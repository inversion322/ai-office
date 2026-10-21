import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkStoryboard, checkReview, checkReportSection, checkProjectVizavi } from '../scripts/check_vizavi.mjs';

const MD = path.join(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), 'video', 'med_detective');
const SB = () => JSON.parse(fs.readFileSync(path.join(MD, 'STORYBOARD_REFERENCE.json'), 'utf8')), RV = () => JSON.parse(fs.readFileSync(path.join(MD, 'REVIEW_LOG_REFERENCE.json'), 'utf8'));
const has = (r, re) => r.problems.some((x) => re.test(x));

test('эталонные раскадровка и журнал проходят проверку (иначе Кирилл не сможет им следовать)', () => {
  assert.deepEqual(checkStoryboard(SB()).problems, []); assert.deepEqual(checkReview(RV()).problems, []);
});
test('раскадровка: нет файла, короткая нить, мало сцен', () => {
  assert.ok(has(checkStoryboard(null), /нет STORYBOARD\.json/));
  const a = SB(); a.thread = 'коротко'; assert.ok(has(checkStoryboard(a), /STORYBOARD\.thread/));
  const b = SB(); b.scenes = b.scenes.slice(0, 2); assert.ok(has(checkStoryboard(b), /нужно не меньше 4/));
});
test('раскадровка: у сцены 2 или 6 вариантов не проходит (нужно 3-5), номер выбора должен существовать, причина обязательна', () => {
  const a = SB(); a.scenes[1].variants = a.scenes[1].variants.slice(0, 2); assert.ok(has(checkStoryboard(a), /сцена 2: вариантов 2/));
  const b = SB(); b.scenes[2].variants = [...b.scenes[2].variants, 'ещё вариант один с другим действием', 'и ещё вариант два совсем другой']; assert.ok(has(checkStoryboard(b), /сцена 3: вариантов 6/));
  const c = SB(); c.scenes[0].chosen = 9; assert.ok(has(checkStoryboard(c), /сцена 1: chosen/));
  const d = SB(); d.scenes[3].why = ''; assert.ok(has(checkStoryboard(d), /сцена 4: why/));
});
test('раскадровка: варианты-перефразировки одного и того же (смена слов без смены действия) не считаются разными', () => {
  const a = SB(); a.scenes[0].variants = ['Цифра гаснет на рекламном щите под лупой утки', 'Цифра на рекламном щите гаснет под лупой утки', 'Цифра под лупой утки гаснет на рекламном щите'];
  assert.ok(has(checkStoryboard(a), /сцена 1: два варианта пересказывают одно и то же/));
});
test('раскадровка: камера, типографика, вход и выход обязательны (последняя сцена без выхода, первая без входа допустимы)', () => {
  const a = SB(); a.scenes[1].camera = ''; a.scenes[2].typography = 'x'; a.scenes[3].in = ''; a.scenes[4].out = '';
  const r = checkStoryboard(a); for (const need of [/сцена 2: поле camera/, /сцена 3: поле typography/, /сцена 4: поле in/, /сцена 5: поле out/]) assert.ok(has(r, need), need + ' :: ' + r.problems.join('; '));
  assert.ok(!has(checkStoryboard(SB()), /сцена 6: поле out/) && !has(checkStoryboard(SB()), /сцена 1: поле in/));
});
test('журнал: пустые поля замечания, одна сборка, нет итоговой проверки и нет честных статусов', () => {
  const a = RV(); a.entries[0].cause = ''; assert.ok(has(checkReview(a), /entries\[1\]: пустое поле cause/));
  const b = RV(); b.builds = 1; assert.ok(has(checkReview(b), /builds/));
  const c = RV(); c.final_check = 'ок'; assert.ok(has(checkReview(c), /final_check/));
  const d = RV(); delete d.statuses.listened; assert.ok(has(checkReview(d), /statuses/));
  const e = RV(); e.statuses.motion_seen = 'да'; assert.ok(has(checkReview(e), /statuses/));
});
test('журнал: «замечаний нет» допустимо только с развёрнутым объяснением, что именно проверено', () => {
  const a = RV(); a.entries = []; assert.ok(has(checkReview(a), /no_defects_reason/));
  a.no_defects_reason = 'Просмотрел весь ролик и каждую границу сцен в движении, прослушал полный микс; дефектов, влияющих на смысл и чтение, не нашёл.'; assert.deepEqual(checkReview(a).problems, []);
});
test('отчёт: раздел «Использовано из vizavi-motion» обязателен; проект целиком: ок / нет файлов', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'vz-')); try {
    assert.ok(checkReportSection(d).length === 1); fs.writeFileSync(path.join(d, 'RESULT.md'), '# Итог\n## Использовано из vizavi-motion\n- раскадровка'); assert.deepEqual(checkReportSection(d), []);
    assert.equal(checkProjectVizavi(d).ok, false);
    fs.copyFileSync(path.join(MD, 'STORYBOARD_REFERENCE.json'), path.join(d, 'STORYBOARD.json')); fs.copyFileSync(path.join(MD, 'REVIEW_LOG_REFERENCE.json'), path.join(d, 'REVIEW_LOG.json'));
    assert.equal(checkProjectVizavi(d, { report: 'RESULT.md' }).ok, true); assert.equal(checkProjectVizavi(d, { report: 'RESULT_v3.md' }).ok, false);
    assert.equal(checkProjectVizavi(d, { review: false, storyboard: true }).ok, true);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

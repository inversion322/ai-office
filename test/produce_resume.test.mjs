// Продолжение монтажа после обрыва сессии: состояние проекта, классификация провала ворот, блок и бриф продолжения, правило бюджета.
// Чистые функции, без моделей и сети. Проекты строятся во временной папке.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { projectState, nextStep, resumeBlock, classifyGate, isArtifactProblem, canContinueShort, shortContinueBrief } from '../scripts/produce_resume.mjs';
import { budgetRules, renderRules } from '../scripts/render_rules.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'resume-'));
const put = (dir, rel, text = 'x') => { const f = path.join(dir, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); return f; };
const later = (f, ms) => { const t = new Date(Date.now() + ms); fs.utimesSync(f, t, t); };
const rounds = (dir, done) => put(dir, '_render_rounds.json', JSON.stringify({ main: { done, fails: 0, history: [] } }));
/** Проект как у №54 после обрыва: всё собрано, круг 1 отрендерен, журнала нет. */
function broken(n = '07') {
  const d = tmp();
  put(d, 'format.json', '{"format":"B"}'); put(d, 'narration.mp3'); put(d, 'words.json', '[]'); put(d, 'STORYBOARD.json', '{}'); put(d, 'LIBRARY_PLAN.json', '{}');
  put(d, `build_dosie${n}.py`); put(d, `final/dosie${n}_v1.mp4`); put(d, 'RESULT.md'); rounds(d, 1);
  return d;
}

test('пустая папка: продолжать нечего, блока продолжения нет', () => {
  const d = tmp();
  assert.equal(projectState(d, 7).resumable, false);
  assert.equal(resumeBlock(d, 7), '');
  assert.equal(resumeBlock(path.join(d, 'нет-такой'), 7), '', 'папки нет совсем');
});

test('только проект без сборщика: не «продолжение», начинать надо с нуля', () => {
  const d = tmp(); put(d, 'format.json', '{"format":"A"}'); put(d, 'narration.mp3'); put(d, 'words.json', '[]');
  const s = projectState(d, 7); assert.equal(s.resumable, false); assert.equal(nextStep(s).id, 'start'); assert.equal(resumeBlock(d, 7), '');
});

test('собранный проект после обрыва: состояние читается по файлам, блок продолжения называет первый невыполненный шаг', () => {
  const d = broken();
  const s = projectState(d, 7);
  assert.deepEqual([s.resumable, s.mp4, s.build, s.rounds, s.reviewLog, s.unrenderedEdits], [true, true, true, 1, null, false]);
  assert.equal(nextStep(s).id, 'review');
  const b = resumeBlock(d, 7);
  assert.match(b, /ПРОДОЛЖЕНИЕ, А НЕ НОВЫЙ РОЛИК/);
  assert.match(b, /Не создавай проект заново/); assert.match(b, /Кругов рендера сделано: 1 из 3 \(осталось 2\)/);
  assert.match(b, /нет REVIEW_LOG\.json/); assert.match(b, /build_dosie07\.py/); assert.match(b, /run_all\.sh/);
});

test('исходники новее готового файла = правки не отрендерены (так остановился монтажёр №54)', () => {
  const d = broken(); later(path.join(d, 'build_dosie07.py'), 60000);
  const s = projectState(d, 7); assert.equal(s.unrenderedEdits, true);
  assert.equal(nextStep(s).id, 'rerender'); assert.match(nextStep(s).text, /НЕ отрендерены/);
  assert.equal(nextStep(s, 3).id, 'rerender');
  rounds(d, 3); assert.match(nextStep(projectState(d, 7)).text, /кругов не осталось/, 'кругов нет: честно финализировать, а не обещать рендер');
});

test('блок продолжения при исчерпанных кругах не обещает рендер: честно «финализируй, что есть»', () => {
  const d = broken(); later(path.join(d, 'build_dosie07.py'), 60000); rounds(d, 3);
  const b = resumeBlock(d, 7);
  assert.match(b, /кругов не осталось/); assert.match(b, /Кругов рендера сделано: 3 из 3 \(осталось 0\)/); assert.doesNotMatch(b, /Отрендерь следующий круг/);
  const one = broken(); later(path.join(one, 'build_dosie07.py'), 60000);
  assert.match(resumeBlock(one, 7), /Отрендерь следующий круг/, 'при остатке кругов рендер предлагается');
  assert.match(resumeBlock(one, 7, { limit: 1 }), /кругов не осталось/, 'лимит берётся из параметра');
});
test('журнал есть: следующий шаг не «просмотр»; файла нет, но сборщик и круг есть: «рендер»', () => {
  const d = broken(); put(d, 'REVIEW_LOG.json', '{"builds":1}');
  assert.equal(nextStep(projectState(d, 7)).id, 'finish');
  const e = tmp(); put(e, 'format.json', '{}'); put(e, 'build_dosie07.py'); rounds(e, 1);
  const s = projectState(e, 7); assert.equal(s.resumable, true); assert.equal(nextStep(s).id, 'render');
});

test('пустые файлы не считаются: нулевой mp4 или пустой words.json = нет', () => {
  const d = tmp(); put(d, 'format.json', '{}'); put(d, 'build_dosie07.py'); put(d, 'final/dosie07_v1.mp4', ''); put(d, 'narration.mp3', ''); put(d, 'words.json', '[]');
  const s = projectState(d, 7); assert.equal(s.mp4, false); assert.equal(s.narration, false); assert.equal(s.resumable, false);
});

test('классификация ворот: только отчётные артефакты отличаются от дефектов качества', () => {
  for (const p of ['vizavi: нет REVIEW_LOG.json или он не читается', 'vizavi: REVIEW_LOG.statuses: честные статусы', 'vizavi: REVIEW_LOG.builds: первая сборка', 'vizavi: в RESULT.md нет раздела «Использовано из vizavi-motion» (что взято)', 'библиотека: в RESULT.md нет раздела «Использовано из библиотеки»'])
    assert.equal(isArtifactProblem(p), true, p);
  for (const p of ['шляпа не по центру: a.html:3 (rotation: 16)', 'динамика: резких смен 3', 'звук: на смене кадра', 'призыв: нет', 'вердикт: слово «миф» в хуке', 'vizavi: STORYBOARD.scenes: вариантов 2', 'библиотека: блок выдуман', 'нужен 1080x1920'])
    assert.equal(isArtifactProblem(p), false, p);
  const a = classifyGate(['vizavi: нет REVIEW_LOG.json или он не читается']); assert.deepEqual([a.onlyArtifacts, a.artifacts.length, a.defects.length], [true, 1, 0]);
  const b = classifyGate(['vizavi: нет REVIEW_LOG.json или он не читается', 'динамика: резких смен 3']); assert.deepEqual([b.onlyArtifacts, b.defects], [false, ['динамика: резких смен 3']]);
  assert.equal(classifyGate([]).onlyArtifacts, false, 'нет проблем: нечего «доводить»'); assert.equal(classifyGate(undefined).onlyArtifacts, false);
});

test('короткое продолжение возможно только если есть готовый файл; бриф честно запрещает выдумывать журнал и пересборку', () => {
  const d = broken(); const cc = canContinueShort(d, 7); assert.equal(cc.ok, true); assert.equal(cc.left, 2);
  const e = tmp(); put(e, 'format.json', '{}'); put(e, 'build_dosie07.py'); rounds(e, 1); assert.equal(canContinueShort(e, 7).ok, false, 'файла нет: короткого продолжения мало, нужен рендер');
  const br = shortContinueBrief({ proj: d, n: 7, title: 'Тема', editorName: 'Матвей Склеев', artifacts: ['vizavi: нет REVIEW_LOG.json или он не читается'], state: cc.state });
  assert.match(br, /Матвей Склеев/); assert.match(br, /нет REVIEW_LOG\.json/); assert.match(br, /Не пересобирай ролик, озвучку и раскадровку/);
  assert.match(br, /Просмотри кадры ГОТОВОГО файла/); assert.match(br, /Выдумывать записи нельзя/); assert.match(br, /20-25 минут/);
  assert.match(br, /Кругов рендера: 1 из 3 \(осталось 2\)/);
  later(path.join(d, 'build_dosie07.py'), 60000);
  const br2 = shortContinueBrief({ proj: d, n: 7, title: 'Тема', editorName: 'М', artifacts: ['x'], state: projectState(d, 7) });
  assert.match(br2, /правки внесены, но не отрендерены/, 'журнал описывает файл: сначала круг');
});

test('правило бюджета: есть в задании на монтаж, нет в правках; названы измеренные сроки и порядок «журнал сразу после круга»', () => {
  const main = renderRules({ proj: 'C:/x/dosie09', scripts: 'C:/s' });
  assert.match(main, /БЮДЖЕТ СЕССИИ: 90 МИНУТ/); assert.match(main, /52, 56 и 74 минуты/); assert.match(main, /СРАЗУ после круга 1/); assert.match(main, /рендер круга 1 не позже 35-й минуты/);
  assert.match(main, /C:\/x\/dosie09\/PROGRESS\.md/, 'путь проекта подставлен'); assert.doesNotMatch(main, /\$\{P\}/, 'шаблон не остался сырым');
  const rw = renderRules({ proj: 'C:/x', scripts: 'C:/s', ns: 'rework2' }); assert.doesNotMatch(rw, /БЮДЖЕТ СЕССИИ/, 'в точечных правках бюджет 90 минут не нужен');
  assert.match(budgetRules('P'), /run_all\.sh/);
});

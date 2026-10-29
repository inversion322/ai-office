// Эксперимент «ответ вперёд» (решение Ника 2026-10-29): пометка, одноразовая заявка в настройках, исключения из вердикт-ворот, задания сотрудникам.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getExperiment, setExperiment, takeNextExperiment, experimentTaskBlock, experimentCheckNote, applyExperimentToBrief, EXPERIMENTS } from '../scripts/experiment.mjs';
import { checkVerdictLabels } from '../scripts/check_verdict_label.mjs';
import { verdictIssues } from '../scripts/script_style.mjs';
import { codewordIssues } from '../scripts/script_codeword.mjs';
import { readSettings, writeSettings } from '../scripts/variants.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'exp-'));
const rm = (d) => fs.rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });

test('пометка эксперимента: пишется рядом со сценарием, читается; без файла и с чужим именем null; неизвестное имя не записывается', () => {
  const d = tmp();
  try {
    assert.equal(getExperiment(d), null);
    setExperiment(d, 'verdict_first'); assert.equal(getExperiment(d), 'verdict_first');
    assert.throws(() => setExperiment(d, 'что-то'), /неизвестный эксперимент/);
    fs.writeFileSync(path.join(d, 'experiment.json'), JSON.stringify({ name: 'левое' })); assert.equal(getExperiment(d), null);
    assert.equal(getExperiment(null), null);
  } finally { rm(d); }
});

test('английская версия (dosieNN_en) наследует пометку оригинала: вердикт-ворота и там не блокируют ответ в начале', () => {
  const d = tmp(), orig = path.join(d, 'dosie05'), en = path.join(d, 'dosie05_en');
  try {
    fs.mkdirSync(orig); fs.mkdirSync(en); setExperiment(orig, 'verdict_first');
    assert.equal(getExperiment(en), 'verdict_first'); assert.equal(getExperiment(path.join(d, 'dosie06_en')), null);
  } finally { rm(d); }
});

test('заявка Ника на следующий ролик берётся ровно один раз и стирается; чужие настройки не трогаются', () => {
  const d = tmp(), f = path.join(d, 'settings.json');
  try {
    writeSettings({ variantFormats: 'A', nextExperiment: 'verdict_first' }, f);
    assert.equal(takeNextExperiment(f), 'verdict_first');
    assert.equal(takeNextExperiment(f), null, 'второй ролик заявку уже не получает');
    const s = readSettings(f); assert.equal(s.variantFormats, 'A'); assert.ok(!('nextExperiment' in s) || s.nextExperiment == null);
    writeSettings({ nextExperiment: 'опечатка' }, f); assert.equal(takeNextExperiment(f), null); assert.equal(readSettings(f).nextExperiment ?? null, null, 'опечатка тоже стёрта');
    assert.equal(takeNextExperiment(path.join(d, 'нет-файла.json')), null);
  } finally { rm(d); }
});

const PROJ_SCENES = [{ n: 's01', start: 0, dur: 2, html: '<div><span>МИФ?</span></div>' }, { n: 's09', start: 30, dur: 4, html: '<div>ФАКТ</div>' }];
function project() {
  const dir = tmp(); fs.mkdirSync(path.join(dir, 'compositions'));
  const divs = PROJ_SCENES.map((s, i) => `<div id="e${i}" data-composition-id="s${i}" data-composition-src="compositions/${s.n}.html" data-start="${s.start}" data-duration="${s.dur}" data-track-index="1"></div>`).join('');
  fs.writeFileSync(path.join(dir, 'index.html'), `<html><body><div id="root" data-duration="40">${divs}</div></body></html>`);
  for (const s of PROJ_SCENES) fs.writeFileSync(path.join(dir, 'compositions', s.n + '.html'), s.html);
  return dir;
}
test('вердикт-ворота монтажа: штамп «МИФ?» во второй секунде блокируется, а с пометкой эксперимента пропускается и это видно в результате', () => {
  const d = project();
  try {
    const bad = checkVerdictLabels(d); assert.equal(bad.ok, false); assert.match(bad.problems.join('|'), /s01\.html/);
    setExperiment(d, 'verdict_first');
    const ok = checkVerdictLabels(d); assert.equal(ok.ok, true); assert.equal(ok.experiment, 'verdict_first'); assert.equal(ok.checked, false);
  } finally { rm(d); }
});

const VF = ['Сорок процентов родителей верят в эту байку. Это миф: сахар не делает детей буйными. Почему? Досмотри до конца. Там же будет слово для бесплатного файла с тридцатью самыми популярными мифами.',
  'Мамы клялись, что малыш неуправляем. Конфеты не было, было только мнение, что она была.',
  'Журнал JAMA, шестнадцать работ. Сахар детям тайком подменяли пустышкой.',
  'Зубам и весу сахар вреден: ВОЗ советует меньше десяти процентов калорий.'];
test('сценарий «ответ вперёд»: обычная проверка вердикта в начале его бы отклонила (поэтому для эксперимента выключается), а проверка обещания слова принимает', () => {
  assert.ok(verdictIssues({ segments: VF }).some((x) => x.rule === 'hook-verdict'), 'без пометки ответ в абзаце 1 блокируется');
  assert.deepEqual(codewordIssues(VF), [], 'обещание в абзаце 1 после ответа: правила про слово не нарушены');
  assert.ok(codewordIssues(VF.map((s, i) => (i === 0 ? s.replace('Досмотри до конца. ', '') : s))).some((x) => /^promise-/.test(x.rule)), 'без «Досмотри до конца» обещание нарушено и в эксперименте');
});

test('задания: Ксения получает устройство абзаца 1, формулу и «не открывай ответ заново», Вера и Кирилл исключение; для неизвестного имени пусто', () => {
  const t = experimentTaskBlock('verdict_first');
  for (const re of [/ОТВЕТ ВПЕРЁД/, /вторая фраза/i, /3-5 секунд/, /Почему\? Досмотри до конца\. Там же будет слово для бесплатного файла с тридцатью самыми популярными мифами\./, /НЕ открывает ответ заново/, /bookend/, /НЕ действует/]) assert.match(t, re, String(re));
  assert.match(experimentCheckNote('verdict_first'), /не возвращай сценарий за это/);
  assert.equal(experimentTaskBlock('x'), ''); assert.equal(experimentCheckNote('x'), ''); assert.equal(applyExperimentToBrief('текст', 'x'), 'текст');
  assert.ok(EXPERIMENTS.verdict_first.title);
});

test('бриф Кирилла: раздел «Вердикт только в конце» заменён исключением, остальные разделы на месте; без эксперимента бриф не меняется (на настоящем шаблоне)', () => {
  const tpl = fs.readFileSync(path.join(ROOT, 'smm', 'brief_template.md'), 'utf8');
  assert.match(tpl, /## Вердикт только в конце/);
  assert.equal(applyExperimentToBrief(tpl, null), tpl);
  const out = applyExperimentToBrief(tpl, 'verdict_first');
  assert.doesNotMatch(out, /## Вердикт только в конце/); assert.match(out, /## ЭКСПЕРИМЕНТ «ОТВЕТ ВПЕРЁД»/); assert.match(out, /переопределяет DESIGN\.md/);
  const heads = (s) => [...s.matchAll(/^## .*$/gm)].map((m) => m[0]);
  assert.equal(heads(out).length, heads(tpl).length, 'разделов столько же, ни один не съеден'); assert.deepEqual(heads(out).filter((h) => !/ОТВЕТ ВПЕРЁД/.test(h)), heads(tpl).filter((h) => !/Вердикт только в конце/.test(h)));
});

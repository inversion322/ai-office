// Качество сценариев (решение Ника 2026-10-21): профиль и модель сценариста и фактчекера, три круга, честная оценка длины, чистая персона без накопленных дублей.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { profileFor, PROFILE_OF } from '../scripts/smm_lib.mjs';
import { lengthVerdict, cutAdvice, ESTIMATE_BIAS, ESTIMATE_MARGIN, SOFT_OVER, LAST_ROUND_OVER } from '../scripts/smm_tts.mjs';
import { EXTRA_AGENTS, CRAFT_MARK, FORMAT_MARK, RULES_MARK, STORY_MARK, VERDICT_MARK, STYLE_MARK } from '../server/lib_extra_agents.mjs';
import { SOURCES_PY } from '../scripts/agent_skills.mjs';

test('Ксения и Вера идут на профиль writer (Opus 5.5 medium), остальной отдел на smm; WRITER_PROFILE=smm откатывает', () => {
  assert.equal(profileFor('scriptwriter', {}), 'writer'); assert.equal(profileFor('factcheck', {}), 'writer');
  for (const id of ['research', 'virality', 'packager', 'captain_smm', 'publisher', undefined]) assert.equal(profileFor(id, {}), 'smm', String(id));
  assert.equal(profileFor('scriptwriter', { WRITER_PROFILE: 'smm' }), 'smm'); assert.equal(profileFor('factcheck', { WRITER_PROFILE: 'smm' }), 'smm'); assert.equal(profileFor('research', { WRITER_PROFILE: 'smm' }), 'smm');
  assert.deepEqual(Object.keys(PROFILE_OF).sort(), ['factcheck', 'scriptwriter']);
});

test('профиль writer настроен: модель claude-opus-5-5, усилие medium, скиллы и sources.py на месте', { skip: !fs.existsSync(SOURCES_PY('writer')) }, () => {
  const dir = process.env.LOCALAPPDATA + '/hermes/profiles/writer', cfg = fs.readFileSync(dir + '/config.yaml', 'utf8');
  assert.match(cfg, /^\s{2}default: "claude-opus-5-5"/m); assert.match(cfg, /^\s{2}reasoning_effort: "medium"/m);
  assert.ok(fs.existsSync(SOURCES_PY('writer')), 'sources.py у Веры'); assert.equal(SOURCES_PY(), SOURCES_PY(process.env.WRITER_PROFILE || 'writer'));
});

test('оценка длины честная: без запаса, поправка на реальный синтез; превышение по оценке до 15% не гонит на сокращение, по замеру любое превышение гонит', () => {
  assert.equal(ESTIMATE_MARGIN, 0); assert.ok(ESTIMATE_BIAS > 1.05 && ESTIMATE_BIAS < 1.15); assert.equal(SOFT_OVER, 0.15);
  const L = 53;
  assert.equal(lengthVerdict({ sec: 50, estimated: true }, L), 'ok'); assert.equal(lengthVerdict({ sec: 53, estimated: true }, L), 'ok');
  assert.equal(lengthVerdict({ sec: 54.4, estimated: true }, L), 'soft', 'это был круг 3: оценка 54,4 с, раньше его резали на 4 секунды');
  assert.equal(lengthVerdict({ sec: 59.2, estimated: true }, L), 'soft', '59,2 с = +11,7%');
  assert.equal(lengthVerdict({ sec: 62.2, estimated: true }, L), 'cut', '62,2 с = +17%: настоящее превышение');
  assert.equal(lengthVerdict({ sec: 54.4, estimated: false }, L), 'cut', 'настоящий замер: любое превышение режется');
  assert.equal(lengthVerdict(null, L), 'ok');
});

test('сид Ксении: одна короткая персона без накопленных блоков, на Opus; Вера на Opus; тест «сцена, а не тезис» и порядок «сначала текст» на месте', () => {
  const k = EXTRA_AGENTS.find((a) => a.id === 'scriptwriter'), v = EXTRA_AGENTS.find((a) => a.id === 'factcheck');
  assert.equal(k.model, 'claude-opus-5-5'); assert.equal(v.model, 'claude-opus-5-5');
  assert.ok(k.prompt.length < 6000, 'персона ' + k.prompt.length + ' знаков (раньше 8000 из семи блоков)');
  for (const m of [CRAFT_MARK, FORMAT_MARK, RULES_MARK, STORY_MARK, VERDICT_MARK, STYLE_MARK]) assert.ok(!k.prompt.includes(m), 'блок не должен дописываться: ' + m.slice(0, 30));
  assert.match(k.prompt, /не пересказ тезисов/); assert.match(k.prompt, /можно ли его нарисовать/); assert.match(k.prompt, /Сначала напиши текст целиком/); assert.match(k.prompt, /Лимит слов не повод резать образы/);
  assert.equal((k.prompt.match(/110-140|115 слов/g) || []).length, 0, 'противоречивых лимитов слов в персоне нет: длину называет задание');
  for (const w of ['улика', 'Потому что', 'вердикт', 'призыв']) assert.ok(k.prompt.toLowerCase().includes(w.toLowerCase()), 'запрет сохранён: ' + w);
});

test('SCRIPT_CRAFT.md начинается с раздела «Сцена, а не тезис» и содержит разбор настоящего провала', () => {
  const t = fs.readFileSync(new URL('../video/med_detective/SCRIPT_CRAFT.md', import.meta.url), 'utf8');
  assert.ok(t.indexOf('## 00. Сцена, а не тезис') > 0 && t.indexOf('## 00.') < t.indexOf('## 0. Что значит'), 'раздел идёт первым');
  assert.match(t, /Сканы неидеальны, работает не всё сразу/); assert.match(t, /Ставка зрителя звучит вслух/);
});

test('последний круг: небольшой перебор (до 10%) по настоящему замеру не бросает сценарий, большой бросает; в обычных кругах настоящий перебор режется', () => {
  const L = 53; assert.equal(LAST_ROUND_OVER, 0.10);
  assert.equal(lengthVerdict({ sec: 56.4, estimated: false }, L), 'cut', 'не последний круг: режем');
  assert.equal(lengthVerdict({ sec: 56.4, estimated: false }, L, { lastRound: true }), 'soft', '56,4 с = +6,4%: это круг 3 пробного прогона, раньше сценарий отбрасывался');
  assert.equal(lengthVerdict({ sec: 58.3, estimated: false }, L, { lastRound: true }), 'soft', '+10,0%: граница включительно'); assert.equal(lengthVerdict({ sec: 58.4, estimated: false }, L, { lastRound: true }), 'cut', '+10,2%: уже отказ');
  assert.equal(lengthVerdict({ sec: 59.5, estimated: false }, L, { lastRound: true }), 'cut', '+12%: отказ');
});

test('подсказка на сокращение: секунды по абзацам, число слов не называется, сказано что резать и что НЕ резать', () => {
  const m = cutAdvice(56.4, 53, { perSeg: '1) 6.9 с, 13 сл.; 2) 8.3 с, 16 сл.' });
  assert.match(m, /Нужно убрать около 5 с/); assert.match(m, /Секунды, не слова/); assert.match(m, /РЕЖЬ: повторы/); assert.match(m, /НЕ РЕЖЬ: сцену/); assert.match(m, /1\) 6\.9 с/);
  assert.doesNotMatch(m, /≈ 0,4\d с/, 'константы секунд на слово больше нет: она гуляет от 0,40 до 0,59'); assert.doesNotMatch(m, /примерно \d+ слов/); assert.doesNotMatch(m, /улик/i, 'слова «улика» в подсказке нет: оно под запретом');
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { craftIssues, craftFeedback, craftSummary } from '../scripts/script_craft.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GOOD = {
  idea: 'Бурю у детей после сладкого создаёт ожидание взрослых, а не сахар.', emotion_arc: ['любопытство', 'удивление', 'недоверие', 'ясность'],
  payoff: 'буря на празднике это не сладкое, а сам праздник',
  hook_options: [{ type: 'слух', line: 'a', score: 9 }, { type: 'откуда', line: 'b', score: 7 }, { type: 'эксперимент', line: 'c', score: 8 }],
  segments: ['Говорят, что от сладкого дети сходят с ума. Правда ли это? Откуда вообще такая уверенность?', 'Но учёные проверили: двадцать три эксперимента, сахар тайно подменяли заменой.', 'Поэтому вывод такой: на поведение детей сахар не влияет. Небольшой эффект исключить нельзя.', 'Но почему родители так уверены? Мамам сказали: сын съел много сахара. А все дети получили пустышку. Мамы всё равно нашли сыновей гиперактивнее.', 'Значит, вероятно, дело в ожидании: от сладкого ждут бури.', 'Так что буря на празднике это не сладкое, а сам праздник.'],
  chain: [{ to: 2, link: 'но' }, { to: 3, link: 'поэтому' }, { to: 4, link: 'но' }, { to: 5, link: 'поэтому' }, { to: 6, link: 'поэтому' }],
};
const rules = (sc, o) => craftIssues(sc, o).issues.map((x) => x.rule);

test('хороший сценарий (образец из SCRIPT_CRAFT.md) проходит, а его сводка для карточки показывает идею, дугу и связки', () => {
  assert.deepEqual(craftIssues(GOOD).issues, []);
  const s = craftSummary(GOOD); assert.match(s, /Идея: Бурю у детей/); assert.match(s, /Эмоция: любопытство → удивление → недоверие → ясность/); assert.match(s, /Связки: 1→2 но, 2→3 поэтому, 3→4 но, 4→5 поэтому, 5→6 поэтому/);
});

test('регрессия: текст про 10 000 шагов, который Нику не понравился (список фактов без цепочки, ярлыки «Метаанализ:»), не проходит', () => {
  const old = JSON.parse(fs.readFileSync(path.join(ROOT, 'test', 'fixtures', 'steps_rejected_script.json'), 'utf8'));
  const r = rules(old); for (const need of ['arc', 'chain', 'payoff', 'telegraphic']) assert.ok(r.includes(need), need + ' должен быть найден: ' + r);
});

test('нет связки «но»: напряжения нет', () => {
  const sc = { ...GOOD, chain: GOOD.chain.map((c) => ({ ...c, link: 'поэтому' })) };
  assert.ok(rules(sc).includes('chain-but'));
});

test('связка в chain заявлена, но в тексте не слышна («но» без «но»)', () => {
  const seg = [...GOOD.segments]; seg[1] = 'Учёные проверили: двадцать три эксперимента, сахар тайно подменяли заменой.';
  const r = craftIssues({ ...GOOD, segments: seg }).issues; assert.ok(r.some((x) => x.rule === 'chain-text' && /абзац 2/.test(x.say)));
});

test('«и потом», «далее» вместо «но/поэтому» в chain отвергается', () => {
  const sc = { ...GOOD, chain: GOOD.chain.map((c, i) => (i === 1 ? { ...c, link: 'и потом' } : c)) };
  assert.ok(rules(sc).includes('chain-link'));
});

test('число связок должно совпадать с числом переходов между абзацами', () => {
  assert.ok(rules({ ...GOOD, chain: GOOD.chain.slice(0, 3) }).includes('chain'));
});

test('payoff должен дословно стоять в одном из двух последних абзацев', () => {
  assert.ok(rules({ ...GOOD, payoff: 'совсем другая фраза про что-то иное' }).includes('payoff-text'));
  assert.ok(rules({ ...GOOD, payoff: '' }).includes('payoff'));
});

test('финал обязан замыкаться на хук: общий ключевой корень с первым абзацем', () => {
  const seg = [...GOOD.segments]; seg[5] = 'Так что буря на празднике это ожидание взрослых и ничего более.';
  assert.ok(rules({ ...GOOD, segments: seg, payoff: 'буря на празднике это ожидание взрослых и ничего более' }).includes('loop'));
});

test('ярлыки с двоеточием («Метаанализ:», «ВОЗ:») считаются протоколом, обычное «Но учёные проверили:» нет', () => {
  const seg = ['Говорят, что сладкое вредит? Правда ли.', 'Метаанализ: сорок семь тысяч.', 'ВОЗ: любая активность лучше.', 'Так что сладкое не при чём.'];
  assert.ok(rules({ ...GOOD, segments: seg, chain: [{ link: 'но' }, { link: 'но' }, { link: 'поэтому' }], payoff: 'сладкое не при чём' }).includes('telegraphic'));
  assert.ok(!rules(GOOD).includes('telegraphic'));
});

test('хуки: нужны три разных семейства; для мифа хук задаёт вопрос зрителю, для советов нет', () => {
  assert.ok(rules({ ...GOOD, hook_options: [{ type: 'слух' }, { type: 'слух' }, { type: 'цифра' }] }).includes('hooks'));
  const seg = [...GOOD.segments]; seg[0] = 'От сладкого дети сходят с ума. Откуда такая уверенность.';
  assert.ok(rules({ ...GOOD, segments: seg }).includes('hook-question'));
  assert.ok(!rules({ ...GOOD, segments: seg }, { rubric: 'tips' }).includes('hook-question'));
});

test('замечание для Ксении называет конкретные проблемы и запрещает трогать факты', () => {
  const fb = craftFeedback(craftIssues({ ...GOOD, chain: [], payoff: '' }).issues);
  assert.match(fb, /Автопроверка драматургии/); assert.match(fb, /SCRIPT_CRAFT\.md/); assert.match(fb, /новых утверждений не добавляй/); assert.equal(craftFeedback([]), '');
});

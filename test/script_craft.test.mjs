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
  lens: { candidates: ['Подозреваемый с железным алиби: сахар в опыте подменяли пустышкой (инверсия злодея)', 'Бурю создаёт праздник, а не конфета (эффект второго порядка)', 'Взгляд мамы, уверенной, что сын после сладкого неуправляем (смена точки зрения)'], chosen: 2, why: 'опыт с пустышкой' },
  stake: 'Вы после каждой конфеты ждёте от ребёнка бурю и заранее ругаете сладкое',
  gaps: ['Сладкое ли делает детей гиперактивными на самом деле?', 'Почему же мы каждый раз видим бурю?'], bookend: 'сладкое',
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

test('история: у образца угол выбран из трёх, а карточка Ника показывает угол и ставку зрителя', () => {
  const s = craftSummary(GOOD); assert.match(s, /Угол: Бурю создаёт праздник/); assert.match(s, /Что у зрителя в ставке: Вы после каждой конфеты/);
});
test('история: нет угла, ставки, интриг и кольца, и каждая нехватка названа своим правилом', () => {
  const sc = { ...GOOD }; delete sc.lens; delete sc.stake; delete sc.gaps; delete sc.bookend;
  const r = rules(sc); for (const need of ['lens', 'stake', 'gaps', 'bookend']) assert.ok(r.includes(need), need + ': ' + r);
});
test('история: три угла, но два из них перефразировка одного, не проходят; выбранный номер обязан существовать', () => {
  const dup = { ...GOOD, lens: { candidates: ['Сахар в опыте подменяли пустышкой, и дети вели себя так же', 'Сахар в опыте подменяли пустышкой, дети всё равно вели себя так же', 'Праздник, а не конфета, создаёт бурю у детей'], chosen: 3, why: 'опыт' } };
  assert.ok(rules(dup).includes('lens-distinct'), rules(dup).join());
  const bad = { ...GOOD, lens: { ...GOOD.lens, chosen: 7 } }; assert.ok(rules(bad).includes('lens-chosen'));
  const thin = { ...GOOD, lens: { ...GOOD.lens, why: '' } }; assert.ok(rules(thin).includes('lens-why'));
});
test('история: кольцо хука и финала: слово из bookend обязано стоять в первом и в последнем абзаце', () => {
  const only1 = { ...GOOD, bookend: 'уверенность' }; assert.ok(rules(only1).includes('bookend-text'), 'в финале слова нет: ' + rules(only1).join());
  const ok = { ...GOOD, bookend: 'сладкое' }; assert.ok(!rules(ok).includes('bookend-text'));
});
test('история: четыре абзаца подряд, забитые числами (отчёт об опыте), помечаются; а живые абзацы с одной цифрой нет', () => {
  const num = { ...GOOD, segments: ['Говорят, что кофе обезвоживает. Правда ли это?', 'Пятьдесят мужчин, три дня, четыре чашки кофе.', 'Двадцать три эксперимента, шестнадцать работ, сорок человек.', 'Пятьдесят один килограмм воды, два литра, три дня.', 'Сто двадцать участников, пять групп, десять недель.', 'Так что кофе это вода.'] };
  assert.ok(rules(num).includes('numbers-run'), rules(num).join()); assert.ok(!rules(GOOD).includes('numbers-run'));
});
test('STORY_GATE=off отключает только проверки истории (для тестов других этапов)', () => {
  const sc = { ...GOOD }; delete sc.lens; delete sc.stake; delete sc.gaps; delete sc.bookend;
  process.env.STORY_GATE = 'off'; try { assert.deepEqual(craftIssues(sc).issues, []); } finally { delete process.env.STORY_GATE; }
});

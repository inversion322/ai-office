// Варианты одного ролика: метки, монтажёры, ротация порядка, проверка различий, числа, задание Ксении.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { titleClash, slotFor, MIN_AHEAD_MIN, parseVariantComment, anchorOf, isDropped, LETTERS, FORMATS, EDITORS, GAP_MIN, variantOf, formatOf, editorOf, enabledFormats, groupMembers, isGroup, publishOrder, publishSchedule, compareVariants, unknownNumbers, numbersOf, variantBrief, summaryRows, ENDING_MAX } from '../scripts/variants.mjs';

const vid = (id, letter, group, extra = {}) => ({ id, title: 'Кофе', notes: JSON.stringify(letter ? { variant: { group, letter, format: letter, rotation: 0 }, ...extra } : extra) });

test('форматы и монтажёры: A у Кирилла, B и C у своих; одиночный ролик без метки это A у Кирилла', () => {
  assert.deepEqual(LETTERS, ['A', 'B', 'C']); assert.equal(GAP_MIN, 30);
  assert.equal(EDITORS[FORMATS.A.editor].name, 'Кирилл Кадров'); assert.equal(FORMATS.B.editor, 'video_b'); assert.equal(FORMATS.C.editor, 'video_c');
  assert.equal(variantOf({ notes: '{}' }), null); assert.equal(variantOf({ notes: 'не json' }), null); assert.equal(variantOf(null), null);
  assert.equal(formatOf({ notes: '{}' }), 'A'); assert.equal(editorOf({ notes: '{}' }).id, 'video');
  assert.equal(editorOf(vid(2, 'B', 1)).id, 'video_b'); assert.equal(editorOf(vid(3, 'C', 1)).profile, 'video_c'); assert.equal(formatOf(vid(3, 'C', 1)), 'C');
  assert.equal(variantOf({ notes: JSON.stringify({ variant: { letter: 'Z' } }) }), null, 'неизвестная буква не считается меткой');
});

test('какие форматы включены: по умолчанию A,B,C; можно выключить; A всегда есть; мусор отбрасывается', () => {
  assert.deepEqual(enabledFormats(undefined), ['A', 'B', 'C']); assert.deepEqual(enabledFormats(''), ['A', 'B', 'C']);
  assert.deepEqual(enabledFormats('A'), ['A']); assert.deepEqual(enabledFormats('a, c'), ['A', 'C']); assert.deepEqual(enabledFormats('B'), ['A', 'B']); assert.deepEqual(enabledFormats('X,Y'), ['A']);
});

test('группа: участники по буквам, включая базовую запись; одиночный ролик группой не считается', () => {
  const all = [vid(5, 'C', 3), vid(3, 'A', 3), vid(4, 'B', 3), vid(9, 'A', 9), { id: 11, title: 'без метки', notes: '{}' }];
  assert.deepEqual(groupMembers(all, all[1]).map((m) => m.id), [3, 4, 5]); assert.deepEqual(groupMembers(all, all[0]).map((m) => m.id), [3, 4, 5], 'из любого участника');
  assert.equal(isGroup(groupMembers(all, all[1])), true);
  assert.deepEqual(groupMembers(all, all[4]).map((m) => m.id), [11]); assert.equal(isGroup(groupMembers(all, all[4])), false);
  assert.equal(isGroup(groupMembers(all, all[3])), false, 'одна запись A без братьев');
});

test('порядок выхода меняется от темы к теме и всегда содержит все буквы', () => {
  assert.deepEqual(publishOrder(0), ['A', 'B', 'C']); assert.deepEqual(publishOrder(1), ['B', 'C', 'A']); assert.deepEqual(publishOrder(2), ['C', 'A', 'B']); assert.deepEqual(publishOrder(3), ['A', 'B', 'C']);
  assert.deepEqual(publishOrder(4, ['A', 'B']), ['A', 'B']); assert.deepEqual(publishOrder(-1), ['C', 'A', 'B']);
  for (let r = 0; r < 9; r++) assert.deepEqual([...publishOrder(r)].sort(), ['A', 'B', 'C']);
});

test('расписание: интервал 30 минут между роликами', () => {
  const s = publishSchedule(['B', 'C', 'A'], '2026-10-22T09:00:00Z');
  assert.deepEqual(s.map((x) => x.letter), ['B', 'C', 'A']); assert.deepEqual(s.map((x) => x.at.toISOString()), ['2026-10-22T09:00:00.000Z', '2026-10-22T09:30:00.000Z', '2026-10-22T10:00:00.000Z']);
});

const A = { letter: 'A', hook_type: 'вопрос-ловушка', segments: ['Говорят, что кофе обезвоживает. Правда ли это?', 'Британцы пометили воду в телах пятидесяти мужчин. Три дня те пили кофе, три дня воду.', 'Вода в организме у обеих групп вела себя одинаково, а моча отличалась меньше, чем думали.', 'Чашку кофе зря обвиняли: в сумме за день жидкости она даёт столько же, сколько вода.'] };
const B = { letter: 'B', hook_type: 'цифра', segments: ['Пятьдесят мужчин, шесть дней и один вопрос про утреннюю чашку.', 'Исследователи Киллер с коллегами разделили дни на кофейные и водные и измеряли, сколько жидкости остаётся в теле.', 'Итог по приборам удивил самих авторов: разница между напитками почти не видна на графике.', 'Утренний кофе вы можете оставить, график это позволяет.'] };
const Cc = { letter: 'C', hook_type: 'контраст', segments: ['Мне сказали, что кофе сушит, а я не поверил.', 'Учёные из Бирмингема поспорили с этим мифом и провели собственный опыт.', 'Выяснилось, что по общему балансу воды кофе и вода идут вровень.', 'Так что пейте, не считая каждую чашку мифической потерей воды.'] };

test('разные хуки, тексты и концовки проходят сравнение; почти копия варианта A нет', () => {
  const ok = compareVariants([A, B, Cc]); assert.equal(ok.ok, true, ok.problems.join('; '));
  assert.deepEqual(ok.per.map((p) => p.letter), ['A', 'B', 'C']);
  const copy = compareVariants([A, { ...A, letter: 'B', segments: A.segments.map((s) => s.replace('Британцы', 'Англичане')) }]);
  assert.equal(copy.ok, false); assert.match(copy.problems.join(' '), /B:/);
});

test('тот же тип крючка у двух вариантов отклоняется, даже при разном тексте', () => {
  const r = compareVariants([A, { ...B, hook_type: 'вопрос-ловушка' }]); assert.equal(r.ok, false); assert.match(r.problems.join(' '), /тип крючка «вопрос-ловушка» уже у варианта A/);
});

test('одинаковая концовка у вариантов отклоняется', () => {
  const same = { ...B, segments: [...B.segments.slice(0, -1), A.segments[A.segments.length - 1]] };
  const r = compareVariants([A, same]); assert.equal(r.ok, false); assert.match(r.problems.join(' '), /концовка совпадает с вариантом A/); assert.ok(ENDING_MAX < 0.5);
});

test('новые числа: вариант не добавляет цифр, которых нет в проверенных материалах', () => {
  const trusted = 'пятьдесят мужчин, 24416202, 50 участников, 3 дня, 1.5 литра';
  assert.deepEqual(unknownNumbers('В опыте было 50 человек и 3 дня', trusted), []);
  assert.deepEqual(unknownNumbers('Выпили 2,5 литра и 70 процентов', trusted), ['2.5', '70']);
  assert.deepEqual(unknownNumbers('Выпили 1,5 литра', trusted), [], 'запятая и точка равны');
  assert.deepEqual(numbersOf('в 2014 году 50 мужчин'), ['2014', '50']);
});

test('задание Ксении: формат, запрет новых фактов, прежние варианты для различия', () => {
  const b = variantBrief({ letter: 'B', format: 'B', baseTitle: 'Кофе', baseSegments: A.segments, baseHookType: A.hook_type });
  assert.match(b, /ВАРИАНТ B ТОЙ ЖЕ ТЕМЫ: формат «Один объект»/); assert.match(b, /ТОЛЬКО их/); assert.match(b, /ПУТЬ ОДНОГО ПРЕДМЕТА/); assert.match(b, /Британцы пометили воду/);
  const c = variantBrief({ letter: 'C', format: 'C', baseTitle: 'Кофе', baseSegments: A.segments, baseHookType: A.hook_type, others: [B] });
  assert.match(c, /«Диалог»/); assert.match(c, /skeptic/); assert.match(c, /Вариант B \(тип крючка «цифра»\)/); assert.match(c, /Вариант A \(тип крючка «вопрос-ловушка»\)/);
});

test('сводка для карточки: формат, тип крючка, первая и последняя фраза', () => {
  const rows = summaryRows([{ ...A, format: 'A' }, { ...B, format: 'B' }]);
  assert.equal(rows[0].format, 'Лента'); assert.equal(rows[1].format, 'Один объект'); assert.match(rows[0].first, /^Говорят, что кофе обезвоживает/); assert.match(rows[1].last, /Утренний кофе/); assert.equal(rows[1].hook_type, 'цифра');
});

test('названия вариантов: похожее на название соседа отклоняется, другое по хуку проходит', () => {
  const taken = [{ letter: 'A', title: 'Что скрывает чашка кофе по утрам?' }, { letter: 'B', title: 'Пятьдесят мужчин и одна чашка' }];
  assert.equal(titleClash('Что скрывает чашка кофе по утрам для здоровья', taken).length, 1); assert.equal(titleClash('Что скрывает чашка кофе по утрам для здоровья', taken)[0].letter, 'A');
  assert.deepEqual(titleClash('Кофе против воды: кто победил в лаборатории', taken), []); assert.deepEqual(titleClash('Любое название', []), []);
});

test('слот в очереди: позиция × 30 минут от старта; пока старта нет, слота нет; ближе 10 минут публикуем сразу', () => {
  const t0 = Date.parse('2026-10-22T09:00:00Z');
  assert.equal(slotFor(['B', 'C', 'A'], 'B', t0).toISOString(), '2026-10-22T09:00:00.000Z'); assert.equal(slotFor(['B', 'C', 'A'], 'C', t0).toISOString(), '2026-10-22T09:30:00.000Z'); assert.equal(slotFor(['B', 'C', 'A'], 'A', t0).toISOString(), '2026-10-22T10:00:00.000Z');
  assert.equal(slotFor(['B', 'C', 'A'], 'A', null), null); assert.equal(slotFor(['B', 'C'], 'A', t0), null); assert.equal(MIN_AHEAD_MIN, 10);
});

test('правка к группе: «B: …» к варианту B, без буквы к A; кириллические А, В, С считаются латинскими; пустое не разбирается', () => {
  assert.deepEqual(parseVariantComment('B: сделай концовку короче'), { letter: 'B', text: 'сделай концовку короче' });
  assert.deepEqual(parseVariantComment('вариант C — убери вторую реплику'), { letter: 'C', text: 'убери вторую реплику' });
  assert.deepEqual(parseVariantComment('В) короче хук'), { letter: 'B', text: 'короче хук' }, 'кириллическая В');
  assert.deepEqual(parseVariantComment('убери вторую фразу'), { letter: null, text: 'убери вторую фразу' }); assert.deepEqual(parseVariantComment('Bтоже плохо без разделителя'), { letter: null, text: 'Bтоже плохо без разделителя' });
  assert.deepEqual(parseVariantComment(''), { letter: null, text: '' });
});

test('якорь группы: вариант A, пока он ждёт утверждения, иначе первый живой; убранные и отклонённые не берутся', () => {
  const m = (id, letter, stage, extra = {}) => ({ id, stage, notes: JSON.stringify({ variant: { group: 1, letter, format: letter }, ...extra }) });
  assert.equal(anchorOf([m(1, 'A', 'checked'), m(2, 'B', 'checked')]).id, 1); assert.equal(anchorOf([m(1, 'A', 'rejected'), m(2, 'B', 'checked'), m(3, 'C', 'checked')]).id, 2);
  assert.equal(anchorOf([m(1, 'A', 'rejected')]), null); assert.equal(isDropped(m(2, 'B', 'rejected', { dropped: true })), true); assert.equal(isDropped(m(2, 'B', 'checked')), false);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRows, renderTable, replaceTable, outAt } from '../scripts/variants_report.mjs';

const mk = (id, letter, stage = 'approved', group = 100) => ({ id, title: 'Кофе обезвоживает?', stage, notes: JSON.stringify({ variant: { group, letter, format: letter } }) });
const states = { 100: { youtube: [{ url: 'https://youtube.com/shorts/aaa', privacy: 'public', ts: '2026-10-22T09:00:00.000Z' }] }, 101: { youtube: [{ url: 'https://youtube.com/shorts/bbb', privacy: 'private', scheduledFor: '2026-10-22T09:30:00.000Z', ts: '2026-10-22T09:01:00.000Z' }] }, 102: {} };

test('строки: по буквам, убранные варианты и одиночные ролики не попадают, время выхода из состояния публикации', () => {
  const all = [mk(102, 'C'), mk(101, 'B'), mk(100, 'A'), mk(103, 'B', 'rejected', 100), { id: 5, title: 'Одиночка', stage: 'approved', notes: '{}' }];
  const rows = buildRows(all, (id) => states[id] || {});
  assert.deepEqual(rows.map((r) => r.letter), ['A', 'B', 'C']); assert.equal(rows[0].out.planned, false); assert.equal(rows[1].out.planned, true); assert.equal(rows[2].out, null);
  assert.equal(outAt({ youtube: [{ privacy: 'private', ts: 'x' }] }), null, 'приватная проверка не считается выходом');
});

test('таблица: время в МСК, пометка «по слоту», пустые колонки под метрики; замена в FORMATS.md не трогает остальной текст', () => {
  const rows = buildRows([mk(100, 'A'), mk(101, 'B'), mk(102, 'C')], (id) => states[id] || {}), t = renderTable(rows);
  assert.match(t, /\| A \(№100\) \| .* \| 22\.10 12:00 \[ссылка\]\(https:\/\/youtube\.com\/shorts\/aaa\) \| \| \| \| \|/); assert.match(t, /22\.10 12:30 \(по слоту\)/); assert.match(t, /ещё не вышел/);
  const md = '# Форматы\n\nтекст до\n\n| Тема | Вариант | Формат | Выход (МСК) | Просмотры | Просмотрели, % | Удержание, % | Подписчики |\n|---|---|---|---|---|---|---|---|\n| старая | строка |\n\nтекст после\n';
  const out = replaceTable(md, t); assert.match(out, /^# Форматы\n\nтекст до\n\n\| Тема/); assert.match(out, /\n\nтекст после\n$/); assert.doesNotMatch(out, /старая/); assert.equal((out.match(/\| Тема \| Вариант \|/g) || []).length, 1);
  assert.throws(() => replaceTable('нет таблицы', t), /нет таблицы/);
});

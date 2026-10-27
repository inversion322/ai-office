// Календарь студии: чистая логика отрисовки (общая для веб-офиса и Mini App)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const C = createRequire(import.meta.url)('../web/cal_core.js');

test('подписи дней и недели', () => {
  assert.equal(C.dayHead('2026-10-26'), 'Пн 26.10'); assert.equal(C.dayHead('2026-11-01'), 'Вс 01.11'); assert.equal(C.dayHead('2027-01-01'), 'Пт 01.01');
  assert.equal(C.weekLabel('2026-10-26', '2026-11-01'), '26 октября – 1 ноября'); assert.equal(C.weekLabel('2026-11-02', '2026-11-08'), '2–8 ноября');
});
test('ячейка: слоты с иконками и классом тона, подсказка для пустой, прошлое и сегодня', () => {
  const slots = [{ slot: 'post1', kind: 'post', time: '12:00', title: 'Быстрая ходьба продлевает жизнь?', tone: 'you', label: 'ждёт вашего «да»' }, { slot: 'video', kind: 'video', time: '18:30', title: 'Т '.repeat(60), tone: 'work', label: 'идёт монтаж' }];
  const v = C.cellView({ date: '2026-10-28', channel: 'm', plan: { status: 'approved', label: 'утверждён' }, slots, canPlan: false }, '2026-10-28');
  assert.deepEqual(v.slots.map((s) => [s.icon, s.cls]), [['📝', 'cal-you'], ['🎬', 'cal-work']]); assert.ok(v.slots[1].short.length <= 64 && v.slots[1].short.endsWith('…')); assert.equal(v.head, 'утверждён'); assert.equal(v.today, true); assert.equal(v.empty, false);
  assert.equal(C.cellView({ date: '2026-10-29', plan: null, slots: [], canPlan: true }, '2026-10-28').hint, 'плана нет');
  assert.equal(C.cellView({ date: '2026-10-20', plan: null, slots: [] }, '2026-10-28').hint, 'плана не было');
  assert.match(C.cellView({ date: '2026-10-29', plan: null, slots: [], autoAt: Date.parse('2026-10-28T17:00:00Z') }, '2026-10-28').hint, /план соберётся сам: 28\.10.* 20:00/);
  assert.match(C.cellView({ date: '2026-10-29', plan: { status: 'proposed', label: 'ждёт вашего выбора', options: { video: 4, posts: 5 } }, slots: [] }, '2026-10-28').head, /вариантов: видео 4, посты 5/);
  assert.equal(C.toneClass('нет такого'), 'cal-wait');
});
test('значок «ждёт вас»: строки со статусом you и планы без выбора', () => {
  assert.equal(C.needYou({ cells: [{ slots: [{ tone: 'you' }, { tone: 'ok' }] }, { slots: [{ tone: 'you' }] }, { plan: { status: 'proposed' }, slots: [] }, { slots: [] }] }), 3); assert.equal(C.needYou({}), 0);
});
test('экранирование: заголовок темы не ломает разметку', () => { assert.equal(C.esc('<b>"x" & \'y\'</b>'), '&lt;b&gt;&quot;x&quot; &amp; &#39;y&#39;&lt;/b&gt;'); });
test('Mini App пускает сессию телефона к календарю (просмотр, план на дату, автоплан) и только к ним', () => {
  const src = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'server', 'server.mjs'), 'utf8');
  const list = /MINI_ALLOWED = (\[[\s\S]*?\]\]);/.exec(src)[1];
  for (const r of ["['GET', '/api/studio/calendar']", "['POST', '/api/studio/plan']", "['POST', '/api/studio/settings']"]) assert.ok(list.includes(r), r);
  assert.ok(!/\/api\/prompt|\/api\/agent'|\/api\/scene|\/api\/video/.test(list), 'промпты, статусы и сцены телефону по-прежнему недоступны');
});

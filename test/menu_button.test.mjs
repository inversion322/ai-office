import { test } from 'node:test';
import assert from 'node:assert/strict';
import { updateMenuButton, updateMenuButtonPatiently } from '../scripts/menu_button.mjs';

const noWait = () => Promise.resolve();
test('ставит кнопку web_app с постоянной страницей и текущим адресом API в параметре', async () => {
  let call; const r = await updateMenuButton(async (m, b) => { call = { m, b }; return { ok: true, result: true }; }, 'https://new-one.trycloudflare.com', { wait: noWait });
  assert.equal(r.ok, true); assert.equal(call.m, 'setChatMenuButton'); assert.equal(call.b.chat_id, 323028999);
  assert.equal(call.b.menu_button.type, 'web_app'); assert.equal(new URL(call.b.menu_button.web_app.url).searchParams.get('api'), 'https://new-one.trycloudflare.com');
  assert.equal(new URL(call.b.menu_button.web_app.url).origin + new URL(call.b.menu_button.web_app.url).pathname, 'https://inversion322.github.io/ai-office/app.html');
});
test('временный сбой Telegram: повторяет с нарастающей паузой и в итоге ставит', async () => {
  let n = 0; const waits = [];
  const r = await updateMenuButton(async () => { n++; if (n < 3) throw new Error('ETIMEDOUT'); return { ok: true }; }, 'https://a.trycloudflare.com', { wait: async (ms) => waits.push(ms), baseMs: 1000 });
  assert.equal(r.ok, true); assert.equal(r.attempts, 3); assert.deepEqual(waits, [1000, 2000]);
});
test('постоянный отказ: не зацикливается, возвращает причину (чтобы сообщить Нику ссылку вручную)', async () => {
  let n = 0; const r = await updateMenuButton(async () => { n++; return { ok: false, description: 'Too Many Requests' }; }, 'https://a.trycloudflare.com', { wait: noWait, retries: 4 });
  assert.equal(r.ok, false); assert.equal(n, 4); assert.match(r.error, /Too Many/); assert.match(r.url, /api=/);
});
test('адрес, который Telegram не примет (не HTTPS), повторами не долбим', async () => {
  let n = 0; const r = await updateMenuButton(async () => { n++; return { ok: false, description: 'Bad Request: ... Only HTTPS links are allowed' }; }, 'http://x', { wait: noWait });
  assert.equal(r.ok, false); assert.equal(n, 1);
});

// Сеть после включения ПК поднимается минуту и дольше: быстрые попытки её не переждут, нужен долгий повтор.
test('сети нет несколько раундов, потом появилась: кнопка ставится, паузы между раундами соблюдены', async () => {
  let n = 0; const waits = []; const retries = [];
  const r = await updateMenuButtonPatiently(async () => { n++; if (n <= 8) throw new Error('fetch failed'); return { ok: true }; }, 'https://a.trycloudflare.com',
    { wait: async (ms) => waits.push(ms), baseMs: 1, intervalMs: 30000, onRetry: (i) => retries.push(i) });
  assert.equal(r.ok, true); assert.equal(r.rounds, 3);                      // 4 попытки + 4 попытки + успех на 9-й
  assert.equal(waits.filter((w) => w === 30000).length, 2); assert.deepEqual(retries, [1, 2]);
});
test('адрес уже сменился: старый вызов снимается и не перетирает кнопку чужим адресом', async () => {
  let current = true; let n = 0;
  const r = await updateMenuButtonPatiently(async () => { n++; current = false; throw new Error('fetch failed'); }, 'https://old.trycloudflare.com',
    { wait: noWait, isCurrent: () => current });
  assert.equal(r.ok, false); assert.equal(r.superseded, true); assert.equal(n, 4);   // один раунд, дальше не лезет
});
test('сети нет совсем: не бесконечно, после rounds раундов отдаёт причину', async () => {
  let n = 0; const r = await updateMenuButtonPatiently(async () => { n++; throw new Error('fetch failed'); }, 'https://a.trycloudflare.com', { wait: noWait, rounds: 3, retries: 2 });
  assert.equal(r.ok, false); assert.equal(r.rounds, 3); assert.equal(n, 6); assert.match(r.error, /fetch failed/);
});
test('Telegram отверг адрес (не HTTPS): долгим повтором не долбим', async () => {
  let n = 0; const r = await updateMenuButtonPatiently(async () => { n++; return { ok: false, description: 'Bad Request: Only HTTPS links are allowed' }; }, 'http://x', { wait: noWait });
  assert.equal(r.ok, false); assert.equal(r.rounds, 1); assert.equal(n, 1);
});
test('по умолчанию ждёт сеть около 20 минут (40 раундов по 30 с), не меньше и не бесконечно', async () => {
  const waits = []; const r = await updateMenuButtonPatiently(async () => { throw new Error('fetch failed'); }, 'https://a.trycloudflare.com', { wait: async (ms) => waits.push(ms), retries: 1 });
  assert.equal(r.ok, false); assert.equal(r.rounds, 40); assert.equal(waits.filter((w) => w === 30000).length, 39);
});

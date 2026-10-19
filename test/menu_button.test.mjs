import { test } from 'node:test';
import assert from 'node:assert/strict';
import { updateMenuButton } from '../scripts/menu_button.mjs';

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

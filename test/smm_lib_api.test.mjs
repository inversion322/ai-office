// scripts/smm_lib.mjs api(): новое соединение на каждый вызов и повтор чтения при сбросе сокета. Без этого один сброс давал «fetch failed»,
// конвейер считал его временным сбоем и через 2 минуты запускал монтажёра заново (лишняя сессия Opus).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

process.env.OFFICE_NO_TG = '1';
const seen = [];
let mode = 'ok', srv, api;
before(async () => {
  srv = http.createServer((req, res) => {
    seen.push({ method: req.method, url: req.url, connection: req.headers.connection });
    if (mode === 'reset-first' && seen.filter((x) => x.url === req.url).length === 1) { req.socket.destroy(); return; }
    if (mode === 'reset-always' && seen.length <= 5) { req.socket.destroy(); return; }      // после 5 сбросов отвечает: бесконечный повтор в коде упрётся в это и упадёт утверждением, а не зависнет
    if (mode === 'http500') { res.statusCode = 500; res.end('{}'); return; }
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ ok: true, method: req.method }));
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  process.env.OFFICE_API = `http://127.0.0.1:${srv.address().port}`;
  ({ api } = await import('../scripts/smm_lib.mjs'));
});
after(() => { srv && srv.closeAllConnections && srv.closeAllConnections(); srv && srv.close(); });
const reset = (m) => { mode = m; seen.length = 0; };

test('каждый вызов идёт по новому соединению (Connection: close): устаревшего сокета из пула не бывает', async () => {
  reset('ok'); await api('/a'); await api('/b', { x: 1 });
  assert.deepEqual(seen.map((x) => x.connection), ['close', 'close']);
});

test('GET: сброс сокета на первой попытке не роняет вызов, он повторяется', async () => {
  reset('reset-first'); const r = await api('/state');
  assert.equal(r.ok, true); assert.equal(seen.length, 2, 'вторая попытка была');
});

test('GET: если сервер сбрасывает соединение всегда, ошибка приходит после трёх попыток (не бесконечный цикл)', async () => {
  reset('reset-always'); await assert.rejects(() => api('/state'), /fetch failed/);
  assert.equal(seen.length, 3, 'ровно три попытки');
});

test('POST не повторяется при сбросе: запись могла дойти до сервера, дубль хуже ошибки', async () => {
  reset('reset-always'); await assert.rejects(() => api('/api/chat/post', { text: 'x' }), /fetch failed/);
  assert.equal(seen.length, 1);
});

test('ответ HTTP 500 не повторяется и называет код', async () => {
  reset('http500'); await assert.rejects(() => api('/x'), /HTTP 500/); assert.equal(seen.length, 1);
});

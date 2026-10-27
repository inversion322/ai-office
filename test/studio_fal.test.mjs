// Клиент fal.ai: ключ не печатается, ошибки понятные, картинка сохраняется, суточный лимит. Сеть подменена.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fal-'));
const KEY = 'id-TEST:secret-TEST-789';
fs.writeFileSync(path.join(dir, 'keys.json'), JSON.stringify({ falApiKey: KEY }));
process.env.OFFICE_STUDIO_KEYS_FILE = path.join(dir, 'keys.json');
const F = await import('../scripts/studio_fal.mjs');
const resp = (status, body, buf) => ({ ok: status < 400, status, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)), arrayBuffer: async () => buf || new ArrayBuffer(0) });
const png = new Uint8Array(5000).fill(7).buffer;

test('успешная генерация: запрос по документации fal, файл сохранён, ключ в заголовке', async () => {
  const calls = [];
  const f = async (url, o = {}) => { calls.push({ url, o }); return /fal\.run/.test(url) ? resp(200, { images: [{ url: 'https://cdn.example/x.jpg' }] }) : resp(200, '', png); };
  const out = path.join(dir, 'a', 'cover.jpg'); const r = await F.generateCover({ prompt: 'p', outFile: out, fetch: f });
  assert.deepEqual([r.ok, r.bytes, r.model, r.cost], [true, 5000, 'fal-ai/nano-banana-pro', 0.15]); assert.ok(fs.existsSync(out));
  assert.equal(calls[0].url, 'https://fal.run/fal-ai/nano-banana-pro'); assert.equal(calls[0].o.headers.Authorization, 'Key ' + KEY);
  assert.deepEqual(JSON.parse(calls[0].o.body), { prompt: 'p', num_images: 1, aspect_ratio: '1:1', output_format: 'jpeg' });
});
test('ошибки понятны и не содержат ключ: 401, 402, не JSON, нет картинки, сеть', async () => {
  const run = (f) => F.generateCover({ prompt: 'p', outFile: path.join(dir, 'b.jpg'), fetch: f });
  assert.match((await run(async () => resp(401, 'bad'))).error, /ключ не принят/);
  assert.match((await run(async () => resp(402, 'pay'))).error, /нет средств/);
  assert.match((await run(async () => resp(200, 'oops'))).error, /не JSON/);
  assert.match((await run(async () => resp(200, { images: [] }))).error, /не вернул картинку/);
  const net = await run(async () => { throw new Error('ECONNRESET ' + KEY); }); assert.match(net.error, /нет связи/); assert.ok(!net.error.includes(KEY) && !JSON.stringify(net).includes('secret-TEST'));
  assert.match((await run(async (u) => (/fal\.run/.test(u) ? resp(200, { images: [{ url: 'https://x/y.jpg' }] }) : resp(200, '', new ArrayBuffer(10))))).error, /пустая/);
});
test('без ключа сеть не вызывается', async () => {
  const old = process.env.OFFICE_STUDIO_KEYS_FILE; process.env.OFFICE_STUDIO_KEYS_FILE = path.join(dir, 'nope.json');
  try { let n = 0; const r = await F.generateCover({ prompt: 'p', outFile: path.join(dir, 'c.jpg'), fetch: async () => { n++; return resp(200, {}); } }); assert.equal(n, 0); assert.match(r.error, /нет ключа/); }
  finally { process.env.OFFICE_STUDIO_KEYS_FILE = old; }
});
test('суточный лимит картинок считается по дню и сбрасывается на следующий', () => {
  const file = path.join(dir, 'count.json');
  let b = F.imageBudget({ file, day: '2026-10-28', max: 2 }); assert.equal(b.left, 2); b.take(); b = F.imageBudget({ file, day: '2026-10-28', max: 2 }); assert.equal(b.left, 1); b.take();
  assert.equal(F.imageBudget({ file, day: '2026-10-28', max: 2 }).left, 0); assert.equal(F.imageBudget({ file, day: '2026-10-29', max: 2 }).left, 2);
});

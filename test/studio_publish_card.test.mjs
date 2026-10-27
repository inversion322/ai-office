// Карточка публикации ролика из плана дня студии: кнопка «По плану дня: 18:30», загрузка сейчас, выход в слот. Сервер подменён (маленький HTTP).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const can = fs.existsSync(path.join(ROOT, 'server', 'data', 'config.json'));
const PORT = 10400 + (process.pid % 90);
process.env.OFFICE_NO_TG = '1'; process.env.OFFICE_API = `http://127.0.0.1:${PORT}`;
let videos = [], posted = [], srv;
before(async () => {
  if (!can) return;
  srv = http.createServer((req, res) => {
    let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      if (req.url.startsWith('/api/state')) return res.end(JSON.stringify({ videos }));
      if (req.url === '/api/chat/post') { posted.push(JSON.parse(b)); return res.end(JSON.stringify({ id: 1 })); }
      res.statusCode = 404; res.end('{}');
    });
  }).listen(PORT, '127.0.0.1');
});
after(() => { try { srv && srv.close(); } catch {} });
const ID = 93001;
const buttons = () => posted.at(-1).buttons.flat().map((b) => b[1]);

test('ролик из плана дня: в карточке публикации первой стоит кнопка «По плану дня» с временем слота', { skip: !can }, async () => {
  const { publishCard } = await import('../scripts/publisher.mjs');
  const slotAt = Date.now() + 3 * 3600e3;
  videos = [{ id: ID, title: 'Тема из плана', stage: 'approved', notes: JSON.stringify({ source: 'studio', studio: { channel: 'med', date: '2026-12-20', slot: 'video', slot_at: slotAt, slot_time: '18:30' } }) }];
  posted = []; await publishCard(ID);
  const b = posted.at(-1).buttons.flat();
  assert.match(b[0][0], /^🎬 По плану дня: \d{2}:\d{2} МСК$/); assert.equal(b[0][1], `publish:${ID}:at:${Math.round(slotAt / 60e3).toString(36)}`);
  assert.ok(b.some((x) => x[1] === `publish:${ID}:yt`) && b.some((x) => x[1] === `pubat:${ID}`), 'остальные кнопки на месте: сейчас, своё время');
  const code = b[0][1].split(':')[3]; assert.equal(parseInt(code, 36) * 60e3, Math.round(slotAt / 60e3) * 60e3);
});
test('слот уже прошёл или ближе десяти минут — кнопки по плану нет; обычный ролик её не получает', { skip: !can }, async () => {
  const { publishCard } = await import('../scripts/publisher.mjs');
  for (const slotAt of [Date.now() - 3600e3, Date.now() + 5 * 60e3]) {
    videos = [{ id: ID, title: 'Тема', stage: 'approved', notes: JSON.stringify({ studio: { slot_at: slotAt } }) }]; posted = []; await publishCard(ID);
    assert.ok(!buttons().some((d) => d.startsWith(`publish:${ID}:at:`)), 'прошедший слот не предлагается');
  }
  videos = [{ id: ID, title: 'Обычный', stage: 'approved', notes: '{}' }]; posted = []; await publishCard(ID);
  assert.ok(!buttons().some((d) => d.includes(':at:')));
});

// Mini App: вход по подписи Telegram, права сессии, защита от подбора. Настоящий API на КОПИИ данных; токен бота и Telegram не нужны (подпись считаем сами тем же алгоритмом).
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { copyLiveDb } from './fixtures/copy_db.mjs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { signInitData } from '../server/lib_tgauth.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REAL = path.join(ROOT, 'server', 'data');
const can = fs.existsSync(path.join(REAL, 'office.db')) && fs.existsSync(path.join(REAL, 'config.json'));
const PORT = 9500 + (process.pid % 90), API = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let tmp, server, FULL, BOT;
const call = async (p, { method = 'GET', token, body } = {}) => { const r = await fetch(API + p, { method, headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); let j = null; try { j = await r.json(); } catch {} return { status: r.status, j }; };
const initData = ({ id = 323028999, age = 10, token = BOT } = {}) => { const p = { auth_date: String(Math.floor(Date.now() / 1000) - age), query_id: 'AAH', user: JSON.stringify({ id, first_name: 'Ник' }) }; return new URLSearchParams({ ...p, hash: signInitData(p, token) }).toString(); };

before(async () => {
  if (!can) return;
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mini-test-'));
  copyLiveDb(REAL, tmp, 'miniapp');
  const cfg = JSON.parse(fs.readFileSync(path.join(REAL, 'config.json'), 'utf8')); FULL = cfg.token; BOT = cfg.smmBotToken;
  fs.writeFileSync(path.join(tmp, 'config.json'), JSON.stringify(cfg));
  server = spawn(process.execPath, ['server.mjs'], { cwd: path.join(ROOT, 'server'), env: { ...process.env, OFFICE_DATA_DIR: tmp, PORT: String(PORT), OFFICE_NO_TG: '1', OFFICE_CHAT_STUB: '1', OFFICE_NO_WATCH: '1' }, stdio: 'ignore' });
  for (let i = 0; i < 40; i++) { try { if ((await fetch(API + '/health')).ok) break; } catch {} await sleep(300); }
});
after(async () => { try { server && server.kill(); } catch {} await sleep(500); try { tmp && fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); } catch {} });

test('без входа API закрыт; /health открыт', { skip: !can }, async () => {
  assert.equal((await call('/api/state?office=smm')).status, 401); assert.equal((await call('/health')).status, 200);
});
test('вход владельца по настоящей подписи даёт сессию, и по ней видно состояние офиса', { skip: !can }, async () => {
  const r = await call('/api/tg-login', { method: 'POST', body: { initData: initData() } }); assert.equal(r.status, 200); assert.ok(r.j.token && r.j.token !== FULL);
  const s = await call('/api/state?office=smm', { token: r.j.token }); assert.equal(s.status, 200); assert.ok(s.j.agents.length >= 6);
  assert.equal((await call('/api/chat?office=smm', { token: r.j.token })).status, 200);
});
test('чужой Telegram-аккаунт с настоящей подписью получает 403, подделка и просрочка 401', { skip: !can }, async () => {
  assert.equal((await call('/api/tg-login', { method: 'POST', body: { initData: initData({ id: 777 }) } })).status, 403);
  assert.equal((await call('/api/tg-login', { method: 'POST', body: { initData: initData({ token: '1:чужой' }) } })).status, 401);
  assert.equal((await call('/api/tg-login', { method: 'POST', body: { initData: initData({ age: 90000 }) } })).status, 401);
  assert.equal((await call('/api/tg-login', { method: 'POST', body: {} })).status, 401);
});
test('сессия может писать сотруднику, но НЕ может менять промпты, статусы агентов, сцены, видео', { skip: !can }, async () => {
  const tok = (await call('/api/tg-login', { method: 'POST', body: { initData: initData() } })).j.token;
  const send = await call('/api/chat/send', { method: 'POST', token: tok, body: { text: 'Ксения, тест из Mini App', to: 'scriptwriter', office: 'smm' } }); assert.equal(send.status, 200);
  assert.ok((await call('/api/chat?office=smm', { token: tok })).j.messages.some((m) => /тест из Mini App/.test(m.text)), 'сообщение не дошло');
  for (const [method, p, body] of [['POST', '/api/agent', { id: 'video', status: 'idle' }], ['POST', '/api/prompt', { agent_id: 'video', body: 'взлом' }], ['POST', '/api/scene', {}], ['POST', '/api/video', { id: 1, stage: 'x' }], ['POST', '/api/chat/post', { text: 'x', thread: 'video' }], ['POST', '/api/chat/incoming', { text: 'x' }], ['GET', '/api/agent-config?id=video']])
    assert.equal((await call(p, { method, token: tok, body })).status, 403, `${method} ${p} не должен пускать сессию`);
  assert.equal((await call('/api/state?office=smm', { token: FULL })).status, 200, 'постоянный токен продолжает работать');
});
test('выдуманный токен отклоняется, а сессия НЕ переживает перезапуск сервера (хранится только в памяти)', { skip: !can }, async () => {
  assert.equal((await call('/api/state?office=smm', { token: 'vydumannyi-token' })).status, 401);
  const tok = (await call('/api/tg-login', { method: 'POST', body: { initData: initData() } })).j.token;
  assert.equal((await call('/api/state?office=smm', { token: tok })).status, 200);
  server.kill(); await sleep(800);
  server = spawn(process.execPath, ['server.mjs'], { cwd: path.join(ROOT, 'server'), env: { ...process.env, OFFICE_DATA_DIR: tmp, PORT: String(PORT), OFFICE_NO_TG: '1', OFFICE_CHAT_STUB: '1', OFFICE_NO_WATCH: '1' }, stdio: 'ignore' });
  for (let i = 0; i < 40; i++) { try { if ((await fetch(API + '/health')).ok) break; } catch {} await sleep(300); }
  assert.equal((await call('/api/state?office=smm', { token: tok })).status, 401, 'старая сессия ожила после перезапуска');
  assert.equal((await call('/api/tg-login', { method: 'POST', body: { initData: initData() } })).status, 200, 'новый вход работает');
});
test('страховка: тестовый сервер без подмены модели НЕ запускает этап конвейера (иначе тратится лимит Claude и пишется рабочий журнал)', { skip: !can }, async () => {
  const logBefore = fs.existsSync(path.join(ROOT, 'smm', 'pipeline.log')) ? fs.statSync(path.join(ROOT, 'smm', 'pipeline.log')).size : 0;
  const tok = (await call('/api/tg-login', { method: 'POST', body: { initData: initData() } })).j.token;
  const cards = (await call('/api/chat?office=smm', { token: FULL })).j.messages;
  const id = (await call('/api/chat/post', { method: 'POST', token: FULL, body: { office: 'smm', thread: 'packager', sender: 'packager', text: 'тестовая карточка', buttons: [[['Другое название', 'package:1']]], mirror: false } })).j.id;
  const r = await call('/api/chat/answer', { method: 'POST', token: tok, body: { id, choice: 'package:1', via: 'dashboard' } });
  assert.equal(r.status, 200); await sleep(1500);
  const after = (await call('/api/chat?office=smm', { token: FULL })).j.messages.map((m) => m.text).join('\n');
  assert.match(after, /не запущен: в тестовом режиме нет подмены модели/);
  const logAfter = fs.existsSync(path.join(ROOT, 'smm', 'pipeline.log')) ? fs.statSync(path.join(ROOT, 'smm', 'pipeline.log')).size : 0;
  assert.equal(logAfter, logBefore, 'в рабочий журнал pipeline.log что-то записано');
});

test('страховка: перезапуск Кирилла (resume) и правки ролика (rework) в тестовом режиме тоже не запускают настоящую модель', { skip: !can }, async () => {
  const tok = (await call('/api/tg-login', { method: 'POST', body: { initData: initData() } })).j.token;
  const procs = () => new Promise((resolve) => { const p = spawn('powershell.exe', ['-NoProfile', '-Command', "(Get-CimInstance Win32_Process -Filter \"Name='hermes.exe'\" | Where-Object { $_.CommandLine -match ' -p video ' }).Count"], { stdio: ['ignore', 'pipe', 'ignore'] }); let o = ''; p.stdout.on('data', (b) => (o += b)); p.on('exit', () => resolve(Number(o.trim()) || 0)); });
  const before = await procs();
  for (const [choice, text] of [['resume:1', 'Запустить Кирилла заново'], ['rework:1', 'Внести правки']]) {
    const id = (await call('/api/chat/post', { method: 'POST', token: FULL, body: { office: 'smm', thread: 'captain_smm', sender: 'captain_smm', text: 'тест ' + choice, buttons: [[[text, choice]]], mirror: false } })).j.id;
    const r = await call('/api/chat/answer', { method: 'POST', token: tok, body: { id, choice, comment: 'Сделай ролик короче на 5 секунд', via: 'dashboard' } }); assert.equal(r.status, 200, choice);
  }
  await sleep(2500);
  assert.equal(await procs(), before, 'в тестовом режиме запущен настоящий Кирилл (hermes -p video)');
  const said = (await call('/api/chat?office=smm', { token: FULL })).j.messages.map((m) => m.text).join('\n');
  assert.match(said, /Кирилл не запущен: в тестовом режиме/); assert.match(said, /этап «rework 1 --comment .*не запущен/);
  const kv = await call('/api/priority', { token: FULL }); assert.equal(kv.j.active, true, 'эта проверка не должна оставлять приоритет в рабочей БД, но тестовая БД копия');
});

// ВАЖНО: этот тест закрывает вход на минуту, поэтому он обязан идти последним.
test('перебор подписей ограничен: после 20 неудач за минуту вход временно закрыт даже для настоящей подписи', { skip: !can }, async () => {
  for (let i = 0; i < 22; i++) await call('/api/tg-login', { method: 'POST', body: { initData: 'hash=' + '0'.repeat(64) } });
  assert.equal((await call('/api/tg-login', { method: 'POST', body: { initData: initData() } })).status, 429);
});

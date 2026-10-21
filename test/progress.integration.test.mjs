// Прогресс сотрудников через настоящий API офиса на КОПИИ данных: POST /api/agent -> запуск в agent_runs -> GET /api/state отдаёт pb.
// В боевой офис и Telegram тест не пишет.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { copyLiveDb } from './fixtures/copy_db.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REAL = path.join(ROOT, 'server', 'data');
const can = fs.existsSync(path.join(REAL, 'office.db')) && fs.existsSync(path.join(REAL, 'config.json'));
const PORT = 9800 + (process.pid % 90), API = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let tmp, server, TOKEN;
const api = async (p, body) => { const r = await fetch(API + p, { method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return r.json(); };
const agentOf = async (id) => (await api('/api/state?office=smm')).agents.find((a) => a.id === id);

before(async () => {
  if (!can) return;
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'prog-test-')); copyLiveDb(REAL, tmp); TOKEN = JSON.parse(fs.readFileSync(path.join(REAL, 'config.json'), 'utf8')).token;
  server = spawn(process.execPath, ['server.mjs'], { cwd: path.join(ROOT, 'server'), env: { ...process.env, OFFICE_DATA_DIR: tmp, PORT: String(PORT), OFFICE_NO_TG: '1', OFFICE_CHAT_STUB: '1', OFFICE_NO_WATCH: '1' }, stdio: 'ignore', windowsHide: true });
  for (let i = 0; i < 40; i++) { try { if ((await fetch(API + '/health')).ok) break; } catch {} await sleep(300); }
});
after(async () => { try { server && server.kill(); } catch {} await sleep(600); try { tmp && fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); } catch {} });

test('свободный сотрудник без шкалы; запущенный монтаж получает шкалу с первой оценкой по начальной истории', { skip: !can }, async () => {
  await api('/api/agent', { id: 'video', status: 'idle', task: 'Свободен', progress: 0 });
  assert.equal((await agentOf('video')).pb, undefined);
  await api('/api/agent', { id: 'video', status: 'working', task: 'Озвучка, субтитры, монтаж (Opus 5.5)', progress: 3, real: true });
  const a = await agentOf('video');
  assert.ok(a.pb, 'нет pb'); assert.equal(a.pb.kind, 'produce'); assert.equal(a.pb.basis, 'history');
  assert.ok(a.pb.remaining_sec > 0 && a.pb.remaining_sec <= 55 * 60, 'остаток из начальной истории (33–55 мин)');
  assert.match(a.pb.label, /ещё ~\d+ мин$/);
});

test('настоящая веха сотрудника поднимает процент, заглушка этапа без real — нет', { skip: !can }, async () => {
  await api('/api/agent', { id: 'video', status: 'working', progress: 70, real: true });
  const real = await agentOf('video'); assert.equal(real.pb.pct, 70);
  assert.ok(real.pb.remaining_sec > 0 && real.pb.remaining_sec < 47 * 60 * 0.4, 'при 70 % остаток мал: ' + real.pb.remaining_sec);
  await api('/api/agent', { id: 'video', status: 'working', progress: 82 });          // конвейер без real: цифра этапа не считается прогрессом
  const stub = await agentOf('video'); assert.ok(stub.pb.pct < 10, 'заглушка не должна давать ' + stub.pb.pct + ' %');
});

test('завершение работы закрывает запуск; следующий старт начинается заново', { skip: !can }, async () => {
  await api('/api/agent', { id: 'scriptwriter', status: 'working', task: 'Пишу сценарий', progress: 10 });
  const first = await agentOf('scriptwriter'); assert.equal(first.pb.kind, 'run'); assert.ok(first.pb.elapsed_sec < 5);
  await api('/api/agent', { id: 'scriptwriter', status: 'idle', task: 'Свободна', progress: 100 });
  const done = await agentOf('scriptwriter'); assert.equal(done.status, 'idle'); assert.equal(done.pb, undefined);
  await api('/api/agent', { id: 'scriptwriter', status: 'working', task: 'Пишу сценарий 2', progress: 10 });
  assert.ok((await agentOf('scriptwriter')).pb.elapsed_sec < 5, 'новый запуск, а не продолжение прошлого');
});

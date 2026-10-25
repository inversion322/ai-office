// Регрессия: /api/state отдаёт панели 100 последних роликов, а скриптам конвейера (?videos=all) нужны все.
// Пока роликов было меньше сотни, разницы не видели; на сотом самые старые темы перестали считаться «уже использованными»
// (ежедневный подбор мог повторить тему) и ролик по номеру не находился. Тест на копии боевой БД, в неё докладываются ролики.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { copyLiveDb } from './fixtures/copy_db.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REAL = path.join(ROOT, 'server', 'data');
const can = fs.existsSync(path.join(REAL, 'office.db')) && fs.existsSync(path.join(REAL, 'config.json'));
const PORT = 10700 + (process.pid % 80), API = `http://127.0.0.1:${PORT}`;
let tmp, server, token;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const state = async (qs = '') => (await (await fetch(`${API}/api/state?office=smm${qs}`, { headers: { Authorization: 'Bearer ' + token } })).json()).videos;

before(async () => {
  if (!can) return;
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'state-all-')); copyLiveDb(REAL, tmp, 'state_videos_all');
  const db = new DatabaseSync(path.join(tmp, 'office.db'));
  const ins = db.prepare("INSERT INTO videos (office,title,rubric,stage,created_at,updated_at) VALUES ('smm',?,'myth','idea',?,?)");
  ins.run('САМЫЙ СТАРЫЙ ТЕСТОВЫЙ РОЛИК', 1, 1);                                       // обновлялся давно: в «последние 100» не попадёт
  for (let i = 0; i < 130; i++) ins.run('тестовый ролик ' + i, 2e12 + i, 2e12 + i);   // свежее любого настоящего
  db.close();
  token = JSON.parse(fs.readFileSync(path.join(tmp, 'config.json'), 'utf8')).token;
  server = spawn(process.execPath, [path.join(ROOT, 'server', 'server.mjs')], { cwd: path.join(ROOT, 'server'), env: { ...process.env, OFFICE_DATA_DIR: tmp, OFFICE_NO_TG: '1', OFFICE_CHAT_STUB: '1', OFFICE_NO_WATCH: '1', PORT: String(PORT) }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) { try { if ((await fetch(API + '/health')).ok) break; } catch {} await sleep(200); }
});
after(() => { try { server && server.kill(); } catch {} try { tmp && fs.rmSync(tmp, { recursive: true, force: true }); } catch {} });

test('панель по умолчанию получает 100 последних роликов (интерфейс не тяжелеет)', { skip: !can }, async () => {
  const v = await state();
  assert.equal(v.length, 100);
  assert.ok(!v.some((x) => x.title === 'САМЫЙ СТАРЫЙ ТЕСТОВЫЙ РОЛИК'));
});

test('?videos=all отдаёт все ролики, включая давно не обновлявшиеся', { skip: !can }, async () => {
  const v = await state('&videos=all');
  assert.ok(v.length > 130, `роликов ${v.length}`);
  assert.ok(v.some((x) => x.title === 'САМЫЙ СТАРЫЙ ТЕСТОВЫЙ РОЛИК'));
});

test('скрипты конвейера берут полный список: проверка повторов видит старую тему, ролик находится по номеру', { skip: !can }, async () => {
  const lib = fs.readFileSync(path.join(ROOT, 'scripts', 'smm_lib.mjs'), 'utf8');
  assert.match(lib, /export const videos = async \(\) => \(await api\('\/api\/state\?office=smm&videos=all'\)\)\.videos;/);
});

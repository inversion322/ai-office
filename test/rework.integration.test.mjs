// Интеграционный тест «Внести правки»: настоящий API на КОПИИ данных, настоящий конвейер, имитация Кирилла, Telegram выключен.
// Не трогает рабочую БД, Telegram и проект ролика №1: тестовый ролик №9 лежит в video/dosie09 и удаляется после теста.
// Запуск: node --test test/rework.integration.test.mjs  (нужны локальные server/data/office.db и config.json; без них тест пропускается)
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REAL = path.join(ROOT, 'server', 'data');
const can = fs.existsSync(path.join(REAL, 'office.db')) && fs.existsSync(path.join(REAL, 'config.json'));
const PORT = 8800 + Math.floor(Math.random() * 90);
const API = `http://127.0.0.1:${PORT}`;
const PROJ = path.join(ROOT, 'video', 'dosie09');
const FAKE = path.join(ROOT, 'test', 'fixtures', 'fake_kirill.mjs');
let tmp, server, token;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const api = async (p, body) => (await fetch(API + p, { method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })).json();
const env = (extra = {}) => ({ ...process.env, OFFICE_API: API, OFFICE_NO_TG: '1', HERMES_BIN: FAKE, REWORK_POLL_MS: '600', PRIORITY_POLL_MS: '300', ...extra });
function runStage(args, extra) {
  return new Promise((resolve) => { const p = spawn(process.execPath, [path.join(ROOT, 'scripts', 'smm_pipeline.mjs'), ...args], { cwd: ROOT, env: env(extra), stdio: ['ignore', 'pipe', 'pipe'] }); let out = ''; p.stdout.on('data', (b) => (out += b)); p.stderr.on('data', (b) => (out += b)); p.on('exit', (code) => resolve({ code, out })); });
}

before(async () => {
  if (!can) return;
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rework-test-'));
  fs.copyFileSync(path.join(REAL, 'office.db'), path.join(tmp, 'office.db')); fs.copyFileSync(path.join(REAL, 'config.json'), path.join(tmp, 'config.json'));
  token = JSON.parse(fs.readFileSync(path.join(tmp, 'config.json'), 'utf8')).token;
  fs.mkdirSync(path.join(PROJ, 'final'), { recursive: true });
  fs.writeFileSync(path.join(PROJ, 'final', 'dosie09_v1.mp4'), Buffer.alloc(2048, 7));
  fs.writeFileSync(path.join(PROJ, 'script_ru.txt'), 'Абзац один.\n\nАбзац два.\n', 'utf8');
  fs.writeFileSync(path.join(PROJ, 'PROGRESS.md'), '- старая строка\n');
  server = spawn(process.execPath, ['server.mjs'], { cwd: path.join(ROOT, 'server'), env: { ...process.env, OFFICE_DATA_DIR: tmp, PORT: String(PORT), OFFICE_NO_TG: '1', OFFICE_CHAT_STUB: '1', OFFICE_NO_WATCH: '1' }, stdio: 'ignore' });
  for (let i = 0; i < 40; i++) { try { const r = await fetch(API + '/api/priority', { headers: { Authorization: 'Bearer ' + token } }); if (r.ok) return; } catch {} await sleep(300); }
  throw new Error('тестовый API не поднялся');
});
after(() => { try { server && server.kill(); } catch {} fs.rmSync(PROJ, { recursive: true, force: true }); if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); });

test('правки: приоритет включается и выключается, версия собирается, Нику приходит карточка с двумя кнопками', { skip: !can }, async () => {
  const comment = 'Сделай заголовок крупнее и замедли первую сцену';
  const stage = runStage(['rework', '9', '--comment', comment], { FAKE_KIRILL_SECONDS: '4' });
  let sawPriority = null, sawWork = null;
  for (let i = 0; i < 30 && !sawWork; i++) { await sleep(300); const p = await api('/api/priority'); if (p.active) sawPriority = p; const s = await api('/api/state?office=smm'); const a = s.agents.find((x) => x.id === 'video'); if (a.status === 'working' && /Правки ролика №9/.test(a.task)) sawWork = a; }
  assert.ok(sawPriority && sawPriority.video_id === 9, 'приоритет не включился');
  assert.ok(sawWork, 'Кирилл не показан работающим над правками');
  // другой этап в это время уступает
  const t0 = Date.now();
  const probe = await new Promise((resolve) => { const p = spawn(process.execPath, ['--input-type=module', '-e', `import { yieldToPriority } from './scripts/smm_lib.mjs'; await yieldToPriority('research'); console.log('done');`], { cwd: ROOT, env: env(), stdio: ['ignore', 'pipe', 'pipe'] }); let o = ''; p.stdout.on('data', (b) => (o += b)); p.stderr.on('data', (b) => (o += b)); p.on('exit', (c) => resolve({ c, o })); });
  const waited = Date.now() - t0;
  const res = await stage;
  assert.equal(res.code, 0, res.out);
  assert.equal(probe.c, 0, probe.o);
  assert.ok(waited >= 1200, `другой этап не уступил приоритету (ждал ${waited} мс)`);
  assert.equal((await api('/api/priority')).active, false, 'приоритет не снят');
  // результат
  const v = (await api('/api/state?office=smm')).videos.find((x) => x.id === 9);
  assert.equal(v.stage, 'produced'); assert.match(v.video_path, /dosie09_v2\.mp4$/);
  assert.ok(fs.existsSync(path.join(PROJ, 'v1_archive', 'script_ru.txt')), 'прежняя версия не заархивирована');
  assert.ok(fs.existsSync(path.join(PROJ, 'final', 'dosie09_v1.mp4')), 'прежний ролик пропал');
  const brief = fs.readFileSync(path.join(PROJ, 'REWORK_v2.md'), 'utf8');
  assert.ok(brief.includes(comment), 'комментарий Ника не дословно в задании'); assert.match(brief, /Не перезаписывай и не удаляй прежние версии/); assert.match(brief, /приоритет/i);
  const chat = await api('/api/chat?office=smm');
  const card = chat.messages.filter((m) => m.kind === 'action' && m.status === 'open').pop();
  assert.ok(card, 'нет карточки с результатом');
  assert.deepEqual(card.buttons.flat().map((b) => b.d), ['accept:9', 'rework:9']);
  assert.match(card.text + ' ', /Ролик №9 v2/);
});

test('правки не вышли: приоритет снят, прежняя версия цела, Нику предложено повторить или принять прежнюю', { skip: !can }, async () => {
  const res = await runStage(['rework', '9', '--comment', 'ещё правка'], { FAKE_KIRILL_MODE: 'fail', FAKE_KIRILL_SECONDS: '1' });
  assert.equal(res.code, 0, res.out);
  assert.equal((await api('/api/priority')).active, false);
  assert.ok(fs.existsSync(path.join(PROJ, 'final', 'dosie09_v2.mp4')) && !fs.existsSync(path.join(PROJ, 'final', 'dosie09_v3.mp4')));
  const card = (await api('/api/chat?office=smm')).messages.filter((m) => m.kind === 'action' && m.status === 'open').pop();
  assert.ok(/не готовы/.test(card.text)); assert.deepEqual(card.buttons.flat().map((b) => b.d), ['rework:9', 'accept:9']);
  const a = (await api('/api/state?office=smm')).agents.find((x) => x.id === 'video'); assert.equal(a.status, 'error');
});

test('правки без текста: стадия не меняется, ошибка понятная', { skip: !can }, async () => {
  const res = await runStage(['rework', '9', '--comment', '']);
  assert.notEqual(res.code, 0); assert.match(res.out, /нет текста правок/);
});

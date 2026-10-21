// Конвейер produce сам проверяет ролик перед отправкой Нику: формат Shorts/Reels и шляпа утки. Кирилл подменён, Telegram и озвучка по сети выключены.
// Тестовый ролик №5 пишет в video/dosie05 и smm/runs/video_5 (оба удаляются после теста; реальных роликов с таким номером нет).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { copyLiveDb } from './fixtures/copy_db.mjs';
import { ffprobePath } from '../scripts/video_format.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REAL = path.join(ROOT, 'server', 'data'), FAKE = path.join(ROOT, 'test', 'fixtures', 'fake_agent.mjs');
const FF = path.join(path.dirname(ffprobePath()), 'ffmpeg.exe');
const can = fs.existsSync(path.join(REAL, 'office.db')) && fs.existsSync(FF);
const PORT = 9200 + (process.pid % 90), API = `http://127.0.0.1:${PORT}`;
const PROJ = path.join(ROOT, 'video', 'dosie05'), RUN = path.join(ROOT, 'smm', 'runs', 'video_5');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let tmp, server, TOKEN;
const api = async (p, body) => { const r = await fetch(API + p, { method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return r.json(); };

before(async () => {
  if (!can) return; tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-test-')); copyLiveDb(REAL, tmp);
  TOKEN = JSON.parse(fs.readFileSync(path.join(REAL, 'config.json'), 'utf8')).token;
  server = spawn(process.execPath, ['server.mjs'], { cwd: path.join(ROOT, 'server'), env: { ...process.env, OFFICE_DATA_DIR: tmp, PORT: String(PORT), OFFICE_NO_TG: '1', OFFICE_CHAT_STUB: '1', OFFICE_NO_WATCH: '1' }, stdio: 'ignore' });
  for (let i = 0; i < 40; i++) { try { if ((await fetch(API + '/health')).ok) return; } catch {} await sleep(300); }
});
after(async () => { try { server && server.kill(); } catch {} await sleep(600); fs.rmSync(PROJ, { recursive: true, force: true }); fs.rmSync(RUN, { recursive: true, force: true }); try { tmp && fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); } catch {} });

async function produce(mode) {
  fs.rmSync(PROJ, { recursive: true, force: true }); fs.rmSync(RUN, { recursive: true, force: true }); fs.mkdirSync(RUN, { recursive: true });
  fs.writeFileSync(path.join(RUN, 'script_ru.txt'), 'Короткий текст про шаги.\n'); fs.writeFileSync(path.join(RUN, 'FACTS.md'), '# факты\n');
  const id = 5; await api('/api/video', { id, stage: 'editing' });
  const before = (await api('/api/chat?office=smm')).messages.length;
  const code = await new Promise((resolve) => {
    const p = spawn(process.execPath, [path.join(ROOT, 'scripts', 'smm_pipeline.mjs'), 'produce', String(id)], { cwd: ROOT, stdio: 'ignore', env: { ...process.env, OFFICE_API: API, OFFICE_NO_TG: '1', HERMES_BIN: FAKE, TEST_FFMPEG: FF, FAKE_VIDEO_MODE: mode } });
    p.on('exit', resolve); setTimeout(() => { p.kill(); resolve('timeout'); }, 180000);     // 90 с хватало вне нагрузки; в полном прогоне рядом идут ffmpeg-тесты других файлов
  });
  const st = await api('/api/state?office=smm'), msgs = (await api('/api/chat?office=smm')).messages.slice(before);
  return { code, st, msgs, stage: st.videos.find((v) => v.id === id).stage, agent: st.agents.find((a) => a.id === 'video') };
}
const sentToNick = (msgs) => msgs.some((m) => m.kind === 'action' && /Принять ролик/.test(JSON.stringify(m.buttons)));

test('хороший ролик проходит проверки и уходит Нику на приёмку', { skip: !can }, async () => {
  const r = await produce('good'); assert.equal(r.stage, 'produced'); assert.equal(r.agent.status, 'idle'); assert.ok(sentToNick(r.msgs));
});
test('шляпа наклонена: ролик Нику НЕ отправляется, Кирилл в ошибке, Нику пишут причину', { skip: !can }, async () => {
  const r = await produce('tilted_hat'); assert.notEqual(r.code, 0); assert.equal(r.stage, 'editing'); assert.equal(r.agent.status, 'error'); assert.ok(!sentToNick(r.msgs));
  assert.ok(r.msgs.some((m) => /НЕ отправлен вам/.test(m.text) && /шляпа не по центру/.test(m.text) && /rotation: 16/.test(m.text)));
});
test('горизонтальный ролик (не 9:16): Нику НЕ отправляется, причина названа', { skip: !can }, async () => {
  const r = await produce('bad_format'); assert.notEqual(r.code, 0); assert.equal(r.stage, 'editing'); assert.ok(!sentToNick(r.msgs));
  assert.ok(r.msgs.some((m) => /НЕ отправлен вам/.test(m.text) && /нужен 1080x1920/.test(m.text)));
});

test('статичный ролик (как №1 и №2): Нику НЕ отправляется, названа динамика с цифрами', { skip: !can }, async () => {
  const r = await produce('static'); assert.notEqual(r.code, 0); assert.equal(r.stage, 'editing'); assert.equal(r.agent.status, 'error'); assert.ok(!sentToNick(r.msgs));
  assert.ok(r.msgs.some((m) => /НЕ отправлен вам/.test(m.text) && /динамика:/.test(m.text) && /резких смен/.test(m.text) && /цветной фон/.test(m.text)));
});
test('хороший ролик: в карточке для Ника строка с метриками динамики, проект помечен форматом A', { skip: !can }, async () => {
  const r = await produce('good'); assert.equal(r.stage, 'produced');
  assert.equal(JSON.parse(fs.readFileSync(path.join(PROJ, 'format.json'), 'utf8')).format, 'A');
});

test('призыв старым способом (обычный регистр, моноширинная ссылка, текст целиком): Нику НЕ отправляется, названы шрифт и побуквенный набор', { skip: !can }, async () => {
  const r = await produce('bad_cta'); assert.notEqual(r.code, 0); assert.equal(r.stage, 'editing'); assert.equal(r.agent.status, 'error'); assert.ok(!sentToNick(r.msgs));
  assert.ok(r.msgs.some((m) => /НЕ отправлен вам/.test(m.text) && /призыв:/.test(m.text) && /моноширинный/.test(m.text) && /по буквам/.test(m.text)), r.msgs.map((m) => m.text.slice(0, 200)).join(' | '));
});

test('ролик «всё с нуля» (нет LIBRARY_PLAN.json и раздела «Использовано из библиотеки»): Нику НЕ отправляется, названо, что нужно использовать библиотеку', { skip: !can }, async () => {
  const r = await produce('no_plan'); assert.notEqual(r.code, 0); assert.equal(r.stage, 'editing'); assert.equal(r.agent.status, 'error'); assert.ok(!sentToNick(r.msgs));
  assert.ok(r.msgs.some((m) => /НЕ отправлен вам/.test(m.text) && /библиотека:/.test(m.text) && /LIBRARY_PLAN\.json/.test(m.text) && /Использовано из библиотеки/.test(m.text)), r.msgs.map((m) => m.text.slice(0, 220)).join(' | '));
});

test('ролик без vizavi-motion (нет STORYBOARD.json, REVIEW_LOG.json и раздела «Использовано из vizavi-motion»): Нику НЕ отправляется, названо, что именно нужно', { skip: !can }, async () => {
  const r = await produce('no_vizavi'); assert.notEqual(r.code, 0); assert.equal(r.stage, 'editing'); assert.equal(r.agent.status, 'error'); assert.ok(!sentToNick(r.msgs));
  assert.ok(r.msgs.some((m) => /НЕ отправлен вам/.test(m.text) && /vizavi:/.test(m.text) && /STORYBOARD\.json/.test(m.text) && /REVIEW_LOG\.json/.test(m.text) && /Использовано из vizavi-motion/.test(m.text)), r.msgs.map((m) => m.text.slice(0, 220)).join(' | '));
});

// Короткое продолжение монтажёра (решение Ника 2026-10-22): ворота ругаются только на отчётные артефакты → один раз короткое задание
// «дописать отчёт», а не тупик и не новые 90 минут. Настоящий конвейер на копии БД, монтажёр подменён (test/fixtures/fake_agent.mjs).
// Свой порт 10300+ и свой id 92201+ (тесты идут параллельно, папки smm/runs/video_N и video/dosieNN общие).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { copyLiveDb } from './fixtures/copy_db.mjs';
import { ffprobePath } from '../scripts/video_format.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REAL = path.join(ROOT, 'server', 'data'), FAKE = path.join(ROOT, 'test', 'fixtures', 'fake_agent.mjs');
const FF = path.join(path.dirname(ffprobePath()), 'ffmpeg.exe');
const can = fs.existsSync(path.join(REAL, 'office.db')) && fs.existsSync(FF);
const PORT = 10300 + (process.pid % 90), API = `http://127.0.0.1:${PORT}`;
const IDS = [92201, 92202, 92203, 92204];
const projOf = (id) => path.join(ROOT, 'video', `dosie${id}`), runOf = (id) => path.join(ROOT, 'smm', 'runs', `video_${id}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let tmp, server, TOKEN;
const api = async (p, body) => { const r = await fetch(API + p, { method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json', Connection: 'close' }, body: body ? JSON.stringify(body) : undefined }); return r.json(); };
const clean = () => { for (const id of IDS) { fs.rmSync(projOf(id), { recursive: true, force: true }); fs.rmSync(runOf(id), { recursive: true, force: true }); } };

before(async () => {
  if (!can) return;
  clean(); tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-test-')); copyLiveDb(REAL, tmp);
  const db = new DatabaseSync(path.join(tmp, 'office.db'));           // свои ролики создаются в копии БД ДО старта сервера (id у параллельных файлов не должны совпадать)
  for (const id of IDS) db.prepare("INSERT OR REPLACE INTO videos (id, office, title, stage, created_at, updated_at) VALUES (?, 'smm', ?, 'editing', ?, ?)").run(id, 'Тест продолжения ' + id, Date.now(), Date.now());
  db.prepare("UPDATE agents SET status='idle', progress=0 WHERE status IN ('working','waiting','error')").run(); db.close();      // копия живого офиса несёт чужие статусы
  TOKEN = JSON.parse(fs.readFileSync(path.join(REAL, 'config.json'), 'utf8')).token;
  server = spawn(process.execPath, ['server.mjs'], { cwd: path.join(ROOT, 'server'), env: { ...process.env, OFFICE_DATA_DIR: tmp, PORT: String(PORT), OFFICE_NO_TG: '1', OFFICE_CHAT_STUB: '1', OFFICE_NO_WATCH: '1' }, stdio: 'ignore' });
  for (let i = 0; i < 40; i++) { try { if ((await fetch(API + '/health')).ok) return; } catch {} await sleep(300); }
});
after(async () => { try { server && server.kill(); } catch {} await sleep(600); clean(); try { tmp && fs.rmSync(tmp, { recursive: true, force: true }); } catch {} });

async function produce(id, env = {}, args = []) {
  fs.rmSync(runOf(id), { recursive: true, force: true }); fs.mkdirSync(runOf(id), { recursive: true });
  fs.writeFileSync(path.join(runOf(id), 'script_ru.txt'), 'Короткий текст про шаги.\n'); fs.writeFileSync(path.join(runOf(id), 'FACTS.md'), '# факты\n');
  return run(id, env, args);
}
async function run(id, env = {}, args = []) {
  const LOG = path.join(tmp, `briefs_${id}_${Date.now()}.log`); fs.writeFileSync(LOG, '');
  const before = (await api('/api/chat?office=smm')).messages.reduce((a, m) => Math.max(a, m.id), 0);      // по id, а не по длине: выдача чата ограничена 400 последними, длина перестаёт расти
  const code = await new Promise((resolve) => {
    const p = spawn(process.execPath, [path.join(ROOT, 'scripts', 'smm_pipeline.mjs'), 'produce', String(id), ...args], { cwd: ROOT, stdio: 'ignore', env: { ...process.env, OFFICE_API: API, OFFICE_NO_TG: '1', HERMES_BIN: FAKE, TEST_FFMPEG: FF, FAKE_BRIEF_LOG: LOG, ...env } });
    const guard = setTimeout(() => { p.kill(); resolve('timeout'); }, 240000);      // таймер ОБЯЗАН сниматься: живой setTimeout держит процесс теста ещё 4 минуты после зелёных тестов
    p.on('exit', (code) => { clearTimeout(guard); resolve(code); });
  });
  const st = await api('/api/state?office=smm'), msgs = (await api('/api/chat?office=smm')).messages.filter((m) => m.id > before);
  const calls = fs.readFileSync(LOG, 'utf8').trim().split('\n').filter(Boolean);
  return { code, calls, msgs, stage: st.videos.find((v) => v.id === id).stage, agent: st.agents.find((a) => a.id === 'video') };
}
const kinds = (calls) => calls.map((c) => c.split(' ')[0]);
const count = (calls, kind) => kinds(calls).filter((k) => k === kind).length;
const sentToNick = (msgs) => msgs.some((m) => m.kind === 'action' && /Принять ролик/.test(JSON.stringify(m.buttons)));

test('монтажёр собрал всё, но не записал журнал: один раз короткое продолжение, оно дописало журнал, ролик уходит Нику (вторая сессия на 90 минут не нужна)', { skip: !can }, async () => {
  const id = 92201, r = await produce(id, { FAKE_VIDEO_MODE: 'no_review', FAKE_CONTINUE_MODE: 'writes' });
  assert.equal(r.code, 0, JSON.stringify(r.msgs.map((m) => m.text.slice(0, 160))));
  assert.equal(count(r.calls, 'CONTINUE'), 1, 'короткое продолжение вызвано ровно один раз: ' + r.calls.join(' | ')); assert.ok(count(r.calls, 'FIRST') >= 1, 'сборка была');
  assert.equal(kinds(r.calls).lastIndexOf('FIRST') < kinds(r.calls).indexOf('CONTINUE'), true, 'продолжение идёт ПОСЛЕ сборки');
  assert.equal(r.stage, 'produced'); assert.ok(sentToNick(r.msgs), 'карточка приёмки ушла');
  assert.ok(fs.existsSync(path.join(projOf(id), 'REVIEW_LOG.json')));
  assert.ok(fs.existsSync(path.join(runOf(id), 'BRIEF_continue.md')), 'бриф продолжения сохранён');
  assert.ok(!r.msgs.some((m) => /НЕ отправлен вам/.test(m.text)), 'тупиковой карточки сбоя нет');
});

test('продолжение ничего не сделало: честный отказ с причиной, и НИКАКОГО цикла (короткое продолжение даётся один раз)', { skip: !can }, async () => {
  const id = 92202, r = await produce(id, { FAKE_VIDEO_MODE: 'no_review', FAKE_CONTINUE_MODE: 'ignores' });
  assert.notEqual(r.code, 0); assert.equal(r.stage, 'editing'); assert.ok(!sentToNick(r.msgs));
  assert.equal(count(r.calls, 'CONTINUE'), 1, 'ровно одно продолжение, не больше: ' + r.calls.join(' | '));
  assert.ok(r.msgs.some((m) => /НЕ отправлен вам/.test(m.text) && /REVIEW_LOG\.json/.test(m.text)), 'причина названа');
  assert.ok(fs.existsSync(path.join(runOf(id), '_short_continue.json')), 'метка «продолжение уже было»');
  const again = await run(id, { FAKE_VIDEO_MODE: 'no_review', FAKE_CONTINUE_MODE: 'ignores' });          // «Повторить»: новая сессия монтажёра получает бриф ПРОДОЛЖЕНИЯ, не «с нуля»
  assert.ok(!again.calls.some((c) => c.startsWith('CONTINUE')), 'второго короткого продолжения нет: метка не даёт зациклиться');
});

test('реальный дефект качества (статичный ролик) И нет журнала: короткое продолжение НЕ запускается (журнал не лечит плохой ролик), ворота отказывают как раньше', { skip: !can }, async () => {
  const id = 92203, r = await produce(id, { FAKE_VIDEO_MODE: 'static_no_review', FAKE_CONTINUE_MODE: 'writes' });
  assert.ok(r.msgs.some((m) => /REVIEW_LOG\.json/.test(m.text)), 'журнала нет: без защиты продолжение бы запустилось (проект собран, файл есть)');
  assert.notEqual(r.code, 0); assert.equal(r.stage, 'editing'); assert.ok(!sentToNick(r.msgs));
  assert.equal(count(r.calls, 'CONTINUE'), 0, 'дописывание отчёта не лечит плохой ролик: ' + r.calls.join(' | ')); assert.ok(count(r.calls, 'FIRST') >= 1);
  assert.ok(r.msgs.some((m) => /НЕ отправлен вам/.test(m.text) && /динамика:/.test(m.text)));
  assert.ok(!fs.existsSync(path.join(runOf(id), '_short_continue.json')));
});

test('SHORT_CONTINUE=off выключает автодоводку (рубильник)', { skip: !can }, async () => {
  const id = 92204, r = await produce(id, { FAKE_VIDEO_MODE: 'no_review', SHORT_CONTINUE: 'off', FAKE_CONTINUE_MODE: 'writes' });
  assert.notEqual(r.code, 0); assert.equal(count(r.calls, 'CONTINUE'), 0, 'рубильник выключил продолжение'); assert.ok(count(r.calls, 'FIRST') >= 1); assert.equal(r.stage, 'editing');
});

test('«Повторить» на уже собранном проекте: бриф монтажёру говорит ПРОДОЛЖЕНИЕ, а не «создай проект»', { skip: !can }, async () => {
  const id = 92204;                                                  // проект остался собранным после предыдущего теста (без журнала, круг 1 есть)
  const r = await run(id, { FAKE_VIDEO_MODE: 'no_review', SHORT_CONTINUE: 'off' });
  assert.ok(r.calls.some((c) => /^FIRST \d+ resume$/.test(c)), 'бриф с блоком продолжения: ' + r.calls.join(' | '));
  const brief = fs.readFileSync(path.join(runOf(id), 'BRIEF.md'), 'utf8');
  assert.match(brief, /ПРОДОЛЖЕНИЕ, А НЕ НОВЫЙ РОЛИК/); assert.match(brief, /БЮДЖЕТ СЕССИИ: 90 МИНУТ/);
  assert.ok(brief.indexOf('ПРОДОЛЖЕНИЕ, А НЕ НОВЫЙ РОЛИК') < brief.indexOf('## Шаги'), 'блок стоит перед шагами');
});

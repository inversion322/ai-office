// Интеграционный тест ежедневной подборки: настоящий API на КОПИИ данных, настоящий daily_topics.mjs, имитация Виктора и Льва, Telegram выключен.
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
const FAKE = path.join(ROOT, 'test', 'fixtures', 'fake_agent.mjs');
let tmp, server, token, feedFile;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const api = async (p, body) => (await fetch(API + p, { method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })).json();
const run = (extra = {}) => new Promise((resolve) => { const p = spawn(process.execPath, [path.join(ROOT, 'scripts', 'daily_topics.mjs'), '--channel', 'med_detective'], { cwd: ROOT, env: { ...process.env, OFFICE_API: API, OFFICE_NO_TG: '1', HERMES_BIN: FAKE, CHANNEL_FEED_FILE: feedFile, ...extra }, stdio: ['ignore', 'pipe', 'pipe'] }); let out = ''; p.stdout.on('data', (b) => (out += b)); p.stderr.on('data', (b) => (out += b)); p.on('exit', (code) => resolve({ code, out })); });
const RUNS = path.join(ROOT, 'smm', 'runs'), isDaily = (d) => /_daily_med_detective$/.test(d);
let keep = new Set();      // настоящие подборки (их создаёт cron) тест не трогает: по ним считаются повторы
const chat = async () => (await api('/api/chat?office=smm')).messages;
// «новые сообщения» считаем по id, а не по длине: выдача /api/chat ограничена 400 последними, и на копии живой БД длина перестаёт расти (тест мигал красным по мере накопления сообщений в офисе)
const chatMaxId = async () => (await chat()).reduce((a, m) => Math.max(a, m.id), 0);
const chatSince = async (id) => (await chat()).filter((m) => m.id > id);
const vids = async () => (await api('/api/state?office=smm')).videos;
const newer = async (maxId) => (await vids()).filter((v) => v.id > maxId);     // API отдаёт список не по порядку добавления: новые = id больше прежнего максимума
const maxId = async () => Math.max(0, ...(await vids()).map((v) => v.id));

before(async () => {
  if (!can) return;
  keep = new Set(fs.readdirSync(RUNS).filter(isDaily));      // без try: если защита не сработала, тест должен упасть, а не удалить настоящие подборки
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'daily-test-')); copyLiveDb(REAL, tmp);
  feedFile = path.join(tmp, 'feed.json');      // «лента канала»: тема, которой нет в БД офиса, но она уже опубликована
  fs.writeFileSync(feedFile, JSON.stringify({ posts: [{ id: 1, title: 'Утренний кофе натощак вреден для желудка?' }] }));
  token = JSON.parse(fs.readFileSync(path.join(tmp, 'config.json'), 'utf8')).token;
  server = spawn(process.execPath, [path.join(ROOT, 'server', 'server.mjs')], { cwd: path.join(ROOT, 'server'), env: { ...process.env, OFFICE_DATA_DIR: tmp, OFFICE_NO_TG: '1', OFFICE_CHAT_STUB: '1', OFFICE_NO_WATCH: '1', PORT: String(PORT) }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) { try { if ((await fetch(API + '/health')).ok) break; } catch {} await sleep(200); }
});
after(() => { try { server && server.kill(); } catch {} try { for (const d of fs.readdirSync(RUNS)) if (isDaily(d) && !keep.has(d)) fs.rmSync(path.join(RUNS, d), { recursive: true, force: true }); } catch {} });

test('подборка: повторы (офис, лента канала, прежние подборки) отсеяны, темы без первоисточника не берутся, приходит одна карточка с кнопками «Тема N» и «Другие темы»', { skip: !can }, async () => {
  await api('/api/video', { title: 'Нужно ходить ровно десять тысяч шагов в день?', stage: 'approved', score: 80, notes: '{}' });
  const before0 = await maxId(), cardsBefore = await chatMaxId();
  const r = await run({ FAKE_DAILY_MODE: 'ok' }); assert.equal(r.code, 0, r.out);
  const added = await newer(before0);
  assert.ok(added.length >= 3 && added.length <= 6, 'добавлено новых тем: ' + added.length);
  const titles = added.map((v) => v.title); assert.ok(added.every((v) => v.stage === 'scored'), 'новые темы оценены и ждут выбора Ника');
  assert.ok(!titles.some((t) => /десять тысяч шагов|10 000 шагов|Антибиотики помогают|Сахар делает детей/.test(t)), 'повторы офиса отсеяны: ' + titles.join(' | '));
  assert.ok(!titles.some((t) => /кофе натощак/i.test(t)), 'тема, уже опубликованная в канале (лента), отсеяна');
  assert.ok(!titles.includes('Тема без источника'), 'тема без первоисточника не берётся');
  assert.equal(new Set(titles).size, titles.length);
  const msgs = (await chatSince(cardsBefore)).filter((m) => /Темы на сегодня/.test(m.text)); assert.equal(msgs.length, 1, 'ровно одна карточка');
  const ds = msgs[0].buttons.flat().map((b) => b.d); assert.ok(ds.some((d) => /^pick:\d+$/.test(d)) && ds.includes('more:0'), ds.join());
  assert.match(msgs[0].text, /повторов нет/); assert.match(msgs[0].text, /Без вашей кнопки ничего не запускается/);
  assert.ok(!(await chatSince(cardsBefore)).some((m) => /Ксения пишет|Тема выбрана/i.test(m.text)), 'сценарий сам не запускался');
});

test('если в подборке вышли одни повторы: второй круг просит другие темы, итог без повторов', { skip: !can }, async () => {
  const before0 = await maxId();
  const r = await run({ FAKE_DAILY_MODE: 'dups_then_new' }); assert.equal(r.code, 0, r.out);
  const added = await newer(before0); assert.ok(added.length >= 3, 'добавлены новые после второго круга: ' + added.length);
  assert.ok(!added.some((v) => /десять тысяч шагов|Антибиотики помогают|Сахар делает детей/.test(v.title)));
});

test('если новых тем нет совсем: честное сообщение «новых тем не нашлось», никаких карточек выбора и ложных тем', { skip: !can }, async () => {
  const before0 = await maxId(), c0 = await chatMaxId();
  const r = await run({ FAKE_DAILY_MODE: 'all_dups' }); assert.equal(r.code, 0, r.out);
  assert.equal((await newer(before0)).length, 0, 'новые темы не добавлены');
  const m = (await chatSince(c0)).filter((x) => /новых тем без повторов не нашлось/.test(x.text)); assert.equal(m.length, 1); assert.ok(!(m[0].buttons || []).length);
});

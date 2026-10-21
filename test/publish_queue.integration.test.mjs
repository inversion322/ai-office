// Очередь выхода вариантов одной темы (интервал 30 минут): первый вариант выходит сразу и задаёт старт, второй уходит с отложенным выходом на +30 минут.
// Настоящий сервер на копии БД, Google имитирован. Тестовые ролики и папки удаляются.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { copyLiveDb } from './fixtures/copy_db.mjs';
import { startFakeGoogle } from './fixtures/fake_google.mjs';
import { makeClip } from './fixtures/make_clip.mjs';
import { ffprobePath } from '../scripts/video_format.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REAL = path.join(ROOT, 'server', 'data'), FAKE = path.join(ROOT, 'test', 'fixtures', 'fake_agent.mjs'), FF = path.join(path.dirname(ffprobePath()), 'ffmpeg.exe');
const can = fs.existsSync(path.join(REAL, 'office.db')) && fs.existsSync(path.join(REAL, 'config.json')) && fs.existsSync(FF);
const PORT = 10100 + (process.pid % 90), API = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const IDS = { A: 92001, B: 92002, SOLO: 92003 };       // свои id: тестовые папки smm/runs/video_N общие для всех тестов, id сервера (max+1) совпали бы с соседними тестами
let tmp, server, TOKEN, g; const dirs = [];
const api = async (p, body) => {          // повтор один раз: при нагрузке (ffmpeg в соседних тестах) сервер закрывает «простаивающее» соединение, и fetch получает ECONNRESET
  for (let k = 0; ; k++) { try { const r = await fetch(API + p, { method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json', Connection: 'close' }, body: body ? JSON.stringify(body) : undefined }); return await r.json(); } catch (e) { if (k >= 2) throw e; await sleep(300); } }
};
const msgs = async () => (await api('/api/chat?office=smm')).messages;
async function waitFor(re, from = 0, ms = 60000) { for (let t = 0; t < ms; t += 400) { const m = (await msgs()).find((x) => x.id > from && re.test(x.text)); if (m) return m; await sleep(400); } throw new Error('сообщение не пришло: ' + re); }
const lastId = async () => Math.max(0, ...(await msgs()).map((m) => m.id));
const connect = () => { fs.writeFileSync(path.join(tmp, 'youtube_client.json'), JSON.stringify({ installed: { client_id: 'cid', client_secret: 'sec' } })); fs.writeFileSync(path.join(tmp, 'youtube_token.json'), JSON.stringify({ refresh_token: '1//r' })); };
async function clip(title, letter, group, rotation, pubTitle) {
  const id = IDS[letter], mp4 = makeClip(FF, path.join(tmp, `q_${id}.mp4`), 'dynamic'); const g0 = group || id;
  await api('/api/video', { id, title, stage: 'approved', rubric: 'myth', video_path: mp4, notes: JSON.stringify({ variant: { group: g0, letter, format: letter, rotation } }) });
  const run = path.join(ROOT, 'smm', 'runs', `video_${id}`), pack = path.join(ROOT, 'smm', 'runs', `package_${id}`); dirs.push(run, pack); fs.mkdirSync(run, { recursive: true }); fs.mkdirSync(pack, { recursive: true });
  fs.writeFileSync(path.join(run, 'script.json'), JSON.stringify({ sources_card: ['Killer. 2014.'] })); fs.writeFileSync(path.join(pack, 'publish_meta.json'), JSON.stringify({ title: pubTitle, tags: ['#МедицинскийДетектив'], video_title: title }));
  return { id, run };
}
const press = async (id, mode) => { const cid = (await api('/api/chat/post', { office: 'smm', thread: 'captain_smm', sender: 'captain_smm', text: 'Публикация', buttons: [[['YT', `publish:${id}:${mode}`]]], mirror: false })).id; return { cid, res: await api('/api/chat/answer', { id: cid, choice: `publish:${id}:${mode}`, via: 'dashboard' }) }; };
const pipe = (args) => new Promise((resolve) => { const p = spawn(process.execPath, [path.join(ROOT, 'scripts', 'smm_pipeline.mjs'), ...args], { cwd: ROOT, stdio: 'ignore', env: { ...process.env, OFFICE_API: API, OFFICE_NO_TG: '1', HERMES_BIN: FAKE } }); p.on('exit', resolve); setTimeout(() => { p.kill(); resolve('timeout'); }, 60000); });

before(async () => {
  if (!can) return; tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pq-test-')); copyLiveDb(REAL, tmp); TOKEN = JSON.parse(fs.readFileSync(path.join(REAL, 'config.json'), 'utf8')).token;
  const db = new DatabaseSync(path.join(tmp, 'office.db')); for (const id of Object.values(IDS)) db.prepare("INSERT INTO videos (id,office,title,rubric,stage,created_at,updated_at) VALUES (?,'smm','seed','myth','approved',?,?)").run(id, Date.now(), Date.now()); db.close();
  g = await startFakeGoogle('ok');
  server = spawn(process.execPath, ['server.mjs'], { cwd: path.join(ROOT, 'server'), env: { ...process.env, OFFICE_DATA_DIR: tmp, PORT: String(PORT), OFFICE_NO_TG: '1', OFFICE_CHAT_STUB: '1', OFFICE_NO_WATCH: '1', HERMES_BIN: FAKE, YT_OAUTH_URL: g.token, YT_UPLOAD_URL: g.upload, YT_RETRY_MS: '5' }, stdio: 'ignore', windowsHide: true });
  for (let i = 0; i < 40; i++) { try { if ((await fetch(API + '/health')).ok) break; } catch {} await sleep(300); }
  connect();
});
after(async () => { try { server && server.kill(); } catch {} try { g && await g.close(); } catch {} await sleep(600); for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); try { tmp && fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); } catch {} });

test('второй вариант до выхода первого: слота ещё нет, на карточке только обычные кнопки и текст про очередь B → A', { skip: !can }, async () => {
  const A = await clip('Кофе', 'A', null, 1, 'Что скрывает чашка кофе?'), B = await clip('Кофе', 'B', A.id, 1, 'Пятьдесят мужчин и одна чашка');
  Object.assign(globalThis, { __A: A, __B: B });
  const from = await lastId(); assert.equal(await pipe(['publish-card', String(A.id)]), 0);
  const card = await waitFor(/Публикация ролика №/, from); const ds = JSON.stringify(card.buttons);
  assert.ok(ds.includes(`publish:${A.id}:yt`) && !ds.includes(':yts'), 'слота нет: кнопки «Запланировать» быть не должно'); assert.match(card.text, /Очередь выхода варианта этой темы: B \(.*\) → A/); assert.match(card.text, /интервал 30 минут/); assert.match(card.text, /Время слотов задаст выход первого/);
});

test('первый в очереди (B при ротации 1) выходит сразу и задаёт старт; потом у A появляется кнопка «Запланировать на HH:MM»', { skip: !can }, async () => {
  const { __A: A, __B: B } = globalThis; const n0 = g.st.inits.length, f = await lastId();
  const { res } = await press(B.id, 'yts'); assert.ok(res.ok !== false); const ok = await waitFor(/опубликован в YouTube Shorts/, f); assert.match(ok.text, /слот ещё не определён: публикую сразу/);
  assert.equal(g.st.inits.length, n0 + 1); const init = g.st.inits[g.st.inits.length - 1]; assert.equal(init.meta.status.privacyStatus, 'public'); assert.equal(init.meta.status.publishAt, undefined);
  const plan = JSON.parse(fs.readFileSync(path.join(ROOT, 'smm', 'runs', `video_${A.id}`, 'publish_plan.json'), 'utf8')); assert.ok(Math.abs(plan.start - Date.now()) < 120000, 'старт очереди = момент выхода первого'); assert.equal(plan.first, 'B');
  const f2 = await lastId(); assert.equal(await pipe(['publish-card', String(A.id)]), 0);
  const card = await waitFor(/Публикация ролика №/, f2); const btn = JSON.parse(JSON.stringify(card.buttons)).flat();
  const sched = btn.find((b) => b.d === `publish:${A.id}:yts`); assert.ok(sched, 'есть кнопка слота: ' + JSON.stringify(btn.map((b) => b.d))); assert.match(sched.t, /^🕐 Запланировать на \d\d:\d\d \(МСК\)$/); assert.match(btn.find((b) => b.d === `publish:${A.id}:yt`).t, /Опубликовать сейчас/);
  assert.match(card.text, /B \d\d:\d\d \(вышел\) → A \d\d:\d\d \(принят\)/, card.text.slice(-300));
});

test('«Запланировать» у A: загрузка сейчас, выход YouTube ровно через 30 минут после первого; повтор отклоняется, карточка больше не предлагает публикацию', { skip: !can }, async () => {
  const { __A: A } = globalThis; const plan = JSON.parse(fs.readFileSync(path.join(ROOT, 'smm', 'runs', `video_${A.id}`, 'publish_plan.json'), 'utf8')); const n0 = g.st.inits.length, f = await lastId();
  await press(A.id, 'yts'); const ok = await waitFor(/запланирован на \d\d:\d\d \(МСК\)/, f); assert.match(ok.text, /YouTube сам выложит/);
  assert.equal(g.st.inits.length, n0 + 1); const init = g.st.inits[g.st.inits.length - 1]; assert.equal(init.meta.status.privacyStatus, 'private'); assert.ok(init.meta.status.publishAt, 'у загрузки есть publishAt');
  assert.ok(Math.abs(new Date(init.meta.status.publishAt).getTime() - (plan.start + 30 * 60e3)) < 2000, `слот = старт + 30 минут: ${init.meta.status.publishAt}`);
  const st = JSON.parse(fs.readFileSync(path.join(ROOT, 'smm', 'runs', `video_${A.id}`, 'publish.json'), 'utf8')); assert.equal(st.youtube.length, 1); assert.ok(st.youtube[0].scheduledFor);
  const f2 = await lastId(); await press(A.id, 'yts'); const no = await waitFor(/НЕ загружен в YouTube/, f2); assert.match(no.text, /уже загружено с отложенным выходом/); assert.equal(g.st.inits.length, n0 + 1, 'второй загрузки не было');
  const f3 = await lastId(); assert.equal(await pipe(['publish-card', String(A.id)]), 0); await sleep(1000); assert.equal((await msgs()).filter((m) => m.id > f3 && /Публикация ролика №/.test(m.text)).length, 0, 'публиковать больше нечего');
});

test('одиночный ролик (не вариант) работает как раньше: «yts» превращается в обычную публикацию, очереди в карточке нет', { skip: !can }, async () => {
  const id = IDS.SOLO, mp4 = makeClip(FF, path.join(tmp, `q_solo.mp4`), 'dynamic'); await api('/api/video', { id, title: 'Соло', stage: 'approved', rubric: 'myth', video_path: mp4 });
  const run = path.join(ROOT, 'smm', 'runs', `video_${id}`), pack = path.join(ROOT, 'smm', 'runs', `package_${id}`); dirs.push(run, pack); fs.mkdirSync(run, { recursive: true }); fs.mkdirSync(pack, { recursive: true });
  fs.writeFileSync(path.join(run, 'script.json'), '{}'); fs.writeFileSync(path.join(pack, 'publish_meta.json'), JSON.stringify({ title: 'Соло название', tags: ['#МедицинскийДетектив'], video_title: 'Соло' }));
  const f = await lastId(); assert.equal(await pipe(['publish-card', String(id)]), 0); const card = await waitFor(/Публикация ролика №/, f); assert.doesNotMatch(card.text, /Очередь выхода/); assert.doesNotMatch(JSON.stringify(card.buttons), /:yts/);
  const f2 = await lastId(); await press(id, 'yts'); const ok = await waitFor(/опубликован в YouTube Shorts/, f2); assert.match(ok.text, /слот ещё не определён/);
});

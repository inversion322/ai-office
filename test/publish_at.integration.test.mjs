// Отложенная публикация на время Ника («завтра 18:00»): кнопка → ожидание времени → разбор → подтверждение → загрузка с publishAt. минут.
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
const PORT = 10200 + (process.pid % 90), API = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const IDS = { A: 92101, B: 92102, SOLO: 92103, S2: 92104, S3: 92105 };       // свои id: тестовые папки smm/runs/video_N общие для всех тестов, id сервера (max+1) совпали бы с соседними тестами
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
  if (!can) return; for (const id of Object.values(IDS)) for (const k of ['video', 'package']) fs.rmSync(path.join(ROOT, 'smm', 'runs', `${k}_${id}`), { recursive: true, force: true });       // остатки прерванного прогона не должны ломать следующий (publish.json «уже загружено»)
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-test-')); copyLiveDb(REAL, tmp); TOKEN = JSON.parse(fs.readFileSync(path.join(REAL, 'config.json'), 'utf8')).token;
  const db = new DatabaseSync(path.join(tmp, 'office.db')); for (const id of Object.values(IDS)) db.prepare("INSERT INTO videos (id,office,title,rubric,stage,created_at,updated_at) VALUES (?,'smm','seed','myth','approved',?,?)").run(id, Date.now(), Date.now()); db.close();
  g = await startFakeGoogle('ok');
  server = spawn(process.execPath, ['server.mjs'], { cwd: path.join(ROOT, 'server'), env: { ...process.env, OFFICE_DATA_DIR: tmp, PORT: String(PORT), OFFICE_NO_TG: '1', OFFICE_CHAT_STUB: '1', OFFICE_NO_WATCH: '1', HERMES_BIN: FAKE, YT_OAUTH_URL: g.token, YT_UPLOAD_URL: g.upload, YT_RETRY_MS: '5' }, stdio: 'ignore', windowsHide: true });
  for (let i = 0; i < 40; i++) { try { if ((await fetch(API + '/health')).ok) break; } catch {} await sleep(300); }
  connect();
});
after(async () => { try { server && server.kill(); } catch {} try { g && await g.close(); } catch {} await sleep(600); for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); try { tmp && fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); } catch {} });


import { parseWhen, mskToMs, mskParts, fmtMsk } from '../scripts/publish_when.mjs';
const solo = async (title, key = 'SOLO') => {
  const id = IDS[key]; for (const k of ['video', 'package']) fs.rmSync(path.join(ROOT, 'smm', 'runs', `${k}_${id}`), { recursive: true, force: true });
  const mp4 = makeClip(FF, path.join(tmp, `pa_${key}.mp4`), 'dynamic'); await api('/api/video', { id, title, stage: 'approved', rubric: 'myth', video_path: mp4 });
  const run = path.join(ROOT, 'smm', 'runs', `video_${id}`), pack = path.join(ROOT, 'smm', 'runs', `package_${id}`); dirs.push(run, pack); fs.mkdirSync(run, { recursive: true }); fs.mkdirSync(pack, { recursive: true });
  fs.writeFileSync(path.join(run, 'script.json'), '{}'); fs.writeFileSync(path.join(pack, 'publish_meta.json'), JSON.stringify({ title: 'Отложенное название', tags: ['#МедицинскийДетектив'], video_title: title }));
  return id;
};
const tell = (text) => api('/api/chat/incoming', { text, source: 'telegram' });
const click = (cid, d) => api('/api/chat/answer', { id: cid, choice: d, via: 'dashboard' });
const btns = (m) => JSON.parse(JSON.stringify(m.buttons || [])).flat();

test('на карточке публикации есть кнопка «Запланировать на своё время»', { skip: !can }, async () => {
  const id = await solo('Отложка'); const f = await lastId(); assert.equal(await pipe(['publish-card', String(id)]), 0);
  const card = await waitFor(/Публикация ролика №/, f); const b = btns(card).find((x) => x.d === `pubat:${id}`); assert.ok(b, 'нет кнопки: ' + JSON.stringify(btns(card).map((x) => x.d))); assert.match(b.t, /Запланировать на своё время/);
  assert.ok(btns(card).find((x) => x.d === `publish:${id}:yt`), 'обычная публикация осталась');
  globalThis.__id = id;
});

test('кнопка без текста спрашивает время; «завтра 18:00» даёт карточку подтверждения с точным временем; ничего не загружено до «Да»', { skip: !can }, async () => {
  const id = globalThis.__id, n0 = g.st.inits.length, f = await lastId();
  const cid = (await api('/api/chat/post', { office: 'smm', thread: 'captain_smm', sender: 'captain_smm', text: 'Публикация', buttons: [[['At', `pubat:${id}`]]], mirror: false })).id;
  await click(cid, `pubat:${id}`);
  const ask = await waitFor(/Когда выложить/, f); assert.match(ask.text, /завтра 18:00/); assert.match(ask.text, /по Москве/);
  const f2 = await lastId(); await tell('завтра 18:00');
  const conf = await waitFor(/Выложить «.*» \d\d\.\d\d\.\d{4} 18:00 \(МСК\)\?/, f2); const yes = btns(conf).find((x) => /^publish:\d+:at:[0-9a-z]+$/.test(x.d)); assert.ok(yes, 'есть кнопка подтверждения: ' + JSON.stringify(btns(conf).map((x) => x.d)));
  const want = parseWhen('завтра 18:00', Date.now()).atMs; assert.equal(parseInt(yes.d.split(':')[3], 36) * 60e3, Math.round(want / 60e3) * 60e3, 'время зашито в кнопку');
  assert.ok(btns(conf).find((x) => x.d === `pubat:${id}`), 'есть «Другое время»'); assert.equal(g.st.inits.length, n0, 'до подтверждения в YouTube ничего не ушло');
  globalThis.__yes = yes.d; globalThis.__want = Math.round(want / 60e3) * 60e3;
});

test('«Да»: загрузка сразу как приватный с publishAt ровно на выбранное время, запись scheduledFor, повтор отклоняется', { skip: !can }, async () => {
  const id = globalThis.__id, n0 = g.st.inits.length, f = await lastId();
  const cid = (await api('/api/chat/post', { office: 'smm', thread: 'captain_smm', sender: 'captain_smm', text: 'Подтверждение', buttons: [[['Да', globalThis.__yes]]], mirror: false })).id; await click(cid, globalThis.__yes);
  const ok = await waitFor(/запланирован на \d\d\.\d\d\.\d{4} 18:00 \(МСК\)/, f, 90000); assert.match(ok.text, /YouTube сам выложит/); assert.doesNotMatch(ok.text, /NaN/, 'время в сообщении не должно быть мусором');
  const said = (await msgs()).filter((m) => m.id > f && m.sender === 'captain_smm' && /Принято\. Пётр/.test(m.text)).pop(); assert.ok(said && /\d\d\.\d\d\.\d{4} 18:00 \(МСК\)/.test(said.text) && !/NaN/.test(said.text), 'подтверждение «Принято» с точной датой: ' + (said && said.text.slice(0, 200)));
  assert.equal(g.st.inits.length, n0 + 1); const init = g.st.inits[g.st.inits.length - 1]; assert.equal(init.meta.status.privacyStatus, 'private'); assert.equal(new Date(init.meta.status.publishAt).getTime(), globalThis.__want, 'publishAt = выбранное время'); assert.match(init.meta.status.publishAt, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/, 'publishAt в формате ISO для YouTube');
  const st = JSON.parse(fs.readFileSync(path.join(ROOT, 'smm', 'runs', `video_${id}`, 'publish.json'), 'utf8')); assert.equal(st.youtube.length, 1); assert.equal(new Date(st.youtube[0].scheduledFor).getTime(), globalThis.__want); assert.equal(st.youtube[0].byNick, true);
  const f2 = await lastId(); const cid2 = (await api('/api/chat/post', { office: 'smm', thread: 'captain_smm', sender: 'captain_smm', text: 'Повтор', buttons: [[['Да', globalThis.__yes]]], mirror: false })).id; await click(cid2, globalThis.__yes);
  await waitFor(/НЕ загружен в YouTube/, f2, 60000); assert.equal(g.st.inits.length, n0 + 1, 'второй загрузки не было');
  const f3 = await lastId(); assert.equal(await pipe(['publish-card', String(id)]), 0); await sleep(1000); assert.equal((await msgs()).filter((m) => m.id > f3 && /Публикация ролика №/.test(m.text)).length, 0, 'публиковать больше нечего');
});

test('плохое время не запускает загрузку: прошлое и «не время» возвращают вопрос, «отмена» снимает ожидание', { skip: !can }, async () => {
  const id = await solo('Отложка 2', 'S2'); const n0 = g.st.inits.length;
  const ask = async () => { const f = await lastId(); const cid = (await api('/api/chat/post', { office: 'smm', thread: 'captain_smm', sender: 'captain_smm', text: 'Публикация', buttons: [[['At', `pubat:${id}`]]], mirror: false })).id; await click(cid, `pubat:${id}`); await waitFor(/Когда выложить/, f); };
  await ask(); let f = await lastId(); await tell('привет, как дела'); const bad1 = await waitFor(/Не нашла время суток/, f); assert.match(bad1.text, /ещё раз или «отмена»/);
  f = await lastId(); await tell('вчера 12:00'); const yd = await waitFor(/прошедший день/, f); assert.match(yd.text, /ещё раз или «отмена»/);
  f = await lastId(); await tell('отмена'); const c = await waitFor(/время выхода не задаю/, f); assert.ok(c);
  f = await lastId(); await tell('завтра 18:00'); await sleep(1500); assert.equal((await msgs()).filter((m) => m.id > f && /Выложить «/.test(m.text)).length, 0, 'после «отмены» ожидания нет, обычный текст не превращается в публикацию');
  assert.equal(g.st.inits.length, n0, 'ни одной загрузки');
});

test('устаревшая кнопка: время в ней уже прошло, загрузки нет, объяснение и новая карточка публикации', { skip: !can }, async () => {
  const id = await solo('Отложка 3', 'S3'); const n0 = g.st.inits.length, f = await lastId(); const past = Math.round((Date.now() - 3600e3) / 60e3).toString(36), d = `publish:${id}:at:${past}`;
  const cid = (await api('/api/chat/post', { office: 'smm', thread: 'captain_smm', sender: 'captain_smm', text: 'Старая', buttons: [[['Да', d]]], mirror: false })).id; await click(cid, d);
  const no = await waitFor(/НЕ загружен в YouTube/, f, 60000); assert.match(no.text, /уже прошло или слишком близко/); assert.equal(g.st.inits.length, n0, 'в YouTube ничего не ушло'); await waitFor(/Публикация ролика №/, f, 30000);
});

test('для варианта: время, назначенное Ником первому ролику, задаёт старт очереди, остальные идут через 30 минут', { skip: !can }, async () => {
  const A = await clip('Кофе', 'A', null, 0, 'Название A'), B = await clip('Кофе', 'B', A.id, 0, 'Название B');
  const tm = new Date(Date.now() + 3 * 86400e3 + 3 * 3600e3), at = mskToMs(...(({ y, m, d }) => [y, m, d])(mskParts(tm.getTime())), 18, 0), code = Math.round(at / 60e3).toString(36), n0 = g.st.inits.length, f = await lastId(), dd = fmtMsk(at).slice(0, 10);       // через ~3 дня в 18:00 МСК: в пределах года, в будущем
  const cid = (await api('/api/chat/post', { office: 'smm', thread: 'captain_smm', sender: 'captain_smm', text: 'Да', buttons: [[['Да', `publish:${A.id}:at:${code}`]]], mirror: false })).id; await click(cid, `publish:${A.id}:at:${code}`);
  await waitFor(new RegExp('запланирован на ' + dd.replace(/\./g, '\\.') + ' 18:00'), f, 90000); const plan = JSON.parse(fs.readFileSync(path.join(ROOT, 'smm', 'runs', `video_${A.id}`, 'publish_plan.json'), 'utf8')); assert.equal(plan.start, at, 'старт очереди = время Ника'); assert.equal(plan.first, 'A');
  const f2 = await lastId(); assert.equal(await pipe(['publish-card', String(B.id)]), 0); const card = await waitFor(/Публикация ролика №/, f2); const sched = btns(card).find((x) => x.d === `publish:${B.id}:yts`); assert.ok(sched, 'у B появилась кнопка слота'); assert.match(sched.t, /18:30/, 'слот B = 18:30 (старт + 30 минут)');
});

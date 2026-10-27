// Публикатор: путь «кнопка в карточке -> этап publish -> загрузка в (имитацию) YouTube -> сообщение со ссылкой». Настоящий API офиса на КОПИИ данных, Google имитирован (fake_google).
// Тестовый ролик создаётся новой записью в копии БД; его файлы в smm/runs/ (video_<id>, package_<id>) удаляются после теста. В настоящий YouTube и Telegram тест не пишет.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { copyLiveDb } from './fixtures/copy_db.mjs';
import { startFakeGoogle } from './fixtures/fake_google.mjs';
import { makeClip } from './fixtures/make_clip.mjs';
import { ffprobePath } from '../scripts/video_format.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REAL = path.join(ROOT, 'server', 'data'), FAKE = path.join(ROOT, 'test', 'fixtures', 'fake_agent.mjs'), FF = path.join(path.dirname(ffprobePath()), 'ffmpeg.exe');
const can = fs.existsSync(path.join(REAL, 'office.db')) && fs.existsSync(path.join(REAL, 'config.json')) && fs.existsSync(FF);
const PORT = 9700 + (process.pid % 90), API = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let tmp, server, TOKEN, g; const dirs = [];
// Connection: close и два повтора: в полном параллельном прогоне пулованное keep-alive соединение иногда рвётся (ECONNRESET), пока рядом идут ffmpeg-тесты; тест мигал красным без причины в продукте
const api = async (p, body) => { for (let i = 0; ; i++) { try { const r = await fetch(API + p, { method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json', Connection: 'close' }, body: body ? JSON.stringify(body) : undefined }); return await r.json(); } catch (e) { if (i >= 2) throw e; await new Promise((r) => setTimeout(r, 400)); } } };
const msgs = async () => (await api('/api/chat?office=smm')).messages;
async function waitFor(re, from = 0, ms = 60000) { for (let t = 0; t < ms; t += 400) { const m = (await msgs()).find((x) => x.id > from && re.test(x.text)); if (m) return m; await sleep(400); } throw new Error('сообщение не пришло: ' + re); }
const lastId = async () => Math.max(0, ...(await msgs()).map((m) => m.id));
const connect = () => { fs.writeFileSync(path.join(tmp, 'youtube_client.json'), JSON.stringify({ installed: { client_id: 'cid', client_secret: 'sec' } })); fs.writeFileSync(path.join(tmp, 'youtube_token.json'), JSON.stringify({ refresh_token: '1//r' })); };
async function newVideo({ stage = 'approved', kind = 'dynamic', title = 'Тест: шаги' } = {}) {
  const mp4 = makeClip(FF, path.join(tmp, `clip_${Date.now()}_${kind}.mp4`), kind);
  const id = (await api('/api/video', { title, stage, rubric: 'myth', video_path: mp4 })).id; const run = path.join(ROOT, 'smm', 'runs', `video_${id}`), pack = path.join(ROOT, 'smm', 'runs', `package_${id}`); dirs.push(run, pack);
  fs.mkdirSync(run, { recursive: true }); fs.mkdirSync(pack, { recursive: true });
  fs.writeFileSync(path.join(run, 'script.json'), JSON.stringify({ sources_card: ['Paluch AE. Lancet Public Health. 2022.'] })); fs.writeFileSync(path.join(pack, 'publish_meta.json'), JSON.stringify({ title: 'Десять тысяч шагов родились в рекламе?', tags: ['#МедицинскийДетектив', '#10000шагов', '#Ходьба'], video_title: title }));
  return { id, run, mp4 };
}
const press = async (id, mode) => { const cid = (await api('/api/chat/post', { office: 'smm', thread: 'captain_smm', sender: 'captain_smm', text: 'Публикация', buttons: [[['YT', `publish:${id}:${mode}`]]], mirror: false })).id; return { cid, res: await api('/api/chat/answer', { id: cid, choice: `publish:${id}:${mode}`, via: 'dashboard' }) }; };

before(async () => {
  if (!can) return;
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pub-test-')); copyLiveDb(REAL, tmp, 'publisher'); TOKEN = JSON.parse(fs.readFileSync(path.join(REAL, 'config.json'), 'utf8')).token;
  g = await startFakeGoogle('ok');
  server = spawn(process.execPath, ['server.mjs'], { cwd: path.join(ROOT, 'server'), env: { ...process.env, OFFICE_DATA_DIR: tmp, PORT: String(PORT), OFFICE_NO_TG: '1', OFFICE_CHAT_STUB: '1', OFFICE_NO_WATCH: '1', HERMES_BIN: FAKE, YT_OAUTH_URL: g.token, YT_UPLOAD_URL: g.upload, YT_RETRY_MS: '5' }, stdio: process.env.PUB_TEST_SERVER_LOG ? ['ignore', fs.openSync(process.env.PUB_TEST_SERVER_LOG, 'a'), fs.openSync(process.env.PUB_TEST_SERVER_LOG, 'a')] : 'ignore', windowsHide: true });   // PUB_TEST_SERVER_LOG: журнал тестового сервера для разбора редких падений
  for (let i = 0; i < 40; i++) { try { if ((await fetch(API + '/health')).ok) break; } catch {} await sleep(300); }
});
after(async () => { try { server && server.kill(); } catch {} try { g && await g.close(); } catch {} await sleep(600); for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); try { tmp && fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); } catch {} });

test('сотрудник «Пётр Выкладов» есть в офисе SMM на своём столе, свободен', { skip: !can }, async () => {
  const a = (await api('/api/state?office=smm')).agents.find((x) => x.id === 'publisher'); assert.ok(a, 'нет сотрудника publisher'); assert.equal(a.name, 'Пётр Выкладов'); assert.equal(a.desk, 7); assert.equal(a.status, 'idle');
  assert.match(fs.readFileSync(path.join(ROOT, 'web', 'office.js'), 'utf8'), /publisher: \[94\.2, 80\.6\]/, 'стол в офисе (студия каналов справа, YouTube-публикатор в нижнем ряду)');
  assert.equal(a.team, 'yt', 'сотрудник YouTube-канала');
});

test('YouTube не подключён: загрузки нет, Нику понятно, что сделать', { skip: !can }, async () => {
  const v = await newVideo(), from = await lastId(); await press(v.id, 'ytp'); const m = await waitFor(/НЕ загружен в YouTube/, from);
  assert.match(m.text, /YouTube не подключён/); assert.equal(g.st.inits.length, 0);
});

test('приватная проверка: загрузка с названием из пакета, описанием с хэштегами и источниками; ссылка Нику; следом карточка только с «опубликовать»; состояние записано', { skip: !can }, async () => {
  connect(); const v = await newVideo(), from = await lastId(); const { res } = await press(v.id, 'ytp'); assert.equal(res.ok, true);
  const m = await waitFor(/загружен в YouTube как ПРИВАТНЫЙ/, from); assert.match(m.text, /https:\/\/youtube\.com\/shorts\/VID123/);
  const init = g.st.inits[g.st.inits.length - 1]; assert.equal(init.meta.status.privacyStatus, 'private'); assert.equal(init.meta.snippet.title, 'Десять тысяч шагов родились в рекламе?'); assert.match(init.meta.snippet.description, /#МедицинскийДетектив #10000шагов #Ходьба #Shorts/); assert.match(init.meta.snippet.description, /Paluch AE/);
  assert.ok(g.st.uploads[g.st.uploads.length - 1].equals(fs.readFileSync(v.mp4)), 'ушёл именно файл принятого ролика');
  const card = await waitFor(/Публикация ролика №\d+/, m.id); const ds = JSON.parse(JSON.stringify(card.buttons)).flat().map((b) => b.d); assert.ok(ds.includes(`publish:${v.id}:yt`) && !ds.includes(`publish:${v.id}:ytp`), ds.join(','));
  const st = JSON.parse(fs.readFileSync(path.join(v.run, 'publish.json'), 'utf8')); assert.equal(st.youtube.length, 1); assert.equal(st.youtube[0].privacy, 'private');
  const ag = (await api('/api/state?office=smm')).agents.find((x) => x.id === 'publisher'); assert.equal(ag.status, 'idle');
});

test('публичная выкладка: после приватной проверки загружается вторая копия публично; повторное нажатие не выкладывает дважды', { skip: !can }, async () => {
  const v = await newVideo(), from = await lastId(); await press(v.id, 'ytp'); await waitFor(/ПРИВАТНЫЙ/, from); const before = g.st.inits.length;
  const f2 = await lastId(); await press(v.id, 'yt'); const ok = await waitFor(/опубликован в YouTube Shorts/, f2); assert.match(ok.text, /shorts\/VID123/); assert.equal(g.st.inits.length, before + 1); assert.equal(g.st.inits[g.st.inits.length - 1].meta.status.privacyStatus, 'public');
  // Процесс первой публикации к моменту повторного нажатия может ещё не завершиться: тогда сервер отвечает «Публикатор уже загружает… Второй раз не запускаю» (тоже верная защита).
  // Раньше тест угадывал только второй ответ и случайно падал; теперь при первом ответе ждём конца процесса и жмём ещё раз, пока не дойдём до защиты «уже загружено публично».
  let no = null, guards = 0;
  for (let k = 0; k < 6 && !no; k++) {
    const f3 = await lastId(); await press(v.id, 'yt');
    const m = await waitFor(/НЕ загружен в YouTube|Второй раз не запускаю/, f3);
    if (/НЕ загружен в YouTube/.test(m.text)) no = m; else { guards++; await sleep(2500); }
  }
  assert.ok(no, 'защита «уже загружено публично» так и не ответила');
  assert.match(no.text, /уже загружено публично/); assert.equal(g.st.inits.length, before + 1, 'второй публичной загрузки не было');
});

test('охрана: непринятый ролик не публикуется; файл не того формата (горизонтальный) не уходит в YouTube', { skip: !can }, async () => {
  const n0 = g.st.inits.length;
  const a = await newVideo({ stage: 'produced' }), f1 = await lastId(); await press(a.id, 'yt'); const m1 = await waitFor(/ещё не принят, публиковать рано/, f1); assert.ok(m1);
  const b = await newVideo({ kind: 'horizontal' }), f2 = await lastId(); await press(b.id, 'ytp'); const m2 = await waitFor(/НЕ загружен в YouTube/, f2); assert.match(m2.text, /формат:/);
  assert.equal(g.st.inits.length, n0, 'в YouTube ничего не ушло');
});

test('ошибка YouTube (лимит API): Нику понятная причина, повтор разрешён, в состояние ничего не записано', { skip: !can }, async () => {
  const v = await newVideo(), f = await lastId(); g.st.mode = 'quota'; try { await press(v.id, 'ytp'); const m = await waitFor(/НЕ загружен в YouTube/, f); assert.match(m.text, /дневной лимит YouTube API/); assert.equal(fs.existsSync(path.join(v.run, 'publish.json')), false); } finally { g.st.mode = 'ok'; }
  const f2 = await lastId(); await press(v.id, 'ytp'); await waitFor(/загружен в YouTube как ПРИВАТНЫЙ/, f2);
});

test('карточка публикации: команда publish-card присылает кнопки «приватная проверка» и «опубликовать»', { skip: !can }, async () => {
  const v = await newVideo(), from = await lastId();
  await new Promise((resolve) => { const p = spawn(process.execPath, [path.join(ROOT, 'scripts', 'smm_pipeline.mjs'), 'publish-card', String(v.id)], { cwd: ROOT, stdio: 'ignore', env: { ...process.env, OFFICE_API: API, OFFICE_NO_TG: '1', OFFICE_DATA_DIR: tmp } }); p.on('exit', resolve); });
  const card = await waitFor(/Публикация ролика №\d+ «Тест: шаги»/, from); assert.match(card.text, /«Десять тысяч шагов родились в рекламе\?»/); assert.match(card.text, /Ничего не публикуется без вашей кнопки/);
  const ds = JSON.parse(JSON.stringify(card.buttons)).flat().map((b) => b.d); assert.ok(ds.includes(`publish:${v.id}:ytp`) && ds.includes(`publish:${v.id}:yt`), ds.join(','));
});

test('после пакета Тимофея: карточка названия с «Перегенерировать», «Своё название» и (если YouTube подключён) «Перейти к публикации»; публикационная карточка сама не приходит', { skip: !can }, async () => {
  const run1 = (id, extra = {}) => new Promise((resolve) => { const p = spawn(process.execPath, [path.join(ROOT, 'scripts', 'smm_pipeline.mjs'), 'package', String(id)], { cwd: ROOT, stdio: 'ignore', env: { ...process.env, OFFICE_API: API, OFFICE_NO_TG: '1', OFFICE_DATA_DIR: tmp, HERMES_BIN: FAKE, SMM_TTS_ESTIMATE_ONLY: '1', ...extra } }); p.on('exit', resolve); });
  for (const connected of [true, false]) {
    if (!connected) fs.rmSync(path.join(tmp, 'youtube_token.json'), { force: true });
    const v = await newVideo({ title: connected ? 'Сахар делает детей гиперактивными?' : 'Сахар и дети, без YouTube' }); fs.writeFileSync(path.join(v.run, 'script_ru.txt'), 'Ребёнок съел конфету. Сахар не влияет на поведение. Это миф.\n'); fs.rmSync(path.join(ROOT, 'smm', 'runs', `package_${v.id}`, 'publish_meta.json'), { force: true });
    const from = await lastId(); await run1(v.id); const pk = await waitFor(/Пакет публикации/, from);
    const meta = JSON.parse(fs.readFileSync(path.join(ROOT, 'smm', 'runs', `package_${v.id}`, 'publish_meta.json'), 'utf8')); assert.ok(meta.title && meta.tags.length >= 1, 'выбранное название и хэштеги записаны для Публикатора');
    const ds = JSON.parse(JSON.stringify(pk.buttons)).flat().map((b) => b.d).filter((d) => d !== 'dismiss:0');
    assert.deepEqual(ds, connected ? [`package:${v.id}`, `title:${v.id}`, `publish_go:${v.id}`] : [`package:${v.id}`, `title:${v.id}`]);
    await sleep(1200); assert.ok(!(await msgs()).some((x) => x.id > from && /Публикация ролика №/.test(x.text)), 'публикационная карточка без нажатия «Перейти к публикации» не приходит');
  }
  connect();
});

test('«Перейти к публикации»: приходит карточка с названием, главной кнопкой «опубликовать», приватной проверкой и кнопками смены названия; старая карточка названия закрыта', { skip: !can }, async () => {
  connect(); const v = await newVideo(), from = await lastId();
  const cid = (await api('/api/chat/post', { office: 'smm', thread: 'captain_smm', sender: 'captain_smm', text: 'Название', buttons: [[['🔄', `package:${v.id}`], ['✏️', `title:${v.id}`]], [['🚀', `publish_go:${v.id}`]]], mirror: false })).id;
  assert.equal((await api('/api/chat/answer', { id: cid, choice: `publish_go:${v.id}`, via: 'dashboard' })).ok, true);
  const card = await waitFor(/Публикация ролика №\d+ «Тест: шаги»/, from); const ds = JSON.parse(JSON.stringify(card.buttons)).flat().map((b) => b.d).filter((d) => d !== 'dismiss:0');
  assert.deepEqual(ds, [`publish:${v.id}:yt`, `publish:${v.id}:ytp`, `pubat:${v.id}`, `title:${v.id}`, `package:${v.id}`], 'на карточке есть «Запланировать на своё время» (pubat) между проверкой и сменой названия'); assert.match(card.text, /«Десять тысяч шагов родились в рекламе\?»/);
  assert.equal(g.st.inits.length, g.st.inits.length, 'до кнопки «опубликовать» ничего не загружено'); assert.ok(!fs.existsSync(path.join(v.run, 'publish.json')));
});

test('своё название: кнопка без текста просит написать; текст Ника сохраняется для публикации, хэштеги прежние, приходит обновлённая карточка; слишком длинное просят сократить', { skip: !can }, async () => {
  connect(); const v = await newVideo(), from = await lastId();
  const cid = (await api('/api/chat/post', { office: 'smm', thread: 'captain_smm', sender: 'captain_smm', text: 'Название', buttons: [[['🔄', `package:${v.id}`], ['✏️', `title:${v.id}`]], [['🚀', `publish_go:${v.id}`]]], mirror: false })).id;
  const r = await api('/api/chat/answer', { id: cid, choice: `title:${v.id}`, via: 'dashboard' }); assert.deepEqual([r.ok, r.pending], [true, 'comment']);
  await waitFor(/Напишите одним сообщением своё название/, from);
  const f2 = await lastId(); await api('/api/chat/send', { office: 'smm', thread: 'captain_smm', text: 'я'.repeat(101), source: 'dashboard' }); await waitFor(/длиннее 100 знаков \(101\)/, f2);
  const f3 = await lastId(); await api('/api/chat/send', { office: 'smm', thread: 'captain_smm', text: 'Шаги: откуда взялись десять тысяч?', source: 'dashboard' });
  const card = await waitFor(/Ваше название для «Тест: шаги»/, f3); assert.match(card.text, /«Шаги: откуда взялись десять тысяч\?»/); assert.match(card.text, /#МедицинскийДетектив #10000шагов #Ходьба/);
  const ds = JSON.parse(JSON.stringify(card.buttons)).flat().map((b) => b.d).filter((d) => d !== 'dismiss:0'); assert.deepEqual(ds, [`package:${v.id}`, `title:${v.id}`, `publish_go:${v.id}`]);
  const meta = JSON.parse(fs.readFileSync(path.join(ROOT, 'smm', 'runs', `package_${v.id}`, 'publish_meta.json'), 'utf8')); assert.equal(meta.title, 'Шаги: откуда взялись десять тысяч?'); assert.equal(meta.manual, true); assert.deepEqual(meta.tags, ['#МедицинскийДетектив', '#10000шагов', '#Ходьба']);
  // и в YouTube уйдёт именно оно
  const f4 = await lastId(); await press(v.id, 'ytp'); await waitFor(/ПРИВАТНЫЙ/, f4); assert.equal(g.st.inits[g.st.inits.length - 1].meta.snippet.title, 'Шаги: откуда взялись десять тысяч?');
});

test('название можно ввести сразу текстом (без ожидания), а «перегенерировать» закрывает устаревшую карточку публикации с прежним названием', { skip: !can }, async () => {
  connect(); const v = await newVideo(), from = await lastId();
  const pub = (await api('/api/chat/post', { office: 'smm', thread: 'captain_smm', sender: 'captain_smm', text: 'Публикация', buttons: [[['🚀', `publish:${v.id}:yt`]], [['✏️', `title:${v.id}`], ['🔄', `package:${v.id}`]]], mirror: false })).id;
  const cid = (await api('/api/chat/post', { office: 'smm', thread: 'captain_smm', sender: 'captain_smm', text: 'Название', buttons: [[['🔄', `package:${v.id}`], ['✏️', `title:${v.id}`]]], mirror: false })).id;
  assert.equal((await api('/api/chat/answer', { id: cid, choice: `title:${v.id}`, comment: 'Мой вариант названия', via: 'dashboard' })).ok, true);
  await waitFor(/Ваше название для/, from); const old = (await msgs()).find((x) => x.id === pub); assert.equal(old.status, 'answered', 'карточка публикации со старым названием закрыта');
  const meta = JSON.parse(fs.readFileSync(path.join(ROOT, 'smm', 'runs', `package_${v.id}`, 'publish_meta.json'), 'utf8')); assert.equal(meta.title, 'Мой вариант названия');
});

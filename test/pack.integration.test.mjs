// Приёмка ролика -> пакет публикации (название + хэштеги) одним сообщением. Настоящий API на КОПИИ данных, настоящий конвейер, имитация Тимофея.
// Telegram выключен (OFFICE_NO_TG): проверяем карточку в чате. Не трогает рабочую БД. Тестовый ролик №8 лежит в smm/runs/video_8 и удаляется после теста.
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
const PORT = 9100 + (process.pid % 90), API = `http://127.0.0.1:${PORT}`;
const RUN = path.join(ROOT, 'smm', 'runs', 'video_8');
const FAKE = path.join(ROOT, 'test', 'fixtures', 'fake_agent.mjs');
let tmp, server, token;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const api = async (p, body) => (await fetch(API + p, { method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })).json();
const env = (x = {}) => ({ ...process.env, OFFICE_API: API, OFFICE_NO_TG: '1', HERMES_BIN: FAKE, ...(tmp ? { OFFICE_DATA_DIR: tmp } : {}), ...x });   // данные теста, а не настоящие ключи YouTube из server/data
const runStage = (args, x) => new Promise((resolve) => { const p = spawn(process.execPath, [path.join(ROOT, 'scripts', 'smm_pipeline.mjs'), ...args], { cwd: ROOT, env: env(x), stdio: ['ignore', 'pipe', 'pipe'] }); let o = ''; p.stdout.on('data', (b) => (o += b)); p.stderr.on('data', (b) => (o += b)); p.on('exit', (code) => resolve({ code, out: o })); });
const lastCard = async () => (await api('/api/chat?office=smm')).messages.filter((m) => m.sender === 'captain_smm' && /Пакет публикации|остановился/.test(m.text)).pop();

before(async () => {
  if (!can) return;
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pack-test-'));
  copyLiveDb(REAL, tmp, 'pack');
  token = JSON.parse(fs.readFileSync(path.join(tmp, 'config.json'), 'utf8')).token;
  fs.mkdirSync(RUN, { recursive: true });
  fs.writeFileSync(path.join(RUN, 'script_ru.txt'), 'Ребёнок съел конфету. Сахар не влияет на поведение. Миф.\n\nПодписывайтесь на телеграм-канал «Медицинский детектив»: там больше полезного.\n', 'utf8');
  server = spawn(process.execPath, ['server.mjs'], { cwd: path.join(ROOT, 'server'), env: { ...process.env, OFFICE_DATA_DIR: tmp, PORT: String(PORT), OFFICE_NO_TG: '1', OFFICE_CHAT_STUB: '1', OFFICE_NO_WATCH: '1', HERMES_BIN: FAKE }, stdio: 'ignore' });
  for (let i = 0; i < 40; i++) { try { if ((await fetch(API + '/api/priority', { headers: { Authorization: 'Bearer ' + token } })).ok) break; } catch {} await sleep(300); }
  await api('/api/video', { id: 8, title: 'Тестовый ролик про сахар', stage: 'produced', rubric: 'myth' });
});
after(async () => { try { server && server.kill(); } catch {} await sleep(500); fs.rmSync(RUN, { recursive: true, force: true }); fs.rmSync(path.join(ROOT, 'smm', 'runs', 'package_8'), { recursive: true, force: true }); try { if (tmp) fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); } catch {} });

test('сотрудник «Тимофей» есть в офисе SMM на своём столе', { skip: !can }, async () => {
  const s = await api('/api/state?office=smm'); const a = s.agents.find((x) => x.id === 'packager');
  assert.ok(a, 'Тимофей не добавлен'); assert.equal(a.name, 'Тимофей Заголовков'); assert.equal(a.desk, 6);
  assert.match((await api('/api/agent-config?id=packager')).prompt.body, /не больше 5 хэштегов/);
});

test('пакет: одно сообщение с названием и хэштегами, накрутки убраны, лимит 5, бренд первым, сотрудник вернулся в «свободен»', { skip: !can }, async () => {
  const res = await runStage(['package', '8']); assert.equal(res.code, 0, res.out);
  const card = await lastCard(); assert.ok(card, 'нет сообщения с пакетом');
  assert.match(card.text, /НАЗВАНИЕ/); assert.match(card.text, /Сахар делает детей гиперактивными\? Ответ в конце/);
  const tagLine = card.text.split('\n').find((l) => l.startsWith('#МедицинскийДетектив')); assert.ok(tagLine, 'нет строки с хэштегами');
  const tags = tagLine.split(' '); assert.equal(tags.length, 5); assert.ok(!/fyp|viral/i.test(tagLine));
  assert.match(card.text, /Убрала:.*fyp/); assert.equal(card.kind, 'action'); assert.deepEqual(card.buttons.flat().map((b) => b.d).filter((d) => d !== 'dismiss:0'), ['package:8', 'title:8', 'en:8']);
  assert.ok(fs.existsSync(path.join(ROOT, 'smm', 'runs', 'package_8', 'publish_pack.txt')));
  assert.equal((await api('/api/state?office=smm')).agents.find((x) => x.id === 'packager').status, 'idle');
});

test('автопроверка бракует кликбейт «шок/врачи скрывают/вылечит», даёт модели один шанс исправиться', { skip: !can }, async () => {
  fs.rmSync(path.join(ROOT, 'smm', 'runs', 'package_8'), { recursive: true, force: true });
  const res = await runStage(['package', '8'], { FAKE_PACK_MODE: 'bad_then_good' }); assert.equal(res.code, 0, res.out);
  assert.match((await lastCard()).text, /Сахар делает детей гиперактивными\? Ответ в конце/);
});

test('если честного названия так и не вышло: сбой не молчит, Нику предложено повторить, сотрудник в «ошибка»', { skip: !can }, async () => {
  fs.rmSync(path.join(ROOT, 'smm', 'runs', 'package_8'), { recursive: true, force: true });
  const res = await runStage(['package', '8'], { FAKE_PACK_MODE: 'bad' }); assert.notEqual(res.code, 0);
  const card = await lastCard(); assert.match(card.text, /названия и хэштегов/); assert.deepEqual(card.buttons.flat().map((b) => b.d).filter((d) => d !== 'dismiss:0'), ['package:8']);   // карточка сбоя: только «повторить»
  assert.equal((await api('/api/state?office=smm')).agents.find((x) => x.id === 'packager').status, 'error');
});

test('приёмка ролика запускает пакет (кнопка «Принять» -> этап package)', { skip: !can }, async () => {
  fs.rmSync(path.join(ROOT, 'smm', 'runs', 'package_8'), { recursive: true, force: true });
  const id = (await api('/api/chat/post', { office: 'smm', thread: 'captain_smm', sender: 'captain_smm', text: 'Ролик готов', buttons: [[['Принять ролик', 'accept:8']]], mirror: false })).id;
  assert.equal((await api('/api/chat/answer', { id, choice: 'accept:8', via: 'dashboard' })).ok, true);
  assert.match((await api('/api/chat?office=smm')).messages.map((m) => m.text).join('\n'), /Тимофей уже придумывает название и хэштеги/);
  for (let i = 0; i < 40 && !fs.existsSync(path.join(ROOT, 'smm', 'runs', 'package_8', 'publish_pack.txt')); i++) await sleep(500);
  assert.ok(fs.existsSync(path.join(ROOT, 'smm', 'runs', 'package_8', 'publish_pack.txt')), 'этап package не запустился после приёмки');
});

test('страховка: тестовый режим с рабочим адресом :8787 отказывается стартовать, а не пишет в рабочий офис', { skip: !can }, async () => {
  const res = await new Promise((resolve) => { const p = spawn(process.execPath, [path.join(ROOT, 'scripts', 'smm_pipeline.mjs'), 'package', '8'], { cwd: ROOT, env: { ...process.env, OFFICE_NO_TG: '1', OFFICE_API: 'http://127.0.0.1:8787', HERMES_BIN: FAKE }, stdio: ['ignore', 'pipe', 'pipe'] }); let o = ''; p.stdout.on('data', (b) => (o += b)); p.stderr.on('data', (b) => (o += b)); p.on('exit', (code) => resolve({ code, out: o })); });
  assert.notEqual(res.code, 0); assert.match(res.out, /не может работать с рабочим API/);
});

const meta = () => JSON.parse(fs.readFileSync(path.join(ROOT, 'smm', 'runs', 'package_8', 'publish_meta.json'), 'utf8'));
test('название чистое по умолчанию: хэштеги рекомендацией отдельно, и даже если модель вернула title_tags, без просьбы Ника в название ничего не дописывается', { skip: !can }, async () => {
  fs.rmSync(path.join(ROOT, 'smm', 'runs', 'package_8'), { recursive: true, force: true });
  const res = await runStage(['package', '8']); assert.equal(res.code, 0, res.out);
  const m = meta(); assert.equal(m.title, 'Сахар делает детей гиперактивными? Ответ в конце'); assert.equal(m.clean_title, m.title); assert.deepEqual(m.title_tags, []); assert.equal(m.tags[0], '#МедицинскийДетектив');
  const card = await lastCard(); const lines = card.text.split('\n'); assert.ok(!lines[lines.indexOf('НАЗВАНИЕ (копируйте):') + 1].includes('#'), 'в названии хэштегов нет');
  assert.match(card.text, /рекомендация, в название они не вставлены/); assert.match(card.text, /название останется чистым/);
});
test('в правках Ник называет хэштеги: они дописываются в конец названия ровно как он назвал, рекомендация остаётся отдельной, публикатор получает название с ними', { skip: !can }, async () => {
  fs.rmSync(path.join(ROOT, 'smm', 'runs', 'package_8'), { recursive: true, force: true });
  const res = await runStage(['package', '8', '--comment', 'в название #кофе #Здоровье']); assert.equal(res.code, 0, res.out);
  const m = meta(); assert.equal(m.clean_title, 'Сахар делает детей гиперактивными? Ответ в конце'); assert.equal(m.title, m.clean_title + ' #кофе #Здоровье'); assert.deepEqual(m.title_tags, ['#кофе', '#Здоровье']);
  assert.ok(m.tags.length >= 1 && m.tags[0] === '#МедицинскийДетектив', 'рекомендация осталась отдельной');
  const card = await lastCard(); assert.match(card.text, /Сахар делает детей гиперактивными\? Ответ в конце #кофе #Здоровье/); assert.match(card.text, /хэштеги в названии, как вы просили: #кофе #Здоровье/);
});
test('Ник просит «добавь хэштег в название» без имён: берётся то, что предложила модель (title_tags), не больше трёх', { skip: !can }, async () => {
  fs.rmSync(path.join(ROOT, 'smm', 'runs', 'package_8'), { recursive: true, force: true });
  const res = await runStage(['package', '8', '--comment', 'добавь один хэштег в название']); assert.equal(res.code, 0, res.out);
  assert.deepEqual(meta().title_tags, ['#сахар']); assert.match(meta().title, / #сахар$/);
});
test('модель вставила хэштеги в название сама: автопроверка бракует, один шанс исправиться, итог чистый', { skip: !can }, async () => {
  fs.rmSync(path.join(ROOT, 'smm', 'runs', 'package_8'), { recursive: true, force: true });
  const res = await runStage(['package', '8'], { FAKE_PACK_MODE: 'hash_then_good' }); assert.equal(res.code, 0, res.out);
  assert.ok(!meta().title.includes('#'));
  const q2 = fs.readFileSync(path.join(ROOT, 'smm', 'runs', 'package_8', '_query_packageb.txt'), 'utf8'); assert.match(q2, /ПРОШЛЫЙ ВАРИАНТ ОТКЛОНЁН/); assert.match(q2, /хэштеги в название не ставим/, 'Тимофею названа причина отказа');
});
test('правка к названию: Тимофей получает текущее название и просьбу Ника, чтобы при «только хэштеги» оставить название прежним', { skip: !can }, async () => {
  fs.rmSync(path.join(ROOT, 'smm', 'runs', 'package_8'), { recursive: true, force: true });
  let res = await runStage(['package', '8']); assert.equal(res.code, 0, res.out);
  res = await runStage(['package', '8', '--comment', 'название оставь, добавь в название #кофе']); assert.equal(res.code, 0, res.out);
  const q = fs.readdirSync(path.join(ROOT, 'smm', 'runs', 'package_8')).filter((x) => /^_query_package/.test(x)).map((x) => fs.readFileSync(path.join(ROOT, 'smm', 'runs', 'package_8', x), 'utf8')).join('\n');
  assert.match(q, /Текущее название: «Сахар делает детей гиперактивными\? Ответ в конце»/); assert.match(q, /оставь это название без изменений/); assert.match(q, /ХЭШТЕГИ В НАЗВАНИЕ НЕ ВСТАВЛЯЙ/); assert.match(q, /КЛИКБЕЙТ/); assert.match(q, /НЕ раскрывай вердикт/);
});

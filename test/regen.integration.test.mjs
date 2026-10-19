// «Перегенерировать»: полный путь нажатие -> конвейер (имитация Ксении и Веры) -> карточка. Настоящий API на КОПИИ данных, Telegram и озвучка по сети выключены.
// Тестовый ролик №7 (пакетные тесты занимают №8, тесты правок №9: файловые тесты идут параллельно) живёт в smm/runs/video_7 и удаляется после теста; рабочая база и журналы не трогаются.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REAL = path.join(ROOT, 'server', 'data');
const can = fs.existsSync(path.join(REAL, 'office.db')) && fs.existsSync(path.join(REAL, 'config.json')) && fs.existsSync('C:/hf_tts/venv/Scripts/python.exe');
const PORT = 8900 + Math.floor(Math.random() * 90), API = `http://127.0.0.1:${PORT}`;
const RUN = path.join(ROOT, 'smm', 'runs', 'video_7'), FAKE = path.join(ROOT, 'test', 'fixtures', 'fake_agent.mjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let tmp, server, TOKEN;
const api = async (p, body) => { const r = await fetch(API + p, { method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return r.json(); };
const OLD = ['Ребёнок съел конфету и носится как угорелый. Виноват сахар? Открываем дело номер один.', 'Улика первая. Шестнадцать работ, двадцать три эксперимента: никто не знал, где сахар, а где замена. Итог в журнале JAMA: на поведение детей сахар не влияет.', 'Улика вторая. Одним мамам сказали: сын съел много сахара. Но всем детям дали пустышку. Те мамы назвали сыновей более гиперактивными.', 'Вероятно, всё дело в ожидании. От сладкого ждут бури, а сладкое подают на празднике, где и так шумно.', 'Приговор: миф. Но сахар вреден для зубов и веса. ВОЗ советует: добавленных сахаров меньше десяти процентов калорий.'];
function startServer(mode) {
  return spawn(process.execPath, ['server.mjs'], { cwd: path.join(ROOT, 'server'), env: { ...process.env, OFFICE_DATA_DIR: tmp, PORT: String(PORT), OFFICE_NO_TG: '1', OFFICE_CHAT_STUB: '1', OFFICE_NO_WATCH: '1', HERMES_BIN: FAKE, SMM_TTS_ESTIMATE_ONLY: '1', FAKE_SCRIPT_MODE: mode }, stdio: 'ignore' });
}
async function boot(mode) {
  if (server) { server.kill(); await sleep(700); }
  server = startServer(mode);
  for (let i = 0; i < 40; i++) { try { if ((await fetch(API + '/health')).ok) return; } catch {} await sleep(300); }
}
const reset = () => { fs.rmSync(RUN, { recursive: true, force: true }); fs.mkdirSync(RUN, { recursive: true }); fs.writeFileSync(path.join(RUN, 'script.json'), JSON.stringify({ title: 'Сахар', segments: OLD, hook_type: 'сцена' })); };
async function regen(mode) {
  await boot(mode); reset();
  await api('/api/video', { id: 7, title: 'Сахар делает детей гиперактивными?', stage: 'checked', rubric: 'myth' });
  const cid = (await api('/api/chat/post', { office: 'smm', thread: 'captain_smm', sender: 'captain_smm', text: 'Сценарий', buttons: [[['Утвердить сценарий', 'approve:7'], ['Нужны правки', 'revise:7']], [['🔄 Перегенерировать', 'regen:7'], ['Отклонить тему', 'reject:7']]], mirror: false })).id;
  const r = await api('/api/chat/answer', { id: cid, choice: 'regen:7', via: 'dashboard' }); assert.equal(r.ok, true);
  for (let i = 0; i < 90; i++) { await sleep(1000); const m = (await api('/api/chat?office=smm')).messages.filter((x) => x.kind === 'action' && x.status === 'open' && /Сценарий: «/.test(x.text)); if (m.length) return { card: m[m.length - 1], all: (await api('/api/chat?office=smm')).messages }; }
  throw new Error('карточка нового сценария не пришла за 90 с');
}
before(() => { if (!can) return; tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'regen-test-')); fs.copyFileSync(path.join(REAL, 'office.db'), path.join(tmp, 'office.db')); fs.copyFileSync(path.join(REAL, 'config.json'), path.join(tmp, 'config.json')); TOKEN = JSON.parse(fs.readFileSync(path.join(REAL, 'config.json'), 'utf8')).token; });
after(async () => { try { server && server.kill(); } catch {} await sleep(600); fs.rmSync(RUN, { recursive: true, force: true }); try { tmp && fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); } catch {} });

test('перегенерация: прежняя версия сохранена в history, написана новая с другим крючком, на карточке есть строка о перегенерации и кнопка «Перегенерировать»', { skip: !can }, async () => {
  const { card } = await regen('ok');
  const hist = fs.readdirSync(path.join(RUN, 'history')); assert.deepEqual(hist, ['script_01.json']);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(RUN, 'history', 'script_01.json'), 'utf8')).segments, OLD, 'прежний текст сохранён без изменений');
  const now = JSON.parse(fs.readFileSync(path.join(RUN, 'script.json'), 'utf8')); assert.equal(now.hook_type, 'цифра'); assert.notDeepEqual(now.segments, OLD);
  assert.match(card.text, /🔄 Перегенерация, написано заново \(прежних версий: 1\)/); assert.match(card.text, /Совпадение с прежними \d+%/); assert.match(card.text, /Крючок: «Сорок процентов родителей/); assert.match(card.text, /тип: цифра/);
  const ds = card.buttons.flat().map((b) => b.d); assert.deepEqual(ds, ['approve:7', 'revise:7', 'regen:7', 'reject:7', 'dismiss:0']);
  assert.equal((await api('/api/state?office=smm')).videos.find((v) => v.id === 7).stage, 'checked');
});

test('задание Ксении при перегенерации: прежний текст дан как «нельзя повторять», правки прежнего текста не предлагаются', { skip: !can }, async () => {
  const q = fs.readFileSync(path.join(RUN, '_query_script1.txt'), 'utf8');
  assert.match(q, /ПЕРЕГЕНЕРАЦИЯ/); assert.match(q, /ПОВТОРЯТЬ НЕЛЬЗЯ/); assert.match(q, /Ребёнок съел конфету и носится как угорелый/, 'прежний текст приведён как список запретного'); assert.ok(!/Предыдущая версия сценария \(правь её\)/.test(q), 'правка прежнего текста не предлагается');
  assert.match(q, /hook_options/); assert.match(q, /«Улика первая»/, 'прежний шаблон зачинов назван запретным');
});

test('обычные «Нужны правки» по-прежнему правят прежний текст (это другой режим, перегенерация его не заменяет)', { skip: !can }, async () => {
  await boot('ok'); reset();
  await api('/api/video', { id: 7, title: 'Сахар делает детей гиперактивными?', stage: 'checked', rubric: 'myth' });
  const cid = (await api('/api/chat/post', { office: 'smm', thread: 'captain_smm', sender: 'captain_smm', text: 'Сценарий', buttons: [[['Утвердить сценарий', 'approve:7'], ['Нужны правки', 'revise:7']], [['🔄 Перегенерировать', 'regen:7']]], mirror: false })).id;
  assert.equal((await api('/api/chat/answer', { id: cid, choice: 'revise:7', comment: 'Сделай концовку короче', via: 'dashboard' })).ok, true);
  for (let i = 0; i < 90 && !fs.existsSync(path.join(RUN, '_query_script1.txt')); i++) await sleep(1000);
  const q = fs.readFileSync(path.join(RUN, '_query_script1.txt'), 'utf8');
  assert.match(q, /Предыдущая версия сценария \(правь её\)/); assert.match(q, /Правки Ника: Сделай концовку короче/); assert.ok(!/ПЕРЕГЕНЕРАЦИЯ/.test(q));
  for (let i = 0; i < 90; i++) { await sleep(1000); if ((await api('/api/chat?office=smm')).messages.some((m) => m.kind === 'action' && m.status === 'open' && /Сценарий: «/.test(m.text))) break; }
});

test('слишком похожий черновик отклоняется автопроверкой, Ксения пишет заново, и итог уже новый', { skip: !can }, async () => {
  const { card, all } = await regen('similar_then_new');
  assert.equal(fs.readFileSync(path.join(RUN, 'script.json.calls'), 'utf8').trim(), '2', 'модель вызвана дважды: первый черновик отброшен');
  assert.ok(all.some((m) => m.sender === 'scriptwriter' && /слишком похож на прежнюю версию/.test(m.text)), 'Ксения сообщила в чат, что переписывает');
  assert.match(card.text, /🔄 Перегенерация/); assert.ok(!/выше порога/.test(card.text)); assert.match(fs.readFileSync(path.join(RUN, '_query_script2.txt'), 'utf8'), /Отброшенный черновик 1/);
});

test('если новизны так и не вышло за все круги, Нику честно сказано об этом, а кнопка «Перегенерировать» остаётся', { skip: !can }, async () => {
  const { card } = await regen('always_similar');
  assert.match(card.text, /⚠️ Перегенерация/); assert.match(card.text, /выше порога/); assert.ok(card.buttons.flat().some((b) => b.d === 'regen:7'));
  assert.equal(fs.readFileSync(path.join(RUN, 'script.json.calls'), 'utf8').trim(), '4', 'четыре круга и ни одним больше');
});

test('сессия Mini App может убрать карточку и сбросить ожидание сотрудника, но по-прежнему не может править промпты', { skip: !can }, async () => {
  const { signInitData } = await import('../server/lib_tgauth.mjs');
  const bot = JSON.parse(fs.readFileSync(path.join(REAL, 'config.json'), 'utf8')).smmBotToken;
  const p = { auth_date: String(Math.floor(Date.now() / 1000) - 5), query_id: 'AAH', user: JSON.stringify({ id: 323028999, first_name: 'Ник' }) };
  const login = await (await fetch(API + '/api/tg-login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ initData: new URLSearchParams({ ...p, hash: signInitData(p, bot) }).toString() }) })).json();
  const call = async (path, body) => { const r = await fetch(API + path, { method: 'POST', headers: { Authorization: 'Bearer ' + login.token, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, j: await r.json().catch(() => ({})) }; };
  const cid = (await api('/api/chat/post', { office: 'smm', thread: 'packager', sender: 'packager', text: 'Пакет', buttons: [[['Другое название', 'package:7']]], mirror: false })).id;
  const d = await call('/api/chat/answer', { id: cid, choice: 'dismiss:0', via: 'dashboard' }); assert.equal(d.status, 200); assert.equal(d.j.dismissed, true);
  const st = (await api('/api/chat?office=smm')).messages.find((m) => m.id === cid); assert.equal(st.status, 'dismissed');
  await api('/api/agent', { id: 'research', status: 'waiting', task: 'Ожидает' });
  const c = await call('/api/chat/clear-status', { agent: 'research' }); assert.equal(c.status, 200); assert.equal(c.j.status, 'idle');
  assert.equal((await call('/api/prompt', { agent_id: 'video', body: 'x' })).status, 403);
});

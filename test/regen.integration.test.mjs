// «Перегенерировать»: полный путь нажатие -> конвейер (имитация Ксении и Веры) -> карточка. Настоящий API на КОПИИ данных, Telegram и озвучка по сети выключены.
// Тестовый ролик №7 (пакетные тесты занимают №8, тесты правок №9: файловые тесты идут параллельно) живёт в smm/runs/video_7 и удаляется после теста; рабочая база и журналы не трогаются.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { copyLiveDb } from './fixtures/copy_db.mjs';
process.env.VARIANTS = 'off';          // эти тесты проверяют одиночный сценарий; варианты B и C покрыты в variants*.test.mjs

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REAL = path.join(ROOT, 'server', 'data');
const can = fs.existsSync(path.join(REAL, 'office.db')) && fs.existsSync(path.join(REAL, 'config.json')) && fs.existsSync('C:/hf_tts/venv/Scripts/python.exe');
const PORT = 9400 + (process.pid % 90), API = `http://127.0.0.1:${PORT}`;
const RUN = path.join(ROOT, 'smm', 'runs', 'video_7'), FAKE = path.join(ROOT, 'test', 'fixtures', 'fake_agent.mjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let tmp, server, TOKEN;
const api = async (p, body) => { const r = await fetch(API + p, { method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return r.json(); };
const OLD = ['Ребёнок съел конфету и носится как угорелый. Виноват сахар? Открываем дело номер один.', 'Улика первая. Шестнадцать работ, двадцать три эксперимента: никто не знал, где сахар, а где замена. Итог в журнале JAMA: на поведение детей сахар не влияет.', 'Улика вторая. Одним мамам сказали: сын съел много сахара. Но всем детям дали пустышку. Те мамы назвали сыновей более гиперактивными.', 'Вероятно, всё дело в ожидании. От сладкого ждут бури, а сладкое подают на празднике, где и так шумно.', 'Приговор: миф. Но сахар вреден для зубов и веса. ВОЗ советует: добавленных сахаров меньше десяти процентов калорий.'];
function startServer(mode) {
  return spawn(process.execPath, ['server.mjs'], { cwd: path.join(ROOT, 'server'), env: { ...process.env, OFFICE_DATA_DIR: tmp, PORT: String(PORT), OFFICE_NO_TG: '1', OFFICE_CHAT_STUB: '1', OFFICE_NO_WATCH: '1', HERMES_BIN: FAKE, SMM_TTS_ESTIMATE_ONLY: '1', FAKE_SCRIPT_MODE: mode, CRAFT_GATE: mode === 'craft' ? 'on' : 'off', CODEWORD_GATE: mode === 'codeword' ? 'on' : 'off' }, stdio: 'ignore' });   // CRAFT_GATE=off: старые тесты проверяют новизну, длину и правки, а не драматургию
}
async function boot(mode) {
  if (server) { server.kill(); await sleep(700); }
  server = startServer(mode);
  for (let i = 0; i < 40; i++) { try { if ((await fetch(API + '/health')).ok) return; } catch {} await sleep(300); }
}
const reset = () => { fs.rmSync(RUN, { recursive: true, force: true }); fs.mkdirSync(RUN, { recursive: true }); fs.writeFileSync(path.join(RUN, 'script.json'), JSON.stringify({ title: 'Сахар', segments: OLD, hook_type: 'сцена' })); };
// Ищем только карточки новее своей (id > cid): в копии боевого чата лежит настоящая открытая карточка сценария.
async function regen(mode, { experiment = null } = {}) {
  await boot(mode); reset();
  if (experiment) fs.writeFileSync(path.join(RUN, 'experiment.json'), JSON.stringify({ name: experiment, ts: Date.now() }));
  await api('/api/video', { id: 7, title: 'Сахар делает детей гиперактивными?', stage: 'checked', rubric: 'myth' });
  const cid = (await api('/api/chat/post', { office: 'smm', thread: 'captain_smm', sender: 'captain_smm', text: 'Сценарий', buttons: [[['Утвердить сценарий', 'approve:7'], ['Нужны правки', 'revise:7']], [['🔄 Перегенерировать', 'regen:7'], ['Отклонить тему', 'reject:7']]], mirror: false })).id;
  const r = await api('/api/chat/answer', { id: cid, choice: 'regen:7', via: 'dashboard' }); assert.equal(r.ok, true);
  for (let i = 0; i < 90; i++) { await sleep(1000); const m = (await api('/api/chat?office=smm')).messages.filter((x) => x.id > cid && x.kind === 'action' && x.status === 'open' && /Сценарий: «/.test(x.text)); if (m.length) return { card: m[m.length - 1], all: (await api('/api/chat?office=smm')).messages }; }
  throw new Error('карточка нового сценария не пришла за 90 с');
}
before(() => { if (!can) return; tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'regen-test-')); copyLiveDb(REAL, tmp, 'regen'); TOKEN = JSON.parse(fs.readFileSync(path.join(REAL, 'config.json'), 'utf8')).token; });
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
  for (let i = 0; i < 90; i++) { await sleep(1000); if ((await api('/api/chat?office=smm')).messages.some((m) => m.id > cid && m.kind === 'action' && m.status === 'open' && /Сценарий: «/.test(m.text))) break; }
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
  assert.equal(fs.readFileSync(path.join(RUN, 'script.json.calls'), 'utf8').trim(), '3', 'три круга при перегенерации и ни одним больше (решение Ника 2026-10-21; раньше шесть)');
});

test('служебные слова в тексте («улика первая», «поворот», «приговор», «источники на экране») автоматически возвращаются Ксении, Нику приходит уже чистый сценарий', { skip: !can }, async () => {
  const { card } = await regen('stage_words');
  const now = JSON.parse(fs.readFileSync(path.join(RUN, 'script.json'), 'utf8')), text = now.segments.join(' ');
  assert.doesNotMatch(text, /улик|поворот|приговор|развязк|источники на экране/i, 'в итоговом тексте служебных слов нет');
  const qs = fs.readFileSync(path.join(RUN, 'script.json.queries'), 'utf8');
  assert.match(qs, /служебные слова каркаса/); assert.match(qs, /абзац 2: номер улики/); assert.match(qs, /слово «поворот»/); assert.match(qs, /«источники на экране»/); assert.match(qs, /Перепиши эти места по смыслу/);
  assert.ok(qs.split('---').filter((x) => x.trim()).length >= 2, 'Ксении ушло минимум два запроса: первый чистый, второй с замечанием');
  assert.match(card.text, /Сценарий: «/); assert.ok(card.buttons.flat().some((b) => b.d === 'approve:7'));
});

test('драматургия: «перебор фактов» без идеи, дуги и связок возвращается Ксении с замечанием, исправленный текст доходит до Ника, в карточке идея, эмоция и связки', { skip: !can }, async () => {
  const { card } = await regen('craft');
  const now = JSON.parse(fs.readFileSync(path.join(RUN, 'script.json'), 'utf8'));
  assert.equal(now.chain.length, now.segments.length - 1); assert.ok(now.chain.some((c) => c.link === 'но')); assert.ok(now.payoff && now.idea && now.emotion_arc.length >= 3);
  const qs = fs.readFileSync(path.join(RUN, 'script.json.queries'), 'utf8');
  assert.match(qs, /Автопроверка драматургии/); assert.match(qs, /поле chain/); assert.match(qs, /emotion_arc/); assert.match(qs, /payoff/); assert.match(qs, /SCRIPT_CRAFT\.md/);
  assert.match(card.text, /Идея: Бурю у детей/); assert.match(card.text, /Эмоция: любопытство → удивление → недоверие → ясность/); assert.match(card.text, /Связки: 1→2 но, 2→3 поэтому, 3→4 но, 4→5 поэтому/);
  assert.doesNotMatch(card.text, /Драматургию автопроверка не приняла/); assert.ok(card.buttons.flat().some((b) => b.d === 'approve:7'));
  // Ксения вернула «Поэтому вывод…», «Значит, дело…», «Так что буря…»: код вырезает вводные слова, Ник видит сразу суть (решение 2026-10-21)
  assert.ok(!now.segments.some((s) => /(^|[.!?…]\s+)(поэтому|значит|так что|потому что|итак)(?![а-яё])/i.test(s)), now.segments.join(' | '));
  assert.match(card.text, /Вывод простой: на поведение детей сахар не влияет/); assert.match(card.text, /Дело в ожидании\. Буря на празднике это не сахар/); assert.doesNotMatch(card.text, /Так что буря|Поэтому вывод|Значит, дело/);
  assert.equal(now.payoff, 'буря на празднике это не сахар, а сам праздник');
});

test('«обновить карточку» (card): тот же сценарий и вердикт Веры без запросов к моделям, вводные слова убраны, старая карточка закрыта, новая с живыми кнопками', { skip: !can }, async () => {
  const { card: old } = await regen('craft');
  const f = path.join(RUN, 'script.json'), sc = JSON.parse(fs.readFileSync(f, 'utf8'));
  sc.segments[1] = 'Так что ' + sc.segments[1][0].toLowerCase() + sc.segments[1].slice(1); sc.segments[sc.segments.length - 1] = 'Поэтому ' + sc.segments[sc.segments.length - 1][0].toLowerCase() + sc.segments[sc.segments.length - 1].slice(1);
  fs.writeFileSync(f, JSON.stringify(sc, null, 1));
  const qBefore = fs.statSync(path.join(RUN, 'script.json.queries')).size, checkBefore = fs.readFileSync(path.join(RUN, 'check.json'), 'utf8');
  const res = await new Promise((resolve) => { const p = spawn(process.execPath, [path.join(ROOT, 'scripts', 'smm_pipeline.mjs'), 'card', '7'], { cwd: ROOT, env: { ...process.env, OFFICE_API: API, OFFICE_NO_TG: '1', HERMES_BIN: FAKE, OFFICE_DATA_DIR: tmp, SMM_TTS_ESTIMATE_ONLY: '1' }, stdio: ['ignore', 'pipe', 'pipe'] }); let o = ''; p.stdout.on('data', (b) => (o += b)); p.stderr.on('data', (b) => (o += b)); p.on('exit', (code) => resolve({ code, out: o })); });
  assert.equal(res.code, 0, res.out); assert.match(res.out, /убраны вводные слова: абз\.2, абз\.\d/);
  assert.equal(fs.statSync(path.join(RUN, 'script.json.queries')).size, qBefore, 'к модели Ксении новых запросов нет'); assert.equal(fs.readFileSync(path.join(RUN, 'check.json'), 'utf8'), checkBefore, 'вердикт Веры не тронут');
  const msgs = (await api('/api/chat?office=smm')).messages, fresh = msgs.filter((x) => x.id > old.id && x.kind === 'action' && x.status === 'open' && /Сценарий: «/.test(x.text)).pop();
  assert.ok(fresh, 'новой карточки нет'); assert.match(fresh.text, /Карточка обновлена: убраны вводные слова/); assert.ok(fresh.buttons.flat().some((b) => b.d === 'approve:7') && fresh.buttons.flat().some((b) => b.d === 'regen:7'));
  assert.match(fresh.text.split('\n')[1], /«Так что», «Поэтому»/); assert.doesNotMatch(fresh.text.split('\n').slice(2).join('\n'), /Так что |Поэтому /); assert.match(fresh.text, /Вера сверила смысл с источниками/);
  const was = msgs.find((x) => x.id === old.id); assert.equal(was.status, 'answered'); assert.equal(was.choice, 'superseded', 'старая карточка закрыта сервером');
  assert.doesNotMatch(fs.readFileSync(path.join(RUN, 'script_ru.txt'), 'utf8'), /Так что |Поэтому /);
  const again = await new Promise((resolve) => { const p = spawn(process.execPath, [path.join(ROOT, 'scripts', 'smm_pipeline.mjs'), 'card', '7'], { cwd: ROOT, env: { ...process.env, OFFICE_API: API, OFFICE_NO_TG: '1', HERMES_BIN: FAKE, OFFICE_DATA_DIR: tmp }, stdio: ['ignore', 'pipe', 'pipe'] }); let o = ''; p.stdout.on('data', (b) => (o += b)); p.on('exit', (code) => resolve({ code, out: o })); });
  assert.equal(again.code, 0); assert.match(again.out, /текст без изменений/, 'повтор идемпотентен');
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

test('кодовое слово: сценарий без обещания слова возвращается Ксении с замечанием, исправленный (одно обещание в абзаце 1, без напоминалок в середине) доходит до Ника, призыв со словом стоит последним абзацем', { skip: !can }, async () => {
  const { card } = await regen('codeword');
  const now = JSON.parse(fs.readFileSync(path.join(RUN, 'script.json'), 'utf8'));
  assert.match(now.segments[0], /Досмотри до конца\. Там же будет слово для бесплатного файла с тридцатью самыми популярными мифами\./); assert.equal(now.segments.filter((x) => /слово/i.test(x)).length, 1, 'слово упомянуто один раз, в начале; напоминалок в середине нет');
  const qs = fs.readFileSync(path.join(RUN, 'script.json.queries'), 'utf8');
  assert.match(qs, /Лид-магнит/); assert.match(qs, /«ДОСЬЕ»/); assert.match(qs, /ОДНО обещание по формуле Ника/);
  assert.match(card.text, /Кодовое слово — «досье»/); assert.ok(card.buttons.flat().some((b) => b.d === 'approve:7'));
  const sr = fs.readFileSync(path.join(ROOT, 'smm', 'runs', 'video_7', 'script_ru.txt'), 'utf8').trim().split(/\n\n/);
  assert.match(sr[sr.length - 1], /^Кодовое слово — «досье»\./); assert.doesNotMatch(sr.slice(0, -1).join(' '), /досье|боту|подписк/i);
});

test('эксперимент «ответ вперёд»: сценарий с ответом («миф») в абзаце 1 проходит проверку стиля, задания Ксении и Веры несут исключение, на карточке пометка; без эксперимента такой текст не принимался бы', { skip: !can }, async () => {
  const { card } = await regen('verdict_first', { experiment: 'verdict_first' });
  const now = JSON.parse(fs.readFileSync(path.join(RUN, 'script.json'), 'utf8'));
  assert.match(now.segments[0], /Это миф: сахар не делает детей буйными\. Почему\? Досмотри до конца\./, 'текст Ксении принят как есть, ответ в начале не вырезан');
  const qs = fs.readFileSync(path.join(RUN, '_query_script1.txt'), 'utf8');
  assert.match(qs, /ЭКСПЕРИМЕНТ «ОТВЕТ ВПЕРЁД»/); assert.match(qs, /НЕ действует/);
  const qc = fs.readFileSync(path.join(RUN, '_query_check1.txt'), 'utf8'); assert.match(qc, /ЭКСПЕРИМЕНТ «ОТВЕТ ВПЕРЁД»/); assert.match(qc, /не возвращай сценарий за это/);
  assert.match(card.text, /🧪 Эксперимент «ответ вперёд»/); assert.ok(card.buttons.flat().some((b) => b.d === 'approve:7'));
  assert.equal(JSON.parse(fs.readFileSync(path.join(RUN, 'experiment.json'), 'utf8')).name, 'verdict_first');
});

test('без эксперимента тот же текст (ответ «миф» в абзаце 1) стилем отклоняется: правило «вердикт только в конце» для обычных роликов живо', { skip: !can }, async () => {
  await boot('verdict_first'); reset();
  await api('/api/video', { id: 7, title: 'Сахар делает детей гиперактивными?', stage: 'checked', rubric: 'myth' });
  const cid = (await api('/api/chat/post', { office: 'smm', thread: 'captain_smm', sender: 'captain_smm', text: 'Сценарий', buttons: [[['Утвердить сценарий', 'approve:7'], ['Нужны правки', 'revise:7'], ['Перегенерировать', 'regen:7']]] })).id;
  await api('/api/chat/answer', { id: cid, choice: 'regen:7', via: 'dashboard' });
  const qf = path.join(RUN, 'script.json.queries'), calls = () => (fs.existsSync(qf) ? fs.readFileSync(qf, 'utf8').split('\n---\n').filter((x) => x.trim()) : []);
  for (let i = 0; i < 120 && calls().length < 2; i++) await sleep(1000);
  assert.ok(calls().length >= 2, 'Ксения получила второй круг');
  assert.match(calls()[1], /Вердикт \(миф это или правда\) нельзя называть в начале ролика/, 'второй круг Ксении начался с замечания о вердикте в начале');
  assert.ok(!fs.existsSync(path.join(RUN, 'experiment.json')));
});

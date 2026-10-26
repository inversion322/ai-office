// Тест логики чата и действий (временная БД, без Telegram, без реального конвейера: ROOT указывает в пустую папку)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.OFFICE_NO_TG = '1'; process.env.OFFICE_NO_WATCH = '1'; process.env.OFFICE_CHAT_STUB = '1';
const { setupChat } = await import('../server/lib_chat.mjs');

function make() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-test-'));
  const db = new DatabaseSync(path.join(dir, 't.db'));
  db.exec(`CREATE TABLE agents (id TEXT PRIMARY KEY, name TEXT, role TEXT, office TEXT, status TEXT, task TEXT, progress INT, updated_at INT);
    CREATE TABLE videos (id INTEGER PRIMARY KEY, title TEXT, stage TEXT, updated_at INT);
    CREATE TABLE kv (k TEXT PRIMARY KEY, v TEXT); CREATE TABLE prompts (agent_id TEXT, body TEXT);
    CREATE TABLE events (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INT, agent_id TEXT, level TEXT, message TEXT);
    INSERT INTO agents VALUES ('captain_smm','Капитан Кряк','Chief of Staff','smm','idle','',0,0),('scriptwriter','Ксения Сюжетова','Scriptwriter','smm','idle','',0,0);
    INSERT INTO videos VALUES (3,'Витамин C','scored',0),(5,'Шаги','scored',0);`);
  const chat = setupChat({ db, ROOT: dir, DATA_DIR: dir });   // в ROOT нет scripts/: запуск конвейера безвреден
  return { db, chat, dir };
}
const topics = (chat) => chat.post({ thread: 'captain_smm', sender: 'captain_smm', kind: 'action', text: 'Темы', buttons: [[['Тема 1', 'pick:3'], ['Тема 2', 'pick:5']], [['Другие темы', 'more:0']]] });

test('ответ закрывает карточку, повторный ответ отклоняется', async () => {
  const { chat } = make(); const id = topics(chat);
  assert.equal(chat.pending('smm'), 1);
  const r = await chat.answer({ id, choice: 'pick:3', via: 'dashboard' });
  assert.equal(r.ok, true); assert.equal(chat.pending('smm'), 0);
  const again = await chat.answer({ id, choice: 'pick:5', via: 'telegram' });
  assert.equal(again.ok, false); assert.match(again.error, /уже ответили/);
});

test('неизвестная кнопка и неизвестный вопрос', async () => {
  const { chat } = make(); const id = topics(chat);
  assert.equal((await chat.answer({ id, choice: 'hack:1', via: 'dashboard' })).ok, false);
  assert.equal((await chat.answer({ id: 999, choice: 'pick:3', via: 'dashboard' })).ok, false);
  assert.equal(chat.pending('smm'), 1);
});

test('выбор темы закрывает устаревшие карточки выбора (нельзя запустить второй сценарий)', async () => {
  // Два РАЗНЫХ списка тем (с одинаковыми кнопками второй сразу заменил бы первый, см. тест ниже): оба открыты, выбор в одном закрывает другой.
  const { chat, db } = make(); const a = topics(chat), b = chat.post({ thread: 'captain_smm', sender: 'captain_smm', kind: 'action', text: 'Другие темы', buttons: [[['Тема 7', 'pick:7'], ['Тема 9', 'pick:9']]] });
  assert.equal(chat.pending('smm'), 2);
  await chat.answer({ id: a, choice: 'pick:3', via: 'telegram' });
  const rows = db.prepare('SELECT id,status,choice,answered_via FROM messages WHERE kind=? ORDER BY id').all('action');
  assert.deepEqual(rows.map((r) => [r.status, r.choice, r.answered_via]), [['answered', 'pick:3', 'telegram'], ['answered', 'superseded', 'system']]);
  assert.equal(chat.pending('smm'), 0);
  assert.equal(db.prepare("SELECT stage FROM videos WHERE id=3").get().stage, 'script');
});

test('сообщение Ника из дашборда попадает в ветку сотрудника и в историю', () => {
  const { chat, db } = make();
  const r = chat.incoming({ text: 'Ксения, привет', source: 'dashboard', thread: 'scriptwriter' });
  assert.equal(r.ok, true);
  const m = db.prepare("SELECT thread,sender,source FROM messages WHERE sender='nick'").get();
  assert.deepEqual([m.thread, m.sender, m.source], ['scriptwriter', 'nick', 'dashboard']);
});

test('из Telegram имя в начале сообщения выбирает сотрудника, без имени отвечает Капитан', () => {
  const { chat, db } = make();
  chat.incoming({ text: 'Ксения, а сценарий готов?', source: 'telegram' });
  chat.incoming({ text: 'Что в работе?', source: 'telegram' });
  const rows = db.prepare("SELECT thread FROM messages WHERE sender='nick' ORDER BY id").all().map((r) => r.thread);
  assert.deepEqual(rows, ['scriptwriter', 'captain_smm']);
});

import { cleanReport } from '../server/lib_text.mjs';

const videoCard = (chat, id = 3) => chat.post({ thread: 'captain_smm', sender: 'captain_smm', kind: 'action', text: 'Ролик готов', buttons: [[['Принять ролик', `accept:${id}`], ['Внести правки', `rework:${id}`]]], tgMsg: 77 });

test('«Внести правки» с комментарием: карточка закрыта, стадия editing, приоритет включён, прежняя кнопка «Принять» не останется', async () => {
  const { chat, db } = make(); const id = videoCard(chat); db.prepare("UPDATE videos SET stage='produced' WHERE id=3").run();
  const r = await chat.answer({ id, choice: 'rework:3', comment: 'заголовок крупнее', via: 'dashboard' });
  assert.equal(r.ok, true); assert.equal(chat.pending('smm'), 0);
  assert.equal(db.prepare('SELECT stage FROM videos WHERE id=3').get().stage, 'editing');
  const p = chat.priority(); assert.equal(p.active, true); assert.equal(p.video_id, 3);
  const row = db.prepare('SELECT status,choice FROM messages WHERE id=?').get(id); assert.deepEqual([row.status, row.choice], ['answered', 'rework:3']);
});

test('«Внести правки» без текста (Telegram): карточка и кнопка «Принять» остаются, следующий текст Ника становится комментарием', async () => {
  const { chat, db } = make(); const id = videoCard(chat);
  const r = await chat.answer({ id, choice: 'rework:3', via: 'telegram' });
  assert.deepEqual([r.ok, r.pending], [true, 'comment']);
  assert.equal(chat.pending('smm'), 1, 'карточка закрылась раньше времени');
  assert.equal(chat.priority().active, false, 'приоритет включился до получения правок');
  chat.incoming({ text: 'Замедли первую сцену', source: 'telegram' });
  assert.equal(chat.pending('smm'), 0);
  assert.equal(chat.priority().active, true);
  const row = db.prepare('SELECT status,choice,answered_via FROM messages WHERE id=?').get(id); assert.deepEqual([row.status, row.choice, row.answered_via], ['answered', 'rework:3', 'telegram']);
  assert.equal(db.prepare("SELECT v FROM kv WHERE k='awaiting'").get(), undefined, 'ожидание комментария не сброшено');
});

test('ожидание комментария истекает через 30 минут: старое «ожидание» не съедает обычное сообщение', async () => {
  const { chat, db } = make(); const id = videoCard(chat);
  await chat.answer({ id, choice: 'rework:3', via: 'telegram' });
  db.prepare("UPDATE kv SET v=? WHERE k='awaiting'").run(JSON.stringify({ kind: 'rework', id: 3, mid: id, ts: Date.now() - 31 * 60e3 }));
  chat.incoming({ text: 'Что в работе?', source: 'telegram' });
  assert.equal(chat.pending('smm'), 1); assert.equal(chat.priority().active, false);
});

test('«Принять ролик» закрывает и карточку правок: после приёмки поздняя кнопка «Внести правки» не запустит монтаж', async () => {
  // Дубль появиться через post() уже не может (его закрывает новая карточка), но в базе мог остаться старый: копируем строку напрямую, как это было до правила.
  const { chat, db } = make(); const a = videoCard(chat);
  const b = Number(db.prepare("INSERT INTO messages (ts,office,thread,sender,kind,text,buttons,status,source) SELECT ts,office,thread,sender,kind,text,buttons,status,source FROM messages WHERE id=?").run(a).lastInsertRowid);
  await chat.answer({ id: a, choice: 'accept:3', via: 'dashboard' });
  assert.equal(db.prepare('SELECT choice FROM messages WHERE id=?').get(b).choice, 'superseded');
  assert.equal(db.prepare('SELECT stage FROM videos WHERE id=3').get().stage, 'approved');
});

test('cleanReport: без markdown, без заголовка, обрезка по предложению', () => {
  const md = '# Дело №01, ролик v2: отчёт Кирилла (19.10.2026)\n\nИтог: `final/dosie01_v2.mp4`, 50,7 с (лимит 59,0 с). Не опубликован, **ждёт** приёмки Ника.\n\n## Файлы\n- `final/x.mp4`';
  const s = cleanReport(md);
  assert.equal(s, 'Итог: final/dosie01_v2.mp4, 50,7 с (лимит 59,0 с). Не опубликован, ждёт приёмки Ника.');
  assert.ok(!/[`#*]/.test(s));
  const long = cleanReport('Первое предложение. ' + 'Очень длинное второе предложение без конца '.repeat(20), 120);
  assert.ok(long.length <= 125 && /[.…]$/.test(long), long);
});


/* ---------- «Убрать», замена дублей, сброс ожидания, перегенерация ---------- */
const card = (chat, buttons, o = {}) => chat.post({ thread: 'captain_smm', sender: 'captain_smm', kind: 'action', text: 'Карточка', buttons, ...o });
const row = (db, id) => db.prepare('SELECT * FROM messages WHERE id=?').get(id);
const ds = (db, id) => JSON.parse(row(db, id).buttons).flat().map((b) => b.d);

test('каждая карточка получает «✖ Убрать»; подтверждения «Да/Нет» и обычные сообщения не получают', () => {
  const { chat, db } = make();
  const a = card(chat, [[['Принять ролик', 'accept:3']]]); assert.deepEqual(ds(db, a), ['accept:3', 'dismiss:0']);
  assert.equal(JSON.parse(row(db, a).buttons).flat().find((b) => b.d === 'dismiss:0').t, '✖ Убрать');
  const conf = card(chat, [[['Да, сделать', 'confirm:1'], ['Нет', 'cancel:1']]], { ref: { data: 'accept:3' } }); assert.deepEqual(ds(db, conf), ['confirm:1', 'cancel:1']);
  const plain = chat.say('captain_smm', 'просто текст'); assert.equal(row(db, plain).buttons, null);
});

test('новая карточка с тем же действием по тому же ролику заменяет старую (зависших дублей не копится)', () => {
  const { chat, db } = make(); const a = card(chat, [[['Другое название', 'package:3']]]), b = card(chat, [[['Другое название', 'package:3']]]);
  assert.equal(chat.pending('smm'), 1); assert.deepEqual([row(db, a).status, row(db, a).choice, row(db, a).answered_via], ['answered', 'superseded', 'system']); assert.equal(row(db, b).status, 'open');
  const other = card(chat, [[['Другое название', 'package:5']]]); assert.equal(chat.pending('smm'), 2, 'другой ролик не затронут');
  const c = card(chat, [[['Принять ролик', 'accept:3']]]); assert.equal(row(db, b).status, 'open', 'другое действие по тому же ролику не затронуто'); assert.equal(row(db, c).status, 'open');
});

test('«Убрать»: карточка закрыта без действий и без реплик в чате, повтор отклонён, ролик и стадия не тронуты', async () => {
  const { chat, db } = make(); const a = card(chat, [[['Принять ролик', 'accept:3']]]);
  const nick0 = db.prepare("SELECT COUNT(*) c FROM messages WHERE sender='nick'").get().c, msgs0 = db.prepare('SELECT COUNT(*) c FROM messages').get().c;
  const r = await chat.answer({ id: a, choice: 'dismiss:0', via: 'telegram' });
  assert.deepEqual([r.ok, r.dismissed], [true, true]); assert.equal(chat.pending('smm'), 0);
  assert.deepEqual([row(db, a).status, row(db, a).choice, row(db, a).answered_via], ['dismissed', 'dismiss', 'telegram']);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM messages WHERE sender='nick'").get().c, nick0, 'реплика от имени Ника не пишется');
  assert.equal(db.prepare('SELECT COUNT(*) c FROM messages').get().c, msgs0, 'никаких новых сообщений (в том числе Капитана)');
  assert.equal(db.prepare('SELECT stage FROM videos WHERE id=3').get().stage, 'scored', 'стадия ролика не менялась');
  const again = await chat.answer({ id: a, choice: 'dismiss:0', via: 'dashboard' }); assert.equal(again.ok, false); assert.match(again.error, /уже ответили/);
});

test('«Убрать» работает и на старой карточке, у которой кнопки в базе ещё нет (по tg_msg, как из Telegram)', async () => {
  const { chat, db } = make(); const a = card(chat, [[['Принять ролик', 'accept:3']]]);
  db.prepare("UPDATE messages SET buttons=?, tg_msg=777 WHERE id=?").run(JSON.stringify([[{ t: 'Принять ролик', d: 'accept:3' }]]), a);
  const r = await chat.answer({ tgMsg: 777, choice: 'dismiss:0', via: 'telegram' }); assert.equal(r.ok, true); assert.equal(row(db, a).status, 'dismissed');
});

test('«Убрать» снимает ожидание сотрудника только когда карточек у него не осталось', async () => {
  const { chat, db } = make(); const a = card(chat, [[['Принять ролик', 'accept:3']]]), b = card(chat, [[['Другое название', 'package:5']]]);
  db.prepare("UPDATE agents SET status='waiting', task='Ждёт утверждения' WHERE id='captain_smm'").run();
  await chat.answer({ id: a, choice: 'dismiss:0', via: 'dashboard' });
  assert.equal(db.prepare("SELECT status FROM agents WHERE id='captain_smm'").get().status, 'waiting', 'ещё одна карточка ждёт, статус сохраняется');
  await chat.answer({ id: b, choice: 'dismiss:0', via: 'dashboard' });
  assert.deepEqual(Object.values(db.prepare("SELECT status, task FROM agents WHERE id='captain_smm'").get()), ['idle', 'Свободен']);
});

test('сброс статуса сотрудника: ждёт и ошибка сбрасываются, работающий нет, при открытых карточках отказ с числом', () => {
  const { chat, db } = make(); const st = (id) => db.prepare('SELECT status FROM agents WHERE id=?').get(id).status;
  db.prepare("UPDATE agents SET status='waiting' WHERE id='scriptwriter'").run(); assert.deepEqual(chat.clearStatus('scriptwriter'), { ok: true, status: 'idle' }); assert.equal(st('scriptwriter'), 'idle');
  db.prepare("UPDATE agents SET status='error' WHERE id='scriptwriter'").run(); assert.equal(chat.clearStatus('scriptwriter').ok, true); assert.equal(st('scriptwriter'), 'idle');
  db.prepare("UPDATE agents SET status='working' WHERE id='scriptwriter'").run(); const w = chat.clearStatus('scriptwriter'); assert.equal(w.ok, false); assert.match(w.error, /работает/); assert.equal(st('scriptwriter'), 'working');
  db.prepare("UPDATE agents SET status='waiting' WHERE id='captain_smm'").run(); card(chat, [[['Принять ролик', 'accept:3']]]);
  const o = chat.clearStatus('captain_smm'); assert.equal(o.ok, false); assert.match(o.error, /карточки.*: 1/); assert.equal(st('captain_smm'), 'waiting');
  assert.equal(chat.clearStatus('нет-такого').ok, false);
});

test('отклонение темы закрывает карточки сценария и не оставляет Капитана «ждущим» (раньше оставался «Вера не пропустила сценарий»)', async () => {
  const { chat, db } = make(); db.prepare("UPDATE videos SET stage='script' WHERE id=3").run();
  const a = card(chat, [[['Утвердить сценарий', 'approve:3'], ['Нужны правки', 'revise:3']], [['🔄 Перегенерировать', 'regen:3'], ['Отклонить тему', 'reject:3']]]);
  db.prepare("UPDATE agents SET status='waiting', task='Вера не пропустила сценарий' WHERE id='captain_smm'").run();
  await chat.answer({ id: a, choice: 'reject:3', via: 'telegram' });
  assert.equal(db.prepare('SELECT stage FROM videos WHERE id=3').get().stage, 'rejected'); assert.equal(chat.pending('smm'), 0);
  assert.equal(db.prepare("SELECT status FROM agents WHERE id='captain_smm'").get().status, 'idle');
});

test('«Перегенерировать»: стадия «сценарий», старые кнопки утверждения закрыты, запущен этап script --regen', async () => {
  const { chat, db } = make(); db.prepare("UPDATE videos SET stage='checked' WHERE id=3").run();
  const a = card(chat, [[['Утвердить сценарий', 'approve:3'], ['Нужны правки', 'revise:3']], [['🔄 Перегенерировать', 'regen:3'], ['Отклонить тему', 'reject:3']]]);
  const r = await chat.answer({ id: a, choice: 'regen:3', via: 'dashboard' }); assert.equal(r.ok, true);
  assert.equal(db.prepare('SELECT stage FROM videos WHERE id=3').get().stage, 'script');
  assert.equal(db.prepare("SELECT status FROM agents WHERE id='captain_smm'").get().status, 'working');
  const said = db.prepare("SELECT text FROM messages WHERE sender='captain_smm' ORDER BY id").all().map((m) => m.text).join('\n');
  assert.match(said, /Перегенерирую сценарий «Витамин C» с нуля/); assert.match(said, /script 3 --regen/, 'в тестовом режиме этап не запускается, но называется с нужными аргументами');
  assert.ok(!/--comment/.test(said), 'без пожелания комментарий не передаётся');
});

test('одноразовая миграция: уже висящая карточка без «Убрать» получает его при запуске', () => {
  const { chat, db, dir } = make(); const a = card(chat, [[['Другое название', 'package:3']]]);
  db.prepare('UPDATE messages SET buttons=? WHERE id=?').run(JSON.stringify([[{ t: 'Другое название', d: 'package:3' }]]), a);
  setupChat({ db, ROOT: dir, DATA_DIR: dir });
  assert.deepEqual(ds(db, a), ['package:3', 'dismiss:0']);
  setupChat({ db, ROOT: dir, DATA_DIR: dir }); assert.deepEqual(ds(db, a), ['package:3', 'dismiss:0'], 'повторный запуск не дублирует кнопку');
});


/* ---------- «понимать с первого раза»: короткие ответы, прямое выполнение, без дублей ---------- */
const tick = (ms = 80) => new Promise((r) => setTimeout(r, ms));
function confirmCard(chat, db, data, comment = '', title = 'Выбрать тему «Шаги»?') {
  const id = chat.post({ thread: 'captain_smm', sender: 'captain_smm', kind: 'action', text: `Правильно ли я поняла: ${title}`, ref: { data, comment }, buttons: [[['Да, сделать', 'confirm:0'], ['Нет', 'cancel:0']]] });
  db.prepare('UPDATE messages SET buttons=? WHERE id=?').run(JSON.stringify([[{ t: 'Да, сделать', d: `confirm:${id}` }, { t: 'Нет', d: `cancel:${id}` }]]), id);
  return id;
}
const msgs = (db) => db.prepare('SELECT * FROM messages ORDER BY id').all();
const stageOf = (db, id) => db.prepare('SELECT stage FROM videos WHERE id=?').get(id).stage;

test('напечатанное «Да» отвечает на открытый вопрос: без модели, без новой карточки, ответ Ника не дублируется', async () => {
  const { chat, db } = make(); const a = confirmCard(chat, db, 'pick:5');
  chat.incoming({ text: 'Да', source: 'dashboard', thread: 'captain_smm' }); await tick(200);
  assert.equal(stageOf(db, 5), 'script'); assert.equal(chat.pending('smm'), 0);
  const all = msgs(db); assert.equal(all.filter((m) => m.sender === 'nick').length, 1, 'только напечатанное «Да», без эха кнопки');
  assert.ok(!all.some((m) => /заглушка/.test(m.text)), 'модель не вызывалась');
  assert.equal(all.filter((m) => /Тема выбрана/.test(m.text)).length, 1);
  assert.equal(db.prepare('SELECT choice FROM messages WHERE id=?').get(a).choice, `confirm:${a}`);
});

test('четыре открытых вопроса на одно действие (как 20.10): «Да» запускает действие один раз, остальные закрываются', async () => {
  const { chat, db } = make(); const ids = [1, 2, 3, 4].map(() => confirmCard(chat, db, 'pick:5'));
  chat.incoming({ text: 'да, сделать', source: 'dashboard', thread: 'captain_smm' }); await tick(200);
  assert.equal(chat.pending('smm'), 0); assert.equal(msgs(db).filter((m) => /Тема выбрана/.test(m.text)).length, 1, 'тема выбрана один раз');
  const st = ids.map((i) => db.prepare('SELECT choice FROM messages WHERE id=?').get(i).choice); assert.equal(st.filter((c) => c === 'superseded').length, 3);
});

test('«Нет» отменяет вопрос, ничего не запускает', async () => {
  const { chat, db } = make(); confirmCard(chat, db, 'pick:5');
  chat.incoming({ text: 'не надо', source: 'telegram' }); await tick(200);
  assert.equal(stageOf(db, 5), 'scored'); assert.equal(chat.pending('smm'), 0); assert.ok(msgs(db).some((m) => m.text === 'Хорошо, не делаю.'));
});

test('«Да, про 10000 шагов»: уточнение уходит как пожелание Ксении (для выбора темы), а не теряется и не вызывает повторный вопрос', async () => {
  const { chat, db } = make(); confirmCard(chat, db, 'pick:5');
  chat.incoming({ text: 'Да, про 10000 шагов', source: 'dashboard', thread: 'captain_smm' }); await tick(200);
  assert.equal(stageOf(db, 5), 'script'); assert.ok(msgs(db).some((m) => /Пожелание передано Ксении: «про 10000 шагов»/.test(m.text)));
});

test('«Да, …» к действию без поля пожелания (принять ролик) уходит Капитану, вопрос остаётся открытым: ничего не теряется', async () => {
  const { chat, db } = make(); db.prepare("INSERT INTO videos VALUES (8,'Ролик','produced',0)").run(); confirmCard(chat, db, 'accept:8', '', 'Принять ролик?');
  chat.incoming({ text: 'Да, но поменяй музыку', source: 'dashboard', thread: 'captain_smm' }); await tick(1200);
  assert.equal(chat.pending('smm'), 1); assert.ok(msgs(db).some((m) => /заглушка/.test(m.text)), 'ответил Капитан');
  assert.equal(stageOf(db, 8), 'produced');
});

test('без открытых вопросов «Да» не выполняет ничего и уходит Капитану', async () => {
  const { chat, db } = make(); chat.incoming({ text: 'Да', source: 'dashboard', thread: 'captain_smm' }); await tick(1200);
  assert.equal(stageOf(db, 5), 'scored'); assert.ok(msgs(db).some((m) => /заглушка/.test(m.text)));
});

test('«#5» и «выбираем тему 5» выбирают тему из списка сразу, без модели', async () => {
  const { chat, db } = make(); topics(chat);
  chat.incoming({ text: 'Выбираем тему #5', source: 'dashboard', thread: 'captain_smm' }); await tick(200);
  assert.equal(stageOf(db, 5), 'script'); assert.equal(chat.pending('smm'), 0); assert.ok(!msgs(db).some((m) => /заглушка/.test(m.text)));
  assert.equal(msgs(db).filter((m) => /Тема выбрана/.test(m.text)).length, 1);
});

test('число без списка тем (ролик не ждёт выбора) не запускает ничего', async () => {
  const { chat, db } = make(); db.prepare("INSERT INTO videos VALUES (9,'Старая','rejected',0)").run();
  chat.incoming({ text: '9', source: 'dashboard', thread: 'captain_smm' }); await tick(1200);
  assert.equal(stageOf(db, 9), 'rejected');
});

async function llm(json, text, make_) {
  const { chat, db } = make_ || make(); process.env.OFFICE_CHAT_STUB_JSON = JSON.stringify(json);
  try { chat.incoming({ text, source: 'dashboard', thread: 'captain_smm' }); await tick(1300); } finally { delete process.env.OFFICE_CHAT_STUB_JSON; }
  return { chat, db };
}

test('модель: ясная команда «выбираем тему 5» выполняется сразу, одной репликой Капитана, пожелание уходит Ксении', async () => {
  const { chat, db } = await llm({ reply: 'Ник, понял: тема 5. Подтвердите кнопкой, и Ксения возьмёт её.', action: { type: 'pick', video_id: 5, comment: 'хук поярче', explicit: true } }, 'Выбираем тему 5, хук поярче');
  assert.equal(stageOf(db, 5), 'script'); assert.equal(chat.pending('smm'), 0);
  const cap = msgs(db).filter((m) => m.sender === 'captain_smm').map((m) => m.text); assert.ok(cap.some((x) => /Пожелание передано Ксении: «хук поярче»/.test(x)));
  assert.ok(!cap.some((x) => /кнопк/i.test(x)), 'нет «подтвердите кнопкой»');
});

test('модель: предположение (explicit=false) даёт ровно одну карточку «да/нет», слова про кнопку из ответа вырезаны', async () => {
  const { chat, db } = await llm({ reply: 'Ник, понял: тема 5 «Шаги», балл 77. Нажмите кнопку, и Ксения возьмёт её.', action: { type: 'pick', video_id: 5, comment: '', explicit: false } }, 'наверное шаги');
  assert.equal(stageOf(db, 5), 'scored'); assert.equal(chat.pending('smm'), 1);
  const cap = msgs(db).filter((m) => m.sender === 'captain_smm'); assert.ok(!cap.some((m) => m.kind === 'text' && /кнопк/i.test(m.text)));
  assert.match(cap.find((m) => m.kind === 'action').text, /написать «да» \/ «нет»/);
});

test('модель: тема в «ясной» команде не названа Ником (нет номера и слов названия): выполнение откладывается на подтверждение', async () => {
  const { chat, db } = await llm({ reply: '', action: { type: 'pick', video_id: 5, comment: '', explicit: true } }, 'сделай уже что-нибудь');
  assert.equal(stageOf(db, 5), 'scored'); assert.equal(chat.pending('smm'), 1);
});

test('модель: «утверждаю сценарий» (прямое указание, слово и тема названы) на проверенном сценарии утверждает сразу; без слова утверждения идёт одна карточка подтверждения', async () => {
  const m = make(); m.db.prepare("INSERT INTO videos VALUES (8,'Ролик','checked',0)").run();
  const { chat, db } = await llm({ reply: '', action: { type: 'approve', video_id: 8, comment: '', explicit: true } }, 'утверждаю сценарий 8', m);
  assert.equal(stageOf(db, 8), 'editing'); assert.equal(chat.pending('smm'), 0);
  const m2 = make(); m2.db.prepare("INSERT INTO videos VALUES (8,'Ролик','checked',0)").run();
  const r2 = await llm({ reply: '', action: { type: 'approve', video_id: 8, comment: '', explicit: true } }, 'ну пусть будет сценарий 8', m2);
  assert.equal(stageOf(r2.db, 8), 'checked'); assert.equal(r2.chat.pending('smm'), 1);
});

test('модель: повторное предложение того же действия заменяет прежнюю карточку, дублей нет', async () => {
  const m = make(); const j = { reply: '', action: { type: 'pick', video_id: 5, comment: '', explicit: false } };
  await llm(j, 'наверное шаги', m); await llm(j, 'ну шаги же', m); await llm(j, 'шаги', m);
  assert.equal(m.chat.pending('smm'), 1);
});

test('выбор темы, уже ушедшей дальше (сценарий проверен), второй раз не запускает этап', async () => {
  const { chat, db } = make(); db.prepare("INSERT INTO videos VALUES (8,'Ролик','checked',0)").run();
  const id = chat.post({ thread: 'captain_smm', sender: 'captain_smm', kind: 'action', text: 'Темы', buttons: [[['Тема 8', 'pick:8']]] });
  await chat.answer({ id, choice: 'pick:8', via: 'dashboard' });
  assert.equal(stageOf(db, 8), 'checked'); assert.ok(msgs(db).some((m) => /уже в работе/.test(m.text)));
});

test('этап запущен: второй такой же не стартует (настоящий запуск с подменой конвейера)', async () => {
  const { chat, db, dir } = make();
  fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true }); fs.writeFileSync(path.join(dir, 'scripts', 'smm_pipeline.mjs'), 'setTimeout(() => {}, 4000);');
  process.env.HERMES_BIN = 'fake';
  try {
    const a = chat.post({ thread: 'captain_smm', sender: 'captain_smm', kind: 'action', text: 'Темы', buttons: [[['Тема 5', 'pick:5']]] });
    await chat.answer({ id: a, choice: 'pick:5', via: 'dashboard' });
    const b = chat.post({ thread: 'captain_smm', sender: 'captain_smm', kind: 'action', text: 'Ещё раз темы', buttons: [[['Тема 5', 'pick:5'], ['Тема 7', 'pick:7']]] });
    await chat.answer({ id: b, choice: 'pick:5', via: 'telegram' });
    assert.equal(msgs(db).filter((m) => /Тема выбрана/.test(m.text)).length, 1, 'вторая «Тема выбрана» не пришла');
    assert.ok(msgs(db).some((m) => /Ксения уже пишет сценарий/.test(m.text)));
  } finally { delete process.env.HERMES_BIN; }
});


/* ---------- «агенты отвечают на прямые указания»: утверждение до проверки Веры, «Делаем» ---------- */
function withPipeline(fn) {         // подмена конвейера: пишет свои аргументы в файл, ничего не делает
  return async () => {
    const m = make(); const log = path.join(m.dir, 'spawned.txt');
    fs.mkdirSync(path.join(m.dir, 'scripts'), { recursive: true });
    fs.writeFileSync(path.join(m.dir, 'scripts', 'smm_pipeline.mjs'), `import fs from 'node:fs'; fs.appendFileSync(${JSON.stringify(log)}, process.argv.slice(2).join(' ') + '\\n'); setTimeout(() => {}, 1500);`);
    process.env.HERMES_BIN = 'fake';
    try { await fn({ ...m, spawned: () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n') : []) }); } finally { delete process.env.HERMES_BIN; }
  };
}
const failedCard = (chat, id = 4) => chat.post({ thread: 'captain_smm', sender: 'captain_smm', kind: 'action', text: '📝 Сценарий: «Шаги»', buttons: [[['Утвердить после проверки', `approve:${id}`], ['Нужны правки', `revise:${id}`]], [['🔄 Перегенерировать', `regen:${id}`], ['Отклонить тему', `reject:${id}`]]] });

test('«Делаем» на карточке «не прошёл проверку»: утверждение засчитано, запущено «довести до конца», карточка закрыта, ответа-отказа нет', withPipeline(async ({ chat, db, dir, spawned }) => {
  db.prepare("INSERT INTO videos VALUES (4,'Шаги','script',0)").run(); failedCard(chat);
  chat.incoming({ text: 'Делаем', source: 'telegram' }); await tick(700);
  assert.equal(chat.pending('smm'), 0); assert.deepEqual(spawned(), ['script 4 --finish']);
  assert.ok(fs.existsSync(path.join(dir, 'smm', 'runs', 'video_4', 'PREAPPROVED')), 'утверждение запомнено');
  const cap = msgs(db).filter((m) => m.sender === 'captain_smm').map((m) => m.text).join('\n'); assert.match(cap, /Принято, сценарий «Шаги» утверждён/); assert.match(cap, /сразу запущу Кирилла/);
  assert.ok(!msgs(db).some((m) => /заглушка/.test(m.text)), 'модель не вызывалась'); assert.equal(stageOf(db, 4), 'script', 'монтаж ещё не начат: Вера не пропустила');
}));

test('«Утвердить после проверки» кнопкой делает то же самое; повторное нажатие/слово не запускает второй раз', withPipeline(async ({ chat, db, spawned }) => {
  db.prepare("INSERT INTO videos VALUES (4,'Шаги','script',0)").run(); const id = failedCard(chat);
  await chat.answer({ id, choice: 'approve:4', via: 'telegram' });
  const id2 = failedCard(chat); await chat.answer({ id: id2, choice: 'approve:4', via: 'dashboard' }); await tick(300);
  assert.equal(spawned().length, 1, 'один запуск'); assert.ok(msgs(db).some((m) => /Ксения с Верой ещё работают/.test(m.text)));
}));

test('«Делаем» при двух открытых карточках с утверждением не угадывает: уходит Капитану', async () => {
  const { chat, db } = make(); db.prepare("INSERT INTO videos VALUES (4,'Шаги','script',0),(8,'Ролик','produced',0)").run();
  failedCard(chat, 4); chat.post({ thread: 'captain_smm', sender: 'captain_smm', kind: 'action', text: 'Ролик готов', buttons: [[['Принять ролик', 'accept:8'], ['Внести правки', 'rework:8']]] });
  chat.incoming({ text: 'Делаем', source: 'dashboard', thread: 'captain_smm' }); await tick(1300);
  assert.equal(chat.pending('smm'), 2); assert.ok(msgs(db).some((m) => /заглушка/.test(m.text)));
});

test('«Делаем» на карточке проверенного сценария («Утвердить сценарий») утверждает и запускает монтаж', withPipeline(async ({ chat, db, spawned }) => {
  db.prepare("INSERT INTO videos VALUES (4,'Шаги','checked',0)").run(); chat.post({ thread: 'captain_smm', sender: 'captain_smm', kind: 'action', text: 'Сценарий', buttons: [[['Утвердить сценарий', 'approve:4'], ['Нужны правки', 'revise:4']]] });
  chat.incoming({ text: 'Делаем', source: 'dashboard', thread: 'captain_smm' }); await tick(600);
  assert.equal(stageOf(db, 4), 'editing'); assert.deepEqual(spawned(), ['produce 4']);
}));

test('правки, перегенерация и отклонение снимают предварительное утверждение', withPipeline(async ({ chat, db, dir }) => {
  for (const act of ['revise:4', 'regen:4', 'reject:4']) {
    db.prepare("DELETE FROM videos WHERE id=4").run(); db.prepare("INSERT INTO videos VALUES (4,'Шаги','script',0)").run();
    const pre = path.join(dir, 'smm', 'runs', 'video_4', 'PREAPPROVED'); fs.mkdirSync(path.dirname(pre), { recursive: true }); fs.writeFileSync(pre, '1');
    const id = failedCard(chat); await chat.answer({ id, choice: act, comment: act === 'revise:4' ? 'короче' : undefined, via: 'dashboard' });
    assert.equal(fs.existsSync(pre), false, act);
  }
}));

test('уже висящая карточка «не прошёл проверку» без кнопки утверждения получает её при запуске (тупик из 20.10)', () => {
  const { db, chat } = make(); db.prepare("INSERT INTO videos VALUES (4,'Шаги','script',0)").run();
  chat.post({ thread: 'captain_smm', sender: 'captain_smm', kind: 'action', text: 'Сценарий', buttons: [[['Нужны правки', 'revise:4'], ['🔄 Перегенерировать', 'regen:4']], [['Отклонить тему', 'reject:4']]] });
  const chat2 = setupChat({ db, ROOT: path.dirname(db.prepare('PRAGMA database_list').get().file), DATA_DIR: os.tmpdir() });
  const b = JSON.parse(db.prepare("SELECT buttons FROM messages WHERE kind='action'").get().buttons).flat().map((x) => x.d);
  assert.ok(b.includes('approve:4')); assert.equal(chat2.pending('smm'), 1);
});

test('«Своё название» без текста (Telegram): карточка остаётся открытой, следующий текст Ника становится названием; слишком длинное просят сократить и ждут снова', async () => {
  const { chat, db } = make(); const id = card(chat, [[['🔄 Перегенерировать название', 'package:3'], ['✏️ Своё название', 'title:3']]]);
  const r = await chat.answer({ id, choice: 'title:3', via: 'telegram' }); assert.deepEqual([r.ok, r.pending], [true, 'comment']); assert.equal(chat.pending('smm'), 1, 'карточка не закрыта до получения названия');
  assert.equal(JSON.parse(db.prepare("SELECT v FROM kv WHERE k='awaiting'").get().v).kind, 'title');
  chat.incoming({ text: 'я'.repeat(101), source: 'telegram' });
  assert.match(db.prepare("SELECT text FROM messages WHERE sender='captain_smm' ORDER BY id DESC LIMIT 1").get().text, /длиннее 100 знаков \(101\)/); assert.equal(JSON.parse(db.prepare("SELECT v FROM kv WHERE k='awaiting'").get().v).kind, 'title', 'ждёт новое название');
  chat.incoming({ text: 'Десять тысяч шагов: откуда цифра?', source: 'telegram' });
  assert.equal(chat.pending('smm'), 0); assert.equal(db.prepare("SELECT v FROM kv WHERE k='awaiting'").get(), undefined, 'ожидание сброшено');
  const row = db.prepare('SELECT status,choice FROM messages WHERE id=?').get(id); assert.deepEqual([row.status, row.choice], ['answered', 'title:3']);
  assert.ok(db.prepare("SELECT text FROM messages WHERE sender='captain_smm' AND text LIKE 'Принято, ставлю ваше название%'").get(), 'Капитан подтвердил название');
});


test('«темы» в чате Капитана: поиск тем стартует сразу с пожеланием, старый список закрывается; повторная просьба при идущем поиске не запускает второй', async () => {
  const { chat, db } = make(); const a = topics(chat);
  const r = chat.incoming({ text: 'темы про сон и стресс', source: 'telegram' });
  assert.equal(r.note, 'topics'); await new Promise((res) => setTimeout(res, 150));
  const out = db.prepare("SELECT sender, text FROM messages WHERE sender='captain_smm' AND kind='text' ORDER BY id").all().map((m) => m.text).join('\n');
  assert.match(out, /Принято, ищу темы для видео с вашим пожеланием: «темы про сон и стресс»/); assert.match(out, /(этап «topics --hint темы про сон и стресс»|topics --hint)/);
  assert.equal(db.prepare('SELECT status, choice FROM messages WHERE id=?').get(a).choice, 'superseded', 'старая карточка выбора темы закрыта');
  assert.deepEqual(db.prepare('SELECT stage FROM videos ORDER BY id').all().map((x) => x.stage), ['rejected', 'rejected'], 'предложенные раньше темы сняты, как при «Другие темы»');
});
test('«тема» без пожеланий: просто поиск; «тема 4» и «выбираем тему» по-прежнему выбор, а не поиск; в чате другого сотрудника просьба не перехватывается', async () => {
  const { chat, db } = make(); topics(chat);
  assert.equal(chat.incoming({ text: 'Тема', source: 'telegram' }).note, 'topics');
  await new Promise((res) => setTimeout(res, 100));
  assert.match(db.prepare("SELECT text FROM messages WHERE sender='captain_smm' AND kind='text' ORDER BY id DESC").all().map((m) => m.text).join('\n'), /Принято, ищу темы для видео\. Виктор соберёт/);
  const m2 = make(); topics(m2.chat);
  assert.equal(m2.chat.incoming({ text: 'тема 5', source: 'telegram' }).note, 'pick');
  assert.notEqual(m2.chat.incoming({ text: 'темы', source: 'dashboard', thread: 'scriptwriter' }).note, 'topics', 'в ветке Ксении это разговор с Ксенией');
});

test('«Внести правки» варианта C: правки идут Роману (имя в ответе, статус video_c), лампочка Кирилла не загорается; у обычного ролика Кирилл как раньше', async () => {
  const { chat, db } = make(); db.exec(`ALTER TABLE videos ADD COLUMN notes TEXT; INSERT INTO agents VALUES ('video','Кирилл Кадров','Video Editor','smm','idle','',0,0),('video_c','Роман Ракурсов','Video Editor C','smm','idle','',0,0);`);
  db.prepare("UPDATE videos SET stage='produced', notes=? WHERE id=3").run(JSON.stringify({ variant: { group: 1, letter: 'C', format: 'C' } })); db.prepare("UPDATE videos SET stage='produced' WHERE id=5").run();
  const idC = videoCard(chat, 3); await chat.answer({ id: idC, choice: 'rework:3', comment: 'переделай страницу', via: 'dashboard' });
  const sayC = db.prepare("SELECT text FROM messages WHERE sender='captain_smm' AND text LIKE 'Правки приняты%' ORDER BY id DESC").get().text;
  assert.match(sayC, /^Правки приняты, Роман начинает сразу/, sayC.slice(0, 80)); assert.doesNotMatch(sayC, /Кирилл/);
  assert.equal(db.prepare("SELECT status FROM agents WHERE id='video'").get().status, 'idle', 'Кирилл не при делах: чужой формат');
  const idA = videoCard(chat, 5); await chat.answer({ id: idA, choice: 'rework:5', comment: 'заголовок крупнее', via: 'dashboard' });
  const sayA = db.prepare("SELECT text FROM messages WHERE sender='captain_smm' AND text LIKE 'Правки приняты%' ORDER BY id DESC").get().text;
  assert.match(sayA, /^Правки приняты, Кирилл начинает сразу/); assert.equal(db.prepare("SELECT status FROM agents WHERE id='video'").get().status, 'working');
});

/* ---------- правка пришла, пока этап «script» ещё идёт (25.10, №100: правка потерялась, вариант A не смонтировался) ---------- */
const reviseCard = (chat, id) => chat.post({ thread: 'captain_smm', sender: 'captain_smm', kind: 'action', text: 'Сценарий', buttons: [[['Утвердить сценарий', `approve:${id}`], ['Нужны правки', `revise:${id}`]]] });
const waitUntil = async (fn, ms = 7000) => { for (let t = 0; t < ms; t += 100) { if (fn()) return true; await tick(100); } return false; };
const pendingPath = (dir, id) => path.join(dir, 'smm', 'runs', `video_${id}`, 'PENDING_REVISE.txt');
const capText = (db) => msgs(db).filter((m) => m.sender === 'captain_smm').map((m) => m.text).join('\n');
function addGroup(db) {      // тема 100: A уже есть, B готов (в боевом офисе их пишет цепочка после «Вера пропустила»)
  db.exec('ALTER TABLE videos ADD COLUMN notes TEXT');
  const note = (l) => JSON.stringify({ variant: { group: 100, letter: l, format: l } });
  db.prepare("INSERT INTO videos (id,title,stage,updated_at,notes) VALUES (100,'Голодание','script',0,?),(101,'Голодание','checked',0,?)").run(note('A'), note('B'));
}

test('правка к варианту A во время работы цепочки не теряется: запоминается, стадия A не сбивается, применяется после этапа', withPipeline(async ({ chat, db, dir, spawned }) => {
  addGroup(db);
  await chat.answer({ id: reviseCard(chat, 100), choice: 'approve:100', via: 'dashboard' });                 // запускает этап «script 100» (в офисе это цепочка сценарий -> варианты)
  assert.ok(await waitUntil(() => spawned().length === 1), 'этап запущен'); assert.deepEqual(spawned(), ['script 100 --finish']);
  db.prepare("UPDATE videos SET stage='checked' WHERE id=100").run();                                          // Вера пропустила A, цепочка ещё идёт
  await chat.answer({ id: reviseCard(chat, 100), choice: 'revise:100', comment: 'убери строчку про надёжность', via: 'telegram' });
  assert.equal(spawned().length, 1, 'второй запуск, который отклонился бы как дубль, не делается');
  assert.equal(stageOf(db, 100), 'checked', 'A не переведён в «script» без исполнителя (так он выпал из карточки вариантов)');
  assert.equal(fs.readFileSync(pendingPath(dir, 100), 'utf8'), 'убери строчку про надёжность');
  assert.match(capText(db), /запомнила/); assert.ok(!/Этап «script/.test(capText(db)), 'ответа «второй раз не запускаю» нет');
  assert.ok(await waitUntil(() => spawned().length === 2), 'после конца этапа правка пошла Ксении');
  assert.equal(spawned()[1], 'script 100 --comment убери строчку про надёжность');
  assert.equal(stageOf(db, 100), 'script'); assert.ok(!fs.existsSync(pendingPath(dir, 100)), 'очередь очищена');
  assert.match(capText(db), /Беру вашу правку/);
}));

test('две правки подряд во время работы этапа склеиваются в одну; запуск один', withPipeline(async ({ chat, db, dir, spawned }) => {
  addGroup(db);
  await chat.answer({ id: reviseCard(chat, 100), choice: 'approve:100', via: 'dashboard' }); assert.ok(await waitUntil(() => spawned().length === 1));
  db.prepare("UPDATE videos SET stage='checked' WHERE id=100").run();
  await chat.answer({ id: reviseCard(chat, 100), choice: 'revise:100', comment: 'первое', via: 'telegram' });
  await chat.answer({ id: reviseCard(chat, 100), choice: 'revise:100', comment: 'второе', via: 'telegram' });
  assert.equal(fs.readFileSync(pendingPath(dir, 100), 'utf8'), 'первое\nвторое');
  assert.ok(await waitUntil(() => spawned().some((l) => l.startsWith('script 100 --comment')))); await tick(700);
  const runs = spawned().filter((l) => l.startsWith('script 100')); assert.equal(runs.length, 2, 'после первого этапа ровно один новый запуск (обе правки в одном комментарии)'); assert.deepEqual(spawned().slice(1), ['script 100 --comment первое', 'второе'], 'комментарий многострочный, журнал заглушки разбивает его по строкам');
}));

test('одиночный ролик (без вариантов): правка во время работы этапа тоже ждёт его конца', withPipeline(async ({ chat, db, dir, spawned }) => {
  db.prepare("INSERT INTO videos VALUES (4,'Шаги','script',0)").run();
  await chat.answer({ id: reviseCard(chat, 4), choice: 'approve:4', via: 'dashboard' }); assert.ok(await waitUntil(() => spawned().length === 1));
  db.prepare("UPDATE videos SET stage='checked' WHERE id=4").run();
  await chat.answer({ id: reviseCard(chat, 4), choice: 'revise:4', comment: 'короче', via: 'telegram' });
  assert.equal(spawned().length, 1); assert.equal(fs.readFileSync(pendingPath(dir, 4), 'utf8'), 'короче'); assert.equal(stageOf(db, 4), 'checked');
  assert.ok(await waitUntil(() => spawned().length === 2)); assert.equal(spawned()[1], 'script 4 --comment короче');
}));

test('если за время работы этапа ролик ушёл дальше (утверждён и в монтаже), отложенная правка не применяется и Ник узнаёт об этом', withPipeline(async ({ chat, db, dir, spawned }) => {
  addGroup(db);
  await chat.answer({ id: reviseCard(chat, 100), choice: 'approve:100', via: 'dashboard' }); assert.ok(await waitUntil(() => spawned().length === 1));
  db.prepare("UPDATE videos SET stage='checked' WHERE id=100").run();
  await chat.answer({ id: reviseCard(chat, 100), choice: 'revise:100', comment: 'убери строчку', via: 'telegram' });
  db.prepare("UPDATE videos SET stage='editing' WHERE id=100").run();
  assert.ok(await waitUntil(() => /применить не вышло/.test(capText(db))), 'сообщение о неприменённой правке');
  await tick(500); assert.equal(spawned().length, 1, 'Ксения не запускалась'); assert.equal(stageOf(db, 100), 'editing'); assert.ok(!fs.existsSync(pendingPath(dir, 100)));
}));

test('«Утвердить» после запомненной правки отменяет её (иначе после монтажа придёт непонятное сообщение)', withPipeline(async ({ chat, db, dir, spawned }) => {
  addGroup(db);
  await chat.answer({ id: reviseCard(chat, 100), choice: 'approve:100', via: 'dashboard' });
  db.prepare("UPDATE videos SET stage='checked' WHERE id=100").run();
  await chat.answer({ id: reviseCard(chat, 100), choice: 'revise:100', comment: 'убери строчку', via: 'telegram' });
  assert.ok(fs.existsSync(pendingPath(dir, 100)));
  await chat.answer({ id: reviseCard(chat, 100), choice: 'approve:100', via: 'dashboard' });
  assert.ok(!fs.existsSync(pendingPath(dir, 100)), 'очередь очищена утверждением');
}));

// Переключатель форматов из чата (решение Ника 2026-10-26): настройка пишется в settings.json рядом с данными, ответ Капитана сразу, модель не вызывается
const sendCap = (chat, text, src = 'dashboard') => chat.incoming({ text, source: src, thread: 'captain_smm' });
const lastCap = (db) => db.prepare("SELECT text FROM messages WHERE sender='captain_smm' ORDER BY id DESC LIMIT 1").get().text;
const settingsOf = (dir) => { try { return JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8')); } catch { return null; } };
test('«только формат А» пишет настройку и отвечает сразу; повтор говорит «уже так и стоит»', () => {
  delete process.env.VARIANT_FORMATS;
  const { chat, db, dir } = make(); const r = sendCap(chat, 'выставь VARIANT_FORMATS=A, пока нужны видео только по данному формату');
  assert.equal(r.note, 'formats'); assert.equal(settingsOf(dir).variantFormats, 'A');
  assert.match(lastCap(db), /только формат A «Лента».*B и C не создаются/s); assert.match(lastCap(db), /перезапуск не нужен/); assert.match(lastCap(db), /включи B и C/);
  sendCap(chat, 'Пока сделай так, чтобы монтировался только формат А'); assert.match(lastCap(db), /Уже так и стоит: A «Лента»/); assert.equal(settingsOf(dir).variantFormats, 'A');
});
test('«включи B и C» возвращает все три и предупреждает о цене; «B и C не нужны» выключает снова; другие поля файла сохраняются', () => {
  delete process.env.VARIANT_FORMATS;
  const { chat, db, dir } = make(); fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ variantFormats: 'A', other: 7 }));
  sendCap(chat, 'включи B и C'); assert.equal(settingsOf(dir).variantFormats, 'A,B,C'); assert.equal(settingsOf(dir).other, 7);
  assert.match(lastCap(db), /A «Лента», B «Один объект», C «Комикс»/); assert.match(lastCap(db), /3 ролика на тему/); assert.match(lastCap(db), /у сценариев, которые уже готовы, B и C не появятся/);
  sendCap(chat, 'варианты B и C пока не нужны'); assert.equal(settingsOf(dir).variantFormats, 'A'); assert.equal(settingsOf(dir).other, 7);
  sendCap(chat, 'включи формат B'); assert.equal(settingsOf(dir).variantFormats, 'A,B'); sendCap(chat, 'убери форматы B и C'); assert.equal(settingsOf(dir).variantFormats, 'A');
});
test('вопрос «какие форматы включены?» ничего не меняет и отвечает состоянием', () => {
  delete process.env.VARIANT_FORMATS;
  const { chat, db, dir } = make(); sendCap(chat, 'какие форматы сейчас включены?'); assert.equal(settingsOf(dir), null, 'файл не создан'); assert.match(lastCap(db), /монтируется: A «Лента», B «Один объект», C «Комикс»/);
  sendCap(chat, 'только формат A'); sendCap(chat, 'какие варианты сейчас монтируются'); assert.match(lastCap(db), /монтируется: A «Лента» \(варианты B и C выключены\)/);
});
test('переменная окружения VARIANT_FORMATS сильнее файла: Капитан честно говорит об этом', () => {
  process.env.VARIANT_FORMATS = 'A,B,C';
  try { const { chat, db, dir } = make(); sendCap(chat, 'только формат A'); assert.match(lastCap(db), /VARIANT_FORMATS=A,B,C: она сильнее настройки/); assert.equal(settingsOf(dir).variantFormats, 'A'); }
  finally { delete process.env.VARIANT_FORMATS; }
});
test('неоднозначное не трогает настройку: «убери вариант C», вопросы, чужие чаты сотрудников; из Telegram работает так же', () => {
  delete process.env.VARIANT_FORMATS;
  const { chat, db, dir } = make();
  for (const x of ['убери вариант C', 'почему не включены B и C?', 'давай варианты названий']) { const r = sendCap(chat, x); assert.notEqual(r.note, 'formats', x); }
  chat.incoming({ text: 'только формат A', source: 'dashboard', thread: 'scriptwriter' }); assert.equal(settingsOf(dir), null, 'в чате Ксении это не настройка');
  sendCap(chat, 'только формат A'); assert.equal(settingsOf(dir).variantFormats, 'A');
  const r = chat.incoming({ text: 'Включи B и C', source: 'telegram' }); assert.equal(r.note, 'formats'); assert.equal(settingsOf(dir).variantFormats, 'A,B,C');
  const tgMsg = db.prepare("SELECT text FROM messages WHERE sender='captain_smm' ORDER BY id DESC LIMIT 1").get().text; assert.match(tgMsg, /Принято/);
});

test('этап конвейера получает путь к той же настройке форматов, что читает сервер (каталог данных сервера)', async () => {
  const keep = process.env.OFFICE_SETTINGS_FILE; delete process.env.OFFICE_SETTINGS_FILE;
  const m = make(); const log = path.join(m.dir, 'env.txt');
  fs.mkdirSync(path.join(m.dir, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(m.dir, 'scripts', 'smm_pipeline.mjs'), `import fs from 'node:fs'; fs.appendFileSync(${JSON.stringify(log)}, String(process.env.OFFICE_SETTINGS_FILE) + '\\n'); setTimeout(() => {}, 1000);`);
  process.env.HERMES_BIN = 'fake';
  try { sendCap(m.chat, 'подбери темы про сон'); await tick(900); assert.ok(fs.existsSync(log), 'этап запущен'); assert.equal(path.resolve(fs.readFileSync(log, 'utf8').trim()), path.resolve(path.join(m.dir, 'settings.json'))); }
  finally { delete process.env.HERMES_BIN; if (keep !== undefined) process.env.OFFICE_SETTINGS_FILE = keep; }
});

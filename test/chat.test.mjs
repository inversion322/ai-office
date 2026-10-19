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
  const { chat, db } = make(); const a = topics(chat), b = topics(chat);
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
  const { chat, db } = make(); const a = videoCard(chat), b = videoCard(chat);
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

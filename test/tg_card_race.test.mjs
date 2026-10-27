// Гонка «карточку закрыли раньше, чем Telegram вернул её номер»: кнопки должны сниматься в любом порядке (карточка №641 осталась с живой «Утвердить» после автоутверждения).
// Telegram подменён: globalThis.fetch записывает вызовы; настоящий бот и боевая БД не участвуют.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

delete process.env.OFFICE_NO_TG; process.env.OFFICE_NO_WATCH = '1'; process.env.OFFICE_CHAT_STUB = '1';
const { setupChat } = await import('../server/lib_chat.mjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function make({ sendDelay }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tgrace-'));
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ smmBotToken: 'test-token', smmBotChatId: 4242 }));
  const db = new DatabaseSync(path.join(dir, 't.db'));
  db.exec(`CREATE TABLE agents (id TEXT PRIMARY KEY, name TEXT, role TEXT, office TEXT, status TEXT, task TEXT, progress INT, updated_at INT);
    CREATE TABLE videos (id INTEGER PRIMARY KEY, title TEXT, stage TEXT, updated_at INT);
    CREATE TABLE kv (k TEXT PRIMARY KEY, v TEXT); CREATE TABLE prompts (agent_id TEXT, body TEXT);
    CREATE TABLE events (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INT, agent_id TEXT, level TEXT, message TEXT);
    INSERT INTO agents VALUES ('captain_smm','Капитан Кряк','Chief of Staff','smm','idle','',0,0);
    INSERT INTO videos VALUES (3,'Витамин C','scored',0);`);
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const method = String(url).split('/').pop(), body = init.body ? JSON.parse(init.body) : {};
    calls.push({ method, body });
    if (method === 'sendMessage') { await sleep(sendDelay); return { json: async () => ({ ok: true, result: { message_id: 777 } }) }; }
    return { json: async () => ({ ok: true, result: true }) };
  };
  return { db, chat: setupChat({ db, ROOT: dir, DATA_DIR: dir }), calls, dir };
}
const card = (chat) => chat.post({ thread: 'captain_smm', sender: 'captain_smm', kind: 'action', text: 'Сценарий', buttons: [[['Тема 1', 'pick:3']]], mirrorTg: true });
const clears = (calls) => calls.filter((c) => c.method === 'editMessageReplyMarkup' && c.body.message_id === 777 && c.body.reply_markup.inline_keyboard.length === 0);

test('ответили ДО того, как Telegram вернул номер сообщения: кнопки всё равно снимаются (гонка автоутверждения)', async () => {
  const { chat, calls, db } = make({ sendDelay: 80 });
  const id = card(chat);
  const r = await chat.answer({ id, choice: 'pick:3', via: 'auto', echo: false }); assert.equal(r.ok, true);
  assert.equal(clears(calls).length, 0, 'в момент ответа номера ещё нет: снимать нечего');
  await sleep(300);
  assert.equal(clears(calls).length, 1, 'после получения номера кнопки сняты ровно один раз: ' + JSON.stringify(calls.map((c) => c.method)));
  assert.equal(db.prepare('SELECT tg_msg FROM messages WHERE id=?').get(id).tg_msg, 777);
});
test('обычный порядок (ответ после отправки): кнопки снимаются ответом, повторного снятия нет', async () => {
  const { chat, calls } = make({ sendDelay: 10 });
  const id = card(chat); await sleep(200);
  assert.equal(clears(calls).length, 0, 'пока карточка открыта, кнопки на месте');
  await chat.answer({ id, choice: 'pick:3', via: 'dashboard' }); await sleep(150);
  assert.equal(clears(calls).length, 1);
});
test('открытая карточка и обычный текст без кнопок клавиатуру не трогают', async () => {
  const { chat, calls } = make({ sendDelay: 10 });
  card(chat); chat.post({ thread: 'captain_smm', sender: 'captain_smm', text: 'Просто сообщение', mirrorTg: true }); await sleep(300);
  assert.equal(calls.filter((c) => c.method === 'editMessageReplyMarkup').length, 0);
});

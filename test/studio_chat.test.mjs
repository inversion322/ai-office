// Студия в чате Ника: «план дня», кнопки плана и превью поста, ожидание правки, автоплан. БД временная, конвейер не запускается (STUB пишет в чат, что этап не стартовал).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.OFFICE_NO_TG = '1'; process.env.OFFICE_NO_WATCH = '1'; process.env.OFFICE_CHAT_STUB = '1';
const SD = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-chat-'));
process.env.OFFICE_STUDIO_DIR = path.join(SD, 'studio'); process.env.OFFICE_STUDIO_SETTINGS_FILE = path.join(SD, 'studio.json');
const { setupChat } = await import('../server/lib_chat.mjs');
const S = await import('../scripts/studio.mjs');

function make() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-studio-'));
  const db = new DatabaseSync(path.join(dir, 't.db'));
  db.exec(`CREATE TABLE agents (id TEXT PRIMARY KEY, name TEXT, role TEXT, office TEXT, status TEXT, task TEXT, progress INT, updated_at INT);
    CREATE TABLE videos (id INTEGER PRIMARY KEY, title TEXT, stage TEXT, updated_at INT);
    CREATE TABLE kv (k TEXT PRIMARY KEY, v TEXT); CREATE TABLE prompts (agent_id TEXT, body TEXT);
    CREATE TABLE events (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INT, agent_id TEXT, level TEXT, message TEXT);
    INSERT INTO agents VALUES ('captain_smm','Капитан Кряк','Chief','smm','idle','',0,0),('studio_chief','Мария Планова','Content Chief','smm','idle','',0,0);`);
  return { db, chat: setupChat({ db, ROOT: dir, DATA_DIR: dir }) };
}
const texts = (db) => db.prepare("SELECT text FROM messages WHERE sender<>'nick' ORDER BY id").all().map((r) => r.text);
const notStarted = (db) => texts(db).filter((t) => /не запущен/.test(t)).map((t) => /«([^»]+)»/.exec(t)[1]);
const card = (chat, buttons) => chat.post({ thread: 'captain_smm', sender: 'captain_smm', kind: 'action', text: 'карточка', buttons });
const DATE = '2026-12-20';

test('«план дня» в чате: этап поиска уходит сразу, дата — завтра днём и сегодня утром, пожелание передаётся', async () => {
  const { chat, db } = make();
  assert.equal(chat.incoming({ text: 'Составь план дня про сон', source: 'telegram' }).note, 'studio-plan');
  await new Promise((r) => setTimeout(r, 30));
  const run = notStarted(db)[0]; assert.match(run, /^studio plan med_detective --date \d{4}-\d{2}-\d{2} --hint сон$/);
  assert.match(texts(db).join('\n'), /Принято, собираю план дня на \d{4}-\d{2}-\d{2} с вашим пожеланием «сон»/);
  assert.equal(db.prepare("SELECT status FROM agents WHERE id='studio_chief'").get().status, 'working');
  assert.equal(chat.incoming({ text: 'план на завтра', source: 'telegram' }).note, 'studio-plan');
});
test('уже утверждённый план не затирается просьбой «план дня»', async () => {
  const { chat, db } = make(); const day = S.mskDate(Date.now() + 86400e3);
  S.savePlan({ date: day, channel: 'med_detective', status: 'approved', slots: [] });
  chat.incoming({ text: 'план на завтра', source: 'telegram' }); await new Promise((r) => setTimeout(r, 30));
  assert.match(texts(db).join('\n'), /уже утверждён и в работе/); assert.equal(notStarted(db).length, 0);
});
test('кнопки плана: «Утвердить» запускает plan-act, «Другие темы» и «Пропустить» тоже; старые карточки плана гасятся', async () => {
  const { chat, db } = make();
  const btn = [[['✅', `splan:med_detective:${DATE}:ok`]], [['🔄', `splan:med_detective:${DATE}:more`], ['✖', `splan:med_detective:${DATE}:skip`]]];
  const a = card(chat, btn), b = card(chat, btn);
  assert.equal(chat.pending('smm') >= 1, true);
  const r = await chat.answer({ id: b, choice: `splan:med_detective:${DATE}:ok`, via: 'telegram' }); assert.equal(r.ok, true);
  assert.deepEqual(notStarted(db), [`studio plan-act med_detective ${DATE} ok`]);
  assert.equal(db.prepare('SELECT choice FROM messages WHERE id=?').get(a).choice, 'superseded', 'прежняя карточка плана с теми же кнопками закрыта');
  assert.equal(chat.pending('smm'), 0, 'дубль карточки плана закрыт');
  const c = card(chat, [[['🔄', `splan:med_detective:${DATE}:more`], ['✖', `splan:med_detective:${DATE}:skip`]]]);
  await chat.answer({ id: c, choice: `splan:med_detective:${DATE}:skip`, via: 'dashboard' });
  assert.deepEqual(notStarted(db).at(-1), `studio plan-act med_detective ${DATE} skip`);
});
test('превью поста: «Поставить» и «Убрать» запускают post-act; «Править» без текста ждёт сообщение, затем уходит с правкой', async () => {
  const { chat, db } = make();
  const B = (slot) => [[['✅', `spost:med_detective:${DATE}:${slot}:ok`], ['✏️', `spost:med_detective:${DATE}:${slot}:edit`]], [['🗑', `spost:med_detective:${DATE}:${slot}:drop`]]];
  const c1 = card(chat, B('post1')); await chat.answer({ id: c1, choice: `spost:med_detective:${DATE}:post1:ok`, via: 'telegram' });
  assert.deepEqual(notStarted(db).at(-1), `studio post-act med_detective ${DATE} post1 ok`);
  const c2 = card(chat, B('post2')); const r = await chat.answer({ id: c2, choice: `spost:med_detective:${DATE}:post2:edit`, via: 'telegram' });
  assert.deepEqual([r.ok, r.pending], [true, 'comment']); assert.equal(db.prepare('SELECT status FROM messages WHERE id=?').get(c2).status, 'open', 'карточка ждёт текст правки');
  assert.match(texts(db).at(-1), /Напишите одним сообщением, что исправить в посте/);
  const inc = chat.incoming({ text: 'короче и без эмодзи', source: 'telegram' }); assert.equal(inc.note, 'comment');
  await new Promise((r2) => setTimeout(r2, 30));
  assert.equal(db.prepare('SELECT status FROM messages WHERE id=?').get(c2).status, 'answered');
  assert.deepEqual(notStarted(db).at(-1), `studio post-act med_detective ${DATE} post2 edit --comment короче и без эмодзи`);
  const c3 = card(chat, B('post1')); await chat.answer({ id: c3, choice: `spost:med_detective:${DATE}:post1:edit`, comment: 'сделай хук короче', via: 'dashboard' });
  assert.deepEqual(notStarted(db).at(-1), `studio post-act med_detective ${DATE} post1 edit --comment сделай хук короче`);
});
test('битые и чужие данные кнопок не запускают этапов', async () => {
  const { chat, db } = make();
  const id = card(chat, [[['x', 'splan:med_detective:вчера:ok'], ['y', `spost:med_detective:${DATE}:post9:ok`], ['z', `splan:med_detective:${DATE}:hack`]]]);
  await chat.answer({ id, choice: 'splan:med_detective:вчера:ok', via: 'dashboard' }); const id2 = card(chat, [[['y', `spost:med_detective:${DATE}:post9:ok`]]]); await chat.answer({ id: id2, choice: `spost:med_detective:${DATE}:post9:ok`, via: 'dashboard' });
  const id3 = card(chat, [[['z', `splan:med_detective:${DATE}:hack`]]]); await chat.answer({ id: id3, choice: `splan:med_detective:${DATE}:hack`, via: 'dashboard' });
  assert.equal(notStarted(db).length, 0);
});
test('автоплан включается и выключается словом Ника и пишется в настройки студии', () => {
  const { chat, db } = make();
  assert.equal(S.studioSettings().autoPlan, false);
  assert.equal(chat.incoming({ text: 'включи автоплан', source: 'telegram' }).note, 'studio-auto'); assert.equal(S.studioSettings().autoPlan, true); assert.match(texts(db).at(-1), /собирается сам каждый день в 20:00 МСК/);
  assert.equal(chat.incoming({ text: 'выключи автоплан', source: 'telegram' }).note, 'studio-auto'); assert.equal(S.studioSettings().autoPlan, false); assert.match(texts(db).at(-1), /выключен/);
});

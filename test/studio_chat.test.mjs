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
test('превью поста: «Править картинку» ждёт текст и запускает этап cover с правкой, «Другая картинка» запускает его сразу; текст поста не трогается', async () => {
  const { chat, db } = make();
  const B = (slot) => [[['✅', `spost:med_detective:${DATE}:${slot}:ok`]], [['✏️', `spost:med_detective:${DATE}:${slot}:edit`], ['🎨', `spost:med_detective:${DATE}:${slot}:pic`]], [['🖼', `spost:med_detective:${DATE}:${slot}:pic0`], ['🗑', `spost:med_detective:${DATE}:${slot}:drop`]]];
  const c1 = card(chat, B('post1')); const r = await chat.answer({ id: c1, choice: `spost:med_detective:${DATE}:post1:pic`, via: 'telegram' });
  assert.deepEqual([r.ok, r.pending], [true, 'comment']); assert.equal(db.prepare('SELECT status FROM messages WHERE id=?').get(c1).status, 'open', 'карточка ждёт текст правки картинки');
  assert.match(texts(db).at(-1), /что изменить в картинке[\s\S]*Текст поста останется прежним/);
  assert.equal(chat.incoming({ text: 'убери банку, пусть будет лупа над чашкой кофе', source: 'telegram' }).note, 'comment'); await new Promise((r2) => setTimeout(r2, 30));
  assert.equal(db.prepare('SELECT status FROM messages WHERE id=?').get(c1).status, 'answered');
  assert.deepEqual(notStarted(db).at(-1), `studio post-act med_detective ${DATE} post1 pic --comment убери банку, пусть будет лупа над чашкой кофе`);
  const c2 = card(chat, B('post2')); await chat.answer({ id: c2, choice: `spost:med_detective:${DATE}:post2:pic0`, via: 'dashboard' });
  assert.deepEqual(notStarted(db).at(-1), `studio post-act med_detective ${DATE} post2 pic0`); assert.equal(db.prepare('SELECT status FROM messages WHERE id=?').get(c2).status, 'answered');
  const c3 = card(chat, B('post1')); await chat.answer({ id: c3, choice: `spost:med_detective:${DATE}:post1:pic`, comment: 'сделай светлее', via: 'dashboard' });
  assert.deepEqual(notStarted(db).at(-1), `studio post-act med_detective ${DATE} post1 pic --comment сделай светлее`);
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

/* ---- единый план: выбор на карточке ---- */
const mkOpt = (title, reach) => ({ title, demand: { reach, index: reach / 25 }, evidence: [{ url: 'https://a.org/' + encodeURIComponent(title) }], clear_answer: true, rubric: 'myth' });
const VT = ['Гомеопатия работает лучше плацебо?', 'Эффект Моцарта делает детей умнее?', 'Давление можно почувствовать по самочувствию?', 'Хруст пальцев вызывает артрит?'], PT = ['Быстрая ходьба продлевает жизнь?', 'Мобильный телефон вызывает рак мозга?', 'Восемь стаканов воды в день обязательны?', 'Чтение в темноте портит зрение навсегда?', 'Сахар делает детей гиперактивными?'];
function planCard(chat, date, { complete = true } = {}) {
  const plan = S.newDayPlan({ date, channel: 'med_detective', options: S.makeOptions({ video: VT.map((x, i) => mkOpt(x, 20 - i)), posts: PT.map((x, i) => ({ ...mkOpt(x, 10 - i), freshness: 2 })) }), slots: S.DEFAULT_SLOTS, now: Date.now() });
  if (!complete) { plan.selection.posts = [0]; S.syncSlots(plan); }
  const id = chat.post({ thread: 'captain_smm', sender: 'captain_smm', kind: 'action', text: S.planCardTextV2(plan, 'Медицинский детектив'), buttons: S.planButtonsV2(plan) }); plan.card_id = id; S.savePlan(plan); return { id, plan };
}
const status = (db, id) => db.prepare('SELECT status FROM messages WHERE id=?').get(id).status;

test('выбор кнопкой в плане: карточка остаётся открытой, пайплайн получает выбор; в Telegram кнопки не снимаются (kept)', async () => {
  const { chat, db } = make(); const { id } = planCard(chat, '2026-12-30');
  for (const [tok, cmd] of [['v2', 'v2'], ['p3', 'p3'], ['morep', 'morep'], ['morev', 'morev']]) {
    const r = await chat.answer({ id, choice: `splan:med_detective:2026-12-30:${tok}`, via: 'telegram' });
    assert.deepEqual([r.ok, r.kept], [true, true], tok); assert.equal(status(db, id), 'open', 'карточка не закрыта после ' + tok);
    assert.equal(notStarted(db).at(-1), `studio plan-act med_detective 2026-12-30 ${cmd}`);
  }
  assert.equal(chat.pending('smm'), 1);
});
test('«Утвердить»: при полном выборе карточка закрывается и работа стартует; при неполном карточка остаётся и пайплайн напоминает, чего не хватает', async () => {
  const { chat, db } = make(); const full = planCard(chat, '2026-12-31');
  const r = await chat.answer({ id: full.id, choice: 'splan:med_detective:2026-12-31:ok', via: 'dashboard' }); assert.equal(r.kept, undefined); assert.equal(status(db, full.id), 'answered'); assert.equal(notStarted(db).at(-1), 'studio plan-act med_detective 2026-12-31 ok');
  const part = planCard(chat, '2027-01-01', { complete: false });
  const r2 = await chat.answer({ id: part.id, choice: 'splan:med_detective:2027-01-01:ok', via: 'dashboard' }); assert.deepEqual([r2.ok, r2.kept], [true, true]); assert.equal(status(db, part.id), 'open');
  assert.equal(notStarted(db).at(-1), 'studio plan-act med_detective 2027-01-01 ok');
});
test('выбор текстом или голосом: «видео 2, посты 1 и 4», «другое видео», «другие посты» работают при открытой карточке плана и молчат без неё', async () => {
  const { chat, db } = make();
  assert.notEqual(chat.incoming({ text: 'видео 2, посты 1 и 4', source: 'telegram' }).note, 'studio-select', 'карточки плана нет: это обычное сообщение');
  const { id } = planCard(chat, '2027-01-02');
  assert.equal(chat.incoming({ text: 'Возьми видео второе, а посты первый и четвёртый', source: 'telegram' }).note, 'studio-select'); await new Promise((r) => setTimeout(r, 30));
  assert.equal(notStarted(db).at(-1), 'studio plan-act med_detective 2027-01-02 sel --comment {"video":2,"posts":[1,4]}');
  chat.incoming({ text: 'другое видео', source: 'telegram' }); await new Promise((r) => setTimeout(r, 30)); assert.equal(notStarted(db).at(-1), 'studio plan-act med_detective 2027-01-02 morev');
  chat.incoming({ text: 'давай другие посты', source: 'telegram' }); await new Promise((r) => setTimeout(r, 30)); assert.equal(notStarted(db).at(-1), 'studio plan-act med_detective 2027-01-02 morep');
  assert.equal(status(db, id), 'open', 'ни одна из фраз не закрыла карточку');
});
test('«да» / «утверждаю» утверждает единственную открытую карточку плана', async () => {
  const { chat, db } = make(); const { id } = planCard(chat, '2027-01-03');
  assert.equal(chat.incoming({ text: 'утверждаю', source: 'telegram' }).note, 'approve'); await new Promise((r) => setTimeout(r, 60));
  assert.equal(status(db, id), 'answered'); assert.equal(notStarted(db).at(-1), 'studio plan-act med_detective 2027-01-03 ok');
});
test('правка карточки на месте: текст и кнопки меняются, закрытую карточку править нельзя', async () => {
  const { chat, db } = make(); const { id } = planCard(chat, '2027-01-04');
  assert.deepEqual(await chat.editCard(id, 'новый текст', [[['A', 'x:1']]]), { ok: true });
  const row = db.prepare('SELECT text, buttons FROM messages WHERE id=?').get(id); assert.equal(row.text, 'новый текст'); assert.deepEqual(JSON.parse(row.buttons).flat().map((b) => b.d), ['x:1', 'dismiss:0']);
  db.prepare("UPDATE messages SET status='answered' WHERE id=?").run(id); assert.equal((await chat.editCard(id, 'ещё', null)).ok, false); assert.equal((await chat.editCard(99999, 'x', null)).ok, false);
});

/* ---- HTTP календаря студии ---- */
async function call(chat, method, pathq, bodyObj) {
  let out = null; const url = new URL('http://x' + pathq);
  const handled = await chat.handle({ method }, {}, url, async () => bodyObj || {}, (res, code, obj) => { out = { code, obj }; });
  return { handled, ...(out || {}) };
}
test('GET /api/studio/calendar: неделя × каналы, ролик берётся из базы; POST /api/studio/plan проверяет канал и дату и запускает поиск; POST /api/studio/settings включает автоплан', async () => {
  const { chat, db } = make();
  db.prepare("INSERT INTO videos (id,title,stage,updated_at) VALUES (8801,'Тема','editing',0)").run();
  const plan = S.newDayPlan({ date: '2027-04-07', channel: 'med_detective', options: S.makeOptions({ video: [mkOpt('Видео тема про сон и усталость?', 9)], posts: [mkOpt('Пост один про воду и почки?', 8), mkOpt('Пост два про кофе и сердце?', 7)] }), slots: S.DEFAULT_SLOTS, now: Date.now() });
  plan.status = 'approved'; S.slotOf(plan, 'video').videoId = 8801; S.slotOf(plan, 'video').status = 'script'; S.savePlan(plan);
  const r = await call(chat, 'GET', '/api/studio/calendar?start=2027-04-07'); assert.equal(r.handled, true); assert.equal(r.code, 200);
  assert.equal(r.obj.start, '2027-04-05'); assert.equal(r.obj.cells.filter((c) => c.channel === 'med_detective').length, 7);
  const cell = r.obj.cells.find((c) => c.date === '2027-04-07' && c.channel === 'med_detective'); assert.equal(cell.slots.find((s) => s.kind === 'video').label, 'идёт монтаж');
  assert.equal((await call(chat, 'GET', '/api/studio/calendar?start=мусор')).code, 200, 'битая дата = текущая неделя');
  const day = S.mskDate(Date.now() + 5 * 86400e3);
  assert.equal((await call(chat, 'POST', '/api/studio/plan', { channel: 'нет_такого', date: day })).code, 400); assert.equal((await call(chat, 'POST', '/api/studio/plan', { channel: 'med_detective', date: '2020-01-01' })).code, 400);
  assert.equal((await call(chat, 'POST', '/api/studio/plan', { channel: 'med_detective', date: 'завтра' })).code, 400);
  const ok = await call(chat, 'POST', '/api/studio/plan', { channel: 'med_detective', date: day, hint: 'про сон' }); assert.deepEqual(ok.obj, { ok: true }); await new Promise((r2) => setTimeout(r2, 30));
  assert.equal(notStarted(db).at(-1), `studio plan med_detective --date ${day} --hint про сон`);
  const s1 = await call(chat, 'POST', '/api/studio/settings', { autoPlan: true, planAt: '19:30' }); assert.deepEqual(s1.obj, { ok: true, autoPlan: true, planAt: '19:30' }); assert.equal(S.studioSettings().autoPlan, true);
  const s2 = await call(chat, 'POST', '/api/studio/settings', { autoPlan: false, planAt: 'вечером' }); assert.deepEqual(s2.obj, { ok: true, autoPlan: false, planAt: '19:30' }, 'мусор вместо времени не принимается'); S.writeStudioSettings({ planAt: '20:00' });
});

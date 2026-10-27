// Конвейер студии: план дня, утверждение, посты (автор → редактор → обложка → превью), публикация по расписанию. Модели, сеть и время подменены.
import { test as baseTest } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// своя папка студии на каждый тест: занятые темы прежних планов иначе отсеивают кандидатов следующего теста
const test = (name, fn) => baseTest(name, async (t) => { process.env.OFFICE_STUDIO_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-pipe-')); return fn(t); });
process.env.OFFICE_STUDIO_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-pipe-'));
const S = await import('../scripts/studio.mjs');
const X = await import('../scripts/studio_pipeline.mjs');

const NOW = Date.parse('2026-10-28T05:00:00Z');                    // 08:00 МСК
const CH = { med: { key: 'med', name: 'Медицинский детектив', tg: 'med_detective_ru', brief: 'Миф о здоровье по первоисточникам, медицина', lang: 'ru', postFormat: 'short', slots: S.DEFAULT_SLOTS, planAt: '08:00' } };
const EV = [{ source: 'Cochrane', url: 'https://www.cochrane.org/a', finding: 'x' }];
const cand = (title, extra = {}) => ({ title, rubric: 'myth', why_massive: 'почему', evidence: EV, clear_answer: true, queries: [title.split(' ').slice(0, 2).join(' ') + ' ещё'], ...extra });
const GOOD = (t) => `**${t}** 🤔\n\nКрупный обзор сравнил десятки исследований и не нашёл эффекта сильнее пустышки\n\nСамовнушение помогает чувствовать себя лучше, но это не лечение\n\nА вы как думаете, почему это так популярно?\n\n🔬 Источники: [NHMRC](https://www.nhmrc.gov.au/x), [Cochrane](https://www.cochrane.org/y)\n\nБольше разборов: [подписывайтесь](https://t.me/med_detective_ru)`;

function mk({ cands = [], reach = {}, used = [], agentFn, cover = 'ok', sendFail = 0, now = NOW } = {}) {
  const log = { notify: [], agent: [], say: [], spawn: [], script: [], api: [], photos: [], texts: [], runs: [], covers: 0 };
  let nid = 900, sendFailLeft = sendFail;
  const deps = X.makeDeps({
    api: async (p, b) => { log.api.push([p, b]); return { id: 501 }; },
    agent: async (...a) => { log.agent.push(a); }, say: async (...a) => { log.say.push(a); },
    notify: async (t, b) => { log.notify.push({ t, b }); return ++nid; }, promptOf: async (id) => `persona ${id}`,
    runAgent: async (o) => { log.runs.push(o); if (o.label === 'scout' || o.label.startsWith('scout')) fs.writeFileSync(o.outFile, JSON.stringify(cands)); else if (agentFn) await agentFn(o); return { code: 0 }; },
    measureAll: async (list) => list.map((c) => ({ reach: reach[c.title] ?? 0, line: `охват ${reach[c.title] ?? 0}`, level: 'measured' })),
    usedTopics: async () => ({ all: used, counts: {}, feed: { titles: [] } }), spawn: (a) => log.spawn.push(a), spawnScript: (id) => log.script.push(id),
    generateCover: async ({ outFile, prompt }) => { log.covers++; log.lastPrompt = prompt; if (cover === 'ok') { fs.mkdirSync(path.dirname(outFile), { recursive: true }); fs.writeFileSync(outFile, Buffer.alloc(3000, 1)); return { ok: true, file: outFile }; } return { ok: false, error: cover }; },
    sendPhoto: async (chat, file, html) => { if (sendFailLeft-- > 0) throw new Error('Bad Request: chat not found'); log.photos.push({ chat, file, html }); return { message_id: 77 }; },
    sendText: async (chat, html) => { if (sendFailLeft-- > 0) throw new Error('Bad Request: chat not found'); log.texts.push({ chat, html }); return { message_id: 78 }; },
    now: () => now, channels: () => CH,
  });
  return { deps, log };
}
const T = ['Гомеопатия работает лучше плацебо?', 'Эффект Моцарта делает детей умнее?', 'Давление можно почувствовать по самочувствию?', 'Хруст пальцев вызывает артрит?', 'Кофе обезвоживает организм?', 'Полнолуние влияет на психику людей?', 'Лёгкие сигареты менее вредны?', 'Витамин С лечит простуду быстрее?', 'Мобильный телефон вызывает рак мозга?', 'Восемь стаканов воды в день обязательны?', 'Чтение в темноте портит зрение навсегда?', 'Сахар делает детей гиперактивными?'];
const REACH = { [T[2]]: 17, [T[0]]: 10, [T[3]]: 6, [T[1]]: 4, [T[4]]: 3, [T[5]]: 2, [T[6]]: 9, [T[7]]: 1, [T[8]]: 8, [T[9]]: 7, [T[10]]: 5, [T[11]]: 5 };
const run = (ch, date, slot) => `${date}_${ch}_${slot}`;
let dayN = 0; const nextDate = () => `2026-11-${String(10 + ++dayN).padStart(2, '0')}`;     // свой день на каждый тест: файлы плана не пересекаются

test('план дня: три разные темы, самая востребованная на ролик, карточка с тремя кнопками', async () => {
  const date = nextDate(), { deps, log } = mk({ cands: [...T.map((t) => cand(t)), { title: 'Без источников тема про погоду', evidence: [], clear_answer: true }], reach: REACH, used: ['Хруст пальцев и артрит: правда ли'] });
  const r = await X.studioPlan('med', { date, deps });
  assert.equal(r.plan.slots.length, 3);
  assert.equal(S.slotOf(r.plan, 'video').title, T[2], 'самый востребованный (17) на видео');
  assert.deepEqual(r.plan.slots.map((x) => x.slot), ['post1', 'video', 'post2']);
  const titles = r.plan.slots.map((x) => x.title); assert.ok(!titles.includes(T[3]), 'тема, уже занятая в ленте канала, отсеяна'); assert.ok(!titles.some((x) => /погод/.test(x)), 'без первоисточника тема не берётся');
  const card = log.notify.at(-1); assert.match(card.t, /План дня/); assert.equal(card.b.flat().length, 3); assert.match(card.b[0][0][1], new RegExp(`^splan:med:${date}:ok$`));
  assert.ok(log.agent.some((a) => a[0] === 'tg_scout' && a[1] === 'working') && log.agent.some((a) => a[0] === 'studio_chief' && a[1] === 'waiting'));
  const scout = log.runs.find((x) => x.label === 'scout'); assert.equal(scout.profile, 'studio_research'); assert.equal(scout.agentId, 'tg_scout');
  assert.equal(S.loadPlan(date, 'med').status, 'proposed');
});
test('план дня: тем с источниками меньше трёх или все похожи — плана нет, кнопка «Повторить»', async () => {
  const d1 = nextDate(), a = mk({ cands: [cand(T[0]), cand(T[1])], reach: REACH });
  assert.equal((await X.studioPlan('med', { date: d1, deps: a.deps })).plan, null); assert.match(a.log.notify.at(-1).t, /2 из трёх/); assert.match(a.log.notify.at(-1).b[0][0][1], /:more$/); assert.equal(S.loadPlan(d1, 'med'), null);
  const d2 = nextDate(), b = mk({ cands: [cand('Лёгкие сигареты менее вредны для здоровья?'), cand('Правда ли, что лёгкие сигареты менее вредны?'), cand('Лёгкие сигареты менее вредны: миф?')], reach: { 'Лёгкие сигареты менее вредны для здоровья?': 9 } });
  assert.equal((await X.studioPlan('med', { date: d2, deps: b.deps })).plan, null);
});
test('второй план на тот же день: прежний уходит в архив, его темы остаются занятыми; утверждённый план не затирается', async () => {
  const date = nextDate(), a = mk({ cands: T.map((t) => cand(t)), reach: REACH });
  await X.studioPlan('med', { date, deps: a.deps });
  const b = mk({ cands: T.map((t) => cand(t)), reach: REACH, used: [] });
  const r2 = await X.studioPlan('med', { date, deps: b.deps });
  const first = new Set(S.plannedTitles('med', { now: NOW })); assert.ok(first.size >= 3);
  const used = fs.readFileSync(path.join(r2.dir, 'used_topics.txt'), 'utf8'); assert.ok(used.includes(T[2]), 'темы прежнего плана переданы Глебу как занятые');
  await X.studioPlanAct('med', date, 'ok', { deps: b.deps });
  const c = mk({ cands: T.map((t) => cand(t)), reach: REACH }); const r3 = await X.studioPlan('med', { date, deps: c.deps });
  assert.equal(r3.kept, true); assert.equal(S.loadPlan(date, 'med').status, 'approved'); assert.match(c.log.notify.at(-1).t, /уже утверждён/);
});
test('утверждение плана: ролик уходит Ксении (строка в базе, сценарий), посты Дарье; второе «да» ничего не запускает', async () => {
  const date = nextDate(), { deps, log } = mk({ cands: T.map((t) => cand(t)), reach: REACH });
  await X.studioPlan('med', { date, deps });
  const r = await X.studioPlanAct('med', date, 'ok', { deps }); assert.equal(r.ok, true);
  const v = log.api.find(([p]) => p === '/api/video')[1]; assert.equal(v.title, T[2]); assert.equal(v.stage, 'script'); assert.equal(JSON.parse(v.notes).source, 'studio');
  assert.deepEqual(log.script, [501]); assert.deepEqual(log.spawn.at(-1), ['posts', 'med', date]);
  const plan = S.loadPlan(date, 'med'); assert.equal(plan.status, 'approved'); assert.equal(S.slotOf(plan, 'video').videoId, 501); assert.equal(S.slotOf(plan, 'post1').status, 'queued');
  assert.match(log.notify.at(-1).t, /План на .* принят/);
  const n = log.spawn.length; const again = await X.studioPlanAct('med', date, 'ok', { deps }); assert.equal(again.ok, false); assert.equal(log.spawn.length, n); assert.equal(log.script.length, 1);
});
test('«Другие темы» и «Пропустить день»', async () => {
  const d1 = nextDate(), a = mk({ cands: T.map((t) => cand(t)), reach: REACH }); await X.studioPlan('med', { date: d1, deps: a.deps });
  await X.studioPlanAct('med', d1, 'more', { deps: a.deps }); assert.deepEqual(a.log.spawn.at(-1).slice(0, 4), ['plan', 'med', '--date', d1]); assert.equal(S.loadPlan(d1, 'med').status, 'replaced');
  assert.equal((await X.studioPlanAct('med', d1, 'ok', { deps: a.deps })).ok, false, 'заменённый план утвердить нельзя'); assert.equal(a.log.script.length, 0);
  const d2 = nextDate(), b = mk({ cands: T.map((t) => cand(t)), reach: REACH }); await X.studioPlan('med', { date: d2, deps: b.deps });
  await X.studioPlanAct('med', d2, 'skip', { deps: b.deps }); assert.equal(S.loadPlan(d2, 'med').status, 'skipped'); assert.equal(b.log.spawn.length, 0);
  assert.equal((await X.studioPlanAct('med', '2000-01-01', 'ok', { deps: b.deps })).ok, false, 'нет такого плана');
});

async function planned() { const date = nextDate(), m = mk({ cands: T.map((t) => cand(t)), reach: REACH }); await X.studioPlan('med', { date, deps: m.deps }); return { date, ...m }; }
const author = (text) => async (o) => {
  if (o.label.startsWith('author')) fs.writeFileSync(o.outFile, JSON.stringify({ text: typeof text === 'function' ? text(o) : text, cover_brief: { scene: 'a magnifying glass over a pill', mood: 'calm', text_on_image: '' } }));
  else fs.writeFileSync(o.outFile, JSON.stringify({ verdict: 'ok', text: fs.existsSync(path.join(path.dirname(o.outFile), 'candidate.json')) ? JSON.parse(fs.readFileSync(path.join(path.dirname(o.outFile), 'candidate.json'), 'utf8')).text : '', issues: [], facts_ok: true }));
};

test('пост: автор → код → редактор → обложка → превью «как выйдет» и карточка с тремя кнопками; в эфир ничего не ушло', async () => {
  const { date, deps, log } = await planned(); const mm = mk({ cands: [], agentFn: author((o) => GOOD('Хук про ' + o.label)) }); Object.assign(deps, { runAgent: mm.deps.runAgent });
  const r = await X.studioPost('med', date, 'post1', { deps: { ...deps, runAgent: async (o) => { log.runs.push(o); await author(GOOD('Гомеопатия работает лучше плацебо'))(o); return { code: 0 }; } } });
  assert.equal(r.ok, true); assert.ok(r.cover);
  const author1 = log.runs.find((x) => x.label === 'author1'), ed = log.runs.find((x) => x.label === 'editor1');
  assert.equal(author1.profile, 'studio_text'); assert.equal(author1.agentId, 'tg_author'); assert.equal(ed.agentId, 'tg_editor'); assert.match(author1.task, /post_rules\.md/); assert.match(author1.task, /https:\/\/t\.me\/med_detective_ru/);
  assert.equal(log.photos.length, 1); assert.equal(log.photos[0].chat, 323028999, 'превью только Нику'); assert.match(log.photos[0].html, /<b>Гомеопатия работает лучше плацебо<\/b>/); assert.ok(!log.photos[0].html.includes('**'));
  const card = log.notify.at(-1); assert.match(card.t, /Пост 12:00 готов/); assert.deepEqual(card.b.flat().map((b) => b[1].split(':').pop()), ['ok', 'edit', 'drop']);
  assert.equal(S.slotOf(S.loadPlan(date, 'med'), 'post1').status, 'preview'); assert.ok(log.photos.every((p) => p.chat !== '@med_detective_ru'));
  assert.match(log.lastPrompt, /magnifying glass/);
});
test('пост: замечания кода (нет CTA) возвращаются автору без редактора; замечания редактора передаются во втором круге вместе с прошлым текстом', async () => {
  const { date, deps, log } = await planned(); let n = 0;
  const fn = async (o) => {
    log.runs.push(o);
    if (o.label.startsWith('author')) { n++; const t = n === 1 ? GOOD('Хук').replace('https://t.me/med_detective_ru', 'https://example.com') : GOOD('Хук'); fs.writeFileSync(o.outFile, JSON.stringify({ text: t, cover_brief: { scene: 's' } })); }
    else { const cand = JSON.parse(fs.readFileSync(path.join(path.dirname(o.outFile), 'candidate.json'), 'utf8')).text; const first = !log.edSeen; log.edSeen = true; fs.writeFileSync(o.outFile, JSON.stringify(first ? { verdict: 'rework', text: cand, issues: ['факт про 2015 год не подтверждён источником'], facts_ok: false } : { verdict: 'ok', text: cand, issues: [], facts_ok: true })); }
    return { code: 0 };
  };
  const r = await X.studioPost('med', date, 'post1', { deps: { ...deps, runAgent: fn } }); assert.equal(r.ok, true);
  const labels = log.runs.map((x) => x.label); assert.deepEqual(labels.filter((l) => l !== 'scout'), ['author1', 'author2', 'editor2', 'author3', 'editor3'], 'редактора не зовут, пока код видит нарушение');
  assert.match(log.runs.find((x) => x.label === 'author2').task, /CTA-подписки/); assert.match(log.runs.find((x) => x.label === 'author3').task, /факт про 2015 год не подтверждён[\s\S]*Прошлый текст/);
});
test('пост: три круга без успеха — пост «не прошёл проверку», обложка не тратится, кнопки «Ещё раз» и «Снять»', async () => {
  const { date, deps, log } = await planned();
  const r = await X.studioPost('med', date, 'post1', { deps: { ...deps, runAgent: async (o) => { log.runs.push(o); fs.writeFileSync(o.outFile, JSON.stringify({ text: 'Просто текст без хука и ссылки' })); return { code: 0 }; } } });
  assert.equal(r.ok, false); assert.equal(log.covers, 0); assert.equal(S.slotOf(S.loadPlan(date, 'med'), 'post1').status, 'failed');
  assert.match(log.notify.at(-1).t, /не прошёл проверку/); assert.deepEqual(log.notify.at(-1).b.flat().map((b) => b[1].split(':').pop()), ['edit', 'drop']);
});
test('пост: обложка не получилась (ключ не принят) — превью текстом и честная пометка; суточный лимит картинок', async () => {
  const { date, deps, log } = await planned(); const bad = { ...deps, runAgent: async (o) => { log.runs.push(o); await author(GOOD('Хук без картинки'))(o); return { code: 0 }; }, generateCover: async () => { log.covers++; return { ok: false, error: 'fal.ai ответил 401 (ключ не принят)' }; } };
  const r = await X.studioPost('med', date, 'post1', { deps: bad }); assert.equal(r.ok, true); assert.equal(r.cover, null); assert.equal(log.covers, 1, 'при отказе по ключу вторая попытка не нужна');
  assert.equal(log.photos.length, 0); assert.equal(log.texts.length, 1); assert.match(log.notify.at(-1).t, /Обложки нет: fal\.ai ответил 401/);
  const day = nextDate(); const pl2 = mk({ cands: T.map((t) => cand(t)), reach: REACH }); await X.studioPlan('med', { date: day, deps: pl2.deps });
  fs.writeFileSync(path.join(S.studioDir(), 'image_count.json'), JSON.stringify({ day, count: 99 }));
  const m2 = mk({ cands: [], agentFn: author(GOOD('Хук лимит')) }); const r2 = await X.studioPost('med', day, 'post2', { deps: { ...pl2.deps, runAgent: m2.deps.runAgent, notify: m2.deps.notify, generateCover: async () => { throw new Error('не должен вызываться'); } } });
  assert.equal(r2.cover, null); assert.match(m2.log.notify.at(-1).t, /лимит картинок/);
});
test('ответ на превью: утвердить = пост в расписании; править без текста спрашивает, с текстом возвращает Дарье; снять; чужие статусы', async () => {
  const { date, deps, log } = await planned();
  await X.studioPost('med', date, 'post1', { deps: { ...deps, runAgent: async (o) => { log.runs.push(o); await author(GOOD('Хук'))(o); return { code: 0 }; } } });
  const a = await X.studioPostAct('med', date, 'post1', 'edit', { deps }); assert.equal(a.pending, 'comment'); assert.equal(log.spawn.filter((x) => x[0] === 'post').length, 0);
  await X.studioPostAct('med', date, 'post1', 'edit', { deps, comment: 'короче и без эмодзи' }); assert.deepEqual(log.spawn.at(-1), ['post', 'med', date, 'post1', '--comment', 'короче и без эмодзи']);
  const ok = await X.studioPostAct('med', date, 'post1', 'ok', { deps }); assert.equal(ok.ok, true); assert.equal(S.slotOf(S.loadPlan(date, 'med'), 'post1').status, 'approved'); assert.match(log.notify.at(-1).t, /в 12:00 МСК/);
  assert.match((await X.studioPostAct('med', date, 'post1', 'ok', { deps }), log.notify.at(-1).t), /уже стоит в расписании/);
  assert.equal((await X.studioPostAct('med', date, 'post2', 'ok', { deps })).ok, false, 'пост без превью утвердить нельзя');
  await X.studioPostAct('med', date, 'post1', 'drop', { deps }); assert.equal(S.slotOf(S.loadPlan(date, 'med'), 'post1').status, 'dropped');
  assert.equal((await X.studioPostAct('med', date, 'post1', 'ok', { deps })).ok, false, 'снятый пост утвердить нельзя');
});

async function approved(slot = 'post1') {
  const { date, deps, log } = await planned();
  await X.studioPost('med', date, slot, { deps: { ...deps, runAgent: async (o) => { log.runs.push(o); await author(GOOD('Хук ' + slot))(o); return { code: 0 }; } } });
  await X.studioPostAct('med', date, slot, 'ok', { deps }); return { date, deps, log };
}
const at = (date, hhmm) => S.slotMs(date, hhmm);
test('публикация: до времени не выходит, в срок уходит в канал единым сообщением «фото + подпись», один раз', async () => {
  const { date, log } = await approved('post1');
  const early = mk({ now: at(date, '11:59') }); assert.deepEqual(await X.studioPublishDue({ deps: early.deps }), { due: 0, done: 0 }); assert.equal(early.log.photos.length, 0);
  const m = mk({ now: at(date, '12:00') + 20e3 }); const r = await X.studioPublishDue({ deps: m.deps }); assert.deepEqual(r, { due: 1, done: 1 });
  assert.equal(m.log.photos.length, 1); assert.equal(m.log.photos[0].chat, '@med_detective_ru'); assert.match(m.log.photos[0].html, /<a href="https:\/\/t\.me\/med_detective_ru">подписывайтесь<\/a>/);
  const slot = S.slotOf(S.loadPlan(date, 'med'), 'post1'); assert.equal(slot.status, 'published'); assert.equal(slot.message_id, 77); assert.match(m.log.notify.at(-1).t, /опубликован в @med_detective_ru: https:\/\/t\.me\/med_detective_ru\/77/);
  const again = mk({ now: at(date, '12:05') }); assert.deepEqual(await X.studioPublishDue({ deps: again.deps }), { due: 0, done: 0 }); assert.equal(again.log.photos.length, 0, 'второй раз не публикуется');
});
test('публикация: сбой Telegram — повтор через 2 минуты, после третьей попытки «не вышел» и один звонок Нику; неутверждённое не выходит', async () => {
  const { date } = await approved('post1');
  let t = at(date, '12:00') + 1000; const m1 = mk({ now: t, sendFail: 5 });
  await X.studioPublishDue({ deps: m1.deps }); let slot = S.slotOf(S.loadPlan(date, 'med'), 'post1'); assert.equal(slot.status, 'approved'); assert.equal(slot.attempts, 1); assert.match(m1.log.notify.at(-1).t, /не админ[\s\S]*Повторю через 2 минуты/);
  const m2 = mk({ now: t + 30e3, sendFail: 5 }); assert.deepEqual(await X.studioPublishDue({ deps: m2.deps }), { due: 0, done: 0 }, 'раньше retry_at не повторяем');
  const m3 = mk({ now: t + 130e3, sendFail: 5 }); await X.studioPublishDue({ deps: m3.deps }); assert.equal(m3.log.notify.length, 0, 'второй сбой молчит');
  const m4 = mk({ now: t + 260e3, sendFail: 5 }); await X.studioPublishDue({ deps: m4.deps }); slot = S.slotOf(S.loadPlan(date, 'med'), 'post1'); assert.equal(slot.status, 'failed'); assert.match(m4.log.notify.at(-1).t, /Больше не повторяю/);
  assert.deepEqual(await X.studioPublishDue({ deps: mk({ now: t + 600e3 }).deps }), { due: 0, done: 0 });
  const { date: d2, deps, log } = await planned(); await X.studioPost('med', d2, 'post1', { deps: { ...deps, runAgent: async (o) => { await author(GOOD('Хук'))(o); return { code: 0 }; } } });
  assert.deepEqual(await X.studioPublishDue({ deps: mk({ now: at(d2, '13:00') }).deps }), { due: 0, done: 0 }, 'без «да» Ника превью в канал не выходит');
});
test('публикация: пост без обложки выходит текстом; длинный с обложкой — обложка и текст отдельно; нет файла поста — понятная ошибка', async () => {
  const { date, deps, log } = await planned();
  await X.studioPost('med', date, 'post1', { deps: { ...deps, generateCover: async () => ({ ok: false, error: 'нет ключа' }), runAgent: async (o) => { await author(GOOD('Хук без обложки'))(o); return { code: 0 }; } } });
  await X.studioPostAct('med', date, 'post1', 'ok', { deps }); const m = mk({ now: at(date, '12:01') }); await X.studioPublishDue({ deps: m.deps });
  assert.equal(m.log.photos.length, 0); assert.equal(m.log.texts[0].chat, '@med_detective_ru'); assert.match(m.log.texts[0].html, /<b>Хук без обложки<\/b>/);
  const d2 = (await approved('post2')).date; const f = S.slotOf(S.loadPlan(d2, 'med'), 'post2').text_file; const post = JSON.parse(fs.readFileSync(f, 'utf8')); post.text = '**Длинный**\n\n' + ('слово '.repeat(120) + '\n\n').repeat(3) + 'Больше: [канал](https://t.me/med_detective_ru)'; fs.writeFileSync(f, JSON.stringify(post));
  const m2 = mk({ now: at(d2, '19:01') }); await X.studioPublishDue({ deps: m2.deps }); assert.equal(m2.log.photos.length, 1); assert.equal(m2.log.texts.length, 1); assert.match(m2.log.photos[0].html, /<b>Длинный<\/b>/);
  const { date: d3 } = await approved('post1'); fs.rmSync(S.slotOf(S.loadPlan(d3, 'med'), 'post1').text_file); const m3 = mk({ now: at(d3, '12:01') }); await X.studioPublishDue({ deps: m3.deps }); assert.match(m3.log.notify.at(-1).t, /нет файла поста/);
});
test('разбор команд studio: неизвестная команда даёт справку', async () => {
  await assert.rejects(() => X.runStudio(['nope'], mk().deps), /Команды studio/);
});

// Конвейер студии: единый план дня (варианты для видео и для постов, выбор вместе), посты (автор → редактор → обложка → превью), публикация по расписанию.
// Модели, сеть, источники канала и время подменены.
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
const CH = { med: { key: 'med', name: 'Медицинский детектив', tg: 'med_detective_ru', brief: 'Миф о здоровье по первоисточникам, медицина', lang: 'ru', postFormat: 'short', slots: S.DEFAULT_SLOTS, planAt: '20:00' } };
const EV = [{ source: 'Cochrane', url: 'https://www.cochrane.org/a', finding: 'x' }];
const cand = (title, extra = {}) => ({ title, rubric: 'myth', why_massive: 'почему', evidence: EV, clear_answer: true, queries: [title.split(' ').slice(0, 2).join(' ') + ' ещё'], ...extra });
const GOOD = (t) => `**${t}** 🤔\n\nКрупный обзор сравнил десятки исследований и не нашёл эффекта сильнее пустышки\n\nСамовнушение помогает чувствовать себя лучше, но это не лечение\n\nА вы как думаете, почему это так популярно?\n\n🔬 Источники: [NHMRC](https://www.nhmrc.gov.au/x), [Cochrane](https://www.cochrane.org/y)\n\nБольше разборов: [подписывайтесь](https://t.me/med_detective_ru)`;
const DAY = 86400e3;

// Шесть тем для видео и шесть для постов (разные по смыслу), материалы источников разной свежести.
const VT = ['Гомеопатия работает лучше плацебо?', 'Эффект Моцарта делает детей умнее?', 'Давление можно почувствовать по самочувствию?', 'Хруст пальцев вызывает артрит?', 'Кофе обезвоживает организм?', 'Полнолуние влияет на психику людей?'];
const PT = ['Быстрая ходьба продлевает жизнь?', 'Мобильный телефон вызывает головную боль?', 'Восемь стаканов воды в день обязательны?', 'Чтение в темноте портит зрение навсегда?', 'Сахар делает детей гиперактивными?', 'Витамин С лечит простуду быстрее?'];
const T = [...VT, ...PT];
const REACH = { [VT[2]]: 17, [VT[0]]: 10, [VT[3]]: 6, [VT[1]]: 4, [VT[4]]: 3, [VT[5]]: 2, [PT[0]]: 20, [PT[1]]: 15, [PT[2]]: 10, [PT[3]]: 5, [PT[4]]: 5, [PT[5]]: 5 };
const AGE = [0.5, 1, 5, 20, 3, 40];                                 // возраст материала поста в сутках
const ITEMS = PT.map((t, i) => ({ source: i % 2 ? 'Medical Xpress' : 'ВОЗ (WHO), новости', type: 'rss', title: 'Материал: ' + t, link: `https://example.org/news/${i + 1}`, date: NOW - AGE[i] * DAY, summary: 'суть материала' }));
const postCand = (i, extra = {}) => cand(PT[i], { items: ['i' + (i + 1)], evidence: [], ...extra });
const FX = () => ({ cands: VT.map((t) => cand(t)), postCands: PT.map((_, i) => postCand(i)), items: { items: ITEMS, errors: [], okSources: 2 }, reach: REACH });

function mk({ cands = [], postCands = [], items = { items: [], errors: [], okSources: 0 }, reach = {}, used = [], agentFn, cover = 'ok', sendFail = 0, now = NOW, srcs = [{ type: 'rss', identifier: 'https://example.org/feed', name: 'Пример' }], editFail = false } = {}) {
  const log = { notify: [], agent: [], say: [], spawn: [], script: [], api: [], photos: [], texts: [], runs: [], covers: 0, measure: [], edits: [] };
  let nid = 900, sendFailLeft = sendFail;
  const deps = X.makeDeps({
    api: async (p, b) => { log.api.push([p, b]); return { id: 501 }; },
    agent: async (...a) => { log.agent.push(a); }, say: async (...a) => { log.say.push(a); },
    notify: async (t, b) => { log.notify.push({ t, b }); return ++nid; }, promptOf: async (id) => `persona ${id}`,
    editCard: async (id, text, buttons) => { if (editFail) throw new Error('карточка закрыта'); log.edits.push({ id, text, buttons }); },
    runAgent: async (o) => { log.runs.push(o); if (/^scout/.test(o.label)) fs.writeFileSync(o.outFile, JSON.stringify(cands)); else if (o.label === 'postscout') fs.writeFileSync(o.outFile, JSON.stringify(postCands)); else if (agentFn) await agentFn(o); return { code: 0 }; },
    measureAll: async (list, ctx = {}) => { log.measure.push({ n: list.length, ctx }); return list.map((c) => ({ reach: reach[c.title] ?? 0, index: (reach[c.title] ?? 0) / 25, line: `охват ${reach[c.title] ?? 0}`, level: 'measured', wiki: null, suggest: { google: 3 }, trends: { matched: [] }, youtube: ctx.youtube === false ? null : { n: 5, median: 2000, max: 90000, hits: 0 } })); },
    trendsNow: async () => ({ ok: true, items: [{ title: 'Хруст пальцев', traffic: '200+' }, { title: 'Погода завтра', traffic: '1000+' }] }),
    collectItems: async () => items, sources: () => srcs,
    usedTopics: async () => ({ all: used, counts: {}, feed: { titles: [] } }), spawn: (a) => log.spawn.push(a), spawnScript: (id) => log.script.push(id),
    generateCover: async ({ outFile, prompt }) => { log.covers++; log.lastPrompt = prompt; if (cover === 'ok') { fs.mkdirSync(path.dirname(outFile), { recursive: true }); fs.writeFileSync(outFile, Buffer.alloc(3000, 1)); return { ok: true, file: outFile }; } return { ok: false, error: cover }; },
    sendPhoto: async (chat, file, html) => { if (sendFailLeft-- > 0) throw new Error('Bad Request: chat not found'); log.photos.push({ chat, file, html }); return { message_id: 77 }; },
    sendText: async (chat, html) => { if (sendFailLeft-- > 0) throw new Error('Bad Request: chat not found'); log.texts.push({ chat, html }); return { message_id: 78 }; },
    now: () => NOW === now ? now : now, channels: () => CH,
  });
  return { deps, log };
}
let dayN = 0; const nextDate = () => new Date(Date.UTC(2026, 11, 1 + ++dayN)).toISOString().slice(0, 10);     // свой день на каждый тест (настоящие даты, без «31 ноября»): файлы плана не пересекаются
const btnData = (rows) => rows.flat().map((b) => b[1]);

test('единый план: варианты для видео и для постов раздельно, выбор по умолчанию, карточка с кнопками выбора', async () => {
  const date = nextDate(), { deps, log } = mk({ ...FX() });
  const r = await X.studioPlan('med', { date, deps }); const plan = r.plan;
  assert.equal(plan.options.video.length, 4); assert.equal(plan.options.posts.length, 5); assert.equal(plan.options.video[0].title, VT[2], 'самый востребованный по замеру первым');
  assert.equal(plan.options.posts[0].title, PT[0], 'у постов выше свежий материал и интерес'); assert.ok(plan.options.posts.every((c) => c.from_sources && c.evidence.length), 'у каждого поста есть первоисточник из материалов канала');
  assert.equal(plan.options.posts[0].evidence[0].url, 'https://example.org/news/1'); assert.equal(plan.options.posts[0].sources_meta[0].name, 'ВОЗ (WHO), новости');
  assert.deepEqual(plan.selection, { video: 0, posts: [0, 1] }); assert.deepEqual(plan.slots.map((s) => [s.slot, s.title]), [['post1', PT[0]], ['video', VT[2]], ['post2', PT[1]]]);
  const scout = log.runs.find((x) => x.label === 'scout'), ps = log.runs.find((x) => x.label === 'postscout');
  assert.equal(scout.profile, 'studio_research'); assert.match(scout.task, /Хруст пальцев, Погода завтра/, 'тренды Google переданы поиску видео'); assert.match(scout.task, /РОЛИКА Shorts/);
  assert.equal(ps.agentId, 'tg_scout'); assert.match(ps.task, /source_items\.json/); assert.match(ps.task, /ПОСТОВ Telegram/);
  assert.equal(log.measure.length, 2); assert.equal(log.measure[0].ctx.trends.ok, true); assert.equal(log.measure[1].ctx.youtube, false, 'темы постов не тратят квоту YouTube'); assert.equal(log.measure[1].ctx.trends.ok, true);
  const card = log.notify.at(-1); assert.match(card.t, /🎬 ВИДЕО в 18:30[\s\S]*📝 ПОСТЫ в 12:00 и 19:00/); assert.match(card.t, /📰 ВОЗ \(WHO\), новости, сегодня|📰 ВОЗ \(WHO\), новости, 0 дн|📰 ВОЗ/);
  const d = btnData(card.b); assert.equal(d[0], `splan:med:${date}:ok`); assert.deepEqual(d.slice(1, 5), [1, 2, 3, 4].map((n) => `splan:med:${date}:v${n}`)); assert.deepEqual(d.slice(5, 10), [1, 2, 3, 4, 5].map((n) => `splan:med:${date}:p${n}`)); assert.deepEqual(d.slice(10), [`splan:med:${date}:morev`, `splan:med:${date}:morep`, `splan:med:${date}:skip`]);
  assert.match(card.b[0][0][0], /Утвердить: видео 1 \+ посты 1, 2/); assert.ok(card.t.length < 3900); assert.equal(plan.card_id, 901);
  assert.equal(S.loadPlan(date, 'med').status, 'proposed'); assert.ok(log.agent.some((a) => a[0] === 'studio_chief' && a[1] === 'waiting'));
});
test('источники канала молчат: посты берутся из общего поиска (запас видео), в плане честная пометка', async () => {
  const date = nextDate(), f = FX(), { deps, log } = mk({ ...f, items: { items: [], errors: [{ source: 'ВОЗ', error: 'HTTP 403' }], okSources: 0 }, postCands: [] });
  const r = await X.studioPlan('med', { date, deps });
  assert.equal(r.plan.options.posts.length >= 2, true); assert.ok(r.plan.options.posts.every((c) => c.fallback), 'посты из запаса видео-поиска помечены'); assert.equal(log.runs.filter((x) => x.label === 'postscout').length, 0, 'без материалов второй Opus не запускается');
  assert.equal(r.plan.sources.ok, 0);
});
test('мало тем — плана нет, кнопка «Повторить»', async () => {
  const d1 = nextDate(), a = mk({ cands: [cand(VT[0])], reach: REACH });
  assert.equal((await X.studioPlan('med', { date: d1, deps: a.deps })).plan, null); assert.match(a.log.notify.at(-1).t, /набралось 1/); assert.equal(a.log.notify.at(-1).b[0][0][1], `splan_new:med:${d1}`); assert.equal(S.loadPlan(d1, 'med'), null);
});
test('второй план на тот же день: прежний уходит в архив, его темы остаются занятыми; утверждённый план не затирается', async () => {
  const date = nextDate(), a = mk({ ...FX() }); await X.studioPlan('med', { date, deps: a.deps });
  const b = mk({ ...FX() }); const r2 = await X.studioPlan('med', { date, deps: b.deps });
  const used = fs.readFileSync(path.join(r2.dir, 'used_topics.txt'), 'utf8'); assert.ok(used.includes(VT[2]) && used.includes(PT[0]), 'темы прежнего плана переданы Глебу как занятые');
  assert.ok(!r2.plan.options.video.some((c) => c.title === VT[2]), 'выбранные вчера темы в новый список не вернулись');
  await X.studioPlanAct('med', date, 'ok', { deps: b.deps });
  const c = mk({ ...FX() }); const r3 = await X.studioPlan('med', { date, deps: c.deps });
  assert.equal(r3.kept, true); assert.equal(S.loadPlan(date, 'med').status, 'approved'); assert.match(c.log.notify.at(-1).t, /уже утверждён/); assert.equal(c.log.runs.length, 0, 'поиск не запускался');
});
const sel = async (deps, date, action, comment) => X.studioPlanAct('med', date, action, { deps, comment });
test('выбор кнопками: видео, посты (повторное нажатие снимает, третий вытесняет), карточка правится на месте', async () => {
  const date = nextDate(), { deps, log } = mk({ ...FX() }); await X.studioPlan('med', { date, deps });
  await sel(deps, date, 'v2'); let plan = S.loadPlan(date, 'med'); assert.equal(plan.selection.video, 1); assert.equal(S.slotOf(plan, 'video').title, plan.options.video[1].title);
  assert.equal(log.edits.length, 1); assert.equal(log.edits[0].id, 901); assert.match(log.edits[0].text, /Выбрано: видео 2; посты 1 и 2/); assert.equal(log.notify.length, 1, 'новая карточка не создавалась');
  await sel(deps, date, 'p2'); plan = S.loadPlan(date, 'med'); assert.deepEqual(plan.selection.posts, [0]); assert.match(log.edits.at(-1).buttons[0][0][0], /Выберите: ещё один пост/);
  await sel(deps, date, 'p3'); await sel(deps, date, 'p4'); plan = S.loadPlan(date, 'med'); assert.equal(plan.selection.posts.length, 2); assert.ok(plan.selection.posts.includes(3) && !plan.selection.posts.includes(0), 'третий вытеснил самый давний');
  assert.match(log.edits.at(-1).buttons[0][0][0], /Утвердить: видео 2 \+ посты 3, 4/);
  assert.equal(S.slotOf(plan, 'post1').title, plan.options.posts[2].title, 'первый по номеру пост идёт в первый слот');
});
test('похожие темы в одном дне не выбираются: карточка остаётся прежней и объясняет почему', async () => {
  const date = nextDate(), { deps, log } = mk({ ...FX() });
  const vid = [cand('Лёгкие сигареты менее вредны для здоровья?', { demand: { reach: 20, index: 0.8 } }), cand(VT[0], { demand: { reach: 10, index: 0.4 } })];
  const posts = [cand(PT[0], { freshness: 3, from_sources: true }), cand('Правда ли, что лёгкие сигареты менее вредны?', { freshness: 2, from_sources: true }), cand(PT[2], { freshness: 1, from_sources: true })];
  const plan = S.newDayPlan({ date, channel: 'med', options: { video: vid, video_spare: [], posts, posts_spare: [] }, slots: S.DEFAULT_SLOTS, now: NOW }); plan.card_id = 901; S.savePlan(plan);
  assert.deepEqual(plan.selection.posts, [0, 2], 'по умолчанию похожий пост не берётся');
  const before = JSON.stringify(S.loadPlan(date, 'med').selection); const res = await sel(deps, date, 'p2');
  assert.equal(res.ok, false); assert.equal(JSON.stringify(S.loadPlan(date, 'med').selection), before); assert.match(log.edits.at(-1).text, /⚠️ Пост «.*» слишком похож на выбранное видео/);
  assert.equal((await sel(deps, date, 'sel', JSON.stringify({ video: 2, posts: [1, 2] }))).ok, true, 'видео другое: теперь пост 2 не конфликтует'); assert.equal((await sel(deps, date, 'v1')).ok, false);
});
test('выбор текстом: видео и посты сразу; больше двух постов и несуществующие номера отклоняются', async () => {
  const date = nextDate(), { deps, log } = mk({ ...FX() }); await X.studioPlan('med', { date, deps });
  const ok = await sel(deps, date, 'sel', JSON.stringify({ video: 3, posts: [1, 4] })); assert.equal(ok.ok, true); const plan = S.loadPlan(date, 'med'); assert.deepEqual([plan.selection.video, plan.selection.posts], [2, [0, 3]]);
  assert.equal((await sel(deps, date, 'sel', JSON.stringify({ video: null, posts: [1, 2, 3] }))).ok, false); assert.match(log.edits.at(-1).text, /не больше двух/);
  assert.equal((await sel(deps, date, 'sel', JSON.stringify({ video: 9, posts: null }))).ok, false); assert.match(log.edits.at(-1).text, /Видео №9 нет в списке/);
  assert.equal((await sel(deps, date, 'sel', 'не json')).ok, false);
});
test('«Утвердить» при неполном выборе не запускает работу; закрытая карточка заменяется новой', async () => {
  const date = nextDate(), { deps, log } = mk({ ...FX(), editFail: true }); await X.studioPlan('med', { date, deps });
  await sel(deps, date, 'p1'); await sel(deps, date, 'p2');
  const n = log.notify.length; const r = await X.studioPlanAct('med', date, 'ok', { deps }); assert.equal(r.ok, false); assert.equal(r.incomplete, true); assert.equal(log.script.length, 0); assert.equal(S.loadPlan(date, 'med').status, 'proposed');
  assert.ok(log.notify.length > n, 'карточку нельзя править на месте (закрыта): пришла новая'); assert.match(log.notify.at(-1).t, /Утвердить нельзя: сначала выберите два поста/); assert.equal(S.loadPlan(date, 'med').card_id, log.notify.length ? 900 + log.notify.length : 0);
});
test('«Другие посты» и «Другое видео»: запас показывается сразу, без поиска; без запаса идёт отдельный поиск только для этого вида', async () => {
  const date = nextDate(), f = FX(); f.postCands = [...PT, 'Корь можно вылечить народными средствами?', 'Холодная вода закаливает иммунитет?'].map((t, i) => postCand(Math.min(i, 5), { title: t })); f.reach = { ...f.reach, 'Корь можно вылечить народными средствами?': 4, 'Холодная вода закаливает иммунитет?': 3 };
  const { deps, log } = mk(f); await X.studioPlan('med', { date, deps });
  let plan = S.loadPlan(date, 'med'); assert.equal(plan.options.posts.length, 5); assert.equal(plan.options.posts_spare.length, 3);
  const runs0 = log.runs.length; const r = await sel(deps, date, 'morep'); assert.equal(r.from, 'spare'); plan = S.loadPlan(date, 'med');
  assert.equal(plan.options.posts.length, 3); assert.equal(plan.options.posts_spare.length, 0); assert.equal(log.runs.length, runs0, 'запас показан без поиска'); assert.match(log.edits.at(-1).text, /Показал следующие варианты для постов/);
  assert.equal(plan.selection.posts.length, 2, 'выбор пересчитан под новые варианты');
  const r2 = await sel(deps, date, 'morep'); assert.equal(r2.from, 'search'); plan = S.loadPlan(date, 'med'); assert.ok(plan.busy); assert.deepEqual(log.spawn.at(-1), ['plan-more', 'med', date, 'posts']); assert.match(log.edits.at(-1).text, /⏳ Ищу другие варианты для постов/); assert.ok(!btnData(log.edits.at(-1).buttons).some((d) => /more/.test(d)), 'пока идёт поиск, кнопок «другие» нет');
  const r3 = await sel(deps, date, 'morep'); assert.equal(r3.ok, false); assert.match(log.notify.at(-1).t, /уже идёт/);
});
test('plan-more: новый поиск обновляет только свой вид, старые показанные темы не возвращаются, busy снимается', async () => {
  const date = nextDate(), f = FX(); const { deps, log } = mk(f); await X.studioPlan('med', { date, deps });
  for (let i = 0; i < 2; i++) { await sel(deps, date, 'morev'); }      // запас видео (2 темы) показан, затем запрос нового поиска
  let plan = S.loadPlan(date, 'med'); assert.ok(plan.busy || plan.options.video.length === 2);
  if (!plan.busy) await sel(deps, date, 'morev'); plan = S.loadPlan(date, 'med'); assert.ok(plan.busy, 'запас кончился: поиск заказан');
  const fresh = ['Сквозняк вызывает простуду?', 'Холодный душ укрепляет иммунитет?'];
  const m2 = mk({ cands: fresh.map((t) => cand(t)), reach: { [fresh[0]]: 30, [fresh[1]]: 8 }, used: [] }); const shownBefore = new Set(plan.seen);
  const res = await X.studioPlanMore('med', date, 'video', { deps: m2.deps }); assert.equal(res.ok, true);
  plan = S.loadPlan(date, 'med'); assert.equal(plan.busy, null); assert.equal(plan.options.video[0].title, fresh[0]); assert.ok(plan.options.video.every((c) => !shownBefore.has(c.title) || fresh.includes(c.title)), 'ранее показанные темы не вернулись');
  assert.equal(plan.options.posts.length, 5, 'посты не тронуты'); assert.match(m2.log.edits.at(-1).text, /Новые варианты для видео показаны/);
  const used = fs.readFileSync(path.join(plan.run_dir, 'used_topics.txt'), 'utf8'); assert.ok(used.includes(VT[2]), 'показанное вошло в список занятых для поиска');
});
test('утверждение плана: ролик уходит Ксении (строка в базе, сценарий), посты Дарье; второе «да» ничего не запускает', async () => {
  const date = nextDate(), { deps, log } = mk({ ...FX() }); await X.studioPlan('med', { date, deps });
  const r = await X.studioPlanAct('med', date, 'ok', { deps }); assert.equal(r.ok, true);
  const v = log.api.find(([p]) => p === '/api/video')[1]; assert.equal(v.title, VT[2]); assert.equal(v.stage, 'script'); const notes = JSON.parse(v.notes); assert.equal(notes.source, 'studio'); assert.equal(notes.studio.slot_time, '18:30');
  assert.deepEqual(log.script, [501]); assert.deepEqual(log.spawn.at(-1), ['posts', 'med', date]);
  const plan = S.loadPlan(date, 'med'); assert.equal(plan.status, 'approved'); assert.equal(S.slotOf(plan, 'video').videoId, 501); assert.equal(S.slotOf(plan, 'post1').status, 'queued');
  assert.match(log.notify.at(-1).t, /План на .* принят/); assert.equal((await sel(deps, date, 'v2')).ok, false, 'после утверждения выбор не меняется');
  const n = log.spawn.length; const again = await X.studioPlanAct('med', date, 'ok', { deps }); assert.equal(again.ok, false); assert.equal(log.spawn.length, n); assert.equal(log.script.length, 1);
});
test('старый план без вариантов (прежний формат) утверждается как раньше; «Пропустить день»; нет такого плана', async () => {
  const date = nextDate(), { deps, log } = mk({}); const picks = S.pickDayTopics([{ title: 'Тема раз про сон', demand: { reach: 9 }, evidence: EV }, { title: 'Тема два про зубы', demand: { reach: 8 }, evidence: EV }, { title: 'Тема три про спину', demand: { reach: 7 }, evidence: EV }]);
  S.savePlan(S.buildPlan({ date, channel: 'med', picks, slots: S.DEFAULT_SLOTS, now: NOW }));
  assert.equal((await sel(deps, date, 'v2')).ok, false); assert.match(log.notify.at(-1).t, /старом формате/);
  assert.equal((await X.studioPlanAct('med', date, 'ok', { deps })).ok, true); assert.equal(log.script.length, 1);
  const d2 = nextDate(), b = mk({ ...FX() }); await X.studioPlan('med', { date: d2, deps: b.deps });
  await X.studioPlanAct('med', d2, 'skip', { deps: b.deps }); assert.equal(S.loadPlan(d2, 'med').status, 'skipped'); assert.equal(b.log.spawn.length, 0);
  assert.equal((await X.studioPlanAct('med', d2, 'v1', { deps: b.deps })).ok, false, 'пропущенный план не меняется'); assert.equal((await X.studioPlanAct('med', '2000-01-01', 'ok', { deps: b.deps })).ok, false, 'нет такого плана');
});

/* ---- профиль канала: контекст для агентов и отсев тяжёлых тем ---- */
const MD = { med_detective: { ...CH.med, key: 'med_detective' } };
const HEAVY_V = ['Правда ли, что сахарный диабет бывает от сладкого?', 'Правда ли, что инфаркт всегда начинается с боли в груди?', 'Правда ли, что если в семье не было рака груди, он не грозит?'];
test('профиль канала: тяжёлые темы и материалы про болезни отсеиваются до замера спроса, агенты получают профиль, карточка говорит об отсеве, файл профиля создан', async () => {
  const date = nextDate(), fx = FX(), heavyItem = { source: 'PLOS Medicine', type: 'rss', title: 'Новый препарат от лейкоза прошёл испытания', link: 'https://example.org/news/99', date: NOW - DAY, summary: 'суть' };
  const { deps, log } = mk({ ...fx, cands: [...fx.cands, ...HEAVY_V.map((t) => cand(t, { audience_fit: 5 }))], postCands: [...fx.postCands, postCand(0, { title: 'Правда ли, что лейкоз — всегда смертный приговор?' }), postCand(1, { title: 'Правда ли, что витамин D нужен всем?', audience_fit: 2, fit_note: 'про пожилых' })], items: { ...fx.items, items: [...fx.items.items, heavyItem] } });
  deps.channels = () => MD;
  const r = await X.studioPlan('med_detective', { date, deps }), plan = r.plan;
  assert.equal(plan.options.video.length, 4); assert.ok(plan.options.video.every((c) => VT.includes(c.title)), 'видео: только бытовые');
  const all = [...plan.options.video, ...plan.options.video_spare, ...plan.options.posts, ...plan.options.posts_spare].map((c) => c.title);
  assert.ok(all.length >= 9 && all.every((t) => !/диабет|инфаркт|рака|лейкоз|витамин D/.test(t)), 'ни одной тяжёлой темы и темы с низкой оценкой');
  assert.equal(log.measure[0].n, VT.length, 'тяжёлые темы не попали в замер YouTube (квота не тратится)'); assert.equal(log.measure[1].n, PT.length);
  assert.deepEqual(plan.filtered, { video: 3, posts: 2, items: 1 }); assert.equal(plan.sources.filtered, 1);
  const scout = log.runs.find((x) => x.label === 'scout'), ps = log.runs.find((x) => x.label === 'postscout');
  for (const t of [scout.task, ps.task]) { assert.match(t, /ПРОФИЛЬ КАНАЛА/); assert.match(t, /18-45/); assert.match(t, /НЕ ПОДХОДИТ[^\n]*рак, инфаркт, инсульт, диабет/); assert.match(t, /"audience_fit"/); assert.match(t, /Сахарный диабет бывает от сладкого/); }
  assert.match(scout.task, /только myth/); assert.match(ps.task, /body «Что будет с телом, если…»/); assert.match(ps.task, /лучше меньше тем, чем тяжёлые/);
  const items = JSON.parse(fs.readFileSync(path.join(path.dirname(ps.outFile), 'source_items.json'), 'utf8')); assert.ok(!items.some((x) => /лейкоз/.test(x.title)), 'материал про лейкоз разведчик не видит'); assert.equal(items.length, PT.length);
  assert.match(log.notify.at(-1).t, /🧭 Отсеяно по профилю канала[^\n]*для видео 3, для постов 2, материалов источников 1/);
  const dirOf = path.dirname(scout.outFile); assert.equal(JSON.parse(fs.readFileSync(path.join(dirOf, 'rejected_by_profile_video.json'), 'utf8')).length, 3); assert.equal(JSON.parse(fs.readFileSync(path.join(dirOf, 'rejected_by_profile_posts.json'), 'utf8')).length, 2);
  assert.match(fs.readFileSync(path.join(process.env.OFFICE_STUDIO_DIR, 'channels', 'med_detective.md'), 'utf8'), /профиль и голос канала/);
});
test('профиль канала: если после отсева мало тем, второй круг поиска просит бытовые темы и называет, сколько отсеяно; у канала без профиля отсева нет', async () => {
  const date = nextDate(), fx = FX(), { deps, log } = mk({ ...fx, cands: [...VT.slice(0, 3).map((t) => cand(t)), ...HEAVY_V.map((t) => cand(t))] });
  deps.channels = () => MD; await X.studioPlan('med_detective', { date, deps });
  const scouts = log.runs.filter((x) => /^scout/.test(x.label)); assert.equal(scouts.length, 2); assert.match(scouts[1].task, /3 отсеяно как тяжёлые или не для широкой аудитории/); assert.match(scouts[1].task, /еда и напитки, сон, спорт, мозг и память/);
  const d2 = nextDate(), m2 = mk({ ...fx, cands: [...VT.map((t) => cand(t)), ...HEAVY_V.map((t) => cand(t))] }); const r2 = await X.studioPlan('med', { date: d2, deps: m2.deps });
  assert.ok([...r2.plan.options.video, ...r2.plan.options.video_spare].some((c) => /диабет/.test(c.title)), 'без профиля канал не отсеивает'); assert.ok(!m2.log.runs[0].task.includes('ПРОФИЛЬ КАНАЛА')); assert.equal(r2.plan.filtered.video, 0);
});
test('профиль канала: слова из пожелания Ника снимают запрет («план дня про диабет»)', async () => {
  const date = nextDate(), fx = FX(), { deps } = mk({ ...fx, cands: [...fx.cands, cand('Правда ли, что сахарный диабет бывает от сладкого?')], reach: { ...REACH, 'Правда ли, что сахарный диабет бывает от сладкого?': 24 } });
  deps.channels = () => MD; const r = await X.studioPlan('med_detective', { date, hint: 'про диабет', deps });
  assert.equal(r.plan.options.video[0].title, 'Правда ли, что сахарный диабет бывает от сладкого?'); assert.equal(r.plan.filtered.video, 0);
});
test('пост: автор и редактор получают профиль канала и проверяют соответствие; файл голоса канала есть', async () => {
  const date = nextDate(), m = mk({ ...FX() }); m.deps.channels = () => MD; await X.studioPlan('med_detective', { date, deps: m.deps });
  const r = await X.studioPost('med_detective', date, 'post1', { deps: { ...m.deps, runAgent: async (o) => { m.log.runs.push(o); await author(GOOD('Хук про профиль'))(o); return { code: 0 }; } } }); assert.equal(r.ok, true);
  const a = m.log.runs.find((x) => x.label === 'author1'), e = m.log.runs.find((x) => x.label === 'editor1');
  assert.match(a.task, /Аудитория: Широкая русскоязычная[\s\S]*не должен звучать как справочник про болезни/); assert.match(e.task, /5\) тема и подача подходят профилю канала/); assert.match(e.task, /тема не подходит каналу/); assert.match(a.task, /channels[\\/]med_detective\.md/);
  assert.ok(fs.existsSync(path.join(process.env.OFFICE_STUDIO_DIR, 'channels', 'med_detective.md')));
});

async function planned() { const date = nextDate(), m = mk({ ...FX() }); await X.studioPlan('med', { date, deps: m.deps }); return { date, ...m }; }
const author = (text) => async (o) => {
  if (o.label.startsWith('author')) fs.writeFileSync(o.outFile, JSON.stringify({ text: typeof text === 'function' ? text(o) : text, cover_brief: { scene: 'a magnifying glass over a pill', mood: 'calm', text_on_image: '' } }));
  else fs.writeFileSync(o.outFile, JSON.stringify({ verdict: 'ok', text: fs.existsSync(path.join(path.dirname(o.outFile), 'candidate.json')) ? JSON.parse(fs.readFileSync(path.join(path.dirname(o.outFile), 'candidate.json'), 'utf8')).text : '', issues: [], facts_ok: true }));
};

test('пост: автор → код → редактор → обложка → превью «как выйдет» и карточка с кнопками текста и картинки; в эфир ничего не ушло', async () => {
  const { date, deps, log } = await planned(); const mm = mk({ cands: [], agentFn: author((o) => GOOD('Хук про ' + o.label)) }); Object.assign(deps, { runAgent: mm.deps.runAgent });
  const r = await X.studioPost('med', date, 'post1', { deps: { ...deps, runAgent: async (o) => { log.runs.push(o); await author(GOOD('Гомеопатия работает лучше плацебо'))(o); return { code: 0 }; } } });
  assert.equal(r.ok, true); assert.ok(r.cover);
  const author1 = log.runs.find((x) => x.label === 'author1'), ed = log.runs.find((x) => x.label === 'editor1');
  assert.equal(author1.profile, 'studio_text'); assert.equal(author1.agentId, 'tg_author'); assert.equal(ed.agentId, 'tg_editor'); assert.match(author1.task, /post_rules\.md/); assert.match(author1.task, /https:\/\/t\.me\/med_detective_ru/);
  assert.equal(log.photos.length, 1); assert.equal(log.photos[0].chat, 323028999, 'превью только Нику'); assert.match(log.photos[0].html, /<b>Гомеопатия работает лучше плацебо<\/b>/); assert.ok(!log.photos[0].html.includes('**'));
  const card = log.notify.at(-1); assert.match(card.t, /Пост 12:00 готов/); assert.deepEqual(card.b.flat().map((b) => b[1].split(':').pop()), ['ok', 'edit', 'pic', 'pic0', 'drop'], 'текст и картинка правятся отдельными кнопками');
  assert.equal(S.slotOf(S.loadPlan(date, 'med'), 'post1').status, 'preview'); assert.ok(log.photos.every((p) => p.chat !== '@med_detective_ru'));
  assert.match(log.lastPrompt, /magnifying glass/);
  // качество обложки (перенос из WorkFlow AI, 2026-10-28): арт-директорские правила в задании автора и клауза фотореализма в запросе к fal.ai
  assert.match(author1.task, /БРИФ ОБЛОЖКИ[\s\S]*КОНКРЕТНЫЙ предмет[\s\S]*photo \| illustration \| infographic \| cartoon \| minimalist \| poster/); assert.match(author1.task, /Не вставляй в каждую обложку «фирменную атрибутику»/);
  assert.match(log.lastPrompt, /Style: Professional photograph, photo-realistic rendering/); assert.match(log.lastPrompt, /High quality, no artifacts\.$/); assert.doesNotMatch(log.lastPrompt, /Editorial cover illustration/);
});
/* ---- только картинка: текст согласован и остаётся, меняется изображение по правкам Ника ---- */
const artist = (brief) => async (o) => { if (o.label === 'cover_brief') fs.writeFileSync(o.outFile, JSON.stringify(brief)); };
async function previewed() {
  const { date, deps, log } = await planned();
  await X.studioPost('med', date, 'post1', { deps: { ...deps, runAgent: async (o) => { log.runs.push(o); await author(GOOD('Хук про банку'))(o); return { code: 0 }; } } });
  const file = path.join(process.env.OFFICE_STUDIO_DIR, 'posts', `${date}_med_post1`, 'post.json');
  return { date, deps, log, file, post: () => JSON.parse(fs.readFileSync(file, 'utf8')) };
}
test('картинка: текст поста остаётся байт в байт, сценарий картинки пересобирается с правкой Ника, старая версия сохраняется, новое превью с кнопками', async () => {
  const { date, deps, log, file, post } = await previewed(); const before = post(), textBefore = fs.readFileSync(file, 'utf8'), n0 = log.photos.length, runs0 = log.runs.length;
  const r = await X.studioCover('med', date, 'post1', { comment: 'убери банку, пусть будет лупа над чашкой кофе', deps: { ...deps, runAgent: async (o) => { log.runs.push(o); await artist({ scene: 'a magnifying glass over a coffee cup', mood: 'calm', text_on_image: '' })(o); return { code: 0 }; } } });
  assert.equal(r.ok, true); const after = post();
  assert.equal(after.text, before.text); assert.equal(after.html, before.html); assert.deepEqual(after.notes, before.notes, 'текст, разметка и замечания не тронуты');
  const run = log.runs.slice(runs0).find((x) => x.label === 'cover_brief'); assert.equal(run.agentId, 'tg_artist'); assert.equal(run.profile, 'studio_text');
  assert.match(run.task, /ТОЛЬКО картинку[\s\S]*текст поста менять нельзя/); assert.match(run.task, /убери банку, пусть будет лупа над чашкой кофе/); assert.match(run.task, /a magnifying glass over a pill/, 'прежний сценарий передан');
  assert.deepEqual(after.brief, { scene: 'a magnifying glass over a coffee cup', style: 'photo', mood: 'calm', text_on_image: '' }, 'стиль не назван художником: остаётся фотореализм по умолчанию'); assert.deepEqual(after.cover_edits, ['убери банку, пусть будет лупа над чашкой кофе']);
  assert.match(log.lastPrompt, /Art director's corrections[^\n]*убери банку, пусть будет лупа над чашкой кофе/); assert.match(log.lastPrompt, /a magnifying glass over a coffee cup/); assert.match(log.lastPrompt, /Do not write any text, letters or numbers/, 'без текста на картинке, пока Ник его не просил');
  assert.ok(fs.existsSync(after.cover) && fs.existsSync(path.join(path.dirname(file), 'covers', 'v1.jpg')), 'прежняя картинка сохранена'); assert.equal(S.slotOf(S.loadPlan(date, 'med'), 'post1').status, 'preview'); assert.equal(S.slotOf(S.loadPlan(date, 'med'), 'post1').cover, after.cover);
  assert.equal(log.photos.length, n0 + 1, 'в чат ушла только новая картинка'); const card = log.notify.at(-1); assert.match(card.t, /Текст остался прежним, как вы его согласовали[\s\S]*убери банку/); assert.match(card.t, /версия 1/);
  const d = btnData(card.b); assert.deepEqual(d, [`spost:med:${date}:post1:ok`, `spost:med:${date}:post1:edit`, `spost:med:${date}:post1:pic`, `spost:med:${date}:post1:pic0`, `spost:med:${date}:post1:drop`]);
  assert.equal(fs.readFileSync(file, 'utf8').includes('"text"'), true); assert.notEqual(fs.readFileSync(file, 'utf8'), textBefore, 'файл обновился (картинка, правки), но текст в нём прежний');
});
test('картинка: правки копятся (вторая правка не стирает первую), «другая картинка» без правок просит иное решение той же мысли', async () => {
  const { date, deps, log, post } = await previewed(); const mk2 = (brief) => ({ ...deps, runAgent: async (o) => { log.runs.push(o); await artist(brief)(o); return { code: 0 }; } });
  await X.studioCover('med', date, 'post1', { comment: 'светлее и без банки', deps: mk2({ scene: 'bright desk with a magnifier', mood: 'light', text_on_image: '' }) });
  await X.studioCover('med', date, 'post1', { comment: 'добавь надпись «Что внутри?»', deps: mk2({ scene: 'bright desk with a magnifier', mood: 'light', text_on_image: 'Что внутри?' }) });
  const p = post(); assert.deepEqual(p.cover_edits, ['светлее и без банки', 'добавь надпись «Что внутри?»']); assert.equal(p.cover_versions, 2); assert.match(log.lastPrompt, /светлее и без банки \| добавь надпись/); assert.match(log.lastPrompt, /Render exactly this short Russian text[^\n]*Что внутри\?/);
  assert.ok(fs.existsSync(path.join(process.env.OFFICE_STUDIO_DIR, 'posts', `${date}_med_post1`, 'covers', 'v2.jpg')));
  await X.studioCover('med', date, 'post1', { deps: mk2({ scene: 'a different angle: coffee cup from above', mood: 'calm', text_on_image: '' }) });
  const last = log.runs.filter((x) => x.label === 'cover_brief').at(-1); assert.match(last.task, /ДРУГОЙ вариант картинки[\s\S]*сохранив все его правки выше/); assert.match(last.task, /1\) светлее и без банки 2\) добавь надпись/); assert.doesNotMatch(log.runs.filter((x) => x.label === 'cover_brief')[0].task, /ДРУГОЙ вариант/, 'обычная правка не просит другое решение'); assert.equal(post().cover_edits.length, 2, 'без комментария список правок не растёт'); assert.equal(post().cover_versions, 3);
});
test('картинка: в расписании пост остаётся утверждённым и выйдет с новой картинкой; ошибка fal.ai не трогает ни текст, ни прежнюю картинку; лимит и чужие статусы', async () => {
  const { date, deps, log, post } = await previewed(); await X.studioPostAct('med', date, 'post1', 'ok', { deps }); assert.equal(S.slotOf(S.loadPlan(date, 'med'), 'post1').status, 'approved');
  const fail = { ...deps, runAgent: async (o) => { await artist({ scene: 'x scene', mood: 'm', text_on_image: '' })(o); return { code: 0 }; }, generateCover: async () => ({ ok: false, error: 'fal.ai ответил 500' }) }; const before = post();
  const r0 = await X.studioCover('med', date, 'post1', { comment: 'проба', deps: fail }); assert.equal(r0.ok, false); assert.deepEqual(post(), before, 'после ошибки пост цел'); assert.match(log.notify.at(-1).t, /не получилась: fal\.ai ответил 500\. Прежняя осталась, текст не менялся/); assert.equal(btnData(log.notify.at(-1).b)[0], `spost:med:${date}:post1:pic0`);
  const ok = { ...deps, runAgent: async (o) => { await artist({ scene: 'new scene', mood: 'm', text_on_image: '' })(o); return { code: 0 }; } };
  const r1 = await X.studioCover('med', date, 'post1', { comment: 'теплее', deps: ok }); assert.equal(r1.ok, true); assert.equal(S.slotOf(S.loadPlan(date, 'med'), 'post1').status, 'approved', 'пост остался в расписании'); assert.match(log.notify.at(-1).t, /Пост уже в расписании на \d\d:\d\d МСК: выйдет с этой картинкой/);
  assert.deepEqual(btnData(log.notify.at(-1).b), [`spost:med:${date}:post1:pic`, `spost:med:${date}:post1:pic0`, `spost:med:${date}:post1:drop`], 'у утверждённого поста нет второй кнопки «Поставить»');
  S.updateSlot(date, 'med', 'post1', { status: 'published' }); assert.equal((await X.studioCover('med', date, 'post1', { comment: 'поздно', deps: ok })).ok, false); assert.match(log.notify.at(-1).t, /нельзя: статус «published» \(пост уже вышел\)/);
  S.updateSlot(date, 'med', 'post1', { status: 'preview' }); fs.writeFileSync(path.join(process.env.OFFICE_STUDIO_DIR, 'image_count.json'), JSON.stringify({ day: S.mskDate(NOW), count: 99 }));
  const lim = await X.studioCover('med', date, 'post1', { comment: 'ещё', deps: { ...ok, generateCover: async () => { throw new Error('не должен вызываться'); } } }); assert.equal(lim.limit, true); assert.match(log.notify.at(-1).t, /лимит картинок[\s\S]*остаётся, текст не менялся/);
});
test('ответ на превью: «Править картинку» без текста спрашивает правку, с текстом и «Другая картинка» запускают этап cover; текст поста не пересобирается', async () => {
  const { date, deps, log } = await planned();
  const a = await X.studioPostAct('med', date, 'post1', 'pic', { deps }); assert.deepEqual([a.ok, a.pending], [true, 'comment']); assert.match(log.notify.at(-1).t, /Что изменить в картинке[\s\S]*Текст останется прежним/); assert.equal(log.spawn.length, 0);
  await X.studioPostAct('med', date, 'post1', 'pic', { deps, comment: ' без банки ' }); assert.deepEqual(log.spawn.at(-1), ['cover', 'med', date, 'post1', '--comment', 'без банки']); assert.match(log.notify.at(-1).t, /Диана перерисует картинку[\s\S]*Текст не трогаю/);
  await X.studioPostAct('med', date, 'post2', 'pic0', { deps }); assert.deepEqual(log.spawn.at(-1), ['cover', 'med', date, 'post2']); assert.ok(!log.spawn.some((a) => a[0] === 'post'), 'Дарья не запускалась');
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
  const labels = log.runs.map((x) => x.label); assert.deepEqual(labels.filter((l) => !/scout/.test(l)), ['author1', 'author2', 'editor2', 'author3', 'editor3'], 'редактора не зовут, пока код видит нарушение');
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
  const day = nextDate(); const pl2 = mk({ ...FX() }); await X.studioPlan('med', { date: day, deps: pl2.deps });
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

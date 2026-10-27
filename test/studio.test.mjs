// Студия: выбор трёх разных тем, самая востребованная на ролик; план дня; реестр. Без сети, реестр во временной папке.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.OFFICE_STUDIO_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-'));
const S = await import('../scripts/studio.mjs');
const C = (title, reach, extra = {}) => ({ title, demand: { reach, line: `охват ${reach}` }, evidence: [{ source: 'x' }], ...extra });

test('самая востребованная тема идёт на ролик, следующие две на посты', () => {
  const p = S.pickDayTopics([C('Гомеопатия работает?', 10), C('Эффект Моцарта делает умнее?', 4), C('Давление можно почувствовать по самочувствию?', 17), C('Хруст пальцев вызывает артрит?', 6)]);
  assert.equal(p.video.title, 'Давление можно почувствовать по самочувствию?');
  assert.deepEqual(p.posts.map((x) => x.title), ['Гомеопатия работает?', 'Хруст пальцев вызывает артрит?']);
  assert.equal(p.missing, 0); assert.equal(p.spare.length, 1);
});
test('похожие по смыслу темы одного дня не берутся вместе: вторая похожая пропускается', () => {
  const p = S.pickDayTopics([C('Правда ли, что лёгкие сигареты менее вредны?', 20), C('Лёгкие сигареты менее вредны для здоровья?', 19), C('Гомеопатия работает?', 8), C('Хруст пальцев вызывает артрит?', 5)]);
  assert.deepEqual([p.video.title, ...p.posts.map((x) => x.title)], ['Правда ли, что лёгкие сигареты менее вредны?', 'Гомеопатия работает?', 'Хруст пальцев вызывает артрит?']);
});
test('уже занятые темы (ролики, посты, лента канала) не попадают в день', () => {
  const p = S.pickDayTopics([C('Нужно ходить ровно десять тысяч шагов в день?', 25), C('Гомеопатия работает?', 8), C('Хруст пальцев вызывает артрит?', 5), C('Кофе обезвоживает?', 3)], { taken: ['10 000 шагов в день: обязательно ли ходить?'] });
  assert.ok(!p.video.title.includes('шагов') && !p.posts.some((x) => x.title.includes('шагов')));
});
test('не хватает тем: missing показывает, сколько слотов осталось пустыми; дубли названий схлопываются', () => {
  const p = S.pickDayTopics([C('Гомеопатия работает?', 8), C('гомеопатия работает?', 7)]);
  assert.equal(p.video.title, 'Гомеопатия работает?'); assert.equal(p.posts.length, 0); assert.equal(p.missing, 2);
  assert.deepEqual(S.pickDayTopics([]), { video: null, posts: [], spare: [], missing: 3 });
});
test('при равном охвате выше тема с большим числом первоисточников; без замера охват 0', () => {
  const p = S.pickDayTopics([{ title: 'Сколько спать взрослому человеку', demand: { reach: 5 }, evidence: [{}] }, { title: 'Пить воду натощак по утрам', demand: { reach: 5 }, evidence: [{}, {}, {}] }, { title: 'Ходьба шагами каждый вечер', evidence: [{}, {}, {}, {}] }]);
  assert.equal(p.video.title, 'Пить воду натощак по утрам'); assert.equal(p.posts[1].title, 'Ходьба шагами каждый вечер', 'без замера охват 0: тема в конце, хотя источников больше');
});

test('план дня: слоты по времени МСК (пост 12:00, ролик 18:30, пост 19:00) и момент выхода в мс', () => {
  const picks = S.pickDayTopics([C('Давление и самочувствие', 17, { queries: ['давление симптомы'] }), C('Гомеопатия работает?', 10), C('Хруст пальцев и артрит', 6)]);
  const plan = S.buildPlan({ date: '2026-10-28', channel: 'med_detective', picks, now: 1 });
  assert.deepEqual(plan.slots.map((s) => [s.slot, s.kind, s.time]), [['post1', 'post', '12:00'], ['video', 'video', '18:30'], ['post2', 'post', '19:00']]);
  assert.equal(S.slotOf(plan, 'video').title, 'Давление и самочувствие'); assert.deepEqual(S.slotOf(plan, 'video').queries, ['давление симптомы']);
  assert.equal(new Date(S.slotOf(plan, 'post1').at).toISOString(), '2026-10-28T09:00:00.000Z', '12:00 МСК = 09:00 UTC');
  assert.equal(new Date(S.slotOf(plan, 'video').at).toISOString(), '2026-10-28T15:30:00.000Z');
  assert.equal(S.mskDate(Date.parse('2026-10-28T22:30:00Z')), '2026-10-29', 'после 21:00 UTC в Москве уже следующий день');
});
test('слоты канала можно переопределить, неактивные каналы не попадают', () => {
  const ch = S.studioChannels({ a: { name: 'А', active: true }, b: { name: 'Б', active: false }, c: { name: 'В', active: true, slots: { video: { kind: 'video', time: '17:00' } } } }, { a: { slots: { post1: { kind: 'post', time: '10:00' } }, planAt: '07:30' } });
  assert.deepEqual(Object.keys(ch), ['a', 'c']);
  assert.equal(ch.a.slots.post1.time, '10:00'); assert.equal(ch.a.slots.post2.time, '19:00'); assert.equal(ch.a.planAt, '07:30'); assert.equal(ch.c.slots.video.time, '17:00'); assert.equal(ch.a.lang, 'ru');
});
test('реестр: план сохраняется, слот обновляется, темы планов считаются занятыми (кроме снятых)', () => {
  const picks = S.pickDayTopics([C('Сколько спать взрослому человеку', 9), C('Пить воду натощак по утрам', 8), C('Ходьба шагами каждый вечер', 7)]);
  const plan = S.buildPlan({ date: '2026-10-28', channel: 'med_detective', picks }); S.savePlan(plan);
  assert.equal(S.loadPlan('2026-10-28', 'med_detective').slots.length, 3); assert.equal(S.loadPlan('2026-10-29', 'med_detective'), null);
  S.updateSlot('2026-10-28', 'med_detective', 'post2', { status: 'dropped' });
  assert.equal(S.plannedTitles('med_detective', { now: Date.parse('2026-10-30') }).length, 3, 'снятая тема тоже занята: Ник её уже видел');
  assert.equal(S.archivePlan(S.loadPlan('2026-10-28', 'med_detective')), 1); assert.equal(S.archivePlan(S.loadPlan('2026-10-28', 'med_detective')), 2);
  const plan2 = S.buildPlan({ date: '2026-10-28', channel: 'med_detective', picks: S.pickDayTopics([C('Совсем другая тема про зубы', 9), C('Ещё тема про глаза и зрение', 8), C('Тема про спину и осанку', 7)]) }); S.savePlan(plan2);
  const titles = S.plannedTitles('med_detective', { now: Date.parse('2026-10-30') });
  assert.equal(titles.length, 9, 'новый план + две копии прежнего в архиве: ничего не теряется'); assert.equal(S.plannedTitles('other_channel', { now: Date.parse('2026-10-30') }).length, 0);
  assert.throws(() => S.updateSlot('2026-10-28', 'med_detective', 'nope', {}), /нет слота/);
  assert.equal(S.plannedTitles('med_detective', { now: Date.parse('2027-03-01') }).length, 0, 'старше 45 дней не учитываются');
});
test('карточка плана: три темы по времени, кнопки утвердить / другие / пропустить', () => {
  const picks = S.pickDayTopics([C('Давление и самочувствие', 17), C('Гомеопатия работает?', 10), C('Хруст пальцев и артрит', 6)]);
  const plan = S.buildPlan({ date: '2026-10-28', channel: 'med_detective', picks });
  const t = S.planCardText(plan, 'Медицинский детектив'); const i1 = t.indexOf('12:00'), i2 = t.indexOf('18:30'), i3 = t.indexOf('19:00');
  assert.ok(i1 > 0 && i1 < i2 && i2 < i3, 'порядок по времени'); assert.match(t, /18:30 · 🎬 Ролик Shorts: Давление и самочувствие/);
  assert.deepEqual(S.planButtons(plan).flat().map((b) => b[1]), ['splan:med_detective:2026-10-28:ok', 'splan:med_detective:2026-10-28:more', 'splan:med_detective:2026-10-28:skip']);
});

/* ---- расписание ---- */
const msk = (iso) => Date.parse(iso + '+03:00');
test('настройки студии: по умолчанию автоплан выключен, время 20:00; значения читаются, запись не стирает остальное', () => {
  const f = path.join(process.env.OFFICE_STUDIO_DIR, 'settings_test.json');
  assert.deepEqual(S.studioSettings(f), { autoPlan: false, planAt: '20:00', autoChannels: ['med_detective'], channels: {} });
  fs.writeFileSync(f, '{ сломанный json');
  assert.equal(S.studioSettings(f).autoPlan, false, 'битый файл = значения по умолчанию');
  S.writeStudioSettings({ autoPlan: true, planAt: '7:30' }, f); S.writeStudioSettings({ autoChannels: ['a', 'b'] }, f);
  assert.deepEqual(S.studioSettings(f), { autoPlan: true, planAt: '7:30', autoChannels: ['a', 'b'], channels: {} });
  S.writeStudioSettings({ planAt: 'вечером' }, f); assert.equal(S.studioSettings(f).planAt, '20:00', 'мусор вместо времени не принимается');
});
test('на какой день план: вечернее время даёт завтра, утреннее сегодня', () => {
  const t = msk('2026-12-01T20:30:00');
  assert.equal(S.planDateFor(t, '20:00'), '2026-12-02'); assert.equal(S.planDateFor(t, '08:00'), '2026-12-01'); assert.equal(S.planDateFor(msk('2026-12-31T21:00:00'), '20:00'), '2027-01-01');
});
function planWith(date, ch, statuses, patch = {}) {
  const picks = S.pickDayTopics([C('Тема один про сон', 9), C('Тема два про зубы', 8), C('Тема три про спину', 7)]);
  const plan = S.buildPlan({ date, channel: ch, picks }); plan.slots.forEach((x) => { x.status = statuses[x.slot] || 'planned'; Object.assign(x, patch[x.slot] || {}); }); S.savePlan(plan); return plan;
}
test('что пора выложить: только утверждённые посты, чьё время пришло; ролик, неутверждённое, исчерпанные попытки и отсрочки не берутся', () => {
  planWith('2026-12-05', 'sched_a', { post1: 'approved', video: 'approved', post2: 'preview' });
  assert.deepEqual(S.dueSlots(msk('2026-12-05T11:59:00')), []);
  assert.deepEqual(S.dueSlots(msk('2026-12-05T12:00:30')).map((d) => [d.chKey, d.slot]), [['sched_a', 'post1']], 'ролик (kind video) в эфир этим сторожем не выходит');
  planWith('2026-12-06', 'sched_b', { post1: 'approved', post2: 'approved' }, { post1: { attempts: 3 }, post2: { retry_at: msk('2026-12-06T19:10:00') } });
  const of = (t, ch) => S.dueSlots(t).filter((d) => d.chKey === ch).map((d) => d.slot);
  assert.deepEqual(of(msk('2026-12-06T19:05:00'), 'sched_b'), [], 'три попытки исчерпаны, вторая ждёт повтора');
  assert.deepEqual(of(msk('2026-12-06T19:11:00'), 'sched_b'), ['post2']);
  planWith('2026-12-01', 'sched_c', { post1: 'approved' });
  assert.deepEqual(S.dueSlots(msk('2026-12-05T10:00:00')).filter((d) => d.chKey === 'sched_c'), [], 'план трёхдневной давности не трогаем');
  assert.deepEqual(S.dueSlots(msk('2026-12-02T01:00:00')).filter((d) => d.chKey === 'sched_c').map((d) => d.slot), ['post1'], 'вчерашний пост, не вышедший вовремя, ещё догоняется');
  assert.equal(S.hasDue(msk('2026-12-05T12:30:00')), true); assert.equal(S.hasDue(msk('2026-11-30T12:30:00')), false);
});
test('автоплан: выключен ничего не делает; включён — собирает после времени плана один раз, не чаще чем раз в 90 минут и не более двух попыток', () => {
  const on = { autoPlan: true, planAt: '20:00', autoChannels: ['auto_x'], channels: {} };
  assert.deepEqual(S.autoPlanTargets(msk('2026-12-10T20:30:00'), { ...on, autoPlan: false }), []);
  assert.deepEqual(S.autoPlanTargets(msk('2026-12-10T19:59:00'), on), [], 'до времени плана рано');
  const t1 = msk('2026-12-10T20:05:00');
  assert.deepEqual(S.autoPlanTargets(t1, on), [{ ch: 'auto_x', date: '2026-12-11' }]);
  S.markTried('2026-12-11', 'auto_x', t1);
  assert.deepEqual(S.autoPlanTargets(t1 + 30 * 60e3, on), [], 'после попытки 90 минут тишины: поиск мог ещё идти');
  assert.equal(S.autoPlanTargets(t1 + 95 * 60e3, on).length, 1, 'через полтора часа вторая попытка, если плана нет');
  S.markTried('2026-12-11', 'auto_x', t1 + 95 * 60e3); assert.deepEqual(S.autoPlanTargets(t1 + 200 * 60e3, on), [], 'двух попыток в сутки достаточно');
  const on2 = { ...on, autoChannels: ['auto_y'], channels: { auto_y: { planAt: '07:00' } } };
  assert.deepEqual(S.autoPlanTargets(msk('2026-12-10T07:10:00'), on2), [{ ch: 'auto_y', date: '2026-12-10' }], 'у канала своё время, утренний план на сегодня');
  assert.deepEqual(S.autoPlanTargets(msk('2026-12-10T16:00:00'), on2), [], 'позже 8 часов после времени плана не запускаем (перезапуск офиса ночью не должен будить поиск)');
  planWith('2026-12-12', 'auto_z', {}); assert.deepEqual(S.autoPlanTargets(msk('2026-12-11T20:10:00'), { ...on, autoChannels: ['auto_z'] }), [], 'план на день уже есть');
});

/* ---- единый план: варианты, выбор, карточка ---- */
const VID = ['Гомеопатия работает лучше плацебо?', 'Эффект Моцарта делает детей умнее?', 'Давление можно почувствовать по самочувствию?', 'Хруст пальцев вызывает артрит?', 'Кофе обезвоживает организм?', 'Полнолуние влияет на психику людей?'];
const PST = ['Быстрая ходьба продлевает жизнь?', 'Мобильный телефон вызывает рак мозга?', 'Восемь стаканов воды в день обязательны?', 'Чтение в темноте портит зрение навсегда?', 'Сахар делает детей гиперактивными?', 'Витамин С лечит простуду быстрее?'];
const V = (title, reach) => ({ title, demand: { reach, index: reach / 25, youtube: { n: 12, median: 2800, max: 54005351, hits: 3 }, suggest: { google: 3, youtube: 4 }, wiki: { last30: 351 }, trends: { matched: [{ title: 'Хруст костей' }] } }, evidence: [{ url: 'https://a.org/1' }], clear_answer: true });
const Pp = (title, freshness, index = 0.3, hosts = 1) => ({ title, freshness, demand: { index }, evidence: Array.from({ length: hosts }, (_, i) => ({ url: `https://h${i}.org/x` })), clear_answer: true, from_sources: true, sources_meta: [{ name: 'ВОЗ', date: Date.parse('2026-12-18T12:00:00Z') }] });
const mkPlan = () => S.newDayPlan({ date: '2026-12-20', channel: 'plan_unit', options: S.makeOptions({ video: VID.map((x, i) => V(x, 20 - i * 3)), posts: PST.map((x, i) => Pp(x, 3 - (i % 3), 0.5 - i * 0.05)) }), slots: S.DEFAULT_SLOTS, now: Date.parse('2026-12-19T10:00:00Z') });

test('варианты: видео по охвату, посты по свежести и числу источников; четыре и пять в списке, остальное в запасе; занятые и почти одинаковые отсеяны', () => {
  const o = S.makeOptions({ video: VID.map((x, i) => V(x, i)), posts: [Pp('Свежий пост', 3, 0.1, 1), Pp('Старый пост с интересом', 0, 0.9, 1), Pp('Свежий с тремя источниками', 3, 0.1, 3)], taken: ['Кофе обезвоживает организм?'] });
  assert.equal(o.video.length, 4); assert.equal(o.video_spare.length, 1); assert.ok(!o.video.concat(o.video_spare).some((c) => /Кофе/.test(c.title)), 'занятая тема отсеяна'); assert.equal(o.video[0].title, VID[5]);
  assert.deepEqual(o.posts.map((c) => c.title), ['Свежий с тремя источниками', 'Свежий пост', 'Старый пост с интересом']);
  const dup = S.makeOptions({ video: [V('Лёгкие сигареты менее вредны для здоровья?', 9), V('Лёгкие сигареты менее вредны для вас?', 8), V(VID[0], 7)] }); assert.equal(dup.video.length, 2, 'почти одинаковые внутри списка не показываются дважды');
});
test('выбор по умолчанию и слоты: лучшее видео и два лучших непохожих поста; первый пост в 12:00, второй в 19:00, ролик в 18:30', () => {
  const plan = mkPlan(); assert.deepEqual(plan.selection, { video: 0, posts: [0, 1] }); assert.deepEqual(plan.slots.map((s) => [s.slot, s.time, s.title]), [['post1', '12:00', plan.options.posts[0].title], ['video', '18:30', VID[0]], ['post2', '19:00', plan.options.posts[1].title]]);
  assert.equal(S.selectionComplete(plan), true);
  const o = S.makeOptions({ video: [V('Лёгкие сигареты менее вредны для здоровья?', 20)], posts: [Pp('Правда ли, что лёгкие сигареты менее вредны?', 3), Pp(PST[0], 2), Pp(PST[1], 1)] });
  assert.deepEqual(S.defaultSelection(o), { video: 0, posts: [1, 2] }, 'пост, похожий на видео, по умолчанию не берётся');
});
test('кнопки выбора: видео заменяет, пост снимается повторным нажатием, третий вытесняет давнего, похожее отклоняется с объяснением', () => {
  const plan = mkPlan();
  assert.equal(S.applyChoice(plan, 'v3').ok, true); assert.equal(plan.selection.video, 2); assert.equal(plan.slots.find((s) => s.slot === 'video').title, VID[2]);
  assert.equal(S.applyChoice(plan, 'p1').ok, true); assert.deepEqual(plan.selection.posts, [1]); assert.equal(S.selectionComplete(plan), false); assert.match(S.missingText(plan), /ещё один пост/);
  S.applyChoice(plan, 'p3'); S.applyChoice(plan, 'p4'); assert.deepEqual(plan.selection.posts, [2, 3]);
  assert.equal(S.applyChoice(plan, 'p9').ok, false); assert.equal(S.applyChoice(plan, 'x1').ok, false); assert.equal(S.applyChoice(plan, 'v7').ok, false);
  const sim = S.newDayPlan({ date: '2026-12-21', channel: 'plan_unit', options: S.makeOptions({ video: [V('Лёгкие сигареты менее вредны для здоровья?', 20), V(VID[0], 5)], posts: [Pp(PST[0], 3), Pp('Правда ли, что лёгкие сигареты менее вредны?', 2), Pp(PST[1], 1)] }) });
  const r = S.applyChoice(sim, 'p2'); assert.equal(r.ok, false); assert.match(r.error, /слишком похож на выбранное видео/); assert.deepEqual(sim.selection.posts, [0, 2]);
  const r2 = S.setSelection(sim, { video: 2 }); assert.equal(r2.ok, true); assert.equal(S.applyChoice(sim, 'p2').ok, true, 'после смены видео пост уже не конфликтует'); assert.equal(S.applyChoice(sim, 'v1').ok, false);
});
test('выбор целиком (текст Ника): номера с единицы, не больше двух постов, чего нет — как было', () => {
  const plan = mkPlan(); assert.equal(S.setSelection(plan, { video: 3, posts: [1, 4] }).ok, true); assert.deepEqual([plan.selection.video, plan.selection.posts], [2, [0, 3]]);
  assert.equal(S.setSelection(plan, { video: null, posts: [2] }).ok, true); assert.deepEqual([plan.selection.video, plan.selection.posts], [2, [1]]);
  assert.equal(S.setSelection(plan, { posts: [1, 2, 3] }).ok, false); assert.equal(S.setSelection(plan, { video: 9 }).ok, false); assert.equal(S.setSelection(plan, { posts: [9] }).ok, false);
});
test('другие варианты: запас показывается вместо старых, выбор пересчитывается, новый поиск не возвращает показанное', () => {
  const plan = S.newDayPlan({ date: '2026-12-22', channel: 'plan_unit', options: S.makeOptions({ video: VID.map((x, i) => V(x, 20 - i)), posts: PST.map((x, i) => Pp(x, 2, 0.5 - i * 0.05)) }) });
  const shown = plan.options.posts.map((c) => c.title); assert.equal(plan.options.posts_spare.length, 1);
  const r = S.replaceOptions(plan, 'posts', []); assert.equal(r.ok, true); assert.deepEqual(plan.options.posts.map((c) => c.title), [PST[5]]); assert.equal(plan.options.posts_spare.length, 0); assert.equal(plan.selection.posts.length, 1);
  assert.equal(S.replaceOptions(plan, 'posts', []).ok, false, 'запас пуст и новых нет: ничего не меняется');
  const fresh = S.replaceOptions(plan, 'posts', [Pp('Совсем новая тема про сон и усталость', 3, 0.8), Pp(shown[0], 3, 0.9)]);
  assert.equal(fresh.ok, true); assert.ok(!plan.options.posts.some((c) => c.title === shown[0]), 'показанная ранее тема не вернулась'); assert.equal(plan.options.posts[0].title, 'Совсем новая тема про сон и усталость');
  assert.equal(plan.options.video.length, 4, 'видео не тронуто');
});
test('карточка: варианты видео и постов с цифрами спроса, тренд, источник; уложена в сообщение Telegram; кнопки выбора с отметкой', () => {
  const plan = mkPlan(), text = S.planCardTextV2(plan, 'Медицинский детектив', { now: Date.parse('2026-12-19T12:00:00Z') }).replace(/\u00a0/g, ' ');
  assert.match(text, /📅 План дня · «Медицинский детектив» · 2026-12-20/); assert.match(text, /🎬 ВИДЕО в 18:30/); assert.match(text, /📝 ПОСТЫ в 12:00 и 19:00/);
  assert.match(text, /1\. ✅ Гомеопатия/); assert.match(text, /охват 20\/25 · Shorts: 12 роликов, медиана 2,8 тыс\., лучший 54 млн, от 100 тыс\.: 3 · подсказки 7\/20 · Вики 351\/мес · 🔥 в трендах Google: «Хруст костей»/);
  assert.match(text, /📰 ВОЗ, вчера · 📊 интерес \d+%/); assert.match(text, /Выбрано: видео 1; посты 1 и 2 \(первый в 12:00, второй в 19:00\)/); assert.ok(text.length < 3900);
  const rows = S.planButtonsV2(plan); assert.match(rows[0][0][0], /✅ Утвердить: видео 1 \+ посты 1, 2/); assert.equal(rows[1][0][0], '🎬 1 ✅'); assert.equal(rows[2][1][0], '📝 2 ✅'); assert.equal(rows[2][2][0], '📝 3');
  assert.equal(S.planButtonsV2(plan, { busy: true }).flat().some((b) => /more/.test(b[1])), false);
  S.applyChoice(plan, 'p1'); assert.match(S.planButtonsV2(plan)[0][0][0], /Выберите: ещё один пост/); assert.match(S.planCardTextV2(plan, 'К', { note: '⚠️ пояснение' }), /⚠️ пояснение/);
  const long = S.newDayPlan({ date: '2026-12-23', channel: 'plan_unit', options: S.makeOptions({ video: VID.slice(0, 4).map((x) => ({ ...V('Очень длинная тема ' + x.repeat(3), 20), why: 'почему '.repeat(40) })), posts: PST.slice(0, 5).map((x) => ({ ...Pp('Очень длинный пост ' + x.repeat(3), 3), sources_meta: [{ name: 'Источник с очень длинным названием '.repeat(2), date: 0 }] })) }) });
  assert.ok(S.planCardTextV2(long, 'К').length <= 3900, 'длинные темы не выводят карточку за предел сообщения Telegram');
});
test('блокировка плана: правки идут по очереди, зависшая блокировка снимается', async () => {
  const order = []; await Promise.all([1, 2, 3].map((n) => S.withPlanLock('2026-12-24', 'lock_ch', async () => { order.push('s' + n); await new Promise((r) => setTimeout(r, 30)); order.push('e' + n); })));
  assert.deepEqual(order.map((x) => x[0]).join(''), 'sesese', 'без перекрытия');
  fs.writeFileSync(S.planFile('2026-12-25', 'lock_ch') + '.lock', String(Date.now() - 5 * 60e3)); await S.withPlanLock('2026-12-25', 'lock_ch', async () => order.push('stale-ok')); assert.equal(order.at(-1), 'stale-ok');
  fs.writeFileSync(S.planFile('2026-12-26', 'lock_ch') + '.lock', String(Date.now())); await assert.rejects(() => S.withPlanLock('2026-12-26', 'lock_ch', async () => {}, { waitMs: 150 }), /занят/);
});

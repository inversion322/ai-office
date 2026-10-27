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
  const titles = S.plannedTitles('med_detective', { now: Date.parse('2026-10-30') });
  assert.equal(titles.length, 2); assert.throws(() => S.updateSlot('2026-10-28', 'med_detective', 'nope', {}), /нет слота/);
  assert.equal(S.plannedTitles('med_detective', { now: Date.parse('2027-03-01') }).length, 0, 'старше 45 дней не учитываются');
});
test('карточка плана: три темы по времени, кнопки утвердить / другие / пропустить', () => {
  const picks = S.pickDayTopics([C('Давление и самочувствие', 17), C('Гомеопатия работает?', 10), C('Хруст пальцев и артрит', 6)]);
  const plan = S.buildPlan({ date: '2026-10-28', channel: 'med_detective', picks });
  const t = S.planCardText(plan, 'Медицинский детектив'); const i1 = t.indexOf('12:00'), i2 = t.indexOf('18:30'), i3 = t.indexOf('19:00');
  assert.ok(i1 > 0 && i1 < i2 && i2 < i3, 'порядок по времени'); assert.match(t, /18:30 · 🎬 Ролик Shorts: Давление и самочувствие/);
  assert.deepEqual(S.planButtons(plan).flat().map((b) => b[1]), ['splan:med_detective:2026-10-28:ok', 'splan:med_detective:2026-10-28:more', 'splan:med_detective:2026-10-28:skip']);
});

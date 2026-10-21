import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { similarity, findDuplicate, splitNew, tokens } from '../scripts/topic_dedupe.mjs';
import { parsePosts, titleOf, channelTitles } from '../scripts/channel_feed.mjs';

test('одна и та же тема другими словами считается повтором (числа словами, склонения, порядок слов)', () => {
  const pairs = [
    ['Нужно ходить ровно десять тысяч шагов в день?', '10 000 шагов в день: обязательно ли ходить?'],
    ['Нужно пить два литра воды в день?', 'Сколько воды пить в день: правда ли два литра?'],
    ['Холод и мокрые волосы вызывают простуду?', 'Можно ли простудиться от мокрых волос на холоде?'],
    ['Кофе перед дневным сном — бессмыслица?', 'Правда ли, что кофе перед сном полезен?'],
  ];
  for (const [a, b] of pairs) assert.ok(similarity(a, b) >= 0.6, `${a} <> ${b}: ${similarity(a, b)}`);
});
test('разные темы не принимаются за повтор (в том числе близкие по области)', () => {
  const pairs = [
    ['Антибиотики помогают от простуды и ОРВИ?', 'Витамин C спасает от простуды?'],
    ['Хруст пальцами приводит к артриту?', 'Яйца повышают холестерин и вредят сердцу?'],
    ['Магний от судорог ночью: работает ли?', 'Мёд лучше сахара при диабете?'],
    ['Сахар делает детей гиперактивными?', 'Сахар вызывает диабет?'],
  ];
  for (const [a, b] of pairs) assert.ok(similarity(a, b) < 0.6, `${a} <> ${b}: ${similarity(a, b)}`);
});
test('«10 000» с пробелом, неразрывным пробелом и словами даёт один и тот же токен', () => {
  for (const s of ['10 000 шагов', '10\u00a0000 шагов', '10000 шагов', 'десять тысяч шагов']) assert.ok(tokens(s).has('10000'), s);
});
test('splitNew: повторы и существующих тем, и внутри самой пачки отсеиваются, новые остаются порядком', () => {
  const r = splitNew([{ title: 'Нужно ходить десять тысяч шагов в день?' }, { title: 'Магний от судорог ночью: работает ли?' }, { title: 'Работает ли магний от ночных судорог?' }, { title: 'Холодный душ укрепляет иммунитет?' }], ['10 000 шагов в день: обязательно ли?']);
  assert.deepEqual(r.fresh.map((c) => c.title), ['Магний от судорог ночью: работает ли?', 'Холодный душ укрепляет иммунитет?']);
  assert.equal(r.dropped.length, 2); assert.ok(r.dropped.every((d) => d.match && d.score >= 0.6));
});
test('пустые и слишком короткие названия не дают ложных совпадений', () => {
  assert.equal(similarity('', 'что-то про сон'), 0); assert.equal(findDuplicate('Сон', ['Сон']).dup, false); assert.equal(findDuplicate('Магний от судорог', []).dup, false);
});

const HTML = `<div class="tgme_widget_message_wrap"><div class="tgme_widget_message js-widget_message" data-post="med_detective_ru/68"><div class="tgme_widget_message_text js-message_text" dir="auto">Не спали всю ночь? Вот как быстро вернуть память и фокус 🧠<br/>🚫 МИФ: если не спать сутки&nbsp;— мозг теряет способность</div><a class="tgme_widget_message_date"><time datetime="2026-08-28T09:00:33+00:00"></time></a></div></div>
<div class="tgme_widget_message_wrap"><div class="tgme_widget_message js-widget_message" data-post="med_detective_ru/69"><div class="tgme_widget_message_text js-message_text" dir="auto">Что на самом деле бежит по нашим нервам вместо электричества? ⚡️❌ МИФ: поток электронов</div><a class="tgme_widget_message_date"><time datetime="2026-08-29T09:00:17+00:00"></time></a></div></div>
<div class="tgme_widget_message_wrap"><div class="tgme_widget_message js-widget_message" data-post="med_detective_ru/70"><div class="tgme_widget_message_photo_wrap"></div></div></div>`;
test('разбор публичной ленты Telegram: тема поста вырезается до метки МИФ/эмодзи, посты без текста пропускаются', () => {
  const p = parsePosts(HTML); assert.deepEqual(p.map((x) => x.id), [68, 69]);
  assert.equal(p[0].title, 'Не спали всю ночь?'); assert.equal(p[1].title, 'Что на самом деле бежит по нашим нервам вместо электричества?');
  assert.equal(titleOf('Без вопроса и без метки просто текст поста'), 'Без вопроса и без метки просто текст поста');
});
test('channelTitles: свежий кэш не ходит в сеть; при сбое сети берётся прежний кэш; без кэша и сети пусто и без падения', async () => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'feed-')), 'feed.json');
  const net = async () => ({ ok: true, text: async () => HTML });
  const a = await channelTitles('x', { file: f, fetchImpl: net }); assert.deepEqual([a.source, a.titles.length], ['network', 2]);
  const b = await channelTitles('x', { file: f, fetchImpl: async () => { throw new Error('сеть не должна вызываться'); } }); assert.equal(b.source, 'cache');
  const c = await channelTitles('x', { file: f, ttlMs: -1, fetchImpl: async () => { throw new Error('нет сети'); } }); assert.deepEqual([c.source, c.titles.length], ['stale-cache', 2]);
  const d = await channelTitles('y', { file: f + '.нет', fetchImpl: async () => { throw new Error('нет сети'); } }); assert.deepEqual([d.source, d.titles], ['none', []]);
});

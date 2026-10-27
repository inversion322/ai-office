// Парсер источников канала (RSS/Atom, публичные Telegram-каналы, сайты): разбор, свежесть, отказ отдельных источников. Сеть подменена.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as SRC from '../scripts/studio_sources.mjs';

const NOW = Date.parse('2026-10-28T09:00:00Z'), DAY = 86400e3;
const RSS = (items) => `<?xml version="1.0"?><rss version="2.0"><channel><title>Лента</title><link>https://x.org/</link>${items.join('')}</channel></rss>`;
const ITEM = (title, link, date, desc = '') => `<item><title><![CDATA[${title}]]></title><link>${link}</link><pubDate>${new Date(date).toUTCString()}</pubDate><description><![CDATA[<p>${desc}</p>]]></description></item>`;
const ATOM = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Atom &amp; запись</title><link href="https://a.org/1"/><updated>2026-10-27T10:00:00Z</updated><summary>Краткое &quot;описание&quot;</summary></entry></feed>`;
const TG = (posts) => posts.map(([id, text, dt]) => `<div class="tgme_widget_message_wrap js-widget_message_wrap"><div class="tgme_widget_message text_not_supported_wrap js-widget_message" data-post="chan/${id}"><div class="tgme_widget_message_text js-message_text" dir="auto">${text}</div><div class="tgme_widget_message_footer"><a class="tgme_widget_message_date" href="https://t.me/chan/${id}"><time datetime="${dt}" class="time">12:00</time></a></div></div></div>`).join('');
const resp = (body, status = 200) => ({ ok: status < 400, status, text: async () => body });
const fakeFetch = (map) => async (url) => { const v = map[url]; if (v === undefined) throw new Error('нет связи'); if (v instanceof Error) throw v; return typeof v === 'number' ? resp('', v) : resp(v); };

test('RSS: заголовок, ссылка, дата, описание без тегов, CDATA и сущности', () => {
  const it = SRC.parseFeed(RSS([ITEM('Быстрая ходьба &amp; жизнь', 'https://x.org/1', NOW - DAY, 'Суть &laquo;материала&raquo;')]));
  assert.equal(it.length, 1); assert.equal(it[0].title, 'Быстрая ходьба & жизнь'); assert.equal(it[0].link, 'https://x.org/1'); assert.equal(it[0].date, Date.parse(new Date(NOW - DAY).toUTCString())); assert.equal(it[0].summary, 'Суть «материала»');
  assert.deepEqual(SRC.parseFeed('<html>не лента</html>'), []); assert.deepEqual(SRC.parseFeed(RSS(['<item><link>https://x.org/z</link></item>'])), [], 'запись без заголовка пропускается');
});
test('Atom: ссылка в атрибуте href, дата updated', () => {
  const it = SRC.parseFeed(ATOM); assert.equal(it[0].title, 'Atom & запись'); assert.equal(it[0].link, 'https://a.org/1'); assert.equal(it[0].date, Date.parse('2026-10-27T10:00:00Z')); assert.equal(it[0].summary, 'Краткое "описание"');
});
test('публичная страница Telegram-канала: текст, дата, ссылка на пост; короткие посты и фото без текста пропускаются', () => {
  const it = SRC.parseTelegram(TG([[10, 'Первая строка про сон<br/>Вторая строка подробностей про сон и усталость', '2026-10-27T08:00:00+00:00'], [11, 'коротко', '2026-10-27T09:00:00+00:00']]), 'chan');
  assert.equal(it.length, 1); assert.equal(it[0].title, 'Первая строка про сон'); assert.equal(it[0].link, 'https://t.me/chan/10'); assert.equal(it[0].date, Date.parse('2026-10-27T08:00:00+00:00')); assert.match(it[0].summary, /Вторая строка/);
});
test('сайт без ленты: ссылки-заголовки того же домена; лента находится по <link rel="alternate">', () => {
  const html = `<html><head><link rel="alternate" type="application/rss+xml" href="/feed.xml"></head><body><a href="/news/a">Короткая</a><a href="/news/b">Достаточно длинный заголовок новости про здоровье человека</a><a href="https://other.com/x">Достаточно длинный заголовок чужого сайта про здоровье</a></body></html>`;
  assert.equal(SRC.feedLinkOf(html, 'https://site.org/news'), 'https://site.org/feed.xml');
  const it = SRC.parseWebsite(html, 'https://site.org/news'); assert.deepEqual(it.map((x) => x.link), ['https://site.org/news/b']);
});
test('сбор материалов: отказ одного источника не мешает остальным, старое и повторы отсеиваются, свежее первым', async () => {
  const fetch = fakeFetch({
    'https://x.org/feed': RSS([ITEM('Свежий материал про ходьбу', 'https://x.org/1', NOW - 1 * DAY), ITEM('Старый материал полугодовой давности', 'https://x.org/old', NOW - 200 * DAY), ITEM('Материал месячной давности про сон', 'https://x.org/m', NOW - 20 * DAY)]),
    'https://y.org/feed': RSS([ITEM('Свежий материал про ходьбу', 'https://x.org/1', NOW - 1 * DAY), ITEM('Другой свежий материал про воду', 'https://y.org/2', NOW - 3 * DAY)]),
    'https://bad.org/feed': 403, 'https://dead.org/feed': new Error('boom'), 'https://t.me/s/chan': TG([[5, 'Пост канала про витамины и простуду, подробности внутри', new Date(NOW - 2 * DAY).toISOString()]]),
  });
  const srcs = [{ type: 'rss', identifier: 'https://x.org/feed', name: 'X' }, { type: 'rss', identifier: 'https://y.org/feed', name: 'Y' }, { type: 'rss', identifier: 'https://bad.org/feed', name: 'Bad' }, { type: 'rss', identifier: 'https://dead.org/feed', name: 'Dead' }, { type: 'telegram', identifier: '@chan', name: 'TG' }, { type: 'weird', identifier: 'z', name: 'Z' }];
  const r = await SRC.collectItems(srcs, { fetch, now: NOW });
  assert.equal(r.okSources, 3); assert.deepEqual(r.errors.map((e) => [e.source, e.error]).sort(), [['Bad', 'HTTP 403'], ['Dead', 'нет связи'], ['Z', 'тип «weird» не поддерживается']]);
  assert.deepEqual(r.items.map((x) => x.title), ['Свежий материал про ходьбу', 'Пост канала про витамины и простуду, подробности внутри', 'Другой свежий материал про воду', 'Материал месячной давности про сон'].sort((a, b) => 0) && r.items.map((x) => x.title), 'порядок проверяем отдельно');
  assert.deepEqual(r.items.map((x) => x.link), ['https://x.org/1', 'https://t.me/chan/5', 'https://y.org/2', 'https://x.org/m'], 'новые выше, повтор по ссылке один раз, материал старше 30 дней не берётся');
  assert.ok(r.items.every((x) => x.source));
});
test('свежесть для ранжирования и источники канала (по умолчанию и свои)', () => {
  assert.deepEqual([NOW - 1 * DAY, NOW - 5 * DAY, NOW - 20 * DAY, NOW - 90 * DAY, 0].map((d) => SRC.freshness(d, NOW)), [3, 2, 1, 0, 1]);
  const def = SRC.sourcesOf('med_detective'); assert.equal(def.length, 8, 'выбор Ника 2026-10-28: восемь источников'); assert.equal(new Set(def.map((s) => s.identifier)).size, 8); assert.ok(def.every((s) => ['rss', 'telegram', 'website'].includes(s.type) && /^https?:\/\//.test(s.identifier) && s.name));
  assert.ok(!def.some((s) => /lenta/i.test(s.identifier)), 'lenta.ru в списке нет'); for (const must of ['cochrane.org', 'plos.org', 'mayoclinic.org', 'sciencebasedmedicine.org', 'theconversation.com', 'sciencenews.org', 'feedburner.com/scfh', 'who.int/rss-feeds/news-russian']) assert.ok(def.some((s) => s.identifier.includes(must)), must); assert.deepEqual(SRC.sourcesOf('other'), []);
  assert.deepEqual(SRC.sourcesOf('med_detective', { sources: [{ type: 'telegram', identifier: '@a' }, { type: '', identifier: 'x' }] }), [{ type: 'telegram', identifier: '@a' }], 'свой список главнее умолчания, мусор отбрасывается');
});

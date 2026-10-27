// Источники канала для постов (решение Ника 2026-10-28: «для постов парсер тем по источникам, подключённым к каналу»).
// Типы те же, что в WorkFlow AI: telegram (публичный канал, страница t.me/s/<имя>), rss (RSS/Atom), website (сайт: ищем ленту, иначе заголовки ссылок).
// Только Node, без пакетов. Любой источник может отказать: тогда он попадает в errors, остальные работают. Функции не бросают исключений.
import fs from 'node:fs';
import path from 'node:path';
import { studioDir } from './studio.mjs';

const UA = 'Mozilla/5.0 (compatible; AIOfficeTopicResearch/1.0)';       // с адресом проекта в User-Agent Mayo Clinic отвечает 403
const DAY = 86400e3;

/** Источники по умолчанию. Для канала «Медицинский детектив» (выбор Ника 2026-10-28, проверены живьём): доказательность (Cochrane, PLOS Medicine), клиника (Mayo), разборы мифов (Science-Based Medicine, The Conversation), научная журналистика (Science News), по-русски (СО РАН, ВОЗ); lenta.ru в этом списке никогда не было (она в отслеживании WorkFlow AI); свой список Ник задаёт в server/data/studio.json (channels.<канал>.sources). */
export const DEFAULT_SOURCES = {
  med_detective: [
    { type: 'rss', identifier: 'https://www.cochrane.org/news/rss', name: 'Cochrane, новости' },
    { type: 'rss', identifier: 'https://journals.plos.org/plosmedicine/feed/atom', name: 'PLOS Medicine' },
    { type: 'rss', identifier: 'https://newsnetwork.mayoclinic.org/feed/', name: 'Mayo Clinic, новости' },
    { type: 'rss', identifier: 'https://sciencebasedmedicine.org/feed/', name: 'Science-Based Medicine' },
    { type: 'rss', identifier: 'https://theconversation.com/us/health/articles.atom', name: 'The Conversation: здоровье' },
    { type: 'rss', identifier: 'https://www.sciencenews.org/topic/health-medicine/feed', name: 'Science News: здоровье' },
    { type: 'rss', identifier: 'http://feeds.feedburner.com/scfh/news', name: 'Наука из первых рук (СО РАН)' },
    { type: 'rss', identifier: 'https://www.who.int/rss-feeds/news-russian.xml', name: 'ВОЗ на русском' },
  ],
};
export const sourcesOf = (chKey, chCfg = {}) => (Array.isArray(chCfg.sources) && chCfg.sources.length ? chCfg.sources : DEFAULT_SOURCES[chKey] || []).filter((s) => s && s.type && s.identifier);

/* ---------------- разбор текста ---------------- */
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', laquo: '«', raquo: '»', ndash: '–', mdash: '—', hellip: '…' };
export const decode = (s) => String(s || '').replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d))).replace(/&([a-z]+);/gi, (m, n) => ENT[n.toLowerCase()] ?? m);
export const stripTags = (s) => decode(String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li)>/gi, '\n').replace(/<[^>]+>/g, ' ')).replace(/[ \t\u00a0]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
const tagText = (block, name) => { const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i').exec(block); return m ? stripTags(m[1]) : ''; };
const toMs = (s) => { const t = Date.parse(String(s || '').trim()); return Number.isFinite(t) ? t : 0; };

/** RSS 2.0 и Atom -> [{ title, link, date (мс, 0 если нет), summary }]. */
export function parseFeed(xml) {
  const out = [], text = String(xml || '');
  for (const m of text.matchAll(/<(item|entry)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi)) {
    const b = m[2], title = tagText(b, 'title'); if (!title) continue;
    let link = tagText(b, 'link');
    if (!link) { const a = /<link\b[^>]*\bhref=["']([^"']+)["'][^>]*>/i.exec(b); link = a ? decode(a[1]) : ''; }
    if (!link) link = tagText(b, 'guid');
    const date = toMs(tagText(b, 'pubDate') || tagText(b, 'published') || tagText(b, 'updated') || tagText(b, 'dc:date'));
    const summary = (tagText(b, 'description') || tagText(b, 'summary') || tagText(b, 'content:encoded') || tagText(b, 'content')).slice(0, 700);
    out.push({ title: title.slice(0, 300), link: /^https?:\/\//i.test(link) ? link : '', date, summary });
  }
  return out;
}
/** Публичная страница канала https://t.me/s/<имя> -> посты (первая строка текста как заголовок). */
export function parseTelegram(html, handle) {
  const out = [];
  for (const m of String(html || '').matchAll(/<div class="tgme_widget_message_wrap[\s\S]*?(?=<div class="tgme_widget_message_wrap|$)/g)) {
    const b = m[0], post = /data-post="([^"]+)"/.exec(b), tx = /<div class="tgme_widget_message_text[^>]*>([\s\S]*?)<\/div>\s*(?:<div class="tgme_widget_message_(?:footer|reply_markup|link_preview)|<a class="tgme_widget_message_(?:date|views)|<div class="tgme_widget_message_footer)/.exec(b) || /<div class="tgme_widget_message_text[^>]*>([\s\S]*?)<\/div>/.exec(b);
    if (!tx) continue;
    const text = stripTags(tx[1]); if (text.length < 20) continue;
    const dt = /<time[^>]*datetime="([^"]+)"/.exec(b), first = text.split('\n').find((l) => l.trim().length > 8) || text;
    out.push({ title: first.trim().slice(0, 200), link: post ? `https://t.me/${post[1]}` : `https://t.me/${handle}`, date: dt ? toMs(dt[1]) : 0, summary: text.slice(0, 700) });
  }
  return out;
}
/** Сайт без ленты: ссылки-заголовки (длинный текст ссылки на том же домене). */
export function parseWebsite(html, base) {
  const out = [], seen = new Set(); let host = ''; try { host = new URL(base).host; } catch {}
  for (const m of String(html || '').matchAll(/<a\b[^>]*\bhref=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const title = stripTags(m[2]).replace(/\s+/g, ' '); if (title.length < 30 || title.length > 220) continue;
    let link; try { link = new URL(decode(m[1]), base); } catch { continue; }
    if (link.host !== host || seen.has(link.href)) continue; seen.add(link.href);
    out.push({ title, link: link.href, date: 0, summary: '' });
  }
  return out.slice(0, 30);
}
export const feedLinkOf = (html, base) => { const m = /<link\b[^>]*type=["']application\/(?:rss|atom)\+xml["'][^>]*>/i.exec(String(html || '')); const h = m && /href=["']([^"']+)["']/i.exec(m[0]); try { return h ? new URL(decode(h[1]), base).href : ''; } catch { return ''; } };

/* ---------------- загрузка ---------------- */
async function get(url, { fetch = globalThis.fetch, timeoutMs = 12000 } = {}) {
  const ac = new AbortController(), t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ac.signal, headers: { 'User-Agent': UA, Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, text/html;q=0.8, */*;q=0.5' } });
    const body = await r.text(); return r.ok ? { ok: true, body } : { ok: false, error: `HTTP ${r.status}` };
  } catch (e) { return { ok: false, error: e && e.name === 'AbortError' ? 'таймаут' : 'нет связи' }; } finally { clearTimeout(t); }
}
const tgHandle = (id) => String(id).replace(/^https?:\/\/t\.me\/(s\/)?/i, '').replace(/^@/, '').split(/[/?]/)[0];

/** Один источник -> { ok, items, error }. */
export async function fetchSource(src, { fetch } = {}) {
  try {
    if (src.type === 'telegram') {
      const h = tgHandle(src.identifier), r = await get(`https://t.me/s/${h}`, { fetch }); if (!r.ok) return { ok: false, items: [], error: r.error };
      const items = parseTelegram(r.body, h); return items.length ? { ok: true, items } : { ok: false, items: [], error: 'в канале нет публичных постов (или закрытый просмотр)' };
    }
    if (src.type === 'rss' || src.type === 'website') {
      const r = await get(src.identifier, { fetch }); if (!r.ok) return { ok: false, items: [], error: r.error };
      let items = /<(item|entry)[\s>]/i.test(r.body) ? parseFeed(r.body) : [];
      if (!items.length && src.type === 'website') {
        const feed = feedLinkOf(r.body, src.identifier);
        if (feed) { const f = await get(feed, { fetch }); if (f.ok) items = parseFeed(f.body); }
        if (!items.length) items = parseWebsite(r.body, src.identifier);
      }
      return items.length ? { ok: true, items } : { ok: false, items: [], error: 'лента пустая или это не RSS' };
    }
    return { ok: false, items: [], error: `тип «${src.type}» не поддерживается` };
  } catch (e) { return { ok: false, items: [], error: 'сбой разбора' }; }
}

/**
 * Свежие материалы всех источников канала: не старше `days` дней (материал без даты считается свежим, но идёт в конец), не более `perSource` с источника,
 * без повторов по ссылке и заголовку. -> { items: [{ source, title, link, date, summary }], errors: [{ source, error }], okSources }
 */
export async function collectItems(sources, { fetch, now = Date.now(), days = 30, perSource = 12, limit = 60 } = {}) {
  const res = await Promise.all(sources.map(async (s) => ({ s, r: await fetchSource(s, { fetch }) })));
  const items = [], errors = [], seen = new Set(); let okSources = 0;
  for (const { s, r } of res) {
    const name = s.name || s.identifier;
    if (!r.ok) { errors.push({ source: name, error: r.error }); continue; }
    okSources++;
    const fresh = r.items.filter((x) => !x.date || (x.date <= now + DAY && now - x.date <= days * DAY)).sort((a, b) => (b.date || 0) - (a.date || 0)).slice(0, perSource);
    for (const x of fresh) {
      const key = (x.link || x.title).toLowerCase(); if (seen.has(key)) continue; seen.add(key);
      items.push({ source: name, type: s.type, ...x });
    }
  }
  items.sort((a, b) => (b.date || 0) - (a.date || 0) || 0);
  return { items: items.slice(0, limit), errors, okSources };
}
/** Свежесть для ранжирования: 0..3 (до 2 суток 3, до недели 2, до месяца 1). */
export const freshness = (date, now = Date.now()) => (!date ? 1 : now - date <= 2 * DAY ? 3 : now - date <= 7 * DAY ? 2 : now - date <= 30 * DAY ? 1 : 0);
export const saveItems = (dir, data) => { fs.mkdirSync(dir, { recursive: true }); const f = path.join(dir, 'source_items.json'); fs.writeFileSync(f, JSON.stringify(data, null, 1), 'utf8'); return f; };
export { studioDir };

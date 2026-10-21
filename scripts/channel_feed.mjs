// Что уже опубликовано в Telegram-канале (публичная лента t.me/s/<канал>): эти темы не предлагаем снова.
// Ролики, выложенные Ником вручную, и посты до AI-офиса есть только здесь. Без входа в аккаунт, без бота: обычная публичная страница.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dec = (s) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&laquo;/g, '«').replace(/&raquo;/g, '»').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#(\d+);/g, (m, n) => String.fromCodePoint(Number(n)));
const plain = (h) => dec(h.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();

/** Название темы поста: до метки «МИФ/ПРАВДА/ФАКТ» или эмодзи, иначе первое предложение. */
export function titleOf(text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  const cut = t.split(/\s*(?:[\u{1F300}-\u{1FAFF}\u2600-\u27BF]|МИФ:|ПРАВДА:|ФАКТ:)/u)[0].trim() || t;
  const q = /^(.{8,160}?\?)/.exec(cut); return (q ? q[1] : cut.slice(0, 140)).trim();
}
/** Разбор страницы t.me/s/<канал>: [{ id, date, text, title }] */
export function parsePosts(html) {
  const out = [];
  for (const m of String(html).matchAll(/<div class="tgme_widget_message[^"]*"[^>]*data-post="[^"/]+\/(\d+)"[\s\S]*?(?=<div class="tgme_widget_message[^"]*"[^>]*data-post=|$)/g)) {
    const block = m[0], tx = /<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/.exec(block); if (!tx) continue;
    const text = plain(tx[1]); if (!text) continue;
    const dt = /<time[^>]*datetime="([^"]+)"/.exec(block);
    out.push({ id: Number(m[1]), date: dt ? dt[1] : null, text: text.slice(0, 600), title: titleOf(text) });
  }
  return out;
}
/** Загружает до `pages` страниц ленты (старее по ?before=). */
export async function fetchChannelPosts(handle, { pages = 4, fetchImpl = fetch } = {}) {
  const all = new Map(); let before = null;
  for (let i = 0; i < pages; i++) {
    const r = await fetchImpl(`https://t.me/s/${handle}${before ? `?before=${before}` : ''}`, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!r.ok) throw new Error(`t.me/s/${handle}: HTTP ${r.status}`);
    const posts = parsePosts(await r.text()); if (!posts.length) break;
    for (const p of posts) all.set(p.id, p);
    const minId = Math.min(...posts.map((p) => p.id)); if (!(minId > 1) || minId === before) break; before = minId;
  }
  return [...all.values()].sort((a, b) => b.id - a.id);
}
/** Темы канала с кэшем на диске (по умолчанию 6 часов). При сбое сети берётся прежний кэш. Тесты подменяют файл переменной CHANNEL_FEED_FILE. */
export async function channelTitles(handle, { ttlMs = 6 * 3600e3, fetchImpl = fetch, file } = {}) {
  const f = process.env.CHANNEL_FEED_FILE || file || path.join(ROOT, 'smm', `channel_feed_${handle}.json`);
  let cache = null; try { cache = JSON.parse(fs.readFileSync(f, 'utf8')); } catch {}
  if (process.env.CHANNEL_FEED_FILE && cache) return { titles: (cache.posts || []).map((p) => p.title), fresh: false, source: 'file' };
  if (cache && cache.ts && Date.now() - cache.ts < ttlMs) return { titles: cache.posts.map((p) => p.title), fresh: false, source: 'cache' };
  try {
    const posts = await fetchChannelPosts(handle, { fetchImpl }); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify({ handle, ts: Date.now(), posts }, null, 1), 'utf8');
    return { titles: posts.map((p) => p.title), fresh: true, source: 'network' };
  } catch (e) { return { titles: cache ? cache.posts.map((p) => p.title) : [], fresh: false, source: cache ? 'stale-cache' : 'none', error: e.message }; }
}

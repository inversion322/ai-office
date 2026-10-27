// Замер спроса на темы (запрос Ника 2026-10-27: «темы должны соответствовать трендам, нужны цифры запросов, а не "спрос не проверялся"»).
// Считает КОД, не модель. Источники без ключей: Википедия (просмотры статьи за 30 дней и динамика), Google Trends (лента «в тренде сегодня»),
// подсказки поиска Google / YouTube / Яндекса. С ключами (server/data/demand_keys.json): Вордстат (Yandex Cloud Search API) и YouTube Data API.
// Любой источник может отказать: тогда в карточке честное «не измерено», а балл охвата за него не начисляется. Функции не бросают исключений.
// Веса и шкалы ниже это ГИПОТЕЗА: связь «спрос → просмотры Shorts» не доказана, измерения сохраняются по каждой теме и сверяются с реальными просмотрами.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tokens, similarity } from './topic_dedupe.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const KEYS_FILE = () => process.env.OFFICE_DEMAND_KEYS_FILE || path.join(ROOT, 'server', 'data', 'demand_keys.json');
const UA = 'AIOfficeTopicResearch/1.0 (https://github.com/inversion322/ai-office)';      // Викимедиа просит указывать контакт в User-Agent, иначе чаще отвечает 429
const DAY = 86400000;

/** Ключи читаются при каждом вызове. Пустые поля = источник выключен. Ключи нигде не печатаются и не сохраняются в результатах. */
export function readKeys() {
  let j = {}; try { j = JSON.parse(fs.readFileSync(KEYS_FILE(), 'utf8')); } catch {}
  const s = (k) => (typeof j[k] === 'string' ? j[k].trim() : '');
  return { yandexApiKey: s('yandexApiKey'), yandexFolderId: s('yandexFolderId'), youtubeApiKey: s('youtubeApiKey') };
}

/** GET/POST с таймаутом. Не бросает: { ok, status, text, error }. Ключи в сообщения об ошибках не попадают (только код HTTP или тип сбоя). */
export async function http(url, opts = {}, attempt = 0) {
  const { fetch = globalThis.fetch, method = 'GET', headers = {}, body, timeoutMs = 10000 } = opts;
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), timeoutMs); let res;
  try {
    const r = await fetch(url, { method, headers: { 'User-Agent': UA, ...headers }, body, signal: ac.signal });
    const text = await r.text();
    res = r.ok ? { ok: true, status: r.status, text } : { ok: false, status: r.status, error: 'HTTP ' + r.status };
  } catch (e) { res = { ok: false, error: e && e.name === 'AbortError' ? 'таймаут' : 'нет связи' }; } finally { clearTimeout(t); }
  // один повтор при перегрузке источника (429/5xx), чтобы пачка из 8 тем не теряла замеры из-за ограничения частоты
  if (!res.ok && attempt === 0 && (res.status === 429 || res.status >= 500)) { await new Promise((r) => setTimeout(r, Number(process.env.OFFICE_DEMAND_RETRY_MS ?? 1500))); return http(url, opts, 1); }
  return res;
}
const json = (r) => { try { return JSON.parse(r.text); } catch { return null; } };
const ymd = (d) => d.toISOString().slice(0, 10).replace(/-/g, '');
const clamp01 = (x) => Math.max(0, Math.min(1, x));

/* ---------------- Википедия ---------------- */
/** Просмотры статьи по окнам дат (дни без просмотров API не отдаёт, поэтому считаем по датам, а не по числу записей). */
export async function wikiViews(title, { fetch, now = new Date(), lang = 'ru' } = {}) {
  const end = new Date(now.getTime() - DAY), start = new Date(end.getTime() - 59 * DAY);      // вчера — последний полный день
  const u = `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/${lang}.wikipedia/all-access/user/${encodeURIComponent(String(title).replace(/ /g, '_'))}/daily/${ymd(start)}/${ymd(end)}`;
  const r = await http(u, { fetch }); if (!r.ok) return { ok: false, error: r.status === 404 ? 'нет данных по статье' : r.error };
  const items = (json(r) || {}).items; if (!Array.isArray(items)) return { ok: false, error: 'неожиданный ответ' };
  const cut = ymd(new Date(end.getTime() - 29 * DAY)); let last30 = 0, prev30 = 0;
  for (const it of items) { const d = String(it.timestamp).slice(0, 8); if (d >= cut) last30 += it.views || 0; else prev30 += it.views || 0; }
  return { ok: true, article: String(title).replace(/_/g, ' '), last30, prev30, change: prev30 > 0 ? Math.round((last30 / prev30 - 1) * 100) : null };
}
/** Каноническое название статьи (с учётом перенаправлений) или null. */
export async function wikiResolve(title, { fetch, lang = 'ru' } = {}) {
  const r = await http(`https://${lang}.wikipedia.org/w/api.php?action=query&redirects=1&format=json&titles=${encodeURIComponent(title)}`, { fetch });
  if (!r.ok) return null; const pages = ((json(r) || {}).query || {}).pages || {}; const p = Object.values(pages)[0];
  return p && !('missing' in p) && p.title ? p.title : null;
}
/** Поиск по Википедии: названия статей. */
export async function wikiSearch(q, { fetch, lang = 'ru', limit = 3 } = {}) {
  const r = await http(`https://${lang}.wikipedia.org/w/api.php?action=query&list=search&format=json&srlimit=${limit}&srsearch=${encodeURIComponent(q)}`, { fetch });
  if (!r.ok) return []; return (((json(r) || {}).query || {}).search || []).map((x) => x.title).filter(Boolean);
}
/** Статья по теме: подсказка Виктора (если есть), иначе ПЕРВЫЙ результат поиска, если все слова его названия есть в запросе (точность важнее полноты: лучше «не найдена», чем чужие просмотры). */
export async function wikiMeasure(hint, queries, { fetch, now } = {}) {
  const tried = [];
  if (hint) { const t = await wikiResolve(hint, { fetch }); if (t) { const v = await wikiViews(t, { fetch, now }); if (v.ok) return { ...v, how: 'подсказка Виктора' }; tried.push(v.error); } else tried.push('статья из подсказки не найдена'); }
  for (const q of [...(hint ? [hint] : []), ...queries.slice(0, 2)]) {      // подсказка Виктора, не нашедшаяся как название, ищется ещё и как запрос
    const qt = tokens(q);
    for (const t of (await wikiSearch(q, { fetch })).slice(0, 1)) {      // только первый результат поиска: второстепенные («Ребёнок» на «слушать Моцарта … ребёнок») дают чужие просмотры
      const tt = tokens(t); let covered = tt.size > 0; for (const x of tt) if (!qt.has(x)) covered = false;      // все слова названия статьи должны быть в запросе: «Электронная сигарета» не годится для «лёгкие сигареты»
      if (!covered) continue;
      const v = await wikiViews(t, { fetch, now }); if (v.ok) return { ...v, how: 'поиск по Википедии' };
      tried.push(v.error);
    }
  }
  return { ok: false, error: tried[0] || 'подходящей статьи не нашлось' };
}

/* ---------------- Google Trends: лента «в тренде сегодня» ---------------- */
export async function trendsNow({ fetch, geo = 'RU' } = {}) {
  const r = await http(`https://trends.google.com/trending/rss?geo=${geo}`, { fetch }); if (!r.ok) return { ok: false, error: r.error, items: [] };
  const items = []; for (const m of r.text.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const title = (/<title>([\s\S]*?)<\/title>/.exec(m[1]) || [])[1], tr = (/<ht:approx_traffic>([\s\S]*?)<\/ht:approx_traffic>/.exec(m[1]) || [])[1];
    if (title) items.push({ title: title.replace(/<!\[CDATA\[|\]\]>/g, '').replace(/&amp;/g, '&').trim(), traffic: (tr || '').trim() });
  }
  return { ok: items.length > 0, error: items.length ? undefined : 'пустая лента', items };
}
export function trendsMatch(queries, items) {
  const qt = new Set(); for (const q of queries) for (const x of tokens(q)) if (x.length >= 4 && !/^\d+$/.test(x)) qt.add(x);
  return items.filter((it) => { for (const x of tokens(it.title)) if (qt.has(x)) return true; return false; });
}

/* ---------------- Подсказки поиска (без ключей, без чисел) ---------------- */
const SUGGEST = {
  google: (q) => `https://suggestqueries.google.com/complete/search?client=firefox&hl=ru&q=${encodeURIComponent(q)}`,
  youtube: (q) => `https://suggestqueries.google.com/complete/search?client=firefox&ds=yt&hl=ru&q=${encodeURIComponent(q)}`,
  yandex: (q) => `https://suggest.yandex.ru/suggest-ff.cgi?part=${encodeURIComponent(q)}&uil=ru&n=10`,
};
export async function suggestCounts(queries, { fetch } = {}) {
  const out = {}; let any = false;
  for (const [name, mk] of Object.entries(SUGGEST)) {
    let best = null;
    for (const q of queries.slice(0, 2)) {
      const r = await http(mk(q), { fetch }); if (!r.ok) continue; const j = json(r);
      if (Array.isArray(j) && Array.isArray(j[1])) { best = Math.max(best ?? 0, Math.min(10, j[1].length)); }
    }
    if (best !== null) { out[name] = best; any = true; }
  }
  return any ? out : null;
}

/* ---------------- Ключи: Вордстат и YouTube Data API ---------------- */
export async function wordstatCount(phrase, { fetch, keys }) {
  if (!keys.yandexApiKey || !keys.yandexFolderId) return { ok: false, error: 'нет ключа' };
  const r = await http('https://searchapi.api.cloud.yandex.net/v2/wordstat/topRequests', { fetch, method: 'POST', headers: { Authorization: 'Api-Key ' + keys.yandexApiKey, 'Content-Type': 'application/json' }, body: JSON.stringify({ phrase, numPhrases: 5, devices: ['DEVICE_ALL'], folderId: keys.yandexFolderId }) });
  if (!r.ok) return { ok: false, error: r.error }; const j = json(r); const n = Number(j && (j.totalCount ?? (j.results && j.results[0] && j.results[0].count)));
  return Number.isFinite(n) ? { ok: true, count: n } : { ok: false, error: 'неожиданный ответ' };
}
export async function youtubeStats(query, { fetch, keys, now = new Date() }) {
  if (!keys.youtubeApiKey) return { ok: false, error: 'нет ключа' };
  const after = new Date(now.getTime() - 30 * DAY).toISOString();
  const s = await http(`https://www.googleapis.com/youtube/v3/search?part=id&type=video&videoDuration=short&order=viewCount&maxResults=10&regionCode=RU&relevanceLanguage=ru&publishedAfter=${encodeURIComponent(after)}&q=${encodeURIComponent(query)}&key=${encodeURIComponent(keys.youtubeApiKey)}`, { fetch });
  if (!s.ok) return { ok: false, error: s.error }; const ids = (((json(s) || {}).items) || []).map((x) => x.id && x.id.videoId).filter(Boolean);
  if (!ids.length) return { ok: true, n: 0, median: 0, max: 0 };
  const v = await http(`https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${ids.join(',')}&key=${encodeURIComponent(keys.youtubeApiKey)}`, { fetch });
  if (!v.ok) return { ok: false, error: v.error }; const views = (((json(v) || {}).items) || []).map((x) => Number(x.statistics && x.statistics.viewCount)).filter(Number.isFinite).sort((a, b) => a - b);
  if (!views.length) return { ok: false, error: 'неожиданный ответ' };
  const mid = views.length >> 1; return { ok: true, n: views.length, median: views.length % 2 ? views[mid] : Math.round((views[mid - 1] + views[mid]) / 2), max: views[views.length - 1] };
}

/* ---------------- Сбор и оценка ---------------- */
/** Запасные формулировки, если Виктор их не дал: смысловые слова названия (без «правда ли, что» и связок); текст в скобках даёт вторую формулировку. Качество ниже, чем у формулировок Виктора. */
const FILLER = new Set('правда ли что чтобы можно нужно это как или при для если ведь все они она оно его ему их так там тут вот быть бывает бывают реально действительно вообще еще ещё уже тоже также просто'.split(' '));
const contentWords = (s, n) => String(s || '').toLowerCase().replace(/[«»"“”?!.,:;()]/g, ' ').split(/\s+/).filter((w) => w.length >= 3 && !FILLER.has(w)).slice(0, n).join(' ');
export function fallbackQueries(title) {
  const t = String(title || ''), paren = (/\(([^)]*)\)/.exec(t) || [])[1];
  return [contentWords(t.replace(/\([^)]*\)/g, ' '), 5), contentWords(paren, 4)].filter(Boolean);
}
export const cleanQueries = (c) => { const q = (Array.isArray(c && c.queries) ? c.queries : []).map((x) => String(x || '').trim()).filter(Boolean).slice(0, 3); return q.length ? q : fallbackQueries(c && c.title); };
const hasOwnQueries = (c) => (Array.isArray(c && c.queries) ? c.queries : []).some((x) => String(x || '').trim());

/** Сырые замеры по одной теме (без оценки). Каждый источник независим: сбой одного не мешает остальным. */
export async function collectRaw(cand, ctx = {}) {
  const { fetch, now = new Date() } = ctx, keys = ctx.keys || readKeys(), queries = cleanQueries(cand), errors = {};
  const raw = { queries, queries_auto: !hasOwnQueries(cand), measured_at: now.toISOString(), wiki: null, trends: null, suggest: null, wordstat: null, youtube: null, errors };
  if (!queries.length) { errors.all = 'нет формулировок запроса'; return raw; }
  const [wiki, sug, ws, yt] = await Promise.all([
    wikiMeasure(cand.wiki_article, queries, { fetch, now }).catch(() => ({ ok: false, error: 'сбой' })),
    suggestCounts(queries, { fetch }).catch(() => null),
    wordstatCount(queries[0], { fetch, keys }).catch(() => ({ ok: false, error: 'сбой' })),
    youtubeStats(queries[0], { fetch, keys, now }).catch(() => ({ ok: false, error: 'сбой' })),
  ]);
  if (wiki.ok) raw.wiki = { article: wiki.article, how: wiki.how, last30: wiki.last30, prev30: wiki.prev30, change: wiki.change }; else errors.wiki = wiki.error;
  if (sug) raw.suggest = sug; else errors.suggest = 'нет ответа';
  if (ws.ok) raw.wordstat = { count: ws.count }; else if (ws.error !== 'нет ключа') errors.wordstat = ws.error;
  if (yt.ok) raw.youtube = { n: yt.n, median: yt.median, max: yt.max }; else if (yt.error !== 'нет ключа') errors.youtube = yt.error;
  if (ctx.trends && ctx.trends.ok) raw.trends = { matched: trendsMatch([...queries, cand.title || ''], ctx.trends.items).slice(0, 3) }; else errors.trends = (ctx.trends && ctx.trends.error) || 'не запрашивались';
  return raw;
}

/** Шкала охвата 0..25 по замерам. ВСЕ веса и шкалы — гипотеза (см. шапку файла). */
export const WEIGHTS = { wiki: 0.25, suggest: 0.15, wordstat: 0.35, youtube: 0.25 };
export const TRENDS_BONUS = 0.1;
/** Без ключей достижим вес 0,40 (Википедия + подсказки); охват масштабируется долей собранного веса, чтобы один слабый источник не давал полный балл. */
export const FULL_COVERAGE = 0.4;
export function scoreRaw(raw) {
  const parts = {};
  if (raw.wiki) parts.wiki = clamp01((Math.log10(Math.max(raw.wiki.last30, 1)) - 2) / 2.5);        // 100 просмотров за 30 дней = 0, 1 000 ≈ 0,4, 30 000 = 1
  if (raw.suggest) { const v = Object.values(raw.suggest); parts.suggest = clamp01(v.reduce((a, b) => a + b, 0) / (10 * v.length)); }
  if (raw.wordstat) parts.wordstat = clamp01(Math.log10(Math.max(raw.wordstat.count, 1)) / 6);    // 1 млн запросов = 1
  if (raw.youtube) parts.youtube = clamp01(Math.log10(Math.max(raw.youtube.median, 1)) / 6);      // медиана топ-10 роликов 1 млн = 1
  const names = Object.keys(parts), wsum = names.reduce((a, k) => a + WEIGHTS[k], 0);
  const level = names.length === 0 ? 'none' : names.length === 1 ? 'partial' : 'measured';
  let index = wsum ? names.reduce((a, k) => a + parts[k] * WEIGHTS[k], 0) / wsum : 0;
  const trending = !!(raw.trends && raw.trends.matched && raw.trends.matched.length);
  if (trending && level !== 'none') index = clamp01(index + TRENDS_BONUS);
  if (trending && level === 'none') index = TRENDS_BONUS;       // тренд без других замеров: минимальный балл
  const coverage = Math.min(1, wsum / FULL_COVERAGE);
  const reach = level === 'none' && !trending ? 0 : Math.round(25 * index * (level === 'none' ? 1 : coverage));
  return { level: trending && level === 'none' ? 'partial' : level, index: Math.round(index * 1000) / 1000, reach, parts };
}

const NB = '\u00a0';
const fmt = (n) => Math.round(n).toLocaleString('ru-RU').replace(/[\u202f\u00a0\s]/g, NB);
/** Строка для карточки темы. */
export function demandLine(d) {
  if (!d) return 'Спрос: не измерено.';
  const bits = [];
  if (d.wiki) bits.push(`Википедия «${d.wiki.article}»: ${fmt(d.wiki.last30)} просмотров за 30 дн${d.wiki.change === null || d.wiki.change === undefined ? '' : ` (${d.wiki.change > 0 ? '+' : d.wiki.change < 0 ? '−' : ''}${Math.abs(d.wiki.change)}${NB}% к прошлым 30)`}`);
  if (d.wordstat) bits.push(`Яндекс: ${fmt(d.wordstat.count)} запросов за 30 дн`);
  if (d.youtube) bits.push(d.youtube.n ? `YouTube за 30 дн: медиана просмотров топ-${d.youtube.n} коротких роликов ${fmt(d.youtube.median)}` : 'YouTube за 30 дн: коротких роликов по теме не нашлось');
  if (d.suggest) { const v = Object.values(d.suggest); bits.push(`подсказки поиска: ${v.reduce((a, b) => a + b, 0)} из ${10 * v.length}`); }
  if (d.trends && d.trends.matched && d.trends.matched.length) bits.push(`в трендах Google сегодня: ${d.trends.matched.map((m) => `«${m.title}»${m.traffic ? ' ' + m.traffic : ''}`).join(', ')}`);
  if (!bits.length) return 'Спрос: не измерено (ни один источник не ответил), балл охвата не начислен.';
  const miss = []; if (!d.wordstat && !(d.errors && d.errors.wordstat)) miss.push('Яндекс'); if (!d.youtube && !(d.errors && d.errors.youtube)) miss.push('YouTube');      // источник без ключа
  const lvl = d.level === 'measured' ? '' : ' (частично)';
  return `Спрос${lvl}: ${bits.join('; ')}. Охват по замерам ${d.reach} из 25.${d.wiki ? '' : ' Статья Википедии не найдена.'}${d.queries_auto ? ' Формулировки запроса подобраны автоматически, замер приблизительный.' : ''}${miss.length ? ` (${miss.join(' и ')}: ключ не подключён)` : ''}`;
}

/** Правила для Виктора и Льва (одни и те же в обеих подборках). Решение Ника 2026-10-27: берём востребованное, занятость темы конкурентами не причина отказа. */
export const VIKTOR_DEMAND_RULES = `ВАЖНО (решение Ника 2026-10-27): нужны темы, которые УЖЕ востребованы и популярны сейчас, их ищут и смотрят много людей. Занятость темы другими каналами НЕ причина отказа: свой угол мы добавим в подаче. Не гонись за «ещё никем не снятым». Для КАЖДОГО кандидата добавь поля: "queries" (2-3 короткие формулировки так, как люди реально вводят в поиск, например «гомеопатия работает», «лёгкие сигареты вред») и "wiki_article" (точное название статьи русской Википедии по теме, если такая есть, иначе пустая строка). Код сам возьмёт по ним число запросов, просмотры и тренды; цифры спроса ты не придумываешь.`;
export const LEV_DEMAND_RULES = `В каждом кандидате есть поле demand: замеры спроса сделал код (просмотры Википедии, подсказки поиска, тренды Google, при ключах Вордстат и YouTube). Оценку «охват» (reach) ставит код по этим замерам, твоё значение игнорируется. Остальные баллы оценивай как обычно. Занятость темы другими каналами баллы НЕ снижает (решение Ника 2026-10-27: нужны востребованные темы, свой угол добавляем в подаче); «ниша» = есть ли у нас возможность дать свой угол. Не пиши в reason и data_sources про отсутствие Wordstat или Trends: если demand.level = "none", пиши «спрос не измерен». Цифры спроса не пересказывай и не выдумывай: они придут в карточку отдельной строкой.`;

/** Что показываем Льву из замера. */
export const demandForPrompt = (d) => (d ? { level: d.level, line: d.line, wiki: d.wiki, suggest: d.suggest, trends: d.trends, wordstat: d.wordstat, youtube: d.youtube } : null);

/** Тест-подмена сети: OFFICE_DEMAND_STUB=<json: { "<название темы>": сырой замер, "*": по умолчанию }>. OFFICE_NO_DEMAND=1 — замер выключен (тесты не ходят в сеть). */
function stubFor(title) {
  const f = process.env.OFFICE_DEMAND_STUB; if (!f) return null;
  try { const m = JSON.parse(fs.readFileSync(f, 'utf8')); const r = m[title] || m['*']; return r ? { queries: [], errors: {}, measured_at: new Date().toISOString(), wiki: null, trends: null, suggest: null, wordstat: null, youtube: null, ...r } : null; } catch { return null; }
}

/** Замер одной темы: сырые данные + оценка + строка. Никогда не бросает. */
export async function measureDemand(cand, ctx = {}) {
  let raw;
  try { raw = process.env.OFFICE_NO_DEMAND === '1' ? null : (stubFor(cand && cand.title) || await collectRaw(cand || {}, ctx)); } catch { raw = null; }
  if (!raw) raw = { queries: [], measured_at: new Date().toISOString(), wiki: null, trends: null, suggest: null, wordstat: null, youtube: null, errors: { all: process.env.OFFICE_NO_DEMAND === '1' ? 'замер выключен' : 'сбой замера' } };
  const d = { ...raw, ...scoreRaw(raw) }; d.line = demandLine(d); return d;
}
/** Замер пачки тем (лента трендов берётся один раз, темы — по 3 параллельно). Возвращает массив в том же порядке. */
export async function measureAll(cands, ctx = {}) {
  const trends = process.env.OFFICE_NO_DEMAND === '1' || process.env.OFFICE_DEMAND_STUB ? { ok: false, error: 'выключено', items: [] } : await trendsNow({ fetch: ctx.fetch }).catch(() => ({ ok: false, error: 'сбой', items: [] }));
  const out = new Array(cands.length); let next = 0;
  await Promise.all(Array.from({ length: Math.min(3, cands.length) }, async () => { while (next < cands.length) { const i = next++; out[i] = await measureDemand(cands[i], { ...ctx, trends }); } }));
  return out;
}

/** Подмена «охвата» Льва замером: reach = по замерам, итог пересчитан, строки отсортированы. Темы без замера получают охват 0 и честную строку. */
export function applyDemand(rows, demandOf) {
  const out = rows.map((r) => {
    const d = demandOf(r.title) || null; const s = { ...(r.scores || {}) };
    const lev = Number.isFinite(Number(s.reach)) ? Number(s.reach) : 0, reach = d ? d.reach : 0;
    s.reach = reach;
    const total = Number.isFinite(Number(r.total)) ? Math.max(0, Math.min(100, Number(r.total) - lev + reach)) : r.total;
    return { ...r, scores: s, total, reach_lev: lev, demand: d, demand_line: d ? d.line : demandLine(null) };
  });
  return out.sort((a, b) => (b.total ?? 0) - (a.total ?? 0));
}
/** Поиск замера по названию: точное совпадение, затем похожее (Лев мог поправить название). */
export function demandLookup(cands, demands) {
  const norm = (s) => String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
  const exact = new Map(cands.map((c, i) => [norm(c.title), demands[i]]));
  return (title) => {
    const e = exact.get(norm(title)); if (e) return e;
    let best = null, bs = 0; cands.forEach((c, i) => { const s = similarity(title, c.title); if (s > bs) { bs = s; best = demands[i]; } });
    return bs >= 0.8 ? best : null;
  };
}

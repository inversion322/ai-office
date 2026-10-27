// Студия каналов (решение Ника 2026-10-27): ТРИ РАЗНЫЕ темы в день на канал — два поста в Telegram и один ролик Shorts.
// Самая востребованная по замеру спроса идёт на ролик, следующие две на посты. Чистая логика (без сети и моделей): выбор слотов, план дня, реестр.
// Хранение: smm/studio/plans/<дата>_<канал>.json (smm/ не в git). Время МСК (UTC+3 без перехода на летнее).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { similarity, findDuplicate } from './topic_dedupe.mjs';
import { mskToMs, mskParts } from './publish_when.mjs';

// Без smm_lib: модуль подключается и сервером (расписание), а smm_lib при тестовом режиме требует тестовый адрес API.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const studioDir = () => process.env.OFFICE_STUDIO_DIR || path.join(ROOT, 'smm', 'studio');
export const planFile = (date, ch) => path.join(studioDir(), 'plans', `${date}_${ch}.json`);

/** Слоты дня по умолчанию (решение Ника): пост в 12:00, ролик в 18:30, второй пост в 19:00. Меняется на канал в server/data/studio.json. */
export const DEFAULT_SLOTS = { post1: { kind: 'post', time: '12:00' }, video: { kind: 'video', time: '18:30' }, post2: { kind: 'post', time: '19:00' } };
/** Две темы одного дня не должны быть похожи сильнее этого порога (похожесть слов 0..1, см. topic_dedupe). */
export const DAY_SIMILARITY = 0.4;

const pad = (n) => String(n).padStart(2, '0');
export const mskDate = (ms = Date.now()) => { const p = mskParts(ms); return `${p.y}-${pad(p.m)}-${pad(p.d)}`; };
export function slotMs(date, hhmm) {
  const [y, m, d] = String(date).split('-').map(Number), [h, min] = String(hhmm).split(':').map(Number);
  if (![y, m, d, h, min].every(Number.isFinite)) throw new Error(`не разобрать слот ${date} ${hhmm}`);
  return mskToMs(y, m, d, h, min);
}

/** Настройки каналов студии: из каналов ежедневных тем + необязательный server/data/studio.json (переопределения на канал). */
export function studioChannels(base, overrides = {}) {
  const out = {};
  for (const [k, c] of Object.entries(base || {})) {
    if (!c || c.active === false) continue;
    const o = overrides[k] || {};
    out[k] = { key: k, lang: 'ru', planAt: '20:00', postFormat: 'short', ...c, ...o, slots: { ...DEFAULT_SLOTS, ...(c.slots || {}), ...(o.slots || {}) } };
  }
  return out;
}

/** Чем выше, тем востребованнее: главное измеренный охват (0..25), затем число первоисточников и однозначность ответа. */
export function rankOf(c) {
  const reach = Number(c && c.demand && c.demand.reach); const r = Number.isFinite(reach) ? reach : Number(c && c.reach) || 0;
  const ev = Array.isArray(c && c.evidence) ? c.evidence.length : 0;
  return r * 100 + Math.min(ev, 5) * 2 + (c && c.clear_answer === false ? 0 : 1) + (Number(c && c.total) || 0) / 1000;
}

/**
 * Выбор трёх разных тем: самая востребованная на ролик, ещё две на посты. Темы, уже занятые (ролики, посты, лента канала), отсеиваются по смыслу;
 * темы одного дня не пересекаются между собой. Возвращает { video, posts, spare, missing } (missing: сколько слотов осталось без темы).
 */
export function pickDayTopics(cands, { taken = [], dayThreshold = DAY_SIMILARITY } = {}) {
  const seen = new Set();
  const pool = (cands || []).filter((c) => c && String(c.title || '').trim() && !seen.has(String(c.title).trim().toLowerCase()) && seen.add(String(c.title).trim().toLowerCase()))
    .filter((c) => !findDuplicate(c.title, taken).dup).sort((a, b) => rankOf(b) - rankOf(a));
  const chosen = [];
  for (const c of pool) {
    if (chosen.length === 3) break;
    if (chosen.every((x) => similarity(x.title, c.title) < dayThreshold)) chosen.push(c);
  }
  const spare = pool.filter((c) => !chosen.includes(c));
  return { video: chosen[0] || null, posts: chosen.slice(1, 3), spare, missing: 3 - chosen.length };
}

/** План дня из выбора: слоты по времени выхода. status: proposed → approved (Ник) → в работе → published. */
export function buildPlan({ date, channel, picks, slots = DEFAULT_SLOTS, now = Date.now() }) {
  const items = [
    picks.posts[0] && { slot: 'post1', kind: 'post', c: picks.posts[0] },
    picks.video && { slot: 'video', kind: 'video', c: picks.video },
    picks.posts[1] && { slot: 'post2', kind: 'post', c: picks.posts[1] },
  ].filter(Boolean);
  return {
    date, channel, status: 'proposed', created_at: now,
    slots: items.map(({ slot, kind, c }) => ({
      slot, kind, time: slots[slot].time, at: slotMs(date, slots[slot].time), title: c.title, rubric: c.rubric || null, queries: c.queries || [], wiki_article: c.wiki_article || '',
      why: c.why_massive || c.reason || '', evidence: c.evidence || [], sources_meta: c.sources_meta || [], demand: c.demand || null, demand_line: c.demand_line || (c.demand && c.demand.line) || '', status: 'planned',
    })),
  };
}

const bySlot = (plan, slot) => (plan.slots || []).find((s) => s.slot === slot);
export const slotOf = bySlot;

/** Карточка «План дня» для Ника: три темы, у каждой время и почему именно она на этом слоте. */
export function planCardText(plan, chName, { dropped = 0 } = {}) {
  const KIND = { video: '🎬 Ролик Shorts', post: '📝 Пост' };
  const lines = [...plan.slots].sort((a, b) => a.at - b.at).map((s) => `${s.time} · ${KIND[s.kind] || s.kind}: ${s.title}${s.why ? `\n   ${String(s.why).slice(0, 160)}` : ''}${s.demand_line ? `\n   📊 ${s.demand_line}` : ''}`);
  const top = bySlot(plan, 'video');
  return `📅 План дня · «${chName}» · ${plan.date}\n\n${lines.join('\n\n')}\n\nСамая востребованная тема по замеру спроса${top ? ' (ролик)' : ''} идёт на видео; темы дня разные по смыслу и не повторяют прежние${dropped ? ` (отсеяно похожих: ${dropped})` : ''}. Один ответ на план: утвердите, и ролик и два поста пойдут в работу; каждый пост перед выходом вы ещё увидите и подтвердите.`;
}
export const planButtons = (plan) => [[['✅ Утвердить план', `splan:${plan.channel}:${plan.date}:ok`]], [['🔄 Другие темы', `splan:${plan.channel}:${plan.date}:more`], ['✖ Пропустить день', `splan:${plan.channel}:${plan.date}:skip`]]];

export const loadPlan = (date, ch) => { try { return JSON.parse(fs.readFileSync(planFile(date, ch), 'utf8')); } catch { return null; } };
export function savePlan(plan) { const f = planFile(plan.date, plan.channel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(plan, null, 1), 'utf8'); return f; }
export function updateSlot(date, ch, slot, patch) {
  const plan = loadPlan(date, ch); if (!plan) throw new Error(`нет плана ${date} ${ch}`);
  const s = bySlot(plan, slot); if (!s) throw new Error(`в плане нет слота ${slot}`);
  Object.assign(s, patch); savePlan(plan); return plan;
}
/** Прежний план того же дня уходит в архив (<дата>_<канал>.r1.json, .r2.json…), чтобы его темы остались «занятыми»: Ник их уже видел. */
export function archivePlan(plan) {
  const dir = path.dirname(planFile(plan.date, plan.channel)); fs.mkdirSync(dir, { recursive: true });
  let n = 1; while (fs.existsSync(path.join(dir, `${plan.date}_${plan.channel}.r${n}.json`))) n++;
  fs.writeFileSync(path.join(dir, `${plan.date}_${plan.channel}.r${n}.json`), JSON.stringify(plan, null, 1), 'utf8'); return n;
}
/** Темы из планов за последние N дней (в том числе заменённых, снятых и пропущенных): Ник их уже видел, повторять не нужно. */
export function plannedTitles(ch, { days = 45, now = Date.now() } = {}) {
  const out = [];
  let files = []; try { files = fs.readdirSync(path.join(studioDir(), 'plans')); } catch {}
  for (const f of files) {
    const m = /^(\d{4}-\d{2}-\d{2})_([^.]+)(?:\.r\d+)?\.json$/.exec(f); if (!m || (ch && m[2] !== ch)) continue;
    if (now - Date.parse(m[1]) > days * 86400e3) continue;
    try { for (const s of JSON.parse(fs.readFileSync(path.join(studioDir(), 'plans', f), 'utf8')).slots || []) if (s.title) out.push(s.title); } catch {}
  }
  return out;
}

/* ---------------- расписание: что пора выложить и когда собирать план ---------------- */
export const settingsFile = () => process.env.OFFICE_STUDIO_SETTINGS_FILE || path.join(ROOT, 'server', 'data', 'studio.json');
/** Настройки студии (server/data/studio.json, не в git): autoPlan (план дня сам, по умолчанию выключен), planAt (время плана), autoChannels, channels (переопределения на канал). */
export function studioSettings(file = settingsFile()) {
  let j = {}; try { j = JSON.parse(fs.readFileSync(file, 'utf8')) || {}; } catch {}
  return {
    autoPlan: j.autoPlan === true, planAt: /^\d{1,2}:\d{2}$/.test(String(j.planAt || '')) ? String(j.planAt) : '20:00',
    autoChannels: Array.isArray(j.autoChannels) && j.autoChannels.length ? j.autoChannels.map(String) : ['med_detective'], channels: j.channels && typeof j.channels === 'object' ? j.channels : {},
  };
}
export function writeStudioSettings(patch, file = settingsFile()) {
  let cur = {}; try { cur = JSON.parse(fs.readFileSync(file, 'utf8')) || {}; } catch {}
  fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify({ ...cur, ...patch }, null, 1), 'utf8'); return studioSettings(file);
}
/** На какой день собирается план, если его строят во время planAt: вечером — на завтра (ролик и посты успеют пройти согласования), утром — на сегодня. */
export const planDateFor = (now, planAt = '20:00') => mskDate(Number(String(planAt).split(':')[0]) >= 12 ? now + 86400e3 : now);
const hmToMin = (hm) => { const [h, m] = String(hm).split(':').map(Number); return h * 60 + (m || 0); };

/** Утверждённые Ником посты, у которых время слота пришло: сегодняшний и вчерашний план (чтение файлов, без сети). */
export function dueSlots(now = Date.now()) {
  const out = []; let files = []; try { files = fs.readdirSync(path.join(studioDir(), 'plans')); } catch { return out; }
  const days = new Set([mskDate(now - 86400e3), mskDate(now)]);
  for (const f of files) {
    const m = /^(\d{4}-\d{2}-\d{2})_([^.]+)\.json$/.exec(f); if (!m || !days.has(m[1])) continue;
    const plan = loadPlan(m[1], m[2]); if (!plan) continue;
    for (const s of plan.slots || []) if (s.kind === 'post' && s.status === 'approved' && s.at <= now && (s.attempts || 0) < 3 && (!s.retry_at || s.retry_at <= now)) out.push({ chKey: m[2], date: m[1], slot: s.slot, at: s.at });
  }
  return out;
}
export const hasDue = (now = Date.now()) => dueSlots(now).length > 0;

const triedFile = (date, ch) => path.join(studioDir(), 'auto', `${date}_${ch}.json`);
export const triesOf = (date, ch) => { try { return JSON.parse(fs.readFileSync(triedFile(date, ch), 'utf8')); } catch { return { n: 0, at: 0 }; } };
export function markTried(date, ch, now = Date.now()) { const t = triesOf(date, ch), f = triedFile(date, ch); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify({ n: t.n + 1, at: now }), 'utf8'); }
/**
 * Какие планы пора собрать сейчас (автоплан включён Ником). Для канала: время planAt уже наступило (и не прошло больше 8 часов),
 * плана на нужный день ещё нет ни в каком виде, попыток сегодня меньше двух, между попытками 90 минут (сбой поиска не зациклится).
 */
export function autoPlanTargets(now = Date.now(), settings = studioSettings(), { maxAgeMin = 480, retryGapMin = 90, maxTries = 2 } = {}) {
  if (!settings.autoPlan) return [];
  const p = mskParts(now), cur = p.h * 60 + p.min, out = [];
  for (const ch of settings.autoChannels) {
    const planAt = (settings.channels[ch] && settings.channels[ch].planAt) || settings.planAt, at = hmToMin(planAt);
    if (cur < at || cur - at > maxAgeMin) continue;
    const date = planDateFor(now, planAt);
    if (loadPlan(date, ch)) continue;
    const t = triesOf(date, ch); if (t.n >= maxTries || (t.n && now - t.at < retryGapMin * 60e3)) continue;
    out.push({ ch, date });
  }
  return out;
}

/* ---------------- единый план: варианты для видео и для постов, выбор вместе (решение Ника 2026-10-28) ---------------- */
export const VIDEO_SHOWN = 4, POSTS_SHOWN = 5;
const hostOf = (u) => { try { return new URL(u).host.replace(/^www\./, ''); } catch { return String(u || ''); } };
const clip = (t, n) => { const x = String(t || '').replace(/\s+/g, ' ').trim(); return x.length > n ? x.slice(0, n - 1).trimEnd() + '…' : x; };

/** Ранг темы для поста: свежесть материала источника канала, число независимых источников и интерес по замеру (без YouTube: квота только на ролики). */
export function postRank(c) {
  const hosts = new Set((c && c.evidence || []).map((e) => hostOf(e && e.url)).filter(Boolean)), idx = Number(c && c.demand && c.demand.index);
  return (Number(c && c.freshness) || 0) * 10 + Math.min(hosts.size, 3) * 4 + (Number.isFinite(idx) ? idx : 0) * 10 + (c && c.clear_answer === false ? 0 : 1);
}
/** Варианты одного вида ('video' | 'posts'): без занятых, без почти одинаковых внутри списка, по убыванию ранга (видео: охват по замеру YouTube Shorts и трендам, посты: postRank). */
export function rankOptions(kind, cands, { taken = [], within = 0.6 } = {}) {
  const seen = new Set(), rank = kind === 'posts' ? postRank : rankOf;
  const pool = (cands || []).filter((c) => c && String(c.title || '').trim() && !seen.has(String(c.title).trim().toLowerCase()) && seen.add(String(c.title).trim().toLowerCase()))
    .filter((c) => !findDuplicate(c.title, taken).dup).sort((a, b) => rank(b) - rank(a));
  const out = []; for (const c of pool) if (out.every((x) => similarity(x.title, c.title) < within)) out.push(c);
  return out;
}
export function makeOptions({ video = [], posts = [], taken = [] } = {}) {
  const v = rankOptions('video', video, { taken }), p = rankOptions('posts', posts, { taken });
  return { video: v.slice(0, VIDEO_SHOWN), video_spare: v.slice(VIDEO_SHOWN), posts: p.slice(0, POSTS_SHOWN), posts_spare: p.slice(POSTS_SHOWN) };
}
/** Выбор по умолчанию: лучшее видео и два лучших поста, не похожих ни на видео, ни друг на друга. */
export function defaultSelection(opts, threshold = DAY_SIMILARITY) {
  const video = opts.video.length ? 0 : null, v = video === null ? null : opts.video[video], posts = [];
  for (let i = 0; i < opts.posts.length && posts.length < 2; i++) {
    const t = opts.posts[i].title;
    if (v && similarity(t, v.title) >= threshold) continue;
    if (posts.every((j) => similarity(t, opts.posts[j].title) < threshold)) posts.push(i);
  }
  return { video, posts };
}
export const selectionComplete = (plan) => !!(plan.selection && plan.selection.video !== null && plan.selection.video !== undefined && (plan.selection.posts || []).length === 2);
/** Слоты плана пересобираются из выбора. Первый по рангу пост идёт в первый слот (12:00), второй во второй (19:00). */
export function syncSlots(plan) {
  const o = plan.options, sel = plan.selection || { video: null, posts: [] };
  const picks = { video: sel.video !== null && sel.video !== undefined ? o.video[sel.video] : null, posts: [...(sel.posts || [])].sort((a, b) => a - b).map((i) => o.posts[i]).filter(Boolean) };
  plan.slots = buildPlan({ date: plan.date, channel: plan.channel, picks, slots: plan.slot_cfg || DEFAULT_SLOTS, now: plan.created_at }).slots;
  return plan;
}
export function newDayPlan({ date, channel, options, slots = DEFAULT_SLOTS, now = Date.now(), run_dir = '', sources = null }) {
  const plan = { date, channel, status: 'proposed', created_at: now, options, selection: defaultSelection(options), slot_cfg: slots, run_dir, sources };
  plan.seen = [...options.video, ...options.posts].map((c) => c.title);
  return syncSlots(plan);
}
const conflict = (a, b, th) => similarity(a, b) >= th;
/** Один выбор кнопкой: 'v2' (видео №2) или 'p3' (пост №3: повторное нажатие снимает, третий вытесняет самый давний). -> { ok, error? }. Темы дня должны быть разными. */
export function applyChoice(plan, token, threshold = DAY_SIMILARITY) {
  const m = /^([vp])(\d{1,2})$/.exec(String(token)); if (!m) return { ok: false, error: 'Не разобрал выбор.' };
  const kind = m[1], n = Number(m[2]) - 1, o = plan.options, sel = plan.selection;
  const list = kind === 'v' ? o.video : o.posts; if (!list || !list[n]) return { ok: false, error: `В списке нет номера ${n + 1}.` };
  const title = list[n].title, vid = sel.video !== null && sel.video !== undefined ? o.video[sel.video] : null;
  if (kind === 'v') {
    const bad = (sel.posts || []).map((i) => o.posts[i]).find((x) => x && conflict(x.title, title, threshold));
    if (bad) return { ok: false, error: `Видео «${clip(title, 60)}» слишком похоже на выбранный пост «${clip(bad.title, 60)}»: темы дня должны быть разными. Снимите этот пост или выберите другое видео.` };
    sel.video = n;
  } else {
    let posts = [...(sel.posts || [])];
    if (posts.includes(n)) posts = posts.filter((i) => i !== n);
    else {
      if (vid && conflict(vid.title, title, threshold)) return { ok: false, error: `Пост «${clip(title, 60)}» слишком похож на выбранное видео «${clip(vid.title, 60)}»: темы дня должны быть разными.` };
      const bad = posts.map((i) => o.posts[i]).find((x) => x && conflict(x.title, title, threshold));
      if (bad) return { ok: false, error: `Пост «${clip(title, 60)}» слишком похож на уже выбранный «${clip(bad.title, 60)}»: темы дня должны быть разными.` };
      posts.push(n); if (posts.length > 2) posts.shift();
    }
    sel.posts = posts;
  }
  syncSlots(plan); return { ok: true };
}
/** Выбор целиком (из текста Ника): { video: 2, posts: [1, 4] } (номера с единицы; чего нет, то остаётся как было). */
export function setSelection(plan, { video = null, posts = null } = {}, threshold = DAY_SIMILARITY) {
  const o = plan.options, next = { video: plan.selection.video, posts: [...(plan.selection.posts || [])] };
  if (video !== null) { if (!o.video[video - 1]) return { ok: false, error: `Видео №${video} нет в списке.` }; next.video = video - 1; }
  if (posts !== null) {
    const idx = [...new Set(posts)].map((n) => n - 1); if (idx.length > 2) return { ok: false, error: 'Постов в день два: назовите не больше двух.' };
    const miss = idx.find((i) => !o.posts[i]); if (miss !== undefined) return { ok: false, error: `Поста №${miss + 1} нет в списке.` };
    next.posts = idx;
  }
  const items = [...(next.video !== null && next.video !== undefined ? [o.video[next.video]] : []), ...next.posts.map((i) => o.posts[i])];
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) if (conflict(items[i].title, items[j].title, threshold)) return { ok: false, error: `«${clip(items[i].title, 50)}» и «${clip(items[j].title, 50)}» слишком похожи: темы дня должны быть разными.` };
  plan.selection = next; syncSlots(plan); return { ok: true };
}
/** Новые варианты одного вида вместо показанных (из запаса или после нового поиска). Выбор этого вида сбрасывается на лучший подходящий. */
export function replaceOptions(plan, kind, fresh, { taken = [] } = {}) {
  const o = plan.options, key = kind === 'video' ? 'video' : 'posts', spare = key + '_spare', n = key === 'video' ? VIDEO_SHOWN : POSTS_SHOWN;
  const seen = new Set(plan.seen || []);
  const pool = rankOptions(key, [...(o[spare] || []), ...(fresh || [])], { taken: [...taken, ...seen] });
  if (!pool.length) return { ok: false, count: 0 };
  o[key] = pool.slice(0, n); o[spare] = pool.slice(n);
  plan.seen = [...seen, ...o[key].map((c) => c.title)];
  if (key === 'video') plan.selection.video = null; else plan.selection.posts = [];
  const sel = plan.selection;
  // подбираем выбор заново для заменённого вида, не трогая второй
  if (key === 'video') { for (let i = 0; i < o.video.length; i++) if ((sel.posts || []).every((j) => !conflict(o.posts[j].title, o.video[i].title, DAY_SIMILARITY))) { sel.video = i; break; } }
  else { const v = sel.video !== null && sel.video !== undefined ? o.video[sel.video] : null; for (let i = 0; i < o.posts.length && sel.posts.length < 2; i++) { const t = o.posts[i].title; if (v && conflict(v.title, t, DAY_SIMILARITY)) continue; if (sel.posts.every((j) => !conflict(o.posts[j].title, t, DAY_SIMILARITY))) sel.posts.push(i); } }
  syncSlots(plan); return { ok: true, count: o[key].length, spare: o[spare].length };
}

/* ---------------- карточка единого плана ---------------- */
const NB = '\u00a0';
const kfmt = (n) => { n = Number(n) || 0; const f = (x, d) => x.toFixed(d).replace('.', ',').replace(/,0$/, ''); return n >= 1e6 ? `${f(n / 1e6, n >= 1e7 ? 0 : 1)}${NB}млн` : n >= 1e3 ? `${f(n / 1e3, n >= 1e4 ? 0 : 1)}${NB}тыс.` : String(Math.round(n)); };
/** Короткая строка замера для карточки выбора. kind: 'video' (охват 0..25 с YouTube Shorts) или 'posts' (YouTube не опрашивался: интерес по Википедии, подсказкам и трендам). */
export function demandShort(d, kind = 'video') {
  if (!d) return 'спрос не измерен';
  const b = [];
  if (kind === 'video') { if (Number.isFinite(d.reach)) b.push(`охват ${d.reach}/25`); if (d.youtube) b.push(d.youtube.n ? `Shorts: ${d.youtube.n} роликов, медиана ${kfmt(d.youtube.median)}, лучший ${kfmt(d.youtube.max)}${d.youtube.hits ? `, от 100${NB}тыс.: ${d.youtube.hits}` : ''}` : 'Shorts: роликов нет'); }
  else if (Number.isFinite(d.index)) b.push(`интерес ${Math.round(d.index * 100)}%`);
  if (d.suggest) { const v = Object.values(d.suggest); b.push(`подсказки ${v.reduce((a, c) => a + c, 0)}/${10 * v.length}`); }
  if (d.wiki) b.push(`Вики ${kfmt(d.wiki.last30)}/мес`);
  if (d.trends && d.trends.matched && d.trends.matched.length) b.push(`🔥 в трендах Google: ${d.trends.matched.map((m) => `«${clip(m.title, 28)}»`).join(', ')}`);
  return b.length ? b.join(' · ') : 'спрос не измерен';
}
const agoText = (ms, now) => { if (!ms) return ''; const d = Math.floor((now - ms) / 86400e3); return d <= 0 ? 'сегодня' : d === 1 ? 'вчера' : `${d} дн. назад`; };
export const missingText = (plan) => { const sel = plan.selection, m = []; if (sel.video === null || sel.video === undefined) m.push('видео'); const k = 2 - (sel.posts || []).length; if (k > 0) m.push(k === 2 ? 'два поста' : 'ещё один пост'); return m.join(' и '); };

export function planCardTextV2(plan, chName, { note = '', now = Date.now() } = {}) {
  const o = plan.options, sel = plan.selection, cfg = plan.slot_cfg || DEFAULT_SLOTS, n1 = (i) => i + 1;
  const build = (withWhy) => {
    const L = [`📅 План дня · «${chName}» · ${plan.date}`, ''];
    L.push(`🎬 ВИДЕО в ${cfg.video.time}: выберите одно (YouTube Shorts + тренды Google)`);
    if (!o.video.length) L.push('   (вариантов нет: нажмите «Другое видео»)');
    o.video.forEach((c, i) => { L.push(`${n1(i)}. ${sel.video === i ? '✅' : '▫️'} ${c.title}`, `   📊 ${demandShort(c.demand, 'video')}`); if (withWhy && c.why) L.push(`   ${clip(c.why, 95)}`); });
    L.push('', `📝 ПОСТЫ в ${cfg.post1.time} и ${cfg.post2.time}: выберите два (источники канала)`);
    if (!o.posts.length) L.push('   (вариантов нет: нажмите «Другие посты»)');
    o.posts.forEach((c, i) => {
      const meta = (c.sources_meta || [])[0], src = meta ? `${meta.name}${meta.date ? ', ' + agoText(meta.date, now) : ''}${(c.sources_meta || []).length > 1 ? ` +${(c.sources_meta || []).length - 1}` : ''}` : (c.evidence && c.evidence[0] ? hostOf(c.evidence[0].url) : 'общий поиск');
      L.push(`${n1(i)}. ${(sel.posts || []).includes(i) ? '✅' : '▫️'} ${c.title}`, `   📰 ${src} · 📊 ${demandShort(c.demand, 'posts')}`);
    });
    L.push('', `Выбрано: видео ${sel.video === null || sel.video === undefined ? '—' : n1(sel.video)}; посты ${(sel.posts || []).length ? [...sel.posts].sort((a, b) => a - b).map(n1).join(' и ') : '—'}${selectionComplete(plan) ? ` (первый в ${cfg.post1.time}, второй в ${cfg.post2.time})` : `. Нужно выбрать: ${missingText(plan)}`}.`);
    if (note) L.push(note);
    L.push('Нажмите номера или напишите: «видео 2, посты 1 и 4». «Утвердить» запустит ролик и два поста; каждый пост перед выходом вы ещё раз увидите и подтвердите.');
    if (plan.sources && plan.sources.errors && plan.sources.errors.length) L.push(`⚠️ Источники без ответа: ${plan.sources.errors.map((e) => e.source).slice(0, 4).join(', ')}.`);
    return L.join('\n');
  };
  let text = build(true); if (text.length > 3700) text = build(false);
  return text.length > 3900 ? text.slice(0, 3890) + '…' : text;
}
export function planButtonsV2(plan, { busy = false } = {}) {
  const base = `splan:${plan.channel}:${plan.date}`, o = plan.options, sel = plan.selection, full = selectionComplete(plan);
  const posts = [...(sel.posts || [])].sort((a, b) => a - b).map((i) => i + 1);
  const rows = [[[full ? `✅ Утвердить: видео ${sel.video + 1} + посты ${posts.join(', ')}` : `Выберите: ${missingText(plan)}`, `${base}:ok`]]];
  if (o.video.length) rows.push(o.video.map((_, i) => [`🎬 ${i + 1}${sel.video === i ? ' ✅' : ''}`, `${base}:v${i + 1}`]));
  if (o.posts.length) rows.push(o.posts.map((_, i) => [`📝 ${i + 1}${(sel.posts || []).includes(i) ? ' ✅' : ''}`, `${base}:p${i + 1}`]));
  if (!busy) rows.push([['🔄 Другое видео', `${base}:morev`], ['🔄 Другие посты', `${base}:morep`]]);
  rows.push([['✖ Пропустить день', `${base}:skip`]]);
  return rows;
}

/** Блокировка плана на время правки (две быстрые кнопки подряд не должны затереть друг друга). */
export async function withPlanLock(date, ch, fn, { waitMs = 30000, staleMs = 90000 } = {}) {
  const f = planFile(date, ch) + '.lock'; fs.mkdirSync(path.dirname(f), { recursive: true });
  const t0 = Date.now();
  for (;;) {
    try { fs.writeFileSync(f, String(Date.now()), { flag: 'wx' }); break; }
    catch (e) {
      if (e.code !== 'EEXIST') throw e;
      let age = 0; try { age = Date.now() - Number(fs.readFileSync(f, 'utf8')); } catch {}
      if (age > staleMs) { try { fs.rmSync(f, { force: true }); } catch {} continue; }
      if (Date.now() - t0 > waitMs) throw new Error('план занят другой правкой, повторите через минуту');
      await new Promise((r) => setTimeout(r, 60));
    }
  }
  try { return await fn(); } finally { try { fs.rmSync(f, { force: true }); } catch {} }
}

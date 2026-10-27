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
      why: c.why_massive || c.reason || '', evidence: c.evidence || [], demand: c.demand || null, demand_line: c.demand_line || (c.demand && c.demand.line) || '', status: 'planned',
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

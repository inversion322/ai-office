// Студия каналов (решение Ника 2026-10-27): ТРИ РАЗНЫЕ темы в день на канал — два поста в Telegram и один ролик Shorts.
// Самая востребованная по замеру спроса идёт на ролик, следующие две на посты. Чистая логика (без сети и моделей): выбор слотов, план дня, реестр.
// Хранение: smm/studio/plans/<дата>_<канал>.json (smm/ не в git). Время МСК (UTC+3 без перехода на летнее).
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './smm_lib.mjs';
import { similarity, findDuplicate } from './topic_dedupe.mjs';
import { mskToMs, mskParts } from './publish_when.mjs';

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
    out[k] = { key: k, lang: 'ru', planAt: '08:00', postFormat: 'short', ...c, ...o, slots: { ...DEFAULT_SLOTS, ...(c.slots || {}), ...(o.slots || {}) } };
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
/** Темы из планов за последние N дней (в том числе непринятых): они тоже «заняты» и не должны вернуться. */
export function plannedTitles(ch, { days = 45, now = Date.now() } = {}) {
  const out = [];
  let files = []; try { files = fs.readdirSync(path.join(studioDir(), 'plans')); } catch {}
  for (const f of files) {
    const m = /^(\d{4}-\d{2}-\d{2})_(.+)\.json$/.exec(f); if (!m || (ch && m[2] !== ch)) continue;
    if (now - Date.parse(m[1]) > days * 86400e3) continue;
    try { for (const s of JSON.parse(fs.readFileSync(path.join(studioDir(), 'plans', f), 'utf8')).slots || []) if (s.title && s.status !== 'dropped') out.push(s.title); } catch {}
  }
  return out;
}

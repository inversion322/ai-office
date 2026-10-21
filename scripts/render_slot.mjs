// Обёртка рендера для монтажёров (решение Ника 2026-10-21: «сократить круги цикла до трёх и делать три ролика параллельно»).
// Запуск монтажёром вместо прямого рендера:
//   node scripts/render_slot.mjs <проект> [--log <файл лога>] [--ns main|rework<N>] [--max N] -- npx --yes hyperframes@0.8.174 render -o <файл.mp4> <проект>
// Что делает КОДОМ, а не просьбой:
//   1) ЛИМИТ КРУГОВ: круг = один успешный рендер. После трёх (main) отказ с кодом 3 и текстом «финализируй последнюю версию».
//      Упавший рендер круг не сжигает, но после 6 неудач отказ с кодом 5. Счёт в <проект>/_render_rounds.json.
//   2) ОЧЕРЕДЬ: одновременно рендерят не больше RENDER_SLOTS (по умолчанию 2) процессов на всём ПК (общие слоты в smm/render_slots/).
//      Слот держится только на время самого рендера: раскадровка и сборка идут параллельно. Мёртвый или старше 45 минут слот освобождается сам.
//   3) НАГРУЗКА: к команде `hyperframes ... render` добавляется --workers (RENDER_WORKERS, по умолчанию 6), если монтажёр не задал свой.
// Коды выхода: код команды | 3 лимит кругов | 4 очередь не освободилась за RENDER_QUEUE_MAX_MIN | 5 слишком много неудач.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..');
export const DEFAULT_LIMITS = { main: 3, rework: 2 };
export const MAX_FAILS = 6;
const SLOT_STALE_MS = 45 * 60e3;

export const limitFor = (ns, max) => Number(max) > 0 ? Number(max) : (/^rework/.test(ns) ? DEFAULT_LIMITS.rework : DEFAULT_LIMITS.main);
const roundsFile = (proj) => path.join(proj, '_render_rounds.json');
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };

/** Состояние кругов проекта: { main: {done, fails, history:[…]}, rework1: {...} }. */
export function roundsState(proj) { return readJson(roundsFile(proj)) || {}; }
export function roundsInfo(proj, ns = 'main', max) {
  const st = roundsState(proj)[ns] || { done: 0, fails: 0 };
  return { done: st.done || 0, fails: st.fails || 0, limit: limitFor(ns, max) };
}
function saveRound(proj, ns, patch) {
  const all = roundsState(proj), cur = all[ns] || { done: 0, fails: 0, history: [] };
  const next = { ...cur, ...patch(cur) };
  all[ns] = next; fs.mkdirSync(proj, { recursive: true }); fs.writeFileSync(roundsFile(proj), JSON.stringify(all, null, 1));
  return next;
}
/** Строка для карточки приёмки: сколько кругов сделано и не шёл ли рендер мимо обёртки (тогда счёту верить нельзя). */
export function roundsNote(proj, ns = 'main', max) {
  const st = roundsState(proj)[ns]; const limit = limitFor(ns, max);
  let logs = 0; if (ns === 'main') { try { logs = fs.readdirSync(proj).filter((f) => /^_render_log_b\d+\.txt$/.test(f)).length; } catch {} }
  if (!st || !st.done) return logs ? `⚠️ Рендер шёл мимо обёртки (счёт кругов не велся): по логам ${logs} рендеров при лимите ${limit}.` : '';
  const waited = (st.history || []).reduce((a, h) => a + (h.waited || 0), 0), sec = (st.history || []).reduce((a, h) => a + (h.sec || 0), 0);
  const bypass = logs > st.done ? ` ⚠️ По логам рендеров ${logs}: часть шла мимо обёртки.` : '';
  return `🔁 Кругов рендера: ${st.done} из ${limit} (сам рендер ${Math.round(sec / 60)} мин${waited >= 60 ? `, в очереди ${Math.round(waited / 60)} мин` : ''}).${bypass}`;
}

/** Можно ли начинать ещё один рендер? */
export function canRender(proj, ns = 'main', max) {
  const { done, fails, limit } = roundsInfo(proj, ns, max);
  if (done >= limit) return { ok: false, code: 3, why: `ЛИМИТ КРУГОВ: ${done} из ${limit} рендеров уже сделано (решение Ника: не больше ${limit}). Нового рендера не будет: возьми последнюю собранную версию, доведи её (звук, проверки, RESULT.md, REVIEW_LOG.json с builds=${done}) и сдай. Недочёты, которые не успел исправить, честно перечисли в RESULT.md.` };
  if (fails >= MAX_FAILS) return { ok: false, code: 5, why: `Слишком много неудачных рендеров подряд (${fails}). Найди причину в логе, а не повторяй вслепую; если рендер невозможен, честно напиши об этом в RESULT.md.` };
  return { ok: true };
}

/* ---------------- очередь на слоты ---------------- */
const slotsDir = () => process.env.RENDER_SLOTS_DIR || path.join(ROOT, 'smm', 'render_slots');
const slotCount = () => Math.max(1, Number(process.env.RENDER_SLOTS) || 2);
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Занять свободный слот (атомарно, флагом wx). Возвращает { release, index } или null. */
export function tryAcquireSlot(owner, now = Date.now()) {
  const dir = slotsDir(); fs.mkdirSync(dir, { recursive: true });
  for (let i = 0; i < slotCount(); i++) {
    const f = path.join(dir, `slot-${i}.json`);
    const cur = readJson(f);
    if (cur && alive(cur.pid) && now - cur.ts < SLOT_STALE_MS) continue;     // занят живым процессом
    if (cur) try { fs.rmSync(f, { force: true }); } catch {}                 // брошенный слот
    try {
      const fd = fs.openSync(f, 'wx'); fs.writeSync(fd, JSON.stringify({ pid: process.pid, ts: now, owner })); fs.closeSync(fd);
      return { index: i, release: () => { const c = readJson(f); if (c && c.pid === process.pid) try { fs.rmSync(f, { force: true }); } catch {} } };
    } catch { /* соседний процесс успел раньше: пробуем следующий слот */ }
  }
  return null;
}
export function slotsBusy() {
  const dir = slotsDir(); let n = 0;
  try { for (const f of fs.readdirSync(dir)) { const c = readJson(path.join(dir, f)); if (c && alive(c.pid) && Date.now() - c.ts < SLOT_STALE_MS) n++; } } catch {}
  return n;
}
export async function acquireSlot(owner, { maxWaitMs, pollMs = 3000, onWait } = {}) {
  const t0 = Date.now(); let last = 0;
  for (;;) {
    const s = tryAcquireSlot(owner); if (s) return { ...s, waitedMs: Date.now() - t0 };
    if (Date.now() - t0 > maxWaitMs) return null;
    if (onWait && Date.now() - last > 30000) { last = Date.now(); onWait(Math.round((Date.now() - t0) / 1000)); }
    await sleep(pollMs);
  }
}

/** К команде `hyperframes … render` добавить --workers, если монтажёр не задал. */
export function withWorkers(cmd, workers = Number(process.env.RENDER_WORKERS) || 6) {
  const j = cmd.join(' ');
  if (!/hyperframes/.test(j) || !cmd.includes('render') || /(^|\s)(-w|--workers)(=|\s|$)/.test(j)) return cmd;
  const i = cmd.indexOf('render'); return [...cmd.slice(0, i + 1), `--workers=${workers}`, ...cmd.slice(i + 1)];
}

export function parseArgs(argv) {
  const dash = argv.indexOf('--'); const own = dash < 0 ? argv : argv.slice(0, dash), cmd = dash < 0 ? [] : argv.slice(dash + 1);
  const o = { proj: null, log: null, ns: 'main', max: null, cmd };
  for (let i = 0; i < own.length; i++) {
    if (own[i] === '--log') o.log = own[++i]; else if (own[i] === '--ns') o.ns = own[++i]; else if (own[i] === '--max') o.max = own[++i];
    else if (!o.proj) o.proj = own[i];
  }
  return o;
}

export async function runWrapped({ proj, log, ns = 'main', max = null, cmd }) {
  if (!proj || !cmd.length) { console.error('Использование: node render_slot.mjs <проект> [--log файл] [--ns main|rework1] [--max N] -- <команда рендера>'); return 2; }
  proj = path.resolve(proj);
  const can = canRender(proj, ns, max); if (!can.ok) { console.error(can.why); return can.code; }
  const info = roundsInfo(proj, ns, max);
  const maxWaitMs = (Number(process.env.RENDER_QUEUE_MAX_MIN) || 40) * 60e3;
  const slot = await acquireSlot(path.basename(proj), { maxWaitMs, pollMs: Number(process.env.RENDER_POLL_MS) || 3000, onWait: (s) => console.log(`в очереди на рендер: жду свободный слот уже ${s} с (слотов ${slotCount()}, занято ${slotsBusy()})`) });
  if (!slot) { console.error(`Очередь рендера не освободилась за ${maxWaitMs / 60e3} мин. Это не круг: повтори команду позже.`); return 4; }
  const round = info.done + 1, t0 = Date.now();
  console.log(`рендер: круг ${round} из ${info.limit} (${ns}), слот ${slot.index}${slot.waitedMs > 500 ? `, ждал очереди ${Math.round(slot.waitedMs / 1000)} с` : ''}`);
  const full = withWorkers(cmd);
  const out = log ? fs.openSync(path.isAbsolute(log) ? log : path.join(proj, log), 'a') : null;
  const code = await new Promise((resolve) => {
    const quote = (a) => (/[\s"&|<>^]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a);
    const p = spawn(full.map(quote).join(' '), { cwd: proj, shell: true, stdio: ['ignore', out ?? 'inherit', out ?? 'inherit'], windowsHide: true });
    p.on('error', () => resolve(1)); p.on('exit', (c) => resolve(c == null ? 1 : c));
  });
  slot.release(); if (out != null) fs.closeSync(out);
  const sec = Math.round((Date.now() - t0) / 1000);
  saveRound(proj, ns, (cur) => ({ done: code === 0 ? (cur.done || 0) + 1 : (cur.done || 0), fails: code === 0 ? 0 : (cur.fails || 0) + 1, history: [...(cur.history || []), { round, code, sec, waited: Math.round(slot.waitedMs / 1000), at: new Date().toISOString() }] }));
  const after = roundsInfo(proj, ns, max);
  console.log(code === 0 ? `рендер готов за ${sec} с. Кругов сделано ${after.done} из ${after.limit}${after.done >= after.limit ? ': это последний, дальше только финализация' : ''}.` : `рендер упал (код ${code}) за ${sec} с. Круг не засчитан (неудач подряд ${after.fails}).`);
  return code;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  runWrapped(parseArgs(process.argv.slice(2))).then((c) => process.exit(c), (e) => { console.error(e.message); process.exit(1); });
}

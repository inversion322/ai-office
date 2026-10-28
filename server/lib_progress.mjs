// Прогресс и оценка времени сотрудников (решение Ника 2026-10-21): у работающего сотрудника виден процент и «ещё ~N мин».
// Откуда берутся цифры:
//  - история: каждый запуск работы (agent_runs) измеряется от «начал» до «закончил» без пауз ожидания; ожидание берётся как медиана
//    последних 8 успешных запусков того же сотрудника и того же вида работы;
//  - пока истории нет, берётся оценка по умолчанию (DEFAULT_SEC): это догадка по прошлым роликам, в подписи помечена «первая оценка»;
//  - процент = прошедшее время / ожидаемое (не больше 95 %, пока работа не закончена). Если конвейер присылает настоящие
//    вехи (progress_real: например по файлам монтажа), берётся большее из двух, а остаток считается по скорости вех.
// Сборщик ходит по таблице agents раз в несколько секунд и по /api/agent, поэтому ему не важно, кто именно поменял статус.

const MIN = 60;
export const DEFAULT_SEC = {
  'video:produce': 50 * MIN, 'video:rework': 20 * MIN, 'video_b:produce': 45 * MIN, 'video_b:rework': 20 * MIN, 'video_c:produce': 45 * MIN, 'video_c:rework': 20 * MIN, 'captain_smm:produce': 50 * MIN, 'captain_smm:rework': 20 * MIN,
  'captain_smm:script': 20 * MIN, 'captain_smm:topics': 12 * MIN,
  'scriptwriter:run': 5 * MIN, 'factcheck:run': 3 * MIN, 'research:run': 6 * MIN, 'virality:run': 4 * MIN,
  'packager:run': 3 * MIN, 'publisher:run': 2 * MIN, 'translator:run': 4 * MIN,
};
export const MIN_HISTORY_MS = 45000;        // запуски короче не считаем (дребезг статуса)
const HISTORY_N = 8;
const REAL_FRESH_MS = 120000;               // «настоящий» прогресс принимается, пока обновлялся не позже двух минут назад

/** Вид работы: по сотруднику и тексту задачи в момент старта. Определяет, с чем сравнивать длительность. */
export function kindOf(agentId, task) {
  const t = String(task || '').toLowerCase();
  if (agentId === 'video' || agentId === 'video_b' || agentId === 'video_c') return /правк/.test(t) ? 'rework' : 'produce';
  if (agentId === 'captain_smm') return /правк/.test(t) ? 'rework' : /монтаж/.test(t) ? 'produce' : /сценар/.test(t) ? 'script' : /тем|поиск/.test(t) ? 'topics' : 'run';
  return 'run';
}
const keyOf = (agentId, kind) => `${agentId}:${kind}`;

export function median(nums) {
  const a = nums.filter(Number.isFinite).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : Math.round((a[m - 1] + a[m]) / 2);
}

/** «12 мин», «1 ч 05 мин». Округление вверх до минуты: «ещё ~0 мин» никогда не показываем. */
export function fmtDur(sec) {
  const m = Math.max(1, Math.round(sec / 60));
  return m < 60 ? `${m} мин` : `${Math.floor(m / 60)} ч ${String(m % 60).padStart(2, '0')} мин`;
}

/** Чистая оценка. elapsed/expected в секундах; reported 0..100 только если это настоящие вехи (иначе null). */
export function estimate({ elapsedSec, expectedSec, reported = null }) {
  const elapsed = Math.max(0, elapsedSec || 0);
  const rep = reported != null && reported > 0 ? Math.min(99, reported) : null;
  if (!expectedSec) {
    if (rep != null && rep >= 10 && elapsed >= 60) return { pct: Math.round(rep), remainingSec: Math.round(elapsed * (100 - rep) / rep), overrun: false };
    return { pct: rep != null ? Math.round(rep) : null, remainingSec: null, overrun: false };
  }
  const timePct = Math.min(95, elapsed / expectedSec * 100);
  const pct = Math.min(99, Math.max(timePct, rep ?? 0));
  // Остаток. Настоящая веха (rep) главнее расписания: она знает, что сделано на самом деле.
  //  - веха опережает или догоняет расписание: остаток по скорости вех (elapsed*(100-rep)/rep), но после минуты работы, пока скорость осмысленна;
  //  - до минуты, при веху ≥ 50 %: остаток по доле расписания (expected*(100-rep)/100);
  //  - веха отстаёт от расписания: идём по расписанию, но не меньше остатка по вехе.
  let remaining, overrun = false;
  if (rep != null && rep >= 10 && elapsed >= 60 && (rep >= timePct - 8 || elapsed > expectedSec)) remaining = elapsed * (100 - rep) / rep;
  else if (rep != null && rep >= 10 && elapsed < 60 && rep > timePct) remaining = expectedSec * (100 - rep) / 100;
  else if (elapsed < expectedSec) remaining = expectedSec - elapsed;
  else { remaining = Math.max(2 * MIN, expectedSec * 0.1); overrun = true; }                                         // вышли за обычное время, вех нет: честно «дольше обычного»
  if (rep == null && elapsed >= expectedSec) overrun = true;
  return { pct: Math.round(pct), remainingSec: Math.round(remaining), overrun };
}

/** Подпись для шкалы: «62% · ещё ~12 мин». basis: history | default | none. */
export function labelOf(est, basis, elapsedSec) {
  if (est.remainingSec == null) return est.pct != null ? `${est.pct}% · идёт ${fmtDur(elapsedSec)}` : `идёт ${fmtDur(elapsedSec)}`;
  const head = est.pct != null ? `${est.pct}% · ` : '';
  const tilde = basis === 'default' ? '≈' : '~';
  return est.overrun ? `${head}дольше, ещё ${tilde}${fmtDur(est.remainingSec)}` : `${head}ещё ${tilde}${fmtDur(est.remainingSec)}`;
}

/* ---------------- хранилище запусков ---------------- */
export function initProgress(db) {
  db.exec(`
CREATE TABLE IF NOT EXISTS agent_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, agent_id TEXT NOT NULL, kind TEXT NOT NULL,
  started_at INTEGER NOT NULL, finished_at INTEGER, paused_since INTEGER, paused_ms INTEGER NOT NULL DEFAULT 0,
  active_ms INTEGER, outcome TEXT,            -- ok | error | dup | partial
  last_progress INTEGER NOT NULL DEFAULT 0, source TEXT NOT NULL DEFAULT 'live'      -- live | seed
);
CREATE INDEX IF NOT EXISTS idx_runs_agent_kind ON agent_runs(agent_id, kind, outcome);`);
  const cols = db.prepare('PRAGMA table_info(agents)').all().map((c) => c.name);
  if (!cols.includes('progress_real')) db.exec('ALTER TABLE agents ADD COLUMN progress_real INTEGER NOT NULL DEFAULT 0');
  // Запуск, начатый до перезапуска сервера, не доживёт: его длительность неизвестна, в историю он не попадёт.
  db.prepare("UPDATE agent_runs SET finished_at=?, outcome='partial' WHERE finished_at IS NULL AND source='live' AND NOT EXISTS (SELECT 1 FROM agents a WHERE a.id=agent_runs.agent_id AND a.status IN ('working','waiting'))").run(Date.now());
}

/** Исторические запуски монтажа (по чату: утверждение сценария -> «ролик готов»): 55, 33 и 47 минут. Один раз. */
export function seedHistory(db, now = Date.now()) {
  const have = db.prepare("SELECT COUNT(*) n FROM agent_runs WHERE source='seed'").get().n;
  if (have) return false;
  const ins = db.prepare("INSERT INTO agent_runs (agent_id, kind, started_at, finished_at, active_ms, outcome, source) VALUES (?,?,?,?,?, 'ok', 'seed')");
  for (const agent of ['video', 'captain_smm']) for (const m of [55, 33, 47]) { const ms = m * MIN * 1000; ins.run(agent, 'produce', now - ms, now, ms); }
  return true;
}

/** Один проход по сотрудникам: открывает, ставит на паузу, возобновляет и закрывает запуски. Вызывать часто и безопасно. */
export function sampleRuns(db, now = Date.now()) {
  const agents = db.prepare('SELECT id, status, task, progress FROM agents').all();
  const open = db.prepare('SELECT * FROM agent_runs WHERE agent_id=? AND finished_at IS NULL ORDER BY id DESC');
  for (const a of agents) {
    const runs = open.all(a.id), cur = runs[0];
    for (const extra of runs.slice(1)) db.prepare("UPDATE agent_runs SET finished_at=?, outcome='dup' WHERE id=?").run(now, extra.id);
    if (a.status === 'working') {
      if (!cur) db.prepare('INSERT INTO agent_runs (agent_id, kind, started_at, last_progress) VALUES (?,?,?,?)').run(a.id, kindOf(a.id, a.task), now, Number(a.progress) || 0);
      else if (cur.paused_since) db.prepare('UPDATE agent_runs SET paused_ms=paused_ms+?, paused_since=NULL, last_progress=? WHERE id=?').run(now - cur.paused_since, Number(a.progress) || 0, cur.id);
      else if ((Number(a.progress) || 0) !== cur.last_progress) db.prepare('UPDATE agent_runs SET last_progress=? WHERE id=?').run(Number(a.progress) || 0, cur.id);
    } else if (a.status === 'waiting') {
      if (cur && !cur.paused_since) db.prepare('UPDATE agent_runs SET paused_since=? WHERE id=?').run(now, cur.id);
    } else if (cur) {
      const paused = cur.paused_ms + (cur.paused_since ? now - cur.paused_since : 0);
      const active = Math.max(0, now - cur.started_at - paused);
      db.prepare('UPDATE agent_runs SET finished_at=?, paused_ms=?, paused_since=NULL, active_ms=?, outcome=? WHERE id=?').run(now, paused, active, a.status === 'error' ? 'error' : 'ok', cur.id);
    }
  }
}

export function expectedFor(db, agentId, kind) {
  const rows = db.prepare("SELECT active_ms FROM agent_runs WHERE agent_id=? AND kind=? AND outcome='ok' AND active_ms>=? ORDER BY id DESC LIMIT ?").all(agentId, kind, MIN_HISTORY_MS, HISTORY_N);
  if (rows.length) return { sec: Math.round(median(rows.map((r) => r.active_ms)) / 1000), basis: 'history', n: rows.length };
  const d = DEFAULT_SEC[keyOf(agentId, kind)];
  return d ? { sec: d, basis: 'default', n: 0 } : { sec: null, basis: 'none', n: 0 };
}

/** Добавляет каждому работающему сотруднику поле pb: { pct, remaining_sec, elapsed_sec, overrun, basis, n, label, kind }. */
export function decorateAgents(db, agents, now = Date.now()) {
  const open = db.prepare('SELECT * FROM agent_runs WHERE agent_id=? AND finished_at IS NULL ORDER BY id DESC LIMIT 1');
  return agents.map((a) => {
    if (a.status !== 'working') return a;
    const run = open.get(a.id);
    if (!run) return a;
    const elapsedSec = Math.max(0, (now - run.started_at - run.paused_ms) / 1000);
    const exp = expectedFor(db, a.id, run.kind);
    const real = a.progress_real && now - (a.updated_at || 0) <= REAL_FRESH_MS ? Number(a.progress) || 0 : null;
    const est = estimate({ elapsedSec, expectedSec: exp.sec, reported: real });
    return { ...a, pb: { pct: est.pct, remaining_sec: est.remainingSec, elapsed_sec: Math.round(elapsedSec), overrun: est.overrun, basis: exp.basis, n: exp.n, kind: run.kind, label: labelOf(est, exp.basis, elapsedSec) } };
  });
}

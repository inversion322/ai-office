// Прогресс и оценка времени сотрудников (server/lib_progress.mjs) и вехи монтажа по файлам (scripts/video_progress.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { kindOf, median, estimate, fmtDur, labelOf, initProgress, seedHistory, sampleRuns, expectedFor, decorateAgents, DEFAULT_SEC } from '../server/lib_progress.mjs';
import { videoMilestone, watchVideoProgress } from '../scripts/video_progress.mjs';

const MIN = 60000;
function mkdb() {
  const db = new DatabaseSync(':memory:');
  db.exec("CREATE TABLE agents (id TEXT PRIMARY KEY, name TEXT, status TEXT DEFAULT 'idle', task TEXT, progress INTEGER DEFAULT 0, updated_at INTEGER)");
  for (const id of ['video', 'captain_smm', 'scriptwriter']) db.prepare('INSERT INTO agents (id,name) VALUES (?,?)').run(id, id);
  initProgress(db);
  return db;
}
const setA = (db, id, status, task, progress = 0, t = Date.now()) => db.prepare('UPDATE agents SET status=?, task=COALESCE(?,task), progress=?, updated_at=? WHERE id=?').run(status, task, progress, t, id);
const runs = (db, id) => db.prepare('SELECT * FROM agent_runs WHERE agent_id=? ORDER BY id').all(id);

test('вид работы определяется по сотруднику и тексту задачи', () => {
  assert.equal(kindOf('video', 'Озвучка, субтитры, монтаж (Opus 5.5)'), 'produce');
  assert.equal(kindOf('video', 'Правки ролика №4 → v2: короче'), 'rework');
  assert.equal(kindOf('captain_smm', 'Монтаж: «Кофе»'), 'produce');
  assert.equal(kindOf('captain_smm', 'Правки ролика №4 (приоритет)'), 'rework');
  assert.equal(kindOf('captain_smm', 'Сценарий: «Кофе»'), 'script');
  assert.equal(kindOf('captain_smm', 'Запускаю поиск тем'), 'topics');
  assert.equal(kindOf('scriptwriter', 'Пишу сценарий'), 'run');
  assert.equal(kindOf('video_b', 'Озвучка, субтитры, монтаж (Opus 5.5)'), 'produce'); assert.equal(kindOf('video_c', 'Правки ролика №4'), 'rework');
  assert.ok(DEFAULT_SEC['video_b:produce'] < DEFAULT_SEC['video:produce'], 'у B и C три круга, оценка по умолчанию короче');
});

test('median и форматирование времени', () => {
  assert.equal(median([55, 33, 47]), 47); assert.equal(median([10, 20]), 15); assert.equal(median([]), null);
  assert.equal(fmtDur(20), '1 мин'); assert.equal(fmtDur(12 * 60), '12 мин'); assert.equal(fmtDur(65 * 60), '1 ч 05 мин'); assert.equal(fmtDur(120 * 60), '2 ч 00 мин');
});

test('оценка только по времени: процент растёт, остаток убывает, до 95 % и «дольше»', () => {
  assert.deepEqual(estimate({ elapsedSec: 600, expectedSec: 3000 }), { pct: 20, remainingSec: 2400, overrun: false });
  assert.deepEqual(estimate({ elapsedSec: 0, expectedSec: 3000 }), { pct: 0, remainingSec: 3000, overrun: false });
  const late = estimate({ elapsedSec: 3600, expectedSec: 3000 });
  assert.equal(late.pct, 95); assert.equal(late.overrun, true); assert.ok(late.remainingSec >= 120);
});

test('настоящие вехи главнее расписания: остаток по их скорости; отстающая веха не портит оценку', () => {
  const ahead = estimate({ elapsedSec: 600, expectedSec: 3000, reported: 50 });
  assert.equal(ahead.pct, 50); assert.equal(ahead.remainingSec, 600);            // 10 мин на половину = ещё 10 мин
  const behind = estimate({ elapsedSec: 1500, expectedSec: 3000, reported: 10 });
  assert.equal(behind.pct, 50); assert.equal(behind.remainingSec, 1500);          // веха отстаёт сильно: идём по расписанию
  assert.equal(estimate({ elapsedSec: 4000, expectedSec: 3000, reported: 80 }).remainingSec, 1000);   // дольше обычного, но веха известна
  const early = estimate({ elapsedSec: 1, expectedSec: 2820, reported: 70 });     // сразу после старта (перезапуск посреди монтажа)
  assert.equal(early.pct, 70); assert.equal(early.remainingSec, 846);             // 30 % от 47 мин, а не «ещё 47 мин»
  const onTrack = estimate({ elapsedSec: 1500, expectedSec: 3000, reported: 45 });
  assert.equal(onTrack.remainingSec, Math.round(1500 * 55 / 45));                 // веха чуть отстаёт (в пределах 8 пунктов): по вехам
});

test('без истории и без вех процента нет, есть только «идёт N мин»; с вехами остаток экстраполируется', () => {
  const none = estimate({ elapsedSec: 300, expectedSec: null });
  assert.deepEqual(none, { pct: null, remainingSec: null, overrun: false });
  assert.equal(labelOf(none, 'none', 300), 'идёт 5 мин');
  const ex = estimate({ elapsedSec: 600, expectedSec: null, reported: 40 });
  assert.equal(ex.pct, 40); assert.equal(ex.remainingSec, 900);
});

test('подпись шкалы: «62% · ещё ~12 мин», «≈» для первой оценки, «дольше»', () => {
  assert.equal(labelOf({ pct: 62, remainingSec: 720, overrun: false }, 'history', 1), '62% · ещё ~12 мин');
  assert.equal(labelOf({ pct: 20, remainingSec: 2400, overrun: false }, 'default', 1), '20% · ещё ≈40 мин');
  assert.equal(labelOf({ pct: 95, remainingSec: 300, overrun: true }, 'history', 1), '95% · дольше, ещё ~5 мин');
});

test('запуски: старт, пауза ожидания не считается, закрытие считает чистое время и исход', () => {
  const db = mkdb(); const t0 = 1_000_000_000_000;
  setA(db, 'video', 'working', 'Озвучка, субтитры, монтаж', 3); sampleRuns(db, t0);
  assert.equal(runs(db, 'video').length, 1); assert.equal(runs(db, 'video')[0].kind, 'produce');
  sampleRuns(db, t0 + 5 * MIN); assert.equal(runs(db, 'video').length, 1, 'повторный проход не открывает второй запуск');
  setA(db, 'video', 'waiting', null); sampleRuns(db, t0 + 10 * MIN);               // ждёт Ника (или уступает правкам)
  setA(db, 'video', 'working', null, 40); sampleRuns(db, t0 + 30 * MIN);           // пауза 20 минут
  setA(db, 'video', 'idle', null, 100); sampleRuns(db, t0 + 50 * MIN);
  const r = runs(db, 'video')[0];
  assert.equal(r.outcome, 'ok'); assert.equal(r.paused_ms, 20 * MIN); assert.equal(r.active_ms, 30 * MIN); assert.equal(r.finished_at, t0 + 50 * MIN);
});

test('ошибка закрывает запуск как error: в историю для оценок он не попадает', () => {
  const db = mkdb(); const t0 = 2_000_000_000_000;
  setA(db, 'video', 'working', 'Озвучка, монтаж'); sampleRuns(db, t0);
  setA(db, 'video', 'error', 'Ролик не собран'); sampleRuns(db, t0 + 20 * MIN);
  assert.equal(runs(db, 'video')[0].outcome, 'error');
  assert.equal(expectedFor(db, 'video', 'produce').basis, 'default');
});

test('оценка ожидания: медиана последних успешных запусков; короткие и чужого вида не считаются; без истории берётся значение по умолчанию', () => {
  const db = mkdb(); const base = 3_000_000_000_000;
  const add = (agent, kind, minutes, outcome = 'ok') => db.prepare("INSERT INTO agent_runs (agent_id, kind, started_at, finished_at, active_ms, outcome) VALUES (?,?,?,?,?,?)").run(agent, kind, base, base + minutes * MIN, minutes * MIN, outcome);
  assert.deepEqual(expectedFor(db, 'video', 'produce'), { sec: DEFAULT_SEC['video:produce'], basis: 'default', n: 0 });
  assert.deepEqual(expectedFor(db, 'unknown', 'run'), { sec: null, basis: 'none', n: 0 });
  for (const m of [55, 33, 47]) add('video', 'produce', m);
  add('video', 'produce', 0.2); add('video', 'rework', 99); add('video', 'produce', 500, 'error');
  const e = expectedFor(db, 'video', 'produce');
  assert.deepEqual(e, { sec: 47 * 60, basis: 'history', n: 3 });
});

test('начальная история монтажа записывается один раз', () => {
  const db = mkdb();
  assert.equal(seedHistory(db, 5_000_000_000_000), true); assert.equal(seedHistory(db, 5_000_000_000_000), false);
  assert.equal(expectedFor(db, 'video', 'produce').sec, 47 * 60); assert.equal(expectedFor(db, 'captain_smm', 'produce').basis, 'history');
});

test('decorateAgents: у работающего появляется pb с процентом и остатком, у остальных нет', () => {
  const db = mkdb(); seedHistory(db, 6_000_000_000_000);
  const t0 = 6_100_000_000_000;
  setA(db, 'video', 'working', 'Озвучка, субтитры, монтаж', 3, t0); sampleRuns(db, t0);
  const list = () => decorateAgents(db, db.prepare('SELECT *, 0 AS progress_real FROM agents').all(), t0 + 14 * MIN + 6000);
  const v = list().find((a) => a.id === 'video');
  assert.equal(v.pb.basis, 'history'); assert.equal(v.pb.kind, 'produce'); assert.equal(v.pb.elapsed_sec, 14 * 60 + 6);
  assert.equal(v.pb.pct, 30); assert.equal(v.pb.remaining_sec, 47 * 60 - (14 * 60 + 6)); assert.match(v.pb.label, /^30% · ещё ~33 мин$/);
  assert.equal(list().find((a) => a.id === 'scriptwriter').pb, undefined);
});

test('прогресс из вех принимается только если он «настоящий» и свежий', () => {
  const db = mkdb(); seedHistory(db, 7_000_000_000_000);
  const t0 = 7_100_000_000_000;
  setA(db, 'video', 'working', 'Озвучка, субтитры, монтаж', 82, t0); sampleRuns(db, t0);
  const row = (real, updated) => ({ ...db.prepare('SELECT * FROM agents WHERE id=?').get('video'), progress_real: real, updated_at: updated });
  const at = t0 + 10 * MIN;
  assert.equal(decorateAgents(db, [row(0, at)], at)[0].pb.pct, 21, 'заглушка этапа (82 из конвейера) не считается прогрессом');
  assert.equal(decorateAgents(db, [row(1, at - 30000)], at)[0].pb.pct, 82);
  assert.equal(decorateAgents(db, [row(1, at - 300000)], at)[0].pb.pct, 21, 'устаревшая веха игнорируется');
});

test('сервер перезапущен посреди работы: брошенный запуск закрывается как partial и в историю не идёт', () => {
  const db = mkdb(); const t0 = 8_000_000_000_000;
  setA(db, 'video', 'working', 'Озвучка, монтаж'); sampleRuns(db, t0);
  setA(db, 'video', 'idle', null);                                         // пока сервер не работал, сотрудник закончил
  initProgress(db);
  const r = runs(db, 'video')[0]; assert.equal(r.outcome, 'partial'); assert.notEqual(r.finished_at, null);
  assert.equal(expectedFor(db, 'video', 'produce').basis, 'default');
});

test('два открытых запуска не накапливаются: лишний закрывается как dup', () => {
  const db = mkdb(); const t0 = 9_000_000_000_000;
  db.prepare('INSERT INTO agent_runs (agent_id, kind, started_at) VALUES (?,?,?)').run('video', 'produce', t0);
  db.prepare('INSERT INTO agent_runs (agent_id, kind, started_at) VALUES (?,?,?)').run('video', 'produce', t0 + 1);
  setA(db, 'video', 'working', 'монтаж'); sampleRuns(db, t0 + MIN);
  assert.deepEqual(runs(db, 'video').map((r) => r.outcome), ['dup', null]);
});

/* ---------- вехи монтажа по файлам ---------- */
function tmpProj() { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'vprog-')); return d; }
const touch = (d, f, text = 'x') => { fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true }); fs.writeFileSync(path.join(d, f), text); };

test('вехи монтажа растут по следам Кирилла и не превышают 97', () => {
  const d = tmpProj(), since = Date.now() - 1000;
  assert.equal(videoMilestone(d, 19, since).pct, 3);
  touch(d, '_narrate_log.txt'); assert.deepEqual(videoMilestone(d, 19, since), { pct: 10, step: 'озвучка и субтитры' });
  touch(d, 'STORYBOARD.json'); assert.equal(videoMilestone(d, 19, since).pct, 22);
  touch(d, 'build_dosie19.py'); assert.equal(videoMilestone(d, 19, since).pct, 30);
  touch(d, '_render_log_b1.txt', '@hf-progress {"code":"capture","pct":50}\n'); assert.equal(videoMilestone(d, 19, since).pct, 35);        // внутри первого рендера
  touch(d, '_frames_log_b1.txt'); assert.equal(videoMilestone(d, 19, since).pct, 40);                                                          // рендер просмотрен
  for (const k of [2, 3, 4, 5]) { touch(d, `_render_log_b${k}.txt`, '@hf-progress {"pct":100}\n'); touch(d, `_frames_log_b${k}.txt`); }
  assert.equal(videoMilestone(d, 19, since).pct, 70, 'после четвёртого рендера вехи не растут от числа сборок');
  touch(d, '_finalize.json'); assert.equal(videoMilestone(d, 19, since).pct, 82);
  touch(d, '_dynamics_log.txt'); assert.equal(videoMilestone(d, 19, since).pct, 90);
  touch(d, 'final/dosie19_v1.mp4'); assert.equal(videoMilestone(d, 19, since).pct, 95);
  touch(d, 'RESULT.md'); assert.deepEqual(videoMilestone(d, 19, since), { pct: 97, step: 'отчёт' });
  fs.rmSync(d, { recursive: true, force: true });
});

test('файлы, оставшиеся от прошлых запусков (старше старта монтажа), вех не дают', () => {
  const d = tmpProj();
  touch(d, '_narrate_log.txt'); touch(d, '_finalize.json'); touch(d, 'final/dosie04_v1.mp4');
  const old = new Date(Date.now() - 3 * 3600 * 1000);
  for (const f of ['_narrate_log.txt', '_finalize.json', 'final/dosie04_v1.mp4']) fs.utimesSync(path.join(d, f), old, old);
  assert.equal(videoMilestone(d, 4, Date.now() - 60000).pct, 3);
  assert.equal(videoMilestone(path.join(d, 'нет-такой'), 4, 0).pct, 0);
  fs.rmSync(d, { recursive: true, force: true });
});

test('наблюдатель шлёт только растущий процент и останавливается', async () => {
  const d = tmpProj(), got = [];
  const stop = watchVideoProgress(d, 7, Date.now() - 1000, (pct, step) => got.push([pct, step]), { intervalMs: 40 });
  touch(d, '_narrate_log.txt'); await new Promise((r) => setTimeout(r, 120));
  touch(d, 'STORYBOARD.json'); await new Promise((r) => setTimeout(r, 120));
  stop(); const n = got.length; touch(d, 'build_dosie07.py'); await new Promise((r) => setTimeout(r, 120));
  assert.deepEqual(got.map((g) => g[0]), [3, 10, 22]); assert.equal(got.length, n, 'после stop новых отчётов нет');
  fs.rmSync(d, { recursive: true, force: true });
});

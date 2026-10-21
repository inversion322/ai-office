// Обязательное применение vizavi-motion (решение Ника 2026-10-21: «используем vizavi вместо editing-videos, использование обязательное»).
// Недостаточно открыть скилл: проверяем артефакты его метода.
//   1) ДО сборки: <проект>/STORYBOARD.json: единая нить и по каждой сцене 3-5 существенно разных вариантов, выбор и причина, камера, типографика, вход/выход.
//   2) ПОСЛЕ первой сборки (она считается черновиком): <проект>/REVIEW_LOG.json: просмотр и правки в формате «интервал → наблюдение → причина → правка → повторная проверка»,
//      честные статусы (реализовано / проверено запуском / видно в кадрах / проверено в движении / прослушано) и итоговая проверка готового файла.
//   3) В отчёте RESULT*.md раздел «Использовано из vizavi-motion».
// Запуск Кириллом: node scripts/check_vizavi.mjs <проект> --storyboard | --review   (код 0 обязателен). Те же проверки в воротах конвейера (video_gate.mjs). Обход для тестов: VIZAVI_GATE=off.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const LIMITS = { minScenes: 4, minVariants: 3, maxVariants: 5, minThread: 30, minText: 12, minReviewEntries: 2, minNoDefects: 40, minFinal: 30 };
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const s = (v) => String(v == null ? '' : v).trim();
const norm = (t) => s(t).toLowerCase().replace(/ё/g, 'е').replace(/[^а-яa-z0-9\s]/gi, ' ').replace(/\s+/g, ' ').trim();
const stems = (t) => new Set(norm(t).split(' ').filter((w) => w.length >= 4).map((w) => w.slice(0, 5)));
const overlap = (a, b) => { const A = stems(a), B = stems(b); const u = new Set([...A, ...B]); if (!u.size) return 0; let i = 0; for (const x of A) if (B.has(x)) i++; return i / u.size; };

/** Раскадровка: { thread, scenes:[{id, variants[3-5], chosen, why, camera, typography, in, out}] } */
export function checkStoryboard(sb, L = LIMITS) {
  const p = [];
  if (!sb || typeof sb !== 'object') return { problems: ['нет STORYBOARD.json или он не читается'] };
  if (s(sb.thread).length < L.minThread) p.push(`STORYBOARD.thread: единая нить одним-двумя предложениями (что действует, что меняется, какую мысль доказывает результат), не короче ${L.minThread} знаков`);
  const sc = Array.isArray(sb.scenes) ? sb.scenes : [];
  if (sc.length < L.minScenes) p.push(`в STORYBOARD.scenes ${sc.length} сцен, нужно не меньше ${L.minScenes} (сцена = абзац сценария, 5-7 штук)`);
  sc.forEach((x, i) => {
    const n = `сцена ${x && x.id != null ? x.id : i + 1}`;
    const v = (Array.isArray(x && x.variants) ? x.variants : []).map(s).filter(Boolean);
    if (v.length < L.minVariants || v.length > L.maxVariants) p.push(`${n}: вариантов ${v.length}, нужно ${L.minVariants}-${L.maxVariants} существенно разных (действие, пространство, метафора или переход; смена цвета и шрифта не вариант)`);
    else if (v.some((t) => t.length < L.minText)) p.push(`${n}: вариант короче ${L.minText} знаков, опиши действие`);
    else { let dup = false; for (let a = 0; a < v.length; a++) for (let b = a + 1; b < v.length; b++) if (overlap(v[a], v[b]) > 0.6) dup = true; if (dup) p.push(`${n}: два варианта пересказывают одно и то же, нужны существенно разные`); }
    const ch = Number(x && x.chosen); if (!(ch >= 1 && ch <= Math.max(v.length, 1))) p.push(`${n}: chosen это номер выбранного варианта (1-${v.length})`);
    if (s(x && x.why).length < 10) p.push(`${n}: why, коротко почему этот вариант сильнее для всего ролика`);
    for (const k of ['camera', 'typography']) if (s(x && x[k]).length < 8) p.push(`${n}: поле ${k} (${k === 'camera' ? 'путь камеры, крупность, глубина и фокус' : 'что делают буквы и слова'})`);
    if (i > 0 && s(x && x.in).length < 5) p.push(`${n}: поле in, как сцена входит из предыдущей`);
    if (i < sc.length - 1 && s(x && x.out).length < 5) p.push(`${n}: поле out, как сцена выходит в следующую`);
  });
  return { problems: p };
}

const STATUSES = ['implemented', 'run_checked', 'frames_seen', 'motion_seen', 'listened'];
/** Журнал: { builds, entries:[{interval, observation, cause, fix, recheck}], no_defects_reason, final_check, statuses:{...} } */
export function checkReview(rv, L = LIMITS) {
  const p = [];
  if (!rv || typeof rv !== 'object') return { problems: ['нет REVIEW_LOG.json или он не читается'] };
  const entries = Array.isArray(rv.entries) ? rv.entries : [];
  entries.forEach((e, i) => { for (const k of ['interval', 'observation', 'cause', 'fix', 'recheck']) if (s(e && e[k]).length < 3) p.push(`REVIEW_LOG.entries[${i + 1}]: пустое поле ${k} (формат: интервал → наблюдение → причина → правка → повторная проверка)`); });
  if (entries.length < L.minReviewEntries) { if (s(rv.no_defects_reason).length < L.minNoDefects) p.push(`в журнале ${entries.length} замечаний, нужно не меньше ${L.minReviewEntries}; если дефектов правда нет, объясни в no_defects_reason (не короче ${L.minNoDefects} знаков), что именно проверено`); }
  else if (Number(rv.builds) < 2) p.push('REVIEW_LOG.builds: первая сборка это черновик; после правок нужна минимум вторая (builds >= 2)');
  if (s(rv.final_check).length < L.minFinal) p.push(`REVIEW_LOG.final_check: что проверено в ГОТОВОМ файле (формат, начало и конец, границы сцен, звук), не короче ${L.minFinal} знаков`);
  const st = rv.statuses && typeof rv.statuses === 'object' ? rv.statuses : null;
  if (!st || STATUSES.some((k) => typeof st[k] !== 'boolean')) p.push(`REVIEW_LOG.statuses: честные статусы true/false по каждому пункту: ${STATUSES.join(', ')} (непроверенное не получает true)`);
  return { problems: p };
}

export function checkReportSection(proj, name = 'RESULT.md') {
  let t = ''; try { t = fs.readFileSync(path.join(proj, name), 'utf8'); } catch {}
  return /использовано из vizavi-motion/i.test(t) ? [] : [`в ${name} нет раздела «Использовано из vizavi-motion» (что взято из раскадровки с вариантами, что исправлено по журналу)`];
}
export function checkProjectVizavi(proj, { storyboard = true, review = true, report = null } = {}) {
  const problems = [];
  if (storyboard) problems.push(...checkStoryboard(readJson(path.join(proj, 'STORYBOARD.json'))).problems);
  if (review) problems.push(...checkReview(readJson(path.join(proj, 'REVIEW_LOG.json'))).problems);
  if (report) problems.push(...checkReportSection(proj, report));
  return { ok: problems.length === 0, problems };
}
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const args = process.argv.slice(2), proj = path.resolve(args.find((a) => !a.startsWith('--')) || '.');
  const only = args.includes('--storyboard') ? 'storyboard' : args.includes('--review') ? 'review' : 'both';
  const r = checkProjectVizavi(proj, { storyboard: only !== 'review', review: only !== 'storyboard' });
  console.log(r.ok ? `vizavi-motion: ок (${only})` : 'vizavi-motion:\n  - ' + r.problems.join('\n  - ')); process.exit(r.ok ? 0 : 1);
}

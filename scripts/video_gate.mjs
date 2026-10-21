// Единые ворота перед отправкой ролика Нику: формат Shorts/Reels, шляпа утки, динамика (для роликов формата A).
// Динамика включается, если правка явно про неё (в тексте есть DYNAMICS.md), если ролик новый (produce) или проект уже помечен format.json = A.
// Принятые ролики старого формата (№1) при мелких правках динамикой не блокируются. Обход: DYNAMICS_GATE=off (только вручную).
import fs from 'node:fs';
import path from 'node:path';
import { probeVideo, checkFormat } from './video_format.mjs';
import { checkProject } from './check_duck_hat.mjs';
import { decodeFrames, measure, judge, summaryLine, FORMAT_PROFILES } from './video_dynamics.mjs';
import { checkSfx } from './sfx_check.mjs';
import { checkCta } from './check_cta.mjs';
import { checkProjectPlan, checkReportSection } from './check_library_plan.mjs';
import { checkProjectVizavi } from './check_vizavi.mjs';
import { checkVerdictLabels } from './check_verdict_label.mjs';

const fmtFile = (proj) => path.join(proj, 'format.json');
const FORMATS_OK = ['A', 'B', 'C'];
/** Формат проекта по format.json (A «Лента», B «Один объект», C «Диалог») или null: у принятых роликов старого формата метки нет. */
export const projectFormat = (proj) => { try { const f = JSON.parse(fs.readFileSync(fmtFile(proj), 'utf8')).format; return FORMATS_OK.includes(f) ? f : null; } catch { return null; } };
export const hasFormat = (proj) => !!projectFormat(proj);
export const isFormatA = (proj) => projectFormat(proj) === 'A';
export const markFormat = (proj, fmt = 'A') => fs.writeFileSync(fmtFile(proj), JSON.stringify({ format: FORMATS_OK.includes(fmt) ? fmt : 'A', ts: Date.now() }));
export const markFormatA = (proj) => markFormat(proj, 'A');

export function gate(mp4, proj, { dynamics = false, reportName = 'RESULT.md', format = null } = {}) {
  const problems = []; let summary = '';
  const fmt = format || projectFormat(proj) || 'A', strict = dynamics || hasFormat(proj) || !!format;      // ролик любого из трёх форматов проходит все общие ворота; динамика судится по профилю формата
  problems.push(...checkFormat(probeVideo(mp4)).problems);
  for (const x of checkProject(proj).problems) for (const b of x.bad) problems.push(`шляпа не по центру: ${x.file}:${b.line} (${b.found})`);
  if (process.env.SFX_GATE !== 'off' && strict) problems.push(...checkSfx(proj).problems.map((p) => 'звук: ' + p));
  if (strict) problems.push(...checkCta(proj).problems.map((p) => 'призыв: ' + p));
  if (process.env.VERDICT_GATE !== 'off' && strict) problems.push(...checkVerdictLabels(proj).problems.map((p) => 'вердикт: ' + p));
  if (process.env.VIZAVI_GATE !== 'off' && strict) problems.push(...checkProjectVizavi(proj, { report: reportName || null }).problems.map((p) => 'vizavi: ' + p));   // vizavi-motion обязателен (Ник 2026-10-21): раскадровка с вариантами и журнал правок
  if (process.env.LIBRARY_GATE !== 'off' && strict) { problems.push(...checkProjectPlan(proj).problems.map((p) => 'библиотека: ' + p)); const sec = reportName ? checkReportSection(proj, reportName) : []; problems.push(...sec.map((p) => 'библиотека: ' + p)); }
  const useDyn = strict && process.env.DYNAMICS_GATE !== 'off';
  let metrics = null;
  if (useDyn) { metrics = measure(decodeFrames(mp4)); summary = summaryLine(metrics); problems.push(...judge(metrics, FORMAT_PROFILES[fmt] || FORMAT_PROFILES.A).problems.map((p) => 'динамика: ' + p)); }
  return { ok: problems.length === 0, problems, summary, dynamicsChecked: useDyn, metrics, format: fmt };
}

// Единые ворота перед отправкой ролика Нику: формат Shorts/Reels, шляпа утки, динамика (для роликов формата A).
// Динамика включается, если правка явно про неё (в тексте есть DYNAMICS.md), если ролик новый (produce) или проект уже помечен format.json = A.
// Принятые ролики старого формата (№1) при мелких правках динамикой не блокируются. Обход: DYNAMICS_GATE=off (только вручную).
import fs from 'node:fs';
import path from 'node:path';
import { probeVideo, checkFormat } from './video_format.mjs';
import { checkProject } from './check_duck_hat.mjs';
import { decodeFrames, measure, judge, summaryLine } from './video_dynamics.mjs';

const fmtFile = (proj) => path.join(proj, 'format.json');
export const isFormatA = (proj) => { try { return JSON.parse(fs.readFileSync(fmtFile(proj), 'utf8')).format === 'A'; } catch { return false; } };
export const markFormatA = (proj) => fs.writeFileSync(fmtFile(proj), JSON.stringify({ format: 'A', ts: Date.now() }));

export function gate(mp4, proj, { dynamics = false } = {}) {
  const problems = []; let summary = '';
  problems.push(...checkFormat(probeVideo(mp4)).problems);
  for (const x of checkProject(proj).problems) for (const b of x.bad) problems.push(`шляпа не по центру: ${x.file}:${b.line} (${b.found})`);
  const useDyn = (dynamics || isFormatA(proj)) && process.env.DYNAMICS_GATE !== 'off';
  let metrics = null;
  if (useDyn) { metrics = measure(decodeFrames(mp4)); summary = summaryLine(metrics); problems.push(...judge(metrics).problems.map((p) => 'динамика: ' + p)); }
  return { ok: problems.length === 0, problems, summary, dynamicsChecked: useDyn, metrics };
}

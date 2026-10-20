// Измеритель динамики ролика по готовому mp4: считает то, что видит зритель, а не то, что обещает сценарий сборки.
// Зачем: ролики №1 и №2 формально следовали правилу «смена картинки каждые 1-1,5 с», но по измерению 72-74 % времени кадр почти неподвижен,
// фон ни разу не меняется, резких смен нет (текст, который печатается внутри одной карточки, не «новая картинка»).
// Использование: node scripts/video_dynamics.mjs <ролик.mp4> [--json]   (код выхода 1, если ниже порогов THRESHOLDS)
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ffprobePath } from './video_format.mjs';

export const W = 54, H = 96, FPS = 10;
// Пороги для 45-59 с. Откалиброваны на роликах №1 и №2 (оба 0 ударов, 72-74 % статики, фон не меняется) и на контрольных синтетических клипах.
export const THRESHOLDS = {
  nonBaseBg: 0.30,       // доля времени с цветным (не бумажным) фоном на весь экран
  hues: 3,               // различных оттенков фона (с долей ≥ 4 %), бумажный тоже считается
  beatsPer10s: 1.2,      // резких смен большей части кадра на каждые 10 с
  maxBeatGap: 4.5,       // самая длинная пауза без резкой смены, с
  sameShare: 0.25,       // не более четверти времени картинка отличается от бывшей секунду назад меньше чем на 10 % площади (ролики №1 и №2: 55-60 %)
  brightRange: 14,       // медиана размаха яркости в окне 2 с
};
const BASE = [245, 243, 238];

export function decodeFrames(file) {
  const ff = path.join(path.dirname(ffprobePath()), 'ffmpeg.exe');
  const r = spawnSync(ff, ['-v', 'error', '-i', file, '-an', '-vf', `fps=${FPS},scale=${W}:${H}:flags=area`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { maxBuffer: 1 << 29 });
  if (r.status !== 0) throw new Error('ffmpeg не прочитал файл: ' + String(r.stderr).slice(0, 200));
  const n = Math.floor(r.stdout.length / (W * H * 3)), out = [];
  for (let i = 0; i < n; i++) out.push(r.stdout.subarray(i * W * H * 3, (i + 1) * W * H * 3));
  return out;
}
const ringColor = (f) => { const px = []; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (x < 3 || x >= W - 3 || y < 3 || y >= H - 3) { const o = (y * W + x) * 3; px.push([f[o], f[o + 1], f[o + 2]]); } const med = (k) => px.map((p) => p[k]).sort((a, b) => a - b)[px.length >> 1]; return [med(0), med(1), med(2)]; };
const luma = (f) => { let s = 0; for (let i = 0; i < f.length; i += 3) s += 0.2126 * f[i] + 0.7152 * f[i + 1] + 0.0722 * f[i + 2]; return s / (W * H); };
const changed = (a, b, thr) => { let c = 0; for (let i = 0; i < W * H; i++) { const o = i * 3; if (Math.abs(a[o] - b[o]) + Math.abs(a[o + 1] - b[o + 1]) + Math.abs(a[o + 2] - b[o + 2]) > thr) c++; } return c / (W * H); };
export function hueBucket([r, g, b]) { const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; if (d < 30 || mx < 60) return mx < 90 ? 'dark' : 'neutral'; let h; if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4; return 'h' + Math.floor(((h * 60 + 360) % 360) / 30); }

export function measure(frames) {
  const n = frames.length; if (n < 20) throw new Error('слишком короткий ролик для измерения');
  const sec = n / FPS, rings = frames.map(ringColor), L = frames.map(luma);
  const dist = (c) => Math.abs(c[0] - BASE[0]) + Math.abs(c[1] - BASE[1]) + Math.abs(c[2] - BASE[2]);
  const nonBaseBg = rings.filter((c) => dist(c) > 60).length / n;
  const buckets = {}; rings.forEach((c) => { const k = hueBucket(c); buckets[k] = (buckets[k] || 0) + 1; });
  const hues = Object.entries(buckets).filter(([, v]) => v / n >= 0.04).map(([k]) => k);
  // резкая смена: заметно изменилась четверть кадра и более за 0,1 с; не чаще раза в 0,4 с
  const beats = []; for (let i = 1; i < n; i++) if (changed(frames[i - 1], frames[i], 45) >= 0.25 && (!beats.length || (i - beats[beats.length - 1]) / FPS >= 0.4)) beats.push(i);
  const gaps = []; let prev = 0; for (const b of beats) { gaps.push((b - prev) / FPS); prev = b; } gaps.push((n - prev) / FPS);
  // «та же картинка»: по сравнению с кадром секундой раньше изменилось меньше 10 % площади. Печатающийся текст и мелкие движения внутри одной карточки сюда попадают.
  const act = []; for (let i = FPS; i < n; i++) act.push(changed(frames[i - FPS], frames[i], 45));
  const sameShare = act.filter((a) => a < 0.10).length / act.length;
  const rng = []; for (let i = 0; i + 20 <= n; i += 10) rng.push(Math.max(...L.slice(i, i + 20)) - Math.min(...L.slice(i, i + 20)));
  const brightRange = [...rng].sort((a, b) => a - b)[rng.length >> 1];
  return { seconds: sec, nonBaseBg, hues: hues.length, hueList: hues, beats: beats.length, beatsPer10s: beats.length / sec * 10, maxBeatGap: Math.max(...gaps), sameShare, brightRange, beatTimes: beats.map((b) => b / FPS) };
}
export function judge(m, t = THRESHOLDS) {
  const bad = [];
  if (m.nonBaseBg < t.nonBaseBg) bad.push(`цветной фон на весь экран занимает ${(m.nonBaseBg * 100).toFixed(0)} % времени, нужно не меньше ${t.nonBaseBg * 100} %`);
  if (m.hues < t.hues) bad.push(`оттенков фона ${m.hues}, нужно не меньше ${t.hues}`);
  if (m.beatsPer10s < t.beatsPer10s) bad.push(`резких смен кадра ${m.beats} (${m.beatsPer10s.toFixed(1)} на 10 с), нужно не меньше ${t.beatsPer10s} на 10 с`);
  if (m.maxBeatGap > t.maxBeatGap) bad.push(`самая длинная пауза без резкой смены ${m.maxBeatGap.toFixed(1)} с, не больше ${t.maxBeatGap} с`);
  if (m.sameShare > t.sameShare) bad.push(`${(m.sameShare * 100).toFixed(0)} % времени картинка почти та же, что секунду назад (мелкие движения внутри карточки не в счёт), не больше ${t.sameShare * 100} %`);
  if (m.brightRange < t.brightRange) bad.push(`размах яркости ${m.brightRange.toFixed(1)}, нужно не меньше ${t.brightRange}`);
  return { ok: bad.length === 0, problems: bad };
}
export const summaryLine = (m) => `Динамика: резких смен ${m.beats} (пауза до ${m.maxBeatGap.toFixed(1)} с), цветной фон ${(m.nonBaseBg * 100).toFixed(0)} % времени, «той же картинки» ${(m.sameShare * 100).toFixed(0)} %`;

if (process.argv[1] && /video_dynamics\.mjs$/.test(process.argv[1].replace(/\\/g, '/'))) {
  const f = process.argv[2]; if (!f) { console.error('Использование: node scripts/video_dynamics.mjs <ролик.mp4> [--json]'); process.exit(2); }
  const m = measure(decodeFrames(f)), j = judge(m);
  if (process.argv.includes('--json')) console.log(JSON.stringify({ ...m, ...j }));
  else { console.log(summaryLine(m)); console.log(`оттенков фона: ${m.hues} (${m.hueList.join(', ')}); яркость: размах ${m.brightRange.toFixed(1)}; смены на: ${m.beatTimes.map((x) => x.toFixed(1)).join(' ')}`); }
  if (!j.ok) { console.error('ДИНАМИКА НИЖЕ ПОРОГА:\n- ' + j.problems.join('\n- ')); process.exit(1); }
  console.log('динамика: ок');
}

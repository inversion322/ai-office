// Единый стандарт ролика для YouTube Shorts и Instagram Reels: 1080x1920, 9:16, квадратные пиксели, H.264 High yuv420p, 30 к/с постоянные,
// AAC 48 кГц стерео, не длиннее 59 с, не больше 40 МБ. Решение Ника (ролик №1 v3 принят в таком формате; 2026-10-20 повторено).
// probeVideo() читает реальные параметры файла, checkFormat() сравнивает со стандартом, sendFields() даёт Telegram точные width/height/duration,
// иначе плеер Telegram не знает размеров и показывает вертикальное видео «сжатым» в окне по умолчанию.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export const STANDARD = { width: 1080, height: 1920, sar: '1:1', fps: 30, vcodec: 'h264', pix_fmt: 'yuv420p', acodec: 'aac', sample_rate: 48000, maxSeconds: 59.0, maxMB: 40 };

export function ffprobePath() {
  const base = path.join(process.env.LOCALAPPDATA || '', 'hermes', 'tools');
  try { const d = fs.readdirSync(base).filter((x) => /^ffmpeg-/.test(x)).sort().pop(); if (d) return path.join(base, d, 'bin', 'ffprobe.exe'); } catch {}
  return 'ffprobe';
}
export function probeVideo(file, probeBin = ffprobePath()) {
  const r = spawnSync(probeBin, ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name,pix_fmt,width,height,sample_aspect_ratio,r_frame_rate,avg_frame_rate,sample_rate,channels:stream_side_data=rotation:format=duration,size', '-of', 'json', file], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error('ffprobe не смог прочитать файл: ' + (r.stderr || '').slice(0, 200));
  const j = JSON.parse(r.stdout); const v = (j.streams || []).find((s) => s.codec_type === 'video'); const a = (j.streams || []).find((s) => s.codec_type === 'audio');
  if (!v) throw new Error('в файле нет видеодорожки');
  const fr = (x) => { const [n, d] = String(x || '0/1').split('/').map(Number); return d ? n / d : 0; };
  const rot = Number(((v.side_data_list || []).find((x) => x.rotation !== undefined) || {}).rotation || 0);
  return { width: v.width, height: v.height, sar: v.sample_aspect_ratio || '1:1', fps: fr(v.r_frame_rate), avgFps: fr(v.avg_frame_rate), vcodec: v.codec_name, pix_fmt: v.pix_fmt, rotation: rot,
    acodec: a && a.codec_name, sample_rate: a && Number(a.sample_rate), channels: a && a.channels, seconds: Number((j.format || {}).duration), sizeMB: Number((j.format || {}).size) / 1048576 };
}
export function checkFormat(p, std = STANDARD) {
  const bad = [];
  if (p.rotation) bad.push(`в файле стоит поворот ${p.rotation}°: плеер покажет его иначе`);
  if (p.width !== std.width || p.height !== std.height) bad.push(`размер ${p.width}x${p.height}, нужен ${std.width}x${std.height} (9:16)`);
  if (p.sar && p.sar !== '1:1' && p.sar !== '0:1') bad.push(`пиксели не квадратные (${p.sar}): картинка будет растянута или сжата`);
  if (Math.abs(p.fps - std.fps) > 0.01 || Math.abs(p.avgFps - std.fps) > 0.05) bad.push(`частота ${p.fps.toFixed(2)} (средняя ${p.avgFps.toFixed(2)}), нужна постоянная ${std.fps}`);
  if (p.vcodec !== std.vcodec || p.pix_fmt !== std.pix_fmt) bad.push(`кодек ${p.vcodec}/${p.pix_fmt}, нужен ${std.vcodec}/${std.pix_fmt}`);
  if (!p.acodec) bad.push('нет звука'); else if (p.acodec !== std.acodec || p.sample_rate !== std.sample_rate || p.channels !== 2) bad.push(`звук ${p.acodec} ${p.sample_rate} Гц ${p.channels} кан., нужен ${std.acodec} ${std.sample_rate} Гц стерео`);
  if (p.seconds > std.maxSeconds) bad.push(`длина ${p.seconds.toFixed(2)} с, максимум ${std.maxSeconds} с`);
  if (p.sizeMB > std.maxMB) bad.push(`размер файла ${p.sizeMB.toFixed(1)} МБ, максимум ${std.maxMB} МБ`);
  return { ok: bad.length === 0, problems: bad };
}
// Поля sendVideo: без width/height/duration Telegram показывает вертикальный ролик в окне по умолчанию (выглядит сжатым).
export function sendFields(p) { return { width: String(p.width), height: String(p.height), duration: String(Math.round(p.seconds)), supports_streaming: 'true' }; }

if (process.argv[1] && /video_format\.mjs$/.test(process.argv[1].replace(/\\/g, '/'))) {
  const f = process.argv[2]; if (!f) { console.error('Использование: node scripts/video_format.mjs <ролик.mp4>'); process.exit(2); }
  const p = probeVideo(f), c = checkFormat(p);
  console.log(JSON.stringify(p)); if (!c.ok) { console.error('ФОРМАТ НЕ ПО СТАНДАРТУ:\n- ' + c.problems.join('\n- ')); process.exit(1); } console.log('формат: ок (1080x1920, 9:16, 30 к/с, ≤59 с)');
}

// Настоящий прогресс монтажа ролика по файлам проекта (решение Ника 2026-10-21: видеть процент и оставшееся время монтажа).
// Кирилл оставляет в папке video/dosieNN следы каждого шага; по ним считаем процент, не спрашивая модель.
// Вехи (в процентах): озвучка 10, раскадровка 22, сборка 30, каждый рендер до 4 включительно +10 (в самом рендере по ходу его прогресса),
// музыка и звук 82, автопроверки 90, файл ролика 95, отчёт 97. Больше 97 не бывает, 100 ставит конвейер, когда ролик принят воротами.
import fs from 'node:fs';
import path from 'node:path';

const exists = (p, since) => { try { return fs.statSync(p).mtimeMs >= since - 2000; } catch { return false; } };

/** Процент и название шага по файлам. since: время старта монтажа (мс), старые файлы проекта (шаблоны, прошлые версии) не считаются. */
export function videoMilestone(proj, n, since = 0) {
  const nn = String(n).padStart(2, '0');
  let list = [];
  try { list = fs.readdirSync(proj); } catch { return { pct: 0, step: 'подготовка' }; }
  const has = (name) => exists(path.join(proj, name), since);
  let pct = 3, step = 'подготовка';
  const up = (p, s) => { if (p > pct) { pct = p; step = s; } };
  if (has('_narrate_log.txt') || has('captions.srt')) up(10, 'озвучка и субтитры');
  if (has('STORYBOARD.json')) up(22, 'раскадровка');
  if (has(`build_dosie${nn}.py`) || has('build_meta.json')) up(30, 'сборка сцен');
  const renders = list.filter((f) => /^_render_log_b\d+\.txt$/.test(f) && has(f)).sort((a, b) => parseInt(a.replace(/\D/g, '')) - parseInt(b.replace(/\D/g, '')));
  if (renders.length) {
    const r = renders.length, last = renders[r - 1], k = Math.min(r, 4);
    const reviewed = list.some((f) => f === `_frames_log_b${parseInt(last.replace(/\D/g, ''))}.txt` && has(f));
    let inner = 0;
    try { const t = fs.readFileSync(path.join(proj, last), 'utf8'), all = [...t.matchAll(/@hf-progress \{[^}]*"pct":(\d+)/g)]; if (all.length) inner = Number(all[all.length - 1][1]); } catch {}
    if (reviewed || inner >= 100) up(30 + k * 10, `рендер ${r} и просмотр кадров`);
    else up(30 + (k - 1) * 10 + Math.round(inner / 10), `рендер ${r}`);
  }
  if (has('_finalize.json')) up(82, 'музыка и звук');
  if (has('_dynamics_log.txt') || has('_format_log.txt') || has('_zone_pixel.json')) up(90, 'автопроверки');
  if (has(path.join('final', `dosie${nn}_v1.mp4`)) && pct >= 82) up(Math.max(pct, 95), 'файл ролика собран');
  if (has('RESULT.md') && pct >= 90) up(97, 'отчёт');
  return { pct: Math.min(97, pct), step };
}

/** Следит за проектом и сообщает прогресс, когда он вырос. Возвращает stop(). report(pct, step) вызывается не чаще раза в интервал. */
export function watchVideoProgress(proj, n, since, report, { intervalMs = 20000 } = {}) {
  let sent = 0, lastStep = '';
  const tick = () => {
    try {
      const m = videoMilestone(proj, n, since);
      if (m.pct > sent || m.step !== lastStep) { if (m.pct >= sent) { sent = m.pct; lastStep = m.step; Promise.resolve(report(m.pct, m.step)).catch(() => {}); } }
    } catch { /* следим дальше */ }
  };
  const t = setInterval(tick, intervalMs); t.unref?.();
  tick();
  return () => clearInterval(t);
}

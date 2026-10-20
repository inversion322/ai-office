// Проверка: вердикт «МИФ / ПРАВДА» не показывается в начале ролика (решение Ника 2026-10-20: заранее отмеченный вердикт теряет вовлечённость,
// зритель может не досмотреть). Метка, штамп «МИФ?» и слова-ярлыки допустимы только в сценах вердикта, то есть после AFTER доли длительности ролика.
// Проверяется исходник монтажа (index.html + compositions/*.html): видно сцену и время, а не картинку. Обход: VERDICT_GATE=off.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VERDICT_RE } from './script_style.mjs';

export const VERDICT_LABEL = { after: 0.6 };
const strip = (html) => html.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<head[\s\S]*?<\/head>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
// Текст, который сцена собирает скриптом: строки в кавычках с ярлыком ЗАГЛАВНЫМИ (так набираются штампы), код вокруг не читаем: он даст ложные срабатывания.
const scriptLabels = (html) => [...html.matchAll(/<script[\s\S]*?<\/script>/gi)].flatMap((m) => [...m[0].matchAll(/(["'`])((?:(?!\1)[^\n\\])*?(?:МИФ|ПРАВДА|ЛОЖЬ|ФЕЙК)(?:(?!\1)[^\n\\])*)\1/g)].map((x) => x[2])).join(' ');
const attr = (tag, name) => { const m = new RegExp(`${name}\\s*=\\s*"([^"]*)"`, 'i').exec(tag); return m ? m[1] : null; };

/** Сцены монтажа: [{ src, start, dur }] из index.html */
export function sceneList(html) {
  const out = [];
  for (const m of html.matchAll(/<div\b[^>]*data-composition-src\s*=\s*"[^"]+"[^>]*>/gi)) {
    const start = Number(attr(m[0], 'data-start')), dur = Number(attr(m[0], 'data-duration'));
    if (Number.isFinite(start) && Number.isFinite(dur)) out.push({ src: attr(m[0], 'data-composition-src'), start, dur });
  }
  return out;
}
const word = (text) => { const m = VERDICT_RE.exec(text); return m ? text.slice(Math.max(0, m.index - 12), m.index + 28).trim() : null; };

/** Возвращает { ok, problems[], checked }. Проект без index.html или без сцен не проверяется (старые ролики, тесты). */
export function checkVerdictLabels(proj, { after = VERDICT_LABEL.after } = {}) {
  if (process.env.VERDICT_GATE === 'off') return { ok: true, problems: [], checked: false };
  const idx = path.join(proj, 'index.html'); if (!fs.existsSync(idx)) return { ok: true, problems: [], checked: false };
  const html = fs.readFileSync(idx, 'utf8'), scenes = sceneList(html); if (!scenes.length) return { ok: true, problems: [], checked: false };
  const total = Math.max(...scenes.map((s) => s.start + s.dur)), limit = after * total, problems = [];
  const hit = (where, start, text) => { const w = word(text); if (w) problems.push(`${where} (с ${start.toFixed(1)} с из ${total.toFixed(0)}): «${w}» вердикт назван до сцены вердикта, метку «МИФ/ПРАВДА» и штамп можно показывать только после ${limit.toFixed(0)} с (${Math.round(after * 100)}% ролика)`); };
  hit('index.html', 0, strip(html) + ' ' + scriptLabels(html));
  for (const s of scenes) {
    if (s.start >= limit) continue;
    const f = path.join(proj, s.src); if (!fs.existsSync(f)) continue;
    const h = fs.readFileSync(f, 'utf8'); hit(s.src, s.start, strip(h) + ' ' + scriptLabels(h));
  }
  return { ok: problems.length === 0, problems, checked: true };
}
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const r = checkVerdictLabels(path.resolve(process.argv[2] || '.')); console.log(r.ok ? `вердикт: ${r.checked ? 'в начале не назван' : 'не проверялось'}` : 'вердикт назван рано:\n  - ' + r.problems.join('\n  - ')); process.exit(r.ok ? 0 : 1);
}

// Шляпа утки обязана стоять ровно по центру головы: #dk-hatwrap двигается только по y.
// Использование: node scripts/check_duck_hat.mjs <папка_проекта_ролика>   (код выхода 1, если найден наклон или сдвиг вбок)
// Проверяет и build_*.py, и собранные compositions/*.html. Решение Ника (2026-10-19, повторено 2026-10-20).
import fs from 'node:fs';
import path from 'node:path';

export function badHatLines(text) {
  const bad = [];
  text.split(/\r?\n/).forEach((line, i) => {
    if (!/dk-hatwrap|dk-hat\b/.test(line) || /HAT_LOCK\s*=/.test(line)) return;
    // rotation / rotate / x / skew в словаре или в вызове GSAP, относящемся к шляпе, с ненулевым значением
    const m = [...line.matchAll(/["']?\b(rotation|rotate|rotationZ|skewX|skewY|x)\b["']?\s*:\s*(-?\d+(?:\.\d+)?)/g)].filter((k) => Number(k[2]) !== 0);
    if (m.length) bad.push({ line: i + 1, text: line.trim().slice(0, 200), found: m.map((k) => `${k[1]}: ${k[2]}`).join(', ') });
  });
  return bad;
}
export function checkProject(dir) {
  const files = [];
  const walk = (d, depth) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) { if (depth < 2 && !/^(node_modules|_frames|\.hyperframes|.*_archive|_aborted.*)$/.test(e.name)) walk(f, depth + 1); } else if (/^build_.*\.py$|\.html$/.test(e.name)) files.push(f); } };
  walk(dir, 0);
  const out = [];
  for (const f of files) { const b = badHatLines(fs.readFileSync(f, 'utf8')); if (b.length) out.push({ file: path.relative(dir, f), bad: b }); }
  return { files: files.length, problems: out };
}
if (process.argv[1] && /check_duck_hat\.mjs$/.test(process.argv[1].replace(/\\/g, '/'))) {      // запуск из командной строки (сравнение путей ломается на кириллице и дисках Windows)
  const dir = process.argv[2];
  if (!dir) { console.error('Использование: node scripts/check_duck_hat.mjs <папка_проекта>'); process.exit(2); }
  const r = checkProject(dir);
  if (r.problems.length) { for (const p of r.problems) for (const b of p.bad) console.error(`ШЛЯПА НЕ ПО ЦЕНТРУ: ${p.file}:${b.line}: ${b.found}\n   ${b.text}`); console.error('Шляпа двигается только по y. Уберите rotation и x у #dk-hatwrap.'); process.exit(1); }
  console.log(`шляпа: ок (проверено файлов: ${r.files})`);
}

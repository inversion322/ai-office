// Проверка сцены призыва подписаться (решение Ника 2026-10-20): шрифт как у заголовков (Manrope 800, ЗАГЛАВНЫЕ), текст набирается по буквам быстро,
// потом ссылка на канал и источники. Проверяется исходник композиции, а не картинка: так видно причину, а не симптом.
// Контракт для Кирилла: video/med_detective/DESIGN.md, раздел «Призыв подписаться». Обход: CTA_GATE=off.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { projectLang } from './project_lang.mjs';

export const CTA_RULES = { minLetters: 14, maxStep: 0.06, headline: 'ПОДПИСЫВАЙТЕСЬ' };
export const CTA_RULES_EN = { ...CTA_RULES, headline: 'SUBSCRIBE' };                // английская версия ролика (lang.json): тот же набор по буквам, заголовок SUBSCRIBE
const CTA_WORD = { ru: /подписывайтесь/i, en: /subscribe/i };
const stripFontFace = (s) => s.replace(/@font-face\s*{[^}]*}/gi, '');
const plainText = (s) => s.replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, '');

/** html: текст одной композиции со сценой призыва. Возвращает { problems[] } */
export function checkCtaHtml(html, R = CTA_RULES) {
  const problems = [];
  const css = stripFontFace(html);
  const fams = [...css.matchAll(/font-family\s*:\s*([^;}]+)/gi)].map((m) => m[1].split(/"\s*>/)[0].replace(/["']/g, '').trim()).filter(Boolean);
  const mono = fams.filter((f) => /mono|courier|consolas/i.test(f));
  if (mono.length) problems.push(`в сцене призыва моноширинный шрифт (${[...new Set(mono)].join(' | ').slice(0, 60)}): призыв и ссылка набираются тем же шрифтом, что заголовки, Manrope 800`);
  const other = fams.filter((f) => !/manrope|system-ui|sans-serif|inherit/i.test(f) && !/mono|courier|consolas/i.test(f));
  if (other.length) problems.push(`в сцене призыва чужой шрифт (${[...new Set(other)].join(' | ').slice(0, 60)}), нужен Manrope 800 как у заголовков`);
  if (/\.(?:[\w-]*mono[\w-]*)\s*{/i.test(css) && !mono.length) problems.push('в сцене призыва остался класс «mono»: ссылка на канал не должна выделяться шрифтом');
  const text = plainText(html);
  if (!text.includes(R.headline)) problems.push(`призыв набран не как заголовки: ожидается «${R.headline}» заглавными, не строчными`);
  const letters = (html.match(/class\s*=\s*["'][^"']*\bcta-ch\b/gi) || []).length;
  if (letters < R.minLetters) problems.push(`призыв не набирается по буквам: найдено ${letters} элементов .cta-ch, нужно не меньше ${R.minLetters} (по одному на букву, быстро)`);
  const steps = [...html.matchAll(/stagger\s*:\s*([0-9]*\.?[0-9]+)/g)].map((m) => +m[1]).concat([...html.matchAll(/data-cta-step\s*=\s*["']([0-9]*\.?[0-9]+)["']/g)].map((m) => +m[1]));
  if (!steps.length) problems.push('не задан шаг между буквами (stagger или data-cta-step), нужно не больше ' + R.maxStep + ' с на букву');
  else if (steps.some((x) => x > R.maxStep)) problems.push(`шаг между буквами ${Math.max(...steps)} с, нужно не больше ${R.maxStep} с: «по буквам, но быстро»`);
  return { problems };
}

/** proj: каталог проекта ролика. Находит композицию со сценой призыва и проверяет её. */
export function checkCta(proj) {
  if (process.env.CTA_GATE === 'off') return { ok: true, problems: [], file: null };
  const files = [];
  const comp = path.join(proj, 'compositions');
  try { for (const f of fs.readdirSync(comp)) if (/\.html$/i.test(f)) files.push(path.join(comp, f)); } catch {}
  for (const f of ['index.html']) if (fs.existsSync(path.join(proj, f))) files.push(path.join(proj, f));
  if (!files.length) return { ok: true, problems: [], file: null, skipped: 'нет композиций (проект без исходников: проверять нечего)' };
  const lang = projectLang(proj), R = lang === 'en' ? CTA_RULES_EN : CTA_RULES;
  const hit = files.filter((f) => { try { return CTA_WORD[lang].test(plainText(fs.readFileSync(f, 'utf8'))); } catch { return false; } });
  if (!hit.length) return { ok: false, problems: [`не найдена сцена призыва подписаться (в композициях нет слова «${R.headline}»)`], file: null };
  const sceneFile = hit.find((f) => /compositions/.test(f.replace(/\\/g, '/'))) || hit[0];
  const r = checkCtaHtml(fs.readFileSync(sceneFile, 'utf8'), R);
  return { ok: r.problems.length === 0, problems: r.problems, file: path.basename(sceneFile) };
}
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const r = checkCta(path.resolve(process.argv[2] || '.'));
  console.log(r.ok ? `призыв: ок (${r.file})` : 'призыв: ' + r.problems.join('; ')); process.exit(r.ok ? 0 : 1);
}

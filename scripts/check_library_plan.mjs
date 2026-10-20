// Проверка плана использования библиотеки (решение Ника 2026-10-20: «не выдумывать то, что уже лежит в готовых скиллах и фреймворках HyperFrames»).
// Кирилл ДО раскадровки пишет <проект>/LIBRARY_PLAN.json и запускает: node scripts/check_library_plan.mjs <проект>  (код 0 обязателен).
// Чтобы заполнить план настоящими id, ему приходится открыть правила, блюпринты, каталог и палитру звуков: выдуманный id не проходит.
// Те же проверки запускают ворота конвейера перед отправкой ролика Нику. Обход: LIBRARY_GATE=off.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LIB = path.join(ROOT, 'video', 'library');
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
export const PLAN_LIMITS = { minRules: 2, minRegistry: 2, transitionFamilies: ['A', 'B', 'C'], captionStyles: ['1', '2'], maxSfx: 20 };

export function loadIndexes(lib = LIB) {
  const hf = readJson(path.join(lib, 'hf_catalog.json')) || [], anim = readJson(path.join(lib, 'animation_index.json')) || {}, sounds = (readJson(path.join(lib, 'cc0', 'catalog.json')) || {}).sounds || [], gr = (readJson(path.join(lib, 'cc0', 'graphics', 'catalog.json')) || {}).assets || [];
  return { registry: new Set(hf.map((x) => x.name)), rules: new Set(anim.rules || []), blueprints: new Set(anim.blueprints || []), sfx: new Set(sounds.filter((s) => s.category !== 'music').map((s) => s.id)), music: new Set(sounds.filter((s) => s.category === 'music').map((s) => s.id)), graphics: new Set(gr.map((a) => a.id)), palette: readJson(path.join(lib, 'sound_palette.json')) || {} };
}
const arr = (v) => (Array.isArray(v) ? v : []);
const unknown = (list, set) => arr(list).filter((x) => !set.has(String(x && x.id ? x.id : x)));
const idsOf = (list) => arr(list).map((x) => String(x && x.id ? x.id : x));

/** plan: объект LIBRARY_PLAN.json. Возвращает { problems[] } */
export function checkPlan(plan, idx = loadIndexes(), L = PLAN_LIMITS) {
  const p = [];
  if (!plan || typeof plan !== 'object') return { problems: ['нет LIBRARY_PLAN.json или он не читается'] };
  if (!idx.registry.size || !idx.rules.size || !idx.sfx.size) return { problems: ['каталоги библиотеки не найдены (video/library/hf_catalog.json, animation_index.json, cc0/catalog.json): план проверить нельзя'] };
  const rules = idsOf(plan.animation_rules); if (rules.length < L.minRules) p.push(`animation_rules: нужно не меньше ${L.minRules} правил из скилла hyperframes-animation (rules/*.md), указано ${rules.length}`);
  const badR = rules.filter((x) => !idx.rules.has(x)); if (badR.length) p.push(`animation_rules: такого правила нет в скилле hyperframes-animation: ${badR.join(', ')}`);
  const bp = idsOf(plan.blueprints); const badB = bp.filter((x) => !idx.blueprints.has(x)); if (badB.length) p.push(`blueprints: нет в скилле: ${badB.join(', ')}`);
  const reg = idsOf(plan.registry_blocks); if (reg.length < L.minRegistry) p.push(`registry_blocks: нужно не меньше ${L.minRegistry} готовых блоков или компонентов из «npx hyperframes catalog», указано ${reg.length}`);
  const badG = reg.filter((x) => !idx.registry.has(x)); if (badG.length) p.push(`registry_blocks: нет в каталоге HyperFrames (выдуманное название?): ${badG.join(', ')}`);
  const tf = plan.transitions || {}; const fams = Object.keys(tf).map((k) => k.toUpperCase());
  for (const f of L.transitionFamilies) if (!fams.includes(f)) p.push(`transitions: не указано семейство ${f} из BRAND_MOTION.md (A линза, B пуш-плита, C скриб/бумага)`);
  for (const [k, v] of Object.entries(tf)) { const src = String(v && v.source || ''); if (!src) p.push(`transitions.${k}: нужно поле source (имя компонента каталога или файл правил, откуда взято)`); const n = Number(v && v.count); if (!(n >= 0)) p.push(`transitions.${k}: нужно число использований count`); }
  const total = Object.values(tf).reduce((a, v) => a + (Number(v && v.count) || 0), 0), main = Number((tf.A || tf.a || {}).count) || 0;
  if (total > 0 && main / total < 0.5) p.push(`transitions: основной переход A должен быть 60-70% смен (сейчас ${Math.round((main / total) * 100)}%): «один основной + 1-2 акцента, не разный на каждую сцену»`);
  const cs = String((plan.captions && plan.captions.main) || ''); if (!L.captionStyles.includes(cs)) p.push('captions.main: основной стиль субтитров 1 (МАРКЕР), см. BRAND_MOTION.md');
  const sfx = idsOf(plan.sfx), badS = sfx.filter((x) => !idx.sfx.has(x)); if (badS.length) p.push(`sfx: нет в каталоге CC0: ${badS.join(', ')}`);
  const pal = new Set(Object.values(idx.palette.groups || {}).flat()); const off = sfx.filter((x) => idx.sfx.has(x) && pal.size && !pal.has(x)); if (off.length) p.push(`sfx: не из палитры канала (SOUND_PALETTE.md): ${off.join(', ')}`);
  const banned = sfx.filter((x) => /whoosh|swish|slide|sweep|riser|swoosh/i.test(x)); if (banned.length) p.push(`sfx: звуки переходов запрещены (решение Ника): ${banned.join(', ')}`);
  if (sfx.length > L.maxSfx) p.push(`sfx: больше ${L.maxSfx} событий`);
  const gr = idsOf(plan.graphics), badGr = gr.filter((x) => !idx.graphics.has(x)); if (badGr.length) p.push(`graphics: нет в наборе CC0 (graphics/catalog.json): ${badGr.join(', ')}`);
  const mu = plan.music; if (!mu || typeof mu !== 'object') p.push('music: укажи {"id": "...", "reason": "..."} или {"id": "none", "reason": "..."}');
  else if (mu.id !== 'none' && !idx.music.has(String(mu.id))) p.push(`music: такого трека нет в наборе CC0: ${mu.id}`);
  else if (mu.id !== 'none' && idx.palette.music && !(idx.palette.music.allowed || []).includes(String(mu.id))) p.push(`music: трек не из разрешённых (${(idx.palette.music.allowed || []).join(', ')})`);
  const fs_ = arr(plan.from_scratch); fs_.forEach((x, i) => { if (!x || !x.what || !x.why_not_library || !arr(x.searched).length) p.push(`from_scratch[${i}]: нужны what, why_not_library и searched (что искал в каталоге/скиллах)`); });
  if (fs_.length > 6) p.push(`from_scratch: ${fs_.length} элементов с нуля: слишком много, ищи в библиотеке (допустимо не больше 6, утка, лупа и CTA не считаются)`);
  return { problems: p };
}
export function checkProjectPlan(proj, idx) {
  if (process.env.LIBRARY_GATE === 'off') return { ok: true, problems: [], file: null };
  const file = path.join(proj, 'LIBRARY_PLAN.json'); const r = checkPlan(readJson(file), idx);
  return { ok: r.problems.length === 0, problems: r.problems, file: fs.existsSync(file) ? 'LIBRARY_PLAN.json' : null };
}
/** RESULT.md должен содержать раздел «Использовано из библиотеки». */
export function checkReportSection(proj, name = 'RESULT.md') {
  let t = ''; try { t = fs.readFileSync(path.join(proj, name), 'utf8'); } catch {}
  return /использовано из библиотеки/i.test(t) ? [] : [`в ${name} нет раздела «Использовано из библиотеки»`];
}
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const proj = path.resolve(process.argv[2] || '.'); const r = checkProjectPlan(proj);
  console.log(r.ok ? `план библиотеки: ок (${r.file})` : 'план библиотеки: ' + r.problems.join('\n  - ')); process.exit(r.ok ? 0 : 1);
}

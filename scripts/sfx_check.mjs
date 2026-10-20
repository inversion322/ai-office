// Проверка звуковых эффектов ролика (решение Ника 2026-10-20: звуки на смене кадра раздражают).
// Кирилл пишет отчёт сведения звука в _sfx*.json: { by_kind: {имя: сколько}, events: N }. Допустимы мягкие звуки появления текста и один удар на штампе.
import fs from 'node:fs';
import path from 'node:path';
export const SFX_LIMITS = { maxEvents: 20, forbidden: ['whoosh', 'swish'], thumpMax: 1 };
export function judgeSfx(rep, L = SFX_LIMITS) {
  const problems = [];
  const bk = (rep && rep.by_kind) || {};
  const total = typeof rep?.events === 'number' ? rep.events : Object.values(bk).reduce((a, b) => a + (+b || 0), 0);
  if (total > L.maxEvents) problems.push(`звуковых событий ${total}, допустимо не больше ${L.maxEvents}`);
  for (const k of L.forbidden) if (bk[k]) problems.push(`звук «${k}» на переходах запрещён (${bk[k]} шт.)`);
  if ((bk.thump || 0) > L.thumpMax) problems.push(`глухих ударов ${bk.thump}, допустим один на штампе МИФ`);
  return { ok: problems.length === 0, problems, total };
}
// Берём самый свежий отчёт проекта. Нет отчёта: звук не проверить, и это не повод блокировать (Кирилл мог выпустить без эффектов).
export function checkSfx(proj) {
  let files = [];
  try { files = fs.readdirSync(proj).filter((f) => /^_sfx.*\.json$/.test(f)).map((f) => ({ f, t: fs.statSync(path.join(proj, f)).mtimeMs })).sort((a, b) => b.t - a.t); } catch {}
  if (!files.length) return { ok: true, problems: [], total: 0, file: null };
  let rep; try { rep = JSON.parse(fs.readFileSync(path.join(proj, files[0].f), 'utf8')); } catch { return { ok: true, problems: [], total: 0, file: files[0].f }; }
  return { ...judgeSfx(rep), file: files[0].f };
}

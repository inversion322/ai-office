// Призыв подписаться в конце ролика: один текст для всех роликов (video/cta.json), добавляется последним абзацем сценария.
// Старые тексты призыва (previous_voice_ru) заменяются, а не дублируются: у готовых сценариев в script_ru.txt может стоять прежний призыв.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const loadCta = (file = path.join(ROOT, 'video', 'cta.json')) => JSON.parse(fs.readFileSync(file, 'utf8'));
export const loadCtaEn = (file = path.join(ROOT, 'video', 'cta_en.json')) => JSON.parse(fs.readFileSync(file, 'utf8'));
const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();

/** Абзацы без призыва (нового или любого прежнего) в конце. */
export function stripCta(parts, cta = loadCta()) {
  const all = new Set([cta.voice_ru, ...(cta.previous_voice_ru || [])].map(norm));
  const out = [...parts];
  while (out.length && all.has(norm(out[out.length - 1]))) out.pop();
  return out;
}
/** Сценарий с текущим призывом последним абзацем (идемпотентно, прежний призыв заменяется). */
export const withCta = (segments, cta = loadCta()) => [...stripCta(segments, cta), cta.voice_ru];

/** Приводит файл script_ru.txt к текущему призыву. Возвращает true, если файл изменён. */
export function ensureCtaFile(file, cta = loadCta()) {
  const text = fs.readFileSync(file, 'utf8'), parts = text.trim().split(/\n\s*\n/);
  const next = withCta(parts, cta).join('\n\n') + '\n';
  if (next === text) return false;
  fs.writeFileSync(file, next, 'utf8'); return true;
}

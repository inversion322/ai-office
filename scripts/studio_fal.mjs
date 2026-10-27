// Обложки через fal.ai (ключ id:secret в server/data/studio_keys.json, поле falApiKey; ключ нигде не печатается и не попадает в ошибки).
// Модель по умолчанию Nano Banana Pro (читаемая кириллица), как в WorkFlow AI. Сеть подменяется параметром fetch (тесты).
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './smm_lib.mjs';

export const KEYS_FILE = () => process.env.OFFICE_STUDIO_KEYS_FILE || path.join(ROOT, 'server', 'data', 'studio_keys.json');
export const FAL_MODEL = 'fal-ai/nano-banana-pro';
export const IMAGE_COST_USD = { 'fal-ai/nano-banana-pro': 0.15, 'fal-ai/flux/schnell': 0.003, 'fal-ai/flux/dev': 0.025 };      // оценка для отчёта, не для расчётов с fal
export const falKey = () => { try { const k = JSON.parse(fs.readFileSync(KEYS_FILE(), 'utf8')).falApiKey; return typeof k === 'string' ? k.trim() : ''; } catch { return ''; } };

const clean = (s, key) => (key ? String(s).split(key).join('<ключ>') : String(s));

/**
 * Одна картинка. Возвращает { ok, file, url, model, cost } или { ok:false, error } (ошибка без ключа и без адресов с подписью).
 * outFile: куда сохранить (jpg). Таймаут на запрос и на скачивание.
 */
export async function generateCover({ prompt, outFile, model = FAL_MODEL, aspect = '1:1', fetch: f = globalThis.fetch, timeoutMs = 120000 } = {}) {
  const key = falKey(); if (!key) return { ok: false, error: 'нет ключа fal.ai (server/data/studio_keys.json, falApiKey)' };
  if (!prompt) return { ok: false, error: 'пустой запрос обложки' };
  const body = model.includes('nano-banana') ? { prompt, num_images: 1, aspect_ratio: aspect, output_format: 'jpeg' } : { prompt, num_images: 1, image_size: aspect === '1:1' ? 'square_hd' : 'landscape_4_3' };
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await f(`https://fal.run/${model}`, { method: 'POST', headers: { Authorization: 'Key ' + key, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ac.signal });
    const text = await r.text();
    if (!r.ok) return { ok: false, error: `fal.ai ответил ${r.status}${r.status === 401 || r.status === 403 ? ' (ключ не принят)' : r.status === 402 ? ' (на счёте нет средств)' : ''}` };
    let j; try { j = JSON.parse(text); } catch { return { ok: false, error: 'fal.ai вернул не JSON' }; }
    const url = j && j.images && j.images[0] && j.images[0].url; if (!url) return { ok: false, error: 'fal.ai не вернул картинку' + (j && j.detail ? ': ' + String(j.detail).slice(0, 120) : '') };
    const img = await f(url, { signal: ac.signal }); if (!img.ok) return { ok: false, error: `не скачалась картинка (${img.status})` };
    const buf = Buffer.from(await img.arrayBuffer()); if (buf.length < 2000) return { ok: false, error: 'картинка пустая' };
    fs.mkdirSync(path.dirname(outFile), { recursive: true }); fs.writeFileSync(outFile, buf);
    return { ok: true, file: outFile, bytes: buf.length, model, cost: IMAGE_COST_USD[model] ?? null };
  } catch (e) { return { ok: false, error: e && e.name === 'AbortError' ? 'fal.ai не ответил вовремя' : clean('нет связи с fal.ai: ' + ((e && e.message) || e), key) }; }
  finally { clearTimeout(t); }
}

/** Суточный лимит картинок (страховка от зацикливания: каждая обложка стоит денег). Счётчик в smm/studio/image_count.json. */
export function imageBudget({ file, day, max = Number(process.env.STUDIO_MAX_IMAGES_PER_DAY || 8) } = {}) {
  let j = {}; try { j = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
  const used = j.day === day ? Number(j.count) || 0 : 0;
  return { used, max, left: Math.max(0, max - used), take() { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify({ day, count: used + 1 })); } };
}

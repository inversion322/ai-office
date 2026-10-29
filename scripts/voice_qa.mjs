// Отчёт сверки озвучки с текстом (voice_qa.json рядом с narration.mp3) и карточка Нику, если искажение не удалось починить.
// Решение Ника 2026-10-29: озвучка остаётся там, где была (в сессии монтажёра, до раскадровки); искажённое слово чинится автоматически
// (иная пунктуация, затем склейка половин; слова не меняются), а если не вышло, карточка с фразой и аудио приходит сразу, не после двух часов монтажа.
import fs from 'node:fs';
import path from 'node:path';

const plain = (s) => String(s == null ? '' : s).replace(/\+/g, '').replace(/\u0301/g, '');      // знаки ударения («В+осемь») нужны голосу, а Нику в карточке они только мешают
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
export const qaFile = (proj) => path.join(proj, 'voice_qa.json');
export const readVoiceQa = (proj) => readJson(qaFile(proj));
const sentMark = (proj) => path.join(proj, 'voice_qa.notified');

/** Одна строка для отчётов: что сделала сверка. */
export function voiceQaSummary(qa) {
  if (!qa) return 'сверка озвучки: отчёта нет';
  if (qa.status === 'clean') return 'сверка озвучки: чисто';
  if (qa.status === 'skipped') return `сверка озвучки не выполнялась (${qa.note || 'причина не указана'})`;
  const rep = (qa.repaired || []).map((r) => `кусок ${r.chunk}: ${r.fix}`), bad = (qa.failed || []).map((f) => `кусок ${f.chunk} «${(f.words || []).map((w) => plain(w).replace(/[.,!?…]+$/, '')).join(' ')}»`);
  if (qa.status === 'repaired') return `сверка озвучки: починено автоматически (${rep.join('; ')}), слова те же`;
  return `сверка озвучки: НЕ починено ${bad.join('; ')}${rep.length ? `; починено: ${rep.join('; ')}` : ''}`;
}

/** Текст карточки Нику по непочиненным кускам. */
export function voiceQaCardText({ id, title, tag = '', qa }) {
  const bad = (qa.failed || []);
  const lines = bad.map((f) => `• кусок ${f.chunk}: «${plain(f.text).replace(/\s+/g, ' ').slice(0, 160)}»\n  звучит искажённо: ${(f.words || []).map((w) => `«${plain(w).replace(/[.,!?…]+$/, '')}»`).join(', ') || 'см. аудио'}.\n  Пробовал: перегенерации, ${f.tried && f.tried.length ? f.tried.join('; ') : 'варианты не получились'}.`);
  const fixed = (qa.repaired || []).map((r) => `кусок ${r.chunk} (${r.fix})`);
  return `🎙 Озвучка ролика №${id} «${title}»${tag}: автоматически починить не удалось.\n${lines.join('\n')}${fixed.length ? `\nПочинено само: ${fixed.join('; ')}.` : ''}\n\nМонтаж идёт с этой озвучкой. Послушай кусок во вложении. Если плохо, напиши, чем заменить слово (или «оставить»), и я перезапишу озвучку куска и пересоберу ролик.`;
}

/** Один проход: если сверка не починила, а карточка ещё не уходила, отправляет её (один раз на проект). -> 'sent' | 'none' | 'already'. */
export async function checkVoiceQa(proj, { id, title, tag = '', notify, log = () => {} } = {}) {
  const qa = readVoiceQa(proj);
  if (!qa) return 'none';
  if (qa.status === 'repaired') log('озвучка: ' + voiceQaSummary(qa));
  if (qa.status !== 'failed') return 'none';
  if (fs.existsSync(sentMark(proj)) && readJson(sentMark(proj)).ts === qa.ts) return 'already';
  const audio = (qa.failed || []).map((f) => f.audio && path.join(proj, f.audio)).filter((f) => f && fs.existsSync(f));
  await notify(voiceQaCardText({ id, title, tag, qa }), audio);
  fs.writeFileSync(sentMark(proj), JSON.stringify({ ts: qa.ts, sent: Date.now() }));
  return 'sent';
}

/** Следит за проектом, пока монтажёр работает: карточка уходит сразу, как только озвучка записала отчёт с провалом. -> stop(). */
export function watchVoiceQa(proj, opts, { intervalMs = 15000 } = {}) {
  let busy = false;
  const tick = async () => { if (busy) return; busy = true; try { await checkVoiceQa(proj, opts); } catch (e) { (opts.log || (() => {}))('озвучка: карточка не ушла: ' + e.message); } finally { busy = false; } };
  const h = setInterval(tick, intervalMs); if (h.unref) h.unref();
  return () => clearInterval(h);
}

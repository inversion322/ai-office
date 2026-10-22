// Разбор времени отложенной публикации YouTube (Ник пишет по-русски, время московское, МСК = UTC+3 без перехода на летнее).
// «завтра 18:00», «сегодня в 20:30», «послезавтра 9», «25.10 19:00», «25 октября в 19:00», «через 3 часа», «18:00» (ближайшее такое время).
// parseWhen(text, now) → { ok, at: Date, atMs } | { ok:false, error }. Чистая функция: можно проверять без сети и часов.
export const MSK_OFFSET_H = 3;
export const MIN_AHEAD_MIN_USER = 10;            // YouTube принимает publishAt только в будущем; меньше десяти минут ставить смысла нет
export const MAX_AHEAD_DAYS = 365;
const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const NOT_LETTER = '(?![а-яё])';

/** Московские календарные поля момента: { y, m (1-12), d, h, min }. */
export function mskParts(ms) {
  const t = ms instanceof Date ? ms.getTime() : typeof ms === 'string' && !/^\d+$/.test(ms.trim()) ? Date.parse(ms) : Number(ms);       // миллисекунды, Date или ISO-строка: раньше ISO давало NaN.NaN.NaN
  if (!Number.isFinite(t)) throw new Error('не удалось разобрать время: ' + String(ms));
  const d = new Date(t + MSK_OFFSET_H * 3600e3);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), min: d.getUTCMinutes() };
}
/** Момент (мс UTC) по московскому времени. */
export const mskToMs = (y, m, d, h, min) => Date.UTC(y, m - 1, d, h - MSK_OFFSET_H, min, 0, 0);
const dim = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const fmtMsk = (ms) => { const p = mskParts(ms); const pad = (n) => String(n).padStart(2, '0'); return `${pad(p.d)}.${pad(p.m)}.${p.y} ${pad(p.h)}:${pad(p.min)}`; };
export { fmtMsk };

export function parseWhen(input, nowMs = Date.now()) {
  let s = String(input || '').toLowerCase().replace(/ё/g, 'е').replace(/[,;]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s) return { ok: false, error: 'Не вижу времени. Напишите, например: «завтра 18:00» или «25.10 19:30».' };
  if (new RegExp(`(?:^| )(вчера|позавчера|позапозавчера)${NOT_LETTER}`).test(s)) return { ok: false, error: 'Это прошедший день: YouTube принимает выход только в будущем. Напишите «сегодня», «завтра» или дату.' };       // «вчера 12:00» молча стало бы «ближайшим 12:00»
  const now = mskParts(nowMs);
  let atMs = null;

  // «через 3 часа», «через 40 минут», «через полтора часа»
  let m = s.match(new RegExp(`через (?:(\\d{1,3})|полтора|пол ?часа)\\s*(час[а-я]*|ч|мин[а-я]*|м)?${NOT_LETTER}`));
  if (m && (m[2] || /полтора|пол/.test(m[0]))) {
    const half = /полтора/.test(m[0]), halfH = /пол ?часа/.test(m[0]);
    const n = half ? 1.5 : halfH ? 0.5 : Number(m[1]), isH = half || halfH || /^ч/.test(m[2] || '');
    atMs = nowMs + n * (isH ? 3600e3 : 60e3);
  } else {
    // время суток: 18:00, 18.00, 18 00 (с «в»), «в 9», «9 утра», «9 вечера»
    let h = null, min = 0, rest = s;
    // 18:00 и 18ч00 всегда время; 18.00 время, только если день назван словом или перед ним «в» (иначе это дата ДД.ММ); «в 18» и «в 18 30»
    const dayWord = new RegExp(`(?:^| )(сегодня|завтра|послезавтра|понедельник|вторник|сред[ау]|четверг|пятниц[ау]|суббот[ау]|воскресенье)${NOT_LETTER}`).test(s);
    const hm = s.match(/(?:^|[^\d.])([01]?\d|2[0-3])[:ч]([0-5]\d)(?!\d)/)
      || s.match(/(?:^| )в ([01]?\d|2[0-3])[.]([0-5]\d)(?!\d)/)
      || (dayWord ? s.match(/(?:^|[^\d.])([01]?\d|2[0-3])[.]([0-5]\d)(?![\d.])/) : null)
      || (/(?:^|[^\d])\d{1,2}\.\d{1,2}(?:\.\d{2,4})?\s+([01]?\d|2[0-3])\.([0-5]\d)(?![\d.])/.test(s) ? s.match(/\s([01]?\d|2[0-3])\.([0-5]\d)(?![\d.])(?!.*\d{1,2}\.\d)/) : null)   // «25.10 18.00»: первая пара дата, вторая время
      || s.match(/(?:^| )в ([01]?\d|2[0-3])(?:[ ]([0-5]\d))?(?![\d.:]|\s*(?:час|ч\b))/);
    if (hm) { h = Number(hm[1]); min = hm[2] ? Number(hm[2]) : 0; rest = s.replace(hm[0], ' '); }
    else { const alone = s.match(/(?:^| )([01]?\d|2[0-3])\s*(утра|дня|вечера|ночи)(?![а-яё])/); if (alone) { h = Number(alone[1]); rest = s.replace(alone[0], ' '); } }
    const dayPart = s.match(/(\d{1,2})\s*(?:[:ч.]\s*\d{2})?\s*(утра|дня|вечера|ночи)(?![а-яё])/);
    if (h != null && dayPart) {
      const w = dayPart[2];
      if ((w === 'вечера' || w === 'дня') && h < 12) h += 12; else if (w === 'ночи' && h === 12) h = 0; else if (w === 'утра' && h === 12) h = 0;
    }
    if (h == null) return { ok: false, error: 'Не нашла время суток. Напишите, например: «завтра 18:00».' };

    // день: сегодня / завтра / послезавтра / ДД.ММ(.ГГГГ) / «25 октября» / день недели
    let y = now.y, mo = now.m, d = now.d, dayGiven = false;
    const bump = (n) => { const t = new Date(Date.UTC(y, mo - 1, d + n)); y = t.getUTCFullYear(); mo = t.getUTCMonth() + 1; d = t.getUTCDate(); };
    let dm;
    if (new RegExp(`послезавтра${NOT_LETTER}`).test(rest)) { bump(2); dayGiven = true; }
    else if (new RegExp(`завтра${NOT_LETTER}`).test(rest)) { bump(1); dayGiven = true; }
    else if (new RegExp(`сегодня${NOT_LETTER}`).test(rest)) dayGiven = true;
    else if ((dm = rest.match(/(?:^|[^\d])(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?(?!\d)/))) {
      d = Number(dm[1]); mo = Number(dm[2]); dayGiven = true; if (dm[3]) y = Number(dm[3]) < 100 ? 2000 + Number(dm[3]) : Number(dm[3]);
      if (mo < 1 || mo > 12 || d < 1 || d > dim(y, mo)) return { ok: false, error: `Такой даты нет: ${dm[0].trim()}.` };
      if (!dm[3] && mskToMs(y, mo, d, h, min) < nowMs - 60e3) y += 1;
    } else if ((dm = rest.match(new RegExp(`(\\d{1,2})\\s+(${MONTHS.map((x) => x.slice(0, 3)).join('|')})[а-я]*`)))) {
      d = Number(dm[1]); mo = MONTHS.findIndex((x) => x.startsWith(dm[2])) + 1; dayGiven = true;
      if (d < 1 || d > dim(y, mo)) return { ok: false, error: `Такой даты нет: ${dm[0]}.` };
      if (mskToMs(y, mo, d, h, min) < nowMs - 60e3) y += 1;
    } else {
      const WD = [['воскресенье', 'воскресенье', 0], ['понедельник', 'понедельник', 1], ['вторник', 'вторник', 2], ['сред', 'среду', 3], ['четверг', 'четверг', 4], ['пятниц', 'пятницу', 5], ['суббот', 'субботу', 6]];
      const w = WD.find(([k]) => new RegExp(`(?:^| )${k}`).test(rest));
      if (w) { const cur = new Date(Date.UTC(y, mo - 1, d)).getUTCDay(); let add = (w[2] - cur + 7) % 7; if (add === 0 && mskToMs(y, mo, d, h, min) < nowMs + MIN_AHEAD_MIN_USER * 60e3) add = 7; bump(add); dayGiven = true; }
    }
    atMs = mskToMs(y, mo, d, h, min);
    // «18:00» без дня: ближайшее такое время (сегодня, если ещё не прошло с запасом, иначе завтра)
    if (!dayGiven && atMs < nowMs + MIN_AHEAD_MIN_USER * 60e3) { bump(1); atMs = mskToMs(y, mo, d, h, min); }
  }
  if (!Number.isFinite(atMs)) return { ok: false, error: 'Не смогла разобрать время.' };
  if (atMs < nowMs + MIN_AHEAD_MIN_USER * 60e3) return { ok: false, error: `Это время уже прошло или меньше чем через ${MIN_AHEAD_MIN_USER} минут (${fmtMsk(atMs)} МСК, сейчас ${fmtMsk(nowMs)}). YouTube принимает выход только в будущем: укажите позже.` };
  if (atMs > nowMs + MAX_AHEAD_DAYS * 86400e3) return { ok: false, error: `Слишком далеко (${fmtMsk(atMs)}): YouTube принимает выход не дальше чем через год.` };
  return { ok: true, at: new Date(atMs), atMs, text: fmtMsk(atMs) };
}

/** Фраза Ника, которая отменяет ожидание времени и не является временем. */
export const isCancelWhen = (t) => new RegExp(`^\\s*(отмена|отменить|не надо|не нужно|стоп|передумал[а-я]*|нет)\\s*[.!]?\\s*$`, 'i').test(String(t || ''));

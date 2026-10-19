// Пакет публикации ролика: название-крючок + хэштеги. Здесь только чистая логика (проверка и сборка сообщения): запуск модели в scripts/smm_pipeline.mjs.
// Правила площадок на 2026-10 (проверены по справке YouTube и официальному анонсу Instagram, декабрь 2025):
//  - Instagram: не больше 5 хэштегов на пост/Reels; глава Instagram: хэштеги не дают охват, общие (#reels, #explore) могут навредить;
//  - YouTube: название до 100 знаков; 3-5 хэштегов (до трёх лучших видны над названием); с >60 хэштегами YouTube игнорирует все; нечестные названия и теги = нарушение;
//  - Telegram: хэштеги работают как рубрики канала (поиск внутри канала).
export const BRAND_TAG = '#МедицинскийДетектив';
export const BANNED_TAGS = ['fyp', 'foryou', 'foryoupage', 'viral', 'viralvideo', 'trending', 'reels', 'reel', 'explore', 'explorepage', 'shorts', 'instagram', 'follow', 'followme', 'like4like', 'любимое', 'вирусноевидео', 'рекомендации', 'врекомендации', 'хочуврек', 'врек'];
// формулировки, которые в названии про здоровье недопустимы: лечебные обещания, «секреты врачей», давление страхом
// В JS \b не понимает кириллицу, поэтому границу слова задаём через Юникод-свойства букв.
const W0 = '(?<![\\p{L}])';
export const RISKY_TITLE = [
  new RegExp(`${W0}(вылеч|излеч|исцел|лечит|лечение|спасёт от|спасет от|гарантир|100\\s*%|навсегда избавит)`, 'iu'),
  new RegExp(`${W0}(врачи\\s+(скрыва|молч|не\\s+хотят)|скрывают от вас|запрещ[её]нн|шок|ужас|смертельн|вы умрёте|вы умрете)`, 'iu'),
  /[A-ZА-ЯЁ]{6,}/u,                              // КАПС
];
const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
export const normTag = (t) => { const s = clean(t).replace(/^#+/, '').replace(/[^\p{L}\p{N}_]/gu, ''); return s ? '#' + s : ''; };
const lower = (t) => normTag(t).slice(1).toLowerCase();

// Число прописью по корням: 16 -> «шестнадцат», 23 -> «двадцать три» / «двадцат» и «три»; для чисел больше 99 только круглые.
const ONES = { 1: ['один', 'одна', 'одно', 'одн'], 2: ['два', 'две'], 3: ['три'], 4: ['четыр'], 5: ['пят'], 6: ['шест'], 7: ['сем'], 8: ['восем'], 9: ['девят'], 10: ['десят', 'десять'], 11: ['одиннадцат'], 12: ['двенадцат'], 13: ['тринадцат'], 14: ['четырнадцат'], 15: ['пятнадцат'], 16: ['шестнадцат'], 17: ['семнадцат'], 18: ['восемнадцат'], 19: ['девятнадцат'] };
const TENS = { 20: 'двадцат', 30: 'тридцат', 40: 'сорок', 50: 'пятьдесят', 60: 'шестьдесят', 70: 'семьдесят', 80: 'восемьдесят', 90: 'девяносто', 100: 'сто', 1000: 'тысяч' };
function wordsForNumber(n) {
  if (ONES[n]) return ONES[n];
  if (TENS[n]) return [TENS[n]];
  if (n > 20 && n < 100) { const t = Math.floor(n / 10) * 10, o = n % 10; return TENS[t] && ONES[o] ? ONES[o].map((w) => `${TENS[t]}ь ${w}`).concat([`${TENS[t]} ${ONES[o][0]}`]) : []; }
  return [];
}
export { wordsForNumber };
export function checkTitle(title, { max = 100, scriptText = '' } = {}) {
  const t = clean(title), problems = [];
  if (!t) return { ok: false, problems: ['пусто'] };
  if (t.length > max) problems.push(`длиннее ${max} знаков (${t.length})`);
  if (t.split(' ').length > 12) problems.push('длиннее 12 слов');
  if ((t.match(/[!?]/g) || []).length > 2) problems.push('больше двух знаков ! или ?');
  for (const re of RISKY_TITLE) if (re.test(t)) problems.push('рискованная формулировка для темы здоровья: ' + (re.exec(t) || [])[0]);
  // числа в названии должны быть в сценарии цифрой или словом того же значения (иначе это обещание, которого нет в ролике)
  const script = String(scriptText).toLowerCase();
  if (script) for (const n of t.match(/\d+/g) || []) if (!script.includes(n) && !wordsForNumber(Number(n)).some((w) => script.includes(w))) problems.push(`число ${n} не найдено в сценарии`);
  return { ok: !problems.length, problems };
}

export function checkTags(tags, { max = 5, topicWords = [] } = {}) {
  const out = [], seen = new Set(), dropped = [];
  for (const raw of tags || []) {
    const t = normTag(raw), l = lower(raw);
    if (!t || t.length < 3) continue;
    if (seen.has(l)) continue;
    if (BANNED_TAGS.includes(l)) { dropped.push([t, 'накрутка или общий тег: вредит или бесполезен']); continue; }
    seen.add(l); out.push(t);
  }
  const brandPos = out.findIndex((t) => t.toLowerCase() === BRAND_TAG.toLowerCase());
  if (brandPos >= 0) out.splice(brandPos, 1);
  const tags5 = [BRAND_TAG, ...out].slice(0, max);                 // бренд всегда первым и всегда остаётся в лимите
  for (const t of out.slice(max - 1)) dropped.push([t, `лимит ${max} хэштегов (Instagram)`]);
  return { tags: tags5, dropped };
}

// Краткая пометка: первое ПОЛНОЕ предложение (двоеточие и точка с запятой внутри фразы не конец: «Лёгкий:» без продолжения бессмысленно)
const shortRisk = (r, n = 110) => {
  const s = clean(r).replace(/^риск:\s*/i, '');
  if (!s || /^(нет|лёгк|легк|низк|минимальн|небольш|ничего|отсутств)/i.test(s)) return '';     // «Нет: …», «Лёгкий: …», «низкий» = риска нет, показывать нечего
  const sentence = (s.match(/^.+?[.!?](?=\s|$)/u) || [s])[0].replace(/[.;:,\s]+$/u, '');
  if (sentence.length <= n) return sentence;
  const cut = sentence.slice(0, n), at = Math.max(cut.lastIndexOf(', '), cut.lastIndexOf(' — '), cut.lastIndexOf('; '));
  return (at > n * 0.5 ? cut.slice(0, at) : cut.replace(/\s+\S*$/u, '')).replace(/[.;:,\s]+$/u, '') + '…';
};
const sameAs = (a, b) => clean(a).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '') === clean(b).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
// Итоговое сообщение Нику: одно, копируемое. title — выбранное, alternatives — запасные (без повтора названия самой темы и выбранного).
export function buildMessage({ videoTitle, title, why, alternatives = [], tags, dropped = [], honesty = '' }) {
  alternatives = alternatives.filter((a) => !sameAs(a.title, title) && !sameAs(a.title, videoTitle));
  const lines = [`📦 Пакет публикации: «${clean(videoTitle)}»`, '', 'НАЗВАНИЕ (копируйте):', title];
  if (why) lines.push(`почему: ${shortRisk(why, 160) || clean(why)}`);
  if (alternatives.length) { lines.push('', 'Запасные варианты:'); alternatives.forEach((a, i) => { const r = shortRisk(a.risk); lines.push(`${i + 1}. ${a.title}${r ? `  (осторожно: ${r})` : ''}`); }); }
  const line = tags.join(' ');
  lines.push('', 'ХЭШТЕГИ для Instagram и Telegram (копируйте одной строкой, их ' + tags.length + ', больше 5 Instagram не примет):', line);
  lines.push('', 'YouTube Shorts: в название добавьте 1-2 первых хэштега в конце, остальные последней строкой описания.');
  if (dropped.length) lines.push('', 'Убрала: ' + dropped.map(([t, r]) => `${t} (${r})`).join('; '));
  if (honesty) lines.push('', clean(honesty));
  return lines.join('\n');
}

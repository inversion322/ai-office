// Повторы тем (решение Ника 2026-10-20: «темы не должны повторяться»). Сравнение по смыслу слов, а не по точной строке:
// «Нужно ходить ровно десять тысяч шагов в день?» и «10 000 шагов в день: обязательно ли ходить?» это одна тема.
// Нормализация: нижний регистр, ё→е, числа словами → цифры («десять тысяч» = 10000), стоп-слова убраны, слова режутся до основы (первые 5 букв).
const STOP = new Set('ли ни не да то же бы это эта этот эти тот та те что как для при про над под без или либо а но и в во на с со к ко о об от по из за у до ну так там тут вот весь все всё всех всем свой ваш наш их его ее ей им нам вам может можно нужно надо правда миф мифы ли?'.split(/\s+/));
const NUMW = { ноль: 0, один: 1, одна: 1, одно: 1, два: 2, две: 2, три: 3, четыре: 4, пять: 5, шесть: 6, семь: 7, восемь: 8, девять: 9, десять: 10, двадцать: 20, тридцать: 30, сорок: 40, пятьдесят: 50, сто: 100 };
const stem = (w) => (w.length > 5 ? w.slice(0, 5) : w);

export function tokens(title) {
  let s = String(title || '').toLowerCase().replace(/ё/g, 'е').replace(/(\d)[\s\u00a0.,](?=\d{3}(?!\d))/g, '$1');   // 10 000 → 10000
  s = s.replace(/(^|[^а-я])(\d+|[а-я]+)\s+тысяч[а-я]*/g, (m, p, w) => `${p}${(/^\d+$/.test(w) ? Number(w) : NUMW[w]) * 1000 || w + ' тысяч'}`);   // «десять тысяч» → 10000
  const out = new Set();
  for (const w of s.split(/[^а-яa-z0-9]+/).filter(Boolean)) {
    if (STOP.has(w)) continue;
    if (w in NUMW) { out.add(String(NUMW[w])); continue; }
    if (/^\d+$/.test(w)) { out.add(w); continue; }
    if (w.length < 3) continue;
    out.add(stem(w));
  }
  return out;
}
/** Похожесть двух тем 0..1: доля общих основ слов от меньшего набора (устойчиво к разной длине формулировок). */
export function similarity(a, b) {
  const A = tokens(a), B = tokens(b); if (A.size < 2 || B.size < 2) return 0;
  let common = 0; for (const t of A) if (B.has(t)) common++;
  return common / Math.min(A.size, B.size);
}
export const DUP_THRESHOLD = 0.6;
/** Находит самую похожую из существующих тем. Возвращает { dup: bool, score, match }. */
export function findDuplicate(title, existing, threshold = DUP_THRESHOLD) {
  let best = { dup: false, score: 0, match: null };
  for (const e of existing || []) { const s = similarity(title, e); if (s > best.score) best = { dup: s >= threshold, score: s, match: e }; }
  return { ...best, dup: best.score >= threshold };
}
/** Делит кандидатов на новые и повторы (по существующим темам и между собой: два одинаковых кандидата в одной пачке тоже повтор). */
export function splitNew(cands, existing, threshold = DUP_THRESHOLD) {
  const fresh = [], dropped = [], seen = [...(existing || [])];
  for (const c of cands || []) {
    const r = findDuplicate(c && c.title, seen, threshold);
    if (r.dup) dropped.push({ title: c.title, match: r.match, score: Number(r.score.toFixed(2)) });
    else { fresh.push(c); seen.push(c.title); }
  }
  return { fresh, dropped };
}

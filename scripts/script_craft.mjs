// Автопроверка драматургии сценария (решение Ника 2026-10-20: «факты просто перебираются без логической цепочки и без эмоциональной развязки»).
// Что можно проверить честно, проверяем кодом: идея, эмоциональная дуга, цепочка «но/поэтому» в самом тексте, фраза-вывод, замыкание на хук, протокольный стиль.
// Что нельзя (интересно ли, смешно ли), решает Ник на утверждении, поэтому в карточку выводятся идея, дуга и связки.
const L = '(?<![а-яёa-z])', R = '(?![а-яёa-z])';
export const BUT = ['но', 'однако', 'а вот', 'зато', 'вот только', 'только вот', 'на самом деле', 'хотя', 'а на деле', 'при этом', 'правда'];
export const THEREFORE = ['поэтому', 'значит', 'получается', 'выходит', 'так что', 'вот почему', 'следовательно', 'отсюда', 'в итоге', 'а раз так', 'вот откуда', 'вот и ответ', 'итак'];
const mk = (list) => new RegExp(`${L}(?:${list.join('|')})${R}`, 'i');
const BUT_RE = mk(BUT), THEREFORE_RE = mk(THEREFORE);
const STOP = new Set(['который', 'которые', 'когда', 'потому', 'просто', 'можно', 'нужно', 'очень', 'такой', 'такие', 'этого', 'этой', 'этот', 'почему', 'всего', 'более', 'после', 'перед', 'между']);
const norm = (s) => String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/[^а-яa-z0-9\s]/gi, ' ').replace(/\s+/g, ' ').trim();
const stems = (s) => new Set(norm(s).split(' ').filter((w) => w.length >= 5 && !STOP.has(w)).map((w) => w.slice(0, 5)));

/** sc: объект script.json. Возвращает { ok, issues: [{rule, say}], } */
export function craftIssues(sc, { rubric = 'myth' } = {}) {
  const issues = [], seg = (sc && sc.segments) || [], add = (rule, say) => issues.push({ rule, say });
  if (!seg.length) return { ok: false, issues: [{ rule: 'empty', say: 'нет абзацев' }] };
  if (String(sc.idea || '').trim().length < 15) add('idea', 'нет поля idea: сквозная мысль ролика одним предложением');
  const arc = Array.isArray(sc.emotion_arc) ? sc.emotion_arc : [];
  if (arc.length < 3) add('arc', 'поле emotion_arc: нужно 3-4 шага чувства по ходу ролика (например: любопытство → удивление → сомнение → облегчение)');
  const chain = Array.isArray(sc.chain) ? sc.chain : [];
  if (chain.length !== seg.length - 1) add('chain', `поле chain: нужно ${seg.length - 1} связок (по числу переходов между абзацами), сейчас ${chain.length}`);
  else {
    const links = chain.map((c) => String((c && c.link) || '').toLowerCase().trim());
    if (links.some((l) => l !== 'но' && l !== 'поэтому')) add('chain-link', 'в chain каждая связка только «но» или «поэтому» (не «и потом», не «далее»)');
    else {
      if (!links.includes('но')) add('chain-but', 'в цепочке нет ни одного «но»: без «но» нет напряжения, добавь поворот или оговорку');
      links.forEach((l, i) => {
        const text = String(seg[i + 1] || '').slice(0, 90), re = l === 'но' ? BUT_RE : THEREFORE_RE;
        if (!re.test(text)) add('chain-text', `абзац ${i + 2} связан с предыдущим словом «${l}», но в начале текста этого не слышно: начни с живой связки (${(l === 'но' ? BUT : THEREFORE).slice(0, 5).map((x) => `«${x}»`).join(', ')}…)`);
      });
    }
  }
  const pay = norm(sc.payoff);
  if (pay.length < 10) add('payoff', 'нет поля payoff: одна запоминающаяся фраза-вывод, которую зритель повторит другу');
  else if (!norm(seg.slice(-2).join(' ')).includes(pay)) add('payoff-text', 'фраза payoff должна дословно стоять в одном из двух последних абзацев');
  const first = stems(seg[0]), last = stems(seg[seg.length - 1]);
  if (![...first].some((x) => last.has(x))) add('loop', 'финал не замыкается на хук: в последнем абзаце нет ни одного ключевого слова из первого (дай ответ на вопрос хука его же словами)');
  const labeled = seg.filter((s) => /^[А-ЯЁA-Z][а-яёА-ЯЁa-zA-Z-]{1,}(?:\s+[а-яёa-z-]+)?:/.test(String(s).trim())).length;   // ярлык: одно-два слова и двоеточие («Метаанализ:», «ВОЗ:»), а не обычная фраза «Но учёные проверили:»
  if (labeled >= 2) add('telegraphic', `${labeled} абзаца начинаются «ярлыком с двоеточием» («Метаанализ: …»): это протокол, а не речь. Переведи в живую фразу, как говорят другу`);
  const hooks = Array.isArray(sc.hook_options) ? sc.hook_options : [];
  if (new Set(hooks.map((h) => String(h && h.type || '').toLowerCase()).filter(Boolean)).size < 3) add('hooks', 'hook_options: нужны 3 хука из 3 разных семейств (слух, откуда, эксперимент, контраст, цифра, история) с оценкой');
  if (rubric === 'myth' && !/\?/.test(String(seg[0]).slice(0, 140))) add('hook-question', 'для мифа хук задаёт живой вопрос зрителю: «Говорят, что … Правда ли это?»');
  return { ok: issues.length === 0, issues };
}
export function craftFeedback(issues) {
  if (!issues.length) return '';
  return `Автопроверка драматургии (решение Ника: цепочка «но/поэтому», эмоциональная дуга, живая речь, развязка; правила в video/med_detective/SCRIPT_CRAFT.md) нашла: ${issues.map((x) => x.say).join('; ')}. Исправь именно это, факты и claims не меняй, новых утверждений не добавляй.`;
}
/** Короткая сводка для карточки Ника: идея, дуга, связки. */
export function craftSummary(sc) {
  const arc = (sc.emotion_arc || []).map((a) => (typeof a === 'string' ? a : a.feeling || a.beat || '')).filter(Boolean).join(' → ');
  const chain = (sc.chain || []).map((c) => `${c.to - 1}→${c.to} ${c.link}`).join(', ');
  return [sc.idea ? `Идея: ${sc.idea}` : '', arc ? `Эмоция: ${arc}` : '', chain ? `Связки: ${chain}` : ''].filter(Boolean).join('\n');
}

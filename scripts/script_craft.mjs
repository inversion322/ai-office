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
  if (process.env.STORY_GATE !== 'off') {     // единая история (решение Ника 2026-10-21): угол, ставка зрителя, две интриги, финал-кольцо
    const cand = (sc.lens && Array.isArray(sc.lens.candidates) ? sc.lens.candidates : []).map((x) => String(x || '').trim()).filter(Boolean);
    if (cand.length < 3 || cand.some((x) => x.length < 15)) add('lens', 'поле lens.candidates: нужны 3 разных угла подачи (каждый одной фразой с приёмом: инверсия злодея, актив в провале, эффект второго порядка, смена точки зрения, цена и выгода наоборот); очевидный «миф ли это?» может быть одним из трёх');
    else {
      const ss = cand.map((x) => stems(x)); let same = false;
      for (let i = 0; i < ss.length; i++) for (let j = i + 1; j < ss.length; j++) { const u = new Set([...ss[i], ...ss[j]]); const inter = [...ss[i]].filter((x) => ss[j].has(x)).length; if (u.size && inter / u.size > 0.5) same = true; }
      if (same) add('lens-distinct', 'угла три, но два из них пересказывают одно и то же: нужны существенно разные углы (другое действие, другой герой истории, другая метафора), а не перефразировка');
      const ch = Number(sc.lens && sc.lens.chosen); if (!(ch >= 1 && ch <= cand.length)) add('lens-chosen', 'lens.chosen: номер выбранного угла (1-' + cand.length + ')');
      if (String((sc.lens && sc.lens.why) || '').trim().length < 12) add('lens-why', 'lens.why: коротко почему выбран именно этот угол (на каких данных он держится)');
    }
    if (String(sc.stake || '').trim().length < 25) add('stake', 'поле stake: что зритель чувствует или делает по этому поводу каждый день, его словами, одним предложением (эмоциональное зеркало, не факт)');
    const gaps = (Array.isArray(sc.gaps) ? sc.gaps : []).map((x) => String(x || '').trim()).filter((x) => x.length >= 10);
    if (gaps.length < 2) add('gaps', 'поле gaps: две интриги, «что на самом деле» и «что это значит для меня»; обе открываются в первых абзацах и закрываются в финале');
    const be = String(sc.bookend || '').trim();
    if (!be) add('bookend', 'поле bookend: слово или число из хука, которое возвращается в последнем абзаце (кольцо)');
    else {
      const tk = (s) => new Set(norm(s).split(' ').filter((w) => w.length >= 3 && !STOP.has(w)).map((w) => (/^\d+$/.test(w) ? w : w.slice(0, 4))));
      const need = [...tk(be)]; const A = tk(seg[0]), Z = tk(seg[seg.length - 1]);
      if (!need.length || !need.some((x) => A.has(x)) || !need.some((x) => Z.has(x))) add('bookend-text', `bookend «${be}» должен стоять и в первом, и в последнем абзаце (кольцо хука и финала); сейчас ${need.some((x) => A.has(x)) ? '' : 'в первом нет'}${!need.some((x) => A.has(x)) && !need.some((x) => Z.has(x)) ? ' и ' : ''}${need.some((x) => Z.has(x)) ? '' : 'в последнем нет'}`);
    }
    const shape = seg.map((s) => { const t = String(s); return { n: (t.match(/\d+|[а-яё]+(?:надцат|десят|сот)[а-яё]*|(?:один|два|две|три|четыре|пять|шесть|семь|восемь|девять|десять|сорок|пятьдесят|сто)(?![а-яё])/gi) || []).length, q: /\?/.test(t) }; });
    let run = 0, worst = 0; shape.forEach((x) => { run = x.n >= 2 && !x.q ? run + 1 : 0; worst = Math.max(worst, run); });
    if (worst >= 4) add('numbers-run', 'четыре абзаца подряд забиты числами: это отчёт об опыте, а не история. Оставь цифры там, где они ломают ожидание, остальное переведи в образ и действие');
  }
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
  const lens = sc.lens && Array.isArray(sc.lens.candidates) && sc.lens.candidates[Number(sc.lens.chosen) - 1];
  return [sc.idea ? `Идея: ${sc.idea}` : '', lens ? `Угол: ${lens}` : '', sc.stake ? `Что у зрителя в ставке: ${sc.stake}` : '', arc ? `Эмоция: ${arc}` : '', chain ? `Связки: ${chain}` : ''].filter(Boolean).join('\n');
}

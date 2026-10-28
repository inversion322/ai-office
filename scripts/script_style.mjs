// Автопроверка стиля текста озвучки (решение Ника 2026-10-20): служебные слова каркаса в ролике не звучат и не показываются.
// «Улика №…», «поворот», «развязка», «заявление», «приговор» это внутренняя формула сценариста, а не речь диктора.
const WORD = '[а-яё]*';
const NUM = '(?:перв|втор|трет|четв[её]рт|пят)';
const RULES = [
  { id: 'clue-num', re: new RegExp(`улик${WORD}\\s*(?:№|номер|n)?\\s*(?:\\d+|${NUM}${WORD}|один|два|три|четыре|пять)`, 'i'), say: 'номер улики («улика первая/номер один…»)' },
  { id: 'clue-num-rev', re: new RegExp(`(?:${NUM}${WORD}|№\\s*\\d+)\\s+улик${WORD}`, 'i'), say: 'номер улики («первая улика…»)' },
  { id: 'clue-word', re: /(?:^|[\s«"(,.—-])улик[а-яё]*/i, say: 'слово «улика» как название этапа' },
  { id: 'twist', re: /(?:^|[\s«"(,.—-])поворот(?=\s*(?:[!.:;—-]|$))/i, say: 'слово «поворот» как название этапа' },
  { id: 'denouement', re: /(?:^|[\s«"(,.—-])развязк[а-яё]*/i, say: 'слово «развязка»' },
  { id: 'claim', re: /(?:^|[\s«"(,.—-])заявлени[а-яё]*(?=[\s,.:;!?—»")-]|$)/i, say: 'слово «заявление» как название этапа' },
  { id: 'verdict', re: /(?:^|[\s«"(,.—-])приговор[а-яё]*/i, say: 'слово «приговор» как название этапа' },
  { id: 'sources-voice', re: /источник[а-яё]*\s+на\s+экран/i, say: '«источники на экране» (источники показываются после призыва молча)' },
  { id: 'case-no', re: /дел[оа]\s*(?:№|номер)\s*\d+/i, say: 'номер дела вслух' },
];
// «Повороты судьбы», «поворотный» не ловим: «поворот» только отдельным словом-названием этапа («Поворот!», «Поворот:»).
export function styleIssues(segments = []) {
  const out = [];
  segments.forEach((seg, i) => {
    const text = String(seg || '');
    for (const r of RULES) {
      const m = r.re.exec(text);
      if (m) out.push({ seg: i + 1, rule: r.id, say: r.say, quote: text.slice(Math.max(0, m.index - 20), m.index + 50).replace(/\s+/g, ' ').trim() });
    }
  });
  return out;
}
export function styleFeedback(issues) {
  if (!issues.length) return '';
  const verdict = issues.filter((x) => x.rule === 'hook-verdict'), other = issues.filter((x) => x.rule !== 'hook-verdict'), parts = [];
  if (other.length) {
    const lines = other.map((x) => `абзац ${x.seg}: ${x.say}: «…${x.quote}…»`).join('; ');
    parts.push(`В тексте озвучки остались служебные слова каркаса, которых в ролике быть не должно (решение Ника: «улика №…», «поворот», «развязка» и подобное это внутренняя формула, а не речь): ${lines}. Перепиши эти места по смыслу: назови само исследование и что оно показало, свяжи с предыдущим фактом логическим мостиком («но если дело в этом, почему…»). Остальной текст и факты не меняй.`);
  }
  if (verdict.length) {
    const lines = verdict.map((x) => `${x.where === 'экран' ? 'на экране' : 'в озвучке'}, абзац ${x.seg}: «…${x.quote}…»`).join('; ');
    parts.push(`Вердикт (миф это или правда) нельзя называть в начале ролика ни голосом, ни на экране (решение Ника: так зритель теряет интерес и не досматривает): ${lines}. Хук ставит вопрос («Говорят, что… Правда ли это?»), а не метку и не штамп «МИФ?»: убери слова «миф», «правда» (кроме вопроса «правда ли»), «ложь», «фейк», «развенчиваем» из первых двух абзацев и из их описания на экране (on_screen: headline, note, loupe). Вердикт звучит и показывается только в конце, перед призывом. Остальной текст и факты не меняй.`);
  }
  return parts.join('\n\n');
}
// «Резкий переход»: абзац (кроме первого) начинается голым перечислением без связки с предыдущим.
const BARE_STARTS = /^(?:далее|следующ[а-яё]*|втор(?:ое|ой|ая|ым)|трет(?:ье|ий|ья|ьим)|ещё\s+один\s+факт|теперь\s+о|во-вторых|в-третьих|и ещё\s+один)(?![а-яё])/i;
export function bridgeIssues(segments = []) {
  const out = [];
  segments.forEach((seg, i) => { if (i > 0 && BARE_STARTS.test(String(seg).trim())) out.push({ seg: i + 1, say: 'абзац начинается как пункт списка без связки с предыдущей мыслью', quote: String(seg).trim().slice(0, 50) }); });
  return out;
}

// Вердикт (миф или правда) в начале ролика (решение Ника 2026-10-20): метка «МИФ?» в заголовке и слова-ярлыки в хуке выдают развязку, зритель не досматривает.
// Проверяются первые EARLY абзацев озвучки и их описание на экране (on_screen: headline, note, loupe, numbers). «Правда ли это?» остаётся: это вопрос, а не метка.
export const VERDICT_EARLY = 2;
const LB = '(?<![а-яё])';
export const VERDICT_RE = new RegExp([
  'миф[а-яё]*', 'ложь', 'ложн[а-яё]*', 'неправд[а-яё]*', 'фейк[а-яё]*', 'развенчива[а-яё]*', 'разоблача[а-яё]*',
  'правд[аыуе](?![а-яё])(?!\\s+ли(?![а-яё]))(?!\\s*[?]|\\s*,?\\s+что(?![а-яё]))',
].map((x) => LB + x).join('|'), 'i');
// Обещание файла с мифами («слово для бесплатного файла с тридцатью самыми популярными мифами», призыв «файл с разбором тридцати мифов») называет СОДЕРЖАНИЕ файла,
// а не вердикт ролика (решение Ника 2026-10-28, правка последнего сценария: «мифами» в обещании остаётся). Такие слова из проверки вердикта вырезаются.
export const LEADMAGNET_RE = /файл[а-яё]*\s+со?\s+(?:[а-яё«»"-]+\s+){0,5}?миф[а-яё]*/gi;      // только «файл(а) с … миф…»: «файл МИФ?» рядом со штампом сюда не попадает
export const stripLeadMagnet = (text) => String(text == null ? '' : text).replace(LEADMAGNET_RE, ' ');
const flat = (v) => (Array.isArray(v) ? v.map(flat).join(' ') : v && typeof v === 'object' ? Object.values(v).map(flat).join(' ') : String(v == null ? '' : v));
export function verdictIssues(script, early = VERDICT_EARLY) {
  const out = [], seg = (script && script.segments) || [], scr = (script && Array.isArray(script.on_screen)) ? script.on_screen : [];
  const add = (n, where, raw) => { const text = stripLeadMagnet(raw), m = VERDICT_RE.exec(text); if (m) out.push({ seg: n, rule: 'hook-verdict', where, say: 'вердикт «миф/правда» назван в начале ролика', quote: text.slice(Math.max(0, m.index - 25), m.index + 40).replace(/\s+/g, ' ').trim() }); };
  for (let i = 0; i < Math.min(early, seg.length); i++) add(i + 1, 'озвучка', String(seg[i] || ''));
  scr.forEach((e, i) => { const n = Number(e && e.segment) || i + 1; if (n <= early) add(n, 'экран', flat([e.headline, e.note, e.loupe, e.numbers, e.text])); });
  return out;
}

// Вводные слова без смысла в начале фразы (решение Ника 2026-10-21: «так что британцы пометили воду» -> «Британцы пометили воду»).
// «Потому что / Поэтому / Так что / Итак / Значит…» ничего не сообщают, связь держит содержание. Фраза начинается сразу с сути.
// Контрастные «Но», «Однако», «А вот» остаются: они несут смысл. Вопросы («Значит ли это…», «Так что же делать?») не трогаем.
const NOT_LI = '(?![а-яё])(?!\\s+ли(?![а-яё]))';
const FILLER_SRC = [
  `(?:а\\s+)?(?:значит|получается|выходит)${NOT_LI}(?:,?\\s+что(?![а-яё]))?`,
  `(?:итак|следовательно|поэтому|таким\\s+образом|вот\\s+почему|вот\\s+откуда|вот\\s+и\\s+ответ|а\\s+раз\\s+так|так\\s+вот|ну|короче|в\\s+общем)${NOT_LI}`,
  '(?:так|потому)\\s+что(?![а-яё])(?!\\s+(?:же|делать|такое)(?![а-яё]))',
  'дело\\s+в\\s+том,?\\s+что(?![а-яё])',
].join('|');
const FILLER_AT_START = `(^|(?<=[.!?…][»"”)]*\\s+))(?:${FILLER_SRC})[\\s,:—–-]*([а-яёa-z0-9«"(])`;
export const fillerRe = () => new RegExp(FILLER_AT_START, 'gi');
const SHOW = (t, i) => String(t).slice(i, i + 60).replace(/\s+/g, ' ').trim();
/** Какие фразы начинаются вводным словом: [{seg, quote}] (seg с 1). */
export function fillerOpeners(segments = []) {
  const out = [];
  segments.forEach((seg, i) => { const t = String(seg || ''), re = fillerRe(); let m; while ((m = re.exec(t))) out.push({ seg: i + 1, rule: 'filler-open', say: 'фраза начинается вводным словом без смысла', quote: SHOW(t, m.index + m[1].length) }); });
  return out;
}
/** Вырезает вводное слово и поднимает первую букву: «Так что британцы…» -> «Британцы…». Возвращает { text, changed:[{from,to}] }. */
export function stripFillerOpeners(text) {
  const changed = []; const re = fillerRe();
  const t = String(text == null ? '' : text).replace(re, (m, pre, ch, off, whole) => { const to = pre + ch.toUpperCase(); changed.push({ word: m.slice(pre.length, m.length - ch.length).replace(/[\s,:—–-]+$/, ''), from: SHOW(whole, off + pre.length), to: SHOW(whole.slice(0, off) + to + whole.slice(off + m.length), off + pre.length) }); return to; });
  return { text: t, changed };
}
/** Чистит сценарий (script.json) на месте: абзацы и payoff. Возвращает список правок [{seg, from, to}]. */
export function cleanFillerOpeners(script) {
  const out = []; if (!script || !Array.isArray(script.segments)) return out;
  script.segments = script.segments.map((s, i) => { const r = stripFillerOpeners(s); r.changed.forEach((c) => out.push({ seg: i + 1, ...c })); return r.text; });
  if (typeof script.payoff === 'string') script.payoff = stripFillerOpeners(script.payoff).text;
  return out;
}
export function fillerFeedback(issues) {
  if (!issues.length) return '';
  return `Фразы начинаются вводными словами без смысла (${issues.map((x) => `абзац ${x.seg}: «${x.quote}»`).join('; ')}). Решение Ника: никаких «Потому что», «Поэтому», «Так что», «Итак», «Значит», «Получается», «Выходит», «Таким образом» в начале фразы, сразу суть (что сделали, что нашли). Связь между абзацами держит содержание.`;
}

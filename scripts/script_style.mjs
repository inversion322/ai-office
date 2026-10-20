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
const flat = (v) => (Array.isArray(v) ? v.map(flat).join(' ') : v && typeof v === 'object' ? Object.values(v).map(flat).join(' ') : String(v == null ? '' : v));
export function verdictIssues(script, early = VERDICT_EARLY) {
  const out = [], seg = (script && script.segments) || [], scr = (script && Array.isArray(script.on_screen)) ? script.on_screen : [];
  const add = (n, where, text) => { const m = VERDICT_RE.exec(text); if (m) out.push({ seg: n, rule: 'hook-verdict', where, say: 'вердикт «миф/правда» назван в начале ролика', quote: text.slice(Math.max(0, m.index - 25), m.index + 40).replace(/\s+/g, ' ').trim() }); };
  for (let i = 0; i < Math.min(early, seg.length); i++) add(i + 1, 'озвучка', String(seg[i] || ''));
  scr.forEach((e, i) => { const n = Number(e && e.segment) || i + 1; if (n <= early) add(n, 'экран', flat([e.headline, e.note, e.loupe, e.numbers, e.text])); });
  return out;
}

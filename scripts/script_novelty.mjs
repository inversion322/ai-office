// «Перегенерировать сценарий»: проверка, что новая версия действительно новая, а не правка прежней другими словами,
// и заготовка задания для Ксении. Чистые функции без сети и моделей, поэтому проверяются тестами на реальных текстах.
import fs from 'node:fs';
import path from 'node:path';

// Типы крючка (первая фраза, которая должна остановить прокрутку за 1,5 секунды). Новая версия обязана взять тип, которого не было раньше.
export const HOOK_TYPES = [
  ['парадокс', 'утверждение, которое звучит неверно, но подтверждается данными'],
  ['цифра', 'одна неожиданная конкретная цифра в первой фразе'],
  ['сцена', 'узнаваемая бытовая сцена, в которой зритель видит себя'],
  ['вопрос-ловушка', 'вопрос, на который почти все отвечают неверно'],
  ['обвинение', 'детективная подача: кого зря обвиняли и кто виноват на самом деле'],
  ['контраст', '«все думают X, а данные показывают Y»'],
  ['открытая петля', 'обещание раскрыть в конце ролика одну деталь, которую зритель не ждёт'],
];
export const hookCatalog = () => HOOK_TYPES.map(([n, d]) => `«${n}» (${d})`).join('; ');

// Пороги подобраны на реальных текстах (test/novelty.test.mjs): правка одного и того же сценария даёт ≥ 0,5 общих четвёрок слов,
// два независимых сценария на одну тему обычно делят меньше 0,08 (общие названия исследований и цифры).
// run = 8: главный вывод исследования («на поведение детей сахар не влияет», 6 слов) обязан звучать одинаково в любой честной версии; копированием считаем цепочку от 8 слов.
export const LIMITS = { containment: 0.12, run: 8, firstSentence: 0.5, openers: 2 };

const words = (s) => String(s || '').toLowerCase().replace(/ё/g, 'е').match(/[\p{L}\p{N}]+/gu) || [];
const stem = (w) => (w.length > 5 ? w.slice(0, 5) : w);          // грубо, но склонения одного слова считаются одним
const toks = (s) => words(s).map(stem);
const grams = (t, n) => { const g = new Set(); for (let i = 0; i + n <= t.length; i++) g.add(t.slice(i, i + n).join(' ')); return g; };

// Самая длинная общая цепочка подряд идущих слов (динамикой по двум массивам, тексты короткие).
function longestRun(a, b) {
  let best = 0, end = 0; let prev = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    const cur = new Array(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j++) if (a[i - 1] === b[j - 1]) { cur[j] = prev[j - 1] + 1; if (cur[j] > best) { best = cur[j]; end = i; } }
    prev = cur;
  }
  return { len: best, text: a.slice(end - best, end).join(' ') };
}
const firstSentence = (seg) => (String(seg || '').split(/(?<=[.!?…])\s/)[0] || '');
const opener = (seg) => toks(seg).slice(0, 2).join(' ');           // зачин абзаца: первые два слова («улика перва»)

/** draft: { segments, hook_type }, olds: [{ segments, hook_type, label? }]. Возвращает { ok, reasons[], feedback, summary, worst } */
export function novelty(draft, olds, limits = LIMITS) {
  const dSeg = (draft && draft.segments) || [], dTok = toks(dSeg.join(' '));
  const reasons = []; let worst = { containment: 0, run: 0, runText: '', first: 0, openers: 0, hookSame: false, at: -1 };
  (olds || []).forEach((o, k) => {
    const oSeg = o.segments || [], oTok = toks(oSeg.join(' '));
    const g = grams(dTok, 4), og = grams(oTok, 4); let shared = 0; g.forEach((x) => { if (og.has(x)) shared++; });
    const containment = g.size ? shared / g.size : 0;
    const run = longestRun(dTok, oTok);
    const f1 = new Set(toks(firstSentence(dSeg[0]))), f2 = new Set(toks(firstSentence(oSeg[0])));
    const inter = [...f1].filter((x) => f2.has(x)).length, union = new Set([...f1, ...f2]).size;
    const first = union ? inter / union : 0;
    const oo = new Set(oSeg.map(opener)); const openers = dSeg.map(opener).filter((x) => x && oo.has(x)).length;
    const hookSame = !!(draft.hook_type && o.hook_type && String(draft.hook_type).toLowerCase() === String(o.hook_type).toLowerCase());
    const score = containment + (run.len >= limits.run ? 1 : 0) + (first > limits.firstSentence ? 1 : 0) + (openers >= limits.openers ? 1 : 0) + (hookSame ? 1 : 0);
    const wScore = worst.at < 0 ? -1 : worst.containment + (worst.run >= limits.run ? 1 : 0) + (worst.first > limits.firstSentence ? 1 : 0) + (worst.openers >= limits.openers ? 1 : 0) + (worst.hookSame ? 1 : 0);
    if (score > wScore) worst = { containment, run: run.len, runText: run.text, first, openers, hookSame, at: k, label: o.label || `версия ${k + 1}` };
  });
  if (worst.at >= 0) {
    if (worst.containment > limits.containment) reasons.push(`${Math.round(worst.containment * 100)}% оборотов совпадает с прежней версией (допустимо до ${Math.round(limits.containment * 100)}%)`);
    if (worst.run >= limits.run) reasons.push(`дословный повтор ${worst.run} слов подряд: «${worst.runText}»`);
    if (worst.first > limits.firstSentence) reasons.push('первая фраза почти повторяет прежнюю');
    if (worst.openers >= limits.openers) reasons.push(`те же зачины абзацев (${worst.openers}), то есть прежняя рубрикация`);
    if (worst.hookSame) reasons.push(`тот же тип крючка «${draft.hook_type}»`);
  }
  const ok = reasons.length === 0;
  const pct = Math.round(worst.containment * 100);
  return {
    ok, reasons, worst,
    summary: ok ? `новая версия: совпадение с прежними ${pct}%, тип крючка ${draft.hook_type || 'не указан'}` : `слишком похоже на ${worst.label}: ${reasons.join('; ')}`,
    feedback: ok ? '' : `Черновик отклонён автопроверкой: он слишком похож на прежние версии (${reasons.join('; ')}). Напиши заново, а не правь этот черновик: другой тип крючка, другая первая фраза, другая композиция и другие зачины абзацев, ни одной цепочки из ${limits.run} слов подряд из прежних текстов.`,
  };
}

/** Что Ксении нельзя повторять и что нужно сделать: текст в задание. */
export function regenBlock(olds, { comment = '' } = {}) {
  const used = [...new Set(olds.map((o) => o.hook_type).filter(Boolean))];
  const labels = [...new Set(olds.flatMap((o) => (o.segments || []).map((s) => String(s).split(/[.:!?]/)[0].trim()).filter((x) => x.split(/\s+/).length <= 3)))].slice(0, 8);
  const list = olds.map((o, i) => `--- ${o.label || 'Версия ' + (i + 1)}${o.hook_type ? ` (тип крючка: ${o.hook_type})` : ''}:\n${(o.segments || []).join('\n')}`).join('\n');
  return `ПЕРЕГЕНЕРАЦИЯ. Ник недоволен прежними версиями этого сценария: правки не помогли, он просит написать сценарий ЗАНОВО. Это не правка: прежние тексты ниже даны только как список того, что ПОВТОРЯТЬ НЕЛЬЗЯ, не опирайся на них и не пересказывай.
Цель: ролик, который цепляет с первой секунды, который хочется досмотреть до конца и переслать. Конкретика вместо общих слов, в начале открытая загадка, которая закрывается только в конце, живая речь на слух.
1. Сначала придумай 3 крючка РАЗНЫХ типов и оцени каждый от 1 до 10 по вопросу «остановит ли он палец за 1,5 секунды». Запиши их в hook_options ([{"type","line","score"}]), выбери сильнейший и запиши его тип в hook_type. Типы: ${hookCatalog()}. Тип выбранного крючка не должен совпадать с прежними (${used.join(', ') || 'прежние не указаны'}).
2. Другая композиция: другой порядок мыслей, другой образ или сравнение, другая последняя фраза${labels.length ? `. Не начинай абзацы с прежних зачинов (${labels.map((x) => '«' + x + '»').join(', ')}) и не строй текст как «Улика первая / вторая / Приговор»: детективный дух канала сохрани, но другими словами` : ''}.
3. Факты. Используй только то, что подтверждено первоисточником (PubMed, Cochrane, ВОЗ, Mayo Clinic), оговорки авторов сохраняй. Можно и нужно искать другие улики, цифры и детали того же источника, которых не было раньше. Нет источника, нет утверждения.
4. Автопроверка отклонит черновик, если он делит с прежними версиями больше ${Math.round(LIMITS.containment * 100)}% оборотов, повторяет ${LIMITS.run} слов подряд, берёт тот же тип крючка или те же зачины абзацев.${comment ? `\nПожелание Ника к новой версии: ${comment}` : ''}
Прежние версии (ПОВТОРЯТЬ НЕЛЬЗЯ):
${list || '(нет сохранённых версий)'}`;
}

/* ---------- история версий ---------- */
const readJ = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
export function loadHistory(hdir) {
  if (!fs.existsSync(hdir)) return [];
  return fs.readdirSync(hdir).filter((f) => /^script_\d+\.json$/.test(f)).sort().map((f, i) => ({ file: f, label: `Версия ${i + 1}`, ...readJ(path.join(hdir, f)) })).filter((x) => Array.isArray(x.segments));
}
/** Кладёт текущий script.json в history/script_NN.json, если он ещё не сохранён. Возвращает число сохранённых версий. */
export function archiveScript(dir) {
  const sj = path.join(dir, 'script.json'), hdir = path.join(dir, 'history');
  const cur = readJ(sj); if (!cur || !Array.isArray(cur.segments)) return loadHistory(hdir).length;
  fs.mkdirSync(hdir, { recursive: true });
  const have = loadHistory(hdir); const key = (x) => JSON.stringify(x.segments);
  if (!have.some((h) => key(h) === key(cur))) fs.writeFileSync(path.join(hdir, `script_${String(have.length + 1).padStart(2, '0')}.json`), JSON.stringify(cur, null, 1), 'utf8');
  return loadHistory(hdir).length;
}

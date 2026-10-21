// Несколько вариантов одного ролика на одну тему (решение Ника 2026-10-21): после утверждения темы и фактов один ролик превращается
// в три РАЗНЫХ по содержанию (хук, подача, концовка) и по формату, которые монтируют три монтажёра параллельно. Чистая логика без сети и моделей.
// Модель данных: каждый вариант это обычная запись ролика (videos) со своим id, поэтому приёмка, правки, название и публикация работают для него как раньше.
// Метка лежит в notes.variant = { group, letter, format, rotation }, group = id базового ролика (вариант A).
import { novelty } from './script_novelty.mjs';
const norm = (t) => String(t == null ? '' : t).toLowerCase().replace(/ё/g, 'е').replace(/[^а-яa-z0-9\s]/gi, ' ').replace(/\s+/g, ' ').trim();

export const LETTERS = ['A', 'B', 'C'];
export const FORMATS = {
  A: { code: 'A', name: 'Лента', short: 'цветные поля на весь экран, гигантские числа и слова, шторки, печать', editor: 'video', spec: 'video/med_detective/DYNAMICS.md' },
  B: { code: 'B', name: 'Один объект', short: 'один предмет-улика превращается из состояния в состояние, камера наезжает, светлый и спокойный', editor: 'video_b', spec: 'video/med_detective/FORMAT_B.md' },
  C: { code: 'C', name: 'Диалог', short: 'утка отвечает голосом, «скептик» возражает текстом на экране, у каждой реплики свой цвет поля', editor: 'video_c', spec: 'video/med_detective/FORMAT_C.md' },
};
export const EDITORS = {
  video: { id: 'video', profile: 'video', name: 'Кирилл Кадров', format: 'A' },
  video_b: { id: 'video_b', profile: 'video_b', name: 'Матвей Склеев', format: 'B' },
  video_c: { id: 'video_c', profile: 'video_c', name: 'Роман Ракурсов', format: 'C' },
};
export const GAP_MIN = 30;                       // интервал между публикациями (решение Ника, подтверждён источниками: порога частоты у Shorts нет)

const parse = (v) => { try { return JSON.parse((v && v.notes) || '{}') || {}; } catch { return {}; } };
export const variantOf = (v) => { const x = parse(v).variant; return x && LETTERS.includes(x.letter) ? { ...x, group: Number(x.group) } : null; };      // group всегда число: из командной строки id приходит строкой
export const formatOf = (v) => { const x = variantOf(v); return x ? x.format : 'A'; };
/** Монтажёр записи: у варианта по формату, у одиночного ролика Кирилл. */
export const editorOf = (v) => EDITORS[(FORMATS[formatOf(v)] || FORMATS.A).editor] || EDITORS.video;

/** Какие форматы брать: env VARIANT_FORMATS=A,B,C (или «A» чтобы выключить варианты). Всегда начинается с A. */
export function enabledFormats(env = process.env.VARIANT_FORMATS) {
  const want = String(env || 'A,B,C').toUpperCase().split(/[\s,;]+/).filter((x) => LETTERS.includes(x));
  return ['A', ...LETTERS.filter((l) => l !== 'A' && want.includes(l))];
}

/** Участники группы: все записи с тем же group (включая базовую A), по буквам. */
export function groupMembers(videos, v) {
  const x = variantOf(v); const g = x ? x.group : v && v.id;
  return (videos || []).filter((o) => { const t = variantOf(o); return o.id === g || (t && t.group === g); })
    .sort((a, b) => LETTERS.indexOf((variantOf(a) || { letter: 'A' }).letter) - LETTERS.indexOf((variantOf(b) || { letter: 'A' }).letter));
}
export const isGroup = (members) => members.length > 1 && members.every((m) => variantOf(m));

/** Порядок выхода меняется от темы к теме (A,B,C → B,C,A → C,A,B), чтобы место в очереди не влияло на сравнение. */
export function publishOrder(rotation = 0, letters = LETTERS) {
  const L = letters.slice(), r = ((Number(rotation) || 0) % L.length + L.length) % L.length;
  return [...L.slice(r), ...L.slice(0, r)];
}
/** Расписание: время первого ролика и интервал; возвращает [{letter, at: Date}]. */
export function publishSchedule(order, start, gapMin = GAP_MIN) {
  const t0 = new Date(start).getTime(); return order.map((letter, i) => ({ letter, at: new Date(t0 + i * gapMin * 60e3) }));
}
export const hhmm = (d) => new Date(d).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' });

/* ---------------- различие вариантов ---------------- */
const lastSegment = (s) => (s.segments || [])[Math.max(0, (s.segments || []).length - 1)] || '';
const stemSet = (t) => new Set(norm(t).split(' ').filter((w) => w.length >= 4).map((w) => w.slice(0, 5)));
const jaccard = (a, b) => { const A = stemSet(a), B = stemSet(b); const u = new Set([...A, ...B]); if (!u.size) return 0; let i = 0; for (const x of A) if (B.has(x)) i++; return i / u.size; };
export const ENDING_MAX = 0.45;                  // концовки (последний абзац до призыва) похожи не больше чем на 45 % слов
export const HOOK_MAX = 0.5;                     // первые фразы

/** Варианты обязаны отличаться хуком (тип и первая фраза), текстом и концовкой: иначе это дубли, а не три ролика (решение Ника 2026-10-21). */
export function compareVariants(items) {
  const problems = [], per = [];
  items.forEach((it, i) => {
    const olds = items.slice(0, i).map((o) => ({ label: `вариант ${o.letter}`, segments: o.segments, hook_type: o.hook_type }));
    if (!olds.length) { per.push({ letter: it.letter, ok: true }); return; }
    const nv = novelty({ segments: it.segments, hook_type: it.hook_type }, olds), mine = [];
    if (!nv.ok) mine.push(...nv.reasons);
    for (const o of items.slice(0, i)) {
      const e = jaccard(lastSegment(it), lastSegment(o)); if (e > ENDING_MAX) mine.push(`концовка совпадает с вариантом ${o.letter} на ${Math.round(e * 100)} % слов (нужно меньше ${ENDING_MAX * 100} %): другая последняя мысль, не пересказ`);
      if (it.hook_type && o.hook_type && norm(it.hook_type) === norm(o.hook_type)) mine.push(`тип крючка «${it.hook_type}» уже у варианта ${o.letter}: возьми другой`);
    }
    per.push({ letter: it.letter, ok: mine.length === 0, reasons: [...new Set(mine)] });
    for (const r of new Set(mine)) problems.push(`${it.letter}: ${r}`);
  });
  return { ok: problems.length === 0, problems, per };
}

/** Новые числа: вариант не вправе добавлять цифры, которых нет в проверенных материалах (факты Веры и сценарий A). Возвращает список лишних. */
export const numbersOf = (t) => (String(t || '').replace(/ё/g, 'е').match(/\d+(?:[.,]\d+)?/g) || []).map((x) => x.replace(',', '.'));
export function unknownNumbers(variantText, ...trustedTexts) {
  const ok = new Set(trustedTexts.flatMap(numbersOf)); return [...new Set(numbersOf(variantText))].filter((n) => !ok.has(n));
}
const WORD_NUM = { один: '1', одна: '1', одно: '1', два: '2', две: '2', три: '3', четыре: '4', пять: '5', шесть: '6', семь: '7', восемь: '8', девять: '9', десять: '10', сто: '100', тысяча: '1000', тысяч: '1000', тысячи: '1000' };
export const numberWordsOf = (t) => (norm(t).split(' ').map((w) => WORD_NUM[w]).filter(Boolean));

/* ---------------- задания Ксении ---------------- */
export const HOOK_BY_FORMAT = {
  B: 'хук строится вокруг ОДНОГО предмета-улики (документ, число, этикетка, упаковка, дата), например «У этой цифры есть дата рождения» (подходят типы «цифра», «сцена», «открытая петля»)',
  C: 'хук строится как спор: сомнение или возражение, с которым зритель соглашается в первую секунду («Мне сказали…, а я не поверил») (подходят типы «вопрос-ловушка», «контраст», «обвинение»)',
};
export const STRUCTURE_BY_FORMAT = {
  B: 'Сюжет это ПУТЬ ОДНОГО ПРЕДМЕТА: каждый абзац показывает его в новом состоянии (папка открывается, из неё достают документ, на документе находят число, число превращается в график, на графике штамп). Пиши так, чтобы в кадре можно было вести камеру от детали к детали без склеек: один и тот же объект, меняющееся состояние.',
  C: 'Сюжет это СПОР с «Скептиком». Озвучивается только утка. Для КАЖДОГО абзаца придумай реплику Скептика (вопрос или возражение, до 9 слов, на русском, без вердикта) в поле «skeptic» (JSON-массив строк): массив из ровно стольких строк, сколько абзацев в segments (без призыва); абзац отвечает на реплику, но реплику Скептика в текст segments НЕ вставляй. Реплика звучит на экране текстом, голос один.',
};
export function variantBrief({ letter, format, baseTitle, baseSegments, baseHookType, others = [] }) {
  const F = FORMATS[format];
  const prior = [{ letter: 'A', segments: baseSegments, hook_type: baseHookType }, ...others].map((o) => `Вариант ${o.letter} (тип крючка «${o.hook_type || '?'}»): ${(o.segments || []).join(' ')}`).join('\n');
  return `ВАРИАНТ ${letter} ТОЙ ЖЕ ТЕМЫ: формат «${F.name}» (${F.short}).
Тема, проверенные факты и источники те же, что у варианта A: бери ТОЛЬКО их (файл FACTS.md и реестр цитат лежат рядом), новых утверждений и новых цифр не добавляй, Вера по ним уже поработала.
Но ролик должен быть ДРУГИМ по содержанию, а не пересказом: другой хук (${HOOK_BY_FORMAT[format] || 'другой тип крючка, чем у остальных вариантов'}), другой порядок подачи фактов, другая концовка (последняя мысль перед призывом не повторяет концовку других вариантов). Три варианта выходят как три самостоятельных ролика на один канал; совпадение фраз и тип крючка проверяет код и вернёт тебе повтор.
${STRUCTURE_BY_FORMAT[format] || ''}
Уже написанные варианты (НЕ повторяй их хуки, формулировки и концовки):
${prior}`;
}

/** Сводка для карточки: что отличается. */
export function summaryRows(items) {
  return items.map((it) => {
    const first = String((it.segments || [])[0] || '').split(/(?<=[.!?…])\s/)[0], last = lastSegment(it).split(/(?<=[.!?…])\s/).slice(-1)[0] || '';
    return { letter: it.letter, format: FORMATS[it.format].name, hook_type: it.hook_type || '', first, last };
  });
}

/** Правка Ника к группе: «B: сделай концовку короче» относится к варианту B; без буквы это вариант A. Кириллические А, В, С в начале считаются латинскими. */
const CYR = { 'А': 'A', 'В': 'B', 'С': 'C' };
export function parseVariantComment(text) {
  const m = /^\s*(?:вариант\w*\s+)?([ABCАВСabc])\s*[:.)—–-]\s*([\s\S]+)$/i.exec(String(text || ''));
  if (!m) return { letter: null, text: String(text || '').trim() };
  const L = (CYR[m[1]] || m[1]).toUpperCase(); return { letter: L, text: m[2].trim() };
}
/** Якорь группы для кнопок карточки: вариант A, пока он жив, иначе первый живой по буквам. */
export function anchorOf(members) {
  const live = (members || []).filter((m) => m.stage === 'checked'); return live.find((m) => (variantOf(m) || { letter: 'A' }).letter === 'A') || live[0] || null;
}
export const isDropped = (v) => !!parse(v).dropped;

/** Название варианта не должно быть похоже на названия соседних вариантов (решение Ника 2026-10-21: разные названия, три отдельных ролика). Возвращает список совпадений. */
export const TITLE_CLASH_MAX = 0.5;
export function titleClash(title, taken = [], max = TITLE_CLASH_MAX) {
  return taken.map((t) => ({ letter: t.letter, title: t.title, share: jaccard(title, t.title) })).filter((x) => x.share > max);
}
export const MIN_AHEAD_MIN = 10;        // YouTube принимает отложенный выход только в будущем: ближе чем через 10 минут публикуем сразу
/** Слот варианта в очереди выхода: позиция в порядке × интервал от старта группы. null, пока группа не стартовала. */
export function slotFor(order, letter, startMs, gapMin = GAP_MIN) {
  const i = order.indexOf(letter); if (i < 0 || !startMs) return null; return new Date(Number(startMs) + i * gapMin * 60e3);
}

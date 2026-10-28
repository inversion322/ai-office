// Пост Telegram: чистые проверки и оформление (без сети и моделей). Правила из ДОКУМЕНТА 1 WorkFlow AI (smm/studio/post_rules.md):
// хук жирным первой строкой, одна мысль, короткие абзацы без списков, последнее предложение абзаца без точки, эмодзи дозированно, CTA-подписка ссылкой, 2-3 первичных источника.
export const MAX_CAPTION = 1024;            // подпись к фото в Telegram
export const SHORT_MAX = 700;               // короткий пост: выходит как «фото + подпись» без ужатия

/** Видимая длина текста: без разметки **жирного** и без URL ссылок [текст](url). */
export const plainText = (t) => String(t || '').replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '$1').replace(/\*\*/g, '').trim();

const AI_TELLS = [/в (современном )?мире, где/i, /важно отметить/i, /стоит отметить/i, /не секрет, что/i, /давайте разберёмся/i, /в наше время/i, /погрузимся/i, /\bво-первых\b[\s\S]*\bво-вторых\b[\s\S]*\bв-третьих\b/i];
const MED_ADVICE = [/принимайте/i, /лечитесь/i, /дозировк/i, /\b\d+\s?(мг|мл|таблет)/i, /вместо врача/i];
const EMOJI = /\p{Extended_Pictographic}/gu;
const linksOf = (t) => [...String(t || '').matchAll(/\]\((https?:\/\/[^)\s]+)\)|(https?:\/\/[^\s)]+)/g)].map((m) => m[1] || m[2]);
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };

/** Последнее предложение каждого абзаца без точки (правило 7); многоточие и другие знаки не трогаем. Код правит сам, это не повод возвращать пост автору. */
export function fixPunctuation(text) {
  const tail = '(\\s*(?:\\p{Extended_Pictographic}\\uFE0F?\\s*)*)$';      // хвост абзаца: пробелы и эмодзи после последнего предложения
  return String(text || '').split(/\n{2,}/).map((p) => p.replace(new RegExp('([^.\\s…*])\\.(\\*\\*)?' + tail, 'u'), (m, a, b, e) => a + (b || '') + e)).join('\n\n');
}

/**
 * Проблемы поста: [{ code, msg }]. Пустой список = правила соблюдены.
 * opts: { handle (канал для CTA), format 'short'|'long', maxLen, medical (канал без лечебных советов) }
 */
export function postIssues(text, opts = {}) {
  const t = String(text || '').trim(), out = [], add = (code, msg) => out.push({ code, msg });
  if (!t) return [{ code: 'empty', msg: 'пустой текст' }];
  const plain = plainText(t), limit = opts.maxLen || (opts.format === 'long' ? 3800 : SHORT_MAX);
  if (plain.length > limit) add('long', `длина ${plain.length} знаков, лимит ${limit}${opts.format === 'long' ? '' : ' (короткий пост выходит подписью к фото, до 1024 с запасом на ссылки)'}`);
  const first = t.split('\n').find((l) => l.trim()) || '';
  if (!/\*\*[^*]+\*\*/.test(first)) add('hook', 'первая строка должна быть хуком, выделенным **жирным**');
  if (/^\s*([-*•▪])\s+\S/m.test(t.replace(/\*\*/g, ''))) add('list', 'маркированные списки запрещены: ключевые мысли отдельными короткими абзацами');
  const paras = t.split(/\n{2,}/).filter((p) => p.trim());
  if (paras.some((p) => (p.match(EMOJI) || []).length > 2)) add('emoji', 'больше двух эмодзи в одном абзаце');
  if (paras.some((p) => plainText(p).length > 520)) add('para', 'абзац длиннее 520 знаков: разбей на короткие (1-3 предложения)');
  if (AI_TELLS.some((r) => r.test(t))) add('ai', 'приметы ИИ-текста («в мире, где…», «важно отметить», «давайте разберёмся»…)');
  if (opts.handle && !new RegExp(`https://t\\.me/${opts.handle}\\b`, 'i').test(t)) add('cta', `нет кликабельного CTA-подписки на https://t.me/${opts.handle}`);
  const src = paras.find((p) => /^\s*🔬/.test(p));
  if (src) { const hosts = new Set(linksOf(src).map(hostOf).filter(Boolean)); if (hosts.size < 2) add('sources', 'в строке «🔬 Источники» нужно 2-3 первичных источника из разных доменов (или не писать строку вовсе)'); }
  if (opts.medical && MED_ADVICE.some((r) => r.test(t))) add('medical', 'лечебные советы и дозировки в канале запрещены');
  return out;
}

/** Markdown-подобный текст автора → HTML Telegram (разрешены <b>, <a>). Всё остальное экранируется. */
export function toTgHtml(text) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return esc(String(text || '')).replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (m, a, u) => `<a href="${u.replace(/"/g, '&quot;')}">${a}</a>`).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
}

/** Как выйдет в канале: короткий (подпись помещается в 1024) = фото с подписью; длиннее = обложка отдельным сообщением выше текста, пост целиком в соседнем. */
export function publishShape(text, hasCover) {
  const html = toTgHtml(text);
  if (!hasCover) return { mode: 'text', html };
  return html.length <= MAX_CAPTION ? { mode: 'photo', html } : { mode: 'photo_then_text', html };
}

/**
 * Стили обложки и их английские клаузы. Перенесены из WorkFlow AI (src/workflow_ai/services/images/prompts.py), где обложки получались лучше:
 * там стиль выбирает арт-директор по теме, по умолчанию фотореализм, а клауза стиля и «хвост качества» всегда стоят в запросе.
 * (До 2026-10-28 здесь стояло «Editorial cover illustration»: любая обложка шла как иллюстрация, а детективный мотив канала рисовался мультяшкой.)
 */
export const COVER_STYLES = {
  photo: 'Professional photograph, photo-realistic rendering, sharp focus, editorial lighting, natural colors, high detail',
  illustration: 'Modern digital illustration, clean linework, vibrant palette, editorial style, flat shapes with subtle shading',
  infographic: 'Clean infographic design, data-visualization aesthetic, minimal layout, soft pastel gradients, balanced negative space, legible labels',
  cartoon: 'Friendly cartoon illustration, soft cel-shading, rounded forms, warm colors, playful and approachable',
  minimalist: 'Minimalist geometric composition, flat colors, generous negative space, muted pastel palette, simple shapes, calm and refined',
  poster: 'Dramatic cinematic poster, bold composition, atmospheric lighting, strong color grading, magazine-cover style, sense of scale',
};
export const COVER_STYLE_DEFAULT = 'photo';
export const normalizeCoverStyle = (s) => { const k = String(s || '').toLowerCase().trim(); return Object.prototype.hasOwnProperty.call(COVER_STYLES, k) ? k : COVER_STYLE_DEFAULT; };

/** Запрос обложки для fal.ai (Nano Banana Pro читает кириллицу). Без лиц реальных людей, без текста, если он не нужен. */
export function coverPrompt(brief = {}, { palette = '', styleClause = '', edits = [] } = {}) {
  const style = normalizeCoverStyle(brief.style);
  const scene = String(brief.scene || '').trim(), mood = String(brief.mood || '').trim();
  const text = String(brief.text_on_image || '').trim().slice(0, 40);
  const wishes = (Array.isArray(edits) ? edits : []).map((e) => String(e || '').trim()).filter(Boolean).slice(-5);
  const parts = [
    scene ? (/[.!?]$/.test(scene) ? scene : scene + '.') : 'A calm, concrete real-world still life that illustrates the post topic.',
    mood ? `Mood: ${mood}.` : '', `Style: ${COVER_STYLES[style]}.`,
    palette ? `Palette: ${palette}.` : '',
    styleClause ? `Match the channel's established cover identity: ${styleClause} Keep visual consistency with this identity.` : '',
    text ? `Render exactly this short Russian text, large and perfectly legible, nothing else written: «${text}».` : 'Do not write any text, letters or numbers on the image.',
    wishes.length ? `Art director's corrections from the channel owner, apply them strictly (they override the scene above where they conflict): ${wishes.join(' | ')}.` : '',
    'No real people faces, no logos, no watermarks, no medical before/after, no shocking imagery.',
    'Square 1:1 composition, the key subject centered with safe margins. High quality, no artifacts.',
  ];
  return parts.filter(Boolean).join(' ');
}

/** Всё, что нужно показать Нику в превью: проверяем форму перед карточкой. */
export function previewSummary(text, opts = {}) {
  const issues = postIssues(text, opts), shape = publishShape(text, true);
  return { issues, shape: shape.mode, plainLen: plainText(text).length };
}

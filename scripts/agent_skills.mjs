// Скиллы сотрудников SMM (решение Ника 2026-10-20: «наделить остальных сотрудников скиллами, чтобы итоговое качество видео было выше»).
// Принцип тот же, что у Кирилла: обязательные скиллы названы в задаче, открытие проверяется по логу сессии (skill_usage.mjs), а не верится на слово.
// Что намеренно НЕ подключено: youtube-content (нужен пакет youtube_transcript_api, его на ПК нет, а ставить пакеты без согласия Ника нельзя;
// польза для Виктора и Льва небольшая), платные видеогенераторы и MCP (content-engine: нужны USDC и ключи).
import path from 'node:path';
import os from 'node:os';

const HOME = () => path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'hermes');
const fwd = (p) => String(p).replaceAll('\\', '/');
export const SOURCES_PY = (profile = 'smm') => fwd(path.join(HOME(), 'profiles', profile, 'skills', 'research', 'grounded-citations', 'scripts', 'sources.py'));

/** required: skill_view обязателен (проверяется по логу). hint: полезно, но условно (страница не открылась), по логу не проверяется. */
export const AGENT_SKILLS = {
  scriptwriter: { required: ['short-video-script-craft', 'humanizer'], hint: ['blocked-page-recovery'] },
  factcheck: { required: ['grounded-citations'], hint: ['blocked-page-recovery'] },
  research: { required: [], hint: ['blocked-page-recovery'] },
  virality: { required: [], hint: ['blocked-page-recovery'] },
  packager: { required: [], hint: [] },
};
export const requiredFor = (agentId) => (AGENT_SKILLS[agentId] && AGENT_SKILLS[agentId].required) || [];

const BLOCKED = (n) => `${n}. Если нужная страница не открывается (403/429, платный доступ, защита от ботов), сделай skill_view('blocked-page-recovery') и действуй по нему, а не пропускай источник.`;
const HEAD = '## СКИЛЛЫ ПРЕЖДЕ ВСЕГО (решение Ника 2026-10-20; открытие проверяется по логу твоей сессии)';

/** Ledger Веры лежит рядом со сценарием: <dir>/ledger.json */
export const ledgerPath = (dir) => fwd(path.join(dir, 'ledger.json'));

export function skillsBlock(agentId, { dir = '.' } = {}) {
  if (agentId === 'scriptwriter') return `${HEAD}
1. Первым делом skill_view('short-video-script-craft'): цепочка «но/поэтому», дуга эмоции, семейства хука, три задачи концовки, образец. Хук бери из семейства, которого ещё не было в прежних сценариях этой темы (смотри history/), и строй текст звеньями, а не списком фактов.
2. Когда черновик готов, сделай ОДИН проход по русскому тексту озвучки: skill_view('humanizer'). Применяй только пункты про штампы и воду: 1, 4, 5, 7 (канцелярит, рекламные и «умные» слова, «эксперты считают»), 20–25 и 27–28 (вода, оговорки, общие бодрые концовки, «на самом деле главное», анонсы), 30 (натянутые метафоры), 33–34 (слова-паразиты в начале фразы, успокаивающие концовки). НЕ применяй 31 и 32: короткие фразы и вопрос-ответ нужны хуку. Не трогай числа, названия исследований, связки «но/поэтому», строки, которые Ник продиктовал дословно, и лимит слов. Если после прохода цепочка или хук ослабли, верни прежний вариант.
${BLOCKED(3)}
Скиллы английские, а текст русский: принципы переноси на русскую живую речь, не переводи штампы буквально.`;
  if (agentId === 'factcheck') {
    const S = SOURCES_PY(), L = ledgerPath(dir), D = fwd(dir);
    return `${HEAD}
1. Первым делом skill_view('grounded-citations'). Реестр источников этого сценария: ${L}. Команды: python "${S}" --ledger "${L}" reset (один раз в начале); python "${S}" --ledger "${L}" add <url> --title "<кратко>" (печатает id); python "${S}" --ledger "${L}" quote <id> --text "<дословная фраза со страницы, до 200 знаков>" --from <файл с текстом страницы>.
2. Текст страницы бери в файл, а не из памяти. Для PubMed: curl -sL "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id=<PMID>&rettype=abstract&retmode=text" -o ${D}/src_<N>.txt (чистый текст аннотации). Для остальных страниц: web_extract, текст сохрани в ${D}/src_<N>.txt. Команда quote ОТКЛОНИТ пересказ: фразу копируй из файла. Цитата на языке источника, переводить её не нужно.
3. В check.json у КАЖДОГО утверждения claims, которое ты признаёшь верным или упрощённым, заполни: "source" = url из реестра, "ledger_id" = id, "quote_found" = ровно ту цитату, которую принял quote. Утверждения со статусом «не подтверждено» или «отклонить» могут быть без цитаты. Код сверит quote_found с реестром; цитата, которой там нет, вернёт тебе проверку на доработку.
4. В конце: python "${S}" --ledger "${L}" render --style evidence > ${D}/evidence.md.
${BLOCKED(5)}`;
  }
  if (agentId === 'research' || agentId === 'virality') return `${HEAD}\n1. Если нужная страница не открывается (403/429, платный доступ, защита от ботов), сделай skill_view('blocked-page-recovery') и действуй по нему, а не пропускай источник.`;
  return '';
}

/** Замечание при повторном запуске, если нужные скиллы не открыты. */
export const retryNote = (missing) => `ПОВТОР: в прошлой попытке ты не открыл обязательные скиллы: ${missing.join(', ')}. Начни с skill_view для каждого из них и работай по ним; без этого результат не принимается.`;

const norm = (s) => String(s || '').toLowerCase().replace(/[*_`]/g, '').replace(/\s+/g, ' ').trim();
/** Цитаты реестра: ledger = JSON из sources.py ({sources:[{id,url,quotes:[{text}]}]}) или null. */
export function ledgerQuotes(ledger) {
  const out = [];
  for (const s of (ledger && Array.isArray(ledger.sources) ? ledger.sources : [])) for (const q of s.quotes || []) out.push({ id: s.id, url: s.url, text: norm(q.text) });
  return out;
}
const NEEDS_QUOTE = /^(верно|упрощено)/i;
/** Проверка Веры: каждое признанное верным утверждение подкреплено цитатой, которую принял реестр. Возвращает { ok, issues[] }. */
export function evidenceIssues(check, ledger) {
  const issues = [], claims = (check && Array.isArray(check.claims)) ? check.claims : [];
  if (!claims.length) return { ok: true, issues };
  const qs = ledgerQuotes(ledger);
  if (!ledger || !Array.isArray(ledger.sources) || !ledger.sources.length) return { ok: false, issues: ['реестр источников пуст или не создан (python sources.py --ledger … reset / add / quote), ни одна цитата не подкреплена'] };
  for (const c of claims) {
    if (!NEEDS_QUOTE.test(String(c.status || '').trim())) continue;
    const q = norm(c.quote_found), label = String(c.text || '').slice(0, 70);
    if (q.length < 12) { issues.push(`«${label}»: нет дословной цитаты в quote_found`); continue; }
    if (!qs.some((x) => x.text.includes(q) || q.includes(x.text))) issues.push(`«${label}»: цитаты нет в реестре (её не принимала команда quote, это пересказ)`);
  }
  return { ok: issues.length === 0, issues };
}
export const evidenceFeedback = (issues) => `Проверка Веры не принята: утверждения без цитат из реестра grounded-citations. ${issues.join('; ')}. Для каждого признанного верным утверждения добавь в реестр дословную цитату командой quote (текст страницы бери из файла, не по памяти) и впиши ровно её в quote_found, затем перезапиши check.json. Реестр НЕ сбрасывай (reset не вызывай): дополни тот, что уже есть.`;

// Конвейер Nick G SMM.   node scripts/smm_pipeline.mjs topics [--hint "пожелание"]
//                         node scripts/smm_pipeline.mjs card <id>   (обновить карточку сценария без запросов к моделям)
//                         node scripts/smm_pipeline.mjs script <id> [--comment "правки"] [--regen] [--finish]   (--regen: написать заново, не правя прежний; --finish: довести текущий текст до длины и проверки Веры; если в video_N есть PREAPPROVED и Вера пропустила, сценарий сразу уходит в монтаж)
//                         node scripts/smm_pipeline.mjs produce <id> [--comment "правки"]
// topics: Виктор ищет кандидатов -> Лев оценивает -> бот присылает Нику темы кнопками (точка участия №1).
// script: Ксения пишет сценарий -> Вера проверяет факты (не больше двух проверок за этап) -> бот присылает Нику на утверждение (точка №2).
// produce: Кирилл Кадров (профиль video, Opus 5.5, высокие усилия) озвучивает и монтирует -> бот присылает ролик (точка №3).
// Публикует всегда только Ник. Состояние видно на дашборде (вкладка Nick G SMM).
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, api, agent, scene, promptOf, videos, getVideo, setVideo, runAgent, readJson, notify, sendVideoFile, topicsMessage, say, yieldToPriority, setPriority, hermesSpawn } from './smm_lib.mjs';

const stamp = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
const safeNotify = async (text, buttons) => { try { return await notify(text, buttons); } catch (e) { console.error('УВЕДОМЛЕНИЕ НЕ ДОСТАВЛЕНО:', e.message); fs.appendFileSync(path.join(ROOT, 'smm', 'undelivered.txt'), `\n--- ${new Date().toISOString()}\n${text}\n`); } };
const CTA = loadCta();   // призыв подписаться: один текст для всех роликов (video/cta.json), логика в cta_text.mjs
const CTA_WORDS = CTA.voice_ru.split(/\s+/).length, CTA_SEC = CTA.voice_sec || 8;
const MAX_SPEECH = 53, MAX_WORDS = 100;      // озвучка до 53 с ВМЕСТЕ с призывом (rate +25%), сценарий без призыва до 100 слов, итоговый ролик строго до 59 с
// Призыв добавляется последним абзацем (идемпотентно): и в сценарий, и перед монтажом, чтобы старые сценарии без него тоже получили его
const withCta = (segments) => withCtaText(segments, CTA);
const ensureCtaFile = (file) => ensureCtaFileText(file, CTA);
import { loadCta, withCta as withCtaText, ensureCtaFile as ensureCtaFileText } from './cta_text.mjs';
import { speechSeconds as measureSpeech, lengthVerdict, cutAdvice } from './smm_tts.mjs';
import { cleanReport } from '../server/lib_text.mjs';
import { checkTitle, checkTags, buildMessage, titleTagsFrom, composeTitle, BRAND_TAG } from '../server/lib_pack.mjs';
import { gate, markFormat, projectFormat } from './video_gate.mjs';
import { novelty, regenBlock, archiveScript, loadHistory, hookCatalog, LIMITS } from './script_novelty.mjs';
import { watchVideoProgress } from './video_progress.mjs';
import { renderRules } from './render_rules.mjs';
import { editorOf, formatOf, variantOf, groupMembers, enabledFormats, titleClash, FORMATS } from './variants.mjs';
import { makeFlow } from './variants_flow.mjs';
import { formatSection } from './format_spec.mjs';
import { roundsInfo, roundsNote } from './render_slot.mjs';
import { styleIssues, styleFeedback, bridgeIssues, verdictIssues, cleanFillerOpeners } from './script_style.mjs';
import { craftIssues, craftFeedback, craftSummary } from './script_craft.mjs';
import { evidenceIssues, evidenceFeedback, ledgerPath } from './agent_skills.mjs';
import { skillUsageNote } from './skill_usage.mjs';
import { fireReminders } from './reminders.mjs';
import { publishYouTube, publishCard, loadPublishMeta, queueInfo, queueText } from './publisher.mjs';
import { ytStatus } from './youtube.mjs';
const speechSeconds = async (segments) => { await yieldToPriority('scriptwriter'); return measureSpeech(segments, { root: ROOT }); };   // { sec, estimated, perSeg }
// Поток «варианты одной темы» (variants_flow.mjs): три сценария разных форматов, одна карточка, три монтажёра параллельно
const flow = makeFlow({ ROOT, api, videos, getVideo, setVideo, runAgent, promptOf, agent, say, scene, safeNotify, speechSeconds, withCta, MAX_SPEECH, MAX_WORDS, ledgerPath });
const HOOK_NAMES = hookCatalog().replace(/ \([^)]*\)/g, '');       // только названия типов крючка, без пояснений
const NOTE = (v) => { try { return JSON.parse(v.notes || '{}'); } catch { return {}; } };

/* ---------------- 1. Темы ---------------- */
async function topics(hint) {
  const dir = path.join(ROOT, 'smm', 'runs', `${stamp()}_topics`);
  const cand = path.join(dir, 'candidates.json'), scored = path.join(dir, 'scored.json');
  const already = ['Сахар делает детей гиперактивными? (ролик №1, готов)', ...(await videos()).map((v) => v.title)].join('; ');

  await agent('captain_smm', 'working', 'Запускаю поиск тем', 10, 'Запустил цикл: поиск тем и оценка виральности');
  await scene('captain_smm', 'research', 'Найди 8 массовых мифов о здоровье на следующий ролик. Нужны данные и первоисточники.');
  await agent('research', 'working', 'Ищу темы: запросы людей, ролики конкурентов, первоисточники', 20, 'Начал разведку тем');
  const t1 = await runAgent({
    label: 'research', outFile: cand, persona: await promptOf('research'),
    task: `Найди 8 кандидатов на тему следующего ролика канала «Медицинский детектив» (русскоязычная аудитория). Рубрика «Миф»: популярное заблуждение о здоровье, которое можно разоблачить по первоисточникам. Цель: максимально широкий охват, массовые заблуждения, не узкая ниша.
Уже снято или есть в работе или уже предлагалось, не повторять: ${already}.${hint ? `\nПожелание Ника: ${hint}` : ''}
С помощью веб-поиска и чтения страниц:
1) Найди, что реально спрашивают и обсуждают люди («правда ли что…», «миф ли», вопросы на форумах и в Q&A, обсуждения под роликами).
2) Посмотри популярные русскоязычные ролики и каналы про мифы о здоровье (YouTube, Telegram): какие темы собирают просмотры, о чём спорят в комментариях, что уже разобрано и что осталось.
3) Для каждого кандидата найди сильный первоисточник (PubMed, Cochrane, ВОЗ, Mayo Clinic) и проверь, что ответ однозначный; без источника тему не включай.
Формат файла: JSON-массив из 8 объектов: {"title": "миф вопросом", "rubric": "myth", "why_massive": "почему массовый + данные", "evidence": [{"source": "…", "url": "…", "pmid": "…", "finding": "что установлено"}], "clear_answer": true/false, "detective_angle": "происхождение мифа или поворот", "competitors": "что уже сняли конкуренты, просмотры если видно", "risks": "медицинские и юридические риски", "links": ["…откуда данные про популярность"]}.`,
  });
  const cands = readJson(cand);
  if (!Array.isArray(cands) || !cands.length) {
    await agent('research', 'error', 'Не удалось собрать темы', 0, `Поиск тем не дал результата (код ${t1.code}), см. ${dir}`, 'error');
    await agent('captain_smm', 'waiting', 'Цикл остановлен: нет тем', 0, 'Цикл тем остановлен', 'error');
    await safeNotify('⚠️ Поиск тем не дал результата. Подробности: ' + dir);
    throw new Error('нет candidates.json, смотри ' + dir);
  }
  await agent('research', 'idle', 'Темы переданы Льву на оценку', 100, `Нашёл ${cands.length} кандидатов`);
  await say('research', `Нашёл ${cands.length} кандидатов с первоисточниками, передал Льву на оценку.`);
  await scene('research', 'virality', `Лев, вот ${cands.length} кандидатов. Оцени виральность по рубрике.`, 'chat');
  await agent('virality', 'working', 'Оцениваю виральность тем', 20, 'Начал оценку тем');
  const t2 = await runAgent({
    label: 'virality', outFile: scored, persona: await promptOf('virality'), maxTurns: 60, budgetSec: 1200,
    task: `Оцени кандидатов из файла ${cand} (читай его). Для каждого: сначала ворота (первоисточник с однозначным ответом; нет рекомендаций лечения и дозировок; не про бренд или рецептурный препарат), затем баллы по рубрике из твоего промпта (охват 25, насущность 15, распространённость 15, доказательства 15, ниша 15, сюжет 10, скорость 5), итог 0-100. Проверь данные веб-поиском там, где можешь; где данных нет, пиши «нет данных» и снижай уверенность, не выдумывай.
Формат файла: JSON-массив, отсортированный по total по убыванию: {"title","rubric","gates_passed":true/false,"scores":{"reach","urgency","prevalence","evidence","niche","plot","speed"},"total","confidence":"low|medium|high","data_sources":["…"],"main_risk","recommendation":"снимать|отложить|отклонить","reason":"1-2 предложения"}.`,
  });
  const res = readJson(scored);
  if (!Array.isArray(res) || !res.length) {
    await agent('virality', 'error', 'Не удалось оценить темы', 0, `Оценка не удалась (код ${t2.code}), см. ${dir}`, 'error');
    await safeNotify('⚠️ Оценка тем не удалась. Подробности: ' + dir);
    throw new Error('нет scored.json, смотри ' + dir);
  }
  const byTitle = new Map(cands.map((c) => [c.title, c]));
  const made = [];
  for (const r of res) {
    const c = byTitle.get(r.title) || {};
    const notes = JSON.stringify({ gates: r.gates_passed, scores: r.scores, confidence: r.confidence, reason: r.reason, risk: r.main_risk, recommendation: r.recommendation, sources: r.data_sources, evidence: c.evidence, why_massive: c.why_massive, angle: c.detective_angle, competitors: c.competitors });
    const rejected = r.recommendation === 'отклонить' || r.gates_passed === false;
    const { id } = await api('/api/video', { title: r.title, rubric: r.rubric || c.rubric || 'myth', stage: rejected ? 'rejected' : 'scored', score: r.total, notes });
    made.push({ id, ...r, rejected });
  }
  await agent('virality', 'idle', 'Оценка готова, ход за Ником', 100, `Оценил ${res.length} тем`);
  await say('virality', `Оценил ${res.length} тем. Лучшая: «${res[0].title}» (${res[0].total}). Балл это гипотеза, не прогноз; список у Капитана в «Требуют ответа».`);
  await agent('captain_smm', 'waiting', 'Ждёт, какую тему выберет Ник', 0, `Темы оценены (${res.length}), нужен выбор Ника`);
  await scene('virality', 'captain_smm', 'Темы оценены, пусть Ник выберет.', 'chat');
  fs.writeFileSync(path.join(dir, 'summary.md'), res.map((r, i) => `${i + 1}. [${r.total}] ${r.title} (${r.recommendation}; ${r.confidence}) ${r.reason || ''}`).join('\n'), 'utf8');

  const tm = topicsMessage(await videos());
  if (tm) await safeNotify(tm.text, tm.buttons);
  console.log('ok:', made.map((m) => `#${m.id} [${m.total}] ${m.title}`).join('\n'));
}

/* ---------------- 2. Сценарий + проверка фактов ---------------- */
/** Карточка сценария для Ника (текст и кнопки). Общая для этапа script и для «обновить карточку» (card): одна сборка, чтобы они не расходились.
 *  x: { id, v, prev, check, ok, text, lengthFail, lengthWarnEst, veraRuns, regen, history, nv, nvWarn, craftWarn, skillState, quoteCount, evWarn, MAXR, note } */
function scriptCard(x) {
  const { id, v, prev, check, ok, text, lengthFail = false, lengthWarnEst = null, veraRuns = 1, regen = false, history = [], nv = null, nvWarn = false, craftWarn = null, skillState = {}, quoteCount = 0, evWarn = null, MAXR = 5, note = '' } = x;
  const lastDur = lengthFail ? (/(\d+(?:\.\d+)?) с/.exec(String(check.summary)) || [])[1] : null;
  const verdictLine = ok ? `✅ Вера проверила факты: ${check.summary || 'всё подтверждено'}`
    : lengthFail ? `⚠️ Текст длиннее лимита${lastDur ? ` (${lastDur} с при ${MAX_SPEECH} с)` : ''}, и Вера последнюю версию не проверяла: правки по фактам удлинили ролик. «Утвердить после проверки»: Ксения сократит, Вера проверит, и если пропустит, сразу запускаю монтаж. Ничего нажимать больше не придётся.`
    : `⚠️ Вера НЕ пропустила (проверок Веры: ${veraRuns}): ${(check.required_changes || []).join('; ')}\n«Утвердить после проверки»: Ксения учтёт замечания, Вера проверит заново, и если пропустит, сразу запускаю монтаж.`;
  const sources = (prev.sources_card || []).map((s) => '• ' + s).join('\n');
  const hookLine = prev.hook_type ? `\nКрючок: «${String(prev.segments[0]).split(/(?<=[.!?…])\s/)[0]}» (тип: ${prev.hook_type})` : '';
  const regenLine = regen && history.length ? `\n${nvWarn ? '⚠️' : '🔄'} Перегенерация, написано заново (прежних версий: ${history.length}). ${nv ? (nvWarn ? 'Совпадение с прежними выше порога: ' + nv.reasons.join('; ') + '. Можно нажать «Перегенерировать» ещё раз.' : `Совпадение с прежними ${Math.round(nv.worst.containment * 100)}%, порог ${Math.round(LIMITS.containment * 100)}%.`) : ''}` : '';
  const craftLine = (lengthWarnEst ? `\n⚠️ ${lengthWarnEst}.` : '') + (craftSummary(prev) ? `\n${craftSummary(prev)}` : '') + (craftWarn ? `\n⚠️ Драматургию автопроверка не приняла за ${MAXR} кругов: ${craftWarn.join('; ')}. Можно нажать «Нужны правки» или «Перегенерировать».` : '');
  const WHO_RU = { scriptwriter: 'Ксения', factcheck: 'Вера' }, REQ_RU = { scriptwriter: 'short-video-script-craft, storytelling, storytelling-hooks, humanizer', factcheck: 'grounded-citations' };
  const skMiss = Object.entries(skillState).filter(([, m]) => m && m.length).map(([a, m]) => `${WHO_RU[a]} не открыла скиллы: ${m.join(', ')}`);
  const skOk = Object.keys(skillState).filter((a) => !skillState[a].length).map((a) => `${WHO_RU[a]} (${REQ_RU[a]})`);
  const skillLine = (skMiss.length ? `\n⚠️ ${skMiss.join('; ')}, даже после повтора: этот текст проверьте внимательнее.` : '') + (skOk.length ? `\n📚 Скиллы открыты: ${skOk.join('; ')}${quoteCount && skillState.factcheck && !skillState.factcheck.length ? `; цитат в реестре источников: ${quoteCount}` : ''}.` : '') + (evWarn ? `\n⚠️ У Веры не у всех фактов цитата из реестра: ${evWarn.slice(0, 3).join('; ')}.` : '');
  return {
    text: `📝 Сценарий: «${prev.title || v.title}»${note ? `\n${note}` : ''}${regenLine}${hookLine}${craftLine}${skillLine}\n\n${text}\n${verdictLine}\n\nИсточники:\n${sources}\n\nФайлы: smm/runs/video_${id}/ (script_ru.txt, FACTS.md)`,
    buttons: ok ? [[['Утвердить сценарий', `approve:${id}`], ['Нужны правки', `revise:${id}`]], [['🔄 Перегенерировать', `regen:${id}`], ['Отклонить тему', `reject:${id}`]]]
       : [[['Утвердить после проверки', `approve:${id}`], ['Нужны правки', `revise:${id}`]], [['🔄 Перегенерировать', `regen:${id}`], ['Отклонить тему', `reject:${id}`]]],
  };
}

/** Обновить карточку сценария БЕЗ новых запросов к моделям: тот же сценарий и тот же вердикт Веры, но с актуальным текстом (убраны вводные слова), актуальной подписью скиллов и живыми кнопками.
 *  Старая открытая карточка закрывается сервером сама («superseded»: те же кнопки). Только для сценария, который Вера уже пропустила. */
async function recard(id) {
  const v = await getVideo(id); if (!v) throw new Error('нет ролика #' + id);
  if (v.stage !== 'checked') throw new Error(`ролик на этапе «${v.stage}»: карточка сценария нужна только пока он ждёт утверждения`);
  const dir = path.join(ROOT, 'smm', 'runs', `video_${id}`), sj = path.join(dir, 'script.json'), cj = path.join(dir, 'check.json');
  const prev = readJson(sj), check = readJson(cj);
  if (!prev || !Array.isArray(prev.segments)) throw new Error('нет script.json');
  if (!check || check.verdict !== 'pass') throw new Error('Вера этот сценарий не пропускала: карточку обновлять рано, нужен обычный этап script');
  const cut = cleanFillerOpeners(prev);                                        // идемпотентно: если уже чисто, ничего не меняет
  if (cut.length) fs.writeFileSync(sj, JSON.stringify(prev, null, 1), 'utf8');
  const text = withCta(prev.segments).join('\n\n') + '\n';
  fs.writeFileSync(path.join(dir, 'script_ru.txt'), text, 'utf8');
  const latest = (re) => fs.readdirSync(dir).filter((f) => re.test(f)).map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs })).sort((a, b) => b.t - a.t)[0];
  const skillState = {}; for (const [agent, re] of [['scriptwriter', /^_skills_script.*\.json$/], ['factcheck', /^_skills_check.*\.json$/]]) { const f = latest(re), j = f && readJson(path.join(dir, f.f)); if (j && j.checked) skillState[agent] = j.missing || []; }
  const ledger = readJson(ledgerPath(dir)), quoteCount = ((ledger && ledger.sources) || []).reduce((s, x) => s + (x.quotes || []).length, 0);
  const ev = process.env.EVIDENCE_GATE === 'off' ? { ok: true } : evidenceIssues(check, ledger);
  const note = cut.length ? `🔁 Карточка обновлена: убраны вводные слова в начале фраз («${[...new Set(cut.map((c) => c.word))].join('», «')}»). Факты и числа те же, Вера уже проверила их.` : '🔁 Карточка обновлена: текст прежний, вердикт Веры прежний.';
  const card = scriptCard({ id, v, prev, check, ok: true, text, skillState, quoteCount, evWarn: ev.ok ? null : ev.issues, note });
  const cardId = await safeNotify(card.text, card.buttons);
  console.log(cut.length ? 'убраны вводные слова: ' + cut.map((c) => `абз.${c.seg}`).join(', ') : 'текст без изменений', '| карточка', cardId);
}

async function script(id, comment, regen = false, finish = false) {
  const v = await getVideo(id); if (!v) throw new Error('нет ролика #' + id);
  const n = NOTE(v);
  const dir = path.join(ROOT, 'smm', 'runs', `video_${id}`); fs.mkdirSync(dir, { recursive: true });
  const sj = path.join(dir, 'script.json'), cj = path.join(dir, 'check.json');
  // Каждая прежняя версия сохраняется в history/: по ней видно, что уже было, и с ней сравнивается перегенерация.
  const savedBefore = archiveScript(dir);
  const history = loadHistory(path.join(dir, 'history'));
  const PRE = path.join(dir, 'PREAPPROVED');                      // Ник уже сказал «утверждаю»: как только Вера пропустит, сразу монтаж, без нового вопроса
  let skipWrite = finish && !!readJson(sj);                       // «довести до конца»: текущий текст не переписывается вслепую, сначала замер длины и проверка
  let fresh = regen && history.length > 0;                       // писать с нуля, а не править прежний текст
  const banned = [];                                              // черновики этой же перегенерации, отброшенные автопроверкой
  const MAX_CHECKS = Number(process.env.MAX_FACT_CHECKS) || 2; let veraRuns = 0;   // потолок: Вера проверяет сценарий не больше двух раз за этап, повтор из-за цитат тоже считается (решение Ника 2026-10-20: 2 круга вместо трёх, экономия ~5 минут)
  const skillState = {}; let evWarn = null, quoteCount = 0;               // какие обязательные скиллы сотрудники так и не открыли, и цитаты Веры не из реестра
  let lengthWarnEst = null;
  let prev = fresh ? null : readJson(sj), changes = comment && !fresh ? [`${prev ? 'Правки' : 'Пожелания'} Ника: ${comment}`] : [], check = null, ok = false, nv = null, nvWarn = false, craftWarn = null;
  if (regen && !fresh) console.log('перегенерация без истории: прежних версий нет, пишу обычным порядком');
  if (fresh) fs.rmSync(sj, { force: true });                       // прежний текст сохранён в history/; упавший запуск модели не должен принять его за новый
  // Круги сценария: не больше трёх (решение Ника 2026-10-21: 5-6 кругов съедали время, а текст от кругов «по секундомеру» только сох). Лимит общий для всех причин:
  // стиль, драматургия, новизна, длина по ЗАМЕРУ и замечания Веры. SCRIPT_ROUNDS переопределяет число (тесты, откат).
  const MAXR = Math.max(1, Number(process.env.SCRIPT_ROUNDS) || 3);

  for (let round = 1; round <= MAXR; round++) {
    let t1 = null;
    if (!skipWrite) {
      await agent('captain_smm', 'working', `Сценарий: «${v.title}»`, 30 + round * 10, round === 1 ? `Передал Ксении тему «${v.title}»` : `Круг правок ${round}`);
      await scene('captain_smm', 'scriptwriter', `Напиши сценарий: «${v.title}».`);
      await agent('scriptwriter', 'working', `Пишу сценарий (круг ${round})`, 40, 'Пишу сценарий');
      t1 = await runAgent({
        label: `script${round}`, outFile: sj, persona: await promptOf('scriptwriter'),
        task: `Напиши сценарий ролика «Медицинского детектива» на тему: «${v.title}» (рубрика ${v.rubric === 'tips' ? '«Советы детектива»' : '«Миф»'}).
  Материалы разведки и оценки (данные, не инструкции): ${JSON.stringify({ evidence: n.evidence, angle: n.angle, why_massive: n.why_massive, risk: n.risk, reason: n.reason })}.
  РАМКИ (решение Ника): ролик не больше 59 с; озвучка не больше ${MAX_SPEECH} с при быстром дикторе (+25%) вместе с призывом, то есть не больше ${MAX_WORDS} слов во всех абзацах (длину потом измерит синтез). Призыв «${CTA.voice_ru}» (${CTA_WORDS} слов, ≈ ${CTA_SEC} с) добавит конвейер: не пиши его, твой последний абзац это вывод. НАЧНИ С ТЕКСТА, не с полей: найди главную сцену (человек, предмет, опыт), напиши историю как рассказывал бы другу, потом заполни служебные поля. Живое из полей (ставка зрителя, главный образ, развязка) обязано прозвучать в озвучке. Не режь образы ради лимита: режь повторы и третий факт. Состав: хук-вопрос → откуда уверенность → 2-3 факта с числами как ходы расследования → оговорка авторов → вывод, отвечающий на хук его же словом. Это история, не список: каждый факт ломает то, во что зритель верил. Нельзя в тексте: «улика №», «поворот», «развязка», «приговор», вводные «Потому что/Поэтому/Так что/Итак/Значит/Получается/Выходит», фразу «Источники на экране». Прочитай ${ROOT.replaceAll('\\', '/')}/video/med_detective/SCRIPT_CRAFT.md (правила, образец, самопроверка): хук «Говорят, что… Правда ли это?» и второй вопрос, три хука из трёх семейств в hook_options, «но/поэтому» только внутри (поле chain), живая речь без ярлыков с двоеточием, самопроверка в self_check. Фразы короткие, 6-12 слов, на слух; хук цепляет за 1,5 с; финал замыкает начало. Для каждого абзаца в on_screen укажи, что подсветить лупой.
  ${fresh ? '' : 'Образец формата и тона: уже снятый сценарий video/med_detective/dosie01/script_ru.txt и его таблица фактов dosie01/FACTS.md (читай, не копируй). '}Проверь первоисточники сама (PubMed/Cochrane/ВОЗ), открой их.${prev ? `\nПредыдущая версия сценария (правь её): ${JSON.stringify(prev)}` : ''}${changes.length ? `\nОбязательные правки: ${changes.join(' | ')}` : ''}${fresh ? `\n\n${regenBlock([...history, ...banned], { comment: comment || '' })}` : ''}
  Формат файла: {"title","idea":"сквозная мысль ролика одним предложением","lens":{"candidates":["угол 1 + приём","угол 2 + приём","угол 3 + приём"],"chosen":2,"why":"на каких данных держится"},"stake":"что зритель чувствует или делает по этому поводу каждый день, его словами","gaps":["интрига 1: что на самом деле","интрига 2: что это значит для меня"],"bookend":"слово или число из хука, которое возвращается в последнем абзаце","emotion_arc":["любопытство","удивление","сомнение","облегчение"] (3-4 шага чувства),"payoff":"фраза-вывод, дословно стоит в одном из двух последних абзацев","chain":[{"to":2,"link":"но|поэтому","why":"что связывает по смыслу; в тексте словами НЕ произносится"}] (по одному на каждый переход между абзацами),"self_check":"как проверила пересказ через но/поэтому и тест на воду","rubric","hook_type":"тип крючка первой фразы: ${HOOK_NAMES}","hook_options":[{"type","line","score"}] (3 крючка разных типов с оценкой 1-10; обязательно при перегенерации),"segments":["абзац 1","абзац 2",…] (5-7 абзацев, 85-100 слов всего БЕЗ призыва, числа и аббревиатуры словами),"on_screen":[{"segment":1,"headline":"…","numbers":["…"],"note":"что показать","loupe":"деталь для лупы"}],"claims":[{"text":"утверждение из сценария","source":"журнал/организация, год","url":"…","pmid":"…","quote":"точная цитата или близкий перевод из первоисточника","caveat":"оговорка авторов, если есть"}],"sources_card":["Автор. Журнал. Год."],"disclaimer":"Не заменяет консультацию врача. …"}.`,
      });
    }
    skipWrite = false;
    if (t1 && t1.skills && t1.skills.checked) skillState.scriptwriter = t1.skills.missing;
    prev = readJson(sj);
    if (!prev || !Array.isArray(prev.segments)) { await agent('scriptwriter', 'error', 'Сценарий не получился', 0, `Нет script.json (код ${t1 && t1.code})`, 'error'); await safeNotify(`⚠️ Сценарий «${v.title}» не получился, см. ${dir}`); throw new Error('нет script.json'); }
    const cut = cleanFillerOpeners(prev);                       // решение Ника 2026-10-21: «Потому что/Поэтому/Так что…» в начале фразы вырезаем кодом, сразу суть
    if (cut.length) { fs.writeFileSync(sj, JSON.stringify(prev, null, 1), 'utf8'); console.log('убраны вводные слова: ' + cut.map((c) => `абз.${c.seg} «${c.from}» → «${c.to}»`).join('; ')); }
    const stl = [...styleIssues(prev.segments), ...bridgeIssues(prev.segments), ...(process.env.VERDICT_GATE === 'off' ? [] : verdictIssues(prev))];   // служебные слова каркаса и «пункты списка» вместо связной мысли
    if (stl.length) {
      console.log('стиль: ' + stl.map((x) => `абз.${x.seg} ${x.say}`).join('; '));
      if (round < MAXR) {
        await agent('scriptwriter', 'working', 'Убираю служебные слова из текста', 45, `Автопроверка стиля: ${stl.map((x) => x.say).join('; ')}`, 'warn');
        changes = [styleFeedback(stl)]; continue;
      }
      await agent('scriptwriter', 'error', 'Служебные слова остались в тексте', 0, 'Последний круг, текст не очищен', 'error');
      await safeNotify(`⚠️ Сценарий «${v.title}»: автопроверка стиля не приняла текст (${[...new Set(stl.map((x) => x.say))].join('; ')}), в ролик такое не пойдёт. Нажмите «Перегенерировать» или напишите правку.`);
      throw new Error('стиль: служебные слова остались: ' + stl.map((x) => x.say).join('; '));
    }
    const crf = process.env.CRAFT_GATE === 'off' ? { ok: true, issues: [] } : craftIssues(prev, { rubric: v.rubric });   // CRAFT_GATE=off только для тестов других этапов          // драматургия: идея, дуга, цепочка «но/поэтому», живая речь, развязка и замыкание на хук
    if (!crf.ok) {
      console.log('драматургия: ' + crf.issues.map((x) => x.rule).join(', '));
      if (round < MAXR) {
        await agent('scriptwriter', 'working', 'Усиливаю драматургию: цепочка, дуга, развязка', 50, `Автопроверка драматургии: ${crf.issues.map((x) => x.rule).join(', ')}`, 'warn');
        changes = [craftFeedback(crf.issues)]; continue;
      }
      craftWarn = crf.issues.map((x) => x.say);                     // последний круг: показываем Нику как есть, но честно предупреждаем
    }
    if (fresh) {                                                  // перегенерация: новая версия обязана отличаться от всех прежних
      nv = novelty(prev, [...history, ...banned]);
      console.log('новизна: ' + nv.summary);
      if (!nv.ok && round < MAXR) {
        banned.push({ label: `Отброшенный черновик ${banned.length + 1}`, segments: prev.segments, hook_type: prev.hook_type });
        await agent('scriptwriter', 'working', 'Переписываю: черновик слишком похож на прежний', 40, `Автопроверка новизны отклонила черновик: ${nv.reasons.join('; ')}`, 'warn');
        await say('scriptwriter', `Черновик слишком похож на прежнюю версию (${nv.reasons.join('; ')}). Пишу заново, по-другому.`);
        changes = [nv.feedback]; prev = null; fs.rmSync(sj, { force: true });
        continue;
      }
      if (!nv.ok) nvWarn = true;                                 // последний круг: показываем Нику как есть, но честно предупреждаем
      fresh = false;                                             // дальше обычные круги: длина и факты правят уже новый текст
    }
    const sp = await speechSeconds(withCta(prev.segments)), dur = sp.sec, words = prev.segments.join(' ').split(/\s+/).length;
    const tag = sp.estimated ? ' (оценка по тексту, сервис озвучки недоступен)' : '';
    console.log(`круг ${round}: ${words} слов, озвучка ${dur.toFixed(1)} с${tag}`);
    if (sp.estimated) await say('scriptwriter', `Сервис озвучки сейчас не отвечает, длину оценила по тексту с запасом: ≈${dur.toFixed(0)} с. Точный замер будет при озвучке ролика.`);
    // Длина по ОЦЕНКЕ (Edge не ответил) не гонит на сокращение: честная оценка без запаса всё равно приблизительна, решает точный замер при озвучке ролика (решение Ника 2026-10-21).
    // Превышение больше 15% по оценке считается настоящим и возвращает на сокращение; меньшее остаётся предупреждением на карточке.
    const lenSoft = lengthVerdict(sp, MAX_SPEECH, { lastRound: round === MAXR }) === 'soft';
    if (dur > MAX_SPEECH && lenSoft) { lengthWarnEst = sp.estimated ? `длина по оценке ${dur.toFixed(0)} с при лимите ${MAX_SPEECH} с (озвучка не отвечала); точный замер будет при озвучке ролика` : `озвучка ${dur.toFixed(1)} с при лимите ${MAX_SPEECH} с: небольшой перебор после трёх кругов, текст проверен; при озвучке ролика длину поджмёт монтажёр или нажмите «Нужны правки»`; console.log('длина по оценке чуть выше лимита, не возвращаю на сокращение: ' + lengthWarnEst); }
    if (dur > MAX_SPEECH && !lenSoft) {
      await agent('scriptwriter', 'working', `Сокращаю: озвучка ${dur.toFixed(0)} с при лимите ${MAX_SPEECH}`, 60, `Сценарий слишком длинный (${dur.toFixed(1)} с), сокращаю`, 'warn');
      const cut = Math.ceil(dur - MAX_SPEECH + 2), perSeg = (sp.perSeg || []).slice(0, prev.segments.length).map((x, i) => `${i + 1}) ${x.toFixed(1)} с, ${String(prev.segments[i] || '').split(/\s+/).length} сл.`).join('; ');
      changes = [cutAdvice(dur, MAX_SPEECH, { perSeg, ctaSec: CTA_SEC, tag })];
      if (round === MAXR) { check = { verdict: 'fix', summary: `Сценарий не укладывается в лимит: ${dur.toFixed(1)} с`, required_changes: changes, claims: [] }; ok = false; break; }
      continue;
    }
    await agent('scriptwriter', 'idle', 'Сценарий передан на проверку фактов', 100, `Сценарий готов (круг ${round}, озвучка ${dur.toFixed(0)} с${sp.estimated ? ', оценка' : ''})`);
    await say('scriptwriter', `Сценарий готов (круг ${round}): ${words} слов, озвучка ${dur.toFixed(0)} с${sp.estimated ? ' (оценка)' : ''}. Передала Вере на проверку фактов.`);
    await scene('scriptwriter', 'factcheck', 'Вера, проверь, пожалуйста, каждую фразу с фактом.', 'chat');
    await agent('factcheck', 'working', 'Проверяю факты по первоисточникам', 30, 'Начала проверку фактов');
    const checkTask = `Проверь сценарий из файла ${sj} (читай его). Для КАЖДОГО объекта claims открой первоисточник (url/PMID), найди подтверждающее место и сравни со словами сценария (segments): число, тип исследования, популяция, оговорки. Проверь также, что в сценарии нет советов по лечению, дозировок, брендов и обещаний результата, а числа в озвучке записаны словами.
Формат файла: {"verdict":"pass"|"fix","claims":[{"text","source_checked":true/false,"quote_found":"что именно сказано в источнике","status":"верно|упрощено|не подтверждено|отклонить","note":""}],"required_changes":["конкретная правка…"],"summary":"1-2 предложения"}. verdict "pass" только если все claims «верно» или безвредно «упрощено» с оговоркой в тексте.`;
    const runCheck = async (label, extra) => runAgent({ label, agentId: 'factcheck', outFile: cj, persona: await promptOf('factcheck'), maxTurns: 90, budgetSec: 1500, task: checkTask + (extra ? `\n\n${extra}` : '') });
    veraRuns++;
    const t2 = await runAgent({
      label: `check${round}`, outFile: cj, persona: await promptOf('factcheck'), maxTurns: 90, budgetSec: 1500, task: checkTask,
    });
    check = readJson(cj);
    if (!check) { await agent('factcheck', 'error', 'Проверка не удалась', 0, `Нет check.json (код ${t2.code})`, 'error'); await safeNotify(`⚠️ Проверка фактов «${v.title}» не удалась, см. ${dir}`); throw new Error('нет check.json'); }
    if (t2.skills && t2.skills.checked) skillState.factcheck = t2.skills.missing;
    // Доказательства: каждое признанное верным утверждение подкреплено дословной цитатой, которую принял реестр grounded-citations.
    if (process.env.EVIDENCE_GATE !== 'off') {
      const ledger = () => readJson(ledgerPath(dir));
      let ev = evidenceIssues(check, ledger());
      if (!ev.ok && veraRuns >= MAX_CHECKS) console.log('доказательства: ' + ev.issues.join('; ') + ' (потолок проверок Веры, повтора нет, предупреждение уйдёт на карточку)');
      if (!ev.ok && veraRuns < MAX_CHECKS) {
        veraRuns++;
        console.log('доказательства: ' + ev.issues.join('; '));
        await agent('factcheck', 'working', 'Добавляю в реестр дословные цитаты', 60, `Автопроверка: у ${ev.issues.length} утверждений нет цитаты из реестра, возвращаю Вере`, 'warn');
        const keep = check, t3 = await runCheck(`check${round}ev`, evidenceFeedback(ev.issues));
        if (t3.skills && t3.skills.checked && t3.skills.missing.length) skillState.factcheck = t3.skills.missing;
        check = readJson(cj) || keep; ev = evidenceIssues(check, ledger());
      }
      evWarn = ev.ok ? null : ev.issues; quoteCount = (ledger() && ledger().sources || []).reduce((s, x) => s + (x.quotes || []).length, 0);
    }
    ok = check.verdict === 'pass';
    await say('factcheck', ok ? `Проверила: ${check.summary || 'факты подтверждены'}` : `Не пропускаю, нужны правки: ${(check.required_changes || []).join('; ')}`);
    await agent('factcheck', 'idle', ok ? 'Сценарий проверен' : 'Вернула сценарий на правки', 100, ok ? 'Факты подтверждены' : `Нужны правки: ${(check.required_changes || []).length}`, ok ? 'info' : 'warn');
    if (ok || round === MAXR || veraRuns >= MAX_CHECKS) break;
    await scene('factcheck', 'scriptwriter', 'Ксения, нужны правки по фактам.', 'chat');
    changes = check.required_changes || [];
  }

  // Пока шли круги, Ник мог отклонить тему: тогда ни карточки, ни монтажа (раньше итог затирал стадию «отклонён» обратно в «проверен»)
  const live = await getVideo(id);
  if (live && live.stage === 'rejected') {
    fs.rmSync(PRE, { force: true });
    await agent('scriptwriter', 'idle', 'Тема отклонена Ником, сценарий не нужен', 0, 'Тема отклонена за время работы над сценарием'); await agent('captain_smm', 'idle', 'Свободен', 0, 'Тема отклонена, сценарий не передаю');
    console.log('тема отклонена за время работы: сценарий не отправлен'); return;
  }
  // Круги кончились: сотрудник не «работает» дальше (раньше Ксения так и висела «Сокращаю…», хотя процесса уже не было)
  const lengthFail = !ok && /не укладывается в лимит/.test(String(check && check.summary));
  await agent('scriptwriter', 'idle', ok ? 'Сценарий передан Нику' : lengthFail ? 'Сценарий не уложился в лимит, ждёт решения Ника' : 'Сценарий не прошёл проверку, ждёт решения Ника', 100, ok ? 'Сценарий готов' : 'Круги закончились без результата', ok ? 'info' : 'warn');
  const text = withCta(prev.segments).join('\n\n') + '\n';   // последний абзац: призыв подписаться (video/cta.json)
  fs.writeFileSync(path.join(dir, 'script_ru.txt'), text, 'utf8');
  const facts = [`# ${prev.title || v.title}: проверка фактов (Вера Доказова)`, '', `Вердикт: ${check.verdict}. ${check.summary || ''}`, '', '| Утверждение | Источник | Что в источнике | Статус |', '|---|---|---|---|',
    ...(check.claims || []).map((c) => `| ${c.text} | ${(prev.claims.find((x) => x.text === c.text) || {}).source || c.source || ''} | ${c.quote_found || ''} | ${c.status}${c.note ? ': ' + c.note : ''} |`), '', '## Источники для карточки', ...(prev.sources_card || []).map((s) => '- ' + s), '', prev.disclaimer || ''].join('\n');
  fs.writeFileSync(path.join(dir, 'FACTS.md'), facts, 'utf8');
  await setVideo(id, { stage: ok ? 'checked' : 'script', script_path: path.join('smm', 'runs', `video_${id}`, 'script_ru.txt'), notes: JSON.stringify({ ...n, check: { verdict: check.verdict, summary: check.summary, required_changes: check.required_changes } }) });
  await agent('captain_smm', 'waiting', ok ? 'Ждёт утверждения сценария Ником' : 'Вера не пропустила сценарий', 0, ok ? `Сценарий «${v.title}» проверен, нужен ответ Ника` : 'Сценарий не прошёл проверку');
  const preApproved = fs.existsSync(PRE);
  // Вера пропустила вариант A: превращаем тему в группу вариантов (B и C пишет Ксения) и шлём ОДНУ карточку на все; если варианты выключены или не вышли, карточка одиночная
  let cardId = null, grp = null;
  if (ok && process.env.VARIANTS !== 'off' && enabledFormats().length > 1) {
    try { grp = await flow.variantsFlow(id); } catch (e) { console.error('варианты не получились:', e.message); await safeNotify(`⚠️ Варианты B и C не получились (${String(e.message).split('\n')[0].slice(0, 160)}). Ниже сценарий A, его можно утвердить отдельно.`); }
  }
  if (grp && !grp.skipped) cardId = grp.cardId;
  else { const card = scriptCard({ id, v, prev, check, ok, text, lengthFail, lengthWarnEst, veraRuns, regen, history, nv, nvWarn, craftWarn, skillState, quoteCount, evWarn, MAXR }); cardId = await safeNotify(card.text, card.buttons); }

  console.log(ok ? 'сценарий проверен' : 'сценарий НЕ прошёл проверку');
  // Предварительное утверждение Ника (его прямое «делаем»): исполняется только если Вера пропустила и тема не отклонена за время работы
  if (preApproved) {
    fs.rmSync(PRE, { force: true });
    const cur = await getVideo(id);
    if (ok && cardId && cur && cur.stage === 'checked') {
      await safeNotify('Вера пропустила. Ваше «утверждаю» засчитано, сценарий выше уходит в монтаж: вопрос повторять не буду.');
      await api('/api/chat/answer', { id: cardId, choice: `approve:${id}`, via: 'auto', echo: false });
      console.log('предварительное утверждение исполнено: монтаж запущен');
    } else if (!ok) {
      await safeNotify(`⚠️ Вера снова не пропустила сценарий «${v.title}», ваше предварительное «утверждаю» не исполнено: ролик в монтаж не ушёл. Решение за вами: кнопки на карточке выше.`);
    }
  }
}

/* ---------------- 3. Озвучка и монтаж (Кирилл, Opus 5.5, high) ---------------- */
// Реплики «Скептика» формата C: лежат рядом со сценарием (skeptic.json), монтажёру передаются в задании дословно
function skepticLine(dir) { try { const a = JSON.parse(fs.readFileSync(path.join(dir, 'skeptic.json'), 'utf8')); return Array.isArray(a) && a.length ? a.map((t, i) => `[${i + 1}] ${t}`).join(' ') : ''; } catch { return ''; } }
async function produce(id, comment) {
  const v = await getVideo(id); if (!v) throw new Error('нет ролика #' + id);
  const ed = editorOf(v), fmt = formatOf(v), vr = variantOf(v), tag = vr ? ` · вариант ${vr.letter} «${FORMATS[fmt].name}»` : '';   // монтажёр и формат по метке варианта; одиночный ролик: Кирилл, формат A
  const n = String(id).padStart(2, '0');
  const rel = path.join('smm', 'runs', `video_${id}`);
  const abs = path.join(ROOT, rel);
  const proj = path.join(ROOT, 'video', `dosie${n}`);
  const tpl = fs.readFileSync(path.join(ROOT, 'smm', 'brief_template.md'), 'utf8');
  const brief = tpl.replaceAll('{{N}}', n).replaceAll('{{ID}}', String(id)).replaceAll('{{TITLE}}', v.title).replaceAll('{{SCRIPT}}', path.join(abs, 'script_ru.txt').replaceAll('\\', '/'))
    .replaceAll('{{FACTS}}', path.join(abs, 'FACTS.md').replaceAll('\\', '/')).replaceAll('{{PROJ}}', proj.replaceAll('\\', '/')).replaceAll('{{VIDEO}}', ROOT.replaceAll('\\', '/') + '/video').replaceAll('{{SCRIPTS}}', ROOT.replaceAll('\\', '/') + '/scripts').replaceAll('{{COMMENT}}', comment || 'нет').replaceAll('{{RENDER_RULES}}', renderRules({ proj, scripts: path.join(ROOT, 'scripts') })).replaceAll('{{FORMAT_SECTION}}', formatSection(fmt, ROOT, { skeptic: skepticLine(abs) })).replaceAll('Ты Кирилл Кадров, Video Editor', `Ты ${ed.name}, Video Editor`);
  if (ensureCtaFile(path.join(abs, 'script_ru.txt'))) console.log('в сценарий добавлен призыв подписаться (video/cta.json)');
  const bf = path.join(abs, 'BRIEF.md'); fs.writeFileSync(bf, brief, 'utf8');

  await agent('captain_smm', 'working', `Монтаж: «${v.title}»${tag}`, 60, `Сценарий утверждён, передал ${ed.name}${tag}`);
  await scene('captain_smm', ed.id, `${ed.name.split(' ')[0]}, сценарий утверждён: «${v.title}»${tag}. Озвучка, субтитры, монтаж.`);
  await yieldToPriority(ed.id);          // идут правки другого ролика: у правок приоритет
  await agent(ed.id, 'working', 'Озвучка, субтитры, монтаж (Opus 5.5)', 3, 'Начал сборку ролика', undefined, { real: true });
  const videoStartedAt = Date.now();
  // настоящий процент по файлам проекта: дашборд показывает «N% · ещё ~M мин» (video_progress.mjs)
  const stopWatch = watchVideoProgress(proj, n, videoStartedAt, (pct, step) => agent(ed.id, 'working', undefined, pct, `Монтаж: ${step} (${pct}%)`, undefined, { real: true }));
  const { spawn } = await import('node:child_process');
  const code = await new Promise((resolve) => {
    const p = hermesSpawn(['-p', ed.profile, 'chat', '--query-file', bf, '-Q', '--oneshot', '--max-turns', '400', '--run-budget', '5400'], { cwd: ROOT, windowsHide: true, stdio: ['ignore', fs.openSync(path.join(abs, '_video_log.txt'), 'w'), 'ignore'] });
    p.on('exit', resolve);
  });
  stopWatch();
  const mp4 = path.join(proj, 'final', `dosie${n}_v1.mp4`);
  if (!fs.existsSync(mp4)) {
    await agent(ed.id, 'error', 'Ролик не собран', 0, `Нет ${mp4} (код ${code})`, 'error');
    await safeNotify(`⚠️ Ролик «${v.title}»${tag} не собран, смотрите ${proj}/RESULT.md`);
    throw new Error('нет mp4');
  }
  const gt = gate(mp4, proj, { dynamics: true, format: fmt });        // формат, шляпа и динамика проверяются конвейером по профилю формата ролика (A, B или C), а не только словами в задании
  if (!gt.ok) {
    const why = gt.problems.join('; ');
    await agent(ed.id, 'error', 'Ролик не прошёл проверку (формат/шляпа/динамика)', 0, why.slice(0, 200), 'error');
    await safeNotify(`⚠️ Ролик «${v.title}»${tag} собран, но НЕ отправлен вам: не прошёл автоматическую проверку.\n- ${gt.problems.join('\n- ')}\nФайл: ${mp4}`);
    throw new Error('ролик не прошёл проверку: ' + why);
  }
  markFormat(proj, fmt);
  await setVideo(id, { stage: 'produced', video_path: path.relative(ROOT, mp4) });
  await agent(ed.id, 'idle', 'Ролик готов, ждёт вашего просмотра', 100, 'Ролик собран');
  await say(ed.id, `Ролик собран: ${path.relative(ROOT, mp4)}. Отчёт: ${path.relative(ROOT, path.join(proj, 'RESULT.md'))}.`);
  const siblings = vr ? groupMembers(await videos(), v).filter((x) => x.id !== v.id && x.stage === 'editing').length : 0;      // остальные варианты ещё монтируются: Капитан не «ждёт Ника», пока работа идёт
  if (siblings) await agent('captain_smm', 'working', `Монтаж: ещё в работе вариантов: ${siblings}`, 70, `Ролик «${v.title}»${tag} готов, остальные варианты монтируются`);
  else await agent('captain_smm', 'waiting', 'Ждёт вашего решения по ролику', 0, `Ролик «${v.title}»${tag} готов`);
  let res = ''; try { res = cleanReport(fs.readFileSync(path.join(proj, 'RESULT.md'), 'utf8')); } catch {}
  const btn = [[['Принять ролик', `accept:${id}`], ['Внести правки', `rework:${id}`]]];
  const skillNote = skillUsageNote(videoStartedAt, undefined, { profile: ed.profile, name: ed.name.split(' ')[0] }), roundNote = roundsNote(proj);
  if (skillNote) console.log(skillNote);
  if (roundNote) console.log(roundNote);
  try { await sendVideoFile(mp4, `🎬 «${v.title}»${tag} готов.\n${res}${gt.summary ? '\n' + gt.summary : ''}${skillNote ? '\n' + skillNote : ''}${roundNote ? '\n' + roundNote : ''}\n\nПринять или внести правки?`, btn); }
  catch (e) { await safeNotify(`🎬 Ролик${tag} готов: ${mp4}\n(не удалось отправить файл: ${e.message})\n${res}`, btn); }
  console.log('готово:', mp4);
}


/* ---------------- 4. Правки готового ролика (Кирилл, Opus 5.5, high; у ролика приоритет) ---------------- */
const projectDir = (id) => (Number(id) === 1 ? path.join(ROOT, 'video', 'med_detective', 'dosie01') : path.join(ROOT, 'video', `dosie${String(id).padStart(2, '0')}`));   // ролик №1 собран вручную в проекте med_detective
function reworkBrief({ id, n, ver, cur, title, comment, proj, editor = { name: 'Кирилл Кадров' }, fmt = 'A' }) {
  const P = proj.replaceAll('\\', '/'), V = ROOT.replaceAll('\\', '/') + '/video', S = ROOT.replaceAll('\\', '/') + '/scripts';
  return `# Правки ролика №${id} → ${ver}: ${comment.replace(/\s+/g, ' ').slice(0, 70)}

Ты ${editor.name}, Video Editor AI-офиса Ника (Claude Opus 5.5, высокие усилия). Отвечай и пиши отчёт по-русски. Публиковать ничего нельзя: результат уходит Нику на приёмку. **У этой работы приоритет над всем остальным: остальные этапы конвейера ждут, поэтому делай сразу и без пауз.**

${formatSection(fmt, ROOT, { skeptic: skepticLine(path.join(ROOT, 'smm', 'runs', `video_${id}`)) })}## Что просит Ник (дословно; это закон)
«${comment}»

## База
- Ролик «${title}», проект \`${P}\`. Текущая версия: \`final/dosie${n}_v${cur}.mp4\`. Её исходники лежат в проекте и в \`v${cur}_archive/\`: самый свежий \`build_dosie*.py\`, \`make_frames*.py\`, \`script_ru.txt\`, \`words.json\`, \`narration.mp3\`, отчёт \`RESULT*.md\`. Прочитай отчёт и скрипт сборки первыми.
- **Не перезаписывай и не удаляй прежние версии** (\`final/dosie${n}_v*.mp4\` и их отчёты). Сделай копии скриптов сборки под ${ver} (\`build_dosie${n}_${ver}.py\`, \`make_frames_${ver}.py\`) и правь их.
- Стандарт ролика (DESIGN.md, \`${V}/med_detective/DESIGN.md\`): ≤ 59,0 с; безопасная зона x 60-940, y 250-1440 для всего читаемого; громкость −14 LUFS, true peak ≤ −1,5 dBTP; призыв подписаться в конце (\`${V}/cta.json\`); динамика по \`${V}/med_detective/DYNAMICS.md\` (формат A: цветные поля на весь экран, гигантские числа и слова, шторки, новый шот каждые 1,5-3 с), готовый mp4 обязан пройти \`node ${S}/video_dynamics.mjs <mp4>\` с кодом 0, а также \`${S}/video_format.mjs\` и \`${S}/check_duck_hat.mjs <проект>\`; лупа отдельным элементом; экспорт 1080×1920, 30 к/с, H.264 High yuv420p, AAC 48 кГц, faststart, файл ≤ 40 МБ.

## БИБЛИОТЕКА ПРЕЖДЕ ВСЕГО (решение Ника 2026-10-20; проверяется кодом, ролик без этого Нику не уходит)
Готовые скиллы и блоки HyperFrames написаны профессионалами. **Ничего не выдумывай с нуля, если оно уже лежит в библиотеке.** С нуля делается только то, что ты искал и не нашёл (утка, лупа, CTA и дизайн-система уже наши).
**До раскадровки, по порядку:**
1. \`skill_view\` для \`hyperframes-animation\` (читай \`rules-index.md\`, \`blueprints-index.md\`, \`transitions/overview.md\` и \`transitions/catalog.md\`), \`hyperframes-registry\` и \`vertical-video-editing\` (хук, ритм, камера, звук). Заглядывай в \`media-use\` за звуками и картинками; темп и громкость бери из наших \`${V}/med_detective/DYNAMICS.md\` и \`${V}/library/SOUND_PALETTE.md\`.
1a. **\`vizavi-motion\` ОБЯЗАТЕЛЕН и ПРОВЕРЯЕТСЯ КОДОМ** (решение Ника 2026-10-21: он главный скилл по монтажу и визуалу; ролик без этого Нику не уходит). \`skill_view('vizavi-motion')\`, затем \`references/storyboard.md\`, \`references/motion-and-sound.md\`, \`references/review-and-export.md\`. **ДО сборки** запиши \`${P}/STORYBOARD.json\` по эталону \`${V}/med_detective/STORYBOARD_REFERENCE.json\`: единая нить и по КАЖДОЙ сцене 3–5 существенно разных вариантов (действие, пространство, метафора, переход; смена цвета и шрифта не вариант), выбранный, причина выбора, камера (путь, крупность, глубина, фокус), типографика в действии, вход и выход. Сцена = абзац сценария (5–7 штук); кадры внутри сцены по-прежнему меняются каждые 1–1,5 с по DYNAMICS.md. Запусти \`node ${S}/check_vizavi.mjs ${P} --storyboard\`: **код 0 обязателен ДО сборки**. **ПОСЛЕ первой сборки** (это черновик, не финал) просмотри ролик целиком и по сценам, запиши \`${P}/REVIEW_LOG.json\` по эталону \`REVIEW_LOG_REFERENCE.json\` (замечания «интервал → наблюдение → причина → правка → повторная проверка», сборок не меньше двух, честные статусы «реализовано / проверено запуском / видно в кадрах / проверено в движении / прослушано», итоговая проверка готового файла), исправь найденное, пересобери и запусти \`node ${S}/check_vizavi.mjs ${P} --review\`: код 0 обязателен. В \`RESULT.md\` добавь раздел **«Использовано из vizavi-motion»**. **Его умолчания НЕ действуют там, где они спорят с нашими правилами:** только 1080×1920, 30 к/с, до 59 с (не 1920×1080 и 60 к/с); звуков на смене кадра нет, музыка только из нашей палитры; бренд, дизайн-система, утка, лупа и CTA остаются нашими; стили его демо (карандаш, бумага, пиксели, SaaS/UI) не копируй. Если что-то в скилле противоречит этому брифу, прав бриф.
2. Прочитай \`${V}/med_detective/BRAND_MOTION.md\` (три семейства переходов A/B/C, два стиля субтитров, порядок поиска) и \`${V}/library/SOUND_PALETTE.md\` (звуки и музыка).
3. Поищи готовое: \`npx hyperframes catalog <слово>\` (субтитры \`caption-*\`, переходы, текст \`bottom-up-letters\`/\`char-slam-explode\`, \`hw-*\` рисованная графика, \`count-up\`); ставь \`npx hyperframes add <имя>\`. Графика CC0: \`${V}/library/cc0/graphics/\`. Звуки и музыка: \`${V}/library/cc0/sfx/\`, \`.../music/\` (только из палитры).
4. Запиши план в \`${P}/LIBRARY_PLAN.json\` по эталону \`${V}/med_detective/LIBRARY_PLAN_REFERENCE.json\` и запусти \`node ${S}/check_library_plan.mjs ${P}\`: **код 0 обязателен ДО сборки**. Любой id проверяется по каталогам; выдуманный блок, звук перехода или звук не из палитры не пройдёт.
5. Адаптируй блоки каталога под наш формат (они на 1920×1080 с Google Fonts): 1080×1920, \`cqw/cqh\`, шрифт только локальный Manrope 800, слова из \`words.json\`, цвета бренда, безопасная зона. Не подключай шрифты из сети.
6. В \`RESULT.md\` добавь раздел **«Использовано из библиотеки»**: какие правила, блюпринты, блоки, переходы (A/B/C), стиль субтитров, звуки, графика и музыка взяты, и что сделано с нуля и почему.
7. Звук: музыка тихая (−24 дБ от голоса, ducking на речи), без звуков на переходах; собери два варианта: основной и \`*_nomusic.mp4\` (без музыки), положи оба в \`final/\`.

## Вердикт только в конце (решение Ника 2026-10-20; проверяется кодом)
Вердикт (миф это или правда) называется и показывается ТОЛЬКО в конце ролика, перед призывом. В хуке и заголовке начала нет слов «миф», «правда» (кроме вопроса «правда ли это?»), «ложь», «фейк», «развенчиваем», нет штампа «МИФ?» и метки рубрики: зритель, знающий ответ заранее, не досматривает ролик. В первых 60% ролика нет штампа «МИФ?», плашки, красного поля с вердиктом, слов «МИФ»/«ПРАВДА». Проверка: \`node ${S}/check_verdict_label.mjs ${P}\` (код 0 обязателен).

${renderRules({ proj, scripts: path.join(ROOT, 'scripts'), ns: 'rework' + String(ver).replace(/[^0-9]/g, '') })}
## Как вносить правки
0. **Если просьба про динамику / «ролик слабый» / DYNAMICS.md: это полная переделка визуала, а не правка.** Прочитай \`${V}/med_detective/DYNAMICS.md\` целиком, сделай раскадровку (по кадру на шот) и посмотри её до полного рендера; звук, текст, тайминги речи и призыв остаются, картинка строится заново в новом языке. Вердикт по динамике выносит измеритель, не ты.
1. Меняй **только то, что просит Ник** (кроме случая из п. 0). Всё остальное остаётся как в v${cur}: не ломай принятое (тайминги, лупу, зону, призыв, громкость).
2. Если правка касается **текста озвучки или фактов** (слова диктора, числа, названия источников): текст сценария сам НЕ МЕНЯЙ (он проверен фактчекером). Сделай всё остальное из просьбы, а по тексту опиши в отчёте раздел «Нужна правка сценария» с точной формулировкой просьбы: её передадут сценаристу и фактчекеру.
3. Озвучку генерируй заново только если она действительно меняется (скорость, пауза и т. п.): \`C:/hf_tts/venv/Scripts/python.exe ${V}/narrate.py --lang ru --text <script_ru.txt> --out <narration.mp3> --srt <captions.srt> --words <words.json> --patience 1200\`. Код выхода 4 (сервис недоступен) значит «подожди 10 минут и повтори»; голос и движок не менять.
4. Проверки после правки (затронутые правкой обязательно; длительность и безопасную зону проверяй всегда): \`npx --yes hyperframes@0.8.174 check\` без замечаний, рендер \`--quality standard\`, \`ffprobe\` ≤ 59,0 с, кадры затронутых мест смотри через \`vision_analyze\` (наложения, обрезания, выход за зону, мелкий шрифт), громкость \`ebur128\`, призыв подписаться в последней сцене.

## Результат (имена ТОЧНО такие)
\`final/dosie${n}_${ver}.mp4\`, \`RESULT_${ver}.md\` в корне проекта (по каждому пункту просьбы: что сделано и как проверено, что не удалось, раздел «Нужна правка сценария», если он нужен; первой строкой одно предложение-итог без разметки: оно уйдёт Нику в Telegram), \`final/poster_${ver}.png\`, \`final/contact_sheet_${ver}.png\`, субтитры \`final/captions_${ver}.srt\`.

## Жёсткие рамки
- Работай только в \`${V}/\` и в проекте \`${P}\`. Не трогай \`server/\`, \`web/\`, \`smm/\`, \`scripts/\`, git, профили и конфиги Hermes, cron; ничего не устанавливай глобально; сервисы не перезапускай; никому не пиши и не публикуй.
- В режиме без человека блокируются \`execute_code\` и команды-heredoc: создавай файлы \`write_file\`/\`patch\`, запускай скрипты простыми командами \`terminal\` (\`C:/hf_tts/venv/Scripts/python.exe путь.py\`).
- Пиши прогресс в \`${P}/PROGRESS.md\` короткими строками («ЧЧ:ММ: что сделано, что дальше») после каждого шага: по нему офис показывает Нику ход работы.
- Факты только из FACTS.md. Никаких советов по лечению, дозировок, брендов, «врачей» и ИИ-аватаров. Музыку не добавлять.
- Не заканчивай, пока проверки не пройдены. Если что-то невозможно, честно запиши в RESULT_${ver}.md, ничего не подделывай.
- Команды дольше 600 с запускай фоном; временные файлы в \`~/AppData/Local/hermes/cache/scratch\`.
`;
}
async function rework(id, comment) {
  comment = String(comment || '').trim(); if (!comment) throw new Error('нет текста правок');
  const v = await getVideo(id); if (!v) throw new Error('нет ролика #' + id);
  const ed = editorOf(v), fmt = formatOf(v), vr = variantOf(v), tag = vr ? ` (вариант ${vr.letter} «${FORMATS[fmt].name}»)` : '';
  const n = String(id).padStart(2, '0'), proj = projectDir(id), fin = path.join(proj, 'final');
  const have = fs.existsSync(fin) ? fs.readdirSync(fin).map((f) => new RegExp(`^dosie${n}_v(\\d+)\\.mp4$`).exec(f)).filter(Boolean).map((m) => Number(m[1])) : [];
  if (!have.length) throw new Error(`нет готового ролика в ${fin}`);
  const cur = Math.max(...have), next = cur + 1, ver = `v${next}`, started = Date.now();
  const short = comment.replace(/\s+/g, ' ').slice(0, 80);
  // прежняя версия: исходники и отчёт в архив (mp4 остаётся в final/)
  const arch = path.join(proj, `v${cur}_archive`); fs.mkdirSync(arch, { recursive: true });
  for (const f of fs.readdirSync(proj)) if (/^(script_ru\.txt|narration\.mp3|words\.json|captions\.srt|build_meta\.json|RESULT[\w]*\.md|build_dosie[\w]*\.py|make_frames[\w]*\.py)$/.test(f) && !fs.existsSync(path.join(arch, f))) fs.copyFileSync(path.join(proj, f), path.join(arch, f));
  if (ensureCtaFile(path.join(proj, 'script_ru.txt'))) console.log('в сценарий добавлен призыв подписаться');
  const bf = path.join(proj, `REWORK_${ver}.md`); fs.writeFileSync(bf, reworkBrief({ id, n, ver, cur, title: v.title, comment, proj, editor: ed, fmt }), 'utf8');
  const progress = path.join(proj, 'PROGRESS.md'), lastLine = () => { try { return fs.readFileSync(progress, 'utf8').split(/\r?\n/).map((s) => s.trim()).filter(Boolean).pop() || ''; } catch { return ''; } };

  await setPriority(true, Number(id), `правки ролика №${id}`);
  await agent('captain_smm', 'working', `Правки ролика №${id} (приоритет): ${short}`, 60, `Ник просит правки ролика №${id}: ${short}`);
  await scene('captain_smm', ed.id, `${ed.name.split(' ')[0]}, правки Ника по ролику №${id}${tag}: ${short}`);
  await agent(ed.id, 'working', `Правки ролика №${id} → ${ver}: ${short}`, 10, `Начал правки (${ver}): ${short}`);
  let code = null, last = lastLine();
  try {
    code = await new Promise((resolve) => {
      const out = fs.openSync(path.join(proj, `_run_${ver}_log.txt`), 'a');
      const p = hermesSpawn(['-p', ed.profile, 'chat', '--query-file', bf, '-Q', '--oneshot', '--max-turns', '400', '--run-budget', '5400'], { cwd: ROOT, windowsHide: true, stdio: ['ignore', out, out] });
      const timer = setInterval(async () => {                // живой ход: минуты и последняя строка его PROGRESS.md
        const mins = Math.round((Date.now() - started) / 60000), ll = lastLine();
        await agent(ed.id, 'working', `Правки ролика №${id} → ${ver}: ${short} · ${mins} мин`, Math.min(90, 10 + mins * 2), ll && ll !== last ? ll.slice(0, 200) : undefined).catch(() => {});
        last = ll;
      }, Number(process.env.REWORK_POLL_MS) || 20000);
      p.on('exit', (c) => { clearInterval(timer); resolve(c); });
    });
  } finally { await setPriority(false); }

  const mp4 = path.join(fin, `dosie${n}_${ver}.mp4`), report = path.join(proj, `RESULT_${ver}.md`);
  const fresh = (f) => { try { return fs.statSync(f).mtimeMs >= started; } catch { return false; } };
  if (!fresh(mp4) || !fresh(report)) {
    await agent(ed.id, 'error', fresh(mp4) ? 'Правки: черновой рендер без финальной проверки' : 'Правки не готовы', 0, `Правки ролика №${id}: ${ver} не собран (код ${code})`, 'error');
    await agent('captain_smm', 'waiting', 'Правки не вышли, ждёт вашего решения', 0, `Правки ролика №${id} не собраны`, 'error');
    await setVideo(id, { stage: 'produced' });
    await safeNotify(`⚠️ Правки ролика №${id} не готовы: Кирилл остановился${fresh(mp4) ? ' (есть черновой рендер, но без финальной проверки)' : ''}. Прежняя версия v${cur} цела. Это сбой на нашей стороне, не ваш. Можно внести правки ещё раз или принять v${cur}.`, [[[`Внести правки ещё раз`, `rework:${id}`], [`Принять v${cur}`, `accept:${id}`]]]);
    return;
  }
  const md = fs.readFileSync(report, 'utf8');
  const gt = gate(mp4, proj, { dynamics: /DYNAMICS\.md/.test(comment), reportName: `RESULT_${ver}.md` });   // правка про динамику (или проект уже формата A) тоже проверяется измерением
  if (!gt.ok) {
    const why = gt.problems.join('; ');
    await agent(ed.id, 'error', 'Правки не прошли проверку (формат/шляпа/динамика)', 0, why.slice(0, 200), 'error');
    await safeNotify(`⚠️ Правки ролика №${id} ${ver} собраны, но НЕ отправлены вам: не прошли автоматическую проверку.\n- ${gt.problems.join('\n- ')}\nФайл: ${mp4}`);
    throw new Error('правки не прошли проверку: ' + why);
  }
  if (gt.dynamicsChecked) markFormat(proj, gt.format || fmt);
  await setVideo(id, { stage: 'produced', video_path: path.relative(ROOT, mp4) });
  await agent(ed.id, 'idle', `Правки внесены, ${ver} ждёт вашего просмотра`, 100, `Ролик №${id} ${ver} собран`);
  await say(ed.id, `Правки внесены: ${path.relative(ROOT, mp4)}.`);
  await agent('captain_smm', 'waiting', `Ждёт вашего решения по ролику №${id} ${ver}`, 0, `Ролик №${id} ${ver} готов`);
  const needScript = /нужна правка сценария/i.test(md) ? '\n⚠️ Часть просьбы касается текста озвучки: нужны сценарист и фактчекер, подробности в отчёте Кирилла.' : '';
  const btn = [[['Принять ролик', `accept:${id}`], ['Внести правки', `rework:${id}`]]];
  const caption = `🎬 Ролик №${id}${tag} ${ver}: правки внесены.\n${cleanReport(md)}${gt.summary ? '\n' + gt.summary : ''}${needScript}\n\nПринять или внести ещё правки?`;
  try { await sendVideoFile(mp4, caption, btn); } catch (e) { await safeNotify(`${caption}\n(файл не отправился: ${e.message}; он лежит на ПК: ${mp4})`, btn); }
  console.log('готово:', mp4);
}


/* ---------------- 5. Пакет публикации: название-крючок и хэштеги (Тимофей, после приёмки ролика) ---------------- */
// Сценарий для названия: у ролика №1 собран вручную, у остальных лежит в smm/runs/video_N
const scriptFileOf = (id) => (Number(id) === 1 ? path.join(projectDir(1), 'script_ru.txt') : path.join(ROOT, 'smm', 'runs', `video_${id}`, 'script_ru.txt'));
// Кнопки карточки названия. «Перейти к публикации» только когда YouTube подключён.
const titleButtons = (id) => [[['🔄 Перегенерировать название', `package:${id}`], ['✏️ Своё название', `title:${id}`]], ...(ytStatus().ready ? [[['🚀 Перейти к публикации', `publish_go:${id}`]]] : [])];
// Своё название, введённое Ником: сохраняется для Публикатора, хэштеги прежние. Автопроверка только предупреждает: решение за Ником.
async function setTitle(id, title) {
  const v = await getVideo(id); if (!v) throw new Error('нет ролика #' + id);
  title = String(title || '').replace(/\s+/g, ' ').trim(); if (!title) throw new Error('пустое название'); if (title.length > 100) throw new Error(`название длиннее 100 знаков (${title.length})`);
  const dir = path.join(ROOT, 'smm', 'runs', `package_${id}`); fs.mkdirSync(dir, { recursive: true });
  const prev = loadPublishMeta(id), tags = prev ? prev.tags : [];
  fs.writeFileSync(path.join(dir, 'publish_meta.json'), JSON.stringify({ title, clean_title: title, title_tags: [], tags, video_title: v.title, manual: true, ts: Date.now() }, null, 1), 'utf8');
  let script = ''; try { script = fs.readFileSync(scriptFileOf(id), 'utf8'); } catch {}
  const chk = checkTitle(title, { scriptText: script, allowTags: true });     // своё название: хэштеги в нём решение Ника
  await say('packager', `Принял ваше название: «${title}».`);
  await safeNotify(`✏️ Ваше название для «${v.title}»:\n«${title}»\n${chk.ok ? '' : `⚠️ Автопроверка (решать вам): ${chk.problems.join('; ')}.\n`}Хэштеги (рекомендация, уйдут в описание YouTube): ${tags.length ? tags.join(' ') : '—'}\n\nПерегенерировать, изменить ещё раз или перейти к публикации?`, titleButtons(id));
  console.log('готово: своё название', title);
}
async function packageClip(id, comment) {
  const v = await getVideo(id); if (!v) throw new Error('нет ролика #' + id);
  const vr0 = variantOf(v);
  const dir = path.join(ROOT, 'smm', 'runs', `package_${id}`); fs.mkdirSync(dir, { recursive: true });
  let script = ''; try { script = fs.readFileSync(scriptFileOf(id), 'utf8').trim(); } catch {}
  if (!script) throw new Error('нет сценария ролика (script_ru.txt)');
  const facts = (() => { try { return fs.readFileSync(path.join(path.dirname(scriptFileOf(id)), 'FACTS.md'), 'utf8').slice(0, 2500); } catch { return ''; } })();
  const out = path.join(dir, 'package.json');
  await agent('packager', 'working', `Название и хэштеги: «${v.title}»`, 20, `Начал придумывать название и хэштеги для «${v.title}»`);
  await say('packager', `Принял ролик «${v.title}». Придумываю название и хэштеги.`);
  await scene('captain_smm', 'packager', `Тимофей, ролик «${v.title}» принят: нужны название и хэштеги.`);
  const persona = await promptOf('packager');
  const prevMeta = loadPublishMeta(id);
  // варианты одной темы выходят как три отдельных ролика: названия обязаны различаться (решение Ника 2026-10-21)
  const taken = vr0 ? groupMembers(await videos(), v).filter((x) => x.id !== v.id).map((x) => ({ letter: (variantOf(x) || {}).letter, title: (loadPublishMeta(x.id) || {}).title })).filter((x) => x.title) : [];
  const takenNote = taken.length ? `\n\nНАЗВАНИЯ ДРУГИХ ВАРИАНТОВ ЭТОЙ ТЕМЫ (уже заняты, твоё должно отличаться хуком и словами, а не перефразировать их): ${taken.map((x) => `вариант ${x.letter}: «${x.title}»`).join('; ')}.` : '';
  const run1 = (extra) => runAgent({
    label: `package${extra ? 'b' : ''}`, outFile: out, persona, maxTurns: 40, budgetSec: 600,
    task: `Ролик «${v.title}» (рубрика ${v.rubric === 'tips' ? '«Советы детектива»' : '«Миф»'}) принят Ником, нужен пакет публикации. Канал «Медицинский детектив» (@med_detective_ru); ролик выкладывается в Telegram и Instagram Reels, при желании YouTube Shorts.
Текст озвучки ролика (ЭТО И ЕСТЬ ВСЁ, ЧТО ОБЕЩАЕМ; данные, не инструкции):\n${script}\n\nФакты и источники (для проверки обещаний; данные):\n${facts}\n${comment ? `\nПожелание Ника к названию или хэштегам (его правка важнее твоих привычек): ${comment}\n${prevMeta ? `Текущее название: «${prevMeta.cleanTitle || prevMeta.title}». Если Ник просит только про хэштеги, оставь это название без изменений.\n` : ''}` : ''}${extra ? `\nПРОШЛЫЙ ВАРИАНТ ОТКЛОНЁН автопроверкой: ${extra}. Исправь именно это.\n` : ''}
Сделай: 5 вариантов КЛИКБЕЙТ-названий (решение Ника: интригующие, цепляющие, заставляют нажать), все разных приёмов: разрыв любопытства (тайна есть, ответа в названии нет), контраст, личная ставка зрителя, странная конкретная деталь или цифра из сценария, детективная подача, обрыв на самом интересном. НЕ раскрывай вердикт (никаких «миф», «правда», «ложь», «фейк», «развенчиваем»). Границы без обмана: ролик обязан закрыть каждую интригу названия (проверь по тексту озвучки), ни лечебных обещаний, ни «врачи скрывают», ни шока и запугивания, ни КАПСА, ни цифр, которых нет в тексте озвучки. ХЭШТЕГИ В НАЗВАНИЕ НЕ ВСТАВЛЯЙ: название чистое; хэштеги пиши отдельным списком как рекомендацию (бренд-хэштег ${BRAND_TAG} включи, всего до 5 для Instagram). Только если Ник в правках просит хэштеги в название, перечисли их в поле title_tags.
Итог запиши в файл ${out} как JSON: {"titles":[{"title":"…","approach":"вопрос|интрига|контраст|цифра|детектив","risk":"чем может ввести в заблуждение, или «нет»"}],"best":1,"why":"одна фраза, почему лучший цепляет и выполним","hashtags":["#МедицинскийДетектив","#…"],"title_tags":[] (пусто, пока Ник не просил хэштеги в название),"honesty":"одна фраза Нику, что хэштеги и название только помогают найти ролик, а охват решает удержание"}` + takenNote,
  });
  await run1('');
  let j = readJson(out), titles = [], pick = null, bad = [];
  const evaluate = () => {
    titles = (j && Array.isArray(j.titles) ? j.titles : []).map((t) => ({ ...t, title: String(t.title || '').replace(/\s+/g, ' ').trim(), check: (() => { const ck = checkTitle(t.title, { scriptText: script }), cl = titleClash(String(t.title || ''), taken); return cl.length ? { ...ck, ok: false, problems: [...ck.problems, ...cl.map((c) => `похоже на название варианта ${c.letter} «${c.title}»`)] } : ck; })() })).filter((t) => t.title);
    const bi = Math.max(0, Math.min(titles.length - 1, (Number(j && j.best) || 1) - 1));
    pick = titles[bi] && titles[bi].check.ok ? titles[bi] : titles.find((t) => t.check.ok) || null;
    bad = titles.filter((t) => !t.check.ok).map((t) => `«${t.title}»: ${t.check.problems.join(', ')}`);
  };
  evaluate();
  if (!pick) {      // автопроверка отклонила все варианты: один повтор с причинами
    await say('packager', 'Автопроверка не пропустила мои варианты, переделываю.');
    fs.rmSync(out, { force: true });
    await run1(bad.join(' | ') || 'нет вариантов');
    j = readJson(out); evaluate();
  }
  if (!pick) throw new Error('не удалось получить честное название: ' + (bad.join(' | ') || 'пустой ответ').slice(0, 200));
  const tg = checkTags(j.hashtags || [], { max: 5 });
  const alts = titles.filter((t) => t !== pick && t.check.ok).slice(0, 4).map((t) => ({ title: t.title, risk: t.risk && !/^нет/i.test(t.risk) ? t.risk : '' }));
  const dropped = [...tg.dropped, ...titles.filter((t) => !t.check.ok).map((t) => [`«${t.title}»`, t.check.problems.join(', ')])];
  const comp = composeTitle(pick.title, titleTagsFrom(comment, j.title_tags));       // хэштеги в название только по просьбе Ника, ровно те, что он назвал
  if (comp.dropped.length) dropped.push(...comp.dropped.map((t) => [t, 'не влезло в 100 знаков названия']));
  const text = buildMessage({ videoTitle: v.title, title: comp.title, why: j.why, alternatives: alts, tags: tg.tags, dropped, titleTags: comp.used, honesty: j.honesty || 'Название и хэштеги помогают найти ролик, но охват решает то, досматривают ли его до конца.' });
  fs.writeFileSync(path.join(dir, 'publish_pack.txt'), text + '\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'publish_meta.json'), JSON.stringify({ title: comp.title, clean_title: pick.title, title_tags: comp.used, tags: tg.tags, video_title: v.title, ts: Date.now() }, null, 1), 'utf8');   // точный выбор для Публикатора: tags это рекомендация (уйдёт в описание), в названии только то, что просил Ник
  await agent('packager', 'idle', 'Пакет публикации отправлен Нику', 100, `Пакет для «${v.title}» готов: «${comp.title}»`);
  await say('packager', `Готово: «${comp.title}», рекомендую хэштегов: ${tg.tags.length} (в название не вставлены${comp.used.length ? ', кроме ' + comp.used.join(' ') + ' по вашей просьбе' : ''}). Отправила Нику.`);
  const qt = vr0 ? queueText(await queueInfo(id).catch(() => null)) : '';
  await safeNotify(text + (qt ? '\n\n' + qt : ''), titleButtons(id));                  // перегенерировать, ввести своё, перейти к публикации (только по кнопке Ника)
  console.log('готово: пакет публикации', comp.title, '| рекомендация:', tg.tags.join(' '));
  await fireReminders('package_done', (t) => safeNotify(t)).catch(() => {});   // напоминания Нику, привязанные к концу ролика
}

const [cmd, a1, ...rest] = process.argv.slice(2);
const opt = (name, from) => { const i = from.indexOf(name); return i >= 0 ? from[i + 1] : ''; };
const all = [a1, ...rest];
const runOnce = () => cmd === 'topics' ? topics(opt('--hint', all))
  : cmd === 'card' ? recard(a1)
  : cmd === 'variants' ? flow.variantsFlow(a1, { regen: all.includes('--regen') }).then((r) => console.log(r.skipped ? 'варианты выключены' : `варианты готовы: ${r.ready.join(', ')}${r.failed.length ? '; не вышли: ' + r.failed.map((f) => f.letter).join(', ') : ''}`))
  : cmd === 'group-card' ? flow.groupCard(a1).then((cid) => console.log('карточка группы', cid))
  : cmd === 'variant-revise' ? flow.reviseVariant(a1, opt('--comment', rest)).then((cid) => console.log('карточка группы', cid))
  : cmd === 'script' ? script(a1, opt('--comment', rest), all.includes('--regen'), all.includes('--finish'))
  : cmd === 'produce' ? produce(a1, opt('--comment', rest))
  : cmd === 'rework' ? rework(a1, opt('--comment', rest))
  : cmd === 'package' ? packageClip(a1, opt('--comment', rest))
  : cmd === 'publish' ? publishYouTube(a1, opt('--target', rest) || 'ytp', { when: opt('--at', rest) || undefined }).then((r) => { if (!r.ok) process.exitCode = 1; })
  : cmd === 'publish-card' ? publishCard(a1, { only: opt('--only', rest) || undefined })
  : cmd === 'set-title' ? setTitle(a1, opt('--title', rest))
  : Promise.resolve(console.log('Команды: topics [--hint …] | variants <id> [--regen] | group-card <id> | variant-revise <id> --comment … | script <id> [--comment …] [--regen] | produce <id> [--comment …] | rework <id> --comment … | package <id> [--comment …] | publish <id> --target ytp|yt | publish-card <id> | set-title <id> --title …'));
// Временные сбои (сервис озвучки, сеть, API): один автоповтор через 2 минуты, и только потом тревога Нику
const TRANSIENT = /NoAudioReceived|WSServerHandshake|TTS_UNAVAILABLE|ECONNRESET|ECONNREFUSED|fetch failed|ETIMEDOUT|timed out|не удалось ни измерить/i;
const editorIdOf = async (id) => { try { return editorOf(await getVideo(id)).id; } catch { return 'video'; } };      // кто монтирует этот ролик (у варианта свой монтажёр)
const run = (async () => {
  try { await runOnce(); }
  catch (e) {
    if (cmd === 'rework' || cmd === 'publish' || !TRANSIENT.test(String((e && e.message) || e))) throw e;     // правки ролика не перезапускаем сами: это долгий запуск монтажёра
    const who = (cmd === 'script' || cmd === 'variants' || cmd === 'variant-revise') ? 'scriptwriter' : cmd === 'produce' ? await editorIdOf(a1) : 'research';
    console.error('временный сбой, повтор через 2 минуты:', String(e.message).split('\n')[0]);
    await agent(who, 'working', 'Временный сбой сервиса, повторю через 2 минуты', 5, `Временный сбой: ${String(e.message).split('\n')[0].slice(0, 160)}`, 'warn');
    await new Promise((r) => setTimeout(r, 120000));
    await runOnce();
  }
})();
run.catch(async (e) => {
  const msg = String((e && e.message) || e).split('\n')[0].slice(0, 220);
  console.error('ОШИБКА:', msg);
  try {   // статусы не должны зависать «в работе», а Ник должен узнать о сбое и получить кнопку «Повторить»
    const who = (cmd === 'script' || cmd === 'variants' || cmd === 'variant-revise') ? 'scriptwriter' : (cmd === 'produce' || cmd === 'rework') ? await editorIdOf(a1) : cmd === 'group-card' ? 'captain_smm' : cmd === 'package' ? 'packager' : cmd === 'publish' ? 'publisher' : 'research';
    const stage = { script: 'сценария', variants: 'вариантов сценария', 'variant-revise': 'правки варианта', 'group-card': 'карточки вариантов', produce: 'монтажа', rework: 'правок ролика', package: 'названия и хэштегов', publish: 'публикации', topics: 'поиска тем' }[cmd] || cmd;
    if (cmd === 'rework') await setPriority(false);
    await agent(who, 'error', 'Сбой: ' + msg, 0, `Сбой этапа ${stage}: ${msg}`, 'error');
    if (cmd === 'script') { await agent('factcheck', 'idle', 'Ждёт сценарий на проверку', 0); }
    if (cmd === 'topics') { await agent('virality', 'idle', 'Ждёт темы для оценки', 0); }
    await agent('captain_smm', 'waiting', `Сбой этапа ${stage}, ждёт вашего решения`, 0, `Этап ${stage} остановился с ошибкой`, 'error');
    await safeNotify(`⚠️ Этап ${stage} остановился с ошибкой (после автоповтора): ${msg}\n\nЭто сбой на нашей стороне, не ваш. Нажмите «Повторить», когда удобно, и я запущу этап заново.`, [[[cmd === 'rework' ? 'Внести правки ещё раз' : 'Повторить', cmd === 'topics' ? 'more:0' : cmd === 'rework' ? `rework:${a1}` : cmd === 'package' ? `package:${a1}` : `retry:${a1}`]]]);
  } catch (e2) { console.error('не удалось отметить сбой:', e2.message); }
  process.exit(1);
});

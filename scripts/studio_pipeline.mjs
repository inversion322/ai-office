// Конвейер студии каналов (решение Ника 2026-10-27). Запуск: node scripts/smm_pipeline.mjs studio <этап> …
//   plan <канал> [--date YYYY-MM-DD] [--hint …]      Глеб ищет темы, код измеряет спрос и выбирает три РАЗНЫЕ (самая востребованная на ролик), Мария собирает карточку «План дня»
//   plan-act <канал> <дата> ok|more|skip              ответ Ника на карточку плана (ok: ролик уходит Ксении, посты Дарье)
//   posts <канал> <дата>                              оба поста дня по очереди (Дарья пишет, Павел проверяет, Диана рисует обложку, карточка превью)
//   post <канал> <дата> <слот> [--comment …]          один пост (слот post1|post2), с правкой Ника
//   post-act <канал> <дата> <слот> ok|edit|drop       ответ Ника на превью поста (ok: пост ставится на время слота)
//   publish-due                                       Григорий выкладывает утверждённые посты, чьё время пришло (вызывает сервер раз в минуту)
// Всё, что идёт наружу (пост в канал), только после «да» Ника на превью. Сеть, модели и время подменяются через deps (тесты).
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, api as realApi, agent as realAgent, say as realSay, promptOf as realPromptOf, runAgent as realRunAgent, readJson, notify as realNotify, tgBase, cfg, spawnPipeline } from './smm_lib.mjs';
import { CHANNELS, usedTopics as realUsedTopics } from './daily_topics.mjs';
import { splitNew } from './topic_dedupe.mjs';
import { measureAll as realMeasureAll, demandForPrompt, VIKTOR_DEMAND_RULES } from './demand.mjs';
import * as S from './studio.mjs';
import * as P from './studio_post.mjs';
import { generateCover, imageBudget } from './studio_fal.mjs';

export const channelsConfig = () => S.studioChannels(CHANNELS, S.studioSettings().channels);
const postDir = (date, ch, slot) => path.join(S.studioDir(), 'posts', `${date}_${ch}_${slot}`);
const chatId = () => { try { return cfg().smmBotChatId || 323028999; } catch { return 323028999; } };

/** Всё внешнее в одном месте: тесты подменяют. */
export function makeDeps(o = {}) {
  return {
    api: realApi, agent: realAgent, say: realSay, notify: realNotify, promptOf: realPromptOf, runAgent: realRunAgent, measureAll: realMeasureAll, usedTopics: realUsedTopics,
    spawn: (args) => spawnPipeline(['studio', ...args]), spawnScript: (id) => spawnPipeline(['script', String(id)]),
    generateCover, now: () => Date.now(), channels: channelsConfig,
    sendPhoto: tgPhoto, sendText: tgText, ...o,
  };
}

/* ---------------- Telegram (бот офиса; в тестах подменяется) ---------------- */
async function tgCall(method, body, form) {
  if (process.env.OFFICE_NO_TG && !(process.env.TELEGRAM_API_BASE && process.env.OFFICE_NO_TG_BASE_OK === '1')) throw new Error('Telegram выключен (OFFICE_NO_TG)');
  const r = await (await fetch(`${tgBase()}/bot${cfg().smmBotToken}/${method}`, form ? { method: 'POST', body: form } : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
  if (!r.ok) throw new Error(`Telegram ${method}: ${r.description}`);
  return r.result;
}
/** Фото с подписью (HTML). chat: id или @канал. */
export async function tgPhoto(chat, file, captionHtml, markup) {
  const fd = new FormData(); fd.append('chat_id', String(chat)); fd.append('caption', captionHtml); fd.append('parse_mode', 'HTML');
  if (markup) fd.append('reply_markup', JSON.stringify(markup));
  fd.append('photo', new Blob([fs.readFileSync(file)], { type: 'image/jpeg' }), path.basename(file));
  return tgCall('sendPhoto', null, fd);
}
export const tgText = (chat, html, markup) => tgCall('sendMessage', { chat_id: chat, text: html, parse_mode: 'HTML', disable_web_page_preview: false, reply_markup: markup });

/* ---------------- ПЛАН ДНЯ ---------------- */
const SCOUT_TASK = (ch, date, month, dir, hint, want) => `Найди ${want} кандидатов на темы дня для канала «${ch.name}» (${date}): из них один станет роликом Shorts и два Telegram-постами, поэтому темы должны быть РАЗНЫМИ по смыслу. ${ch.brief}
Цель: максимально широкая аудитория и АКТУАЛЬНОСТЬ СЕЙЧАС (${month}): что сейчас обсуждают, новые исследования и новости, сезонные темы, вирусные утверждения. УЖЕ ЕСТЬ, НЕ ПОВТОРЯТЬ: список в файле ${path.join(dir, 'used_topics.txt')}, прочитай его первым действием; повтор это и та же мысль другими словами.${hint ? `\nПожелание Ника: ${hint}` : ''}
С помощью веб-поиска и чтения страниц: что реально спрашивают, что собирает просмотры у русскоязычных каналов, для каждой темы сильный первоисточник с однозначным ответом (научные организации, ведомства, оригинальные исследования); без источника тему не включай.
${VIKTOR_DEMAND_RULES}
Формат файла: JSON-массив объектов {"title":"тема вопросом","rubric":"myth","why_massive":"почему массовая и почему сейчас","evidence":[{"source","url","finding"}],"clear_answer":true,"queries":["2-3 формулировки из 2+ слов, как ищут люди"],"wiki_article":"название статьи Википедии или пустая строка"}.`;

export async function studioPlan(chKey, { date, hint = '', deps = makeDeps() } = {}) {
  const ch = deps.channels()[chKey]; if (!ch) throw new Error(`канал «${chKey}» не подключён к студии`);
  date = date || S.mskDate(deps.now());
  const had = S.loadPlan(date, chKey);
  if (had && had.status === 'approved') { await deps.notify(`План на ${date} для «${ch.name}» уже утверждён и в работе, новых тем не ищу.`); return { plan: had, kept: true }; }   // до поиска: исследование на Opus не тратим зря
  const dir = path.join(S.studioDir(), 'runs', `${date}_${chKey}_plan_${deps.now().toString(36)}`); fs.mkdirSync(dir, { recursive: true });
  const used = await deps.usedTopics(ch); const taken = [...new Set([...used.all, ...S.plannedTitles(chKey, { now: deps.now() })])];
  fs.writeFileSync(path.join(dir, 'used_topics.txt'), taken.join('\n'), 'utf8');
  const month = new Date(deps.now()).toLocaleString('ru-RU', { month: 'long', year: 'numeric' }), cand = path.join(dir, 'candidates.json');
  await deps.agent('studio_chief', 'working', `Собираю план дня: «${ch.name}»`, 10, `План дня ${date}: «${ch.name}»`);
  await deps.agent('tg_scout', 'working', 'Ищу темы и первоисточники', 20, `Поиск тем дня для «${ch.name}»`);
  let fresh = [], dropped = [], rounds = 0; const seen = [...taken];
  while (fresh.length < 8 && rounds < 2) {                                // второй круг, только если после отсева тем мало
    rounds++;
    await deps.runAgent({ label: 'scout', agentId: 'tg_scout', profile: 'studio_research', outFile: cand, persona: await deps.promptOf('tg_scout'), task: SCOUT_TASK(ch, date, month, dir, rounds > 1 ? `${hint} Прошлый круг дал мало новых тем: расширь поиск, не повторяя найденное.`.trim() : hint, 12), maxTurns: 70, budgetSec: 1500 });
    const got = readJson(cand); if (!Array.isArray(got) || !got.length) { if (rounds > 1) break; continue; }
    const sp = splitNew(got, seen); dropped.push(...sp.dropped);
    for (const c of sp.fresh) { fresh.push(c); seen.push(c.title); }
  }
  fresh = fresh.filter((c) => c && c.title && c.clear_answer !== false && Array.isArray(c.evidence) && c.evidence.length);
  if (fresh.length < 3) {
    await deps.agent('tg_scout', 'idle', 'Мало новых тем', 0, `Нашёл только ${fresh.length} подходящих тем`); await deps.agent('studio_chief', 'idle', 'План не собран: мало тем', 0);
    await deps.notify(`📅 План дня · «${ch.name}»: новых тем с первоисточниками набралось ${fresh.length} из трёх нужных (отсеяно похожих на прежние: ${dropped.length}). Плана на ${date} нет. Подскажите направление в чате или нажмите «Повторить».`, [[['Повторить', `splan:${chKey}:${date}:more`]]]);
    return { plan: null, fresh };
  }
  await deps.agent('tg_scout', 'working', 'Замеряю спрос на YouTube', 60, 'Замер спроса: YouTube, Википедия, подсказки, тренды');
  const demands = await deps.measureAll(fresh);
  const withDemand = fresh.map((c, i) => ({ ...c, demand: demandForPrompt(demands[i]) ? { ...demandForPrompt(demands[i]), reach: demands[i].reach } : null, demand_line: demands[i].line }));
  fs.writeFileSync(path.join(dir, 'demand.json'), JSON.stringify(withDemand.map((c) => ({ title: c.title, demand: c.demand })), null, 1), 'utf8');
  await deps.agent('tg_scout', 'idle', 'Темы переданы Марии', 100, `Нашёл ${fresh.length} тем, спрос измерен`);
  const picks = S.pickDayTopics(withDemand, { taken });
  if (picks.missing > 0) {
    await deps.agent('studio_chief', 'idle', 'План не собран: темы совпадают', 0);
    await deps.notify(`📅 План дня · «${ch.name}»: из ${fresh.length} тем после проверки на повторы внутри дня получилось только ${3 - picks.missing} из трёх разных. Нажмите «Повторить», найду ещё.`, [[['Повторить', `splan:${chKey}:${date}:more`]]]);
    return { plan: null, fresh };
  }
  const prev = S.loadPlan(date, chKey);
  if (prev && prev.status === 'approved') return { plan: prev, kept: true };       // утвердили, пока шёл поиск: не затираем
  if (prev) S.archivePlan(prev);                                       // прежний план дня остаётся в архиве: его темы «заняты», Ник их уже видел
  const plan = S.buildPlan({ date, channel: chKey, picks, slots: ch.slots, now: deps.now() }); plan.run_dir = dir;
  S.savePlan(plan);
  const text = S.planCardText(plan, ch.name, { dropped: dropped.length });
  await deps.say('studio_chief', `План на ${date}: ролик «${S.slotOf(plan, 'video').title}», посты «${S.slotOf(plan, 'post1').title}» и «${S.slotOf(plan, 'post2').title}».`);
  const id = await deps.notify(text, S.planButtons(plan));
  await deps.agent('studio_chief', 'waiting', 'План дня ждёт вашего «да»', 100, `Карточка плана на ${date}`);
  return { plan, card: id, dir };
}

/** Ответ Ника на карточку плана. */
export async function studioPlanAct(chKey, date, action, { deps = makeDeps(), comment = '' } = {}) {
  const ch = deps.channels()[chKey]; const plan = S.loadPlan(date, chKey);
  if (!ch || !plan) { await deps.notify(`План дня ${date} для «${chKey}» не найден: нечего ${action === 'ok' ? 'утверждать' : 'менять'}.`); return { ok: false }; }
  if (action === 'skip') { plan.status = 'skipped'; for (const s of plan.slots) s.status = 'dropped'; S.savePlan(plan); await deps.agent('studio_chief', 'idle', 'День пропущен', 0); await deps.notify(`Хорошо, ${date} пропускаем: ни постов, ни ролика по плану не будет.`); return { ok: true }; }
  if (action === 'more') { for (const s of plan.slots) s.status = 'dropped'; plan.status = 'replaced'; S.savePlan(plan); await deps.notify('Хорошо, ищу другие три темы. План пришлю сюда.', null); deps.spawn(['plan', chKey, '--date', date, '--hint', comment || 'другие темы, не повторяя уже предложенные']); return { ok: true }; }
  if (plan.status === 'approved') { await deps.notify('План на этот день уже утверждён и в работе, второй раз не запускаю.'); return { ok: false }; }
  if (plan.status !== 'proposed') { await deps.notify(`Этот план уже ${plan.status === 'skipped' ? 'пропущен' : 'заменён другим'}: утверждать нечего.`); return { ok: false }; }
  plan.status = 'approved'; plan.approved_at = deps.now();
  const video = S.slotOf(plan, 'video');
  // ролик: тема уходит Ксении так же, как при выборе темы кнопкой (строка «scored» в базе ролика, дальше обычный сценарий → Вера → «да» → монтаж)
  const notes = JSON.stringify({ source: 'studio', studio: { channel: chKey, date, slot: 'video', slot_at: video.at, slot_time: video.time }, channel: chKey, plan_date: date, evidence: video.evidence, why_massive: video.why, demand_line: video.demand_line, demand: video.demand, queries: video.queries, recommendation: 'взять' });
  const { id } = await deps.api('/api/video', { title: video.title, rubric: video.rubric || 'myth', stage: 'script', score: Math.round(Number(video.demand && video.demand.reach) || 0), notes });
  video.videoId = id; video.status = 'script';
  for (const s of plan.slots) if (s.kind === 'post') s.status = 'queued';
  S.savePlan(plan);
  deps.spawnScript(id); deps.spawn(['posts', chKey, date]);
  await deps.agent('studio_chief', 'idle', 'План утверждён', 100, `План ${date} утверждён`);
  const p1 = S.slotOf(plan, 'post1'), p2 = S.slotOf(plan, 'post2');
  await deps.notify(`План на ${date} принят.\n🎬 Ролик ${video.time}: «${video.title}». Ксения пишет сценарий, Вера проверит, дальше как обычно: сценарий придёт вам на утверждение.\n📝 Пост ${p1.time}: «${p1.title}»\n📝 Пост ${p2.time}: «${p2.title}»\nПосты Дарья напишет, Павел проверит, Диана нарисует обложку; каждый пост придёт вам превью с кнопкой «Поставить на ${p1.time.slice(0, 5)}» (в эфир только после вашего «да»).`);
  return { ok: true, videoId: id };
}

/* ---------------- ПОСТЫ ---------------- */
const VOICE_FILE = (chKey) => path.join(S.studioDir(), 'channels', `${chKey}.md`);
const channelVoice = (chKey, ch) => { try { return fs.readFileSync(VOICE_FILE(chKey), 'utf8'); } catch { return `Голос канала: ${ch.brief}`; } };
const rules = () => path.join(S.studioDir(), 'post_rules.md');

const AUTHOR_TASK = (ch, chKey, slot, dir, outFile, extra) => `Напиши пост для Telegram-канала «${ch.name}» (https://t.me/${ch.tg}) на тему «${slot.title}».
ПРОЧИТАЙ ПЕРВЫМ ДЕЛОМ: ${rules()} (ДОКУМЕНТ 1, универсальные правила) и ${VOICE_FILE(chKey)} (ДОКУМЕНТ 2, голос канала, если файла нет, ориентируйся на «${ch.brief}»).
Материал и первоисточники (бери факты ТОЛЬКО отсюда и из страниц по этим ссылкам): ${JSON.stringify(slot.evidence || [])}
Почему тема: ${slot.why || '—'}
Формат канала: ${ch.postFormat === 'long' ? 'лонгрид' : 'короткий пост до 700 знаков (выйдет подписью к фото)'}. CTA-ПОДПИСКА: заверши пост мягким призывом с кликабельной ссылкой [текст призыва](https://t.me/${ch.tg}) ПОСЛЕ смыслового аккорда. Строка «🔬 Источники:» с 2-3 ссылками из РАЗНЫХ доменов вида [название](url), или без неё, если независимых первоисточников нет. Хук первой строкой жирным (**так**).${extra ? `\n${extra}` : ''}
Формат файла ${outFile}: JSON {"text":"готовый пост (markdown: **жирный**, [текст](url))","cover_brief":{"scene":"что нарисовать, по-английски, 1-2 предложения","mood":"настроение","text_on_image":"короткий текст на обложке до 40 знаков или пустая строка"},"hook_type":"какой хук"}.`;
const EDITOR_TASK = (ch, chKey, slot, textFile, outFile) => `Проверь пост из файла ${textFile} (поле text) для канала «${ch.name}». Тема: «${slot.title}». Первоисточники: ${JSON.stringify(slot.evidence || [])}.
Прочитай ${rules()} и ${VOICE_FILE(chKey)}. Проверь: 1) СМЫСЛ каждого утверждения против первоисточников (не приписывай источнику больше, чем в нём сказано; открой страницы источников), 2) правила поста и голос канала, 3) приметы ИИ-текста (штампы, пустые вводные, перебор эмодзи), 4) пост не повторяет прежние темы канала.
Исправь мелочи сам и верни исправленный текст; если нужно переписывание (неверный факт, нет хука, не та мысль), верни verdict "rework" с конкретными правками для автора.
Формат файла ${outFile}: JSON {"verdict":"ok|rework","text":"текст после твоих мелких правок","issues":["что не так, по пунктам"],"facts_ok":true/false}.`;

export async function studioPost(chKey, date, slotName, { comment = '', deps = makeDeps() } = {}) {
  const ch = deps.channels()[chKey]; const plan = S.loadPlan(date, chKey); const slot = plan && S.slotOf(plan, slotName);
  if (!ch || !slot || slot.kind !== 'post') throw new Error(`нет поста ${slotName} в плане ${date} «${chKey}»`);
  if (['published', 'dropped'].includes(slot.status)) { await deps.notify(`Пост ${slot.time} «${slot.title}» уже ${slot.status === 'published' ? 'опубликован' : 'снят'}, второй раз не делаю.`); return { ok: false }; }
  const dir = postDir(date, chKey, slotName); fs.mkdirSync(dir, { recursive: true });
  const medical = /медиц|здоров|врач/i.test(`${ch.name} ${ch.brief}`);
  const opts = { handle: ch.tg, format: ch.postFormat, medical };
  S.updateSlot(date, chKey, slotName, { status: 'writing' });
  await deps.agent('tg_author', 'working', `Пишу пост ${slot.time}: ${slot.title}`.slice(0, 80), 15, `Пост ${slot.time} «${slot.title}»`);
  let text = '', brief = {}, notes = [], round = 0, ok = false, last = null;
  const outA = path.join(dir, 'draft.json'), outE = path.join(dir, 'review.json');
  while (round < 3 && !ok) {
    round++;
    const extra = [comment && round === 1 ? `ПРАВКА НИКА: ${comment}` : '', last ? `ПРОШЛАЯ ВЕРСИЯ вернулась с замечаниями, исправь их и ничего не ломай:\n- ${last.join('\n- ')}\nПрошлый текст:\n${text}` : ''].filter(Boolean).join('\n');
    await deps.runAgent({ label: `author${round}`, agentId: 'tg_author', profile: 'studio_text', outFile: outA, persona: await deps.promptOf('tg_author'), task: AUTHOR_TASK(ch, chKey, slot, dir, outA, extra), maxTurns: 40, budgetSec: 900 });
    const d = readJson(outA); if (!d || !d.text) { last = ['файл с постом не получен или пустой: верни JSON строго по формату']; continue; }
    text = P.fixPunctuation(String(d.text).trim()); brief = d.cover_brief || brief;
    const code = P.postIssues(text, opts);
    if (code.length) { last = code.map((i) => i.msg); if (round >= 3) break; continue; }       // дешёвая проверка кодом раньше редактора-модели
    await deps.agent('tg_author', 'idle', 'Пост передан редактору', 100); await deps.agent('tg_editor', 'working', 'Сверяю смысл с источниками и правила', 40, `Проверка поста ${slot.time}`);
    fs.writeFileSync(path.join(dir, 'candidate.json'), JSON.stringify({ text }), 'utf8');
    await deps.runAgent({ label: `editor${round}`, agentId: 'tg_editor', profile: 'studio_text', outFile: outE, persona: await deps.promptOf('tg_editor'), task: EDITOR_TASK(ch, chKey, slot, path.join(dir, 'candidate.json'), outE), maxTurns: 40, budgetSec: 900 });
    const e = readJson(outE);
    if (e && e.verdict === 'ok' && e.facts_ok !== false) { const fixed = P.fixPunctuation(String(e.text || text).trim()); const after = P.postIssues(fixed, opts); text = after.length ? text : fixed; notes = e.issues || []; ok = true; }
    else { last = (e && Array.isArray(e.issues) && e.issues.length) ? e.issues : ['редактор не вернул заключение: проверь факты по источникам']; if (e && e.text) text = P.fixPunctuation(String(e.text).trim()); }
  }
  await deps.agent('tg_editor', 'idle', 'Проверка закончена', 100);
  if (!ok) {
    S.updateSlot(date, chKey, slotName, { status: 'failed', last_issues: last });
    await deps.agent('tg_author', 'error', 'Пост не прошёл проверку', 0, `Пост ${slot.time}: ${last.join('; ').slice(0, 160)}`, 'error');
    await deps.notify(`⚠️ Пост ${slot.time} «${slot.title}» не прошёл проверку за три круга. Что осталось:\n- ${last.slice(0, 5).join('\n- ')}\nМожно дать правку в ответе (напишите, что исправить) или снять пост.`, [[['🔁 Ещё раз', `spost:${chKey}:${date}:${slotName}:edit`], ['🗑 Снять пост', `spost:${chKey}:${date}:${slotName}:drop`]]]);
    return { ok: false, issues: last };
  }
  // обложка
  let cover = null, coverNote = '';
  await deps.agent('tg_artist', 'working', 'Рисую обложку', 30, `Обложка поста ${slot.time}`);
  const budget = imageBudget({ file: path.join(S.studioDir(), 'image_count.json'), day: date });
  if (!budget.left) coverNote = `суточный лимит картинок (${budget.max}) исчерпан`;
  else for (let attempt = 1; attempt <= 2 && !cover; attempt++) {
    budget.take();
    const r = await deps.generateCover({ prompt: P.coverPrompt(brief, { palette: ch.palette || '', styleClause: ch.coverStyle || '' }), outFile: path.join(dir, 'cover.jpg') });
    if (r.ok) cover = r.file; else coverNote = r.error;
    if (!cover && /ключ|средств/.test(coverNote)) break;      // повтор не поможет
  }
  await deps.agent('tg_artist', 'idle', cover ? 'Обложка готова' : 'Обложки нет', 100, cover ? 'Обложка готова' : `Обложки нет: ${coverNote}`, cover ? undefined : 'warn');
  const html = P.toTgHtml(text);
  fs.writeFileSync(path.join(dir, 'post.json'), JSON.stringify({ text, html, cover, brief, notes, slot: slotName, date, channel: chKey }, null, 1), 'utf8');
  S.updateSlot(date, chKey, slotName, { status: 'preview', cover, text_file: path.join(dir, 'post.json') });
  // превью: тот же вид, что выйдет в канале (фото + подпись или текст), затем карточка с кнопками
  const shape = P.publishShape(text, !!cover);
  const hm = slot.time.slice(0, 5);
  try {
    if (cover && shape.mode === 'photo') await deps.sendPhoto(chatId(), cover, html);
    else { if (cover) await deps.sendPhoto(chatId(), cover, `<b>Обложка</b> · ${slot.title}`.slice(0, 1000)); await deps.sendText(chatId(), html); }
  } catch (e) { await deps.say('tg_publisher', 'Превью в Telegram не ушло: ' + String(e.message).slice(0, 120)); }
  const head = `📝 Пост ${hm} готов: «${slot.title}»\nДарья написала, Павел проверил${notes.length ? ` (замечания учтены: ${notes.slice(0, 2).join('; ').slice(0, 160)})` : ''}.${cover ? ' Обложка Дианы выше.' : `\n⚠️ Обложки нет: ${coverNote}. Можно выйти без неё или повторить.`}\nПревью выше выглядит так же, как выйдет в канале (${shape.mode === 'photo' ? 'фото с подписью' : shape.mode === 'photo_then_text' ? 'обложка и текст отдельными сообщениями' : 'текст'}). Выйдет сам в ${hm} МСК после вашего «да».`;
  const id = await deps.notify(head, [[[`✅ Поставить на ${hm}`, `spost:${chKey}:${date}:${slotName}:ok`], ['✏️ Править', `spost:${chKey}:${date}:${slotName}:edit`]], [['🗑 Убрать пост', `spost:${chKey}:${date}:${slotName}:drop`]]]);
  await deps.agent('tg_author', 'waiting', `Пост ${hm} ждёт вашего «да»`, 100);
  return { ok: true, card: id, cover, text };
}

/** Оба поста дня по очереди (подписка Claude: сначала первый слот, потом второй; параллельно не гоним). */
export async function studioPosts(chKey, date, { deps = makeDeps() } = {}) {
  const plan = S.loadPlan(date, chKey); if (!plan) throw new Error(`нет плана ${date} «${chKey}»`);
  const res = [];
  for (const slot of plan.slots.filter((s) => s.kind === 'post').sort((a, b) => a.at - b.at)) {
    const cur = S.slotOf(S.loadPlan(date, chKey), slot.slot); if (['preview', 'approved', 'published', 'dropped'].includes(cur.status)) continue;
    try { res.push(await studioPost(chKey, date, slot.slot, { deps })); } catch (e) { await deps.notify(`⚠️ Пост ${slot.time} «${slot.title}»: ${String(e.message).slice(0, 200)}`); res.push({ ok: false, error: e.message }); }
  }
  return res;
}

/** Ответ Ника на превью поста. */
export async function studioPostAct(chKey, date, slotName, action, { deps = makeDeps(), comment = '' } = {}) {
  const plan = S.loadPlan(date, chKey); const slot = plan && S.slotOf(plan, slotName);
  if (!slot) { await deps.notify('Этот пост не найден (план мог измениться).'); return { ok: false }; }
  const hm = slot.time.slice(0, 5);
  if (action === 'drop') { S.updateSlot(date, chKey, slotName, { status: 'dropped' }); await deps.agent('tg_author', 'idle', 'Пост снят', 0); await deps.notify(`Пост ${hm} «${slot.title}» снят, в канал не выйдет.`); return { ok: true }; }
  if (action === 'edit') {
    if (!comment || !comment.trim()) { await deps.notify(`Что исправить в посте ${hm}? Напишите правку одним сообщением, я передам Дарье.`, null); return { ok: true, pending: 'comment' }; }
    deps.spawn(['post', chKey, date, slotName, '--comment', comment.trim()]); await deps.notify(`Принято, Дарья поправит пост ${hm}: «${comment.trim().slice(0, 160)}». Новое превью пришлю сюда.`); return { ok: true };
  }
  if (slot.status === 'approved') { await deps.notify(`Пост ${hm} уже стоит в расписании.`); return { ok: true }; }
  if (slot.status !== 'preview') { await deps.notify(`Пост ${hm} сейчас в статусе «${slot.status}», утверждать нельзя: ${slot.status === 'published' ? 'он уже вышел' : slot.status === 'dropped' ? 'он снят' : 'он ещё не прошёл проверку'}.`); return { ok: false }; }
  S.updateSlot(date, chKey, slotName, { status: 'approved', approved_at: deps.now() });
  const late = slot.at < deps.now();
  await deps.agent('tg_publisher', 'waiting', `Ждёт ${hm}: «${slot.title}»`.slice(0, 80), 0, `Пост ${hm} в расписании`);
  await deps.agent('tg_author', 'idle', 'Пост утверждён', 0);
  await deps.notify(late ? `Пост ${hm} утверждён, но время слота уже прошло: выйдет в течение минуты. Если не нужно, «Убрать» не успеет, напишите сразу.` : `Пост ${hm} «${slot.title}» стоит в расписании: Григорий выложит его в канал ровно в ${hm} МСК.`);
  return { ok: true, late };
}

/* ---------------- ПУБЛИКАЦИЯ ПО РАСПИСАНИЮ ---------------- */
export async function studioPublishDue({ deps = makeDeps() } = {}) {
  const now = deps.now(), due = S.dueSlots(now).filter((d) => deps.channels()[d.chKey]), done = [];
  for (const d of due) {
    const ch = deps.channels()[d.chKey], plan = S.loadPlan(d.date, d.chKey), slot = S.slotOf(plan, d.slot);
    const post = readJson(slot.text_file); if (!post) { S.updateSlot(d.date, d.chKey, d.slot, { status: 'failed', error: 'нет файла поста' }); await deps.notify(`⚠️ Пост ${slot.time} «${slot.title}» не вышел: нет файла поста.`); continue; }
    S.updateSlot(d.date, d.chKey, d.slot, { status: 'publishing', attempts: (slot.attempts || 0) + 1 });        // до отправки: сбой посреди не приведёт к двойной публикации
    await deps.agent('tg_publisher', 'working', `Выкладываю пост ${slot.time}`, 50, `Публикация поста ${slot.time} в @${ch.tg}`);
    try {
      const chat = '@' + ch.tg; let msg;
      const shape = P.publishShape(post.text, !!(post.cover && fs.existsSync(post.cover)));
      if (shape.mode === 'photo') msg = await deps.sendPhoto(chat, post.cover, shape.html);
      else { if (shape.mode === 'photo_then_text') await deps.sendPhoto(chat, post.cover, `<b>${post.text.split('\n')[0].replace(/\*\*/g, '')}</b>`.slice(0, 1000)); msg = await deps.sendText(chat, shape.html); }
      const id = msg && (msg.message_id || msg.id);
      S.updateSlot(d.date, d.chKey, d.slot, { status: 'published', published_at: deps.now(), message_id: id || null });
      await deps.agent('tg_publisher', 'idle', `Пост ${slot.time} выложен`, 100, `Пост ${slot.time} опубликован в @${ch.tg}`);
      await deps.notify(`✅ Пост ${slot.time} «${slot.title}» опубликован в @${ch.tg}${id ? `: https://t.me/${ch.tg}/${id}` : ''}`); done.push(d);
    } catch (e) {
      const tries = (S.slotOf(S.loadPlan(d.date, d.chKey), d.slot).attempts) || 1;
      S.updateSlot(d.date, d.chKey, d.slot, { status: tries >= 3 ? 'failed' : 'approved', error: String(e.message).slice(0, 200), retry_at: deps.now() + 2 * 60e3 });
      await deps.agent('tg_publisher', 'error', 'Публикация не удалась', 0, `Пост ${slot.time}: ${String(e.message).slice(0, 140)}`, 'error');
      if (tries === 1 || tries >= 3) await deps.notify(`⚠️ Пост ${slot.time} «${slot.title}» не вышел в @${ch.tg}: ${String(e.message).slice(0, 200)}${/chat not found|not enough rights|admin/i.test(e.message) ? '\nПохоже, бот не админ канала с правом публикации.' : ''}${tries >= 3 ? '\nБольше не повторяю: пост остался в плане со статусом «не вышел».' : '\nПовторю через 2 минуты.'}`);
    }
  }
  return { due: due.length, done: done.length };
}

/* ---------------- вход из smm_pipeline.mjs ---------------- */
export async function runStudio(argv, deps = makeDeps()) {
  const [stage, a, b, c, d] = argv, rest = argv.slice(1), opt = (k) => { const i = rest.indexOf(k); return i >= 0 ? rest[i + 1] : ''; };
  if (stage === 'plan') return studioPlan(a, { date: opt('--date') || undefined, hint: opt('--hint'), deps });
  if (stage === 'plan-act') return studioPlanAct(a, b, c, { deps, comment: opt('--comment') });
  if (stage === 'posts') return studioPosts(a, b, { deps });
  if (stage === 'post') return studioPost(a, b, c, { comment: opt('--comment'), deps });
  if (stage === 'post-act') return studioPostAct(a, b, c, d, { deps, comment: opt('--comment') });
  if (stage === 'publish-due') return studioPublishDue({ deps });
  throw new Error('Команды studio: plan <канал> | plan-act <канал> <дата> ok|more|skip | posts <канал> <дата> | post <канал> <дата> <слот> | post-act … | publish-due');
}

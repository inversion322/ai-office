// Публикатор (Пётр Выкладов): выкладывает принятый ролик в YouTube Shorts ПО КНОПКЕ Ника. Без модели: действия детерминированные, ничего не придумывается.
// Ничего не публикуется без нажатия кнопки «publish:<id>:<режим>» в карточке (решение Ника: автопубликации без согласования нет).
// Режимы: ytp = YouTube, приватная проверка (видно только вам в YouTube Studio); yt = YouTube Shorts, публично;
// yts = выход по слоту очереди вариантов (варианты одной темы выходят с интервалом 30 минут: загрузка сразу, YouTube сам выложит в назначенное время).
// Один ролик не уходит дважды: состояние в smm/runs/video_N/publish.json.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, agent, say, notify, getVideo, videos, readJson } from './smm_lib.mjs';
import { variantOf, groupMembers, publishOrder, slotFor, hhmm, GAP_MIN, MIN_AHEAD_MIN, FORMATS } from './variants.mjs';
import { probeVideo, checkFormat } from './video_format.mjs';
import { ytStatus, buildMetadata, uploadVideo, YtError } from './youtube.mjs';

export const stateFile = (id) => path.join(ROOT, 'smm', 'runs', `video_${Number(id)}`, 'publish.json');
export const loadState = (id) => readJson(stateFile(id)) || {};
const saveState = (id, s) => { fs.mkdirSync(path.dirname(stateFile(id)), { recursive: true }); fs.writeFileSync(stateFile(id), JSON.stringify(s, null, 1), 'utf8'); };
const safe = (p) => Promise.resolve(p).catch(() => {});

/* ---------- очередь выхода вариантов одной темы ---------- */
const planFile = (group) => path.join(ROOT, 'smm', 'runs', `video_${Number(group)}`, 'publish_plan.json');
export const loadPlan = (group) => readJson(planFile(group)) || {};
const savePlan = (group, p) => { fs.mkdirSync(path.dirname(planFile(group)), { recursive: true }); fs.writeFileSync(planFile(group), JSON.stringify(p, null, 1), 'utf8'); };
/** Очередь группы для ролика id: порядок, слоты, кто уже вышел. null, если ролик не вариант или он единственный живой. */
export async function queueInfo(id, now = Date.now()) {
  const v = await getVideo(id), vr = variantOf(v); if (!vr) return null;
  const mem = groupMembers(await videos(), v).filter((m) => m.stage !== 'rejected'); if (mem.length < 2) return null;
  const a = mem.find((m) => (variantOf(m) || {}).letter === 'A') || mem[0], rot = (variantOf(a) || vr).rotation || 0;
  const letters = mem.map((m) => variantOf(m).letter), order = publishOrder(rot).filter((l) => letters.includes(l));
  const plan = loadPlan(vr.group), rows = order.map((L) => { const m = mem.find((x) => variantOf(x).letter === L), st = loadState(m.id), out = (st.youtube || []).find((x) => x.privacy === 'public' || x.scheduledFor);
    return { letter: L, id: m.id, stage: m.stage, published: !!out, at: slotFor(order, L, plan.start) }; });
  const mine = rows.find((r) => r.id === Number(id));
  return { group: vr.group, order, rows, start: plan.start || null, mine, slot: mine && mine.at, ahead: mine && mine.at ? (mine.at.getTime() - now) / 60e3 : null };
}
const STAGE_RU = { script: 'пишется', checked: 'ждёт утверждения', editing: 'монтируется', produced: 'ждёт вашей приёмки', approved: 'принят', published: 'вышел' };
/** Текст про очередь для карточек названия и публикации. */
export function queueText(q) {
  if (!q) return '';
  const parts = q.rows.map((r) => `${r.letter}${r.at ? ' ' + hhmm(r.at) : ''} (${r.published ? 'вышел' : STAGE_RU[r.stage] || r.stage})`);
  return `🎞 Вариант ${q.mine.letter}. Очередь выхода варианта этой темы: ${parts.join(' → ')}, интервал ${GAP_MIN} минут.${q.start ? '' : ' Время слотов задаст выход первого: как только он выйдет, на карточках остальных появится кнопка «Запланировать» (YouTube сам выложит в срок).'}`;
}

/** Название и хэштеги из пакета Тимофея: publish_meta.json (точный выбор), иначе package.json (лучший вариант). */
export function loadPublishMeta(id) {
  const dir = path.join(ROOT, 'smm', 'runs', `package_${Number(id)}`);
  const m = readJson(path.join(dir, 'publish_meta.json')); if (m && m.title) return { title: m.title, cleanTitle: m.clean_title || m.title, titleTags: m.title_tags || [], tags: m.tags || [], videoTitle: m.video_title || '', manual: !!m.manual };
  const j = readJson(path.join(dir, 'package.json')); if (!j || !Array.isArray(j.titles) || !j.titles.length) return null;
  const i = Math.max(0, Math.min(j.titles.length - 1, (Number(j.best) || 1) - 1));
  const ti = String(j.titles[i].title || '').trim(); return { title: ti, cleanTitle: ti, titleTags: [], tags: (j.hashtags || []).slice(0, 5), videoTitle: '' };
}
const sourcesOf = (id) => { const j = readJson(path.join(ROOT, 'smm', 'runs', `video_${Number(id)}`, 'script.json')); return j && Array.isArray(j.sources_card) ? j.sources_card.slice(0, 6) : []; };
const fileOf = (v) => (v && v.video_path ? path.resolve(ROOT, String(v.video_path).replaceAll('\\', '/')) : null);

/** Проверки ДО загрузки. Возвращает { ok, problems[], file, meta, v } */
export async function preflight(id, mode) {
  const problems = [], v = await getVideo(id);
  if (!v) return { ok: false, problems: ['нет такого ролика'] };
  if (v.stage !== 'approved') problems.push(`ролик ещё не принят вами (этап «${v.stage}»): публикуются только принятые`);
  const file = fileOf(v); if (!file || !fs.existsSync(file)) problems.push('нет файла ролика (' + (v.video_path || 'путь не записан') + ')');
  else { try { problems.push(...checkFormat(probeVideo(file)).problems.map((p) => 'формат: ' + p)); } catch (e) { problems.push('не удалось проверить формат файла: ' + String(e.message).slice(0, 120)); } }
  const meta = loadPublishMeta(id); if (!meta) problems.push('нет пакета публикации (название и хэштеги от Тимофея)');
  const st = ytStatus(); if (!st.ready) problems.push(!st.client ? 'YouTube не подключён: нет ключа OAuth-клиента (server/data/youtube_client.json)' : 'YouTube не подключён: нет разрешения (запустите node scripts/youtube_auth.mjs на ПК)');
  const had = (loadState(id).youtube || []).find((x) => mode === 'ytp' ? x.privacy === 'private' && !x.scheduledFor : (x.privacy === 'public' || x.scheduledFor));
  if (had) problems.push(`уже загружено ${had.scheduledFor ? 'с отложенным выходом' : mode === 'ytp' ? 'для проверки' : 'публично'}: ${had.url}`);
  return { ok: problems.length === 0, problems, file, meta, v };
}

export async function publishYouTube(id, mode = 'ytp', { when } = {}) {
  let slotNote = '';
  if (mode === 'yts') {         // выход по слоту очереди: слот берётся из плана группы; близкий или прошедший слот значит «публикуем сейчас»
    const q = await queueInfo(id); const s = q && q.slot;
    if (s && q.ahead >= MIN_AHEAD_MIN) when = s.toISOString(); else { mode = 'yt'; slotNote = s ? ` (слот ${hhmm(s)} уже наступил или слишком близко: публикую сразу)` : ' (слот ещё не определён: публикую сразу)'; }
  }
  const privacy = mode === 'yt' ? 'public' : 'private';
  await safe(agent('publisher', 'working', `Проверяю ролик №${id} перед загрузкой`, 10, `Публикация ролика №${id} в YouTube (${privacy === 'public' ? 'публично' : 'приватная проверка'})`));
  const pf = await preflight(id, mode);
  if (!pf.ok) {
    await safe(agent('publisher', 'error', 'Публикация не началась', 0, pf.problems.join('; ').slice(0, 200), 'error'));
    await notify(`⚠️ Публикатор: ролик №${id} НЕ загружен в YouTube.\n- ${pf.problems.join('\n- ')}`); return { ok: false, problems: pf.problems };
  }
  try {
    await safe(say('publisher', `Загружаю «${pf.meta.title}» в YouTube (${privacy === 'public' ? 'публично' : 'приватная проверка'}), ${(fs.statSync(pf.file).size / 1048576).toFixed(1)} МБ.`));
    await safe(agent('publisher', 'working', `Загружаю ролик №${id} в YouTube`, 40, 'Идёт загрузка', 'info'));
    const meta = buildMetadata({ title: pf.meta.title, videoTitle: pf.meta.videoTitle || pf.v.title, tags: pf.meta.tags, sources: sourcesOf(id), privacy, publishAt: when });
    const r = await uploadVideo({ file: pf.file, meta });
    const st = loadState(id); st.youtube = [...(st.youtube || []), { id: r.id, url: r.url, privacy: meta.status.privacyStatus, title: meta.snippet.title, ts: new Date().toISOString(), file: path.relative(ROOT, pf.file), ...(when ? { scheduledFor: new Date(when).toISOString() } : {}) }]; saveState(id, st);
    // первый вышедший ролик группы задаёт старт очереди: остальные варианты получают слоты от него с интервалом 30 минут
    try { const vr = variantOf(pf.v); if (vr && !when && meta.status.privacyStatus === 'public' && !loadPlan(vr.group).start) savePlan(vr.group, { ...loadPlan(vr.group), start: Date.now(), first: vr.letter }); } catch {}
    await safe(agent('publisher', 'idle', `Ролик №${id} загружен в YouTube`, 100, `YouTube: ${r.url} (${meta.status.privacyStatus})`));
    await safe(say('publisher', `Готово: ${r.url}`));
    if (when) await notify(`🕐 Ролик №${id} загружен и запланирован на ${hhmm(when)} (МСК): ${r.url}\nНазвание: «${meta.snippet.title}». YouTube сам выложит его в назначенное время, больше ничего нажимать не нужно.`);
    else if (meta.status.privacyStatus === 'public') await notify(`✅ Ролик №${id} опубликован в YouTube Shorts: ${r.url}${slotNote}\nНазвание: «${meta.snippet.title}»`);
    else { await notify(`🧪 Ролик №${id} загружен в YouTube как ПРИВАТНЫЙ (виден только вам): ${r.url}\nОткройте в YouTube Studio и проверьте название, описание и то, что он определился как Short. Если всё хорошо, нажмите «Опубликовать» (загрузится вторая, публичная копия; приватную можно удалить в Studio).`); await publishCard(id, { only: 'yt' }); }
    return { ok: true, ...r };
  } catch (e) {
    const msg = e instanceof YtError ? e.message : 'неожиданная ошибка: ' + String(e && e.message || e).slice(0, 200);
    await safe(agent('publisher', 'error', 'Загрузка в YouTube не удалась', 0, msg.slice(0, 200), 'error'));
    await notify(`⚠️ Публикатор: ролик №${id} НЕ загружен в YouTube.\n${msg}${e instanceof YtError && e.reauth ? '\nНужно переподключить YouTube на ПК: node scripts/youtube_auth.mjs --open' : e instanceof YtError && e.retry ? '\nЭто сбой связи, можно нажать кнопку ещё раз.' : ''}`);
    return { ok: false, problems: [msg], error: e };
  }
}

/** Карточка публикации: главная кнопка «опубликовать», рядом приватная проверка; ниже можно поменять название. only: 'yt' | 'ytp' */
export async function publishCard(id, { only } = {}) {
  const v = await getVideo(id); if (!v) throw new Error('нет ролика #' + id);
  const meta = loadPublishMeta(id), st = loadState(id), has = (p) => (st.youtube || []).find((x) => x.privacy === p);
  const sched = (st.youtube || []).find((x) => x.scheduledFor); if (sched) return null;                 // уже загружен с отложенным выходом: нечего публиковать
  const q = await queueInfo(id).catch(() => null);
  const row = []; if (q && q.slot && q.ahead >= MIN_AHEAD_MIN && (!only || only === 'yts')) row.push([`🕐 Запланировать на ${hhmm(q.slot)} (МСК)`, `publish:${id}:yts`]);
  if ((!only || only === 'yt') && !has('public')) row.push([q && q.slot && q.ahead >= MIN_AHEAD_MIN ? '🚀 Опубликовать сейчас' : '🚀 YouTube Shorts: опубликовать', `publish:${id}:yt`]); if ((!only || only === 'ytp') && !has('private') && !has('public')) row.push(['🧪 Приватная проверка', `publish:${id}:ytp`]);
  if (!row.length) return null;
  const text = `🚀 Публикация ролика №${id} «${v.title}»\nНазвание: ${meta ? '«' + meta.title + '»' : '(пакета нет)'}${meta && meta.manual ? ' (ваше)' : ''}\nХэштеги (рекомендация, уйдут в описание YouTube${meta && meta.titleTags && meta.titleTags.length ? '; в названии: ' + meta.titleTags.join(' ') : '; в названии их нет'}): ${meta ? meta.tags.join(' ') : '—'}\n${has('private') ? `Приватная проверка уже загружена: ${has('private').url}\n` : ''}Ничего не публикуется без вашей кнопки. Название можно поменять кнопками ниже.${q ? '\n\n' + queueText(q) : ''}`;
  return notify(text, [row, [['✏️ Своё название', `title:${id}`], ['🔄 Перегенерировать название', `package:${id}`]]]);
}

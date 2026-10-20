// Публикатор (Пётр Выкладов): выкладывает принятый ролик в YouTube Shorts ПО КНОПКЕ Ника. Без модели: действия детерминированные, ничего не придумывается.
// Ничего не публикуется без нажатия кнопки «publish:<id>:<режим>» в карточке (решение Ника: автопубликации без согласования нет).
// Режимы: ytp = YouTube, приватная проверка (видно только вам в YouTube Studio); yt = YouTube Shorts, публично.
// Один ролик не уходит дважды: состояние в smm/runs/video_N/publish.json.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, agent, say, notify, getVideo, readJson } from './smm_lib.mjs';
import { probeVideo, checkFormat } from './video_format.mjs';
import { ytStatus, buildMetadata, uploadVideo, YtError } from './youtube.mjs';

export const stateFile = (id) => path.join(ROOT, 'smm', 'runs', `video_${Number(id)}`, 'publish.json');
export const loadState = (id) => readJson(stateFile(id)) || {};
const saveState = (id, s) => { fs.mkdirSync(path.dirname(stateFile(id)), { recursive: true }); fs.writeFileSync(stateFile(id), JSON.stringify(s, null, 1), 'utf8'); };
const safe = (p) => Promise.resolve(p).catch(() => {});

/** Название и хэштеги из пакета Тимофея: publish_meta.json (точный выбор), иначе package.json (лучший вариант). */
export function loadPublishMeta(id) {
  const dir = path.join(ROOT, 'smm', 'runs', `package_${Number(id)}`);
  const m = readJson(path.join(dir, 'publish_meta.json')); if (m && m.title) return { title: m.title, tags: m.tags || [], videoTitle: m.video_title || '' };
  const j = readJson(path.join(dir, 'package.json')); if (!j || !Array.isArray(j.titles) || !j.titles.length) return null;
  const i = Math.max(0, Math.min(j.titles.length - 1, (Number(j.best) || 1) - 1));
  return { title: String(j.titles[i].title || '').trim(), tags: (j.hashtags || []).slice(0, 5), videoTitle: '' };
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
  const had = (loadState(id).youtube || []).find((x) => x.privacy === (mode === 'yt' ? 'public' : 'private'));
  if (had) problems.push(`уже загружено ${mode === 'yt' ? 'публично' : 'для проверки'}: ${had.url}`);
  return { ok: problems.length === 0, problems, file, meta, v };
}

export async function publishYouTube(id, mode = 'ytp', { when } = {}) {
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
    const st = loadState(id); st.youtube = [...(st.youtube || []), { id: r.id, url: r.url, privacy: meta.status.privacyStatus, title: meta.snippet.title, ts: new Date().toISOString(), file: path.relative(ROOT, pf.file) }]; saveState(id, st);
    await safe(agent('publisher', 'idle', `Ролик №${id} загружен в YouTube`, 100, `YouTube: ${r.url} (${meta.status.privacyStatus})`));
    await safe(say('publisher', `Готово: ${r.url}`));
    if (meta.status.privacyStatus === 'public') await notify(`✅ Ролик №${id} опубликован в YouTube Shorts: ${r.url}\nНазвание: «${meta.snippet.title}»`);
    else { await notify(`🧪 Ролик №${id} загружен в YouTube как ПРИВАТНЫЙ (виден только вам): ${r.url}\nОткройте в YouTube Studio и проверьте название, описание и то, что он определился как Short. Если всё хорошо, нажмите «Опубликовать» (загрузится вторая, публичная копия; приватную можно удалить в Studio).`); await publishCard(id, { only: 'yt' }); }
    return { ok: true, ...r };
  } catch (e) {
    const msg = e instanceof YtError ? e.message : 'неожиданная ошибка: ' + String(e && e.message || e).slice(0, 200);
    await safe(agent('publisher', 'error', 'Загрузка в YouTube не удалась', 0, msg.slice(0, 200), 'error'));
    await notify(`⚠️ Публикатор: ролик №${id} НЕ загружен в YouTube.\n${msg}${e instanceof YtError && e.reauth ? '\nНужно переподключить YouTube на ПК: node scripts/youtube_auth.mjs --open' : e instanceof YtError && e.retry ? '\nЭто сбой связи, можно нажать кнопку ещё раз.' : ''}`);
    return { ok: false, problems: [msg], error: e };
  }
}

/** Карточка с кнопками публикации (только если ролик принят и YouTube подключён). only: 'yt' | 'ytp' */
export async function publishCard(id, { only } = {}) {
  const v = await getVideo(id); if (!v) throw new Error('нет ролика #' + id);
  const meta = loadPublishMeta(id), st = loadState(id), has = (p) => (st.youtube || []).find((x) => x.privacy === p);
  const row = []; if (!only || only === 'ytp') if (!has('private') && !has('public')) row.push(['🧪 YouTube: приватная проверка', `publish:${id}:ytp`]); if (!only || only === 'yt') if (!has('public')) row.push(['🚀 YouTube Shorts: опубликовать', `publish:${id}:yt`]);
  if (!row.length) return null;
  const text = `🚀 Публикация ролика №${id} «${v.title}»\nНазвание: ${meta ? '«' + meta.title + '»' : '(пакета нет)'}\nХэштеги: ${meta ? meta.tags.join(' ') : '—'}\n${has('private') ? `Приватная проверка уже загружена: ${has('private').url}\n` : ''}Ничего не публикуется без вашей кнопки.${has('private') ? '' : ' В первый раз советую «приватная проверка»: ролик увидите только вы.'}`;
  return notify(text, [row]);
}

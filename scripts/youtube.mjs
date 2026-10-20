// Загрузка роликов в YouTube Shorts через официальный YouTube Data API v3 (videos.insert, resumable upload).
// Права: ТОЛЬКО youtube.upload (загрузка; менять и удалять чужие данные канала этот доступ не позволяет).
// Секреты лежат в server/data/ (в .gitignore): youtube_client.json (OAuth-клиент из Google Cloud, кладёт Ник) и youtube_token.json (refresh-токен, создаёт youtube_auth.mjs).
// Токены и ключи нигде не печатаются. Адреса подменяются переменными YT_OAUTH_URL / YT_UPLOAD_URL только в тестах.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = () => process.env.OFFICE_DATA_DIR || path.join(ROOT, 'server', 'data');
export const ytFiles = () => ({ client: path.join(DATA(), 'youtube_client.json'), token: path.join(DATA(), 'youtube_token.json') });
export const YT_SCOPE = 'https://www.googleapis.com/auth/youtube.upload';
const OAUTH = () => process.env.YT_OAUTH_URL || 'https://oauth2.googleapis.com/token';
const UPLOAD = () => process.env.YT_UPLOAD_URL || 'https://www.googleapis.com/upload/youtube/v3/videos';
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };

export class YtError extends Error {
  constructor(message, { reauth = false, retry = false, reason = '', status = 0 } = {}) { super(message); this.name = 'YtError'; this.reauth = reauth; this.retry = retry; this.reason = reason; this.status = status; }
}
export function loadClient(file = ytFiles().client) {
  const j = readJson(file); if (!j) return null;
  const c = j.installed || j.web || j; return c.client_id && c.client_secret ? { client_id: c.client_id, client_secret: c.client_secret } : null;
}
export const loadToken = (file = ytFiles().token) => { const j = readJson(file); return j && j.refresh_token ? j : null; };
export function ytStatus() { const client = !!loadClient(), token = !!loadToken(); return { client, token, ready: client && token }; }

let cache = null;                                      // { token, exp }
export const _resetTokenCache = () => { cache = null; };
export async function getAccessToken() {
  if (cache && cache.exp > Date.now() + 60000) return cache.token;
  const c = loadClient(), t = loadToken();
  if (!c) throw new YtError('нет ключа OAuth-клиента Google (server/data/youtube_client.json)', { reauth: true, reason: 'no_client' });
  if (!t) throw new YtError('YouTube ещё не подключён: нет разрешения (запустите node scripts/youtube_auth.mjs)', { reauth: true, reason: 'no_token' });
  let r;
  try { r = await fetch(OAUTH(), { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: c.client_id, client_secret: c.client_secret, refresh_token: t.refresh_token, grant_type: 'refresh_token' }) }); }
  catch (e) { throw new YtError('нет связи с Google (' + (e.cause && e.cause.code || e.message) + ')', { retry: true, reason: 'network' }); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) {
    const bad = j.error === 'invalid_grant' || j.error === 'invalid_client' || r.status === 400 || r.status === 401;
    throw new YtError(bad ? 'доступ к YouTube истёк или отозван: нужно заново дать разрешение (node scripts/youtube_auth.mjs). Если приложение в Google Cloud остаётся в режиме «Testing», разрешение живёт всего 7 дней: переведите его в «In production»' : `Google отказал в токене (HTTP ${r.status})`, { reauth: bad, reason: String(j.error || 'token'), status: r.status });
  }
  cache = { token: j.access_token, exp: Date.now() + (Number(j.expires_in) || 3600) * 1000 }; return cache.token;
}

const clean = (s) => String(s || '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim();
/** Метаданные ролика для YouTube. Название чистое (хэштеги только в описании: YouTube сам показывает первые три над названием). */
export function buildMetadata({ title, videoTitle = '', tags = [], sources = [], channel = { name: 'Медицинский детектив', url: 'https://t.me/med_detective_ru' }, privacy = 'private', publishAt, disclaimer = 'Не заменяет консультацию врача. Если поведение или самочувствие беспокоит, обратитесь к врачу.' } = {}) {
  const t = clean(title); if (!t) throw new YtError('нет названия ролика для YouTube');
  if (t.length > 100) throw new YtError(`название длиннее 100 знаков (${t.length}), YouTube его не примет`);
  if (!['private', 'unlisted', 'public'].includes(privacy)) throw new YtError('privacy: private | unlisted | public');
  const hashtags = [...new Set(tags.map((x) => '#' + String(x).replace(/^#/, '').replace(/\s+/g, '')).filter((x) => x.length > 1))].slice(0, 14), shorts = hashtags.some((h) => /^#shorts$/i.test(h)) ? [] : ['#Shorts'];
  const lines = [videoTitle && clean(videoTitle) !== t ? clean(videoTitle) : '', `Телеграм-канал «${channel.name}»: ${channel.url}`, sources.length ? 'Источники:\n' + sources.map((s) => '• ' + clean(s)).join('\n') : '', disclaimer, [...hashtags, ...shorts].join(' ')].filter(Boolean);
  const description = lines.join('\n\n').slice(0, 4900);
  const keywords = hashtags.map((h) => h.slice(1)); let tagBytes = 0; const kw = [];
  for (const k of keywords) { tagBytes += k.length + 3; if (tagBytes > 450) break; kw.push(k); }
  const status = { privacyStatus: publishAt ? 'private' : privacy, selfDeclaredMadeForKids: false, embeddable: true, license: 'youtube', publicStatsViewable: true };
  if (publishAt) status.publishAt = new Date(publishAt).toISOString();
  return { snippet: { title: t, description, tags: kw, categoryId: '27', defaultLanguage: 'ru', defaultAudioLanguage: 'ru' }, status };
}

function explain(status, body) {
  const e = (body && body.error) || {}, reason = (e.errors && e.errors[0] && e.errors[0].reason) || e.status || '', msg = e.message || '';
  const R = { quotaExceeded: 'дневной лимит YouTube API исчерпан, повторю завтра', uploadLimitExceeded: 'достигнут суточный лимит загрузок канала', youtubeSignupRequired: 'у этого аккаунта Google нет канала YouTube', forbidden: 'YouTube не разрешил загрузку (проверьте, что приложение имеет доступ youtube.upload и канал подтверждён)', authError: 'доступ к YouTube отозван', invalidTitle: 'YouTube не принял название', invalidDescription: 'YouTube не принял описание', videoTooLong: 'ролик слишком длинный', mediaBodyRequired: 'файл не дошёл до YouTube' };
  const reauth = status === 401 || reason === 'authError';
  return new YtError(`YouTube отказал (HTTP ${status}${reason ? ', ' + reason : ''}): ${R[reason] || msg || 'неизвестная причина'}`, { reauth, retry: status >= 500 || status === 408, reason, status });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Загружает файл. Возвращает { id, url, privacy }. Обрыв связи: продолжает с места обрыва (resumable), до 4 попыток. */
export async function uploadVideo({ file, meta }) {
  const size = fs.statSync(file).size; if (!size) throw new YtError('файл пустой');
  let token = await getAccessToken(), init;
  for (let a = 0; a < 2; a++) {
    try { init = await fetch(`${UPLOAD()}?uploadType=resumable&part=snippet,status`, { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Length': String(size), 'X-Upload-Content-Type': 'video/mp4' }, body: JSON.stringify(meta) }); }
    catch (e) { throw new YtError('нет связи с YouTube (' + (e.cause && e.cause.code || e.message) + ')', { retry: true, reason: 'network' }); }
    if (init.status === 401 && a === 0) { _resetTokenCache(); token = await getAccessToken(); continue; }
    break;
  }
  if (!init.ok) throw explain(init.status, await init.json().catch(() => ({})));
  const session = init.headers.get('location'); if (!session) throw new YtError('YouTube не выдал адрес загрузки');
  const buf = fs.readFileSync(file), pause = Number(process.env.YT_RETRY_MS) || 2000; let offset = 0, lastErr = null;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const r = await fetch(session, { method: 'PUT', headers: { 'Content-Type': 'video/mp4', ...(offset ? { 'Content-Range': `bytes ${offset}-${size - 1}/${size}` } : {}) }, body: buf.subarray(offset) });
      if (r.status === 200 || r.status === 201) { const j = await r.json().catch(() => ({})); if (!j.id) throw new YtError('YouTube принял файл, но не вернул номер ролика'); return { id: j.id, url: `https://youtube.com/shorts/${j.id}`, privacy: meta.status.privacyStatus }; }
      if (r.status >= 500 || r.status === 408) { lastErr = explain(r.status, await r.json().catch(() => ({}))); }
      else throw explain(r.status, await r.json().catch(() => ({})));
    } catch (e) { if (e instanceof YtError && !e.retry) throw e; lastErr = e instanceof YtError ? e : new YtError('обрыв связи при загрузке (' + (e.cause && e.cause.code || e.message) + ')', { retry: true, reason: 'network' }); }
    if (attempt === 4) break;
    await sleep(pause * attempt);
    try {                                              // где остановились: Range ответа 308 говорит, сколько байт YouTube уже получил
      const q = await fetch(session, { method: 'PUT', headers: { 'Content-Range': `bytes */${size}`, 'Content-Length': '0' } });
      if (q.status === 200 || q.status === 201) { const j = await q.json().catch(() => ({})); if (j.id) return { id: j.id, url: `https://youtube.com/shorts/${j.id}`, privacy: meta.status.privacyStatus }; }
      const rg = /bytes=0-(\d+)/.exec(q.headers.get('range') || ''); offset = rg ? Number(rg[1]) + 1 : 0;
    } catch { /* повтор с прежнего места */ }
  }
  throw lastErr || new YtError('загрузка не удалась');
}

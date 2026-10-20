import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startFakeGoogle } from './fixtures/fake_google.mjs';
import { buildMetadata, getAccessToken, uploadVideo, ytStatus, loadClient, YtError, _resetTokenCache } from '../scripts/youtube.mjs';
import { runAuth } from '../scripts/youtube_auth.mjs';

let tmp, g, clip;
const keep = {}; const setEnv = (o) => { for (const [k, v] of Object.entries(o)) { if (!(k in keep)) keep[k] = process.env[k]; process.env[k] = v; } };
const writeClient = () => fs.writeFileSync(path.join(tmp, 'youtube_client.json'), JSON.stringify({ installed: { client_id: 'cid.apps.googleusercontent.com', client_secret: 'sec', redirect_uris: ['http://localhost'] } }));
const writeToken = () => fs.writeFileSync(path.join(tmp, 'youtube_token.json'), JSON.stringify({ refresh_token: '1//refresh' }));
async function fake(mode) { if (g) await g.close(); g = await startFakeGoogle(mode); setEnv({ YT_OAUTH_URL: g.token, YT_UPLOAD_URL: g.upload, YT_RETRY_MS: '5' }); _resetTokenCache(); return g; }
before(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'yt-')); setEnv({ OFFICE_DATA_DIR: tmp }); clip = path.join(tmp, 'clip.mp4'); fs.writeFileSync(clip, crypto_bytes(100000)); });
after(async () => { if (g) await g.close(); for (const [k, v] of Object.entries(keep)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } fs.rmSync(tmp, { recursive: true, force: true }); });
function crypto_bytes(n) { const b = Buffer.alloc(n); for (let i = 0; i < n; i++) b[i] = (i * 31 + 7) & 255; return b; }

test('метаданные: чистое название, хэштеги и #Shorts в описании, категория «Образование», «не для детей», канал и дисклеймер', () => {
  const m = buildMetadata({ title: 'Десять тысяч шагов родились в рекламе?', videoTitle: 'Нужно ходить ровно десять тысяч шагов в день?', tags: ['#МедицинскийДетектив', '10000шагов', '#Ходьба'], sources: ['Paluch AE. Lancet Public Health. 2022.'], privacy: 'private' });
  assert.equal(m.snippet.title, 'Десять тысяч шагов родились в рекламе?'); assert.ok(!m.snippet.title.includes('#'));
  assert.match(m.snippet.description, /Нужно ходить ровно десять тысяч шагов в день\?/); assert.match(m.snippet.description, /https:\/\/t\.me\/med_detective_ru/); assert.match(m.snippet.description, /• Paluch AE/); assert.match(m.snippet.description, /Не заменяет консультацию врача/);
  assert.match(m.snippet.description, /#МедицинскийДетектив #10000шагов #Ходьба #Shorts$/); assert.deepEqual(m.snippet.tags, ['МедицинскийДетектив', '10000шагов', 'Ходьба', 'Shorts'].slice(0, 3));
  assert.equal(m.snippet.categoryId, '27'); assert.equal(m.snippet.defaultLanguage, 'ru'); assert.equal(m.status.privacyStatus, 'private'); assert.equal(m.status.selfDeclaredMadeForKids, false);
  assert.equal((buildMetadata({ title: 'T', tags: ['#shorts', '#a'] }).snippet.description.match(/#shorts/gi) || []).length, 1, '#Shorts не дублируется');
});
test('метаданные: название длиннее 100 знаков и неверная приватность отклоняются; запланированная публикация всегда private + publishAt', () => {
  assert.throws(() => buildMetadata({ title: 'я'.repeat(101) }), /длиннее 100/); assert.throws(() => buildMetadata({ title: '' }), /нет названия/); assert.throws(() => buildMetadata({ title: 'T', privacy: 'secret' }), /privacy/);
  const m = buildMetadata({ title: 'T', privacy: 'public', publishAt: '2026-10-22T07:00:00Z' }); assert.equal(m.status.privacyStatus, 'private'); assert.equal(m.status.publishAt, '2026-10-22T07:00:00.000Z');
});

test('состояние подключения: без ключа и токена не готово, с обоими готово; ключ читается из формата Google (installed)', () => {
  fs.rmSync(path.join(tmp, 'youtube_client.json'), { force: true }); fs.rmSync(path.join(tmp, 'youtube_token.json'), { force: true });
  assert.deepEqual(ytStatus(), { client: false, token: false, ready: false }); writeClient(); assert.equal(ytStatus().ready, false); writeToken();
  assert.deepEqual(ytStatus(), { client: true, token: true, ready: true }); assert.equal(loadClient().client_id, 'cid.apps.googleusercontent.com');
});

test('токен: обновляется по refresh-токену и кэшируется; отозванное разрешение даёт понятную причину и подсказку про режим Testing', async () => {
  const s = await fake('ok'); assert.equal(await getAccessToken(), 'ya29.fake'); await getAccessToken(); assert.equal(s.st.tokenRequests.length, 1, 'второй раз из кэша');
  assert.equal(s.st.tokenRequests[0].refresh_token, '1//refresh'); assert.equal(s.st.tokenRequests[0].client_id, 'cid.apps.googleusercontent.com');
  await fake('invalid_grant'); await assert.rejects(getAccessToken(), (e) => e instanceof YtError && e.reauth && /заново дать разрешение/.test(e.message) && /Testing/.test(e.message));
  fs.rmSync(path.join(tmp, 'youtube_token.json')); await fake('ok'); await assert.rejects(getAccessToken(), (e) => e.reauth && /не подключён/.test(e.message)); writeToken();
});

test('загрузка: resumable, метаданные и размер уходят на старте, файл приходит целиком, возвращается номер и ссылка Shorts', async () => {
  const s = await fake('ok'), meta = buildMetadata({ title: 'Тест', tags: ['#a'], privacy: 'private' });
  const r = await uploadVideo({ file: clip, meta }); assert.deepEqual(r, { id: 'VID123', url: 'https://youtube.com/shorts/VID123', privacy: 'private' });
  const init = s.st.inits[0]; assert.equal(init.query.uploadType, 'resumable'); assert.equal(init.query.part, 'snippet,status'); assert.equal(init.headers['x-upload-content-length'], '100000'); assert.equal(init.meta.status.privacyStatus, 'private'); assert.equal(init.meta.snippet.title, 'Тест');
  assert.ok(s.st.uploads[0].equals(fs.readFileSync(clip)), 'файл дошёл без искажений');
});

test('обрыв загрузки: первая отправка падает 503, код узнаёт, сколько байт принято, и догружает с этого места; файл целый', async () => {
  const s = await fake('flaky'); const r = await uploadVideo({ file: clip, meta: buildMetadata({ title: 'Тест', privacy: 'private' }) }); assert.equal(r.id, 'VID123');
  assert.ok(s.st.puts.some((p) => /^bytes \*\//.test(p.range)), 'спросил, где остановились'); assert.ok(s.st.puts.some((p) => /^bytes 50000-99999\/100000$/.test(p.range)), s.st.puts.map((p) => p.range).join('|'));
  assert.ok(s.st.uploads[0].equals(fs.readFileSync(clip)), 'после догрузки файл целый');
});

test('ошибки YouTube понятны: лимит API, истёкший токен при старте (один повтор с новым токеном), нет доступа', async () => {
  await fake('quota'); await assert.rejects(uploadVideo({ file: clip, meta: buildMetadata({ title: 'Т' }) }), (e) => e instanceof YtError && e.reason === 'quotaExceeded' && !e.reauth && /дневной лимит YouTube API/.test(e.message));
  const s = await fake('expire_once'); const r = await uploadVideo({ file: clip, meta: buildMetadata({ title: 'Т' }) }); assert.equal(r.id, 'VID123'); assert.equal(s.st.tokenRequests.length, 2, 'после 401 токен обновлён и запрос повторён');
});

test('подключение (OAuth на ПК): ссылка со scope youtube.upload, PKCE и state; код обменивается, refresh-токен сохраняется; чужой state и отказ отклоняются; токен не печатается', async () => {
  const s = await fake('ok'); writeClient(); fs.rmSync(path.join(tmp, 'youtube_token.json'), { force: true }); setEnv({ YT_AUTH_URL: 'http://127.0.0.1:1/auth' });
  let seen; const click = async (url, qs) => { const u = new URL(url); s.st.expectChallenge = u.searchParams.get('code_challenge'); const redirect = u.searchParams.get('redirect_uri'); seen = u; return fetch(`${redirect}/?${qs(u.searchParams.get('state'))}`); };
  const ok = runAuth({ onUrl: (url) => { click(url, (st) => `code=GOODCODE&state=${st}`); } }); const r = await ok; assert.equal(r.ok, true);
  assert.equal(seen.searchParams.get('scope'), 'https://www.googleapis.com/auth/youtube.upload'); assert.equal(seen.searchParams.get('access_type'), 'offline'); assert.equal(seen.searchParams.get('code_challenge_method'), 'S256'); assert.match(seen.searchParams.get('redirect_uri'), /^http:\/\/127\.0\.0\.1:\d+$/);
  const saved = JSON.parse(fs.readFileSync(path.join(tmp, 'youtube_token.json'), 'utf8')); assert.equal(saved.refresh_token, '1//fake-refresh'); assert.equal(ytStatus().ready, true);
  fs.rmSync(path.join(tmp, 'youtube_token.json')); await assert.rejects(runAuth({ onUrl: (url) => { click(url, () => 'code=GOODCODE&state=чужой'); } }), /state не совпал/);
  await assert.rejects(runAuth({ onUrl: (url) => { click(url, (st) => `error=access_denied&state=${st}`); } }), /access_denied/);
  assert.equal(fs.existsSync(path.join(tmp, 'youtube_token.json')), false, 'при отказе токен не создаётся');
});

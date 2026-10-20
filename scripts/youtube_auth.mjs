// Одноразовое подключение YouTube: Ник нажимает «Разрешить» в браузере на своём ПК, refresh-токен сохраняется в server/data/youtube_token.json.
// Запуск: node scripts/youtube_auth.mjs [--open]   (--open сам откроет браузер). Нужен server/data/youtube_client.json (OAuth-клиент «Приложение для ПК»).
// Права: только youtube.upload. Токен и ключ нигде не печатаются. Схема OAuth для приложений на ПК: loopback 127.0.0.1 + PKCE.
import fs from 'node:fs';
import http from 'node:http';
import crypto from 'node:crypto';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadClient, ytFiles, YT_SCOPE } from './youtube.mjs';

const b64 = (b) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const AUTH_URL = () => process.env.YT_AUTH_URL || 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = () => process.env.YT_OAUTH_URL || 'https://oauth2.googleapis.com/token';

export async function runAuth({ onUrl, timeoutMs = 10 * 60e3, clientFile, tokenFile } = {}) {
  const client = loadClient(clientFile); if (!client) throw new Error('нет ключа OAuth-клиента: положите скачанный JSON в ' + (clientFile || ytFiles().client));
  const verifier = b64(crypto.randomBytes(48)), challenge = b64(crypto.createHash('sha256').update(verifier).digest()), state = b64(crypto.randomBytes(16));
  let server, redirect;
  const code = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { try { server.close(); } catch {} reject(new Error('время ожидания разрешения вышло (10 минут)')); }, timeoutMs);
    server = http.createServer((req, res) => {
      const u = new URL(req.url, 'http://127.0.0.1');
      if (u.pathname !== '/' || !(u.searchParams.has('code') || u.searchParams.has('error'))) { res.writeHead(404); return res.end(); }
      const done = (ok, text) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(`<meta charset="utf-8"><body style="font:20px system-ui;padding:40px">${text}</body>`); clearTimeout(timer); setTimeout(() => server.close(), 200); return ok; };
      if (u.searchParams.get('state') !== state) { done(false, 'Ошибка: чужой ответ. Закройте вкладку и запустите подключение заново.'); return reject(new Error('state не совпал')); }
      if (u.searchParams.get('error')) { done(false, 'Разрешение не дано. Можно закрыть вкладку.'); return reject(new Error('Google: ' + u.searchParams.get('error'))); }
      done(true, 'Готово: YouTube подключён к AI-офису. Эту вкладку можно закрыть.'); resolve(u.searchParams.get('code'));
    });
    server.listen(0, '127.0.0.1', () => {
      redirect = `http://127.0.0.1:${server.address().port}`;
      const url = `${AUTH_URL()}?${new URLSearchParams({ client_id: client.client_id, redirect_uri: redirect, response_type: 'code', scope: YT_SCOPE, access_type: 'offline', prompt: 'consent', state, code_challenge: challenge, code_challenge_method: 'S256' })}`;
      try { onUrl && onUrl(url, redirect); } catch (e) { reject(e); }
    });
  });
  const r = await fetch(TOKEN_URL(), { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ code, client_id: client.client_id, client_secret: client.client_secret, redirect_uri: redirect, grant_type: 'authorization_code', code_verifier: verifier }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.refresh_token) throw new Error(`Google не выдал разрешение (HTTP ${r.status}${j.error ? ', ' + j.error : ''}${r.ok && !j.refresh_token ? ', нет refresh_token: отзовите доступ приложения в аккаунте Google и повторите' : ''})`);
  const file = tokenFile || ytFiles().token; fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ refresh_token: j.refresh_token, scope: j.scope || YT_SCOPE, obtained_at: new Date().toISOString() }, null, 1), { mode: 0o600 });
  return { ok: true, file };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const open = process.argv.includes('--open');
  runAuth({ onUrl: (url) => {
    console.log('Откройте эту ссылку в браузере НА ЭТОМ ПК и нажмите «Разрешить» (аккаунт Google, на котором канал YouTube):\n\n' + url + '\n\nЖду ответ до 10 минут...');
    if (open) spawn('powershell.exe', ['-NoProfile', '-Command', `Start-Process '${url.replace(/'/g, "''")}'`], { stdio: 'ignore', windowsHide: true }).unref();
  } }).then((r) => { console.log('YouTube подключён. Разрешение сохранено в ' + r.file); process.exit(0); }).catch((e) => { console.error('Не получилось: ' + e.message); process.exit(1); });
}

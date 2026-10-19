// Запускает API и Cloudflare Tunnel, перезапускает при падении,
// пишет текущий адрес туннеля в server/data/tunnel-url.txt и на рабочий стол.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { check } from './tunnel_watch.mjs';
import { updateMenuButton, makeTg, readBotToken } from './menu_button.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Всё настраиваемое окружением, чтобы проверять супервизор на отдельных портах и копии данных, не задевая рабочий офис. Без переменных работает как раньше.
const API_PORT = Number(process.env.SUP_API_PORT || 8787), METRICS_PORT = Number(process.env.SUP_METRICS_PORT || 20241);
const dataDir = process.env.OFFICE_DATA_DIR || path.join(root, 'server', 'data');
const DRY = process.env.SUP_DRY === '1';          // тест: не писать на рабочий стол, не трогать Telegram
fs.mkdirSync(dataDir, { recursive: true });
const logFile = fs.createWriteStream(path.join(dataDir, 'supervisor.log'), { flags: 'a' });
const log = (m) => logFile.write(`${new Date().toISOString()} ${m}\n`);
const CF = 'C:\\Program Files (x86)\\cloudflared\\cloudflared.exe';

const procs = {};          // имя -> дочерний процесс (нужен, чтобы перезапустить зависший туннель)
function keepAlive(name, cmd, args, opts, onLine) {
  const start = () => {
    log(`${name}: старт`);
    const p = spawn(cmd, args, { ...opts, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    procs[name] = p; if (name === 'tunnel') watch.startedAt = Date.now();
    const feed = (b) => b.toString().split(/\r?\n/).forEach((l) => l && onLine && onLine(l));
    p.stdout.on('data', feed); p.stderr.on('data', feed);
    p.on('exit', (c) => { log(`${name}: выход ${c}, перезапуск через 5 с`); setTimeout(start, 5000); });
  };
  start();
}

function saveUrl(url) {
  let token = '';
  try { token = JSON.parse(fs.readFileSync(path.join(dataDir, 'config.json'), 'utf8')).token; } catch {}
  fs.writeFileSync(path.join(dataDir, 'tunnel-url.txt'), url);
  const desktop = path.join(os.homedir(), 'Desktop', 'AI-Office-доступ.txt');
  if (!DRY) fs.writeFileSync(desktop,
    `AI Office: данные для входа\r\n\r\nСайт:  https://inversion322.github.io/ai-office/\r\nАдрес API:  ${url}\r\nТокен:  ${token}\r\n\r\nАдрес меняется при каждом перезапуске туннеля, файл обновляется автоматически. Токен не публикуйте.\r\n`);
  log(`адрес туннеля: ${url}`);
  watch.url = url; watch.outsideFails = 0;
  pushMenuButton(url);
}

// Кнопка Mini App в боте должна всегда вести на живой адрес: обновляем при каждой смене. Не вышло — говорим Нику в чат, а не молчим.
async function pushMenuButton(url) {
  if (DRY) { log('кнопка Mini App: сухой режим, пропуск'); return; }
  const token = readBotToken(dataDir); if (!token) { log('кнопка Mini App: нет smmBotToken, пропуск'); return; }
  const r = await updateMenuButton(makeTg(token), url);
  log(r.ok ? `кнопка Mini App обновлена (попыток: ${r.attempts})` : `кнопка Mini App НЕ обновлена: ${r.error}`);
  if (!r.ok) {
    try { await makeTg(token)('sendMessage', { chat_id: 323028999, text: `⚠️ Туннель сменил адрес, но кнопку «Офис» обновить не вышло (${r.error}). Откройте вручную:\n${r.url}` }); } catch (e) { log('сообщение о сбое кнопки не ушло: ' + e.message); }
  }
}

// Наблюдение за туннелем: чиним по факту, а не по расписанию (смена адреса без причины только создаёт окна недоступности).
const watch = { url: '', startedAt: 0, lastRestartAt: 0 };
const probe = async (u, ms) => { const ac = new AbortController(); const t = setTimeout(() => ac.abort(), ms); try { return await fetch(u, { signal: ac.signal, cache: 'no-store' }); } finally { clearTimeout(t); } };
const io = {
  now: () => Date.now(),
  localOk: async () => { try { return (await probe(`http://127.0.0.1:${API_PORT}/health`, 4000)).ok; } catch { return false; } },
  ready: async () => { try { const j = await (await probe(`http://127.0.0.1:${METRICS_PORT}/ready`, 3000)).json(); return Number(j.readyConnections); } catch { return null; } },
  outsideOk: async (u) => { try { return (await probe(u + '/health', 10000)).ok; } catch { return false; } },
};
setInterval(async () => {
  try {
    const { state, decision } = await check(watch, io);
    Object.assign(watch, state);
    if (decision.act === 'restart' && procs.tunnel) {
      log(`туннель: перезапуск (${decision.why})`); watch.lastRestartAt = Date.now(); watch.outsideFails = 0; watch.deadReadyCount = 0; watch.noReadyCount = 0;
      try { spawn('taskkill', ['/F', '/PID', String(procs.tunnel.pid)], { windowsHide: true }); } catch (e) { log('taskkill: ' + e.message); }   // keepAlive поднимет новый, saveUrl обновит кнопку
    }
  } catch (e) { log('наблюдение за туннелем: ' + e.message); }
}, 60_000);

keepAlive('api', process.execPath, ['server.mjs'], { cwd: path.join(root, 'server'), env: { ...process.env, PORT: String(API_PORT) } }, (l) => log('api: ' + l));
if (!DRY) keepAlive('smm-bot', process.execPath, ['scripts/smm_bot.mjs'], { cwd: root }, (l) => log('smm-bot: ' + l));
setTimeout(() => keepAlive('tunnel', CF, ['tunnel', '--url', `http://127.0.0.1:${API_PORT}`, '--no-autoupdate', '--metrics', `127.0.0.1:${METRICS_PORT}`], {}, (l) => {
  const m = l.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
  if (m) saveUrl(m[0]);
}), 3000);

// Запускает API и Cloudflare Tunnel, перезапускает при падении,
// пишет текущий адрес туннеля в server/data/tunnel-url.txt и на рабочий стол.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.join(root, 'server', 'data');
fs.mkdirSync(dataDir, { recursive: true });
const logFile = fs.createWriteStream(path.join(dataDir, 'supervisor.log'), { flags: 'a' });
const log = (m) => logFile.write(`${new Date().toISOString()} ${m}\n`);
const CF = 'C:\\Program Files (x86)\\cloudflared\\cloudflared.exe';

function keepAlive(name, cmd, args, opts, onLine) {
  const start = () => {
    log(`${name}: старт`);
    const p = spawn(cmd, args, { ...opts, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
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
  fs.writeFileSync(desktop,
    `AI Office: данные для входа\r\n\r\nСайт:  https://inversion322.github.io/ai-office/\r\nАдрес API:  ${url}\r\nТокен:  ${token}\r\n\r\nАдрес меняется при каждом перезапуске туннеля, файл обновляется автоматически. Токен не публикуйте.\r\n`);
  log(`адрес туннеля: ${url}`);
}

keepAlive('api', process.execPath, ['server.mjs'], { cwd: path.join(root, 'server') }, (l) => log('api: ' + l));
setTimeout(() => keepAlive('tunnel', CF, ['tunnel', '--url', 'http://127.0.0.1:8787', '--no-autoupdate'], {}, (l) => {
  const m = l.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
  if (m) saveUrl(m[0]);
}), 3000);

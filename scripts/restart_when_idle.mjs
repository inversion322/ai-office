// Ждёт, пока ролик закончит монтироваться и в офисе не останется работающих сотрудников, затем перезапускает супервизор
// (API + туннель), чтобы включились Mini App и самолечение туннеля. Нужен потому, что перезапуск на секунды отключает API и
// обрывает связь работающих этапов с ним.
// Запуск: node scripts/restart_when_idle.mjs --video 3 [--max-hours 14] [--check] [--force]
//   --check  только показать, что мешает перезапуску сейчас, ничего не трогать
//   --force  не ждать (для тестов на тестовом стенде)
// Тестовый стенд: --scratch-dir <каталог с копией БД> --api-port 8798 --metrics-port 20299 (супервизор запускается в сухом режиме).
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { makeTg, readBotToken } from './menu_button.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i < 0 ? d : (process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true); };
const VIDEO = Number(arg('video', 3)), MAX_H = Number(arg('max-hours', 14)), CHECK = !!arg('check', false), FORCE = !!arg('force', false);
const SCRATCH = arg('scratch-dir', null), API_PORT = Number(arg('api-port', 8787)), METRICS_PORT = Number(arg('metrics-port', 20241));
const DATA = SCRATCH || path.join(ROOT, 'server', 'data');
const LOG = path.join(ROOT, 'smm', SCRATCH ? 'restart_watch_test.log' : 'restart_watch.log');
const OWNER = 323028999, POLL_MS = Number(process.env.RW_POLL_MS || 30000), NEED_IDLE = Number(process.env.RW_NEED_IDLE || 3);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (m) => { const l = `${new Date().toISOString()} ${m}`; console.log(l); try { fs.mkdirSync(path.dirname(LOG), { recursive: true }); fs.appendFileSync(LOG, l + '\n'); } catch {} };

/* ---------- чистое решение (проверяется тестом) ---------- */
// Ролик «закончил монтироваться»: produced (собран и отправлен Нику), либо больше не будет собираться (approved/rejected).
export const DONE_STAGES = ['produced', 'approved', 'rejected'];
export function decide({ stage, busy, idleStreak, priorityActive }, { needIdle = 3 } = {}) {
  if (!DONE_STAGES.includes(stage)) return { go: false, why: `ролик ещё не собран (стадия «${stage}»)` };
  if (priorityActive) return { go: false, why: 'идут правки ролика (приоритет)' };
  if (busy.length) return { go: false, why: 'работают: ' + busy.join(', ') };
  if (idleStreak < needIdle) return { go: false, why: `тихо ${idleStreak} из ${needIdle} проверок подряд (между этапами бывают паузы)` };
  return { go: true, why: 'ролик собран, сотрудники свободны' };
}

/* ---------- Windows ---------- */
const ps = (cmd) => execFileSync('powershell.exe', ['-NoProfile', '-Command', cmd], { encoding: 'utf8', windowsHide: true, timeout: 30000 }).trim();
const procs = () => { const out = ps("[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-CimInstance Win32_Process | Where-Object { $_.Name -ne 'powershell.exe' -and $_.CommandLine } | Select-Object ProcessId,ParentProcessId,Name,CommandLine | ConvertTo-Json -Compress"); const j = JSON.parse(out || '[]'); return Array.isArray(j) ? j : [j]; };
function portOwner(port) {
  const out = execFileSync('netstat', ['-ano'], { encoding: 'utf8', windowsHide: true });
  for (const l of out.split(/\r?\n/)) { const m = new RegExp(`^\\s*TCP\\s+127\\.0\\.0\\.1:${port}\\s+\\S+\\s+LISTENING\\s+(\\d+)`).exec(l); if (m) return Number(m[1]); }
  return null;
}
// Кто сейчас работает: этапы конвейера и модели-сотрудники профилей smm/video (jobs ведёт отдельный бот, API не задевается).
function busyNow(list) {
  const names = [];
  for (const p of list) {
    if (p.ProcessId === process.pid) continue;
    const c = p.CommandLine;
    if (/node(\.exe)?"?\s.*smm_pipeline\.mjs/i.test(c)) names.push('этап ' + (/smm_pipeline\.mjs"?\s+(\w+)/.exec(c) || [])[1]);
    else if (/hermes\.exe"?\s+-p\s+(smm|video)\s+chat/i.test(c)) names.push('модель -p ' + /-p\s+(\w+)/.exec(c)[1]);
  }
  return names;
}
function readState() {
  const db = new DatabaseSync(path.join(DATA, 'office.db'), { readOnly: true });
  try {
    const v = db.prepare('SELECT stage FROM videos WHERE id=?').get(VIDEO);
    const pr = db.prepare("SELECT v FROM kv WHERE k LIKE '%priority%'").all().map((r) => { try { return JSON.parse(r.v); } catch { return null; } }).filter(Boolean);
    return { stage: v ? v.stage : 'нет такого ролика', priorityActive: pr.some((x) => x && x.active) };
  } finally { db.close(); }
}

/* ---------- сам перезапуск ---------- */
const health = async (url, ms = 4000) => { const ac = new AbortController(); const t = setTimeout(() => ac.abort(), ms); try { return (await fetch(url, { signal: ac.signal, cache: 'no-store' })).status; } catch { return 0; } finally { clearTimeout(t); } };
const tunnelFile = path.join(DATA, 'tunnel-url.txt');
const supLog = path.join(DATA, 'supervisor.log');
// Хвост файла с байтового смещения. Нельзя резать строку по размеру файла: в журнале кириллица (2 байта на символ), и срез по символам пропускал нужную строку.
export const readFrom = (file, byteOffset = 0) => { try { return fs.readFileSync(file).subarray(byteOffset).toString('utf8'); } catch { return ''; } };
const readUrl = () => { try { return fs.readFileSync(tunnelFile, 'utf8').trim(); } catch { return ''; } };

const killPid = (pid) => { try { execFileSync('taskkill', ['/F', '/PID', String(pid)], { windowsHide: true, stdio: 'ignore' }); return true; } catch { return false; } };
const OURS = /server\.mjs|cloudflared|smm_bot\.mjs|supervisor\.mjs/i;      // только эти процессы можно останавливать при перезапуске

async function launchAndWait(oldUrl) {
  // Окружение как у автозапуска: тестовые переменные не переносим.
  const env = { ...process.env }; for (const k of ['OFFICE_NO_TG', 'OFFICE_CHAT_STUB', 'OFFICE_NO_WATCH', 'HERMES_BIN', 'OFFICE_API', 'OFFICE_DATA_DIR', 'PORT', 'SUP_API_PORT', 'SUP_METRICS_PORT', 'SUP_DRY']) delete env[k];
  if (SCRATCH) Object.assign(env, { OFFICE_DATA_DIR: SCRATCH, SUP_API_PORT: String(API_PORT), SUP_METRICS_PORT: String(METRICS_PORT), SUP_DRY: '1', OFFICE_NO_TG: '1', OFFICE_NO_WATCH: '1', OFFICE_CHAT_STUB: '1' });
  const out = fs.openSync(path.join(DATA, 'supervisor.stdout.log'), 'a');
  // Тестовый крючок (только RW_TEST_BREAK_FIRST): первая попытка запуска заведомо падает, чтобы проверить повторную.
  const broken = !!process.env.RW_TEST_BREAK_FIRST && !launchAndWait.used; launchAndWait.used = true;
  spawn(process.execPath, broken ? ['-e', 'process.exit(1)'] : [path.join(ROOT, 'scripts', 'supervisor.mjs')], { cwd: ROOT, detached: true, stdio: ['ignore', out, out], windowsHide: true, env }).unref();
  const t0 = Date.now(); let apiOk = false, newUrl = '', outside = 0;
  while (Date.now() - t0 < (broken ? 8000 : 100000)) {
    await sleep(2000);
    if (!apiOk) apiOk = (await health(`http://127.0.0.1:${API_PORT}/health`)) === 200;
    const u = readUrl(); if (u && u !== oldUrl) newUrl = u;
    if (apiOk && newUrl) { outside = await health(newUrl + '/health', 8000); if (outside === 200) break; }
  }
  return { apiOk, newUrl, outside };
}

async function restartSupervisor() {
  const list = procs(); const by = new Map(list.map((p) => [p.ProcessId, p]));
  const apiPid = portOwner(API_PORT), cfPid = portOwner(METRICS_PORT);
  if (!apiPid) throw new Error(`на порту ${API_PORT} никто не слушает: перезапускать нечего`);
  const supPid = by.get(apiPid) && by.get(apiPid).ParentProcessId;
  const sup = by.get(supPid);
  // До остановки можно отказаться без последствий. Ошибка здесь = убить не то, поэтому всё подтверждаем по командной строке.
  if (!sup || !/supervisor\.mjs/i.test(sup.CommandLine)) throw new Error(`родитель API (PID ${supPid}) не supervisor.mjs: ${sup ? sup.CommandLine.slice(-60) : 'нет такого процесса'}. Не трогаю`);
  if (!/server\.mjs/i.test(by.get(apiPid).CommandLine)) throw new Error(`PID ${apiPid} на порту ${API_PORT} не server.mjs`);
  if (cfPid && !(by.get(cfPid) && /cloudflared/i.test(by.get(cfPid).CommandLine))) throw new Error(`PID ${cfPid} на порту метрик не cloudflared`);
  // Цели: супервизор и все его дети нужных видов (туннель мог только стартовать и ещё не слушать порт метрик), плюс владельцы портов.
  const kids = list.filter((p) => p.ParentProcessId === supPid && OURS.test(p.CommandLine)).map((p) => p.ProcessId);
  const targets = [...new Set([supPid, ...kids, apiPid, cfPid].filter(Boolean))];
  const oldUrl = readUrl(); const logSize = fs.existsSync(supLog) ? fs.statSync(supLog).size : 0; const startedAt = Date.now();
  log(`перезапуск: останавливаю ${targets.join(', ')} (супервизор ${supPid}, API ${apiPid}, туннель ${cfPid || 'ещё не слушал'}), адрес до: ${oldUrl}`);
  // С этого места назад дороги нет: офис выключен, и ЛЮБОЙ исход обязан закончиться попыткой его поднять. Дальше исключений не бросаем.
  killPid(supPid);                                   // сначала супервизор, иначе он поднимет API и туннель обратно
  for (const pid of targets) if (pid !== supPid) killPid(pid);       // без /T: отвязанные этапы конвейера не задеваем
  for (let i = 0; i < 8 && (portOwner(API_PORT) || portOwner(METRICS_PORT)); i++) {
    await sleep(1000);
    for (const port of [API_PORT, METRICS_PORT]) { const o = portOwner(port); const p = o && procs().find((x) => x.ProcessId === o); if (p && OURS.test(p.CommandLine)) { log(`порт ${port} всё ещё занят нашим процессом ${o}, останавливаю`); killPid(o); } }
  }
  if (portOwner(API_PORT) || portOwner(METRICS_PORT)) log('ВНИМАНИЕ: порт занят не нашим процессом, запуск может не получиться');
  let r = await launchAndWait(oldUrl);
  if (!r.apiOk || !r.newUrl) {                       // вторая попытка: снять недоподнявшееся и запустить заново
    log(`первая попытка не удалась (api=${r.apiOk}, адрес=${r.newUrl || '—'}), пробую ещё раз`);
    const l2 = procs(); for (const p of l2) if (OURS.test(p.CommandLine) && p.ProcessId !== process.pid && (p.ProcessId === portOwner(API_PORT) || p.ProcessId === portOwner(METRICS_PORT) || /supervisor\.mjs/i.test(p.CommandLine) && p.ProcessId !== supPid && by.get(p.ProcessId) === undefined)) killPid(p.ProcessId);
    await sleep(3000); r = await launchAndWait(oldUrl);
  }
  const newSup = (() => { const o = portOwner(API_PORT); const p = o && procs().find((x) => x.ProcessId === o); return p ? p.ParentProcessId : null; })();
  const tail = readFrom(supLog, logSize);
  const res = { ...r, newSup, oldUrl, tail, logSize, startedAt };
  log(`итог подъёма: api=${r.apiOk} адрес=${r.newUrl || '—'} снаружи=${r.outside} супервизор=${newSup}`);
  return res;
}

async function verify(res) {
  const problems = [];
  if (!res.apiOk) problems.push('API не поднялся');
  if (!res.newUrl) problems.push('новый адрес туннеля не появился'); else if (res.outside !== 200) problems.push(`адрес снаружи отвечает ${res.outside}`);
  if (!res.newSup) problems.push('не найден новый супервизор');
  // Новый код действительно загружен: /api/tg-login есть (раньше такого маршрута не было, был бы 401 для всего без различий).
  try { const r = await fetch(`http://127.0.0.1:${API_PORT}/api/tg-login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); const j = await r.json().catch(() => ({})); if (!(r.status === 401 && j.reason)) problems.push(`маршрут входа Mini App не найден (HTTP ${r.status}): запущен старый код?`); } catch (e) { problems.push('маршрут входа недоступен: ' + e.message); }
  if (!SCRATCH) {
    // Кнопка в боте указывает на новый адрес: спрашиваем у самого Telegram, не верим логу. Супервизор ставит её чуть позже подъёма туннеля, поэтому ждём до 40 с.
    const token = readBotToken(DATA); let btn = null, last = '';
    for (let i = 0; i < 8; i++) {
      try {
        const mb = (await makeTg(token)('getChatMenuButton', { chat_id: OWNER })).result || {};
        const u = mb.web_app && mb.web_app.url ? new URL(mb.web_app.url) : null;
        last = u ? u.searchParams.get('api') : 'кнопки нет';
        if (u && last === res.newUrl) { btn = u.toString(); break; }
      } catch (e) { last = 'не удалось спросить Telegram: ' + e.message; }
      await sleep(5000);
    }
    if (!btn) problems.push(`кнопка «Офис» в Telegram указывает не на новый адрес (${last})`);
    // Журнал смотрим по ВРЕМЕНИ строки, а не по смещению в файле: супервизор может переписать файл, и смещение указывало бы за его конец (ложная тревога 19.10 в 22:59, хотя кнопка была обновлена и Telegram это подтвердил). Главная проверка выше идёт по ответу Telegram, журнал только дополнительный.
    const fresh = readFrom(supLog, 0).split('\n').filter((l) => /кнопка Mini App обновлена/.test(l) && Date.parse(l.slice(0, 24)) >= (res.startedAt || 0) - 2000);
    if (!fresh.length && !btn) problems.push('в журнале супервизора нет «кнопка Mini App обновлена»');
  }
  return problems;
}

async function tellNick(text) {
  if (SCRATCH) { log('(сухой режим) Нику: ' + text.split('\n')[0]); return; }
  try { await makeTg(readBotToken(DATA))('sendMessage', { chat_id: OWNER, text }); } catch (e) { log('Telegram не принял сообщение Нику: ' + e.message); }
}

async function main() {
  log(`наблюдатель запущен: ролик №${VIDEO}, ждать до ${MAX_H} ч, режим ${CHECK ? 'только проверка' : FORCE ? 'сразу' : 'ожидание'}${SCRATCH ? ', ТЕСТОВЫЙ СТЕНД ' + SCRATCH : ''}`);
  const t0 = Date.now(); let idleStreak = 0, lastWhy = '';
  for (;;) {
    const busy = busyNow(procs()); idleStreak = busy.length ? 0 : idleStreak + 1;
    const st = readState(); const d = decide({ ...st, busy, idleStreak }, { needIdle: NEED_IDLE });
    if (d.why !== lastWhy) { log(`ждём: ${d.why}`); lastWhy = d.why; }
    if (CHECK) { console.log(JSON.stringify({ ...st, busy, decision: d })); return; }
    if (FORCE || d.go) break;
    if (Date.now() - t0 > MAX_H * 3600e3) { log('время ожидания вышло, перезапуск НЕ сделан'); await tellNick(`⚠️ Не дождалась конца монтажа за ${MAX_H} ч, перезапуск офиса не сделан. Кнопка «Офис» в боте появится после перезапуска: скажите, когда его можно сделать.`); process.exitCode = 2; return; }
    await sleep(POLL_MS);
  }
  let res; try { res = await restartSupervisor(); } catch (e) { log('ПЕРЕЗАПУСК НЕ ВЫПОЛНЕН: ' + e.message); await tellNick('⚠️ Перезапуск офиса не выполнен: ' + e.message + '\nОфис продолжает работать по-старому.'); process.exitCode = 3; return; }
  const problems = await verify(res);
  if (!res.apiOk) { problems.unshift('ОФИС НЕ ПОДНЯЛСЯ после остановки: проверьте, что ПК включён, и запустите ярлык автозапуска AI_Office (или скажите мне)'); }
  if (problems.length) { log('ПРОВЕРКА НЕ ПРОШЛА: ' + problems.join('; ')); await tellNick('⚠️ Офис перезапущен, но проверка нашла проблемы:\n• ' + problems.join('\n• ')); process.exitCode = 4; return; }
  log('ГОТОВО: перезапуск прошёл, проверка пройдена');
  await tellNick('✅ Офис перезапущен. Рядом с полем ввода в этом чате появилась кнопка «Офис»: это дашборд внутри Telegram. Адрес туннеля сменился, дальше кнопка будет обновляться сама.');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((e) => { log('ОШИБКА НАБЛЮДАТЕЛЯ: ' + e.stack); process.exitCode = 1; });

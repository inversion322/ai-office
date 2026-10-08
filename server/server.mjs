// AI Office API: Node + SQLite, без внешних зависимостей.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

// --- Конфиг: токен хранится в data/config.json, создаётся при первом запуске ---
const cfgPath = path.join(DATA_DIR, 'config.json');
let cfg = fs.existsSync(cfgPath) ? JSON.parse(fs.readFileSync(cfgPath, 'utf8')) : {};
if (!cfg.token) {
  cfg.token = crypto.randomBytes(24).toString('base64url');
  cfg.allowedOrigins = ['https://inversion322.github.io', 'http://localhost:5173'];
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
  console.log('Создан новый токен доступа, он лежит в server/data/config.json');
}
const PORT = Number(process.env.PORT || 8787);

// --- БД ---
const db = new DatabaseSync(path.join(DATA_DIR, 'office.db'));
db.exec(`
CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL, team TEXT NOT NULL,
  model TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'idle',   -- idle | working | waiting | error | offline
  task TEXT, progress INTEGER DEFAULT 0, color TEXT, desk INTEGER, updated_at INTEGER
);
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT, agent_id TEXT, title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'planned',  -- planned | running | done | failed
  scheduled_at INTEGER, started_at INTEGER, finished_at INTEGER
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, agent_id TEXT,
  level TEXT NOT NULL DEFAULT 'info', message TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, source TEXT, title TEXT, company TEXT, url TEXT UNIQUE,
  salary TEXT, format TEXT, summary TEXT, fit TEXT,
  stage TEXT NOT NULL DEFAULT 'found',  -- found | review | approved | letter | applied | reply | rejected
  created_at INTEGER, updated_at INTEGER
);
`);

const now = () => Date.now();
const q = (sql, ...a) => db.prepare(sql).all(...a);
const run = (sql, ...a) => db.prepare(sql).run(...a);

function seedIfEmpty() {
  if (q('SELECT COUNT(*) c FROM agents')[0].c) return;
  const t = now();
  const A = [
    ['xenon', 'Xenon', 'Оркестратор', 'core', 'claude', 'working', 'Распределяю задачи между агентами', 60, '#7c5cff', 0],
    ['scout', 'Scout', 'Поиск вакансий', 'jobs', 'claude', 'working', 'Сканирую Himalayas, Wellfound, hh.ru', 35, '#22d3ee', 1],
    ['analyst', 'Analyst', 'Карточки вакансий', 'jobs', 'claude', 'waiting', 'Ждёт новых вакансий', 0, '#34d399', 2],
    ['writer', 'Writer', 'Сопроводительные', 'jobs', 'claude', 'idle', 'Ждёт одобрения вакансий', 0, '#f59e0b', 3],
    ['sender', 'Sender', 'Отправка откликов', 'jobs', 'claude', 'idle', 'Только после вашего подтверждения', 0, '#f43f5e', 4],
    ['content', 'Content', 'Посты для каналов', 'content', 'claude', 'offline', 'Не подключён', 0, '#a78bfa', 5],
    ['research', 'Research', 'Ресёрч рынка', 'research', 'claude', 'offline', 'Не подключён', 0, '#fb923c', 6],
  ];
  for (const a of A) run('INSERT INTO agents VALUES (?,?,?,?,?,?,?,?,?,?,?)', ...a, t);
  const T = [
    ['scout', 'Обход Himalayas, Wellfound, remotepmjobs', 'running'],
    ['scout', 'Обход hh.ru (Москва, гибрид/офис)', 'planned'],
    ['analyst', 'Сводка по компании и вакансии', 'planned'],
    ['writer', 'Сопроводительное письмо под компанию', 'planned'],
  ];
  for (const x of T) run('INSERT INTO tasks (agent_id,title,status,scheduled_at) VALUES (?,?,?,?)', ...x, t + 600000);
  run("INSERT INTO events (ts,agent_id,level,message) VALUES (?,?,?,?)", t, 'xenon', 'info', 'Офис запущен (тестовые данные)');
  const J = [
    ['Himalayas', 'AI Product Manager', 'Acme AI (демо)', 'https://example.com/1', '$55k–70k', 'Remote', 'Демо-карточка: вакансия для проверки интерфейса', 'Хороший матч по роли', 'review'],
    ['hh.ru', 'Менеджер AI-продуктов', 'Компания N (демо)', 'https://example.com/2', '120 000 ₽', 'Гибрид, Москва', 'Демо-карточка', 'Средний матч', 'found'],
  ];
  for (const j of J) run('INSERT INTO jobs (source,title,company,url,salary,format,summary,fit,stage,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)', ...j, t, t);
}
seedIfEmpty();

// --- HTTP ---
function cors(req, res) {
  const origin = req.headers.origin;
  if (origin && cfg.allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
}
const authed = (req) => {
  const h = req.headers.authorization || '';
  const given = Buffer.from(h.replace(/^Bearer /, ''));
  const real = Buffer.from(cfg.token);
  return given.length === real.length && crypto.timingSafeEqual(given, real);
};
const json = (res, code, obj) => {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
};
const body = (req) => new Promise((ok) => { let s = ''; req.on('data', (c) => (s += c)); req.on('end', () => { try { ok(JSON.parse(s || '{}')); } catch { ok({}); } }); });

http.createServer(async (req, res) => {
  cors(req, res);
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/health') return json(res, 200, { ok: true });
  if (!authed(req)) return json(res, 401, { error: 'unauthorized' });

  if (req.method === 'GET' && url.pathname === '/api/state') {
    const agents = q('SELECT * FROM agents ORDER BY desk');
    const jobs = q('SELECT * FROM jobs ORDER BY updated_at DESC LIMIT 100');
    const stages = {};
    for (const j of jobs) stages[j.stage] = (stages[j.stage] || 0) + 1;
    return json(res, 200, {
      ts: now(), agents,
      tasks: q("SELECT t.*, a.name agent_name FROM tasks t LEFT JOIN agents a ON a.id=t.agent_id WHERE t.status IN ('running','planned') ORDER BY t.status DESC, t.scheduled_at LIMIT 50"),
      events: q('SELECT e.*, a.name agent_name FROM events e LEFT JOIN agents a ON a.id=e.agent_id ORDER BY e.id DESC LIMIT 60'),
      jobs, funnel: stages,
    });
  }
  // Агенты пишут сюда статус
  if (req.method === 'POST' && url.pathname === '/api/agent') {
    const b = await body(req);
    run('UPDATE agents SET status=COALESCE(?,status), task=COALESCE(?,task), progress=COALESCE(?,progress), updated_at=? WHERE id=?',
      b.status ?? null, b.task ?? null, b.progress ?? null, now(), b.id);
    if (b.log) run('INSERT INTO events (ts,agent_id,level,message) VALUES (?,?,?,?)', now(), b.id, b.level || 'info', b.log);
    return json(res, 200, { ok: true });
  }
  if (req.method === 'POST' && url.pathname === '/api/job') {
    const b = await body(req);
    if (b.id) run('UPDATE jobs SET stage=?, updated_at=? WHERE id=?', b.stage, now(), b.id);
    else run('INSERT OR IGNORE INTO jobs (source,title,company,url,salary,format,summary,fit,stage,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      b.source, b.title, b.company, b.url, b.salary ?? '', b.format ?? '', b.summary ?? '', b.fit ?? '', b.stage || 'found', now(), now());
    return json(res, 200, { ok: true });
  }
  json(res, 404, { error: 'not found' });
}).listen(PORT, '127.0.0.1', () => console.log(`AI Office API: http://127.0.0.1:${PORT}`));

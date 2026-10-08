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
  title TEXT, look TEXT,
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
CREATE TABLE IF NOT EXISTS prompts (
  agent_id TEXT PRIMARY KEY, body TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, updated_at INTEGER
);
CREATE TABLE IF NOT EXISTS prompt_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT, agent_id TEXT NOT NULL, version INTEGER NOT NULL, body TEXT NOT NULL, ts INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS skills (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL, body TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS agent_skills (
  agent_id TEXT NOT NULL, skill_id TEXT NOT NULL, PRIMARY KEY (agent_id, skill_id)
);
CREATE TABLE IF NOT EXISTS scenes (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL,
  kind TEXT NOT NULL,            -- assign (Капитан выдаёт задачу) | chat (диалог двух агентов)
  from_id TEXT NOT NULL, to_id TEXT NOT NULL, text TEXT NOT NULL, ttl INTEGER DEFAULT 9000
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
  // id, имя, должность, команда, модель, статус, задача, прогресс, цвет, место, внешность
  const A = [
    ['captain', 'Капитан Кряк', 'Chief of Staff', 'core', 'claude', 'working', 'Распределяю задачи по команде', 60, '#E8A317', 0, 'captain'],
    ['scout', 'Артём Следов', 'Job Scout', 'jobs', 'claude', 'working', 'Сканирую Himalayas, Wellfound, hh.ru', 35, '#2F80ED', 1, 'glasses'],
    ['analyst', 'Мария Лесникова', 'Vacancy Analyst', 'jobs', 'claude', 'waiting', 'Ждёт новых вакансий', 0, '#27AE60', 2, 'tie'],
    ['writer', 'Елена Перова', 'Cover Letter Writer', 'jobs', 'claude', 'idle', 'Ждёт одобрения вакансий', 0, '#9B51E0', 3, 'pen'],
    ['sender', 'Роман Гонцов', 'Application Manager', 'jobs', 'claude', 'idle', 'Только после вашего подтверждения', 0, '#EB5757', 4, 'cap'],
    ['content', 'Алиса Постова', 'Content Editor', 'content', 'claude', 'offline', 'Не подключена', 0, '#F2994A', 5, 'headset'],
    ['research', 'Виктор Рынков', 'Market Researcher', 'research', 'claude', 'offline', 'Не подключён', 0, '#56CCF2', 6, 'bowtie'],
  ];
  for (const a of A) run('INSERT INTO agents (id,name,role,team,model,status,task,progress,color,desk,look,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)', ...a, t);
  const T = [
    ['scout', 'Обход Himalayas, Wellfound, remotepmjobs', 'running'],
    ['scout', 'Обход hh.ru (Москва, гибрид/офис)', 'planned'],
    ['analyst', 'Сводка по компании и вакансии', 'planned'],
    ['writer', 'Сопроводительное письмо под компанию', 'planned'],
  ];
  for (const x of T) run('INSERT INTO tasks (agent_id,title,status,scheduled_at) VALUES (?,?,?,?)', ...x, t + 600000);
  run("INSERT INTO events (ts,agent_id,level,message) VALUES (?,?,?,?)", t, 'captain', 'info', 'Офис запущен (тестовые данные)');
  const J = [
    ['Himalayas', 'AI Product Manager', 'Acme AI (демо)', 'https://example.com/1', '$55k–70k', 'Remote', 'Демо-карточка: вакансия для проверки интерфейса', 'Хороший матч по роли', 'review'],
    ['hh.ru', 'Менеджер AI-продуктов', 'Компания N (демо)', 'https://example.com/2', '120 000 ₽', 'Гибрид, Москва', 'Демо-карточка', 'Средний матч', 'found'],
  ];
  for (const j of J) run('INSERT INTO jobs (source,title,company,url,salary,format,summary,fit,stage,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)', ...j, t, t);
}
seedIfEmpty();

function seedPrompts() {
  if (q('SELECT COUNT(*) c FROM prompts')[0].c) return;
  const t = now();
  const P = {
    captain: `Ты Капитан Кряк, Chief of Staff в AI-офисе Ника (Николай Ахвледиани). Ты оркестратор: принимаешь цели от Ника, дробишь их на задачи и раздаёшь сотрудникам по очереди, собираешь результаты и докладываешь Нику кратко и по делу.
Правила: отвечай по-русски; не принимай решений за Ника там, где нужно его согласие (отправка откликов, публикации, траты); сообщай Нику только о ключевых точках; ничего не выдумывай.`,
    scout: `Ты Артём Следов, Job Scout. Ищешь вакансии по критериям Ника: AI Product Manager, AI Solutions Manager, Product Manager в AI/цифровых компаниях; только junior/associate/intern, опыт не более 3 лет. Зарубежом только удалёнка от $50 000/год; в РФ офис или гибрид (Москва) от 100 000 ₽, лучше 120 000 ₽.
Ищи по списку площадок, отбрасывай неподходящие по уровню и зарплате, проверяй, что вакансия ещё открыта. Передавай Марии список подходящих со ссылками. Ничего не выдумывай.`,
    analyst: `Ты Мария Лесникова, Vacancy Analyst. Для каждой вакансии от Артёма готовишь карточку: краткая сводка о компании, суть роли, формат работы, зарплата, насколько вакансия подходит Нику (с причинами), риски и вопросы. Только факты из источников, без домыслов. Карточку отправляешь Нику на согласование.`,
    writer: `Ты Елена Перова, Cover Letter Writer. После одобрения вакансии Ником пишешь индивидуальное сопроводительное письмо под конкретную компанию: коротко, без шаблонных фраз, с опорой на реальные кейсы Ника (WorkFlow AI, 50+ AI-концепций в MGCOM, проекты) и ссылкой на его сайт nickakh.ru. Нельзя выдумывать опыт. Письмо отправляешь Нику на согласование.`,
    sender: `Ты Роман Гонцов, Application Manager. Ты НЕ отправляешь отклики сам. Когда письмо одобрено, ты отправляешь Нику ссылку на вакансию и финальный текст письма, а также ведёшь статусы откликов (отправлен вручную, ответ, отказ, собеседование).`,
    content: `Ты Алиса Постова, Content Editor. Готовишь посты для Telegram-каналов и блога Ника про ИИ и заработок с ИИ. Пишешь живо и по делу, в стиле канала, опираешься на проверенные источники. Публикуешь только после одобрения Ника. (Агент пока не подключён.)`,
    research: `Ты Виктор Рынков, Market Researcher. Исследуешь рынок и спрос: проверка гипотез по WorkFlow AI, ниши для заработка на автоматизации, конкуренты. Все выводы с источниками, без выдумок. (Агент пока не подключён.)`,
  };
  for (const [id, body] of Object.entries(P)) {
    run('INSERT INTO prompts (agent_id,body,version,updated_at) VALUES (?,?,?,?)', id, body, 1, t);
    run('INSERT INTO prompt_history (agent_id,version,body,ts) VALUES (?,?,?,?)', id, 1, body, t);
  }
  const S = [
    ['web-research', 'Веб-поиск и чтение страниц', 'Искать и читать страницы, извлекать факты со ссылками на источники.'],
    ['job-filter', 'Фильтр вакансий', 'Отбор по уровню (junior/associate), опыту до 3 лет, формату и вилке зарплаты.'],
    ['company-brief', 'Сводка о компании', 'Краткое описание компании: чем занимается, размер, продукт, свежие новости.'],
    ['cover-letter', 'Сопроводительные письма', 'Персонализированные письма под компанию с реальными кейсами Ника.'],
    ['telegram-notify', 'Уведомления в Telegram', 'Отправка карточек и писем Нику на согласование.'],
    ['post-writing', 'Написание постов', 'Тексты для Telegram-каналов и блога в стиле канала.'],
    ['market-research', 'Исследование рынка', 'Проверка спроса, конкуренты, ниши, с источниками.'],
    ['task-planning', 'Планирование и распределение задач', 'Дробление цели на задачи и распределение между сотрудниками.'],
  ];
  for (const x of S) run('INSERT INTO skills (id,name,description) VALUES (?,?,?)', ...x);
  const AS = { captain: ['task-planning', 'telegram-notify'], scout: ['web-research', 'job-filter'], analyst: ['web-research', 'company-brief', 'telegram-notify'],
    writer: ['cover-letter'], sender: ['telegram-notify'], content: ['post-writing', 'web-research'], research: ['market-research', 'web-research'] };
  for (const [a, list] of Object.entries(AS)) for (const sk of list) run('INSERT INTO agent_skills VALUES (?,?)', a, sk);
}
seedPrompts();

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
      scenes: q('SELECT * FROM scenes WHERE ts + ttl > ? ORDER BY id', now()),
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

  if (req.method === 'GET' && url.pathname === '/api/agent-config') {
    const id = url.searchParams.get('id');
    return json(res, 200, {
      prompt: q('SELECT * FROM prompts WHERE agent_id=?', id)[0] || null,
      history: q('SELECT version, ts, substr(body,1,160) preview FROM prompt_history WHERE agent_id=? ORDER BY version DESC LIMIT 20', id),
      skills: q('SELECT s.* FROM skills s JOIN agent_skills a ON a.skill_id=s.id WHERE a.agent_id=?', id),
      allSkills: q('SELECT id,name,description FROM skills ORDER BY name'),
    });
  }
  if (req.method === 'POST' && url.pathname === '/api/prompt') {
    const b = await body(req);
    const body_ = String(b.body || '').trim();
    if (!b.id || !body_ || body_.length > 8000) return json(res, 400, { error: 'bad prompt' });
    const cur = q('SELECT version FROM prompts WHERE agent_id=?', b.id)[0];
    if (!cur) return json(res, 404, { error: 'no agent' });
    const v = cur.version + 1;
    run('UPDATE prompts SET body=?, version=?, updated_at=? WHERE agent_id=?', body_, v, now(), b.id);
    run('INSERT INTO prompt_history (agent_id,version,body,ts) VALUES (?,?,?,?)', b.id, v, body_, now());
    run('INSERT INTO events (ts,agent_id,level,message) VALUES (?,?,?,?)', now(), b.id, 'info', `Промпт обновлён (версия ${v})`);
    return json(res, 200, { ok: true, version: v });
  }
  if (req.method === 'POST' && url.pathname === '/api/agent-skills') {
    const b = await body(req);
    if (!b.id || !Array.isArray(b.skills)) return json(res, 400, { error: 'bad request' });
    run('DELETE FROM agent_skills WHERE agent_id=?', b.id);
    for (const sk of b.skills) run('INSERT OR IGNORE INTO agent_skills VALUES (?,?)', b.id, String(sk));
    return json(res, 200, { ok: true });
  }
  if (req.method === 'POST' && url.pathname === '/api/scene') {
    const b = await body(req);
    run('INSERT INTO scenes (ts,kind,from_id,to_id,text,ttl) VALUES (?,?,?,?,?,?)', now(), b.kind || 'chat', b.from, b.to, b.text, b.ttl || 9000);
    run('DELETE FROM scenes WHERE ts < ?', now() - 3600000);
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

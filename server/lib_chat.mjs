// Чат Ника с сотрудниками офиса: единая переписка для дашборда и Telegram-бота SMM (источник правды: таблица messages).
// Действия, ждущие ответа Ника (выбор темы, утверждение сценария, приём ролика), это сообщения kind='action' с кнопками.
// Ответ из любого канала проходит через answer(): кнопки гасятся в обоих, действие выполняется один раз.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const OWNER = 323028999;
const NAMES = { капитан: 'captain_smm', кряк: 'captain_smm', виктор: 'research', ксения: 'scriptwriter', лев: 'virality', вера: 'factcheck', кирилл: 'video' };
const REPLY_PROFILE = { video: 'video' };     // Кирилл отвечает на Opus 5.5, остальные SMM на профиле smm
const STAGE_LABEL = { idea: 'идея', scored: 'оценена, ждёт выбора', script: 'сценарий пишется/проверяется', checked: 'сценарий проверен, ждёт утверждения', editing: 'монтаж', produced: 'ролик готов, ждёт приёма', approved: 'принят', rejected: 'отклонена', published: 'опубликован' };

export function setupChat({ db, ROOT, DATA_DIR }) {
  const q = (sql, ...a) => db.prepare(sql).all(...a);
  const run = (sql, ...a) => db.prepare(sql).run(...a);
  const now = () => Date.now();
  db.exec(`
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, office TEXT NOT NULL DEFAULT 'smm',
  thread TEXT NOT NULL,                  -- id сотрудника, с которым ведётся переписка
  sender TEXT NOT NULL,                  -- nick | id сотрудника | system
  kind TEXT NOT NULL DEFAULT 'text',     -- text | action
  text TEXT NOT NULL, buttons TEXT,      -- JSON [[{t,d}]]
  status TEXT, choice TEXT, answered_ts INTEGER, answered_via TEXT,   -- для action: open | answered
  source TEXT, tg_msg INTEGER, ref TEXT
);
CREATE INDEX IF NOT EXISTS idx_messages_office ON messages(office, id);
`);
  const NO_TG = !!process.env.OFFICE_NO_TG, STUB = !!process.env.OFFICE_CHAT_STUB;
  const HERMES = process.env.HERMES_BIN || path.join(process.env.LOCALAPPDATA || '', 'hermes', 'hermes-agent', '.hermes', 'bin', 'hermes.exe');
  const cfg = () => { try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'config.json'), 'utf8')); } catch { return {}; } };
  const kvGet = (k) => (q('SELECT v FROM kv WHERE k=?', k)[0] || {}).v;
  const kvSet = (k, v) => run('INSERT INTO kv (k,v) VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v', k, v);
  const kvDel = (k) => run('DELETE FROM kv WHERE k=?', k);
  const nameOf = (id) => (q('SELECT name FROM agents WHERE id=?', id)[0] || {}).name || id;
  const typing = new Map();                 // agent_id -> число активных ответов

  /* ---------- Telegram ---------- */
  async function tg(method, body) {
    const t = cfg().smmBotToken; if (!t || NO_TG) return { ok: false, description: 'telegram off' };
    const r = await fetch(`https://api.telegram.org/bot${t}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return r.json();
  }
  const chatId = () => cfg().smmBotChatId || OWNER;
  const kbOf = (buttons) => { const b = buttons && JSON.parse(buttons); return b && b.length ? { inline_keyboard: b.map((row) => row.map((x) => ({ text: x.t, callback_data: x.d }))) } : undefined; };
  function tgText(m) {
    if (m.sender === 'nick') return `✍️ Вы (${m.source === 'telegram' ? 'Telegram' : 'дашборд'}) → ${nameOf(m.thread)}: ${m.text}`;
    return /^[\p{Extended_Pictographic}]/u.test(m.text) ? m.text : `${nameOf(m.sender)}: ${m.text}`;
  }
  async function mirror(id, silent = false) {
    const m = q('SELECT * FROM messages WHERE id=?', id)[0]; if (!m || m.tg_msg) return;
    const parts = []; let cur = '';
    for (const line of tgText(m).split('\n')) { if ((cur + line).length > 3800 && cur) { parts.push(cur.trimEnd()); cur = ''; } cur += line + '\n'; }
    if (cur.trim()) parts.push(cur.trimEnd());
    for (let i = 0; i < parts.length; i++) {
      const r = await tg('sendMessage', { chat_id: chatId(), text: parts[i], disable_web_page_preview: true, disable_notification: silent, reply_markup: i === parts.length - 1 ? kbOf(m.buttons) : undefined });
      if (r.ok && i === parts.length - 1) run('UPDATE messages SET tg_msg=? WHERE id=?', r.result.message_id, id);
      if (!r.ok && r.description !== 'telegram off') console.error('TG:', r.description);
    }
  }

  /* ---------- сообщения ---------- */
  function post({ office = 'smm', thread, sender, kind = 'text', text, buttons = null, source = 'pipeline', ref = null, tgMsg = null, mirrorTg = false, silent = false }) {
    const b = buttons ? JSON.stringify(buttons.map((row) => row.map((x) => (Array.isArray(x) ? { t: x[0], d: x[1] } : x)))) : null;
    const r = run('INSERT INTO messages (ts,office,thread,sender,kind,text,buttons,status,source,tg_msg,ref) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      now(), office, thread, sender, kind, String(text).slice(0, 12000), b, kind === 'action' ? 'open' : null, source, tgMsg, ref ? JSON.stringify(ref) : null);
    const id = Number(r.lastInsertRowid);
    if (mirrorTg && !tgMsg && office === 'smm') mirror(id, silent).catch((e) => console.error('mirror', e.message));
    return id;
  }
  const say = (agentId, text, mirrorTg = false) => post({ thread: agentId, sender: agentId, text, mirrorTg });
  const setAgent = (id, status, task, log) => {
    run('UPDATE agents SET status=COALESCE(?,status), task=COALESCE(?,task), updated_at=? WHERE id=?', status ?? null, task ?? null, now(), id);
    if (log) run('INSERT INTO events (ts,agent_id,level,message) VALUES (?,?,?,?)', now(), id, 'info', log);
  };
  const setStage = (id, stage) => run('UPDATE videos SET stage=?, updated_at=? WHERE id=?', stage, now(), id);

  function spawnPipeline(args) {
    fs.mkdirSync(path.join(ROOT, 'smm'), { recursive: true });
    const out = fs.openSync(path.join(ROOT, 'smm', 'pipeline.log'), 'a');
    spawn(process.execPath, [path.join(ROOT, 'scripts', 'smm_pipeline.mjs'), ...args], { cwd: ROOT, detached: true, stdio: ['ignore', out, out], windowsHide: true }).unref();
  }

  /* ---------- выполнение действий (кнопки и подтверждённые предложения) ---------- */
  // Решение принято: закрываем устаревшие открытые карточки с такими же кнопками (и в Telegram убираем кнопки), чтобы не запустить лишнее
  function supersede(prefix) {
    for (const o of q("SELECT id, tg_msg FROM messages WHERE kind='action' AND status='open' AND buttons LIKE ?", `%"d":"${prefix}%`)) {
      run("UPDATE messages SET status='answered', choice='superseded', answered_ts=?, answered_via='system' WHERE id=?", now(), o.id);
      if (o.tg_msg && !NO_TG) tg('editMessageReplyMarkup', { chat_id: chatId(), message_id: o.tg_msg, reply_markup: { inline_keyboard: [] } }).catch(() => {});
    }
  }
  async function execAction(data, comment, via, srcMsg) {
    const [act, idStr] = String(data).split(':'); const id = Number(idStr);
    const v = act === 'confirm' || act === 'cancel' ? null : (id ? q('SELECT * FROM videos WHERE id=?', id)[0] : null);
    const cap = (text, mirrorTg = true) => post({ thread: 'captain_smm', sender: 'captain_smm', text, mirrorTg });
    if (act === 'confirm') {
      const m = q('SELECT * FROM messages WHERE id=?', id)[0]; const ref = m && m.ref && JSON.parse(m.ref);
      if (!ref) return { note: 'нет предложения' };
      return execAction(ref.data, ref.comment, via, m);
    }
    if (act === 'cancel') { cap('Хорошо, не делаю.', false); return {}; }
    if (act === 'pick' && v) {
      for (const o of q("SELECT id FROM videos WHERE stage='scored' AND id<>?", id)) setStage(o.id, 'idea');
      supersede('pick:'); supersede('more:');
      setStage(id, 'script'); setAgent('captain_smm', 'working', `Тема выбрана: ${v.title}`, `Ник выбрал тему «${v.title}»`);
      cap(`Тема выбрана: «${v.title}».\nКсения пишет сценарий, Вера проверит каждый факт. Пришлю результат сюда.`);
      spawnPipeline(['script', String(id)]);
    } else if (act === 'more') {
      supersede('pick:'); supersede('more:');
      for (const o of q("SELECT id FROM videos WHERE stage='scored'")) setStage(o.id, 'rejected');
      cap('Хорошо, ищу другие темы. Пришлю новый список.'); spawnPipeline(['topics', '--hint', 'другие темы, не повторяя уже предложенные']);
    } else if (act === 'approve' && v) {
      supersede(`approve:${id}`); supersede(`revise:${id}`);
      setStage(id, 'editing');
      cap(`Сценарий утверждён: «${v.title}».\nКирилл Кадров (Opus 5.5) озвучивает и монтирует, обычно около часа. Пришлю готовый ролик.`);
      spawnPipeline(['produce', String(id)]);
    } else if (act === 'revise' && v) {
      if (comment && comment.trim()) { supersede(`approve:${id}`); supersede(`revise:${id}`); cap('Передала Ксении: исправит, Вера проверит заново.'); spawnPipeline(['script', String(id), '--comment', comment.trim()]); }
      else { kvSet('awaiting', JSON.stringify({ kind: 'script', id })); cap('Напишите одним сообщением, что поправить в сценарии (здесь или в Telegram). Ксения исправит и Вера проверит заново.'); }
    } else if (act === 'accept' && v) {
      setStage(id, 'approved'); setAgent('captain_smm', 'idle', 'Ролик принят, ждёт вашей публикации', `Ник принял ролик «${v.title}»`);
      cap('Ролик принят. Публикуете вы сами, когда готовы.');
    } else if (act === 'resume') {
      const job = jobInfo() || { ver: 'v2', brief: 'dosie01/BRIEF_v2b.md' };
      const dir = path.join(ROOT, 'video', 'med_detective'); const out = fs.openSync(path.join(dir, 'dosie01', `_run_${job.ver}_resume_log.txt`), 'a');
      spawn(HERMES, ['-p', 'video', 'chat', '--query-file', job.brief, '-Q', '--oneshot', '--max-turns', '400', '--run-budget', '5400'], { cwd: dir, detached: true, stdio: ['ignore', out, out], windowsHide: true }).unref();
      cap('Запустила Кирилла заново: он продолжит по сохранённым файлам. Ход работы виден справа в «Сейчас в работе».');
    } else if (act === 'retry' && v) {
      if (v.stage === 'editing') { cap(`Запускаю монтаж заново: «${v.title}».`); spawnPipeline(['produce', String(id)]); }
      else { setStage(id, 'script'); cap(`Запускаю сценарий заново: «${v.title}».`); spawnPipeline(['script', String(id)]); }
    } else if (act === 'reject' && v) {
      setStage(id, 'rejected'); cap('Тема отклонена.');
    } else return { note: 'неизвестное действие' };
    return {};
  }

  // Ответ Ника на действие (из дашборда, Telegram или подтверждение предложения агента)
  async function answer({ id, tgMsg, choice, comment, via }) {
    const m = id ? q('SELECT * FROM messages WHERE id=?', id)[0] : q('SELECT * FROM messages WHERE tg_msg=?', tgMsg)[0];
    if (!m || m.kind !== 'action') return { ok: false, error: 'такого вопроса нет' };
    if (m.status !== 'open') return { ok: false, error: 'на этот вопрос уже ответили' };
    const btn = JSON.parse(m.buttons || '[]').flat().find((b) => b.d === choice);
    if (!btn) return { ok: false, error: 'нет такой кнопки' };
    run("UPDATE messages SET status='answered', choice=?, answered_ts=?, answered_via=? WHERE id=?", choice, now(), via, m.id);
    if (m.tg_msg && !NO_TG) {
      tg('editMessageReplyMarkup', { chat_id: chatId(), message_id: m.tg_msg, reply_markup: { inline_keyboard: [] } }).catch(() => {});
      if (via === 'dashboard') tg('sendMessage', { chat_id: chatId(), text: `✅ Ответ из дашборда: ${btn.t}${comment ? ': ' + comment : ''}`, disable_notification: true }).catch(() => {});
    }
    post({ office: m.office, thread: m.thread, sender: 'nick', text: comment ? `${btn.t}: ${comment}` : btn.t, source: via });
    try { await execAction(choice, comment, via, m); } catch (e) { post({ thread: m.thread, sender: 'captain_smm', text: 'Не получилось выполнить: ' + e.message }); return { ok: false, error: e.message }; }
    return { ok: true };
  }

  /* ---------- свободный текст: ответ сотрудника ---------- */
  const resolveThread = (text, fallback = 'captain_smm') => {
    const m = /^\s*@?([\p{L}-]+)[\s,:;—-]/u.exec(text + ' '); const id = m && NAMES[m[1].toLowerCase()];
    return id ? { thread: id, text: text.replace(/^\s*@?[\p{L}-]+[\s,:;—-]+/u, '').trim() || text } : { thread: fallback, text };
  };
  function context(office, thread) {
    const vs = q("SELECT id,title,stage,score FROM videos WHERE office='smm' ORDER BY updated_at DESC LIMIT 12").map((v) => `#${v.id} «${v.title}» [${STAGE_LABEL[v.stage] || v.stage}] балл ${v.score ?? '—'}`).join('\n') || 'нет';
    const pend = q("SELECT id,thread,substr(text,1,140) t FROM messages WHERE office=? AND kind='action' AND status='open'", office).map((p) => `· (${p.thread}) ${p.t.replace(/\n/g, ' ')}`).join('\n') || 'нет';
    const hist = q('SELECT sender,text FROM messages WHERE office=? AND thread=? ORDER BY id DESC LIMIT 14', office, thread).reverse().map((h) => `${h.sender === 'nick' ? 'Ник' : nameOf(h.sender)}: ${h.text.slice(0, 600)}`).join('\n');
    return { vs, pend, hist };
  }
  async function reply(office, thread, nickMsgId, text) {
    const ag = q('SELECT * FROM agents WHERE id=?', thread)[0]; if (!ag) return;
    typing.set(thread, (typing.get(thread) || 0) + 1);
    const dir = path.join(ROOT, 'smm', 'chat'); fs.mkdirSync(dir, { recursive: true });
    const outFile = path.join(dir, `${nickMsgId}_out.json`), qFile = path.join(dir, `${nickMsgId}_query.txt`);
    try {
      let rep = null, action = null;
      if (STUB) { await new Promise((r) => setTimeout(r, 800)); rep = `(заглушка) ${ag.name} получил: «${text}»`; }
      else {
        const persona = (q('SELECT body FROM prompts WHERE agent_id=?', thread)[0] || {}).body || `Ты ${ag.name}, ${ag.role}.`;
        const c = context(office, thread);
        fs.writeFileSync(qFile, `${persona}

=== ЧАТ С НИКОМ ===
Ник пишет тебе в чат офиса (из Telegram или дашборда). Ответь по-русски, коротко и по делу, от своего имени и в своей роли, без воды. Ничего не выдумывай: не знаешь, так и скажи. Не публикуй, никому не пиши, файлы не меняй. Для справки читать файлы можно: smm/runs/ (темы, сценарии, проверки), video/med_detective/ (DESIGN.md, ролики), docs/.
Состояние конвейера роликов:
${c.vs}
Вопросы, ждущие ответа Ника:
${c.pend}
Недавняя переписка с тобой:
${c.hist}

Новое сообщение Ника: ${text}

Если Ник просит выполнить шаг конвейера (выбрать тему, утвердить сценарий, вернуть его на правки, принять или отклонить ролик, найти другие темы), НЕ говори, что уже сделала: предложи действие в поле action, Ник подтвердит кнопкой. Типы: pick (video_id), more, approve (video_id), revise (video_id, comment), accept (video_id), reject (video_id).
Итог запиши в файл ${outFile} строго как JSON: {"reply":"текст ответа Нику","action":null или {"type":"pick","video_id":3,"comment":""}}. После записи файла ничего больше не делай.`, 'utf8');
        await new Promise((resolve) => {
          const p = spawn(HERMES, ['-p', office === 'smm' ? (REPLY_PROFILE[thread] || 'smm') : 'jobs', 'chat', '--query-file', qFile, '-Q', '--oneshot', '--max-turns', '30', '--run-budget', '420'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
          let out = ''; p.stdout.on('data', (b) => (out += b)); p.stderr.on('data', (b) => (out += b));
          p.on('exit', () => { try { const j = JSON.parse(fs.readFileSync(outFile, 'utf8')); rep = j.reply; action = j.action; } catch { rep = out.replace(/session_id:.*$/s, '').trim().slice(0, 1500) || null; } resolve(); });
        });
      }
      if (!rep) rep = 'Не получилось ответить сейчас, повторите вопрос чуть позже.';
      post({ office, thread, sender: thread, text: rep, source: 'agent', mirrorTg: true });
      const ACTS = new Set(['pick', 'more', 'approve', 'revise', 'accept', 'reject']);
      if (action && ACTS.has(action.type)) {
        const v = action.video_id ? q('SELECT title FROM videos WHERE id=?', Number(action.video_id))[0] : null;
        if (action.type === 'more' || v) {
          const data = `${action.type}:${action.type === 'more' ? 0 : Number(action.video_id)}`;
          const label = { pick: 'Выбрать тему', more: 'Искать другие темы', approve: 'Утвердить сценарий', revise: 'Вернуть на правки', accept: 'Принять ролик', reject: 'Отклонить' }[action.type];
          const mid = post({ office, thread: 'captain_smm', sender: 'captain_smm', kind: 'action', text: `Правильно ли я поняла: ${label.toLowerCase()}${v ? ` «${v.title}»` : ''}${action.comment ? ` (${action.comment})` : ''}?`, ref: { data, comment: action.comment || '' }, buttons: [[['Да, сделать', 'confirm:0'], ['Нет', 'cancel:0']]], mirrorTg: false });
          run('UPDATE messages SET buttons=? WHERE id=?', JSON.stringify([[{ t: 'Да, сделать', d: `confirm:${mid}` }, { t: 'Нет', d: `cancel:${mid}` }]]), mid);
          mirror(mid).catch(() => {});
        }
      }
    } catch (e) { post({ office, thread, sender: thread, text: 'Ошибка ответа: ' + e.message, source: 'agent' }); }
    finally { typing.set(thread, Math.max(0, (typing.get(thread) || 1) - 1)); if (!typing.get(thread)) typing.delete(thread); }
  }

  // Сообщение Ника: из дашборда (thread задан) или из Telegram (thread по имени, иначе Капитан)
  function incoming({ text, source, thread, office = 'smm' }) {
    text = String(text || '').trim(); if (!text) return { ok: false, error: 'пусто' };
    let t = thread, body = text;
    if (!t) { const r = resolveThread(text); t = r.thread; body = r.text; }
    const id = post({ office, thread: t, sender: 'nick', text: source === 'telegram' ? text : body, source, mirrorTg: false });
    if (source === 'dashboard') mirror(id, true).catch(() => {});
    // ожидается комментарий к сценарию: следующий текст в чате Капитана
    const aw = kvGet('awaiting');
    if (aw && t === 'captain_smm') {
      const { id: vid } = JSON.parse(aw); kvDel('awaiting');
      post({ thread: 'captain_smm', sender: 'captain_smm', text: 'Передала Ксении: исправит, Вера проверит заново.', mirrorTg: true });
      spawnPipeline(['script', String(vid), '--comment', body]);
      return { ok: true, id, note: 'comment' };
    }
    reply(office, t, id, body).catch((e) => console.error('reply', e.message));
    return { ok: true, id };
  }


  /* ---------- сторож реальной работы: статус сотрудника не расходится с процессами на ПК ----------
     Пока на ПК жив процесс `hermes … -p video … BRIEF*.md` (Кирилл, запущенный не через конвейер), он показывается рабочим.
     Живой лог: шаги модели из лога профиля, новые/изменённые файлы проекта, строки PROGRESS.md.
     Завершение: есть итоговый mp4 → ролик уходит Нику в Telegram с кнопкой «Принять»; нет mp4 → статус «ошибка» и сообщение. */
  const VIDEO_JOB = { agent: 'video', videoId: 1, dir: path.join(ROOT, 'video', 'med_detective', 'dosie01') };
  // Какая версия ролика собирается сейчас: из имени BRIEF_vN.md в командной строке процесса; хранится в kv, чтобы пережить перезапуск API
  const jobInfo = () => { try { return JSON.parse(kvGet('video_job')); } catch { return null; } };
  const jobFiles = (ver) => ({ mp4: path.join(VIDEO_JOB.dir, 'final', `dosie01_${ver}.mp4`), report: path.join(VIDEO_JOB.dir, `RESULT_${ver}.md`) });
  const PROC_RE = /hermes\.exe"?\s+-p\s+video\b.*?(BRIEF[\w.-]*\.md)/i;
  const AGENT_LOG = path.join(process.env.LOCALAPPDATA || '', 'hermes', 'profiles', 'video', 'logs', 'agent.log');
  const W = { pid: null, started: 0, lastScan: 0, lastProgress: '', steps: 0 };
  const evt = (agent, msg, level = 'info') => { if (q('SELECT 1 FROM events WHERE agent_id=? AND message=? AND ts>?', agent, msg, now() - 15 * 60e3).length) return; run('INSERT INTO events (ts,agent_id,level,message) VALUES (?,?,?,?)', now(), agent, level, msg); };   // без дублей после перезапуска API
  function listProcs() {
    return new Promise((resolve) => {
      const p = spawn('powershell.exe', ['-NoProfile', '-Command', "Get-CimInstance Win32_Process -Filter \"Name='hermes.exe'\" | ForEach-Object { $_.ProcessId.ToString() + '|' + $_.CreationDate.ToString('o') + '|' + $_.CommandLine }"], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
      let o = ''; p.stdout.on('data', (b) => (o += b)); p.on('exit', () => resolve(o.split(/\r?\n/).filter(Boolean))); p.on('error', () => resolve([]));
    });
  }
  const tailOf = (f, bytes = 70000) => { try { const fd = fs.openSync(f, 'r'); const st = fs.fstatSync(fd); const len = Math.min(bytes, st.size); const buf = Buffer.alloc(len); fs.readSync(fd, buf, 0, len, st.size - len); fs.closeSync(fd); return buf.toString('utf8'); } catch { return ''; } };
  const briefTask = (file) => { try { const h = /^#\s*(.+)$/m.exec(fs.readFileSync(file, 'utf8')); if (h) return h[1].replace(/^Задание[^:]*:\s*/i, '').slice(0, 120); } catch {} return null; };
  function modelSteps(since) {          // «API call #N» и последний инструмент из лога профиля video, только записи новее старта процесса
    let steps = 0, lastTool = '';
    for (const l of tailOf(AGENT_LOG).split(/\r?\n/)) {
      const m = /^(\d{4}-\d\d-\d\d) (\d\d:\d\d:\d\d),\d+ .*?(API call #(\d+)|tool (\w+) completed \(([\d.]+)s)/.exec(l); if (!m) continue;
      if (Date.parse(`${m[1]}T${m[2]}`) < since - 5000) continue;
      if (m[4]) steps = Math.max(steps, Number(m[4])); else if (m[5]) lastTool = `${m[5]} ${m[6]} с`;
    }
    return { steps, lastTool };
  }
  function scanFiles(since) {           // что изменилось в проекте ролика после прошлой проверки
    const out = [];
    const walk = (d, depth) => { let ents = []; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
      for (const e of ents) { const f = path.join(d, e.name); if (e.isDirectory()) { if (depth < 2 && !/^(v1_archive|node_modules|frames|\.)/.test(e.name)) walk(f, depth + 1); }
        else if (!/^(_run|PROGRESS)/.test(e.name)) { try { const st = fs.statSync(f); if (st.mtimeMs > since) out.push(path.relative(VIDEO_JOB.dir, f).replace(/\\/g, '/')); } catch {} } } };
    walk(VIDEO_JOB.dir, 0); return out;
  }
  async function sendVideo(file, caption, buttons) {
    const t = cfg().smmBotToken; if (!t || NO_TG) return null;
    const fd = new FormData(); fd.append('chat_id', String(chatId())); fd.append('caption', caption.slice(0, 1000)); fd.append('supports_streaming', 'true'); fd.append('width', '1080'); fd.append('height', '1920');
    const kb = kbOf(JSON.stringify(buttons.map((row) => row.map((x) => ({ t: x[0], d: x[1] }))))); if (kb) fd.append('reply_markup', JSON.stringify(kb));
    fd.append('video', new Blob([fs.readFileSync(file)], { type: 'video/mp4' }), path.basename(file));
    const r = await (await fetch(`https://api.telegram.org/bot${t}/sendVideo`, { method: 'POST', body: fd })).json();
    return r.ok ? r.result.message_id : null;
  }
  async function finishVideoJob(ag) {
    const job = jobInfo() || { ver: 'v2', started: 0, brief: 'dosie01/BRIEF_v2b.md' };
    const { mp4, report } = jobFiles(job.ver), fresh = (f) => { try { return fs.statSync(f).mtimeMs >= job.started - 5000; } catch { return false; } };   // файл должен быть создан ЭТИМ запуском, а не остаться от прошлой версии
    const mp4ok = fresh(mp4), ok = mp4ok && fresh(report), draft = mp4ok && !ok;
    if (!ok) {
      run('UPDATE agents SET status=?, task=?, progress=?, updated_at=? WHERE id=?', 'error', draft ? `Остановился: есть черновой рендер ${job.ver}, но без финальной проверки` : `Остановился без результата: ролика ${job.ver} нет`, 0, now(), VIDEO_JOB.agent);
      evt(VIDEO_JOB.agent, draft ? 'Процесс остановился: есть черновой рендер, отчёта и финальной проверки нет' : 'Процесс монтажа остановился, итогового ролика нет', 'error');
      post({ thread: 'captain_smm', sender: 'captain_smm', kind: 'action', text: draft ? `⚠️ Кирилл остановился: черновой рендер ${job.ver} есть, но финальной проверки и отчёта нет, отдавать его на приёмку рано. Рабочие файлы сохранены, он продолжит с того места. Запустить заново?` : `⚠️ Кирилл остановился, и ролика ${job.ver} нет. Его рабочие файлы сохранены, он продолжит с того места. Запустить заново?`, buttons: [[{ t: 'Запустить Кирилла заново', d: `resume:${VIDEO_JOB.videoId}` }]], mirrorTg: true });
      return;
    }
    run('UPDATE agents SET status=?, task=?, progress=?, updated_at=? WHERE id=?', 'idle', `Ролик ${job.ver} готов, ждёт вашего просмотра`, 100, now(), VIDEO_JOB.agent);
    evt(VIDEO_JOB.agent, `Ролик ${job.ver} собран: final/dosie01_${job.ver}.mp4`);
    let len = ''; try { len = fs.readFileSync(report, 'utf8').slice(0, 600); } catch {}
    const caption = `🎬 Ролик №${VIDEO_JOB.videoId} ${job.ver} готов. Посмотрите и скажите, принимаем ли.\n${len}`;
    const buttons = [[['Принять ролик', `accept:${VIDEO_JOB.videoId}`]]];
    let mid = null; try { mid = await sendVideo(mp4, caption, buttons); } catch (e) { console.error('sendVideo', e.message); }
    post({ thread: 'captain_smm', sender: 'captain_smm', kind: 'action', text: `🎬 Ролик №${VIDEO_JOB.videoId} ${job.ver} готов: ${path.relative(ROOT, mp4)}${mid ? '\n(файл отправлен вам в Telegram)' : '\n(файл лежит на ПК, в Telegram отправить не удалось)'}\n${len}\nЕсли нужны правки, напишите Кириллу в чате.`, buttons: buttons.map((r) => r.map((x) => ({ t: x[0], d: x[1] }))), tgMsg: mid, mirrorTg: !mid });
    run('UPDATE agents SET status=?, task=?, updated_at=? WHERE id=?', 'waiting', `Ждёт вашего решения по ролику №${VIDEO_JOB.videoId} ${job.ver}`, now(), 'captain_smm');
  }
  async function watchTick() {
    const procs = (await listProcs()).map((l) => { const [pid, cd, ...cmd] = l.split('|'); return { pid, started: Date.parse(cd) || now(), cmd: cmd.join('|') }; });
    const hit = procs.find((x) => PROC_RE.test(x.cmd));
    const ag = q('SELECT status,task FROM agents WHERE id=?', VIDEO_JOB.agent)[0]; if (!ag) return;
    if (hit) {
      const file = path.join(VIDEO_JOB.dir, PROC_RE.exec(hit.cmd)[1]);
      const task = briefTask(file) || 'Монтаж ролика';
      const mins = Math.round((now() - hit.started) / 60000);
      if (W.pid !== hit.pid) {
        Object.assign(W, { pid: hit.pid, started: hit.started, lastScan: hit.started, lastProgress: '', steps: 0 }); evt(VIDEO_JOB.agent, `Начал работу: ${task}`);
        const bn = PROC_RE.exec(hit.cmd)[1], ver = (/BRIEF_(v\d+)/i.exec(bn) || [, 'v1'])[1];
        const prev = jobInfo(); if (!prev || prev.started !== hit.started) kvSet('video_job', JSON.stringify({ ver, started: hit.started, brief: 'dosie01/' + bn }));
      }
      const { steps, lastTool } = modelSteps(hit.started);
      if (steps && steps !== W.steps) W.steps = steps;
      const files = scanFiles(W.lastScan); W.lastScan = now() - 1000;
      if (files.length) evt(VIDEO_JOB.agent, `Обновил файлы: ${files.slice(0, 4).join(', ')}${files.length > 4 ? ` и ещё ${files.length - 4}` : ''}`);
      try { const last = fs.readFileSync(path.join(VIDEO_JOB.dir, 'PROGRESS.md'), 'utf8').split(/\r?\n/).map((s) => s.trim()).filter(Boolean).pop();
        if (last && last !== W.lastProgress) { W.lastProgress = last; evt(VIDEO_JOB.agent, last.slice(0, 220)); } } catch {}
      const pr = Math.min(92, 8 + Math.round(mins * 1.2));
      run('UPDATE agents SET status=?, task=?, progress=?, updated_at=? WHERE id=?', 'working', `${task} ⏱ ${mins} мин${W.steps ? ` · шаг ${W.steps}` : ''}`, pr, now(), VIDEO_JOB.agent);
    } else if (ag.status === 'working' && String(ag.task).includes('⏱')) {
      W.pid = null; await finishVideoJob(ag);
    }
  }
  if (!process.env.OFFICE_NO_WATCH) { setInterval(() => watchTick().catch((e) => console.error('watch', e.message)), 15000); setTimeout(() => watchTick().catch(() => {}), 3000); }

  /* ---------- HTTP ---------- */
  async function handle(req, res, url, body, json) {
    const p = url.pathname;
    if (req.method === 'GET' && p === '/api/chat') {
      const office = url.searchParams.get('office') === 'jobs' ? 'jobs' : 'smm';
      const messages = q('SELECT * FROM messages WHERE office=? ORDER BY id DESC LIMIT 400', office).reverse().map((m) => ({ ...m, buttons: m.buttons ? JSON.parse(m.buttons) : null }));
      json(res, 200, { messages, pending: messages.filter((m) => m.status === 'open').length, typing: [...typing.keys()] }); return true;
    }
    if (req.method === 'POST' && p === '/api/chat/send') {
      const b = await body(req); json(res, 200, incoming({ text: b.text, source: 'dashboard', thread: b.to, office: b.office === 'jobs' ? 'jobs' : 'smm' })); return true;
    }
    if (req.method === 'POST' && p === '/api/chat/incoming') { const b = await body(req); json(res, 200, incoming({ text: b.text, source: b.source || 'telegram' })); return true; }
    if (req.method === 'POST' && p === '/api/chat/answer') { const b = await body(req); json(res, 200, await answer({ id: b.id, tgMsg: b.tg_msg, choice: b.choice, comment: b.comment, via: b.via || 'dashboard' })); return true; }
    if (req.method === 'POST' && p === '/api/chat/post') {
      const b = await body(req);
      const id = post({ office: b.office || 'smm', thread: b.thread, sender: b.sender || b.thread, kind: b.buttons ? 'action' : (b.kind || 'text'), text: b.text, buttons: b.buttons, source: b.source || 'pipeline', tgMsg: b.tg_msg || null, mirrorTg: b.mirror !== false && !b.tg_msg && (b.mirror === true || !!b.buttons) });
      json(res, 200, { ok: true, id }); return true;
    }
    return false;
  }
  const pending = (office) => q("SELECT COUNT(*) c FROM messages WHERE office=? AND status='open'", office)[0].c;
  return { handle, pending, post, say, answer, incoming };
}

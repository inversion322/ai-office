// Чат Ника с сотрудниками офиса: единая переписка для дашборда и Telegram-бота SMM (источник правды: таблица messages).
// Действия, ждущие ответа Ника (выбор темы, утверждение сценария, приём ролика), это сообщения kind='action' с кнопками.
// Ответ из любого канала проходит через answer(): кнопки гасятся в обоих, действие выполняется один раз.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { cleanReport } from './lib_text.mjs';
import { topicRequest, formatSwitch, classifyAnswer, quickPick, topicMentioned, stripButtonTalk, studioPlanRequest, studioAutoSwitch, studioSelection } from './lib_intent.mjs';
import * as STUDIO from '../scripts/studio.mjs';
import { probeVideo, checkFormat, sendFields } from '../scripts/video_format.mjs';
import { variantOf, groupMembers, isGroup, anchorOf, parseVariantComment, enabledFormats, readSettings, writeSettings, FORMATS as VFORMATS } from '../scripts/variants.mjs';
import { parseWhen, isCancelWhen, fmtMsk } from '../scripts/publish_when.mjs';

const OWNER = 323028999;
const NAMES = { капитан: 'captain_smm', кряк: 'captain_smm', виктор: 'research', ксения: 'scriptwriter', лев: 'virality', вера: 'factcheck', кирилл: 'video', матвей: 'video_b', роман: 'video_c', тимофей: 'packager' };
const REPLY_PROFILE = { video: 'video', video_b: 'video_b', video_c: 'video_c' };     // Кирилл отвечает на Opus 5.5, остальные SMM на профиле smm
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
  status TEXT, choice TEXT, answered_ts INTEGER, answered_via TEXT,   -- для action: open | answered | dismissed (Ник убрал карточку без действия)
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

  /* ---------- приоритет правок ролика ----------
     Пока Кирилл вносит правки Ника в ролик, остальные этапы конвейера (темы, сценарии, проверки, первичный монтаж) не стартуют новую тяжёлую работу
     (озвучка, рендер и запросы моделей не конкурируют с правками). Метка с временем жизни: зависший этап не блокирует офис дольше 100 минут. */
  const PRIORITY_TTL = 100 * 60e3;
  const priorityRaw = () => { try { const p = JSON.parse(kvGet('priority')); if (p && now() - p.since < PRIORITY_TTL) return p; } catch {} return null; };
  const priority = () => { const p = priorityRaw(); return p ? { active: true, video_id: p.video_id, label: p.label || '', since: p.since } : { active: false }; };
  function setPriority({ active, video_id, label }) {
    if (active) kvSet('priority', JSON.stringify({ video_id: Number(video_id) || null, label: String(label || '').slice(0, 120), since: now() })); else kvDel('priority');
    return priority();
  }

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
      if (r.ok && i === parts.length - 1) {
        run('UPDATE messages SET tg_msg=? WHERE id=?', r.result.message_id, id);
        // Карточку могли закрыть, пока шла отправка (автоутверждение отвечает через ~30 мс после публикации): ответ не нашёл tg_msg и кнопки не снял.
        // Тогда снимаем их здесь, иначе в Telegram остаётся живая кнопка «Утвердить» на уже утверждённом сценарии (так было с карточкой №641, 2026-10-27).
        const cur2 = q('SELECT status FROM messages WHERE id=?', id)[0];
        if (cur2 && cur2.status && cur2.status !== 'open' && m.buttons) tg('editMessageReplyMarkup', { chat_id: chatId(), message_id: r.result.message_id, reply_markup: { inline_keyboard: [] } }).catch(() => {});
      }
      if (!r.ok && r.description !== 'telegram off') console.error('TG:', r.description);
    }
  }

  /* ---------- сообщения ---------- */
  // Любую карточку, ждущую ответа, Ник может убрать без последствий: бывают зависшие и ненужные (например, «Другое название» к уже принятому ролику).
  // Подтверждения предложений («Да, сделать» / «Нет») уже имеют отказ, им отдельная кнопка не нужна.
  const DISMISS = { t: '✖ Убрать', d: 'dismiss:0' };
  const isDismiss = (x) => x && /^dismiss:/.test(x.d);
  const withDismiss = (rows) => (rows.flat().some(isDismiss) ? rows : [...rows, [DISMISS]]);
  function post({ office = 'smm', thread, sender, kind = 'text', text, buttons = null, source = 'pipeline', ref = null, tgMsg = null, mirrorTg = false, silent = false }) {
    let rows = buttons ? buttons.map((row) => row.map((x) => (Array.isArray(x) ? { t: x[0], d: x[1] } : x))) : null;
    if (rows && kind === 'action' && !ref) rows = withDismiss(rows);
    const b = rows ? JSON.stringify(rows) : null;
    const r = run('INSERT INTO messages (ts,office,thread,sender,kind,text,buttons,status,source,tg_msg,ref) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      now(), office, thread, sender, kind, String(text).slice(0, 12000), b, kind === 'action' ? 'open' : null, source, tgMsg, ref ? JSON.stringify(ref) : null);
    const id = Number(r.lastInsertRowid);
    // Новая карточка с тем же действием по тому же ролику заменяет старую: две одинаковые «Принять ролик» или «Пакет публикации» всегда устаревшие.
    if (rows && kind === 'action' && !ref) for (const x of rows.flat()) if (x.d && !/^(dismiss|confirm|cancel):/.test(x.d)) supersedeExact(x.d, id);
    if (mirrorTg && !tgMsg && office === 'smm') mirror(id, silent).catch((e) => console.error('mirror', e.message));
    return id;
  }
  // Правка открытой карточки на месте (выбор в плане дня: текст и кнопки меняются, карточка остаётся одна и в чате, и в Telegram).
  async function editCard(id, text, buttons) {
    const m = q('SELECT * FROM messages WHERE id=?', Number(id))[0];
    if (!m || m.kind !== 'action') return { ok: false, error: 'нет такой карточки' };
    if (m.status !== 'open') return { ok: false, error: 'карточка уже закрыта' };
    let rows = Array.isArray(buttons) ? buttons.map((row) => row.map((x) => (Array.isArray(x) ? { t: x[0], d: x[1] } : x))) : null;
    if (rows && !m.ref) rows = withDismiss(rows);
    const b = rows ? JSON.stringify(rows) : null, body = String(text || '').slice(0, 12000);
    run('UPDATE messages SET text=?, buttons=? WHERE id=?', body, b, m.id);
    if (m.tg_msg && !NO_TG) {
      const r = await tg('editMessageText', { chat_id: chatId(), message_id: m.tg_msg, text: tgText({ ...m, text: body }).slice(0, 4000), disable_web_page_preview: true, reply_markup: kbOf(b) || { inline_keyboard: [] } }).catch((e) => ({ ok: false, description: e.message }));
      if (!r.ok && !/not modified/i.test(r.description || '')) console.error('TG edit:', r.description);
    }
    return { ok: true };
  }
  function closeCard(o, status, choice, via) {
    run('UPDATE messages SET status=?, choice=?, answered_ts=?, answered_via=? WHERE id=? AND status=\'open\'', status, choice, now(), via, o.id);
    if (o.tg_msg && !NO_TG) tg('editMessageReplyMarkup', { chat_id: chatId(), message_id: o.tg_msg, reply_markup: { inline_keyboard: [] } }).catch(() => {});
  }
  function supersedeExact(d, exceptId) {
    for (const o of q("SELECT id, tg_msg FROM messages WHERE kind='action' AND status='open' AND id<>? AND buttons LIKE ?", exceptId, `%"d":"${d}"%`)) closeCard(o, 'answered', 'superseded', 'system');
  }
  const preFile = (id) => path.join(ROOT, 'smm', 'runs', `video_${Number(id)}`, 'PREAPPROVED');
  const setPre = (id) => { try { fs.mkdirSync(path.dirname(preFile(id)), { recursive: true }); fs.writeFileSync(preFile(id), String(now())); } catch {} };
  const clearPre = (id) => { try { fs.rmSync(preFile(id), { force: true }); } catch {} };
  // Правка Ника, пришедшая ПОКА этап «script» этого ролика ещё идёт. Цепочка «сценарий A -> варианты B и C» работает около получаса, карточки A в это время нет,
  // и Ник пишет правку текстом. Раньше ролик A сразу переводился в стадию «script», а второй запуск отклонялся как дубль: правка пропадала, A выпадал из карточки
  // вариантов и никогда не монтировался (25.10, №100). Теперь правка ждёт в файле и применяется, как только этап закончится; стадия ролика до тех пор не трогается.
  const pendingFile = (id) => path.join(ROOT, 'smm', 'runs', `video_${Number(id)}`, 'PENDING_REVISE.txt');
  const clearPending = (id) => { try { fs.rmSync(pendingFile(id), { force: true }); } catch {} };
  function queueRevise(id, text) {
    const f = pendingFile(id); let prev = ''; try { prev = fs.readFileSync(f, 'utf8').trim(); } catch {}
    fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, [prev, String(text).trim()].filter(Boolean).join('\n'));
  }
  function runQueuedRevise(args) {
    if (args[0] !== 'script' || !args[1] || String(args[1]).startsWith('--')) return;
    const id = Number(args[1]); let text = '';
    try { text = fs.readFileSync(pendingFile(id), 'utf8').trim(); } catch { return; }
    clearPending(id); if (!text) return;
    setTimeout(() => {                     // дать завершившемуся этапу дописать в базу
      try {
        const v = q('SELECT * FROM videos WHERE id=?', id)[0], short = text.replace(/\s+/g, ' ').slice(0, 90);
        const cap = (t) => post({ thread: 'captain_smm', sender: 'captain_smm', text: t, mirrorTg: true });
        if (v && v.stage === 'checked') { cap(`Ксения закончила предыдущий этап по теме «${v.title}». Беру вашу правку: «${short}».`); execAction(`revise:${id}`, text, 'system', null).catch((e) => cap('Не получилось применить отложенную правку: ' + e.message)); }
        else if (v && v.stage === 'script') { setStage(id, 'script'); cap(`Предыдущий этап по теме «${v.title}» закончился без готового сценария. Передаю Ксении вашу правку: «${short}».`); spawnPipeline(['script', String(id), '--comment', text]); }
        else cap(`Правку «${short}» к сценарию «${v ? v.title : '№' + id}» применить не вышло: пока Ксения работала, ролик ушёл дальше (${v ? (STAGE_LABEL[v.stage] || v.stage) : 'удалён'}). Если она ещё нужна, напишите её заново.`);
      } catch (e) { console.error('отложенная правка:', e.message); }
    }, 400);
  }
  const say = (agentId, text, mirrorTg = false) => post({ thread: agentId, sender: agentId, text, mirrorTg });
  const setAgent = (id, status, task, log) => {
    run('UPDATE agents SET status=COALESCE(?,status), task=COALESCE(?,task), updated_at=? WHERE id=?', status ?? null, task ?? null, now(), id);
    if (log) run('INSERT INTO events (ts,agent_id,level,message) VALUES (?,?,?,?)', now(), id, 'info', log);
  };
  const setStage = (id, stage) => run('UPDATE videos SET stage=?, updated_at=? WHERE id=?', stage, now(), id);

  function spawnPipeline(args) {
    // Тестовый сервер (OFFICE_CHAT_STUB) не должен запускать настоящих сотрудников: это тратит лимит Claude и пишет в рабочие журналы.
    // Настоящий запуск в тесте разрешён только с подменой модели (HERMES_BIN), как в интеграционных тестах.
    if (STUB && !process.env.HERMES_BIN) { console.error('spawnPipeline: тестовый режим без HERMES_BIN, этап', args.join(' '), 'не запущен'); post({ thread: 'captain_smm', sender: 'captain_smm', text: `(тест) этап «${args.join(' ')}» не запущен: в тестовом режиме нет подмены модели.` }); return false; }
    if (stageRunning(args)) { post({ thread: 'captain_smm', sender: 'captain_smm', text: `Этап «${args[0]}${args[1] && !String(args[1]).startsWith('--') ? ' №' + args[1] : ''}» уже идёт. Второй раз не запускаю: подождите результат.`, mirrorTg: true }); return false; }
    fs.mkdirSync(path.join(ROOT, 'smm'), { recursive: true });
    const out = fs.openSync(path.join(ROOT, 'smm', STUB ? 'pipeline.test.log' : 'pipeline.log'), 'a');
    const port = process.env.PORT || 8787;      // этап ходит в тот же сервер, что его запустил
    const child = spawn(process.execPath, [path.join(ROOT, 'scripts', 'smm_pipeline.mjs'), ...args], { cwd: ROOT, detached: true, stdio: ['ignore', out, out], windowsHide: true, env: { ...process.env, OFFICE_API: process.env.OFFICE_API || `http://127.0.0.1:${port}`, OFFICE_SETTINGS_FILE: process.env.OFFICE_SETTINGS_FILE || path.join(DATA_DIR, 'settings.json') } });
    RUNNING.set(stageKey(args), { pid: child.pid, ts: now() }); child.on('exit', () => { RUNNING.delete(stageKey(args)); runQueuedRevise(args); });
    child.unref(); return true;
  }
  // Один и тот же этап одного ролика не запускается дважды: 20.10 четыре «Да, сделать» подряд запустили четыре Ксении на одну тему.
  const RUNNING = new Map();
  const stageKey = (args) => (args[0] === 'studio'
    ? args.filter((x, i) => !String(x).startsWith('--') && !String(args[i - 1] || '').startsWith('--')).join(' ')       // studio post-act med 2026-10-28 post1 ok: две кнопки подряд не блокируют друг друга
    : `${args[0]} ${args[1] && !String(args[1]).startsWith('--') ? args[1] : ''}`.trim());
  const pidAlive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
  function stageRunning(args) { const k = stageKey(args), r = RUNNING.get(k); if (r && pidAlive(r.pid) && now() - r.ts < 4 * 3600e3) return true; RUNNING.delete(k); return false; }

  /* ---------- выполнение действий (кнопки и подтверждённые предложения) ---------- */
  // Решение принято: закрываем устаревшие открытые карточки с такими же кнопками (и в Telegram убираем кнопки), чтобы не запустить лишнее
  function supersede(prefix) {
    for (const o of q("SELECT id, tg_msg FROM messages WHERE kind='action' AND status='open' AND buttons LIKE ?", `%"d":"${prefix}%`)) {
      run("UPDATE messages SET status='answered', choice='superseded', answered_ts=?, answered_via='system' WHERE id=?", now(), o.id);
      if (o.tg_msg && !NO_TG) tg('editMessageReplyMarkup', { chat_id: chatId(), message_id: o.tg_msg, reply_markup: { inline_keyboard: [] } }).catch(() => {});
    }
  }
  // Открытые карточки подтверждения: новая заменяет старые того же действия (для выбора темы любые прежние: тема в работе только одна).
  function closeConfirms(office, data, exceptId) {
    const type = String(data).split(':')[0];
    for (const o of q("SELECT id, tg_msg, ref FROM messages WHERE office=? AND kind='action' AND status='open' AND ref IS NOT NULL AND id<>?", office, exceptId || 0)) {
      let r; try { r = JSON.parse(o.ref); } catch { continue; }
      if (r && (r.data === data || (type === 'pick' && String(r.data).startsWith('pick:')))) closeCard(o, 'answered', 'superseded', 'system');
    }
  }
  const AWAIT_ACT = (kind) => (kind === 'rework' ? 'rework' : kind === 'title' ? 'title' : kind === 'pubat' ? 'pubat' : 'revise');
  const awaitData = (aw) => (aw.kind === 'spost' && aw.data ? aw.data : `${AWAIT_ACT(aw.kind)}:${aw.id}`);     // какое действие продолжит следующий текст Ника
  async function execAction(data, comment, via, srcMsg) {
    const [act, idStr, mode] = String(data).split(':'); const id = Number(idStr);
    const v = act === 'confirm' || act === 'cancel' ? null : (id ? q('SELECT * FROM videos WHERE id=?', id)[0] : null);
    const cap = (text, mirrorTg = true) => post({ thread: 'captain_smm', sender: 'captain_smm', text, mirrorTg });
    const members = (x) => groupMembers(q('SELECT * FROM videos'), x);          // участники группы вариантов (для одиночного ролика одна запись)
    const letterOf = (x) => (variantOf(x) || { letter: 'A' }).letter;
    const markDropped = (x) => { let n = {}; try { n = JSON.parse(x.notes || '{}') || {}; } catch {} run('UPDATE videos SET notes=?, updated_at=? WHERE id=?', JSON.stringify({ ...n, dropped: true }), now(), x.id); };
    if (act === 'confirm') {
      const m = q('SELECT * FROM messages WHERE id=?', id)[0]; const ref = m && m.ref && JSON.parse(m.ref);
      if (!ref) return { note: 'нет предложения' };
      closeConfirms(m.office, ref.data, m.id);                // другие открытые подтверждения того же действия устарели
      return execAction(ref.data, [ref.comment, comment].filter((x) => x && String(x).trim()).join('. '), via, m);
    }
    if (act === 'cancel') { cap('Хорошо, не делаю.', false); return {}; }
    if (act === 'splan' || act === 'spost' || act === 'splan_new') return execStudio(act, String(data).split(':'), comment, srcMsg, cap);
    if (act === 'pick' && v) {
      supersede('pick:'); supersede('more:');
      if (['checked', 'editing', 'produced', 'approved'].includes(v.stage)) { cap(`Тема «${v.title}» уже в работе (${STAGE_LABEL[v.stage] || v.stage}), второй раз не запускаю.`); return {}; }
      if (stageRunning(['script', String(id)])) { cap(`Ксения уже пишет сценарий по теме «${v.title}». Второй раз не запускаю.`, false); return {}; }
      for (const o of q("SELECT id FROM videos WHERE stage='scored' AND id<>?", id)) setStage(o.id, 'idea');
      const wish = comment && comment.trim() ? comment.trim() : '';
      setStage(id, 'script'); setAgent('captain_smm', 'working', `Тема выбрана: ${v.title}`, `Ник выбрал тему «${v.title}»`);
      cap(`Тема выбрана: «${v.title}».\nКсения пишет сценарий, Вера проверит каждый факт.${wish ? `\nПожелание передано Ксении: «${wish.slice(0, 200)}».` : ''} Пришлю результат сюда.`);
      spawnPipeline(['script', String(id), ...(wish ? ['--comment', wish] : [])]);
    } else if (act === 'topics') {
      // Просьба Ника «темы» / «подбери темы про сон» (lib_intent.topicRequest): поиск тем сразу, пожелание уходит Виктору; старый список заменяется новым, как при «Другие темы»
      const wish = comment && comment.trim() ? comment.trim() : '';
      if (stageRunning(['topics'])) { cap(`Поиск тем уже идёт, список пришлю сюда.${wish ? ` Ваше пожелание «${wish.slice(0, 120)}» в этот поиск уже не попадёт: напишите его ещё раз, когда придёт список.` : ''}`, false); return {}; }
      supersede('pick:'); supersede('more:');
      for (const o of q("SELECT id FROM videos WHERE stage='scored'")) setStage(o.id, 'rejected');
      cap(`Принято, ищу темы для видео${wish ? ` с вашим пожеланием: «${wish.slice(0, 200)}»` : ''}. Виктор соберёт кандидатов с первоисточниками, Лев оценит, список пришлю сюда.`);
      spawnPipeline(['topics', ...(wish ? ['--hint', wish] : [])]);
    } else if (act === 'more') {
      supersede('pick:'); supersede('more:');
      for (const o of q("SELECT id FROM videos WHERE stage='scored'")) setStage(o.id, 'rejected');
      cap('Хорошо, ищу другие темы. Пришлю новый список.'); spawnPipeline(['topics', '--hint', 'другие темы, не повторяя уже предложенные']);
    } else if (act === 'approve' && v && v.stage !== 'checked') {
      // Ник сказал «утверждаю», а Вера ещё не пропустила текущую версию (круги кончились на длине или на её правках). Отказом и «ждите» это не закрываем:
      // утверждение запоминается, Ксения/Вера доводят сценарий, и при «можно» монтаж стартует сам, без второго вопроса.
      if (['editing', 'produced', 'approved'].includes(v.stage)) { cap(`Сценарий «${v.title}» уже утверждён и в работе (${STAGE_LABEL[v.stage] || v.stage}).`, false); return {}; }
      supersede(`approve:${id}`); supersede(`revise:${id}`); supersede(`regen:${id}`);
      setPre(id);
      if (stageRunning(['script', String(id)])) { cap(`Принято. Ксения с Верой ещё работают над сценарием «${v.title}»; как только Вера пропустит, сразу запущу Кирилла. Повторно подтверждать не нужно.`); return {}; }
      setStage(id, 'script'); setAgent('captain_smm', 'working', `Довожу сценарий до проверки: ${v.title}`, `Ник утвердил сценарий «${v.title}» заранее`);
      cap(`Принято, сценарий «${v.title}» утверждён.\nСейчас его текст ещё не прошёл проверку Веры (длина и правки по фактам). Ксения доведёт его, Вера проверит. Если пропустит, сразу запущу Кирилла на монтаж, вопрос повторять не буду. Если нет, напишу вам и объясню почему.`);
      spawnPipeline(['script', String(id), '--finish']);
    } else if (act === 'approve' && v) {
      supersede(`approve:${id}`); supersede(`revise:${id}`); supersede('vregen:'); supersede('vdrop:'); clearPre(id); clearPending(id);
      const mem = members(v), live = mem.filter((m) => m.stage === 'checked');
      if (isGroup(mem) && live.length > 1) {
        // варианты одной темы: все живые уходят в монтаж СРАЗУ, у каждого свой монтажёр и формат; рендер ставится в очередь на два слота
        for (const m of live) { setStage(m.id, 'editing'); spawnPipeline(['produce', String(m.id)]); }
        const names = live.map((m) => `${letterOf(m)} «${VFORMATS[letterOf(m)].name}»`).join(', ');
        cap(`Сценарии утверждены: ${names}.\nМонтируют параллельно: ${live.map((m) => { const ed = VFORMATS[letterOf(m)].editor; return ed === 'video' ? 'Кирилл' : ed === 'video_b' ? 'Матвей' : 'Роман'; }).join(', ')} (Opus 5.5). Рендер идёт в очереди на два слота, кругов не больше трёх, обычно 40-60 минут. Каждый ролик придёт отдельной карточкой приёмки.`);
      } else {
        const m = live[0] || v, ed = VFORMATS[letterOf(m)].editor;
        setStage(m.id, 'editing');
        cap(`Сценарий утверждён: «${v.title}»${variantOf(m) ? ` (вариант ${letterOf(m)} «${VFORMATS[letterOf(m)].name}»)` : ''}.\n${ed === 'video' ? 'Кирилл Кадров' : ed === 'video_b' ? 'Матвей Склеев' : 'Роман Ракурсов'} (Opus 5.5) озвучивает и монтирует, обычно около часа. Пришлю готовый ролик.`);
        spawnPipeline(['produce', String(m.id)]);
      }
    } else if (act === 'vdrop' && v) {
      // «Убрать вариант»: он не монтируется и не публикуется; остальные идут дальше. Последний оставшийся убрать нельзя: для этого есть «Отклонить тему».
      const mem = members(v), live = mem.filter((m) => m.stage === 'checked');
      if (v.stage !== 'checked') { cap(`Вариант ${letterOf(v)} уже не ждёт утверждения.`, false); return {}; }
      if (live.length <= 1) { cap('Это последний вариант: чтобы отказаться от темы целиком, нажмите «Отклонить тему».', false); return {}; }
      supersede(`vdrop:${id}`); markDropped(v); setStage(id, 'rejected');
      cap(`Вариант ${letterOf(v)} «${VFORMATS[letterOf(v)].name}» убран. Остаются: ${live.filter((m) => m.id !== id).map((m) => letterOf(m)).join(', ')}. Обновляю карточку.`);
      spawnPipeline(['group-card', String(id)]);
    } else if (act === 'vregen' && v) {
      // «Перегенерировать варианты»: Ксения пишет B и C заново (A остаётся); убранные варианты не возвращаются
      const mem = members(v), a = mem.find((m) => letterOf(m) === 'A') || v, gid = (variantOf(v) || { group: v.id }).group;
      supersede(`approve:${id}`); supersede(`revise:${id}`); supersede('vregen:'); supersede('vdrop:');
      for (const m of mem) if (m.stage === 'checked' && letterOf(m) !== 'A') setStage(m.id, 'script');
      setAgent('captain_smm', 'working', `Варианты заново: ${v.title}`, `Ник просит новые варианты «${v.title}»`);
      cap(`Перегенерирую варианты «${v.title}»: Ксения напишет B и C заново (другие хуки и концовки), Вера сверит факты. Вариант A остаётся. Пришлю одну карточку.`);
      spawnPipeline(['variants', String(gid), '--regen']);
      void a;
    } else if (act === 'revise' && v) {
      clearPre(id);
      const mem = members(v), grouped = isGroup(mem);
      const pc = grouped ? parseVariantComment(comment) : { letter: null, text: String(comment || '').trim() };
      if (grouped && pc.text) {
        // Правка к группе: «B: …» идёт варианту B, «C: …» варианту C, без буквы это вариант A (пока он жив)
        const target = pc.letter ? mem.find((m) => letterOf(m) === pc.letter && m.stage === 'checked') : mem.find((m) => letterOf(m) === 'A' && m.stage === 'checked');
        if (!target) { cap(pc.letter ? `Варианта ${pc.letter} нет среди ждущих утверждения. Напишите правку с буквой существующего варианта, например «${letterOf(anchorOf(mem) || v)}: …».` : 'Вариант A убран: начните правку с буквы существующего варианта, например «B: …».', false); return {}; }
        supersede(`approve:${id}`); supersede(`revise:${id}`); supersede('vregen:'); supersede('vdrop:');
        if (letterOf(target) === 'A' && stageRunning(['script', String(target.id)])) { queueRevise(target.id, pc.text); cap(`Ксения ещё дописывает варианты по теме «${v.title}». Правку к варианту A («${pc.text.replace(/\s+/g, ' ').slice(0, 90)}») запомнила: возьмусь сразу, как она закончит, и пришлю одну карточку.`); }
        else if (letterOf(target) === 'A') { setStage(target.id, 'script'); cap(`Передала Ксении правку к варианту A: исправит, Вера проверит заново, потом обновлю карточку со всеми вариантами.`); spawnPipeline(['script', String(target.id), '--comment', pc.text]); }
        else { cap(`Передала Ксении правку к варианту ${letterOf(target)} «${VFORMATS[letterOf(target)].name}»: исправит, Вера сверит с фактами, остальные варианты не трогаю.`); setAgent('captain_smm', 'working', `Правка варианта ${letterOf(target)}`, `Правка Ника к варианту ${letterOf(target)}`); spawnPipeline(['variant-revise', String(target.id), '--comment', pc.text]); }
      }
      else if (comment && comment.trim() && stageRunning(['script', String(id)])) { queueRevise(id, comment.trim()); cap(`Ксения ещё работает над сценарием «${v.title}». Вашу правку запомнила: возьмусь сразу, как она закончит.`); }
      else if (comment && comment.trim()) { supersede(`approve:${id}`); supersede(`revise:${id}`); cap('Передала Ксении: исправит, Вера проверит заново.'); spawnPipeline(['script', String(id), '--comment', comment.trim()]); }
      else { kvSet('awaiting', JSON.stringify({ kind: 'script', id, mid: srcMsg && srcMsg.id, ts: now() })); cap(grouped ? 'Напишите одним сообщением, что поправить. Если правка к варианту B или C, начните с буквы: «B: …». Без буквы правка пойдёт в вариант A.' : 'Напишите одним сообщением, что поправить в сценарии (здесь или в Telegram). Ксения исправит и Вера проверит заново.'); }
    } else if (act === 'rework' && v) {
      if (comment && comment.trim()) {
        const short = comment.trim().replace(/\s+/g, ' ').slice(0, 90);
        supersede(`accept:${id}`); supersede(`rework:${id}`);
        setStage(id, 'editing'); setPriority({ active: true, video_id: id, label: `правки ролика №${id}` });
        const edId = (VFORMATS[letterOf(v)] || VFORMATS.A).editor, edName = { video: 'Кирилл', video_b: 'Матвей', video_c: 'Роман' }[edId] || 'Монтажёр';          // правки идут тому монтажёру, чей формат у ролика (A Кирилл, B Матвей, C Роман)
        if (edId === 'video') setAgent('video', 'working', `Правки ролика №${id}: ${short}`, `Ник просит правки ролика «${v.title}»: ${short}`);
        cap(`Правки приняты, ${edName} начинает сразу. У этого ролика приоритет: новые этапы других роликов подождут, пока он не закончит.\nЧто делает: «${short}${comment.trim().length > 90 ? '…' : ''}».\nГотовую версию пришлю сюда с кнопками «Принять» и «Внести правки».`);
        spawnPipeline(['rework', String(id), '--comment', comment.trim()]);
      } else { kvSet('awaiting', JSON.stringify({ kind: 'rework', id, mid: srcMsg && srcMsg.id, ts: now() })); cap('Напишите одним сообщением, что поправить в ролике (здесь или в Telegram). Кирилл начнёт сразу, у этого ролика будет приоритет.'); }
    } else if (act === 'accept' && v) {
      supersede(`accept:${id}`); supersede(`rework:${id}`);
      setStage(id, 'approved'); setAgent('captain_smm', 'idle', 'Ролик принят, ждёт вашей публикации', `Ник принял ролик «${v.title}»`);
      const ytReady = fs.existsSync(path.join(process.env.OFFICE_DATA_DIR || path.join(ROOT, 'server', 'data'), 'youtube_token.json'));
      cap(ytReady ? 'Ролик принят. Тимофей уже придумывает название и хэштеги, пришлю одним сообщением и на карточке можно перегенерировать название, ввести своё и перейти к публикации в YouTube Shorts. Без вашей кнопки ничего не выкладывается.' : 'Ролик принят. Тимофей уже придумывает название и хэштеги, пришлю одним сообщением. Публикуете вы сами, когда готовы.');
      spawnPipeline(['package', String(id)]);
    } else if (act === 'resume' && STUB && !process.env.HERMES_BIN) {
      cap('(тест) Кирилл не запущен: в тестовом режиме нет подмены модели.');          // тот же запрет, что в spawnPipeline: тест не должен будить настоящего Кирилла (Opus)
    } else if (act === 'resume') {
      const job = jobInfo() || { ver: 'v2', brief: 'dosie01/BRIEF_v2b.md' };
      const dir = path.join(ROOT, 'video', 'med_detective'); const out = fs.openSync(path.join(dir, 'dosie01', `_run_${job.ver}_resume_log.txt`), 'a');
      spawn(HERMES, ['-p', 'video', 'chat', '--query-file', job.brief, '-Q', '--oneshot', '--max-turns', '400', '--run-budget', '5400'], { cwd: dir, detached: true, stdio: ['ignore', out, out], windowsHide: true }).unref();
      cap('Запустила Кирилла заново: он продолжит по сохранённым файлам. Ход работы виден справа в «Сейчас в работе».');
    } else if (act === 'publish' && v) {
      // Публикация только по кнопке и только принятого ролика; одну и ту же карточку второй раз не исполняем
      if (!['yt', 'ytp', 'yts', 'at'].includes(mode)) { cap('Не понял, куда публиковать.', false); return {}; }
      let atIso = ''; if (mode === 'at') {          // publish:<id>:at:<минуты от эпохи в base36>: время зашито в кнопку, старая карточка не может выложить в другое
        const raw = String(data).split(':')[3] || '', min = parseInt(raw, 36); atIso = Number.isFinite(min) && min > 0 ? new Date(min * 60e3).toISOString() : '';
        if (!atIso) { cap('Не вижу времени выхода в кнопке. Нажмите «Запланировать на своё время» ещё раз.', false); return {}; }
      }
      if (v.stage !== 'approved') { cap(`Ролик «${v.title}» ещё не принят, публиковать рано.`, false); return {}; }
      supersede(`publish:${id}:${mode}`); if (mode === 'at') supersede(`pubat:${id}`);
      if (stageRunning(['publish', String(id)])) { cap(`Публикатор уже загружает ролик «${v.title}». Второй раз не запускаю.`, false); return {}; }
      setAgent('publisher', 'working', `Публикация ролика №${id}`, `Ник нажал «${mode === 'at' ? 'запланировать выход в YouTube' : mode === 'yt' ? 'опубликовать в YouTube Shorts' : 'приватная проверка в YouTube'}»`);
      cap(mode === 'at' ? `Принято. Пётр Выкладов загружает «${v.title}» сейчас, а YouTube выложит его сам ${fmtMsk(atIso)} (МСК). До этого ролик виден только вам. Пришлю ссылку.` : mode === 'yts' ? `Принято. Пётр Выкладов загружает «${v.title}» сейчас, а выложит его YouTube сам по слоту очереди вариантов (интервал 30 минут). Пришлю ссылку.` : `Принято. Пётр Выкладов загружает «${v.title}» в YouTube ${mode === 'yt' ? 'публично' : 'как приватный (виден только вам)'}. Пришлю ссылку.`);
      spawnPipeline(['publish', String(id), '--target', mode, ...(mode === 'at' ? ['--at', atIso] : [])]);
    } else if (act === 'title' && v) {
      // Своё название вместо предложенного Тимофеем: кнопка без текста ждёт следующее сообщение Ника, с текстом сохраняет сразу
      const t = String(comment || '').replace(/\s+/g, ' ').trim();
      if (!t) { kvSet('awaiting', JSON.stringify({ kind: 'title', id, mid: srcMsg && srcMsg.id, ts: now() })); cap('Напишите одним сообщением своё название ролика (до 100 знаков). Хэштеги можно писать прямо в названии. Рекомендованные хэштеги уйдут в описание.'); return {}; }
      if (t.length > 100) { kvSet('awaiting', JSON.stringify({ kind: 'title', id, ts: now() })); cap(`Название длиннее 100 знаков (${t.length}): YouTube его не примет. Сократите и пришлите ещё раз.`); return {}; }
      supersede(`package:${id}"`); supersede(`title:${id}"`); supersede(`publish_go:${id}"`); supersede(`publish:${id}:`);
      cap(`Принято, ставлю ваше название: «${t}».`);
      spawnPipeline(['set-title', String(id), '--title', t]);
    } else if (act === 'pubat' && v) {
      // Отложенная публикация на время Ника: кнопка без текста ждёт сообщение вроде «завтра 18:00», с текстом разбирает сразу.
      if (v.stage !== 'approved') { cap(`Ролик «${v.title}» ещё не принят, публиковать рано.`, false); return {}; }
      const had = (() => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'smm', 'runs', `video_${id}`, 'publish.json'), 'utf8')).youtube || []; } catch { return []; } })().find((x) => x.privacy === 'public' || x.scheduledFor);
      if (had) { cap(`Ролик «${v.title}» уже ${had.scheduledFor ? 'запланирован на ' + fmtMsk(had.scheduledFor) + ' (МСК)' : 'опубликован'}: ${had.url}. Второй раз не загружаю.`, false); return {}; }
      const t = String(comment || '').replace(/\s+/g, ' ').trim();
      if (!t || isCancelWhen(t)) {
        if (t) { cap('Хорошо, время выхода не задаю. Карточка публикации остаётся с прежними кнопками.', false); return {}; }
        kvSet('awaiting', JSON.stringify({ kind: 'pubat', id, mid: srcMsg && srcMsg.id, ts: now() }));
        cap(`Когда выложить «${v.title}»? Напишите одним сообщением время по Москве, например: «завтра 18:00», «сегодня 20:30», «25.10 19:00», «в субботу в 11», «через 3 часа». Сейчас ${fmtMsk(Date.now())} МСК. Передумали, напишите «отмена».`);
        return {};
      }
      const w = parseWhen(t, Date.now());
      if (!w.ok) { kvSet('awaiting', JSON.stringify({ kind: 'pubat', id, ts: now() })); cap(`${w.error}\nНапишите время ещё раз или «отмена».`); return {}; }
      supersede(`publish:${id}:at:`);
      const code = Math.round(w.atMs / 60e3).toString(36);
      post({ thread: 'captain_smm', sender: 'captain_smm', kind: 'action', text: `📅 Выложить «${v.title}» ${w.text} (МСК)?\nРолик загрузится сейчас как приватный, а YouTube сам опубликует его в это время. До выхода его видите только вы, время можно поменять в YouTube Studio.`, buttons: [[[`✅ Да, на ${w.text}`, `publish:${id}:at:${code}`]], [['🕐 Другое время', `pubat:${id}`]]], mirrorTg: true });
    } else if (act === 'publish_go' && v) {
      if (v.stage !== 'approved') { cap(`Ролик «${v.title}» ещё не принят, публиковать рано.`, false); return {}; }
      supersede(`publish_go:${id}"`); supersede(`publish:${id}:`);
      spawnPipeline(['publish-card', String(id)]);
    } else if (act === 'package' && v) {
      supersede(`publish_go:${id}"`); supersede(`publish:${id}:`);          // карточки публикации с прежним названием устарели
      cap(`Запускаю Тимофея заново: название и хэштеги для «${v.title}».`); spawnPipeline(['package', String(id), ...(comment && comment.trim() ? ['--comment', comment.trim()] : [])]);
    } else if (act === 'retry' && v) {
      if (v.stage === 'editing') { cap(`Запускаю монтаж заново: «${v.title}».`); spawnPipeline(['produce', String(id)]); }
      else { setStage(id, 'script'); cap(`Запускаю сценарий заново: «${v.title}».`); spawnPipeline(['script', String(id)]); }
    } else if (act === 'regen' && v) {
      clearPre(id); clearPending(id);
      supersede(`approve:${id}`); supersede(`revise:${id}`); supersede(`regen:${id}`);
      try { const aw = JSON.parse(kvGet('awaiting') || 'null'); if (aw && aw.id === id) kvDel('awaiting'); } catch {}
      setStage(id, 'script'); setAgent('captain_smm', 'working', `Сценарий заново: ${v.title}`, `Ник просит новый сценарий «${v.title}» с нуля`);
      cap(`Перегенерирую сценарий «${v.title}» с нуля.\nКсения напишет другую версию: другой крючок и другая композиция, а не правку прежней; Вера проверит факты заново. Прежняя версия сохранена в истории. Результат пришлю сюда.`);
      spawnPipeline(['script', String(id), '--regen', ...(comment && comment.trim() ? ['--comment', comment.trim()] : [])]);
    } else if (act === 'reject' && v) {
      clearPre(id); clearPending(id);
      supersede(`approve:${id}`); supersede(`revise:${id}`); supersede(`regen:${id}`); supersede('vregen:'); supersede('vdrop:');
      const grp = members(v); for (const m of grp) if (['script', 'checked'].includes(m.stage)) setStage(m.id, 'rejected');      // отклонена тема: отклоняются и все её варианты
      setStage(id, 'rejected'); cap(grp.length > 1 ? 'Тема отклонена вместе со всеми вариантами.' : 'Тема отклонена.');
      settleWaiting('smm', ['captain_smm', 'scriptwriter', 'factcheck']);      // раньше Капитан так и оставался «ждёт: Вера не пропустила сценарий»
    } else return { note: 'неизвестное действие' };
    return {};
  }

  /* ---------- студия каналов: план дня и посты (scripts/studio_pipeline.mjs, этапы `studio …`) ----------
     splan:<канал>:<дата>:ok|more|skip          ответ на карточку «План дня»
     splan_new:<канал>:<дата>                   просьба Ника «план дня» (подсказка в comment)
     spost:<канал>:<дата>:<слот>:ok|edit|drop|pic|pic0   ответ на превью поста (edit: текст, pic: правка картинки с текстом Ника, pic0: другая картинка без правок; текст поста не меняется)
     В эфир пост уходит только после «ok» Ника на превью; сам выход делает минутный сторож studioTick (Григорий). */
  function execStudio(act, parts, comment, srcMsg, cap) {
    const chKey = parts[1], date = parts[2], note = comment && comment.trim() ? ['--comment', comment.trim()] : [];
    if (!chKey || !/^\d{4}-\d{2}-\d{2}$/.test(date || '')) { cap('Не разобрал, к какому плану относится кнопка. Напишите «план дня».', false); return {}; }
    if (act === 'splan_new') {
      const plan = STUDIO.loadPlan(date, chKey);
      if (plan && plan.status === 'approved') { cap(`План на ${date} уже утверждён и в работе. Новый не собираю, чтобы не затереть его: ролик и посты идут по нему.`, false); return {}; }
      if (stageRunning(['studio', 'plan', chKey])) { cap('План дня уже собирается (Глеб ищет темы), пришлю сюда. Это обычно 10–25 минут.', false); return {}; }
      supersede(`splan:${chKey}:${date}:`);
      cap(`Принято, собираю план дня на ${date}${note.length ? ` с вашим пожеланием «${comment.trim().slice(0, 160)}»` : ''}. Глеб ищет темы и первоисточники, код замеряет спрос на YouTube, Мария соберёт три разные темы: самая востребованная пойдёт на ролик. Это обычно 10–25 минут, ничего не уйдёт в канал без вашего «да».`);
      setAgent('studio_chief', 'working', `План дня ${date}`, `Ник просит план дня на ${date}`);
      spawnPipeline(['studio', 'plan', chKey, '--date', date, ...(note.length ? ['--hint', comment.trim()] : [])]);
      return {};
    }
    if (act === 'splan') {
      const action = parts[3], pick = /^([vp]\d{1,2}|sel|morev|morep)$/.test(action);       // выбор и «другие варианты» правят ту же карточку, она остаётся открытой
      if (!pick && !['ok', 'more', 'skip'].includes(action)) throw new Error(`кнопка «${action}» этому серверу неизвестна (он старее карточки: нужен перезапуск офиса)`);
      const pl = STUDIO.loadPlan(date, chKey), incomplete = action === 'ok' && pl && pl.options && pl.status === 'proposed' && !STUDIO.selectionComplete(pl);       // «Утвердить» при неполном выборе карточку не закрывает
      if (!pick && !incomplete) supersede(`splan:${chKey}:${date}:`);
      spawnPipeline(['studio', 'plan-act', chKey, date, action, ...note]); return {};
    }
    const slot = parts[3], action = parts[4];
    if (!['post1', 'post2'].includes(slot) || !['ok', 'edit', 'drop', 'pic', 'pic0'].includes(action)) throw new Error(`кнопка «${action}» этому серверу неизвестна (он старее карточки: нужен перезапуск офиса)`);
    if ((action === 'edit' || action === 'pic') && !note.length) {
      kvSet('awaiting', JSON.stringify({ kind: 'spost', data: parts.join(':'), mid: srcMsg && srcMsg.id, ts: now() }));
      cap(action === 'pic' ? 'Напишите одним сообщением, что изменить в картинке (например «без банки, пусть будет лупа над чашкой кофе»). Текст поста останется прежним, Диана перерисует только изображение по вашим правкам.' : 'Напишите одним сообщением, что исправить в посте: Дарья поправит, Павел проверит заново, новое превью придёт сюда.'); return {};
    }
    supersede(`spost:${chKey}:${date}:${slot}:`);
    spawnPipeline(['studio', 'post-act', chKey, date, slot, action, ...note]); return {};
  }

  // «Убрать»: карточка закрывается без действий и без реплик в чате; кнопки гаснут в обоих каналах; сотрудник, который только из-за неё «ждал», освобождается.
  function dismissCard(m, via) {
    closeCard(m, 'dismissed', 'dismiss', via || 'dashboard');
    try { const aw = JSON.parse(kvGet('awaiting') || 'null'); if (aw && aw.mid === m.id) kvDel('awaiting'); } catch {}
    settleWaiting(m.office, [m.sender, m.thread, 'captain_smm']);
    return { ok: true, dismissed: true };
  }
  // Сотрудник в статусе «ждёт», у которого не осталось открытых карточек, больше никого не ждёт.
  function settleWaiting(office, ids) {
    for (const id of new Set(ids)) {
      const a = q("SELECT status FROM agents WHERE id=? AND office=?", id, office)[0]; if (!a || a.status !== 'waiting') continue;
      const open = q("SELECT COUNT(*) c FROM messages WHERE office=? AND kind='action' AND status='open' AND (thread=? OR sender=?)", office, id, id)[0].c;
      if (!open) setAgent(id, 'idle', 'Свободен', 'Ждать больше нечего: решение принято или карточка убрана');
    }
  }
  // Ручной сброс «зависшего» статуса (ждёт / ошибка). Работающего сотрудника не трогаем: он действительно занят.
  function clearStatus(agentId) {
    const a = q('SELECT id, status, office FROM agents WHERE id=?', agentId)[0];
    if (!a) return { ok: false, error: 'нет такого сотрудника' };
    if (a.status === 'working') return { ok: false, error: 'сотрудник сейчас работает, сбрасывать нечего' };
    if (a.status !== 'waiting' && a.status !== 'error') return { ok: true, status: a.status, note: 'уже свободен' };
    const open = q("SELECT COUNT(*) c FROM messages WHERE office=? AND kind='action' AND status='open' AND (thread=? OR sender=?)", a.office, a.id, a.id)[0].c;
    if (open) return { ok: false, error: `сначала уберите или ответьте на карточки, которые он ждёт: ${open}` };
    setAgent(a.id, 'idle', 'Свободен', a.status === 'error' ? 'Ник сбросил ошибку' : 'Ник снял ожидание');
    return { ok: true, status: 'idle' };
  }

  // Ответ Ника на действие (из дашборда, Telegram или подтверждение предложения агента)
  async function answer({ id, tgMsg, choice, comment, via, echo = true }) {
    const m = id ? q('SELECT * FROM messages WHERE id=?', id)[0] : q('SELECT * FROM messages WHERE tg_msg=?', tgMsg)[0];
    if (!m || m.kind !== 'action') return { ok: false, error: 'такого вопроса нет' };
    if (m.status !== 'open') return { ok: false, error: 'на этот вопрос уже ответили' };
    if (/^dismiss:/.test(String(choice))) return dismissCard(m, via);
    const btn = JSON.parse(m.buttons || '[]').flat().find((b) => b.d === choice);
    if (!btn) return { ok: false, error: 'нет такой кнопки' };
    // «Внести правки» / «Вернуть на правки» без текста (кнопка в Telegram): карточка остаётся открытой, пока не придёт комментарий, иначе кнопка «Принять» пропала бы зря
    // Выбор в плане дня (видео/посты/«другие варианты») и «Утвердить» при неполном выборе не закрывают карточку: пайплайн правит её на месте.
    const planOk = /^splan:([^:]+):(\d{4}-\d{2}-\d{2}):ok$/.exec(String(choice)), planDoc = planOk ? STUDIO.loadPlan(planOk[2], planOk[1]) : null;
    if (/^splan:[^:]+:\d{4}-\d{2}-\d{2}:([vp]\d{1,2}|morev|morep)$/.test(String(choice)) || (planDoc && planDoc.options && planDoc.status === 'proposed' && !STUDIO.selectionComplete(planDoc))) {
      try { await execAction(choice, undefined, via, m); } catch (e) { return { ok: false, error: e.message }; }
      return { ok: true, kept: true };
    }
    if (/^(rework|revise|title):|^spost:[^:]+:[^:]+:[^:]+:(edit|pic)$/.test(choice) && !(comment && comment.trim())) {
      try { await execAction(choice, undefined, via, m); } catch (e) { return { ok: false, error: e.message }; }
      return { ok: true, pending: 'comment' };
    }
    run("UPDATE messages SET status='answered', choice=?, answered_ts=?, answered_via=? WHERE id=?", choice, now(), via, m.id);
    if (m.tg_msg && !NO_TG) {
      tg('editMessageReplyMarkup', { chat_id: chatId(), message_id: m.tg_msg, reply_markup: { inline_keyboard: [] } }).catch(() => {});
      if (via === 'dashboard') tg('sendMessage', { chat_id: chatId(), text: `✅ Ответ из дашборда: ${btn.t}${comment ? ': ' + comment : ''}`, disable_notification: true }).catch(() => {});
    }
    if (echo) post({ office: m.office, thread: m.thread, sender: 'nick', text: comment ? `${btn.t}: ${comment}` : btn.t, source: via });      // напечатанный ответ уже в чате, второй раз не дублируем
    try { await execAction(choice, comment, via, m); } catch (e) {
      if (/^s(post|plan):/.test(String(choice))) {             // карточка студии: нажатие не должно пропадать, кнопки возвращаются
        run("UPDATE messages SET status='open', choice=NULL, answered_ts=NULL, answered_via=NULL WHERE id=?", m.id);
        if (m.tg_msg && !NO_TG) tg('editMessageReplyMarkup', { chat_id: chatId(), message_id: m.tg_msg, reply_markup: kbOf(m.buttons) }).catch(() => {});
      }
      post({ thread: m.thread, sender: 'captain_smm', text: 'Не получилось выполнить: ' + e.message, mirrorTg: true }); return { ok: false, error: e.message };
    }
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
    return { vs: vs + scriptFacts(), pend, hist };
  }
  // Факты о сценариях для Капитана: какая версия проверена, что висит на карточке. Без этого он выдумывал («карточка на утверждение уже висит»).
  function scriptFacts() {
    const out = [];
    for (const v of q("SELECT id,title,stage FROM videos WHERE office='smm' AND stage IN ('script','checked')")) {
      const dir = path.join(ROOT, 'smm', 'runs', `video_${v.id}`); let line = `#${v.id}: `;
      try {
        const sj = fs.statSync(path.join(dir, 'script.json')).mtimeMs; let ck = null; try { ck = JSON.parse(fs.readFileSync(path.join(dir, 'check.json'), 'utf8')); } catch {}
        const ckt = ck ? fs.statSync(path.join(dir, 'check.json')).mtimeMs : 0;
        line += ck ? `проверка Веры «${ck.verdict}»${sj > ckt + 1000 ? ', НО текст переписан уже после неё, текущая версия Верой не проверена' : ', относится к текущей версии'}` : 'Вера этот текст ещё не проверяла';
      } catch { line += 'файлов сценария нет'; }
      const cards = q("SELECT buttons FROM messages WHERE office='smm' AND kind='action' AND status='open' AND buttons LIKE ?", `%:${v.id}"%`).map((m) => { try { return JSON.parse(m.buttons).flat().map((b) => b.t).join(' / '); } catch { return ''; } }).filter(Boolean);
      line += cards.length ? `; на открытой карточке кнопки: ${cards.join(' | ')}` : '; открытых карточек по нему нет';
      line += fs.existsSync(preFile(v.id)) ? '; утверждение Ника УЖЕ принято, ждёт проверки Веры' : '';
      out.push(line);
    }
    return out.length ? '\nСценарии на этапе проверки (точные факты, не додумывай сверх них):\n' + out.join('\n') : '';
  }
  async function reply(office, thread, nickMsgId, text) {
    const ag = q('SELECT * FROM agents WHERE id=?', thread)[0]; if (!ag) return;
    typing.set(thread, (typing.get(thread) || 0) + 1);
    const dir = path.join(ROOT, 'smm', 'chat'); fs.mkdirSync(dir, { recursive: true });
    const outFile = path.join(dir, `${nickMsgId}_out.json`), qFile = path.join(dir, `${nickMsgId}_query.txt`);
    try {
      let rep = null, action = null;
      if (STUB) { await new Promise((r) => setTimeout(r, 800)); rep = `(заглушка) ${ag.name} получил: «${text}»`; if (process.env.OFFICE_CHAT_STUB_JSON) { try { const j = JSON.parse(process.env.OFFICE_CHAT_STUB_JSON); rep = j.reply; action = j.action || null; } catch {} } }
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

Если Ник просит выполнить шаг конвейера (выбрать тему, утвердить сценарий, вернуть его на правки, принять или отклонить ролик, внести правки в готовый ролик, найти другие темы), НЕ говори, что уже сделала: предложи действие в поле action (его выполнит или подтвердит система, ты кнопок не нажимаешь). Типы: pick (video_id), more, approve (video_id), revise (video_id, comment: что поправить в прежнем сценарии), regen (video_id, comment: пожелание; переписать сценарий с нуля, когда прежний не нравится в целом, а не в деталях), rework (video_id, comment: что именно поправить в готовом ролике, дословно по просьбе Ника), accept (video_id), reject (video_id), package (video_id, comment: пожелание к названию или хэштегам, например «короче» или «без вопроса»).
ПРАВИЛА ПОНИМАНИЯ (Ник не должен повторять и объяснять дважды):
1) Если Ник сам ясно назвал шаг и тему («выбираем тему #4», «перепиши сценарий с нуля», «ищи другие темы»), ставь в action "explicit":true: система выполнит сразу. Если ты лишь предполагаешь, чего он хочет, "explicit":false.
2) В reply НИКОГДА не пиши «подтвердите кнопкой», «нажмите кнопку» и не пересказывай то, что сделает действие: подтверждение (когда оно нужно) система задаёт сама одной карточкой, и Ник может просто ответить «да» или «нет». Если action есть, reply оставь пустым или добавь только то, что не вошло в действие.
3) Если в списке «Вопросы, ждущие ответа Ника» уже висит вопрос на это же действие, не предлагай его заново.
4) Постоянные требования Ника к роликам уже заложены в конвейер и не требуют отдельного подтверждения: динамичный монтаж (смена картинки каждые 1-1,5 с), быстрая озвучка (+25%), хук в первые 1,5 с, длина до 59 с, призыв подписаться на канал в конце. Не пересказывай их и не переспрашивай; если Ник их повторил, скажи одной фразой, что это уже учтено. В comment кладёшь только НОВЫЕ пожелания, дословно его словами.
5) Ответ из одного слова («да», «нет», «ок») к твоим вопросам система обработает сама, тебе такие сообщения не придут.
6) Прямое указание Ника («утверждаю», «делаем», «запускай», «перепиши», «отклоняю») выполняется, а не обсуждается. Не отказывай и не отправляй Ника ждать. Если сценарий ещё не прошёл Веру, всё равно ставь action approve с "explicit":true: система сама доведёт сценарий до проверки и запустит монтаж, когда Вера пропустит. Говорить про кнопки и карточки можно только те, что есть в блоке «Сценарии на этапе проверки» и в списке вопросов выше.
Итог запиши в файл ${outFile} строго как JSON: {"reply":"текст ответа Нику","action":null или {"type":"pick","video_id":3,"comment":"","explicit":true}}. После записи файла ничего больше не делай.`, 'utf8');
        await new Promise((resolve) => {
          const p = spawn(HERMES, ['-p', office === 'smm' ? (REPLY_PROFILE[thread] || 'smm') : 'jobs', 'chat', '--query-file', qFile, '-Q', '--oneshot', '--max-turns', '30', '--run-budget', '420'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
          let out = ''; p.stdout.on('data', (b) => (out += b)); p.stderr.on('data', (b) => (out += b));
          p.on('exit', () => { try { const j = JSON.parse(fs.readFileSync(outFile, 'utf8')); rep = j.reply; action = j.action; } catch { rep = out.replace(/session_id:.*$/s, '').trim().slice(0, 1500) || null; } resolve(); });
        });
      }
      if (!rep) rep = 'Не получилось ответить сейчас, повторите вопрос чуть позже.';
      const ACTS = new Set(['pick', 'more', 'approve', 'revise', 'regen', 'rework', 'accept', 'reject', 'package']);
      // Шаги без дорогих последствий и с ясным указанием Ника выполняются сразу, вторым вопросом «правильно ли я поняла?» их не задерживаем.
      // Утверждение сценария выполняется сразу, если Ник сам сказал «утверждаю / делаем / запускай»: это его прямое указание. Принять, отклонить и правки готового ролика подтверждаются одной карточкой.
      const DIRECT = new Set(['pick', 'more', 'revise', 'regen', 'package', 'approve']);
      const v = action && ACTS.has(action.type) && action.video_id ? q('SELECT id, title FROM videos WHERE id=?', Number(action.video_id))[0] : null;
      const valid = !!(action && ACTS.has(action.type) && (action.type === 'more' || v));
      const wish = valid && action.comment ? String(action.comment).trim() : '';
      const approveWord = /утвержд|одобр|делаем|запуска|погнали|согласен|согласна/i.test(text);
      const sure = valid && action.explicit === true && (action.type !== 'pick' || topicMentioned(text, v.id, v.title)) && (action.type !== 'revise' || !!wish) && (action.type !== 'approve' || approveWord);
      if (valid && DIRECT.has(action.type) && sure) {
        await execAction(`${action.type}:${action.type === 'more' ? 0 : v.id}`, wish, 'agent', null);   // своё сообщение Капитана («Тема выбрана…») пишет execAction; ответ модели не дублируем
      } else if (valid) {
        const talk = stripButtonTalk(rep);                                    // «подтвердите кнопкой» говорит карточка, а не модель
        if (talk.length > 25) post({ office, thread, sender: thread, text: talk, source: 'agent', mirrorTg: true });
        const data = `${action.type}:${action.type === 'more' ? 0 : v.id}`;
        closeConfirms(office, data, 0);                                       // прежние такие же вопросы устарели: карточка остаётся одна
        const label = { pick: 'Выбрать тему', more: 'Искать другие темы', approve: 'Утвердить сценарий', revise: 'Вернуть на правки', regen: 'Перегенерировать сценарий с нуля', rework: 'Внести правки в ролик', package: 'Придумать название и хэштеги заново', accept: 'Принять ролик', reject: 'Отклонить' }[action.type];
        const mid = post({ office, thread: 'captain_smm', sender: 'captain_smm', kind: 'action', text: `Правильно ли я поняла: ${label.toLowerCase()}${v ? ` «${v.title}»` : ''}${wish ? ` (${wish})` : ''}?\n(можно ответить кнопкой или написать «да» / «нет»)`, ref: { data, comment: wish }, buttons: [[['Да, сделать', 'confirm:0'], ['Нет', 'cancel:0']]], mirrorTg: false });
        run('UPDATE messages SET buttons=? WHERE id=?', JSON.stringify([[{ t: 'Да, сделать', d: `confirm:${mid}` }, { t: 'Нет', d: `cancel:${mid}` }]]), mid);
        mirror(mid).catch(() => {});
      } else post({ office, thread, sender: thread, text: rep, source: 'agent', mirrorTg: true });

    } catch (e) { post({ office, thread, sender: thread, text: 'Ошибка ответа: ' + e.message, source: 'agent' }); }
    finally { typing.set(thread, Math.max(0, (typing.get(thread) || 1) - 1)); if (!typing.get(thread)) typing.delete(thread); }
  }


  // Короткий однозначный ответ Ника понимается сразу, без модели: «да» / «нет» на открытый вопрос и «#4» / «выбираем тему 4» на список тем.
  const COMMENT_TYPES = new Set(['pick', 'regen', 'revise', 'rework', 'package']);
  function fastAnswer(office, text, source) {
    const cards = q("SELECT * FROM messages WHERE office=? AND kind='action' AND status='open' AND ref IS NOT NULL ORDER BY id DESC", office);
    const cl = classifyAnswer(text);
    if (cl.kind && cards.length) {
      const c = cards[0]; let ref = null; try { ref = JSON.parse(c.ref); } catch {}
      const type = ref ? String(ref.data).split(':')[0] : '';
      if (ref && !(cl.kind === 'yes' && cl.extra && !COMMENT_TYPES.has(type))) {       // «да, а ещё…» к действию без комментария уходит Капитану: ничего не теряем
        for (const o of cards.slice(1)) closeCard(o, 'answered', 'superseded', 'system');     // новый ответ заменяет все прежние вопросы
        answer({ id: c.id, choice: cl.kind === 'yes' ? `confirm:${c.id}` : `cancel:${c.id}`, comment: cl.extra || undefined, via: source, echo: false })
          .then((r) => { if (r && r.ok === false) post({ thread: 'captain_smm', sender: 'captain_smm', text: 'Не получилось выполнить: ' + (r.error || ''), mirrorTg: true }); })
          .catch((e) => console.error('fastAnswer', e.message));
        return cl.kind;
      }
    }
    // Прямое «делаем / утверждаю» без открытого вопроса «да/нет»: относится к единственной открытой карточке с утверждающей кнопкой (сценарий или ролик)
    if (cl.kind === 'yes' && !cl.extra) {
      const pos = [];
      for (const c of q("SELECT * FROM messages WHERE office=? AND kind='action' AND status='open' AND ref IS NULL ORDER BY id DESC", office)) {
        let b = []; try { b = JSON.parse(c.buttons || '[]').flat(); } catch {}
        const btn = b.find((x) => /^(approve|accept):\d+$|^splan:[^:]+:\d{4}-\d{2}-\d{2}:ok$/.test(x.d)); if (btn) pos.push({ c, d: btn.d });
      }
      if (pos.length === 1) {
        answer({ id: pos[0].c.id, choice: pos[0].d, via: source, echo: false }).then((r) => { if (r && r.ok === false) post({ thread: 'captain_smm', sender: 'captain_smm', text: 'Не получилось выполнить: ' + (r.error || ''), mirrorTg: true }); }).catch((e) => console.error('fastAnswer', e.message));
        return 'approve';
      }
    }
    const n = quickPick(text);
    if (n) {
      const open = q("SELECT id FROM messages WHERE office=? AND kind='action' AND status='open' AND buttons LIKE ?", office, `%"d":"pick:${n}"%`);
      const v = q('SELECT id, stage FROM videos WHERE id=?', n)[0];
      if (open.length || (v && v.stage === 'scored')) { execAction(`pick:${n}`, '', source, null).catch((e) => post({ thread: 'captain_smm', sender: 'captain_smm', text: 'Не получилось выполнить: ' + e.message, mirrorTg: true })); return 'pick'; }
    }
    return null;
  }

  // Переключатель форматов роликов (решение Ника 2026-10-26): «только формат А» / «включи B и C» / «какие форматы включены?». Без модели и без пересказа через кнопки:
  // прямое указание выполняется сразу, настройка server/data/settings.json (variantFormats) читается каждым следующим этапом конвейера, перезапуск не нужен.
  function applyFormatSwitch(fr) {
    const file = path.join(DATA_DIR, 'settings.json'), cur = readSettings(file), envSet = String(process.env.VARIANT_FORMATS || '').trim();
    const before = enabledFormats(undefined, cur), name = (l) => `${l} «${VFORMATS[l].name}»`, list = (a) => a.map(name).join(', ');
    let next = before;
    if (fr.only) next = fr.only; else if (fr.on) next = [...new Set([...before, ...fr.on])]; else if (fr.off) next = before.filter((l) => l === 'A' || !fr.off.includes(l));
    next = ['A', ...['B', 'C'].filter((l) => next.includes(l))];
    const warn = envSet ? `\n⚠️ На сервере задана переменная VARIANT_FORMATS=${envSet}: она сильнее настройки, пока её не уберут из окружения.` : '';
    if (fr.status) { const eff = enabledFormats(envSet || undefined, cur); return `Сейчас для новых тем монтируется: ${list(eff)}${eff.length === 1 ? ' (варианты B и C выключены)' : ''}.${warn}`; }
    if (next.join() === before.join()) return `Уже так и стоит: ${list(before)}.${warn}`;
    writeSettings({ variantFormats: next.join(',') }, file);
    const head = next.length === 1 ? `Принято: для новых тем монтируется только формат ${name('A')}, варианты B и C не создаются и не монтируются.`
      : `Принято: для новых тем монтируются форматы ${list(next)}. Это ${next.length} ролика на тему и ${next.length} монтажа Opus одновременно.`;
    return `${head}\nДействует со следующего сценария, перезапуск не нужен. Что уже в работе или ждёт вашей приёмки, не меняется${next.length > before.length ? ': у сценариев, которые уже готовы, B и C не появятся' : ''}. Вернуть: «включи B и C».${warn}`;
  }

  // Сообщение Ника: из дашборда (thread задан) или из Telegram (thread по имени, иначе Капитан)
  function incoming({ text, source, thread, office = 'smm' }) {
    text = String(text || '').trim(); if (!text) return { ok: false, error: 'пусто' };
    let t = thread, body = text;
    if (!t) { const r = resolveThread(text); t = r.thread; body = r.text; }
    const id = post({ office, thread: t, sender: 'nick', text: source === 'telegram' ? text : body, source, mirrorTg: false });
    if (source === 'dashboard') mirror(id, true).catch(() => {});
    // ожидается комментарий к правкам (сценария или ролика): следующий текст Ника в чате Капитана (для правок ролика ещё и в чате Кирилла); ожидание живёт 30 минут
    let aw = null; try { aw = JSON.parse(kvGet('awaiting') || 'null'); } catch {}
    if (aw && aw.ts && now() - aw.ts > 30 * 60e3) { kvDel('awaiting'); aw = null; }
    if (aw && (t === 'captain_smm' || (aw.kind === 'rework' && t === 'video'))) {
      kvDel('awaiting');
      if (aw.mid) {                       // карточка, у которой нажали кнопку, закрывается как отвеченная с комментарием
        const card = q("SELECT id, tg_msg FROM messages WHERE id=? AND status='open'", aw.mid)[0];
        if (card) { run("UPDATE messages SET status='answered', choice=?, answered_ts=?, answered_via=? WHERE id=?", awaitData(aw), now(), source, card.id);
          if (card.tg_msg && !NO_TG) tg('editMessageReplyMarkup', { chat_id: chatId(), message_id: card.tg_msg, reply_markup: { inline_keyboard: [] } }).catch(() => {}); }
      }
      execAction(awaitData(aw), body, source, null).catch((e) => post({ thread: 'captain_smm', sender: 'captain_smm', text: 'Не получилось выполнить: ' + e.message, mirrorTg: true }));
      return { ok: true, id, note: 'comment' };
    }
    // Переключатель форматов: «только формат А» и т.п. выполняется сразу, раньше разбора «да/нет» и модели
    const fsw = office === 'smm' && t === 'captain_smm' ? formatSwitch(body) : null;
    if (fsw) { let msg; try { msg = applyFormatSwitch(fsw); } catch (e) { msg = 'Не получилось изменить настройку форматов: ' + e.message; } post({ office, thread: 'captain_smm', sender: 'captain_smm', text: msg, mirrorTg: true }); return { ok: true, id, note: 'formats' }; }
    // «Тема» как просьба подобрать темы: выполняется сразу, до разбора «да/нет», чтобы «давай темы» не стало подтверждением чужой карточки
    const tr = office === 'smm' && t === 'captain_smm' ? topicRequest(body, { scored: q("SELECT id, title FROM videos WHERE stage='scored'") }) : null;
    if (tr) { execAction('topics:0', tr.hint, source, null).catch((e) => post({ thread: 'captain_smm', sender: 'captain_smm', text: 'Не получилось выполнить: ' + e.message, mirrorTg: true })); return { ok: true, id, note: 'topics' }; }
    const sa = office === 'smm' && t === 'captain_smm' ? studioAutoSwitch(body) : null;
    if (sa) { const s = STUDIO.writeStudioSettings({ autoPlan: sa.on }); post({ office, thread: 'captain_smm', sender: 'captain_smm', text: sa.on ? `Принято: план дня (видео и посты вместе) собирается сам каждый день в ${s.planAt} МСК на следующий день (канал: ${s.autoChannels.join(', ')}). Придёт одна карточка: варианты для видео и отдельно для постов, выбор нажатием номеров или словами («видео 2, посты 1 и 4»). В работу ничего не пойдёт без вашего «да». Выключить: «выключи автоплан».` : 'Принято: автоматический план дня выключен. Собрать вручную можно в любой момент: «план дня».', mirrorTg: true }); return { ok: true, id, note: 'studio-auto' }; }
    const ss = office === 'smm' && t === 'captain_smm' ? studioSelection(body) : null;
    if (ss) {
      const card = q("SELECT buttons FROM messages WHERE office=? AND kind='action' AND status='open' AND buttons LIKE ? ORDER BY id DESC LIMIT 1", office, '%"d":"splan:%:ok"%')[0];
      const key = card && (/splan:([^:]+):(\d{4}-\d{2}-\d{2}):ok/.exec(card.buttons) || [])[0];
      if (key) {
        const [, chKey, date] = key.split(':');
        execAction(`splan:${chKey}:${date}:${ss.more ? (ss.more === 'video' ? 'morev' : 'morep') : 'sel'}`, ss.more ? undefined : JSON.stringify({ video: ss.video, posts: ss.posts }), source, null).catch((e) => post({ thread: 'captain_smm', sender: 'captain_smm', text: 'Не получилось выполнить: ' + e.message, mirrorTg: true }));
        return { ok: true, id, note: 'studio-select' };
      }
    }
    const sp = office === 'smm' && t === 'captain_smm' ? studioPlanRequest(body) : null;
    if (sp) {
      const ch = STUDIO.studioSettings().autoChannels[0];
      const nowMs = now(), mskHour = Number(new Date(nowMs + 3 * 3600e3).toISOString().slice(11, 13));
      const date = sp.when === 'сегодня' ? STUDIO.mskDate(nowMs) : sp.when === 'завтра' ? STUDIO.mskDate(nowMs + 86400e3) : (mskHour < 10 ? STUDIO.mskDate(nowMs) : STUDIO.mskDate(nowMs + 86400e3));    // днём без уточнения план делается на завтра: ролик и посты не успеют на сегодня
      execAction(`splan_new:${ch}:${date}`, sp.hint, source, null).catch((e) => post({ thread: 'captain_smm', sender: 'captain_smm', text: 'Не получилось выполнить: ' + e.message, mirrorTg: true }));
      return { ok: true, id, note: 'studio-plan' };
    }
    const fast = fastAnswer(office, body, source);
    if (fast) return { ok: true, id, note: fast };
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
  const PROC_RE = /hermes\.exe"?\s+-p\s+video\b.*?query-file\s+"?dosie01[\\\/](BRIEF_v\w+\.md)/i;   // только ручные запуски проекта ролика №1; конвейер (produce/rework) сам ведёт статусы
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
    const probe = probeVideo(file), fmt = checkFormat(probe); if (!fmt.ok) throw new Error('формат ролика не по стандарту Shorts/Reels, не отправляю: ' + fmt.problems.join('; '));
    const fd = new FormData(); fd.append('chat_id', String(chatId())); fd.append('caption', caption.slice(0, 1000)); for (const [k, v] of Object.entries(sendFields(probe))) fd.append(k, v);
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
    let len = ''; try { len = cleanReport(fs.readFileSync(report, 'utf8')); } catch {}
    const caption = `🎬 Ролик №${VIDEO_JOB.videoId} ${job.ver} готов.\n${len}\n\nПринять или внести правки?`;
    const buttons = [[['Принять ролик', `accept:${VIDEO_JOB.videoId}`], ['Внести правки', `rework:${VIDEO_JOB.videoId}`]]];
    let mid = null; try { mid = await sendVideo(mp4, caption, buttons); } catch (e) { console.error('sendVideo', e.message); }
    run('UPDATE videos SET stage=?, video_path=?, updated_at=? WHERE id=?', 'produced', path.relative(ROOT, mp4), now(), VIDEO_JOB.videoId);
    post({ thread: 'captain_smm', sender: 'captain_smm', kind: 'action', text: `🎬 Ролик №${VIDEO_JOB.videoId} ${job.ver} готов: ${path.relative(ROOT, mp4)}${mid ? '\n(файл отправлен вам в Telegram)' : '\n(файл лежит на ПК, в Telegram отправить не удалось)'}\n${len}`, buttons: buttons.map((r) => r.map((x) => ({ t: x[0], d: x[1] }))), tgMsg: mid, mirrorTg: !mid });
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
      run('UPDATE agents SET status=?, task=?, progress=?, progress_real=0, updated_at=? WHERE id=?', 'working', `${task} ⏱ ${mins} мин${W.steps ? ` · шаг ${W.steps}` : ''}`, pr, now(), VIDEO_JOB.agent);
    } else if (ag.status === 'working' && String(ag.task).includes('⏱')) {
      W.pid = null; await finishVideoJob(ag);
    }
  }
  /* ---------- сторож студии (раз в минуту): Григорий выкладывает утверждённые посты, у которых пришло время; план дня сам, если Ник включил ---------- */
  function studioTick() {
    if (STUB) return;
    const nowMs = now();
    if (STUDIO.hasDue(nowMs) && !stageRunning(['studio', 'publish-due'])) spawnPipeline(['studio', 'publish-due']);
    for (const t of STUDIO.autoPlanTargets(nowMs)) {
      if (stageRunning(['studio', 'plan', t.ch])) continue;
      STUDIO.markTried(t.date, t.ch, nowMs);
      post({ thread: 'captain_smm', sender: 'captain_smm', text: `Собираю план дня на ${t.date} (автоматически, как вы включили). Глеб ищет темы, пришлю карточку.`, mirrorTg: false });
      setAgent('studio_chief', 'working', `План дня ${t.date}`, `Автоплан на ${t.date}`);
      spawnPipeline(['studio', 'plan', t.ch, '--date', t.date]);
    }
  }
  if (!process.env.OFFICE_NO_WATCH) { setInterval(() => { try { studioTick(); } catch (e) { console.error('studio tick', e.message); } }, 60000); setTimeout(() => { try { studioTick(); } catch {} }, 20000); }
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
    if (req.method === 'POST' && p === '/api/chat/answer') { const b = await body(req); json(res, 200, await answer({ id: b.id, tgMsg: b.tg_msg, choice: b.choice, comment: b.comment, via: b.via || 'dashboard', echo: b.echo !== false })); return true; }
    if (req.method === 'POST' && p === '/api/chat/clear-status') { const b = await body(req); json(res, 200, clearStatus(String(b.agent || ''))); return true; }
    if (req.method === 'GET' && p === '/api/priority') { json(res, 200, priority()); return true; }
    if (req.method === 'POST' && p === '/api/priority') { const b = await body(req); json(res, 200, setPriority({ active: !!b.active, video_id: b.video_id, label: b.label })); return true; }
    // Календарь студии «неделя × каналы» (чтение планов; ничего не запускает), запуск плана на дату и автоплан
    if (req.method === 'GET' && p === '/api/studio/calendar') {
      const st = url.searchParams.get('start') || '';
      const videoInfo = (id) => {
        const v = q('SELECT stage FROM videos WHERE id=?', Number(id))[0]; if (!v) return null;
        let pub = null; try { pub = (JSON.parse(fs.readFileSync(path.join(ROOT, 'smm', 'runs', `video_${Number(id)}`, 'publish.json'), 'utf8')).youtube || []).filter((x) => x.privacy === 'public' || x.scheduledFor).pop() || null; } catch {}
        return { stage: v.stage, url: pub ? pub.url : '', scheduledFor: pub ? pub.scheduledFor : '', privacy: pub ? pub.privacy : '' };
      };
      json(res, 200, STUDIO.calendarWeek(/^\d{4}-\d{2}-\d{2}$/.test(st) ? st : undefined, { videoInfo, now: now() })); return true;
    }
    if (req.method === 'POST' && p === '/api/studio/plan') {
      const b = await body(req), ch = String(b.channel || ''), date = String(b.date || '');
      if (!STUDIO.calendarChannels().some((c) => c.key === ch) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) { json(res, 400, { ok: false, error: 'неизвестный канал или дата' }); return true; }
      if (date < STUDIO.mskDate(now())) { json(res, 400, { ok: false, error: 'на прошедший день план не собираю' }); return true; }
      execAction(`splan_new:${ch}:${date}`, b.hint ? String(b.hint).slice(0, 300) : undefined, 'dashboard', null).catch((e) => post({ thread: 'captain_smm', sender: 'captain_smm', text: 'Не получилось выполнить: ' + e.message, mirrorTg: true }));
      json(res, 200, { ok: true }); return true;
    }
    if (req.method === 'POST' && p === '/api/studio/settings') {
      const b = await body(req), patch = {};
      if (typeof b.autoPlan === 'boolean') patch.autoPlan = b.autoPlan;
      if (typeof b.planAt === 'string' && /^\d{1,2}:\d{2}$/.test(b.planAt)) patch.planAt = b.planAt;
      const st = STUDIO.writeStudioSettings(patch); json(res, 200, { ok: true, autoPlan: st.autoPlan, planAt: st.planAt }); return true;
    }
    if (req.method === 'POST' && p === '/api/chat/edit') { const b = await body(req); json(res, 200, await editCard(b.id, b.text, b.buttons)); return true; }
    if (req.method === 'POST' && p === '/api/chat/post') {
      const b = await body(req);
      const id = post({ office: b.office || 'smm', thread: b.thread, sender: b.sender || b.thread, kind: b.buttons ? 'action' : (b.kind || 'text'), text: b.text, buttons: b.buttons, source: b.source || 'pipeline', tgMsg: b.tg_msg || null, mirrorTg: b.mirror !== false && !b.tg_msg && (b.mirror === true || !!b.buttons) });
      json(res, 200, { ok: true, id }); return true;
    }
    return false;
  }
  // Одноразово: уже висящие карточки тоже получают «Убрать» (в базе и в Telegram), иначе зависшее нельзя было бы убрать из бота.
  for (const o of q("SELECT id, tg_msg, buttons FROM messages WHERE kind='action' AND status='open' AND ref IS NULL AND buttons IS NOT NULL")) {
    let rows; try { rows = JSON.parse(o.buttons); } catch { continue; }
    if (!Array.isArray(rows) || rows.flat().some(isDismiss)) continue;
    const nb = JSON.stringify(withDismiss(rows)); run('UPDATE messages SET buttons=? WHERE id=?', nb, o.id);
    if (o.tg_msg && !NO_TG) tg('editMessageReplyMarkup', { chat_id: chatId(), message_id: o.tg_msg, reply_markup: kbOf(nb) }).catch(() => {});
  }
  // Одноразово: карточка сценария «не прошёл проверку» раньше не имела кнопки утверждения (тупик: Ник говорил «делаем», а утверждать было нечем).
  for (const o of q("SELECT id, tg_msg, buttons FROM messages WHERE kind='action' AND status='open' AND ref IS NULL AND buttons LIKE '%\"d\":\"revise:%'")) {
    let rows; try { rows = JSON.parse(o.buttons); } catch { continue; }
    const flat = rows.flat(), rv = flat.find((b) => /^revise:\d+$/.test(b.d)); if (!rv || flat.some((b) => /^approve:/.test(b.d))) continue;
    const vid = Number(rv.d.split(':')[1]); const vv = q('SELECT stage FROM videos WHERE id=?', vid)[0]; if (!vv || vv.stage !== 'script') continue;
    const nb = JSON.stringify([[{ t: 'Утвердить после проверки', d: `approve:${vid}` }], ...rows]); run('UPDATE messages SET buttons=? WHERE id=?', nb, o.id);
    if (o.tg_msg && !NO_TG) tg('editMessageReplyMarkup', { chat_id: chatId(), message_id: o.tg_msg, reply_markup: kbOf(nb) }).catch(() => {});
  }
  const pending = (office) => q("SELECT COUNT(*) c FROM messages WHERE office=? AND status='open'", office)[0].c;
  return { handle, pending, post, say, answer, incoming, priority, clearStatus, editCard };
}

// Нижний блок дашборда: чат с сотрудниками (слева) и «Сейчас в работе» (справа).
// Вопросы, ждущие ответа Ника, закрепляются над перепиской автоматически; ответ из дашборда и из Telegram идёт через один API.
let chatThread = null, chatData = { messages: [], pending: 0, typing: [] }, chatKey = '', pinKey = '', chatStarted = false;
const expanded = new Set();
let revise = null;                      // { mid, choice, text }: открыто поле правок к сценарию
const knownOpen = new Set(); let firstLoad = true;
const seenKey = () => 'chat_seen_' + officeId;
const seenMap = () => { try { return JSON.parse(localStorage.getItem(seenKey()) || '{}'); } catch { return {}; } };
const hhmm = (ts) => new Date(ts).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });
const hhmmss = (ts) => new Date(ts).toLocaleTimeString('ru');
const agentById = (id) => ((state && state.agents) || []).find((a) => a.id === id);
const captainId = () => (((state && state.agents) || []).find((a) => a.role === 'Chief of Staff') || {}).id || 'captain_smm';
const firstName = (a) => String(a.name || '').split(' ')[0];
const VIA = { dashboard: 'дашборд', telegram: 'Telegram' };
const thread = () => chatThread || captainId();

/* ---------- данные ---------- */
async function fetchChat() {
  const d = await api('/api/chat?office=' + encodeURIComponent(officeId));
  const open = d.messages.filter((m) => m.status === 'open');
  const fresh = open.filter((m) => !knownOpen.has(m.id));
  open.forEach((m) => knownOpen.add(m.id));
  d.freshIds = firstLoad ? new Set() : new Set(fresh.map((m) => m.id)); firstLoad = false;
  chatData = d; renderChat();
}
function startChat() {
  if (chatStarted) return; chatStarted = true;
  fetchChat().catch(() => {});
  const loop = async () => { if (!document.hidden) await fetchChat().catch(() => {}); setTimeout(loop, (chatData.typing || []).length ? 1500 : 4000); };   // пока сотрудник печатает, опрос чаще
  setTimeout(loop, 4000);
}
function chatOnOfficeSwitch() { chatThread = null; chatKey = pinKey = ''; knownOpen.clear(); firstLoad = true; chatData = { messages: [], pending: 0, typing: [] }; renderChat(); fetchChat().catch(() => {}); }
function chatOnState(s) {
  const n = s.pending || 0;
  const b = $('chatBadge'); b.textContent = n; b.classList.toggle('hidden', !n);
  document.title = (n ? `(${n}) ` : '') + 'AI Office';
  startChat();
  if (n !== chatData.messages.filter((m) => m.status === 'open').length) fetchChat().catch(() => {});
  renderLive(s);
}

/* ---------- закреплённые вопросы ---------- */
function actHtml(m) {
  const ag = agentById(m.sender), reviseHere = revise && revise.mid === m.id, open = expanded.has(m.id) || reviseHere;
  const flat = (m.buttons || []).flat();
  const btns = `<div class="act-btns">${flat.map((b) => `<button type="button" data-act="${esc(b.d)}" data-mid="${m.id}">${esc(b.t)}</button>`).join('')}</div>`;
  const rev = reviseHere
    ? `<div class="rev"><textarea id="revText" placeholder="${revise.choice.startsWith('rework:') ? 'Что поправить в ролике? Кирилл начнёт сразу.' : 'Что поправить в сценарии?'}">${esc(revise.text)}</textarea><div class="btns"><button type="button" data-revsend="1">Отправить правки</button><button type="button" data-revcancel="1">Отмена</button></div></div>`
    : btns;
  const long = m.text.length > 70 || m.text.includes('\n');
  const more = long ? `<button type="button" class="act-more" data-more="${m.id}">${open ? 'Свернуть ▴' : 'Подробнее ▾'}</button>` : '';
  return `<div class="act ${open ? 'open' : ''} ${chatData.freshIds && chatData.freshIds.has(m.id) ? 'fresh' : ''}" data-m="${m.id}"><div class="act-line"><div class="act-text" ${long ? `data-more="${m.id}"` : ''}>${esc(open ? m.text : m.text.split('\n')[0])}</div>${more}</div>${rev}${open ? `<div class="act-meta" style="display:block">${hhmm(m.ts)} · ${esc(ag ? ag.name : m.sender)}</div>` : ''}</div>`;
}
function renderPinned() {
  const open = chatData.messages.filter((m) => m.status === 'open');
  const key = JSON.stringify([open.map((m) => m.id), revise && revise.mid, [...expanded]]);
  const box = $('chatPinned');
  if (!open.length) { box.classList.add('hidden'); box.innerHTML = ''; pinKey = ''; return; }
  box.classList.remove('hidden');
  if (key === pinKey) return;
  pinKey = key;
  box.innerHTML = `<h4>⏳ Ждут вашего ответа · ${open.length}</h4>` + open.map(actHtml).join('');
  const ta = $('revText'); if (ta) ta.focus();
}

/* ---------- переписка ---------- */
function renderChatTabs() {
  const seen = seenMap(), cur = thread();
  const unread = (t) => chatData.messages.some((m) => m.thread === t && m.sender !== 'nick' && m.id > (seen[t] || 0));
  $('chatTabs').innerHTML = (((state && state.agents) || []).map((a) => `<button type="button" class="chat-tab ${cur === a.id ? 'on' : ''}" data-thread="${esc(a.id)}" title="${esc(a.name)}" aria-label="${esc(a.name)}"><span class="av">${duckSVG(a, { size: 26 })}</span>${cur === a.id ? esc(firstName(a)) : ''}${unread(a.id) && cur !== a.id ? '<span class="dot"></span>' : ''}</button>`).join(''));
}
function msgHtml(m) {
  const me = m.sender === 'nick', ag = agentById(m.sender);
  const who = me ? '' : `<span class="who">${esc(ag ? ag.name : m.sender)}</span>`;
  if (m.kind === 'action') {
    if (m.status === 'open') return `<div class="msg sys">⏳ ${esc(m.text.split('\n')[0].slice(0, 110))}<br>Ждёт вашего ответа: кнопки закреплены выше.<span class="meta">${hhmm(m.ts)}</span></div>`;
    const stale = m.choice === 'superseded';
    const choice = ((m.buttons || []).flat().find((b) => b.d === m.choice) || {}).t || m.choice;
    if (stale) return `<div class="msg sys">${who}${esc(m.text.split('\n')[0].slice(0, 90))}<br>⏹ Неактуально: решение уже принято по другому вопросу<span class="meta">${hhmm(m.ts)}</span></div>`;
    return `<div class="msg ag">${who}${esc(m.text.length > 400 ? m.text.slice(0, 400) + '…' : m.text)}<span class="answered">${stale ? '⏹ Неактуально: решение уже принято по другому вопросу' : `✅ Ваш ответ: ${esc(choice)} · ${VIA[m.answered_via] || ''} ${hhmm(m.answered_ts)}`}</span><span class="meta">${hhmm(m.ts)}</span></div>`;
  }
  return `<div class="msg ${me ? 'nick' : 'ag'}">${who}${esc(m.text)}<span class="meta">${hhmm(m.ts)}${me && m.source && VIA[m.source] ? ' · ' + VIA[m.source] : ''}</span></div>`;
}
function renderLog() {
  const cur = thread(), ag = agentById(cur);
  const msgs = chatData.messages.filter((m) => m.thread === cur);
  const key = JSON.stringify([cur, msgs.map((m) => [m.id, m.status, m.answered_ts])]);
  const log = $('chatLog');
  if (key !== chatKey) {
    const near = log.scrollHeight - log.scrollTop - log.clientHeight < 90 || chatKey === '' || !chatKey.startsWith(`["${cur}"`);
    log.innerHTML = msgs.length ? msgs.map(msgHtml).join('') : `<div class="chat-empty">Здесь пока пусто.<br>Напишите ${ag ? esc(firstName(ag)) : 'сотруднику'}: он ответит в своей роли.${officeId === 'smm' ? '<br>В Telegram-боте начните сообщение с имени, и переписка появится и тут.' : ''}</div>`;
    if (near) log.scrollTop = log.scrollHeight;
    chatKey = key;
  }
  const t = (chatData.typing || []).filter((id) => id === cur).map((id) => (agentById(id) || {}).name).filter(Boolean);
  $('chatTyping').textContent = t.length ? `${t.join(', ')} печатает…` : '';
  const m = seenMap(); m[cur] = Math.max(0, m[cur] || 0, ...msgs.map((x) => x.id)); localStorage.setItem(seenKey(), JSON.stringify(m));
  $('chatInput').placeholder = `Написать: ${ag ? ag.name : 'сотруднику'}…`;
}
function renderChat() { renderChatTabs(); renderPinned(); renderLog(); }

/* ---------- «Сейчас в работе» ---------- */
function liveCard(a, kind) {
  const raw = String(a.task || ''), i = raw.indexOf('⏱');
  const task = (i >= 0 ? raw.slice(0, i) : raw).trim().replace(/\s*\(дело[^)]*\)/i, '');
  const meta = i >= 0 ? raw.slice(i + 1).trim() : '';
  const pr = Math.max(0, Math.min(100, Number(a.progress) || 0));
  return `<div class="live-card ${kind}" data-agent="${esc(a.id)}" title="${esc(a.name)}: ${esc(task)}. Нажмите, чтобы открыть чат"><div class="av">${duckSVG(a, { size: 40 })}</div><div><b>${esc(a.name)}</b><div class="t">${esc(task)}</div>${meta ? `<div class="m">⏱ ${esc(meta)}</div>` : ''}${kind === '' && pr ? `<div class="bar"><i style="width:${pr}%"></i></div>` : ''}</div></div>`;
}
function renderLive(s) {
  const agents = s.agents || [];
  const work = agents.filter((a) => a.status === 'working'), err = agents.filter((a) => a.status === 'error');
  $('liveCount').textContent = work.length ? `работают: ${work.length}` : '';
  const pr = s.priority && s.priority.active ? `<div class="live-prio">⚡ Приоритет: ${esc(s.priority.label || 'правки ролика')}. Остальные этапы подождут.</div>` : '';
  $('liveNow').innerHTML = pr + (work.map((a) => liveCard(a, '')).concat(err.map((a) => liveCard(a, 'err'))).join('')) || '<div class="live-empty">Сейчас никто не работает: все свободны.</div>';
  const now = Date.now();
  $('liveFeed').innerHTML = (s.events || []).slice(0, 16).map((e) => `<li class="${e.level === 'error' ? 'err' : ''} ${now - e.ts < 90000 ? 'new' : ''}"><time>${hhmmss(e.ts)}</time><span><b>${esc((e.agent_name || '').split(' ')[0])}</b> ${esc(e.message)}</span></li>`).join('') || '<li><span>Пока пусто</span></li>';
}

/* ---------- действия ---------- */
async function answerAction(mid, choice, comment) {
  try {
    const r = await api('/api/chat/answer', { method: 'POST', body: JSON.stringify({ id: Number(mid), choice, comment: comment || undefined, via: 'dashboard' }) });
    if (!r.ok) alert(r.error || 'Не вышло');
  } catch (e) { alert('Ошибка: ' + e.message); }
  revise = null; pinKey = chatKey = ''; await fetchChat().catch(() => {});
}
async function sendChat() {
  const inp = $('chatInput'), text = inp.value.trim(); if (!text) return;
  const to = thread(); inp.value = ''; inp.style.height = 'auto';
  try { await api('/api/chat/send', { method: 'POST', body: JSON.stringify({ office: officeId, to, text }) }); }
  catch (e) { alert('Не отправилось: ' + e.message); inp.value = text; }
  chatKey = ''; await fetchChat().catch(() => {});
}
function focusChat() { $('dock').scrollIntoView({ behavior: 'smooth', block: 'end' }); setTimeout(() => $('chatInput').focus(), 250); }
function openThread(id) { chatThread = id; chatKey = ''; renderChat(); focusChat(); }

$('chatBtn').onclick = focusChat;
$('chatForm').addEventListener('submit', (e) => { e.preventDefault(); sendChat(); });
$('chatInput').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); } });
$('chatInput').addEventListener('input', (e) => { e.target.style.height = 'auto'; e.target.style.height = Math.min(110, e.target.scrollHeight) + 'px'; });
$('chatTabs').addEventListener('click', (e) => { const t = e.target.closest('[data-thread]'); if (t) { chatThread = t.dataset.thread; chatKey = ''; renderChat(); } });
$('liveNow').addEventListener('click', (e) => { const c = e.target.closest('[data-agent]'); if (c) openThread(c.dataset.agent); });
$('chatPinned').addEventListener('input', (e) => { if (revise && e.target.id === 'revText') revise.text = e.target.value; });
$('chatPinned').addEventListener('click', (e) => {
  if (e.target.closest('[data-revcancel]')) { revise = null; pinKey = ''; return renderPinned(); }
  if (e.target.closest('[data-revsend]')) { const t = ($('revText').value || '').trim(); if (!t) return $('revText').focus(); return answerAction(revise.mid, revise.choice, t); }
  const more = e.target.closest('[data-more]'); if (more) { const id = Number(more.dataset.more); expanded.has(id) ? expanded.delete(id) : expanded.add(id); pinKey = ''; return renderPinned(); }
  const b = e.target.closest('[data-act]'); if (!b || b.disabled) return;
  if (b.dataset.act.startsWith('revise:') || b.dataset.act.startsWith('rework:')) { revise = { mid: Number(b.dataset.mid), choice: b.dataset.act, text: '' }; pinKey = ''; return renderPinned(); }
  b.disabled = true; answerAction(b.dataset.mid, b.dataset.act);
});
document.addEventListener('dblclick', (e) => { const el = e.target.closest('[data-id]'); if (el && agentById(el.dataset.id)) openThread(el.dataset.id); });

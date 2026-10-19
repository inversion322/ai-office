// Чат с сотрудниками: переписка как в мессенджере. Вопросы, ждущие ответа Ника, это карточки с кнопками (вкладка «Ответить»);
// ответ из дашборда и из Telegram-бота идёт через один API, состояние всегда общее.
let chatOpen = false, chatThread = 'inbox', chatData = { messages: [], pending: 0, typing: [] }, chatTimer = null, chatLastKey = '';
const SEEN_KEY = () => 'chat_seen_' + officeId;
const seenMap = () => { try { return JSON.parse(localStorage.getItem(SEEN_KEY()) || '{}'); } catch { return {}; } };
const markSeen = (thread) => { const m = seenMap(); const ids = chatData.messages.filter((x) => x.thread === thread).map((x) => x.id); m[thread] = Math.max(0, ...ids, m[thread] || 0); localStorage.setItem(SEEN_KEY(), JSON.stringify(m)); };
const hhmm = (ts) => new Date(ts).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });
const agentById = (id) => (state && state.agents || []).find((a) => a.id === id);
const captainId = () => ((state && state.agents || []).find((a) => a.role === 'Chief of Staff') || {}).id || 'captain_smm';
const VIA = { dashboard: 'дашборд', telegram: 'Telegram' };

function chatOnState(s) {
  const n = s.pending || 0;
  const b = $('chatBadge'); b.textContent = n; b.classList.toggle('hidden', !n);
  document.title = (n ? `(${n}) ` : '') + 'AI Office';
  if (n && !chatOpen && !chatTimer) fetchChat().catch(() => {});
}
function chatOnOfficeSwitch() { chatThread = 'inbox'; chatData = { messages: [], pending: 0, typing: [] }; chatLastKey = ''; if (chatOpen) { fetchChat().catch(() => {}); } }

async function fetchChat() {
  const d = await api('/api/chat?office=' + encodeURIComponent(officeId));
  chatData = d;
  const b = $('chatBadge'); b.textContent = d.pending; b.classList.toggle('hidden', !d.pending);
  if (chatOpen) renderChat();
}
function openChat(thread) {
  chatOpen = true; if (thread) chatThread = thread;
  $('chat').classList.remove('hidden');
  fetchChat().catch((e) => { $('chatLog').innerHTML = `<div class="chat-empty">Нет связи с API: ${esc(e.message)}</div>`; });
  clearInterval(chatTimer); chatTimer = setInterval(() => fetchChat().catch(() => {}), 3000);
  setTimeout(() => $('chatInput').focus(), 50);
}
function closeChat() { chatOpen = false; $('chat').classList.add('hidden'); clearInterval(chatTimer); chatTimer = null; }

function renderTabs() {
  const agents = (state && state.agents) || [];
  const seen = seenMap();
  const unread = (t) => chatData.messages.some((m) => m.thread === t && m.sender !== 'nick' && m.id > (seen[t] || 0));
  const pend = chatData.messages.filter((m) => m.status === 'open').length;
  let html = `<button type="button" class="chat-tab ${chatThread === 'inbox' ? 'on' : ''}" data-thread="inbox">Ответить${pend ? `<span class="cnt">${pend}</span>` : ''}</button>`;
  html += agents.map((a) => `<button type="button" class="chat-tab ${chatThread === a.id ? 'on' : ''}" data-thread="${esc(a.id)}"><span class="av">${duckSVG(a, { size: 24 })}</span>${esc(a.name.split(' ')[0])}${unread(a.id) && chatThread !== a.id ? '<span class="dot"></span>' : ''}</button>`).join('');
  $('chatTabs').innerHTML = html;
}
function msgHtml(m) {
  const me = m.sender === 'nick', ag = agentById(m.sender);
  const who = me ? '' : `<span class="who">${esc(ag ? ag.name : m.sender)}</span>`;
  const via = m.source && VIA[m.source] ? ` · ${VIA[m.source]}` : '';
  if (m.kind === 'action') {
    const done = m.status !== 'open';
    const btns = (m.buttons || []).map((row) => `<div class="btns">${row.map((b) => `<button type="button" data-act="${esc(b.d)}" data-mid="${m.id}" ${done ? 'disabled' : ''}>${esc(b.t)}</button>`).join('')}</div>`).join('');
    const choice = done ? ((m.buttons || []).flat().find((b) => b.d === m.choice) || {}).t || m.choice : '';
    return `<div class="msg action ${done ? 'done' : ''}" data-m="${m.id}">${who}${esc(m.text)}${done ? `<span class="answered">✅ Ответ: ${esc(choice)} · ${VIA[m.answered_via] || ''} ${hhmm(m.answered_ts)}</span>` : btns}<span class="meta">${hhmm(m.ts)}</span></div>`;
  }
  return `<div class="msg ${me ? 'nick' : 'ag'}">${who}${esc(m.text)}<span class="meta">${hhmm(m.ts)}${me ? via : ''}</span></div>`;
}
function renderChat() {
  renderTabs();
  const inbox = chatThread === 'inbox';
  const ag = agentById(chatThread);
  $('chatTitle').textContent = inbox ? 'Требуют вашего ответа' : (ag ? `${ag.name} · ${ag.title || ag.role}` : 'Чат');
  const msgs = inbox ? chatData.messages.filter((m) => m.status === 'open').reverse() : chatData.messages.filter((m) => m.thread === chatThread);
  const key = JSON.stringify([chatThread, msgs.map((m) => [m.id, m.status, m.answered_ts])]) + $('chatInput').value.length * 0;
  const log = $('chatLog');
  if (key !== chatLastKey) {
    const keepRev = log.querySelector('.rev textarea') ? { id: log.querySelector('.rev').dataset.mid, v: log.querySelector('.rev textarea').value } : null;
    const nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 80 || chatLastKey === '';
    log.innerHTML = msgs.length ? msgs.map(msgHtml).join('') : `<div class="chat-empty">${inbox ? 'Вопросов, ждущих вашего ответа, нет.<br>Когда сотрудникам понадобится ваше решение, оно появится здесь и в Telegram.' : 'Здесь пока пусто. Напишите сообщение: сотрудник ответит.'}</div>`;
    if (inbox) log.scrollTop = 0; else if (nearBottom) log.scrollTop = log.scrollHeight;
    if (keepRev) openRevise(keepRev.id, keepRev.v);
    chatLastKey = key;
  }
  const t = (chatData.typing || []).filter((id) => inbox ? true : id === chatThread).map((id) => (agentById(id) || {}).name).filter(Boolean);
  $('chatTyping').textContent = t.length ? `${t.join(', ')} печатает…` : '';
  if (!inbox) markSeen(chatThread);
  $('chatInput').placeholder = inbox ? `Написать ${((agentById(captainId()) || {}).name || 'Капитану')}…` : `Написать: ${ag ? ag.name.split(' ')[0] : 'сотруднику'}…`;
}
function openRevise(mid, text = '') {
  const card = document.querySelector(`.msg.action[data-m="${mid}"]`); if (!card || card.querySelector('.rev')) return;
  const btn = card.querySelector('[data-act^="revise:"]'); const choice = btn ? btn.dataset.act : null; if (!choice) return;
  card.querySelectorAll('.btns').forEach((b) => b.remove());
  const d = document.createElement('div'); d.className = 'rev'; d.dataset.mid = mid;
  d.innerHTML = `<textarea placeholder="Что поправить в сценарии?">${esc(text)}</textarea><div class="btns"><button type="button" data-revsend="${esc(choice)}" data-mid="${mid}">Отправить правки</button><button type="button" data-revcancel="${mid}">Отмена</button></div>`;
  card.appendChild(d); d.querySelector('textarea').focus();
}
async function answerAction(mid, choice, comment) {
  try {
    const r = await api('/api/chat/answer', { method: 'POST', body: JSON.stringify({ id: Number(mid), choice, comment: comment || undefined, via: 'dashboard' }) });
    if (!r.ok) alert(r.error || 'Не вышло');
  } catch (e) { alert('Ошибка: ' + e.message); }
  chatLastKey = ''; await fetchChat().catch(() => {});
}
async function sendChat() {
  const inp = $('chatInput'), text = inp.value.trim(); if (!text) return;
  const to = chatThread === 'inbox' ? captainId() : chatThread;
  inp.value = ''; inp.style.height = 'auto';
  if (chatThread === 'inbox') { chatThread = to; }
  try { await api('/api/chat/send', { method: 'POST', body: JSON.stringify({ office: officeId, to, text }) }); }
  catch (e) { alert('Не отправилось: ' + e.message); inp.value = text; }
  chatLastKey = ''; await fetchChat().catch(() => {});
}

$('chatBtn').onclick = () => (chatOpen ? closeChat() : openChat(chatData.pending ? 'inbox' : chatThread));
$('chatClose').onclick = closeChat;
$('chatForm').addEventListener('submit', (e) => { e.preventDefault(); sendChat(); });
$('chatInput').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); } });
$('chatInput').addEventListener('input', (e) => { e.target.style.height = 'auto'; e.target.style.height = Math.min(120, e.target.scrollHeight) + 'px'; });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && chatOpen && !$('modal') .classList.contains('hidden') === false) closeChat(); });
$('chatTabs').addEventListener('click', (e) => { const t = e.target.closest('[data-thread]'); if (t) { chatThread = t.dataset.thread; chatLastKey = ''; renderChat(); } });
$('chatLog').addEventListener('click', (e) => {
  const rs = e.target.closest('[data-revsend]');
  if (rs) { const ta = rs.closest('.rev').querySelector('textarea'); if (!ta.value.trim()) return ta.focus(); return answerAction(rs.dataset.mid, rs.dataset.revsend, ta.value.trim()); }
  const rc = e.target.closest('[data-revcancel]'); if (rc) { chatLastKey = ''; return renderChat(); }
  const b = e.target.closest('[data-act]'); if (!b || b.disabled) return;
  if (b.dataset.act.startsWith('revise:')) return openRevise(b.dataset.mid);
  b.disabled = true; answerAction(b.dataset.mid, b.dataset.act);
});
// клик по сотруднику в офисе или списке: «Написать»
document.addEventListener('dblclick', (e) => { const el = e.target.closest('[data-id]'); if (el && state && state.agents.find((a) => a.id === el.dataset.id)) openChat(el.dataset.id); });

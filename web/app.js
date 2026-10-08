// AI Office: фронтенд. Каждые 15 секунд тянет /api/state у API на вашем ПК.
const POLL_MS = 15000;
const ICON = { core: '🧠', jobs: '🔎', content: '✍️', research: '📊' };
const AGENT_ICON = { xenon: '🧠', scout: '🔭', analyst: '📋', writer: '✉️', sender: '🚀', content: '✍️', research: '📊' };
const STATUS = { working: 'работает', waiting: 'ждёт', idle: 'свободен', error: 'ошибка', offline: 'отключён' };
const STAGES = [['found', 'Найдено'], ['review', 'На согласовании'], ['approved', 'Одобрено'], ['letter', 'Письмо'], ['applied', 'Отправлено'], ['reply', 'Ответ']];

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let state = null, selected = null, timer = null;

const store = {
  get: () => ({ url: localStorage.getItem('office_url'), token: localStorage.getItem('office_token') }),
  set: (u, t) => { localStorage.setItem('office_url', u.replace(/\/+$/, '')); localStorage.setItem('office_token', t); },
  clear: () => { localStorage.removeItem('office_url'); localStorage.removeItem('office_token'); },
};

async function fetchState() {
  const { url, token } = store.get();
  const r = await fetch(url + '/api/state', { headers: { Authorization: 'Bearer ' + token }, cache: 'no-store' });
  if (r.status === 401) throw new Error('Неверный токен');
  if (!r.ok) throw new Error('API ответил ' + r.status);
  return r.json();
}

function render(s) {
  const agents = s.agents;
  $('sTotal').textContent = agents.length;
  $('sActive').textContent = agents.filter((a) => a.status === 'working').length;
  $('sWait').textContent = s.jobs.filter((j) => j.stage === 'review').length;

  // воронка на «экране» на стене
  const max = Math.max(1, ...STAGES.map(([k]) => s.funnel[k] || 0));
  $('funnel').innerHTML = STAGES.map(([k, n]) => `<div class="f-col"><b>${s.funnel[k] || 0}</b><i style="height:${6 + ((s.funnel[k] || 0) / max) * 34}px"></i>${n}</div>`).join('');

  // комната
  $('room').innerHTML = agents.map((a) => `
    <div class="desk" data-id="${esc(a.id)}">
      <div class="bubble" style="visibility:${a.status === 'working' && a.task ? 'visible' : 'hidden'}">${esc(a.task || '')}</div>
      <div class="bot ${esc(a.status)}" style="background:${esc(a.color)}">${AGENT_ICON[a.id] || '🤖'}</div>
      <div class="table"></div>
      <div class="plate"><span class="dot ${esc(a.status)}"></span>${esc(a.name)}</div>
    </div>`).join('');

  // боковая панель
  $('agentList').innerHTML = agents.map((a) => `
    <li data-id="${esc(a.id)}" class="${selected === a.id ? 'sel' : ''}">
      <div class="av" style="background:${esc(a.color)}33">${AGENT_ICON[a.id] || '🤖'}</div>
      <div><b>${esc(a.name)} <span class="dot ${esc(a.status)}"></span></b><small>${esc(a.role)}: ${esc(a.task || STATUS[a.status])}</small></div>
    </li>`).join('');

  $('tasks').innerHTML = s.tasks.map((t) => `<li>${t.status === 'running' ? '▶' : '⏱'} ${esc(t.title)}<small>${esc(t.agent_name || '')}</small></li>`).join('') || '<li>Пока пусто</li>';
  $('jobs').innerHTML = s.jobs.slice(0, 12).map((j) => `<li>${esc(j.title)}<small>${esc(j.company)} · ${esc(j.salary)} · ${esc(j.format)} · ${esc(j.stage)}</small></li>`).join('') || '<li>Пока пусто</li>';
  $('events').innerHTML = s.events.map((e) => `<li>${new Date(e.ts).toLocaleTimeString('ru')} ${esc(e.agent_name || '')} ${esc(e.message)}</li>`).join('');
  renderDetail();
}

function renderDetail() {
  const a = state && state.agents.find((x) => x.id === selected);
  const box = $('detail');
  if (!a) return box.classList.add('hidden');
  box.classList.remove('hidden');
  box.innerHTML = `<h4>${esc(a.name)} · ${esc(a.role)}</h4>
    <p>Статус: ${STATUS[a.status] || esc(a.status)}</p><p>Модель: ${esc(a.model)}</p><p>Команда: ${esc(a.team)}</p>
    <p>Задача: ${esc(a.task || '—')}</p><div class="bar"><i style="width:${Number(a.progress) || 0}%"></i></div>`;
}

async function tick() {
  try {
    state = await fetchState();
    $('conn').className = 'conn on';
    $('conn').textContent = '● онлайн · ' + new Date(state.ts).toLocaleTimeString('ru');
    render(state);
  } catch (e) {
    $('conn').className = 'conn off';
    $('conn').textContent = '● нет связи: ' + e.message;
  }
}

function start() {
  $('login').classList.add('hidden');
  $('app').classList.remove('hidden');
  tick();
  clearInterval(timer);
  timer = setInterval(tick, POLL_MS);
}

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-id]');
  if (el) { selected = el.dataset.id; if (state) render(state); }
});
$('logout').onclick = () => { store.clear(); clearInterval(timer); $('app').classList.add('hidden'); $('login').classList.remove('hidden'); };
$('loginForm').onsubmit = async (e) => {
  e.preventDefault();
  store.set($('apiUrl').value.trim(), $('apiToken').value.trim());
  try { await fetchState(); $('loginErr').textContent = ''; start(); }
  catch (err) { $('loginErr').textContent = err.message === 'Failed to fetch' ? 'API недоступен: проверьте адрес и что ПК включён' : err.message; store.clear(); }
};
setInterval(() => { $('clock').textContent = new Date().toLocaleString('ru'); }, 1000);

if (store.get().url && store.get().token) start(); else $('login').classList.remove('hidden');

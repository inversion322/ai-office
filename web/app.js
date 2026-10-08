// AI Office: фронтенд. Опрос API каждые 15 с, анимация сцен на клиенте.
const POLL_MS = 15000;
const STATUS = { working: 'работает', waiting: 'ждёт', idle: 'свободен', error: 'ошибка', offline: 'отключён' };
const STAGES = [['found', 'Найдено'], ['review', 'Review'], ['approved', 'Одобрено'], ['letter', 'Письмо'], ['applied', 'Отправлено'], ['reply', 'Ответ']];

// Места (в % от офиса): Капитан в центре, остальные по кругу вокруг ковра.
const DESKS = {
  captain: [50, 52],
  scout: [17, 48], analyst: [17, 80], writer: [83, 48],
  sender: [83, 80], content: [38, 84], research: [62, 84],
};

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let state = null, selected = null, timer = null;
const actors = {};            // id -> { el, home:[x,y], busy }
const playedScenes = new Set();
let sceneQueue = [], sceneRunning = false;

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

/* ---------- построение офиса ---------- */
function buildOffice(agents) {
  const desks = $('desks'), layer = $('actors');
  desks.innerHTML = agents.map((a) => {
    const [x, y] = DESKS[a.id] || [50, 50];
    return `<div class="desk ${esc(a.status)}" data-id="${esc(a.id)}" style="left:${x}%;top:${y}%">
      <div class="top"></div><div class="mon"></div><div class="kb"></div><div class="cup"></div>
      <div class="plate"><b>${esc(a.name)}</b><span>${esc(a.title || a.role)}</span></div></div>`;
  }).join('');
  agents.forEach((a) => {
    if (actors[a.id]) return;
    const [x, y] = DESKS[a.id] || [50, 50];
    const el = document.createElement('div');
    el.className = 'actor'; el.dataset.id = a.id;
    el.innerHTML = duckSVG(a);
    layer.appendChild(el);
    actors[a.id] = { el, home: [x, y - 6] };
    place(a.id, x, y - 6, false);
  });
}
function place(id, x, y, animate = true) {
  const el = actors[id].el;
  if (!animate) el.style.transition = 'none';
  el.style.left = x + '%'; el.style.top = y + '%';
  if (!animate) { void el.offsetWidth; el.style.transition = ''; }
}
function setStatusClasses(agents) {
  agents.forEach((a) => {
    const d = document.querySelector(`.desk[data-id="${a.id}"]`);
    if (d) d.className = `desk ${a.status}`;
    const ac = actors[a.id];
    if (!ac) return;
    const walking = ac.el.classList.contains('walking');
    ac.el.className = `actor ${a.status}${a.status === 'working' && !walking ? ' typing' : ''}${walking ? ' walking' : ''}`;
  });
}

/* ---------- сцены: диалоги и выдача задач ---------- */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function bubbleAt(id, text, label, cls = '') {
  const [x, y] = [parseFloat(actors[id].el.style.left), parseFloat(actors[id].el.style.top)];
  const b = document.createElement('div');
  b.className = 'bubble ' + cls; b.style.left = x + '%'; b.style.top = (y - 13) + '%';
  b.innerHTML = (label ? `<small>${esc(label)}</small>` : '') + esc(text);
  $('bubbles').appendChild(b);
  return b;
}
async function walk(id, x, y) {
  const el = actors[id].el;
  el.classList.add('walking'); el.classList.remove('typing');
  place(id, x, y);
  await sleep(1500);
  el.classList.remove('walking');
}
async function playScene(sc) {
  const A = actors[sc.from_id], B = actors[sc.to_id];
  if (!A || !B) return;
  const nameOf = (id) => (state.agents.find((a) => a.id === id) || {}).name || id;
  const [tx, ty] = B.home;
  if (sc.kind === 'assign') {
    // Капитан подходит к сотруднику, показывает задачу, возвращается на место
    await walk(sc.from_id, tx + 7, ty + 1);
    const bub = bubbleAt(sc.from_id, sc.text, `Задача → ${nameOf(sc.to_id)}`, 'assign');
    await sleep(Math.min(sc.ttl || 4500, 5000));
    bub.remove();
    await walk(sc.from_id, ...A.home);
  } else {
    // диалог: говорящий идёт к собеседнику, оба показывают облачко
    await walk(sc.from_id, tx + 7, ty + 1);
    const b1 = bubbleAt(sc.from_id, sc.text, `${nameOf(sc.from_id)} → ${nameOf(sc.to_id)}`);
    await sleep(Math.min(sc.ttl || 4500, 5000));
    b1.remove();
    await walk(sc.from_id, ...A.home);
  }
}
async function pump() {
  if (sceneRunning) return;
  sceneRunning = true;
  while (sceneQueue.length) { try { await playScene(sceneQueue.shift()); } catch (e) { console.warn(e); } }
  sceneRunning = false;
  if (state) setStatusClasses(state.agents);
}
function enqueueScenes(list) {
  list.forEach((s) => { if (!playedScenes.has(s.id)) { playedScenes.add(s.id); sceneQueue.push(s); } });
  pump();
}

/* ---------- отрисовка данных ---------- */
function render(s) {
  const agents = s.agents;
  $('sTotal').textContent = agents.length;
  $('sActive').textContent = agents.filter((a) => a.status === 'working').length;
  $('sWait').textContent = s.jobs.filter((j) => j.stage === 'review').length;

  const max = Math.max(1, ...STAGES.map(([k]) => s.funnel[k] || 0));
  $('funnel').innerHTML = STAGES.map(([k, n]) => `<div class="f-col"><b>${s.funnel[k] || 0}</b><i style="height:${4 + ((s.funnel[k] || 0) / max) * 26}px"></i>${n}</div>`).join('');

  buildOffice(agents);
  if (!sceneRunning) setStatusClasses(agents);

  $('agentList').innerHTML = agents.map((a) => `
    <li data-id="${esc(a.id)}" class="${selected === a.id ? 'sel' : ''}">
      <div class="av">${duckSVG(a, { size: 34 })}</div>
      <div><b>${esc(a.name)} <span class="dot ${esc(a.status)}"></span></b>
        <small class="title">${esc(a.title || a.role)}</small><small>${esc(a.task || STATUS[a.status])}</small></div>
    </li>`).join('');

  $('tasks').innerHTML = s.tasks.map((t) => `<li>${t.status === 'running' ? '▶' : '⏱'} ${esc(t.title)}<small>${esc(t.agent_name || '')}</small></li>`).join('') || '<li>Пока пусто</li>';
  $('jobs').innerHTML = s.jobs.slice(0, 12).map((j) => `<li>${esc(j.title)}<small>${esc(j.company)} · ${esc(j.salary)} · ${esc(j.format)} · ${esc(j.stage)}</small></li>`).join('') || '<li>Пока пусто</li>';
  $('events').innerHTML = s.events.map((e) => `<li>${new Date(e.ts).toLocaleTimeString('ru')} ${esc(e.agent_name || '')}: ${esc(e.message)}</li>`).join('');
  renderDetail();
  enqueueScenes(s.scenes || []);
}

function renderDetail() {
  const a = state && state.agents.find((x) => x.id === selected);
  const box = $('detail');
  if (!a) return box.classList.add('hidden');
  box.classList.remove('hidden');
  box.innerHTML = `<h4>${esc(a.name)}</h4><div class="t">${esc(a.title || a.role)}</div>
    <p>Статус: <b>${STATUS[a.status] || esc(a.status)}</b></p><p>Модель: <b>${esc(a.model)}</b></p><p>Команда: <b>${esc(a.team)}</b></p>
    <p>Задача: <b>${esc(a.task || '—')}</b></p><div class="bar"><i style="width:${Number(a.progress) || 0}%"></i></div>`;
}

async function tick() {
  try {
    state = await fetchState();
    $('conn').className = 'conn on';
    $('conn').textContent = 'онлайн · ' + new Date(state.ts).toLocaleTimeString('ru');
    render(state);
  } catch (e) {
    $('conn').className = 'conn off';
    $('conn').textContent = 'нет связи: ' + e.message;
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
  if (el) { selected = el.dataset.id; if (state) { render(state); } }
});
$('logout').onclick = () => { store.clear(); clearInterval(timer); $('app').classList.add('hidden'); $('login').classList.remove('hidden'); };
$('loginForm').onsubmit = async (e) => {
  e.preventDefault();
  store.set($('apiUrl').value.trim(), $('apiToken').value.trim());
  try { await fetchState(); $('loginErr').textContent = ''; start(); }
  catch (err) { $('loginErr').textContent = err.message === 'Failed to fetch' ? 'API недоступен: проверьте адрес и что ПК включён' : err.message; store.clear(); }
};
setInterval(() => { $('clock').textContent = new Date().toLocaleString('ru'); }, 1000);
$('loginDuck').innerHTML = duckSVG({ color: '#E8A317', look: 'captain' }, { size: 72 });

if (store.get().url && store.get().token) start(); else $('login').classList.remove('hidden');

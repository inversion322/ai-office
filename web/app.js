// AI Office: фронтенд. Опрос API каждые 15 с, анимация сцен на клиенте.
const POLL_MS = 15000;
const STATUS = { working: 'работает', waiting: 'ждёт', idle: 'свободен', error: 'ошибка', offline: 'отключён' };
const STAGES = [['found', 'Найдено'], ['review', 'Review'], ['approved', 'Одобрено'], ['letter', 'Письмо'], ['applied', 'Отправлено'], ['reply', 'Ответ']];

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let state = null, selected = null, timer = null, officeTick = 0;
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
    const g = deskGeom(a.id).box;
    return `<div class="desk ${esc(a.status)}" data-id="${esc(a.id)}" style="left:${g.l}%;top:${g.t}%;width:${g.w}%;height:${g.h}%">
      <div class="plate"><b>${esc(a.name)}</b><span>${esc(a.title || a.role)}</span></div></div>`;
  }).join('');
  agents.forEach((a) => {
    if (actors[a.id]) return;
    const [x, y] = deskGeom(a.id).home;
    const el = document.createElement('div');
    el.className = 'actor'; el.dataset.id = a.id;
    el.innerHTML = duckSVG(a);
    layer.appendChild(el);
    actors[a.id] = { el, home: [x, y], st: a.status };
    place(a.id, x, y, false);
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
    if (ac.st !== a.status) { ac.st = a.status; ac.el.innerHTML = duckSVG(a); }
    const walking = ac.el.classList.contains('walking');
    ac.el.className = `actor ${a.status}${a.status === 'working' && !walking ? ' typing' : ''}${walking ? ' walking' : ''}`;
  });
}

/* ---------- сцены: диалоги и выдача задач ---------- */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function bubbleAt(id, text, label, cls = '') {
  const [x, y] = [parseFloat(actors[id].el.style.left), parseFloat(actors[id].el.style.top)];
  const b = document.createElement('div');
  b.className = 'bubble ' + cls; b.style.left = x + '%'; b.style.top = (y - 24) + '%';
  b.innerHTML = (label ? `<small>${esc(label)}</small>` : '') + esc(text);
  $('bubbles').appendChild(b);
  return b;
}
const px2pct = (x, y) => [x / OW * 100, y / OH * 100];
function curPos(id) { const e = actors[id].el; return [parseFloat(e.style.left), parseFloat(e.style.top)]; }
async function moveTo(id, x, y) {
  const el = actors[id].el, [cx, cy] = curPos(id);
  const dist = Math.hypot((x - cx) / 100 * OW, (y - cy) / 100 * OH);
  const ms = Math.max(450, Math.round(dist / 60 * 1000));
  el.style.transition = `left ${ms}ms linear, top ${ms}ms linear`;
  place(id, x, y);
  await sleep(ms + 60);
  el.style.transition = '';
}
// маршрут между кабинетами идёт через двери
function routeBetween(fromRoom, toRoom) {
  const pts = [];
  if (fromRoom !== toRoom) {
    if (fromRoom && ROOMS[fromRoom]) { pts.push(px2pct(...ROOMS[fromRoom].door.in), px2pct(...ROOMS[fromRoom].door.out)); }
    if (toRoom && ROOMS[toRoom]) { pts.push(px2pct(...ROOMS[toRoom].door.out), px2pct(...ROOMS[toRoom].door.in)); }
  }
  return pts;
}
async function walkPath(id, pts) {
  const el = actors[id].el;
  el.classList.add('walking'); el.classList.remove('typing');
  for (const [x, y] of pts) await moveTo(id, x, y);
  el.classList.remove('walking');
}
function visitSpot(toId) {
  const room = AGENT_ROOM[toId], h = actors[toId].home;
  if (room === 'jobs') return [72 / OW * 100, h[1]];                       // проход между столами отдела
  if (room === 'cap') return [h[0] - 30 / OW * 100, h[1]];
  return [h[0], h[1] + 26 / OH * 100];                                      // у открытых столов встают спереди
}
async function playScene(sc) {
  const A = actors[sc.from_id], B = actors[sc.to_id];
  if (!A || !B) return;
  const nameOf = (id) => (state.agents.find((a) => a.id === id) || {}).name || id;
  const fromRoom = AGENT_ROOM[sc.from_id], toRoom = AGENT_ROOM[sc.to_id];
  const spot = visitSpot(sc.to_id);
  await walkPath(sc.from_id, [...routeBetween(fromRoom, toRoom), spot]);
  A.el.classList.add('visiting');
  const isAssign = sc.kind === 'assign';
  const bub = bubbleAt(sc.from_id, sc.text, isAssign ? `Задача → ${nameOf(sc.to_id)}` : `${nameOf(sc.from_id)} → ${nameOf(sc.to_id)}`, isAssign ? 'assign' : '');
  await sleep(Math.min(sc.ttl || 4500, 5000));
  bub.remove();
  await walkPath(sc.from_id, [...routeBetween(toRoom, fromRoom), A.home]);
  A.el.classList.remove('visiting');
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
  $('funnel').innerHTML = '<div class="kpi-title">KPI · поиск работы</div><div class="kpi-cols">' + STAGES.map(([k, n]) => `<div class="f-col"><b>${s.funnel[k] || 0}</b><i style="height:${3 + ((s.funnel[k] || 0) / max) * 18}px"></i>${n}</div>`).join('') + '</div>';

  buildOffice(agents);
  drawOffice(agents, officeTick);
  if (!sceneRunning) setStatusClasses(agents);

  $('agentList').innerHTML = agents.map((a) => `
    <li data-id="${esc(a.id)}" class="${selected === a.id ? 'sel' : ''}">
      <div class="av">${duckSVG(a, { size: 48 })}</div>
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
    <p>Задача: <b>${esc(a.task || '—')}</b></p><div class="bar"><i style="width:${Number(a.progress) || 0}%"></i></div>
    <button class="btn-primary wide" id="openCfg" data-open="${esc(a.id)}">Промпт и навыки</button>`;
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
$('loginDuck').innerHTML = duckSVG({ color: '#E8A317', look: 'captain' }, { size: 96 });

if (store.get().url && store.get().token) start(); else $('login').classList.remove('hidden');


/* ---------- редактор промпта и навыков ---------- */
let cfgId = null, cfgSkills = new Set();
async function api(path, opts = {}) {
  const { url, token } = store.get();
  const r = await fetch(url + path, { ...opts, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, cache: 'no-store' });
  if (!r.ok) throw new Error('API ' + r.status);
  return r.json();
}
async function openConfig(id) {
  const a = state.agents.find((x) => x.id === id); if (!a) return;
  cfgId = id;
  const c = await api('/api/agent-config?id=' + encodeURIComponent(id));
  $('mAvatar').innerHTML = duckSVG(a, { size: 72 });
  $('mTitle').textContent = a.name; $('mSub').textContent = a.title || a.role;
  $('mPrompt').value = c.prompt ? c.prompt.body : '';
  $('mVer').textContent = c.prompt ? 'Версия ' + c.prompt.version : '';
  $('mMsg').textContent = '';
  $('mHist').innerHTML = c.history.map((h) => `<li><b>v${h.version}</b> · ${new Date(h.ts).toLocaleString('ru')}<small>${esc(h.preview)}…</small></li>`).join('');
  cfgSkills = new Set(c.skills.map((s) => s.id));
  $('mSkills').innerHTML = c.allSkills.map((s) => `<label class="skill"><input type="checkbox" value="${esc(s.id)}" ${cfgSkills.has(s.id) ? 'checked' : ''}>
    <span><b>${esc(s.name)}</b><small>${esc(s.description)}</small></span></label>`).join('');
  $('modal').classList.remove('hidden');
  $('mPrompt').focus();
}
function closeConfig() { $('modal').classList.add('hidden'); cfgId = null; }
document.addEventListener('click', (e) => { const b = e.target.closest('[data-open]'); if (b) openConfig(b.dataset.open).catch((er) => alert(er.message)); });
$('mClose').onclick = closeConfig;
$('modal').addEventListener('click', (e) => { if (e.target === $('modal')) closeConfig(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && cfgId) closeConfig(); });
$('mSave').onclick = async () => {
  try { const r = await api('/api/prompt', { method: 'POST', body: JSON.stringify({ id: cfgId, body: $('mPrompt').value }) });
    $('mMsg').textContent = 'Сохранено, версия ' + r.version; $('mVer').textContent = 'Версия ' + r.version; openConfig(cfgId); }
  catch (e) { $('mMsg').textContent = 'Ошибка: ' + e.message; }
};
$('mSaveSkills').onclick = async () => {
  const list = [...document.querySelectorAll('#mSkills input:checked')].map((i) => i.value);
  try { await api('/api/agent-skills', { method: 'POST', body: JSON.stringify({ id: cfgId, skills: list }) }); $('mMsg').textContent = 'Навыки сохранены'; }
  catch (e) { $('mMsg').textContent = 'Ошибка: ' + e.message; }
};

drawOffice([], 0);
setInterval(() => { officeTick++; drawOffice(state ? state.agents : [], officeTick); }, 500);

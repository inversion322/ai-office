// AI Office: фронтенд. Опрос API каждые 15 с, анимация сцен на клиенте.
const POLL_MS = 5000;
const STATUS = { working: 'работает', waiting: 'ждёт', idle: 'свободен', error: 'ошибка', offline: 'отключён' };
const STAGES = [['found', 'Найдено'], ['review', 'Review'], ['approved', 'Одобрено'], ['letter', 'Письмо'], ['applied', 'Отправлено'], ['reply', 'Ответ']];
// Конвейер роликов (офис Nick G SMM)
const VSTAGES = [['idea', 'Идеи'], ['scored', 'Оценены'], ['script', 'Сценарий'], ['checked', 'Проверен'], ['editing', 'Монтаж'], ['produced', 'Видео'], ['approved', 'Принято']];
const VSTAGE_NAME = Object.fromEntries(VSTAGES.concat([['published', 'Опубликован'], ['rejected', 'Отклонён']]));
const NEED_NICK = ['scored', 'checked', 'produced'];            // стадии, где ход за Ником
let officeId = localStorage.getItem('office_id') || 'jobs';

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
  const r = await fetch(url + '/api/state?office=' + encodeURIComponent(officeId), { headers: { Authorization: 'Bearer ' + token }, cache: 'no-store' });
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
    updateBadge(a, walking);
  });
}
/* постоянная подпись над сотрудником: над чем работает прямо сейчас (виден ход работы, а не только жесты утки) */
const VFMT = { A: 'Лента', B: 'Один объект', C: 'Комикс' };      // форматы вариантов одной темы (метка у ролика в списке)
/* шкала прогресса: процент и «ещё ~N мин» внутри полоски (решение Ника 2026-10-21); цифры считает сервер, поле pb */
function pbarHTML(a) {
  const pb = a && a.status === 'working' && a.pb; if (!pb) return '';
  const tip = pb.basis === 'history' ? `Оценка по ${pb.n} прошлым запускам этой работы` : pb.basis === 'default' ? 'Первая оценка: истории запусков этой работы ещё нет, цифра уточнится' : 'Оценки пока нет';
  return `<div class="pbar${pb.overrun ? ' over' : ''}" title="${esc(tip)}"><i style="width:${Number(pb.pct) || 0}%"></i><span>${esc(pb.label)}</span></div>`;
}
/* ширина плашки «работает»: не шире шага между столами в этом ряду (в студии SMM столов пять в ряд), в пределах 100–150 px */
function badgeMaxW(id, layer) {
  const me = (OFFICE_DESKS || {})[id]; if (!me) return 150;
  const gaps = Object.keys(OFFICE_DESKS).filter((k) => k !== id && Math.abs(OFFICE_DESKS[k][1] - me[1]) < 6).map((k) => Math.abs(OFFICE_DESKS[k][0] - me[0])).filter((d) => d > 0);
  const pitch = gaps.length ? Math.min(...gaps) : 100;
  return Math.max(100, Math.min(150, Math.round(layer.clientWidth * pitch / 100 - 4)));
}
function updateBadge(a, walking) {
  const layer = $('bubbles'); if (!layer) return;
  let b = layer.querySelector(`.work-badge[data-id="${a.id}"]`);
  const show = a.status === 'working' && a.task && !walking;
  if (!show) { if (b) b.remove(); return; }
  const [x, y] = [parseFloat(actors[a.id].el.style.left), parseFloat(actors[a.id].el.style.top)];
  if (!b) { b = document.createElement('div'); b.className = 'work-badge'; b.dataset.id = a.id; layer.appendChild(b); }
  const pr = Math.max(0, Math.min(100, Number(a.progress) || 0));
  const short = String(a.task).replace(/\s*\(дело[^)]*\)/i, '').replace(/\s*⏱.*$/, '');
  const mins = (/⏱\s*([^]*)$/.exec(a.task) || [])[1];
  b.style.left = (x + 1) + '%'; b.style.top = (y + 2.5) + '%'; b.title = a.task; b.classList.add('side');
  const mw = badgeMaxW(a.id, layer); b.style.maxWidth = mw + 'px'; b.classList.toggle('narrow', mw < 140);   // плашки соседних столов в одном ряду не налезают друг на друга; в узкой плашке задачи нет (она в подсказке и в панели «Сейчас в работе»)
  b.innerHTML = `<small>⚙ работает${mins ? ' · ' + esc(mins) : ''}</small>${mw < 140 ? '' : esc(short.length > 46 ? short.slice(0, 44) + '…' : short)}${pbarHTML(a) || (pr ? `<i style="width:${pr}%"></i>` : '')}`;
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
    const A = fromRoom && ROOMS[fromRoom], B = toRoom && ROOMS[toRoom];
    if (A) { pts.push(px2pct(...A.door.in), px2pct(...A.door.out)); }
    // комнат три (офис SMM): между ними двери выходят в коридор под комнатами, иначе утка прошла бы сквозь стекло соседней
    if (A && B && Object.keys(ROOMS).length > 2) pts.push(px2pct(A.door.out[0], CORR), px2pct(B.door.out[0], CORR));
    if (B) { pts.push(px2pct(...B.door.out), px2pct(...B.door.in)); }
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
  if (VISIT_BESIDE && room && room !== 'cap') return [h[0] - 26 / OW * 100, h[1]];      // комнаты с рядом столов: гость встаёт слева от стола того, к кому пришёл
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

/* ---------- переключатель офисов ---------- */
function renderTabs(s) {
  const box = $('officeTabs'); if (!box || !s.offices) return;
  box.innerHTML = s.offices.map((o) => `<button type="button" class="tab ${o.id === (s.office || officeId) ? 'on' : ''}" data-office="${esc(o.id)}">${esc(o.name)}</button>`).join('');
}
function switchOffice(id) {
  if (id === officeId) return;
  officeId = id; localStorage.setItem('office_id', id);
  Object.keys(actors).forEach((k) => delete actors[k]);
  $('actors').innerHTML = ''; $('desks').innerHTML = ''; $('bubbles').innerHTML = '';
  playedScenes.clear(); sceneQueue = []; selected = null; state = null;
  applyOffice(id); drawOffice([], officeTick);
  if (typeof chatOnOfficeSwitch === 'function') chatOnOfficeSwitch();
  tick();
}
document.addEventListener('click', (e) => { const t = e.target.closest('[data-office]'); if (t) switchOffice(t.dataset.office); });

/* ---------- отрисовка данных ---------- */
const OFFICE_TEAM_ORDER = ['core', 'studio', 'tg', 'yt', 'video'];
const OFFICE_TEAM_TITLES = { core: 'Руководство', studio: 'Управление контентом', tg: 'Telegram-канал', yt: 'YouTube-канал', video: 'Видео-студия' };
function render(s) {
  const agents = s.agents;
  $('sTotal').textContent = agents.length;
  $('sActive').textContent = agents.filter((a) => a.status === 'working').length;
  const isSmm = (s.office || officeId) === 'smm';
  // SMM: «ждут вас» = открытые карточки (то же число, что значок в мини-аппе и в чате). Считать по стадии ролика нельзя: убранная карточка оставляла ролик «ждущим» без кнопок.
  $('sWait').textContent = isSmm ? (Number(s.pending) || 0) : s.jobs.filter((j) => j.stage === 'review').length;
  renderTabs(s);
  if (typeof chatOnState === 'function') chatOnState(s);
  const L = applyOffice(s.office || officeId);
  $('lblDept').textContent = L.dept; $('lblCap').textContent = L.cap;
  $('lblDept').style.left = ((ROOMS.jobs.x + 5.5) / OW * 100) + '%'; $('lblDept').style.top = ((ROOMS.jobs.y + 2) / OH * 100) + '%';
  $('lblCap').style.left = ((ROOMS.cap.x + 4.7) / OW * 100) + '%'; $('lblCap').style.top = ((ROOMS.cap.y + 4.7) / OH * 100) + '%';
  const l2 = $('lblDept2'); l2.classList.toggle('hidden', !ROOMS.right);
  if (ROOMS.right) { l2.textContent = L.dept2 || ''; l2.style.left = ((ROOMS.right.x + 5.5) / OW * 100) + '%'; l2.style.top = ((ROOMS.right.y + 2) / OH * 100) + '%'; }
  $('listTitle').textContent = isSmm ? 'Ролики' : 'Вакансии';

  const ST = isSmm ? VSTAGES : STAGES, FN = isSmm ? (s.vfunnel || {}) : s.funnel;
  const max = Math.max(1, ...ST.map(([k]) => FN[k] || 0));
  $('funnel').innerHTML = `<div class="kpi-title">KPI · ${isSmm ? 'ролики' : 'поиск работы'}</div><div class="kpi-cols">` + ST.map(([k, n]) => `<div class="f-col"><b>${FN[k] || 0}</b><i style="height:${3 + ((FN[k] || 0) / max) * 18}px"></i>${n}</div>`).join('') + '</div>';

  buildOffice(agents);
  drawOffice(agents, officeTick);
  if (!sceneRunning) setStatusClasses(agents);

  const agentLi = (a) => `
    <li data-id="${esc(a.id)}" class="${selected === a.id ? 'sel' : ''}">
      <div class="av">${duckSVG(a, { size: 48 })}</div>
      <div><b>${esc(a.name)} <span class="dot ${esc(a.status)}"></span></b>
        <small class="title">${esc(a.title || a.role)}</small><small>${esc(a.task || STATUS[a.status])}</small></div>
    </li>`;
  // SMM: сотрудники сгруппированы по виду деятельности и площадке (Telegram, YouTube, видео, управление), у Ника это отдельные блоки
  $('agentList').innerHTML = isSmm && agents.some((a) => OFFICE_TEAM_TITLES[a.team])
    ? [...OFFICE_TEAM_ORDER, null].map((t) => {
        const items = agents.filter((a) => (t ? a.team === t : !OFFICE_TEAM_TITLES[a.team]));
        return items.length ? `<li class="grp">${esc(t ? OFFICE_TEAM_TITLES[t] : 'Прочие')}</li>` + items.map(agentLi).join('') : '';
      }).join('')
    : agents.map(agentLi).join('');

  $('tasks').innerHTML = s.tasks.map((t) => `<li>${t.status === 'running' ? '▶' : '⏱'} ${esc(t.title)}<small>${esc(t.agent_name || '')}</small></li>`).join('') || '<li>Пока пусто</li>';
  $('jobs').innerHTML = (isSmm
    ? (s.videos || []).slice(0, 12).map((v) => `<li>${NEED_NICK.includes(v.stage) ? '👉 ' : ''}${esc(v.title)}${v.variant ? ` <b class="vtag" title="Вариант одной темы: свой формат, хук и концовка">${esc(v.variant.letter)} · ${esc(VFMT[v.variant.letter] || '')}</b>` : ''}<small>${v.rubric === 'tips' ? 'Советы' : 'Миф'} · ${esc(VSTAGE_NAME[v.stage] || v.stage)} · балл ${v.score ?? '—'}</small></li>`)
    : s.jobs.slice(0, 12).map((j) => `<li>${esc(j.title)}<small>${esc(j.company)} · ${esc(j.salary)} · ${esc(j.format)} · ${esc(j.stage)}</small></li>`)).join('') || '<li>Пока пусто</li>';
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
    <p>Статус: <b>${STATUS[a.status] || esc(a.status)}</b></p><p>Модель: <b>${esc(a.model)}</b></p><p>Команда: <b>${esc(OFFICE_TEAM_TITLES[a.team] || a.team)}</b></p>
    <p>Задача: <b>${esc(a.task || '—')}</b></p>${pbarHTML(a) || `<div class="bar"><i style="width:${Number(a.progress) || 0}%"></i></div>`}
    <button class="btn-primary wide" id="openCfg" data-open="${esc(a.id)}">Промпт и навыки</button>${a.status === 'waiting' || a.status === 'error' ? `<button class="btn-ghost wide clear-wait" data-clearwait="${esc(a.id)}">${a.status === 'waiting' ? 'Снять ожидание' : 'Сбросить ошибку'}</button>` : ''}`;
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
// «Зависший» статус (ждёт / ошибка) можно сбросить вручную; работающего сотрудника сервер не даёт сбросить.
document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-clearwait]'); if (!b || b.disabled) return;
  b.disabled = true;
  try { const r = await api('/api/chat/clear-status', { method: 'POST', body: JSON.stringify({ agent: b.dataset.clearwait }) }); if (!r.ok) alert(r.error || 'Не вышло'); await tick(); }
  catch (er) { alert('Ошибка: ' + er.message); }
  b.disabled = false;
});
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

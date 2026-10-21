/* Telegram Mini App офиса Nick G SMM. Вход по подписи Telegram (initData), адрес API берётся из ссылки (?api=…, её обновляет бот при смене туннеля).
   Логика без DOM лежит в mini_core.js (с тестами). Здесь только отрисовка и опрос. */
(function () {
  'use strict';
  const C = window.MiniCore, tg = window.Telegram && window.Telegram.WebApp;
  const $ = (id) => document.getElementById(id);
  const S = { api: '', token: '', state: null, chat: null, view: 'now', who: null, timer: null, sending: false, lastSig: '', fails: 0 };
  const POLL = { fast: 1500, normal: 4000, slow: 15000 };

  /* ---------- ворота (экран до входа и при сбоях) ---------- */
  function gate(kind, extra) {
    const g = C.gateFor(kind, extra);
    $('gate').classList.remove('hidden'); $('app').classList.add('hidden');
    $('gateTitle').textContent = g.title; $('gateText').textContent = g.text;
    $('gateRetry').classList.toggle('hidden', !g.retry);
    $('gateDuck').innerHTML = duckSVG({ color: '#E8A317', look: 'captain', status: kind === 'connecting' ? 'working' : 'idle' }, { size: 88 });
  }
  $('gateRetry').onclick = () => boot();

  async function raw(path, opts = {}) {
    const ac = new AbortController(); const t = setTimeout(() => ac.abort(), opts.timeout || 12000);      // действия (ответ, отправка) терпят дольше, опрос задаёт свой короткий
    try {
      return await fetch(S.api + path, { ...opts, signal: ac.signal, cache: 'no-store', headers: { 'Content-Type': 'application/json', ...(S.token ? { Authorization: 'Bearer ' + S.token } : {}) } });
    } finally { clearTimeout(t); }
  }

  async function login() {
    let r;
    try { r = await raw('/api/tg-login', { method: 'POST', body: JSON.stringify({ initData: tg.initData }) }); } catch { return { err: 'offline' }; }
    if (r.status === 403) return { err: 'forbidden' };
    if (!r.ok) return { err: r.status === 429 ? 'expired' : 'expired' };
    const j = await r.json(); S.token = j.token; return { ok: true };
  }

  async function boot() {
    clearTimeout(S.timer);
    if (!tg || !tg.initData) return gate('not-telegram');
    try { tg.ready(); tg.expand(); if (tg.disableVerticalSwipes) tg.disableVerticalSwipes(); } catch {}
    const a = C.parseApi(location.search);
    if (!a.ok) return gate(a.reason === 'нет адреса' ? 'no-api' : 'bad-api', a.reason);
    S.api = a.api; S.token = '';
    gate('connecting'); $('gateText').textContent = 'Подключаюсь к офису…';
    const l = await login(); if (!l.ok) return gate(l.err);
    $('gate').classList.add('hidden'); $('app').classList.remove('hidden');
    tg.setHeaderColor && tg.setHeaderColor('#F5F3EE'); tg.setBackgroundColor && tg.setBackgroundColor('#F5F3EE');
    show(S.view); loop();
  }

  /* ---------- опрос ---------- */
  async function pull() {
    const [a, b] = await Promise.all([raw('/api/state?office=smm', { timeout: 6000 }), raw('/api/chat?office=smm', { timeout: 6000 })]);
    if (a.status === 401 || b.status === 401) { const l = await login(); if (!l.ok) throw Object.assign(new Error('auth'), { gate: l.err }); return pull(); }
    if (!a.ok || !b.ok) throw new Error('api ' + a.status + '/' + b.status);
    S.state = await a.json(); S.chat = await b.json(); S.fails = 0; S.okAt = Date.now();
    $('conn').className = 'conn on'; $('conn').title = 'онлайн'; $('stale').classList.add('hidden'); render();
  }
  function nextDelay() {
    if (document.hidden) return POLL.slow;
    if (S.chat && S.chat.typing && S.chat.typing.length) return POLL.fast;
    return S.view === 'chat' ? POLL.fast * 2 : POLL.normal;
  }
  async function loop() {
    clearTimeout(S.timer);
    try { await pull(); }
    catch (e) {
      if (e.gate) return gate(e.gate);
      S.fails++; $('conn').className = 'conn off'; $('conn').title = 'нет связи';
      // Данные на экране уже устарели: говорим об этом сразу и заметно, а не только красной точкой (до экрана сбоя может пройти около минуты).
      if (S.okAt) { $('staleAt').textContent = new Date(S.okAt).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit', second: '2-digit' }); $('stale').classList.remove('hidden'); }
      if (S.fails >= 4) { clearTimeout(S.timer); return gate('offline'); }      // 4 неудачи подряд (около 40 с): скорее всего туннель сменил адрес
    }
    S.timer = setTimeout(loop, nextDelay());
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden && S.api && S.token) loop(); });

  /* ---------- вкладки ---------- */
  function show(v) {
    S.view = v;
    ['now', 'chat', 'feed'].forEach((x) => $('v-' + x).classList.toggle('hidden', x !== v));
    document.querySelectorAll('.tabbar button').forEach((b) => b.classList.toggle('on', b.dataset.v === v));
    $('composer').classList.toggle('hidden', v !== 'chat');
    if (v === 'chat') scrollLog(true);
    document.body.classList.toggle('chatting', v === 'chat');
    // Из чата нижняя панель скрыта (место нужно клавиатуре), поэтому выход обязателен: штатная «Назад» Telegram и запасная «‹» в шапке.
    $('back').classList.toggle('hidden', v !== 'chat');
    try { if (tg.BackButton) { if (v === 'chat') tg.BackButton.show(); else tg.BackButton.hide(); } } catch {}
    $('brandText').textContent = v === 'chat' ? (S.who ? agentName(S.who) : 'Чат') : 'Nick G SMM';
    if (S.state) render();
  }
  const goBack = () => { if (S.view === 'chat') { show('now'); tg.HapticFeedback && tg.HapticFeedback.selectionChanged(); } };
  $('back').addEventListener('click', goBack);
  try { if (tg.BackButton) tg.BackButton.onClick(goBack); } catch {}
  document.querySelector('.tabbar').addEventListener('click', (e) => { const b = e.target.closest('button[data-v]'); if (b) { show(b.dataset.v); tg.HapticFeedback && tg.HapticFeedback.selectionChanged(); } });

  /* ---------- отрисовка ---------- */
  const agentName = (id) => { const a = S.state && S.state.agents.find((x) => x.id === id); return a ? a.name.split(' ')[0] : id; };
  function render() {
    renderBadge();
    if (S.view === 'now') renderNow(); else if (S.view === 'chat') renderChat(); else renderFeed();
  }
  function renderBadge() {
    const n = C.pendingCards(S.chat && S.chat.messages).length;
    $('badge').textContent = n; $('badge').classList.toggle('hidden', !n);
  }
  // Не перерисовываем то, что не изменилось: иначе прыгает прокрутка и пропадают нажатия.
  function put(el, html, key) { const sig = key + '|' + html.length + '|' + html.slice(0, 64) + html.slice(-64); if (el.dataset.sig === sig) return false; el.dataset.sig = sig; el.innerHTML = html; return true; }

  function renderNow() {
    const cards = C.pendingCards(S.chat.messages);
    const pin = $('pinned');
    // Ждущее ответа не должно заслонять главное (чем заняты сотрудники): одна свежая карточка видна сразу, остальные раскрываются по нажатию.
    const rest = cards.slice(1);
    put(pin, cards.length ? `<h2>Ждут вашего ответа · ${cards.length}</h2>` + cardHtml(cards[0]) +
      (rest.length ? (S.pinOpen ? rest.map(cardHtml).join('') : '') + `<button class="more-cards" data-pinmore>${S.pinOpen ? 'Свернуть' : 'Ещё ' + rest.length + ' · показать'}</button>` : '') : '', 'pin' + cards.map((c) => c.id).join(',') + S.pinOpen);
    pin.classList.toggle('hidden', !cards.length);
    const prio = S.state.priority && S.state.priority.active ? `<div class="prio">⚡ Приоритет: ${C.esc(S.state.priority.label || 'правки ролика')}</div>` : '';
    put($('crew'), prio + S.state.agents.map(agentHtml).join(''), 'crew');
    $('crew').querySelectorAll('[data-duck]').forEach((el) => { if (!el.firstChild) { const a = S.state.agents.find((x) => x.id === el.dataset.duck); el.innerHTML = duckSVG(a, { size: 56 }); } });
    const v = (S.state.videos || []).slice(0, 4);
    put($('clips'), v.length ? '<h2>Ролики</h2>' + v.map((x) => `<div class="clip"><b>${C.esc(x.title || 'Ролик ' + x.id)}${C.variantLabel(x) ? ` <i class="vtag">${C.esc(C.variantLabel(x))}</i>` : ''}</b><span>${C.esc(stageName(x.stage))}</span></div>`).join('') : '', 'clips');
  }
  function stageName(s) { return ({ idea: 'идея', scored: 'оценена', script: 'сценарий', checked: 'факты проверены', produced: 'смонтирован', accepted: 'принят', published: 'опубликован' })[s] || s || ''; }
  function agentHtml(a) {
    const busy = a.status === 'working';
    const prog = busy ? (C.progressBar(a) || (Number(a.progress) ? `<div class="bar"><i style="width:${Math.min(100, Number(a.progress))}%"></i></div>` : '')) : '';
    return `<article class="agent ${C.esc(a.status)}" data-open="${C.esc(a.id)}"><div class="duck" data-duck="${C.esc(a.id)}"></div>
      <div class="agent-body"><div class="agent-top"><b>${C.esc(a.name.split(' ')[0])}</b><span class="st ${C.esc(a.status)}">${C.esc(C.statusText(a.status))}</span></div>
      <div class="role">${C.esc(a.title || a.role)}</div><div class="task">${C.esc(a.task || '—')}</div>${prog}${C.clearLabel(a.status) ? `<button class="clear" data-clear="${C.esc(a.id)}">${C.clearLabel(a.status)}</button>` : ''}</div></article>`;
  }
  document.addEventListener('click', (e) => { if (e.target.closest('[data-clear]')) return; const a = e.target.closest('.agent[data-open]'); if (a) { S.who = a.dataset.open; show('chat'); $('msg').focus(); } });

  function cardHtml(m) {
    const btns = C.splitButtons(m.buttons).main.map((b) => `<button class="btn" data-ans="${C.esc(b.d)}" data-id="${m.id}">${C.esc(b.t)}</button>`).join('');
    const sq = C.squash(m.text); const open = !!m._open;
    return `<div class="card" data-card="${m.id}"><div class="card-from">${C.esc(agentName(m.sender))}</div><div class="card-text">${C.esc(open ? m.text : sq.text + (sq.cut ? ' …' : ''))}</div>${sq.cut ? `<button class="more" data-more="${m.id}">${open ? 'Свернуть' : 'Подробнее'}</button>` : ''}<div class="card-btns">${btns}</div><button class="dismiss" data-ans="dismiss:0" data-id="${m.id}">✖ Убрать</button></div>`;
  }

  function renderChat() {
    const ags = S.state.agents;
    put($('who'), `<button data-w="" class="${S.who ? '' : 'on'}">Всем</button>` + ags.map((a) => `<button data-w="${C.esc(a.id)}" class="${S.who === a.id ? 'on' : ''}">${C.esc(a.name.split(' ')[0])}</button>`).join(''), 'who' + S.who);
    const msgs = C.threadFilter(S.chat.messages, S.who);
    const stick = nearBottom();
    const html = msgs.map(msgHtml).join('') || '<div class="empty">Пока пусто. Напишите сотруднику, например: «Ксения, сделай сценарий короче».</div>';
    if (put($('log'), html, 'log' + S.who)) scrollLog(stick);
    const ty = (S.chat.typing || []).map(agentName);
    $('typing').textContent = ty.length ? ty.join(', ') + ' печатает…' : '';
  }
  function msgHtml(m) {
    const mine = C.isMine(m);
    const who = mine ? '' : `<div class="from">${C.esc(agentName(m.sender))}</div>`;
    const isOpen = m.kind === 'action' && m.status === 'open';
    const action = m.kind === 'action' ? `<div class="tag ${isOpen ? 'open' : ''}">${isOpen ? 'ждёт вашего ответа' : m.status === 'dismissed' ? 'убрано' : 'отвечено'}</div>` : '';
    // Кнопки стоят прямо под вопросом: раньше в чате была только подпись «ждёт вашего ответа», а кнопки жили на другом экране, и Ник печатал «да» вместо нажатия.
    const sp = isOpen ? C.splitButtons(m.buttons) : null;
    const btns = isOpen ? `<div class="card-btns">${sp.main.map((b) => `<button class="btn" data-ans="${C.esc(b.d)}" data-id="${m.id}">${C.esc(b.t)}</button>`).join('')}</div>${sp.dismiss ? `<button class="dismiss" data-ans="dismiss:0" data-id="${m.id}">✖ Убрать</button>` : ''}` : '';
    return `<div class="m ${mine ? 'me' : 'them'}"${isOpen ? ` data-card="${m.id}"` : ''}>${who}<div class="bubble">${C.esc(m.text)}</div>${action}${btns}<time>${C.esc(C.ago(m.ts, Date.now()))}</time></div>`;
  }
  const nearBottom = () => { const l = $('log'); return l.scrollHeight - l.scrollTop - l.clientHeight < 80; };
  const scrollLog = (force) => { if (force) requestAnimationFrame(() => { $('log').scrollTop = $('log').scrollHeight; }); };
  $('who').addEventListener('click', (e) => { const b = e.target.closest('button[data-w]'); if (b) { S.who = b.dataset.w || null; $('brandText').textContent = S.who ? agentName(S.who) : 'Чат'; renderChat(); scrollLog(true); } });

  function renderFeed() {
    const ev = (S.state.events || []).slice(0, 40);
    put($('feed'), ev.map((e) => `<li class="${C.esc(e.level || '')}"><time>${C.esc(C.ago(e.ts, Date.now()))}</time><b>${C.esc((e.agent_name || '').split(' ')[0])}</b> ${C.esc(e.message)}</li>`).join('') || '<li class="empty">Событий пока нет</li>', 'feed');
  }

  /* ---------- нижний лист для текста правок ---------- */
  function askText(mode) {
    return new Promise((resolve) => {
      const sh = $('sheet'), ta = $('sheetText');
      $('sheetTitle').textContent = mode.title; sh.querySelector('.sheet-sub').textContent = mode.sub; $('sheetOk').textContent = mode.cta;
      ta.value = ''; sh.classList.remove('hidden'); setTimeout(() => ta.focus(), 50);
      const done = (v) => { sh.classList.add('hidden'); $('sheetOk').onclick = $('sheetCancel').onclick = null; sh.onclick = null; resolve(v); };
      $('sheetOk').onclick = () => { const v = ta.value.trim(); if (v || !mode.required) done(v); else ta.focus(); };   // '' = без пожелания (если можно); null = отмена
      $('sheetCancel').onclick = () => done(null);
      sh.onclick = (e) => { if (e.target === sh) done(null); };
    });
  }

  /* ---------- действия ---------- */
  document.addEventListener('click', async (e) => {
    if (e.target.closest('[data-pinmore]')) { S.pinOpen = !S.pinOpen; $('pinned').dataset.sig = ''; renderNow(); return; }
    const more = e.target.closest('[data-more]');
    if (more) { const m = S.chat.messages.find((x) => x.id === Number(more.dataset.more)); if (m) { m._open = !m._open; $('pinned').dataset.sig = ''; renderNow(); } return; }
    const clr = e.target.closest('[data-clear]');
    if (clr && !clr.disabled) {
      clr.disabled = true;
      try { const r = await raw('/api/chat/clear-status', { method: 'POST', body: JSON.stringify({ agent: clr.dataset.clear }) }); const j = await r.json(); if (!j.ok) throw new Error(j.error || 'не вышло'); tg.HapticFeedback && tg.HapticFeedback.notificationOccurred('success'); $('crew').dataset.sig = ''; await pull(); }
      catch (er) { clr.disabled = false; tg.HapticFeedback && tg.HapticFeedback.notificationOccurred('error'); tg.showAlert ? tg.showAlert(String(er.message || er)) : alert(String(er.message || er)); }
      return;
    }
    const b = e.target.closest('[data-ans]'); if (!b || b.disabled) return;
    const id = Number(b.dataset.id), choice = b.dataset.ans;
    if (C.isDismiss(choice)) {         // убранное не вернуть, поэтому переспрашиваем (в Telegram есть штатное окно подтверждения)
      const ok = await new Promise((res) => { if (tg.showConfirm) tg.showConfirm('Убрать карточку? Действие не выполнится, вернуть её будет нельзя.', res); else res(window.confirm('Убрать карточку без действия?')); });
      if (!ok) return;
    }
    const mode = C.commentMode(choice);                          // в Telegram нет окна с вводом текста, поэтому свой нижний лист
    let comment;
    if (mode.ask) { comment = await askText(mode); if (comment === null) return; comment = comment || undefined; }
    document.querySelectorAll(`[data-card="${id}"] button`).forEach((x) => { x.disabled = true; });
    try {
      const r = await raw('/api/chat/answer', { method: 'POST', body: JSON.stringify({ id, choice, comment, via: 'dashboard' }) });
      if (!r.ok) throw new Error(String(r.status));
      tg.HapticFeedback && tg.HapticFeedback.notificationOccurred('success'); $('pinned').dataset.sig = ''; await pull();
    } catch { document.querySelectorAll(`[data-card="${id}"] button`).forEach((x) => { x.disabled = false; }); tg.HapticFeedback && tg.HapticFeedback.notificationOccurred('error'); tg.showAlert ? tg.showAlert('Не получилось отправить. Нажмите ещё раз.') : alert('Не получилось отправить.'); }
  });

  $('composer').addEventListener('submit', async (e) => {
    e.preventDefault(); if (S.sending) return;
    const text = $('msg').value.trim(); if (!text) return;
    S.sending = true; $('send').disabled = true;
    try {
      const r = await raw('/api/chat/send', { method: 'POST', body: JSON.stringify({ text, to: C.targetFor(S.who, S.state.agents), office: 'smm' }) });
      if (!r.ok) throw new Error(String(r.status));
      $('msg').value = ''; fit(); tg.HapticFeedback && tg.HapticFeedback.impactOccurred('light'); await pull(); scrollLog(true);
    } catch { tg.showAlert ? tg.showAlert('Сообщение не ушло, текст сохранён. Проверьте связь и нажмите ещё раз.') : alert('Сообщение не ушло.'); }   // текст остаётся в поле, ничего не теряем
    finally { S.sending = false; $('send').disabled = false; }
  });
  const fit = () => { const t = $('msg'); t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight, 120) + 'px'; };
  $('msg').addEventListener('input', fit);

  // Клавиатура: высоту окна берём из visualViewport, чтобы поле ввода не уезжало под неё.
  function viewport() { const h = (window.visualViewport && window.visualViewport.height) || window.innerHeight; document.documentElement.style.setProperty('--vh', h + 'px'); }
  if (window.visualViewport) { window.visualViewport.addEventListener('resize', () => { viewport(); scrollLog(true); }); }
  viewport(); window.addEventListener('resize', viewport);

  boot();
})();

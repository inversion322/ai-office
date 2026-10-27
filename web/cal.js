/* Календарь студии «неделя × каналы» (веб-офис). Данные: GET /api/studio/calendar. Календарь ничего не публикует: показывает ход дня и просит собрать план. */
(function () {
  'use strict';
  const C = window.CalCore, q = (id) => document.getElementById(id);
  let cal = null, start = '', busy = false, timer = null;
  const isOpen = () => !q('cal').classList.contains('hidden');
  const LEGEND = [['you', 'ждёт вас'], ['work', 'в работе'], ['ok', 'в расписании'], ['done', 'вышло'], ['wait', 'впереди'], ['bad', 'сбой'], ['off', 'снято']];

  async function load() {
    if (busy) return; busy = true;
    try { cal = await api('/api/studio/calendar' + (start ? '?start=' + start : '')); }
    catch { if (isOpen() && !cal) q('calBody').innerHTML = '<div class="cal-empty">Нет связи с офисом</div>'; busy = false; return; }
    busy = false; badge(); if (isOpen()) render();
  }
  function badge() { const n = cal ? C.needYou(cal) : 0, b = q('calBadge'); b.textContent = n; b.classList.toggle('hidden', !n); }
  function slotHtml(s) {
    const link = s.url ? ` <a href="${C.esc(s.url)}" target="_blank" rel="noopener">открыть</a>` : '', src = s.source ? ` · ${C.esc(s.source)}` : '';
    return `<div class="cal-slot ${s.cls}" data-slot tabindex="0" title="${C.esc(s.title)}"><span class="t">${C.esc(s.time)}</span><span class="i">${s.icon}</span><span class="n">${C.esc(s.short)}</span><span class="s">${C.esc(s.label)}${src}${link}</span></div>`;
  }
  function render() {
    if (!cal) return;
    q('calWeek').textContent = C.weekLabel(cal.start, cal.end);
    q('calAuto').checked = !!cal.autoPlan; q('calAutoAt').textContent = cal.planAt;
    let h = '<div class="cal-grid"><div class="cal-corner"></div>' + cal.days.map((d) => `<div class="cal-dh ${d === cal.today ? 'today' : ''}">${C.dayHead(d)}</div>`).join('');
    if (!cal.channels.length) h += '<div class="cal-empty" style="grid-column:1/-1">Каналов в студии пока нет</div>';
    for (const ch of cal.channels) {
      h += `<div class="cal-ch"><b>${C.esc(ch.name)}</b><span>${ch.tg ? '@' + C.esc(ch.tg) : ''}</span></div>`;
      for (const d of cal.days) {
        const cell = cal.cells.find((c) => c.channel === ch.key && c.date === d), v = C.cellView(cell, cal.today);
        h += `<div class="cal-cell ${v.today ? 'today' : ''} ${v.past ? 'past' : ''}">`;
        if (v.head) h += `<div class="cal-plan-head">${C.esc(v.head)}</div>`;
        h += v.slots.map(slotHtml).join('');
        if (v.empty) h += `<div class="cal-none">${C.esc(v.hint)}</div>`;
        if (cell.plan && cell.plan.status === 'proposed') h += '<button type="button" class="cal-open">Выбрать в чате</button>';
        else if (v.canPlan) h += `<button type="button" class="cal-plan" data-ch="${C.esc(ch.key)}" data-date="${d}">＋ Собрать план</button>`;
        h += '</div>';
      }
    }
    q('calBody').innerHTML = h + '</div>';
    q('calFoot').innerHTML = LEGEND.map(([t, l]) => `<span class="cal-leg ${C.toneClass(t)}">${l}</span>`).join('') + '<span class="cal-hint">Нажмите на строку, чтобы раскрыть название. Ничего не выходит без вашего «да» на карточке.</span>';
  }
  function open() { q('cal').classList.remove('hidden'); start = ''; load().then(render); clearInterval(timer); timer = setInterval(() => { if (isOpen()) load(); }, 12000); }
  function close() { q('cal').classList.add('hidden'); clearInterval(timer); }
  q('calBtn').onclick = open; q('calClose').onclick = close;
  q('cal').addEventListener('click', (e) => { if (e.target === q('cal')) close(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && isOpen()) close(); });
  q('calPrev').onclick = () => { if (cal) { start = cal.prev; load(); } };
  q('calNext').onclick = () => { if (cal) { start = cal.next; load(); } };
  q('calToday').onclick = () => { start = ''; load(); };
  q('calAuto').onchange = async (e) => { try { await api('/api/studio/settings', { method: 'POST', body: JSON.stringify({ autoPlan: e.target.checked }) }); } catch { e.target.checked = !e.target.checked; } load(); };
  q('calBody').addEventListener('click', async (e) => {
    const sl = e.target.closest('[data-slot]'); if (sl && !e.target.closest('a')) { sl.classList.toggle('open'); return; }
    if (e.target.closest('.cal-open')) { close(); if (typeof focusChat === 'function') focusChat(); return; }
    const b = e.target.closest('.cal-plan'); if (!b) return;
    b.disabled = true; b.textContent = 'Запускаю…';
    try { await api('/api/studio/plan', { method: 'POST', body: JSON.stringify({ channel: b.dataset.ch, date: b.dataset.date }) }); b.textContent = 'План собирается, карточка придёт в чат'; }
    catch { b.disabled = false; b.textContent = '＋ Собрать план (не вышло, ещё раз)'; }
  });
  // кнопка календаря видна только в офисе SMM; число ждущих решения обновляется раз в полминуты
  const sync = () => { const smm = typeof officeId !== 'undefined' && officeId === 'smm'; q('calBtn').classList.toggle('hidden', !smm); if (!smm && isOpen()) close(); };
  setInterval(sync, 1500); sync();
  setInterval(() => { if (typeof officeId !== 'undefined' && officeId === 'smm' && !isOpen()) { const keep = start; start = ''; load().finally(() => { start = keep; }); } }, 30000);
  setTimeout(() => { if (typeof officeId !== 'undefined' && officeId === 'smm') load(); }, 4000);
})();

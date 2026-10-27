/* Календарь студии «неделя × каналы»: чистая логика отрисовки без DOM (общая для веб-офиса и Mini App). Тесты: test/cal_core.test.mjs. */
(function (root) {
  'use strict';
  const DOW = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'], MONTH = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  const parts = (d) => String(d).split('-').map(Number);
  const dowOf = (d) => { const [y, m, dd] = parts(d); return (new Date(Date.UTC(y, m - 1, dd)).getUTCDay() + 6) % 7; };
  /** «Пн 26.10» */
  const dayHead = (d) => { const [, m, dd] = parts(d); return `${DOW[dowOf(d)]} ${String(dd).padStart(2, '0')}.${String(m).padStart(2, '0')}`; };
  /** «26 октября – 1 ноября» */
  const weekLabel = (start, end) => { const [, m1, d1] = parts(start), [, m2, d2] = parts(end); return m1 === m2 ? `${d1}–${d2} ${MONTH[m1 - 1]}` : `${d1} ${MONTH[m1 - 1]} – ${d2} ${MONTH[m2 - 1]}`; };
  const ICON = { post: '📝', video: '🎬' };
  const TONE = { you: 'cal-you', work: 'cal-work', ok: 'cal-ok', done: 'cal-done', wait: 'cal-wait', bad: 'cal-bad', off: 'cal-off' };
  const toneClass = (t) => TONE[t] || TONE.wait;
  const clip = (t, n) => { const x = String(t || '').replace(/\s+/g, ' ').trim(); return x.length > n ? x.slice(0, n - 1).trimEnd() + '…' : x; };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  /** Ячейка (день × канал) -> что показать: заголовок статуса плана, строки-слоты, подсказка для пустой ячейки. */
  function cellView(cell, today) {
    const slots = (cell.slots || []).map((s) => ({ ...s, icon: ICON[s.kind] || '•', cls: toneClass(s.tone), short: clip(s.title, 64) }));
    let head = '', hint = '';
    if (cell.plan) head = cell.plan.label + (cell.plan.status === 'proposed' && cell.plan.options ? ` · вариантов: видео ${cell.plan.options.video}, посты ${cell.plan.options.posts}` : '');
    else if (cell.autoAt) hint = 'план соберётся сам: ' + new Date(cell.autoAt).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' }).replace(',', ' в');
    else hint = cell.date < today ? 'плана не было' : 'плана нет';
    return { head, hint, slots, empty: !slots.length, today: cell.date === today, past: cell.date < today, canPlan: !!cell.canPlan };
  }
  /** Сколько в неделе пунктов, ждущих решения Ника (для значка на кнопке). */
  const needYou = (cal) => (cal.cells || []).reduce((n, c) => n + (c.slots || []).filter((s) => s.tone === 'you').length + ((c.plan && c.plan.status === 'proposed' && !(c.slots || []).length) ? 1 : 0), 0);
  const api = { dayHead, weekLabel, cellView, toneClass, needYou, clip, esc, ICON, DOW };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.CalCore = api;
})(typeof window !== 'undefined' ? window : globalThis);

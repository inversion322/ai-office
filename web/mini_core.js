/* Чистая логика Mini App без обращений к DOM: разбор ссылки, решения по состоянию экрана, подписи. Тестируется в Node (test/mini_core.test.mjs). */
(function (root) {
  'use strict';

  // Адрес API берём из ссылки ?api=… (его подставляет бот при смене туннеля). Принимаем только https на trycloudflare:
  // иначе любой, кто подсунет ссылку с чужим адресом, получил бы подпись Telegram (initData) на свой сервер.
  const API_HOST_OK = /^[a-z0-9-]+\.trycloudflare\.com$/i;
  function parseApi(search) {
    let raw; try { raw = new URLSearchParams(search).get('api'); } catch { return { ok: false, reason: 'нет адреса' }; }
    if (!raw) return { ok: false, reason: 'нет адреса' };
    let u; try { u = new URL(raw); } catch { return { ok: false, reason: 'адрес не разобрать' }; }
    if (u.protocol !== 'https:') return { ok: false, reason: 'нужен https' };
    if (!API_HOST_OK.test(u.hostname)) return { ok: false, reason: 'неизвестный хост' };
    if (u.username || u.password || u.port) return { ok: false, reason: 'лишнее в адресе' };
    return { ok: true, api: u.origin };
  }

  // Что показать на «воротах» по ответу сервера/сети. Главное: человеку сказать, ЧТО делать, а не «ошибка».
  function gateFor(kind, extra) {
    switch (kind) {
      case 'not-telegram': return { title: 'Откройте через Telegram', text: 'Эта страница работает только внутри бота @NickG_smm_bot: нажмите кнопку «Офис» рядом с полем ввода.', retry: false };
      case 'no-api': return { title: 'Нет адреса офиса', text: 'Откройте офис кнопкой «Офис» в чате с ботом: адрес подставляется сам.', retry: false };
      case 'bad-api': return { title: 'Адрес офиса не подходит', text: 'Ссылка выглядит поддельной (' + (extra || '') + '). Откройте офис кнопкой «Офис» в чате с ботом.', retry: false };
      case 'forbidden': return { title: 'Нет доступа', text: 'Офис открывается только владельцу.', retry: false };
      case 'expired': return { title: 'Сессия устарела', text: 'Закройте и откройте офис заново кнопкой «Офис».', retry: true };
      case 'offline': return { title: 'Офис не отвечает', text: 'Скорее всего, туннель только что сменил адрес. Бот обновит кнопку «Офис» за минуту: закройте окно и откройте заново. Если не помогает, проверьте, что ПК включён.', retry: true };
      default: return { title: 'Не получилось войти', text: 'Что-то пошло не так' + (extra && String(extra).length > 3 ? ' (' + String(extra).slice(0, 120) + ')' : '') + '. Закройте и откройте офис кнопкой «Офис» ещё раз.', retry: true };
    }
  }

  // Статус сотрудника для людей.
  const STATUS = { working: 'работает', waiting: 'ждёт', idle: 'свободен', error: 'ошибка', offline: 'отключён' };
  const statusText = (s) => STATUS[s] || String(s || '');

  // Сколько времени назад (для ленты и чата): «только что», «5 мин», «2 ч», «вчера».
  function ago(ts, now) {
    const s = Math.max(0, Math.round((now - ts) / 1000));
    if (s < 45) return 'только что';
    if (s < 3600) return Math.round(s / 60) + ' мин';
    if (s < 86400) return Math.round(s / 3600) + ' ч';
    return Math.round(s / 86400) + ' дн';
  }

  // Кому слать, если Ник пишет без выбора: имя в начале сообщения («Ксения, …») угадывает сервер; здесь только выбор вкладкой.
  function targetFor(selected, agents) { return selected && agents.some((a) => a.id === selected) ? selected : null; }

  // Ждущие ответа карточки: открытые action-сообщения, самые свежие сверху.
  function pendingCards(messages) {
    return (messages || []).filter((m) => m.kind === 'action' && m.status === 'open').sort((a, b) => b.id - a.id);
  }

  // Кнопки приходят рядами: [[{t,d}, {t,d}], [{t,d}]] (так их хранит чат) или плоско, или парами [текст, данные]. Приводим к плоскому списку {t,d}.
  function normButtons(b) {
    const out = [];
    const take = (x) => {
      if (Array.isArray(x)) { if (x.length === 2 && typeof x[0] === 'string' && typeof x[1] === 'string') out.push({ t: x[0], d: x[1] }); else x.forEach(take); return; }
      if (x && typeof x === 'object') { const t = x.t || x.text, d = x.d || x.data; if (t && d) out.push({ t: String(t), d: String(d) }); }
    };
    take(b); return out;
  }

  // Что показывать в чате с выбранным сотрудником: только его поток. Ваши сообщения лежат в потоке того, кому адресованы: показывать их всем подряд
  // значило бы выдать «Принять ролик» (Капитану) за реплику Ксении. Без выбора («Всем») виден общий поток.
  const isMine = (m) => m.sender === 'nick';
  function threadFilter(messages, who) {
    const list = messages || [];
    return who ? list.filter((m) => m.thread === who) : list;
  }

  // «✖ Убрать» хранится в карточке как обычная кнопка (так она есть и в Telegram), но на странице это отдельный малозаметный элемент: рядом с «Принять» её не должно быть.
  const isDismiss = (d) => /^dismiss:/.test(String(d || ''));
  function splitButtons(b) { const all = normButtons(b); return { main: all.filter((x) => !isDismiss(x.d)), dismiss: all.some((x) => isDismiss(x.d)) }; }
  // Ручной сброс статуса сотрудника доступен только когда он «ждёт» или в «ошибке»: работающего сбрасывать нельзя.
  const clearLabel = (status) => (status === 'waiting' ? 'Снять ожидание' : status === 'error' ? 'Сбросить ошибку' : '');

  // Какие кнопки просят текст. Совпадает с тем, как их разбирает сервер (lib_chat.mjs execAction):
  //  rework/revise  — без текста сервер не продолжит («Напишите, что поправить»), значит текст обязателен;
  //  title          — «Своё название»: текст обязателен (до 100 знаков).
  //  package        — «Другое название»: можно с пожеланием («короче»), можно без него.
  function commentMode(choice) {
    const act = String(choice || '').split(':')[0];
    if (act === 'rework' || act === 'revise') return { ask: true, required: true, title: 'Что исправить?', sub: act === 'rework' ? 'Кирилл учтёт это сразу, у ролика будет приоритет.' : 'Ксения исправит, Вера проверит заново.', cta: 'Отправить правки' };
    if (act === 'title') return { ask: true, required: true, title: 'Своё название ролика', sub: 'До 100 знаков. Хэштеги можно писать прямо в названии. Рекомендованные уйдут в описание.' };
    if (act === 'package') return { ask: true, required: false, title: 'Какое название нужно?', sub: 'Можно без пожелания. Хэштеги в название по умолчанию не ставим; хотите, напишите: «в название #кофе #здоровье».', cta: 'Предложить другое' };
    return { ask: false };
  }

  // Свёрнутый вид карточки: без пустых строк (они съедают место и прячут суть) и не больше N непустых строк. Возвращает { text, cut }.
  function squash(text, lines = 4, maxChars = 220) {
    const rows = String(text || '').split('\n').map((x) => x.trim()).filter(Boolean);
    let out = rows.slice(0, lines).join('\n'); let cut = rows.length > lines;
    if (out.length > maxChars) { out = out.slice(0, maxChars).replace(/\s+\S*$/, ''); cut = true; }
    return { text: out, cut };
  }

  // Безопасный текст в HTML: страница строится из ответов сервера, в них не должно быть исполняемой разметки.
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // Шкала прогресса работающего сотрудника: процент и «ещё ~N мин» внутри полоски (поле pb считает сервер: server/lib_progress.mjs)
  function progressBar(a) {
    const pb = a && a.status === 'working' && a.pb;
    if (!pb) return '';
    const tip = pb.basis === 'history' ? 'по ' + pb.n + ' прошлым запускам' : pb.basis === 'default' ? 'первая оценка: истории запусков ещё нет, цифра уточнится' : 'оценки пока нет';
    return '<div class="pbar' + (pb.overrun ? ' over' : '') + '" title="' + esc(tip) + '"><i style="width:' + (Number(pb.pct) || 0) + '%"></i><span>' + esc(pb.label) + '</span></div>';
  }

  // Метка варианта одной темы у ролика: «B · Один объект» (поле variant приходит с сервера)
  const VFMT = { A: 'Лента', B: 'Один объект', C: 'Комикс' };
  const variantLabel = (v) => (v && v.variant && v.variant.letter ? v.variant.letter + ' · ' + (VFMT[v.variant.letter] || '') : '');

  // Группы сотрудников по виду деятельности и площадке (решение Ника 2026-10-27): Telegram, YouTube, видео, управление. Монтажёры живут в видео-студии и в штат Telegram не входят.
  const GROUPS = [
    { id: 'core', title: 'Руководство', cls: 'core' }, { id: 'studio', title: 'Управление контентом', cls: 'studio' }, { id: 'tg', title: 'Telegram-канал', cls: 'tg' },
    { id: 'yt', title: 'YouTube-канал', cls: 'yt' }, { id: 'video', title: 'Видео-студия', cls: 'video' },
  ];
  function groupAgents(agents) {
    const list = Array.isArray(agents) ? agents : [];
    const out = GROUPS.map((g) => ({ ...g, agents: list.filter((a) => a.team === g.id) })).filter((g) => g.agents.length);
    const known = new Set(GROUPS.map((g) => g.id)), rest = list.filter((a) => !known.has(a.team));
    if (rest.length) out.push({ id: 'other', title: 'Прочие', cls: 'other', agents: rest });
    return out.map((g) => ({ ...g, working: g.agents.filter((a) => a.status === 'working').length }));
  }

  const api = { groupAgents, GROUPS, variantLabel, progressBar, parseApi, gateFor, statusText, ago, targetFor, pendingCards, normButtons, squash, threadFilter, isMine, commentMode, splitButtons, isDismiss, clearLabel, esc, STATUS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.MiniCore = api;
})(typeof window !== 'undefined' ? window : globalThis);

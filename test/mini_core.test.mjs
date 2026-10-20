import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const C = require('../web/mini_core.js');

test('адрес API из ссылки: нормальный trycloudflare принимается и приводится к origin', () => {
  assert.deepEqual(C.parseApi('?api=https%3A%2F%2Fmechanical-her-dairy-php.trycloudflare.com'), { ok: true, api: 'https://mechanical-her-dairy-php.trycloudflare.com' });
  assert.equal(C.parseApi('?api=https://a-b.trycloudflare.com/api/state?x=1').api, 'https://a-b.trycloudflare.com');
});
test('подмена адреса: чужой хост, http, порт, логин в адресе, похожие домены — всё отклоняется (иначе подпись Telegram уйдёт на чужой сервер)', () => {
  for (const bad of ['https://evil.example.com', 'http://a.trycloudflare.com', 'https://a.trycloudflare.com:8443', 'https://u:p@a.trycloudflare.com', 'https://a.trycloudflare.com.evil.io', 'https://trycloudflare.com', 'https://evil-trycloudflare.com', 'javascript:alert(1)', 'https://a.b.trycloudflare.com'])
    assert.equal(C.parseApi('?api=' + encodeURIComponent(bad)).ok, false, bad);
  assert.equal(C.parseApi('').ok, false); assert.equal(C.parseApi('?api=').ok, false);
});
test('окна-«ворота»: каждый сбой говорит, что делать, а повтор предлагается только там, где он поможет', () => {
  for (const k of ['not-telegram', 'no-api', 'bad-api', 'forbidden', 'expired', 'offline', 'x']) { const g = C.gateFor(k, 'п'); assert.ok(g.title && g.text.length > 20, k); }
  assert.equal(C.gateFor('forbidden').retry, false); assert.equal(C.gateFor('offline').retry, true); assert.match(C.gateFor('offline').text, /кнопк/);
});
test('карточки ждущих ответа: только открытые action, свежие сверху', () => {
  const m = [{ id: 1, kind: 'action', status: 'open' }, { id: 2, kind: 'text' }, { id: 3, kind: 'action', status: 'answered' }, { id: 4, kind: 'action', status: 'open' }];
  assert.deepEqual(C.pendingCards(m).map((x) => x.id), [4, 1]); assert.deepEqual(C.pendingCards(null), []);
});
test('кнопки в РЕАЛЬНОМ формате чата (ряды объектов) раскрываются в плоский список; другие форматы тоже; мусор отбрасывается', () => {
  // Точно так, как они лежат в messages.buttons (взято из рабочей БД): раньше именно этот формат давал «[object Object]» вместо текста кнопки.
  const real = [[{ t: 'Тема 1', d: 'pick:2' }, { t: 'Тема 2', d: 'pick:3' }], [{ t: 'Другие темы', d: 'more:0' }]];
  assert.deepEqual(C.normButtons(real), [{ t: 'Тема 1', d: 'pick:2' }, { t: 'Тема 2', d: 'pick:3' }, { t: 'Другие темы', d: 'more:0' }]);
  assert.deepEqual(C.normButtons([[{ t: 'Принять ролик', d: 'accept:1' }, { t: 'Внести правки', d: 'rework:1' }]]).map((x) => x.t), ['Принять ролик', 'Внести правки']);
  assert.deepEqual(C.normButtons([[['Принять', 'accept:1'], ['Правки', 'rework:1']]]), [{ t: 'Принять', d: 'accept:1' }, { t: 'Правки', d: 'rework:1' }]);
  assert.deepEqual(C.normButtons([{ t: 'Да', d: 'y' }, { text: 'Нет', data: 'n' }, { t: '', d: 'z' }]), [{ t: 'Да', d: 'y' }, { t: 'Нет', d: 'n' }]);
  assert.deepEqual(C.normButtons(null), []); assert.deepEqual(C.normButtons('x'), []);
  for (const x of C.normButtons(real)) assert.equal(typeof x.t, 'string');
});
test('экранирование: разметка в тексте от сервера не исполняется', () => {
  assert.equal(C.esc('<img src=x onerror=alert(1)>"\''), '&lt;img src=x onerror=alert(1)&gt;&quot;&#39;'); assert.equal(C.esc(null), '');
});
test('время «назад» и вкладка адресата', () => {
  const n = 10_000_000; assert.equal(C.ago(n - 10_000, n), 'только что'); assert.equal(C.ago(n - 5 * 60_000, n), '5 мин'); assert.equal(C.ago(n - 3 * 3600_000, n), '3 ч'); assert.equal(C.ago(n - 2 * 86400_000, n), '2 дн');
  assert.equal(C.targetFor('video', [{ id: 'video' }]), 'video'); assert.equal(C.targetFor('нет', [{ id: 'video' }]), null);
});

test('свёрнутая карточка: пустые строки убраны, суть (название) видна, длинное режется по слову', () => {
  const pack = '📦 Пакет публикации: «Сахар делает детей гиперактивными?»\n\nНАЗВАНИЕ (копируйте):\nМамам сказали про сахар, а детям дали пустышку\nпочему: деталь рождает вопрос\n\nЗапасные варианты:\n1. Все винят сахар';
  const s = C.squash(pack); assert.equal(s.cut, true); assert.ok(s.text.includes('Мамам сказали про сахар'), 'название пакета должно быть видно без раскрытия'); assert.ok(!/\n\n/.test(s.text));
  assert.deepEqual(C.squash('коротко'), { text: 'коротко', cut: false }); assert.deepEqual(C.squash(null), { text: '', cut: false });
  const long = C.squash('слово '.repeat(100)); assert.ok(long.text.length <= 220 && long.cut && !/\s$/.test(long.text));
});

test('чат с сотрудником показывает только его поток: ваши сообщения Капитану не выдаются за реплики Ксении', () => {
  const msgs = [
    { id: 1, thread: 'captain_smm', sender: 'nick', text: 'Принять ролик' },
    { id: 2, thread: 'scriptwriter', sender: 'scriptwriter', text: 'Сценарий готов' },
    { id: 3, thread: 'scriptwriter', sender: 'nick', text: 'Сделай первую фразу короче' },
    { id: 4, thread: 'captain_smm', sender: 'captain_smm', text: 'Принят' }];
  assert.deepEqual(C.threadFilter(msgs, 'scriptwriter').map((m) => m.id), [2, 3]);
  assert.deepEqual(C.threadFilter(msgs, 'captain_smm').map((m) => m.id), [1, 4]);
  assert.deepEqual(C.threadFilter(msgs, null).map((m) => m.id), [1, 2, 3, 4], '«Всем» = общий поток');
  assert.deepEqual(C.threadFilter(null, 'x'), []);
  assert.equal(C.isMine(msgs[0]), true); assert.equal(C.isMine(msgs[1]), false);
});

test('какие кнопки просят текст: правки обязательны, «Другое название» по желанию, остальные не спрашивают', () => {
  assert.deepEqual([C.commentMode('rework:1').ask, C.commentMode('rework:1').required], [true, true]);
  assert.deepEqual([C.commentMode('revise:3').ask, C.commentMode('revise:3').required], [true, true]);
  assert.deepEqual([C.commentMode('package:1').ask, C.commentMode('package:1').required], [true, false]);
  assert.deepEqual([C.commentMode('title:1').ask, C.commentMode('title:1').required], [true, true], 'своё название: текст обязателен');
  assert.equal(C.commentMode('publish_go:1').ask, false); assert.equal(C.commentMode('publish:1:yt').ask, false);
  for (const x of ['accept:1', 'pick:2', 'more:0', 'retry:3', 'approve:3', 'reject:3', '', null]) assert.equal(C.commentMode(x).ask, false, String(x));
  assert.match(C.commentMode('rework:1').sub, /приоритет/);
});

test('«✖ Убрать» отделяется от обычных кнопок (в карточке хранится как кнопка, на странице отдельный элемент)', () => {
  const real = [[{ t: 'Принять ролик', d: 'accept:1' }, { t: 'Внести правки', d: 'rework:1' }], [{ t: '✖ Убрать', d: 'dismiss:0' }]];
  const s = C.splitButtons(real); assert.deepEqual(s.main.map((x) => x.d), ['accept:1', 'rework:1']); assert.equal(s.dismiss, true);
  assert.deepEqual(C.splitButtons([[{ t: 'Да', d: 'y' }]]), { main: [{ t: 'Да', d: 'y' }], dismiss: false }); assert.deepEqual(C.splitButtons(null), { main: [], dismiss: false });
  assert.equal(C.isDismiss('dismiss:0'), true); assert.equal(C.isDismiss('accept:1'), false); assert.equal(C.isDismiss(null), false);
  assert.equal(C.commentMode('dismiss:0').ask, false, 'убрать и перегенерировать не спрашивают текст'); assert.equal(C.commentMode('regen:3').ask, false);
});
test('кнопка сброса статуса есть только у ждущего и у сотрудника в ошибке, у работающего и свободного её нет', () => {
  assert.equal(C.clearLabel('waiting'), 'Снять ожидание'); assert.equal(C.clearLabel('error'), 'Сбросить ошибку');
  for (const s of ['working', 'idle', 'offline', '', null, undefined]) assert.equal(C.clearLabel(s), '');
});

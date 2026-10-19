import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyAnswer as c, quickPick, topicMentioned, stripButtonTalk } from '../server/lib_intent.mjs';

test('да: короткие утверждения без уточнения', () => {
  for (const x of ['Да', 'да!', 'Да, сделать', 'ок', 'Окей', 'давай', 'Да-да', 'делай', 'Да, пожалуйста', 'согласен', 'подтверждаю', '+', 'Да, да, сделайте']) assert.deepEqual(c(x), { kind: 'yes', extra: '' }, x);
});
test('да с уточнением: хвост сохраняется дословно', () => {
  assert.deepEqual(c('Да, про 10000 шагов'), { kind: 'yes', extra: 'про 10000 шагов' });
  assert.deepEqual(c('ок, хук поярче'), { kind: 'yes', extra: 'хук поярче' });
});
test('нет: короткий отказ', () => { for (const x of ['Нет', 'нет!', 'не надо', 'нет, не делай', 'Отмена', 'стоп', 'не нужно', 'не сейчас']) assert.deepEqual(c(x), { kind: 'no', extra: '' }, x); });
test('двусмысленное не разбирается: уходит Капитану', () => {
  for (const x of ['Нет, давай #2', 'Да, но сначала другую', 'да, только короче', 'Ролик нужен более динамичный', 'утверждаю', 'не знаю, может другую тему?', '', 'да но не сегодня а завтра и вообще потом всё обсудим ладно хорошо отлично']) assert.equal(c(x).kind, null, x);
});
test('выбор темы числом', () => {
  for (const [x, n] of [['4', 4], ['#4', 4], ['№ 4', 4], ['тему 4', 4], ['Выбираем тему #4', 4], ['выбираю 12', 12], ['давай номер 3', 3], ['Бери #5!', 5]]) assert.equal(quickPick(x), n, x);
  for (const x of ['тему 4, но динамичнее', 'у меня 4 идеи', 'Выбираем про шаги', '10000 шагов', '']) assert.equal(quickPick(x), null, x);
});
test('тема названа: по номеру или слову из названия', () => {
  const T = 'Нужно ходить ровно десять тысяч шагов в день?';
  assert.equal(topicMentioned('Выбираем тему #4', 4, T), true); assert.equal(topicMentioned('давай про шагов', 9, T), true); assert.equal(topicMentioned('про 10000 шагов', 9, T), true);
  assert.equal(topicMentioned('сделай что-нибудь', 4, T), false); assert.equal(topicMentioned('тема 14', 4, T), false);
});
test('из ответа модели вырезаются фразы про кнопку и подтверждение', () => {
  assert.equal(stripButtonTalk('Ник, понял: тема #4. Подтвердите кнопкой, и Ксения возьмёт её. Балл 77.'), 'Ник, понял: тема #4. Балл 77.');
  assert.equal(stripButtonTalk('Нажмите кнопку.'), '');
});

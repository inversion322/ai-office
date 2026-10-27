// «План дня» и переключатель автоплана: понимание коротких просьб Ника без модели
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { studioPlanRequest as plan, studioAutoSwitch as sw, topicRequest } from '../server/lib_intent.mjs';

test('просьба плана дня', () => {
  assert.deepEqual(plan('план дня'), { when: null, hint: '' });
  assert.deepEqual(plan('Составь план дня'), { when: null, hint: '' });
  assert.deepEqual(plan('собери план на завтра'), { when: 'завтра', hint: '' });
  assert.deepEqual(plan('давай план дня на сегодня'), { when: 'сегодня', hint: '' });
  assert.deepEqual(plan('Составь план дня про сон и усталость'), { when: null, hint: 'сон и усталость' });
  assert.deepEqual(plan('план на завтра по теме: витамины'), { when: 'завтра', hint: 'витамины' });
});
test('это не просьба: отзывы, вопросы, обычные слова', () => {
  for (const t of ['план дня понравился', 'какой план дня', 'план такой: сначала сценарий', 'план', 'мне нужен план', 'план дня не нужен', 'отличный план дня', 'утверждаю план дня', '', 'план дня план дня план дня план дня план дня план дня план дня план дня план дня план дня план дня план дня']) assert.equal(plan(t), null, t);
});
test('переключатель автоплана', () => {
  assert.deepEqual(sw('включи автоплан'), { on: true }); assert.deepEqual(sw('Включи план дня каждый вечер'), { on: true }); assert.deepEqual(sw('запусти план дня автоматически'), { on: true });
  assert.deepEqual(sw('выключи автоплан'), { on: false }); assert.deepEqual(sw('отключи план дня по вечерам'), { on: false }); assert.deepEqual(sw('останови автоплан'), { on: false });
});
test('переключатель не путается с просьбой плана и вопросами', () => {
  for (const t of ['запусти план дня', 'план дня', 'включи свет', 'что такое автоплан', 'как включить автоплан', 'не выключай автоплан сегодня вечером пожалуйста спасибо большое']) assert.equal(sw(t), null, t);
  assert.equal(plan('включи автоплан'), null); assert.equal(plan('выключи план дня каждый вечер'), null);
});
test('просьба тем для видео по-прежнему работает отдельно', () => { assert.deepEqual(topicRequest('подбери темы про сон', { scored: [] }).hint.includes('сон'), true); assert.equal(topicRequest('план дня', { scored: [] }), null); });

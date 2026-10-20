import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { styleIssues, styleFeedback, bridgeIssues } from '../scripts/script_style.mjs';

const rules = (a) => styleIssues(a).map((x) => x.rule);

test('служебные слова каркаса ловятся: номер улики, «поворот», «развязка», «приговор», «источники на экране»', () => {
  assert.deepEqual(rules(['Улика номер один. Исследование показало.']), ['clue-num', 'clue-word']);
  assert.deepEqual(rules(['Первая улика: сорок семь тысяч взрослых.']), ['clue-num-rev', 'clue-word']);
  assert.deepEqual(rules(['Поворот! Авторы пишут иначе.']), ['twist']);
  assert.deepEqual(rules(['И тут поворот: цифра из рекламы.']), ['twist']);
  assert.deepEqual(rules(['Развязка близко.']), ['denouement']);
  assert.deepEqual(rules(['Приговор: скорее миф.']), ['verdict']);
  assert.deepEqual(rules(['Источники на экране.']), ['sources-voice']);
});

test('обычная речь не ловится («повороты судьбы», «поворотный», «источники данных»)', () => {
  for (const ok of ['Повороты судьбы тут ни при чём.', 'Это поворотный момент исследования.', 'Авторы подробно описали источники данных.', 'Миф разобран. Вывод простой: двигайтесь.'])
    assert.deepEqual(rules([ok]), [], ok);
});

test('регрессия: ровно тот текст ролика №2 v2, на который жаловался Ник, получает замечания по каждому служебному слову', () => {
  const segs = ['Десять тысяч шагов в день. Кто это придумал?', 'Улика первая. Мета-анализ наблюдений.', 'Улика вторая. Кривая выходит на плато.', 'Поворот! Авторы пишут: цифра из рекламной кампании.', 'Но это наблюдения.', 'Приговор: скорее миф.', 'Кто придумал десять тысяч? Реклама. Источники на экране.'];
  const iss = styleIssues(segs);
  assert.deepEqual([...new Set(iss.map((x) => x.seg))], [2, 3, 4, 6, 7]);
  const fb = styleFeedback(iss);
  assert.match(fb, /абзац 2/); assert.match(fb, /Перепиши эти места по смыслу/);
  assert.equal(styleFeedback([]), '');
});

test('«пункты списка» без связки: «Второе…», «Далее…», «Во-вторых…» в начале абзаца (кроме первого) требуют мостика по смыслу', () => {
  assert.equal(bridgeIssues(['Хук.', 'Второе исследование показало X.', 'Далее перейдём к Y.']).length, 2);
  assert.equal(bridgeIssues(['Хук.', 'Во-вторых, данные такие.']).length, 1);
  assert.equal(bridgeIssues(['Хук.', 'Но если дело в этом, почему кривая плоская?', 'А вот что нашли.']).length, 0);
  assert.equal(bridgeIssues(['Второе слово в первом абзаце не считается']).length, 0);
});

test('правила стиля попали в промпт сценариста и проверяющей, а задание Ксении просит сквозную мысль (idea) и запрещает название этапов', () => {
  const lib = fs.readFileSync(new URL('../server/lib_extra_agents.mjs', import.meta.url), 'utf8');
  assert.match(lib, /НЕ произноси «улика первая»/); assert.match(lib, /Единая сквозная мысль/); assert.match(lib, /ВНУТРЕННЯЯ формула/);
  const pipe = fs.readFileSync(new URL('../scripts/smm_pipeline.mjs', import.meta.url), 'utf8');
  assert.match(pipe, /"idea"/); assert.match(pipe, /служебные слова/i); assert.doesNotMatch(pipe, /можно коротко «Источники на экране/);
});

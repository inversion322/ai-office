import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { styleIssues, styleFeedback, bridgeIssues, verdictIssues } from '../scripts/script_style.mjs';

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

// ---- вердикт «миф/правда» не называется в начале ролика (решение Ника 2026-10-20)
const hv = (segments, on_screen) => verdictIssues({ segments, on_screen });
test('вердикт в хуке: «миф», «правда или миф», «это правда.», ложь, фейк, развенчиваем в первых двух абзацах ловятся', () => {
  for (const s of ['Это миф? Давайте проверим.', 'Правда или миф: десять тысяч шагов?', 'Развенчиваем миф про шаги.', 'Говорят, это правда.', 'Ложь или нет?', 'Фейк про шаги.', 'Мифы о шагах живучи.']) assert.equal(hv([s, 'Дальше.']).length, 1, s);
  assert.equal(hv(['Хук без ярлыка?', 'Откуда это? Развенчивают такое часто.']).length, 1, 'второй абзац тоже ранний');
  assert.equal(hv(['Хук.', 'Второй.', 'Третий.', 'Приговор: это миф. Пользы почти нет.']).length, 0, 'вердикт в конце остаётся');
});
test('вердикт в хуке: «правда ли это?», «это правда?», «правда, что…?» (вопросы) разрешены, это дословный хук Ника', () => {
  assert.deepEqual(hv(['Говорят, что нужно ходить по десять тысяч шагов в день, правда ли это?', 'Откуда взялась вообще эта цифра?']), []);
  assert.deepEqual(hv(['Это правда?', 'Правда, что шаги считают?']), []);
  assert.deepEqual(hv(['Правдоподобно звучит. Но правдивы ли цифры?']), [], 'правдоподобно/правдивы не ярлыки');
});
test('вердикт на экране: штамп «МИФ?» в описании первых двух кадров (как было в ролике про шаги) ловится, в поздних кадрах разрешён', () => {
  const r = hv(['Хук?', 'Откуда?'], [{ segment: 1, headline: '10 000', note: 'гигантское число со штампом «МИФ?»', loupe: 'число' }, { segment: 2, headline: 'Откуда: реклама', numbers: ['47 471'] }, { segment: 6, note: 'печать МИФ на красном поле' }]);
  assert.equal(r.length, 1); assert.equal(r[0].where, 'экран'); assert.equal(r[0].seg, 1); assert.match(r[0].quote, /МИФ/);
  assert.deepEqual(hv(['Хук?', 'Откуда?'], [{ segment: 1, headline: '10 000 шагов в день: правда ли?' }]), [], 'заголовок-вопрос без ярлыка');
});
test('замечание Ксении про вердикт: понятно, где и что убрать; смешивается с замечаниями про служебные слова', () => {
  const v = verdictIssues({ segments: ['Это миф?', 'Дальше.'], on_screen: [{ segment: 1, note: 'штамп МИФ?' }] });
  const fb = styleFeedback(v); assert.match(fb, /Вердикт \(миф это или правда\) нельзя называть в начале ролика/); assert.match(fb, /в озвучке, абзац 1/); assert.match(fb, /на экране, абзац 1/); assert.match(fb, /on_screen: headline, note, loupe/); assert.match(fb, /только в конце, перед призывом/);
  const both = styleFeedback([...styleIssues(['Улика первая. Факт.']), ...v]); assert.match(both, /служебные слова каркаса/); assert.match(both, /Вердикт \(миф/);
});

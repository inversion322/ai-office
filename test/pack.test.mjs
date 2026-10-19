import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkTitle, checkTags, buildMessage, normTag, BRAND_TAG } from '../server/lib_pack.mjs';

const SCRIPT = 'Ребёнок съел конфету. Шестнадцать работ, двадцать три эксперимента. Сахар не влияет на поведение. Миф.';

test('нормальное название-интрига проходит', () => {
  assert.equal(checkTitle('Сахар делает детей гиперактивными? Ответ в конце', { scriptText: SCRIPT }).ok, true);
  assert.equal(checkTitle('Все думают, что сахар шалит. Данные говорят иначе', { scriptText: SCRIPT }).ok, true);
});

test('лечебные обещания, «секреты врачей», запугивание и КАПС отклоняются', () => {
  for (const t of ['Этот витамин вылечит простуду за день', 'Врачи скрывают правду о сахаре', 'ШОК: что сахар делает с детьми', 'Сахар ужас для ребёнка', 'Гарантированно спасёт от простуды', 'СЕКРЕТ ВРАЧЕЙ про сахар']) {
    assert.equal(checkTitle(t, { scriptText: SCRIPT }).ok, false, t);
  }
});

test('длина, знаки и выдуманные цифры', () => {
  assert.equal(checkTitle('а'.repeat(101)).ok, false);
  assert.equal(checkTitle('Правда ли?! Серьёзно?! Да?!').ok, false);
  const bad = checkTitle('Сахар: 97 процентов родителей ошибаются', { scriptText: SCRIPT });
  assert.equal(bad.ok, false); assert.match(bad.problems.join(' '), /97/);
  assert.equal(checkTitle('Сахар и дети: 16 исследований', { scriptText: 'шестнадцать работ. 16 работ' }).ok, true);
});

test('хэштеги: бренд всегда первым, максимум 5, накрутки и дубли убираются, лишние перечислены с причиной', () => {
  const r = checkTags(['#fyp', '#viral', '#reels', '#Сахар', 'Дети', '#сахар', '#ЗОЖ', '#МедицинскийДетектив', '#Здоровье', '#МифыОЗдоровье', '#ещёодин'], { max: 5 });
  assert.equal(r.tags.length, 5); assert.equal(r.tags[0], BRAND_TAG);
  assert.ok(!r.tags.some((t) => /fyp|viral|reels/i.test(t)));
  assert.equal(new Set(r.tags.map((t) => t.toLowerCase())).size, 5, 'дубли');
  assert.ok(r.dropped.some(([t]) => /fyp/i.test(t)) && r.dropped.some(([, why]) => /лимит 5/.test(why)));
});

test('бренд-хэштег добавляется, даже если модель его не дала', () => {
  const r = checkTags(['#Сахар', '#Дети'], { max: 5 });
  assert.deepEqual(r.tags, [BRAND_TAG, '#Сахар', '#Дети']);
});

test('нормализация: пробелы, знаки, регистр не ломают слово', () => {
  assert.equal(normTag(' #Мифы о здоровье! '), '#Мифыоздоровье');
  assert.equal(normTag('###'), '');
});

test('сообщение: одно, с названием, запасными вариантами, хэштегами одной строкой и пометкой про лимит Instagram', () => {
  const m = buildMessage({ videoTitle: 'Сахар делает детей гиперактивными?', title: 'Сахар шалит? Ответ в конце', why: 'интрига закрывается в ролике', alternatives: [{ title: 'Конфета и шалости: что на самом деле', risk: '' }, { title: 'Миф про сахар', risk: 'слишком общее' }], tags: [BRAND_TAG, '#Сахар', '#Дети'], dropped: [['#fyp', 'накрутка']], honesty: 'Охват решает досмотр.' });
  assert.match(m, /НАЗВАНИЕ/); assert.match(m, /Сахар шалит\? Ответ в конце/); assert.match(m, /#МедицинскийДетектив #Сахар #Дети/);
  assert.match(m, /больше 5 Instagram не примет/); assert.match(m, /Запасные варианты:\n1\. /); assert.match(m, /осторожно: слишком общее/); assert.match(m, /Убрала: #fyp/);
  assert.ok(m.length < 3800, 'влезает в одно сообщение Telegram');
});

test('числа прописью в сценарии засчитываются по значению: «шестнадцать» подтверждает 16, а 97 нет', () => {
  const script = 'Шестнадцать работ, двадцать три эксперимента. Десять процентов калорий.';
  assert.equal(checkTitle('16 работ о сахаре: что нашли', { scriptText: script }).ok, true);
  assert.equal(checkTitle('23 эксперимента про сахар', { scriptText: script }).ok, true);
  assert.equal(checkTitle('10 процентов: норма сахара', { scriptText: script }).ok, true);
  assert.equal(checkTitle('97 процентов родителей ошибаются', { scriptText: script }).ok, false);
  assert.equal(checkTitle('5 причин не верить мифу про сахар', { scriptText: script }).ok, false);
});

test('сообщение: запасной вариант, повторяющий тему ролика или выбранное название, не показывается; пометка риска короткая', () => {
  const m = buildMessage({ videoTitle: 'Сахар делает детей гиперактивными?', title: 'Сахар заводит детей? Данные говорят иначе', alternatives: [
    { title: 'Сахар делает детей гиперактивными?', risk: '' }, { title: 'Сахар заводит детей? Данные говорят иначе', risk: '' },
    { title: 'Конфета или ожидание: что заводит ребёнка?', risk: 'Ролик говорит «вероятно, всё дело в ожидании»: это гипотеза авторов, а не доказанный факт, подавать как причину нельзя. Ещё одна длинная фраза, которую не нужно показывать целиком.' }], tags: [BRAND_TAG, '#Сахар'] });
  assert.ok(!/1\. Сахар делает детей гиперактивными\?/.test(m), 'тема ролика в запасных');
  assert.equal((m.match(/Сахар заводит детей\? Данные говорят иначе/g) || []).length, 1, 'выбранное название повторено');
  assert.match(m, /осторожно: Ролик говорит/); assert.ok(!/Ещё одна длинная/.test(m));
});

test('краткая пометка риска не обрывается на двоеточии или точке с запятой посреди фразы', () => {
  const m = buildMessage({ videoTitle: 'Т', title: 'Заголовок один', alternatives: [
    { title: 'Вариант А про сахар', risk: 'Лёгкий: «все винят сахар» в ролике подтверждается, но «эксперименты говорят иначе» звучит категоричнее, чем сказано. Вторая фраза.' },
    { title: 'Вариант Б про конфеты', risk: 'Ответ в ролике только гипотеза (ожидание родителей и шумный праздник, «вероятно»); подавать как факт нельзя.' }], tags: [BRAND_TAG] });
  assert.ok(!/осторожно: [^\n]*[:;]\)/.test(m), m);
  assert.ok(!/\(осторожно: Лёгкий:\)/.test(m), 'обрезано до «Лёгкий:»');
  assert.ok(!/Вторая фраза/.test(m));
  for (const line of m.split('\n').filter((l) => /осторожно:/.test(l))) assert.ok(line.length < 200, line);
});

test('пометка «риск: нет / лёгкий / низкий» не показывается Нику', () => {
  const m = buildMessage({ videoTitle: 'Т', title: 'Заголовок один', alternatives: [
    { title: 'Вариант А', risk: 'Нет: цифра названа в улике первой' }, { title: 'Вариант Б', risk: 'Лёгкий: авторы не исключают малый эффект' }, { title: 'Вариант В', risk: 'Низкий, ролик закрывает интригу' }, { title: 'Вариант Г', risk: 'Подаёт гипотезу как факт' }], tags: [BRAND_TAG] });
  assert.equal((m.match(/осторожно:/g) || []).length, 1); assert.match(m, /Вариант Г {2}\(осторожно: Подаёт гипотезу как факт\)/);
});

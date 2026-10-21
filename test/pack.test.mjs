import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkTitle, checkTags, buildMessage, normTag, BRAND_TAG, titleTagsFrom, composeTitle, askedForTitleTags } from '../server/lib_pack.mjs';

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

test('кликбейт-интрига проходит, но хэштеги в названии бракуются (они идут отдельной рекомендацией), своё название Ника с тегами допускается', () => {
  assert.equal(checkTitle('Вы запиваете кофе водой зря? Один опыт всё меняет').ok, true);
  assert.equal(checkTitle('Что на самом деле делает кофе с водой в теле? Ответ неожиданный').ok, true);
  const r = checkTitle('Кофе и вода: что нашли #кофе #здоровье'); assert.equal(r.ok, false); assert.match(r.problems.join(' '), /хэштеги в название не ставим/);
  assert.equal(checkTitle('Кофе и вода: что нашли #кофе', { allowTags: true }).ok, true);
});
test('название не раскрывает вердикт: «миф», «ложь», «фейк», «развенчиваем» убивают интригу', () => {
  for (const t of ['Это миф: кофе не сушит организм', 'Фейк про кофе и воду', 'Ложь о кофе: проверяем', 'Развенчиваем кофе и воду', 'Миф о кофе?']) { const r = checkTitle(t); assert.equal(r.ok, false, t); assert.match(r.problems.join(' '), /раскрывает вердикт/, t); }
  assert.equal(checkTitle('Правда ли кофе сушит? Ответ в конце').ok, true, 'вопрос без ответа допустим');
});
test('хэштеги в название только по просьбе Ника: названные им берутся как есть, без просьбы пусто что бы ни вернула модель, не больше трёх', () => {
  assert.equal(askedForTitleTags('в название #кофе #здоровье'), true); assert.equal(askedForTitleTags('добавь два хэштега в название'), true);
  assert.equal(askedForTitleTags('сделай ярче, у нас стратегия'), false, '«стратегия» не «тег»'); assert.equal(askedForTitleTags(''), false); assert.equal(askedForTitleTags(undefined), false);
  assert.deepEqual(titleTagsFrom('в название #кофе #Здоровье #кофе', ['#x']), ['#кофе', '#Здоровье']);
  assert.deepEqual(titleTagsFrom('сделай интереснее', ['#a', '#b']), [], 'не просил: название чистое');
  assert.deepEqual(titleTagsFrom('добавь два хэштега в название', ['#Кофе', '#Вода', '#Сон', '#Сахар']), ['#Кофе', '#Вода', '#Сон'], 'без имён решает модель, максимум 3');
  assert.deepEqual(titleTagsFrom('в название #fyp #кофе', []), ['#кофе'], 'накрутки не берём');
});
test('сборка названия: теги дописываются в конец, не влезшие отбрасываются по порядку, чистое название остаётся как есть', () => {
  assert.deepEqual(composeTitle('Вы запиваете кофе зря?', ['#кофе', '#здоровье']), { title: 'Вы запиваете кофе зря? #кофе #здоровье', used: ['#кофе', '#здоровье'], dropped: [] });
  const long = composeTitle('а'.repeat(95), ['#кофе', '#я']); assert.equal(long.title, 'а'.repeat(95)); assert.deepEqual(long.dropped, ['#кофе', '#я'], 'порядок Ника не нарушаем');
  assert.deepEqual(composeTitle('Чистое название', []), { title: 'Чистое название', used: [], dropped: [] });
});
test('сообщение: хэштеги отдельной рекомендацией, в названии их нет; подсказка, как попросить хэштеги в название; без прежнего совета «добавьте 1-2 хэштега в название»', () => {
  const m = buildMessage({ videoTitle: 'Кофе обезвоживает?', title: 'Вы запиваете кофе зря?', tags: ['#МедицинскийДетектив', '#Кофе'] });
  assert.match(m, /НАЗВАНИЕ \(копируйте\):\nВы запиваете кофе зря\?\n/); assert.match(m, /рекомендация, в название они не вставлены/); assert.match(m, /название останется чистым/); assert.match(m, /в название #кофе #здоровье/);
  assert.ok(!/в название добавьте 1-2/.test(m)); assert.ok(!m.split('\n').find((l) => l.startsWith('Вы запиваете')).includes('#'));
  const m2 = buildMessage({ videoTitle: 'К', title: 'Вы запиваете кофе зря? #кофе', tags: ['#МедицинскийДетектив', '#Кофе'], titleTags: ['#кофе'] });
  assert.match(m2, /хэштеги в названии, как вы просили: #кофе/); assert.ok(!/название останется чистым/.test(m2));
});

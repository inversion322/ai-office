// Имитация модели-сотрудника для тестов пакета публикации: читает файл запроса, пишет JSON в путь из строки «Итог запиши в файл … как JSON».
import fs from 'node:fs';
const i = process.argv.indexOf('--query-file');
const q = fs.readFileSync(process.argv[i + 1], 'utf8');
if (/Тимофей Заголовков/.test(q) && /пакет публикации/.test(q)) {
  const out = /Итог запиши в файл (.+?) как JSON/.exec(q)[1].trim();
  const mode = process.env.FAKE_PACK_MODE || 'ok';
  const good = { titles: [
    { title: 'Сахар делает детей гиперактивными? Ответ в конце', approach: 'вопрос', risk: 'нет' },
    { title: 'Все думают, что сахар шалит. Данные говорят иначе', approach: 'контраст', risk: 'нет' },
    { title: 'Конфета и шалости: что на самом деле происходит', approach: 'интрига', risk: 'слишком общее' }], best: 1, why: 'интрига закрывается приговором в ролике',
    hashtags: ['#fyp', '#МифыОЗдоровье', '#Сахар', '#ДетскоеПитание', '#сахар', '#viral', '#Здоровье', '#МедицинскийДетектив'], honesty: 'Хэштеги помогают найти ролик, а охват решает досмотр.' };
  const bad = { titles: [{ title: 'ШОК! Врачи скрывают: этот сахар вылечит всё', approach: 'шок', risk: 'нет' }], best: 1, why: 'x', hashtags: ['#fyp'] };
  const payload = mode === 'bad_then_good' && !fs.existsSync(out + '.second') ? (fs.writeFileSync(out + '.second', '1'), bad) : mode === 'bad' ? bad : good;
  fs.writeFileSync(out, JSON.stringify(payload));
}

// ---- Ксения и Вера (этап сценария). Режимы FAKE_SCRIPT_MODE: ok | similar_then_new | always_similar
const OLD_SEGMENTS = ['Ребёнок съел конфету и носится как угорелый. Виноват сахар? Открываем дело номер один.',
  'Улика первая. Шестнадцать работ, двадцать три эксперимента: никто не знал, где сахар, а где замена. Итог в журнале JAMA: на поведение детей сахар не влияет.',
  'Улика вторая. Одним мамам сказали: сын съел много сахара. Но всем детям дали пустышку. Те мамы назвали сыновей более гиперактивными.',
  'Вероятно, всё дело в ожидании. От сладкого ждут бури, а сладкое подают на празднике, где и так шумно.',
  'Приговор: миф. Но сахар вреден для зубов и веса. ВОЗ советует: добавленных сахаров меньше десяти процентов калорий.'];
const NEW_SEGMENTS = ['Сорок процентов родителей не верят данным. А данные такие: детям тайком подменяли сахар пустышкой.',
  'Мамы клялись, что малыш неуправляем. Конфеты не было, было только мнение, что она была.',
  'Журнал JAMA, шестнадцать работ. Вывод простой: на поведение детей сахар не влияет.',
  'Откуда же буря? Праздник, друзья, музыка. Сладкое просто приходит туда, где и так шумно.',
  'Зубам и весу сахар вреден: ВОЗ советует меньше десяти процентов калорий. Но гиперактивность тут ни при чём.'];
if (/Напиши сценарий ролика/.test(q)) {
  const out = /Итог запиши строго в файл (.+?) \(валидный JSON/.exec(q)[1].trim();
  const mode = process.env.FAKE_SCRIPT_MODE || 'ok', regen = /ПЕРЕГЕНЕРАЦИЯ/.test(q);
  const counter = out + '.calls'; const n = (fs.existsSync(counter) ? Number(fs.readFileSync(counter, 'utf8')) : 0) + 1; fs.writeFileSync(counter, String(n));
  const copy = regen && (mode === 'always_similar' || (mode === 'similar_then_new' && n === 1));
  const segments = !regen ? OLD_SEGMENTS : copy ? OLD_SEGMENTS.map((s, i) => (i === 0 ? s.replace('носится как угорелый', 'носится по дому') : s)) : NEW_SEGMENTS;
  fs.writeFileSync(out, JSON.stringify({ title: 'Сахар делает детей гиперактивными?', rubric: 'myth', hook_type: copy || !regen ? 'сцена' : 'цифра',
    hook_options: [{ type: 'цифра', line: segments[0], score: 9 }, { type: 'сцена', line: 'x', score: 6 }, { type: 'парадокс', line: 'y', score: 7 }],
    segments, on_screen: [], claims: [], sources_card: ['Wolraich. JAMA. 1995.'], disclaimer: 'Не заменяет консультацию врача.' }));
}
if (/Проверь сценарий из файла/.test(q)) {
  const out = /Итог запиши строго в файл (.+?) \(валидный JSON/.exec(q)[1].trim();
  fs.writeFileSync(out, JSON.stringify({ verdict: 'pass', summary: 'факты подтверждены (имитация)', claims: [], required_changes: [] }));
}

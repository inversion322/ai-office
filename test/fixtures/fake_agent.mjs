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

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

// ---- Ксения и Вера (этап сценария). Режимы FAKE_SCRIPT_MODE: ok | similar_then_new | always_similar | long (не влезает в лимит) | short (влезает)
const OLD_SEGMENTS = ['Ребёнок съел конфету и носится как угорелый. Виноват сахар? Проверим по данным.',
  'Шестнадцать работ, двадцать три эксперимента: никто не знал, где сахар, а где замена. Итог в журнале JAMA: на поведение детей сахар не влияет.',
  'А вот что нашли в другом опыте. Одним мамам сказали: сын съел много сахара. Но всем детям дали пустышку. Те мамы назвали сыновей более гиперактивными.',
  'Вероятно, всё дело в ожидании. От сладкого ждут бури, а сладкое подают на празднике, где и так шумно.',
  'Вывод: миф. Но сахар вреден для зубов и веса. ВОЗ советует: добавленных сахаров меньше десяти процентов калорий.'];
const NEW_SEGMENTS = ['Сорок процентов родителей не верят данным. А данные такие: детям тайком подменяли сахар пустышкой.',
  'Мамы клялись, что малыш неуправляем. Конфеты не было, было только мнение, что она была.',
  'Журнал JAMA, шестнадцать работ. Вывод простой: на поведение детей сахар не влияет.',
  'Откуда же буря? Праздник, друзья, музыка. Сладкое просто приходит туда, где и так шумно.',
  'Зубам и весу сахар вреден: ВОЗ советует меньше десяти процентов калорий. Но гиперактивность тут ни при чём.'];
if (/Напиши сценарий ролика/.test(q)) {
  const out = /Итог запиши строго в файл (.+?) \(валидный JSON/.exec(q)[1].trim();
  const mode = process.env.FAKE_SCRIPT_MODE || 'ok', regen = /ПЕРЕГЕНЕРАЦИЯ/.test(q);
  try { const ch = /Обязательные правки: (.*?)(?:\n|$)/s.exec(q); fs.appendFileSync(out + '.queries', (ch ? ch[1] : '(без замечаний)').slice(0, 1800) + '\n---\n'); } catch {}
  const counter = out + '.calls'; const n = (fs.existsSync(counter) ? Number(fs.readFileSync(counter, 'utf8')) : 0) + 1; fs.writeFileSync(counter, String(n));
  const copy = regen && (mode === 'always_similar' || (mode === 'similar_then_new' && n === 1));
  const LONG = Array.from({ length: 6 }, (_, i) => 'Абзац ' + (i + 1) + ': ' + 'длинная фраза про шаги и здоровье взрослых людей, ' .repeat(4) + 'конец.');
  const STAGE_WORDS = ['Хук про конфету.', 'Улика первая. Шестнадцать работ показали, что сахар не влияет.', 'Поворот! Мамам дали пустышку, а они видели бурю.', 'Приговор: миф. Источники на экране.'];
  const segments = mode === 'stage_words' && !fs.existsSync(out + '.second') ? (fs.writeFileSync(out + '.second', '1'), STAGE_WORDS) : mode === 'stage_words' ? NEW_SEGMENTS : mode === 'long' ? LONG : mode === 'short' ? NEW_SEGMENTS : !regen ? OLD_SEGMENTS : copy ? OLD_SEGMENTS.map((s, i) => (i === 0 ? s.replace('носится как угорелый', 'носится по дому') : s)) : NEW_SEGMENTS;
  fs.writeFileSync(out, JSON.stringify({ title: 'Сахар делает детей гиперактивными?', rubric: 'myth', hook_type: copy || !regen ? 'сцена' : 'цифра',
    hook_options: [{ type: 'цифра', line: segments[0], score: 9 }, { type: 'сцена', line: 'x', score: 6 }, { type: 'парадокс', line: 'y', score: 7 }],
    segments, on_screen: [], claims: [], sources_card: ['Wolraich. JAMA. 1995.'], disclaimer: 'Не заменяет консультацию врача.' }));
}
if (/Проверь сценарий из файла/.test(q)) {
  const out = /Итог запиши строго в файл (.+?) \(валидный JSON/.exec(q)[1].trim();
  if (process.env.FAKE_DELAY_MS) await new Promise((r) => setTimeout(r, Number(process.env.FAKE_DELAY_MS)));
  const bad = process.env.FAKE_CHECK_MODE === 'fail';
  fs.writeFileSync(out, JSON.stringify({ verdict: bad ? 'fix' : 'pass', summary: bad ? 'формулировка шире данных (имитация)' : 'факты подтверждены (имитация)', claims: [], required_changes: bad ? ['Сегмент 2: уточнить формулировку'] : [] }));
}

// ---- Кирилл (этап монтажа, конвейер produce). FAKE_VIDEO_MODE: good | tilted_hat | bad_format | static
if (/Создай проект \S+:/.test(q) && /_v1\.mp4/.test(q)) {
  const proj = /Создай проект `?([^`\s:]+(?::[^`\s:]+)?)`?:/.exec(q)[1].replace(/\\/g, '/'); const n = /dosie(\d+)_v1\.mp4/.exec(q)[1];
  const { spawnSync } = await import('node:child_process'); const path = await import('node:path');
  const ff = process.env.TEST_FFMPEG; const mode = process.env.FAKE_VIDEO_MODE || 'good';
  fs.mkdirSync(proj + '/final', { recursive: true }); fs.mkdirSync(proj + '/compositions', { recursive: true });
  const { makeClip } = await import('./make_clip.mjs');
  makeClip(ff, `${proj}/final/dosie${n}_v1.mp4`, mode === 'bad_format' ? 'horizontal' : mode === 'static' ? 'static' : 'dynamic');
  fs.writeFileSync(proj + '/compositions/d_frame.html', mode === 'tilted_hat' ? 'tl.fromTo("#dk-hatwrap", { x: 0, y: 0, rotation: 0 }, { x: 3, y: -9, rotation: 16 }, 1);' : 'tl.fromTo("#dk-hatwrap", { y: 0 }, { y: -9 }, 1);');
  fs.writeFileSync(proj + '/RESULT.md', '# Результат\nГотово (имитация).');
}

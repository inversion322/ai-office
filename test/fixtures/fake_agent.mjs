// Имитация модели-сотрудника для тестов пакета публикации: читает файл запроса, пишет JSON в путь из строки «Итог запиши в файл … как JSON».
import fs from 'node:fs';
import path from 'node:path';
const i = process.argv.indexOf('--query-file');
const q = fs.readFileSync(process.argv[i + 1], 'utf8');
if (/Тимофей Заголовков/.test(q) && /пакет публикации/.test(q)) {
  const out = /Итог запиши в файл (.+?) как JSON/.exec(q)[1].trim();
  const mode = process.env.FAKE_PACK_MODE || 'ok';
  const good = { titles: [
    { title: 'Сахар делает детей гиперактивными? Ответ в конце', approach: 'вопрос', risk: 'нет' },
    { title: 'Все думают, что сахар шалит. Данные говорят иначе', approach: 'контраст', risk: 'нет' },
    { title: 'Конфета и шалости: что на самом деле происходит', approach: 'интрига', risk: 'слишком общее' }], best: 1, why: 'интрига закрывается приговором в ролике',
    title_tags: ['#сахар'],
    hashtags: ['#fyp', '#МифыОЗдоровье', '#Сахар', '#ДетскоеПитание', '#сахар', '#viral', '#Здоровье', '#МедицинскийДетектив'], honesty: 'Хэштеги помогают найти ролик, а охват решает досмотр.' };
  const bad = { titles: [{ title: 'ШОК! Врачи скрывают: этот сахар вылечит всё', approach: 'шок', risk: 'нет' }], best: 1, why: 'x', hashtags: ['#fyp'] };
  const hashBad = { titles: [{ title: 'Сахар шалит? Ответ тут #сахар #дети', approach: 'вопрос', risk: 'нет' }], best: 1, why: 'x', hashtags: ['#МедицинскийДетектив', '#Сахар'] };   // хэштеги в названии: брак
  const payload = (mode === 'bad_then_good' || mode === 'hash_then_good') && !fs.existsSync(out + '.second') ? (fs.writeFileSync(out + '.second', '1'), mode === 'hash_then_good' ? hashBad : bad) : mode === 'bad' ? bad : good;
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
// ---- Варианты одной темы (Ксения пишет B и C, Вера сверяет). FAKE_VARIANT_MODE: ok | no_file (вариант не получается)
const VAR_B = { hook_type: 'цифра', segments: ['Пятьдесят мужчин, шесть дней и один вопрос про утреннюю чашку.', 'Исследователи делили дни на кофейные и водные и измеряли, сколько жидкости остаётся в теле.', 'Итог по приборам удивил самих авторов: разница между напитками почти не видна на графике.', 'Утренний кофе вы можете оставить, график это позволяет.'] };
const VAR_C = { hook_type: 'контраст', segments: ['Мне сказали, что кофе сушит, а я не поверил.', 'Учёные поспорили с этой байкой и провели собственный опыт.', 'Выяснилось, что по общему балансу воды кофе и вода идут вровень.', 'Пейте спокойно: чашка кофе потерей воды не станет.'], panels: [{ scene: 'Мужчина в белом халате ставит на весы чашку кофе', caption: 'Кофе сушит?' }, { scene: 'Учёные в лаборатории наливают воду в пробирки', caption: 'Опыт' }, { scene: 'Три дня подряд по очереди кофе и вода', caption: '' }, { scene: 'Утка-детектив смотрит в лупу на график', caption: 'Вровень' }], reveal: 'Кофе воду не отнимает' };
const isVariant = /ТОЙ ЖЕ ТЕМЫ/.test(q);
if (isVariant && /Напиши сценарий ролика/.test(q)) {
  const L = /ВАРИАНТ ([BC]) ТОЙ ЖЕ ТЕМЫ/.exec(q)[1], out = /запиши результат в (\S+?script\.json)/.exec(q)[1].replace(/\.$/, '');
  const file = path.isAbsolute(out) ? out : path.join(process.env.FAKE_ROOT || process.cwd(), out);
  fs.appendFileSync(file + '.queries', q.replace(/\n/g, ' ') + '\n---\n');
  if (process.env.FAKE_VARIANT_MODE !== 'no_file') { const v = L === 'B' ? VAR_B : VAR_C; fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify({ title: 'Кофе обезвоживает?', rubric: 'myth', ...v, on_screen: [], claims: [], sources_card: ['Killer. 2014.'], disclaimer: 'Не заменяет консультацию врача.' })); }
}
if (/Сверка вариантов сценария/.test(q)) {
  const out = /Запиши JSON в (\S+?variants_check\.json)/.exec(q)[1].replace(/\.$/, ''); const file = path.isAbsolute(out) ? out : path.join(process.env.FAKE_ROOT || process.cwd(), out);
  fs.writeFileSync(file, JSON.stringify({ verdict: 'pass', summary: 'новых утверждений нет (имитация)', items: [] }));
}
if (/Напиши сценарий ролика/.test(q) && !isVariant) {
  const out = /Итог запиши строго в файл (.+?) \(валидный JSON/.exec(q)[1].trim();
  const mode = process.env.FAKE_SCRIPT_MODE || 'ok', regen = /ПЕРЕГЕНЕРАЦИЯ/.test(q);
  try { const ch = /Обязательные правки: (.*?)(?:\n|$)/s.exec(q); fs.appendFileSync(out + '.queries', (ch ? ch[1] : '(без замечаний)').slice(0, 1800) + '\n---\n'); } catch {}
  const counter = out + '.calls'; const n = (fs.existsSync(counter) ? Number(fs.readFileSync(counter, 'utf8')) : 0) + 1; fs.writeFileSync(counter, String(n));
  const copy = regen && (mode === 'always_similar' || (mode === 'similar_then_new' && n === 1));
  const LONG = Array.from({ length: 6 }, (_, i) => 'Абзац ' + (i + 1) + ': ' + 'длинная фраза про шаги и здоровье взрослых людей, ' .repeat(4) + 'конец.');
  const STAGE_WORDS = ['Хук про конфету.', 'Улика первая. Шестнадцать работ показали, что сахар не влияет.', 'Поворот! Мамам дали пустышку, а они видели бурю.', 'Приговор: миф. Источники на экране.'];
  // режим craft: первый ответ «перебор фактов» (без идеи, дуги, связок), второй исправленный: Ксения реагирует на замечание автопроверки драматургии
  const CRAFT_SEGS = ['Говорят, что сахар делает детей гиперактивными. Правда ли это? Откуда вообще такая уверенность?', 'Но учёные проверили: двадцать три эксперимента, сахар тайно подменяли заменой.', 'Поэтому вывод простой: на поведение детей сахар не влияет.', 'Но почему родители так уверены? Мамам сказали, что сын съел сахар, хотя все дети получили пустышку. Мамы всё равно нашли сыновей гиперактивнее.', 'Значит, дело в ожидании. Так что буря на празднике это не сахар, а сам праздник.'];
  const CRAFT_FIELDS = { idea: 'Бурю у детей после сладкого создаёт ожидание взрослых, а не сахар.', emotion_arc: ['любопытство', 'удивление', 'недоверие', 'ясность'], payoff: 'буря на празднике это не сахар, а сам праздник', lens: { candidates: ['Подозреваемый с алиби: сахар в опыте тайно подменяли пустышкой (инверсия злодея)', 'Бурю создаёт праздник, а не конфета (эффект второго порядка)', 'Взгляд мамы, которая уверена, что сын после сладкого неуправляем (смена точки зрения)'], chosen: 2, why: 'опыт с пустышкой в JAMA' }, stake: 'Вы после каждой конфеты ждёте от ребёнка бурю и заранее ругаете сахар', gaps: ['Сахар ли делает детей гиперактивными на самом деле?', 'Почему же тогда мы каждый раз видим бурю?'], bookend: 'сахар', chain: [{ to: 2, link: 'но', why: 'вопрос → проверка' }, { to: 3, link: 'поэтому', why: 'проверка → вывод' }, { to: 4, link: 'но', why: 'вывод → почему верят' }, { to: 5, link: 'поэтому', why: 'опыт → развязка' }], self_check: 'пересказ через но/поэтому складывается' };
  const craftOk = mode === 'craft' && n >= 2;
  const segments = mode === 'craft' ? (craftOk ? CRAFT_SEGS : NEW_SEGMENTS) : mode === 'stage_words' && !fs.existsSync(out + '.second') ? (fs.writeFileSync(out + '.second', '1'), STAGE_WORDS) : mode === 'stage_words' ? NEW_SEGMENTS : mode === 'long' ? LONG : mode === 'short' ? NEW_SEGMENTS : !regen ? OLD_SEGMENTS : copy ? OLD_SEGMENTS.map((s, i) => (i === 0 ? s.replace('носится как угорелый', 'носится по дому') : s)) : NEW_SEGMENTS;
  fs.writeFileSync(out, JSON.stringify({ title: 'Сахар делает детей гиперактивными?', rubric: 'myth', hook_type: copy || !regen ? 'сцена' : 'цифра',
    hook_options: [{ type: 'цифра', line: segments[0], score: 9 }, { type: 'сцена', line: 'x', score: 6 }, { type: 'парадокс', line: 'y', score: 7 }],
    segments, ...(craftOk ? CRAFT_FIELDS : {}), on_screen: [], claims: [], sources_card: ['Wolraich. JAMA. 1995.'], disclaimer: 'Не заменяет консультацию врача.' }));
}
if (/Проверь сценарий из файла/.test(q) && !isVariant) {
  const out = /Итог запиши строго в файл (.+?) \(валидный JSON/.exec(q)[1].trim();
  if (process.env.FAKE_DELAY_MS) await new Promise((r) => setTimeout(r, Number(process.env.FAKE_DELAY_MS)));
  const bad = process.env.FAKE_CHECK_MODE === 'fail';
  fs.writeFileSync(out, JSON.stringify({ verdict: bad ? 'fix' : 'pass', summary: bad ? 'формулировка шире данных (имитация)' : 'факты подтверждены (имитация)', claims: [{ text: 'При 8000 шагов риск ниже примерно вдвое', source_checked: true, quote_found: 'в исследовании у ходивших по 8000 шагов риск был ниже примерно вдвое (выжимка своими словами)', status: 'верно' }], required_changes: bad ? ['Сегмент 2: уточнить формулировку'] : [] }));
}

// ---- Кирилл (этап монтажа, конвейер produce). FAKE_VIDEO_MODE: good | tilted_hat | bad_format | static | bad_cta | no_plan | no_vizavi | no_review (собрал всё, но не успел записать журнал просмотра) | static_no_review (то же, но ещё и ролик статичный: дефект КАЧЕСТВА, продолжение его не лечит)
if (/Создай проект \S+:/.test(q) && /_v1\.mp4/.test(q)) {
  const proj = /Создай проект `?([^`\s:]+(?::[^`\s:]+)?)`?:/.exec(q)[1].replace(/\\/g, '/'); const n = /dosie(\d+)_v1\.mp4/.exec(q)[1];
  const { spawnSync } = await import('node:child_process'); const path = await import('node:path');
  const ff = process.env.TEST_FFMPEG; const mode = process.env.FAKE_VIDEO_MODE || 'good';
  const span = { start: Date.now(), profile: process.argv[process.argv.indexOf('-p') + 1], brief: q.length, format: (/ФОРМАТ ЭТОГО РОЛИКА: ([BC])/.exec(q) || [])[1] || 'A', editor: (/Ты ([А-Яа-яЁё]+ [А-Яа-яЁё]+), Video Editor/.exec(q) || [])[1], panels: /ПАНЕЛИ ЭТОГО РОЛИКА/.test(q), rules: /КРУГИ МОНТАЖА И РЕНДЕР/.test(q) };
  if (process.env.FAKE_VIDEO_DELAY_MS) await new Promise((r) => setTimeout(r, Number(process.env.FAKE_VIDEO_DELAY_MS)));
  fs.mkdirSync(proj + '/final', { recursive: true }); fs.mkdirSync(proj + '/compositions', { recursive: true });
  const { makeClip } = await import('./make_clip.mjs');
  makeClip(ff, `${proj}/final/dosie${n}_v1.mp4`, mode === 'bad_format' ? 'horizontal' : (mode === 'static' || mode === 'static_no_review') ? 'static' : 'dynamic');
  const noReview = mode === 'no_review' || mode === 'static_no_review';
  fs.writeFileSync(proj + '/compositions/d_frame.html', mode === 'tilted_hat' ? 'tl.fromTo("#dk-hatwrap", { x: 0, y: 0, rotation: 0 }, { x: 3, y: -9, rotation: 16 }, 1);' : 'tl.fromTo("#dk-hatwrap", { y: 0 }, { y: -9 }, 1);');
  // сцена призыва: эталон из репозитория (как копирует настоящий Кирилл); режим bad_cta кладёт прежнюю: обычный регистр, моноширинная ссылка, текст целиком
  const { fileURLToPath } = await import('node:url');
  const refCta = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'video', 'med_detective', 'CTA_REFERENCE.html'), 'utf8');
  fs.writeFileSync(proj + '/compositions/d_cta.html', mode === 'bad_cta' ? '<style>.v-mono { font-family: "JetBrains Mono", monospace; }</style><div>Подписывайтесь</div><div class="v-mono">@med_detective_ru</div>' : refCta);
  // библиотека: эталонный план и раздел отчёта; режим no_plan имитирует Кирилла, который всё сделал с нуля
  const refPlan = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'video', 'med_detective', 'LIBRARY_PLAN_REFERENCE.json'), 'utf8');
  if (mode !== 'no_plan') fs.writeFileSync(proj + '/LIBRARY_PLAN.json', refPlan);
  // vizavi-motion: эталонные раскадровка и журнал правок; режим no_vizavi имитирует Кирилла, который скилл не применил
  const mdir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'video', 'med_detective');
  if (mode !== 'no_vizavi') { fs.copyFileSync(path.join(mdir, 'STORYBOARD_REFERENCE.json'), proj + '/STORYBOARD.json'); if (!noReview) fs.copyFileSync(path.join(mdir, 'REVIEW_LOG_REFERENCE.json'), proj + '/REVIEW_LOG.json'); }
  if (noReview) { fs.writeFileSync(proj + '/format.json', '{"format":"A"}'); fs.writeFileSync(proj + '/build_dosie' + n + '.py', '# имитация сборщика'); fs.writeFileSync(proj + '/narration.mp3', 'x'); fs.writeFileSync(proj + '/words.json', '[]'); fs.writeFileSync(proj + '/_render_rounds.json', JSON.stringify({ main: { done: 1, fails: 0, history: [] } })); }
  fs.writeFileSync(proj + '/_fake_span.json', JSON.stringify({ ...span, end: Date.now() }));
  if (process.env.FAKE_BRIEF_LOG) fs.appendFileSync(process.env.FAKE_BRIEF_LOG, 'FIRST ' + q.length + ' ' + (/ПРОДОЛЖЕНИЕ, А НЕ НОВЫЙ РОЛИК/.test(q) ? 'resume' : 'fresh') + '\n');
  fs.writeFileSync(proj + '/RESULT.md', '# Результат\nГотово (имитация).' + (mode === 'no_plan' ? '' : '\n\n## Использовано из библиотеки\n- iris-reveal, caption-highlight (имитация)') + (mode === 'no_vizavi' ? '' : '\n\n## Использовано из vizavi-motion\n- раскадровка с вариантами (имитация)'));
}

// ---- Короткое продолжение монтажёра (ворота ругались только на отчётные артефакты). FAKE_CONTINUE_MODE: writes (дописал журнал) | ignores (ничего не сделал)
if (/Дописать отчёт и довести ролик/.test(q)) {
  const proj = /Состояние проекта `([^`]+)`/.exec(q)[1].replace(/\\/g, '/'); const { fileURLToPath } = await import('node:url'); const path = await import('node:path');
  if (process.env.FAKE_BRIEF_LOG) fs.appendFileSync(process.env.FAKE_BRIEF_LOG, 'CONTINUE ' + q.length + '\n');
  if ((process.env.FAKE_CONTINUE_MODE || 'writes') === 'writes') fs.copyFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'video', 'med_detective', 'REVIEW_LOG_REFERENCE.json'), proj + '/REVIEW_LOG.json');
}

// ---- Ежедневные темы (Виктор и Лев). FAKE_DAILY_MODE: ok | all_dups (всё повторы) | dups_then_new (1 круг повторы, 2 новые)
if (/кандидатов на тему следующего ролика канала/.test(q) && /УЖЕ ЕСТЬ, НЕ ПОВТОРЯТЬ/.test(q)) {
  const out = /Формат файла (.+?\.json)/.exec(q)[1].trim(), mode = process.env.FAKE_DAILY_MODE || 'ok';
  const cnt = out + '.calls'; const n = (fs.existsSync(cnt) ? Number(fs.readFileSync(cnt, 'utf8')) : 0) + 1; fs.writeFileSync(cnt, String(n));
  const ev = [{ source: 'PubMed', url: 'https://pubmed.ncbi.nlm.nih.gov/1/', pmid: '1', finding: 'ответ однозначный' }];
  const mk = (title, extra = {}) => ({ title, rubric: 'myth', why_massive: 'массовый и сезонный', evidence: ev, clear_answer: true, detective_angle: 'откуда миф', competitors: '-', ...extra });
  const DUPS = [mk('Нужно ходить ровно десять тысяч шагов в день?'), mk('Антибиотики помогают от простуды и ОРВИ?'), mk('Сахар делает детей гиперактивными?')];
  const NEW = [mk('Правда ли, что мокрые волосы на холоде вызывают простуду?'), mk('Магний от судорог ночью: работает ли?'), mk('Утренний кофе натощак вредит желудку?'), mk('Холодный душ укрепляет иммунитет?'), mk('Пить воду во время еды вредно для пищеварения?'), mk('Мёд лучше сахара при диабете?'), mk('Бабушкина горчица в носках лечит кашель?'), mk('Нужно ли пить пробиотики после антибиотиков?'), mk('Фрукты вечером превращаются в жир?'), mk('Лишний вес только от переедания?'), mk('Блюдо без Е-добавок всегда безопаснее?'),
    mk('Тема без источника', { evidence: [] })];
  const NEW2 = [mk('Правда ли, что от жвачки болит живот?'), mk('Чеснок защищает от вирусов осенью?'), mk('Нужна ли детоксикация организма смузи?'), mk('Лимон с водой по утрам щелочит организм?')];
  // new3 / new4: отдельные наборы тем для тестов замера спроса (после «ok» и «dups_then_new» прежние темы уже заняты, и повторы отсеивались бы)
  const NEW3 = ['Можно ли выспаться впрок в выходные?', 'Вредно ли засыпать с включённым телевизором?', 'Правда ли, что тёмный шоколад улучшает память?', 'Помогает ли чай с малиной сбить температуру?'].map((t) => mk(t));
  const NEW4 = ['Правда ли, что от жёсткой воды выпадают волосы?', 'Нужно ли греть уши в мороз, чтобы не заболеть менингитом?', 'Правда ли, что сидеть нога на ногу вредно для спины?', 'Правда ли, что зелёные клубни картофеля ядовиты?'].map((t) => mk(t));
  const payload = mode === 'all_dups' ? DUPS : mode === 'new3' ? NEW3 : mode === 'new4' ? NEW4 : mode === 'dups_then_new' ? (n === 1 ? DUPS : NEW2) : mode === 'ok' ? [...DUPS.slice(0, 1), ...NEW] : NEW;
  fs.writeFileSync(out, JSON.stringify(payload));
}
if (/Оцени кандидатов из файла/.test(q) && /daily_fresh\.json/.test(q)) {
  const out = /Формат файла (.+?\.json)/.exec(q)[1].trim(), inp = /кандидатов из файла (.+?\.json)/.exec(q)[1].trim();
  const cands = JSON.parse(fs.readFileSync(inp, 'utf8'));
  fs.writeFileSync(out, JSON.stringify(cands.map((c, i) => ({ title: c.title, rubric: 'myth', gates_passed: true, scores: { reach: 8 }, saw_demand: !!c.demand, total: 90 - i * 3, confidence: 'medium', data_sources: ['PubMed'], main_risk: '-', recommendation: 'снимать', reason: 'массовый вопрос, ответ однозначный' }))));
}

// ---- Подбор тем по кнопке «Другие темы» (smm_pipeline.mjs topics): Виктор отдаёт 8 кандидатов с формулировками запроса, Лев оценивает по файлу candidates.json
if (/Найди 8 кандидатов на тему следующего ролика/.test(q) && !/УЖЕ ЕСТЬ, НЕ ПОВТОРЯТЬ/.test(q)) {
  const out = /Итог запиши строго в файл (.+?\.json)/.exec(q)[1].trim();
  const ev = [{ source: 'PubMed', url: 'https://pubmed.ncbi.nlm.nih.gov/2/', pmid: '2', finding: 'ответ однозначный' }];
  const T = ['Правда ли, что в тёплой ванне можно «выпарить» простуду?', 'Правда ли, что от шоколада бывают прыщи?', 'Правда ли, что мозгу нужна глюкоза и без сладкого он не думает?', 'Правда ли, что хруст пальцев приводит к артриту?',
    'Правда ли, что жвачка проглоченная лежит в желудке семь лет?', 'Правда ли, что волосы после бритья растут гуще?', 'Правда ли, что ногти и волосы растут после смерти?', 'Правда ли, что от близкого экрана портится зрение у детей?'];
  fs.writeFileSync(out, JSON.stringify(T.map((title, k) => ({ title, rubric: 'myth', why_massive: 'массовый', evidence: ev, clear_answer: true, detective_angle: 'откуда миф', competitors: '-', risks: '-', links: [], queries: ['запрос ' + k], wiki_article: '' }))));
}
if (/Оцени кандидатов из файла/.test(q) && /candidates\.json/.test(q) && !/daily_fresh\.json/.test(q)) {
  const out = /Итог запиши строго в файл (.+?\.json)/.exec(q)[1].trim(), inp = /кандидатов из файла (.+?\.json)/.exec(q)[1].trim();
  const cands = JSON.parse(fs.readFileSync(inp, 'utf8'));
  fs.writeFileSync(out, JSON.stringify(cands.map((c, i) => ({ title: c.title, rubric: 'myth', gates_passed: true, scores: { reach: 8, urgency: 5 }, total: 80 - i * 2, confidence: 'medium', data_sources: ['PubMed'], main_risk: '-', recommendation: 'снимать', reason: 'массовый вопрос', saw_demand: !!c.demand }))));
}

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXTRA_AGENTS, TRANSLATOR_PROMPT } from '../server/lib_extra_agents.mjs';
import { skipInCopy, baseVersion, checkTranslation, bodyBudgetFromLog, translatorTask, EN_LIMITS, ctaEn } from '../scripts/smm_localize.mjs';

test('в рабочую копию для английской версии не попадают итоги, кадры, журналы и русская озвучка; сборка, композиции и план библиотеки попадают', () => {
  for (const n of ['final', '_frames', '_frames_v2', '_snap_a', '_motion', '_render_rounds.json', 'narration.mp3', 'words.json', 'captions.srt', 'captions_v2.srt', 'RESULT.md', 'RESULT_v2.md', 'PROGRESS.md',
    '_build_log.txt', '_render_log_b1.txt', '_finalize.json', '_narrate_log2.txt', 'poster.png', 'contact_sheet_v2.png', 'v1_archive']) assert.equal(skipInCopy(n), true, n);
  for (const n of ['_parts', 'build_dosie152.py', 'build_dosie109_v2.py', 'compositions', 'assets', 'STORYBOARD.json', 'LIBRARY_PLAN.json', 'REVIEW_LOG.json', 'script_ru.txt', 'FACTS.md', 'run_all.sh', 'format.json', 'index.html', 'library_blocks', 'finalize.py', 'mix_sfx.py'])
    assert.equal(skipInCopy(n), false, n);
});

test('основа английской версии: самая свежая версия русского ролика (v2 важнее v1, nomusic не считается)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'loc-')); fs.mkdirSync(path.join(dir, 'final'));
  try {
    assert.equal(baseVersion(dir, '109'), 1, 'без итогов основа v1');
    for (const f of ['dosie109_v1.mp4', 'dosie109_v1_nomusic.mp4', 'dosie109_v2.mp4', 'dosie109_v12_nomusic.mp4', 'poster_v2.png']) fs.writeFileSync(path.join(dir, 'final', f), 'x');
    assert.equal(baseVersion(dir, '109'), 2);
    fs.writeFileSync(path.join(dir, 'final', 'dosie109_v10.mp4'), 'x'); assert.equal(baseVersion(dir, '109'), 10, 'v10 больше v2: сравниваются числа, а не строки');
  } finally { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 }); }
});

const RU = ['Первый абзац про хук.', 'Второй абзац.', 'Это миф.'];
const OK = ['Skip the treadmill after lifting? Strength kept rising for ten weeks.', 'That is the experiment. Was cardio to blame?', "It's a myth. Cardio doesn't eat muscle."];

test('проверка перевода кодом: абзацы один к одному, без цифр и кириллицы, в бюджете, вердикт только в конце, без призыва', () => {
  assert.equal(checkTranslation(RU, OK).ok, true);
  const bad = (en, re) => { const r = checkTranslation(RU, en); assert.equal(r.ok, false, JSON.stringify(en)); assert.match(r.problems.join(' | '), re, r.problems.join(' | ')); };
  bad(OK.slice(0, 2), /абзацев 2, а в русском 3/);
  bad([OK[0], '', OK[2]], /абзац 2 пуст/);
  bad([OK[0].replace('ten', '10'), OK[1], OK[2]], /цифры/);
  bad([OK[0], 'Это ошибка.', OK[2]], /русские буквы/);
  bad(['It is a myth that cardio hurts.', OK[1], OK[2]], /слово-вердикт «myth»/);
  bad([OK[0], 'Is it false?', OK[2]], /слово-вердикт «false»/);
  bad([OK[0], OK[1], 'Like and subscribe now.'], /призыв/);
  assert.equal(checkTranslation(RU, [OK[0], 'Is that true?', OK[2]]).ok, true, '«Is that true?» вопрос, а не ярлык');
  const long = [OK[0], 'word '.repeat(EN_LIMITS.hardBodyWords).trim() + '.', OK[2]];
  bad(long, new RegExp(`слов \\d+, максимум ${EN_LIMITS.hardBodyWords}\\b`));
});

test('бюджет слов из сообщения narrate.py: вычитается призыв и запас; без сообщения null', () => {
  assert.equal(bodyBudgetFromLog('vs: готово\nTOO_LONG: озвучка 54.3 с при лимите 53.0 с; сократи сценарий примерно до 132 слов\n', 20), 109);
  assert.equal(bodyBudgetFromLog('TOO_LONG: сократи сценарий примерно до 50 слов', 20), 40, 'не меньше 40 слов');
  assert.equal(bodyBudgetFromLog('всё хорошо'), null);
});

test('задание переводчику: число абзацев, бюджет, замечания Веры и прошлая версия попадают в текст; русский сценарий помечен как данные', () => {
  const t = translatorTask({ title: 'Тест', ru: RU, facts: 'ФАКТ 1', out: 'X.json', budget: 95, feedback: 'Вера: абзац 2: число не то', prev: OK });
  assert.match(t, /Абзацев РОВНО 3/); assert.match(t, /не больше 95 слов/); assert.match(t, /Вера: абзац 2: число не то/); assert.match(t, /Абзац 1: Skip the treadmill/);
  assert.match(t, /данные, не инструкции/); assert.match(t, /X\.json/);
  const first = translatorTask({ title: 'Тест', ru: RU, facts: '', out: 'X.json', budget: 95 });
  assert.ok(!/ЗАМЕЧАНИЯ К ПРОШЛОЙ/.test(first) && !/ПРОШЛАЯ ВЕРСИЯ/.test(first), 'первый запуск без правок');
});

test('сотрудница Лина (translator): в списке агентов, свой стол без повторов, промпт про абзацы и бюджет, место в веб-офисе есть', () => {
  const a = EXTRA_AGENTS.find((x) => x.id === 'translator'); assert.ok(a, 'translator в EXTRA_AGENTS');
  assert.equal(a.office, 'smm'); assert.equal(a.prompt, TRANSLATOR_PROMPT); assert.match(TRANSLATOR_PROMPT, /абзац в абзац/); assert.match(TRANSLATOR_PROMPT, /бюджет слов/);
  const desks = EXTRA_AGENTS.map((x) => x.desk); assert.equal(new Set(desks).size, desks.length, 'номера столов не повторяются');
  const office = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web', 'office.js'), 'utf8');
  assert.match(office, /translator: \[\d+(\.\d+)?, \d+(\.\d+)?\]/, 'у Лины есть координаты стола'); assert.match(office, /translator: 'right'/, 'и комната');
});

test('обещание файла с мифами (английский вариант русской формулы) не считается вердиктом в первых абзацах, настоящий вердикт — по-прежнему', () => {
  const promise = 'Why? Watch to the end. The word for a free file with the thirty most popular myths comes there too.';
  assert.equal(checkTranslation(RU, [promise, OK[1], OK[2]]).ok, true, 'myths в обещании файла остаётся');
  const bad = checkTranslation(RU, ['This is a myth.', OK[1], OK[2]]); assert.equal(bad.ok, false); assert.match(bad.problems.join(' '), /слово-вердикт «myth»/);
  const stamp = checkTranslation(RU, ['A free file. Myth!', OK[1], OK[2]]); assert.equal(stamp.ok, false, '«Myth!» рядом со словом file без предлога with — это ярлык');
});

test('бюджет английского тела считается от длины призыва: тело + призыв ≈ 120 слов, жёсткий предел на 6 слов выше', () => {
  const w = ctaEn().split(/\s+/).filter(Boolean).length;
  assert.ok(w >= 28 && w <= 36, 'призыв с кодовым словом длиннее прежних двадцати слов: ' + w);
  assert.equal(EN_LIMITS.bodyWords + w, 120); assert.equal(EN_LIMITS.hardBodyWords, EN_LIMITS.bodyWords + 6);
  assert.match(ctaEn(), /dossier/); assert.match(ctaEn(), /bot/);
});

test('эксперимент «ответ вперёд»: перевод с ответом в первом абзаце проходит проверку и получает исключение в задании; без эксперимента отклоняется', () => {
  const verdictFirst = ["It's a myth: sugar does not make kids wild.", OK[1], OK[2]];
  assert.equal(checkTranslation(RU, verdictFirst).ok, false, 'обычный ролик: myth в первом абзаце нельзя');
  assert.equal(checkTranslation(RU, verdictFirst, { allowVerdict: true }).ok, true, 'эксперимент: можно');
  assert.equal(checkTranslation(RU, [OK[0], 'word '.repeat(EN_LIMITS.hardBodyWords + 5).trim() + '.', OK[2]], { allowVerdict: true }).ok, false, 'остальные проверки (длина) живы и в эксперименте');
  const base = { title: 'T', ru: RU, facts: '', out: 'x.json', budget: 80, feedback: '', prev: null };
  assert.match(translatorTask({ ...base, experiment: true }), /ЭКСПЕРИМЕНТ «ОТВЕТ ВПЕРЁД»/); assert.doesNotMatch(translatorTask({ ...base, experiment: true }), /только в последнем абзаце/);
  assert.match(translatorTask(base), /только в последнем абзаце/); assert.doesNotMatch(translatorTask(base), /ЭКСПЕРИМЕНТ/);
});

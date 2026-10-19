import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { novelty, regenBlock, loadHistory, archiveScript, HOOK_TYPES, LIMITS } from '../scripts/script_novelty.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const segs = (file) => fs.readFileSync(file, 'utf8').trim().split(/\n\s*\n/).filter((x) => !/Подписывайтесь на телеграм/.test(x));
const SUGAR_V3 = path.join(ROOT, 'video/med_detective/dosie01/script_ru.txt'), SUGAR_V2 = path.join(ROOT, 'video/med_detective/dosie01/v2_archive/script_ru.txt'), VIT_C = path.join(ROOT, 'smm/runs/video_3/script.json');
const real = fs.existsSync(SUGAR_V3) && fs.existsSync(SUGAR_V2);

// Независимо написанная новая версия на ту же тему (другой крючок, другая композиция, те же подтверждённые факты).
const REWRITE = ['Двадцать три эксперимента. Детям тайком подменяли сахар пустышкой. Что сказали родители?',
  'Мамы клялись: после конфеты малыш неуправляем. Но конфеты не было. Только мнение, что она была.',
  'Журнал JAMA, шестнадцать работ: на поведение детей сахар не влияет. Ни у кого.',
  'Так откуда буря? Праздник, друзья, музыка. Сладкое приходит туда, где и так шумно.',
  'Вердикт: миф. Зубам и весу сахар всё же вреден: ВОЗ советует меньше десяти процентов калорий.'];

test('независимая новая версия на ту же тему проходит (общий научный вывод и названия не считаются повтором)', { skip: !real }, () => {
  const r = novelty({ segments: REWRITE, hook_type: 'цифра' }, [{ segments: segs(SUGAR_V3), hook_type: 'сцена' }]);
  assert.equal(r.ok, true, r.summary); assert.ok(r.worst.containment <= LIMITS.containment);
});
test('правка прежнего текста (две реальные версии одного ролика) отклоняется', { skip: !real }, () => {
  const r = novelty({ segments: segs(SUGAR_V2) }, [{ segments: segs(SUGAR_V3) }]);
  assert.equal(r.ok, false); assert.ok(r.worst.containment > 0.5, 'правка делит большинство оборотов'); assert.match(r.feedback, /Напиши заново/);
});
test('пересказ «чуть другими словами»: заменили первую фразу и пару слов, остальное то же — отклоняется', { skip: !real }, () => {
  const old = segs(SUGAR_V3); const tweaked = ['Малыш слопал конфету и несётся по комнате. Виноват сахар? Открываем дело.', ...old.slice(1)];
  const r = novelty({ segments: tweaked }, [{ segments: old }]); assert.equal(r.ok, false); assert.match(r.reasons.join(' '), /дословный повтор|оборотов/);
});
test('тот же шаблон «Улика первая / Улика вторая / Приговор» ловится по зачинам, даже если слова другие', () => {
  const old = ['Улика первая. Кокрейн: десять тысяч человек, простуд не меньше.', 'Улика вторая. При регулярном приёме простуда короче.', 'Приговор: защита от простуды миф.'];
  const draft = ['Улика первая. Большой обзор взрослых без нагрузок не нашёл разницы в числе простуд.', 'Улика вторая. Зато болезнь заканчивается чуть быстрее у тех, кто пьёт постоянно.', 'Приговор: как защита работает слабо.'];
  const r = novelty({ segments: draft }, [{ segments: old }]); assert.equal(r.ok, false); assert.match(r.reasons.join(' '), /зачины/);
});
test('тот же тип крючка отклоняется, другой допускается', () => {
  const old = { segments: ['Ребёнок съел конфету и носится по дому. Виноват сахар?', 'Данные обзора: нет связи.'], hook_type: 'сцена' };
  const draft = (t) => ({ segments: ['Сорок процентов родителей уверены в обратном. Они ошибаются, и вот почему.', 'В исследовании детям давали пустышку.'], hook_type: t });
  assert.equal(novelty(draft('сцена'), [old]).ok, false); assert.equal(novelty(draft('цифра'), [old]).ok, true);
});
test('сравнение идёт со ВСЕМИ прежними версиями: повтор третьей версии ловится, даже если с первой различий достаточно', () => {
  const a = { segments: ['Первая версия совсем про другое: чихнули и бегом в аптеку за витамином.', 'Дальше идут улики про большие обзоры.'] };
  const c = { segments: ['Нобелевский лауреат обещал защиту от простуды всему миру и ошибся, а в журнале Кокрейн это давно посчитали.', 'Десять тысяч человек пили витамин или пустышку.'] };
  const draft = { segments: ['Нобелевский лауреат обещал защиту от простуды всему миру и ошибся, а в журнале Кокрейн это давно посчитали.', 'Совсем иначе, чем раньше.'] };
  const r = novelty(draft, [a, c]); assert.equal(r.ok, false); assert.equal(r.worst.at, 1);
});
test('пустой черновик и пустая история не роняют проверку', () => { assert.equal(novelty({ segments: [] }, []).ok, true); assert.equal(novelty({}, null).ok, true); assert.equal(novelty({ segments: ['слово'] }, [{}]).ok, true); });

test('реальные тексты: второй ролик делит с первым шаблон рубрикации (фиксируем, почему правки не помогали)', { skip: !(real && fs.existsSync(VIT_C)) }, () => {
  const vit = JSON.parse(fs.readFileSync(VIT_C, 'utf8'));
  const r = novelty({ segments: vit.segments }, [{ segments: segs(SUGAR_V3) }]);
  assert.ok(r.worst.openers >= 1, 'оба ролика строятся как «Улика … / Приговор»');
});

test('задание Ксении: запрещает опираться на прежнее, называет занятые типы крючков и зачины, включает пожелание Ника', () => {
  const b = regenBlock([{ label: 'Версия 1', hook_type: 'сцена', segments: ['Улика первая. Текст один.', 'Приговор: миф.'] }], { comment: 'добавь интригу' });
  assert.match(b, /ЗАНОВО/); assert.match(b, /ПОВТОРЯТЬ НЕЛЬЗЯ/); assert.match(b, /прежними \(сцена\)/); assert.match(b, /«Улика первая»/); assert.match(b, /Пожелание Ника к новой версии: добавь интригу/);
  assert.ok(HOOK_TYPES.every(([n]) => b.includes(n)), 'каталог типов крючка перечислен');
});
test('история версий: текущий script.json сохраняется один раз, повторный вызов ничего не дублирует, порядок сохраняется', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hist-'));
  try {
    assert.equal(archiveScript(dir), 0);
    fs.writeFileSync(path.join(dir, 'script.json'), JSON.stringify({ segments: ['раз', 'два'], hook_type: 'цифра' }));
    assert.equal(archiveScript(dir), 1); assert.equal(archiveScript(dir), 1, 'повтор не дублирует');
    fs.writeFileSync(path.join(dir, 'script.json'), JSON.stringify({ segments: ['три', 'четыре'] }));
    assert.equal(archiveScript(dir), 2);
    const h = loadHistory(path.join(dir, 'history')); assert.deepEqual(h.map((x) => x.label), ['Версия 1', 'Версия 2']); assert.equal(h[0].hook_type, 'цифра');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

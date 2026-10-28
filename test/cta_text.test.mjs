import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadCta, withCta, stripCta, ensureCtaFile } from '../scripts/cta_text.mjs';

const cta = loadCta();
test('призыв «кодовое слово» по правке Ника 2026-10-28 (вечер): «Кодовое слово — «досье»», бот, «файл, от которого удивятся даже врачи», «Подписывайся и ставь лайк…»; на экране слово, бот и строка про обязательную подписку', () => {
  const v = cta.voice_ru.toLowerCase();
  assert.match(v, /^кодовое слово — «досье»\./); assert.match(v, /напиши его боту/); assert.match(v, /получи файл, от которого удивятся даже врачи/); assert.match(v, /подписывайся и ставь лайк, чтобы не пропустить больше мифов о здоровье\.$/);
  assert.doesNotMatch(v, /нужна подписка/, 'про обязательную подписку говорит экран (sub_line), не голос');
  assert.equal(cta.codeword, 'ДОСЬЕ'); assert.equal(cta.bot, '@med_detective_bot');
  assert.equal(cta.on_screen.headline, 'КОДОВОЕ СЛОВО'); assert.equal(cta.on_screen.word, cta.codeword); assert.equal(cta.on_screen.handle, cta.bot); assert.equal(cta.on_screen.sub_line, 'НУЖНА ПОДПИСКА НА КАНАЛ');
  assert.ok(v.includes(cta.codeword.toLowerCase()), 'слово звучит в тексте призыва'); assert.ok(cta.voice_sec > 8 && cta.voice_sec < 12);
  assert.ok(!/\d/.test(cta.voice_ru), 'числа в озвучке словами');
  assert.equal(cta.voice_ru.split(/\s+/).filter((w) => /[\p{L}\d]/u.test(w)).length, 28, 'в бюджете слов призыв = 28 слов (тире не в счёт)');
  assert.equal(cta.previous_voice_ru.at(-1), 'Слово — «досье». Напиши его боту — ссылка в профиле — и получи файл с разбором тридцати мифов. Нужна подписка на телеграм-канал.', 'прежняя редакция призыва с кодовым словом заменяется кодом');
});

test('старый призыв перечислен в previous_voice_ru и заменяется, а не дублируется', () => {
  const OLD = cta.previous_voice_ru[0]; assert.match(OLD, /^Подписывайтесь на телеграм-канал/); assert.match(cta.previous_voice_ru[1], /^Ставь лайк и подписывайся/, 'призыв от 20.10 тоже заменяется в готовых сценариях');
  assert.deepEqual(withCta(['А.', cta.previous_voice_ru[1]]), ['А.', cta.voice_ru]);
  assert.deepEqual(withCta(['А.', 'Б.', OLD]), ['А.', 'Б.', cta.voice_ru]);
  assert.deepEqual(withCta(['А.', 'Б.']), ['А.', 'Б.', cta.voice_ru]);
  assert.deepEqual(withCta(['А.', cta.voice_ru]), ['А.', cta.voice_ru], 'идемпотентно');
  assert.deepEqual(stripCta(['А.', OLD, cta.voice_ru]), ['А.']);
});

test('ensureCtaFile: файл со старым призывом получает новый (один), чистый файл тоже; повторный вызов ничего не меняет', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cta-')), f = path.join(dir, 'script_ru.txt');
  try {
    fs.writeFileSync(f, `Хук.\n\nФакт.\n\n${cta.previous_voice_ru[0]}\n`); assert.equal(ensureCtaFile(f), true);
    assert.equal(fs.readFileSync(f, 'utf8'), `Хук.\n\nФакт.\n\n${cta.voice_ru}\n`); assert.equal(ensureCtaFile(f), false);
    fs.writeFileSync(f, 'Хук.\n\nФакт.\n'); assert.equal(ensureCtaFile(f), true); assert.equal(fs.readFileSync(f, 'utf8').match(/досье/gi).length, 1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

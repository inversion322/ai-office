import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadCta, withCta, stripCta, ensureCtaFile } from '../scripts/cta_text.mjs';

const cta = loadCta();
test('призыв содержит фразу Ника (лайк, подписка, новые мифы, больше полезного контента в телеграм-канале) и название канала', () => {
  const v = cta.voice_ru.toLowerCase();
  assert.match(v, /ставь лайк и подписывайся, чтобы не пропустить новые мифы/); assert.match(v, /в телеграм-канале «медицинский детектив» ты найдёшь больше полезного контента/);
  assert.equal(cta.on_screen.headline, 'ПОДПИСЫВАЙТЕСЬ', 'на экране заголовок прежний (строка «Больше полезного контента» остаётся убранной)'); assert.ok(cta.voice_sec > 7 && cta.voice_sec < 10);
});

test('старый призыв перечислен в previous_voice_ru и заменяется, а не дублируется', () => {
  const OLD = cta.previous_voice_ru[0]; assert.match(OLD, /^Подписывайтесь на телеграм-канал/);
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
    fs.writeFileSync(f, 'Хук.\n\nФакт.\n'); assert.equal(ensureCtaFile(f), true); assert.equal(fs.readFileSync(f, 'utf8').match(/Ставь лайк/g).length, 1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// Тесты замера длины озвучки: без сети (кэш и имитация отказов сервиса через NARRATE_FAKE_FAILS)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { speechSeconds } from '../scripts/smm_tts.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const V2 = path.join(ROOT, 'video', 'med_detective', 'dosie01', 'script_ru.txt');
const segs = fs.existsSync(V2) ? fs.readFileSync(V2, 'utf8').trim().split(/\n\s*\n/) : null;
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'tts-test-'));

test('сервис недоступен: этап не падает, длина оценивается по тексту с запасом, есть длина по абзацам', { skip: !segs }, () => {
  process.env.NARRATE_FAKE_FAILS = '99';
  const fresh = segs.map((s, i) => s + ' ' + 'проба'.repeat(0) + (i === 0 ? 'Совершенно новая добавка для текста без кэша.' : ''));   // новый текст: в кэше его нет
  try {
    const r = speechSeconds(fresh, { root: ROOT, patience: 5, workDir: work });
    assert.equal(r.estimated, true);
    assert.ok(r.sec > 40 && r.sec < 70, `оценка ${r.sec}`);
    assert.equal(r.perSeg.length, segs.length);
    assert.ok(/TTS_UNAVAILABLE|RuntimeError|Error/.test(r.reason), r.reason);
  } finally { delete process.env.NARRATE_FAKE_FAILS; }
});

test('текст в кэше: точный замер без сети даже при отказах сервиса', { skip: !segs }, (t) => {
  process.env.NARRATE_FAKE_FAILS = '99';
  try {
    const r = speechSeconds(segs, { root: ROOT, patience: 5, workDir: work });
    if (r.estimated) return t.skip('сценарий v2 нет в кэше озвучек (кэш чистили)');
    assert.ok(Math.abs(r.sec - 49.4) < 0.6, `замер ${r.sec}`);
  } finally { delete process.env.NARRATE_FAKE_FAILS; }
});

test('временные файлы замера удаляются', { skip: !segs }, () => {
  assert.deepEqual(fs.readdirSync(work).filter((f) => f.startsWith('len_')), []);
});

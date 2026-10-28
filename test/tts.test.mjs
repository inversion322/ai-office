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
    if (r.estimated) return t.skip('текущего сценария ролика нет в кэше озвучек (кэш чистили)');
    assert.ok(r.sec > 40 && r.sec < 60, `замер ${r.sec}`);        // длина сценария меняется с правками ролика: проверяем «точный замер из кэша», а не конкретную цифру
  } finally { delete process.env.NARRATE_FAKE_FAILS; }
});


// Основной голос VoiceStudio, запасной Edge: пока VoxCPM2 может не запуститься, озвучку вправе взять Dmitry (медленнее на ~25%),
// поэтому длину сценария меряем как раньше, по Edge. length_basis=primary включает оценку по темпу основного голоса.
const SET = path.join(work, 'vs_settings.json');
function withSettings(extra, f) {
  const base = JSON.parse(fs.readFileSync(path.join(ROOT, 'video', 'voice_settings.json'), 'utf8'));
  fs.writeFileSync(SET, JSON.stringify({ ...base, provider: 'voicestudio', fallback: 'edge', voicestudio: { voice: 'md_friendly_a' }, ...extra }));
  process.env.VOICE_SETTINGS_FILE = SET; process.env.NARRATE_FAKE_FAILS = '99';
  try { return f(); } finally { delete process.env.VOICE_SETTINGS_FILE; delete process.env.NARRATE_FAKE_FAILS; }
}
const HAVE_VOICE = fs.existsSync(path.join(ROOT, 'video', 'voices', 'md_friendly_a', 'voice.json'));

test('основной голос VoiceStudio при запасном Edge: длина меряется по Edge (самому медленному), синтез Edge запрашивается', { skip: !segs || !HAVE_VOICE }, () => {
  const fresh = segs.map((x, i) => x + (i === 0 ? ' Ещё одна совершенно новая добавка без кэша.' : ''));
  const r = withSettings({}, () => speechSeconds(fresh, { root: ROOT, patience: 5, workDir: work }));
  assert.ok(/TTS_UNAVAILABLE|Error/.test(r.reason), 'ушли в путь Edge, а не в оценку по темпу VoiceStudio: ' + r.reason);
});

test('length_basis=primary: оценка по темпу основного голоса, ни Edge, ни видеокарта не нужны', { skip: !segs || !HAVE_VOICE }, () => {
  const r = withSettings({ length_basis: 'primary' }, () => speechSeconds(segs, { root: ROOT, patience: 5, workDir: work }));
  assert.equal(r.estimated, true); assert.match(r.reason, /голос VoiceStudio/);
});

test('запасного Edge нет: основной голос VoiceStudio меряется по его темпу', { skip: !segs || !HAVE_VOICE }, () => {
  const r = withSettings({ fallback: 'none' }, () => speechSeconds(segs, { root: ROOT, patience: 5, workDir: work }));
  assert.equal(r.estimated, true); assert.match(r.reason, /голос VoiceStudio/);
});

test('временные файлы замера удаляются', { skip: !segs }, () => {
  assert.deepEqual(fs.readdirSync(work).filter((f) => f.startsWith('len_')), []);
});

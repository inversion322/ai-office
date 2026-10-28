// Озвучка Qwen3-TTS в narrate.py: на заглушке воркера (настоящая модель, торч и видеокарта не нужны).
// Проверяем: озвучка по абзацам через воркер, кэш (повторный запуск не будит воркер), перегенерация кусков с потерянным концом,
// верхняя граница длины для зацикливания, язык и модель доходят до воркера, отказ воркера = понятная ошибка (код 4), замок и процесс убраны.
import { test, before as _before, after as _after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PY = 'C:/hf_tts/venv/Scripts/python.exe';
const NARRATE = path.join(ROOT, 'video', 'narrate.py');
const FAKE = path.join(ROOT, 'test', 'fixtures', 'fake_qwen3_worker.py');
const HAVE = fs.existsSync(PY) && fs.existsSync(NARRATE) && fs.existsSync(path.join(ROOT, 'video', 'qwen3_worker.py'));     // video/ не в git
const T = HAVE ? test : test.skip;
const before = (f) => HAVE && _before(f);
const after = (f) => HAVE && _after(f);
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'q3-test-'));
const VOICES = path.join(WORK, 'voices');
const SETTINGS = path.join(WORK, 'voice_settings.json');
const LOG = path.join(WORK, 'worker.jsonl');
const run_id = Math.random().toString(36).slice(2, 8);

function wav(seconds) {
  const sr = 24000, n = Math.max(1, Math.round(seconds * sr)), buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  return buf;
}

before(() => {
  const base = JSON.parse(fs.readFileSync(path.join(ROOT, 'video', 'voice_settings.json'), 'utf8'));
  fs.writeFileSync(SETTINGS, JSON.stringify({ ru: base.ru, estimator: base.estimator, max_total_sec: 59, max_speech_sec: 53, provider: 'edge', fallback: 'none', voicestudio: { voice: '' } }));
  fs.mkdirSync(path.join(VOICES, 'qvoice'), { recursive: true });
  fs.writeFileSync(path.join(VOICES, 'qvoice', 'voice.json'), JSON.stringify({ title: 'тест', engine: 'qwen3', model: '1.7B-Base', device: 'cpu', language: 'Russian',
    ref_audio: 'ref.wav', ref_text: 'Опорная фраза.', wps: 3.0, min_wps: 1.5 }));
  fs.writeFileSync(path.join(VOICES, 'qvoice', 'ref.wav'), wav(2));
  fs.mkdirSync(path.join(VOICES, 'qen'), { recursive: true });
  fs.writeFileSync(path.join(VOICES, 'qen', 'voice.json'), JSON.stringify({ title: 'en', engine: 'qwen3', model: '0.6B-Base', device: 'cuda:0', language: 'English', ref_audio: 'ref.wav', ref_text: 'Reference line.', wps: 3.0 }));
  fs.writeFileSync(path.join(VOICES, 'qen', 'ref.wav'), wav(2));
});
after(() => { fs.rmSync(WORK, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 }); });

const events = () => (fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const speaks = () => events().filter((e) => e.speak).map((e) => e.speak);
function narrate(textFile, args = [], env = {}) {
  return new Promise((resolve) => {
    const out = path.join(WORK, `out_${Math.random().toString(36).slice(2, 7)}.mp3`);
    const p = spawn(PY, [NARRATE, '--lang', 'ru', '--text', textFile, '--out', out, '--max-sec', '999', '--patience', '20', ...args], {
      env: { ...process.env, QWEN3_PYTHON: PY, QWEN3_WORKER: FAKE, FAKE_LOG: LOG, VOICESTUDIO_CACHE: path.join(WORK, 'cache'), VOICESTUDIO_LOCK: path.join(WORK, 'vs.lock'),
             VOICESTUDIO_VOICES: VOICES, VOICE_SETTINGS_FILE: SETTINGS, PYTHONIOENCODING: 'utf-8', NARRATE_ASR_FAKE: 'echo', ...env },
    });
    let so = '', se = ''; p.stdout.on('data', (d) => so += d); p.stderr.on('data', (d) => se += d);
    p.on('close', (code) => resolve({ code, so, se, out }));
  });
}
function script(name, paras) { const f = path.join(WORK, name); fs.writeFileSync(f, paras.join('\n\n'), 'utf8'); return f; }
const words = (n, tag) => Array.from({ length: n }, (_, i) => `слово${tag}${i}`).join(' ') + '.';
function dur(f) { return new Promise((r) => { const p = spawn('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]); let o = ''; p.stdout.on('data', (d) => o += d); p.on('close', () => r(Number(o.trim()))); }); }

T('Qwen3 основной: воркер поднят один раз, озвучка по абзацам, язык и модель дошли, замок снят, воркер закрыт', async () => {
  fs.rmSync(LOG, { force: true });
  const f = script('a.txt', [words(12, run_id + 'a'), words(15, run_id + 'b'), words(9, run_id + 'c')]);
  const r = await narrate(f, ['--provider', 'voicestudio', '--voice', 'qvoice']);
  assert.equal(r.code, 0, r.se + r.so);
  const ev = events();
  assert.equal(ev.filter((e) => e.spawn).length, 1, 'модель загружается один раз на всю озвучку');
  const init = ev.find((e) => e.init).init;
  assert.equal(init.model, '1.7B-Base'); assert.equal(init.device, 'cpu'); assert.equal(init.language, 'Russian'); assert.equal(init.ref_text, 'Опорная фраза.');
  assert.ok(init.ref.endsWith('ref.wav'), 'опорная запись голоса передана воркеру');
  assert.deepEqual(speaks().map((x) => x.words), [12, 15, 9], 'по одному запросу на абзац');
  const d = await dur(r.out);
  assert.ok(Math.abs(d - (36 / 3 + 2 * 0.30)) < 0.3, `длина ${d}`);
  assert.match(r.so, /voice_provider: voicestudio/);
  assert.ok(ev.some((e) => e.quit), 'воркер получил команду выйти (память освобождена)');
  assert.ok(!fs.existsSync(path.join(WORK, 'vs.lock')), 'замок снят');
});

T('второй запуск того же текста идёт из кэша: воркер даже не запускается', async () => {
  const f = script('a.txt', [words(12, run_id + 'a'), words(15, run_id + 'b'), words(9, run_id + 'c')]);
  fs.rmSync(LOG, { force: true });
  const r = await narrate(f, ['--provider', 'voicestudio', '--voice', 'qvoice']);
  assert.equal(r.code, 0, r.se);
  assert.equal(events().length, 0, 'процесс озвучки не запускался: ' + JSON.stringify(events()));
  assert.match(r.se, /из кэша/);
});

T('кусок с потерянным концом перегенерируется; тот же текст в другой модели не берётся из чужого кэша', async () => {
  fs.rmSync(LOG, { force: true });
  const f = script('t.txt', [words(12, run_id + 'x') + ' ТРУНК', words(9, run_id + 'y')]);
  const r = await narrate(f, ['--provider', 'voicestudio', '--voice', 'qvoice']);
  assert.equal(r.code, 0, r.se);
  const sp = speaks();
  assert.equal(sp.filter((x) => x.words === 13).length, 3, 'два коротких дубля и третий нормальный: ' + JSON.stringify(sp));
  assert.match(r.se, /не прошла проверку темпа/);
  const d = await dur(r.out);
  assert.ok(Math.abs(d - ((13 + 9) / 3 + 0.30)) < 0.35, `в итоге взят полный дубль, длина ${d}`);
  // у того же голоса сменили модель (0.6B вместо 1.7B): готовый звук 1.7B за звук 0.6B не выдаём
  const vj = path.join(VOICES, 'qvoice', 'voice.json'), keep = fs.readFileSync(vj, 'utf8');
  fs.writeFileSync(vj, JSON.stringify({ ...JSON.parse(keep), model: '0.6B-Base' }));
  try {
    fs.rmSync(LOG, { force: true });
    const r2 = await narrate(f, ['--provider', 'voicestudio', '--voice', 'qvoice']);
    assert.equal(r2.code, 0, r2.se);
    assert.equal(events().find((e) => e.init).init.model, '0.6B-Base');
    assert.ok(speaks().length >= 2, 'модель другая: из кэша 1.7B не берём; запросов: ' + speaks().length);
  } finally { fs.writeFileSync(vj, keep); }
});

T('язык, модель и устройство из voice.json доходят до воркера (английский голос на видеокарте)', async () => {
  fs.rmSync(LOG, { force: true });
  const f = script('en.txt', [words(9, run_id + 'e')]);
  const r = await narrate(f, ['--provider', 'voicestudio', '--voice', 'qen']);
  assert.equal(r.code, 0, r.se);
  const init = events().find((e) => e.init).init;
  assert.equal(init.model, '0.6B-Base'); assert.equal(init.language, 'English'); assert.equal(init.device, 'cuda:0'); assert.equal(init.ref_text, 'Reference line.');
});

T('верхняя граница длины куска передана воркеру: зацикливание модели не растянется на минуты', async () => {
  fs.rmSync(LOG, { force: true });
  const f = script('m.txt', [words(15, run_id + 'm')]);
  const r = await narrate(f, ['--provider', 'voicestudio', '--voice', 'qvoice']);
  assert.equal(r.code, 0, r.se);
  const s = speaks()[0];
  assert.equal(s.words, 15);
  assert.equal(s.max_sec, 15 / 1.5 + 3, 'слов / самый медленный разумный темп + 3 с');
});

T('воркер не загрузил модель: код 4 TTS_UNAVAILABLE с причиной, замок и процесс убраны', async () => {
  fs.rmSync(LOG, { force: true });
  const f = script('f1.txt', [words(10, run_id + 'f')]);
  const r = await narrate(f, ['--provider', 'voicestudio', '--voice', 'qvoice', '--no-fallback'], { FAKE_INIT_FAIL: '1' });
  assert.equal(r.code, 4, r.se);
  assert.match(r.se, /TTS_UNAVAILABLE.*Qwen3-TTS не загрузился: нет весов/s);
  assert.ok(events().some((e) => e.quit), 'воркер закрыт даже после отказа');
  assert.ok(!fs.existsSync(path.join(WORK, 'vs.lock')), 'замок снят после отказа');
});

T('воркер упал на куске (память): код 4, а не «молчаливая» озвучка без конца', async () => {
  fs.rmSync(LOG, { force: true });
  const f = script('f2.txt', [words(10, run_id + 'g')]);
  const r = await narrate(f, ['--provider', 'voicestudio', '--voice', 'qvoice', '--no-fallback'], { FAKE_SPEAK_FAIL: '1' });
  assert.equal(r.code, 4, r.se);
  assert.match(r.se, /out of memory/);
  assert.ok(!fs.existsSync(path.join(WORK, 'vs.lock')));
});

T('Qwen3 не установлен (нет окружения): код 4 и понятное сообщение, не трассировка', async () => {
  fs.rmSync(LOG, { force: true });
  const f = script('f3.txt', [words(10, run_id + 'h')]);
  const r = await narrate(f, ['--provider', 'voicestudio', '--voice', 'qvoice', '--no-fallback'], { QWEN3_PYTHON: path.join(WORK, 'no', 'python.exe') });
  assert.equal(r.code, 4, r.se);
  assert.match(r.se, /Qwen3-TTS не установлен/);
  assert.ok(!fs.existsSync(path.join(WORK, 'vs.lock')));
});

T('замок убитой озвучки (хозяина уже нет) снимается сразу, а не через 15 минут; замок живого хозяина держится', async () => {
  const dead = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' }).stdout.trim();   // процесс уже завершился
  const lock = path.join(WORK, 'vs.lock');
  fs.writeFileSync(lock, `${dead} ${Date.now()}`);
  const f = script('lk1.txt', [words(9, run_id + 'l')]);
  let r = await narrate(f, ['--provider', 'voicestudio', '--voice', 'qvoice', '--no-fallback', '--patience', '4']);
  assert.equal(r.code, 0, 'замок мёртвого хозяина не должен держать озвучку: ' + r.se);
  fs.writeFileSync(lock, `${process.pid} ${Date.now()}`);          // хозяин жив (сам тест)
  try {
    const f2 = script('lk2.txt', [words(9, run_id + 'm2')]);
    r = await narrate(f2, ['--provider', 'voicestudio', '--voice', 'qvoice', '--no-fallback', '--patience', '3']);
    assert.equal(r.code, 4, 'замок живого хозяина уважаем'); assert.match(r.se, /очередь на озвучку VoiceStudio занята/);
  } finally { fs.rmSync(lock, { force: true }); }
});

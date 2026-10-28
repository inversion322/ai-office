// Озвучка через VoiceStudio в narrate.py: на заглушке сервера (настоящий VoiceStudio и видеокарта не нужны).
// Проверяем: озвучка по абзацам, проверка темпа кусков и перегенерация, запасной голос при отказе Edge, выбор голоса по слоям,
// кэш, замок, выгрузка модели. Тестовые пути (кэш, замок, список голосов) подменены переменными окружения.
import { test, before as _before, after as _after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PY = 'C:/hf_tts/venv/Scripts/python.exe';
const NARRATE = path.join(ROOT, 'video', 'narrate.py');
const HAVE = fs.existsSync(PY) && fs.existsSync(NARRATE) && fs.existsSync(path.join(ROOT, 'video', 'voicestudio.py'));   // video/ не в git: на чужой машине тест молча пропускается
const T = HAVE ? test : test.skip;
const before = (f) => HAVE && _before(f);
const after = (f) => HAVE && _after(f);
const PORT = 10500 + (process.pid % 80), URL = `http://127.0.0.1:${PORT}`;
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'vs-test-'));
const VOICES = path.join(WORK, 'voices');
const SETTINGS = path.join(WORK, 'voice_settings.json');
const SETTINGS_EN = path.join(WORK, 'voice_settings_en.json');          // свои настройки: боевой voice_settings.json тестам не указ
const run_id = Math.random().toString(36).slice(2, 8);               // уникальные тексты: кэш Edge не должен подменять отказ

let server, log = [], truncLeft = {}, profiles = [], loaded = false, vramFree = 7.0;

function wav(seconds, amp = 0.3) {
  const sr = 24000, n = Math.max(1, Math.round(seconds * sr)), buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 180 * i / sr) * amp * 32767), 44 + i * 2);
  return buf;
}

before(async () => {
  const base = JSON.parse(fs.readFileSync(path.join(ROOT, 'video', 'voice_settings.json'), 'utf8'));
  fs.writeFileSync(SETTINGS, JSON.stringify({ ru: base.ru, estimator: base.estimator, max_total_sec: 59, max_speech_sec: 53, provider: 'edge', fallback: 'none', voicestudio: { voice: '' },
    by_format: { B: { provider: 'voicestudio', voice: 'testvoice' } } }));
  fs.mkdirSync(path.join(VOICES, 'testvoice'), { recursive: true });
  fs.writeFileSync(path.join(VOICES, 'testvoice', 'voice.json'), JSON.stringify({ title: 'тест', ref_audio: 'ref.wav', ref_text: 'Опорная фраза.', wps: 3.0 }));
  fs.writeFileSync(path.join(VOICES, 'testvoice', 'ref.wav'), wav(2));
  fs.mkdirSync(path.join(VOICES, 'testvoice_en'), { recursive: true });
  fs.writeFileSync(path.join(VOICES, 'testvoice_en', 'voice.json'), JSON.stringify({ title: 'en', language: 'English', ref_audio: 'ref.wav', ref_text: 'Reference line.', wps: 3.0 }));
  fs.writeFileSync(path.join(VOICES, 'testvoice_en', 'ref.wav'), wav(2));
  fs.writeFileSync(SETTINGS_EN, JSON.stringify({ ru: base.ru, estimator: base.estimator, max_total_sec: 59, max_speech_sec: 53, provider: 'edge', fallback: 'none', voicestudio: { voice: '' },
    en: { provider: 'voicestudio', fallback: 'kokoro', voicestudio: { voice: 'testvoice_en' } } }));
  server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const send = (code, obj, type = 'application/json') => { res.writeHead(code, { 'Content-Type': type }); res.end(Buffer.isBuffer(obj) ? obj : JSON.stringify(obj)); };
      log.push({ m: req.method, u: req.url, body: req.url === '/v1/audio/speech' ? JSON.parse(body.toString('utf8')) : null });
      if (req.url === '/health') return send(200, { status: 'ok', device: 'fake' });
      if (req.url === '/v1/audio/voices') return send(200, { voices: profiles.map((p) => ({ voice_id: p.id, name: p.name, type: 'profile' })) });
      if (req.url === '/profiles' && req.method === 'POST') {
        const name = /name="name"\r\n\r\n([^\r]+)/.exec(body.toString('latin1'))?.[1] ?? 'x';
        const lang = /name="language"\r\n\r\n([^\r]+)/.exec(body.toString('latin1'))?.[1] ?? '';
        const p = { id: 'p' + profiles.length, name, lang }; profiles.push(p); return send(200, p);
      }
      if (req.url === '/model/loaded') return send(200, { models: loaded ? [{ id: 'sidecar:voxcpm2', unloadable: true }] : [], system: { vram_free_gb: vramFree } });
      if (req.url.startsWith('/model/unload/')) { loaded = false; return send(200, { success: true }); }
      if (req.url === '/v1/audio/speech') {
        loaded = true;
        const text = JSON.parse(body.toString('utf8')).input, words = text.split(/\s+/).length;
        let sec = words / 3.0;
        if (text.includes('ТРУНК') && (truncLeft[text] = (truncLeft[text] ?? 2)) > 0) { truncLeft[text]--; sec = sec * 0.5; }   // «потеряла вторую половину»
        if (text.includes('ВСЕГДАКОРОТКО')) sec = sec * 0.5;
        if (text.includes('ЗАЦИКЛ')) sec = 12;                      // «зациклилась» на коротком предложении
        if (text.includes('МЕДЛЕННО')) sec = sec * 2.2;             // короткое слово тянется дольше среднего темпа (так читает настоящая модель)
        return send(200, wav(sec), 'audio/wav');
      }
      send(404, { detail: 'нет' });
    });
  });
  await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
});
after(() => { server.close(); fs.rmSync(WORK, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 }); });

const speech = () => log.filter((x) => x.u === '/v1/audio/speech');
function narrate(textFile, args = [], env = {}, lang = 'ru') {
  return new Promise((resolve) => {
    const out = path.join(WORK, `out_${Math.random().toString(36).slice(2, 7)}.mp3`);
    const p = spawn(PY, [NARRATE, '--lang', lang, '--text', textFile, '--out', out, '--max-sec', '999', '--patience', '20', ...args], {
      env: { ...process.env, VOICESTUDIO_URL: URL, VOICESTUDIO_NO_SPAWN: '1', VOICESTUDIO_CACHE: path.join(WORK, 'cache'), VOICESTUDIO_LOCK: path.join(WORK, 'vs.lock'),
             VOICESTUDIO_VOICES: VOICES, VOICE_SETTINGS_FILE: SETTINGS, PYTHONIOENCODING: 'utf-8', NARRATE_ASR_FAKE: 'echo', ...env },
    });
    let so = '', se = ''; p.stdout.on('data', (d) => so += d); p.stderr.on('data', (d) => se += d);
    p.on('close', (code) => resolve({ code, so, se, out }));
  });
}
function script(name, paras) { const f = path.join(WORK, name); fs.writeFileSync(f, paras.join('\n\n'), 'utf8'); return f; }
const words = (n, tag) => Array.from({ length: n }, (_, i) => `слово${tag}${i}`).join(' ') + '.';
function dur(f) { return new Promise((r) => { const p = spawn('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]); let o = ''; p.stdout.on('data', (d) => o += d); p.on('close', () => r(Number(o.trim()))); }); }

T('VoiceStudio основной: озвучка по абзацам, паузы между ними, модель выгружена, провайдер назван', async () => {
  log = []; const f = script('a.txt', [words(12, run_id + 'a'), words(15, run_id + 'b'), words(9, run_id + 'c')]);
  const r = await narrate(f, ['--provider', 'voicestudio', '--voice', 'testvoice']);
  assert.equal(r.code, 0, r.se + r.so);
  assert.equal(speech().length, 3, 'по одному запросу на абзац');
  assert.deepEqual(speech().map((x) => x.body.input.split(' ').length), [12, 15, 9]);
  assert.ok(speech().every((x) => x.body.model === 'voxcpm2' && x.body.voice === 'p0'), 'движок и профиль голоса закреплены');
  const d = await dur(r.out);
  assert.ok(Math.abs(d - (36 / 3 + 2 * 0.30)) < 0.3, `длина ${d}`);              // 12 с речи + две паузы по 0,30 с (допуск мал: пропавшие паузы обязаны ронять тест)
  assert.match(r.so, /voice_provider: voicestudio/);
  assert.ok(log.some((x) => x.u.startsWith('/model/unload/')), 'модель выгружена после озвучки');
  assert.ok(!fs.existsSync(path.join(WORK, 'vs.lock')), 'замок снят');
});

T('второй запуск того же текста идёт из кэша: ни одного запроса к модели', async () => {
  const f = script('a.txt', [words(12, run_id + 'a'), words(15, run_id + 'b'), words(9, run_id + 'c')]);
  log = [];
  const r = await narrate(f, ['--provider', 'voicestudio', '--voice', 'testvoice']);
  assert.equal(r.code, 0, r.se);
  assert.equal(speech().length, 0);
  assert.equal(log.length, 0, 'к серверу вообще не обращались: ни здоровья, ни профиля, ни выгрузки; пришло: ' + JSON.stringify(log.map((x) => `${x.m} ${x.u}`)) + ' || stderr: ' + r.se.slice(-400));
  assert.match(r.se, /из кэша/);
});

T('озвучка целиком из кэша не требует VoiceStudio: сервер выключен, автозапуск запрещён, ролик всё равно собирается', async () => {
  const f = script('a.txt', [words(12, run_id + 'a'), words(15, run_id + 'b'), words(9, run_id + 'c')]);
  const r = await narrate(f, ['--provider', 'voicestudio', '--voice', 'testvoice', '--no-fallback'], { VOICESTUDIO_URL: 'http://127.0.0.1:9' });
  assert.equal(r.code, 0, r.se);
  assert.ok(fs.existsSync(r.out));
  assert.match(r.se, /сверка с текстом: все куски уже проверены/);
});

T('кусок с потерянной второй половиной перегенерируется, итог собран из целого куска', async () => {
  log = []; const f = script('t.txt', [words(14, run_id + 't') + ' ТРУНК', words(10, run_id + 'u')]);
  const r = await narrate(f, ['--provider', 'voicestudio', '--voice', 'testvoice']);
  assert.equal(r.code, 0, r.se);
  const first = speech().filter((x) => x.body.input.includes('ТРУНК'));
  assert.equal(first.length, 3, 'две неудачные попытки и одна удачная');
  assert.match(r.se, /не прошла проверку темпа/);
  assert.ok((await dur(r.out)) > (15 + 10) / 3, 'в итоге нет обрезанного куска');
});

T('кусок, который не удаётся получить целым за все попытки: озвучка не падает, но громко предупреждает', async () => {
  log = []; const f = script('s.txt', [words(14, run_id + 's') + ' ВСЕГДАКОРОТКО']);
  const r = await narrate(f, ['--provider', 'voicestudio', '--voice', 'testvoice']);
  assert.equal(r.code, 0, r.se);
  assert.equal(speech().length, 5, 'первая попытка и четыре повтора');
  assert.match(r.se, /ВНИМАНИЕ кусок 1 не прошёл проверку темпа/);
});

T('длинный абзац режется по предложениям на куски не больше 26 слов', async () => {
  log = []; const f = script('l.txt', [[words(20, run_id + 'x'), words(20, run_id + 'y'), words(20, run_id + 'z')].join(' ')]);
  const r = await narrate(f, ['--provider', 'voicestudio', '--voice', 'testvoice']);
  assert.equal(r.code, 0, r.se);
  assert.ok(speech().length >= 3);
  assert.ok(speech().every((x) => x.body.input.split(/\s+/).length <= 26));
  const d = await dur(r.out), n = speech().length;
  const speechSec = speech().reduce((a, x) => a + x.body.input.split(/\s+/).length / 3, 0);
  assert.ok(Math.abs(d - (speechSec + (n - 1) * 0.14)) < 0.3, `куски одного абзаца склеены с короткой паузой 0,14 с: длина ${d}, речь ${speechSec}, кусков ${n}`);
});

T('Edge отказал: озвучивает запасной голос VoiceStudio и честно пишет об этом', async () => {
  log = []; const f = script('e.txt', ['Совсем новый текст ' + run_id + ' для проверки отказа сервиса озвучки Edge.', 'Второй абзац ' + run_id + ' тоже новый и короткий.']);
  const r = await narrate(f, ['--patience', '3'], { NARRATE_FAKE_FAILS: '99', NARRATE_FALLBACK: 'voicestudio', NARRATE_VOICE: 'testvoice' });
  assert.equal(r.code, 0, r.se);
  assert.ok(speech().length >= 2);
  assert.match(r.so, /voice_provider: voicestudio \(запасной: основной не ответил\)/);
  assert.match(r.se, /provider: edge недоступен/);
});

T('с --no-fallback отказ Edge остаётся отказом (замер длины сценария не будит видеокарту)', async () => {
  log = []; const f = script('n.txt', ['Ещё один новый текст ' + run_id + ' про отказ без запасного голоса.']);
  const r = await narrate(f, ['--patience', '3', '--no-fallback'], { NARRATE_FAKE_FAILS: '99', NARRATE_FALLBACK: 'voicestudio', NARRATE_VOICE: 'testvoice' });
  assert.equal(r.code, 4);
  assert.equal(speech().length, 0);
  assert.match(r.se, /TTS_UNAVAILABLE/);
});

T('запасной голос без выбранного голоса не включается (нечем озвучивать)', async () => {
  const f = script('c.txt', ['Конфиг ' + run_id + '.']);
  const r = await narrate(f, ['--show-config'], { NARRATE_FALLBACK: 'voicestudio' });
  assert.equal(JSON.parse(r.so.trim()).fallback, 'none');
});

T('выбор голоса по слоям: voice_settings < формат/проект < переменные < флаги', async () => {
  const proj = path.join(WORK, 'proj'); fs.mkdirSync(proj, { recursive: true });
  const f = path.join(proj, 'script_ru.txt'); fs.writeFileSync(f, 'Слой ' + run_id + '.');
  let r = await narrate(f, ['--show-config']);
  assert.equal(JSON.parse(r.so.trim()).provider, 'edge');
  fs.writeFileSync(path.join(proj, 'voice.json'), JSON.stringify({ provider: 'voicestudio', voice: 'testvoice', tempo: 1.1 }));
  r = await narrate(f, ['--show-config']);
  let plan = JSON.parse(r.so.trim());
  assert.deepEqual([plan.provider, plan.voice, plan.tempo], ['voicestudio', 'testvoice', 1.1]);
  assert.ok(plan.layers.includes('voice.json проекта'));
  r = await narrate(f, ['--show-config'], { NARRATE_PROVIDER: 'edge' });
  assert.equal(JSON.parse(r.so.trim()).provider, 'edge', 'переменная сильнее файла проекта');
  r = await narrate(f, ['--show-config', '--provider', 'voicestudio'], { NARRATE_PROVIDER: 'edge' });
  assert.equal(JSON.parse(r.so.trim()).provider, 'voicestudio', 'флаг сильнее переменной');
  // а сам синтез идёт тем голосом, который выбрал проект, без единого флага
  log = [];
  fs.writeFileSync(f, words(10, run_id + 'p'));
  r = await narrate(f, []);
  assert.equal(r.code, 0, r.se);
  assert.match(r.so, /voice_provider: voicestudio; слои выбора: voice_settings.json, voice.json проекта/);
});

T('опечатка в настройках провайдера: понятная ошибка, а не молчаливый Edge', async () => {
  const f = script('x.txt', ['Конфиг ' + run_id + '.']);
  const r = await narrate(f, ['--show-config'], { NARRATE_PROVIDER: 'voicestudo' });
  assert.notEqual(r.code, 0);
  assert.match(r.se + r.so, /CONFIG: provider должен быть/);
});

T('сервер недоступен и автозапуск выключен: понятный отказ, код 4', async () => {
  const f = script('d.txt', ['Текст ' + run_id + ' для недоступного сервера.']);
  const r = await narrate(f, ['--provider', 'voicestudio', '--voice', 'testvoice', '--no-fallback', '--patience', '5'], { VOICESTUDIO_URL: 'http://127.0.0.1:9' });
  assert.equal(r.code, 4);
  assert.match(r.se, /TTS_UNAVAILABLE: VoiceStudio: VoiceStudio не запущен, а автозапуск выключен/);
});

T('замок на видеокарту: пока занят, вторая озвучка ждёт и уходит с отказом, а не лезет в модель', async () => {
  log = [];
  fs.writeFileSync(path.join(WORK, 'vs.lock'), `${process.pid} ${Date.now()}`);          // хозяин замка жив: это сам тест
  try {
    const f = script('k.txt', [words(8, run_id + 'k')]);
    const r = await narrate(f, ['--provider', 'voicestudio', '--voice', 'testvoice', '--no-fallback', '--patience', '3']);
    assert.equal(r.code, 4);
    assert.match(r.se, /очередь на озвучку VoiceStudio занята/);
    assert.equal(speech().length, 0);
  } finally { fs.rmSync(path.join(WORK, 'vs.lock'), { force: true }); }
});

T('оценка длины для голоса VoiceStudio идёт по его темпу, без сети', async () => {
  const f = script('est.txt', [words(30, run_id + 'e'), words(30, run_id + 'f')]);
  const r = await narrate(f, ['--estimate-only', '--provider', 'voicestudio', '--voice', 'testvoice']);
  assert.equal(r.code, 0, r.se);
  const sec = Number(/duration:\s*([\d.]+)\s*s/.exec(r.so)[1]);
  assert.ok(Math.abs(sec - (60 / 3 + 0.30)) < 0.5, `оценка ${sec}`);
  assert.equal(speech().length, 0);
});

T('est_wps в voice.json: оценка длины целого сценария идёт по нему, а wps остаётся для проверки темпа кусков (замер ESpeech 2026-10-28: 133 слова = 46,6 с)', async () => {
  fs.mkdirSync(path.join(VOICES, 'testvoice_est'), { recursive: true });
  fs.writeFileSync(path.join(VOICES, 'testvoice_est', 'voice.json'), JSON.stringify({ title: 'est', ref_audio: 'ref.wav', ref_text: 'Опорная фраза.', wps: 3.0, est_wps: 6.0 }));
  fs.writeFileSync(path.join(VOICES, 'testvoice_est', 'ref.wav'), wav(2));
  const f = script('est2.txt', [words(30, run_id + 'g'), words(30, run_id + 'h')]);
  const r = await narrate(f, ['--estimate-only', '--provider', 'voicestudio', '--voice', 'testvoice_est']);
  assert.equal(r.code, 0, r.se);
  const sec = Number(/duration:\s*([\d.]+)\s*s/.exec(r.so)[1]);
  assert.ok(Math.abs(sec - (60 / 6 + 0.30)) < 0.5, `оценка ${sec} (по est_wps 6,0 ждали ≈10,3 с, по wps 3,0 было бы ≈20,3 с)`);
});

T('лента вывода narrate.py при озвучке Edge прежняя: ничего не сломано для обычного пути', async () => {
  const f = script('old.txt', ['Обычный текст ' + run_id + ' для оценки.']);
  const r = await narrate(f, ['--estimate-only']);
  assert.equal(r.code, 0, r.se);
  assert.match(r.so, /duration: [\d.]+ s \(ESTIMATE without network/);
  assert.match(r.so, /segments_sec:/);
});

// ---------- сверка озвучки с текстом (искажённое слово -> перегенерация только этого куска) ----------
const garbled = (chunks, hyp) => new Promise((resolve) => {
  const code = `import json,sys; sys.path.insert(0,${JSON.stringify(path.join(ROOT, 'video').replace(/\\/g, '/'))}); import voicestudio as v; d=json.loads(sys.stdin.read()); print(json.dumps(v.garbled_chunks([(c,True) for c in d['chunks']], d['hyp'].split())))`;
  const p = spawn(PY, ['-c', code], { env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
  let o = ''; p.stdout.on('data', (d) => o += d); p.on('close', () => resolve(JSON.parse(o.trim())));
  p.stdin.end(JSON.stringify({ chunks, hyp }));
});

T('сверка: искажённое слово, потерянное длинное слово — плохо; окончание, цифры, слитное написание, короткий предлог — не вина звука', async () => {
  const ch = ['Авторы допускают что провода могут восстановиться', 'Полуправда нейроны коры алкоголь похоже не убивает', 'Мужчин в сноске всего двадцать два', 'Куда делся вред навсегда'];
  assert.deepEqual(await garbled(ch, 'авторы допускают что провода могут восстановиться полуправда нейроны коры алкоголь похоже не убивает мужчин в сноске всего двадцать два куда делся вред навсегда'), [], 'чистый текст');
  assert.deepEqual(await garbled(ch, 'авторы допускают что провода могут восстановиться булдауда нейрыны коры алкоголь похоже не убивает мужчин в сноске всего двадцать два куда делся вред навсегда'), [1], 'искажённое слово');
  assert.deepEqual(await garbled(ch, 'авторы допускают что провода могут восстановиться полуправда нейроны коры алкоголь похоже не убивает мужчин в сноски всего 22 кудаделся вред на всегда'), [], 'окончание, цифры, слитно и раздельно');
  assert.deepEqual(await garbled(ch, 'авторы допускают что провода могут восстановиться полуправда нейроны коры похоже не убивает мужчин в сноске всего двадцать два куда делся вред навсегда'), [1], 'потеряно слово «алкоголь»');
  assert.deepEqual(await garbled(ch, 'авторы допускают провода могут восстановиться полуправда нейроны коры алкоголь похоже не убивает мужчин в сноске всего двадцать два куда делся вред навсегда'), [0], 'потеряно слово «что»');
  assert.deepEqual(await garbled(ch, 'авторы допускают что провода могут восстановиться полуправда нейроны коры алкоголь похоже убивает мужчин в сноске всего двадцать два куда делся вред навсегда'), [1], 'потеряно «не»: смысл перевёрнут');
  assert.deepEqual(await garbled(ch, 'авторы допускают что провода могут восстановиться полуправда нейроны коры алкоголь похоже не убивает мужчин сноске всего двадцать два куда делся вред навсегда'), [], 'потерянный предлог «в» не вина звука');
});

T('искажённый кусок перегенерируется один раз, остальные куски не трогаются', async () => {
  log = []; const f = script('g1.txt', [words(10, run_id + 'g1'), words(9, run_id + 'g2') + ' МАРКЕРГ', words(11, run_id + 'g3')]);
  const r = await narrate(f, ['--provider', 'voicestudio', '--voice', 'testvoice'], { NARRATE_ASR_FAKE: 'garble:МАРКЕРГ:1' });
  assert.equal(r.code, 0, r.se);
  const byInput = (k) => speech().filter((x) => x.body.input.includes(k)).length;
  assert.equal(byInput('МАРКЕРГ'), 2, 'плохой кусок озвучен заново');
  assert.equal(byInput(run_id + 'g10'), 1, 'чистые куски не перезапрашивались');
  assert.equal(byInput(run_id + 'g30'), 1);
  assert.match(r.se, /искажены куски \[2\]; перегенерирую \(круг 1 из 2\)/);
  assert.match(r.se, /сверка с текстом: чисто после 1 перегенераций/);
});

T('кусок, который остаётся искажённым после всех кругов: ролик не блокируется, но громко предупреждает', async () => {
  log = []; const f = script('g2.txt', [words(10, run_id + 'h1'), words(9, run_id + 'h2') + ' МАРКЕРД']);
  const r = await narrate(f, ['--provider', 'voicestudio', '--voice', 'testvoice'], { NARRATE_ASR_FAKE: 'garble:МАРКЕРД:99' });
  assert.equal(r.code, 0, r.se);
  assert.equal(speech().filter((x) => x.body.input.includes('МАРКЕРД')).length, 3, 'первая озвучка и два круга перегенерации');
  assert.match(r.se, /ВНИМАНИЕ после 2 перегенераций всё ещё искажены куски \[2\]/);
});

T('проверенные куски помечены: повторный запуск не просит ни модель, ни повторной сверки', async () => {
  const f = script('g1.txt', [words(10, run_id + 'g1'), words(9, run_id + 'g2') + ' МАРКЕРГ', words(11, run_id + 'g3')]);
  log = [];
  const r = await narrate(f, ['--provider', 'voicestudio', '--voice', 'testvoice'], { NARRATE_ASR_FAKE: 'garble:МАРКЕРГ:99' });   // сверка дала бы ошибку, но она не должна вызываться
  assert.equal(r.code, 0, r.se);
  assert.equal(speech().length, 0);
  assert.match(r.se, /сверка с текстом: все куски уже проверены/);
});

T('сверка выключена (NARRATE_VERIFY=off) или сама сломалась: озвучка выдаётся, причина названа', async () => {
  let f = script('v1.txt', [words(8, run_id + 'v1')]);
  let r = await narrate(f, ['--provider', 'voicestudio', '--voice', 'testvoice'], { NARRATE_VERIFY: 'off' });
  assert.equal(r.code, 0, r.se); assert.match(r.se, /сверка с текстом: не проверялась/);
  f = script('v2.txt', [words(8, run_id + 'v2')]);
  r = await narrate(f, ['--provider', 'voicestudio', '--voice', 'testvoice'], { NARRATE_ASR_FAKE: 'boom' });
  assert.equal(r.code, 0, r.se); assert.match(r.se, /проверка распознаванием не удалась/);
  assert.ok(fs.existsSync(r.out));
});

T('голос по формату проекта: format.json и by_format в настройках, а voice.json проекта сильнее', async () => {
  const proj = path.join(WORK, 'projB'); fs.mkdirSync(proj, { recursive: true });
  fs.writeFileSync(path.join(proj, 'format.json'), JSON.stringify({ format: 'B', ts: 1 }));
  const f = path.join(proj, 'script_ru.txt'); fs.writeFileSync(f, 'Формат ' + run_id + '.');
  let plan = JSON.parse((await narrate(f, ['--show-config'])).so.trim());
  assert.deepEqual([plan.provider, plan.voice], ['voicestudio', 'testvoice']);
  assert.ok(plan.layers.includes('by_format[B]'));
  fs.writeFileSync(path.join(proj, 'voice.json'), JSON.stringify({ provider: 'edge' }));
  plan = JSON.parse((await narrate(f, ['--show-config'])).so.trim());
  assert.equal(plan.provider, 'edge', 'ролик можно вернуть на Dmitry, даже если формат озвучен локальным голосом');
  const other = path.join(WORK, 'projA'); fs.mkdirSync(other, { recursive: true });
  fs.writeFileSync(path.join(other, 'format.json'), JSON.stringify({ format: 'A' }));
  fs.writeFileSync(path.join(other, 'script_ru.txt'), 'Другой формат ' + run_id + '.');
  plan = JSON.parse((await narrate(path.join(other, 'script_ru.txt'), ['--show-config'])).so.trim());
  assert.equal(plan.provider, 'edge', 'у формата A своего выбора нет');
});

T('видеокарту занимает другое приложение: быстрый внятный отказ вместо подкачки на минуты, модель не запрашивается', async () => {
  log = []; vramFree = 3.1;
  try {
    const f = script('vr.txt', [words(9, run_id + 'vr')]);
    const r = await narrate(f, ['--provider', 'voicestudio', '--voice', 'testvoice', '--no-fallback']);
    assert.equal(r.code, 4, r.se);
    assert.match(r.se, /на видеокарте свободно 3\.1 ГБ, а VoxCPM2 нужно не меньше 6/);
    assert.match(r.se, /распознавание голосовых/);
    assert.equal(speech().length, 0);
    assert.ok(!fs.existsSync(path.join(WORK, 'vs.lock')), 'замок снят и при отказе');
  } finally { vramFree = 7.0; }
});

T('наша собственная модель в памяти не считается помехой: свободной памяти мало именно из-за неё', async () => {
  log = []; vramFree = 0.4; loaded = true;
  try {
    const f = script('vr2.txt', [words(9, run_id + 'vs')]);
    const r = await narrate(f, ['--provider', 'voicestudio', '--voice', 'testvoice', '--no-fallback']);
    assert.equal(r.code, 0, r.se);
    assert.equal(speech().length, 1);
  } finally { vramFree = 7.0; loaded = false; }
});

T('английский: по умолчанию Kokoro; раздел en в настройках включает локальный голос с запасным Kokoro; русские слои не мешают', async () => {
  const show = (settings, args = []) => new Promise((resolve) => {
    const f = script('en_show.txt', ['Hello there.']);
    const p = spawn(PY, [NARRATE, '--lang', 'en', '--text', f, '--show-config', ...args], { env: { ...process.env, VOICE_SETTINGS_FILE: settings, VOICESTUDIO_VOICES: VOICES, PYTHONIOENCODING: 'utf-8' } });
    let so = '', se = ''; p.stdout.on('data', (d) => so += d); p.stderr.on('data', (d) => se += d);
    p.on('close', (code) => resolve({ code, plan: so.trim() ? JSON.parse(so) : null, se }));
  });
  let r = await show(SETTINGS);                                  // в боевых настройках раздела en ещё нет в копии теста: берётся умолчание
  assert.equal(r.code, 0, r.se); assert.equal(r.plan.provider, 'kokoro'); assert.equal(r.plan.fallback, 'none');
  r = await show(SETTINGS_EN);
  assert.deepEqual([r.plan.provider, r.plan.fallback, r.plan.voice], ['voicestudio', 'kokoro', 'testvoice_en']);
  r = await show(SETTINGS_EN, ['--provider', 'edge']);           // Edge — русский движок
  assert.notEqual(r.code, 0); assert.match(r.se, /kokoro или voicestudio/);
});

T('английская озвучка локальным голосом: профиль создан с языком English, текст без русских подмен, провайдер назван', async () => {
  log = []; const n0 = profiles.length;
  const f = script('en.txt', [`Hello ${run_id} one two three four five six.`, `Second paragraph ${run_id} has seven words here.`]);
  const r = await narrate(f, [], { VOICE_SETTINGS_FILE: SETTINGS_EN }, 'en');
  assert.equal(r.code, 0, r.se + r.so);
  assert.equal(profiles.length, n0 + 1); assert.equal(profiles[n0].lang, 'English', 'язык профиля берётся из voice.json');
  assert.equal(speech().length, 2);
  assert.match(speech()[0].body.input, /^Hello /);
  assert.match(r.so, /voice_provider: voicestudio/);
});

T('видеопамяти мало до запуска приложения: отказ сразу, VoiceStudio не запускается (минута на старт не тратится)', async () => {
  const smi = path.join(WORK, 'smi.cmd'), app = path.join(WORK, 'app.cmd'), ran = path.join(WORK, 'app_ran.txt');
  fs.writeFileSync(smi, '@echo 2958\r\n'); fs.writeFileSync(app, `@echo x> "${ran}"\r\n`);
  const f = script('vram.txt', [words(8, run_id + 'v')]);
  const t0 = Date.now();
  const r = await narrate(f, ['--provider', 'voicestudio', '--voice', 'testvoice', '--no-fallback', '--patience', '5'],
    { VOICESTUDIO_URL: 'http://127.0.0.1:9', VOICESTUDIO_NO_SPAWN: '', VOICESTUDIO_EXE: app, VOICESTUDIO_NVIDIA_SMI: smi });
  assert.equal(r.code, 4, r.se + r.so);
  assert.match(r.se, /на видеокарте свободно 2\.9 ГБ.*Приложение не запускаю/s);
  await new Promise((res) => setTimeout(res, 1500));
  assert.ok(!fs.existsSync(ran), 'приложение не должно было запускаться');
  assert.ok(Date.now() - t0 < 20000, 'отказ быстрый');
  // а при достаточной памяти приложение запускается (здесь это заглушка, которая сервер не поднимает: ждём отказа по времени, но запуск был)
  fs.writeFileSync(smi, '@echo 7000\r\n');
  const r2 = await narrate(script('vram2.txt', [words(8, run_id + 'w')]), ['--provider', 'voicestudio', '--voice', 'testvoice', '--no-fallback', '--patience', '5'],
    { VOICESTUDIO_URL: 'http://127.0.0.1:9', VOICESTUDIO_NO_SPAWN: '', VOICESTUDIO_EXE: app, VOICESTUDIO_NVIDIA_SMI: smi, VOICESTUDIO_START_TIMEOUT: '3' });
  assert.ok(fs.existsSync(ran), 'при свободных 6.8 ГБ приложение запускается: ' + r2.se.slice(-300));
});

// ---- ударения RUAccent для локального голоса (заглушка вместо настоящей модели) ----
const FAKE_ACCENT = path.join(ROOT, 'test', 'fixtures', 'fake_ruaccent_cli.py');
const ACC_LOG = path.join(WORK, 'accent_calls.log'), ACC_CACHE = path.join(WORK, 'accent_cache.json'), STRESS = path.join(WORK, 'stress_ru.json');
function accentSettings(name, accent) {
  const f = path.join(WORK, name), base = JSON.parse(fs.readFileSync(SETTINGS, 'utf8'));
  fs.writeFileSync(f, JSON.stringify({ ...base, accent })); return f;
}
const accEnv = (settings, extra = {}) => ({ VOICE_SETTINGS_FILE: settings, RUACCENT_PYTHON: PY, RUACCENT_CLI: FAKE_ACCENT, ACCENT_CACHE: ACC_CACHE, STRESS_DICT_FILE: STRESS, FAKE_ACCENT_LOG: ACC_LOG, ...extra });
const calls = () => (fs.existsSync(ACC_LOG) ? fs.readFileSync(ACC_LOG, 'utf8').trim().split('\n').filter(Boolean).length : 0);

T('ударения: знак «+» доходит до голоса, словарь Ника сильнее RUAccent, у «не» ударение снято; второй запуск берёт кэш', async () => {
  fs.rmSync(ACC_LOG, { force: true }); fs.rmSync(ACC_CACHE, { force: true });
  fs.writeFileSync(STRESS, JSON.stringify({ overrides: { 'горстка': 'г+орстка' }, unstressed: ['не'] }));
  const set = accentSettings('s_acc.json', { enabled: true, model: 'turbo3.1', mark: 'plus' });
  log = []; const f = script('acc1.txt', [`Горстка клеток. Не убивает слово${run_id}.`]);
  let r = await narrate(f, ['--provider', 'voicestudio', '--voice', 'testvoice'], accEnv(set));
  assert.equal(r.code, 0, r.se + r.so);
  const inp = speech().map((x) => x.body.input).join(' | ');
  assert.match(inp, /Г\+орстка/, 'слово из словаря: ' + inp);
  assert.ok(inp.includes('. Не '), 'частица «Не» осталась словом без знака: ' + inp); assert.ok(!inp.includes('Н+е'), 'знак с «не» снят: ' + inp);
  assert.match(inp, /кл\+еток/); assert.match(r.se, /accent: RUAccent turbo3\.1, знак «plus», ударений/);
  assert.equal(calls(), 1);
  log = []; r = await narrate(f, ['--provider', 'voicestudio', '--voice', 'testvoice'], accEnv(set));
  assert.equal(r.code, 0, r.se); assert.equal(calls(), 1, 'второй раз RUAccent не вызывали: ответ взят из кэша');
});

T('ударения: сбой RUAccent не роняет озвучку, текст идёт без знаков, предупреждение видно', async () => {
  fs.rmSync(ACC_CACHE, { force: true });
  const set = accentSettings('s_acc2.json', { enabled: true, model: 'turbo3.1', mark: 'plus' });
  log = []; const f = script('acc2.txt', [`Горстка клеток слово${run_id}x.`]);
  const r = await narrate(f, ['--provider', 'voicestudio', '--voice', 'testvoice'], accEnv(set, { FAKE_ACCENT_FAIL: '1' }));
  assert.equal(r.code, 0, r.se);
  assert.ok(!speech().some((x) => x.body.input.includes('+')), 'знаков нет');
  assert.match(r.se, /accent: ВНИМАНИЕ ударения не расставлены.*модель ударений не загрузилась/);
});

T('ударения: знак acute = гласная + U+0301, «+» не остаётся; выключено в настройках — текст не тронут', async () => {
  fs.rmSync(ACC_CACHE, { force: true });
  let set = accentSettings('s_acc3.json', { enabled: true, model: 'turbo3.1', mark: 'acute' });
  log = []; let r = await narrate(script('acc3.txt', [`Горстка клеток слово${run_id}y.`]), ['--provider', 'voicestudio', '--voice', 'testvoice'], accEnv(set));
  assert.equal(r.code, 0, r.se);
  let inp = speech().map((x) => x.body.input).join(' ');
  assert.ok(inp.includes('о\u0301рстка') || inp.includes('о\u0301'), 'акут после гласной: ' + inp); assert.ok(!inp.includes('+'));
  set = accentSettings('s_acc4.json', { enabled: false });
  fs.rmSync(ACC_LOG, { force: true }); log = [];
  r = await narrate(script('acc4.txt', [`Горстка клеток слово${run_id}z.`]), ['--provider', 'voicestudio', '--voice', 'testvoice'], accEnv(set));
  assert.equal(r.code, 0, r.se); inp = speech().map((x) => x.body.input).join(' ');
  assert.ok(!inp.includes('+') && !inp.includes('\u0301'), 'выключено: ' + inp); assert.equal(calls(), 0);
});

// ---- по предложениям: паузы между предложениями и абзацами ----
const SENT_SETTINGS = path.join(WORK, 'voice_settings_sent.json');
function sentSettings() {
  const base = JSON.parse(fs.readFileSync(SETTINGS, 'utf8'));
  fs.writeFileSync(SENT_SETTINGS, JSON.stringify({ ...base, voicestudio: { voice: '', chunk_by_sentence: true, gap_sentence: 0.5, gap_paragraph: 1.0 } })); return SENT_SETTINGS;
}
const sent = (n, tag) => `Это ${words(n, tag)}`;                  // предложение из n+1 слов, начинается с заглавной

T('по предложениям: каждое предложение отдельным запросом, между ними gap_sentence, после абзаца gap_paragraph; короткое предложение не перегенерируется', async () => {
  log = [];
  const f = script('sn1.txt', [`${sent(8, run_id + 'a')} ${sent(9, run_id + 'b')} Да ${run_id}.`, sent(6, run_id + 'c')]);
  const r = await narrate(f, ['--provider', 'voicestudio', '--voice', 'testvoice'], { VOICE_SETTINGS_FILE: sentSettings() });
  assert.equal(r.code, 0, r.se + r.so);
  assert.deepEqual(speech().map((x) => x.body.input.split(' ').length), [9, 10, 2, 7], 'по запросу на предложение');
  const d = await dur(r.out);
  assert.ok(Math.abs(d - (28 / 3 + 0.5 + 0.5 + 1.0)) < 0.35, `длина ${d}: речь + две паузы между предложениями + пауза после абзаца`);
  assert.ok(!/не прошла проверку темпа/.test(r.se), 'короткое предложение «Да …» прошло проверку: ' + r.se.slice(-300));
});

T('по предложениям: короткое предложение, на котором модель зациклилась, ловится и громко отмечается', async () => {
  log = [];
  const f = script('sn2.txt', [`${sent(7, run_id + 'd')} Тоже ЗАЦИКЛ${run_id}.`]);
  const r = await narrate(f, ['--provider', 'voicestudio', '--voice', 'testvoice'], { VOICE_SETTINGS_FILE: sentSettings() });
  assert.equal(r.code, 0, r.se);
  assert.match(r.se, /не прошла проверку темпа \(2 слов за 12\.0 с/); assert.match(r.se, /ВНИМАНИЕ кусок 2 не прошёл проверку темпа/);
});

T('деление на предложения: инициалы, сокращения, кавычки и вопросительные знаки', () => {
  const r = spawnSync(PY, ['-c', "import sys, json; sys.path.insert(0, r'" + path.join(ROOT, 'video') + "'); import voicestudio as v; print(json.dumps([v.sentences('Это сделал А. С. Пушкин. Он жил давно. Давление 120 мм рт. ст. было нормой! «Правда?» Да. Конец…'), v.split_chunks(['Один. Два три.', 'Три.'], 26, True)], ensure_ascii=False))"], { encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
  assert.equal(r.status, 0, r.stderr);
  const [sn, ch] = JSON.parse(r.stdout);
  assert.deepEqual(sn, ['Это сделал А. С. Пушкин.', 'Он жил давно.', 'Давление 120 мм рт. ст. было нормой!', '«Правда?»', 'Да.', 'Конец…']);
  assert.deepEqual(ch, [['Один.', false], ['Два три.', true], ['Три.', true]], 'пометка конца абзаца только у последнего предложения');
});

T('по предложениям: короткое предложение, читаемое медленнее среднего темпа, не считается браком (темп по слову ему не мерило)', async () => {
  log = [];
  const f = script('sn3.txt', [`${sent(7, run_id + 'e')} Навсегда МЕДЛЕННО${run_id}.`]);
  const r = await narrate(f, ['--provider', 'voicestudio', '--voice', 'testvoice'], { VOICE_SETTINGS_FILE: sentSettings() });
  assert.equal(r.code, 0, r.se);
  assert.ok(!/не прошла проверку темпа/.test(r.se), r.se.slice(-300));
  assert.equal(speech().filter((x) => x.body.input.includes('МЕДЛЕННО')).length, 1, 'запрошено один раз, без перегенераций');
});

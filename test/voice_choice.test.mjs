// video/voice_choice.py: выбор голоса озвучки для ролика / формата / по умолчанию. Боевой voice_settings.json не трогаем.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PY = 'C:/hf_tts/venv/Scripts/python.exe';
const CHOICE = path.join(ROOT, 'video', 'voice_choice.py');
const HAVE = fs.existsSync(PY) && fs.existsSync(CHOICE);
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-test-'));
const SETTINGS = path.join(WORK, 'voice_settings.json');
const VOICES = path.join(WORK, 'voices');
const T = HAVE ? test : test.skip;

before(() => {
  fs.mkdirSync(path.join(VOICES, 'v1'), { recursive: true });
  fs.writeFileSync(path.join(VOICES, 'v1', 'voice.json'), JSON.stringify({ title: 'первый', ref_audio: 'ref.wav', ref_text: 'т' }));
  fs.writeFileSync(path.join(VOICES, 'v1', 'ref.wav'), 'RIFF');
  fs.writeFileSync(SETTINGS, JSON.stringify({ ru: { voice: 'ru-RU-DmitryNeural', rate: '+25%' }, provider: 'edge', fallback: 'none', voicestudio: { voice: '' } }));
});
after(() => fs.rmSync(WORK, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 }));

const run = (...args) => spawnSync(PY, [CHOICE, ...args], { encoding: 'utf8', env: { ...process.env, VOICE_SETTINGS_FILE: SETTINGS, VOICESTUDIO_VOICES: VOICES, PYTHONIOENCODING: 'utf-8' } });
const settings = () => JSON.parse(fs.readFileSync(SETTINGS, 'utf8'));

T('list показывает голоса и текущий выбор по умолчанию', () => {
  const r = run('list'); assert.equal(r.status, 0, r.stderr);
  const d = JSON.parse(r.stdout);
  assert.equal(d.default.provider, 'edge');
  assert.deepEqual(d.voices.map((v) => v.name), ['v1']);
});

T('голос для одного ролика: пишется voice.json в его папку, clear убирает', () => {
  const proj = path.join(WORK, 'proj1');
  let r = run('project', proj, 'voicestudio', 'v1', '--tempo', '1.05'); assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(proj, 'voice.json'), 'utf8')), { provider: 'voicestudio', voice: 'v1', tempo: 1.05 });
  r = run('project', proj, 'edge'); assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(proj, 'voice.json'), 'utf8')), { provider: 'edge' });
  r = run('project', proj, 'clear'); assert.equal(r.status, 0);
  assert.ok(!fs.existsSync(path.join(proj, 'voice.json')));
});

T('неизвестный голос или провайдер отвергаются, файл не портится', () => {
  const proj = path.join(WORK, 'proj2');
  let r = run('project', proj, 'voicestudio', 'нет_такого');
  assert.notEqual(r.status, 0); assert.match(r.stderr, /не настроен/);
  assert.ok(!fs.existsSync(path.join(proj, 'voice.json')));
  r = run('project', proj, 'voicestudio'); assert.notEqual(r.status, 0); assert.match(r.stderr, /нужно имя голоса/);
  r = run('project', proj, 'azure'); assert.notEqual(r.status, 0); assert.match(r.stderr, /edge или voicestudio/);
  r = run('format', 'B', 'voicestudio', 'нет_такого'); assert.notEqual(r.status, 0);
  assert.deepEqual(settings().by_format ?? {}, {});
});

T('голос для формата ложится в by_format, прочие настройки сохраняются', () => {
  const r = run('format', 'b', 'voicestudio', 'v1'); assert.equal(r.status, 0, r.stderr);
  const s = settings();
  assert.deepEqual(s.by_format, { B: { provider: 'voicestudio', voice: 'v1' } });
  assert.equal(s.ru.rate, '+25%', 'темп Dmitry не тронут');
  assert.equal(run('format', 'B', 'clear').status, 0);
  assert.deepEqual(settings().by_format, {});
});

T('default: основной Edge, запасной VoiceStudio с голосом; запасной без голоса невозможен', () => {
  let r = run('default', 'edge', '--fallback', 'voicestudio'); assert.notEqual(r.status, 0, 'голос не выбран');
  r = run('default', 'edge', '--fallback', 'voicestudio', '--voice', 'v1'); assert.equal(r.status, 0, r.stderr);
  const s = settings();
  assert.deepEqual([s.provider, s.fallback, s.voicestudio.voice], ['edge', 'voicestudio', 'v1']);
});

T('list показывает пометку «утверждён Ником» у голоса, у остальных её нет', () => {
  const f = path.join(VOICES, 'v1', 'voice.json'), orig = fs.readFileSync(f, 'utf8');
  fs.mkdirSync(path.join(VOICES, 'v2'), { recursive: true });
  fs.writeFileSync(path.join(VOICES, 'v2', 'voice.json'), JSON.stringify({ title: 'второй', ref_audio: 'ref.wav', ref_text: 'т', approved: 'Ник, слепой тест' })); fs.writeFileSync(path.join(VOICES, 'v2', 'ref.wav'), 'RIFF');
  try {
    const r = run('list'); assert.equal(r.status, 0, r.stderr);
    const by = Object.fromEntries(JSON.parse(r.stdout).voices.map((v) => [v.name, v.approved]));
    assert.ok(!by.v1, 'у v1 пометки нет'); assert.match(by.v2, /Ник/);
  } finally { fs.rmSync(path.join(VOICES, 'v2'), { recursive: true, force: true }); fs.writeFileSync(f, orig); }
});

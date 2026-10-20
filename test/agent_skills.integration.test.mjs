// Путь «правки сценария -> Ксения -> Вера с реестром цитат -> карточка»: настоящий API на КОПИИ данных, Telegram и озвучка по смете, модели имитированы.
// Тестовый ролик создаётся в копии БД новой записью (его номер выдаёт база), папка smm/runs/video_<id> удаляется после теста.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { copyLiveDb } from './fixtures/copy_db.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REAL = path.join(ROOT, 'server', 'data'), FAKE = path.join(ROOT, 'test', 'fixtures', 'fake_agent.mjs');
const can = fs.existsSync(path.join(REAL, 'office.db')) && fs.existsSync(path.join(REAL, 'config.json')) && fs.existsSync('C:/hf_tts/venv/Scripts/python.exe');
const PORT = 9600 + (process.pid % 90), API = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let tmp, server, TOKEN; const made = [];
const api = async (p, body) => { const r = await fetch(API + p, { method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return r.json(); };
const OLD = ['Ребёнок съел конфету и носится как угорелый. Виноват сахар? Открываем дело.', 'Шестнадцать работ показали, что сахар не влияет.', 'Мамам дали пустышку, а они видели бурю.', 'Вывод: миф. Источники на экране.'];
async function boot(checkMode, extra = {}) {
  if (server) { server.kill(); await sleep(700); }
  server = spawn(process.execPath, ['server.mjs'], { cwd: path.join(ROOT, 'server'), env: { ...process.env, OFFICE_DATA_DIR: tmp, PORT: String(PORT), OFFICE_NO_TG: '1', OFFICE_CHAT_STUB: '1', OFFICE_NO_WATCH: '1', HERMES_BIN: FAKE, SMM_TTS_ESTIMATE_ONLY: '1', FAKE_CHECK_MODE: checkMode, FAKE_SCRIPT_MODE: 'short', CRAFT_GATE: 'off', SKILL_GATE: 'off', ...extra }, stdio: 'ignore', windowsHide: true });
  for (let i = 0; i < 40; i++) { try { if ((await fetch(API + '/health')).ok) return; } catch {} await sleep(300); }
}
async function run(checkMode, extra) {
  await boot(checkMode, extra);
  const id = (await api('/api/video', { title: 'Тест: шаги и польза', stage: 'checked', rubric: 'myth' })).id, RUN = path.join(ROOT, 'smm', 'runs', `video_${id}`); made.push(RUN);
  fs.rmSync(RUN, { recursive: true, force: true }); fs.mkdirSync(RUN, { recursive: true }); fs.writeFileSync(path.join(RUN, 'script.json'), JSON.stringify({ title: 'Шаги', segments: OLD, hook_type: 'сцена' }));
  const cid = (await api('/api/chat/post', { office: 'smm', thread: 'captain_smm', sender: 'captain_smm', text: 'Сценарий', buttons: [[['Утвердить сценарий', `approve:${id}`], ['Нужны правки', `revise:${id}`]]], mirror: false })).id;
  assert.equal((await api('/api/chat/answer', { id: cid, choice: `revise:${id}`, comment: 'Сделай концовку короче', via: 'dashboard' })).ok, true);
  for (let i = 0; i < 120; i++) { await sleep(1000); const m = (await api('/api/chat?office=smm')).messages.filter((x) => x.kind === 'action' && x.status === 'open' && /Сценарий: «/.test(x.text) && x.id > cid); if (m.length) return { card: m[m.length - 1], RUN, id }; }
  throw new Error('карточка сценария не пришла за 120 с');
}
before(() => { if (!can) return; tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-test-')); copyLiveDb(REAL, tmp); TOKEN = JSON.parse(fs.readFileSync(path.join(REAL, 'config.json'), 'utf8')).token; });
after(async () => { try { server && server.kill(); } catch {} await sleep(600); for (const d of made) fs.rmSync(d, { recursive: true, force: true }); try { tmp && fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); } catch {} });

test('задания сотрудников несут блоки скиллов: Ксения (script-craft, humanizer), Вера (реестр в папке сценария, команды sources.py), у каждого запуска своя метка', { skip: !can }, async () => {
  const { RUN } = await run('evidence_retry');
  const q1 = fs.readFileSync(path.join(RUN, '_query_script1.txt'), 'utf8'), q2 = fs.readFileSync(path.join(RUN, '_query_check1.txt'), 'utf8');
  assert.match(q1, /СКИЛЛЫ ПРЕЖДЕ ВСЕГО/); assert.match(q1, /short-video-script-craft/); assert.match(q1, /humanizer/); assert.match(q1, /\[метка запуска, служебная: RUN-script1-/);
  assert.match(q2, /grounded-citations/); assert.match(q2, /ledger\.json/); assert.match(q2, /sources\.py/); assert.match(q2, /\[метка запуска, служебная: RUN-check1-/);
});

test('Вера принесла пересказ вместо цитаты: код возвращает ей проверку один раз с названием фактов; после реестра карточка чистая, цитата дословная в FACTS.md', { skip: !can }, async () => {
  const { card, RUN } = await run('evidence_retry');
  assert.deepEqual(fs.readFileSync(path.join(RUN, 'check.json.checks'), 'utf8').trim().split('\n'), ['first', 'retry'], 'Вера вызвана дважды: пересказ, затем цитата из реестра');
  assert.match(fs.readFileSync(path.join(RUN, '_query_check1ev.txt'), 'utf8'), /Проверка Веры не принята.*реестр источников пуст или не создан.*Реестр НЕ сбрасывай/s);
  assert.ok(!/не у всех фактов цитата/.test(card.text), card.text); assert.match(card.text, /Вера проверила факты/);
  const facts = fs.readFileSync(path.join(RUN, 'FACTS.md'), 'utf8'); assert.match(facts, /Taking 8000 steps per day was associated with a 51% lower risk/); assert.match(facts, /pubmed\.ncbi\.nlm\.nih\.gov\/35247352/);
});

test('Вера так и не принесла цитаты: после одного повтора карточка честно говорит об этом Нику, вердикт Веры не подменяется', { skip: !can }, async () => {
  const { card, RUN } = await run('evidence_never');
  assert.deepEqual(fs.readFileSync(path.join(RUN, 'check.json.checks'), 'utf8').trim().split('\n'), ['first', 'retry'], 'один повтор, не бесконечно');
  assert.match(card.text, /⚠️ У Веры не у всех фактов цитата из реестра/); assert.match(card.text, /Вера проверила факты/);
});

test('потолок проверок Веры: повтор из-за цитат тоже считается; при потолке 1 повтора нет, Нику предупреждение на карточке (а не третий запуск)', { skip: !can }, async () => {
  const { card, RUN } = await run('evidence_never', { MAX_FACT_CHECKS: '1' });
  assert.deepEqual(fs.readFileSync(path.join(RUN, 'check.json.checks'), 'utf8').trim().split('\n'), ['first'], 'один запуск Веры, повтора из-за цитат нет');
  assert.ok(!fs.existsSync(path.join(RUN, '_query_check1ev.txt'))); assert.match(card.text, /⚠️ У Веры не у всех фактов цитата из реестра/);
});

test('Ксении в задании назван бюджет слов по реальному синтезу (88-100 слов, призыв ≈ 8,4 с), без цифр, выведенных из оценки при выключенной озвучке', () => {
  return import('../scripts/agent_skills.mjs').then(({ skillsBlock }) => { const b = skillsBlock('scriptwriter', { dir: 'C:/x' }); assert.match(b, /БЮДЖЕТ СЛОВ/); assert.match(b, /88-100 слов без призыва/); assert.match(b, /≈ 8,4 с/); assert.ok(!/76-84/.test(b)); });
});

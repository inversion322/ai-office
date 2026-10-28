// Путь «правки сценария -> Ксения (выжимка, не цитаты) -> Вера (сверка смысла) -> карточка»: настоящий API на КОПИИ данных, Telegram и озвучка по смете, модели имитированы.
// Тестовый ролик создаётся в копии БД новой записью (его номер выдаёт база), папка smm/runs/video_<id> удаляется после теста.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { copyLiveDb } from './fixtures/copy_db.mjs';
process.env.VARIANTS = 'off';          // эти тесты проверяют одиночный сценарий; варианты B и C покрыты в variants*.test.mjs

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
  server = spawn(process.execPath, ['server.mjs'], { cwd: path.join(ROOT, 'server'), env: { ...process.env, OFFICE_DATA_DIR: tmp, PORT: String(PORT), OFFICE_NO_TG: '1', OFFICE_CHAT_STUB: '1', OFFICE_NO_WATCH: '1', HERMES_BIN: FAKE, SMM_TTS_ESTIMATE_ONLY: '1', FAKE_CHECK_MODE: checkMode, FAKE_SCRIPT_MODE: 'short', CRAFT_GATE: 'off', CODEWORD_GATE: 'off', SKILL_GATE: 'off', ...extra }, stdio: 'ignore', windowsHide: true });
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
before(() => { if (!can) return; tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-test-')); copyLiveDb(REAL, tmp, 'agent_skills'); TOKEN = JSON.parse(fs.readFileSync(path.join(REAL, 'config.json'), 'utf8')).token; });
after(async () => { try { server && server.kill(); } catch {} await sleep(600); for (const d of made) fs.rmSync(d, { recursive: true, force: true }); try { tmp && fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); } catch {} });

test('задания сотрудников: Ксения получает скиллы и правило «ВЫЖИМКА, А НЕ ЦИТАТЫ» и поле gist вместо quote; Вера получает сверку СМЫСЛА без реестра; у каждого запуска своя метка', { skip: !can }, async () => {
  const { RUN } = await run('ok');
  const q1 = fs.readFileSync(path.join(RUN, '_query_script1.txt'), 'utf8'), q2 = fs.readFileSync(path.join(RUN, '_query_check1.txt'), 'utf8');
  assert.match(q1, /СКИЛЛЫ ПРЕЖДЕ ВСЕГО/); assert.match(q1, /short-video-script-craft/); assert.match(q1, /humanizer/); assert.match(q1, /storytelling-hooks/); assert.match(q1, /\"lens\"/); assert.match(q1, /НАЧНИ С ТЕКСТА, не с полей/); assert.match(q1, /Это история, не список/); assert.match(q1, /Ты Ксения Сюжетова/);
  const task1 = q1.split('=== ЗАДАЧА ===')[1] || ''; assert.ok(task1.length > 500, 'задание выделено отдельно от персоны'); assert.match(task1, /ВЫЖИМКА, А НЕ ЦИТАТЫ/, 'правило есть именно в ЗАДАНИИ, а не только в персоне'); assert.match(task1, /\"gist\"/); assert.ok(!/\"quote\":/.test(task1)); assert.match(q1.split('=== ЗАДАЧА ===')[0], /ВЫЖИМКА, А НЕ ЦИТАТЫ/, 'и в персоне, которую доставил promptRev 4'); assert.ok(!/точная цитата/.test(q1), 'поле «точная цитата» убрано из формата сценария');
  assert.match(q1, /\[метка запуска, служебная: RUN-script1-/);
  assert.match(q2, /КРАТКАЯ ВЫЖИМКА/); assert.match(q2, /дословных цитат в ней быть не должно/); assert.match(q2, /Сверяй смысл, а не слова/); assert.match(q2, /\[метка запуска, служебная: RUN-check1-/);
  assert.ok(!/grounded-citations|ledger\.json|sources\.py|реестр/i.test(q2.replace(/НЕ веди реестр источников и не запускай sources\.py: этого больше нет/, '')), 'реестра в задании Веры нет');
});

test('Вера проверяет один раз: без повтора из-за цитат; карточка «Вера сверила смысл с источниками», нет предупреждений про реестр и цитаты; FACTS.md со своими словами', { skip: !can }, async () => {
  const { card, RUN } = await run('ok');
  assert.ok(!fs.existsSync(path.join(RUN, '_query_check1ev.txt')), 'повторного запуска Веры из-за цитат больше нет'); assert.ok(!fs.existsSync(path.join(RUN, 'ledger.json')), 'реестр не создаётся');
  assert.match(card.text, /Вера сверила смысл с источниками/); assert.ok(!/цитат|реестр|Вера проверила факты/.test(card.text), card.text);
  const facts = fs.readFileSync(path.join(RUN, 'FACTS.md'), 'utf8'); assert.match(facts, /сверка выжимки с источниками/); assert.match(facts, /своими словами/);
});

test('если выжимка не пройдёт по смыслу, Вера возвращает сценарий Ксении с конкретной правкой; цитаты тут ни при чём', { skip: !can }, async () => {
  const { card } = await run('fail');
  assert.match(card.text, /Вера НЕ пропустила/); assert.match(card.text, /Сегмент 2: уточнить формулировку/); assert.ok(!/цитат|реестр/.test(card.text));
});

test('Ксении в задании назван бюджет слов по реальному синтезу (80-100 слов, призыв ≈ 8,4 с), без цифр, выведенных из оценки при выключенной озвучке', () => {
  return import('../scripts/agent_skills.mjs').then(({ skillsBlock }) => { const b = skillsBlock('scriptwriter', { dir: 'C:/x' }); assert.match(b, /БЮДЖЕТ СЛОВ/); assert.match(b, /80-100 слов без призыва/); assert.match(b, /без запаса/); assert.match(b, /≈ 8,4 с/); assert.ok(!/76-84/.test(b)); });
});

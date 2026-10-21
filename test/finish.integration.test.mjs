// «Утвердить после проверки»: Ник сказал «делаем» на сценарии, который Вера ещё не пропустила. Конвейер (имитация Ксении и Веры) доводит текст,
// и при «можно» монтаж запускается сам. Настоящий API на КОПИИ данных, Telegram и озвучка по сети выключены, настоящие модели не вызываются.
// Тестовый ролик №6 живёт в smm/runs/video_6 и удаляется после теста.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { copyLiveDb } from './fixtures/copy_db.mjs';
process.env.VARIANTS = 'off';          // эти тесты проверяют одиночный сценарий; варианты B и C покрыты в variants*.test.mjs

process.env.CRAFT_GATE = 'off';   // эти тесты проверяют довод до конца и длину, драматургия проверяется в regen.integration и script_craft.test
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REAL = path.join(ROOT, 'server', 'data');
const can = fs.existsSync(path.join(REAL, 'office.db')) && fs.existsSync(path.join(REAL, 'config.json')) && fs.existsSync('C:/hf_tts/venv/Scripts/python.exe');
const PORT = 9000 + (process.pid % 90), API = `http://127.0.0.1:${PORT}`;
const RUN = path.join(ROOT, 'smm', 'runs', 'video_6'), FAKE = path.join(ROOT, 'test', 'fixtures', 'fake_agent.mjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let tmp, server, TOKEN;
const api = async (p, body) => { const r = await fetch(API + p, { method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return r.json(); };
const LONG = Array.from({ length: 6 }, (_, i) => `Абзац ${i + 1}: ${'длинная фраза про шаги и здоровье взрослых людей, '.repeat(4)}конец.`);

before(async () => {
  if (!can) return;
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'finish-test-')); copyLiveDb(REAL, tmp);
  TOKEN = JSON.parse(fs.readFileSync(path.join(REAL, 'config.json'), 'utf8')).token;
  // Сервер БЕЗ HERMES_BIN: этапы, которые он захотел бы запустить (монтаж Кирилла), в тесте отклоняются охраной, а не стартуют.
  server = spawn(process.execPath, ['server.mjs'], { cwd: path.join(ROOT, 'server'), env: { ...process.env, OFFICE_DATA_DIR: tmp, PORT: String(PORT), OFFICE_NO_TG: '1', OFFICE_CHAT_STUB: '1', OFFICE_NO_WATCH: '1' }, stdio: 'ignore' });
  for (let i = 0; i < 40; i++) { try { if ((await fetch(API + '/health')).ok) return; } catch {} await sleep(300); }
});
after(async () => { try { server && server.kill(); } catch {} await sleep(600); fs.rmSync(RUN, { recursive: true, force: true }); try { tmp && fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); } catch {} });

async function scenario({ pre, scriptMode = 'short', checkMode = 'ok' }) {
  fs.rmSync(RUN, { recursive: true, force: true }); fs.mkdirSync(RUN, { recursive: true });
  fs.writeFileSync(path.join(RUN, 'script.json'), JSON.stringify({ title: 'Холод', rubric: 'myth', hook_type: 'вопрос-ловушка', segments: LONG, claims: [], sources_card: ['Источник. 2020.'], disclaimer: 'Не заменяет консультацию врача.' }));
  fs.writeFileSync(path.join(RUN, 'check.json'), JSON.stringify({ verdict: 'fix', summary: 'нужны правки', required_changes: ['уточнить'], claims: [] }));
  if (pre) fs.writeFileSync(path.join(RUN, 'PREAPPROVED'), '1');
  await api('/api/video', { id: 6, stage: 'script' });
  await api('/api/agent', { id: 'scriptwriter', status: 'working', task: 'Сокращаю: озвучка 58 с при лимите 53' });
  const before = (await api('/api/chat?office=smm')).messages.length;
  const code = await new Promise((resolve) => {
    const p = spawn(process.execPath, [path.join(ROOT, 'scripts', 'smm_pipeline.mjs'), 'script', '6', '--finish'], { cwd: ROOT, stdio: 'ignore', env: { ...process.env, OFFICE_API: API, OFFICE_NO_TG: '1', SMM_TTS_ESTIMATE_ONLY: '1', HERMES_BIN: FAKE, FAKE_SCRIPT_MODE: scriptMode, FAKE_CHECK_MODE: checkMode } });
    p.on('exit', resolve); setTimeout(() => { p.kill(); resolve('timeout'); }, 150000);
  });
  const st = await api('/api/state?office=smm'), msgs = (await api('/api/chat?office=smm')).messages.slice(before);
  return { code, st, msgs, stage: st.videos.find((v) => v.id === 6).stage, agent: (id) => st.agents.find((a) => a.id === id) };
}
const card = (msgs) => msgs.filter((m) => m.kind === 'action' && /Сценарий: «/.test(m.text)).pop();

test('предварительное утверждение + Вера пропустила: сценарий сокращён, карточка закрыта автоматически, ролик в стадии монтажа, ни одного лишнего вопроса', { skip: !can }, async () => {
  const r = await scenario({ pre: true }); assert.equal(r.code, 0);
  assert.equal(fs.existsSync(path.join(RUN, '_query_script1.txt')), false, 'круг 1 без вслепую переписанного текста: сначала замер длины');
  assert.match(fs.readFileSync(path.join(RUN, '_query_script2.txt'), 'utf8'), /Озвучка .* при лимите/, 'Ксении поставлена задача сократить');
  assert.equal(r.stage, 'editing'); assert.equal(fs.existsSync(path.join(RUN, 'PREAPPROVED')), false);
  const c = card(r.msgs); assert.equal(c.status, 'answered'); assert.equal(c.choice, 'approve:6'); assert.equal(c.answered_via, 'auto');
  assert.ok(r.msgs.some((m) => /Вера пропустила\. Ваше «утверждаю» засчитано/.test(m.text))); assert.ok(r.msgs.some((m) => /Сценарий утверждён/.test(m.text)));
  assert.equal(r.msgs.filter((m) => m.sender === 'nick').length, 0, 'от имени Ника ничего не написано');
  assert.equal((await api('/api/state?office=smm')).pending, (r.st.pending), 'открытых карточек не прибавилось');
  assert.equal(r.agent('scriptwriter').status === 'working', false, 'Ксения не висит «работает»');
});

test('без предварительного утверждения Вера пропустила: приходит обычная карточка с «Утвердить сценарий», сама ничего не утверждается', { skip: !can }, async () => {
  const r = await scenario({ pre: false }); assert.equal(r.stage, 'checked');
  const c = card(r.msgs); assert.equal(c.status, 'open'); assert.ok(c.buttons.flat().some((b) => b.d === 'approve:6')); assert.ok(!r.msgs.some((m) => /Сценарий утверждён/.test(m.text)));
});

test('предварительное утверждение, но Вера не пропустила: монтаж не стартует, Нику честно сказано, карточка есть, на ней «Утвердить после проверки»', { skip: !can }, async () => {
  const r = await scenario({ pre: true, checkMode: 'fail' }); assert.equal(r.code, 0);
  assert.equal(r.stage, 'script'); assert.equal(fs.existsSync(path.join(RUN, 'PREAPPROVED')), false);
  assert.ok(r.msgs.some((m) => /ваше предварительное «утверждаю» не исполнено/.test(m.text)));
  const c = card(r.msgs); assert.equal(c.status, 'open'); assert.ok(c.buttons.flat().some((b) => b.d === 'approve:6' && /после проверки/.test(b.t)));
  assert.equal(fs.readdirSync(RUN).filter((f) => /^_query_check\d+\.txt$/.test(f)).length, 2, 'потолок: Вера проверяет не больше двух раз за этап, даже если пять кругов правок ещё не кончились (решение Ника: 2 круга вместо трёх)');
  assert.match(card(r.msgs).text, /Вера НЕ пропустила \(проверок Веры: 2\)/);
});

test('текст так и не влез в лимит: честная подпись «длиннее лимита, Вера не проверяла», Ксения не остаётся «работает», кнопка утверждения есть', { skip: !can }, async () => {
  const r = await scenario({ pre: false, scriptMode: 'long' }); assert.equal(r.code, 0); assert.equal(r.stage, 'script');
  const c = card(r.msgs); assert.match(c.text, /Текст длиннее лимита/); assert.match(c.text, /Вера последнюю версию не проверяла/); assert.ok(c.buttons.flat().some((b) => b.d === 'approve:6'));
  assert.equal(r.agent('scriptwriter').status, 'idle'); assert.match(r.agent('scriptwriter').task, /не уложился в лимит/);
});

test('пока шли круги, Ник отклонил тему: ни карточки, ни монтажа, стадия остаётся «отклонён», флаг снят', { skip: !can }, async () => {
  fs.rmSync(RUN, { recursive: true, force: true }); fs.mkdirSync(RUN, { recursive: true });
  fs.writeFileSync(path.join(RUN, 'script.json'), JSON.stringify({ title: 'Холод', rubric: 'myth', hook_type: 'вопрос-ловушка', segments: ['Короткий текст про шаги.'], claims: [], sources_card: [], disclaimer: 'x' }));
  fs.writeFileSync(path.join(RUN, 'PREAPPROVED'), '1'); await api('/api/video', { id: 6, stage: 'script' });
  const before = (await api('/api/chat?office=smm')).messages.length;
  const run = spawn(process.execPath, [path.join(ROOT, 'scripts', 'smm_pipeline.mjs'), 'script', '6', '--finish'], { cwd: ROOT, stdio: 'ignore', env: { ...process.env, OFFICE_API: API, OFFICE_NO_TG: '1', SMM_TTS_ESTIMATE_ONLY: '1', HERMES_BIN: FAKE, FAKE_SCRIPT_MODE: 'short', FAKE_DELAY_MS: '3000' } });
  const done = new Promise((r) => { run.on('exit', r); setTimeout(r, 60000); });
  await sleep(1500); await api('/api/video', { id: 6, stage: 'rejected' });          // Ник отклонил тему, пока Вера проверяла
  await done;
  const st = await api('/api/state?office=smm'), msgs = (await api('/api/chat?office=smm')).messages.slice(before);
  assert.equal(st.videos.find((v) => v.id === 6).stage, 'rejected'); assert.equal(fs.existsSync(path.join(RUN, 'PREAPPROVED')), false);
  assert.ok(!msgs.some((m) => m.kind === 'action' && /Сценарий: «/.test(m.text)), 'карточка по отклонённой теме не прислана'); assert.ok(!msgs.some((m) => /Сценарий утверждён/.test(m.text)));
});

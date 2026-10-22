// Варианты одной темы на НАСТОЯЩЕМ сервере (копия БД), модели подменены: variants -> одна карточка -> «Утвердить все три» -> три параллельных монтажа
// с разными монтажёрами, форматами и профилями; «Убрать вариант», правка «B: …», отклонение темы. Тестовые ролики 90001+ (папки удаляются после теста).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { copyLiveDb } from './fixtures/copy_db.mjs';
import { ffprobePath } from '../scripts/video_format.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REAL = path.join(ROOT, 'server', 'data'), FAKE = path.join(ROOT, 'test', 'fixtures', 'fake_agent.mjs');
const FF = path.join(path.dirname(ffprobePath()), 'ffmpeg.exe');
const can = fs.existsSync(path.join(REAL, 'office.db')) && fs.existsSync(path.join(REAL, 'config.json')) && fs.existsSync(FF);
const PORT = 9900 + (process.pid % 90), API = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const G1 = 90001, G2 = 90100;        // базовые записи двух тем; варианты получают id сервера (max+1), их находим по меткам notes.variant
const runDir = (id) => path.join(ROOT, 'smm', 'runs', `video_${id}`), projDir = (id) => path.join(ROOT, 'video', `dosie${id}`);
const SA = ['Говорят, что кофе обезвоживает. Правда ли это?', 'Британцы пометили воду в телах пятидесяти мужчин. Три дня те пили кофе, три дня воду.', 'Вода в организме у обеих групп вела себя одинаково, а различие нашли в мелочах.', 'Чашку кофе зря обвиняли: за день жидкости она даёт столько же, сколько вода.'];
let tmp, server, TOKEN;
const envFor = { OFFICE_API: API, OFFICE_NO_TG: '1', HERMES_BIN: FAKE, FAKE_ROOT: ROOT, TEST_FFMPEG: FF, SMM_TTS_ESTIMATE_ONLY: '1', CRAFT_GATE: 'off', DYNAMICS_GATE: 'off', FAKE_VIDEO_DELAY_MS: '3000' };
const api = async (p, body) => { const r = await fetch(API + p, { method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return r.json(); };
// чистим ТОЛЬКО тестовые номера (>= 90000): настоящие ролики имеют номера в сотнях
const cleanup = () => { for (const [base, re] of [[path.join(ROOT, 'smm', 'runs'), /^video_(\d+)$/], [path.join(ROOT, 'video'), /^dosie(\d+)$/]]) { try { for (const f of fs.readdirSync(base)) { const m = re.exec(f); if (m && Number(m[1]) >= 90000) fs.rmSync(path.join(base, f), { recursive: true, force: true }); } } catch {} } };
const state = async () => (await api('/api/state?office=smm'));
const video = async (id) => (await state()).videos.find((v) => v.id === id);
const notesOf = (v) => { try { return JSON.parse(v.notes || '{}'); } catch { return {}; } };
const group = async (gid) => (await state()).videos.filter((v) => { const x = notesOf(v).variant; return x && x.group === gid; });
const ofLetter = async (gid, L) => (await group(gid)).find((v) => notesOf(v).variant.letter === L);
const cards = async (re) => (await api('/api/chat?office=smm')).messages.filter((m) => m.kind === 'action' && re.test(JSON.stringify(m.buttons || '')));
let logN = 0;
function pipe(args, extra = {}) { return new Promise((resolve) => { const log = fs.openSync(path.join(tmp, `pipe_${++logN}_${args[0]}.log`), 'w'); const p = spawn(process.execPath, [path.join(ROOT, 'scripts', 'smm_pipeline.mjs'), ...args], { cwd: ROOT, stdio: ['ignore', log, log], env: { ...process.env, ...envFor, ...extra } }); p.on('exit', resolve); setTimeout(() => { p.kill(); resolve('timeout'); }, 120000); }); }
function seedTopic(db, id) {
  db.prepare("INSERT INTO videos (id, office, title, rubric, stage, notes, created_at, updated_at) VALUES (?, 'smm', ?, 'myth', 'checked', ?, ?, ?)").run(id, 'Кофе обезвоживает?', JSON.stringify({ evidence: ['PMID 24416202'], angle: 'пробирки' }), Date.now(), Date.now());
  const d = runDir(id); fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'script.json'), JSON.stringify({ title: 'Кофе обезвоживает?', rubric: 'myth', hook_type: 'вопрос-ловушка', segments: SA, claims: [], sources_card: ['Killer. 2014.'] }));
  fs.writeFileSync(path.join(d, 'script_ru.txt'), SA.join('\n\n') + '\n'); fs.writeFileSync(path.join(d, 'FACTS.md'), 'Killer 2014, 50 мужчин, 3 дня'); fs.writeFileSync(path.join(d, 'check.json'), JSON.stringify({ verdict: 'pass', summary: 'ок' }));
}
async function waitFor(fn, ms = 150000) { const t0 = Date.now(); for (;;) { const r = await fn(); if (r) return r; if (Date.now() - t0 > ms) return null; await sleep(1000); } }

before(async () => {
  if (!can) return; cleanup();
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vint-')); copyLiveDb(REAL, tmp); TOKEN = JSON.parse(fs.readFileSync(path.join(REAL, 'config.json'), 'utf8')).token;
  const db = new DatabaseSync(path.join(tmp, 'office.db')); seedTopic(db, G1); seedTopic(db, G2);
  db.exec("UPDATE agents SET status='idle', progress=0 WHERE status IN ('working','waiting','error')");          // копия снята с боевого офиса: статусы тех, кто работает в этот момент, к тесту не относятся (иначе тест мигает при каждом монтаже)
  db.close();
  server = spawn(process.execPath, ['server.mjs'], { cwd: path.join(ROOT, 'server'), env: { ...process.env, ...envFor, OFFICE_DATA_DIR: tmp, PORT: String(PORT), OFFICE_CHAT_STUB: '1', OFFICE_NO_WATCH: '1' }, stdio: 'ignore', windowsHide: true });
  for (let i = 0; i < 40; i++) { try { if ((await fetch(API + '/health')).ok) break; } catch {} await sleep(300); }
});
after(async () => { try { server && server.kill(); } catch {} await sleep(800); cleanup(); try { tmp && fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); } catch {} });

test('в офисе есть монтажёры B и C на своих столах, свободны', { skip: !can }, async () => {
  const ag = (await state()).agents; for (const [id, name] of [['video_b', 'Матвей Склеев'], ['video_c', 'Роман Ракурсов']]) { const a = ag.find((x) => x.id === id); assert.ok(a, 'нет ' + id); assert.equal(a.name, name); assert.equal(a.status, 'idle'); }
  assert.deepEqual(['video', 'video_b', 'video_c'].map((id) => ag.find((a) => a.id === id).desk).length, 3);
});

test('variants: появляются записи B и C с метками, ОДНА карточка с кнопками группы, A не переписан', { skip: !can }, async () => {
  const code = await pipe(['variants', String(G1)]); assert.equal(code, 0, fs.readFileSync(path.join(tmp, 'pipe_1_variants.log'), 'utf8').slice(-600));
  const [A, B, C] = [await video(G1), await ofLetter(G1, 'B'), await ofLetter(G1, 'C')]; assert.ok(B && C, 'записи B и C созданы: ' + fs.readFileSync(path.join(tmp, 'pipe_1_variants.log'), 'utf8').slice(-800) + JSON.stringify((await state()).videos.filter((v) => v.id >= 90000).map((v) => [v.id, v.stage, v.notes && v.notes.slice(0, 80)])));
  assert.deepEqual([A, B, C].map((v) => notesOf(v).variant.letter), ['A', 'B', 'C']); assert.ok([B, C].every((v) => notesOf(v).variant.group === G1)); assert.deepEqual([B, C].map((v) => v.stage), ['checked', 'checked']);
  assert.equal(JSON.parse(fs.readFileSync(path.join(runDir(G1), 'script.json'), 'utf8')).segments[0], SA[0], 'A не тронут');
  assert.match(fs.readFileSync(path.join(runDir(B.id), 'script_ru.txt'), 'utf8'), /Пятьдесят мужчин/); assert.equal(JSON.parse(fs.readFileSync(path.join(runDir(C.id), 'panels.json'), 'utf8')).length, 4); assert.equal(fs.readFileSync(path.join(runDir(C.id), 'reveal.txt'), 'utf8').trim(), 'Кофе воду не отнимает');
  const cs = await cards(new RegExp(`approve:${G1}`)); assert.equal(cs.length, 1, 'одна карточка'); const btn = JSON.stringify(cs[0].buttons);
  for (const d of [`approve:${G1}`, `revise:${G1}`, `vregen:${G1}`, `reject:${G1}`, `vdrop:${G1}`, `vdrop:${B.id}`, `vdrop:${C.id}`]) assert.ok(btn.includes(d), 'нет кнопки ' + d); assert.match(cs[0].text, /Варианты сценария \(A, B, C\)/); assert.match(cs[0].text, /🖼 Панель 1: Мужчина в белом халате ставит на весы чашку кофе/); assert.match(cs[0].text, /❓ Последняя панель, ответ: Кофе воду не отнимает/);
  assert.match(fs.readFileSync(path.join(runDir(B.id), 'script.json.queries'), 'utf8'), /ВАРИАНТ B ТОЙ ЖЕ ТЕМЫ/);
});

test('«Утвердить все три»: три монтажа стартуют ОДНОВРЕМЕННО у Кирилла, Матвея и Романа, у каждого свой формат и задание; ролики приходят с меткой варианта', { skip: !can }, async () => {
  const card = (await cards(new RegExp(`approve:${G1}`)))[0]; const r = await api('/api/chat/answer', { id: card.id, choice: `approve:${G1}`, via: 'test' }); assert.ok(r.ok !== false, JSON.stringify(r));
  const ids = [G1, (await ofLetter(G1, 'B')).id, (await ofLetter(G1, 'C')).id];
  const done = await waitFor(async () => { const vs = await Promise.all(ids.map(video)); return vs.every((v) => v.stage === 'produced') ? vs : null; });
  assert.ok(done, 'все три ролика должны дойти до приёмки: ' + JSON.stringify((await state()).videos.filter((v) => v.id >= 90000).map((v) => [v.id, v.stage])));
  const spans = ids.map((id) => JSON.parse(fs.readFileSync(path.join(projDir(id), '_fake_span.json'), 'utf8')));
  assert.deepEqual(spans.map((s) => s.profile), ['video', 'video_b', 'video_c']); assert.deepEqual(spans.map((s) => s.format), ['A', 'B', 'C']); assert.deepEqual(spans.map((s) => s.editor), ['Кирилл Кадров', 'Матвей Склеев', 'Роман Ракурсов']);
  assert.deepEqual(spans.map((s) => s.panels), [false, false, true], 'панели комикса только в задании для C'); assert.ok(spans.every((s) => s.rules), 'в каждом задании правила кругов и очереди рендера');
  assert.ok(Math.max(...spans.map((s) => s.start)) < Math.min(...spans.map((s) => s.end)), 'монтажи шли одновременно: ' + JSON.stringify(spans.map((s) => [s.start % 100000, s.end % 100000])));
  assert.deepEqual(ids.map((id) => JSON.parse(fs.readFileSync(path.join(projDir(id), 'format.json'), 'utf8')).format), ['A', 'B', 'C']);
  const ag = (await state()).agents; assert.deepEqual(['video', 'video_b', 'video_c'].map((id) => ag.find((a) => a.id === id).status), ['idle', 'idle', 'idle']);
  const msgs = (await api('/api/chat?office=smm')).messages; const acc = msgs.filter((m) => m.kind === 'action' && /accept:/.test(JSON.stringify(m.buttons)) && ids.some((id) => JSON.stringify(m.buttons).includes(`accept:${id}`)));
  assert.equal(acc.length, 3, 'три карточки приёмки'); assert.ok(acc.some((m) => /вариант B «Один объект»/.test(m.text))); assert.ok(acc.some((m) => /вариант C «Комикс»/.test(m.text)));
});

test('«Убрать вариант»: вариант не воскресает, карточка пересобирается без моделей; последний убрать нельзя', { skip: !can }, async () => {
  assert.equal(await pipe(['variants', String(G2)]), 0);
  const [B, C] = [await ofLetter(G2, 'B'), await ofLetter(G2, 'C')]; const card = (await cards(new RegExp(`approve:${G2}`)))[0]; assert.ok(card && B && C);
  await api('/api/chat/answer', { id: card.id, choice: `vdrop:${C.id}`, via: 'test' });
  const dropped = await waitFor(async () => { const v = await video(C.id); return v.stage === 'rejected' ? v : null; }, 15000); assert.ok(dropped); assert.equal(notesOf(dropped).dropped, true);
  const fresh = await waitFor(async () => (await cards(new RegExp(`approve:${G2}`))).find((m) => m.id !== card.id && m.status === 'open' && /\(A, B\)/.test(m.text)), 30000); assert.ok(fresh, 'новая карточка из двух вариантов'); assert.match(JSON.stringify(fresh.buttons), /Утвердить оба/);
  await api('/api/chat/answer', { id: fresh.id, choice: `vdrop:${B.id}`, via: 'test' }); await sleep(1500);
  assert.equal((await video(B.id)).stage, 'rejected', 'B убран');
  const last = (await cards(new RegExp(`approve:${G2}`))).filter((m) => m.status === 'open').pop(); assert.ok(last, 'карточка единственного варианта');
  assert.doesNotMatch(JSON.stringify(last.buttons), /vdrop:/, 'у единственного варианта кнопки «Убрать» нет'); assert.match(JSON.stringify(last.buttons), /Утвердить сценарий/); assert.match(last.text, /Сценарий: «Кофе обезвоживает\?»/);
  assert.equal((await video(G2)).stage, 'checked', 'A остаётся в работе');
});

test('правка «B: …» уходит варианту B, а «reject» отклоняет тему вместе с вариантами', { skip: !can }, async () => {
  const [B, C] = [await ofLetter(G2, 'B'), await ofLetter(G2, 'C')];
  const db = new DatabaseSync(path.join(tmp, 'office.db')); db.prepare("UPDATE videos SET stage='checked', notes=json_remove(notes, '$.dropped') WHERE id IN (?, ?)").run(B.id, C.id); db.close();
  const card = (await cards(new RegExp(`revise:${G2}`))).filter((m) => m.status === 'open').pop(); assert.ok(card);
  await api('/api/chat/answer', { id: card.id, choice: `revise:${G2}`, comment: 'B: сделай концовку короче', via: 'test' });
  const note = await waitFor(async () => (await api('/api/chat?office=smm')).messages.find((m) => /Вариант B исправлен по вашим правкам/.test(m.text)), 60000); assert.ok(note, 'карточка обновлена после правки B');
  assert.match(fs.readFileSync(path.join(runDir(B.id), 'script.json.queries'), 'utf8'), /Правка Ника к этому варианту: сделай концовку короче/);
  const open = (await cards(new RegExp(`reject:${G2}`))).filter((m) => m.status === 'open').pop(); await api('/api/chat/answer', { id: open.id, choice: `reject:${G2}`, via: 'test' }); await sleep(1500);
  assert.deepEqual(await Promise.all([G2, B.id, C.id].map(async (id) => (await video(id)).stage)), ['rejected', 'rejected', 'rejected']);
});

// Интеграционный тест подбора тем по кнопке «Другие темы»: настоящий API на КОПИИ данных, настоящий smm_pipeline.mjs topics, имитация Виктора и Льва, Telegram и сеть замера выключены.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { copyLiveDb } from './fixtures/copy_db.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REAL = path.join(ROOT, 'server', 'data');
const can = fs.existsSync(path.join(REAL, 'office.db')) && fs.existsSync(path.join(REAL, 'config.json'));
const PORT = 10800 + (process.pid % 90), API = `http://127.0.0.1:${PORT}`;
const FAKE = path.join(ROOT, 'test', 'fixtures', 'fake_agent.mjs');
const RUNS = path.join(ROOT, 'smm', 'runs'), isTopics = (d) => /_topics$/.test(d);
let tmp, server, token, keep = new Set();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const api = async (p, body) => (await fetch(API + p, { method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })).json();
const run = (extra = {}) => new Promise((resolve) => { const p = spawn(process.execPath, [path.join(ROOT, 'scripts', 'smm_pipeline.mjs'), 'topics'], { cwd: ROOT, env: { ...process.env, OFFICE_API: API, OFFICE_NO_TG: '1', HERMES_BIN: FAKE, OFFICE_NO_DEMAND: '1', OFFICE_DEMAND_KEYS_FILE: path.join(tmp, 'no-keys.json'), ...extra }, stdio: ['ignore', 'pipe', 'pipe'] }); let out = ''; p.stdout.on('data', (b) => (out += b)); p.stderr.on('data', (b) => (out += b)); p.on('exit', (code) => resolve({ code, out })); });
const chat = async () => (await api('/api/chat?office=smm')).messages;
const vids = async () => (await api('/api/state?office=smm&videos=all')).videos;
const maxId = async () => Math.max(0, ...(await vids()).map((v) => v.id));

before(async () => {
  if (!can) return;
  keep = new Set(fs.readdirSync(RUNS).filter(isTopics));      // настоящие подборки тест не трогает
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'topics-demand-')); copyLiveDb(REAL, tmp, 'topics_demand');
  token = JSON.parse(fs.readFileSync(path.join(tmp, 'config.json'), 'utf8')).token;
  server = spawn(process.execPath, [path.join(ROOT, 'server', 'server.mjs')], { cwd: path.join(ROOT, 'server'), env: { ...process.env, OFFICE_DATA_DIR: tmp, OFFICE_NO_TG: '1', OFFICE_CHAT_STUB: '1', OFFICE_NO_WATCH: '1', PORT: String(PORT) }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) { try { if ((await fetch(API + '/health')).ok) break; } catch {} await sleep(200); }
});
after(() => { try { server && server.kill(); } catch {} try { for (const d of fs.readdirSync(RUNS)) if (isTopics(d) && !keep.has(d)) fs.rmSync(path.join(RUNS, d), { recursive: true, maxRetries: 5, force: true }); } catch {} });

test('«Другие темы»: замер спроса кодом, Лев получает замеры, охват = по замерам, карточка с «📊 Спрос» и новым порядком', { skip: !can }, async () => {
  const stub = path.join(tmp, 'demand_stub.json'), TOP = 'Правда ли, что хруст пальцев приводит к артриту?';
  fs.writeFileSync(stub, JSON.stringify({
    '*': { queries: ['а'], wiki: { article: 'Малая статья', how: 'поиск по Википедии', last30: 120, prev30: 100, change: 20 }, suggest: { google: 2, youtube: 1, yandex: 2 } },
    [TOP]: { queries: ['хруст пальцев'], wiki: { article: 'Хруст суставов', how: 'подсказка Виктора', last30: 40000, prev30: 30000, change: 33 }, suggest: { google: 10, youtube: 10, yandex: 10 }, wordstat: { count: 1000000 } },
  }));
  const id0 = await maxId(), c0 = Math.max(0, ...(await chat()).map((m) => m.id));
  const r = await run({ OFFICE_NO_DEMAND: '', OFFICE_DEMAND_STUB: stub }); assert.equal(r.code, 0, r.out);
  const added = (await vids()).filter((v) => v.id > id0); assert.equal(added.length, 8);
  assert.ok(added.every((v) => v.stage === 'scored'), 'темы оценены и ждут выбора Ника');
  const note = (v) => JSON.parse(v.notes), top = added.find((v) => v.title === TOP);
  assert.equal(note(top).demand.reach, 25); assert.equal(note(top).reach_lev, 8); assert.match(note(top).demand_line, /Яндекс: 1.000.000 запросов/);
  const idx = 3;      // TOP четвёртая в списке имитации Виктора; у имитации Льва итог 80 − 2·позиция при охвате 8, то есть 74 − 8 + 25 = 91 против 80 у лучшей без замера
  assert.equal(added.slice().sort((a, b) => b.score - a.score)[0].title, TOP, 'выше всех тема с наибольшим измеренным спросом');
  assert.equal(top.score, 80 - idx * 2 - 8 + 25);
  const low = added.find((v) => v.title !== TOP); assert.ok(note(low).demand.reach < 12);
  const dir = fs.readdirSync(RUNS).filter((d) => isTopics(d) && !keep.has(d)).sort().pop(), P = (f) => path.join(RUNS, dir, f);
  assert.ok(fs.existsSync(P('demand.json')) && fs.existsSync(P('candidates_raw.json')), 'замеры и исходные кандидаты Виктора сохранены');
  assert.ok(JSON.parse(fs.readFileSync(P('scored.json'), 'utf8')).every((x) => x.saw_demand === true), 'Лев получил замеры в файле кандидатов');
  assert.ok(JSON.parse(fs.readFileSync(P('candidates_raw.json'), 'utf8')).every((x) => !('demand' in x)), 'исходные кандидаты без замеров');
  const msgs = (await chat()).filter((m) => m.id > c0);
  const card = msgs.find((m) => /Темы для следующего ролика оценены/.test(m.text)); assert.ok(card, 'карточка тем пришла');
  assert.match(card.text, /📊 Спрос: Википедия «Хруст суставов»/); assert.doesNotMatch(card.text, /гипотеза, не прогноз/); assert.match(card.text, /охват посчитан по замерам спроса/);
  assert.ok(card.text.indexOf(TOP) < card.text.indexOf('Малая статья'), 'тема с наибольшим спросом в карточке первая');
  assert.ok(msgs.some((m) => /посчитан по замерам спроса, остальное моя оценка/.test(m.text)), 'Лев сообщает честно, как считался балл');
});
test('«Другие темы» без замера: охват 0, «не измерено», подборка не падает', { skip: !can }, async () => {
  const id0 = await maxId(); const r = await run({}); assert.equal(r.code, 0, r.out);
  const added = (await vids()).filter((v) => v.id > id0); assert.equal(added.length, 8);
  for (const v of added) { const n = JSON.parse(v.notes); assert.equal(n.demand.level, 'none'); assert.match(n.demand_line, /не измерено/); assert.equal(n.reach_lev, 8); }
  assert.deepEqual([Math.max(...added.map((v) => v.score)), Math.min(...added.map((v) => v.score))], [72, 58], 'без замера охват 0: итог Льва минус его 8 баллов охвата');
});

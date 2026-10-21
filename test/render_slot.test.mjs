// Обёртка рендера: лимит кругов, неудачи, очередь на два слота, мёртвые слоты, --workers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { roundsNote, limitFor, roundsInfo, canRender, tryAcquireSlot, slotsBusy, withWorkers, parseArgs, DEFAULT_LIMITS } from '../scripts/render_slot.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SLOT = path.join(ROOT, 'scripts', 'render_slot.mjs'), FAKE = path.join(ROOT, 'test', 'fixtures', 'fake_render.mjs');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'rslot-'));
const rm = (d) => fs.rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
function run(proj, extra, cmd, env = {}) {
  return new Promise((resolve) => {
    let out = ''; const p = spawn(process.execPath, [SLOT, proj, ...extra, '--', ...cmd], { env: { ...process.env, ...env }, windowsHide: true });
    p.stdout.on('data', (d) => out += d); p.stderr.on('data', (d) => out += d); p.on('exit', (code) => resolve({ code, out }));
  });
}
const fake = (marks, name, ms, code = 0) => [process.execPath, FAKE, marks, name, String(ms), String(code)];

test('лимиты по умолчанию: 3 круга монтажа, 2 на правки; явный --max важнее', () => {
  assert.deepEqual(DEFAULT_LIMITS, { main: 3, rework: 2 });
  assert.equal(limitFor('main'), 3); assert.equal(limitFor('rework1'), 2); assert.equal(limitFor('main', '4'), 4); assert.equal(limitFor('main', 'x'), 3);
});

test('разбор аргументов: проект, лог, пространство, команда после --', () => {
  const a = parseArgs(['C:/p', '--log', '_render_log_b1.txt', '--ns', 'rework1', '--max', '2', '--', 'npx', 'hyperframes', 'render', '-o', 'a b.mp4']);
  assert.deepEqual(a, { proj: 'C:/p', log: '_render_log_b1.txt', ns: 'rework1', max: '2', cmd: ['npx', 'hyperframes', 'render', '-o', 'a b.mp4'] });
});

test('--workers добавляется только к рендеру HyperFrames и только если монтажёр не задал свой', () => {
  const base = ['npx', '--yes', 'hyperframes@0.8.174', 'render', '-o', 'x.mp4', '.'];
  assert.deepEqual(withWorkers(base, 6).slice(0, 5), ['npx', '--yes', 'hyperframes@0.8.174', 'render', '--workers=6']);
  assert.deepEqual(withWorkers([...base, '--workers', '3'], 6), [...base, '--workers', '3']);
  assert.deepEqual(withWorkers([...base, '-w=3'], 6), [...base, '-w=3']);
  assert.deepEqual(withWorkers(['node', 'x.mjs', 'render'], 6), ['node', 'x.mjs', 'render'], 'не hyperframes: не трогаем');
  assert.deepEqual(withWorkers(['npx', 'hyperframes', 'lint'], 6), ['npx', 'hyperframes', 'lint']);
});

test('после трёх успешных рендеров четвёртый не стартует (код 3), команда не запускается', async () => {
  const proj = tmp(), marks = tmp(), slots = tmp(); const env = { RENDER_SLOTS_DIR: slots };
  try {
    for (let i = 1; i <= 3; i++) { const r = await run(proj, ['--log', `_render_log_b${i}.txt`], fake(marks, `r${i}`, 50), env); assert.equal(r.code, 0, r.out); assert.match(r.out, new RegExp(`круг ${i} из 3`)); }
    assert.deepEqual(roundsInfo(proj), { done: 3, fails: 0, limit: 3 });
    const r4 = await run(proj, [], fake(marks, 'r4', 50), env);
    assert.equal(r4.code, 3); assert.match(r4.out, /ЛИМИТ КРУГОВ: 3 из 3/); assert.match(r4.out, /не больше 3/);
    assert.equal(fs.existsSync(path.join(marks, 'r4.start')), false, 'четвёртый рендер не должен запускаться');
    assert.match(fs.readFileSync(path.join(proj, '_render_log_b1.txt'), 'utf8'), /fake render r1/, 'вывод ушёл в лог');
    assert.equal(JSON.parse(fs.readFileSync(path.join(proj, '_render_rounds.json'), 'utf8')).main.history.length, 3);
  } finally { rm(proj); rm(marks); rm(slots); }
});

test('упавший рендер круг не сжигает; шесть неудач подряд блокируют (код 5); успех обнуляет счётчик неудач', async () => {
  const proj = tmp(), marks = tmp(), slots = tmp(); const env = { RENDER_SLOTS_DIR: slots };
  try {
    for (let i = 0; i < 2; i++) assert.equal((await run(proj, [], fake(marks, `f${i}`, 20, 1), env)).code, 1);
    assert.deepEqual(roundsInfo(proj), { done: 0, fails: 2, limit: 3 });
    assert.equal((await run(proj, [], fake(marks, 'ok', 20, 0), env)).code, 0);
    assert.deepEqual(roundsInfo(proj), { done: 1, fails: 0, limit: 3 });
    for (let i = 0; i < 6; i++) await run(proj, [], fake(marks, `g${i}`, 20, 1), env);
    const blocked = await run(proj, [], fake(marks, 'late', 20, 0), env);
    assert.equal(blocked.code, 5); assert.match(blocked.out, /неудачных рендеров подряд \(6\)/); assert.equal(fs.existsSync(path.join(marks, 'late.start')), false);
  } finally { rm(proj); rm(marks); rm(slots); }
});

test('правки считаются отдельно: своё пространство и лимит 2', async () => {
  const proj = tmp(), marks = tmp(), slots = tmp(); const env = { RENDER_SLOTS_DIR: slots };
  try {
    for (let i = 1; i <= 3; i++) assert.equal((await run(proj, [], fake(marks, `m${i}`, 20), env)).code, 0);
    assert.equal(canRender(proj, 'main').ok, false); assert.equal(canRender(proj, 'rework1').ok, true);
    for (let i = 1; i <= 2; i++) assert.equal((await run(proj, ['--ns', 'rework1'], fake(marks, `w${i}`, 20), env)).code, 0);
    const r = await run(proj, ['--ns', 'rework1'], fake(marks, 'w3', 20), env);
    assert.equal(r.code, 3); assert.match(r.out, /2 из 2/);
  } finally { rm(proj); rm(marks); rm(slots); }
});

test('очередь: три рендера одновременно при двух слотах, одновременно идут не больше двух, все дожидаются и завершаются', async () => {
  const marks = tmp(), slots = tmp(), projs = [tmp(), tmp(), tmp()]; const env = { RENDER_SLOTS_DIR: slots, RENDER_SLOTS: '2', RENDER_POLL_MS: '60' };
  try {
    const res = await Promise.all(projs.map((p, i) => run(p, [], fake(marks, `q${i}`, 900), env)));
    assert.deepEqual(res.map((r) => r.code), [0, 0, 0], res.map((r) => r.out).join('\n'));
    const iv = [0, 1, 2].map((i) => [Number(fs.readFileSync(path.join(marks, `q${i}.start`), 'utf8')), Number(fs.readFileSync(path.join(marks, `q${i}.end`), 'utf8'))]);
    let peak = 0; for (const [s] of iv) peak = Math.max(peak, iv.filter(([a, b]) => a <= s && s < b).length);
    assert.equal(peak, 2, 'пик одновременных рендеров: ' + peak + ' ' + JSON.stringify(iv));
    assert.ok(res.some((r) => /ждал очереди/.test(r.out)), 'третий должен был ждать');
    assert.equal(slotsBusy(), 0, 'слоты освобождены');
  } finally { for (const d of [marks, slots, ...projs]) rm(d); }
});

test('мёртвый слот (процесса нет) освобождается сам; живой чужой слот не отбирается', () => {
  const slots = tmp(); process.env.RENDER_SLOTS_DIR = slots; process.env.RENDER_SLOTS = '1';
  try {
    fs.writeFileSync(path.join(slots, 'slot-0.json'), JSON.stringify({ pid: 2147480000, ts: Date.now(), owner: 'мёртвый' }));
    const s = tryAcquireSlot('новый'); assert.ok(s, 'мёртвый слот должен освободиться'); assert.equal(s.index, 0);
    assert.equal(tryAcquireSlot('второй'), null, 'слот занят живым процессом (этим)');
    s.release(); assert.ok(tryAcquireSlot('после освобождения'));
    fs.rmSync(path.join(slots, 'slot-0.json'), { force: true });
    fs.writeFileSync(path.join(slots, 'slot-0.json'), JSON.stringify({ pid: process.pid, ts: Date.now() - 50 * 60e3, owner: 'старый' }));
    assert.ok(tryAcquireSlot('новый2'), 'слот старше 45 минут считается брошенным даже при живом pid');
  } finally { delete process.env.RENDER_SLOTS_DIR; delete process.env.RENDER_SLOTS; rm(slots); }
});

test('очередь не освободилась вовремя: код 4, круг не засчитан, команда не запускалась', async () => {
  const proj = tmp(), marks = tmp(), slots = tmp();
  fs.writeFileSync(path.join(slots, 'slot-0.json'), JSON.stringify({ pid: process.pid, ts: Date.now(), owner: 'держатель' }));
  try {
    const r = await run(proj, [], fake(marks, 'wait', 20), { RENDER_SLOTS_DIR: slots, RENDER_SLOTS: '1', RENDER_QUEUE_MAX_MIN: '0.01', RENDER_POLL_MS: '50' });
    assert.equal(r.code, 4); assert.match(r.out, /Очередь рендера не освободилась/); assert.equal(fs.existsSync(path.join(marks, 'wait.start')), false);
    assert.deepEqual(roundsInfo(proj), { done: 0, fails: 0, limit: 3 });
  } finally { rm(proj); rm(marks); rm(slots); }
});

test('строка для карточки приёмки: круги, очередь, и честная пометка, если рендер шёл мимо обёртки', async () => {
  const proj = tmp(), marks = tmp(), slots = tmp(); const env = { RENDER_SLOTS_DIR: slots };
  try {
    assert.equal(roundsNote(proj), '', 'ничего не было: пусто');
    fs.writeFileSync(path.join(proj, '_render_log_b1.txt'), 'x'); fs.writeFileSync(path.join(proj, '_render_log_b2.txt'), 'x');
    assert.match(roundsNote(proj), /мимо обёртки.*по логам 2 рендеров при лимите 3/);
    fs.rmSync(path.join(proj, '_render_log_b1.txt')); fs.rmSync(path.join(proj, '_render_log_b2.txt'));
    for (let i = 1; i <= 2; i++) await run(proj, ['--log', `_render_log_b${i}.txt`], fake(marks, `n${i}`, 20), env);
    assert.match(roundsNote(proj), /^🔁 Кругов рендера: 2 из 3/); assert.doesNotMatch(roundsNote(proj), /мимо/);
    fs.writeFileSync(path.join(proj, '_render_log_b3.txt'), 'x'); fs.writeFileSync(path.join(proj, '_render_log_b4.txt'), 'x');
    assert.match(roundsNote(proj), /2 из 3.*По логам рендеров 4: часть шла мимо обёртки/);
  } finally { rm(proj); rm(marks); rm(slots); }
});

test('задания монтажёру и на правки содержат правила рендера: обёртка, лимит, коды', async () => {
  const { renderRules } = await import('../scripts/render_rules.mjs');
  const tpl = fs.readFileSync(path.join(ROOT, 'smm', 'brief_template.md'), 'utf8');
  assert.equal((tpl.match(/\{\{RENDER_RULES\}\}/g) || []).length, 1, 'в шаблоне монтажа ровно одно место для правил рендера');
  const main = renderRules({ proj: 'C:\\v\\dosie20', scripts: 'C:\\s' });
  assert.match(main, /не больше 3/); assert.match(main, /render_slot\.mjs C:\/v\/dosie20 --log _render_log_bN\.txt -- npx/); assert.doesNotMatch(main, /--ns/);
  assert.match(main, /3 лимит кругов[\s\S]*4 очередь[\s\S]*5 слишком много/); assert.match(main, /REVIEW_LOG\.builds/);
  const rw = renderRules({ proj: 'C:/v/dosie20', scripts: 'C:/s', ns: 'rework2' });
  assert.match(rw, /не больше 2/); assert.match(rw, /--ns rework2/);
  const pipe = fs.readFileSync(path.join(ROOT, 'scripts', 'smm_pipeline.mjs'), 'utf8');
  assert.match(pipe, /\$\{renderRules\(\{ proj, scripts: path\.join\(ROOT, 'scripts'\), ns: 'rework'/, 'бриф правок подставляет правила');
  assert.match(pipe, /replaceAll\('\{\{RENDER_RULES\}\}'/, 'бриф монтажа подставляет правила');
});

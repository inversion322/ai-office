import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { decide, DONE_STAGES, readFrom } from '../scripts/restart_when_idle.mjs';

const base = { stage: 'produced', busy: [], idleStreak: 3, priorityActive: false };
test('ролик собран, никто не работает, тихо 3 проверки: можно', () => assert.equal(decide(base).go, true));
test('пока сценарий или монтаж идёт (script/checked/editing), ждём', () => { for (const s of ['idea', 'scored', 'script', 'checked', 'editing', 'нет такого ролика']) assert.equal(decide({ ...base, stage: s }).go, false, s); });
test('если ролик принят или тему отклонили, монтажа уже не будет: тоже можно (но только в тишине)', () => { assert.deepEqual(DONE_STAGES, ['produced', 'approved', 'rejected']); assert.equal(decide({ ...base, stage: 'rejected' }).go, true); });
test('работающие сотрудники, приоритетные правки и короткая тишина не пускают', () => {
  assert.match(decide({ ...base, busy: ['этап package'] }).why, /работают: этап package/);
  assert.equal(decide({ ...base, priorityActive: true }).go, false);
  assert.equal(decide({ ...base, idleStreak: 2 }).go, false); assert.match(decide({ ...base, idleStreak: 1 }).why, /1 из 3/);
});

test('хвост журнала берётся по БАЙТАМ: строка с кириллицей после смещения находится (раньше срез по символам её пропускал)', () => {
  const f = path.join(os.tmpdir(), 'rw-' + process.pid + '.log');
  const before = '2026-10-19 туннель: старт\nапи: старт\n'; const after = '2026-10-19 кнопка Mini App обновлена (попыток: 1)\n';
  fs.writeFileSync(f, before + after, 'utf8');
  const off = fs.statSync(f).size - Buffer.byteLength(after);
  try {
    assert.equal(readFrom(f, off), after); assert.match(readFrom(f, off), /кнопка Mini App обновлена/);
    assert.ok(!/кнопка Mini App обновлена/.test(fs.readFileSync(f, 'utf8').slice(off)), 'контроль: старый способ (срез строки по байтам) строку терял');
    assert.equal(readFrom(path.join(os.tmpdir(), 'нет-такого.log'), 5), '');
  } finally { fs.rmSync(f, { force: true }); }
});

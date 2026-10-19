import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decide, DONE_STAGES } from '../scripts/restart_when_idle.mjs';

const base = { stage: 'produced', busy: [], idleStreak: 3, priorityActive: false };
test('ролик собран, никто не работает, тихо 3 проверки: можно', () => assert.equal(decide(base).go, true));
test('пока сценарий или монтаж идёт (script/checked/editing), ждём', () => { for (const s of ['idea', 'scored', 'script', 'checked', 'editing', 'нет такого ролика']) assert.equal(decide({ ...base, stage: s }).go, false, s); });
test('если ролик принят или тему отклонили, монтажа уже не будет: тоже можно (но только в тишине)', () => { assert.deepEqual(DONE_STAGES, ['produced', 'approved', 'rejected']); assert.equal(decide({ ...base, stage: 'rejected' }).go, true); });
test('работающие сотрудники, приоритетные правки и короткая тишина не пускают', () => {
  assert.match(decide({ ...base, busy: ['этап package'] }).why, /работают: этап package/);
  assert.equal(decide({ ...base, priorityActive: true }).go, false);
  assert.equal(decide({ ...base, idleStreak: 2 }).go, false); assert.match(decide({ ...base, idleStreak: 1 }).why, /1 из 3/);
});

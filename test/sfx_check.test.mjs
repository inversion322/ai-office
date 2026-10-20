import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { judgeSfx, checkSfx } from '../scripts/sfx_check.mjs';

test('v3 ролика №2 (83 события, 21 whoosh, 22 thump, 3 swish) не проходит: именно это Ник назвал раздражающим', () => {
  const r = judgeSfx({ events: 83, by_kind: { click: 18, pop: 17, stamp: 2, swish: 3, thump: 22, whoosh: 21 } });
  assert.equal(r.ok, false);
  assert.ok(r.problems.some((p) => /83/.test(p))); assert.ok(r.problems.some((p) => /whoosh/.test(p))); assert.ok(r.problems.some((p) => /swish/.test(p))); assert.ok(r.problems.some((p) => /ударов 22/.test(p)));
});

test('мягкие звуки появления текста и один удар на штампе проходят', () => {
  assert.equal(judgeSfx({ events: 14, by_kind: { pop: 10, click: 3, thump: 1 } }).ok, true);
  assert.equal(judgeSfx({ by_kind: { pop: 21 } }).ok, false, 'число событий считается и по by_kind, если events не указан');
});

test('checkSfx берёт самый свежий _sfx*.json проекта; нет отчёта или битый — не блокируем', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sfx-'));
  try {
    assert.equal(checkSfx(dir).ok, true); assert.equal(checkSfx(dir).file, null);
    fs.writeFileSync(path.join(dir, '_sfx_v3.json'), JSON.stringify({ events: 83, by_kind: { whoosh: 21 } }));
    const old = new Date(Date.now() - 60000); fs.utimesSync(path.join(dir, '_sfx_v3.json'), old, old);
    fs.writeFileSync(path.join(dir, '_sfx_v4.json'), JSON.stringify({ events: 12, by_kind: { pop: 11, thump: 1 } }));
    const r = checkSfx(dir); assert.equal(r.ok, true); assert.equal(r.file, '_sfx_v4.json');
    fs.writeFileSync(path.join(dir, '_sfx_v5.json'), '{не json');
    assert.equal(checkSfx(dir).ok, true);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

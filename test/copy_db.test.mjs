import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { copyLiveDb } from './fixtures/copy_db.mjs';

test('в копию боевой базы не попадают приоритет правок и ожидание комментария (иначе тестовые этапы ждут до 100 минут)', () => {
  const real = fs.mkdtempSync(path.join(os.tmpdir(), 'live-')), tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'copy-'));
  try {
    const db = new DatabaseSync(path.join(real, 'office.db')); db.exec("CREATE TABLE kv (k TEXT PRIMARY KEY, v TEXT); INSERT INTO kv VALUES ('priority','{\"since\":1}'),('awaiting','{}'),('video_job','{\"ver\":\"v2\"}')"); db.close();
    fs.writeFileSync(path.join(real, 'config.json'), '{}');
    copyLiveDb(real, tmp);
    const c = new DatabaseSync(path.join(tmp, 'office.db')); const keys = c.prepare('SELECT k FROM kv').all().map((r) => r.k); c.close();
    assert.deepEqual(keys, ['video_job'], 'остальное состояние сохраняется'); assert.ok(fs.existsSync(path.join(tmp, 'config.json')));
    const live = new DatabaseSync(path.join(real, 'office.db')); assert.equal(live.prepare('SELECT COUNT(*) c FROM kv').get().c, 3, 'боевая база не тронута'); live.close();
  } finally { fs.rmSync(real, { recursive: true, force: true }); fs.rmSync(tmp, { recursive: true, force: true }); }
});

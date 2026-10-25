import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { copyLiveDb, idBaseFor } from './fixtures/copy_db.mjs';

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

const mkLive = (withSeq) => {
  const real = fs.mkdtempSync(path.join(os.tmpdir(), 'live-')), tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'copy-'));
  const db = new DatabaseSync(path.join(real, 'office.db'));
  db.exec(withSeq ? "CREATE TABLE videos (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT); INSERT INTO videos (title) VALUES ('a'),('b'); CREATE TABLE kv (k TEXT PRIMARY KEY, v TEXT)" : "CREATE TABLE kv (k TEXT PRIMARY KEY, v TEXT)");
  db.close(); fs.writeFileSync(path.join(real, 'config.json'), '{}');
  return { real, tmp, rm: () => { fs.rmSync(real, { recursive: true, force: true }); fs.rmSync(tmp, { recursive: true, force: true }); } };
};
const nextVideoId = (tmp) => { const d = new DatabaseSync(path.join(tmp, 'office.db')); const r = d.prepare("INSERT INTO videos (title) VALUES ('новый')").run(); d.close(); return Number(r.lastInsertRowid); };

test('с тегом новые ролики в копии получают номера из диапазона файла, а не «боевой максимум + 1»', () => {
  const x = mkLive(true);
  try {
    copyLiveDb(x.real, x.tmp, 'publisher');
    const id = nextVideoId(x.tmp);
    assert.ok(id > idBaseFor('publisher') && id <= idBaseFor('publisher') + 1000, `номер ${id}`);
    const live = new DatabaseSync(path.join(x.real, 'office.db')); assert.equal(live.prepare('SELECT MAX(id) m FROM videos').get().m, 2, 'боевая база не тронута'); live.close();
  } finally { x.rm(); }
});

test('без тега поведение прежнее; номер в боевой базе уже выше базы диапазона не понижается', () => {
  const x = mkLive(true);
  try { copyLiveDb(x.real, x.tmp); assert.equal(nextVideoId(x.tmp), 3); } finally { x.rm(); }
  const y = mkLive(true);
  try {
    const live = new DatabaseSync(path.join(y.real, 'office.db')); live.exec("INSERT INTO videos (id, title) VALUES (999999999, 'очень далеко')"); live.close();
    copyLiveDb(y.real, y.tmp, 'publisher'); assert.equal(nextVideoId(y.tmp), 1000000000);
  } finally { y.rm(); }
});

test('копия без таблицы videos (старый стенд) не падает с тегом', () => {
  const x = mkLive(false);
  try { copyLiveDb(x.real, x.tmp, 'publisher'); } finally { x.rm(); }
});

test('охрана: каждый интеграционный тест на копии боевой БД передаёт свой тег, диапазоны не пересекаются (иначе параллельные файлы стирают чужие папки smm/runs/video_<номер>)', () => {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const tags = [];
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.integration.test.mjs'))) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    if (!/copyLiveDb\(/.test(src)) continue;
    const m = /copyLiveDb\(REAL, tmp, '([^']+)'\)/.exec(src);
    assert.ok(m, `${f}: copyLiveDb вызван без тега`);
    tags.push([f, m[1]]);
  }
  assert.ok(tags.length >= 10, 'тестов с копией БД: ' + tags.length);
  const seen = new Map();
  for (const [f, tag] of tags) { const b = idBaseFor(tag); assert.ok(!seen.has(b), `${f} и ${seen.get(b)} делят диапазон номеров`); seen.set(b, f); }
});

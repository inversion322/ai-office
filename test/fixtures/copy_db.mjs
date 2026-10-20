// Копия боевой базы для интеграционного теста. Состояние «в работе», которое могло быть на момент копирования, в копию не берётся:
// включённый приоритет правок (kv 'priority') заставлял тестовые этапы ждать его снятия до 100 минут, а ожидание комментария (kv 'awaiting') съедало бы сообщения теста.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
export function copyLiveDb(realDir, tmpDir) {
  const dst = path.join(tmpDir, 'office.db');
  fs.copyFileSync(path.join(realDir, 'office.db'), dst); fs.copyFileSync(path.join(realDir, 'config.json'), path.join(tmpDir, 'config.json'));
  const db = new DatabaseSync(dst);
  try { db.exec("DELETE FROM kv WHERE k IN ('priority','awaiting')"); } catch {} finally { db.close(); }
  return dst;
}

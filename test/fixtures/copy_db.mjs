// Копия боевой базы для интеграционного теста. Состояние «в работе», которое могло быть на момент копирования, в копию не берётся:
// включённый приоритет правок (kv 'priority') заставлял тестовые этапы ждать его снятия до 100 минут, а ожидание комментария (kv 'awaiting') съедало бы сообщения теста.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
/** Номера новых роликов в копии: каждый тестовый файл (tag) получает свой диапазон из 1000 номеров.
 *  Без этого все файлы стартуют с одного и того же «максимальный номер в боевой БД + 1» и параллельно работают с одними и теми же
 *  папками smm/runs/video_<номер> и video/dosie<номер>: чужая очистка стирала файлы чужого теста (редкие красные прогоны без причины в продукте). */
export function idBaseFor(tag) { return 300000 + (Array.from(String(tag)).reduce((a, c, i) => a + c.charCodeAt(0) * (i + 1), 0) % 900) * 1000; }
export function copyLiveDb(realDir, tmpDir, tag = '') {
  const dst = path.join(tmpDir, 'office.db');
  fs.copyFileSync(path.join(realDir, 'office.db'), dst); fs.copyFileSync(path.join(realDir, 'config.json'), path.join(tmpDir, 'config.json'));
  const db = new DatabaseSync(dst);
  try { db.exec("DELETE FROM kv WHERE k IN ('priority','awaiting')"); } catch {}
  // Копия несёт состояние ЖИВОГО офиса: работающий сотрудник и его открытая запись запуска (agent_runs). Тест, который «запускает» того же сотрудника,
  // получал продолжение чужого запуска (elapsed_sec 40+ вместо <5; progress.integration красный, когда полный прогон шёл во время реальной работы Ксении).
  try { db.exec("UPDATE agents SET status='idle', progress=0 WHERE status IN ('working','waiting','error')"); } catch {}
  try { db.exec("UPDATE agent_runs SET finished_at=started_at, outcome='copy' WHERE finished_at IS NULL"); } catch {}
  try {
    if (tag && db.prepare("SELECT 1 FROM sqlite_master WHERE name='sqlite_sequence'").get()) {      // таблицы нет, пока в базе нет ни одной AUTOINCREMENT-таблицы
      const base = idBaseFor(tag), row = db.prepare("SELECT seq FROM sqlite_sequence WHERE name='videos'").get();
      if (!row) db.prepare("INSERT INTO sqlite_sequence (name, seq) VALUES ('videos', ?)").run(base);
      else if (row.seq < base) db.prepare("UPDATE sqlite_sequence SET seq=? WHERE name='videos'").run(base);
    }
  } finally { db.close(); }
  return dst;
}

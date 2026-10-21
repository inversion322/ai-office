// Проверка, что монтажёр (профиль video) действительно открыл обязательные скиллы перед работой. Решение после разбора сессий 2026-10-19..20:
// Кирилл открывал только nick-hyperframes-notes и hyperframes-core, а hyperframes-animation / registry / media-use ни разу, поэтому анимации писались с нуля в одном шаблоне.
// Читаем state.db профиля (копией: она открыта у работающего агента) и ищем вызовы skill_view в сессиях, начатых после sinceMs.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// vizavi-motion добавлен 2026-10-21 (метод: раскадровка с вариантами, камера/глубина, доработка после первой сборки). Его умолчания (1920×1080, 60 к/с, музыка и звуки) НЕ действуют: правила канала важнее, это прописано в брифе.
export const REQUIRED_SKILLS = ['hyperframes-animation', 'hyperframes-registry', 'vertical-video-editing', 'vizavi-motion'];
const profileDb = (profile = 'video') => path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'hermes', 'profiles', profile, 'state.db');

function collectSkills(db, sess) {
  const used = new Set();
  const q = db.prepare("SELECT tool_calls FROM messages WHERE session_id = ? AND role = 'assistant' AND tool_calls LIKE '%skill_view%'");
  for (const id of sess) for (const row of q.all(id)) {
    let calls; try { calls = JSON.parse(row.tool_calls); } catch { continue; }
    for (const c of calls || []) {
      const fn = c.function || {}; if (fn.name !== 'skill_view') continue;
      let a = {}; try { a = JSON.parse(fn.arguments || '{}'); } catch {}
      if (a.name) used.add(String(a.name));
    }
  }
  return used;
}
// Копия state.db (она открыта у работающего агента) и выбор сессий функцией pick(db) -> [id].
function withDbCopy(dbFile, pick) {
  const out = { used: new Set(), sessions: 0, checked: false };
  if (!fs.existsSync(dbFile)) return out;
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'skillu-')), 'state.db');
  try {
    fs.copyFileSync(dbFile, tmp);
    for (const e of ['-wal', '-shm']) if (fs.existsSync(dbFile + e)) fs.copyFileSync(dbFile + e, tmp + e);
    const db = new DatabaseSync(tmp);
    try { const sess = pick(db); out.sessions = sess.length; out.checked = true; out.used = collectSkills(db, sess); } finally { db.close(); }
  } catch { out.checked = false; }
  finally { try { fs.rmSync(path.dirname(tmp), { recursive: true, force: true }); } catch {} }
  return out;
}

/** Возвращает { used: Set<string>, sessions: n, checked: bool }. dbFile нужен только тестам. */
export function skillsOpenedSince(sinceMs, dbFile = profileDb()) {
  return withDbCopy(dbFile, (db) => db.prepare('SELECT id FROM sessions WHERE started_at >= ?').all(sinceMs / 1000 - 5).map((r) => r.id));
}

/** Те же скиллы, но только в сессиях ОДНОГО запуска сотрудника: метка запуска лежит в тексте задания (первое сообщение сессии).
 *  Нужна, потому что в профиле smm работают сразу несколько сотрудников и по времени их сессии не различить. */
export function skillsOpenedByRun(token, { profile = 'smm', dbFile } = {}) {
  const file = dbFile || profileDb(profile);
  return withDbCopy(file, (db) => db.prepare("SELECT DISTINCT session_id AS id FROM messages WHERE role = 'user' AND content LIKE ?").all(`%${String(token).replace(/[%_]/g, '')}%`).map((r) => r.id));
}
export function missingSkills(used, required = REQUIRED_SKILLS) { return required.filter((s) => !used.has(s)); }
export function skillUsageNote(sinceMs, dbFile) {
  if (process.env.SKILL_GATE === 'off') return '';
  const u = skillsOpenedSince(sinceMs, dbFile);
  if (!u.checked || !u.sessions) return '';                       // не смогли проверить: молчим, а не обвиняем
  const miss = missingSkills(u.used);
  return miss.length ? `⚠️ Кирилл не открыл обязательные скиллы: ${miss.join(', ')}. Анимации и переходы собраны вручную, без готовых правил и блоков (вероятен однотипный вид).` : '';
}

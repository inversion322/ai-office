// Напоминания Нику, привязанные к событию, а не ко времени («напомни, когда закончится сегодняшний ролик»).
// Файл smm/reminders.json: [{ id, when: 'package_done', text, fired: false }]. Событие 'package_done' срабатывает в конце этапа «пакет публикации»
// (после приёмки ролика Ником и работы Тимофея). Сработавшее помечается fired, повторно не шлётся. Нет файла или записей: ничего не делает.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Тестовый запуск (OFFICE_NO_TG=1 или другой каталог данных) не должен сжигать боевые напоминания: файл берётся из OFFICE_REMINDERS_DIR, а при OFFICE_NO_TG без него — пустой список.
const FILE = (root) => (root ? path.join(root, 'smm', 'reminders.json') : process.env.OFFICE_REMINDERS_DIR ? path.join(process.env.OFFICE_REMINDERS_DIR, 'reminders.json') : process.env.OFFICE_NO_TG ? path.join(ROOT, 'smm', '_no_reminders_in_tests.json') : path.join(ROOT, 'smm', 'reminders.json'));
export function loadReminders(root) { try { const j = JSON.parse(fs.readFileSync(FILE(root), 'utf8')); return Array.isArray(j) ? j : []; } catch { return []; } }
export function saveReminders(list, root) { fs.mkdirSync(path.dirname(FILE(root)), { recursive: true }); fs.writeFileSync(FILE(root), JSON.stringify(list, null, 1), 'utf8'); }
/** Возвращает тексты сработавших напоминаний и помечает их. send(text) вызывается для каждого; пометка fired ставится только после успешной отправки. */
export async function fireReminders(event, send, root) {
  const list = loadReminders(root), done = [];
  for (const r of list) {
    if (r.fired || r.when !== event) continue;
    try { await send(r.text); r.fired = true; r.fired_at = new Date().toISOString(); done.push(r.text); } catch { /* не вышло: останется и сработает в следующий раз */ }
  }
  if (done.length) saveReminders(list, root);
  return done;
}

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { skillsOpenedSince, missingSkills, skillUsageNote, REQUIRED_SKILLS } from '../scripts/skill_usage.mjs';

function makeDb(rows) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'su-')), file = path.join(dir, 'state.db'), db = new DatabaseSync(file);
  db.exec('CREATE TABLE sessions (id TEXT PRIMARY KEY, started_at REAL); CREATE TABLE messages (id INTEGER PRIMARY KEY, session_id TEXT, role TEXT, tool_calls TEXT)');
  for (const r of rows) {
    db.prepare('INSERT INTO sessions VALUES (?, ?)').run(r.id, r.t);
    for (const names of r.skills) db.prepare("INSERT INTO messages (session_id, role, tool_calls) VALUES (?, 'assistant', ?)").run(r.id, JSON.stringify(names.map((n) => ({ function: { name: 'skill_view', arguments: JSON.stringify(typeof n === 'string' ? { name: n } : n) } }))));
  }
  db.close(); return { dir, file };
}
const T0 = 1_792_000_000_000;

test('читает вызовы skill_view только сессий, начатых после запуска; чужие и старые не считаются', () => {
  const { dir, file } = makeDb([{ id: 'old', t: T0 / 1000 - 3600, skills: [['hyperframes-animation']] }, { id: 'now', t: T0 / 1000 + 10, skills: [['hyperframes-core'], [{ name: 'hyperframes-registry', file_path: 'SKILL.md' }]] }]);
  try {
    const u = skillsOpenedSince(T0, file); assert.equal(u.checked, true); assert.equal(u.sessions, 1);
    assert.deepEqual([...u.used].sort(), ['hyperframes-core', 'hyperframes-registry']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('регрессия: сессия Кирилла только с core/keyframes/notes (как 2026-10-19..20) даёт предупреждение с нужными скиллами', () => {
  const { dir, file } = makeDb([{ id: 'k', t: T0 / 1000, skills: [['nick-hyperframes-notes'], ['hyperframes-core'], ['hyperframes-keyframes']] }]);
  try {
    const note = skillUsageNote(T0 - 1000, file); assert.match(note, /не открыл обязательные скиллы: hyperframes-animation, hyperframes-registry/);
    assert.deepEqual(missingSkills(new Set(['hyperframes-animation', 'hyperframes-registry'])), []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('все обязательные скиллы открыты — тишина; нет базы, нет сессий или SKILL_GATE=off — тоже тишина (не обвиняем без данных)', () => {
  const { dir, file } = makeDb([{ id: 'k', t: T0 / 1000, skills: [REQUIRED_SKILLS] }]);
  try {
    assert.equal(skillUsageNote(T0 - 1000, file), '');
    assert.equal(skillUsageNote(T0 - 1000, path.join(dir, 'нет.db')), '');
    assert.equal(skillUsageNote(T0 + 999_999_000, file), '', 'сессий после запуска нет');
    const empty = makeDb([{ id: 'k', t: T0 / 1000, skills: [['hyperframes-core']] }]);
    process.env.SKILL_GATE = 'off'; assert.equal(skillUsageNote(T0 - 1000, empty.file), ''); delete process.env.SKILL_GATE;
    fs.rmSync(empty.dir, { recursive: true, force: true });
  } finally { delete process.env.SKILL_GATE; fs.rmSync(dir, { recursive: true, force: true }); }
});

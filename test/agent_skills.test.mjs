import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import * as AS from '../scripts/agent_skills.mjs';
const { AGENT_SKILLS, requiredFor, skillsBlock, retryNote } = AS;
import { skillsOpenedByRun } from '../scripts/skill_usage.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FAKE = path.join(ROOT, 'test', 'fixtures', 'fake_agent.mjs');
const LOCAL = path.join(process.env.LOCALAPPDATA || '', 'hermes');

test('обязательные скиллы: Ксения (short-video-script-craft, storytelling, storytelling-hooks, humanizer); у Веры обязательных нет (grounded-citations и реестр цитат убраны 2026-10-27); остальным тоже нет; youtube-content намеренно не подключён', () => {
  assert.deepEqual(requiredFor('scriptwriter'), ['short-video-script-craft', 'storytelling', 'storytelling-hooks', 'humanizer']); assert.deepEqual(requiredFor('factcheck'), []);
  for (const a of ['research', 'virality', 'packager', 'captain_smm', 'нет-такого']) assert.deepEqual(requiredFor(a), [], a);
  assert.ok(!JSON.stringify(AGENT_SKILLS).includes('youtube-content'), 'пакета youtube_transcript_api на ПК нет, ставить без согласия Ника нельзя');
});

test('скиллы лежат в профиле smm, из которого работают сотрудники (иначе skill_view упадёт)', { skip: !process.env.LOCALAPPDATA }, () => {
  for (const [rel, f] of [['creative/short-video-script-craft', 'SKILL.md'], ['creative/humanizer', 'SKILL.md'], ['creative/storytelling', 'SKILL.md'], ['creative/storytelling-hooks', 'SKILL.md'], ['web/blocked-page-recovery', 'SKILL.md']]) assert.ok(fs.existsSync(path.join(LOCAL, 'profiles', 'smm', 'skills', rel, f)), 'нет в профиле smm: ' + rel);
});

test('блок Ксении: оба скилла, ограничение пунктов humanizer (31 и 32 запрещены), нельзя трогать числа, связки и строки Ника', () => {
  const b = skillsBlock('scriptwriter', { dir: 'C:/x/video_9' });
  assert.match(b, /skill_view\('short-video-script-craft'\)/); assert.match(b, /skill_view\('humanizer'\)/); assert.match(b, /storytelling/); assert.match(b, /storytelling-hooks/); assert.match(b, /ИСТОРИЯ \(решение Ника 2026-10-21/); assert.match(b, /Сначала в уме выбери главную сцену/); assert.match(b, /lens/); assert.match(b, /bookend/); assert.match(b, /НЕ берёшь: выдуманные личные истории/); assert.match(b, /НЕ применяй 31 и 32/); assert.match(b, /Не трогай числа.*связки «но\/поэтому».*дословно/s); assert.match(b, /blocked-page-recovery/);
});

test('блок Веры: сверка СМЫСЛА выжимки, без реестра и без дословных цитат (решение Ника 2026-10-27); никаких команд sources.py', () => {
  const b = skillsBlock('factcheck', { dir: 'C:/x/video_9' });
  assert.match(b, /КРАТКУЮ ВЫЖИМКУ/); assert.match(b, /Сверяй смысл, а не слова/); assert.match(b, /НЕ требуй дословных цитат, НЕ веди реестр/); assert.match(b, /efetch\.fcgi\?db=pubmed.*retmode=text/); assert.match(b, /Возвращай сценарий только за реальную ошибку смысла/); assert.match(b, /blocked-page-recovery/);
  assert.ok(!/--ledger|ledger\.json|skill_view\('grounded-citations'\)|render --style evidence|quote <id>|python "/.test(b), 'команд реестра в задании нет (слова «не запускай sources.py» есть: это запрет)');
});

test('реестр цитат убран из кода: нет ни проверки доказательств, ни путей к ledger/sources.py', () => {
  for (const name of ['ledgerQuotes', 'evidenceIssues', 'evidenceFeedback', 'ledgerPath', 'SOURCES_PY']) assert.equal(AS[name], undefined, name + ' больше не экспортируется');
  assert.ok(!JSON.stringify(AGENT_SKILLS).includes('grounded-citations'));
});

test('блоки Виктора и Льва: только запасной путь при закрытых страницах; Тимофей и Капитан без блока', () => {
  for (const a of ['research', 'virality']) { const b = skillsBlock(a); assert.match(b, /blocked-page-recovery/); assert.ok(!/humanizer|grounded-citations/.test(b)); }
  assert.equal(skillsBlock('packager'), ''); assert.equal(skillsBlock('captain_smm'), '');
});

test('повторный запуск называет пропущенные скиллы', () => { assert.match(retryNote(['humanizer', 'x']), /не открыл обязательные скиллы: humanizer, x/); });

// ---- проверка по метке запуска (в профиле smm работают несколько сотрудников, по времени их сессии не различить)
function makeDb(sessions) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ask-')), file = path.join(dir, 'state.db'), db = new DatabaseSync(file);
  db.exec('CREATE TABLE sessions (id TEXT PRIMARY KEY, started_at REAL); CREATE TABLE messages (id INTEGER PRIMARY KEY, session_id TEXT, role TEXT, content TEXT, tool_calls TEXT)');
  for (const s of sessions) {
    db.prepare('INSERT INTO sessions VALUES (?, ?)').run(s.id, 1);
    db.prepare("INSERT INTO messages (session_id, role, content) VALUES (?, 'user', ?)").run(s.id, `Ты сотрудник.\n=== ЗАДАЧА ===\n...\n[метка запуска, служебная: ${s.token}]`);
    for (const n of s.skills) db.prepare("INSERT INTO messages (session_id, role, tool_calls) VALUES (?, 'assistant', ?)").run(s.id, JSON.stringify([{ function: { name: 'skill_view', arguments: JSON.stringify({ name: n }) } }]));
  }
  db.close(); return { dir, file };
}
test('skillsOpenedByRun: берёт скиллы только сессии с этой меткой; чужие сотрудники профиля не засчитываются; нет сессии = не проверено', () => {
  const { dir, file } = makeDb([{ id: 'a', token: 'RUN-script1-aaa-1', skills: ['short-video-script-craft', 'humanizer'] }, { id: 'b', token: 'RUN-check1-bbb-1', skills: ['grounded-citations'] }, { id: 'c', token: 'RUN-script1-aaa-2', skills: [] }]);
  try {
    const a = skillsOpenedByRun('RUN-script1-aaa-1', { dbFile: file }); assert.equal(a.checked, true); assert.equal(a.sessions, 1); assert.deepEqual([...a.used].sort(), ['humanizer', 'short-video-script-craft']);
    assert.deepEqual([...skillsOpenedByRun('RUN-check1-bbb-1', { dbFile: file }).used], ['grounded-citations']);
    assert.equal(skillsOpenedByRun('RUN-script1-aaa-2', { dbFile: file }).used.size, 0, 'повтор без скиллов виден отдельно');
    const none = skillsOpenedByRun('RUN-нет-такого', { dbFile: file }); assert.equal(none.sessions, 0); assert.equal(skillsOpenedByRun('x', { dbFile: path.join(dir, 'нет.db') }).checked, false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ---- runAgent: один повтор с требованием, если обязательные скиллы не открыты
process.env.HERMES_BIN = FAKE; process.env.OFFICE_API = 'http://127.0.0.1:1';
const can = fs.existsSync(path.join(ROOT, 'server', 'data', 'config.json'));
async function runWith(checker, { label = 'script1', env = {} } = {}) {
  const lib = await import('../scripts/smm_lib.mjs'), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ra-')), calls = [];
  const keep = {}; for (const [k, v] of Object.entries(env)) { keep[k] = process.env[k]; if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  lib.skillCheck.fn = (tok) => { calls.push(tok); return checker(calls.length); };
  try { const r = await lib.runAgent({ label, persona: 'Ты Ксения', task: 'Напиши что-нибудь', outFile: path.join(dir, 'script.json') }); return { r, dir, calls, files: fs.readdirSync(dir).sort() }; }
  finally { for (const [k, v] of Object.entries(keep)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
}
const got = (...n) => ({ checked: true, sessions: 1, used: new Set(n) });
test('runAgent: обязательные скиллы не открыты в первой попытке → ровно один повтор с «ПОВТОР»; во второй открыты → нет предупреждения', { skip: !can }, async () => {
  const { r, dir, files, calls } = await runWith((n) => (n === 1 ? got('humanizer') : got('short-video-script-craft', 'storytelling', 'storytelling-hooks', 'humanizer')));
  try {
    assert.ok(files.includes('_query_script1.txt') && files.includes('_query_script1_retry2.txt'), files.join(','));
    assert.match(fs.readFileSync(path.join(dir, '_query_script1_retry2.txt'), 'utf8'), /ПОВТОР: .*short-video-script-craft/); assert.ok(!/ПОВТОР:/.test(fs.readFileSync(path.join(dir, '_query_script1.txt'), 'utf8')));
    assert.equal(r.skills.retried, true); assert.deepEqual(r.skills.missing, []); assert.equal(calls.length, 2); assert.notEqual(calls[0], calls[1], 'у каждой попытки своя метка');
    assert.match(fs.readFileSync(path.join(dir, '_query_script1.txt'), 'utf8'), new RegExp(`\\[метка запуска, служебная: ${calls[0]}\\]`)); assert.ok(files.includes('_skills_script1.json'));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('runAgent: и после повтора не открыла: ровно один повтор, missing остаётся (карточка Нику покажет предупреждение)', { skip: !can }, async () => {
  const { r, dir, calls } = await runWith(() => got('humanizer'));
  try { assert.equal(calls.length, 2); assert.equal(r.skills.retried, true); assert.deepEqual(r.skills.missing, ['short-video-script-craft', 'storytelling', 'storytelling-hooks']); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('runAgent: открыла всё сразу — повтора нет; базу сессий прочитать не удалось или сессий нет — молчим и не повторяем; SKILL_GATE=off — не проверяем', { skip: !can }, async () => {
  for (const [name, checker, env, expectCalls] of [['всё открыто', () => got('short-video-script-craft', 'storytelling', 'storytelling-hooks', 'humanizer'), {}, 1], ['база недоступна', () => ({ checked: false, sessions: 0, used: new Set() }), {}, 1], ['сессий нет', () => ({ checked: true, sessions: 0, used: new Set() }), {}, 1], ['гейт выключен', () => got(), { SKILL_GATE: 'off' }, 0]]) {
    const { r, dir, files, calls } = await runWith(checker, { env });
    try { assert.equal(calls.length, expectCalls, name); assert.ok(!files.includes('_query_script1_retry2.txt'), name); assert.equal(r.skills.retried, false, name); if (name === 'всё открыто') assert.equal(r.skills.checked, true); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
});
test('runAgent: у сотрудников без обязательных скиллов (Лев, Виктор, Тимофей) база не читается и повтора нет, но подсказка про blocked-page-recovery в задании есть', { skip: !can }, async () => {
  const { r, dir, calls } = await runWith(() => got(), { label: 'virality1' });
  try { assert.equal(calls.length, 0); assert.equal(r.skills.retried, false); assert.match(fs.readFileSync(path.join(dir, '_query_virality1.txt'), 'utf8'), /blocked-page-recovery/); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

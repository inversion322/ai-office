import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { AGENT_SKILLS, requiredFor, skillsBlock, retryNote, ledgerQuotes, evidenceIssues, evidenceFeedback, SOURCES_PY } from '../scripts/agent_skills.mjs';
import { skillsOpenedByRun } from '../scripts/skill_usage.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FAKE = path.join(ROOT, 'test', 'fixtures', 'fake_agent.mjs');
const LOCAL = path.join(process.env.LOCALAPPDATA || '', 'hermes');

test('обязательные скиллы: Ксения (short-video-script-craft, humanizer), Вера (grounded-citations); остальным обязательных нет; youtube-content намеренно не подключён', () => {
  assert.deepEqual(requiredFor('scriptwriter'), ['short-video-script-craft', 'humanizer']); assert.deepEqual(requiredFor('factcheck'), ['grounded-citations']);
  for (const a of ['research', 'virality', 'packager', 'captain_smm', 'нет-такого']) assert.deepEqual(requiredFor(a), [], a);
  assert.ok(!JSON.stringify(AGENT_SKILLS).includes('youtube-content'), 'пакета youtube_transcript_api на ПК нет, ставить без согласия Ника нельзя');
});

test('скиллы лежат в профиле smm, из которого работают сотрудники (иначе skill_view упадёт), и ledger-скрипт на месте', { skip: !process.env.LOCALAPPDATA }, () => {
  for (const [rel, f] of [['creative/short-video-script-craft', 'SKILL.md'], ['creative/humanizer', 'SKILL.md'], ['research/grounded-citations', 'SKILL.md'], ['web/blocked-page-recovery', 'SKILL.md']]) assert.ok(fs.existsSync(path.join(LOCAL, 'profiles', 'smm', 'skills', rel, f)), 'нет в профиле smm: ' + rel);
  assert.ok(fs.existsSync(SOURCES_PY()), 'нет sources.py: ' + SOURCES_PY());
});

test('блок Ксении: оба скилла, ограничение пунктов humanizer (31 и 32 запрещены), нельзя трогать числа, связки и строки Ника', () => {
  const b = skillsBlock('scriptwriter', { dir: 'C:/x/video_9' });
  assert.match(b, /skill_view\('short-video-script-craft'\)/); assert.match(b, /skill_view\('humanizer'\)/); assert.match(b, /НЕ применяй 31 и 32/); assert.match(b, /Не трогай числа.*связки «но\/поэтому».*дословно/s); assert.match(b, /blocked-page-recovery/);
});

test('блок Веры: реестр лежит в папке сценария, команды с --ledger, PubMed через efetch в файл, цитату принимает только quote, в check.json поля source/ledger_id/quote_found', () => {
  const b = skillsBlock('factcheck', { dir: 'C:/x/video_9' });
  assert.match(b, /skill_view\('grounded-citations'\)/); assert.match(b, /--ledger "C:\/x\/video_9\/ledger\.json" reset/); assert.match(b, /efetch\.fcgi\?db=pubmed.*retmode=text/); assert.match(b, /quote <id> --text/); assert.match(b, /ОТКЛОНИТ пересказ/);
  assert.match(b, /"ledger_id"/); assert.match(b, /"quote_found"/); assert.match(b, /render --style evidence/);
  assert.ok(b.includes(SOURCES_PY()), 'путь к sources.py');
});

test('блоки Виктора и Льва: только запасной путь при закрытых страницах; Тимофей и Капитан без блока', () => {
  for (const a of ['research', 'virality']) { const b = skillsBlock(a); assert.match(b, /blocked-page-recovery/); assert.ok(!/humanizer|grounded-citations/.test(b)); }
  assert.equal(skillsBlock('packager'), ''); assert.equal(skillsBlock('captain_smm'), '');
});

test('повторный запуск называет пропущенные скиллы', () => { assert.match(retryNote(['humanizer', 'x']), /не открыл обязательные скиллы: humanizer, x/); });

const LEDGER = { version: 1, sources: [{ id: 1, url: 'https://pubmed.ncbi.nlm.nih.gov/35247352', quotes: [{ text: 'Taking 8000 steps per day was associated with a 51% lower risk' }] }, { id: 2, url: 'https://x', title: 't' }] };
const claim = (over = {}) => ({ text: 'Утверждение про шаги', source_checked: true, status: 'верно', quote_found: 'Taking 8000 steps per day was associated with a 51% lower risk', ...over });

test('доказательства: цитата из реестра принимается (регистр, пробелы и разметка не важны); пересказ и пустое поле нет', () => {
  assert.equal(ledgerQuotes(LEDGER).length, 1);
  assert.equal(evidenceIssues({ claims: [claim()] }, LEDGER).ok, true);
  assert.equal(evidenceIssues({ claims: [claim({ quote_found: '  taking 8000 STEPS per day was **associated** with a 51% lower risk ' })] }, LEDGER).ok, true);
  assert.equal(evidenceIssues({ claims: [claim({ quote_found: 'Taking 8000 steps per day' })] }, LEDGER).ok, true, 'часть цитаты реестра тоже цитата');
  const para = evidenceIssues({ claims: [claim({ quote_found: 'риск ниже почти вдвое' })] }, LEDGER); assert.equal(para.ok, false); assert.match(para.issues[0], /цитаты нет в реестре/);
  const none = evidenceIssues({ claims: [claim({ quote_found: '' })] }, LEDGER); assert.match(none.issues[0], /нет дословной цитаты/);
});

test('доказательства: «не подтверждено» и «отклонить» цитаты не требуют; пустой или отсутствующий реестр при наличии утверждений блокирует; без утверждений проверять нечего', () => {
  assert.equal(evidenceIssues({ claims: [claim({ status: 'не подтверждено', quote_found: '' }), claim({ status: 'отклонить', quote_found: '' })] }, LEDGER).ok, true);
  assert.match(evidenceIssues({ claims: [claim()] }, null).issues[0], /реестр источников пуст или не создан/); assert.equal(evidenceIssues({ claims: [claim()] }, { sources: [] }).ok, false);
  assert.equal(evidenceIssues({ claims: [] }, null).ok, true); assert.equal(evidenceIssues({}, null).ok, true);
  assert.match(evidenceFeedback(['«а»: нет цитаты']), /Реестр НЕ сбрасывай/);
});

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
  const { r, dir, files, calls } = await runWith((n) => (n === 1 ? got('humanizer') : got('short-video-script-craft', 'humanizer')));
  try {
    assert.ok(files.includes('_query_script1.txt') && files.includes('_query_script1_retry2.txt'), files.join(','));
    assert.match(fs.readFileSync(path.join(dir, '_query_script1_retry2.txt'), 'utf8'), /ПОВТОР: .*short-video-script-craft/); assert.ok(!/ПОВТОР:/.test(fs.readFileSync(path.join(dir, '_query_script1.txt'), 'utf8')));
    assert.equal(r.skills.retried, true); assert.deepEqual(r.skills.missing, []); assert.equal(calls.length, 2); assert.notEqual(calls[0], calls[1], 'у каждой попытки своя метка');
    assert.match(fs.readFileSync(path.join(dir, '_query_script1.txt'), 'utf8'), new RegExp(`\\[метка запуска, служебная: ${calls[0]}\\]`)); assert.ok(files.includes('_skills_script1.json'));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('runAgent: и после повтора не открыла: ровно один повтор, missing остаётся (карточка Нику покажет предупреждение)', { skip: !can }, async () => {
  const { r, dir, calls } = await runWith(() => got('humanizer'));
  try { assert.equal(calls.length, 2); assert.equal(r.skills.retried, true); assert.deepEqual(r.skills.missing, ['short-video-script-craft']); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('runAgent: открыла всё сразу — повтора нет; базу сессий прочитать не удалось или сессий нет — молчим и не повторяем; SKILL_GATE=off — не проверяем', { skip: !can }, async () => {
  for (const [name, checker, env, expectCalls] of [['всё открыто', () => got('short-video-script-craft', 'humanizer'), {}, 1], ['база недоступна', () => ({ checked: false, sessions: 0, used: new Set() }), {}, 1], ['сессий нет', () => ({ checked: true, sessions: 0, used: new Set() }), {}, 1], ['гейт выключен', () => got(), { SKILL_GATE: 'off' }, 0]]) {
    const { r, dir, files, calls } = await runWith(checker, { env });
    try { assert.equal(calls.length, expectCalls, name); assert.ok(!files.includes('_query_script1_retry2.txt'), name); assert.equal(r.skills.retried, false, name); if (name === 'всё открыто') assert.equal(r.skills.checked, true); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
});
test('runAgent: у сотрудников без обязательных скиллов (Лев, Виктор, Тимофей) база не читается и повтора нет, но подсказка про blocked-page-recovery в задании есть', { skip: !can }, async () => {
  const { r, dir, calls } = await runWith(() => got(), { label: 'virality1' });
  try { assert.equal(calls.length, 0); assert.equal(r.skills.retried, false); assert.match(fs.readFileSync(path.join(dir, '_query_virality1.txt'), 'utf8'), /blocked-page-recovery/); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

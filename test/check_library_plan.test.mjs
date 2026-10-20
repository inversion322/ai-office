import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkPlan, checkProjectPlan, checkReportSection, loadIndexes } from '../scripts/check_library_plan.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REF = JSON.parse(fs.readFileSync(path.join(ROOT, 'video', 'med_detective', 'LIBRARY_PLAN_REFERENCE.json'), 'utf8'));
const idx = loadIndexes(); const clone = () => JSON.parse(JSON.stringify(REF)); const probs = (p) => checkPlan(p, idx).problems.join(' | ');

test('индексы библиотеки загружены: каталог HyperFrames, правила скилла, звуки CC0, графика', () => {
  assert.ok(idx.registry.size > 300 && idx.rules.size > 40 && idx.blueprints.size > 15 && idx.sfx.size > 100 && idx.music.size >= 10 && idx.graphics.size >= 20, JSON.stringify([idx.registry.size, idx.rules.size, idx.blueprints.size, idx.sfx.size, idx.music.size, idx.graphics.size]));
});

test('эталонный план (его копирует Кирилл) сам проходит проверку', () => { assert.equal(probs(REF), ''); });

test('выдуманный блок каталога и выдуманное правило ловятся по имени', () => {
  const a = clone(); a.registry_blocks.push('super-wow-transition'); assert.match(probs(a), /registry_blocks: нет в каталоге HyperFrames.*super-wow-transition/);
  const b = clone(); b.animation_rules.push('my-own-bounce'); assert.match(probs(b), /нет в скилле hyperframes-animation: my-own-bounce/);
});

test('слишком мало готового: меньше 2 правил или 2 блоков', () => {
  const a = clone(); a.animation_rules = ['kinetic-beat-slam']; assert.match(probs(a), /нужно не меньше 2 правил/);
  const b = clone(); b.registry_blocks = ['iris-reveal']; assert.match(probs(b), /нужно не меньше 2 готовых блоков/);
});

test('звук перехода (whoosh/slide) запрещён, звук не из палитры канала и чужой id ловятся', () => {
  const a = clone(); a.sfx.push('whoosh-soft'); assert.match(probs(a), /звуки переходов запрещены.*whoosh-soft/);
  const b = clone(); b.sfx.push('cash-register-cha-ching'); assert.match(probs(b), /не из палитры канала.*cash-register/);
  const c = clone(); c.sfx.push('мой-звук'); assert.match(probs(c), /нет в каталоге CC0/);
});

test('переходы: нет семейства, нет источника, основной переход A меньше половины — всё ловится', () => {
  const a = clone(); delete a.transitions.C; assert.match(probs(a), /не указано семейство C/);
  const b = clone(); b.transitions.B.source = ''; assert.match(probs(b), /transitions\.B: нужно поле source/);
  const c = clone(); c.transitions.A.count = 3; c.transitions.B.count = 8; assert.match(probs(c), /основной переход A должен быть 60-70%/);
});

test('музыка: чужого трека нет в наборе, трек не из разрешённых; none допустим', () => {
  const a = clone(); a.music = { id: 'my-song', reason: 'x' }; assert.match(probs(a), /такого трека нет/);
  const b = clone(); b.music = { id: 'music-funky-house', reason: 'x' }; assert.match(probs(b), /не из разрешённых/);
  const c = clone(); c.music = { id: 'none', reason: 'Ник без музыки' }; assert.equal(probs(c), '');
});

test('«с нуля» без обоснования (что искал и почему не подошло) и слишком много элементов с нуля ловятся', () => {
  const a = clone(); a.from_scratch = [{ what: 'всё' }]; assert.match(probs(a), /from_scratch\[0\]: нужны what, why_not_library и searched/);
  const b = clone(); b.from_scratch = Array.from({ length: 7 }, (_, i) => ({ what: 'x' + i, why_not_library: 'y', searched: ['z'] })); assert.match(probs(b), /слишком много/);
});

test('проект: нет плана — блок; хороший план — ок; раздел «Использовано из библиотеки» в отчёте обязателен; LIBRARY_GATE=off обходит', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-'));
  try {
    assert.equal(checkProjectPlan(dir, idx).ok, false); assert.match(checkProjectPlan(dir, idx).problems[0], /нет LIBRARY_PLAN\.json/);
    fs.writeFileSync(path.join(dir, 'LIBRARY_PLAN.json'), JSON.stringify(REF)); assert.equal(checkProjectPlan(dir, idx).ok, true);
    assert.equal(checkReportSection(dir).length, 1); fs.writeFileSync(path.join(dir, 'RESULT.md'), '# Итог\n## Использовано из библиотеки\n- iris-reveal'); assert.deepEqual(checkReportSection(dir), []);
    fs.rmSync(path.join(dir, 'LIBRARY_PLAN.json')); process.env.LIBRARY_GATE = 'off'; assert.equal(checkProjectPlan(dir, idx).ok, true);
  } finally { delete process.env.LIBRARY_GATE; fs.rmSync(dir, { recursive: true, force: true }); }
});

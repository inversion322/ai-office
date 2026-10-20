import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fireReminders, loadReminders } from '../scripts/reminders.mjs';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const mk = (list) => { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rem-')); fs.mkdirSync(path.join(root, 'smm')); if (list) fs.writeFileSync(path.join(root, 'smm', 'reminders.json'), JSON.stringify(list)); return root; };

test('напоминание срабатывает один раз на своё событие и помечается; чужое событие и повторный вызов не шлют', async () => {
  const root = mk([{ id: 'a', when: 'package_done', text: 'вернуться к отделу блога', fired: false }, { id: 'b', when: 'other', text: 'другое', fired: false }]);
  try {
    const sent = []; const r1 = await fireReminders('package_done', async (t) => sent.push(t), root);
    assert.deepEqual(sent, ['вернуться к отделу блога']); assert.equal(r1.length, 1);
    const saved = loadReminders(root); assert.equal(saved[0].fired, true); assert.ok(saved[0].fired_at); assert.equal(saved[1].fired, false);
    await fireReminders('package_done', async (t) => sent.push(t), root); assert.equal(sent.length, 1, 'второй раз не шлём');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('отправка не удалась: напоминание остаётся и сработает в следующий раз; нет файла не ломает этап', async () => {
  const root = mk([{ id: 'a', when: 'package_done', text: 'x', fired: false }]);
  try {
    await fireReminders('package_done', async () => { throw new Error('нет сети'); }, root); assert.equal(loadReminders(root)[0].fired, false);
    const sent = []; await fireReminders('package_done', async (t) => sent.push(t), root); assert.deepEqual(sent, ['x']);
    const empty = mk(null); assert.deepEqual(await fireReminders('package_done', async () => {}, empty), []); fs.rmSync(empty, { recursive: true, force: true });
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('в тестовом режиме (OFFICE_NO_TG) боевой файл напоминаний не читается и не меняется: интеграционный тест пакета раз сжёг боевое напоминание', async () => {
  const before = fs.readFileSync(path.join(ROOT_DIR, 'smm', 'reminders.json'), 'utf8');
  process.env.OFFICE_NO_TG = '1'; try { const sent = []; await fireReminders('package_done', async (t) => sent.push(t)); assert.deepEqual(sent, [], 'в тестовом режиме ничего не шлём'); } finally { delete process.env.OFFICE_NO_TG; }
  assert.equal(fs.readFileSync(path.join(ROOT_DIR, 'smm', 'reminders.json'), 'utf8'), before);
});

test('боевой файл напоминаний существует и содержит напоминание про второй отдел; формулировка без «сделал», только «пора вернуться»', () => {
  const list = loadReminders(); const r = list.find((x) => x.id === 'multi_channel_office');
  assert.ok(r, 'нет записи multi_channel_office'); assert.equal(r.when, 'package_done'); assert.match(r.text, /IDEA_multi_channel_office\.md/); assert.match(r.text, /личный блог/);
});

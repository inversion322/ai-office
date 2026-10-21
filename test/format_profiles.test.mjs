// Ворота динамики по форматам: A «Лента» (быстрые цветные поля), B «Один объект» (светлый, без склеек), C «Диалог» (смена полей на реплику).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { judge, FORMAT_PROFILES, THRESHOLDS } from '../scripts/video_dynamics.mjs';
import { projectFormat, hasFormat, isFormatA, markFormat, markFormatA } from '../scripts/video_gate.mjs';
import { formatSection } from '../scripts/format_spec.mjs';

const m = (o) => ({ seconds: 52, nonBaseBg: 0.6, hues: 4, beats: 30, beatsPer10s: 5.8, maxBeatGap: 3, sameShare: 0.1, brightRange: 30, ...o });
const calm = m({ nonBaseBg: 0.15, hues: 2, beats: 3, beatsPer10s: 0.6, maxBeatGap: 20, sameShare: 0.2, brightRange: 8 });      // светлый спокойный ролик с акцентами в финале
const comic = m({ nonBaseBg: 0.30, hues: 2, beats: 16, beatsPer10s: 3.1, maxBeatGap: 3.0, sameShare: 0.2, brightRange: 9 });      // страница комикса: бумага, панели вылетают каждые 1,5-2,5 с

test('профили есть у всех трёх форматов; A это прежние пороги', () => {
  assert.deepEqual(Object.keys(FORMAT_PROFILES), ['A', 'B', 'C']); assert.equal(FORMAT_PROFILES.A, THRESHOLDS);
});

test('быстрый ролик A проходит профиль A и НЕ проходит профиль B (слишком много цвета и смен для спокойного формата)', () => {
  assert.equal(judge(m(), FORMAT_PROFILES.A).ok, true);
  const b = judge(m(), FORMAT_PROFILES.B); assert.equal(b.ok, false); assert.match(b.problems.join(' '), /для этого формата не больше 35 %/); assert.match(b.problems.join(' '), /не больше 0\.8 на 10 с/);
});

test('спокойный светлый ролик B проходит профиль B и НЕ проходит профиль A (там нужны цветные поля и частые смены)', () => {
  assert.equal(judge(calm, FORMAT_PROFILES.B).ok, true, judge(calm, FORMAT_PROFILES.B).problems.join('; '));
  const a = judge(calm, FORMAT_PROFILES.A); assert.equal(a.ok, false); assert.ok(a.problems.length >= 3);
});

test('статичный ролик не проходит и B: движение камеры обязательно (не больше 40 % «той же картинки»)', () => {
  const r = judge(m({ ...calm, sameShare: 0.7 }), FORMAT_PROFILES.B); assert.equal(r.ok, false); assert.match(r.problems.join(' '), /70 % времени картинка почти та же/);
});

test('комикс C: светлая страница с частой сменой панелей проходит; медленный ролик, длинная пауза и сплошные цветные поля нет; яркость не проверяется', () => {
  assert.equal(judge(comic, FORMAT_PROFILES.C).ok, true, judge(comic, FORMAT_PROFILES.C).problems.join('; '));
  assert.equal(judge(m({ ...comic, brightRange: 0 }), FORMAT_PROFILES.C).ok, true, 'размах яркости у комикса не проверяется: страница светлая');
  assert.equal(judge(m({ ...comic, nonBaseBg: 0.0, hues: 1 }), FORMAT_PROFILES.C).ok, true, 'чисто бумажные края допустимы');
  const slow = judge(m({ ...comic, beatsPer10s: 1.0, beats: 5 }), FORMAT_PROFILES.C); assert.equal(slow.ok, false); assert.match(slow.problems.join(' '), /нужно не меньше 2\.5 на 10 с/);
  const gap = judge(m({ ...comic, maxBeatGap: 5 }), FORMAT_PROFILES.C); assert.equal(gap.ok, false); assert.match(gap.problems.join(' '), /пауза без резкой смены 5\.0 с, не больше 3\.5/);
  const fields = judge(m({ ...comic, nonBaseBg: 0.7 }), FORMAT_PROFILES.C); assert.equal(fields.ok, false); assert.match(fields.problems.join(' '), /70 % времени, для этого формата не больше 50 %/);
  assert.equal(judge(calm, FORMAT_PROFILES.C).ok, false, 'спокойный ролик формата B комиксом не считается');
});

test('формат проекта: format.json с A/B/C; мусор и отсутствие это «старый формат»', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'fmt-'));
  try {
    assert.equal(projectFormat(d), null); assert.equal(hasFormat(d), false); assert.equal(isFormatA(d), false);
    markFormat(d, 'B'); assert.equal(projectFormat(d), 'B'); assert.equal(hasFormat(d), true); assert.equal(isFormatA(d), false);
    markFormat(d, 'C'); assert.equal(projectFormat(d), 'C');
    markFormat(d, 'Z'); assert.equal(projectFormat(d), 'A', 'неизвестный формат записывается как A');
    markFormatA(d); assert.equal(isFormatA(d), true);
    fs.writeFileSync(path.join(d, 'format.json'), '{"format":"Q"}'); assert.equal(projectFormat(d), null);
    fs.writeFileSync(path.join(d, 'format.json'), 'не json'); assert.equal(projectFormat(d), null);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test('формат C «Комикс»: раздел задания монтажёру содержит спецификацию и ПАНЕЛИ этого ролика настоящими переносами строк; у A раздела нет, у B панелей нет', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const c = formatSection('C', root, { panels: 'Панель 1: Мужчина в белом халате ставит на весы чашку кофе\nПоследняя панель (пустая с «?»): ответ' });
  assert.doesNotMatch(c, /нет файла/, 'спецификация FORMAT_C.md должна находиться'); assert.match(c, /^## ФОРМАТ ЭТОГО РОЛИКА: C «Комикс»/); assert.match(c, /## ПАНЕЛИ ЭТОГО РОЛИКА/); assert.match(c, /Панель 1: Мужчина в белом халате/);
  assert.doesNotMatch(c, /\\n/, 'буквальных «\\n» в тексте задания быть не должно'); assert.doesNotMatch(c, /скептик|skeptic/i, 'реплик скептика у «Комикса» нет'); assert.match(c, /диалог и реплики второго персонажа[^.]*\(формат «Диалог» отменён/i, 'диалог в спецификации только как запрет');
  assert.match(c, /первые 3 секунды|Первые 3 секунды/i, 'правило «вау за 3 секунды» в спецификации');
  assert.equal(formatSection('A', root, {}), ''); assert.doesNotMatch(formatSection('B', root, {}), /ПАНЕЛИ ЭТОГО РОЛИКА/);
});

// Ворота динамики по форматам: A «Лента» (быстрые цветные поля), B «Один объект» (светлый, без склеек), C «Диалог» (смена полей на реплику).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { judge, FORMAT_PROFILES, THRESHOLDS } from '../scripts/video_dynamics.mjs';
import { projectFormat, hasFormat, isFormatA, markFormat, markFormatA } from '../scripts/video_gate.mjs';

const m = (o) => ({ seconds: 52, nonBaseBg: 0.6, hues: 4, beats: 30, beatsPer10s: 5.8, maxBeatGap: 3, sameShare: 0.1, brightRange: 30, ...o });
const calm = m({ nonBaseBg: 0.15, hues: 2, beats: 3, beatsPer10s: 0.6, maxBeatGap: 20, sameShare: 0.2, brightRange: 8 });      // светлый спокойный ролик с акцентами в финале
const dialog = m({ nonBaseBg: 0.55, hues: 3, beats: 12, beatsPer10s: 2.3, maxBeatGap: 5, sameShare: 0.2, brightRange: 20 });

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

test('диалог C: смена полей на реплику проходит; без цветных полей или с паузой дольше 6,5 с нет', () => {
  assert.equal(judge(dialog, FORMAT_PROFILES.C).ok, true, judge(dialog, FORMAT_PROFILES.C).problems.join('; '));
  assert.equal(judge(m({ ...dialog, nonBaseBg: 0.1 }), FORMAT_PROFILES.C).ok, false);
  const gap = judge(m({ ...dialog, maxBeatGap: 9 }), FORMAT_PROFILES.C); assert.equal(gap.ok, false); assert.match(gap.problems.join(' '), /пауза без резкой смены 9\.0 с, не больше 6\.5/);
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

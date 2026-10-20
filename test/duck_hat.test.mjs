import { test } from 'node:test';
import assert from 'node:assert/strict';
import { badHatLines } from '../scripts/check_duck_hat.mjs';

test('наклон и сдвиг вбок шляпы находятся (как в ролике №2)', () => {
  assert.equal(badHatLines('hold("#dk-hatwrap", {"x": 0, "y": 0, "rotation": 0}, {"x": 3, "y": -9, "rotation": 16}, t1, t2)').length, 1);
  assert.equal(badHatLines('dj(f\'tl.fromTo("#dk-hatwrap", {{ y: 0, rotation: 0 }}, {{ y: -3, rotation: -8, svgOrigin: "32 12" }}, 1)\')').length, 1);
  assert.match(badHatLines('hold("#dk-hatwrap", {}, {"x": 8, "y": -8}, 1, 2)')[0].found, /x: 8/);
});
test('чистый вертикальный подскок и нулевые значения проходят', () => {
  assert.equal(badHatLines('hold("#dk-hatwrap", {"y": 0}, {"y": -9}, t1, t2, origin="32 12")').length, 0);
  assert.equal(badHatLines('tl.set("#dk-hatwrap", { x: 0, rotation: 0 }, 0);').length, 0);
  assert.equal(badHatLines('HAT_LOCK = \'tl.set("#dk-hatwrap", { x: 0, rotation: 0 }, 0);\'').length, 0);
});
test('другие части утки (крыло, брови) могут вращаться', () => {
  assert.equal(badHatLines('hold("#dk-armR", {"rotation": 0}, {"rotation": -32}, 1, 2)').length, 0);
  assert.equal(badHatLines('hold("#dk-browL", {"y": 0, "rotation": 0}, {"y": 0.9, "rotation": 14}, 1, 2)').length, 0);
});

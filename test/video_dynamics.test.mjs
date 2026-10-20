// Измеритель динамики: различает статичный и динамичный ролик, пороги вынесены в THRESHOLDS. Клипы синтезируются ffmpeg, в сеть ничего не уходит.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { measure, decodeFrames, judge, THRESHOLDS, hueBucket, summaryLine } from '../scripts/video_dynamics.mjs';
import { ffprobePath } from '../scripts/video_format.mjs';

const FF = path.join(path.dirname(ffprobePath()), 'ffmpeg.exe'); const have = fs.existsSync(FF);
let tmp;
before(() => { if (have) tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dyn-')); });
after(() => { try { tmp && fs.rmSync(tmp, { recursive: true, force: true }); } catch {} });
const run = (args, out) => { const r = spawnSync(FF, ['-v', 'error', '-y', ...args, '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', out]); assert.equal(r.status, 0, String(r.stderr)); return out; };

function staticClip() { return run(['-f', 'lavfi', '-i', 'color=c=0xF5F3EE:s=1080x1920:r=30:d=30', '-vf', "drawbox=x='100+t*5':y=800:w=300:h=200:color=white@1:t=fill"], path.join(tmp, 'static.mp4')); }
function dynamicClip() {      // цветные поля по 1 с, по ним движутся крупные блоки: то, как должен выглядеть динамичный ролик
  const cols = ['0xE8A317', '0x364FC7', '0xF5F3EE', '0xD64545', '0x1F9D63', '0xF5F3EE']; const inputs = []; let fc = ''; let n = 0;
  for (let rep = 0; rep < 6; rep++) for (const c of cols) { inputs.push('-f', 'lavfi', '-i', `color=c=${c}:s=1080x1920:r=30:d=1,drawbox=x='mod(t*1500,700)':y=500:w=380:h=300:color=black@0.35:t=fill`); fc += `[${n++}]`; }
  return run([...inputs, '-filter_complex', `${fc}concat=n=${n}:v=1:a=0[v]`, '-map', '[v]'], path.join(tmp, 'dynamic.mp4'));
}

test('оттенки фона определяются разумно', () => { assert.equal(hueBucket([245, 243, 238]), 'neutral'); assert.equal(hueBucket([30, 30, 30]), 'dark'); assert.notEqual(hueBucket([232, 163, 23]), hueBucket([54, 79, 199])); });
test('judge: пороги работают по отдельности', () => {
  const ok = { nonBaseBg: 0.5, hues: 4, beatsPer10s: 2, maxBeatGap: 3, sameShare: 0.1, brightRange: 40 };
  assert.equal(judge(ok).ok, true);
  for (const [k, v, re] of [['nonBaseBg', 0.1, /цветной фон/], ['hues', 1, /оттенков/], ['beatsPer10s', 0.2, /резких смен/], ['maxBeatGap', 9, /пауза/], ['sameShare', 0.6, /та же/], ['brightRange', 5, /яркости/]]) { const j = judge({ ...ok, [k]: v }); assert.equal(j.ok, false, k); assert.match(j.problems.join(), re); }
});
test('статичный ролик (как №1 и №2) проваливает проверку по большинству порогов', { skip: !have }, () => {
  const m = measure(decodeFrames(staticClip())); const j = judge(m);
  assert.equal(j.ok, false); assert.ok(j.problems.length >= 5, j.problems.join('; ')); assert.equal(m.beats, 0); assert.equal(m.nonBaseBg, 0);
});
test('динамичный ролик с цветными полями и движением проходит все пороги', { skip: !have }, () => {
  const m = measure(decodeFrames(dynamicClip())); const j = judge(m);
  assert.equal(j.ok, true, j.problems.join('; ') + ' | ' + summaryLine(m)); assert.ok(m.hues >= 3); assert.ok(m.beats >= 20);
});
test('порог можно ужесточить: тот же динамичный клип не проходит строгий порог', { skip: !have }, () => {
  const m = measure(decodeFrames(dynamicClip())); assert.equal(judge(m, { ...THRESHOLDS, beatsPer10s: 50 }).ok, false);
});

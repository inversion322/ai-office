import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gate, isFormatA, markFormatA } from '../scripts/video_gate.mjs';
import { makeClip } from './fixtures/make_clip.mjs';
import { ffprobePath } from '../scripts/video_format.mjs';

const FF = path.join(path.dirname(ffprobePath()), 'ffmpeg.exe'); const have = fs.existsSync(FF);
let tmp, proj, good, stat;
before(() => { if (!have) return; tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-')); proj = path.join(tmp, 'dosie09'); fs.mkdirSync(path.join(proj, 'compositions'), { recursive: true }); good = makeClip(FF, path.join(tmp, 'good.mp4'), 'dynamic'); stat = makeClip(FF, path.join(tmp, 'stat.mp4'), 'static'); });
after(() => { try { tmp && fs.rmSync(tmp, { recursive: true, force: true }); } catch {} });

test('динамичный ролик проходит все три проверки; метрики попадают в сводку', { skip: !have }, () => {
  const g = gate(good, proj, { dynamics: true }); assert.equal(g.ok, true, g.problems.join('; ')); assert.match(g.summary, /^Динамика: резких смен \d+/); assert.equal(g.dynamicsChecked, true);
});
test('статичный ролик без запроса динамики проходит (старый формат, мелкие правки не блокируются)', { skip: !have }, () => {
  const g = gate(stat, proj, { dynamics: false }); assert.equal(g.ok, true); assert.equal(g.dynamicsChecked, false); assert.equal(g.summary, '');
});
test('статичный ролик при динамической проверке блокируется с цифрами', { skip: !have }, () => {
  const g = gate(stat, proj, { dynamics: true }); assert.equal(g.ok, false); assert.ok(g.problems.every((p) => /^динамика:/.test(p)) && g.problems.length >= 5);
});
test('после пометки format.json = A динамика проверяется сама, даже без запроса', { skip: !have }, () => {
  assert.equal(isFormatA(proj), false); markFormatA(proj); assert.equal(isFormatA(proj), true);
  assert.equal(gate(stat, proj, { dynamics: false }).ok, false);
  fs.rmSync(path.join(proj, 'format.json'));
});
test('ручной обход DYNAMICS_GATE=off работает и больше ничего не отключает', { skip: !have }, () => {
  process.env.DYNAMICS_GATE = 'off';
  try { assert.equal(gate(stat, proj, { dynamics: true }).ok, true);
    fs.writeFileSync(path.join(proj, 'compositions', 'x.html'), 'tl.fromTo("#dk-hatwrap", { x: 0 }, { x: 5, rotation: 9 }, 1);');
    const g = gate(stat, proj, { dynamics: true }); assert.equal(g.ok, false); assert.match(g.problems.join(), /шляпа не по центру/);
  } finally { delete process.env.DYNAMICS_GATE; fs.rmSync(path.join(proj, 'compositions', 'x.html'), { force: true }); }
});
test('шляпа и формат проверяются всегда', { skip: !have }, () => {
  const hor = makeClip(FF, path.join(tmp, 'hor.mp4'), 'horizontal'); const g = gate(hor, proj, { dynamics: false });
  assert.equal(g.ok, false); assert.match(g.problems.join(), /нужен 1080x1920/);
});

test('ворота: призыв не тем шрифтом и не по буквам блокирует отправку Нику; эталонная сцена пропускает; CTA_GATE=off обходит только эту проверку', { skip: !have }, () => {
  const REF = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'video', 'med_detective', 'CTA_REFERENCE.html'), 'utf8');
  const file = path.join(proj, 'compositions', 's18.html');
  try {
    fs.writeFileSync(file, '<div class="v18-mono" style="font-family:\'JetBrains Mono\'">Подписывайтесь</div>');
    const bad = gate(good, proj, { dynamics: true }); assert.equal(bad.ok, false); assert.ok(bad.problems.some((x) => /^призыв: .*моноширинный/.test(x)), bad.problems.join('; ')); assert.ok(bad.problems.some((x) => /^призыв: .*по буквам/.test(x)));
    fs.writeFileSync(file, REF);
    const ok = gate(good, proj, { dynamics: true }); assert.equal(ok.ok, true, ok.problems.join('; '));
    fs.writeFileSync(file, '<div>Подписывайтесь</div>'); process.env.CTA_GATE = 'off';
    assert.equal(gate(good, proj, { dynamics: true }).ok, true, 'обход CTA_GATE=off');
    delete process.env.CTA_GATE; assert.equal(gate(good, proj, { dynamics: false }).ok, true, 'без динамики и без формата A призыв старых роликов не проверяется');
  } finally { delete process.env.CTA_GATE; fs.rmSync(file, { force: true }); }
});

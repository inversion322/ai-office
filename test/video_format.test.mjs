// Стандарт формата ролика (Shorts/Reels) и отправка в Telegram с реальными размерами. Telegram подменён локальным приёмником, в сеть ничего не уходит.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, spawn } from 'node:child_process';
import { probeVideo, checkFormat, sendFields, STANDARD, ffprobePath } from '../scripts/video_format.mjs';

import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FF = path.join(path.dirname(ffprobePath()), 'ffmpeg.exe');
const have = fs.existsSync(FF);
let tmp, srv, port; const got = [];
const mk = (name, vf, extra = []) => { const f = path.join(tmp, name + '.mp4'); const r = spawnSync(FF, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=1080x1920:r=30:d=2', '-f', 'lavfi', '-i', 'sine=d=2', ...(vf ? ['-vf', vf] : []), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-ar', '48000', '-ac', '2', ...extra, f]); assert.equal(r.status, 0, String(r.stderr)); return f; };

before(async () => {
  if (!have) return; tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vfmt-'));
  srv = http.createServer((req, res) => { const chunks = []; req.on('data', (c) => chunks.push(c)); req.on('end', () => { const body = Buffer.concat(chunks).toString('latin1'); const fields = {}; for (const m of body.matchAll(/name="([a-z_]+)"\r\n\r\n([^\r\n]*)\r\n/g)) fields[m[1]] = m[2]; got.push({ url: req.url, fields }); res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ ok: true, result: { message_id: 1 } })); }); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r)); port = srv.address().port;
});
after(() => { try { srv && srv.close(); } catch {} try { tmp && fs.rmSync(tmp, { recursive: true, force: true }); } catch {} });

test('стандарт: нужные значения зафиксированы', () => { assert.deepEqual([STANDARD.width, STANDARD.height, STANDARD.fps, STANDARD.maxSeconds], [1080, 1920, 30, 59]); });

test('хороший файл проходит, плохие находятся с понятной причиной', { skip: !have }, () => {
  assert.equal(checkFormat(probeVideo(mk('good'))).ok, true);
  assert.match(checkFormat(probeVideo(mk('sar', 'setsar=4/3'))).problems.join(), /пиксели не квадратные/);
  assert.match(checkFormat(probeVideo(mk('fps', 'fps=25'))).problems.join(), /нужна постоянная 30/);
  const hor = path.join(tmp, 'hor.mp4'); spawnSync(FF, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=1920x1080:r=30:d=2', '-f', 'lavfi', '-i', 'sine=d=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-ar', '48000', '-ac', '2', hor]);
  assert.match(checkFormat(probeVideo(hor)).problems.join(), /нужен 1080x1920/);
});

test('поля отправки берутся из самого файла', { skip: !have }, () => { assert.deepEqual(sendFields(probeVideo(mk('f2'))), { width: '1080', height: '1920', duration: '2', supports_streaming: 'true' }); });

// Асинхронно: приёмник «Telegram» живёт в этом же процессе, синхронный spawnSync заблокировал бы его и дочерний процесс ждал бы ответа вечно.
function send(file) {
  const code = `import { sendVideoFile } from './scripts/smm_lib.mjs'; try { await sendVideoFile(${JSON.stringify(file)}, 'тест', [[['Принять', 'accept:1']]]); console.log('SENT'); } catch (e) { console.log('FAIL ' + e.message); }`;
  return new Promise((resolve) => {
    const p = spawn(process.execPath, ['--input-type=module', '-e', code], { cwd: ROOT, env: { ...process.env, OFFICE_NO_TG: '1', OFFICE_NO_TG_BASE_OK: '1', TELEGRAM_API_BASE: `http://127.0.0.1:${port}`, OFFICE_API: 'http://127.0.0.1:9' } });
    let out = ''; p.stdout.on('data', (d) => (out += d)); p.stderr.on('data', (d) => (out += d)); p.on('exit', () => resolve({ stdout: out }));
    setTimeout(() => { p.kill(); resolve({ stdout: out + ' [таймаут]' }); }, 30000);
  });
}

test('отправка из конвейера: Telegram получает width=1080, height=1920 и длительность (раньше полей не было)', { skip: !have }, async () => {
  got.length = 0; const r = await send(mk('send_ok'));
  const v = got.find((g) => /sendVideo/.test(g.url)); assert.ok(v, r.stdout + r.stderr);
  assert.equal(v.fields.width, '1080'); assert.equal(v.fields.height, '1920'); assert.equal(v.fields.duration, '2'); assert.equal(v.fields.supports_streaming, 'true');
});

test('файл не по стандарту в Telegram не отправляется вообще', { skip: !have }, async () => {
  got.length = 0; const r = await send(mk('send_bad', 'setsar=4/3'));
  assert.match(r.stdout, /FAIL формат ролика не по стандарту/); assert.equal(got.filter((g) => /sendVideo/.test(g.url)).length, 0);
});

test('подмена адреса Telegram без явного разрешения теста игнорируется (боевой офис не может быть перенаправлен)', { skip: !have }, () => {
  const code = `import { tgBase } from './scripts/smm_lib.mjs'; console.log(tgBase());`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, TELEGRAM_API_BASE: 'http://evil.example', OFFICE_NO_TG_BASE_OK: '' } });
  assert.match(r.stdout, /^https:\/\/api\.telegram\.org/);
});

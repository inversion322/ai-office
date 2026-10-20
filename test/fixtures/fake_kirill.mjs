// Имитация Кирилла для интеграционного теста правок: читает бриф REWORK_vN.md, «работает» несколько секунд, пишет итоговые файлы (или падает).
// Запуск через HERMES_BIN=<этот файл> (smm_lib запускает .mjs как скрипт Node). Настоящая модель не вызывается.
import fs from 'node:fs';
import path from 'node:path';
const i = process.argv.indexOf('--query-file');
const brief = fs.readFileSync(process.argv[i + 1], 'utf8');
const all = [...brief.matchAll(/final\/dosie(\d+)_(v\d+)\.mp4/g)];
const m = all[all.length - 1] || [];      // последнее упоминание: раздел «Результат» идёт после «Базы» (текущая версия)
const proj = path.dirname(process.argv[i + 1]);
const secs = Number(process.env.FAKE_KIRILL_SECONDS || 3);
fs.appendFileSync(path.join(proj, 'PROGRESS.md'), `\n- 12:00: [fake] начал ${m[2]}`);
await new Promise((r) => setTimeout(r, secs * 1000));
if (process.env.FAKE_KIRILL_MODE === 'fail') { console.error('fake: падаю без результата'); process.exit(1); }
fs.mkdirSync(path.join(proj, 'final'), { recursive: true });
// Настоящий минимальный ролик в стандарте Shorts/Reels (1080x1920, 30 к/с, AAC 48 кГц стерео): конвейер теперь проверяет формат до отправки, мусорный файл отвергается.
{ const { spawnSync } = await import('node:child_process'); const ff = process.env.TEST_FFMPEG;
  const r = ff ? spawnSync(ff, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=1080x1920:r=30:d=2', '-f', 'lavfi', '-i', 'sine=d=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-ar', '48000', '-ac', '2', path.join(proj, 'final', `dosie${m[1]}_${m[2]}.mp4`)]) : null;
  if (!r || r.status !== 0) fs.writeFileSync(path.join(proj, 'final', `dosie${m[1]}_${m[2]}.mp4`), Buffer.alloc(4096, 1)); }
fs.writeFileSync(path.join(proj, `RESULT_${m[2]}.md`), `# Отчёт ${m[2]}\n\nПравка внесена: заголовок крупнее, проверено на кадрах. Длительность 52,1 с.\n\n## Файлы\n- final/dosie${m[1]}_${m[2]}.mp4\n`);
fs.appendFileSync(path.join(proj, 'PROGRESS.md'), `\n- 12:01: [fake] готово ${m[2]}`);

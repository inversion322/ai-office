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
// Настоящий ролик в стандарте Shorts/Reels (конвейер проверяет формат до отправки). FAKE_KIRILL_CLIP: dynamic (по умолчанию) | static
{ const ff = process.env.TEST_FFMPEG; const out = path.join(proj, 'final', `dosie${m[1]}_${m[2]}.mp4`);
  try { const { makeClip } = await import('./make_clip.mjs'); if (!ff) throw new Error('нет ffmpeg'); makeClip(ff, out, process.env.FAKE_KIRILL_CLIP || 'dynamic'); } catch { fs.writeFileSync(out, Buffer.alloc(4096, 1)); } }
fs.writeFileSync(path.join(proj, `RESULT_${m[2]}.md`), `# Отчёт ${m[2]}\n\nПравка внесена: заголовок крупнее, проверено на кадрах. Длительность 52,1 с.\n\n## Файлы\n- final/dosie${m[1]}_${m[2]}.mp4\n\n\n## Использовано из библиотеки\n- iris-reveal (имитация)\n\n## Использовано из vizavi-motion\n- раскадровка с вариантами (имитация)`);
  try { const { fileURLToPath } = await import('node:url'); if (!fs.existsSync(path.join(proj, 'LIBRARY_PLAN.json'))) fs.copyFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'video', 'med_detective', 'LIBRARY_PLAN_REFERENCE.json'), path.join(proj, 'LIBRARY_PLAN.json')); } catch {}
  try { const { fileURLToPath } = await import('node:url'); const md = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'video', 'med_detective'); for (const [ref, to] of [['STORYBOARD_REFERENCE.json', 'STORYBOARD.json'], ['REVIEW_LOG_REFERENCE.json', 'REVIEW_LOG.json']]) if (!fs.existsSync(path.join(proj, to))) fs.copyFileSync(path.join(md, ref), path.join(proj, to)); } catch {}
fs.appendFileSync(path.join(proj, 'PROGRESS.md'), `\n- 12:01: [fake] готово ${m[2]}`);

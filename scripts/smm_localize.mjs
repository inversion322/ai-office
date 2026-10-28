// Английская версия принятого русского ролика (решение Ника 2026-10-28: английский канал «Medical Detective»; сначала всё делается на русском,
// после утверждения сотрудники переводят и меняют монтаж). Это ЛОКАЛИЗАЦИЯ готового ролика, а не новая режиссура:
//   prepare <id>   рабочая копия проекта dosieNN_en (без итоговых файлов и кадров), lang.json, script_en.txt из smm/runs/video_<id>/script_en.txt
//   narrate <id>   английская озвучка (narrate.py --lang en: голос из voice_settings.json, раздел en), narration.mp3, words.json, captions.srt
//   brief <id>     задание монтажёру (BRIEF_en.md в smm/runs/video_<id>)
//   produce <id>   монтажёр Hermes (профиль video, Opus 5.5 high) по заданию -> ворота -> проверка озвучки в готовом файле -> отправка Нику
//   all <id>       prepare + narrate + produce
// Публикации здесь нет: файл уходит только Нику на приёмку.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ROOT, hermesSpawn, sendVideoFile, notify, readJson } from './smm_lib.mjs';
import { gate } from './video_gate.mjs';
import { renderRules } from './render_rules.mjs';

const PY = 'C:/hf_tts/venv/Scripts/python.exe';
const VIDEO = path.join(ROOT, 'video');
const norm = (id) => String(id).padStart(2, '0');
export const srcDir = (id) => path.join(VIDEO, `dosie${norm(id)}`);
export const enDir = (id) => path.join(VIDEO, `dosie${norm(id)}_en`);
export const runDir = (id) => path.join(ROOT, 'smm', 'runs', `video_${id}`);

/** Что не копируется в рабочую копию: итоги, кадры, журналы прошлых сборок, русская озвучка и субтитры (их заменяет английская). */
export function skipInCopy(name) {
  return /^(final|renders|node_modules|\.git|_frames.*|_snap.*|_motion|_frames_log.*|_render_log.*|_build_log.*|_build_run.*|_check.*|_cta_log.*|_dynamics.*|_finalize.*|_format_log.*|_hat.*|_libplan.*|_narrate.*|_run_b.*|_run_v.*|_sfx_log.*|_verdict_log.*|_words_truncated.*|_zone_pixel.*|_render_rounds\.json|narration\.mp3|words\.json|captions.*\.srt|PROGRESS\.md|RESULT.*\.md|poster.*|contact_sheet.*|.*_archive)$/i.test(name);
}

/** Самая свежая принятая версия русского ролика: dosieNN_vK.mp4 с наибольшим K (без nomusic). */
export function baseVersion(dir, n) {
  let best = 1;
  try { for (const f of fs.readdirSync(path.join(dir, 'final'))) { const m = new RegExp(`^dosie${n}_v(\\d+)\\.mp4$`).exec(f); if (m) best = Math.max(best, +m[1]); } } catch { /* нет final */ }
  return best;
}

export function prepare(id) {
  const src = srcDir(id), dst = enDir(id), n = norm(id);
  if (!fs.existsSync(src)) throw new Error('нет русского проекта ' + src);
  const script = path.join(runDir(id), 'script_en.txt');
  if (!fs.existsSync(script)) throw new Error('нет английского сценария ' + script);
  if (fs.existsSync(dst)) throw new Error('проект уже есть: ' + dst + ' (удалите вручную, если нужна чистая копия)');
  fs.cpSync(src, dst, { recursive: true, filter: (p) => !skipInCopy(path.basename(p)) || p === src });
  const ver = baseVersion(src, n);
  fs.writeFileSync(path.join(dst, 'lang.json'), JSON.stringify({ lang: 'en', source: `dosie${n}`, base_version: `v${ver}`, voice: 'en_calm_f' }, null, 1));
  fs.copyFileSync(script, path.join(dst, 'script_en.txt'));
  console.log(`проект ${dst} создан из ${src} (база v${ver})`);
  return dst;
}

export function narrate(id, { maxSec = 53 } = {}) {
  const dst = enDir(id), log = path.join(dst, '_narrate_en_log.txt');
  const r = spawnSync(PY, [path.join(VIDEO, 'narrate.py'), '--lang', 'en', '--text', path.join(dst, 'script_en.txt'), '--out', path.join(dst, 'narration.mp3'),
    '--srt', path.join(dst, 'captions.srt'), '--words', path.join(dst, 'words.json'), '--max-sec', String(maxSec), '--patience', '1200'], { encoding: 'utf8', maxBuffer: 1 << 26, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
  fs.writeFileSync(log, (r.stdout || '') + '\n' + (r.stderr || ''));
  const words = readJson(path.join(dst, 'words.json'));
  const end = words && words.length ? words[words.length - 1].end : null;
  console.log(`озвучка #${id}: код ${r.status}, слов ${words ? words.length : 0}, речь до ${end} с (лимит ${maxSec})`);
  return { code: r.status, end, words: words ? words.length : 0, log };
}

export function briefFor(id, title) {
  const n = norm(id), P = enDir(id).replaceAll('\\', '/'), SRC = srcDir(id).replaceAll('\\', '/'), V = VIDEO.replaceAll('\\', '/'), S = path.join(ROOT, 'scripts').replaceAll('\\', '/');
  const meta = readJson(path.join(enDir(id), 'lang.json')) || {}, ver = (meta.base_version || 'v1').replace(/^v/, '');
  const words = readJson(path.join(enDir(id), 'words.json')) || [];
  const speechEnd = words.length ? words[words.length - 1].end.toFixed(1) : '?';
  const buildName = ver === '1' ? `build_dosie${n}.py` : `build_dosie${n}_v${ver}.py`;
  return `# Задание: английская версия ролика №${id} «${title}» (проект dosie${n}_en)

Ты Кирилл Кадров, Video Editor AI-офиса Ника (Claude Opus 5.5, высокие усилия). Отвечай и пиши отчёт по-русски, весь видимый в ролике текст по-английски. Публиковать ничего нельзя: результат уходит Нику на приёмку.

## Что это за работа (решение Ника 2026-10-28)
Ник запускает английский канал «Medical Detective». Принятый русский ролик переводится: **тот же сюжет, те же факты, та же раскадровка**, английская озвучка и английский текст на экране. Это **ЛОКАЛИЗАЦИЯ готового ролика, а не новая режиссура**: шоты, их порядок, цвета полей, переходы, утка, лупа, предметы, графика, звуки появления, музыка, библиотечные блоки берутся из русской версии. Менять надо только язык и всё, что от него зависит (тайминги, длины подписей, субтитры, призыв). Библиотеку и скиллы заново не изучай и раскадровку не пиши: они приняты; новое визуальное решение добавляется только если английский текст иначе не помещается.

## Исходные данные
- **Русский оригинал, ТОЛЬКО ЧТЕНИЕ** (ничего в нём не менять, не удалять, не пересобирать): \`${SRC}/\`. Версия-основа: **v${ver}** (\`final/dosie${n}_v${ver}.mp4\`). Её сборка \`${buildName}\` (и \`_parts/*.py\`, если есть), \`make_frames*.py\`, \`finalize.py\`, \`mix_sfx.py\`, \`run_all.sh\`, \`STORYBOARD.json\`, \`LIBRARY_PLAN.json\`, \`REVIEW_LOG.json\`, отчёт \`RESULT*.md\`. **Начни с отчёта и сборки.**
- **Твой проект (пиши только сюда): \`${P}/\`.** Это копия русского проекта без итогов, кадров и журналов. В нём уже лежат:
  - \`script_en.txt\`: английский сценарий, утверждён, **ТЕКСТ НЕ МЕНЯТЬ**. Абзацы идут один к одному с русскими (\`script_ru.txt\`), последний абзац это призыв подписаться.
  - \`narration.mp3\`, \`words.json\` (тайминги английских слов), \`captions.srt\`: готовая английская озвучка (голос en_calm_f, речь до ${speechEnd} с). **Озвучку не генерируй заново и голос не меняй.** Не нравится озвучка (обрыв, склейка слов, пауза > 1,5 с): напиши в RESULT.md и сделай ролик с тем, что есть.
  - \`lang.json\` (\`{"lang":"en"}\`): по нему ворота ждут английский призыв и английские слова-вердикты. Не удаляй.
- Факты и источники: \`${SRC}/FACTS.md\` (по-русски). На экране источники записываются по-английски латиницей: фамилия автора, журнал, год (как в оригинале на экране, где это уже латиница, оставь).
- Призыв: \`${V}/cta_en.json\`. Голос уже в озвучке. На экране: **SUBSCRIBE** / **TELEGRAM CHANNEL** / **MEDICAL DETECTIVE** / **LINK IN BIO** (вместо @имени; адреса нет). Правила те же, что для русского: Manrope 800, ПРОПИСНЫЕ, каждая буква отдельно с шагом ≤ 0,06 с (\`.cta-ch\`), образец \`${V}/med_detective/CTA_REFERENCE.html\`, сцена длится, пока звучит призыв, затем мелкая рамка с источниками.
- Оговорка на финальной рамке: «Not medical advice. If something about your health worries you, see a doctor.» (английский вариант русского «Не заменяет консультацию врача…»).

## Что менять
1. **Весь видимый текст стал английским:** хук, большие слова, цифры с подписями, карточки, подписи, названия источников, печать «МИФ» → **MYTH**, дисклеймер. Фразы, которые есть в озвучке, на экране берутся из \`script_en.txt\` дословно или как точная выжимка из неё. Ничего нового не утверждай и не добавляй. Подписи коротко, как в оригинале; числа цифрами, как в оригинале.
2. **Тайминги пересчитать по английскому \`words.json\`.** В сборке всё привязано к индексам слов (\`EXPECTED\` по абзацам, \`ANCHOR_TEXT\`, \`STARTS\`, якоря шотов, появление слов, чисел, лупы, печати; проверки абзацев и слов остановят сборку, пока не сойдётся). Для каждого шота найди **английское слово, с которого по смыслу начинается та же мысль**, что в русском шоте. Ритм сохрани: новый шот каждые 1,5-3 с (допуск оригинала 1,2-3,3 с), граница шота = начало якорного слова минус 0,12 с. Если английская фраза длиннее или короче русской и шот выходит за допуск, подвинь границу соседних шотов внутри той же сцены или раздели/склей шоты, но смену картинки не реже, чем требует DYNAMICS.md.
3. **Длина строк на экране.** Английские слова другой ширины: перепроверь, что ничего не вылезает за безопасную зону x 60-940, y 250-1440 и за карточки, подбери размеры шрифта (Manrope 800 латиница лежит в \`assets/fonts/manrope-latin-*.woff2\`, \`@font-face\` для обеих подгрупп в композициях уже есть). Русские подстановки в сборке («ё» → «е», склонения, русские сокращения) убери.
4. **Субтитры:** те же стили (МАРКЕР / СЛЭМ) и поведение, слова из английского \`words.json\`; переносы по-английски; \`final/captions.srt\` из них.
5. **Службные слова и вердикт.** На экране и в озвучке нет «evidence #», «plot twist», «verdict», «claim» как рубрик. Слова-ярлыки (**MYTH, TRUE, FALSE, FAKE, LIE, DEBUNKED**) и штамп MYTH появляются только в последних 40 % ролика, перед призывом. «Is that true?» как вопрос в хуке допустимо. Проверка: \`node ${S}/check_verdict_label.mjs ${P}\` (код 0).
6. **Имена файлов.** Сборка \`build_dosie${n}_en.py\` (из \`_parts\`, если оригинал так устроен: правь копии в \`_parts\`, склейка как в \`build.sh\`), \`run_all.sh\` с путями на \`${P}\` и рабочей папкой рендера \`~/AppData/Local/hermes/cache/scratch/d${n}_en\` (в оригинале пути указывают на русский проект и его scratch: **поправь их, иначе перезапишешь русский ролик**). Итоговые файлы: \`final/dosie${n}_en_v1.mp4\`, \`final/dosie${n}_en_v1_nomusic.mp4\`, \`final/captions.srt\`, \`final/poster.png\`, \`final/contact_sheet.png\`, \`RESULT.md\` в корне проекта.
7. Длина ролика ≤ 59,0 с (озвучка + хвост). Музыку и звуки оставь как в оригинале (палитра та же, звуков на смене кадра нет, музыка −24 дБ, два файла: с музыкой и без).

## Стандарт ролика и проверки (те же, что у оригинала, ничего не ослаблено)
≤ 59,0 с; безопасная зона x 60-940, y 250-1440 для всего читаемого; громкость −14 LUFS, true peak ≤ −1,5 dBTP; 1080×1920, 30 к/с, H.264 High yuv420p, AAC 48 кГц, faststart, ≤ 40 МБ; шляпа утки по центру и только по y; лупа отдельным элементом; динамика формата A по \`${V}/med_detective/DYNAMICS.md\` (готовый mp4 обязан пройти \`node ${S}/video_dynamics.mjs <mp4>\` с кодом 0, а также \`${S}/video_format.mjs\`, \`${S}/check_duck_hat.mjs ${P}\`, \`${S}/check_cta.mjs ${P}\` (для lang=en ждёт SUBSCRIBE), \`${S}/check_verdict_label.mjs ${P}\`, \`${S}/check_library_plan.mjs ${P}\`).
- \`STORYBOARD.json\` и \`LIBRARY_PLAN.json\` остаются как в оригинале; поправь в \`STORYBOARD.json\` только текстовые поля, которые описывают русские надписи. В \`RESULT.md\` обязательны разделы «**Использовано из библиотеки**» («без изменений: локализация готового ролика» и перечень того, что всё же добавлено) и «**Использовано из vizavi-motion**» («раскадровка v${ver} сохранена, меняются язык, тайминги и ширина строк»; перечисли затронутые сцены).
- \`REVIEW_LOG.json\`: \`builds\` равно числу успешных рендеров в \`_render_rounds.json\` (у тебя он начат с нуля; первый рендер = 1), на каждый круг добавь запись просмотра (интервал → наблюдение → причина → исправление → перепроверка) и обнови \`final_check\`; \`statuses\` честные true/false.
- Кадры смотри через \`vision_analyze\` (контактный лист, затем по одному кадру в местах, где английский текст длиннее русского, и в сцене призыва).

${renderRules({ proj: P, scripts: path.join(ROOT, 'scripts') })}
## Жёсткие рамки
- Работай только в \`${V}/\` и в проекте \`${P}\`. Русский проект \`${SRC}\` и другие \`dosie*\` не трогай. Не трогай \`server/\`, \`web/\`, \`smm/\`, \`scripts/\`, git, профили и конфиги Hermes, cron; ничего не устанавливай; сервисы не перезапускай; никому не пиши и ничего не публикуй.
- В режиме без человека блокируются \`execute_code\` и команды-heredoc: создавай файлы \`write_file\`/\`patch\`, запускай скрипты простыми командами \`terminal\` (\`C:/hf_tts/venv/Scripts/python.exe путь.py\`).
- Прогресс пиши в \`${P}/PROGRESS.md\` короткими строками («ЧЧ:ММ: что сделано, что дальше») после каждого шага.
- Факты только из FACTS.md. Никаких советов по лечению, дозировок, брендов, «врачей» и ИИ-аватаров. Если что-то невозможно, честно запиши в RESULT.md, ничего не подделывай.
- Команды дольше 600 с запускай фоном; временные файлы в \`~/AppData/Local/hermes/cache/scratch\`.
- RESULT.md первой строкой: одно предложение-итог без разметки (оно уйдёт Нику в Telegram).
`;
}

export async function produce(id, title) {
  const dst = enDir(id), n = norm(id);
  const bf = path.join(runDir(id), 'BRIEF_en.md'); fs.writeFileSync(bf, briefFor(id, title), 'utf8');
  const log = fs.openSync(path.join(runDir(id), '_localize_log.txt'), 'w');
  const code = await new Promise((resolve) => {
    const p = hermesSpawn(['-p', 'video', 'chat', '--query-file', bf, '-Q', '--oneshot', '--max-turns', '400', '--run-budget', '5400'], { cwd: ROOT, windowsHide: true, stdio: ['ignore', log, 'ignore'] });
    p.on('exit', resolve);
  });
  const mp4 = path.join(dst, 'final', `dosie${n}_en_v1.mp4`);
  if (!fs.existsSync(mp4)) { await notify(`⚠️ Английская версия «${title}» не собрана: нет ${mp4} (код ${code}). Смотрите ${dst}/PROGRESS.md`).catch(() => {}); throw new Error('нет mp4'); }
  return finish(id, title);
}

/** Ворота + проверка озвучки в готовом файле + отправка Нику. Вызывается и вручную: node smm_localize.mjs finish <id>. */
export async function finish(id, title, { sendAnyway = false } = {}) {
  const dst = enDir(id), n = norm(id), mp4 = path.join(dst, 'final', `dosie${n}_en_v1.mp4`);
  const gt = gate(mp4, dst, { dynamics: true, format: 'A' });
  let res = ''; try { res = (fs.readFileSync(path.join(dst, 'RESULT.md'), 'utf8').split('\n').find((l) => l.trim()) || '').replace(/[#*`]/g, '').trim(); } catch { /* отчёта нет */ }
  console.log(gt.ok ? 'ворота: ок ' + (gt.summary || '') : 'ворота: ' + gt.problems.join('; '));
  if (!gt.ok && !sendAnyway) return { ok: false, problems: gt.problems };
  const note = gt.ok ? '' : `⚠️ АВТОПРОВЕРКА НЕ ПРОЙДЕНА:\n- ${gt.problems.join('\n- ')}\n\n`;
  await sendVideoFile(mp4, `${note}🇬🇧 «${title}» (английская версия, озвучка en_calm_f).\n${res}${gt.summary ? '\n' + gt.summary : ''}`);
  return { ok: true, problems: gt.problems };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const [cmd, id, ...rest] = process.argv.slice(2);
  const titles = { 152: 'Кардио после силовой «съедает» мышцы?', 144: 'Пресс и жир на животе', 109: 'Жёсткий матрас' };
  const title = rest.filter((x) => !x.startsWith('--')).join(' ') || titles[id] || `ролик ${id}`;
  try {
    if (cmd === 'prepare') prepare(id);
    else if (cmd === 'narrate') { const r = narrate(id); process.exit(r.code === 0 ? 0 : r.code || 1); }
    else if (cmd === 'brief') { fs.writeFileSync(path.join(runDir(id), 'BRIEF_en.md'), briefFor(id, title), 'utf8'); console.log('BRIEF_en.md записан'); }
    else if (cmd === 'produce') await produce(id, title);
    else if (cmd === 'finish') { const r = await finish(id, title, { sendAnyway: rest.includes('--send-anyway') }); process.exit(r.ok ? 0 : 1); }
    else if (cmd === 'all') { prepare(id); const r = narrate(id); if (r.code !== 0) process.exit(r.code || 1); await produce(id, title); }
    else { console.error('использование: smm_localize.mjs prepare|narrate|brief|produce|finish|all <id> [название] [--send-anyway]'); process.exit(2); }
  } catch (e) { console.error(e.message); process.exit(1); }
}

// Продолжение монтажа после обрыва сессии монтажёра (бюджет 90 минут, решение Ника 2026-10-22: «чтобы в будущем избегать»).
// Раньше кнопка «Повторить» запускала produce с нуля: бриф говорил «создай проект», и новая сессия Opus
// (до 90 минут) начинала заново то, что уже собрано. Здесь определяется, что в проекте УЖЕ есть, и бриф получает
// блок «ПРОДОЛЖЕНИЕ» вместо шага «создай проект». Только чтение: ничего не пишет и не запускает.
import fs from 'node:fs';
import path from 'node:path';
import { roundsInfo } from './render_slot.mjs';

const exists = (f) => { try { return fs.statSync(f).isFile() && fs.statSync(f).size > 0; } catch { return false; } };
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const mtime = (f) => { try { return fs.statSync(f).mtimeMs; } catch { return 0; } };

/** Что уже сделано в проекте dosieNN. Ничего не выдумывает: только факты из файлов. */
export function projectState(proj, n) {
  const P = (f) => path.join(proj, f);
  const nn = String(n).padStart(2, '0');
  const build = P(`build_dosie${nn}.py`), mp4 = P(path.join('final', `dosie${nn}_v1.mp4`));
  const rounds = roundsInfo(proj, 'main').done;
  const s = {
    hasProject: fs.existsSync(proj) && exists(P('format.json')),
    narration: exists(P('narration.mp3')) && exists(P('words.json')),
    storyboard: exists(P('STORYBOARD.json')),
    libraryPlan: exists(P('LIBRARY_PLAN.json')),
    build: exists(build),
    mp4: exists(mp4),
    rounds,
    reviewLog: readJson(P('REVIEW_LOG.json')),
    result: exists(P('RESULT.md')),
    // исходники новее готового файла: правки внесены, но не отрендерены (так остановился Матвей на №54)
    unrenderedEdits: exists(mp4) && exists(build) && mtime(build) > mtime(mp4) + 1000,
  };
  s.resumable = s.hasProject && s.build && (s.mp4 || s.rounds > 0);
  return s;
}

/** Первый невыполненный шаг конвейера: подсказка монтажёру и подпись в карточке. */
export function nextStep(s, limit = 3) {
  if (!s.hasProject || !s.build) return { id: 'start', text: 'проект не собран: начни с шага 1' };
  if (!s.mp4) return { id: 'render', text: 'сборщик есть, готового файла нет: проверь, отрендери круг и экспортируй' };
  if (s.unrenderedEdits) return { id: 'rerender', text: s.rounds >= limit ? 'исходники новее файла, а кругов не осталось: финализируй, что есть, и честно перечисли неисправленное' : 'исходники новее готового файла: правки внесены, но НЕ отрендерены. Отрендерь следующий круг' };
  if (!s.reviewLog) return { id: 'review', text: 'файл собран, но нет REVIEW_LOG.json: просмотри кадры и запиши журнал' };
  return { id: 'finish', text: 'всё собрано: осталось отчёт RESULT.md и итоговые проверки' };
}

/** Блок брифа. Заменяет шаг «создай проект», когда продолжать есть что. Пустая строка = продолжать нечего. */
export function resumeBlock(proj, n, { limit = 3 } = {}) {
  const s = projectState(proj, n);
  if (!s.resumable) return '';
  const nn = String(n).padStart(2, '0'), P = String(proj).replaceAll('\\', '/');
  const step = nextStep(s, limit), left = Math.max(0, limit - s.rounds);
  const have = [
    s.narration && 'озвучка и words.json', s.storyboard && 'STORYBOARD.json', s.libraryPlan && 'LIBRARY_PLAN.json',
    `сборщик build_dosie${nn}.py`, s.mp4 && `готовый файл final/dosie${nn}_v1.mp4`, s.reviewLog && 'REVIEW_LOG.json', s.result && 'RESULT.md',
  ].filter(Boolean);
  return `## ПРОДОЛЖЕНИЕ, А НЕ НОВЫЙ РОЛИК (код проверил проект; предыдущая сессия оборвалась по времени)
Проект \`${P}\` уже собран частично. **Не создавай проект заново, не переписывай сборщик, не генерируй озвучку и раскадровку заново, скиллы целиком не перечитывай.** Шаги 1-4 ниже ВЫПОЛНЕНЫ; проверь это за минуту (\`PROGRESS.md\`, \`RESULT.md\`) и иди дальше.
- Уже есть: ${have.join(', ')}.
- Кругов рендера сделано: ${s.rounds} из ${limit} (осталось ${left}).
- **Первый невыполненный шаг: ${step.text}.**
- Прочитай \`PROGRESS.md\` и раздел «Что осталось» в \`RESULT.md\`: предыдущая сессия записала там, на чём остановилась.
- Если в проекте есть \`run_all.sh\` (круг одной командой: \`bash run_all.sh bN\`, N это номер круга), пользуйся им вместо ручных шагов.

`;
}

// ---------------------------------------------------------------- классификация провала ворот
// Ворота ругаются либо на КАЧЕСТВО ролика (формат, шляпа, динамика, зона, звук, вердикт), либо только на ОТСУТСТВУЮЩИЙ ОТЧЁТНЫЙ
// артефакт, который пишется после просмотра (журнал vizavi, разделы RESULT.md). Второй случай не брак ролика: монтажёр не успел
// отчитаться. Код его НЕ подделывает (журнал просмотра свидетельствует, что кадры смотрели), а решает, что делать дальше.
const ARTIFACT = [
  /^vizavi: нет REVIEW_LOG\.json/,
  /^vizavi: REVIEW_LOG\./,
  /^vizavi: в [\w.]+ нет раздела «Использовано из vizavi-motion»/,
  /^библиотека: в [\w.]+ нет раздела «Использовано из библиотеки»/,
];
export const isArtifactProblem = (p) => ARTIFACT.some((re) => re.test(String(p)));

/** { onlyArtifacts, artifacts, defects }: onlyArtifacts = ролик собран и годен, не хватает отчёта о просмотре. */
export function classifyGate(problems) {
  const list = (problems || []).map(String);
  const artifacts = list.filter(isArtifactProblem), defects = list.filter((p) => !isArtifactProblem(p));
  return { onlyArtifacts: list.length > 0 && defects.length === 0, artifacts, defects };
}

/** Можно ли дать монтажёру короткое продолжение (дописать отчёт и, если надо, дорендерить), а не новый монтаж. */
export function canContinueShort(proj, n, { limit = 3 } = {}) {
  const s = projectState(proj, n);
  return { ok: s.resumable && s.mp4, state: s, left: Math.max(0, limit - s.rounds) };
}

/** Задание на короткое продолжение: дописать недостающее, ничего не пересобирая без необходимости. */
export function shortContinueBrief({ proj, n, title, editorName, artifacts, state, limit = 3, render = '' }) {
  const nn = String(n).padStart(2, '0'), P = String(proj).replaceAll('\\', '/');
  const step = nextStep(state, limit), left = Math.max(0, limit - state.rounds);
  return `# Дописать отчёт и довести ролик №${n} до приёмки (продолжение оборванной сессии)

Ты ${editorName}, Video Editor AI-офиса Ника (Claude Opus 5.5). Отвечай и пиши отчёт по-русски. Публиковать ничего нельзя. Предыдущая сессия оборвалась по времени (лимит 90 минут): ролик «${title}» собран, но не прошёл автопроверку: не хватает отчётных артефактов.

## Что не хватает (код проверил)
${artifacts.map((a) => '- ' + a).join('\n')}

## Состояние проекта \`${P}\`
- Кругов рендера: ${state.rounds} из ${limit} (осталось ${left}). Готовый файл: ${state.mp4 ? 'есть' : 'нет'}.
- **${step.text}.**
- ${state.unrenderedEdits ? 'ВНИМАНИЕ: сборщик новее готового файла: правки внесены, но не отрендерены. Журнал описывает ТО, ЧТО В ФАЙЛЕ, поэтому сначала отрендери круг (если кругов не осталось, опиши в журнале честно, какие правки в файл не вошли).' : 'Исходники и файл согласованы.'}

## Что сделать (короткая работа, не новый монтаж)
1. Прочитай \`PROGRESS.md\` и \`RESULT.md\` (раздел «Что осталось»), \`STORYBOARD.json\`. **Не пересобирай ролик, озвучку и раскадровку; скиллы целиком не перечитывай.**
2. Если нужен круг: \`bash run_all.sh bN\` (если скрипта нет, по образцу \`video/dosie54/run_all.sh\`), только через обёртку \`render_slot.mjs\`. Лимит кругов держит код.
3. **Просмотри кадры ГОТОВОГО файла** (\`final/dosie${nn}_v1.mp4\`, \`contact_sheet.png\`, снимки нужных мест) через \`vision_analyze\` и запиши \`REVIEW_LOG.json\` по эталону \`REVIEW_LOG_REFERENCE.json\`: интервал → наблюдение → причина → правка → перепроверка. \`builds\` = число успешных рендеров в \`_render_rounds.json\`. \`statuses\` true ТОЛЬКО для реально проверенного, остальное false. Выдумывать записи нельзя: код сверяет их с файлами.
4. \`RESULT.md\`: убери блок «НЕ ГОТОВ К ПРИЁМКЕ» (если был), добавь разделы «Использовано из библиотеки» и «Использовано из vizavi-motion», первой строкой одно предложение-итог без разметки (оно уйдёт Нику).
5. Проверь сам: \`node C:/Users/Николай/ai-office/scripts/check_vizavi.mjs ${P} --review\` (код 0) и \`node ${P}/_gate.mjs final/dosie${nn}_v1.mp4\`.

## Рамки
- Работай только в \`${P}\`. Не трогай \`server/\`, \`web/\`, \`smm/\`, git, профили, cron. Ничего не публикуй.
- Уложись в 20-25 минут. Не успеваешь: честно запиши в \`RESULT.md\`, что осталось.
${render}`;
}

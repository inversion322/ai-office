// Длина озвучки сценария для цикла «Ксения → правки». Основной путь: настоящий синтез Dmitry (+25%) и ffprobe через video/narrate.py
// (кэш, очередь и повторы внутри него). Сервис Edge неофициальный и отказывает окнами по минутам: если он не ответил за `patience` секунд,
// длина оценивается по тексту БЕЗ сети (с запасом в безопасную сторону), этап не падает. Точный замер всё равно будет при озвучке роликом.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const PY = 'C:/hf_tts/venv/Scripts/python.exe';
const DURATION = /duration:\s*([\d.]+)\s*s/;
// Честная оценка без запаса (решение Ника 2026-10-21: завышенная оценка гнала 4 из 5 кругов на «сокращение по секундомеру»).
// ESTIMATE_BIAS: оценка narrate.py (в ней bias 1.07) против настоящего синтеза Dmitry +25% по 5 озвученным роликам: 1.08, 1.12, 1.12, 1.09, 1.12 (среднее 1.106).
// Делим на среднее: ошибка остаётся в пределах ±2 с, а решает всё равно точный замер при озвучке ролика.
export const ESTIMATE_MARGIN = 0;      // секунд запаса сверх оценки
export const ESTIMATE_BIAS = 1.106;      // во сколько раз оценка narrate.py выше реального синтеза

export function speechSeconds(segments, { root, patience = 90, workDir } = {}) {
  const dir = workDir || path.join(root, 'smm', 'runs', '_len'); fs.mkdirSync(dir, { recursive: true });
  const stem = `len_${process.pid}_${Date.now()}`;                   // уникальные файлы: два этапа одновременно не затирают друг друга
  const script = path.join(dir, stem + '.txt'); fs.writeFileSync(script, segments.join('\n\n'), 'utf8');
  try { return measure(segments, { root, patience, dir, stem, script }); }
  finally { for (const e of ['.txt', '.mp3']) { try { fs.unlinkSync(path.join(dir, stem + e)); } catch {} } }
}

function measure(segments, { root, patience, dir, stem, script }) {
  const narrate = path.join(root, 'video', 'narrate.py');
  const run = (args) => spawnSync(PY, [narrate, '--lang', 'ru', '--text', script, ...args], { encoding: 'utf8', env: process.env, timeout: (patience + 120) * 1000 });

  // Замер длины сценария идёт только по Edge и никогда не будит VoiceStudio (видеокарта, ~1 мин на запуск): запасной голос здесь не нужен.
  // Если основной голос ролика VoiceStudio, настоящий синтез Edge дал бы не ту длину (VoxCPM2 читает на ~40% быстрее): тогда оценка по темпу голоса.
  // Исключение: основной голос VoiceStudio, но запасной Edge, и в voice_settings.json length_basis = slowest (по умолчанию). Пока VoxCPM2 может не
  // запуститься (видеопамять занята Whisper шлюза), озвучку вправе взять Dmitry, который на ~25% медленнее: сценарий, принятый по быстрому голосу,
  // тогда не влез бы в лимит. Меряем по самому медленному из двух; length_basis = primary включают, когда основной голос запускается стабильно.
  let vsPrimary = false;
  try {
    const plan = JSON.parse((run(['--show-config']).stdout || '{}').trim().split('\n').pop());
    vsPrimary = plan.provider === 'voicestudio' && !(plan.fallback === 'edge' && (plan.length_basis || 'slowest') === 'slowest');
  } catch {}
  const est = run(['--estimate-only']);                              // мгновенно, без сети: нужна и для подсказок по абзацам
  const em = DURATION.exec(est.stdout || ''), sm = /segments_sec:\s*(.+)/.exec(est.stdout || '');
  const estSec = em ? Number(em[1]) : null;
  const estSeg = sm ? sm[1].split(',').map(Number) : [];

  // Тестовый режим: никакого синтеза и сети, только оценка по тексту (так интеграционные тесты не зависят от Edge TTS).
  if (process.env.SMM_TTS_ESTIMATE_ONLY && estSec != null) return { sec: estSec / ESTIMATE_BIAS + ESTIMATE_MARGIN, estimated: true, perSeg: estSeg.map((x) => x / ESTIMATE_BIAS), reason: 'тест' };
  if (vsPrimary && estSec != null) return { sec: estSec, estimated: true, perSeg: estSeg, reason: 'голос VoiceStudio: оценка по темпу голоса, синтез не запускался' };
  const real = run(['--provider', 'edge', '--no-fallback', '--out', path.join(dir, stem + '.mp3'), '--max-sec', '999', '--patience', String(patience)]);
  const rm = DURATION.exec(real.stdout || '');
  if (rm) {
    const sec = Number(rm[1]), k = estSec ? sec / estSec : 1;
    return { sec, estimated: false, perSeg: estSeg.map((x) => x * k) };
  }
  if (estSec == null) throw new Error('не удалось ни измерить, ни оценить озвучку: ' + String(real.stderr || est.stderr || '').trim().split('\n').pop().slice(0, 200));
  return { sec: estSec / ESTIMATE_BIAS + ESTIMATE_MARGIN, estimated: true, perSeg: estSeg.map((x) => x / ESTIMATE_BIAS), reason: String(real.stderr || '').trim().split('\n').filter((l) => /TTS_UNAVAILABLE|Error|Exception/.test(l)).pop() || 'сервис озвучки не ответил' };
}

/** Что делать с длиной озвучки: 'ok' | 'soft' | 'cut'.
 *  'cut' (вернуть на сокращение) только по настоящему замеру или если оценка выше лимита больше чем на 15%;
 *  'soft' (оценка выше лимита не более чем на 15%): круг не тратится, остаётся предупреждение на карточке; решает точный замер при озвучке ролика.
 *  Решение Ника 2026-10-21: завышенная оценка гнала 4 из 5 кругов на сокращение и вымывала из текста всё живое. */
export const SOFT_OVER = 0.15;
/** Последний круг: перебор по настоящему замеру до 10% (≈5 с) не бросает сценарий: его проверяет Вера, а на карточке остаётся предупреждение о длине;
 *  точная длина решится при озвучке ролика, где монтажёр может чуть ускорить паузы. Больший перебор по-прежнему отказ. Решение 2026-10-21 по итогам пробного прогона: фактическая правка Веры
 *  съедала круги, и верный по фактам текст отбрасывался из-за трёх секунд. */
export const LAST_ROUND_OVER = 0.10;
export function lengthVerdict(sp, limit, { lastRound = false } = {}) {
  if (!sp || !(sp.sec > limit)) return 'ok';
  const over = sp.sec / limit - 1;
  if (sp.estimated && over <= SOFT_OVER) return 'soft';
  if (lastRound && over <= LAST_ROUND_OVER) return 'soft';            // последний круг: небольшой перебор остаётся предупреждением
  return 'cut';
}

/** Что сказать сценаристу, когда озвучка длиннее лимита: сколько секунд убрать, где они лежат по абзацам и ЧТО резать, а что нет. Один текст для сценария A и вариантов B/C.
 *  Число слов НЕ называем: скорость на слово у русского диктора гуляет от 0,40 до 0,59 с в зависимости от длины слов (замер по четырём озвученным роликам),
 *  а любое число слов, посчитанное по константе, вело Ксению то на недолёт, то на перелёт. Раньше говорилось только «сократи», и модель резала каждую фразу до тезиса. */
export function cutAdvice(sec, limit, { perSeg = '', ctaSec = 8.4, tag = '' } = {}) {
  const cut = Math.ceil(sec - limit + 1);
  return `Озвучка ${sec.toFixed(1)} с${tag} при лимите ${limit} с (диктор +25%, в замер входит призыв подписаться ≈ ${ctaSec} с, он добавляется автоматически и не сокращается). Нужно убрать около ${cut} с.${perSeg ? ` Длина по абзацам: ${perSeg}.` : ''} Секунды, не слова: длинные слова звучат дольше коротких, считай по абзацам выше. РЕЖЬ: повторы, второстепенные имена и числа, третий факт, вторую оговорку, слова-паразиты. НЕ РЕЖЬ: сцену (кто что сделал), ставку зрителя, хук, развязку, число рядом с образом. Лучше убрать целый второстепенный абзац, чем обрезать каждую фразу до тезиса.`;
}

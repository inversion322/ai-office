// Длина озвучки сценария для цикла «Ксения → правки». Основной путь: настоящий синтез Dmitry (+25%) и ffprobe через video/narrate.py
// (кэш, очередь и повторы внутри него). Сервис Edge неофициальный и отказывает окнами по минутам: если он не ответил за `patience` секунд,
// длина оценивается по тексту БЕЗ сети (с запасом в безопасную сторону), этап не падает. Точный замер всё равно будет при озвучке роликом.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const PY = 'C:/hf_tts/venv/Scripts/python.exe';
const DURATION = /duration:\s*([\d.]+)\s*s/;
export const ESTIMATE_MARGIN = 2;      // секунд запаса сверх оценки (в самой оценке уже +7%)

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

  const est = run(['--estimate-only']);                              // мгновенно, без сети: нужна и для подсказок по абзацам
  const em = DURATION.exec(est.stdout || ''), sm = /segments_sec:\s*(.+)/.exec(est.stdout || '');
  const estSec = em ? Number(em[1]) : null;
  const estSeg = sm ? sm[1].split(',').map(Number) : [];

  // Тестовый режим: никакого синтеза и сети, только оценка по тексту (так интеграционные тесты не зависят от Edge TTS).
  if (process.env.SMM_TTS_ESTIMATE_ONLY && estSec != null) return { sec: estSec + ESTIMATE_MARGIN, estimated: true, perSeg: estSeg, reason: 'тест' };
  const real = run(['--out', path.join(dir, stem + '.mp3'), '--max-sec', '999', '--patience', String(patience)]);
  const rm = DURATION.exec(real.stdout || '');
  if (rm) {
    const sec = Number(rm[1]), k = estSec ? sec / estSec : 1;
    return { sec, estimated: false, perSeg: estSeg.map((x) => x * k) };
  }
  if (estSec == null) throw new Error('не удалось ни измерить, ни оценить озвучку: ' + String(real.stderr || est.stderr || '').trim().split('\n').pop().slice(0, 200));
  return { sec: estSec + ESTIMATE_MARGIN, estimated: true, perSeg: estSeg, reason: String(real.stderr || '').trim().split('\n').filter((l) => /TTS_UNAVAILABLE|Error|Exception/.test(l)).pop() || 'сервис озвучки не ответил' };
}

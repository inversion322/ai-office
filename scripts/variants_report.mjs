// Таблица «тройных запусков» для video/FORMATS.md: по каждой теме три строки (A/B/C): формат, время выхода (МСК), ссылка.
// Метрики (просмотры, удержание, подписчики) в Studio видит только Ник, колонки под них остаются пустыми.
// Запуск: node scripts/variants_report.mjs [--write]   (--write заменяет таблицу в разделе «Тройные запуски» файла video/FORMATS.md)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, videos, readJson } from './smm_lib.mjs';
import { variantOf, groupMembers, hhmm, FORMATS } from './variants.mjs';

const HEAD = ['| Тема | Вариант | Формат | Выход (МСК) | Просмотры | Просмотрели, % | Удержание, % | Подписчики |', '|---|---|---|---|---|---|---|---|'];
const dateRu = (d) => new Date(d).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', timeZone: 'Europe/Moscow' });
const stateOf = (id) => readJson(path.join(ROOT, 'smm', 'runs', `video_${id}`, 'publish.json')) || {};

/** Время выхода ролика: отложенный слот, если был, иначе момент публичной загрузки. null, если ещё не выходил. */
export function outAt(st) {
  const y = (st.youtube || []).filter((x) => x.privacy === 'public' || x.scheduledFor).pop();
  return y ? { at: y.scheduledFor || y.ts, url: y.url, planned: !!y.scheduledFor } : null;
}

/** Строки таблицы: группы по первому варианту, внутри группы по буквам. Убранные (rejected) варианты не включаются. */
export function buildRows(all, getState = stateOf) {
  const seen = new Set(), rows = [];
  for (const v of all) {
    const vr = variantOf(v); if (!vr || seen.has(vr.group)) continue; seen.add(vr.group);
    for (const m of groupMembers(all, v).filter((x) => x.stage !== 'rejected').sort((a, b) => variantOf(a).letter.localeCompare(variantOf(b).letter))) {
      const o = outAt(getState(m.id)), l = variantOf(m).letter;
      rows.push({ group: vr.group, id: m.id, letter: l, format: (FORMATS[l] || {}).name || l, title: v.title, out: o, stage: m.stage });
    }
  }
  return rows;
}

export function renderTable(rows) {
  const line = (r) => `| ${r.title} (№${r.group}) | ${r.letter} (№${r.id}) | ${r.format} | ${r.out ? `${dateRu(r.out.at)} ${hhmm(r.out.at)}${r.out.planned ? ' (по слоту)' : ''}${r.out.url ? ` [ссылка](${r.out.url})` : ''}` : 'ещё не вышел'} | | | | |`;
  return [...HEAD, ...rows.map(line)].join('\n');
}

export function replaceTable(md, table) {
  const i = md.indexOf('| Тема | Вариант |'); if (i < 0) throw new Error('в FORMATS.md нет таблицы тройных запусков');
  let j = i; const lines = md.slice(i).split('\n'); let n = 0; for (const l of lines) { if (!l.startsWith('|')) break; n += l.length + 1; }
  j = i + n; return md.slice(0, i) + table + '\n' + md.slice(j);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const rows = buildRows(await videos()), table = renderTable(rows);
  if (process.argv.includes('--write')) {
    const f = path.join(ROOT, 'video', 'FORMATS.md'), md = fs.readFileSync(f, 'utf8'); fs.writeFileSync(f, replaceTable(md, table), 'utf8'); console.log(`таблица обновлена: ${rows.length} строк`);
  } else console.log(table);
}

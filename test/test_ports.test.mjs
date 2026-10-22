// Порты интеграционных тестов не должны попадать в «чёрный список» fetch (undici отвергает их как bad port) и не должны пересекаться между файлами.
// Раньше progress брал 10000 + pid % 90 и падал целиком, когда выпадало 10080 (порт Amanda): красный полный прогон без причины в продукте.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
// «PORT = <база> + (process.pid % <шаг>)»: все файлы тестов, где порт выбирается так
const ranges = [];
for (const f of fs.readdirSync(DIR).filter((x) => x.endsWith('.test.mjs'))) {
  const m = /const PORT = (\d+) \+ \(process\.pid % (\d+)\)/.exec(fs.readFileSync(path.join(DIR, f), 'utf8'));
  if (m) ranges.push({ f, from: Number(m[1]), to: Number(m[1]) + Number(m[2]) - 1 });
}

test('нашлись диапазоны портов интеграционных тестов (иначе проверка ниже ничего не проверяет)', () => {
  assert.ok(ranges.length >= 10, 'найдено диапазонов: ' + ranges.length);
});

test('ни один порт тестов не запрещён для fetch (bad port)', async () => {
  const bad = [];
  for (const r of ranges) for (let p = r.from; p <= r.to; p++) {
    try { await fetch(`http://127.0.0.1:${p}/x`, { signal: AbortSignal.timeout(100) }); }
    catch (e) { if (String((e.cause && e.cause.message) || e.message).includes('bad port')) bad.push(`${r.f}:${p}`); }
  }
  assert.deepEqual(bad, [], 'эти порты fetch отвергает целиком: ' + bad.join(', '));
});

test('диапазоны портов разных файлов не пересекаются', () => {
  const sorted = [...ranges].sort((a, b) => a.from - b.from);
  for (let i = 1; i < sorted.length; i++) assert.ok(sorted[i].from > sorted[i - 1].to, `${sorted[i - 1].f} (${sorted[i - 1].from}-${sorted[i - 1].to}) пересекается с ${sorted[i].f} (${sorted[i].from}-${sorted[i].to})`);
});

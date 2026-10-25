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

// Список «bad port» из стандарта Fetch (WHATWG). Раньше тест проверял каждый порт каждого диапазона настоящим запросом `GET /x`, и этот запрос попадал в живые
// заглушки соседних тестов, идущих параллельно (narrate_voicestudio считал его обращением к серверу и краснел). Теперь сеть не трогается:
// сверяем диапазоны со списком, а сам список проверяем только на запрещённых портах (отказ приходит ДО соединения, значит и трафика нет).
const BAD_PORTS = [1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95, 101, 102, 103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137, 139, 143, 161, 179,
  389, 427, 465, 512, 513, 514, 515, 526, 530, 531, 532, 540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993, 995, 1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566, 6665, 6666,
  6667, 6668, 6669, 6679, 6697, 10080];

test('ни один порт тестов не запрещён для fetch (bad port)', () => {
  const bad = [];
  for (const r of ranges) for (const p of BAD_PORTS) if (p >= r.from && p <= r.to) bad.push(`${r.f}:${p}`);
  assert.deepEqual(bad, [], 'эти порты fetch отвергает целиком: ' + bad.join(', '));
});

test('список запрещённых портов совпадает с поведением fetch этой версии Node (проверка только на запрещённых портах: соединения не бывает)', async () => {
  const notBlocked = [];
  for (const p of BAD_PORTS) {
    try { await fetch(`http://127.0.0.1:${p}/`, { signal: AbortSignal.timeout(1000) }); notBlocked.push(p); }
    catch (e) { if (!String((e.cause && e.cause.message) || e.message).includes('bad port')) notBlocked.push(p); }
  }
  assert.deepEqual(notBlocked, [], 'эти порты из списка fetch не считает запрещёнными: список устарел');
});

test('охрана самой проверки: порт 10080 в диапазоне теста был бы пойман', () => {
  const fake = [{ f: 'x.test.mjs', from: 10000, to: 10079 + 1 }], hit = [];
  for (const r of fake) for (const p of BAD_PORTS) if (p >= r.from && p <= r.to) hit.push(p);
  assert.deepEqual(hit, [10080]);
});

test('диапазоны портов разных файлов не пересекаются', () => {
  const sorted = [...ranges].sort((a, b) => a.from - b.from);
  for (let i = 1; i < sorted.length; i++) assert.ok(sorted[i].from > sorted[i - 1].to, `${sorted[i - 1].f} (${sorted[i - 1].from}-${sorted[i - 1].to}) пересекается с ${sorted[i].f} (${sorted[i].from}-${sorted[i].to})`);
});

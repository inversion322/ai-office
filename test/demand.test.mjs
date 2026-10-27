// Замер спроса на темы: сеть подменена, ключи только тестовые. Реальные сайты и боевой demand_keys.json в тесте не участвуют.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
process.env.OFFICE_DEMAND_RETRY_MS = '0';
process.env.OFFICE_DEMAND_KEYS_FILE = path.join(os.tmpdir(), 'no-such-demand-keys-' + process.pid + '.json');
delete process.env.OFFICE_NO_DEMAND; delete process.env.OFFICE_DEMAND_STUB;
const D = await import('../scripts/demand.mjs');

/** Подмена fetch: routes = [[regex по адресу, (url, init) => { status, body }]]; calls — журнал вызовов. */
const mkFetch = (routes) => { const calls = []; const f = async (url, init = {}) => {
  calls.push({ url: String(url), init });
  for (const [re, h] of routes) if (re.test(String(url))) { const r = await h(String(url), init); return { ok: r.status >= 200 && r.status < 300, status: r.status, text: async () => (typeof r.body === 'string' ? r.body : JSON.stringify(r.body)) }; }
  return { ok: false, status: 404, text: async () => '' };
}; f.calls = calls; return f; };
const NOW = new Date('2026-10-27T12:00:00Z');
const views = (rows) => ({ status: 200, body: { items: rows.map(([d, v]) => ({ timestamp: d.replace(/-/g, '') + '00', views: v })) } });

test('Википедия: окна по датам, а не по числу записей; динамика к прошлым 30 дням', async () => {
  const f = mkFetch([[/per-article/, () => views([['2026-08-30', 3], ['2026-09-26', 10], ['2026-09-27', 5], ['2026-10-26', 7]])]]);
  const r = await D.wikiViews('Гомеопатия', { fetch: f, now: NOW });
  assert.equal(r.ok, true); assert.equal(r.last30, 12); assert.equal(r.prev30, 13); assert.equal(r.change, -8);
  assert.match(f.calls[0].url, /Гомеопатия|%D0%93/); assert.match(f.calls[0].url, /20260828\/20261026$/);    // 60 дней до вчера включительно
});
test('Википедия: нет данных по статье = ошибка, а не ноль просмотров', async () => {
  const r = await D.wikiViews('Нет_такой', { fetch: mkFetch([[/per-article/, () => ({ status: 404, body: {} })]]), now: NOW });
  assert.deepEqual([r.ok, r.error], [false, 'нет данных по статье']);
});
test('Википедия: при 429 один повтор, затем данные', async () => {
  let n = 0; const f = mkFetch([[/per-article/, () => (++n === 1 ? { status: 429, body: '' } : views([['2026-10-26', 4]]))]]);
  const r = await D.wikiViews('Сон', { fetch: f, now: NOW }); assert.equal(r.ok, true); assert.equal(f.calls.length, 2);
});
test('Википедия: подсказка Виктора с перенаправлением берёт каноническое название', async () => {
  const f = mkFetch([[/action=query&redirects=1/, () => ({ status: 200, body: { query: { pages: { 5: { title: 'Эффект Моцарта' } } } } })], [/per-article/, () => views([['2026-10-26', 9]])]]);
  const r = await D.wikiMeasure('эффект моцарта', ['эффект Моцарта'], { fetch: f, now: NOW });
  assert.equal(r.ok, true); assert.equal(r.article, 'Эффект Моцарта'); assert.equal(r.how, 'подсказка Виктора');
});
test('Википедия: поиск принимает только статьи с общими словами запроса (не «Гепатоз» на «сжигание жира»)', async () => {
  const f = mkFetch([[/list=search/, () => ({ status: 200, body: { query: { search: [{ title: 'Гепатоз' }, { title: 'Байкал' }] } } })], [/per-article/, () => views([['2026-10-26', 99]])]]);
  const r = await D.wikiMeasure(null, ['локальное сжигание жира'], { fetch: f, now: NOW });
  assert.equal(r.ok, false); assert.equal(f.calls.filter((c) => /per-article/.test(c.url)).length, 0, 'просмотры чужих статей не запрашивались');
  const f2 = mkFetch([[/list=search/, () => ({ status: 200, body: { query: { search: [{ title: 'Гомеопатия' }] } } })], [/per-article/, () => views([['2026-10-26', 99]])]]);
  const r2 = await D.wikiMeasure(null, ['гомеопатия работает'], { fetch: f2, now: NOW }); assert.equal(r2.ok, true); assert.equal(r2.how, 'поиск по Википедии');
  const f3 = mkFetch([[/list=search/, () => ({ status: 200, body: { query: { search: [{ title: 'Электронная сигарета' }, { title: 'Сигарета' }] } } })], [/per-article/, (u) => views([['2026-10-26', /%D0%AD/.test(u) ? 7000 : 300]])]]);
  const r3 = await D.wikiMeasure(null, ['лёгкие сигареты вред'], { fetch: f3, now: NOW }); assert.equal(r3.ok, false, 'первый результат с лишними словами в названии («Электронная сигарета») не годится, а второстепенные не берём');
  const f4 = mkFetch([[/list=search/, () => ({ status: 200, body: { query: { search: [{ title: 'Эффект Моцарта' }, { title: 'Ребёнок' }] } } })], [/per-article/, () => views([['2026-10-26', 99]])]]);
  assert.equal((await D.wikiMeasure(null, ['слушать моцарта станешь умнее ребёнок'], { fetch: f4, now: NOW })).ok, false, 'общее слово запроса («ребёнок») не даёт чужую статью');
});

const RSS = `<?xml version="1.0"?><rss><channel><item><title>семаглутид</title><ht:approx_traffic>100+</ht:approx_traffic></item><item><title><![CDATA[ноябрь]]></title><ht:approx_traffic>2000+</ht:approx_traffic></item></channel></rss>`;
test('Google Trends: разбор ленты и совпадение с темой по словам', async () => {
  const r = await D.trendsNow({ fetch: mkFetch([[/trending\/rss/, () => ({ status: 200, body: RSS })]]) });
  assert.equal(r.ok, true); assert.deepEqual(r.items.map((i) => i.title), ['семаглутид', 'ноябрь']); assert.equal(r.items[1].traffic, '2000+');
  assert.deepEqual(D.trendsMatch(['семаглутид для похудения'], r.items).map((i) => i.title), ['семаглутид']);
  assert.deepEqual(D.trendsMatch(['гомеопатия работает'], r.items), []);
  assert.deepEqual(D.trendsMatch(['10000 шагов'], r.items), [], 'числа совпадением не считаются');
  assert.equal((await D.trendsNow({ fetch: mkFetch([[/trending\/rss/, () => ({ status: 200, body: '<rss/>' })]]) })).ok, false, 'пустая лента = не измерено');
});

test('подсказки: до 10 на поисковик, упавший поисковик пропускается, все упали = null', async () => {
  const arr = (n) => ['q', Array.from({ length: n }, (_, i) => 'x' + i)];
  const f = mkFetch([[/ds=yt/, () => ({ status: 200, body: arr(13) })], [/suggestqueries/, () => ({ status: 200, body: arr(4) })], [/suggest\.yandex/, () => ({ status: 500, body: '' })]]);
  assert.deepEqual(await D.suggestCounts(['гомеопатия'], { fetch: f }), { google: 4, youtube: 10 });
  assert.equal(await D.suggestCounts(['а'], { fetch: mkFetch([]) }), null);
});

const KEYS = { yandexApiKey: 'YKEY-test-123', yandexFolderId: 'b1gFOLDER', youtubeApiKey: 'ytkey-TEST-456' };
test('Вордстат: без ключа сеть не вызывается; с ключом запрос по документации', async () => {
  const f0 = mkFetch([]); const r0 = await D.wordstatCount('сон', { fetch: f0, keys: { ...KEYS, yandexApiKey: '' } }); assert.equal(r0.error, 'нет ключа'); assert.equal(f0.calls.length, 0);
  const f = mkFetch([[/wordstat\/topRequests/, () => ({ status: 200, body: { totalCount: '12400', results: [{ phrase: 'сон', count: '12400' }] } })]]);
  const r = await D.wordstatCount('сон', { fetch: f, keys: KEYS }); assert.deepEqual([r.ok, r.count], [true, 12400]);
  const c = f.calls[0]; assert.equal(c.init.method, 'POST'); assert.equal(c.init.headers.Authorization, 'Api-Key YKEY-test-123');
  assert.deepEqual(JSON.parse(c.init.body), { phrase: 'сон', numPhrases: 5, devices: ['DEVICE_ALL'], folderId: 'b1gFOLDER' });
});
test('YouTube: поиск за 30 дней и медиана просмотров; пусто = 0 роликов; без ключа сеть не вызывается', async () => {
  const f0 = mkFetch([]); assert.equal((await D.youtubeStats('сон', { fetch: f0, keys: { ...KEYS, youtubeApiKey: '' }, now: NOW })).error, 'нет ключа'); assert.equal(f0.calls.length, 0);
  const f = mkFetch([[/youtube\/v3\/search/, () => ({ status: 200, body: { items: [{ id: { videoId: 'a' } }, { id: { videoId: 'b' } }, { id: { videoId: 'c' } }] } })], [/youtube\/v3\/videos/, () => ({ status: 200, body: { items: [{ statistics: { viewCount: '100' } }, { statistics: { viewCount: '5000' } }, { statistics: { viewCount: '900' } }] } })]]);
  const r = await D.youtubeStats('сон', { fetch: f, keys: KEYS, now: NOW }); assert.deepEqual([r.ok, r.n, r.median, r.max], [true, 3, 900, 5000]);
  assert.match(f.calls[0].url, /publishedAfter=2026-09-27T12/); assert.match(f.calls[0].url, /order=viewCount/);
  const e = await D.youtubeStats('сон', { fetch: mkFetch([[/search/, () => ({ status: 200, body: { items: [] } })]]), keys: KEYS, now: NOW }); assert.deepEqual([e.ok, e.n], [true, 0]);
});

test('оценка: без замеров охват 0 и уровень none; один источник не даёт полный балл; рост просмотров повышает охват', () => {
  assert.deepEqual([D.scoreRaw({}).reach, D.scoreRaw({}).level], [0, 'none']);
  const only = D.scoreRaw({ suggest: { google: 10, youtube: 10, yandex: 10 } }); assert.equal(only.level, 'partial'); assert.ok(only.reach < 12, 'одни подсказки: ' + only.reach);
  const lo = D.scoreRaw({ wiki: { last30: 127 }, suggest: { google: 8 } }), hi = D.scoreRaw({ wiki: { last30: 6808 }, suggest: { google: 8 } });
  assert.equal(lo.level, 'measured'); assert.ok(hi.reach > lo.reach + 5, `${lo.reach} → ${hi.reach}`);
  const top = D.scoreRaw({ wiki: { last30: 50000 }, suggest: { google: 10, youtube: 10, yandex: 10 } }); assert.equal(top.reach, 25);
  const keyed = D.scoreRaw({ wiki: { last30: 6808 }, suggest: { google: 8 }, wordstat: { count: 400000 }, youtube: { median: 200000 } }); assert.ok(keyed.reach > hi.reach);
  const tr = D.scoreRaw({ wiki: { last30: 6808 }, suggest: { google: 8 }, trends: { matched: [{ title: 'x' }] } }); assert.ok(tr.reach > hi.reach, 'тренд даёт надбавку');
  assert.ok(D.scoreRaw({ trends: { matched: [{ title: 'x' }] } }).reach > 0 && D.scoreRaw({ trends: { matched: [{ title: 'x' }] } }).reach < 5, 'один тренд без других замеров = минимум');
});
test('строка карточки: числа, динамика, честное «не измерено»; фразы «спрос не проверялся» нет', async () => {
  const d = await D.measureDemand({ title: 'Гомеопатия работает?', queries: ['гомеопатия'] }, { fetch: mkFetch([[/per-article/, () => views([['2026-09-26', 100], ['2026-10-26', 80]])], [/list=search/, () => ({ status: 200, body: { query: { search: [{ title: 'Гомеопатия' }] } } })], [/suggest/, () => ({ status: 200, body: ['q', ['a', 'b']] })]]), keys: {}, now: NOW });
  assert.match(d.line, /Википедия «Гомеопатия»: 80 просмотров за 30 дн \(−20\u00a0% к прошлым 30\)/); assert.match(d.line, /подсказки поиска: 6 из 30/); assert.match(d.line, /Охват по замерам \d+ из 25/); assert.match(d.line, /Яндекс и YouTube: ключ не подключён/);
  const none = await D.measureDemand({ title: 'Что-то', queries: ['что-то'] }, { fetch: mkFetch([]), keys: {}, now: NOW });
  assert.equal(none.level, 'none'); assert.equal(none.reach, 0); assert.match(none.line, /не измерено/); assert.doesNotMatch(none.line, /не проверялся/);
  assert.match(D.demandLine(null), /не измерено/);
  const auto = await D.measureDemand({ title: 'Правда ли, что гомеопатия работает?' }, { fetch: mkFetch([[/per-article/, () => views([['2026-10-26', 80]])], [/list=search/, () => ({ status: 200, body: { query: { search: [{ title: 'Гомеопатия' }] } } })]]), keys: {}, now: NOW });
  assert.equal(auto.queries_auto, true); assert.match(auto.line, /Формулировки запроса подобраны автоматически/);
  const own = await D.measureDemand({ title: 'Т', queries: ['гомеопатия'] }, { fetch: mkFetch([[/per-article/, () => views([['2026-10-26', 80]])], [/list=search/, () => ({ status: 200, body: { query: { search: [{ title: 'Гомеопатия' }] } } })]]), keys: {}, now: NOW });
  assert.doesNotMatch(own.line, /автоматически/);
});
test('замер не бросает исключений при любом сбое сети и не пропускает ключи в результат', async () => {
  const boom = async () => { throw new Error('ECONNRESET https://x/?key=ytkey-TEST-456'); };
  const d = await D.measureDemand({ title: 'Тема', queries: ['тема'] }, { fetch: boom, keys: KEYS, now: NOW });
  assert.equal(d.level, 'none'); assert.equal(d.reach, 0);
  const ok = await D.measureDemand({ title: 'Тема', queries: ['тема'] }, { fetch: mkFetch([[/wordstat/, () => ({ status: 200, body: { totalCount: '5000' } })], [/youtube\/v3\/search/, () => ({ status: 403, body: 'quota key=ytkey-TEST-456' })]]), keys: KEYS, now: NOW });
  const dump = JSON.stringify([d, ok]); for (const k of Object.values(KEYS)) assert.ok(!dump.includes(k), 'ключ попал в результат: ' + k);
  assert.equal(ok.wordstat.count, 5000); assert.equal(ok.errors.youtube, 'HTTP 403');
  assert.deepEqual(D.readKeys(), { yandexApiKey: '', yandexFolderId: '', youtubeApiKey: '' }, 'тест не читает боевой файл ключей');
});
test('OFFICE_NO_DEMAND=1: сеть не вызывается, тема помечена как не измеренная', async () => {
  process.env.OFFICE_NO_DEMAND = '1'; try { const f = mkFetch([]); const d = await D.measureDemand({ title: 'Т', queries: ['т'] }, { fetch: f }); assert.equal(f.calls.length, 0); assert.equal(d.level, 'none'); const all = await D.measureAll([{ title: 'А' }, { title: 'Б' }], { fetch: f }); assert.equal(all.length, 2); assert.equal(f.calls.length, 0); } finally { delete process.env.OFFICE_NO_DEMAND; }
});
test('запасные формулировки запроса из названия, если Виктор их не дал', () => {
  assert.deepEqual(D.fallbackQueries('Правда ли, что, качая пресс, можно убрать жир с живота (локальное сжигание жира)?'), ['качая пресс убрать жир живота', 'локальное сжигание жира']);
  assert.deepEqual(D.fallbackQueries('Правда ли, что полнолуние влияет на психику и поведение людей?'), ['полнолуние влияет психику поведение людей']);
  assert.deepEqual(D.cleanQueries({ title: 'x', queries: [' а ', '', 'б', 'в', 'г'] }), ['а', 'б', 'в']);
  assert.deepEqual(D.cleanQueries({ title: '' }), []);
});
test('подмена охвата Льва замером: итог пересчитан, строки пересортированы, без замера охват 0', () => {
  const rows = [{ title: 'А тема про сон', scores: { reach: 20, plot: 5 }, total: 80 }, { title: 'Б тема про воду', scores: { reach: 5, plot: 5 }, total: 60 }, { title: 'В тема без замера', scores: { reach: 25 }, total: 90 }];
  const demands = [{ reach: 3, line: 'a' }, { reach: 25, line: 'b' }, null];
  const out = D.applyDemand(rows, D.demandLookup(rows, demands));
  assert.deepEqual(out.map((r) => [r.title[0], r.total, r.scores.reach, r.reach_lev]), [['Б', 80, 25, 5], ['А', 63, 3, 20], ['В', 65, 0, 25]].sort((a, b) => b[1] - a[1]));
  assert.equal(out.find((r) => r.title[0] === 'В').demand_line, 'Спрос: не измерено.');
  const near = D.demandLookup([{ title: 'Нужно ли пить два литра воды в день?' }], [{ reach: 7 }])('Нужно ли пить 2 литра воды в день'); assert.ok(near === null || near.reach === 7);
  assert.equal(D.applyDemand([{ title: 'Х', scores: { reach: 10 }, total: 120 }], () => ({ reach: 25, line: '' }))[0].total, 100, 'итог не выше 100');
});

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

const KEYS = { youtubeApiKey: 'ytkey-TEST-456' };
const iso = (sec) => `PT${Math.floor(sec / 60) ? Math.floor(sec / 60) + 'M' : ''}${sec % 60}S`;
test('YouTube: поиск за год, две формулировки, только ролики до 60 с; медиана, максимум, хиты; без ключа сеть не вызывается', async () => {
  const f0 = mkFetch([]); assert.equal((await D.youtubeStats('сон', { fetch: f0, keys: { youtubeApiKey: '' }, now: NOW })).error, 'нет ключа'); assert.equal(f0.calls.length, 0);
  const item = (id) => ({ id: { videoId: id } });
  const f = mkFetch([
    [/youtube\/v3\/search.*q=%D1%81%D0%BE%D0%BD%20%D0%B3%D0%BB%D1%83%D0%B1%D0%BE%D0%BA%D0%B8%D0%B9&/, () => ({ status: 200, body: { items: [item('a'), item('b'), item('c')] } })],
    [/youtube\/v3\/search/, () => ({ status: 200, body: { items: [item('c'), item('d'), item('e')] } })],       // c повторяется, считается один раз
    [/youtube\/v3\/videos/, () => ({ status: 200, body: { items: [
      { statistics: { viewCount: '100' }, contentDetails: { duration: iso(30) } }, { statistics: { viewCount: '5000' }, contentDetails: { duration: iso(59) } },
      { statistics: { viewCount: '900' }, contentDetails: { duration: iso(60) } }, { statistics: { viewCount: '250000' }, contentDetails: { duration: iso(61) } },     // 61 с не Shorts нашего формата
      { statistics: { viewCount: '9000000' }, contentDetails: { duration: 'PT3M10S' } }] } })]]);
  const r = await D.youtubeStats(['сон глубокий', 'бессонница ночью'], { fetch: f, keys: KEYS, now: NOW });
  assert.deepEqual([r.ok, r.n, r.median, r.max, r.hits], [true, 3, 900, 5000, 0]);
  const searches = f.calls.filter((c) => /v3\/search/.test(c.url)); assert.equal(searches.length, 2, 'по одному поиску на формулировку');
  assert.match(searches[0].url, /publishedAfter=2025-10-27T12/); assert.match(searches[0].url, /order=viewCount/); assert.match(searches[0].url, /maxResults=50/);
  assert.equal(f.calls.filter((c) => /v3\/videos/.test(c.url)).length, 1, 'пять уникальных роликов = один запрос статистики');
  assert.deepEqual((await D.youtubeStats('сон', { fetch: f, keys: KEYS, now: NOW })).ok, true);
  const third = await D.youtubeStats(['а б', 'б в', 'в г'], { fetch: mkFetch([[/search/, () => ({ status: 200, body: { items: [] } })]]), keys: KEYS, now: NOW }); assert.deepEqual([third.ok, third.n], [true, 0]);
  const e = await D.youtubeStats('сон', { fetch: mkFetch([[/search/, () => ({ status: 200, body: { items: [] } })]]), keys: KEYS, now: NOW }); assert.deepEqual([e.ok, e.n], [true, 0]);
  const hit = await D.youtubeStats('сон', { fetch: mkFetch([[/search/, () => ({ status: 200, body: { items: [item('a'), item('b')] } })], [/videos/, () => ({ status: 200, body: { items: [{ statistics: { viewCount: '100000' }, contentDetails: { duration: iso(40) } }, { statistics: { viewCount: '2000000' }, contentDetails: { duration: iso(45) } }] } })]]), keys: KEYS, now: NOW });
  assert.deepEqual([hit.n, hit.hits, hit.max], [2, 2, 2000000], 'хит = от 100 тысяч включительно');
});
test('YouTube: однословные формулировки отбрасываются (они вытаскивают популярное не по теме); если других нет, ищем по первой', async () => {
  const f = mkFetch([[/v3\/search/, () => ({ status: 200, body: { items: [] } })]]);
  await D.youtubeStats(['ребёнок', 'слушать моцарта', 'плацебо'], { fetch: f, keys: KEYS, now: NOW });
  assert.equal(f.calls.length, 1); assert.match(decodeURIComponent(f.calls[0].url), /q=слушать моцарта&/);
  const g = mkFetch([[/v3\/search/, () => ({ status: 200, body: { items: [] } })]]);
  await D.youtubeStats(['гомеопатия', 'плацебо'], { fetch: g, keys: KEYS, now: NOW });
  assert.equal(g.calls.length, 1); assert.match(decodeURIComponent(g.calls[0].url), /q=гомеопатия&/);
});
test('YouTube: сбой одной формулировки не мешает другой; сбой всех и квота дают понятную ошибку без ключа', async () => {
  const one = await D.youtubeStats(['а б', 'в г'], { fetch: mkFetch([[/q=%D0%B0%20%D0%B1&/, () => ({ status: 500, body: '' })], [/v3\/search/, () => ({ status: 200, body: { items: [{ id: { videoId: 'x' } }] } })], [/videos/, () => ({ status: 200, body: { items: [{ statistics: { viewCount: '70' }, contentDetails: { duration: 'PT20S' } }] } })]]), keys: KEYS, now: NOW, });
  assert.deepEqual([one.ok, one.n, one.median], [true, 1, 70]);
  const quota = await D.youtubeStats('сон', { fetch: mkFetch([[/search/, () => ({ status: 403, body: 'quotaExceeded key=ytkey-TEST-456' })]]), keys: KEYS, now: NOW });
  assert.equal(quota.ok, false); assert.match(quota.error, /403.*лимит/); assert.doesNotMatch(JSON.stringify(quota), /ytkey/);
  assert.match((await D.youtubeStats('сон', { fetch: mkFetch([[/search/, () => ({ status: 400, body: '' })]]), keys: KEYS, now: NOW })).error, /400.*ключ не принят/);
});

test('оценка: без замеров охват 0 и уровень none; один источник не даёт полный балл; рост просмотров повышает охват', () => {
  assert.deepEqual([D.scoreRaw({}).reach, D.scoreRaw({}).level], [0, 'none']);
  const only = D.scoreRaw({ suggest: { google: 10, youtube: 10, yandex: 10 } }); assert.equal(only.level, 'partial'); assert.ok(only.reach < 12, 'одни подсказки: ' + only.reach);
  const lo = D.scoreRaw({ wiki: { last30: 127 }, suggest: { google: 8 } }), hi = D.scoreRaw({ wiki: { last30: 6808 }, suggest: { google: 8 } });
  assert.equal(lo.level, 'measured'); assert.ok(hi.reach > lo.reach + 3, `${lo.reach} → ${hi.reach}`);      // без YouTube шкала сжата до 10 баллов
  const noYt = D.scoreRaw({ wiki: { last30: 50000 }, suggest: { google: 10, youtube: 10, yandex: 10 } }); assert.equal(noYt.reach, 10, 'без YouTube потолок 10 из 25: главный источник отсутствует');
  const top = D.scoreRaw({ wiki: { last30: 50000 }, suggest: { google: 10, youtube: 10, yandex: 10 }, youtube: { n: 40, median: 1000000, max: 10000000, hits: 30 } }); assert.equal(top.reach, 25);
  const keyed = D.scoreRaw({ wiki: { last30: 6808 }, suggest: { google: 8 }, youtube: { n: 30, median: 200000, max: 3000000, hits: 12 } }); assert.ok(keyed.reach > hi.reach);
  const yt = (o) => D.scoreRaw({ wiki: { last30: 6808 }, suggest: { google: 8 }, youtube: o }).reach;
  assert.ok(yt({ n: 30, median: 200000, max: 3000000 }) > yt({ n: 30, median: 2000, max: 40000 }), 'тема, где Shorts смотрят чаще, получает больше');
  assert.ok(yt({ n: 30, median: 1200, max: 10000000 }) > yt({ n: 30, median: 1200, max: 20000 }), 'один взрывной ролик тоже учитывается, но слабее медианы');
  assert.ok(yt({ n: 0, median: 0, max: 0 }) < yt({ n: 3, median: 5000, max: 9000 }), 'нет ни одного Shorts по теме = самый низкий балл YouTube');
  const tr = D.scoreRaw({ wiki: { last30: 6808 }, suggest: { google: 8 }, trends: { matched: [{ title: 'x' }] } }); assert.ok(tr.reach > hi.reach, 'тренд даёт надбавку');
  assert.ok(D.scoreRaw({ trends: { matched: [{ title: 'x' }] } }).reach > 0 && D.scoreRaw({ trends: { matched: [{ title: 'x' }] } }).reach < 5, 'один тренд без других замеров = минимум');
});
test('строка карточки: числа, динамика, честное «не измерено»; фразы «спрос не проверялся» нет', async () => {
  const d = await D.measureDemand({ title: 'Гомеопатия работает?', queries: ['гомеопатия'] }, { fetch: mkFetch([[/per-article/, () => views([['2026-09-26', 100], ['2026-10-26', 80]])], [/list=search/, () => ({ status: 200, body: { query: { search: [{ title: 'Гомеопатия' }] } } })], [/suggest/, () => ({ status: 200, body: ['q', ['a', 'b']] })]]), keys: {}, now: NOW });
  assert.match(d.line, /Википедия «Гомеопатия»: 80 просмотров за 30 дн \(−20\u00a0% к прошлым 30\)/); assert.match(d.line, /подсказки поиска: 6 из 30/); assert.match(d.line, /Охват по замерам \d+ из 25/); assert.match(d.line, /\(YouTube: ключ не подключён\)/); assert.doesNotMatch(d.line, /Яндекс/);
  const none = await D.measureDemand({ title: 'Что-то', queries: ['что-то'] }, { fetch: mkFetch([]), keys: {}, now: NOW });
  assert.equal(none.level, 'none'); assert.equal(none.reach, 0); assert.match(none.line, /не измерено/); assert.doesNotMatch(none.line, /не проверялся/);
  assert.match(D.demandLine(null), /не измерено/);
  const auto = await D.measureDemand({ title: 'Правда ли, что гомеопатия работает?' }, { fetch: mkFetch([[/per-article/, () => views([['2026-10-26', 80]])], [/list=search/, () => ({ status: 200, body: { query: { search: [{ title: 'Гомеопатия' }] } } })]]), keys: {}, now: NOW });
  assert.equal(auto.queries_auto, true); assert.match(auto.line, /Формулировки запроса подобраны автоматически/);
  const own = await D.measureDemand({ title: 'Т', queries: ['гомеопатия'] }, { fetch: mkFetch([[/per-article/, () => views([['2026-10-26', 80]])], [/list=search/, () => ({ status: 200, body: { query: { search: [{ title: 'Гомеопатия' }] } } })]]), keys: {}, now: NOW });
  assert.doesNotMatch(own.line, /автоматически/);
});
test('строка карточки с YouTube: число роликов, медиана, лучший, хиты', async () => {
  const f = mkFetch([[/v3\/search/, () => ({ status: 200, body: { items: [{ id: { videoId: 'a' } }, { id: { videoId: 'b' } }] } })], [/v3\/videos/, () => ({ status: 200, body: { items: [{ statistics: { viewCount: '3000' }, contentDetails: { duration: 'PT30S' } }, { statistics: { viewCount: '450000' }, contentDetails: { duration: 'PT44S' } }] } })]]);
  const d = await D.measureDemand({ title: 'Тема', queries: ['тема'] }, { fetch: f, keys: KEYS, now: NOW });
  assert.match(d.line, /YouTube Shorts за год: 2 роликов до 60 с в топе по запросу, медиана 226.500 просмотров, лучший 450.000, от 100.тыс.: 1/); assert.doesNotMatch(d.line, /ключ не подключён/);
  assert.equal(d.youtube.hits, 1);
});
test('замер не бросает исключений при любом сбое сети и не пропускает ключи в результат', async () => {
  const boom = async () => { throw new Error('ECONNRESET https://x/?key=ytkey-TEST-456'); };
  const d = await D.measureDemand({ title: 'Тема', queries: ['тема'] }, { fetch: boom, keys: KEYS, now: NOW });
  assert.equal(d.level, 'none'); assert.equal(d.reach, 0);
  const ok = await D.measureDemand({ title: 'Тема', queries: ['тема'] }, { fetch: mkFetch([[/youtube\/v3\/search/, () => ({ status: 403, body: 'quota key=ytkey-TEST-456' })]]), keys: KEYS, now: NOW });
  const dump = JSON.stringify([d, ok]); for (const k of Object.values(KEYS)) assert.ok(!dump.includes(k), 'ключ попал в результат: ' + k);
  assert.match(ok.errors.youtube, /^HTTP 403/); assert.equal(ok.youtube, null);
  assert.deepEqual(D.readKeys(), { youtubeApiKey: '' }, 'тест не читает боевой файл ключей');
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

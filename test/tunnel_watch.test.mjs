import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decide, check, miniAppUrl } from '../scripts/tunnel_watch.mjs';

const base = { now: 1_000_000, apiLocalOk: true, startedAt: 0, lastRestartAt: 0, readyConnections: 1, deadReadyCount: 0, noReadyCount: 0, outsideFails: 0 };

test('здоровый туннель не трогаем', () => assert.equal(decide(base).act, 'ok'));
test('одна и две неудачи снаружи — ждём (моргнула сеть), на третьей — перезапуск', () => {
  assert.equal(decide({ ...base, outsideFails: 1 }).act, 'ok'); assert.equal(decide({ ...base, outsideFails: 2 }).act, 'ok');
  assert.equal(decide({ ...base, outsideFails: 3 }).act, 'restart');
});
test('0 соединений дважды подряд — перезапуск, один раз — нет', () => {
  assert.equal(decide({ ...base, readyConnections: 0, deadReadyCount: 1 }).act, 'ok');
  assert.equal(decide({ ...base, readyConnections: 0, deadReadyCount: 2 }).act, 'restart');
});
test('cloudflared завис (не отвечает на /ready) дважды — перезапуск', () => {
  assert.equal(decide({ ...base, readyConnections: null, noReadyCount: 2 }).act, 'restart');
});
test('если не отвечает сам локальный API — туннель не трогаем (ни при чём)', () => {
  assert.equal(decide({ ...base, apiLocalOk: false, outsideFails: 9, readyConnections: 0, deadReadyCount: 9 }).act, 'wait');
});
test('сразу после старта и сразу после перезапуска туннель не дёргаем (иначе адрес будет меняться по кругу)', () => {
  assert.equal(decide({ ...base, startedAt: base.now - 30_000, outsideFails: 9 }).act, 'wait');
  assert.equal(decide({ ...base, lastRestartAt: base.now - 60_000, outsideFails: 9 }).act, 'wait');
  assert.equal(decide({ ...base, lastRestartAt: base.now - 130_000, outsideFails: 9 }).act, 'restart');
});
test('check(): серия неудач снаружи накапливается и сбрасывается первой удачей', async () => {
  let up = false; const io = { now: () => 1_000_000, localOk: async () => true, ready: async () => 1, outsideOk: async () => up };
  let s = { url: 'https://x.trycloudflare.com', startedAt: 0, lastRestartAt: 0 }, d;
  for (let i = 0; i < 3; i++) ({ state: s, decision: d } = await check(s, io));
  assert.equal(s.outsideFails, 3); assert.equal(d.act, 'restart');
  up = true; ({ state: s, decision: d } = await check(s, io)); assert.equal(s.outsideFails, 0); assert.equal(d.act, 'ok');
});
test('check(): когда cloudflared говорит «0 соединений», внешний адрес не опрашиваем зря, счётчик растёт', async () => {
  let asked = 0; const io = { now: () => 1_000_000, localOk: async () => true, ready: async () => 0, outsideOk: async () => { asked++; return false; } };
  let s = { url: 'https://x.trycloudflare.com', startedAt: 0, lastRestartAt: 0 }, d;
  ({ state: s } = await check(s, io)); ({ state: s, decision: d } = await check(s, io));
  assert.equal(asked, 0); assert.equal(d.act, 'restart');
});
test('адрес Mini App: ссылка постоянная, меняется только параметр api, кодируется целиком', () => {
  const u = miniAppUrl('https://a-b-c.trycloudflare.com');
  assert.ok(u.startsWith('https://inversion322.github.io/ai-office/app.html?api=')); assert.equal(new URL(u).searchParams.get('api'), 'https://a-b-c.trycloudflare.com');
});

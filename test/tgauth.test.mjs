import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { signInitData, verifyInitData, makeSessions } from '../server/lib_tgauth.mjs';

const BOT = '123456:TEST-token-not-real';
const mk = (over = {}, token = BOT) => {
  const p = { auth_date: String(Math.floor(Date.now() / 1000) - 10), query_id: 'AAH', user: JSON.stringify({ id: 323028999, first_name: 'Ник' }), ...over };
  return new URLSearchParams({ ...p, hash: signInitData(p, token) }).toString();
};

test('настоящая подпись Telegram принимается и отдаёт id пользователя', () => {
  const r = verifyInitData(mk(), BOT); assert.equal(r.ok, true); assert.equal(r.userId, 323028999);
});
test('подпись, сделанная чужим токеном, отклоняется', () => assert.equal(verifyInitData(mk({}, '999:other'), BOT).ok, false));
test('подмена любого поля ломает подпись (id пользователя меняют на чужой)', () => {
  const sp = new URLSearchParams(mk()); sp.set('user', JSON.stringify({ id: 1, first_name: 'X' }));
  const r = verifyInitData(sp.toString(), BOT); assert.equal(r.ok, false); assert.equal(r.reason, 'подпись не сошлась');
});
test('старая подпись (старше суток) и дата из будущего отклоняются', () => {
  assert.equal(verifyInitData(mk({ auth_date: String(Math.floor(Date.now() / 1000) - 90000) }), BOT).reason, 'подпись устарела');
  assert.equal(verifyInitData(mk({ auth_date: String(Math.floor(Date.now() / 1000) + 3600) }), BOT).reason, 'дата из будущего');
});
test('мусор, пустота, отсутствие подписи или токена не роняют и не пропускают', () => {
  for (const x of ['', null, undefined, 'abc', 'hash=zz', 'auth_date=1&user={}', 'x'.repeat(5000)]) assert.equal(verifyInitData(x, BOT).ok, false);
  assert.equal(verifyInitData(mk(), '').ok, false);
});
test('подпись считается тем же алгоритмом, что описан Telegram (независимая сверка на crypto)', () => {
  const params = { auth_date: '1700000000', query_id: 'Q', user: '{"id":5}' };
  const check = 'auth_date=1700000000\nquery_id=Q\nuser={"id":5}';
  const secret = crypto.createHmac('sha256', 'WebAppData').update(BOT).digest();
  assert.equal(signInitData(params, BOT), crypto.createHmac('sha256', secret).update(check).digest('hex'));
});
test('сессии: выдаются, проверяются и истекают', () => {
  let t = 1000; const s = makeSessions({ ttlMs: 500, now: () => t });
  const tok = s.issue(7); assert.equal(s.check(tok).userId, 7); assert.equal(s.check('нет'), null);
  t += 600; assert.equal(s.check(tok), null); assert.equal(s.size(), 0);
});

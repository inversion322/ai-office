// Вход в Telegram Mini App: сервер проверяет подпись initData, которую подписывает сам Telegram токеном бота.
// Токен руками вводить не нужно, а подделать подпись без токена бота нельзя. Доступ получает только владелец (OWNER).
// Схема (core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app):
//   secret = HMAC_SHA256(key="WebAppData", msg=bot_token); hash = HMAC_SHA256(key=secret, msg=data_check_string)
//   data_check_string = пары key=value (кроме hash), отсортированные по ключу, через \n; значения уже раскодированы.
import crypto from 'node:crypto';

export const MAX_AGE_SEC = 24 * 3600;      // подпись действует сутки; свежие данные Telegram выдаёт при каждом открытии

export function signInitData(params, botToken) {         // нужна тестам и проверке; в бою подписывает Telegram
  const check = Object.entries(params).filter(([k]) => k !== 'hash').sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  return crypto.createHmac('sha256', secret).update(check).digest('hex');
}

// Возвращает { ok:true, userId, authDate } или { ok:false, reason }.
export function verifyInitData(initData, botToken, { now = Date.now(), maxAgeSec = MAX_AGE_SEC } = {}) {
  if (!initData || typeof initData !== 'string' || initData.length > 4096) return { ok: false, reason: 'пусто' };
  if (!botToken) return { ok: false, reason: 'нет токена бота' };
  let sp; try { sp = new URLSearchParams(initData); } catch { return { ok: false, reason: 'формат' }; }
  const given = sp.get('hash'); if (!given || !/^[0-9a-f]{64}$/i.test(given)) return { ok: false, reason: 'нет подписи' };
  const params = Object.fromEntries([...sp.entries()].filter(([k]) => k !== 'hash'));
  const want = signInitData(params, botToken);
  const a = Buffer.from(given.toLowerCase(), 'hex'), b = Buffer.from(want, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false, reason: 'подпись не сошлась' };
  const authDate = Number(params.auth_date);
  if (!Number.isFinite(authDate)) return { ok: false, reason: 'нет даты' };
  const age = now / 1000 - authDate;
  if (age > maxAgeSec) return { ok: false, reason: 'подпись устарела' };
  if (age < -300) return { ok: false, reason: 'дата из будущего' };
  let user; try { user = JSON.parse(params.user || '{}'); } catch { return { ok: false, reason: 'user' }; }
  if (!user.id) return { ok: false, reason: 'нет пользователя' };
  return { ok: true, userId: user.id, authDate, user };
}

// Короткоживущий токен сессии: Mini App обменивает подпись на него один раз, дальше ходит с ним (не пересылает initData в каждом запросе).
export function makeSessions({ ttlMs = 12 * 3600 * 1000, now = () => Date.now() } = {}) {
  const map = new Map();
  return {
    issue(userId) { const t = crypto.randomBytes(24).toString('base64url'); map.set(t, { userId, exp: now() + ttlMs }); return t; },
    check(t) { const s = map.get(t); if (!s) return null; if (s.exp < now()) { map.delete(t); return null; } return s; },
    size: () => map.size,
  };
}

// Следит за туннелем и обновляет кнопку Mini App в боте, когда адрес меняется.
// Принцип: не менять адрес по расписанию (плановая смена только создаёт окна недоступности), а чинить по факту.
// Решение о перезапуске принимает чистая функция decide() по накопленным проверкам, поэтому её можно проверить без настоящего cloudflared.

export const MINIAPP_PAGE = 'https://inversion322.github.io/ai-office/app.html';
export const miniAppUrl = (api) => `${MINIAPP_PAGE}?api=${encodeURIComponent(api)}`;

// Состояние проверок. Зависшим считаем туннель, если ИЗНУТРИ всё живо (api отвечает), а СНАРУЖИ адрес не отвечает N проверок подряд
// (одна неудача — это сеть/DNS/Cloudflare моргнули, перезапуск из-за неё сменил бы адрес зря).
export function decide(s, { outsideFailsToRestart = 3, deadReadyChecks = 2, graceMs = 90_000, minGapMs = 120_000 } = {}) {
  const now = s.now;
  if (!s.apiLocalOk) return { act: 'wait', why: 'локальный API не отвечает: туннель тут ни при чём, его поднимет супервизор' };
  if (s.startedAt && now - s.startedAt < graceMs) return { act: 'wait', why: 'туннель только поднялся' };
  if (s.lastRestartAt && now - s.lastRestartAt < minGapMs) return { act: 'wait', why: 'недавно перезапускали, не дёргаем чаще раза в 2 минуты' };
  if (s.readyConnections === 0 && s.deadReadyCount >= deadReadyChecks) return { act: 'restart', why: 'cloudflared сообщает 0 соединений' };
  if (s.readyConnections == null && s.noReadyCount >= deadReadyChecks) return { act: 'restart', why: 'cloudflared не отвечает на /ready, процесс завис' };
  if (s.outsideFails >= outsideFailsToRestart) return { act: 'restart', why: `адрес снаружи не отвечает ${s.outsideFails} проверки подряд` };
  return { act: 'ok', why: 'всё в порядке' };
}

// Один тик проверки: возвращает обновлённое состояние и решение. io — подставляемые функции (в тестах подменяются).
export async function check(s, io, opts) {
  const n = { ...s, now: io.now() };
  n.apiLocalOk = await io.localOk();
  const ready = await io.ready();                       // число соединений или null, если не ответил
  n.readyConnections = ready;
  n.deadReadyCount = ready === 0 ? (s.deadReadyCount || 0) + 1 : 0;
  n.noReadyCount = ready == null ? (s.noReadyCount || 0) + 1 : 0;
  if (n.apiLocalOk && n.url && (ready == null || ready > 0)) n.outsideFails = (await io.outsideOk(n.url)) ? 0 : (s.outsideFails || 0) + 1;
  else if (!n.url) n.outsideFails = 0;
  const d = decide(n, opts);
  return { state: n, decision: d };
}

/** Адрес быстрого туннеля из строки вывода cloudflared или null. Без сети cloudflared пишет `failed to request quick Tunnel: Post "https://api.trycloudflare.com/tunnel": dial tcp: lookup api.trycloudflare.com ...`,
 *  и прежняя регулярка принимала служебный api.trycloudflare.com за адрес туннеля: tunnel-url.txt и кнопка Mini App указывали на него, а приложение «зависало» (так было 2026-10-27 после часа без сети).
 *  Настоящий адрес печатается в баннере (`Your quick Tunnel has been created! Visit it at ...` и следующая строка с рамкой), поэтому строки с ошибкой и служебные имена отбрасываются. */
export const RESERVED_HOSTS = new Set(['api', 'www', 'dash', 'dashboard', 'update', 'quick', 'trycloudflare']);
export function parseTunnelUrl(line) {
  const s = String(line || '');
  if (/failed to|error|ERR\b|dial tcp|lookup |no such host|connection refused|timeout|context deadline|provisioning failed/i.test(s)) return null;
  const m = s.match(/https:\/\/([a-z0-9]+(?:-[a-z0-9]+)+)\.trycloudflare\.com(?![a-z0-9.-])/i);      // у настоящих адресов минимум два слова через дефис
  if (!m || RESERVED_HOSTS.has(m[1].toLowerCase())) return null;
  return m[0].toLowerCase();
}

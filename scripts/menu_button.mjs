// Кнопка меню бота SMM, открывающая Mini App. Вызывается при каждой смене адреса туннеля: Telegram принимает новую ссылку сразу,
// ни git, ни деплой Pages не нужны. Токен бота читается из server/data/config.json и никуда не печатается.
import fs from 'node:fs';
import path from 'node:path';
import { miniAppUrl } from './tunnel_watch.mjs';

export const OWNER = 323028999;

// tgCall(method, body) -> ответ Telegram {ok, result|description}. Подменяется в тестах.
export function makeTg(token, fetchImpl = fetch) {
  return async (method, body) => {
    const r = await fetchImpl(`https://api.telegram.org/bot${token}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return r.json();
  };
}

// Ставит кнопку «Офис» с актуальным адресом. До 4 попыток с нарастающей паузой (Telegram или сеть могут моргнуть).
export async function updateMenuButton(tgCall, api, { retries = 4, wait = (ms) => new Promise((r) => setTimeout(r, ms)), baseMs = 2000, chatId = OWNER } = {}) {
  const url = miniAppUrl(api); let last = null;
  for (let i = 0; i < retries; i++) {
    try {
      const r = await tgCall('setChatMenuButton', { chat_id: chatId, menu_button: { type: 'web_app', text: 'Офис', web_app: { url } } });
      if (r && r.ok) return { ok: true, url, attempts: i + 1 };
      last = (r && r.description) || 'ответ без ok';
      if (/Only HTTPS|invalid/i.test(last)) break;          // повторять бессмысленно: адрес не примут
    } catch (e) { last = e.message; }
    if (i < retries - 1) await wait(baseMs * 2 ** i);
  }
  return { ok: false, url, error: last, attempts: retries };
}

// После включения ПК автозапуск стартует раньше сети: 4 быстрые попытки (~14 с) кончаются раньше, чем сеть поднимется, кнопка остаётся со старым адресом
// и Mini App «недоступно» до ручной починки (так было 2026-10-26 после перезагрузки в 15:49). Поэтому при сбое повторяем раз в intervalMs, пока адрес актуален.
// isCurrent() = false -> адрес уже сменился, этим занимается более новый вызов. Адрес, который Telegram отвергает (не HTTPS), не повторяем.
export async function updateMenuButtonPatiently(tgCall, api, { isCurrent = () => true, rounds = 40, intervalMs = 30000, wait = (ms) => new Promise((r) => setTimeout(r, ms)), onRetry = () => {}, ...rest } = {}) {
  let r = null;
  for (let round = 1; round <= rounds; round++) {
    r = await updateMenuButton(tgCall, api, { wait, ...rest });
    if (r.ok) return { ...r, rounds: round };
    if (/Only HTTPS|invalid/i.test(r.error || '')) return { ...r, rounds: round };
    if (!isCurrent()) return { ...r, rounds: round, superseded: true };
    if (round < rounds) { onRetry(round, r.error); await wait(intervalMs); }
  }
  return { ...r, rounds };
}

export function readBotToken(dataDir) {
  try { return JSON.parse(fs.readFileSync(path.join(dataDir, 'config.json'), 'utf8')).smmBotToken || ''; } catch { return ''; }
}

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

export function readBotToken(dataDir) {
  try { return JSON.parse(fs.readFileSync(path.join(dataDir, 'config.json'), 'utf8')).smmBotToken || ''; } catch { return ''; }
}

// Бот-приёмник решений Ника для офиса Nick G SMM (@NickG_smm_bot). Вся логика в API офиса (server/lib_chat.mjs):
// бот только пересылает нажатия кнопок и текст Ника туда, так что дашборд и Telegram всегда в одном состоянии.
// Запуск: node scripts/smm_bot.mjs (один экземпляр: порт-замок 8788). Токен берётся из server/data/config.json.
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, OWNER, tg, api, videos, sleep, topicsMessage, notify } from './smm_lib.mjs';

const lock = net.createServer();
lock.on('error', () => { console.log('smm_bot уже запущен'); process.exit(0); });
lock.listen(8788, '127.0.0.1', () => main());

const STATE = path.join(ROOT, 'smm', 'bot_state.json');
const state = (() => { try { return JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch { return { offset: 0 }; } })();
const save = () => { fs.mkdirSync(path.dirname(STATE), { recursive: true }); fs.writeFileSync(STATE, JSON.stringify({ offset: state.offset })); };

async function onCallback(cq) {
  if (cq.from.id !== OWNER) return tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Нет доступа' });
  const r = await api('/api/chat/answer', { tg_msg: cq.message && cq.message.message_id, choice: cq.data, via: 'telegram' }).catch((e) => ({ ok: false, error: e.message }));
  if (r.ok && r.pending === 'comment') {       // «Внести правки»: ждём комментарий, кнопки остаются
    await tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Напишите правки сообщением' });
    return;
  }
  await tg('answerCallbackQuery', { callback_query_id: cq.id, text: r.ok ? 'Принято' : (r.error || 'Не вышло') });
  if (cq.message) await tg('editMessageReplyMarkup', { chat_id: cq.message.chat.id, message_id: cq.message.message_id, reply_markup: { inline_keyboard: [] } });
}

async function onMessage(m) {
  if (m.from.id !== OWNER) return;
  const text = String(m.text || '').trim();
  if (!text) {      // голосовые и вложения бот пока не распознаёт: честно сказать, а не молчать
    if (m.voice || m.audio || m.video_note) await tg('sendMessage', { chat_id: OWNER, text: 'Голосовые в этом боте пока не распознаются. Напишите правки текстом, пожалуйста.' });
    return;
  }
  if (text.startsWith('/start') || text.startsWith('/topics')) {
    if (text.startsWith('/start')) await tg('sendMessage', { chat_id: OWNER, text: 'Это бот офиса Nick G SMM. Сюда приходят темы на выбор, сценарии на утверждение и готовые ролики. Можно писать сотрудникам: начните сообщение с имени («Ксения, …», «Лев, …», «Вера, …», «Кирилл, …», «Виктор, …»); без имени отвечает Капитан Кряк. То же самое есть в чате дашборда, переписка общая. /status: что в работе, /topics: темы, ждущие выбора.' });
    const tm = topicsMessage(await videos());
    if (tm) return notify(tm.text, tm.buttons);
    return text.startsWith('/topics') ? tg('sendMessage', { chat_id: OWNER, text: 'Тем, ждущих выбора, нет.' }) : undefined;
  }
  if (text.startsWith('/status')) {
    const vs = await videos();
    return tg('sendMessage', { chat_id: OWNER, text: vs.length ? vs.slice(0, 15).map((v) => `#${v.id} [${v.stage}] ${v.title}${v.score != null ? ` (${v.score})` : ''}`).join('\n') : 'Пока пусто' });
  }
  await api('/api/chat/incoming', { text, source: 'telegram' });
}

async function main() {
  console.log('smm_bot: слушаю @NickG_smm_bot');
  for (;;) {
    try {
      const r = await tg('getUpdates', { offset: state.offset, timeout: 50, allowed_updates: ['message', 'callback_query'] });
      if (!r.ok) { console.error('getUpdates:', r.description); await sleep(15000); continue; }
      for (const u of r.result) {
        state.offset = u.update_id + 1; save();
        try { if (u.callback_query) await onCallback(u.callback_query); else if (u.message) await onMessage(u.message); }
        catch (e) { console.error('обработка:', e.message); }
      }
    } catch (e) { console.error('опрос:', e.message); await sleep(10000); }
  }
}

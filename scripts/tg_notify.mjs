#!/usr/bin/env node
// Отправка сообщений в Telegram-бота по поиску работы (@nickgjobsfinder_bot).
// Использование: node scripts/tg_notify.mjs "текст"     или     echo "текст" | node scripts/tg_notify.mjs -
// Токен и chat_id берутся из server/data/config.json (jobBotToken, jobBotChatId); chat_id находится сам, когда Ник нажал Start.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const CFG = path.join(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), 'server', 'data', 'config.json');
const cfg = JSON.parse(fs.readFileSync(CFG, 'utf8'));
const tg = async (m, body) => (await fetch(`https://api.telegram.org/bot${cfg.jobBotToken}/${m}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) })).json();

let text = process.argv[2];
if (text === '-' || text === undefined) text = fs.readFileSync(0, 'utf8');
if (!cfg.jobBotToken) { console.error('NO_TOKEN'); process.exit(2); }

if (!cfg.jobBotChatId) {
  const u = await tg('getUpdates', { limit: 50 });
  const m = (u.result || []).map((x) => x.message).filter(Boolean).pop();
  if (!m) { console.error('NO_CHAT: Ник ещё не нажал Start в боте'); process.exit(3); }
  cfg.jobBotChatId = m.chat.id;
  fs.writeFileSync(CFG, JSON.stringify(cfg, null, 2));
}
// режем по 3800 символов на границах строк
const parts = []; let cur = '';
for (const line of String(text).split('\n')) { if ((cur + line).length > 3800) { parts.push(cur); cur = ''; } cur += line + '\n'; }
if (cur.trim()) parts.push(cur);
for (const p of parts) {
  const r = await tg('sendMessage', { chat_id: cfg.jobBotChatId, text: p.trim(), disable_web_page_preview: true });
  if (!r.ok) { console.error('TG_ERR', r.description); process.exit(4); }
}
console.log('SENT', parts.length);

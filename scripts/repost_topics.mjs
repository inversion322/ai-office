// Разовая синхронизация: кладёт в чат дашборда карточку «выберите тему» по темам, которые сейчас ждут выбора (stage=scored).
// Telegram-зеркало не отправляется (по умолчанию), чтобы не слать дубль: старое сообщение в Telegram с кнопками остаётся рабочим не будет,
// поэтому по флагу --tg карточка уходит и в Telegram новой копией с живыми кнопками.
import { videos, topicsMessage, api } from './smm_lib.mjs';
const tm = topicsMessage(await videos());
if (!tm) { console.log('нет тем, ждущих выбора'); process.exit(0); }
const r = await api('/api/chat/post', { office: 'smm', thread: 'captain_smm', sender: 'captain_smm', text: tm.text, buttons: tm.buttons, mirror: process.argv.includes('--tg') });
console.log('карточка в чате, id', r.id);

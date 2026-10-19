// Дописывает к промптам сотрудников SMM в работающем офисе блоки правил роликов: жёсткие рамки (59 с, динамика, лупа) и формат Shorts/Reels + призыв подписаться.
// Идемпотентно: по маркеру блока. Запуск: node scripts/apply_video_rules.mjs   (через API офиса, версии промптов растут, история сохраняется)
import { RULES_BY_AGENT, RULES_MARK, FORMAT_BY_AGENT, FORMAT_MARK } from '../server/lib_extra_agents.mjs';
import { api } from './smm_lib.mjs';
const blocks = [[RULES_MARK, RULES_BY_AGENT], [FORMAT_MARK, FORMAT_BY_AGENT]];
for (const id of new Set([...Object.keys(RULES_BY_AGENT), ...Object.keys(FORMAT_BY_AGENT)])) {
  for (const [mark, by] of blocks) {
    if (!by[id]) continue;
    const cur = (await api('/api/agent-config?id=' + id)).prompt;
    if (!cur) { console.log(id, ': нет промпта'); continue; }
    if (cur.body.includes(mark)) { console.log(id, mark.slice(0, 18), ': уже есть'); continue; }
    const r = await api('/api/prompt', { id, body: cur.body.trimEnd() + '\n\n' + by[id] });
    console.log(id, mark.slice(0, 18), ': добавлено, версия', r.version);
  }
}

// Дописывает жёсткие рамки роликов (59 с, динамика, лупа) к промптам сотрудников SMM в работающем офисе. Идемпотентно.
// Запуск: node scripts/apply_video_rules.mjs   (через API офиса, версии промптов растут, история сохраняется)
import { RULES_BY_AGENT, RULES_MARK } from '../server/lib_extra_agents.mjs';
import { api } from './smm_lib.mjs';
for (const [id, block] of Object.entries(RULES_BY_AGENT)) {
  const cur = (await api('/api/agent-config?id=' + id)).prompt;
  if (!cur) { console.log(id, ': нет промпта'); continue; }
  if (cur.body.includes(RULES_MARK)) { console.log(id, ': уже есть'); continue; }
  const r = await api('/api/prompt', { id, body: cur.body.trimEnd() + '\n\n' + block });
  console.log(id, ': добавлено, версия', r.version);
}

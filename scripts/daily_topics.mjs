// Ежедневная подборка тем (cron 11:00 МСК, решение Ника 2026-10-21).
//   node scripts/daily_topics.mjs [--channel med_detective] [--dry]
// Для каждого канала: собрать уже занятые темы → Виктор ищет актуальное → код отсекает повторы → Лев оценивает → Нику приходит подборка.
// Ничего дорогого сам не запускает: сценарий стартует только по кнопке «Взять тему». Чужие темы в офисе не трогает.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, api, agent, say, promptOf, videos, runAgent, readJson, notify } from './smm_lib.mjs';
import { splitNew, findDuplicate } from './topic_dedupe.mjs';
import { channelTitles } from './channel_feed.mjs';
import { measureAll, applyDemand, demandLookup, demandForPrompt, VIKTOR_DEMAND_RULES, LEV_DEMAND_RULES } from './demand.mjs';

/** Каналы. Новый канал (личный блог про ИИ) = новая запись здесь + правила рубрики; отдел и сотрудники подключатся отдельно. */
export const CHANNELS = {
  med_detective: {
    name: 'Медицинский детектив', office: 'smm', tg: 'med_detective_ru', active: true, count: 6,
    brief: 'Рубрика «Миф»: популярное заблуждение о здоровье, которое можно разоблачить по первоисточникам (PubMed, Cochrane, ВОЗ, Mayo Clinic). Русскоязычная широкая аудитория. Без лечебных советов, дозировок, брендов и рецептурных препаратов.',
  },
  // ai_blog: { name: 'Блог про ИИ и автоматизацию', active: false, … }   // подключается Ником через несколько дней (docs/IDEA_multi_channel_office.md)
};

const stamp = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
const noteOf = (v) => { try { return JSON.parse(v.notes || '{}'); } catch { return {}; } };

/** Все занятые темы канала: ролики офиса любого статуса (в т.ч. отклонённые: Ник их уже видел), прежние подборки, посты канала. */
export async function usedTopics(ch) {
  const vs = (await videos()).map((v) => v.title);
  const hist = []; const base = path.join(ROOT, 'smm', 'runs');
  try { for (const d of fs.readdirSync(base)) { for (const f of ['candidates.json', 'scored.json', 'daily_fresh.json']) { const j = readJson(path.join(base, d, f)); if (Array.isArray(j)) hist.push(...j.map((x) => x && x.title).filter(Boolean)); } } } catch {}
  let feed = { titles: [], source: 'none' }; if (ch.tg) feed = await channelTitles(ch.tg).catch((e) => ({ titles: [], source: 'none', error: e.message }));
  const all = [...new Set([...vs, ...hist, ...feed.titles].map((s) => String(s).trim()).filter(Boolean))];
  return { all, counts: { офис: vs.length, прежние_подборки: hist.length, канал: feed.titles.length }, feed };
}

export function dailyMessage(chName, list, dropped, counts) {
  const lines = list.map((r, i) => `${i + 1}. [${r.total ?? '—'}] ${r.title}\n   ${r.reason || r.why_massive || ''}${r.demand_line ? `\n   📊 ${r.demand_line}` : ''}`);
  return `🦆 Темы на сегодня · «${chName}»\n(балл 0-100: охват посчитан по замерам спроса, остальное оценка Льва; это не прогноз просмотров. Уже учтено ${counts.офис + counts.канал + counts.прежние_подборки} прежних тем: повторов нет${dropped ? `, отсеяно похожих: ${dropped}` : ''})\n\n${lines.join('\n\n')}\n\nВыберите тему кнопкой, и Ксения начнёт сценарий. Без вашей кнопки ничего не запускается.`;
}

export async function dailyTopics(chKey, { dry = false } = {}) {
  const ch = CHANNELS[chKey]; if (!ch || !ch.active) throw new Error(`канал «${chKey}» не подключён`);
  const dir = path.join(ROOT, 'smm', 'runs', `${stamp()}_daily_${chKey}`); fs.mkdirSync(dir, { recursive: true });
  const used = await usedTopics(ch);
  if (used.feed.error) console.error('лента канала недоступна:', used.feed.error, '(источник:', used.feed.source + ')');
  fs.writeFileSync(path.join(dir, 'used_topics.txt'), used.all.join('\n'), 'utf8');
  const month = new Date().toLocaleString('ru-RU', { month: 'long', year: 'numeric' });
  const cand = path.join(dir, 'candidates.json'), scored = path.join(dir, 'scored.json');
  let fresh = [], dropped = [], rounds = 0; const taken = [...used.all];
  await agent('research', 'working', `Ищу темы дня: «${ch.name}»`, 20, `Ежедневная подборка тем для «${ch.name}»`);
  while (fresh.length < ch.count && rounds < 2) {      // второй круг только если после отсева осталось мало
    rounds++;
    await runAgent({
      label: 'research', outFile: cand, persona: await promptOf('research'),
      task: `Найди ${ch.count + 4} кандидатов на тему следующего ролика канала «${ch.name}». ${ch.brief}
Цель: максимально широкая аудитория и АКТУАЛЬНОСТЬ СЕЙЧАС (${month}): что сейчас обсуждают, о чём новые исследования и новости, сезонные темы (простуды осенью, жара летом, смена времени, праздничные застолья и т.п.), вирусные утверждения из соцсетей и роликов.
УЖЕ ЕСТЬ, НЕ ПОВТОРЯТЬ (список в файле ${path.join(dir, 'used_topics.txt')}, прочитай его целиком первым действием). Повтор это и та же мысль другими словами: «10 000 шагов» = «ходить по 10 тысяч шагов в день».${rounds > 1 ? `\nПЕРВЫЙ КРУГ ДАЛ ПОВТОРЫ, НЕ ПРЕДЛАГАЙ: ${dropped.slice(-12).map((d) => d.title).join('; ')}. Нужны ДРУГИЕ темы.` : ''}
С помощью веб-поиска и чтения страниц: 1) что реально спрашивают («правда ли что…»), 2) что собирает просмотры у русскоязычных каналов про мифы о здоровье, 3) для каждой темы сильный первоисточник с однозначным ответом; без источника тему не включай.
${VIKTOR_DEMAND_RULES}
Формат файла ${cand}: JSON-массив объектов {"title": "миф вопросом", "rubric": "myth", "why_massive": "почему массовый и почему актуален сейчас", "evidence": [{"source","url","pmid","finding"}], "clear_answer": true/false, "detective_angle": "…", "competitors": "…", "queries": ["…", "…"], "wiki_article": "…"}.`,
      maxTurns: 70, budgetSec: 1200,
    });
    const got = readJson(cand); if (!Array.isArray(got) || !got.length) { if (rounds > 1) break; continue; }
    const sp = splitNew(got, taken); dropped.push(...sp.dropped);
    for (const c of sp.fresh) { fresh.push(c); taken.push(c.title); }
  }
  fs.writeFileSync(path.join(dir, 'dropped_duplicates.json'), JSON.stringify(dropped, null, 1), 'utf8');
  fresh = fresh.filter((c) => c.clear_answer !== false && Array.isArray(c.evidence) && c.evidence.length);   // без первоисточника и без однозначного ответа не берём
  if (!fresh.length) {
    await agent('research', 'idle', 'Новых тем не нашёл', 0, 'Подборка пуста');
    if (!dry) await notify(`🦆 Темы на сегодня · «${ch.name}»: новых тем без повторов не нашлось (отсеяно похожих: ${dropped.length}). Завтра попробую снова; можно подсказать направление в чате.`);
    return { fresh: [], dropped };
  }
  // Замер спроса делает КОД (решение Ника 2026-10-27): Википедия, подсказки, тренды; с ключами Вордстат и YouTube. Охват в балле считается по нему.
  await agent('research', 'working', 'Замеряю спрос на темы', 60, 'Замеряю спрос: просмотры, подсказки, тренды');
  const demands = await measureAll(fresh);
  fs.writeFileSync(path.join(dir, 'demand.json'), JSON.stringify(fresh.map((c, i) => ({ title: c.title, ...demands[i] })), null, 1), 'utf8');
  fs.writeFileSync(path.join(dir, 'daily_fresh.json'), JSON.stringify(fresh.map((c, i) => ({ ...c, demand: demandForPrompt(demands[i]) })), null, 1), 'utf8');
  await agent('research', 'idle', 'Темы переданы Льву', 100, `Нашёл ${fresh.length} новых тем`);
  await agent('virality', 'working', 'Оцениваю темы дня', 20, 'Оценка тем дня');
  await runAgent({
    label: 'virality', outFile: scored, persona: await promptOf('virality'), maxTurns: 60, budgetSec: 1200,
    task: `Оцени кандидатов из файла ${path.join(dir, 'daily_fresh.json')} (читай его). Для каждого: сначала ворота (первоисточник с однозначным ответом; нет рекомендаций лечения и дозировок; не про бренд или рецептурный препарат), затем баллы по рубрике из твоего промпта.
${LEV_DEMAND_RULES}
Формат файла ${scored}: JSON-массив, отсортированный по total по убыванию: {"title","rubric","gates_passed":true/false,"scores":{"reach","urgency","prevalence","evidence","niche","plot","speed"},"total","confidence":"low|medium|high","data_sources":["…"],"main_risk","recommendation":"снимать|отложить|отклонить","reason":"1-2 предложения"}. Названия копируй без изменений.`,
  });
  const res = applyDemand((readJson(scored) || []).filter((r) => r && r.title && r.gates_passed !== false && r.recommendation !== 'отклонить'), demandLookup(fresh, demands));      // охват = по замерам, итог пересчитан
  if (!res.length) { await agent('virality', 'error', 'Оценка не удалась', 0, 'Оценка тем дня не удалась', 'error'); throw new Error('нет scored.json, смотри ' + dir); }
  const byTitle = new Map(fresh.map((c) => [c.title, c]));
  const made = [];
  for (const r of res.slice(0, ch.count)) {
    const c = byTitle.get(r.title) || {};
    if (findDuplicate(r.title, used.all).dup) continue;          // Лев мог переформулировать название: страховка
    const notes = JSON.stringify({ gates: r.gates_passed, scores: r.scores, confidence: r.confidence, reason: r.reason, risk: r.main_risk, recommendation: r.recommendation, sources: r.data_sources, evidence: c.evidence, why_massive: c.why_massive, angle: c.detective_angle, competitors: c.competitors, daily: stamp(), demand: r.demand, demand_line: r.demand_line, reach_lev: r.reach_lev });
    if (dry) { made.push({ id: null, ...r }); continue; }
    const { id } = await api('/api/video', { title: r.title, rubric: r.rubric || c.rubric || 'myth', stage: 'scored', score: r.total, notes });
    made.push({ id, ...r });
  }
  fs.writeFileSync(path.join(dir, 'summary.md'), made.map((r, i) => `${i + 1}. [${r.total}] ${r.title} (${r.recommendation}; ${r.confidence}) ${r.reason || ''} | ${r.demand_line || ''}`).join('\n'), 'utf8');
  await agent('virality', 'idle', 'Оценка готова', 100, `Оценил ${made.length} тем`);
  await say('research', `Темы дня для «${ch.name}»: ${made.length} новых, повторов нет.`);
  const text = dailyMessage(ch.name, made, dropped.length, used.counts);
  if (!dry) await notify(text, [made.slice(0, 4).map((m, i) => [`Тема ${i + 1}`, `pick:${m.id}`]), [['Другие темы', 'more:0']]]);
  console.log(text);
  return { fresh: made, dropped, dir };
}

if (process.argv[1] && /daily_topics\.mjs$/i.test(process.argv[1].replace(/\\/g, '/'))) {
  const args = process.argv.slice(2), opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
  const only = opt('--channel');
  const keys = Object.keys(CHANNELS).filter((k) => CHANNELS[k].active && (!only || k === only));
  if (!keys.length) { console.error('ОШИБКА: нет подходящих активных каналов' + (only ? ` («${only}»)` : '')); process.exit(2); }
  (async () => { for (const k of keys) { try { await dailyTopics(k, { dry: args.includes('--dry') }); } catch (e) { console.error('ОШИБКА', k + ':', e.message); try { await notify(`⚠️ Ежедневные темы для «${CHANNELS[k].name}» не собрались: ${String(e.message).slice(0, 200)}. Завтра попробую снова; сейчас можно запросить темы в чате.`); } catch {} process.exitCode = 1; } } })();
}

// Поток «три варианта одной темы» (решение Ника 2026-10-21). Зависимости передаются снаружи (makeFlow(deps)), поэтому логика проверяется
// быстрыми тестами с подменой моделей. Вызывается из smm_pipeline.mjs: variants <id> [--regen], group-card <id>, variant-revise <id> --comment ….
//   variantsFlow(A):  после того как Вера пропустила вариант A, Ксения пишет B и C (хук, подача и концовка другие, факты те же), код проверяет различия,
//                     стиль, драматургию, длину, новые числа; Вера один раз сверяет варианты с проверенными фактами; уходит ОДНА карточка Нику.
//   groupCard(A):     перерисовать карточку по текущему состоянию без запросов к моделям.
//   reviseVariant(X): правка Ника к конкретному варианту (комментарий «B: …»).
import fs from 'node:fs';
import path from 'node:path';
import { styleIssues, styleFeedback, bridgeIssues, verdictIssues, cleanFillerOpeners, VERDICT_RE } from './script_style.mjs';
import { craftIssues, craftFeedback } from './script_craft.mjs';
import { lengthVerdict, cutAdvice } from './smm_tts.mjs';
import { archiveScript, loadHistory } from './script_novelty.mjs';
import { FORMATS, LETTERS, GAP_MIN, variantOf, formatOf, groupMembers, isGroup, enabledFormats, publishOrder, compareVariants, unknownNumbers, variantBrief, summaryRows, anchorOf, isDropped } from './variants.mjs';

const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const NOTE = (v) => { try { return JSON.parse((v && v.notes) || '{}') || {}; } catch { return {}; } };
const first = (t) => String(t || '').split(/(?<=[.!?…])\s/)[0];
const MAXV = Math.max(1, Number(process.env.SCRIPT_ROUNDS) || 3);   // кругов на один вариант (запись, проверки, исправления); как у сценария A: три (решение Ника 2026-10-21)

export function makeFlow(deps) {
  const { ROOT, api, videos, getVideo, setVideo, runAgent, promptOf, agent, say, scene, safeNotify, speechSeconds, withCta, MAX_SPEECH, MAX_WORDS, log = console.log } = deps;
  const runDir = (id) => path.join(ROOT, 'smm', 'runs', `video_${id}`);
  const rel = (p) => path.relative(ROOT, p).replaceAll('\\', '/');

  async function putNotes(id, patch) { const v = await getVideo(id); await setVideo(id, { notes: JSON.stringify({ ...NOTE(v), ...patch }) }); }

  /** Метки группы: A получает метку, B и C заводятся записями (если ещё нет). Возвращает { A, members:[{letter,id,video}] }. */
  async function ensureGroup(id) {
    id = Number(id);
    const v = await getVideo(id); const n = NOTE(v);
    const all = await videos(); const mem = groupMembers(all, v);
    const mark = variantOf(v) || { group: id, letter: 'A', format: 'A', rotation: all.filter((x) => { const t = variantOf(x); return t && t.letter === 'A' && x.id !== id; }).length % LETTERS.length };
    if (!variantOf(v)) await setVideo(id, { notes: JSON.stringify({ ...n, variant: { ...mark, group: id, letter: 'A', format: 'A' } }) });
    const out = [{ letter: 'A', id, video: v }];
    for (const letter of enabledFormats().filter((l) => l !== 'A')) {
      let rec = mem.find((m) => (variantOf(m) || {}).letter === letter);
      if (!rec) {
        const r = await api('/api/video', { title: v.title, rubric: v.rubric, stage: 'script', notes: JSON.stringify({ evidence: n.evidence, angle: n.angle, why_massive: n.why_massive, risk: n.risk, reason: n.reason, variant: { group: id, letter, format: letter, rotation: mark.rotation } }) });
        rec = await getVideo(r.id);
      }
      out.push({ letter, id: rec.id, video: rec });
    }
    return { A: out[0], members: out, rotation: mark.rotation };
  }

  function copyMaterials(fromDir, toDir) {
    fs.mkdirSync(toDir, { recursive: true });
    for (const f of ['FACTS.md', 'check.json']) if (fs.existsSync(path.join(fromDir, f))) fs.copyFileSync(path.join(fromDir, f), path.join(toDir, f));
      }

  /** Написать (или исправить) один вариант. Возвращает { ok, segments, hook_type, warnings[] }. */
  async function writeVariant({ letter, rec, A, others, title, rubric, comment = '' }) {
    const dir = runDir(rec.id), sj = path.join(dir, 'script.json'), fmt = FORMATS[letter];
    copyMaterials(runDir(A.id), dir);
    const archived = archiveScript(dir), history = loadHistory(path.join(dir, 'history'));
    const sjA = path.join(runDir(A.id), 'script.json'), factsA = path.join(runDir(A.id), 'FACTS.md');
    const trusted = [A.segments.join(' '), (() => { try { return fs.readFileSync(factsA, 'utf8'); } catch { return ''; } })()];
    const warnings = []; let changes = comment ? [`Правка Ника к этому варианту: ${comment}`] : [], prev = comment ? readJson(sj) : null, lastSkills = null;
    if (!comment) fs.rmSync(sj, { force: true });
    for (let round = 1; round <= MAXV; round++) {
      await agent('scriptwriter', 'working', `Вариант ${letter} «${fmt.name}» (круг ${round})`, 30 + round * 12, round === 1 ? `Пишу вариант ${letter} «${fmt.name}»` : `Вариант ${letter}, круг ${round}`);
      await scene('captain_smm', 'scriptwriter', `Ксения, вариант ${letter} «${fmt.name}» той же темы: «${title}».`);
      const brief = variantBrief({ letter, format: letter, baseTitle: title, baseSegments: A.segments, baseHookType: A.hook_type, others });
      const t = await runAgent({
        label: `variant_${letter}_${round}`, outFile: sj, persona: await promptOf('scriptwriter'), maxTurns: 80, budgetSec: 1500, agentId: 'scriptwriter',
        task: `Напиши сценарий ролика «Медицинского детектива» (рубрика ${rubric === 'tips' ? '«Советы детектива»' : '«Миф»'}), тема: «${title}».
${brief}
${history.length ? `Прежние версии этого варианта лежат в ${rel(path.join(dir, 'history'))}: новая версия не должна на них походить.\n` : ''}ГЛАВНОЕ: это история со сценой, а не конспект. Каждый абзац можно нарисовать (человек, предмет, действие), ставка зрителя звучит вслух его словами, образы не режь ради лимита (режь повторы и третий факт); прочитай video/med_detective/SCRIPT_CRAFT.md, раздел «Сцена, а не тезис». Текст напиши раньше служебных полей. РАМКИ (те же, что у варианта A): озвучка не больше ${MAX_SPEECH} с при быстром диктор (+25%) вместе с призывом подписаться, то есть НЕ БОЛЬШЕ ${MAX_WORDS} слов в сценарии (призыв добавляет конвейер, сама его не пиши); в начале фраз нет «Потому что / Поэтому / Так что / Итак / Значит / Получается / Выходит / Таким образом / Вот почему / Дело в том / Ну / Короче»; слов «улика», «поворот», «развязка», «приговор», «заявление» и номеров улик нет; вердикт (миф или правда) звучит только в конце перед призывом, в хуке и заголовке его нет.
Факты и источники только из ${rel(factsA)} и из файла варианта A; claims и источники бери оттуда, новых не придумывай.
Формат файла и ВСЕ его поля ТОЧНО как в ${rel(sjA)} (прочитай его первым: title, idea, lens, stake, gaps, bookend, hook_type, chain, segments, claims, sources_card и остальные), запиши результат в ${rel(sj)}.${letter === 'C' ? '\nДля формата «Комикс» добавь поле «panels»: JSON-массив объектов {"scene","caption"}, по одному на каждый абзац segments (без призыва), и поле «reveal»: что проявится в последней пустой панели с вопросительным знаком (развязка одной фразой).' : ''}
${prev && comment ? `Текущий текст варианта (правь его, а не пиши заново): ${rel(sj)}.\n` : ''}${changes.length ? `Что исправить в этом круге: ${changes.join(' ')}` : ''}`,
      });
      lastSkills = t && t.skills;
      const cur = readJson(sj);
      if (!cur || !Array.isArray(cur.segments)) { warnings.push(`нет script.json после круга ${round} (код ${t && t.code})`); if (round === MAXV) return { ok: false, warnings }; changes = ['Файл сценария не создан: создай его по образцу варианта A.']; continue; }
      const cut = cleanFillerOpeners(cur); if (cut.length) fs.writeFileSync(sj, JSON.stringify(cur, null, 1), 'utf8');
      const bad = [];
      const stl = [...styleIssues(cur.segments), ...bridgeIssues(cur.segments), ...(process.env.VERDICT_GATE === 'off' ? [] : verdictIssues(cur))];
      if (stl.length) bad.push(styleFeedback(stl));
      const crf = process.env.CRAFT_GATE === 'off' ? { ok: true, issues: [] } : craftIssues(cur, { rubric });
      if (!crf.ok) bad.push(craftFeedback(crf.issues));
      const cmp = compareVariants([...others.map((o) => ({ letter: o.letter, segments: o.segments, hook_type: o.hook_type })), { letter, segments: cur.segments, hook_type: cur.hook_type }]);
      const mine = cmp.problems.filter((p) => p.startsWith(letter + ':')).map((p) => p.slice(3));
      if (mine.length) bad.push(`Вариант обязан отличаться от остальных (иначе это дубль, а не отдельный ролик): ${mine.join('; ')}.`);
      const oldHist = history.map((h) => ({ label: 'прежняя версия', segments: h.segments, hook_type: h.hook_type }));
      if (oldHist.length && !comment) { const { novelty } = await import('./script_novelty.mjs'); const nv = novelty({ segments: cur.segments, hook_type: cur.hook_type }, oldHist); if (!nv.ok) bad.push(nv.feedback); }
      const extra = unknownNumbers(cur.segments.join(' '), ...trusted); if (extra.length) bad.push(`В тексте есть числа, которых нет в проверенных фактах: ${extra.join(', ')}. Новых цифр добавлять нельзя: оставь только те, что есть в FACTS.md и в варианте A.`);
      const hard = [];       // структурные требования формата: без них монтировать нечего, на последнем круге их НЕ пропускаем «с пометкой»
      if (letter === 'C') {
        const nBefore = bad.length;
        // формат «Комикс» (решение Ника 2026-10-22, вместо «Диалога»): панели-сцены по абзацам и скрытая развязка
        const pn = Array.isArray(cur.panels) ? cur.panels : [], n = cur.segments.length;
        const sceneOf = (p) => String(p && p.scene || '').trim(), capOf = (p) => String(p && p.caption || '').trim();
        if (pn.length !== n || pn.some((p) => sceneOf(p).split(/\s+/).filter(Boolean).length < 4)) bad.push(`Для формата «Комикс» нужно поле «panels»: ровно ${n} объектов {scene, caption} (по одному на абзац), в каждом scene не короче четырёх слов: кто, где, что делает. Сейчас ${pn.length}.`);
        else if (pn.some((p) => capOf(p).split(/\s+/).filter(Boolean).length > 8)) bad.push('Подпись панели длиннее 8 слов: сократи до 6.');
        else if (pn.some((p, k) => k < n - 1 && VERDICT_RE.test(`${sceneOf(p)} ${capOf(p)}`))) bad.push('В сценах и подписях панелей до последней прозвучал вердикт (миф, ложь, фейк, правда как ярлык): вердикт только в развязке, в последней панели.');
        else if (String(cur.reveal || '').trim().split(/\s+/).filter(Boolean).length < 3) bad.push('Нужно поле «reveal»: что проявится в последней пустой панели с вопросительным знаком (ответ-развязка одной фразой, не короче трёх слов).');
        hard.push(...bad.slice(nBefore));
      }
      let sp = null; try { sp = await speechSeconds(withCta(cur.segments)); } catch (e) { warnings.push('длину не измерили: ' + String(e.message).split('\n')[0]); }
      if (sp && lengthVerdict(sp, MAX_SPEECH, { lastRound: round === MAXV }) === 'cut') bad.push(cutAdvice(sp.sec, MAX_SPEECH, { tag: sp.estimated ? ' (оценка по тексту)' : '' }));
      log(`вариант ${letter}, круг ${round}: ${cur.segments.join(' ').split(/\s+/).length} слов${sp ? `, озвучка ${sp.sec.toFixed(1)} с` : ''}${bad.length ? `, замечаний ${bad.length}` : ', чисто'}`);
      if (!bad.length) { prev = cur; return { ok: true, segments: cur.segments, hook_type: cur.hook_type, script: cur, warnings, sec: sp && sp.sec, skills: lastSkills }; }
      if (round === MAXV && hard.length) { warnings.push(...hard.map((b) => b.split('\n')[0].slice(0, 220))); return { ok: false, warnings }; }       // нет panels/reveal: вариант не получился, группа идёт без него
      if (round === MAXV) { warnings.push(...bad.map((b) => b.split('\n')[0].slice(0, 220))); return { ok: true, segments: cur.segments, hook_type: cur.hook_type, script: cur, warnings, sec: sp && sp.sec, skills: lastSkills, soft: true }; }
      changes = bad; prev = cur;
    }
    return { ok: false, warnings };
  }

  /** Одна сверка Веры: варианты не добавили лишнего к проверенным фактам. */
  async function veraSync({ A, ready, title }) {
    const dirA = runDir(A.id), out = path.join(dirA, 'variants_check.json');
    fs.rmSync(out, { force: true });
    const files = ready.filter((r) => r.letter !== 'A').map((r) => `вариант ${r.letter}: ${rel(path.join(runDir(r.id), 'script.json'))}`).join('; ');
    await agent('factcheck', 'working', 'Сверяю варианты с проверенными фактами', 40, 'Сверка вариантов B и C с проверенными фактами');
    await scene('captain_smm', 'factcheck', 'Вера, сверь, пожалуйста, варианты с уже проверенными фактами.');
    await runAgent({
      label: 'variants_check', agentId: 'factcheck', persona: await promptOf('factcheck'), maxTurns: 40, budgetSec: 900, outFile: out,
      task: `Сверка вариантов сценария по теме «${title}» с УЖЕ проверенными фактами. Первоисточники заново проходить не нужно, если утверждение покрыто проверкой варианта A.
Проверенное: сценарий A ${rel(path.join(dirA, 'script.json'))}, твоя проверка ${rel(path.join(dirA, 'check.json'))}, таблица ${rel(path.join(dirA, 'FACTS.md'))}. Варианты на сверку: ${files}.
Для КАЖДОГО варианта найди: (1) утверждения, которых нет среди проверенных; (2) искажение смысла (усилили вывод: «доказано» вместо «в исследовании на 50 мужчинах», обобщили на всех людей, убрали оговорку авторов); (3) числа, имена и годы не из проверенного. Мелочи подачи и разные формулировки одного и того же факта не считай ошибкой.
Запиши JSON в ${rel(out)}: {"verdict":"pass" или "fix","summary":"одно предложение","items":[{"letter":"B","text":"что в варианте","problem":"в чём расхождение","fix":"как исправить"}]}. Если замечаний нет: verdict pass и items [].`,
    });
    const r = readJson(out);
    await agent('factcheck', 'idle', r && r.verdict === 'pass' ? 'Варианты сверены с фактами' : 'Сверка вариантов завершена', 100, r ? `Сверка вариантов: ${r.verdict}` : 'Сверка вариантов не вернула файл');
    return r;
  }

  function saveVariantFiles(rec, A, res, vera) {
    const dir = runDir(rec.id), s = res.script;
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'script.json'), JSON.stringify(s, null, 1), 'utf8');
    fs.writeFileSync(path.join(dir, 'script_ru.txt'), withCta(s.segments).join('\n\n') + '\n', 'utf8');
    if (rec.letter === 'C') { fs.writeFileSync(path.join(dir, 'panels.json'), JSON.stringify(s.panels || [], null, 1), 'utf8'); fs.writeFileSync(path.join(dir, 'reveal.txt'), String(s.reveal || '').trim() + '\n', 'utf8'); fs.rmSync(path.join(dir, 'skeptic.json'), { force: true }); }
  }

  async function variantsFlow(id, { regen = false } = {}) {
    id = Number(id);
    // Выключено настройкой (server/data/settings.json: variantFormats=A) или env VARIANT_FORMATS=A: ничего не заводим и ролик A меткой группы не помечаем, он остаётся обычным одиночным
    if (enabledFormats().length < 2) { log('варианты выключены (variantFormats / VARIANT_FORMATS)'); return { skipped: true }; }
    const g = await ensureGroup(id); if (g.members.length < 2) { log('варианты выключены (VARIANT_FORMATS)'); return { skipped: true }; }
    const v = g.A.video, dirA = runDir(id), Aj = readJson(path.join(dirA, 'script.json'));
    if (!Aj || !Array.isArray(Aj.segments)) throw new Error('нет script.json варианта A: сначала этап script');
    const A = { id, letter: 'A', segments: Aj.segments, hook_type: Aj.hook_type };
    const ready = [A]; const failed = [];
    for (const m of g.members.filter((x) => x.letter !== 'A')) {
      if (isDropped(m.video)) continue;                       // Ник убрал этот вариант: заново не воскрешаем
      const existing = !regen && m.video.stage === 'checked' && readJson(path.join(runDir(m.id), 'script.json'));
      if (existing && Array.isArray(existing.segments)) { ready.push({ id: m.id, letter: m.letter, segments: existing.segments, hook_type: existing.hook_type, script: existing, kept: true }); continue; }
      const res = await writeVariant({ letter: m.letter, rec: m, A, others: ready.map((r) => ({ letter: r.letter, segments: r.segments, hook_type: r.hook_type })), title: v.title, rubric: v.rubric });
      if (!res.ok) { failed.push({ letter: m.letter, id: m.id, why: res.warnings.join('; ') }); await setVideo(m.id, { stage: 'rejected' }); continue; }
      saveVariantFiles(m, A, res);
      ready.push({ id: m.id, letter: m.letter, segments: res.segments, hook_type: res.hook_type, script: res.script, warnings: res.warnings, sec: res.sec, skills: res.skills });
    }
    await agent('scriptwriter', 'idle', 'Варианты переданы на сверку', 100, `Варианты готовы: ${ready.map((r) => r.letter).join(', ')}`);
    // сверка Веры (не больше двух, как и проверки сценария), при замечаниях Ксения исправляет только названный вариант
    let vera = null;
    if (ready.length > 1 && process.env.VARIANT_VERA !== 'off') {
      for (let k = 1; k <= 2; k++) {
        vera = await veraSync({ A, ready, title: v.title });
        if (!vera || vera.verdict === 'pass' || !Array.isArray(vera.items) || !vera.items.length || k === 2) break;
        for (const L of [...new Set(vera.items.map((x) => x.letter))]) {
          const r = ready.find((x) => x.letter === L && x.letter !== 'A'); if (!r) continue;
          const fixes = vera.items.filter((x) => x.letter === L).map((x) => `${x.problem}${x.fix ? ` (${x.fix})` : ''}`).join('; ');
          const rec = g.members.find((m) => m.letter === L);
          const res = await writeVariant({ letter: L, rec, A, others: ready.filter((x) => x.letter !== L && x.letter < L).map((o) => ({ letter: o.letter, segments: o.segments, hook_type: o.hook_type })), title: v.title, rubric: v.rubric, comment: `Фактчекер просит исправить: ${fixes}` });
          if (res.ok) { saveVariantFiles(rec, A, res); Object.assign(r, { segments: res.segments, hook_type: res.hook_type, script: res.script, warnings: res.warnings }); }
        }
      }
    }
    // после правок по замечаниям Веры writeVariant снова ставил Ксению «работает», и назад её не возвращал никто: в офисе она висела рабочей часами (21.10 с 19:59). Возвращаем явно.
    await agent('scriptwriter', 'idle', 'Варианты готовы', 100, `Варианты готовы: ${ready.map((r) => r.letter).join(', ')}`);
    for (const r of ready.filter((x) => x.letter !== 'A')) await setVideo(r.id, { stage: 'checked', script_path: rel(path.join(runDir(r.id), 'script_ru.txt')) });
    const note = failed.length ? `⚠️ ${failed.map((f) => `Вариант ${f.letter} не получился (${f.why.slice(0, 120)})`).join('; ')}: идём тем, что есть.` : '';
    const cardId = await groupCard(id, { note, vera, ready });
    return { skipped: false, cardId, ready: ready.map((r) => r.letter), failed };
  }

  /** Групповая карточка по текущему состоянию файлов. Без запросов к моделям. */
  async function groupCard(id, { note = '', vera = undefined, ready = null } = {}) {
    id = Number(id);
    const v0 = await getVideo(id); const all = await videos(); const mem = groupMembers(all, v0);
    const live = mem.filter((m) => m.stage === 'checked');
    if (!live.length) throw new Error('в группе нет сценариев на утверждение');
    const Aid = (variantOf(v0) || { group: id }).group, a = anchorOf(mem) || mem.find((m) => m.id === Aid) || v0;     // кнопки ссылаются на живой вариант: убранный A не должен ломать «Утвердить»
    const rot = (variantOf(a) || {}).rotation || 0, letters = live.map((m) => (variantOf(m) || { letter: 'A' }).letter), order = publishOrder(rot).filter((l) => letters.includes(l));
    const items = live.map((m) => {
      const d = runDir(m.id), s = readJson(path.join(d, 'script.json')) || {}, L = (variantOf(m) || { letter: 'A' }).letter;
      return { m, L, s, sk: L === 'C' ? readJson(path.join(d, 'panels.json')) || s.panels || [] : [], segments: s.segments || [], hook_type: s.hook_type, format: L };
    });
    const cmp = items.length > 1 ? compareVariants(items.map((x) => ({ letter: x.L, segments: x.segments, hook_type: x.hook_type }))) : { ok: true, problems: [] };
    const blocks = items.map((x) => {
      const rows = x.L === 'C' && x.sk.length ? x.segments.map((p, i) => `${x.sk[i] && x.sk[i].scene ? `🖼 Панель ${i + 1}: ${String(x.sk[i].scene).trim()}${x.sk[i].caption ? ` («${String(x.sk[i].caption).trim()}»)` : ''}\n` : ''}🎙 ${p}`).join('\n') + (x.s.reveal ? `\n❓ Последняя панель, ответ: ${String(x.s.reveal).trim()}` : '') : x.segments.join('\n');
      return `━━ Вариант ${x.L} · «${FORMATS[x.L].name}»${x.hook_type ? ` · крючок «${x.hook_type}»` : ''}\n${rows}`;
    });
    const sources = ((readJson(path.join(runDir(Aid), 'script.json')) || {}).sources_card || (items[0] && items[0].s.sources_card) || []).map((s) => '• ' + s).join('\n');
    const veraLine = vera === undefined ? '' : vera === null ? '⚠️ Вера не вернула сверку вариантов с фактами: варианты проверены только автоматикой.' : vera.verdict === 'pass' ? `✅ Вера сверила варианты с проверенными фактами: ${vera.summary || 'новых утверждений нет'}` : `⚠️ Вера оставила замечания к вариантам (${(vera.items || []).map((x) => `${x.letter}: ${x.problem}`).join('; ').slice(0, 300)}), Ксения исправила, но проверьте внимательнее.`;
    const warn = (ready || []).flatMap((r) => (r.warnings || []).map((w) => `${r.letter}: ${w}`)).slice(0, 4);
    const text = `🎭 ${items.length > 1 ? `Варианты сценария (${items.map((x) => x.L).join(', ')})` : 'Сценарий'}: «${v0.title}»${note ? `\n${note}` : ''}\nТема и факты одни (Вера проверила один раз), хук, подача и концовка у вариантов свои. Три монтажёра работают параллельно. Порядок выхода: ${order.join(' → ')}, интервал ${GAP_MIN} минут (меняется от темы к теме).\n${cmp.ok ? '✅ Различия между вариантами проверены кодом: хуки, тексты и концовки разные.' : `⚠️ Автопроверка различий: ${cmp.problems.join('; ')}.`}${veraLine ? '\n' + veraLine : ''}${warn.length ? `\n⚠️ Автопроверки не приняли до конца: ${warn.join('; ')}.` : ''}\n\n${blocks.join('\n\n')}\n\nИсточники (общие):\n${sources}\n\nФайлы: smm/runs/video_${items.map((x) => x.m.id).join(', video_')}/`;
    const drop = items.length > 1 ? [items.map((x) => [`Убрать ${x.L}`, `vdrop:${x.m.id}`])] : [];
    const buttons = [[[items.length > 1 ? (items.length === 3 ? 'Утвердить все три' : 'Утвердить оба') : 'Утвердить сценарий', `approve:${a.id}`], ['Нужны правки', `revise:${a.id}`]], [['🔄 Перегенерировать варианты', `vregen:${a.id}`], ['Отклонить тему', `reject:${a.id}`]], ...drop];
    return safeNotify(text, buttons);
  }

  /** Правка Ника к одному варианту (B или C): Ксения правит, проверки, Вера сверяет, карточка группы обновляется. */
  async function reviseVariant(id, comment) {
    id = Number(id);
    const v = await getVideo(id); const vr = variantOf(v); if (!vr) throw new Error('у ролика нет метки варианта');
    const all = await videos(), mem = groupMembers(all, v), a = mem.find((m) => m.id === vr.group);
    const Aj = readJson(path.join(runDir(vr.group), 'script.json')); if (!Aj) throw new Error('нет сценария варианта A');
    const others = [{ letter: 'A', segments: Aj.segments, hook_type: Aj.hook_type }];
    for (const m of mem) { const L = (variantOf(m) || {}).letter; if (L && L !== vr.letter && L !== 'A' && m.stage === 'checked') { const s = readJson(path.join(runDir(m.id), 'script.json')); if (s) others.push({ letter: L, segments: s.segments, hook_type: s.hook_type }); } }
    const res = await writeVariant({ letter: vr.letter, rec: { id, letter: vr.letter }, A: { id: vr.group, segments: Aj.segments, hook_type: Aj.hook_type }, others, title: v.title, rubric: v.rubric, comment });
    if (!res.ok) throw new Error(`вариант ${vr.letter} не удалось исправить: ${res.warnings.join('; ')}`);
    saveVariantFiles({ id, letter: vr.letter }, { id: vr.group }, res);
    await setVideo(id, { stage: 'checked', script_path: rel(path.join(runDir(id), 'script_ru.txt')) });
    await agent('scriptwriter', 'idle', 'Правка варианта внесена', 100, `Вариант ${vr.letter} исправлен`);
    let vera = null; if (process.env.VARIANT_VERA !== 'off') vera = await veraSync({ A: { id: vr.group }, ready: [{ letter: vr.letter, id }], title: v.title });
    return groupCard(vr.group, { note: `✏️ Вариант ${vr.letter} исправлен по вашим правкам.`, vera, ready: [{ letter: vr.letter, warnings: res.warnings }] });
  }

  return { variantsFlow, groupCard, reviseVariant, ensureGroup, writeVariant, veraSync };
}

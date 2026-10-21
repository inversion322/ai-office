// Поток «три варианта»: создание записей, проверки различий, повторы по замечаниям, сверка Веры, групповая карточка. Модели подменены.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeFlow } from '../scripts/variants_flow.mjs';
import { variantOf, groupMembers } from '../scripts/variants.mjs';

process.env.CRAFT_GATE = 'off';            // драматургия проверяется своими тестами; здесь настоящие проверки стиля, различий, чисел, длины
const SA = ['Говорят, что кофе обезвоживает. Правда ли это?', 'Британцы пометили воду в телах пятидесяти мужчин. Три дня те пили кофе, три дня воду.', 'Вода в организме у обеих групп вела себя одинаково, а различие нашли в мелочах.', 'Чашку кофе зря обвиняли: за день жидкости она даёт столько же, сколько вода.'];
const SB = ['Пятьдесят мужчин, шесть дней и один вопрос про утреннюю чашку.', 'Исследователи Киллер с коллегами делили дни на кофейные и водные и измеряли, сколько жидкости остаётся в теле.', 'Итог по приборам удивил самих авторов: разница между напитками почти не видна на графике.', 'Утренний кофе вы можете оставить, график это позволяет.'];
const SC = ['Мне сказали, что кофе сушит, а я не поверил.', 'Учёные из Бирмингема поспорили с этой байкой и провели собственный опыт.', 'Выяснилось, что по общему балансу воды кофе и вода идут вровень.', 'Пейте спокойно: чашка кофе потерей воды не станет.'];
const mk = (segments, hook_type, extra = {}) => ({ title: 'Кофе', hook_type, segments, claims: [{ text: 'кофе', source: 'PMID 24416202' }], sources_card: ['Killer 2014 (PMID 24416202)'], ...extra });
const J = (o) => JSON.stringify(o);

let ROOT, db, nextId, notified, statuses, plans, veraPlan, calls;
function mkFlow() {
  const api = async (p, body) => { assert.equal(p, '/api/video'); const id = nextId++; db.push({ id, title: body.title, rubric: body.rubric, stage: body.stage, notes: body.notes }); return { ok: true, id }; };
  const getVideo = async (id) => db.find((v) => v.id === Number(id));
  const setVideo = async (id, f) => { const v = db.find((x) => x.id === Number(id)); Object.assign(v, f); };
  const runAgent = async ({ label, outFile, task }) => {
    calls.push({ label, task }); const m = /^variant_([BC])_(\d+)$/.exec(label);
    if (m) { const arr = plans[m[1]] || []; const k = calls.filter((c) => c.label.startsWith('variant_' + m[1])).length; const r = arr[Math.min(k, arr.length) - 1]; if (r) { fs.mkdirSync(path.dirname(outFile), { recursive: true }); fs.writeFileSync(outFile, J(r)); } return { code: 0, skills: { checked: true, missing: [] } }; }
    if (label === 'variants_check') { const k = calls.filter((c) => c.label === 'variants_check').length; const r = veraPlan[Math.min(k, veraPlan.length) - 1] || { verdict: 'pass', summary: 'новых утверждений нет', items: [] }; fs.writeFileSync(outFile, J(r)); }
    return { code: 0 };
  };
  return makeFlow({ ROOT, api, videos: async () => db, getVideo, setVideo, runAgent, promptOf: async () => 'persona', agent: async (id, st, task) => { statuses.push([id, st, task]); }, say: async () => {}, scene: async () => {},
    safeNotify: async (text, buttons) => { notified.push({ text, buttons }); return 100 + notified.length; },
    speechSeconds: async (segs) => ({ sec: segs.join(' ').split(/\s+/).length * 0.33, estimated: false }), withCta: (s) => [...s, 'Ставь лайк и подписывайся.'], MAX_SPEECH: 53, MAX_WORDS: 100, ledgerPath: (d) => path.join(d, 'ledger.json'), log: () => {} });
}
function seedA(id = 1, rotationFromPrev = false) {
  db.push({ id, title: 'Кофе', rubric: 'myth', stage: 'checked', notes: J({ evidence: ['PMID 24416202'], angle: 'пробирки' }) });
  const d = path.join(ROOT, 'smm', 'runs', `video_${id}`); fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'script.json'), J(mk(SA, 'вопрос-ловушка'))); fs.writeFileSync(path.join(d, 'FACTS.md'), 'Killer 2014, 50 мужчин, 3 дня, PMID 24416202'); fs.writeFileSync(path.join(d, 'check.json'), J({ verdict: 'pass' })); fs.writeFileSync(path.join(d, 'ledger.json'), '{"sources":[]}');
}
beforeEach(() => { ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'vflow-')); db = []; nextId = 2; notified = []; statuses = []; calls = []; veraPlan = []; plans = { B: [mk(SB, 'цифра')], C: [mk(SC, 'контраст', { skeptic: ['Кофе же сушит?', 'И что, никто не проверял?', 'Но моча же светлеет?', 'Значит, можно пить?'] })] }; delete process.env.VARIANT_FORMATS; delete process.env.VARIANT_VERA; });
const done = () => fs.rmSync(ROOT, { recursive: true, force: true });

test('счастливый путь: записи B и C с метками, сценарии и призыв, реплики скептика, материалы скопированы, ОДНА карточка с кнопками', async () => {
  try {
    seedA(); const flow = mkFlow(); const r = await flow.variantsFlow(1);
    assert.deepEqual(r.ready, ['A', 'B', 'C']); assert.deepEqual(r.failed, []);
    const [A, B, C] = [1, 2, 3].map((i) => db.find((v) => v.id === i));
    assert.deepEqual(['A', 'B', 'C'].map((L, i) => variantOf(db[i]).letter), ['A', 'B', 'C']); assert.equal(variantOf(A).group, 1); assert.equal(variantOf(B).group, 1); assert.equal(variantOf(C).format, 'C'); assert.equal(variantOf(A).rotation, 0);
    assert.equal(B.stage, 'checked'); assert.equal(C.stage, 'checked'); assert.equal(B.title, 'Кофе');
    const dB = path.join(ROOT, 'smm', 'runs', 'video_2'), dC = path.join(ROOT, 'smm', 'runs', 'video_3');
    assert.match(fs.readFileSync(path.join(dB, 'script_ru.txt'), 'utf8'), /Пятьдесят мужчин[\s\S]*Ставь лайк и подписывайся\.\n$/); assert.ok(fs.existsSync(path.join(dB, 'FACTS.md')), 'факты скопированы'); assert.ok(fs.existsSync(path.join(dB, 'ledger.json')));
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dC, 'skeptic.json'), 'utf8')).length, 4); assert.equal(fs.existsSync(path.join(dB, 'skeptic.json')), false, 'скептик только у C');
    assert.equal(calls.filter((c) => c.label.startsWith('variant_B')).length, 1, 'B принят с первого круга'); assert.equal(calls.filter((c) => c.label.startsWith('variant_C')).length, 1, 'C принят с первого круга');
    assert.doesNotMatch(notified[0]?.text || '', /Автопроверки не приняли до конца/);
    assert.equal(notified.length, 1, 'одна карточка на группу');
    const { text, buttons } = notified[0]; const flat = buttons.flat();
    assert.match(text, /Варианты сценария \(A, B, C\)/); assert.match(text, /Вариант A · «Лента»/); assert.match(text, /Вариант B · «Один объект» · крючок «цифра»/); assert.match(text, /Вариант C · «Диалог»/); assert.match(text, /💬 Скептик: «Кофе же сушит\?»/);
    assert.match(text, /Порядок выхода: A → B → C, интервал 30 минут/); assert.match(text, /Вера сверила варианты/); assert.match(text, /Различия между вариантами проверены кодом/);
    assert.deepEqual(flat.map((b) => b[1]), ['approve:1', 'revise:1', 'vregen:1', 'reject:1', 'vdrop:1', 'vdrop:2', 'vdrop:3']); assert.equal(flat[0][0], 'Утвердить все три');
  } finally { done(); }
});

test('почти копия варианта A отклоняется автопроверкой и пишется заново; задание второго круга называет причину', async () => {
  try {
    seedA(); plans.B = [mk(SA.map((s) => s.replace('Британцы', 'Англичане')), 'вопрос-ловушка'), mk(SB, 'цифра')];
    const flow = mkFlow(); const r = await flow.variantsFlow(1);
    assert.deepEqual(r.ready, ['A', 'B', 'C']); const b = calls.filter((c) => c.label.startsWith('variant_B'));
    assert.equal(b.length, 2, 'два круга для B'); assert.match(b[1].task, /обязан отличаться/); assert.match(b[1].task, /тип крючка|совпадени|концовка/);
  } finally { done(); }
});

test('новые числа, которых нет в проверенных фактах, возвращаются Ксении', async () => {
  try {
    seedA(); plans.B = [mk([...SB.slice(0, 3), 'Утренний кофе безопасен: 70 процентов участников не заметили разницы.'], 'цифра'), mk(SB, 'цифра')];
    const flow = mkFlow(); await flow.variantsFlow(1); const b = calls.filter((c) => c.label.startsWith('variant_B'));
    assert.equal(b.length, 2); assert.match(b[1].task, /числа, которых нет в проверенных фактах: 70/);
  } finally { done(); }
});

test('формат C без реплик скептика не принимается, с вердикт-словом в реплике тоже', async () => {
  try {
    seedA(); const noSk = mk(SC, 'контраст'); const verdict = mk(SC, 'контраст', { skeptic: ['Это миф, да?', 'И что?', 'А доказательства?', 'Ну ладно?'] });
    plans.C = [noSk, verdict, mk(SC, 'контраст', { skeptic: ['Кофе же сушит?', 'И что, никто не проверял?', 'Но моча же светлеет?', 'Значит, можно пить?'] })];
    const flow = mkFlow(); await flow.variantsFlow(1); const c = calls.filter((c) => c.label.startsWith('variant_C'));
    assert.equal(c.length, 3); assert.match(c[1].task, /ровно 4 непустых реплик/); assert.match(c[2].task, /вердикт/);
  } finally { done(); }
});

test('вариант не получился (нет файла за все круги): запись отклонена, группа идёт без него, в карточке честная пометка', async () => {
  try {
    seedA(); plans.C = [];
    const flow = mkFlow(); const r = await flow.variantsFlow(1);
    assert.deepEqual(r.ready, ['A', 'B']); assert.equal(r.failed.length, 1); assert.equal(r.failed[0].letter, 'C');
    assert.equal(db.find((v) => v.id === 3).stage, 'rejected'); const { text, buttons } = notified[0];
    assert.match(text, /Варианты сценария \(A, B\)/); assert.match(text, /Вариант C не получился/); assert.equal(buttons.flat()[0][0], 'Утвердить оба'); assert.doesNotMatch(buttons.flat().map((b) => b[1]).join(), /vdrop:3/);
    assert.equal(calls.filter((c) => c.label.startsWith('variant_C')).length, 3, 'три круга и отказ (решение Ника 2026-10-21)');
  } finally { done(); }
});

test('Вера нашла расхождение в варианте B: Ксения исправляет только его, вторая сверка проходит', async () => {
  try {
    seedA(); veraPlan = [{ verdict: 'fix', summary: 'есть расхождения', items: [{ letter: 'B', text: 'график позволяет', problem: 'вывод усилен: в исследовании 50 мужчин', fix: 'добавить оговорку про 50 мужчин' }] }, { verdict: 'pass', summary: 'теперь чисто', items: [] }];
    plans.B = [mk(SB, 'цифра'), mk([...SB.slice(0, 3), 'Утренний кофе можно оставить: по данным опыта на пятидесяти мужчинах.'], 'цифра')];
    const flow = mkFlow(); await flow.variantsFlow(1);
    assert.equal(calls.filter((c) => c.label === 'variants_check').length, 2); const fix = calls.filter((c) => c.label.startsWith('variant_B')).pop();
    assert.match(fix.task, /Фактчекер просит исправить: вывод усилен/); assert.equal(calls.filter((c) => c.label.startsWith('variant_C')).length, 1, 'C не трогали');
    assert.match(fs.readFileSync(path.join(ROOT, 'smm', 'runs', 'video_2', 'script_ru.txt'), 'utf8'), /пятидесяти мужчинах/); assert.match(notified[0].text, /Вера сверила варианты.*теперь чисто/);
    // регрессия 21.10: после правки по замечаниям Веры Ксения оставалась «работает» (часами). Последний её статус обязан быть idle.
    const ks = statuses.filter((s) => s[0] === 'scriptwriter'); assert.ok(ks.some((s) => s[1] === 'working'), 'во время правки она работала'); assert.equal(ks[ks.length - 1][1], 'idle', 'после всех правок Ксения свободна: ' + JSON.stringify(ks.slice(-3)));
  } finally { done(); }
});

test('id из командной строки приходит строкой: метка группы всё равно число, варианты находят друг друга', async () => {
  try {
    seedA(); const flow = mkFlow(); await flow.variantsFlow('1'); const B = db.find((v) => v.id === 2);
    assert.strictEqual(variantOf(B).group, 1); assert.strictEqual(JSON.parse(B.notes).variant.group, 1, 'в базу пишется число');
    assert.equal(groupMembers(db, db[0]).length, 3); db.find((v) => v.id === 2).notes = db.find((v) => v.id === 2).notes.replace('"group":1', '"group":"1"');
    assert.strictEqual(variantOf(db.find((v) => v.id === 2)).group, 1, 'прежние записи со строкой читаются как число'); assert.equal(groupMembers(db, db[0]).length, 3);
    await flow.groupCard('1'); assert.equal(notified.length, 2);
  } finally { done(); }
});

test('варианты выключены (VARIANT_FORMATS=A): ничего не создаётся и карточка не уходит', async () => {
  try {
    process.env.VARIANT_FORMATS = 'A'; seedA(); const flow = mkFlow(); const r = await flow.variantsFlow(1);
    assert.equal(r.skipped, true); assert.equal(db.length, 1); assert.equal(notified.length, 0); assert.equal(calls.length, 0);
  } finally { done(); }
});

test('только B (VARIANT_FORMATS=A,B): два сценария, без C', async () => {
  try { process.env.VARIANT_FORMATS = 'A,B'; seedA(); const flow = mkFlow(); const r = await flow.variantsFlow(1); assert.deepEqual(r.ready, ['A', 'B']); assert.equal(db.length, 2); } finally { done(); }
});

test('порядок выхода вращается: у второй группы первым идёт B; повторный запуск не создаёт записи заново', async () => {
  try {
    seedA(1); const flow = mkFlow(); await flow.variantsFlow(1);
    seedA(10); db.find((v) => v.id === 10).title = 'Шаги'; nextId = 11; await flow.variantsFlow(10);
    assert.equal(variantOf(db.find((v) => v.id === 10)).rotation, 1); assert.match(notified[1].text, /Порядок выхода: B → C → A/);
    const before = db.length; plans.B = []; plans.C = []; await flow.variantsFlow(1); assert.equal(db.length, before, 'уже созданные варианты не плодятся и не переписываются'); assert.equal(groupMembers(db, db[0]).length, 3);
  } finally { done(); }
});

test('карточка группы по состоянию: убранный вариант исчезает, кнопки пересобираются без запросов к моделям', async () => {
  try {
    seedA(); const flow = mkFlow(); await flow.variantsFlow(1); const n0 = calls.length;
    db.find((v) => v.id === 3).stage = 'rejected'; await flow.groupCard(1, { note: '🗑 Вариант C убран.' });
    assert.equal(calls.length, n0, 'моделей не вызывали'); const { text, buttons } = notified[1]; assert.match(text, /Варианты сценария \(A, B\)/); assert.match(text, /Вариант C убран/); assert.doesNotMatch(text, /Вариант C ·/); assert.equal(buttons.flat()[0][0], 'Утвердить оба');
    db.find((v) => v.id === 2).stage = 'rejected'; await flow.groupCard(1); assert.equal(notified[2].buttons.flat()[0][0], 'Утвердить сценарий'); assert.doesNotMatch(notified[2].text, /Скептик|Вариант B ·/);
    db.find((v) => v.id === 1).stage = 'rejected'; await assert.rejects(flow.groupCard(1), /нет сценариев на утверждение/);
  } finally { done(); }
});

test('правка Ника к варианту B: Ксения правит именно его, остальные не трогаются, карточка обновляется', async () => {
  try {
    seedA(); const flow = mkFlow(); await flow.variantsFlow(1); const nB = calls.filter((c) => c.label.startsWith('variant_B')).length, nC = calls.filter((c) => c.label.startsWith('variant_C')).length;
    plans.B = [mk([SB[0], SB[1], SB[2], 'Утренний кофе можно оставить, график это позволяет, и точка.'], 'цифра')];
    await flow.reviseVariant(2, 'сделай концовку короче');
    const b = calls.filter((c) => c.label.startsWith('variant_B')); assert.equal(b.length, nB + 1); assert.match(b.pop().task, /Правка Ника к этому варианту: сделай концовку короче/);
    assert.equal(calls.filter((c) => c.label.startsWith('variant_C')).length, nC, 'C не трогали'); const last = notified[notified.length - 1]; assert.match(last.text, /Вариант B исправлен по вашим правкам/); assert.match(last.text, /точка/);
    await assert.rejects(flow.reviseVariant(999, 'x'), /нет роликa|undefined|метки/);
  } finally { done(); }
});

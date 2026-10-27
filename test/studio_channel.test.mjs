// Профиль канала: тяжёлые темы и узкая аудитория отсеиваются кодом, агенты получают контекст канала, файл профиля создаётся и не затирает правки владельца.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.OFFICE_STUDIO_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-chan-'));
const C = await import('../scripts/studio_channel.mjs');
const P = C.profileOf('med_detective', { name: 'Медицинский детектив' });

test('темы, которые Ник отклонил (болезни, неотложка, узкие группы), отсеиваются', () => {
  for (const title of P.badExamples.concat([
    'Правда ли, что сахарный диабет бывает от того, что ешь много сладкого?', 'Правда ли, что инфаркт всегда начинается с сильной боли в груди?', 'Правда ли, что инсульт бывает только у пожилых?',
    'Правда ли, что если в семье ни у кого не было рака груди, то он вам не грозит?', 'Правда ли, что лейкоз — это всегда смертный приговор?', 'Правда ли, что при эпилептическом приступе человеку нужно разжать зубы ложкой?',
    'Правда ли, что можно отравиться наркотиком, просто дотронувшись до поверхности или купюры с его следами?', 'Правда ли, что беременным нельзя красить волосы?', 'Правда ли, что ковид оставляет последствия на всю жизнь?',
    'Правда ли, что деменцию можно предотвратить кроссвордами?', 'Правда ли, что мобильный телефон вызывает рак мозга?', 'Правда ли, что после операции нужно лежать неделю?',
  ])) { const g = C.gateTopic({ title }, P); assert.equal(g.ok, false, title); assert.match(g.reason, /тяжёлая тема/); }
});
test('бытовые темы канала, которые реально выходили и зашли, проходят', () => {
  for (const title of P.goodExamples.concat([
    'Если много потеть = можно быстро похудеть', 'Глютамат натрия — яд', 'Чем выше пульс — тем хуже', 'Миф: мазать окна йогуртом, чтобы охладиться?', 'Можно ли спать в контактных линзах?', 'Правда ли, что диетические напитки ускоряют старение мозга?',
    'Зелёные яблоки полезнее красных?', 'Что происходит с телом, если обедать за монитором?', 'Не спали всю ночь? Как быстро вернуть память и фокус', 'Правда ли, что хруст пальцев вызывает артрит?', 'Правда ли, что кофе обезвоживает организм?',
    'Правда ли, что от сладкого у детей гиперактивность?', 'Правда ли, что грейпфрут помогает худеть?',
  ])) assert.equal(C.gateTopic({ title }, P).ok, true, title);
});
test('границы слов: «ракета», «раковина», «страх», «вичуга» не срабатывают; формы слов ловятся', () => {
  for (const ok of ['Ракета на кухне: правда ли, что микроволновка портит воду?', 'Раковина и зубная паста: что лучше?', 'Почему нам страшно и как это связано с дыханием?', 'Правда ли, что ночной режим смартфона помогает уснуть?']) assert.equal(C.gateTopic({ title: ok }, P).ok, true, ok);
  for (const bad of ['Рака не бывает от сладкого?', 'Диабетик ли вы: тест', 'Инсультом можно заболеть в молодости?', 'От ВИЧ спасает презерватив?']) assert.equal(C.gateTopic({ title: bad }, P).ok, false, bad);
});
test('оценка разведчика: ниже 4 отсеивается, без оценки и с высокой проходит; слова из пожелания Ника снимают запрет', () => {
  assert.equal(C.gateTopic({ title: 'Правда ли, что витамин D нужен всем?', audience_fit: 3, fit_note: 'скорее для пожилых' }, P).ok, false);
  assert.match(C.gateTopic({ title: 'Правда ли, что витамин D нужен всем?', audience_fit: 3, fit_note: 'скорее для пожилых' }, P).reason, /3 из 5: скорее для пожилых/);
  assert.equal(C.gateTopic({ title: 'Правда ли, что витамин D нужен всем?', audience_fit: 4 }, P).ok, true); assert.equal(C.gateTopic({ title: 'Правда ли, что витамин D нужен всем?' }, P).ok, true);
  assert.equal(C.gateTopic({ title: 'Правда ли, что диабет бывает от сладкого?' }, P, { hint: 'про диабет' }).ok, true, 'Ник сам попросил про диабет');
  assert.equal(C.gateTopic({ title: 'Правда ли, что диабет бывает от сладкого?' }, P, { hint: 'про сон' }).ok, false);
  assert.equal(C.gateTopic({ title: 'Что угодно про рак' }, null).ok, true, 'у канала без профиля отсева нет');
  assert.equal(C.gateItem({ title: 'Новый препарат от лейкоза прошёл испытания' }, P).ok, false); assert.equal(C.gateItem({ title: 'Why coffee before a nap works' }, P).ok, true);
});
test('профиль канала у остальных каналов не появляется сам; свои поля канала дополняют и перекрывают умолчание', () => {
  assert.equal(C.profileOf('другой', { name: 'Другой' }), null);
  const mine = C.profileOf('med_detective', { profile: { avoidTerms: ['пицц\\p{L}*'] } }); assert.equal(C.gateTopic({ title: 'Рак от пиццы?' }, mine).ok, false); assert.equal(C.gateTopic({ title: 'Диабет от сладкого?' }, mine).ok, true);
  assert.equal(C.profileOf('новый', { profile: { concept: 'c', avoidTerms: [] } }).concept, 'c');
});
test('блок для разведчика: канал, аудитория, рубрики, что подходит и что нет, три вопроса, поля оценки; для ролика только «миф»', () => {
  const posts = C.profileBrief(P, 'posts'), video = C.profileBrief(P, 'video');
  for (const re of [/ПРОФИЛЬ КАНАЛА/, /18-45/, /НЕ ПОДХОДИТ/, /рак, инфаркт, инсульт, диабет/, /audience_fit/, /fit_note/, /20-40 лет/, /Сахарный диабет бывает от сладкого/, /Глютамат натрия/]) { assert.match(posts, re); assert.match(video, re); }
  assert.match(posts, /body «Что будет с телом, если…»/); assert.match(posts, /season «Паниковать или нет»/); assert.doesNotMatch(video, /body «/); assert.match(video, /только myth/);
  assert.equal(C.profileBrief(null), ''); assert.match(C.profileLine(P), /18-45[\s\S]*не должен звучать как справочник/); assert.equal(C.profileLine(null), '');
});
test('файл профиля: создаётся для автора и редактора, обновляется при новой редакции, редакцию владельца (без пометки) не трогает', () => {
  const ch = { name: 'Медицинский детектив' }, f = C.ensureProfileFile('med_detective', ch);
  assert.equal(f, C.profileFile('med_detective')); const doc = fs.readFileSync(f, 'utf8'); assert.match(doc.split('\n')[0], /^<!-- auto-profile rev:\d+/); assert.match(doc, /# ДОКУМЕНТ 2 — профиль и голос канала «Медицинский детектив»/); assert.match(doc, /## Не подходит/); assert.match(doc, /Лейкоз — всегда смертный приговор/); assert.match(doc, /verdict "rework"/);
  fs.writeFileSync(f, doc.replace(/^<!--.*-->/, '<!-- auto-profile rev:0; старая -->'), 'utf8'); C.ensureProfileFile('med_detective', ch); assert.match(fs.readFileSync(f, 'utf8').split('\n')[0], new RegExp(`rev:${C.PROFILE_REV};`), 'устаревшая автоверсия обновлена');
  fs.writeFileSync(f, 'Мой собственный голос канала\n', 'utf8'); C.ensureProfileFile('med_detective', ch); assert.equal(fs.readFileSync(f, 'utf8'), 'Мой собственный голос канала\n', 'правка владельца цела');
  assert.equal(C.ensureProfileFile('нет_такого', {}), '');
});

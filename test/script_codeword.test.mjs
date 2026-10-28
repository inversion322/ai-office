import { test } from 'node:test';
import assert from 'node:assert/strict';
import { codewordIssues, codewordFeedback, codewordTaskBlock } from '../scripts/script_codeword.mjs';

const CTA = { codeword: 'ДОСЬЕ', bot: '@med_detective_bot' };
// решение Ника 2026-10-28: слово только в начале (одно обещание по его формуле) и в конце (призыв); напоминалок в середине нет
const PROMISE = 'Почему? Досмотри до конца. Там же будет слово для бесплатного файла с тридцатью самыми популярными мифами.';
const GOOD = [
  'Обходишь дорожку после силовых? Десять недель люди тягали штангу, и сила росла. Потом она упала. ' + PROMISE,
  'Это опыт Хиксона. Кроме штанги, у них было кардио.',
  'Взглянем на тренировки. Штанга пять дней, кардио шесть.',
  'Спустя сорок лет сверили сорок три опыта. Мышцы выросли одинаково.',
  'Это миф. Кардио мышцы не съедает.',
];
const rules = (s, c = CTA) => codewordIssues(s, c).map((x) => x.rule);

test('сценарий с одним обещанием по формуле Ника и без напоминалок в середине проходит', () => {
  assert.deepEqual(rules(GOOD), []);
});

test('формула Ника: «Досмотри до конца», «бесплатного», «файла», «с тридцатью самыми популярными мифами» обязательны; «до конца» засчитывается как «в конце»', () => {
  const noFormula = ['Обходишь дорожку? Сила росла. Почему упала, скажу в конце. Там же слово для файла с тридцатью разборами.', ...GOOD.slice(1)];
  const r = codewordIssues(noFormula, CTA).filter((x) => x.rule === 'promise-formula');
  assert.equal(r.length, 1); assert.match(r[0].say, /«Досмотри до конца»/); assert.match(r[0].say, /«бесплатного» файла/); assert.match(r[0].say, /«с тридцатью самыми популярными мифами»/);
  assert.match(r[0].say, /Формула: «Почему\? Досмотри до конца\. Там же будет слово для бесплатного файла с тридцатью самыми популярными мифами\.»/);
  const partly = ['Обходишь дорожку? Сила росла. Досмотри до конца. Там же будет слово для файла с тридцатью самыми популярными мифами.', ...GOOD.slice(1)];
  const p = codewordIssues(partly, CTA).find((x) => x.rule === 'promise-formula'); assert.match(p.say, /«бесплатного» файла/); assert.doesNotMatch(p.say, /«Досмотри до конца»/);
  assert.ok(!rules(['Обходишь дорожку? Сила росла. ' + PROMISE, ...GOOD.slice(1)]).includes('promise-formula'));
});

test('нет обещания в абзацах 1-2: ловится; обещание в самой первой фразе ловится; обещание и в абзаце 1, и в абзаце 2 ловится', () => {
  assert.ok(rules(['Обходишь дорожку? Сила росла.', ...GOOD.slice(1)]).includes('promise-missing'));
  assert.ok(rules(['Досмотри до конца: там слово для бесплатного файла. Обходишь дорожку? Сила росла.', ...GOOD.slice(1)]).includes('promise-too-early'));
  const inSecond = ['Обходишь дорожку после силовых? Десять недель люди тягали штангу, и сила росла.', PROMISE + ' Это опыт Хиксона.', ...GOOD.slice(2)];
  assert.deepEqual(rules(inSecond), [], 'обещание в абзаце 2 засчитывается');
  assert.ok(rules([GOOD[0], PROMISE + ' Это опыт Хиксона.', ...GOOD.slice(2)]).includes('promise-twice'));
});

test('напоминалка в середине запрещена: «слово в конце», «слово близко», «дождись слова», «досмотри до конца» рядом со словом — все ловятся; обычное слово «слово» не трогается', () => {
  for (const mid of ['Слово в конце, не пропусти. Штанга пять дней, кардио шесть.', 'Слово уже близко. Штанга пять дней.', 'Дождись: слово ждёт в финале.', 'Слово скоро. Штанга пять дней.', 'Досмотри до конца: там слово. Штанга пять дней.']) {
    const r = codewordIssues([GOOD[0], GOOD[1], mid, GOOD[3], GOOD[4]], CTA);
    assert.ok(r.some((x) => x.rule === 'reminder-forbidden' && x.seg === 3), mid + ' → ' + JSON.stringify(r));
  }
  assert.deepEqual(rules([GOOD[0], GOOD[1], 'Он сказал одно слово: хватит. Штанга пять дней.', GOOD[3], GOOD[4]]), [], 'просто слово «слово» в середине не напоминалка');
  assert.deepEqual(rules([GOOD[0], GOOD[1], 'Пересчитали до конца. Штанга пять дней.', GOOD[3], GOOD[4]]), [], '«до конца» без слова «слово» не напоминалка');
  assert.ok(rules([GOOD[0], GOOD[1], GOOD[2], 'Слово в конце, держись. ' + GOOD[3], GOOD[4]]).includes('reminder-forbidden'));
});

test('само слово, бот и подписка в тексте до призыва запрещены; слово в вердикте запрещено', () => {
  assert.ok(rules([GOOD[0], 'Это опыт Хиксона: досье на кардио.', ...GOOD.slice(2)]).includes('word-leak'), 'регистр и е/ё не важны');
  assert.ok(rules([GOOD[0], 'Напиши боту, это опыт Хиксона.', ...GOOD.slice(2)]).includes('bot-or-subscribe'));
  assert.ok(rules([GOOD[0], 'Подпишись, это опыт Хиксона.', ...GOOD.slice(2)]).includes('bot-or-subscribe'));
  assert.ok(rules([...GOOD.slice(0, 4), 'Это миф. Слово ждёт в конце.']).includes('in-verdict'));
});

test('слова вне формулы не считаются: «десять слов», «в конце недели» без «слово» — не обещание', () => {
  const noPromise = ['Обходишь дорожку? В конце недели сила упала. Десять слов о кардио.', ...GOOD.slice(1)];
  assert.ok(rules(noPromise).includes('promise-missing'));
});

test('короткий сценарий без середины проходит; пустой сценарий не падает', () => {
  assert.deepEqual(rules([GOOD[0], GOOD[4]]), []);
  assert.deepEqual(rules([]), []);
});

test('обратная связь и блок задания дают формулу Ника дословно, называют слово и бота и запрещают напоминалки; без проблем обратной связи нет', () => {
  const fb = codewordFeedback(codewordIssues(['Хук.', 'Факт.', 'Вывод.'], CTA), CTA);
  assert.match(fb, /«ДОСЬЕ»/); assert.match(fb, /@med_detective_bot/); assert.match(fb, /ОДНО обещание по формуле Ника/); assert.match(fb, /Досмотри до конца\. Там же будет слово для бесплатного файла с тридцатью самыми популярными мифами\./); assert.match(fb, /ни напоминалок/); assert.match(fb, /не называй/);
  assert.equal(codewordFeedback([], CTA), '');
  const blk = codewordTaskBlock(CTA);
  assert.match(blk, /«ДОСЬЕ»/); assert.match(blk, /НЕ первой фразой/); assert.match(blk, /дословно «Досмотри до конца\. Там же будет слово для бесплатного файла с тридцатью самыми популярными мифами\.»/); assert.match(blk, /про слово НИЧЕГО/); assert.match(blk, /Ник их отменил/); assert.match(blk, /«мифами» внутри этой формулы разрешено/);
  assert.doesNotMatch(blk, /3-5 слов/, 'требования напоминалки в задании больше нет');
});

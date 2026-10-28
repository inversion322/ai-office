import { test } from 'node:test';
import assert from 'node:assert/strict';
import { codewordIssues, codewordFeedback, codewordTaskBlock } from '../scripts/script_codeword.mjs';

const CTA = { codeword: 'ДОСЬЕ', bot: '@med_detective_bot' };
// решение Ника 2026-10-28: слово только в начале (одно обещание) и в конце (призыв); напоминалок в середине нет
const GOOD = [
  'Обходишь дорожку после силовых? Десять недель люди тягали штангу, и сила росла. Почему упала, скажу в конце. Там же слово для файла с тридцатью разборами.',
  'Это опыт Хиксона. Кроме штанги, у них было кардио.',
  'Взглянем на тренировки. Штанга пять дней, кардио шесть.',
  'Спустя сорок лет сверили сорок три опыта. Мышцы выросли одинаково.',
  'Это миф. Кардио мышцы не съедает.',
];
const rules = (s, c = CTA) => codewordIssues(s, c).map((x) => x.rule);

test('сценарий с одним обещанием во втором предложении и без напоминалок в середине проходит', () => {
  assert.deepEqual(rules(GOOD), []);
});

test('нет обещания в абзацах 1-2: ловится; обещание в самой первой фразе ловится; обещание и в абзаце 1, и в абзаце 2 ловится', () => {
  assert.ok(rules(['Обходишь дорожку? Сила росла.', ...GOOD.slice(1)]).includes('promise-missing'));
  assert.ok(rules(['В конце скажу слово для файла. Обходишь дорожку? Сила росла.', ...GOOD.slice(1)]).includes('promise-too-early'));
  const inSecond = [GOOD[0].split(' Почему')[0], 'В конце — слово для файла с разборами. Это опыт Хиксона.', ...GOOD.slice(2)];
  assert.deepEqual(rules(inSecond), [], 'обещание в абзаце 2 засчитывается');
  assert.ok(rules([GOOD[0], 'В конце — слово для файла. Это опыт Хиксона.', ...GOOD.slice(2)]).includes('promise-twice'));
});

test('напоминалка в середине запрещена: «слово в конце», «слово близко», «дождись слова» — все ловятся; в абзацах 1-2 и без слова «слово» не трогается', () => {
  for (const mid of ['Слово в конце, не пропусти. Штанга пять дней, кардио шесть.', 'Слово уже близко. Штанга пять дней.', 'Дождись: слово ждёт в финале.', 'Слово скоро. Штанга пять дней.']) {
    const r = codewordIssues([GOOD[0], GOOD[1], mid, GOOD[3], GOOD[4]], CTA);
    assert.ok(r.some((x) => x.rule === 'reminder-forbidden' && x.seg === 3), mid + ' → ' + JSON.stringify(r));
  }
  assert.deepEqual(rules([GOOD[0], GOOD[1], 'Он сказал одно слово: хватит. Штанга пять дней.', GOOD[3], GOOD[4]]), [], 'просто слово «слово» в середине не напоминалка');
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

test('обратная связь и блок задания называют слово, бота, одно обещание и запрет напоминалок; без проблем обратной связи нет', () => {
  const fb = codewordFeedback(codewordIssues(['Хук.', 'Факт.', 'Вывод.'], CTA), CTA);
  assert.match(fb, /«ДОСЬЕ»/); assert.match(fb, /@med_detective_bot/); assert.match(fb, /ОДНА короткая фраза-обещание/); assert.match(fb, /ни напоминалок/); assert.match(fb, /не называй/);
  assert.equal(codewordFeedback([], CTA), '');
  const blk = codewordTaskBlock(CTA);
  assert.match(blk, /«ДОСЬЕ»/); assert.match(blk, /ВТОРОЙ фразой/); assert.match(blk, /про слово НИЧЕГО/); assert.match(blk, /Ник их отменил/); assert.match(blk, /лимит слов/);
  assert.doesNotMatch(blk, /3-5 слов/, 'требования напоминалки в задании больше нет');
});

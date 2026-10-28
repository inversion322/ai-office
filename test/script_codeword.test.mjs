import { test } from 'node:test';
import assert from 'node:assert/strict';
import { codewordIssues, codewordFeedback, codewordTaskBlock } from '../scripts/script_codeword.mjs';

const CTA = { codeword: 'ДОСЬЕ', bot: '@med_detective_bot' };
const GOOD = [
  'Обходишь дорожку после силовых? Десять недель люди тягали штангу, и сила росла. Почему упала, скажу в конце. Там же слово для файла с тридцатью разборами.',
  'Это опыт Хиксона. Кроме штанги, у них было кардио.',
  'Взглянем на тренировки. Слово в конце, не пропусти. Штанга пять дней, кардио шесть.',
  'Спустя сорок лет сверили сорок три опыта. Мышцы выросли одинаково.',
  'Это миф. Кардио мышцы не съедает.',
];
const rules = (s, c = CTA) => codewordIssues(s, c).map((x) => x.rule);

test('сценарий с обещанием во втором предложении и одной напоминалкой в середине проходит', () => {
  assert.deepEqual(rules(GOOD), []);
});

test('нет обещания в абзацах 1-2: ловится; обещание в самой первой фразе ловится (хук про тему)', () => {
  assert.ok(rules(['Обходишь дорожку? Сила росла.', ...GOOD.slice(1)]).includes('promise-missing'));
  assert.ok(rules(['В конце скажу слово для файла. Обходишь дорожку? Сила росла.', ...GOOD.slice(1)]).includes('promise-too-early'));
  const inSecond = [GOOD[0].split(' Почему')[0], 'В конце — слово для файла с мифами. Это опыт Хиксона.', ...GOOD.slice(2)];
  assert.deepEqual(rules(inSecond), [], 'обещание в абзаце 2 засчитывается');
});

test('напоминалка: нет — ловится, две — ловится; обещание не считается напоминалкой', () => {
  const none = [GOOD[0], GOOD[1], 'Взглянем на тренировки. Штанга пять дней, кардио шесть.', GOOD[3], GOOD[4]];
  assert.ok(rules(none).includes('reminder-missing'));
  const twice = [GOOD[0], GOOD[1], GOOD[2], 'Слово в конце, держись. ' + GOOD[3], GOOD[4]];
  assert.ok(rules(twice).includes('reminder-twice'));
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

test('короткий сценарий без середины не требует напоминалки; пустой сценарий не падает', () => {
  assert.deepEqual(rules([GOOD[0], GOOD[4]]), []);
  assert.deepEqual(rules([]), []);
});

test('обратная связь и блок задания называют слово, бота, обе фразы и лимит; без проблем обратной связи нет', () => {
  const fb = codewordFeedback(codewordIssues(['Хук.', 'Факт.', 'Вывод.'], CTA), CTA);
  assert.match(fb, /«ДОСЬЕ»/); assert.match(fb, /@med_detective_bot/); assert.match(fb, /напоминалк/); assert.match(fb, /не называй/);
  assert.equal(codewordFeedback([], CTA), '');
  const blk = codewordTaskBlock(CTA);
  assert.match(blk, /«ДОСЬЕ»/); assert.match(blk, /ВТОРОЙ фразой/); assert.match(blk, /3-5 слов/); assert.match(blk, /лимит слов/);
});

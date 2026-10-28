import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkCtaHtml as rawCheck, checkCta, ctaRulesFor, CTA_RULES } from '../scripts/check_cta.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REF = fs.readFileSync(path.join(ROOT, 'video', 'med_detective', 'CTA_REFERENCE.html'), 'utf8');
const REF_V1 = fs.readFileSync(path.join(ROOT, 'video', 'med_detective', 'CTA_REFERENCE_v1_subscribe.html'), 'utf8');   // прежний эталон «Подписывайтесь» (старые ролики)
const R = ctaRulesFor(path.join(os.tmpdir(), 'no-such-project')).R;        // правила призыва «кодовое слово» из video/cta.json (проект без script_ru.txt считается новым)
const checkCtaHtml = (h, r = R) => rawCheck(h, r);

test('эталон сцены призыва (его копирует Кирилл) сам проходит проверку', () => {
  assert.deepEqual(checkCtaHtml(REF).problems, []);
});

test('моноширинная ссылка на канал (как в ролике, который Нику не понравился) ловится', () => {
  const bad = REF.replace('.cta-pill {', '.cta-pill { font-family: "JetBrains Mono", ui-monospace, monospace;');
  const p = checkCtaHtml(bad).problems; assert.ok(p.some((x) => /моноширинный/.test(x)), p.join('; '));
});

test('призыв обычным регистром («Кодовое слово») ловится: должен быть как заголовки, заглавными', () => {
  const bad = REF;
  const p = checkCtaHtml(bad.replace(/<span class="cta-ch cta-w1">[^<]*<\/span>/g, (m) => m.toLowerCase())).problems; assert.ok(p.some((x) => /заглавными/.test(x)), p.join('; '));
});

test('призыв целой строкой, а не по буквам, ловится', () => {
  const bad = REF.replace(/<span class="cta-ch [^"]*">([^<]*)<\/span>/g, '$1');
  const p = checkCtaHtml(bad).problems; assert.ok(p.some((x) => /не набирается по буквам/.test(x)), p.join('; '));
});

test('медленные буквы (шаг 0,12 с) ловятся: «по буквам, но быстро»; нет шага вообще тоже ловится', () => {
  assert.ok(checkCtaHtml(REF.replace('const STEP = 0.035', 'const STEP = 0.12').replace('stagger: STEP', 'stagger: 0.12').replace('data-cta-step="0.035"', 'data-cta-step="0.12"')).problems.some((x) => /шаг между буквами 0\.12/.test(x)));
  assert.ok(checkCtaHtml(REF.replace(/stagger: STEP/g, '').replace('data-cta-step="0.035"', '')).problems.some((x) => /не задан шаг/.test(x)));
});

test('чужой шрифт (не Manrope) в сцене призыва ловится', () => {
  const p = checkCtaHtml(REF.replace('.cta-l1 {', '.cta-l1 { font-family: Georgia, serif;')).problems; assert.ok(p.some((x) => /чужой шрифт/.test(x)), p.join('; '));
});

test('@font-face с моноширинным шрифтом в подключении НЕ считается нарушением (он есть в каждой сцене проекта)', () => {
  const withFace = REF.replace('/* @font-face Manrope 600/800: как в соседних сценах */', "@font-face{font-family:'JetBrains Mono';font-weight:700;src:url('x.woff2')}");
  assert.deepEqual(checkCtaHtml(withFace).problems, []);
});

test('проект: нет композиций — пропуск; есть композиции без призыва — блок; хорошая сцена — ок', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cta-'));
  try {
    assert.equal(checkCta(dir).ok, true);
    fs.mkdirSync(path.join(dir, 'compositions'));
    fs.writeFileSync(path.join(dir, 'compositions', 's01.html'), '<div>ОТКУДА ЭТА</div>');
    const r1 = checkCta(dir); assert.equal(r1.ok, false); assert.match(r1.problems[0], /не найдена сцена призыва/);
    fs.writeFileSync(path.join(dir, 'compositions', 's18.html'), REF);
    const r2 = checkCta(dir); assert.equal(r2.ok, true); assert.equal(r2.file, 's18.html');
    fs.writeFileSync(path.join(dir, 'compositions', 's18.html'), REF.replace('.cta-pill {', '.cta-pill { font-family: monospace;'));
    assert.equal(checkCta(dir).ok, false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('английская версия (lang.json = en): сцена SUBSCRIBE проходит, русский призыв в английском ролике не засчитывается', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cta_en_')); fs.mkdirSync(path.join(dir, 'compositions'));
  try {
    fs.writeFileSync(path.join(dir, 'lang.json'), JSON.stringify({ lang: 'en' }));
    // английская копия эталона: заголовок и остальные буквы по-английски, класс .cta-ch у каждой буквы сохранён
    const en = REF.replace(/ПОДПИСЫВАЙТЕСЬ/g, 'SUBSCRIBE');
    const letters = (w) => w.split('').map((ch) => `<span class="cta-ch">${ch}</span>`).join('');
    const sceneEn = `<html><body><div>${letters('SUBSCRIBE')}${letters('TELEGRAMCHANNEL')}${letters('LINKINBIO')}</div><style>.cta-ch{font-family:Manrope}</style><script>gsap.from('.cta-ch',{stagger:0.04})</script></body></html>`;
    fs.writeFileSync(path.join(dir, 'compositions', 'cta.html'), sceneEn);
    const ok = checkCta(dir); assert.equal(ok.ok, true, ok.problems.join('; '));
    fs.writeFileSync(path.join(dir, 'compositions', 'cta.html'), en.replace(/SUBSCRIBE/g, 'Subscribe').replace(/<span class="cta-ch[^"]*">[^<]*<\/span>/g, ''));
    const bad = checkCta(dir); assert.equal(bad.ok, false);
    fs.writeFileSync(path.join(dir, 'compositions', 'cta.html'), REF);            // русский призыв в английском проекте: сцены SUBSCRIBE нет
    const ru = checkCta(dir); assert.equal(ru.ok, false); assert.match(ru.problems.join(' '), /SUBSCRIBE/);
  } finally { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 }); }
});

test('кодовое слово и имя бота обязаны стоять на экране: без «ДОСЬЕ» или без @med_detective_bot призыв не проходит', () => {
  assert.ok(R.must.includes('ДОСЬЕ') && R.must.includes('@med_detective_bot'), 'правила берутся из video/cta.json');
  const noWord = REF.replace(/<div class="cta-line cta-l2"[\s\S]*?<\/div>\n/, '');
  assert.ok(checkCtaHtml(noWord).problems.some((x) => /нет «ДОСЬЕ»/.test(x)), checkCtaHtml(noWord).problems.join('; '));
  const noBot = REF.replace(/<div class="cta-line cta-l4"[\s\S]*?<\/div>\n/, '');
  assert.ok(checkCtaHtml(noBot).problems.some((x) => /нет «@med_detective_bot»/.test(x)));
});

test('слово обязано ЗВУЧАТЬ: words.json без «досье» блокирует, с ним (в любом регистре, е/ё) проходит; без words.json не проверяется', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cta_w_')); fs.mkdirSync(path.join(dir, 'compositions'));
  try {
    fs.writeFileSync(path.join(dir, 'compositions', 's20.html'), REF);
    assert.equal(checkCta(dir).ok, true, 'озвучки ещё нет');
    fs.writeFileSync(path.join(dir, 'words.json'), JSON.stringify([{ text: 'Слово', start: 0, end: 0.3 }, { text: 'бота.', start: 0.4, end: 0.8 }]));
    const bad = checkCta(dir); assert.equal(bad.ok, false); assert.match(bad.problems.join(' '), /не звучит в озвучке/);
    fs.writeFileSync(path.join(dir, 'words.json'), JSON.stringify([{ text: 'Слово', start: 0, end: 0.3 }, { text: '«Досье».', start: 0.4, end: 0.8 }]));
    assert.equal(checkCta(dir).ok, true);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('старый ролик (последний абзац script_ru.txt это прежний призыв) принимается по прежнему эталону «Подписывайтесь»; новый эталон в нём не нужен', () => {
  const cta = JSON.parse(fs.readFileSync(path.join(ROOT, 'video', 'cta.json'), 'utf8'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cta_old_')); fs.mkdirSync(path.join(dir, 'compositions'));
  try {
    fs.writeFileSync(path.join(dir, 'script_ru.txt'), `Хук.\n\n${cta.previous_voice_ru[1]}\n`);
    fs.writeFileSync(path.join(dir, 'compositions', 's20.html'), REF_V1);
    const ok = checkCta(dir); assert.equal(ok.ok, true, ok.problems.join('; '));
    fs.writeFileSync(path.join(dir, 'script_ru.txt'), `Хук.\n\n${cta.voice_ru}\n`);           // тот же проект, но призыв уже новый: прежняя сцена не годится
    const bad = checkCta(dir); assert.equal(bad.ok, false); assert.match(bad.problems.join(' '), /КОДОВОЕ СЛОВО/);
    fs.writeFileSync(path.join(dir, 'compositions', 's20.html'), REF);
    assert.equal(checkCta(dir).ok, true);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

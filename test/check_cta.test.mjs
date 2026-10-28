import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkCtaHtml, checkCta } from '../scripts/check_cta.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REF = fs.readFileSync(path.join(ROOT, 'video', 'med_detective', 'CTA_REFERENCE.html'), 'utf8');

test('эталон сцены призыва (его копирует Кирилл) сам проходит проверку', () => {
  assert.deepEqual(checkCtaHtml(REF).problems, []);
});

test('моноширинная ссылка на канал (как в ролике, который Нику не понравился) ловится', () => {
  const bad = REF.replace('.cta-pill {', '.cta-pill { font-family: "JetBrains Mono", ui-monospace, monospace;');
  const p = checkCtaHtml(bad).problems; assert.ok(p.some((x) => /моноширинный/.test(x)), p.join('; '));
});

test('призыв обычным регистром («Подписывайтесь») ловится: должен быть как заголовки, заглавными', () => {
  const bad = REF.replace(/ПОДПИСЫВАЙТЕСЬ/g, 'Подписывайтесь').replace(/>П</, '>П<');
  const p = checkCtaHtml(bad.replace(/<span class="cta-ch cta-w1">[^<]*<\/span>/g, (m) => m.toLowerCase())).problems; assert.ok(p.some((x) => /заглавными/.test(x)), p.join('; '));
});

test('призыв целой строкой, а не по буквам, ловится', () => {
  const bad = REF.replace(/<span class="cta-ch [^"]*">([^<]*)<\/span>/g, '$1');
  const p = checkCtaHtml(bad).problems; assert.ok(p.some((x) => /не набирается по буквам/.test(x)), p.join('; '));
});

test('медленные буквы (шаг 0,12 с) ловятся: «по буквам, но быстро»; нет шага вообще тоже ловится', () => {
  assert.ok(checkCtaHtml(REF.replace('const STEP = 0.04', 'const STEP = 0.12').replace('stagger: STEP', 'stagger: 0.12').replace('data-cta-step="0.04"', 'data-cta-step="0.12"')).problems.some((x) => /шаг между буквами 0\.12/.test(x)));
  assert.ok(checkCtaHtml(REF.replace(/stagger: STEP/g, '').replace('data-cta-step="0.04"', '')).problems.some((x) => /не задан шаг/.test(x)));
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

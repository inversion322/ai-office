// Правила поста, оформление для Telegram и запрос обложки (чистые функции, без сети)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../scripts/studio_post.mjs';

const GOOD = `**Гомеопатия не лучше плацебо?** 🤔

Крупный обзор в 2015 году сравнил десятки исследований и не нашёл вещества, которое работает лучше пустышки

Самовнушение действительно помогает чувствовать себя лучше, но это не лечение

А вы пробовали? Как вам кажется, почему это так популярно?

🔬 Источники: [NHMRC](https://www.nhmrc.gov.au/x), [Cochrane](https://www.cochrane.org/y)

Больше разборов мифов о здоровье: [подписывайтесь на канал](https://t.me/med_detective_ru)`;
const OPT = { handle: 'med_detective_ru', medical: true };

test('хороший пост проходит все правила', () => { assert.deepEqual(P.postIssues(GOOD, OPT), []); });
test('нет жирного хука в первой строке', () => { assert.ok(P.postIssues(GOOD.replace('**Гомеопатия не лучше плацебо?**', 'Гомеопатия не лучше плацебо?'), OPT).some((i) => i.code === 'hook')); });
test('длина считается без разметки и ссылок; короткий пост до 700 знаков', () => {
  const long = GOOD.replace('Самовнушение', 'Слово '.repeat(130) + 'Самовнушение');
  assert.ok(P.postIssues(long, OPT).some((i) => i.code === 'long'));
  assert.equal(P.plainText('**Хук** и [ссылка](https://a.b/c)'), 'Хук и ссылка');
  assert.deepEqual(P.postIssues(long, { ...OPT, format: 'long' }).filter((i) => i.code === 'long'), [], 'в лонгриде лимит выше');
});
test('маркированные списки, перебор эмодзи, длинный абзац, приметы ИИ', () => {
  assert.ok(P.postIssues(GOOD.replace('Самовнушение действительно', '- Самовнушение действительно'), OPT).some((i) => i.code === 'list'));
  assert.ok(P.postIssues(GOOD.replace('А вы пробовали?', 'А вы пробовали? 😀😀😀'), OPT).some((i) => i.code === 'emoji'));
  assert.ok(P.postIssues(GOOD.replace('Самовнушение', 'Важно отметить, что самовнушение'), OPT).some((i) => i.code === 'ai'));
  assert.ok(P.postIssues(GOOD.replace('Самовнушение', 'слово '.repeat(120) + 'Самовнушение'), { ...OPT, format: 'long' }).some((i) => i.code === 'para'));
});
test('CTA-подписка ссылкой на канал обязателен; источники из разных доменов; лечебные советы запрещены', () => {
  assert.ok(P.postIssues(GOOD.replace('https://t.me/med_detective_ru', 'https://example.com'), OPT).some((i) => i.code === 'cta'));
  assert.ok(P.postIssues(GOOD.replace('https://www.cochrane.org/y', 'https://www.nhmrc.gov.au/z'), OPT).some((i) => i.code === 'sources'), 'два источника с одного домена не считаются');
  assert.deepEqual(P.postIssues(GOOD.replace(/🔬 Источники:[^\n]*\n\n/, ''), OPT), [], 'строку источников можно не писать вовсе');
  assert.ok(P.postIssues(GOOD.replace('Самовнушение', 'Принимайте 500 мг. Самовнушение'), OPT).some((i) => i.code === 'medical'));
  assert.deepEqual(P.postIssues(GOOD.replace('Самовнушение', 'Принимайте 500 мг. Самовнушение'), { handle: 'x_channel' }).filter((i) => i.code === 'medical'), [], 'у нелечебного канала проверка выключена');
  assert.equal(P.postIssues('', OPT)[0].code, 'empty');
});
test('точка в конце абзаца снимается, многоточие и вопрос остаются', () => {
  assert.equal(P.fixPunctuation('Первая мысль. Вторая мысль.\n\nТретья мысль...\n\nЧетвёртая?\n\nПятая мысль. 😀'), 'Первая мысль. Вторая мысль\n\nТретья мысль...\n\nЧетвёртая?\n\nПятая мысль 😀');
  assert.equal(P.fixPunctuation('**Хук.**'), '**Хук**');
});
test('HTML для Telegram: жирный, ссылки, экранирование, чужие теги не проходят', () => {
  assert.equal(P.toTgHtml('**Хук** <script>x</script> & [канал](https://t.me/a)'), '<b>Хук</b> &lt;script&gt;x&lt;/script&gt; &amp; <a href="https://t.me/a">канал</a>');
  assert.equal(P.toTgHtml('[x](javascript:alert(1))'), '[x](javascript:alert(1))', 'ссылки только http(s)');
});
test('форма выхода: подпись до 1024 = фото с подписью, длиннее = обложка и текст отдельно, без обложки = текст', () => {
  assert.equal(P.publishShape(GOOD, true).mode, 'photo'); assert.equal(P.publishShape(GOOD, false).mode, 'text');
  assert.equal(P.publishShape('**Х**\n\n' + 'слово '.repeat(250), true).mode, 'photo_then_text');
});
test('запрос обложки: без лиц и логотипов, текст на картинке только если нужен', () => {
  const a = P.coverPrompt({ scene: 'magnifying glass over pills', mood: 'calm' }), b = P.coverPrompt({ scene: 'x', text_on_image: 'Плацебо?' }, { palette: 'navy and orange' });
  assert.match(a, /Do not write any text/); assert.match(a, /No real people faces/); assert.match(b, /«Плацебо\?»/); assert.match(b, /navy and orange/); assert.doesNotMatch(b, /Do not write any text/);
});

test('стиль обложки (перенос из WorkFlow AI): по умолчанию фотореализм, названный стиль подставляет свою клаузу, неизвестный стиль и регистр не ломают; хвост качества стоит всегда', () => {
  const d = P.coverPrompt({ scene: 'A glass of water and a vinegar bottle on a kitchen table, morning light', mood: 'calm' });
  assert.match(d, /^A glass of water[^\n]*morning light\. Mood: calm\. Style: Professional photograph, photo-realistic rendering, sharp focus, editorial lighting, natural colors, high detail\./); assert.match(d, /Square 1:1 composition[^\n]*High quality, no artifacts\.$/);
  assert.doesNotMatch(d, /Editorial cover illustration|cartoon/i, 'мультяшки и «иллюстрации» по умолчанию нет');
  assert.match(P.coverPrompt({ scene: 's', style: 'Cartoon' }), /Style: Friendly cartoon illustration/); assert.match(P.coverPrompt({ scene: 's', style: 'minimalist' }), /Style: Minimalist geometric composition/);
  assert.match(P.coverPrompt({ scene: 's', style: 'oil painting' }), /Style: Professional photograph/, 'неизвестный стиль = фото'); assert.equal(P.normalizeCoverStyle(undefined), 'photo'); assert.deepEqual(Object.keys(P.COVER_STYLES), ['photo', 'illustration', 'infographic', 'cartoon', 'minimalist', 'poster']);
  assert.match(P.coverPrompt({ scene: 's' }, { styleClause: 'warm paper textures' }), /Match the channel's established cover identity: warm paper textures Keep visual consistency/);
  assert.match(P.coverPrompt({}), /^A calm, concrete real-world still life/, 'пустой сценарий не даёт пустого запроса');
});

test('запрос картинки: правки владельца идут отдельным указанием и главнее сцены; пустые отбрасываются, берутся последние пять', () => {
  const base = P.coverPrompt({ scene: 'a cup', mood: 'calm', text_on_image: '' }); assert.doesNotMatch(base, /Art director/);
  const withEdits = P.coverPrompt({ scene: 'a cup', mood: 'calm', text_on_image: '' }, { edits: ['', 'без банки', '  светлее ', 'a', 'b', 'c', 'd'] });
  assert.match(withEdits, /Art director's corrections[^\n]*override the scene above[^\n]*светлее \| a \| b \| c \| d\./); assert.doesNotMatch(withEdits, /без банки/, 'старее пяти правок отбрасывается');
  assert.match(P.coverPrompt({ scene: 's', text_on_image: 'Что внутри?' }, { edits: ['крупнее'] }), /Render exactly this short Russian text[^\n]*Что внутри\?[\s\S]*крупнее/);
});

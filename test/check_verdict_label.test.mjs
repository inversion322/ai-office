import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkVerdictLabels, sceneList } from '../scripts/check_verdict_label.mjs';

function project(scenes, indexExtra = '') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vl-')); fs.mkdirSync(path.join(dir, 'compositions'));
  const divs = scenes.map((s, i) => `<div id="e${i}" data-composition-id="s${i}" data-composition-src="compositions/${s.name}.html" data-start="${s.start}" data-duration="${s.dur}" data-track-index="1"></div>`).join('\n');
  fs.writeFileSync(path.join(dir, 'index.html'), `<html><head><title>Дело №04: МИФ</title></head><body><div id="root" data-duration="40">${divs}${indexExtra}</div></body></html>`);
  for (const s of scenes) fs.writeFileSync(path.join(dir, 'compositions', s.name + '.html'), s.html);
  return dir;
}
const S = [
  { name: 's01', start: 0, dur: 2, html: '<template><div><style>.mif{color:red}</style><span>ГОВОРЯТ,</span></div></template>' },
  { name: 's02', start: 1.5, dur: 3, html: '<div><span>10 000</span><div class="stamp"><span>ПРАВДА ЛИ ЭТО?</span></div></div>' },
  { name: 's09', start: 20, dur: 3, html: '<div>ФАКТ</div><script>/* МИФ в комментарии кода не считается */ const x = "число";</script>' },
  { name: 's17', start: 33, dur: 4, html: '<div class="stamp"><span>МИФ</span></div>' },
  { name: 's20', start: 37, dur: 3, html: '<div>ПОДПИСЫВАЙТЕСЬ</div>' },
];
test('сцены монтажа читаются из index.html (порядок атрибутов не важен), штамп вердикта в конце разрешён, «ПРАВДА ЛИ ЭТО?» в начале разрешено', () => {
  const dir = project(S);
  try {
    const sc = sceneList(fs.readFileSync(path.join(dir, 'index.html'), 'utf8')); assert.equal(sc.length, 5); assert.deepEqual(sc[3], { src: 'compositions/s17.html', start: 33, dur: 4 });
    const r = checkVerdictLabels(dir); assert.equal(r.checked, true); assert.deepEqual(r.problems.filter((p) => !/index\.html/.test(p)), [], r.problems.join('|'));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('штамп «МИФ?» во второй сцене (1,5 с) блокируется с именем сцены и временем; «МИФ» в <title> и в CSS не считается видимым текстом', () => {
  const dir = project([S[0], { ...S[1], html: '<div><span>10 000</span><span>МИФ?</span></div>' }, S[3], S[4]]);
  try {
    const r = checkVerdictLabels(dir); assert.equal(r.ok, false); assert.equal(r.problems.length, 1, r.problems.join('|'));
    assert.match(r.problems[0], /compositions\/s02\.html \(с 1\.5 с из 40\): «.*МИФ\?»/); assert.match(r.problems[0], /только после 24 с \(60% ролика\)/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('ярлык, который сцена собирает скриптом (строка ЗАГЛАВНЫМИ), ловится; обычный код и слово в комментарии нет', () => {
  const dir = project([S[0], { name: 's03', start: 4, dur: 2, html: '<div id="t"></div><script>document.getElementById("t").textContent = "ВЕРДИКТ: МИФ";</script>' }, S[3]]);
  try { const r = checkVerdictLabels(dir); assert.equal(r.problems.length, 1); assert.match(r.problems[0], /s03\.html/); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('метка поверх всего ролика (в index.html) блокируется как «с 0 с»; сцены без файла и проект без index.html не падают и не проверяются', () => {
  const dir = project([S[0], S[4]], '<div class="badge">МИФ</div>');
  try { const r = checkVerdictLabels(dir); assert.equal(r.ok, false); assert.match(r.problems[0], /^index\.html \(с 0\.0 с/); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'vl-')); try { assert.deepEqual(checkVerdictLabels(empty), { ok: true, problems: [], checked: false }); } finally { fs.rmSync(empty, { recursive: true, force: true }); }
});
test('VERDICT_GATE=off обходит проверку; порог 60% настраивается', () => {
  const dir = project([S[0], { ...S[1], html: '<span>МИФ?</span>' }, S[4]]);
  try {
    process.env.VERDICT_GATE = 'off'; assert.equal(checkVerdictLabels(dir).ok, true); delete process.env.VERDICT_GATE;
    assert.equal(checkVerdictLabels(dir, { after: 0.02 }).ok, true, 'сцена с 1,5 с уже после 2% ролика'); assert.equal(checkVerdictLabels(dir).ok, false);
  } finally { delete process.env.VERDICT_GATE; fs.rmSync(dir, { recursive: true, force: true }); }
});

test('английская версия (lang.json = en): MYTH в конце можно, в начале нельзя; «Is that true?» в хуке можно; в русском проекте английские слова не судятся', () => {
  const en = [
    { name: 's01', start: 0, dur: 2, html: '<div><span>SKIP THE TREADMILL?</span></div>' },
    { name: 's02', start: 1.5, dur: 3, html: '<div><span>IS THAT TRUE ?</span></div>' },
    { name: 's17', start: 33, dur: 4, html: '<div class="stamp"><span>MYTH</span></div>' },
    { name: 's20', start: 37, dur: 3, html: '<div>SUBSCRIBE</div>' },
  ];
  const dir = project(en); fs.writeFileSync(path.join(dir, 'lang.json'), JSON.stringify({ lang: 'en' }));
  try {
    const r = checkVerdictLabels(dir); assert.equal(r.ok, true, r.problems.join('; '));
    for (const bad of ['MYTH BUSTED', 'FAKE', 'Debunked!', 'TRUE', 'It is false', 'a lie']) {
      fs.writeFileSync(path.join(dir, 'compositions', 's01.html'), `<div><span>${bad}</span></div>`);
      const b = checkVerdictLabels(dir); assert.equal(b.ok, false, bad); assert.match(b.problems.join(' '), /s01/);
    }
    fs.writeFileSync(path.join(dir, 'compositions', 's01.html'), '<div><span>TRUE STORY OF 10 000</span></div><script>const label = "MYTH";</script>');
    assert.equal(checkVerdictLabels(dir).ok, false, 'штамп MYTH, набираемый скриптом в начале, ловится');
    fs.rmSync(path.join(dir, 'lang.json'));                       // без lang.json проект русский: английские слова не ярлыки
    fs.writeFileSync(path.join(dir, 'compositions', 's01.html'), '<div><span>MYTH</span></div>');
    assert.equal(checkVerdictLabels(dir).ok, true);
  } finally { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 }); }
});

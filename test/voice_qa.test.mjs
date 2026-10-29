// Карточка Нику по озвучке, которую не удалось починить (решение Ника 2026-10-29): отчёт voice_qa.json -> одна карточка с фразой и аудио.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { voiceQaSummary, voiceQaCardText, checkVoiceQa, watchVoiceQa, readVoiceQa } from '../scripts/voice_qa.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'vqa-'));
const rm = (d) => fs.rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
const FAILED = (ts = 1) => ({ status: 'failed', rounds: 2, ts, repaired: [{ chunk: 3, fix: 'запятая перед «пока»', words: ['пока'] }],
  failed: [{ chunk: 16, text: 'Восемь килограммов от утренней ложки уксуса пока миф.', words: ['пока', 'миф'], tried: ['запятая перед «пока»', 'тире перед «пока»'], audio: 'voice_qa_chunk16.mp3' }] });
const put = (d, qa) => fs.writeFileSync(path.join(d, 'voice_qa.json'), JSON.stringify(qa));

test('сводка: чисто, пропущено, починено, не починено — одной строкой, с номерами кусков', () => {
  assert.match(voiceQaSummary(null), /отчёта нет/); assert.match(voiceQaSummary({ status: 'clean' }), /чисто/);
  assert.match(voiceQaSummary({ status: 'skipped', note: 'сверка выключена' }), /не выполнялась \(сверка выключена\)/);
  assert.match(voiceQaSummary({ status: 'repaired', repaired: [{ chunk: 2, fix: 'тире перед «пока»' }] }), /починено автоматически \(кусок 2: тире перед «пока»\), слова те же/);
  assert.match(voiceQaSummary(FAILED()), /НЕ починено кусок 16 «пока миф»; починено: кусок 3: запятая перед «пока»/);
});

test('карточка: фраза куска, плохие слова, что пробовали, что уже починено, что делать дальше; ничего лишнего', () => {
  const t = voiceQaCardText({ id: 153, title: 'Яблочный уксус', tag: ' · вариант A', qa: FAILED() });
  for (const re of [/ролика №153 «Яблочный уксус» · вариант A/, /кусок 16: «Восемь килограммов от утренней ложки уксуса пока миф\.»/, /«пока», «миф»/, /Пробовал: перегенерации, запятая перед «пока»; тире перед «пока»/, /Починено само: кусок 3/, /Монтаж идёт с этой озвучкой/, /напиши, чем заменить слово/]) assert.match(t, re, String(re));
});

test('одна карточка на один отчёт: ушла — второй раз не уходит; новый отчёт (другое время) — уходит снова; починено и чисто — тишина', async () => {
  const d = tmp(), sent = [];
  const notify = async (text, audio) => sent.push({ text, audio });
  try {
    fs.writeFileSync(path.join(d, 'voice_qa_chunk16.mp3'), 'x');
    assert.equal(await checkVoiceQa(d, { id: 5, title: 'T', notify }), 'none', 'отчёта ещё нет');
    put(d, { status: 'repaired', ts: 1, repaired: [{ chunk: 1, fix: 'a' }], failed: [] }); assert.equal(await checkVoiceQa(d, { id: 5, title: 'T', notify }), 'none');
    put(d, { status: 'clean', ts: 2 }); assert.equal(await checkVoiceQa(d, { id: 5, title: 'T', notify }), 'none'); assert.equal(sent.length, 0);
    put(d, FAILED(10)); assert.equal(await checkVoiceQa(d, { id: 5, title: 'T', notify }), 'sent'); assert.equal(sent.length, 1);
    assert.deepEqual(sent[0].audio, [path.join(d, 'voice_qa_chunk16.mp3')]); assert.match(sent[0].text, /ролика №5/);
    assert.equal(await checkVoiceQa(d, { id: 5, title: 'T', notify }), 'already'); assert.equal(sent.length, 1);
    put(d, FAILED(11)); assert.equal(await checkVoiceQa(d, { id: 5, title: 'T', notify }), 'sent', 'другая озвучка — другой отчёт — новая карточка'); assert.equal(sent.length, 2);
    fs.rmSync(path.join(d, 'voice_qa_chunk16.mp3')); fs.rmSync(path.join(d, 'voice_qa.notified')); assert.equal(await checkVoiceQa(d, { id: 5, title: 'T', notify }), 'sent'); assert.deepEqual(sent[2].audio, [], 'нет файла аудио: карточка всё равно уходит, без вложения');
  } finally { rm(d); }
});

test('сбой отправки не ставит метку «ушла»: карточка повторится на следующем проходе', async () => {
  const d = tmp(); let fail = true, n = 0;
  try {
    put(d, FAILED(7));
    await assert.rejects(checkVoiceQa(d, { id: 1, title: 'T', notify: async () => { n++; if (fail) throw new Error('нет связи'); } }), /нет связи/);
    assert.ok(!fs.existsSync(path.join(d, 'voice_qa.notified')));
    fail = false; assert.equal(await checkVoiceQa(d, { id: 1, title: 'T', notify: async () => { n++; } }), 'sent'); assert.equal(n, 2);
  } finally { rm(d); }
});

test('наблюдатель: пока монтажёр работает, карточка уходит сразу после появления отчёта с провалом, а не в конце', async () => {
  const d = tmp(), sent = [];
  const stop = watchVoiceQa(d, { id: 9, title: 'T', notify: async (text) => sent.push(text) }, { intervalMs: 40 });
  try {
    await new Promise((r) => setTimeout(r, 120)); assert.equal(sent.length, 0, 'отчёта нет — тишина');
    put(d, FAILED(3)); for (let i = 0; i < 40 && !sent.length; i++) await new Promise((r) => setTimeout(r, 50));
    assert.equal(sent.length, 1); await new Promise((r) => setTimeout(r, 200)); assert.equal(sent.length, 1, 'повторно не шлёт');
  } finally { stop(); rm(d); }
  assert.deepEqual(readVoiceQa(path.join(os.tmpdir(), 'нет-такого-проекта')), null);
});

test('знаки ударения из озвучки («В+осемь», «м+иф.») в карточку и сводку не попадают', () => {
  const qa = { status: 'failed', ts: 1, failed: [{ chunk: 16, text: 'В+осемь килогр+аммов +уксуса пока м+иф.', words: ['пока', 'м+иф.'], tried: [] }] };
  const t = voiceQaCardText({ id: 1, title: 'T', qa }); assert.match(t, /«Восемь килограммов уксуса пока миф\.»/); assert.match(t, /«пока», «миф»/); assert.doesNotMatch(t, /\+/);
  assert.match(voiceQaSummary(qa), /кусок 16 «пока миф»/);
});

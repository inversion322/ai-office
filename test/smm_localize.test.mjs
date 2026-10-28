import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { skipInCopy, baseVersion } from '../scripts/smm_localize.mjs';

test('в рабочую копию для английской версии не попадают итоги, кадры, журналы и русская озвучка; сборка, композиции и план библиотеки попадают', () => {
  for (const n of ['final', '_frames', '_frames_v2', '_snap_a', '_motion', '_render_rounds.json', 'narration.mp3', 'words.json', 'captions.srt', 'captions_v2.srt', 'RESULT.md', 'RESULT_v2.md', 'PROGRESS.md',
    '_build_log.txt', '_render_log_b1.txt', '_finalize.json', '_narrate_log2.txt', 'poster.png', 'contact_sheet_v2.png', 'v1_archive']) assert.equal(skipInCopy(n), true, n);
  for (const n of ['_parts', 'build_dosie152.py', 'build_dosie109_v2.py', 'compositions', 'assets', 'STORYBOARD.json', 'LIBRARY_PLAN.json', 'REVIEW_LOG.json', 'script_ru.txt', 'FACTS.md', 'run_all.sh', 'format.json', 'index.html', 'library_blocks', 'finalize.py', 'mix_sfx.py'])
    assert.equal(skipInCopy(n), false, n);
});

test('основа английской версии: самая свежая версия русского ролика (v2 важнее v1, nomusic не считается)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'loc-')); fs.mkdirSync(path.join(dir, 'final'));
  try {
    assert.equal(baseVersion(dir, '109'), 1, 'без итогов основа v1');
    for (const f of ['dosie109_v1.mp4', 'dosie109_v1_nomusic.mp4', 'dosie109_v2.mp4', 'dosie109_v12_nomusic.mp4', 'poster_v2.png']) fs.writeFileSync(path.join(dir, 'final', f), 'x');
    assert.equal(baseVersion(dir, '109'), 2);
    fs.writeFileSync(path.join(dir, 'final', 'dosie109_v10.mp4'), 'x'); assert.equal(baseVersion(dir, '109'), 10, 'v10 больше v2: сравниваются числа, а не строки');
  } finally { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 }); }
});

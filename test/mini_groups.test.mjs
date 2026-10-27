// Группировка сотрудников в Mini App: блоки по виду деятельности и площадке (Telegram, YouTube, видео, управление)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const C = createRequire(import.meta.url)('../web/mini_core.js');
const A = (id, team, status = 'idle') => ({ id, team, status, name: id });

test('сотрудники раскладываются по блокам в порядке: руководство, управление, Telegram, YouTube, видео', () => {
  const g = C.groupAgents([A('video', 'video'), A('tg_author', 'tg'), A('publisher', 'yt'), A('studio_chief', 'studio'), A('captain_smm', 'core'), A('tg_scout', 'tg')]);
  assert.deepEqual(g.map((x) => x.id), ['core', 'studio', 'tg', 'yt', 'video']);
  assert.deepEqual(g.find((x) => x.id === 'tg').agents.map((a) => a.id), ['tg_author', 'tg_scout']);
});
test('монтажёры не попадают в блок Telegram, а YouTube-публикатор не попадает в Telegram', () => {
  const g = C.groupAgents([A('video', 'video'), A('video_b', 'video'), A('video_c', 'video'), A('publisher', 'yt'), A('tg_publisher', 'tg')]);
  assert.ok(!g.find((x) => x.id === 'tg').agents.some((a) => /^video/.test(a.id) || a.id === 'publisher'));
  assert.deepEqual(g.find((x) => x.id === 'video').agents.map((a) => a.id), ['video', 'video_b', 'video_c']);
});
test('считается, сколько работают в блоке; пустые блоки не показываются; неизвестная команда уходит в «Прочие»', () => {
  const g = C.groupAgents([A('a', 'tg', 'working'), A('b', 'tg'), A('c', 'old_team')]);
  assert.deepEqual(g.map((x) => [x.id, x.agents.length, x.working]), [['tg', 2, 1], ['other', 1, 0]]);
  assert.deepEqual(C.groupAgents([]), []); assert.deepEqual(C.groupAgents(null), []);
});

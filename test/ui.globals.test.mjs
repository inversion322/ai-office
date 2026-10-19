// Скрипты дашборда подключаются обычными <script> и делят одну глобальную область: функция с тем же именем в позднем файле молча перекрывает ранний.
// Так пропали вкладки офисов (renderTabs в chat.js затёрла renderTabs в app.js). Тест ловит повтор имени между файлами.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web');
const html = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8');
const files = [...html.matchAll(/<script src="([^"]+\.js)"/g)].map((m) => m[1]);

test('имена верхнего уровня не повторяются между скриптами страницы', () => {
  assert.ok(files.length >= 4, 'не нашёл скрипты в index.html');
  const seen = new Map();
  for (const f of files) {
    for (const line of fs.readFileSync(path.join(WEB, f), 'utf8').split('\n')) {
      const m = /^(?:async\s+)?function\s+(\w+)/.exec(line) || /^(?:const|let|var)\s+(\w+)/.exec(line);
      if (!m) continue;
      if (seen.has(m[1]) && seen.get(m[1]) !== f) assert.fail(`«${m[1]}» объявлено и в ${seen.get(m[1])}, и в ${f}: поздний файл перекроет ранний`);
      seen.set(m[1], f);
    }
  }
});

test('каждая функция, которую зовёт app.js из чата, существует', () => {
  const chat = fs.readFileSync(path.join(WEB, 'chat.js'), 'utf8');
  for (const fn of ['chatOnState', 'chatOnOfficeSwitch']) assert.match(chat, new RegExp(`function ${fn}\\b`));
});

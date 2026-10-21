// Подмена рендера для теста render_slot: пишет метки начала и конца, спит заданное время, завершается заданным кодом.
// node fake_render.mjs <каталог меток> <имя> <мс> [код] [--args-to файл]
import fs from 'node:fs';
import path from 'node:path';
const [dir, name, ms, code = '0'] = process.argv.slice(2);
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, `${name}.start`), String(Date.now()));
fs.writeFileSync(path.join(dir, `${name}.argv`), JSON.stringify(process.argv.slice(2)));
console.log('fake render ' + name);
setTimeout(() => { fs.writeFileSync(path.join(dir, `${name}.end`), String(Date.now())); process.exit(Number(code)); }, Number(ms));

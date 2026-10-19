// Запускает команду отдельным процессом, не привязанным к вызвавшему (не гибнет вместе с сессией/терминалом).
// node scripts/launch_detached.mjs <cwd> <logfile> <exe> [args…]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const [cwd, logFile, exe, ...args] = process.argv.slice(2);
const out = fs.openSync(logFile, 'a');
const p = spawn(exe, args, { cwd, detached: true, stdio: ['ignore', out, out], windowsHide: true });
p.unref();
console.log('pid', p.pid);

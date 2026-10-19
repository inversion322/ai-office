#!/usr/bin/env node
// Харнесс цикла поиска вакансий: связывает работу агентов Hermes с дашбордом AI Office.
// Команды:
//   node office_cycle.mjs start                      — цикл начался, Капитан раздаёт задачи
//   node office_cycle.mjs stage <agent> "<задача>" [прогресс]   — статус агента
//   node office_cycle.mjs chat <from> <to> "<текст>"            — облачко диалога
//   node office_cycle.mjs seen <url>                 — 0 если вакансия НОВАЯ, 1 если уже показывали
//   node office_cycle.mjs add '<json>'               — добавить карточку вакансии (дедуп по url)
//   node office_cycle.mjs end "<итог>"               — цикл окончен, все агенты в ожидание
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'server', 'data');
const cfg = JSON.parse(fs.readFileSync(path.join(DATA, 'config.json'), 'utf8'));
const SEEN = path.join(DATA, 'seen.json');
const API = 'http://127.0.0.1:' + (cfg.port || 8787);
const TOKEN = cfg.token || cfg.apiToken || cfg.TOKEN;

const loadSeen = () => { try { return JSON.parse(fs.readFileSync(SEEN, 'utf8')); } catch { return {}; } };
const saveSeen = (s) => fs.writeFileSync(SEEN, JSON.stringify(s, null, 1));
const norm = (u) => String(u || '').replace(/[?#].*$/, '').replace(/\/+$/, '').toLowerCase();

async function api(p, body) {
  const r = await fetch(API + p, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOKEN },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(p + ' -> ' + r.status);
  return r.json();
}
const AGENTS = ['captain', 'scout', 'analyst', 'writer', 'sender', 'content', 'research'];
const [cmd, ...a] = process.argv.slice(2);

try {
  if (cmd === 'start') {
    await api('/api/agent', { id: 'captain', status: 'working', task: 'Запуск цикла поиска вакансий', progress: 5, log: 'Цикл поиска запущен по расписанию' });
    await api('/api/scene', { kind: 'task', from: 'captain', to: 'scout', text: 'Артём, ищем РФ и зарубеж, нужно по 3 лучших', ttl: 12000 });
  } else if (cmd === 'stage') {
    const [id, task, progress] = a;
    await api('/api/agent', { id, status: 'working', task, progress: progress ? Number(progress) : undefined, log: task });
  } else if (cmd === 'chat') {
    const [from, to, text] = a;
    await api('/api/scene', { kind: 'chat', from, to, text, ttl: 10000 });
  } else if (cmd === 'seen') {
    const s = loadSeen();
    const hit = s[norm(a[0])];
    console.log(hit ? 'SEEN ' + hit.date : 'NEW');
    process.exit(hit ? 1 : 0);
  } else if (cmd === 'add') {
    const j = JSON.parse(a[0]);
    const s = loadSeen();
    const key = norm(j.url);
    if (s[key]) { console.log('DUPLICATE'); process.exit(1); }
    s[key] = { date: new Date().toISOString().slice(0, 10), title: j.title, company: j.company };
    saveSeen(s);
    await api('/api/job', { source: j.source, title: j.title, company: j.company, url: j.url, salary: j.salary || '', format: j.format || '', summary: j.summary || '', fit: j.fit || '', stage: 'found' });
    console.log('ADDED');
  } else if (cmd === 'end') {
    for (const id of AGENTS) await api('/api/agent', { id, status: 'waiting', task: id === 'captain' ? 'Ждёт следующий цикл' : 'Ожидает', progress: 0 });
    await api('/api/agent', { id: 'captain', log: a[0] || 'Цикл завершён' });
  } else {
    console.error('unknown command'); process.exit(2);
  }
} catch (e) { console.error('ERR', e.message); process.exit(3); }

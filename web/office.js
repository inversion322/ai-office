// Пиксельный офис на canvas 320x180 (масштабируется с чёткими пикселями).
// cvBack: стена, пол, полы кабинетов, столешницы, мониторы. cvFront: передние панели столов + стеклянные стены поверх уток.
let OW = 320; const OH = 180, INK = '#3A2A1F';      // OW зависит от офиса (у SMM холст шире: три комнаты в ряд), см. applyOffice
// Кабинеты (px на canvas). Стекло рисуется поверх уток, поэтому те, кто внутри, видны «за стеклом».
let ROOMS;   // геометрия комнат задаётся раскладкой офиса (см. OFFICE_LAYOUTS)
// Раскладки офисов: jobs (поиск работы) и smm (Nick G SMM). Стеклянный отдел с ключом 'jobs' общий по геометрии, подпись разная.
const OFFICE_LAYOUTS = {
  // Отдел откликов U-образно по цепочке (scout -> analyst -> writer -> sender): scout и sender рядом.
  jobs: { dept: 'Отдел поиска работы', cap: 'Кабинет руководителя',
    rooms: { jobs: { x: 6, y: 43, w: 120, h: 130, door: { in: [114, 126], out: [134, 126] } },      // отдел поиска работы (дверь справа)
             cap:  { x: 138, y: 52, w: 74, h: 98, door: { in: [175, 138], out: [175, 160] } } },     // кабинет Капитана (дверь снизу)
    plants: [[222, 150], [302, 150], [128, 158]],
    desks: { captain: [54.7, 56.7], scout: [14, 47], sender: [31, 47], analyst: [14, 80.6], writer: [31, 80.6] },
    agentRoom: { captain: 'cap', scout: 'jobs', sender: 'jobs', analyst: 'jobs', writer: 'jobs' } },
  // Офис SMM (решение Ника 2026-10-27): холст шире, три комнаты в ряд. Слева видео-студия (идеи, сценарий, монтаж), по центру кабинет Капитана,
  // справа студия каналов: Telegram, YouTube и управление контентом. Монтажёры остаются слева и в штат Telegram не входят.
  // Двери выходят в общий коридор под комнатами (CORR), между комнатами ходят по нему.
  smm: { ow: 520, dept: 'Видео-студия', dept2: 'Каналы: Telegram и YouTube', cap: 'Кабинет руководителя', visitBeside: true,
    rooms: { jobs: { x: 6, y: 43, w: 190, h: 130, door: { in: [184, 126], out: [201, 126] } },
             cap:  { x: 206, y: 52, w: 66, h: 98, door: { in: [239, 138], out: [239, 160] } },
             right: { x: 282, y: 43, w: 232, h: 130, door: { side: 'left', in: [294, 126], out: [277, 126] } } },
    plants: [[4, 176], [511, 176], [160, 150]],
    wall: { win: [136, 182, 300, 346, 420], poster: [228, 392], shelf: 484 },
    // слева: research, virality, scriptwriter, factcheck / video, video_b, video_c; справа сверху цепочка Telegram, снизу (под дверью свободно) Telegram и YouTube
    desks: { captain_smm: [45.9, 56.7],
             research: [6.5, 47], virality: [15.2, 47], scriptwriter: [23.8, 47], factcheck: [32.5, 47],
             video: [6.5, 80.6], video_b: [15.2, 80.6], video_c: [23.8, 80.6],
             studio_chief: [59.6, 47], tg_scout: [68.3, 47], tg_author: [76.9, 47], tg_editor: [85.6, 47], tg_artist: [94.2, 47],
             translator: [59.6, 80.6], tg_publisher: [68.3, 80.6], tg_analyst: [76.9, 80.6], packager: [85.6, 80.6], publisher: [94.2, 80.6] },
    agentRoom: { captain_smm: 'cap', research: 'jobs', virality: 'jobs', scriptwriter: 'jobs', factcheck: 'jobs', video: 'jobs', video_b: 'jobs', video_c: 'jobs',
                 studio_chief: 'right', tg_scout: 'right', tg_author: 'right', tg_editor: 'right', tg_artist: 'right', tg_publisher: 'right', tg_analyst: 'right', packager: 'right', publisher: 'right', translator: 'right' } },
};
let OFFICE_DESKS, AGENT_ROOM, PLANTS, WALL, VISIT_BESIDE = false;
const WALL_DEFAULT = { win: [150, 240], poster: [200], shelf: 281 };
const CORR = 160;        // коридор под комнатами: по нему ходят из комнаты в комнату
function applyOffice(id) {
  const L = OFFICE_LAYOUTS[id] || OFFICE_LAYOUTS.jobs;
  OFFICE_DESKS = L.desks; AGENT_ROOM = L.agentRoom; ROOMS = L.rooms; PLANTS = L.plants; WALL = L.wall || WALL_DEFAULT; VISIT_BESIDE = !!L.visitBeside;
  OW = L.ow || 320;
  // ширина холста и пропорции рамки следуют раскладке: высота та же, шире только офис SMM (элементы в % пересчитываются от OW)
  const cb = document.getElementById('cvBack'), cf = document.getElementById('cvFront');
  if (cb && cb.width !== OW) cb.width = OW;
  if (cf && cf.width !== OW) cf.width = OW;
  const rs = document.documentElement.style;
  rs.setProperty('--ow', String(OW)); rs.setProperty('--office-ar', (OW / OH).toFixed(4));
  return L;
}
applyOffice('jobs');

function deskGeom(id) {
  const d = OFFICE_DESKS[id] || [50, 50];
  const cx = Math.round(d[0] / 100 * OW), y0 = Math.round(d[1] / 100 * OH) - 7;
  return { cx, y0, home: [(cx - 5) / OW * 100, (y0 + 10) / OH * 100],
           box: { l: cx / OW * 100, t: (y0 + 8) / OH * 100, w: 44 / OW * 100, h: 26 / OH * 100 } };
}
const R = (c, x, y, w, h, col) => { c.fillStyle = col; c.fillRect(x, y, w, h); };
const frame = (c, x, y, w, h, fill) => { R(c, x - 1, y - 1, w + 2, h + 2, INK); R(c, x, y, w, h, fill); };

function drawWall(c) {
  R(c, 0, 0, OW, 41, '#EBCFB4');
  for (let row = 0; row * 6 < 40; row++) {
    const off = (row % 2) * 8;
    for (let x = -16; x < OW; x += 16) {
      const col = ['#D2805F', '#C8704F', '#D98F6E', '#CC7655'][((x + off) * 7 + row * 13) & 3];
      R(c, x + off + 1, row * 6 + 1, 15, 5, col); R(c, x + off + 1, row * 6 + 1, 15, 1, '#DE9A7B');
    }
  }
  R(c, 0, 38, OW, 3, '#8F452E'); R(c, 0, 41, OW, 2, '#B89F72');
  WALL.win.forEach((x) => {
    frame(c, x, 6, 34, 26, '#F6EFE0'); R(c, x + 2, 8, 30, 22, '#BFE6FF');
    R(c, x + 16, 8, 2, 22, '#F6EFE0'); R(c, x + 2, 18, 30, 2, '#F6EFE0');
    R(c, x + 5, 11, 7, 2, '#FFFFFF'); R(c, x + 7, 9, 4, 2, '#FFFFFF'); R(c, x + 21, 22, 8, 2, '#FFFFFF');
  });
  WALL.poster.forEach((px) => {
    frame(c, px, 8, 18, 22, '#FFF9E8'); R(c, px + 4, 12, 10, 8, '#FFD43B'); R(c, px + 6, 15, 2, 2, INK); R(c, px + 11, 15, 2, 2, INK); R(c, px + 8, 17, 4, 2, '#FF8A2B');
    R(c, px + 4, 23, 10, 1, '#B89F72'); R(c, px + 4, 26, 7, 1, '#B89F72');
  });
  const sx = WALL.shelf;
  frame(c, sx, 4, 32, 33, '#8A5A3A');
  [0, 1, 2].forEach((r) => {
    R(c, sx + 2, 14 + r * 11, 28, 1, '#5E3B22');
    const cols = ['#C0392B', '#2E86C1', '#27AE60', '#F1C40F', '#8E44AD', '#E67E22'];
    for (let i = 0; i < 7; i++) { const h = 6 + ((i * 5 + r * 3) % 4); R(c, sx + 3 + i * 4, 14 + r * 11 - h, 3, h, cols[(i + r * 2) % cols.length]); }
  });
}
function drawFloor(c) {
  for (let row = 0, y = 43; y < OH; row++, y += 10) {
    R(c, 0, y, OW, 10, row % 2 ? '#E2CDA3' : '#E8D5AE');
    R(c, 0, y + 9, OW, 1, '#CDB68A');
    for (let x = (row * 17) % 48; x < OW; x += 48) R(c, x, y, 1, 10, '#CDB68A');
  }
  // полы отделов: мятная плитка (левый отдел) и голубовато-сиреневая (правая студия каналов, чтобы комнаты читались по цвету)
  const TILE = { jobs: ['#D7E5DC', '#C3D6CB'], right: ['#DFE6F5', '#CBD6EC'] };
  for (const [key, j] of Object.entries(ROOMS)) {
    if (key === 'cap') continue;
    const [fill, line] = TILE[key] || TILE.jobs;
    R(c, j.x, j.y, j.w, j.h, fill);
    for (let y = j.y; y < j.y + j.h; y += 12) R(c, j.x, y, j.w, 1, line);
    for (let x = j.x; x < j.x + j.w; x += 12) R(c, x, j.y, 1, j.h, line);
  }
  // пол кабинета Капитана: тёмное дерево
  const k = ROOMS.cap;
  R(c, k.x, k.y, k.w, k.h, '#D2BF9C');
  for (let y = k.y; y < k.y + k.h; y += 8) { R(c, k.x, y, k.w, 1, '#BFA97F'); for (let x = k.x + ((y / 8) % 2) * 18; x < k.x + k.w; x += 36) R(c, x, y, 1, 8, '#BFA97F'); }
}
function plant(c, x, y) {
  R(c, x + 1, y + 10, 10, 8, INK); R(c, x + 2, y + 11, 8, 6, '#B5703A'); R(c, x + 2, y + 11, 8, 1, '#D08A52');
  R(c, x + 4, y, 4, 2, '#2F8A46'); R(c, x + 2, y + 2, 8, 3, '#3FA95C'); R(c, x, y + 5, 12, 4, '#2F8A46'); R(c, x + 3, y + 5, 3, 2, '#6FD08A');
}
function deskBack(c, cx, y0, st, tick) {
  const x = cx - 20;
  frame(c, x, y0, 40, 7, '#E3B26B'); R(c, x, y0, 40, 1, '#F0C98A');
  const mx = cx + 8, my = y0 - 10;
  frame(c, mx, my, 12, 9, '#2B3040');
  const sc = { working: '#3B82F6', waiting: '#64748B', idle: '#64748B', error: '#EF4444', offline: '#1F2430' }[st] || '#64748B';
  R(c, mx + 1, my + 1, 10, 7, sc);
  if (st === 'working') for (let i = 0; i < 3; i++) R(c, mx + 2, my + 2 + i * 2, 3 + ((tick + i * 2) % 5), 1, '#DBEAFE');
  if (st === 'waiting' && tick % 2) R(c, mx + 3, my + 5, 2, 1, '#E2E8F0');
  if (st === 'error') { R(c, mx + 4, my + 3, 4, 1, '#FEE2E2'); R(c, mx + 5, my + 2, 2, 3, '#FEE2E2'); }
  R(c, mx + 4, my + 9, 4, 2, '#555B6B');
  frame(c, cx + 16, y0 + 2, 3, 3, '#FFFFFF'); R(c, cx + 17, y0 + 3, 1, 1, '#8B5A2B');
}
function deskFront(c, cx, y0) {
  const x = cx - 20;
  frame(c, x, y0 + 7, 40, 9, '#C48E4A'); R(c, x, y0 + 7, 40, 1, '#A87433');
  R(c, x + 4, y0 + 9, 14, 5, '#B27C3B'); R(c, x + 10, y0 + 11, 2, 1, '#F0C98A');
  R(c, x + 22, y0 + 9, 14, 5, '#B27C3B'); R(c, x + 28, y0 + 11, 2, 1, '#F0C98A');
  frame(c, cx - 13, y0 + 4, 12, 3, '#DDE0E8'); for (let i = 0; i < 5; i++) R(c, cx - 11 + i * 2, y0 + 5, 1, 1, '#9AA0AD');
}
// стеклянные стены
const GL = 'rgba(168,214,238,.30)', GF = '#5F7F95', GP = '#44627A';
function glassH(f, x, y, w, h) {
  f.fillStyle = GL; f.fillRect(x, y, w, h); R(f, x, y, w, 1, GF); R(f, x, y + h - 1, w, 1, GF);
  for (let i = x + 12; i < x + w - 2; i += 24) { R(f, i, y + 1, 1, h - 2, 'rgba(95,127,149,.6)'); R(f, i + 2, y + 2, 1, 3, 'rgba(255,255,255,.75)'); }
}
function glassV(f, x, y, w, h) {
  f.fillStyle = GL; f.fillRect(x, y, w, h); R(f, x, y, 1, h, GF); R(f, x + w - 1, y, 1, h, GF);
  for (let j = y + 12; j < y + h - 2; j += 24) { R(f, x + 1, j, w - 2, 1, 'rgba(95,127,149,.6)'); R(f, x + 1, j + 2, 2, 1, 'rgba(255,255,255,.75)'); }
}
const post = (f, x, y, w, h) => { R(f, x, y, w, h, GP); R(f, x, y, 1, h, '#6F94AD'); };
function glassDept(f, j) {
  // отдел: сверху стена здания, дверь в правой стене (по умолчанию) или в левой (door.side = 'left')
  const doorY1 = j.door.in[1] - 16, doorY2 = j.door.in[1] + 16;
  glassH(f, j.x, j.y + j.h - 8, j.w, 8);
  if (j.door.side === 'left') {
    glassV(f, j.x + j.w - 4, j.y, 4, j.h);
    glassV(f, j.x, j.y, 4, doorY1 - j.y); glassV(f, j.x, doorY2, 4, j.y + j.h - doorY2);
    post(f, j.x - 1, doorY1 - 2, 6, 3); post(f, j.x - 1, doorY2, 6, 3);
    return;
  }
  glassV(f, j.x, j.y, 4, j.h);
  glassV(f, j.x + j.w - 4, j.y, 4, doorY1 - j.y); glassV(f, j.x + j.w - 4, doorY2, 4, j.y + j.h - doorY2);
  post(f, j.x + j.w - 5, doorY1 - 2, 6, 3); post(f, j.x + j.w - 5, doorY2, 6, 3);
}
function drawGlass(f) {
  for (const [key, r] of Object.entries(ROOMS)) if (key !== 'cap') glassDept(f, r);
  // кабинет Капитана: стекло со всех сторон, дверь снизу
  const k = ROOMS.cap, dx1 = k.door.in[0] - 15, dx2 = k.door.in[0] + 15, by = k.y + k.h - 8;
  glassH(f, k.x, k.y, k.w, 6);
  glassV(f, k.x, k.y, 4, k.h); glassV(f, k.x + k.w - 4, k.y, 4, k.h);
  glassH(f, k.x, by, dx1 - k.x, 8); glassH(f, dx2, by, k.x + k.w - dx2, 8);
  post(f, dx1 - 2, by - 1, 3, 9); post(f, dx2 - 1, by - 1, 3, 9);
}
function drawOffice(agents, tick) {
  const cb = document.getElementById('cvBack'), cf = document.getElementById('cvFront');
  if (!cb || !cf) return;
  const b = cb.getContext('2d'), f = cf.getContext('2d');
  b.imageSmoothingEnabled = false; f.imageSmoothingEnabled = false;
  drawWall(b); drawFloor(b); PLANTS.forEach(([px, py]) => plant(b, px, py));
  f.clearRect(0, 0, OW, OH);
  const stOf = (id) => ((agents || []).find((a) => a.id === id) || {}).status || 'offline';
  Object.keys(OFFICE_DESKS).forEach((id) => { const g = deskGeom(id); deskBack(b, g.cx, g.y0, stOf(id), tick || 0); deskFront(f, g.cx, g.y0); });
  drawGlass(f);
}

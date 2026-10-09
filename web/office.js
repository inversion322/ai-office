// Пиксельный офис: рисуется на canvas 320x180 и масштабируется с чёткими пикселями.
// cvBack: стена, пол, ковёр, столешницы, мониторы. cvFront: передние панели столов и клавиатуры (поверх уток).
const OW = 320, OH = 180, INK = '#3A2A1F';
// Команда откликов слева U-образно по цепочке (scout -> analyst -> writer -> sender): scout и sender рядом.
// Контент и ресёрч справа рядом. Капитан в центре на ковре.
const OFFICE_DESKS = { captain: [52, 58], scout: [14, 47], sender: [31, 47], analyst: [14, 80], writer: [31, 80], content: [74, 50], research: [90, 50] };

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
  // окна
  [28, 240].forEach((x) => {
    frame(c, x, 6, 34, 26, '#F6EFE0'); R(c, x + 2, 8, 30, 22, '#BFE6FF');
    R(c, x + 16, 8, 2, 22, '#F6EFE0'); R(c, x + 2, 18, 30, 2, '#F6EFE0');
    R(c, x + 5, 11, 7, 2, '#FFFFFF'); R(c, x + 7, 9, 4, 2, '#FFFFFF'); R(c, x + 21, 22, 8, 2, '#FFFFFF');
  });
  // постер
  frame(c, 68, 8, 18, 22, '#FFF9E8'); R(c, 72, 12, 10, 8, '#FFD43B'); R(c, 74, 15, 2, 2, INK); R(c, 79, 15, 2, 2, INK); R(c, 76, 17, 4, 2, '#FF8A2B');
  R(c, 72, 23, 10, 1, '#B89F72'); R(c, 72, 26, 7, 1, '#B89F72');
  // стеллаж
  frame(c, 281, 4, 32, 33, '#8A5A3A');
  [0, 1, 2].forEach((r) => {
    R(c, 283, 14 + r * 11, 28, 1, '#5E3B22');
    const cols = ['#C0392B', '#2E86C1', '#27AE60', '#F1C40F', '#8E44AD', '#E67E22'];
    for (let i = 0; i < 7; i++) { const h = 6 + ((i * 5 + r * 3) % 4); R(c, 284 + i * 4, 14 + r * 11 - h, 3, h, cols[(i + r * 2) % cols.length]); }
  });
}
function drawFloor(c) {
  for (let row = 0, y = 43; y < OH; row++, y += 10) {
    R(c, 0, y, OW, 10, row % 2 ? '#E2CDA3' : '#E8D5AE');
    R(c, 0, y + 9, OW, 1, '#CDB68A');
    for (let x = (row * 17) % 48; x < OW; x += 48) R(c, x, y, 1, 10, '#CDB68A');
  }
  // ковёр
  frame(c, 98, 72, 124, 66, '#C7776A'); R(c, 101, 75, 118, 60, '#F0D3BC');
  for (let i = 0; i < 8; i++) { R(c, 106 + i * 14, 80, 6, 6, '#E6B79D'); R(c, 113 + i * 14, 124, 6, 6, '#E6B79D'); }
  R(c, 101, 75, 118, 1, '#E6B79D'); R(c, 101, 134, 118, 1, '#E6B79D');
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
function drawOffice(agents, tick) {
  const cb = document.getElementById('cvBack'), cf = document.getElementById('cvFront');
  if (!cb || !cf) return;
  const b = cb.getContext('2d'), f = cf.getContext('2d');
  b.imageSmoothingEnabled = false; f.imageSmoothingEnabled = false;
  drawWall(b); drawFloor(b); plant(b, 6, 148); plant(b, 302, 148);
  f.clearRect(0, 0, OW, OH);
  const stOf = (id) => ((agents || []).find((a) => a.id === id) || {}).status || 'offline';
  Object.keys(OFFICE_DESKS).forEach((id) => { const g = deskGeom(id); deskBack(b, g.cx, g.y0, stOf(id), tick || 0); deskFront(f, g.cx, g.y0); });
}

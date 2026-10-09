// Пиксельная утка 24x32: форма строится по сетке (эллипсы + контур), без внешних картинок.
// Слои: base, крылья wl/wr (анимируются), face, acc. Мимика зависит от статуса, аксессуар от роли.
function duckSVG(a, opts = {}) {
  const W = 24, H = 32, OY = 4;
  const c = a.color || '#E8A317';
  const st = a.status || 'idle';
  const mood = st === 'offline' ? 'sleep' : st === 'error' ? 'worry' : st === 'working' ? 'focus' : st === 'waiting' ? 'wait' : 'happy';
  const INK = '#1B1F2A', OUT = '#C26A00';
  const L = { b: {}, wl: {}, wr: {}, f: {}, a: {} };
  const put = (layer, x, y, col) => { y += OY; if (x >= 0 && y >= 0 && x < W && y < H) L[layer][x + ',' + y] = col; };
  const rect = (layer, x, y, w, h, col) => { for (let i = 0; i < w; i++) for (let j = 0; j < h; j++) put(layer, x + i, y + j, col); };
  const ell = (x, y, cx, cy, rx, ry) => { const dx = (x + .5 - cx) / rx, dy = (y + .5 - cy) / ry; return dx * dx + dy * dy <= 1; };

  // силуэт: большая голова + чуть уже тело (милые пропорции)
  const body = (x, y) => ell(x, y, 12, 9.5, 10, 8.5) || ell(x, y, 12, 17.5, 9, 7);
  for (let y = -1; y < 27; y++) for (let x = -1; x < 25; x++) {
    if (body(x, y)) {
      let col = '#FFD43B';
      if (ell(x, y, 7.5, 4.5, 3, 1.6)) col = '#FFF3A6';                                    // блик
      else if (ell(x, y, 12, 19.5, 5.5, 4)) col = '#FFF0B0';                               // светлое брюшко
      else if (ell(x, y, 12, 17.5, 9, 7) && !ell(x, y, 10, 15.5, 8, 6)) col = '#F5AE00';   // тень снизу справа
      put('b', x, y, col);
    } else if (body(x + 1, y) || body(x - 1, y) || body(x, y + 1) || body(x, y - 1)) put('b', x, y, OUT);
  }
  // лапки
  rect('b', 7, 25, 4, 1, '#FF8A2B'); rect('b', 13, 25, 4, 1, '#FF8A2B');
  rect('b', 6, 26, 5, 1, '#E5561B'); rect('b', 13, 26, 5, 1, '#E5561B');
  // клюв
  const beak = (x, y) => ell(x, y, 12, 13.5, 3.3, 1.9);
  for (let y = 10; y < 17; y++) for (let x = 6; x < 18; x++) {
    if (beak(x, y)) put('f', x, y, !beak(x, y + 1) ? '#E5561B' : '#FF8A2B');
    else if (beak(x + 1, y) || beak(x - 1, y) || beak(x, y + 1) || beak(x, y - 1)) put('f', x, y, '#B8340F');
  }
  put('f', 11, 12, '#FFC38A'); put('f', 12, 12, '#FFC38A');
  // румянец
  [4, 5, 18, 19].forEach((x) => put('f', x, 12, '#FF9E8A'));
  // крылья-«ручки»
  const wing = (x, y) => ell(x, y, 4, 17.5, 2.4, 3.6);
  for (let y = 12; y < 24; y++) for (let x = 0; x < 9; x++) {
    const mx = 23 - x;
    if (wing(x, y)) { put('wl', x, y, '#FFC21A'); put('wr', mx, y, '#FFC21A'); }
    else if (wing(x + 1, y) || wing(x - 1, y) || wing(x, y + 1) || wing(x, y - 1)) { put('wl', x, y, OUT); put('wr', mx, y, OUT); }
  }
  // глаза
  const eye = (x0, hx) => { rect('f', x0, 7, 2, 3, INK); put('f', hx, 7, '#FFFFFF'); };
  if (mood === 'sleep') {
    rect('f', 7, 8, 2, 1, INK); rect('f', 15, 8, 2, 1, INK);
    rect('a', 20, 0, 3, 1, '#6B7280'); put('a', 21, 1, '#6B7280'); rect('a', 20, 2, 3, 1, '#6B7280');
  } else {
    eye(7, mood === 'wait' ? 8 : 7); eye(15, mood === 'wait' ? 16 : 15);
    if (mood === 'focus') { [[6,5],[7,5],[8,6]].forEach(([x,y]) => put('f',x,y,INK)); [[17,5],[16,5],[15,6]].forEach(([x,y]) => put('f',x,y,INK)); }
    if (mood === 'worry') { [[6,6],[7,5],[8,5]].forEach(([x,y]) => put('f',x,y,INK)); [[17,6],[16,5],[15,5]].forEach(([x,y]) => put('f',x,y,INK)); put('f', 11, 14, '#8a2d00'); put('f', 12, 14, '#8a2d00'); }
  }

  // аксессуары по роли (координаты головы: верх головы y=1)
  const A = (x, y, w, h, col) => rect('a', x, y, w, h, col);
  ({
    captain: () => { A(7,-3,10,1,c); A(6,-2,12,3,c); A(4,1,16,2,'#8A5A00'); A(11,-1,2,1,'#FFFFFF'); },
    glasses: () => { [6, 14].forEach((x) => { A(x,6,4,1,c); A(x,10,4,1,c); A(x,7,1,3,c); A(x+3,7,1,3,c); }); A(10,8,4,1,c); },
    tie: () => { A(11,17,2,1,'#14532D'); A(11,18,2,3,c); A(11,21,2,1,c); },
    pen: () => { A(11,-2,2,1,c); A(8,-1,8,1,c); A(6,0,12,1,c); A(5,1,14,1,c); },
    cap: () => { A(6,-1,12,3,c); A(4,2,16,1,'#7A1F1F'); A(8,3,8,1,'#7A1F1F'); },
    headset: () => { A(6,0,12,1,INK); A(4,1,2,1,INK); A(18,1,2,1,INK); A(3,2,1,5,INK); A(20,2,1,5,INK); A(1,6,3,5,c); A(20,6,3,5,c); },
    bowtie: () => { A(9,17,2,2,c); A(13,17,2,2,c); A(11,17,2,2,'#155E75'); },
  }[a.look] || (() => {}))();

  const runs = (map) => {
    let out = '';
    for (let y = 0; y < H; y++) {
      let x = 0;
      while (x < W) {
        const col = map[x + ',' + y];
        if (!col) { x++; continue; }
        let w = 1; while (x + w < W && map[(x + w) + ',' + y] === col) w++;
        out += `<rect x="${x}" y="${y}" width="${w}" height="1" fill="${col}"/>`;
        x += w;
      }
    }
    return out;
  };
  const size = opts.size || 48;
  return `<svg class="duck" viewBox="0 0 ${W} ${H}" width="${size}" height="${size * H / W}" shape-rendering="crispEdges" aria-hidden="true">
    <rect x="4" y="31" width="16" height="1" fill="#000" opacity=".16"/>
    <g class="wiggle">${runs(L.b)}<g class="wing wl">${runs(L.wl)}</g><g class="wing wr">${runs(L.wr)}</g>${runs(L.f)}${runs(L.a)}</g></svg>`;
}

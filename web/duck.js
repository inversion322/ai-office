// Оригинальная глянцевая мультяшная утка в духе популярных Telegram-стикеров:
// слитый «грушевый» силуэт, толстый оранжевый контур, маленькие глаза-бусинки, широкий клюв, белые блики.
// Не копия чьего-либо рисунка. Мимика зависит от статуса, аксессуар от роли.
let _duckUid = 0;
function duckSVG(a, opts = {}) {
  const u = 'd' + (++_duckUid);
  const c = a.color || '#E8A317';
  const ink = '#1B1F2A', line = '#F08A00', st = a.status || 'idle';
  const mood = st === 'offline' ? 'sleep' : st === 'error' ? 'worry' : st === 'working' ? 'focus' : st === 'waiting' ? 'wait' : 'happy';

  const bead = (x, y, dy = 0, dx = 0) => `<ellipse cx="${x}" cy="${y}" rx="3" ry="3.7" fill="${ink}"/><ellipse cx="${x - 1 + dx}" cy="${y - 1.4 + dy}" rx="1.05" ry="1.2" fill="#fff"/>`;
  const eyes = {
    sleep: `<path d="M20 27 q4.5 3.6 9 0 M35 27 q4.5 3.6 9 0" fill="none" stroke="${ink}" stroke-width="2.6" stroke-linecap="round"/>`,
    worry: `<g class="eyes">${bead(25, 27)}${bead(39, 27)}</g><path d="M20 20.5 l9 3.2 M44 20.5 l-9 3.2" stroke="${ink}" stroke-width="2.2" stroke-linecap="round"/>`,
    focus: `<g class="eyes">${bead(25, 27)}${bead(39, 27)}</g><path d="M20 21 l9 1.6 M44 21 l-9 1.6" stroke="${ink}" stroke-width="2.2" stroke-linecap="round"/>`,
    wait: `<g class="eyes">${bead(25, 26, -1.2, 1)}${bead(39, 26, -1.2, 1)}</g>`,
    happy: `<g class="eyes">${bead(25, 27)}${bead(39, 27)}</g>`,
  }[mood];

  const acc = {
    captain: `<path d="M16 17 Q32 -1 48 17 L46 21.5 Q32 10 18 21.5Z" fill="${c}" stroke="#8a5a00" stroke-width="1.4"/><rect x="15" y="18" width="34" height="5" rx="2.5" fill="#8a5a00"/>
              <circle cx="32" cy="9.5" r="3.6" fill="#fff" stroke="#8a5a00" stroke-width="1"/><path d="M32 6.6 l1 2.1 2.3.3-1.7 1.6.4 2.3-2-1.1-2 1.1.4-2.3-1.7-1.6 2.3-.3z" fill="${c}"/>`,
    glasses: `<g fill="rgba(255,255,255,.4)" stroke="${ink}" stroke-width="2.2"><circle cx="25" cy="27" r="7.4"/><circle cx="39" cy="27" r="7.4"/></g><path d="M18 25 l-4-2.5 M46 25 l4-2.5" stroke="${ink}" stroke-width="2"/>`,
    tie: `<path d="M32 49 l-4.2 3.6 4.2 12 4.2-12z" fill="${c}" stroke="#14532d" stroke-width="1.2"/><path d="M28.4 48.6h7.2l-1.6 3h-4z" fill="#14532d"/>`,
    pen: `<path d="M17 15 q15-10 30 0 q-2 6.5-15 5.5 q-12.5 1-15-5.5z" fill="${c}" stroke="#5b2a86" stroke-width="1.4"/>`,
    cap: `<path d="M16 20 Q32 1 48 20Z" fill="${c}" stroke="#7a1f1f" stroke-width="1.4"/><path d="M30 20 h23 q3 0 3 3 h-26z" fill="#7a1f1f"/>`,
    headset: `<path d="M13 29 q0-20 19-20 t19 20" fill="none" stroke="${ink}" stroke-width="3.4" stroke-linecap="round"/><rect x="9" y="25" width="7.5" height="13" rx="3.7" fill="${c}" stroke="${ink}" stroke-width="1.3"/><rect x="47.5" y="25" width="7.5" height="13" rx="3.7" fill="${c}" stroke="${ink}" stroke-width="1.3"/><path d="M12 38 q2 10 17 11" fill="none" stroke="${ink}" stroke-width="2"/><circle cx="30" cy="49" r="2.8" fill="${ink}"/>`,
    bowtie: `<path d="M32 50 l-8.5-5v10z M32 50 l8.5-5v10z" fill="${c}" stroke="#155e75" stroke-width="1.2"/><circle cx="32" cy="50" r="2.6" fill="#155e75"/>`,
  }[a.look] || '';
  const bodyAcc = a.look === 'tie' || a.look === 'bowtie';
  const smile = mood === 'worry' ? `<path d="M28 41.5 q4-2.6 8 0" fill="none" stroke="#8a2d00" stroke-width="1.5" stroke-linecap="round"/>` : '';

  return `<svg class="duck" viewBox="0 0 64 76" width="${opts.size || 64}" height="${opts.size ? opts.size * 76 / 64 : 76}" aria-hidden="true">
    <defs>
      <linearGradient id="${u}y" x1="0" y1="0" x2="0.35" y2="1"><stop offset="0" stop-color="#FFEB6B"/><stop offset=".55" stop-color="#FFD12E"/><stop offset="1" stop-color="#FFB800"/></linearGradient>
      <linearGradient id="${u}k" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FF8A2B"/><stop offset="1" stop-color="#E5461B"/></linearGradient>
    </defs>
    <ellipse cx="32" cy="71.5" rx="21" ry="3.6" fill="none" stroke="#2D9CDB" stroke-width="1.6" opacity=".85"/>
    <ellipse cx="32" cy="71.5" rx="19" ry="3" fill="#000" opacity=".1"/>
    <g class="wiggle">
      <path d="M32 5.5 C47 5.5 54 16 54 27 C54 33 52 37 52 39 C58 45 58 58 52 65 C47 70 38 70.5 32 70.5 C26 70.5 17 70 12 65 C6 58 6 45 12 39 C12 37 10 33 10 27 C10 16 17 5.5 32 5.5Z"
            fill="url(#${u}y)" stroke="${line}" stroke-width="2.4" stroke-linejoin="round"/>
      <path d="M17 14 C20 10 25 8.5 29 8.3" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" opacity=".9"/>
      <path d="M13 21 q-1 3-1 6" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" opacity=".7"/>
      <path d="M10 53 q-1 6 3 10" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" opacity=".7"/>
      <g class="wing wl"><path d="M14 47 C7 49 6 60 11 64 C17 65 21 59 20 53 C19 49 17 47 14 47Z" fill="#FFC21A" stroke="${line}" stroke-width="2.2" stroke-linejoin="round"/>
        <path d="M11 54 q0 4 2 6" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" opacity=".75"/></g>
      <g class="wing wr"><path d="M50 47 C57 49 58 60 53 64 C47 65 43 59 44 53 C45 49 47 47 50 47Z" fill="#FFC21A" stroke="${line}" stroke-width="2.2" stroke-linejoin="round"/></g>
      ${bodyAcc ? acc : ''}
      <ellipse cx="17.5" cy="34" rx="3.6" ry="2.6" fill="#ff7a59" opacity=".4"/><ellipse cx="46.5" cy="34" rx="3.6" ry="2.6" fill="#ff7a59" opacity=".4"/>
      ${eyes}
      <path d="M19.5 33 C22 29.5 42 29.5 44.5 33 C46 38.5 40 43 32 43 C24 43 18 38.5 19.5 33Z" fill="url(#${u}k)" stroke="#B83410" stroke-width="1.6" stroke-linejoin="round"/>
      <path d="M23.5 33.4 C27 31.6 37 31.6 40.5 33.4" fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round" opacity=".55"/>
      <ellipse cx="28" cy="36.6" rx="1" ry=".8" fill="#7a2300" opacity=".55"/><ellipse cx="36" cy="36.6" rx="1" ry=".8" fill="#7a2300" opacity=".55"/>
      ${smile}
      ${bodyAcc ? '' : acc}
    </g>
  </svg>`;
}

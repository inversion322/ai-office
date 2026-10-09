// Глянцевая мультяшная утка (оригинальный рисунок в манере референсов): слитое грушевое тело,
// толстый оранжевый контур, белые блики, глаза-овалы, клюв-«лопатка» с улыбкой, голубая рябь.
// Крылья висят вдоль тела; поза «машет» и «печатает» задаётся CSS-анимацией. Аксессуары по роли.
let _duckUid = 0;
function duckSVG(a, opts = {}) {
  const u = 'd' + (++_duckUid);
  const c = a.color || '#E8A317';
  const INK = '#1B1F2A', LINE = '#F29A00';
  const st = a.status || 'idle';
  const mood = st === 'offline' ? 'sleep' : st === 'error' ? 'worry' : st === 'working' ? 'focus' : st === 'waiting' ? 'wait' : 'happy';
  const eye = (x, dx = 0, dy = 0) => `<ellipse cx="${x}" cy="27.5" rx="3.3" ry="4" fill="${INK}"/><circle cx="${x + 1.2 + dx}" cy="${25.8 + dy}" r="1.35" fill="#fff"/>`;
  const eyes = {
    sleep: `<path d="M19.5 28.5 q4 3.4 8 0 M36.5 28.5 q4 3.4 8 0" fill="none" stroke="${INK}" stroke-width="2.3" stroke-linecap="round"/><path d="M50 9 h6 l-6 7 h6" fill="none" stroke="#6B7280" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>`,
    worry: `<g class="eyes">${eye(23.5)}${eye(40.5)}</g><path d="M18.5 22.5 L28 19.5 M45.5 22.5 L36 19.5" stroke="${INK}" stroke-width="2.1" stroke-linecap="round"/>`,
    focus: `<g class="eyes">${eye(23.5)}${eye(40.5)}</g><path d="M18.5 20 L28 22.5 M45.5 20 L36 22.5" stroke="${INK}" stroke-width="2.1" stroke-linecap="round"/>`,
    wait: `<g class="eyes">${eye(23.5, 0.8, -1.2)}${eye(40.5, 0.8, -1.2)}</g>`,
    happy: `<g class="eyes">${eye(23.5)}${eye(40.5)}</g>`,
  }[mood];

  const acc = {
    captain: `<path d="M16 18 Q32 1 48 18 L46 22 Q32 11 18 22Z" fill="${c}" stroke="#8a5a00" stroke-width="1.4"/><rect x="15" y="19" width="34" height="4.5" rx="2.2" fill="#8a5a00"/>
              <circle cx="32" cy="10.5" r="3.6" fill="#fff" stroke="#8a5a00" stroke-width="1"/><path d="M32 7.6 l1 2.1 2.3.3-1.7 1.6.4 2.3-2-1.1-2 1.1.4-2.3-1.7-1.6 2.3-.3z" fill="${c}"/>`,
    glasses: `<g fill="rgba(255,255,255,.35)" stroke="${INK}" stroke-width="2.3"><circle cx="23.5" cy="27.5" r="7.6"/><circle cx="40.5" cy="27.5" r="7.6"/></g><path d="M16 25.5 l-4-2.5 M48 25.5 l4-2.5" stroke="${INK}" stroke-width="2"/>`,
    tie: `<path d="M32 48 l-4.2 3.6 4.2 12 4.2-12z" fill="${c}" stroke="#14532d" stroke-width="1.2"/><path d="M28.4 47.6h7.2l-1.6 3h-4z" fill="#14532d"/>`,
    pen: `<path d="M17 16 q15-10 30 0 q-2 6.5-15 5.5 q-12.5 1-15-5.5z" fill="${c}" stroke="#5b2a86" stroke-width="1.4"/>`,
    cap: `<path d="M16 21 Q32 2 48 21Z" fill="${c}" stroke="#7a1f1f" stroke-width="1.4"/><path d="M30 21 h23 q3 0 3 3 h-26z" fill="#7a1f1f"/>`,
    headset: `<path d="M12 30 q0-21 20-21 t20 21" fill="none" stroke="${INK}" stroke-width="3.4" stroke-linecap="round"/><rect x="7" y="26" width="7.5" height="13" rx="3.7" fill="${c}" stroke="${INK}" stroke-width="1.3"/><rect x="49.5" y="26" width="7.5" height="13" rx="3.7" fill="${c}" stroke="${INK}" stroke-width="1.3"/><path d="M10 39 q2 10 18 11" fill="none" stroke="${INK}" stroke-width="2"/><circle cx="29" cy="50" r="2.8" fill="${INK}"/>`,
    bowtie: `<path d="M32 50 l-8.5-5v10z M32 50 l8.5-5v10z" fill="${c}" stroke="#155e75" stroke-width="1.2"/><circle cx="32" cy="50" r="2.6" fill="#155e75"/>`,
  }[a.look] || '';
  const bodyAcc = a.look === 'tie' || a.look === 'bowtie';
  const raised = mood === 'happy' || mood === 'wait';     // статичная поза «машет», если нет CSS-анимации
  const wl = raised ? ' transform="rotate(128)"' : '';
  const size = opts.size || 64;

  return `<svg class="duck" viewBox="0 0 64 76" width="${size}" height="${size * 76 / 64}" aria-hidden="true">
    <defs>
      <linearGradient id="${u}y" x1="0.2" y1="0" x2="0.5" y2="1"><stop offset="0" stop-color="#FFEB5E"/><stop offset=".6" stop-color="#FFD21F"/><stop offset="1" stop-color="#FFB800"/></linearGradient>
      <linearGradient id="${u}k" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FF8A30"/><stop offset="1" stop-color="#E8451A"/></linearGradient>
    </defs>
    <g class="ripple"><ellipse cx="32" cy="72.4" rx="26" ry="3.6" fill="#7DD3FC" fill-opacity=".28" stroke="#2D9CDB" stroke-width="1.3"/><ellipse cx="32" cy="72.4" rx="17" ry="2.1" fill="none" stroke="#7DD3FC" stroke-width="1"/></g>
    <g class="wiggle">
      <path d="M32 5.5 C45 5.5 52.5 15 52.5 26 C52.5 31 51 35 52 38 C58 41 62 49 60 58 C59 66 51 71 32 71 C19 71 8 68 7 58 C6 48 11 41 14 38 C15 35 11.5 31 11.5 26 C11.5 15 19 5.5 32 5.5Z"
            fill="url(#${u}y)" stroke="${LINE}" stroke-width="2.7" stroke-linejoin="round"/>
      <path d="M17 15.5 C19.5 11 24 8.6 28.5 8.2" fill="none" stroke="#fff" stroke-width="2.8" stroke-linecap="round" opacity=".95"/>
      <path d="M13.5 21 q-.6 3-.4 5.5" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" opacity=".8"/>
      <path d="M11.5 50 q-1.4 7 2.4 13" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" opacity=".8"/>
      <path d="M56.5 47 q2 5 1 10" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" opacity=".6"/>
      <g class="wing wl"${wl}><path d="M15 45 C9 46 5.5 54 8 62 C10 67 17 65 18 58 C19 52 18 47 15 45Z" fill="url(#${u}y)" stroke="${LINE}" stroke-width="2.3" stroke-linejoin="round"/><path d="M9.8 52 q-.5 5 1.6 8.5" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" opacity=".85"/></g>
      <g class="wing wr"><path d="M49 45 C55 46 58.5 54 56 62 C54 67 47 65 46 58 C45 52 46 47 49 45Z" fill="url(#${u}y)" stroke="${LINE}" stroke-width="2.3" stroke-linejoin="round"/></g>
      ${bodyAcc ? acc : ''}
      ${eyes}
      <path d="M21 33.4 C24.5 30 39.5 30 43 33.4 C44.8 38.6 38.5 42.6 32 42.6 C25.5 42.6 19.2 38.6 21 33.4Z" fill="url(#${u}k)" stroke="#C4380F" stroke-width="1.5" stroke-linejoin="round"/>
      <path d="M25 33.4 C28.5 31.6 35.5 31.6 39 33.4" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" opacity=".6"/>
      <path d="M24.8 37.4 q7.2 3.6 14.4 0" fill="none" stroke="#A02A0A" stroke-width="1.3" stroke-linecap="round" opacity=".9"/>
      ${bodyAcc ? '' : acc}
    </g>
  </svg>`;
}

// Оригинальная мультяшная утка (не копия стикеров Telegram): крупная голова, большие глаза
// с бликами, объёмные градиенты, лапки-перепонки. Мимика зависит от статуса.
let _duckUid = 0;
function duckSVG(a, opts = {}) {
  const u = 'd' + (++_duckUid);
  const c = a.color || '#E8A317';
  const ink = '#2B2F3A', st = a.status || 'idle';
  const mood = st === 'offline' ? 'sleep' : st === 'error' ? 'worry' : st === 'working' ? 'focus' : st === 'waiting' ? 'wait' : 'happy';

  const eyes = {
    sleep: `<path d="M21 26 q4 3 8 0 M35 26 q4 3 8 0" fill="none" stroke="${ink}" stroke-width="2.4" stroke-linecap="round"/>`,
    worry: `<g class="eyes"><ellipse cx="25" cy="26" rx="4.4" ry="5.2" fill="#fff" stroke="${ink}" stroke-width="1.4"/><ellipse cx="39" cy="26" rx="4.4" ry="5.2" fill="#fff" stroke="${ink}" stroke-width="1.4"/>
      <circle cx="25" cy="27.5" r="2.4" fill="${ink}"/><circle cx="39" cy="27.5" r="2.4" fill="${ink}"/></g>
      <path d="M20 19 l9 3 M44 19 l-9 3" stroke="${ink}" stroke-width="2" stroke-linecap="round"/>`,
    focus: `<g class="eyes"><ellipse cx="25" cy="26" rx="4.6" ry="5.4" fill="#fff" stroke="${ink}" stroke-width="1.4"/><ellipse cx="39" cy="26" rx="4.6" ry="5.4" fill="#fff" stroke="${ink}" stroke-width="1.4"/>
      <circle cx="26.2" cy="27" r="3" fill="${ink}"/><circle cx="40.2" cy="27" r="3" fill="${ink}"/><circle cx="27.2" cy="25.8" r="1.1" fill="#fff"/><circle cx="41.2" cy="25.8" r="1.1" fill="#fff"/></g>
      <path d="M20 20.5 l9 1.5 M44 20.5 l-9 1.5" stroke="${ink}" stroke-width="2" stroke-linecap="round"/>`,
    wait: `<g class="eyes"><ellipse cx="25" cy="26" rx="4.6" ry="5.4" fill="#fff" stroke="${ink}" stroke-width="1.4"/><ellipse cx="39" cy="26" rx="4.6" ry="5.4" fill="#fff" stroke="${ink}" stroke-width="1.4"/>
      <circle cx="26.6" cy="24.6" r="3" fill="${ink}"/><circle cx="40.6" cy="24.6" r="3" fill="${ink}"/><circle cx="27.6" cy="23.4" r="1.1" fill="#fff"/><circle cx="41.6" cy="23.4" r="1.1" fill="#fff"/></g>`,
    happy: `<g class="eyes"><ellipse cx="25" cy="26" rx="4.8" ry="5.8" fill="#fff" stroke="${ink}" stroke-width="1.4"/><ellipse cx="39" cy="26" rx="4.8" ry="5.8" fill="#fff" stroke="${ink}" stroke-width="1.4"/>
      <circle cx="25.6" cy="27" r="3.2" fill="${ink}"/><circle cx="39.6" cy="27" r="3.2" fill="${ink}"/><circle cx="26.8" cy="25.6" r="1.2" fill="#fff"/><circle cx="40.8" cy="25.6" r="1.2" fill="#fff"/></g>`,
  }[mood];

  const mouth = mood === 'worry' ? `<path d="M28 41 q4-3 8 0" fill="none" stroke="#a85a1d" stroke-width="1.6" stroke-linecap="round"/>`
    : mood === 'sleep' ? `<ellipse cx="32" cy="40" rx="2" ry="1.4" fill="#a85a1d"/>`
    : `<path d="M27 39.5 q5 4.5 10 0" fill="none" stroke="#a85a1d" stroke-width="1.7" stroke-linecap="round"/>`;

  const acc = {
    captain: `<path d="M17 18 Q32 2 47 18 L45 22 Q32 12 19 22Z" fill="${c}" stroke="#8a5a00" stroke-width="1.2"/><rect x="16" y="19" width="32" height="4.5" rx="2.2" fill="#8a5a00"/>
              <circle cx="32" cy="11.5" r="3.4" fill="#fff"/><path d="M32 8.6 l1 2.1 2.3.3-1.7 1.6.4 2.3-2-1.1-2 1.1.4-2.3-1.7-1.6 2.3-.3z" fill="${c}"/>`,
    glasses: `<g fill="rgba(255,255,255,.35)" stroke="${ink}" stroke-width="2.2"><circle cx="25" cy="26" r="7"/><circle cx="39" cy="26" r="7"/></g><path d="M32 26h0" stroke="${ink}" stroke-width="2.2"/><path d="M18 25 l-3-2 M46 25 l3-2" stroke="${ink}" stroke-width="2"/>`,
    tie: `<path d="M32 50 l-4 3.5 4 11 4-11z" fill="${c}" stroke="#14532d" stroke-width="1"/><path d="M28.5 49.5h7l-1.6 2.8h-3.8z" fill="#14532d"/>`,
    pen: `<path d="M18 14 q14-9 29 0 q-2 6-14 5 q-12 1-15-5z" fill="${c}" stroke="#5b2a86" stroke-width="1.2"/>`,
    cap: `<path d="M17 20 Q32 3 47 20Z" fill="${c}" stroke="#7a1f1f" stroke-width="1.2"/><path d="M30 20 h22 q3 0 3 3 h-25z" fill="#7a1f1f"/>`,
    headset: `<path d="M15 28 q0-18 17-18 t17 18" fill="none" stroke="${ink}" stroke-width="3.2" stroke-linecap="round"/><rect x="11" y="24" width="7" height="12" rx="3.4" fill="${c}" stroke="${ink}" stroke-width="1.2"/><rect x="46" y="24" width="7" height="12" rx="3.4" fill="${c}" stroke="${ink}" stroke-width="1.2"/><path d="M14 36 q2 9 15 10" fill="none" stroke="${ink}" stroke-width="2"/><circle cx="30" cy="46" r="2.6" fill="${ink}"/>`,
    bowtie: `<path d="M32 51 l-8-4.5v9z M32 51 l8-4.5v9z" fill="${c}" stroke="#155e75" stroke-width="1"/><circle cx="32" cy="51" r="2.4" fill="#155e75"/>`,
  }[a.look] || '';
  const bodyAcc = a.look === 'tie' || a.look === 'bowtie';

  return `<svg class="duck" viewBox="0 0 64 76" width="${opts.size || 64}" height="${opts.size ? opts.size * 76 / 64 : 76}" aria-hidden="true">
    <defs>
      <radialGradient id="${u}b" cx="35%" cy="28%" r="80%"><stop offset="0" stop-color="#FFE87A"/><stop offset=".55" stop-color="#FFD43B"/><stop offset="1" stop-color="#F0A800"/></radialGradient>
      <radialGradient id="${u}h" cx="35%" cy="25%" r="80%"><stop offset="0" stop-color="#FFEE90"/><stop offset=".6" stop-color="#FFD43B"/><stop offset="1" stop-color="#F2AE00"/></radialGradient>
      <linearGradient id="${u}k" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFA94D"/><stop offset="1" stop-color="#F0761A"/></linearGradient>
    </defs>
    <ellipse cx="32" cy="71" rx="19" ry="4" fill="#000" opacity=".14"/>
    <g class="feet"><path d="M20 66 q-3 4 1 5 q6 1 8-1 q-1-3-4-4z" fill="url(#${u}k)" stroke="#c9601a" stroke-width="1"/><path d="M44 66 q3 4-1 5 q-6 1-8-1 q1-3 4-4z" fill="url(#${u}k)" stroke="#c9601a" stroke-width="1"/></g>
    <g class="wiggle">
      <path d="M32 36 q-21 0-21 18 q0 14 21 14 q21 0 21-14 q0-18-21-18z" fill="url(#${u}b)" stroke="#D99A00" stroke-width="1.2"/>
      <ellipse cx="32" cy="56" rx="12" ry="9" fill="#FFF3C4" opacity=".85"/>
      <g class="wing wl"><path d="M13 46 q-7 8-2 18 q7 1 9-8 q0-7-7-10z" fill="#F7BE1B" stroke="#D99A00" stroke-width="1.1"/></g>
      <g class="wing wr"><path d="M51 46 q7 8 2 18 q-7 1-9-8 q0-7 7-10z" fill="#F7BE1B" stroke="#D99A00" stroke-width="1.1"/></g>
      ${bodyAcc ? acc : ''}
      <path d="M32 6 q4-5 7-2 q-3 1-4 4z" fill="#F7BE1B" class="tuft"/>
      <ellipse cx="32" cy="25" rx="20" ry="18.5" fill="url(#${u}h)" stroke="#D99A00" stroke-width="1.2"/>
      <ellipse cx="22" cy="14" rx="7" ry="3.5" fill="#fff" opacity=".35" transform="rotate(-25 22 14)"/>
      <circle cx="17.5" cy="33" r="3.4" fill="#ff8f8f" opacity=".5"/><circle cx="46.5" cy="33" r="3.4" fill="#ff8f8f" opacity=".5"/>
      ${eyes}
      <path d="M21 33 q11-3.5 22 0 q1 8-11 9 q-12-1-11-9z" fill="url(#${u}k)" stroke="#c9601a" stroke-width="1.2"/>
      <ellipse cx="27.5" cy="35" rx="1.1" ry=".8" fill="#8a3d0a" opacity=".6"/><ellipse cx="36.5" cy="35" rx="1.1" ry=".8" fill="#8a3d0a" opacity=".6"/>
      ${mouth}
      ${bodyAcc ? '' : acc}
    </g>
  </svg>`;
}

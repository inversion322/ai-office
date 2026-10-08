// Мультяшные утки в SVG. Один генератор, у каждой роли свой аксессуар и цвет.
// Вид «три четверти сверху»: корпус, голова, клюв, глаза, крылья-«руки» (печатают).
function duckSVG(a, opts = {}) {
  const c = a.color || '#E8A317';
  const body = '#FFD84D', belly = '#FFF1B8', beak = '#F2994A', ink = '#2B2F3A';
  const typing = opts.typing ? ' typing' : '';
  const look = a.look || '';

  const acc = {
    captain: `<path d="M18 17 Q32 3 46 17 L44 21 Q32 13 20 21Z" fill="${c}"/><rect x="17" y="19" width="30" height="4" rx="2" fill="#B5790A"/><circle cx="32" cy="10" r="3" fill="#fff"/>
              <path d="M32 7 l1.2 2.4 2.6.4-1.9 1.8.5 2.6-2.4-1.3-2.4 1.3.5-2.6-1.9-1.8 2.6-.4z" fill="${c}"/>`,
    glasses: `<g fill="none" stroke="${ink}" stroke-width="2"><circle cx="25" cy="27" r="5.5"/><circle cx="39" cy="27" r="5.5"/><path d="M30.5 27h3"/></g>`,
    tie: `<path d="M32 49 l-3.5 4 3.5 9 3.5-9z" fill="${c}"/><path d="M29 49h6l-1.5 2h-3z" fill="#1d6b3a"/>`,
    pen: `<g transform="rotate(25 50 42)"><rect x="47" y="30" width="4" height="22" rx="2" fill="${c}"/><path d="M47 52h4l-2 5z" fill="${ink}"/></g>
          <path d="M40 17 q8-2 10 6" fill="none" stroke="${c}" stroke-width="3" stroke-linecap="round"/>`,
    cap: `<path d="M17 20 Q32 4 47 20Z" fill="${c}"/><rect x="14" y="19" width="36" height="4" rx="2" fill="#a83232"/>`,
    headset: `<path d="M16 28 q0-17 16-17 t16 17" fill="none" stroke="${ink}" stroke-width="3"/><rect x="12" y="25" width="6" height="11" rx="3" fill="${c}"/><rect x="46" y="25" width="6" height="11" rx="3" fill="${c}"/><path d="M15 36 q2 8 14 9" fill="none" stroke="${ink}" stroke-width="2"/><circle cx="30" cy="45" r="2.2" fill="${ink}"/>`,
    bowtie: `<path d="M32 50 l-7-4v8z M32 50 l7-4v8z" fill="${c}"/><circle cx="32" cy="50" r="2.2" fill="#2b7a99"/>`,
  }[look] || '';

  return `<svg class="duck${typing}" viewBox="0 0 64 72" width="${opts.size || 64}" height="${opts.size ? opts.size * 72 / 64 : 72}" aria-hidden="true">
    <ellipse cx="32" cy="68" rx="17" ry="3.5" fill="#000" opacity=".12"/>
    <g class="wiggle">
      <path d="M13 50 Q12 36 32 34 Q52 36 51 50 Q50 66 32 66 Q14 66 13 50Z" fill="${body}"/>
      <ellipse cx="32" cy="55" rx="11" ry="8" fill="${belly}"/>
      <g class="wing wl"><ellipse cx="14" cy="50" rx="5" ry="9" fill="#F5C518" transform="rotate(12 14 50)"/></g>
      <g class="wing wr"><ellipse cx="50" cy="50" rx="5" ry="9" fill="#F5C518" transform="rotate(-12 50 50)"/></g>
      ${look === 'tie' || look === 'bowtie' ? acc : ''}
      <circle cx="32" cy="25" r="16" fill="${body}"/>
      <ellipse cx="32" cy="31" rx="9" ry="6" fill="${beak}"/>
      <path d="M26 31 q6 3 12 0" fill="none" stroke="#c9722b" stroke-width="1.4" stroke-linecap="round"/>
      <g class="eyes"><ellipse cx="25" cy="22" rx="2.6" ry="3.2" fill="${ink}"/><ellipse cx="39" cy="22" rx="2.6" ry="3.2" fill="${ink}"/>
        <circle cx="25.8" cy="21" r=".9" fill="#fff"/><circle cx="39.8" cy="21" r=".9" fill="#fff"/></g>
      <circle cx="20" cy="29" r="2.6" fill="#ff9aa2" opacity=".55"/><circle cx="44" cy="29" r="2.6" fill="#ff9aa2" opacity=".55"/>
      ${look !== 'tie' && look !== 'bowtie' ? acc : ''}
    </g>
  </svg>`;
}

import { createBatch5View, b5Text, esc } from './batch5-kit.js';

function board(S) {
  const n = S.size, step = 480 / n, point = (row, col) => [60 + col * step, 60 + row * step];
  const boxes = S.boxes.map((owner, i) => {
    if (!owner) return '';
    const [x, y] = point(Math.floor(i / n), i % n);
    return `<g class="db-claimed b5-seat-${owner - 1}"><rect x="${x + 8}" y="${y + 8}" width="${step - 16}" height="${step - 16}" rx="16"/><text x="${x + step / 2}" y="${y + step / 2 + 12}">${owner}</text></g>`;
  }).join('');
  const edges = S.edges.map((owner, i) => {
    const horizontal = i < n * (n + 1), j = horizontal ? i : i - n * (n + 1);
    const [x, y] = point(Math.floor(j / (horizontal ? n : n + 1)), j % (horizontal ? n : n + 1));
    const dx = horizontal ? step : 0, dy = horizontal ? 0 : step;
    return `<g id="db-edge-${i}" data-edge="${i}" role="button" aria-label="${horizontal ? 'Horizontal' : 'Vertical'} line ${j + 1}${owner ? ', drawn' : ''}" class="db-edge ${owner ? `is-drawn b5-seat-${owner - 1}` : ''}${S.lastMove?.edge === i ? ' is-last' : ''}">
      <rect class="db-hit" x="${x - (horizontal ? 0 : 38)}" y="${y - (horizontal ? 38 : 0)}" width="${horizontal ? step : 76}" height="${horizontal ? 76 : step}" rx="16"/>
      <path d="M${x},${y}l${dx},${dy}"/>
    </g>`;
  }).join('');
  const dots = Array.from({ length: (n + 1) ** 2 }, (_, i) => {
    const [x, y] = point(Math.floor(i / (n + 1)), i % (n + 1));
    return `<circle cx="${x}" cy="${y}" r="9"/>`;
  }).join('');
  return `<svg class="db-board" viewBox="0 0 600 600" role="group" aria-label="${n} by ${n} box notebook"><rect class="db-paper" x="8" y="8" width="584" height="584" rx="30"/><path class="db-margin" d="M28 18V582"/>${boxes}${edges}<g class="db-dots" pointer-events="none">${dots}</g><text class="db-label" x="300" y="578">${esc(b5Text(S, 'boardLabel'))}</text></svg>`;
}

export default createBatch5View({
  id: 'dots-boxes', prefix: 'db-game', title: 'Dots & Boxes', board,
  columns: 4, meta: S => `${S.size} × ${S.size} boxes`,
  stat: (S, pid) => S.counts[pid], unit: S => b5Text(S, 'unit'),
  hud: S => b5Text(S, 'hud', { n: S.boxes.filter(Boolean).length, total: S.boxes.length }),
  hint: S => b5Text(S, S.lastMove?.claimed?.length ? 'extraTurn' : 'hint'),
});

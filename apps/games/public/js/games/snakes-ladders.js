import { createBatch5View, b5Text, b5Die, esc } from './batch5-kit.js';

function point(square) {
  const row = Math.floor((Math.max(1, square) - 1) / 10), col = (square - 1) % 10;
  return [25 + (row % 2 ? 9 - col : col) * 50, 475 - row * 50];
}

function ladder(from, to) {
  const [x, y] = point(Number(from)), [tx, ty] = point(to), dx = tx - x, dy = ty - y;
  const length = Math.hypot(dx, dy), px = -dy / length * 6, py = dx / length * 6;
  const count = Math.max(3, Math.floor(length / 18));
  const rungs = Array.from({ length: count }, (_, i) => {
    const t = (i + .5) / count, cx = x + dx * t, cy = y + dy * t;
    return `<path d="M${cx - px} ${cy - py}L${cx + px} ${cy + py}"/>`;
  }).join('');
  return `<g class="sl-ladder"><path d="M${x - px} ${y - py}L${tx - px} ${ty - py}M${x + px} ${y + py}L${tx + px} ${ty + py}"/>${rungs}</g>`;
}

function snake(from, to, i) {
  const [x, y] = point(Number(from)), [tx, ty] = point(to);
  return `<g class="sl-snake sl-snake-${i % 3}"><path class="sl-snake-body" d="M${x} ${y}C${x + 42} ${y + 42},${tx - 42} ${ty - 42},${tx} ${ty}"/><circle class="sl-head" cx="${x}" cy="${y}" r="9"/><g class="sl-eyes"><circle cx="${x - 3}" cy="${y - 3}" r="2"/><circle cx="${x + 3}" cy="${y - 3}" r="2"/></g></g>`;
}

function board(S) {
  const cells = Array.from({ length: 100 }, (_, i) => {
    const [x, y] = point(i + 1);
    return `<g><rect class="sl-square sl-shade-${(Math.floor(i / 10) + i) % 3}" x="${x - 25}" y="${y - 25}" width="50" height="50"/><text class="sl-number" x="${x - 20}" y="${y - 11}">${i + 1}</text></g>`;
  }).join('');
  const pawns = S.seats.map((pid, i) => {
    if (S.out.includes(pid)) return '';
    const [x, y] = point(Math.max(1, S.positions[pid]));
    const ox = (i % 3 - 1) * 12, oy = Math.floor(i / 3) * 14;
    return `<g class="sl-pawn b5-seat-${i}" transform="translate(${x + ox} ${y + oy})"><circle class="sl-pawn-shadow" cy="5" r="11"/><circle class="sl-pawn-piece" r="10"/><text y="4">${i + 1}</text></g>`;
  }).join('');
  const last = S.lastMove ? point(S.lastMove.to) : null;
  return `<div class="sl-scene"><svg class="sl-board" viewBox="-8 -8 516 516" role="img" aria-label="Garden trail from 1 to 100, eight snakes and eight ladders"><rect class="sl-frame" x="-8" y="-8" width="516" height="516" rx="18"/>${cells}<g pointer-events="none">${Object.entries(S.ladders).map(([a, b]) => ladder(a, b)).join('')}${Object.entries(S.snakes).map(([a, b], i) => snake(a, b, i)).join('')}${last ? `<circle class="sl-last" cx="${last[0]}" cy="${last[1]}" r="22"/>` : ''}${pawns}</g></svg><p class="sl-trail-note">${esc(b5Text(S, 'trailNote'))}</p></div>`;
}

export default createBatch5View({
  id: 'snakes-ladders', prefix: 'sl-game', title: 'Snakes & Ladders', board,
  extra: '<div class="sl-roll"><div class="sl-die-slot"></div><button type="button" class="tb-btn tb-primary" data-roll>Roll</button></div><p class="tb-reason sl-roll-reason"></p>',
  meta: S => b5Text(S, S.exactFinish ? 'exact' : 'reach'), stat: (S, pid) => S.positions[pid], unit: S => b5Text(S, 'unit'),
  hud: S => b5Text(S, 'hud', { n: S.finished.length }),
  hint: S => S.lastMove ? b5Text(S, S.lastMove.to > S.lastMove.landing ? 'climb' : S.lastMove.to < S.lastMove.landing ? 'slide' : 'step', { from: S.lastMove.from, to: S.lastMove.to }) : b5Text(S, 'hint'),
  paint(el, S, pending) {
    const slot = el.querySelector('.sl-die-slot');
    if (slot.dataset.rev !== String(S.rev)) {
      slot.innerHTML = b5Die(S.die, Number(slot.dataset.rev) < S.rev && !!S.lastMove?.die);
      slot.dataset.rev = S.rev;
    }
    el.querySelector('.sl-roll-reason').textContent = pending ? 'Sending your roll…' :
      S.spectator || S.youAre !== S.turn ? b5Text(S, 'waitReason') : b5Text(S, 'timerHint');
  },
});

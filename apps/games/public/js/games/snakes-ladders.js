import { raceSquares, hopPose, placePose, mixPoint, HOP_MS, DICE_MS } from './board-motion.js';
import { createBatch5View, b5Text, b5Die, esc } from './batch5-kit.js';

export function point(square) {
  square = Math.max(1, square);
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
  return `<g class="sl-ladder" data-ladder="${from}"><path class="sl-ladder-glow" opacity="0" d="M${x} ${y}L${tx} ${ty}"/><path d="M${x - px} ${y - py}L${tx - px} ${ty - py}M${x + px} ${y + py}L${tx + px} ${ty + py}"/>${rungs}</g>`;
}

function snake(from, to, i) {
  const [x, y] = point(Number(from)), [tx, ty] = point(to);
  return `<g class="sl-snake sl-snake-${i % 3}" data-snake="${from}"><path class="sl-snake-body" d="M${x} ${y}C${x + 42} ${y + 42},${tx - 42} ${ty - 42},${tx} ${ty}"/><g class="sl-gulp"><circle class="sl-head" cx="${x}" cy="${y}" r="9"/><g class="sl-eyes"><circle cx="${x - 3}" cy="${y - 3}" r="2"/><circle cx="${x + 3}" cy="${y - 3}" r="2"/></g></g></g>`;
}

function board(S) {
  const cells = Array.from({ length: 100 }, (_, i) => {
    const [x, y] = point(i + 1);
    return `<g><rect class="sl-square sl-shade-${(Math.floor(i / 10) + i) % 3}" x="${x - 25}" y="${y - 25}" width="50" height="50"/><text class="sl-number" x="${x - 20}" y="${y - 11}">${i + 1}</text></g>`;
  }).join('');
  // Print square labels above the snakes and ladders, like a real board.
  const numbers = Array.from({ length: 100 }, (_, i) => {
    const [x, y] = point(i + 1);
    return `<text class="sl-number" x="${x - 20}" y="${y - 11}">${i + 1}</text>`;
  }).join('');
  const pawns = S.seats.map((pid, i) => {
    if (S.out.includes(pid)) return '';
    const [x, y] = point(Math.max(1, S.positions[pid]));
    const ox = (i % 3 - 1) * 12, oy = Math.floor(i / 3) * 14;
    return `<g class="sl-pawn b5-seat-${i}" data-sl-pawn="${i}" data-square="${S.positions[pid]}" transform="translate(${x + ox} ${y + oy})"><g class="sl-pawn-motion"><circle class="sl-pawn-shadow" cy="5" r="11"/><circle class="sl-pawn-piece" r="10"/><text y="4">${i + 1}</text></g></g>`;
  }).join('');
  const last = S.lastMove ? point(S.lastMove.to) : null;
  return `<div class="sl-scene"><svg class="sl-board" viewBox="-8 -8 516 516" role="img" aria-label="Garden trail from 1 to 100, eight snakes and eight ladders"><rect class="sl-frame" x="-8" y="-8" width="516" height="516" rx="18"/>${cells}<g pointer-events="none">${Object.entries(S.ladders).map(([a, b]) => ladder(a, b)).join('')}${Object.entries(S.snakes).map(([a, b], i) => snake(a, b, i)).join('')}${last ? `<circle class="sl-last" cx="${last[0]}" cy="${last[1]}" r="22"/>` : ''}${numbers}${pawns}<g class="sl-pop" opacity="0"><circle r="15"/></g><g class="sl-confetti" aria-hidden="true">${Array.from({length: 18}, (_, i) => `<rect class="b5-seat-${i % 6}" width="5" height="9" rx="2" opacity="0"/>`).join('')}</g></g></svg><p class="sl-trail-note">${esc(b5Text(S, 'trailNote'))}</p></div>`;
}

// Draw at authority's final square; animate only a child relative to it.
// Replacing this SVG on a newer snapshot therefore fast-forwards every pawn.
export function trailMotion(el, S) {
  const m = S.lastMove, pid = S.seats[m.side];
  if (!pid || S.positions[pid] !== m.to || S.out.includes(pid)) return null;
  const node = el.querySelector(`[data-sl-pawn="${m.side}"]`)?.querySelector('.sl-pawn-motion');
  const offset = [(m.side % 3 - 1) * 12, Math.floor(m.side / 3) * 14];
  const withOffset = p => p.map((v, i) => v + offset[i]);
  const destination = withOffset(point(m.to));
  const squares = raceSquares(m.from, m.die, 100, S.exactFinish);
  if (squares.at(-1) !== m.landing) return null;
  const points = squares.map(n => withOffset(point(n)));
  const hopsEnd = DICE_MS + (points.length - 1) * HOP_MS;
  const transport = m.to !== m.landing, climb = m.to > m.landing;
  const travelStart = hopsEnd + (transport ? 180 : 0), travelMs = transport ? (climb ? 700 : 800) : 0;
  const landAt = travelStart + travelMs, duration = landAt + (m.to === 100 ? 700 : 180);
  const ladderGlow = el.querySelector(`[data-ladder="${m.landing}"]`)?.querySelector('.sl-ladder-glow');
  const snake = el.querySelector(`[data-snake="${m.landing}"]`)?.querySelector('.sl-snake-body');
  const gulp = el.querySelector(`[data-snake="${m.landing}"]`)?.querySelector('.sl-gulp');
  const length = snake?.getTotalLength?.();
  const pop = el.querySelector('.sl-pop'), mark = el.querySelector('.sl-last');
  const confetti = [...el.querySelectorAll('.sl-confetti rect')];
  return { duration, frame(ms) {
    let pose = hopPose(points, Math.max(0, ms - DICE_MS));
    const traveling = transport && ms >= travelStart && ms < landAt;
    if (transport && ms >= hopsEnd) {
      const t = Math.max(0, Math.min(1, (ms - travelStart) / travelMs));
      // The slide samples the SAME SVG path that paints the snake body.
      const p = length ? snake.getPointAtLength(length * t) : null;
      const center = p ? [p.x, p.y] : mixPoint(point(m.landing), point(m.to), t);
      // Join the centre line, then spread back into the resting seat slots.
      const spread = Math.max(0, 1 - t * 6, (t - 5 / 6) * 6);
      pose = { point: center.map((v, i) => v + offset[i] * spread), sx: 1, sy: 1 };
    }
    if (ms >= landAt) {
      const t = Math.min(1, (ms - landAt) / 180), squash = Math.sin(t * Math.PI) * .18;
      pose = { point: destination, sx: 1 + squash, sy: 1 - squash };
    }
    placePose(node, pose, destination);
    mark?.setAttribute('opacity', ms >= landAt ? '1' : '0');
    ladderGlow?.setAttribute('opacity', traveling ? String(.5 + .2 * Math.sin((ms - travelStart) / 70)) : '0');
    if (gulp) {
      const [x,y] = point(m.landing), pulse = traveling ? Math.sin((ms - travelStart) / 42) * (1 - (ms - travelStart) / travelMs) : 0;
      gulp.setAttribute('transform', `translate(${x} ${y}) rotate(${pulse * 9}) scale(${1 + pulse * .12} ${1 - pulse * .06}) translate(${-x} ${-y})`);
    }
    const landing = ms >= landAt, local = landing ? ms - landAt : (ms - DICE_MS) % HOP_MS - HOP_MS * .82;
    const t = Math.max(0, Math.min(1, local / (landing ? 180 : HOP_MS * .18)));
    pop?.setAttribute('transform', `translate(${pose.point[0]} ${pose.point[1] + 5}) scale(${.7 + t * .8})`);
    pop?.setAttribute('opacity', local >= 0 && local <= 180 ? String((1 - t) * .45) : '0');
    if (m.to === 100) confetti.forEach((n, i) => {
      const t = Math.max(0, Math.min(1, (ms - landAt) / 700)), angle = i * 2.4;
      n.setAttribute('transform', `translate(${destination[0] + Math.cos(angle) * t * 65} ${destination[1] - Math.sin(i * .8) * t * 45 + t * t * 50}) rotate(${t * (i % 2 ? 260 : -260)})`);
      n.setAttribute('opacity', ms >= landAt ? String((1 - t) * .9) : '0');
    });
  } };
}

export default createBatch5View({
  id: 'snakes-ladders', prefix: 'sl-game', title: 'Snakes & Ladders', board,
  extra: '<div class="sl-roll"><div class="sl-die-slot"></div><button type="button" class="tb-btn tb-primary" data-roll>Roll</button></div><p class="tb-reason sl-roll-reason"></p>',
  meta: S => b5Text(S, S.exactFinish ? 'exact' : 'reach'), stat: (S, pid) => S.positions[pid], unit: S => b5Text(S, 'unit'),
  hud: S => b5Text(S, 'hud', { n: S.finished.length }),
  hint: S => S.lastMove ? b5Text(S, S.lastMove.to > S.lastMove.landing ? 'climb' : S.lastMove.to < S.lastMove.landing ? 'slide' : 'step', { from: S.lastMove.from, to: S.lastMove.to }) : b5Text(S, 'hint'),
  motion: trailMotion,
  paint(el, S, pending, moving) {
    const slot = el.querySelector('.sl-die-slot');
    if (slot.dataset.rev !== String(S.rev)) {
      slot.innerHTML = b5Die(S.die);
      slot.dataset.rev = S.rev;
    }
    el.querySelector('.sl-roll-reason').textContent = pending ? 'Sending your roll…' : moving ? 'Following the trail…' :
      S.spectator || S.youAre !== S.turn ? b5Text(S, 'waitReason') : b5Text(S, 'timerHint');
  },
});

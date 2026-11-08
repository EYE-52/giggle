import { createBatch5View, b5Text } from './batch5-kit.js';

function mark(side, x, y, size, cls = '') {
  return side === 1 ? `<path class="mt-x ${cls}" d="M${x - size},${y - size}l${2 * size},${2 * size}m0,${-2 * size}l${-2 * size},${2 * size}"/>` :
    `<circle class="mt-o ${cls}" cx="${x}" cy="${y}" r="${size}"/>`;
}

function board(S) {
  return `<svg class="mt-board" viewBox="0 0 600 600" role="group" aria-label="Nine small tic-tac-toe boards"><rect class="mt-frame" x="4" y="4" width="592" height="592" rx="32"/>${S.small.map((winner, b) => {
    const x = 16 + b % 3 * 192, y = 16 + Math.floor(b / 3) * 192;
    const open = !winner && (S.forced < 0 || S.forced === b) && S.phase === 'play';
    const cells = S.board.slice(b * 9, b * 9 + 9).map((side, cell) => {
      const cx = x + 10 + cell % 3 * 56, cy = y + 10 + Math.floor(cell / 3) * 56, index = b * 9 + cell;
      return `<g id="mt-cell-${index}" data-cell="${index}" role="button" aria-label="Board ${b + 1}, cell ${cell + 1}${side ? side === 1 ? ', X' : ', O' : ', empty'}"><rect class="mt-cell${S.lastMove?.cell === index ? ' is-last' : ''}" x="${cx}" y="${cy}" width="52" height="52" rx="8"/>${side ? mark(side, cx + 26, cy + 26, 15) : ''}</g>`;
    }).join('');
    const state = winner ? 'is-closed' : open ? 'is-open' : 'is-blocked';
    return `<g class="mt-small ${state}" data-board="${b}">
      <rect class="mt-rim" x="${x}" y="${y}" width="184" height="184" rx="20"/>
      ${cells}
      ${winner && winner < 3 ? `<g class="mt-won" pointer-events="none">${mark(winner, x + 92, y + 92, 64, 'mt-trophy')}</g>` : ''}
      ${winner === 3 ? `<path class="mt-drawn" d="M${x + 52},${y + 92}h80" pointer-events="none"/>` : ''}
    </g>`;
  }).join('')}</svg>`;
}

export default createBatch5View({
  id: 'mega-tic-tac-toe', prefix: 'mt-game', title: 'Mega Tic-Tac-Toe', board, columns: 3,
  meta: S => b5Text(S, 'meta'), side: (_, i) => i ? 'O' : 'X',
  stat: (S, pid) => S.small.filter(v => v === S.seats.indexOf(pid) + 1).length,
  unit: S => b5Text(S, 'unit'), hud: S => b5Text(S, S.forced < 0 ? 'free' : 'forced', { board: S.forced + 1 }),
  hint: S => b5Text(S, 'hint'),
});

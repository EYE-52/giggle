import { createBatch5View, b5Text } from './batch5-kit.js';

function board(S) {
  const grid = Array.from({ length: 15 }, (_, i) => `<path d="M15 ${15 + i * 30}H435M${15 + i * 30} 15V435"/>`).join('');
  const stars = [48, 56, 112, 168, 176].map(i => `<circle cx="${15 + i % 15 * 30}" cy="${15 + Math.floor(i / 15) * 30}" r="3"/>`).join('');
  return `<svg class="fv-board" viewBox="0 0 450 450" role="group" aria-label="15 by 15 wooden stone board"><rect class="fv-wood" width="450" height="450" rx="14"/><g class="fv-grid">${grid}${stars}</g>${S.board.map((colour, i) => {
    const x = i % 15 * 30, y = Math.floor(i / 15) * 30;
    return `<g id="fv-cell-${i}" data-cell="${i}" role="button" aria-label="Row ${Math.floor(i / 15) + 1}, column ${i % 15 + 1}${colour ? colour === 1 ? ', black' : ', white' : ', empty'}"><rect class="fv-hit" x="${x}" y="${y}" width="30" height="30"/>${colour ? `<circle class="fv-stone fv-colour-${colour}" cx="${x + 15}" cy="${y + 16}" r="12"/><circle class="fv-shine" cx="${x + 11}" cy="${y + 11}" r="4"/>` : ''}${S.lastMove?.cell === i ? `<path class="fv-last" d="M${x + 11} ${y + 15}h8m-4 -4v8"/>` : ''}${S.winning.includes(i) ? `<circle class="fv-win" cx="${x + 15}" cy="${y + 15}" r="14"/>` : ''}</g>`;
  }).join('')}</svg>`;
}

export default createBatch5View({
  id: 'five-row', prefix: 'fv-game', title: 'Five in a Row', board, columns: 15,
  extra: '<button class="tb-btn tb-chip fv-swap" data-swap>Swap colours</button><p class="tb-reason fv-swap-reason"></p>',
  meta: S => b5Text(S, 'meta'), side: (S, i) => b5Text(S, S.colours[i] === 1 ? 'black' : 'white'),
  stat: (S, pid) => S.board.filter(v => v === S.colours[S.seats.indexOf(pid)]).length,
  unit: S => b5Text(S, 'unit'), hud: S => b5Text(S, 'hud', { n: S.moves }),
  hint: S => b5Text(S, S.swapAvailable ? 'swapHint' : 'hint'),
  paint(el, S) {
    // The opening choice always owns the same slot, including after it closes.
    const b = el.querySelector('[data-swap]');
    b.style.visibility = S.swapAvailable ? 'visible' : 'hidden';
    el.querySelector('.fv-swap-reason').textContent = S.swapAvailable ? b5Text(S, 'swapHint') : '';
  },
});

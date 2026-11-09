import { createBatch5View, b5Text, b5Die, esc } from './batch5-kit.js';

function board(S) {
  return `<div class="pd-table"><div class="pd-coins" aria-hidden="true"><i></i><i></i><i></i></div>
    <svg class="pd-pig" viewBox="0 0 400 250" aria-hidden="true"><ellipse class="pd-shadow" cx="207" cy="226" rx="138" ry="12"/><path class="pd-body" d="M101 180Q52 151 76 92Q95 44 168 48L208 15L230 52Q297 42 327 101L356 106Q367 107 367 125V154Q367 169 348 169L322 171L306 219H275L266 190H164L151 219H119Z"/><ellipse class="pd-snout" cx="349" cy="137" rx="19" ry="25"/><path class="pd-slot" d="M168 62H218"/><circle class="pd-eye" cx="299" cy="98" r="7"/><path class="pd-tail" d="M74 128C30 139 39 88 57 102C69 116 43 129 31 113"/></svg>
    <div class="pd-pot"><small>${esc(b5Text(S, 'pot'))}</small><b>${S.turnTotal}</b></div>
    <div class="pd-dice-tray">${b5Die(S.die)}</div>
    <p class="pd-roll-note">${esc(b5Text(S, S.lastMove?.die === 1 ? 'bust' : S.finalRound !== null ? 'finalRound' : 'risk'))}</p>
    <div class="pd-controls"><button type="button" class="tb-btn tb-primary" data-roll>Roll</button><button type="button" class="tb-btn tb-secondary" data-hold>Hold</button></div>
    <p class="tb-reason pd-reason"></p></div>`;
}

export default createBatch5View({
  id: 'pig-dice', prefix: 'pd-game', title: 'Pig Dice', board,
  meta: S => b5Text(S, 'meta', { target: S.target }), stat: (S, pid) => S.banked[pid], unit: S => b5Text(S, 'unit'),
  hud: S => b5Text(S, S.finalRound !== null ? 'finalRound' : 'hud', { n: S.roundNo }),
  hint: S => b5Text(S, 'hint'),
  paint(el, S, pending, moving) {
    el.querySelector('.pd-reason').textContent = pending ? 'Sending your roll…' : moving ? 'Rolling…' :
      S.spectator || S.youAre !== S.turn ? b5Text(S, 'waitReason') : b5Text(S, 'timerHint');
  },
});

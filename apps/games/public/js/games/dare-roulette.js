/* Dare Roulette view: spin the wheel, one victim takes the dare,
 * the room votes done/chicken. The server picks the victim after Spin —
 * this view never animates a fake landing. */
import { esc, nameOf, ensureStylesheet } from '../util.js';
import { paintFinal, syncHudTimer, stopHudTimer } from '../kit.js';

let visualKey = '', liveApi = null, liveEl = null, liveState = null, liveActionKey = '';

function plural(n, one, many = one + 's') { return `${n} ${n === 1 ? one : many}`; }

function hud(S) {
  const n = (S.players || []).length;
  const watch = S.spectator || !(S.players || []).some((p) => p.id === S.me);
  const round = Math.max(1, Math.min(S.phase === 'spin' ? (S.round || 0) + 1 : S.round || 1, S.rounds || 1));
  const phase = { done: 'Final scores', reveal: 'Results', spin: 'Spin', perform: 'Perform', verdict: 'Vote' }[S.phase] || '';
  const progress = S.phase === 'verdict' ? `${(S.voted || []).length} of ${Math.max(0, n - 1)} locked in` : '';
  return `<header class="gk-hud party-hud" data-phase="${esc(S.phase)}" aria-label="Dare and play status">`
    + `<span class="gk-hud-round party-round">Round ${round} of ${S.rounds || 1}</span>`
    + `<span class="gk-hud-phase party-phase">${esc(phase)}</span>`
    + (watch ? '<span class="party-spectator">Watching</span>' : '')
    + `<span class="gk-hud-progress party-progress">${esc(progress)}</span>`
    + `<span class="gk-hud-timer" aria-hidden="true"></span>`
    + `</header>`;
}


function ensureCss() {
  ensureStylesheet('party-scenes-css', '/css/party-scenes.css');
  ensureStylesheet('dare-roulette-css', '/css/dare-roulette.css');
}

function isWatching(S) {
  if (S.spectator === true) return true;
  const ps = S.players || [];
  return S.me != null && ps.length > 0 && !ps.some((p) => p.id === S.me);
}

function initial(name) {
  return (String(name || '?').trim().charAt(0) || '?').toUpperCase();
}


function person(S, pid, cls, note) {
  const name = nameOf(S, pid);
  return `<span class="party-person${cls ? ` ${cls}` : ''}">`
    + `<span class="party-avatar" aria-hidden="true">${esc(initial(name))}</span>`
    + `<span class="party-label">${esc(name)}</span>`
    + `<span class="party-meta">${esc(note || '')}</span></span>`;
}


function wheel(S, landed = false) {
  const players = S.players || [];
  const colors = ['#ffd25c', '#90d6c1', '#e7a2c1', '#bfa7e5'];
  const count = Math.max(1, players.length);
  const segments = players.map((p, i) => `${colors[i % colors.length]} ${i / count * 360}deg ${(i + 1) / count * 360}deg`).join(', ');
  const picked = players.findIndex(p => p.id === S.victim);
  const angle = landed && picked >= 0 ? -(picked + .5) / count * 360 : 0;
  return `<div class="party-wheel${landed ? ' is-landed' : ''}" style="--wheel-angle:${angle}deg" aria-label="${landed ? 'Wheel landed on ' + esc(nameOf(S, S.victim)) : 'Wheel with ' + players.length + ' players'}" role="img"><div class="party-wheel-disc" style="background:conic-gradient(${segments || '#ffd25c'})">${players.map((p, i) => `<span class="party-wheel-name" style="--seat-angle:${(i + .5) / count * 360}deg"><span>${esc(initial(p.name))}</span></span>`).join('')}</div><span class="party-wheel-pin" aria-hidden="true"></span></div>`;
}

function meter(S, label, pids, win) {
  const total = pids.total;
  const voters = pids.voters;
  const pct = total ? Math.round((voters.length / total) * 100) : 0;
  const n = voters.length;
  return `<div class="party-result${win ? ' party-result--winner' : ''}">`
    + `<span class="party-label">${esc(label)}</span>`
    + `<div class="party-meter" role="img" aria-label="${esc(label)}: ${n} of ${total} votes"><span style="width:${pct}%"></span></div>`
    + `<span class="party-meta">${n} vote${n === 1 ? '' : 's'}`
    + (voters.length ? ` · ${voters.map((pid) => esc(nameOf(S, pid))).join(', ')}` : '') + '</span></div>';
}

function lastRecap(S, L) {
  const verdict = L.skipped ? 'Skipped (left the game)' : L.done + L.chicken === 0 ? 'No verdict' : L.success ? 'Completed' : L.split ? 'Even split' : 'Not completed';
  return `Last dare · ${nameOf(S, L.victim)}: ${L.dare} · ${verdict} (${L.done} done, ${L.chicken} chicken)`;
}

function paint(el, S, api) {
    ensureCss();
    if (S.phase === 'done') { visualKey = ''; paintFinal(el, { scene: 'dare-roulette', scores: S.scores || {}, players: S.players || [], you: isWatching(S) ? null : S.me, watching: isWatching(S), note: S.last ? lastRecap(S, S.last) : '' }); return; }
    liveApi = api;
    liveEl = el;
    liveState = S;
    const actionKey = JSON.stringify([S.instanceId, S.me, S.phase, S.round, S.index, S.endsAt, S.target, S.subject, S.victim, S.turn, S.hostId, !!S.spectator, !!S.current?.mine, S.myEntry, S.myOption, S.myLines, S.myVote, S.myPick]);
    liveActionKey = actionKey;
    const canAct = () => liveEl === el && liveActionKey === actionKey && liveState && !liveState.preparing && !liveState.spectator && (liveState.players || []).some(p => p.id === liveState.me);
    const sendAction = action => canAct() ? liveApi?.send(action) : false;
    const liveHud = el.querySelector ? el.querySelector('.party-hud') : null;
    if (liveHud) liveHud.outerHTML = hud(S);
    if (['vote', 'pick', 'verdict', 'reveal', 'done'].includes(S.phase)) {
      const key = JSON.stringify({ ...S, audioBaseline: undefined, voted: undefined, answered: undefined, submitted: undefined,
        picked: Array.isArray(S.picked) ? undefined : S.picked });
      if (visualKey === key && el.querySelector?.('.party-scene')) return;
      visualKey = key;
    } else visualKey = '';

    const watch = isWatching(S);


    if (S.phase === 'reveal' && S.last) {
      const L = S.last;
      const doneV = Object.keys(L.votes).filter((pid) => L.votes[pid] === 'done');
      const chickV = Object.keys(L.votes).filter((pid) => L.votes[pid] === 'chicken');
      const total = L.done + L.chicken;
      const outcome = total === 0 ? 'No verdict was submitted' : `${nameOf(S, L.victim)} ${L.success ? 'completed the dare' : L.split ? 'split the room' : 'did not complete the dare'}`;
      const pts = total === 0 ? 'No verdict, no points.' : L.points ? `${nameOf(S, L.victim)} +${L.points} points${L.split ? ' (half credit)' : ''}.` : 'No points this round.';
      el.innerHTML = `<section class="party-scene gk-col gk-stack party-scene--spotlight" aria-label="Dare verdict">`
        + `${hud(S)}`
        + `<p class="gk-meta dr-kicker">${esc(L.dare)}</p>`
        + `<h2 class="gk-prompt party-prompt">${esc(outcome)}</h2>`
        + `<p class="gk-wait is-done" role="status">${esc(pts)}</p>`
        + `<div class="party-reveals">`
        + meter(S, 'Done', { voters: doneV, total }, L.success)
        + meter(S, 'Chicken', { voters: chickV, total }, total > 0 && L.chicken > L.done)
        + `</div>`
        + `<div class="gk-actions is-center dr-actions">${!watch && (S.me === S.hostId || S.me === L.victim)
          ? '<button type="button" class="gk-btn gk-primary" id="drNext">Next</button>' : ''}</div>`
        + `</section>`;
      const nx = el.querySelector('#drNext');
      if (nx) nx.onclick = () => sendAction({ next: true });
      return;
    }

    if (['perform', 'verdict'].includes(S.phase) && S.victim) {
      const isVictim = S.me === S.victim;
      const jurors = (S.players || []).filter((p) => p.id !== S.victim);
      const votedSet = new Set(S.voted || []);
      let action;
      const waiting = Math.max(0, jurors.length - votedSet.size);
      if (S.phase === 'perform') {
        action = !watch && isVictim
          ? `<p class="gk-wait" role="status">Perform your dare, then open the vote.</p><div class="gk-actions is-center"><button type="button" class="gk-btn gk-primary" id="drReady">Ready for votes</button></div>`
          : `<p class="gk-wait" role="status">${esc(nameOf(S, S.victim))} is performing. Voting opens after the performance.</p>`;
      } else if (watch) {
        action = `<p class="gk-wait" role="status">Watching · the room is judging ${esc(nameOf(S, S.victim))}'s dare.</p>`;
      } else if (isVictim) {
        action = `<p class="gk-wait" role="status">The other players are judging your dare · waiting for ${plural(waiting, 'player')}</p>`;
      } else if (S.myVote) {
        action = `<p class="gk-wait" role="status">Locked in: ${S.myVote === 'done' ? 'Done' : 'Chicken'} · waiting for ${plural(waiting, 'player')}</p>`;
      } else {
        action = `<p class="gk-wait" role="status">Did ${esc(nameOf(S, S.victim))} do it?</p>`
          + `<div class="gk-choices dr-choices" role="group" aria-label="Judge the dare" style="--gk-cols:2;--gk-cols-phone:2">`
          + `<button type="button" class="gk-choice" data-v="done" aria-pressed="false"><span class="gk-mark" aria-hidden="true">✓</span><span class="gk-choice-text">Done</span></button>`
          + `<button type="button" class="gk-choice" data-v="chicken" aria-pressed="false"><span class="gk-mark" aria-hidden="true">✕</span><span class="gk-choice-text">Chicken</span></button></div>`;
      }
      el.innerHTML = `<section class="party-scene gk-col gk-stack party-scene--spotlight dare-live" aria-label="Live dare">`
        + `${hud(S)}`
        + `<p class="gk-meta dr-kicker"><span class="gk-mark" aria-hidden="true">${esc(initial(nameOf(S, S.victim)))}</span>${esc(nameOf(S, S.victim))} takes the dare</p>`
        + `<h2 class="gk-prompt party-prompt">${esc(S.dare)}</h2>`
        + action
        + `<details class="party-more"><summary>Jurors</summary><p class="party-meta">`
        + jurors.map((p) => `${esc(p.name)}${votedSet.has(p.id) ? ' (voted)' : ''}`).join(', ')
        + `</p></details></section>`;
      const ready = el.querySelector('#drReady');
      if (ready) ready.onclick = () => sendAction({ ready: true });
      el.querySelectorAll('[data-v]').forEach((b) => {
        b.onclick = () => sendAction({ vote: b.dataset.v });
      });
      return;
    }

    const lineup = `<div class="party-lineup" aria-label="Players on the wheel">`
      + (S.players || []).map((p) => person(S, p.id, '')).join('') + `</div>`;
    el.innerHTML = `<section class="party-scene gk-col gk-stack party-scene--spotlight" aria-label="Spin the wheel">`
      + `${hud(S)}`
      + `<h2 class="gk-prompt party-prompt">Who takes the dare?</h2>`
      + `<p class="gk-wait" role="status">${watch ? 'Watching · someone is about to spin the wheel.' : 'Anyone can spin. Whoever it lands on takes the dare.'}</p>`
      + `<div class="party-spin-desk">${wheel(S)}${watch ? '' : `<button type="button" class="gk-btn gk-primary" id="drSpin">Spin the wheel</button>`}</div>`
      + lineup
      + (S.last ? lastRecap(S, S.last) : '')
      + `</section>`;
    const spin = el.querySelector('#drSpin');
    if (spin) spin.onclick = () => {
      if (spin.disabled || sendAction({ spin: true }) === false) return;
      spin.disabled = true;
      spin.textContent = 'Spinning…';
      el.querySelector('.party-wheel')?.classList.add('is-spinning');
    };
}

let liveTimerEl = null;

export default {
  styles: ['/css/party-scenes.css', '/css/dare-roulette.css'],
  dispose() {
    stopHudTimer(liveTimerEl); liveTimerEl = null; visualKey = ''; liveApi = null; liveEl = null; liveState = null; liveActionKey = ''; },
  ownsTimer: true,
  render(el, S, api) {
    paint(el, S, api);
    liveTimerEl = el;
    syncHudTimer(el, S, api);
  },
};

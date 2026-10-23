/* Pick One: rapid A/B rounds, match the majority. Built on the game kit
 * (public/css/game-ui.css): HUD row, prompt, two choice cards that keep
 * their place from voting to reveal, waiting line, Next, final scores. */
import { esc, nameOf, ensureStylesheet } from '../util.js';
import { paintFinal, syncHudTimer, stopHudTimer } from '../kit.js';

let mountKey = '', liveApi = null, liveEl = null, liveState = null, liveActionKey = '';

function ensureCss() {
  ensureStylesheet('party-scenes-css', '/css/party-scenes.css');
  ensureStylesheet('pick-one-css', '/css/pick-one.css');
}

function isWatch(S) {
  if (S && S.spectator) return true;
  const ids = (S.players || []).map((p) => p.id);
  return !!S.me && ids.length > 0 && !ids.includes(S.me);
}
function plural(n, one, many = one + 's') { return `${n} ${n === 1 ? one : many}`; }


function choiceCards(S, picked, watch, reveal) {
  const ballots = reveal ? S.last.votes || {} : {};
  const n = Object.keys(ballots).length;
  return `<div class="gk-choices pick-choices${picked && !reveal ? ' is-locked' : ''}${reveal ? ' is-reveal' : ''}" role="group" aria-label="Choices" style="--gk-cols:2;--gk-cols-phone:2">`
    + ['a', 'b'].map((side) => {
      const voters = Object.keys(ballots).filter((pid) => ballots[pid] === side);
      const pct = n ? Math.round(voters.length / n * 100) : 0;
      const win = reveal && n > 0 && S.last.winners.includes(side);
      const sel = picked === side;
      return `<button type="button" class="gk-choice pick-choice${sel ? ' is-selected is-picked' : ''}${win ? ' is-majority' : ''}" data-v="${side}" aria-pressed="${sel}"${picked || watch || reveal ? ' disabled' : ''}>`
        + `<span class="gk-mark" aria-hidden="true">${side.toUpperCase()}</span>`
        + `<span class="pick-body"><span class="pick-text">${esc(S.prompt?.[side] || '')}</span>`
        + `<span class="pick-result"><span class="pick-bar"><span class="pick-fill" style="width:${reveal ? pct : 0}%"></span></span>`
        + `<span class="gk-meta pick-count">${reveal ? `${plural(voters.length, 'vote')}${win ? ' · Majority' : ''}` : ''}</span>`
        + `<span class="gk-meta pick-voters">${reveal ? voters.map((pid) => esc(nameOf(S, pid))).join(', ') : ''}</span></span></span>`
        + `</button>`;
    }).join('')
    + `</div>`;
}

function paint(el, S, api) {
    ensureCss();
    if (S.phase === 'done') { mountKey = ''; paintFinal(el, { scene: 'pick-one', scores: S.scores || {}, players: S.players || [], you: isWatch(S) ? null : S.me, watching: isWatch(S) }); return; }
    liveApi = api;
    liveEl = el;
    liveState = S;
    const actionKey = JSON.stringify([S.instanceId, S.me, S.phase, S.round, S.endsAt, S.target, S.hostId, !!S.spectator, S.myVote]);
    liveActionKey = actionKey;
    const canAct = () => liveEl === el && liveActionKey === actionKey && liveState && !liveState.preparing && !liveState.spectator
      && (liveState.players || []).some(p => p.id === liveState.me);
    const sendAction = action => canAct() ? liveApi?.send(action) : false;
    const watch = isWatch(S);
    const done = S.phase === 'done';
    const reveal = S.phase === 'reveal' && !!S.last;
    const picked = S.myVote;
    const total = (S.players || []).length;
    const inCount = (S.voted || []).length;
    const state = done ? 'done' : reveal ? 'reveal' : watch ? 'watch' : picked ? 'locked' : 'open';

    const key = JSON.stringify([S.instanceId, S.me, S.round, S.phase, state, S.prompt, (S.players || []).map((p) => [p.id, p.name]),
      reveal ? S.last : null, done ? S.scores : null]);
    if (key !== mountKey || !el.querySelector('.pick-world')) {
      mountKey = key;
      el.innerHTML = `<section class="party-scene gk-col gk-stack pick-world" data-state="${state}" aria-label="Pick One">`
        + `<div class="gk-hud party-hud" data-phase="${esc(S.phase)}"><span class="gk-hud-round party-round">Round ${Math.min(S.round, S.rounds) || 1} of ${S.rounds}</span>`
        + `<span class="gk-hud-phase party-phase">${done ? 'Final scores' : reveal ? 'Results' : 'Vote'}</span>`
        + (watch ? `<span class="party-spectator">Watching</span>` : '')
        + `<span class="gk-hud-progress party-progress" id="pProgress"></span><span class="gk-hud-timer" aria-hidden="true"></span></div>`
        + `<h3 class="gk-prompt party-prompt">${done ? 'Final scores' : 'Pick one'}</h3>`
        + choiceCards(S, picked, watch, reveal)
        + (done ? '' : `<p class="gk-wait pick-status${reveal ? ' is-done' : ''}" id="pStatus" role="status"></p>`)
        + (done ? '' : `<div class="gk-actions is-center pick-actions"><button type="button" class="gk-btn gk-primary" id="pNext" hidden>Next</button></div>`)
        + (done ? '' : `<details class="party-more"><summary>Scoring</summary><p class="party-meta">Pick the side most of the room picks: 100 points, plus 25 for each such pick in a row (up to +100).</p></details>`)
        + `</section>`;
    }
    el.querySelector('.party-hud').setAttribute('data-phase', S.phase);
    const progress = el.querySelector('#pProgress');
    if (progress) progress.textContent = done ? '' : reveal ? plural(Object.keys(S.last.votes || {}).length, 'vote') : `${inCount} of ${total} locked in`;
    const status = el.querySelector('#pStatus');
    if (status) {
      const waiting = Math.max(0, total - inCount);
      const label = picked ? S.prompt?.[picked] : '';
      status.textContent = reveal ? (watch ? 'Here is how the room picked.' : picked ? `You picked ${label}.` : 'You sat this one out.')
        : watch ? `Watching · waiting for ${plural(waiting, 'player')}`
        : picked ? `Locked in · waiting for ${plural(waiting, 'player')}`
        : 'Quick: tap your side.';
    }
    for (const b of el.querySelectorAll('[data-v]')) {
      b.disabled = !!picked || watch || S.phase !== 'vote' || !!S.preparing;
      b.onclick = () => sendAction({ vote: b.dataset.v });
    }
    const next = el.querySelector('#pNext');
    if (next) {
      next.hidden = !reveal || watch || S.me !== S.hostId;
      next.disabled = next.hidden || !!S.preparing;
      next.onclick = () => sendAction({ next: true });
    }
}

let liveTimerEl = null;

export default {
  styles: ['/css/party-scenes.css', '/css/pick-one.css'],
  dispose() {
    stopHudTimer(liveTimerEl); liveTimerEl = null; mountKey = ''; liveApi = null; liveEl = null; liveState = null; liveActionKey = ''; },
  ownsTimer: true,
  render(el, S, api) {
    paint(el, S, api);
    liveTimerEl = el;
    syncHudTimer(el, S, api);
  },
};

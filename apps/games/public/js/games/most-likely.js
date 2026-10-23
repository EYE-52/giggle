/* Most Likely: a superlative, secret votes for another player, then the
 * room's tally. Built on the game kit (public/css/game-ui.css): HUD row,
 * prompt, nominee cards, waiting line, result rows, Next, final scores. */
import { esc, nameOf, ensureStylesheet } from '../util.js';
import { paintFinal, syncHudTimer, stopHudTimer } from '../kit.js';

let mountKey = '', liveApi = null, liveEl = null, liveState = null, liveActionKey = '';

const CSS = [
  ['party-scenes-css', '/css/party-scenes.css'],
  ['most-likely-css', '/css/most-likely.css'],
];

function ensureCss() {
  for (const [id, href] of CSS) ensureStylesheet(id, href);
}

function isWatch(S) {
  if (S && S.spectator) return true;
  const ids = (S.players || []).map((p) => p.id);
  return !!S.me && ids.length > 0 && !ids.includes(S.me);
}

/* Initials from the real display name, never a stock avatar. */
function initials(name) {
  const parts = String(name || '?').trim().split(/\s+/).filter(Boolean);
  const first = parts.length ? [...parts[0]][0] : '?';
  const second = parts.length > 1 ? [...parts[parts.length - 1]][0] : '';
  return (first + second).toUpperCase();
}
function plural(n, one, many = one + 's') { return `${n} ${n === 1 ? one : many}`; }


function hudHtml() {
  return `<div class="gk-hud party-hud"><span class="gk-hud-round party-round" id="mRound"></span><span class="gk-hud-phase party-phase" id="mPhase"></span>`
    + `<span class="party-spectator" id="mWatch" hidden>Watching</span><span class="gk-hud-progress party-progress" id="mProgress"></span><span class="gk-hud-timer" aria-hidden="true"></span></div>`;
}

function revealRows(S) {
  const ballots = Object.keys(S.last.votes || {}).length;
  return [...(S.players || [])]
    .map((p) => ({ p, n: S.last.tallies?.[p.id] || 0 }))
    .sort((a, b) => (b.n - a.n) || String(a.p.name).localeCompare(String(b.p.name)))
    .map(({ p, n }) => {
      const voters = Object.keys(S.last.votes).filter((v) => S.last.votes[v] === p.id);
      const win = n > 0 && S.last.winners.includes(p.id);
      const pct = ballots ? Math.round(n / ballots * 100) : 0;
      return `<div class="party-result likely-row${win ? ' party-result--winner is-winner' : ''}">`
        + `<span class="gk-mark likely-initials" aria-hidden="true">${esc(initials(p.name))}</span>`
        + `<div class="likely-row-body"><div class="likely-row-head"><span class="likely-name">${esc(p.name)}</span><b class="likely-votes">${plural(n, 'vote')}</b></div>`
        + `<div class="party-meter" role="img" aria-label="${n} votes"><span style="width:${pct}%"></span></div>`
        + `<p class="gk-meta likely-voters">${voters.length ? `Picked by ${voters.map((v) => esc(nameOf(S, v))).join(', ')}` : 'No picks'}</p></div></div>`;
    }).join('');
}

function paint(el, S, api) {
    ensureCss();
    if (S.phase === 'done') { mountKey = ''; paintFinal(el, { scene: 'most-likely', scores: S.scores || {}, players: S.players || [], you: isWatch(S) ? null : S.me, watching: isWatch(S) }); return; }
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
    const total = (S.players || []).length;
    const inCount = (S.voted || []).length;
    const picked = S.myVote;

    const key = JSON.stringify([S.instanceId, S.me, S.round, S.phase, watch, picked, (S.players || []).map((p) => [p.id, p.name]),
      reveal ? S.last : null, done ? S.scores : null]);
    if (key !== mountKey || !el.querySelector('.likely-world')) {
      mountKey = key;
      const others = (S.players || []).filter((p) => p.id !== S.me);
      let body = '';
      if (reveal) body = `<div class="party-reveals likely-results">${revealRows(S) || '<p class="gk-wait is-done">No votes cast.</p>'}</div>`;
      else if (typeof S.prompt === 'string' && S.prompt) {
        const list = watch ? (S.players || []) : others;
        body = `<div class="gk-choices likely-lineup${picked ? ' is-locked' : ''}" role="group" aria-label="Nominees" style="--gk-cols:2;--gk-cols-phone:1">`
          + list.map((p) => `<button type="button" class="gk-choice likely-nominee${picked === p.id ? ' is-selected is-picked' : ''}" data-v="${esc(p.id)}" aria-pressed="${picked === p.id}"${picked || watch ? ' disabled' : ''}>`
            + `<span class="gk-mark likely-initials" aria-hidden="true">${esc(initials(p.name))}</span><span class="gk-choice-text likely-name">${esc(p.name)}</span></button>`).join('')
          + `</div>`;
      }
      el.innerHTML = `<section class="party-scene gk-col gk-stack likely-world" aria-label="Most Likely">`
        + hudHtml()
        + `<h3 class="gk-prompt party-prompt" id="mPrompt"></h3>`
        + `<p class="gk-wait likely-status" id="mStatus" role="status"></p>`
        + body
        + `<div class="gk-actions is-center likely-actions"${reveal ? '' : ' hidden'}><button type="button" class="gk-btn gk-primary" id="mNext" hidden>Next</button></div>`
        + (done ? '' : `<details class="party-more"><summary>Scoring</summary><p class="party-meta">Vote for the player most of the room picks: 100 points, plus 25 for each such vote in a row (up to +100). The room's single pick gets 50.</p></details>`)
        + `</section>`;
    }
    el.querySelector('.likely-world').setAttribute('data-state', done ? 'done' : reveal ? 'reveal' : watch ? 'watch' : picked ? 'locked' : 'open');
    el.querySelector('.party-hud').setAttribute('data-phase', S.phase);
    el.querySelector('#mRound').textContent = `Round ${Math.min(S.round, S.rounds) || 1} of ${S.rounds}`;
    el.querySelector('#mPhase').textContent = done ? 'Final scores' : reveal ? 'Results' : 'Vote';
    el.querySelector('#mWatch').hidden = !watch;
    const ballots = reveal ? Object.keys(S.last.votes || {}).length : 0;
    el.querySelector('#mProgress').textContent = done ? '' : reveal ? plural(ballots, 'vote') : `${inCount} of ${total} locked in`;
    el.querySelector('#mPrompt').textContent = done ? 'Final scores'
      : reveal ? S.last.prompt : (typeof S.prompt === 'string' && S.prompt) ? S.prompt : 'Most likely to…';
    const status = el.querySelector('#mStatus');
    const waiting = Math.max(0, total - inCount);
    const myPts = reveal && S.last.pts ? S.last.pts[S.me] : 0;
    status.hidden = done;
    status.classList.toggle('is-done', reveal);
    status.textContent = !reveal && !(typeof S.prompt === 'string' && S.prompt) ? 'Cueing the nominees…'
      : reveal ? (watch ? 'Here is who the room picked.' : picked ? `You picked ${nameOf(S, picked)}${myPts ? ` · +${myPts} points` : ''}.` : 'You sat this one out.')
      : watch ? `Watching · waiting for ${plural(waiting, 'player')}`
      : picked ? `Locked in on ${nameOf(S, picked)} · waiting for ${plural(waiting, 'player')}`
      : 'Vote for someone else, never yourself.';
    for (const b of el.querySelectorAll('[data-v]')) {
      b.disabled = !!picked || watch || S.phase !== 'vote' || !!S.preparing;
      b.onclick = () => sendAction({ vote: b.dataset.v });
    }
    const next = el.querySelector('#mNext');
    if (next) {
      next.hidden = !reveal || watch || S.me !== S.hostId;
      next.disabled = next.hidden || !!S.preparing;
      next.onclick = () => sendAction({ next: true });
    }
}

let liveTimerEl = null;

export default {
  styles: ['/css/party-scenes.css', '/css/most-likely.css'],
  dispose() {
    stopHudTimer(liveTimerEl); liveTimerEl = null;
    mountKey = ''; liveApi = null; liveEl = null; liveState = null; liveActionKey = '';
    if (typeof document !== 'undefined') document.getElementById('most-likely-css')?.remove();
  },
  ownsTimer: true,
  render(el, S, api) {
    paint(el, S, api);
    liveTimerEl = el;
    syncHudTimer(el, S, api);
  },
};

/* Truth or Dare view: the spinner lands on a target, the target picks
 * a deck + truth/dare, and the room judges. The spin always lands on the
 * server-chosen target — never a fake pick. */
import { esc, nameOf, ensureStylesheet } from '../util.js';
import { paintFinal, syncHudTimer, stopHudTimer, waitCardHtml } from '../kit.js';

let visualKey = '', liveApi = null, liveEl = null, liveState = null, liveActionKey = '';

function plural(n, one, many = one + 's') { return `${n} ${n === 1 ? one : many}`; }

function hud(S) {
  const n = (S.players || []).length;
  const watch = S.spectator || !(S.players || []).some((p) => p.id === S.me);
  const round = Math.max(1, Math.min(S.round || 1, S.rounds || 1));
  const phase = { done: 'Final scores', reveal: 'Results', spin: 'Spin', choose: 'Choose', perform: 'Perform', vote: 'Vote' }[S.phase] || '';
  const progress = S.phase === 'vote' ? `${(S.voted || []).length} of ${Math.max(0, n - 1)} locked in` : '';
  return `<header class="gk-hud party-hud" data-phase="${esc(S.phase)}" aria-label="Round and play status">`
    + `<span class="gk-hud-round party-round">Round ${round} of ${S.rounds || 1}</span>`
    + `<span class="gk-hud-phase party-phase">${esc(phase)}</span>`
    + (watch ? '<span class="party-spectator">Watching</span>' : '')
    + `<span class="gk-hud-progress party-progress">${esc(progress)}</span>`
    + `<span class="gk-hud-timer" aria-hidden="true"></span>`
    + `</header>`;
}


let lastKey = '';
let spinTimer = 0;
let pendingDeck = 'classic';

function ensureCss() {
  ensureStylesheet('party-scenes-css', '/css/party-scenes.css');
  ensureStylesheet('truth-dare-css', '/css/truth-dare.css');
}

function isWatching(S) {
  if (S.spectator === true) return true;
  const ps = S.players || [];
  return S.me != null && ps.length > 0 && !ps.some((p) => p.id === S.me);
}

function labels(S) {
  const L = S.labels || {};
  return {
    decks: L.decks || { classic: 'Classic', funny: 'Funny', wild: 'Wild' },
    truth: L.truth || 'Truth',
    dare: L.dare || 'Dare',
    juicy: L.juicy || 'Juicy',
    dull: L.dull || 'Not juicy',
    done: L.done || 'Done',
    failed: L.failed || 'Failed',
  };
}

/* Mirror the server gate: the host or the round's target advances, or
 * anyone when the host's seat is empty, so a departed host never strands
 * the room. */
function canAdvance(S) {
  if (S.me === S.hostId || (S.last && S.me === S.last.target)) return true;
  return !(S.players || []).some((p) => p.id === S.hostId);
}

function keyOf(S) {
  return `${S.instanceId || ''}:${S.me}:${isWatching(S) ? 'watch' : 'player'}:${S.phase}:${S.round}:${S.target || ''}`;
}

function stopSpin() {
  if (spinTimer) {
    clearInterval(spinTimer);
    spinTimer = 0;
  }
}

function reducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function meter(S, label, voters, total, win) {
  const pct = total ? Math.round((voters.length / total) * 100) : 0;
  return `<div class="party-result${win ? ' party-result--winner' : ''}">`
    + `<span class="party-label">${esc(label)}</span>`
    + `<div class="party-meter" role="img" aria-label="${esc(label)}: ${voters.length} of ${total} votes"><span style="width:${pct}%"></span></div>`
    + `<span class="party-meta">${voters.length} vote${voters.length === 1 ? '' : 's'}`
    + (voters.length ? ` · ${voters.map((pid) => esc(nameOf(S, pid))).join(', ')}` : '') + '</span></div>';
}

function paint(el, S, api) {
    ensureCss();
    if (S.phase === 'done') { visualKey = ''; stopSpin(); lastKey = 'done'; paintFinal(el, { scene: 'truth-dare', scores: S.scores || {}, players: S.players || [], you: isWatching(S) ? null : S.me, watching: isWatching(S), note: lastRound(S) }); return; }
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

    const L = labels(S);
    const watch = isWatching(S);


    if (S.phase === 'reveal' && S.last) {
      stopSpin();
      lastKey = keyOf(S);
      const yesSide = S.last.kind === 'truth' ? L.juicy : L.done;
      const noSide = S.last.kind === 'truth' ? L.dull : L.failed;
      const yesV = Object.keys(S.last.votes).filter((pid) => S.last.votes[pid] === 'yes');
      const noV = Object.keys(S.last.votes).filter((pid) => S.last.votes[pid] === 'no');
      const total = Math.max(1, yesV.length + noV.length);
      el.innerHTML = `<section class="party-scene gk-col gk-stack party-scene--truth" aria-label="Round verdict">`
        + `${hud(S)}`
        + `<p class="gk-meta td-kicker">${esc(nameOf(S, S.last.target))} · ${esc(L.decks[S.last.deck] || S.last.deck)} ${esc(S.last.kind === 'truth' ? L.truth : L.dare)}</p>`
        + `<h2 class="gk-prompt party-prompt">${esc(S.last.prompt)}</h2>`
        + `<div class="party-reveals">`
        + meter(S, yesSide, yesV, total, S.last.yes > S.last.no)
        + meter(S, noSide, noV, total, S.last.no > S.last.yes)
        + `</div>`
        + `<p class="gk-wait is-done" role="status">${esc(S.last.verdict === 'none' || (!S.last.yes && !S.last.no) ? 'No verdict: nobody voted, so no points.'
          : S.last.verdict === 'split' ? `An even split: half credit, ${nameOf(S, S.last.target)} +${S.last.targetPts} points.`
          : `${nameOf(S, S.last.target)} +${S.last.targetPts} points.`)}</p>`
        + `<div class="gk-actions is-center td-actions">${!watch && canAdvance(S) ? '<button type="button" class="gk-btn gk-primary" id="tNext">Next</button>' : ''}</div>`
        + `</section>`;
      const nx = el.querySelector('#tNext');
      if (nx) nx.onclick = () => sendAction({ next: true });
      return;
    }

    if (S.phase === 'perform') {
      stopSpin();
      lastKey = keyOf(S);
      const actor = S.me === S.target && !watch;
      el.innerHTML = `<section class="party-scene gk-col gk-stack party-scene--truth" aria-label="Performance before judging">`
        + hud(S)
        + `<p class="gk-meta td-kicker">${esc(nameOf(S, S.target))} · ${esc(L.decks[S.deck] || S.deck)} ${esc(S.kind === 'truth' ? L.truth : L.dare)}</p>`
        + `<h2 class="gk-prompt party-prompt">${esc(S.prompt)}</h2>`
        + `<p class="gk-wait" role="status">${actor ? S.kind === 'truth' ? 'Answer aloud when you are ready.' : 'Perform the dare when you are ready.' : `${watch ? 'Watching · ' : ''}Give ${esc(nameOf(S, S.target))} time. Judging opens after they finish.`}</p>`
        + (actor ? '<div class="gk-actions is-center"><button type="button" class="gk-btn gk-primary" id="tReady">Ready for votes</button></div>' : '')
        + '</section>';
      const ready = el.querySelector('#tReady');
      if (ready) ready.onclick = () => sendAction({ ready: true });
      return;
    }

    if (S.phase === 'vote') {
      stopSpin();
      lastKey = keyOf(S);
      const isTarget = S.me === S.target;
      const yesLabel = S.kind === 'truth' ? L.juicy : L.done;
      const noLabel = S.kind === 'truth' ? L.dull : L.failed;
      const head = `${hud(S)}`
        + `<p class="gk-meta td-kicker">${esc(nameOf(S, S.target))} · ${esc(L.decks[S.deck] || S.deck)} ${esc(S.kind === 'truth' ? L.truth : L.dare)}</p>`
        + `<h2 class="gk-prompt party-prompt">${esc(S.prompt)}</h2>`;
      if (watch || isTarget) {
        el.innerHTML = `<section class="party-scene gk-col gk-stack party-scene--truth" aria-label="Room judging">` + head
          + (watch
            ? `<p class="gk-wait" role="status">You are watching — ${esc(nameOf(S, S.target))} is on the spot.</p>`
            : `<p class="gk-wait" role="status">You are up. The room is judging…</p>`)
          + `</section>`;
        return;
      }
      if (S.myVote) {
        el.innerHTML = `<section class="party-scene gk-col gk-stack party-scene--truth" aria-label="Vote locked in">` + head
          + `<p class="gk-wait" role="status">Locked in: ${esc(S.myVote === 'yes' ? yesLabel : noLabel)} · waiting for ${plural(Math.max(0, (S.players || []).length - 1 - (S.voted || []).length), 'player')}</p></section>`;
        return;
      }
      el.innerHTML = `<section class="party-scene gk-col gk-stack party-scene--truth" aria-label="Judge the player">` + head
        + `<div class="gk-choices td-choices" role="group" aria-label="Judge ${esc(nameOf(S, S.target))}" style="--gk-cols:2;--gk-cols-phone:2">`
        + `<button type="button" class="gk-choice" data-v="yes" aria-pressed="false"><span class="gk-mark" aria-hidden="true">✓</span><span class="gk-choice-text">${esc(yesLabel)}</span></button>`
        + `<button type="button" class="gk-choice" data-v="no" aria-pressed="false"><span class="gk-mark" aria-hidden="true">✕</span><span class="gk-choice-text">${esc(noLabel)}</span></button></div></section>`;
      el.querySelectorAll('[data-v]').forEach((b) => {
        b.onclick = () => sendAction({ vote: b.dataset.v });
      });
      return;
    }

    if (S.phase === 'choose') {
      stopSpin();
      // Keyed so the target's deck pick and focus survive snapshots.
      const k = keyOf(S);
      if (k === lastKey && (el.querySelector('[data-kind]') || el.querySelector('[data-waitpick]'))) return;
      pendingDeck = 'classic';
      lastKey = k;
      if (S.me !== S.target || watch) {
        el.innerHTML = `<section class="party-scene gk-col gk-stack party-scene--truth" aria-label="Player picking">`
          + `${hud(S)}`
          + waitCardHtml({ kicker: watch ? 'You are watching' : '', title: `${nameOf(S, S.target)} is picking`, text: 'A deck, then truth or dare. Then the room judges.', waiting: `Waiting for ${nameOf(S, S.target)}`, attrs: 'data-waitpick' })
          + `</section>`;
        return;
      }
      el.innerHTML = `<section class="party-scene gk-col gk-stack party-scene--truth" aria-label="Pick your deck">`
        + `${hud(S)}`
        + `<h2 class="gk-prompt party-prompt">Your pick, ${esc(nameOf(S, S.me))}!</h2>`
        + `<p class="gk-wait" role="status">Pick a deck, then truth or dare.</p>`
        + `<div class="gk-choices td-choices td-decks" role="group" aria-label="Deck" style="--gk-cols:3;--gk-cols-phone:3">`
        + ['classic', 'funny', 'wild'].map((d, i) =>
          `<button type="button" class="gk-choice${pendingDeck === d ? ' is-selected is-picked' : ''}" data-deck="${d}" aria-pressed="${pendingDeck === d}"><span class="gk-mark" aria-hidden="true">${i + 1}</span><span class="gk-choice-text">${esc(L.decks[d] || d)}</span></button>`).join('')
        + `</div>`
        + `<div class="gk-choices td-choices" role="group" aria-label="Truth or dare" style="--gk-cols:2;--gk-cols-phone:2">`
        + `<button type="button" class="gk-choice" data-kind="truth" aria-pressed="false"><span class="gk-mark" aria-hidden="true">T</span><span class="gk-choice-text">${esc(L.truth)}</span></button>`
        + `<button type="button" class="gk-choice" data-kind="dare" aria-pressed="false"><span class="gk-mark" aria-hidden="true">D</span><span class="gk-choice-text">${esc(L.dare)}</span></button></div></section>`;
      el.querySelectorAll('[data-deck]').forEach((b) => {
        b.onclick = () => {
          pendingDeck = b.dataset.deck;
          el.querySelectorAll('[data-deck]').forEach((x) => {
            const on = x === b;
            x.classList.toggle('is-picked', on);
            x.classList.toggle('is-selected', on);
            x.setAttribute('aria-pressed', on ? 'true' : 'false');
          });
        };
      });
      el.querySelectorAll('[data-kind]').forEach((b) => {
        b.onclick = () => sendAction({ deck: pendingDeck, kind: b.dataset.kind });
      });
      return;
    }

    // spin: animate names, land on the server-chosen target.
    // Keep DOM across snapshots so the animation never replays.
    const k = keyOf(S);
    if (k === lastKey && document.getElementById('tSpin')) return;
    stopSpin();
    lastKey = k;
    pendingDeck = 'classic';
    el.innerHTML = `<section class="party-scene gk-col gk-stack party-scene--truth" aria-label="Spinning for a target">`
      + `${hud(S)}`
      + `<div class="gk-card gk-wait-card td-spin" role="status">`
      + `<p class="gk-meta">${watch ? 'You are watching · ' : ''}Who is in the spotlight?</p>`
      + `<p class="gk-wait-title" id="tSpin">…</p>`
      + `<p class="gk-sub">They pick a deck and truth or dare next.</p></div>`
      + `</section>`;
    const node = document.getElementById('tSpin');
    const names = (S.players || []).map((p) => p.name);
    if (!names.length || !node) return;
    if (reducedMotion()) {
      node.textContent = nameOf(S, S.target);
      return;
    }
    let ticks = 0;
    spinTimer = setInterval(() => {
      ticks += 1;
      const n = document.getElementById('tSpin');
      if (!n) {
        stopSpin();
        return;
      }
      if (ticks > 26) {
        stopSpin();
        n.textContent = nameOf(S, S.target);
        return;
      }
      n.textContent = names[Math.floor(Math.random() * names.length)];
    }, 110);
}

/* One line under Final scores: the last round's prompt. */
function lastRound(S) {
  if (!S.last) return '';
  const L = labels(S);
  return `Last round · ${nameOf(S, S.last.target)} · ${L.decks[S.last.deck] || S.last.deck} ${S.last.kind === 'truth' ? L.truth : L.dare}: ${S.last.prompt}`;
}

let liveTimerEl = null;

export default {
  styles: ['/css/party-scenes.css', '/css/truth-dare.css'],
  dispose() {
    stopHudTimer(liveTimerEl); liveTimerEl = null; visualKey = ''; liveApi = null; liveEl = null; liveState = null; liveActionKey = '';
    stopSpin();
    lastKey = '';
    pendingDeck = 'classic';
  },
  ownsTimer: true,
  render(el, S, api) {
    paint(el, S, api);
    liveTimerEl = el;
    syncHudTimer(el, S, api);
  },
};

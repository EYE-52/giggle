/* Camera-party shared renderer: controls-only companion to the real parent
 * video. The call IS the stage — this module never draws fake video tiles,
 * never captures media, and never judges. It renders the prompt, the
 * server-owned countdown, Ready/show controls, one-at-a-time Yes/No ballots
 * with thumbs, outcomes, and bounded scores, built on the game kit
 * (public/css/game-ui.css): HUD row, prompt, one action area, results.
 *
 * Game wrapper contract (each camera game owns its tiny wrapper file):
 *   import { renderCameraParty, disposeCameraParty } from '../toolkit/camera-party.js';
 *   function ensureCss() { ... '/css/camera-party.css' ... } // standard pattern
 *   export default { render: renderCameraParty, dispose: disposeCameraParty,
 *     ownsTimer: true };
 * The renderer also ensures the stylesheet idempotently, so a wrapper that
 * follows the standard pattern and this module never double-load it.
 *
 * Patch-in-place: the skeleton is built once per server instanceId and only
 * patched afterwards, so focus, pager position, and scroll survive snapshots.
 */

import { esc, nameOf, countdown } from '../util.js';

export const CAMERA_PARTY_CSS_ID = 'camera-party-css';
export const CAMERA_PARTY_CSS_HREF = '/css/camera-party.css';
export const STANDALONE_CALL_HINT =
  'Show it on your call. Giggle Meet puts your friends on the game stage.';

const instances = new WeakMap();

function ensureCss() {
  if (typeof document === 'undefined') return;
  if (document.getElementById(CAMERA_PARTY_CSS_ID)) return;
  const l = document.createElement('link');
  l.id = CAMERA_PARTY_CSS_ID;
  l.rel = 'stylesheet';
  l.href = CAMERA_PARTY_CSS_HREF;
  document.head.appendChild(l);
}

function isEmbedded() {
  try {
    return !!(typeof document !== 'undefined' &&
      document.body && document.body.classList.contains('is-embed'));
  } catch {
    return false;
  }
}

function serverNow(api) {
  if (api && typeof api.now === 'function') {
    try {
      const v = api.now();
      if (Number.isFinite(v)) return v;
    } catch { /* wall clock below */ }
  }
  return Date.now();
}

function thumbSvg(up) {
  const fist = '<path d="M13 27V16.8l-4.8-1 1.7-6.1c.3-1.3 2-1.5 2.6-.4L15.2 14l1.1 4.2h7.3c1 0 1.8.9 1.6 1.9l-1.6 5c-.2 1-1.1 1.9-2.2 1.9H13z"/>' +
    '<rect x="9" y="17.5" width="4" height="9.5" rx="1.8"/>';
  const cuff = '';
  const art = `<g fill="currentColor" stroke="currentColor" stroke-width="1.4" ` +
    `stroke-linejoin="round" stroke-linecap="round">${fist}</g>${cuff}`;
  const body = up ? art : `<g transform="translate(0 32) scale(1 -1)">${art}</g>`;
  return `<svg viewBox="0 0 32 32" width="22" height="22" aria-hidden="true" focusable="false">` +
    body + `</svg>`;
}

function phaseLabel(phase) {
  return phase === 'perform' ? 'Showtime'
    : phase === 'vote' ? 'Judging'
    : phase === 'reveal' ? 'Results'
    : phase === 'done' ? 'Final scores' : '';
}

/* HUD timer: the slot keeps its width while hidden (CSS), so the row never
 * shifts between phases. */
function paintClock(d) {
  const S = d.state;
  if (!S) return;
  const clock = d.refs.clock;
  const ticking = !S.preparing && (S.phase === 'perform' || S.phase === 'vote' || S.phase === 'reveal');
  clock.hidden = !ticking;
  if (!ticking) { clock.textContent = ''; return; }
  const left = countdown(S.endsAt, () => serverNow(d.api));
  clock.textContent = left + 's';
  clock.classList.toggle('is-urgent', left <= 5 && left > 0);
  clock.setAttribute('aria-label', `${left} seconds left`);
}

function unvotedIndex(S, you) {
  const mine = (S.myVotes && typeof S.myVotes === 'object') ? S.myVotes : {};
  const cands = Array.isArray(S.candidates) ? S.candidates : [];
  for (let i = 0; i < cands.length; i++) {
    if (cands[i] !== you && mine[cands[i]] === undefined) return i;
  }
  return 0;
}

/* Layout (one centred column, game kit classes; specs/GAME_UI_STANDARD.md):
 *   HUD row (round, phase, progress, timer)
 *   prompt + one line under it
 *   one action area: Ready / ballot / round result / final scores
 *   match scores (reveal only)
 * Every part keeps its place between phases, so nothing jumps. */
function build(el, api) {
  el.innerHTML =
    `<section class="camera-party gk-col gk-stack" aria-label="Camera party controls">` +
    `<div class="cp-head gk-hud">` +
    `<span class="cp-round gk-hud-round" role="status" aria-live="polite"></span>` +
    `<span class="cp-phase gk-hud-phase"></span>` +
    `<span class="cp-progress gk-hud-progress"></span>` +
    `<span class="cp-clock gk-hud-timer" aria-live="off"></span></div>` +
    `<div class="cp-prompt-card"><p class="cp-prompt gk-prompt"></p><p class="cp-sub gk-sub"></p></div>` +
    `<p class="cp-call gk-meta"></p>` +
    `<div class="cp-ready-row"><button type="button" class="gk-btn gk-primary cp-ready"></button>` +
    `<p class="cp-ready-status gk-wait"></p></div>` +
    `<div class="cp-ballot gk-card">` +
    `<div class="cp-ballot-top"><button type="button" class="gk-btn cp-prev" data-watchok="1" aria-label="Previous performance">‹</button>` +
    `<div class="cp-ballot-mid"><div class="cp-ballot-name"></div>` +
    `<div class="cp-ballot-progress gk-meta"></div></div>` +
    `<button type="button" class="gk-btn cp-nextbtn" data-watchok="1" aria-label="Next performance">›</button></div>` +
    `<div class="cp-votebtns gk-choices" style="--gk-cols:2;--gk-cols-phone:2" role="group" aria-label="Your vote">` +
    `<button type="button" class="gk-choice cp-vote cp-yes" aria-pressed="false"><span class="gk-mark cp-thumb" aria-hidden="true">${thumbSvg(true)}</span><span class="gk-choice-text cp-vote-label">Yes</span></button>` +
    `<button type="button" class="gk-choice cp-vote cp-no" aria-pressed="false"><span class="gk-mark cp-thumb" aria-hidden="true">${thumbSvg(false)}</span><span class="gk-choice-text cp-vote-label">No</span></button>` +
    `</div><p class="cp-ballot-note gk-meta"></p></div>` +
    `<div class="cp-outcome"><p class="cp-reason gk-sub" role="status"></p>` +
    `<ul class="cp-outcomes"></ul>` +
    `<div class="cp-next-row gk-actions is-center"><button type="button" class="gk-btn gk-primary cp-next">Next</button>` +
    `<p class="cp-next-wait gk-wait"></p></div></div>` +
    `<section class="cp-final gk-results" aria-label="Final scores"><h2 class="cp-final-title gk-results-title"></h2>` +
    `<p class="cp-winner gk-winner"></p><ol class="cp-standings gk-ranks"></ol></section>` +
    `<div class="cp-scores"><h3 class="cp-scores-title gk-meta">Scores</h3>` +
    `<ol class="cp-score-list gk-ranks"></ol></div>` +
    `</section>`;
  const q = (sel) => el.querySelector(sel);
  const d = {
    el,
    api,
    state: null,
    refs: {
      head: q('.cp-head'), round: q('.cp-round'), phase: q('.cp-phase'), progress: q('.cp-progress'), clock: q('.cp-clock'),
      prompt: q('.cp-prompt'), sub: q('.cp-sub'), call: q('.cp-call'),
      readyRow: q('.cp-ready-row'), ready: q('.cp-ready'),
      readyStatus: q('.cp-ready-status'),
      ballot: q('.cp-ballot'), prev: q('.cp-prev'), nextBtn: q('.cp-nextbtn'),
      root: q('.camera-party'), promptCard: q('.cp-prompt-card'),
      ballotName: q('.cp-ballot-name'), ballotProgress: q('.cp-ballot-progress'),
      votes: q('.cp-votebtns'),
      yes: q('.cp-yes'), no: q('.cp-no'), ballotNote: q('.cp-ballot-note'),
      outcome: q('.cp-outcome'), reason: q('.cp-reason'),
      outcomes: q('.cp-outcomes'), nextRow: q('.cp-next-row'), next: q('.cp-next'), nextWait: q('.cp-next-wait'),
      final: q('.cp-final'), finalTitle: q('.cp-final-title'), winner: q('.cp-winner'),
      standings: q('.cp-standings'),
      scores: q('.cp-scores'), scoreList: q('.cp-score-list'),
    },
    key: '',
    ballotKey: '',
    ballotIdx: 0,
    outcomeKey: '',
    scoreKey: '',
    announced: '',
    listeners: [],
    timer: 0,
  };
  const on = (t, ev, fn) => {
    t.addEventListener(ev, fn);
    d.listeners.push([t, ev, fn]);
  };
  on(d.refs.ready, 'click', () => {
    if (canAct(d, 'perform') && !d.refs.ready.disabled &&
        (d.state.mode !== 'spotlight' || d.state.actor === d.state.you)) {
      d.api.send({ ready: true });
    }
  });
  on(d.refs.prev, 'click', () => stepBallot(d, -1));
  on(d.refs.nextBtn, 'click', () => stepBallot(d, 1));
  on(d.refs.yes, 'click', () => castVote(d, true));
  on(d.refs.no, 'click', () => castVote(d, false));
  on(d.refs.next, 'click', () => {
    if (canAct(d, 'reveal') && !d.refs.next.disabled && canAdvance(d.state)) d.api.send({ next: true });
  });
  d.timer = setInterval(() => paintClock(d), 250);
  instances.set(el, d);
  return d;
}

/* The host can always move on from a reveal; in spotlight mode the round's
 * performer can too (specs/GAME_RULES_STANDARD.md). */
function canAdvance(S) {
  if (!S || S.spectator) return false;
  const me = S.you ?? S.me;
  return me === S.hostId || (S.mode === 'spotlight' && !!S.actor && me === S.actor);
}

function canAct(d, phase) {
  const S = d.state;
  return S && S.phase === phase && !S.preparing && !S.spectator &&
    !(S.endsAt > 0 && serverNow(d.api) >= S.endsAt);
}

function stepBallot(d, dir) {
  const cands = (d.state && Array.isArray(d.state.candidates)) ? d.state.candidates : [];
  if (cands.length < 2) return;
  d.ballotIdx = (d.ballotIdx + dir + cands.length) % cands.length;
  patchBallot(d);
}

function castVote(d, approve) {
  const S = d.state;
  if (!canAct(d, 'vote')) return;
  const cands = Array.isArray(S.candidates) ? S.candidates : [];
  const cand = cands[d.ballotIdx];
  if (!cand || cand === S.you) {
    // Self frames cannot be judged; hop to the next judgable one.
    d.ballotIdx = unvotedIndex(S, S.you);
    patchBallot(d);
    return;
  }
  const mine = (S.myVotes && typeof S.myVotes === 'object') ? S.myVotes : {};
  if (mine[cand] !== undefined) return;
  if (Number.isFinite(S.endsAt) && S.endsAt > 0 && serverNow(d.api) >= S.endsAt) return;
  d.api.send({ vote: cand, approve });
}

function setPressed(btn, on) {
  btn.classList.toggle('picked', on);
  btn.setAttribute('aria-pressed', on ? 'true' : 'false');
}

function patchBallot(d) {
  const S = d.state;
  const R = d.refs;
  const cands = Array.isArray(S.candidates) ? S.candidates : [];
  const you = S.you;
  if (!cands.length) {
    R.ballotName.textContent = 'Nobody to judge yet';
    R.ballotProgress.textContent = '';
    R.yes.disabled = true;
    R.no.disabled = true;
    R.prev.disabled = true;
    R.nextBtn.disabled = true;
    setPressed(R.yes, false);
    setPressed(R.no, false);
    R.ballotNote.textContent = S.spectator
      ? 'You are watching.'
      : 'Nobody claimed a performance this round.';
    return;
  }
  if (d.ballotIdx < 0 || d.ballotIdx >= cands.length) d.ballotIdx = 0;
  const cand = cands[d.ballotIdx];
  const mine = (S.myVotes && typeof S.myVotes === 'object') ? S.myVotes : {};
  const judged = cands.filter((c) => c !== you && mine[c] !== undefined).length;
  const judgable = cands.filter((c) => c !== you).length;
  R.ballotName.textContent = nameOf(S, cand);
  R.ballotProgress.textContent = cands.length > 1
    ? `Performance ${d.ballotIdx + 1} of ${cands.length} · you judged ${judged} of ${judgable}`
    : (S.spectator ? 'Performance' : `You judged ${judged} of ${judgable}`);
  R.prev.hidden = cands.length < 2;
  R.nextBtn.hidden = cands.length < 2;
  R.prev.disabled = cands.length < 2;
  R.nextBtn.disabled = cands.length < 2;
  const isSelf = cand === you;
  const voted = mine[cand];
  R.yes.disabled = S.spectator || S.preparing || isSelf || voted !== undefined;
  R.no.disabled = S.spectator || S.preparing || isSelf || voted !== undefined;
  setPressed(R.yes, voted === true);
  setPressed(R.no, voted === false);
  R.votes.classList.toggle('is-locked', voted !== undefined);
  if (S.spectator) {
    R.ballotNote.textContent = 'You are watching. Players judge with Yes or No.';
  } else if (isSelf) {
    R.ballotNote.textContent = 'This is you. Friends judge it; you cannot vote for yourself.';
  } else if (voted === true) {
    R.ballotNote.textContent = 'You voted Yes.';
  } else if (voted === false) {
    R.ballotNote.textContent = 'You voted No.';
  } else {
    R.ballotNote.textContent = 'Did they nail it? Tap Yes or No.';
  }
}

function patchOutcomes(d) {
  const S = d.state;
  const R = d.refs;
  const last = S.last && typeof S.last === 'object' ? S.last : null;
  const key = JSON.stringify(last);
  if (key !== d.outcomeKey) {
    d.outcomeKey = key;
    R.reason.textContent = (last && last.reason) || '';
    R.outcomes.replaceChildren();
    const outcomes = (last && Array.isArray(last.outcomes)) ? last.outcomes : [];
    for (const o of outcomes) {
      if (!o || typeof o !== 'object') continue;
      const li = document.createElement('li');
      li.className = 'cp-outcome-row' + (o.approved ? ' won' : '');
      const badge = document.createElement('span');
      badge.className = 'cp-badge';
      badge.textContent = o.approved ? `+${o.points}` : 'No';
      const who = document.createElement('span');
      who.className = 'cp-outcome-who';
      who.textContent = nameOf(S, o.candidate);
      const detail = document.createElement('span');
      detail.className = 'cp-outcome-detail';
      detail.textContent = `${o.approvals} of ${o.eligible} yes` +
        (o.approved && o.bonus ? ` · +${o.bonus} ready bonus` : '');
      li.append(badge, who, detail);
      R.outcomes.appendChild(li);
    }
    const judges = (last && last.judges && typeof last.judges === 'object') ? last.judges : {};
    // One row per amount (gallery judges can earn 25 or 50 in a round).
    const amounts = [...new Set(Object.values(judges).filter((n) => n > 0))].sort((a, b) => b - a);
    for (const amount of amounts) {
      const li = document.createElement('li');
      li.className = 'cp-outcome-row cp-judges';
      const badge = document.createElement('span');
      badge.className = 'cp-badge';
      badge.textContent = `+${amount}`;
      const who = document.createElement('span');
      who.className = 'cp-outcome-who';
      who.textContent = Object.keys(judges).filter((pid) => judges[pid] === amount).map((pid) => nameOf(S, pid)).join(', ');
      const detail = document.createElement('span');
      detail.className = 'cp-outcome-detail';
      detail.textContent = 'judged with the room';
      li.append(badge, who, detail);
      R.outcomes.appendChild(li);
    }
  }
  const lead = canAdvance(S);
  R.next.hidden = !lead;
  R.next.disabled = !lead;
  R.nextWait.hidden = lead;
  R.nextWait.textContent = S.phase === 'reveal' && S.round >= S.rounds ? 'Final scores are next' : 'Next round starts soon';
}

/* Standard competition ranking, the same as the game kit (kit.js
 * rankRows): equal points share a rank (1, 1, 3); within a tie the order
 * is by name, never by seat. */
function scoreEntries(S) {
  const scores = (S.scores && typeof S.scores === 'object') ? S.scores : {};
  const roster = Array.isArray(S.players) ? S.players.map((p) => p.id) : Object.keys(scores);
  const entries = roster
    .filter((pid, i) => roster.indexOf(pid) === i)
    .map((pid) => ({ pid, name: nameOf(S, pid), pts: Math.max(0, Math.floor(Number(scores[pid]) || 0)) }))
    .sort((a, b) => (b.pts - a.pts) || String(a.name).localeCompare(String(b.name)));
  let rank = 0;
  return entries.map((entry, i) => {
    if (i === 0 || entry.pts !== entries[i - 1].pts) rank = i + 1;
    return { ...entry, rank, leader: entry.pts > 0 && entry.pts === entries[0].pts };
  });
}

function rankRow(S, e, final = false) {
  const li = document.createElement('li');
  const me = S.you ?? S.me;
  li.className = 'gk-rank-row' + (e.leader ? ' is-top leader' : '') + (e.pid === me ? ' is-you' : '');
  const rank = document.createElement('span');
  rank.className = 'gk-rank';
  rank.textContent = String(e.rank);
  const who = document.createElement('span');
  who.className = 'gk-name';
  // Same markup as the kit rows: "Ann (you)" with a small tag, "300 pts".
  const label = document.createElement('span');
  label.textContent = e.name;
  who.append(label);
  if (e.pid === me) {
    const tag = document.createElement('small');
    tag.textContent = ' (you)';
    who.append(tag);
  }
  const pts = document.createElement('span');
  pts.className = 'gk-pts';
  const num = document.createElement('span');
  num.textContent = String(e.pts);
  pts.append(num);
  if (final) {
    const unit = document.createElement('small');
    unit.className = 'gk-meta';
    unit.textContent = ' pts';
    pts.append(unit);
  }
  li.append(rank, who, pts);
  return li;
}

function patchScores(d) {
  const S = d.state;
  const R = d.refs;
  const entries = scoreEntries(S);
  const key = JSON.stringify([entries, S.you ?? S.me]);
  if (key === d.scoreKey) return;
  d.scoreKey = key;
  R.scoreList.replaceChildren();
  for (const e of entries.slice(0, 24)) R.scoreList.appendChild(rankRow(S, e));
}

function joinNames(names) {
  if (names.length <= 1) return names[0] || '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/* "Final scores", then "Ann wins" / "It's a tie: Ann and Bo" / "No one
 * scored", then the ranked list with the viewer highlighted. */
function patchFinal(d) {
  const S = d.state;
  const R = d.refs;
  const entries = scoreEntries(S);
  const top = entries.filter((e) => e.rank === 1);
  R.finalTitle.textContent = 'Final scores';
  R.winner.textContent = !entries.length ? ''
    : (top[0].pts <= 0 ? 'No one scored'
      : top.length > 1 ? `It's a tie: ${joinNames(top.map((e) => e.name))}` : `${top[0].name} wins`);
  R.winner.className = 'cp-winner gk-winner' + (top.length > 1 && top[0].pts > 0 ? ' is-tie' : '');
  R.standings.replaceChildren();
  for (const e of entries.slice(0, 24)) R.standings.appendChild(rankRow(S, e, true));
}

export function renderCameraParty(el, S, api) {
  ensureCss();
  let d = instances.get(el);
  if (!d) d = build(el, api);
  d.api = api;
  d.state = S;
  const R = d.refs;
  const instanceKey = String(S.instanceId || '');
  if (instanceKey !== d.key) {
    // New server instance (start/rematch): reset local UX state only.
    d.key = instanceKey;
    d.ballotKey = '';
    d.ballotIdx = 0;
    d.outcomeKey = '';
    d.scoreKey = '';
    d.announced = '';
  }

  const you = S.you;
  const roster = Array.isArray(S.players) ? S.players : [];
  const ready = (S.ready && typeof S.ready === 'object') ? S.ready : {};
  const readyCount = Object.keys(ready).filter((pid) => ready[pid]).length;
  const cands = Array.isArray(S.candidates) ? S.candidates : [];

  if (S.phase === 'done') {
    R.round.textContent = `${S.rounds} ${S.rounds === 1 ? 'round' : 'rounds'} played`;
  } else {
    R.round.textContent = `Round ${S.round} of ${S.rounds}`;
  }
  R.root.dataset.phase = S.phase || '';
  // The game over screen is the kit's Final scores block: no HUD row.
  R.head.hidden = S.phase === 'done';
  R.root.classList?.toggle('gk-final', S.phase === 'done');
  R.root.dataset.mode = S.mode || '';
  R.phase.hidden = S.phase === 'done';
  R.phase.textContent = phaseLabel(S.phase);
  let progress = '';
  if (S.phase === 'perform' && S.mode !== 'spotlight') progress = `${readyCount} of ${roster.length} ready`;
  else if (S.phase === 'vote') {
    const ballots = (S.ballots && typeof S.ballots === 'object') ? S.ballots : {};
    const cast = cands.reduce((n, c) => n + (Number(ballots[c]) || 0), 0);
    const owed = cands.reduce((n, c) => n + roster.filter((p) => p.id !== c && !p.left).length, 0);
    progress = `${cast} of ${owed} votes in`;
  }
  R.progress.textContent = progress;
  paintClock(d);

  R.prompt.textContent = typeof S.prompt === 'string' && S.prompt ? S.prompt : '';
  R.promptCard.hidden = S.phase === 'done';
  // One line under the prompt names who acts and what the viewer does now
  // (the HUD row above already carries round, phase, progress and clock).
  let sub = '';
  const spotlight = S.mode === 'spotlight';
  if (S.phase === 'perform') {
    sub = spotlight
      ? (S.actor === you && !S.spectator ? 'You are on. Perform it on camera, then tap Ready.' : `${nameOf(S, S.actor)} is performing. Watch the call.`)
      : S.spectator ? 'Everyone is hunting for it. Watch the call.' : 'Find it, hold it up to your camera, then tap Ready.';
  } else if (S.phase === 'vote') {
    const others = cands.filter((c) => c !== you).length;
    sub = S.spectator ? 'The room is judging. Watch the call.'
      : spotlight ? (S.actor === you ? 'Your performance is being judged.' : `Judge ${nameOf(S, S.actor)}: Yes or No.`)
      : others ? `Judge ${others} ${others === 1 ? 'find' : 'other finds'}: Yes or No.` : 'Your find is being judged.';
  } else if (S.phase === 'reveal') {
    sub = 'Round result';
  }
  R.sub.textContent = sub;

  R.call.hidden = isEmbedded() || S.phase === 'done';
  R.call.textContent = isEmbedded() ? '' : STANDALONE_CALL_HINT;

  R.readyRow.hidden = S.phase !== 'perform';
  if (S.phase === 'perform') {
    const mine = !!ready[you];
    const canReady = !S.spectator && (S.mode !== 'spotlight' || S.actor === you);
    R.ready.hidden = !canReady; // watchers see the status, never the button
    const label = S.mode === 'spotlight'
      ? (mine ? 'Ready' : 'Done, judge me')
      : (mine ? 'Shown' : 'I found it');
    if (R.ready.textContent !== label) R.ready.textContent = label;
    R.ready.disabled = mine || !!S.preparing;
    let status;
    if (S.mode === 'spotlight') {
      status = ready[S.actor]
        ? (S.actor === you ? 'Ready. Voting opens when time is up.' : `${nameOf(S, S.actor)} is ready. Voting opens when time is up.`)
        : (S.actor === you ? 'Voting opens when time is up.' : `Waiting for ${nameOf(S, S.actor)}`);
    } else {
      status = mine ? 'Shown. Voting opens when time is up.' : `${readyCount} of ${roster.length} found it`;
    }
    R.readyStatus.textContent = status;
    R.readyStatus.classList.toggle('is-done', mine || !!ready[S.actor]);
  }

  R.ballot.hidden = S.phase !== 'vote';
  if (S.phase === 'vote') {
    const bkey = `${S.round}:${cands.join(',')}`;
    if (bkey !== d.ballotKey) {
      d.ballotKey = bkey;
      d.ballotIdx = unvotedIndex(S, you);
    } else if (d.ballotIdx >= cands.length) {
      d.ballotIdx = 0;
    }
    patchBallot(d);
  }

  R.outcome.hidden = S.phase !== 'reveal';
  if (S.phase === 'reveal') patchOutcomes(d);

  R.final.hidden = S.phase !== 'done';
  if (S.phase === 'done') patchFinal(d);

  R.scores.hidden = S.phase !== 'reveal';
  patchScores(d);

  const akey = `${S.phase}:${S.round}:${S.instanceId}`;
  if (akey !== d.announced) {
    d.announced = akey;
    if (api && typeof api.announce === 'function') {
      try {
        if (S.phase === 'perform') api.announce(`Round ${S.round}: perform!`);
        else if (S.phase === 'vote') api.announce('Time to judge.');
        else if (S.phase === 'reveal') api.announce((S.last && S.last.reason) || 'Results are in.');
        else if (S.phase === 'done') api.announce('Final scores.');
      } catch { /* announce is best effort */ }
    }
  }
}

export function disposeCameraParty(el) {
  const d = instances.get(el);
  if (!d) return;
  if (d.timer) {
    try { clearInterval(d.timer); } catch { /* already gone */ }
    d.timer = 0;
  }
  for (const [t, ev, fn] of d.listeners) {
    try { t.removeEventListener(ev, fn); } catch { /* already gone */ }
  }
  d.listeners.length = 0;
  d.state = null; d.api = null;
  instances.delete(el);
}

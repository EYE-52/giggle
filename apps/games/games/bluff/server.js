'use strict';
/* Bluff: an obscure fact with a blank is shown; everyone submits a fake
 * answer, then all options (fakes + the real truth) are revealed
 * anonymously and each player picks the truth. Truth-finders score 100,
 * and fake authors score 50 per vote their bluff fooled (at most 100). */

const { dealer, shuffle, allIn, roundsSetting, paceSetting, pacedMs } = require('../_sdk');

const id = 'bluff';

const manifest = {
  howto: 'Write a fake answer, then pick the truth from the mix. Finding the truth is worth 100; each player your bluff fools is worth 50 (up to 100).',
  players: { min: 3, max: 20 },
  settings: [
    roundsSetting({ def: 6 }),
    paceSetting(),
    { key: 'writeSeconds', label: 'Seconds to write', type: 'int', min: 15, max: 180, def: 45 },
  ],
};
const PICK_S = 25;
const REVEAL_S = 8;
const TRUTH_POINTS = 100;
const FOOL_POINTS = 50;
const FOOL_MAX = 100;

function create(ctx) {
  const pack = ctx.content(id);
  const facts = pack.facts && pack.facts.length
    ? pack.facts
    : [{ prompt: 'The sky is ___', truth: 'blue' }];
  const s = ctx.settings ? ctx.settings() : {};
  const state = {
    round: 0,
    rounds: s.rounds ?? 6,
    writeMs: (s.writeSeconds ?? 45) * 1000,
    pickMs: pacedMs(s, PICK_S),
    revealMs: pacedMs(s, REVEAL_S),
    phase: 'bluff', // bluff -> pick -> reveal -> done
    fact: { prompt: '', truth: '' },
    fakes: {}, // pid -> text (secret until pick)
    options: [], // [{oid, pid|null, text}] shuffled at pick time; pid null = truth
    picks: {}, // voterPid -> oid
    last: null,
    scores: {},
    endsAt: 0,
    hostId: ctx.hostId(),
  };
  state.deal = dealer(facts);
  nextRound(state, ctx);
  return state;
}

function finish(state) {
  state.phase = 'done';
  state.endsAt = 0;
}

function nextRound(state, ctx) {
  if (state.round >= state.rounds) return finish(state);
  const f = state.deal() || {};
  state.round += 1;
  state.fact = {
    prompt: String(f.prompt || 'Something is ___').slice(0, 200),
    truth: String(f.truth || 'true').slice(0, 120),
  };
  state.fakes = {};
  state.options = [];
  state.picks = {};
  state.phase = 'bluff';
  state.endsAt = ctx.now() + state.writeMs;
  const br = state.round;
  ctx.later(state.writeMs, () => {
    if (state.phase !== 'bluff' || state.round !== br) return;
    startPick(state, ctx);
    ctx.broadcast();
  });
}

function startPick(state, ctx) {
  if (state.phase !== 'bluff') return;
  const list = [{ pid: null, text: state.fact.truth }];
  for (const pid of Object.keys(state.fakes)) list.push({ pid, text: state.fakes[pid] });
  state.options = shuffle(list).map((o, i) => ({ oid: 'o' + i, pid: o.pid, text: o.text }));
  state.phase = 'pick';
  state.picks = {};
  state.endsAt = ctx.now() + state.pickMs;
  const pr = state.round;
  ctx.later(state.pickMs, () => {
    if (state.phase !== 'pick' || state.round !== pr) return;
    reveal(state, ctx);
    ctx.broadcast();
  });
}

function score(state, ctx, pid, pts) {
  if (!pts) return;
  state.scores[pid] = (state.scores[pid] || 0) + pts;
  ctx.award(pid, pts);
}

function reveal(state, ctx) {
  if (state.phase !== 'pick') return;
  state.phase = 'reveal';
  const truthOpt = state.options.find((o) => o.pid === null);
  const truthOid = truthOpt ? truthOpt.oid : null;
  const counts = {};
  for (const oid of Object.values(state.picks)) counts[oid] = (counts[oid] || 0) + 1;
  const points = {};
  const add = (pid, n) => { if (n) points[pid] = (points[pid] || 0) + n; };
  for (const pid of Object.keys(state.picks)) {
    if (state.picks[pid] === truthOid) add(pid, TRUTH_POINTS);
  }
  for (const o of state.options) {
    if (o.pid && counts[o.oid]) add(o.pid, Math.min(FOOL_MAX, counts[o.oid] * FOOL_POINTS));
  }
  for (const pid of Object.keys(points)) score(state, ctx, pid, points[pid]);
  state.last = {
    prompt: state.fact.prompt,
    truth: state.fact.truth,
    truthOid,
    options: state.options.map((o) => ({ oid: o.oid, pid: o.pid, text: o.text, n: counts[o.oid] || 0 })),
    picks: { ...state.picks },
    points,
  };
  state.endsAt = 0; // the reveal shows no clock; Next or the paced timer moves on
  const rr = state.round;
  ctx.later(state.revealMs, () => {
    if (state.phase !== 'reveal' || state.round !== rr) return;
    nextRound(state, ctx);
    ctx.broadcast();
  });
}

/* Everyone still playing who has something to pick has picked. */
function maybeReveal(state, ctx) {
  if (state.phase !== 'pick') return;
  const pickers = ctx.players().filter((p) => state.options.some((o) => o.pid !== p.id));
  if (allIn(pickers, state.picks)) reveal(state, ctx);
}

function knownPid(ctx, pid) {
  return typeof pid === 'string' && ctx.allPlayers().some((p) => p.id === pid);
}

function onAction(state, ctx, pid, a) {
  if (!a || typeof a !== 'object') return;
  if (!knownPid(ctx, pid)) return;
  // Close expired input before a delayed timer can admit it.
  if (state.phase === 'bluff' && ctx.now() >= state.endsAt) {
    startPick(state, ctx);
    return;
  }
  if (state.phase === 'pick' && ctx.now() >= state.endsAt) {
    reveal(state, ctx);
    return;
  }
  if (state.phase === 'bluff' && typeof a.fake === 'string') {
    const t = a.fake.trim().slice(0, 120);
    // A fake that IS the truth is not a bluff — ignore it.
    if (t.length >= 1 && t.toLowerCase() !== state.fact.truth.trim().toLowerCase()) {
      state.fakes[pid] = t;
      if (allIn(ctx.players(), state.fakes)) startPick(state, ctx);
    }
    return;
  }
  if (state.phase === 'pick' && typeof a.pick === 'string' && state.picks[pid] === undefined) {
    const o = state.options.find((x) => x.oid === a.pick);
    if (o && o.pid !== pid) {
      state.picks[pid] = a.pick;
      maybeReveal(state, ctx);
    }
    return;
  }
  if (state.phase === 'reveal' && a.next && pid === ctx.hostId()) {
    nextRound(state, ctx);
  }
}

/* End game: points already given stay; show our own final screen. */
function onEnd(state) {
  finish(state);
}

/* A player left or stayed away: stop waiting for their bluff or pick. */
function onPlayerGone(state, ctx) {
  if (state.phase === 'bluff') {
    if (Object.keys(state.fakes).length && allIn(ctx.players(), state.fakes)) startPick(state, ctx);
  } else if (state.phase === 'pick') {
    maybeReveal(state, ctx);
  }
}

function view(state, pid, ctx) {
  const { deal, ...rest } = state;
  const out = { ...rest, hostId: ctx ? ctx.hostId() : state.hostId };
  if (state.phase === 'bluff') {
    out.fact = { prompt: state.fact.prompt, truth: '' };
    out.fakes = {};
    out.submitted = Object.keys(state.fakes);
    out.myFake = state.fakes[pid] || '';
    out.options = [];
    out.picks = {};
  } else if (state.phase === 'pick') {
    out.fact = { prompt: state.fact.prompt, truth: '' };
    out.fakes = {};
    out.options = state.options.map((o) => ({ oid: o.oid, text: o.text }));
    out.myOption = state.options.find((o) => o.pid === pid)?.oid || null;
    out.myPick = state.picks[pid] === undefined ? null : state.picks[pid];
    out.picks = {};
    out.picked = Object.keys(state.picks);
  } else {
    out.myPick = state.picks[pid] === undefined ? null : state.picks[pid];
  }
  return out;
}

module.exports = { id, minPlayers: 3, maxPlayers: 20, manifest, create, onAction, onEnd, onPlayerGone, view };

'use strict';
/* Camera-party rule engine: shared server-authoritative rules for games
 * where the video call IS the playfield. The engine never stores, captures,
 * or judges photos, video, or audio — no CV, no automatic judging. Players
 * perform on their real call; this module only runs the fixed
 * perform -> vote -> short reveal loop, secret ballots, and scoring.
 *
 * One exported factory, no per-game rule forks:
 *   const { createCameraParty } = require('../engines/camera-party');
 *   const game = createCameraParty({ id: '<game-id>', mode: 'spotlight' });
 *   module.exports = { id, minPlayers, maxPlayers, manifest,
 *     create: game.create, onAction: game.onAction, view: game.view,
 *     dispose: game.dispose };
 *
 * Modes:
 *   spotlight — each round rotates one actor from the start roster. The
 *     actor performs the public prompt and taps ready; everyone else
 *     judges the actor after the fixed perform window.
 *   gallery — everybody finds/shows a matching object and taps ready;
 *     peers judge each claimed candidate. No self voting.
 *
 * Settings (validated host values with defaults):
 *   rounds         default 4 (gallery) / one turn each (spotlight)  (1..12)
 *   pace           Relaxed / Normal / Quick: scales the reveal
 *   performSeconds default 30             (10..90)
 *   voteSeconds    default 15             (8..30)
 *
 * Points (specs/GAME_RULES_STANDARD.md), awarded at each reveal: an
 * approved performance is 100, plus a ready bonus of up to 50 for being
 * ready early; each judge whose ballot agrees with the room gets 25 (at
 * most 50 a round in gallery mode). Points stay at or under 200 a round.
 * Content: ctx.content(id).prompts, a game-owned locale list (>=20).
 * Deadlines are server-owned via ctx.later; every transition carries a
 * monotonic token plus phase/round guards, so a stale timer can never race
 * a manual change (host Next, all-in reveal, or expiry handling).
 */

const { paced, roundsSetting, paceSetting } = require('../_sdk');

const REVEAL_SECONDS = 6;
const REVEAL_MS = REVEAL_SECONDS * 1000;
const BASE_POINTS = 100;
const READY_BONUS_MAX = 50;
const AGREE_POINTS = 25;
const AGREE_MAX = 50;
const CAPTION_MAX = 120;

const BOUNDS = {
  rounds: { min: 1, max: 12, def: 4 },
  performSeconds: { min: 10, max: 90, def: 30 },
  voteSeconds: { min: 8, max: 30, def: 15 },
};

function isInt(n) {
  return typeof n === 'number' && Number.isFinite(n) && Number.isInteger(n);
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/* Pure settings normalization: missing/invalid keys fall back to defaults,
 * integers clamp to bounds. Deterministic and unit-testable. */
function normalizeSettings(raw, opts = {}) {
  const s = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
  const out = {};
  for (const key of Object.keys(BOUNDS)) {
    const b = BOUNDS[key];
    out[key] = isInt(s[key]) ? clamp(s[key], b.min, b.max) : b.def;
  }
  // Turn games default to one turn per player ("Auto").
  if (!isInt(s.rounds) && isInt(opts.autoRounds)) out.rounds = clamp(opts.autoRounds, BOUNDS.rounds.min, BOUNDS.rounds.max);
  return out;
}

/* The shared settings list for a camera game (Rounds and Pace first). */
function cameraSettings(mode) {
  return [
    mode === 'spotlight'
      ? roundsSetting({ def: null, autoLabel: 'Auto (one turn each)' })
      : roundsSetting({ def: BOUNDS.rounds.def }),
    paceSetting(),
    { key: 'performSeconds', label: 'Seconds to perform', type: 'int', min: BOUNDS.performSeconds.min, max: BOUNDS.performSeconds.max, def: BOUNDS.performSeconds.def },
    { key: 'voteSeconds', label: 'Seconds to vote', type: 'int', min: BOUNDS.voteSeconds.min, max: BOUNDS.voteSeconds.max, def: BOUNDS.voteSeconds.def },
  ];
}

/* Public prompt text from a locale entry (string or {text,...} object). */
function promptText(prompt) {
  if (typeof prompt === 'string') return prompt.trim();
  if (prompt && typeof prompt === 'object' && !Array.isArray(prompt)) {
    for (const k of ['text', 'prompt', 'caption', 'a']) {
      if (typeof prompt[k] === 'string' && prompt[k].trim()) return prompt[k].trim();
    }
  }
  return '';
}

/* Short PUBLIC caption for the camera frame. Never more than 120 chars. */
function captionFor(prompt) {
  return promptText(prompt).slice(0, CAPTION_MAX);
}

/* Strict majority of the eligible judges (start roster minus candidate). */
function majorityApproved(approvals, eligible) {
  return eligible > 0 && approvals * 2 > eligible;
}

/* Bounded early-ready bonus: fastest claim earns READY_BONUS_MAX, a claim
 * at the deadline earns 0. Pure in (readyAt, performStart, performMs). */
function readyBonus(readyAt, performStart, performMs) {
  if (!isInt(readyAt) && typeof readyAt !== 'number') return 0;
  if (!Number.isFinite(readyAt) || !Number.isFinite(performStart) ||
      !Number.isFinite(performMs) || performMs <= 0) return 0;
  const ratio = 1 - (readyAt - performStart) / performMs;
  return clamp(Math.round(READY_BONUS_MAX * ratio), 0, READY_BONUS_MAX);
}

function createCameraParty(config) {
  const cfg = config || {};
  if (typeof cfg.id !== 'string' || !cfg.id) {
    throw new TypeError('createCameraParty requires a game id for ctx.content lookup.');
  }
  if (cfg.mode !== 'spotlight' && cfg.mode !== 'gallery') {
    throw new TypeError('createCameraParty mode must be "spotlight" or "gallery".');
  }
  const id = cfg.id;
  const mode = cfg.mode;

  function promptList(ctx) {
    let prompts = [];
    try {
      const pack = ctx.content(id) || {};
      if (Array.isArray(pack.prompts)) prompts = pack.prompts;
    } catch { /* fall through to the fallback below */ }
    const clean = prompts.map(promptText).filter((t) => t.length > 0);
    const deck = clean.length ? clean : ['Show us something amazing on your call!'];
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
  }

  /* Schedule a guarded deadline: the callback runs only when the token,
   * phase, and round still match. The room's own generation/window guard
   * is an additional backstop, never the only one. */
  function arm(s, ctx, ms, fn) {
    if (s._cancel) {
      try { s._cancel(); } catch { /* a dead cancel never blocks the next arm */ }
      s._cancel = null;
    }
    s._token += 1;
    const token = s._token;
    const phase = s.phase;
    const round = s.round;
    s.endsAt = ctx.now() + ms;
    s._cancel = ctx.later(ms, () => {
      if (s._token !== token || s.phase !== phase || s.round !== round) return;
      fn();
      ctx.broadcast();
    });
  }

  function cancel(s) {
    s._token += 1; // invalidate even a queued callback after dispose
    if (s._cancel) {
      try { s._cancel(); } catch { /* dispose-time best effort */ }
      s._cancel = null;
    }
  }

  function finish(s) {
    cancel(s);
    s.phase = 'done';
    s.endsAt = 0; // terminal phases carry no deadline
    s.actor = null;
  }

  function startPerform(s, ctx) {
    s.phase = 'perform';
    s.prompt = s.prompts[(s.round - 1) % s.prompts.length];
    s.actor = null;
    if (mode === 'spotlight') {
      // A player who left keeps their place in the order; their turn is skipped.
      for (let i = 0; i < s.order.length && !s.actor; i++) {
        const idx = (s.nextSeat + i) % s.order.length;
        if (!s.gone.includes(s.order[idx])) { s.actor = s.order[idx]; s.nextSeat = idx + 1; }
      }
    }
    s.ready = {};
    s.readyAt = {};
    s.votes = {};
    s.performStart = ctx.now();
    // Spotlight judges a known star; gallery candidates accumulate below.
    s.candidates = mode === 'spotlight' ? [s.actor] : [];
    arm(s, ctx, s.performMs, () => toVote(s, ctx));
  }

  function nextRound(s, ctx) {
    cancel(s);
    s.round += 1;
    if (s.round > s.rounds || s.order.filter((pid) => !s.gone.includes(pid)).length < 2) {
      finish(s);
      return;
    }
    startPerform(s, ctx);
  }

  /* Perform -> vote. Candidates freeze here: late ready claims during the
   * vote change nothing. Empty or judgeless rounds skip straight to the
   * reveal with an explicit reason instead of idling a vote window. */
  function toVote(s, ctx) {
    if (s.phase !== 'perform') return;
    cancel(s);
    if (mode === 'gallery') {
      s.candidates = s.order.filter((pid) => s.ready[pid]);
    } else {
      s.candidates = s.ready[s.actor] ? [s.actor] : [];
    }
    s.votes = {};
    if (!s.candidates.length || judgesFor(s, s.candidates[0]).length < 1) {
      enterReveal(s, ctx);
      return;
    }
    s.phase = 'vote';
    arm(s, ctx, s.voteMs, () => enterReveal(s, ctx));
  }

  /* Judges of a candidate: the start roster minus the candidate and
   * players who left (they are not waited for and do not count). */
  function judgesFor(s, candidate) {
    return s.order.filter((pid) => pid !== candidate && !s.gone.includes(pid));
  }

  /* Vote -> reveal. A majority approval earns 100 plus a ready bonus;
   * judges who agree with the room earn 25 each. Every outcome carries
   * counts and an explicit reason. */
  function enterReveal(s, ctx, why) {
    if (s.phase !== 'vote' && s.phase !== 'perform') return;
    cancel(s);
    s.phase = 'reveal';
    if (typeof ctx.hostId === 'function') s.hostId = ctx.hostId();
    const roundPoints = {};
    const add = (pid, n) => { if (n > 0) roundPoints[pid] = (roundPoints[pid] || 0) + n; };
    const agreeing = {};
    const outcomes = s.candidates.map((candidate) => {
      let approvals = 0;
      let rejects = 0;
      for (const voter of Object.keys(s.votes)) {
        const ballot = s.votes[voter] && s.votes[voter][candidate];
        if (ballot === true) approvals += 1;
        else if (ballot === false) rejects += 1;
      }
      const eligible = judgesFor(s, candidate).length;
      const approved = majorityApproved(approvals, eligible);
      const bonus = approved ? readyBonus(s.readyAt[candidate], s.performStart, s.performMs) : 0;
      const points = approved ? BASE_POINTS + bonus : 0;
      add(candidate, points);
      for (const voter of Object.keys(s.votes)) {
        const ballot = s.votes[voter] && s.votes[voter][candidate];
        if (ballot === approved && (ballot === true || ballot === false)) agreeing[voter] = (agreeing[voter] || 0) + 1;
      }
      return { candidate, approvals, rejects, eligible, approved, points, bonus };
    });
    const judgePoints = {};
    for (const voter of Object.keys(agreeing)) {
      judgePoints[voter] = Math.min(AGREE_MAX, agreeing[voter] * AGREE_POINTS);
      add(voter, judgePoints[voter]);
    }
    for (const pid of Object.keys(roundPoints)) {
      s.scores[pid] = (s.scores[pid] || 0) + roundPoints[pid];
      ctx.award(pid, roundPoints[pid]);
    }
    const winners = outcomes.filter((o) => o.approved);
    let reason;
    if (why) {
      reason = why;
    } else if (!outcomes.length) {
      reason = 'Nobody was ready, so there was nothing to judge.';
    } else if (!winners.length) {
      reason = 'No majority this round, so no performance points.';
    } else if (outcomes.length === 1) {
      const o = winners[0];
      reason = `Approved by ${o.approvals} of ${o.eligible}: +${o.points} points.`;
    } else {
      reason = `${winners.length} of ${outcomes.length} performances earned a majority.`;
    }
    s.last = { round: s.round, outcomes, reason, points: roundPoints, judges: judgePoints };
    arm(s, ctx, s.revealMs, () => nextRound(s, ctx));
  }

  /* Every connected non-candidate roster member has judged every candidate
   * they may judge. Disconnected seats never block or trigger this early
   * path — the fixed vote deadline still reveals when they stay away. */
  function allJudged(s, ctx) {
    if (!s.candidates.length) return false;
    let connected = [];
    try {
      connected = ctx.players().map((p) => p.id);
    } catch { connected = s.order.slice(); }
    const present = new Set(connected.filter((pid) => s.order.includes(pid) && !s.gone.includes(pid)));
    for (const voter of present) {
      for (const candidate of s.candidates) {
        if (voter === candidate) continue; // no self voting
        const ballot = s.votes[voter] && s.votes[voter][candidate];
        if (ballot === undefined) return false;
      }
    }
    return true;
  }

  function connectedIds(s, ctx) {
    try {
      const ids = new Set(ctx.players().map((p) => p.id));
      return new Set(s.order.filter((pid) => ids.has(pid)));
    } catch {
      return new Set(s.order);
    }
  }

  /* A late action after the deadline advances the phase first (the timer
   * callback may not have run yet), then the action itself is dropped. */
  function expired(s, ctx) {
    return Number.isFinite(s.endsAt) && s.endsAt > 0 && ctx.now() >= s.endsAt;
  }

  return {
    create(ctx) {
      const order = ctx.allPlayers().map((p) => p.id);
      const raw = ctx.settings ? ctx.settings() : {};
      const settings = normalizeSettings(raw, mode === 'spotlight' ? { autoRounds: order.length } : {});
      const prompts = promptList(ctx);
      const s = {
        mode,
        rounds: settings.rounds,
        round: 0,
        phase: 'perform',
        performMs: settings.performSeconds * 1000,
        voteMs: settings.voteSeconds * 1000,
        performSeconds: settings.performSeconds,
        voteSeconds: settings.voteSeconds,
        revealMs: paced(raw, REVEAL_SECONDS) * 1000,
        revealSeconds: paced(raw, REVEAL_SECONDS),
        nextSeat: 0,
        gone: [],
        order,
        actor: null,
        prompts,
        prompt: '',
        ready: {},
        readyAt: {},
        performStart: 0,
        candidates: [],
        votes: {},
        scores: Object.fromEntries(order.map((pid) => [pid, 0])),
        last: null,
        endsAt: 0,
        // The current room host advances reveals; the deadline is always a fallback.
        hostId: typeof ctx.hostId === 'function' ? ctx.hostId() : order[0] || null,
        _token: 0,
        _cancel: null,
      };
      if (!order.length) {
        s.round = 0;
        s.last = { round: 0, outcomes: [], reason: 'Nobody is here yet.' };
        finish(s);
        return s;
      }
      nextRound(s, ctx);
      return s;
    },

    onAction(s, ctx, pid, a) {
      if (!a || typeof a !== 'object' || Array.isArray(a)) return false;
      if (!s.order.includes(pid)) return false; // watchers never act
      if (!connectedIds(s, ctx).has(pid)) return false; // disconnected seats wait
      if (s.gone.includes(pid)) s.gone = s.gone.filter((g) => g !== pid); // back from away
      if (s.phase === 'done') return false;

      if ((s.phase === 'perform' || s.phase === 'vote') && expired(s, ctx)) {
        if (s.phase === 'perform') toVote(s, ctx);
        else enterReveal(s, ctx);
        return; // The authority changed; Room must publish the new window.
      }

      if (s.phase === 'perform') {
        if (a.ready !== true || (mode === 'spotlight' && pid !== s.actor)) return false;
        if (s.ready[pid]) return false; // duplicates keep the first timestamp
        s.ready[pid] = true;
        s.readyAt[pid] = ctx.now();
        if (mode === 'gallery' && !s.candidates.includes(pid)) s.candidates.push(pid);
        return; // fixed window: ready never shortens the perform phase
      }

      if (s.phase === 'vote') {
        if (typeof a.vote !== 'string' || typeof a.approve !== 'boolean') return false;
        if (!s.candidates.includes(a.vote)) return false;
        if (a.vote === pid) return false; // no self voting, no self points
        if (s.votes[pid] && s.votes[pid][a.vote] !== undefined) return false;
        if (!s.votes[pid]) s.votes[pid] = {};
        s.votes[pid][a.vote] = a.approve;
        if (allJudged(s, ctx)) enterReveal(s, ctx);
        return;
      }

      if (s.phase === 'reveal') {
        // The host, or this round's performer in spotlight mode, may move on.
        const host = typeof ctx.hostId === 'function' ? ctx.hostId() : s.hostId;
        const lead = mode === 'spotlight' ? s.actor : null;
        if (a.next !== true || (pid !== host && pid !== lead)) return false;
        nextRound(s, ctx);
        return;
      }

      return false;
    },

    /* End game: points are already awarded at each reveal; a round in
     * progress gives nothing. The final scores show. */
    onEnd(s) {
      finish(s);
    },

    /* A player who left (or stays away): the spotlight turn is skipped,
     * and judges are no longer waited for. */
    onPlayerGone(s, ctx, pid) {
      if (!s.order.includes(pid)) return;
      if (!s.gone.includes(pid)) s.gone.push(pid);
      if (s.phase === 'done') return;
      if (s.phase === 'perform' || s.phase === 'vote') {
        if (mode === 'spotlight' && pid === s.actor) {
          const name = (ctx.allPlayers().find((p) => p.id === pid) || {}).name || 'The performer';
          s.candidates = [];
          s.votes = {};
          enterReveal(s, ctx, `${name} left, so this turn is skipped.`);
          return;
        }
        if (mode === 'gallery') {
          s.candidates = s.candidates.filter((c) => c !== pid);
          if (s.phase === 'perform' && s.ready[pid]) delete s.ready[pid];
          for (const voter of Object.keys(s.votes)) if (s.votes[voter]) delete s.votes[voter][pid];
          delete s.votes[pid];
          if (s.phase === 'vote' && !s.candidates.length) { enterReveal(s, ctx); return; }
        }
        if (s.phase === 'vote' && allJudged(s, ctx)) enterReveal(s, ctx);
      }
    },

    view(s, pid) {
      const roster = s.order.includes(pid);
      const ballotsVisible = s.phase === 'reveal' || s.phase === 'done';
      const votes = {};
      if (ballotsVisible) {
        for (const voter of Object.keys(s.votes)) votes[voter] = { ...s.votes[voter] };
      }
      const ballots = {};
      for (const candidate of s.candidates) {
        let n = 0;
        for (const voter of Object.keys(s.votes)) {
          if (s.votes[voter] && s.votes[voter][candidate] !== undefined) n += 1;
        }
        ballots[candidate] = n;
      }
      return {
        mode: s.mode,
        phase: s.phase,
        round: s.round,
        rounds: s.rounds,
        prompt: s.prompt,
        actor: s.actor,
        ready: Object.fromEntries(s.order.map((id) => [id, !!s.ready[id]])),
        candidates: s.candidates.slice(),
        ballots,
        myVotes: (roster && s.votes[pid]) ? { ...s.votes[pid] } : {},
        votes,
        scores: { ...s.scores },
        last: s.last ? {
          round: s.last.round,
          reason: s.last.reason,
          outcomes: s.last.outcomes.map((o) => ({ ...o })),
          points: { ...(s.last.points || {}) },
          judges: { ...(s.last.judges || {}) },
        } : null,
        endsAt: s.endsAt,
        hostId: s.hostId,
        performSeconds: s.performSeconds,
        voteSeconds: s.voteSeconds,
        revealSeconds: s.revealSeconds,
        gone: s.gone.slice(),
        // Seat ids only; the framework shell maps seats to verified users.
        camera: s.phase === 'done' ? null : {
          mode: s.mode,
          featured: s.mode === 'spotlight' ? s.actor : null,
          caption: captionFor(s.prompt),
        },
      };
    },

    dispose(s) {
      if (s) cancel(s);
    },
  };
}

module.exports = {
  createCameraParty,
  normalizeSettings,
  cameraSettings,
  captionFor,
  promptText,
  majorityApproved,
  readyBonus,
  BOUNDS,
  REVEAL_MS,
  BASE_POINTS,
  READY_BONUS_MAX,
  AGREE_POINTS,
  AGREE_MAX,
  REVEAL_SECONDS,
  CAPTION_MAX,
};

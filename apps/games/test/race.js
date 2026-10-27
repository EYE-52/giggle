'use strict';
/* Race-condition tests: framework-level stale/instance/window guards.
 *
 * Part 1 (unit): REAL Room + REAL game defs with stubbed setTimeout, so
 * timers fire manually and deterministically. No sleeps, no mocks of game
 * code. Part 2 (WS): the real server over real WebSockets.
 *
 * Failing BEFORE the fix (proven glitches):
 *  T2 trivia host-Next + stale reveal timer skips a round.
 *  T3 doodle-guess stale timer after final Next double-awards totals.
 *  T4 five games' timer-reveal never broadcasts (reveal screen skipped).
 *  T5 stale cross-round votes/answers are accepted in the new round.
 *  T6 in-flight actions from a dead instance contaminate the rematch.
 *  T7 word-chain duplicate delivery on a later own turn knocks you out.
 *  T1 sweep: per-game round/index gaps from the same stale-timer class.
 * Regression proofs (pass before AND after; must stay green):
 *  T8 timer disposal on restart, T9 simultaneous votes, T10 spectator +
 *  reconnect resume, W4 missing-token back-compat.
 * Shared-boundary bulkheads (fail before the fix, pass after):
 *  T13 throwing create, T14 throwing timer, T15 throwing onTick,
 *  T16 one bad view/send starves nobody + create-time broadcast.
 *
 * Run: node test/race.js */

const assert = require('assert');
const path = require('path');
const { spawn } = require('child_process');
const WebSocket = require('ws');

const ROOT = path.join(__dirname, '..');
const { Rooms } = require('../server/room');
const registry = require('../games/registry');
const sdk = require('../games/_sdk');

/* The framework window token builder. Missing pre-fix: tests then drive
 * with dummy meta (ignored by the old onAction) so the GLITCH assertions
 * fail instead of the harness crashing. */
const actionWindow = typeof sdk.actionWindow === 'function' ? sdk.actionWindow : null;

const realSetTimeout = setTimeout;
const realClearTimeout = clearTimeout;
const realSetImmediate = setImmediate;
const drain = () => new Promise((res) => realSetImmediate(res));
const sleep = (ms) => new Promise((res) => realSetTimeout(res, ms));

function stubTimers(beforeFire) {
  const pending = [];
  let seq = 1;
  global.setTimeout = (fn, ms, ...rest) => {
    const t = { id: seq++, ms, fn: () => fn(...rest), cleared: false, fired: false };
    pending.push(t);
    return t.id;
  };
  global.clearTimeout = (id) => {
    const t = pending.find((x) => x.id === id);
    if (t) t.cleared = true;
  };
  return {
    pending,
    fireNext() {
      const t = pending.find((x) => !x.cleared && !x.fired);
      if (!t) return null;
      t.fired = true;
      if (beforeFire) beforeFire(t.ms);
      t.fn();
      return t;
    },
    fireAll(cap = 100) {
      let n = 0;
      while (n < cap && this.fireNext()) n += 1;
      return n;
    },
    restore() {
      global.setTimeout = realSetTimeout;
      global.clearTimeout = realClearTimeout;
    },
  };
}

const fakeSock = () => ({
  readyState: 1, bufferedAmount: 0, sent: [],
  send(s) { this.sent.push(JSON.parse(s)); },
  close() { this.readyState = 3; },
});
const statesOf = (sock) => sock.sent.filter((m) => m.t === 'state');

function freshMeta(room) {
  if (!room.game) return undefined;
  if (!actionWindow) return { i: 'pre-fix', w: 'pre-fix' }; // ignored pre-fix
  return { i: room.game.instanceId, w: actionWindow(room.game.state) };
}

const ok = (name) => console.log('RACE ok:', name);

/* ------------------------------------------------------------------ */
/* T1: 33-game sweep — timer chains to quiescence with a quick host   */
/* hitting Next at every reveal. No round/index may be skipped, and   */
/* leftover timers after done must be fully inert.                    */
/* ------------------------------------------------------------------ */
async function sweepGame(id) {
  const def = registry.get(id);
  assert(def, `registry has no def for ${id}`);
  const rooms = new Rooms({});
  const room = rooms.create();
  const stub = stubTimers();
  const rec = { id, done: false, stalled: null, reveals: [], ends: [] };
  try {
    const socks = [fakeSock(), fakeSock(), fakeSock(), fakeSock()];
    const ps = socks.map((s, i) => room.addPlayer('P' + i, s).player);
    const r = room.startGame(def, {}, ps[0].id);
    assert(r.ok, `${id}: startGame failed: ${r.error}`);
    await drain(); // flush later() window capture
    const sockOf = (pid) => {
      const p = room.players.find((x) => x.id === pid);
      return p && p.socket;
    };
    const reveals = new Set();
    const ends = new Set();
    let idxCount = null; // hot-takes order length
    for (let step = 0; step < 400; step++) {
      const st = room.game && room.game.state;
      assert(st, `${id}: game vanished mid-sweep`);
      if (st.phase === 'done') { rec.done = true; break; }
      if (typeof st.round === 'number' && st.phase === 'reveal') reveals.add(st.round);
      if (typeof st.round === 'number' && st.phase === 'roundEnd') ends.add(st.round);
      if (id === 'hot-takes' && st.phase === 'reveal' && typeof st.index === 'number') {
        reveals.add(st.index);
        if (Array.isArray(st.order)) idxCount = st.order.length;
      }
      // Quick host: advance out of reveal immediately, so the reveal
      // timer goes stale and must die quietly when it fires later.
      if (st.phase === 'reveal') {
        const before = st.phase + '|' + st.round + '|' + (st.revealIdx ?? '') +
          '|' + (st.index ?? '');
        let moved = false;
        for (const pid of room.activeRosterIds()) {
          room.onAction(sockOf(pid), { next: true }, freshMeta(room));
          await drain();
          const cur = room.game.state;
          const after = cur.phase + '|' + cur.round + '|' + (cur.revealIdx ?? '') +
            '|' + (cur.index ?? '');
          if (after !== before) { moved = true; break; }
        }
        if (moved) continue; // re-record; the stale timer fires on a later step
        // No Next path (or already consumed): fall through and fire timers.
      }
      const fired = stub.fireNext();
      if (!fired) {
        // Stall-buster: one Next try per seat (draw-phone pager, etc.).
        const cur = room.game.state;
        const before = cur.phase + '|' + cur.round + '|' + (cur.revealIdx ?? '');
        let moved = false;
        for (const pid of room.activeRosterIds()) {
          room.onAction(sockOf(pid), { next: true }, freshMeta(room));
          await drain();
          const now = room.game.state;
          if (now.phase + '|' + now.round + '|' + (now.revealIdx ?? '') !== before) {
            moved = true;
            break;
          }
        }
        if (!moved) {
          rec.stalled = `${cur.phase}${typeof cur.round === 'number' ? ' r' + cur.round : ''}`;
          break;
        }
        continue;
      }
      await drain();
    }
    rec.reveals = [...reveals].sort((a, b) => a - b);
    rec.ends = [...ends].sort((a, b) => a - b);
    const st = room.game.state;
    // No-gap assertions for games that reveal every round. Excluded:
    // draw-phone/word-chain/chess (no round reveals), compliment-battle /
    // roast-toast (timer-only driving takes the documented empty-write
    // shortcut and never reveals; T12 proves their skip with entries),
    // castle-clash (build/siege phase model, no reveal; engine-owned).
    const noCoverage = new Set(['draw-phone', 'word-chain', 'chess',
      'compliment-battle', 'roast-toast', 'castle-clash']);
    if (rec.done && typeof st.rounds === 'number' && def.id !== 'hot-takes' &&
        !noCoverage.has(id)) {
      const want = [];
      for (let i = 1; i <= st.rounds; i++) want.push(i);
      const seen = rec.reveals.length ? rec.reveals : rec.ends;
      assert.deepStrictEqual(
        seen, want,
        `${id}: skipped windows — saw reveals/ends ${JSON.stringify(seen)}, want ${JSON.stringify(want)}`);
    }
    if (id === 'hot-takes' && rec.done) {
      assert(idxCount, 'hot-takes never built a vote order');
      const want = [];
      for (let i = 0; i < idxCount; i++) want.push(i);
      assert.deepStrictEqual(rec.reveals, want, `hot-takes skipped takes: ${JSON.stringify(rec.reveals)}`);
    }
    // Leftover timers after done must be fully inert.
    if (rec.done) {
      const snap = {
        totals: { ...room.totals },
        round: st.round ?? null,
        phase: st.phase,
        index: st.index ?? null,
      };
      stub.fireAll();
      await drain();
      assert.deepStrictEqual(room.totals, snap.totals, `${id}: stale timer after done moved totals`);
      assert.strictEqual(st.round ?? null, snap.round, `${id}: stale timer after done moved round`);
      assert.strictEqual(st.phase, snap.phase, `${id}: stale timer after done moved phase`);
      assert.strictEqual(st.index ?? null, snap.index, `${id}: stale timer after done moved index`);
    }
  } finally {
    stub.restore();
    room.destroy();
  }
  return rec;
}

/* Set up a real Room with n fake players and a started game. Caller owns
 * the timer stub lifecycle. */
async function setupRoom(gameId, n = 4) {
  const rooms = new Rooms({});
  const room = rooms.create();
  const socks = [];
  const ps = [];
  for (let i = 0; i < n; i++) {
    const s = fakeSock();
    socks.push(s);
    ps.push(room.addPlayer('P' + i, s).player);
  }
  const r = room.startGame(registry.get(gameId), {}, ps[0].id);
  assert(r.ok, `${gameId}: startGame failed: ${r.error}`);
  await drain();
  return { room, socks, ps };
}

/* T2: trivia quick-host-Next + stale reveal timer must not skip round 2. */
async function t2TriviaSkip() {
  const stub = stubTimers();
  try {
    const { room, ps } = await setupRoom('trivia', 2);
    try {
      room.onAction(ps[0].socket, { pick: 0 }, freshMeta(room));
      room.onAction(ps[1].socket, { pick: 1 }, freshMeta(room));
      await drain();
      assert.strictEqual(room.game.state.phase, 'reveal', 'all-in must reveal');
      assert.strictEqual(room.game.state.round, 1);
      room.onAction(ps[0].socket, { next: true }, freshMeta(room)); // host Next
      await drain();
      assert.strictEqual(room.game.state.round, 2, 'host Next advances to round 2');
      assert.strictEqual(room.game.state.phase, 'answer');
      stub.fireNext(); // stale round-1 ANSWER timer: must not early-reveal round 2
      stub.fireNext(); // stale round-1 REVEAL timer: must not skip round 2
      await drain();
      assert.strictEqual(room.game.state.round, 2, 'stale reveal timer must not skip round 2');
      assert.strictEqual(room.game.state.phase, 'answer', 'stale timer must not leave round 2');
    } finally {
      room.destroy();
    }
  } finally {
    stub.restore();
  }
  ok('T2 trivia quick-Next + stale timer skips nothing');
}

/* T3: doodle-guess final Next + stale timer must award exactly once. */
async function t3DoodleAward() {
  const stub = stubTimers();
  try {
    const { room } = await setupRoom('doodle-guess', 3);
    try {
      for (let i = 0; i < 40 && room.game.state.phase !== 'done'; i++) {
        const st = room.game.state;
        const sockOf = (pid) => room.players.find((x) => x.id === pid).socket;
        if (st.phase === 'pick') {
          room.onAction(sockOf(st.drawer), { choose: st.choices[0] }, freshMeta(room));
        } else if (st.phase === 'draw') {
          stub.fireNext(); // draw timer ends the turn
        } else if (st.phase === 'reveal') {
          room.onAction(sockOf(st.drawer), { next: true }, freshMeta(room));
        }
        await drain();
      }
      assert.strictEqual(room.game.state.phase, 'done', 'doodle must reach done');
      const totals = { ...room.totals };
      stub.fireAll(); // every leftover timer, incl. the final stale one
      await drain();
      assert.deepStrictEqual(room.totals, totals, 'stale timer after done must not re-award');
      assert.strictEqual(room.game.state.phase, 'done');
    } finally {
      room.destroy();
    }
  } finally {
    stub.restore();
  }
  ok('T3 doodle-guess awards exactly once');
}

/* T4: timer-driven reveals must broadcast so clients SEE the reveal. */
async function t4SilentReveals() {
  const errs = [];
  for (const id of ['trivia', 'countdown-word', 'lyric-fill', 'scattergories', 'would-you-rather']) {
    const stub = stubTimers();
    try {
      const { room, socks } = await setupRoom(id, 3);
      try {
        for (const s of socks) s.sent = [];
        stub.fireNext(); // window-1 main timer -> reveal
        await drain();
        assert.strictEqual(room.game.state.phase, 'reveal', `${id}: main timer must reveal`);
        const got = statesOf(socks[0]);
        assert(got.length >= 1, `${id}: reveal transition must broadcast (clients see nothing)`);
        assert.strictEqual(got[got.length - 1].phase, 'reveal',
          `${id}: last broadcast must be the reveal, saw ${got[got.length - 1].phase}`);
      } finally {
        room.destroy();
      }
    } catch (e) {
      errs.push(`${id}: ${e.message}`);
    } finally {
      stub.restore();
    }
  }
  assert.strictEqual(errs.length, 0, 'silent reveals:\n  ' + errs.join('\n  '));
  ok('T4 timer reveals broadcast (5 games)');
}

/* T5: a stale cross-round action must not score in the new round. */
async function t5StaleWindow() {
  const stub = stubTimers();
  try {
    const { room, ps } = await setupRoom('trivia', 2);
    try {
      const staleW = actionWindow
        ? actionWindow(room.game.state)
        : { stale: true };
      room.onAction(ps[0].socket, { pick: 0 }, freshMeta(room));
      room.onAction(ps[1].socket, { pick: 1 }, freshMeta(room));
      await drain();
      room.onAction(ps[0].socket, { next: true }, freshMeta(room));
      await drain();
      assert.strictEqual(room.game.state.round, 2);
      const meta = actionWindow
        ? { i: room.game.instanceId, w: staleW }
        : { i: 'x', w: 'x' };
      room.onAction(ps[0].socket, { pick: 2 }, meta); // round-1 click, round-2 window
      await drain();
      assert(!room.game.state.answers[ps[0].id],
        'stale round-1 pick must not answer round 2');
      room.onAction(ps[0].socket, { pick: 2 }, freshMeta(room));
      await drain();
      assert.strictEqual(room.game.state.answers[ps[0].id].pick, 2,
        'fresh round-2 pick must be recorded');
    } finally {
      room.destroy();
    }
  } finally {
    stub.restore();
  }
  ok('T5 stale cross-round action dropped, fresh accepted');
}

/* T6: in-flight actions from a dead instance must not hit the rematch. */
async function t6StaleInstance() {
  const stub = stubTimers();
  try {
    const { room, ps } = await setupRoom('trivia', 2);
    try {
      const i1 = room.game.instanceId;
      const r = room.startGame(registry.get('trivia'), {}, ps[0].id); // rematch
      assert(r.ok, 'rematch restart failed');
      await drain();
      const i2 = room.game.instanceId;
      assert.notStrictEqual(i2, i1, 'rematch must mint a fresh instanceId');
      room.onAction(ps[0].socket, { pick: 0 }, { i: i1, w: actionWindow ? actionWindow(room.game.state) : 'x' });
      await drain();
      assert(!room.game.state.answers[ps[0].id],
        'dead-instance action must not answer the rematch');
      room.onAction(ps[0].socket, { pick: 0 }, freshMeta(room));
      await drain();
      assert(room.game.state.answers[ps[0].id], 'current-instance action must work');
    } finally {
      room.destroy();
    }
  } finally {
    stub.restore();
  }
  ok('T6 dead-instance action dropped, rematch clean');
}

/* T7: word-chain duplicate delivery on a later own turn must not kill. */
async function t7StaleTurn() {
  const stub = stubTimers();
  try {
    const { room } = await setupRoom('word-chain', 3);
    try {
      const sockOf = (pid) => room.players.find((x) => x.id === pid).socket;
      const seed = room.game.state.current;
      const words = ['alpha', 'bravo', 'gamma', 'delta'].filter((w) => w !== seed);
      const w1 = actionWindow ? actionWindow(room.game.state) : { stale: true };
      const t1 = room.game.state.turnPid;
      room.onAction(sockOf(t1), { word: words[0] }, freshMeta(room)); // t1 plays
      await drain();
      const t2 = room.game.state.turnPid;
      assert.notStrictEqual(t2, t1, 'turn must advance');
      room.onAction(sockOf(t2), { word: words[1] }, freshMeta(room)); // t2 plays
      await drain();
      const t3 = room.game.state.turnPid;
      room.onAction(sockOf(t3), { word: words[2] }, freshMeta(room)); // t3 plays
      await drain();
      assert.strictEqual(room.game.state.turnPid, t1, 'turn must come back to t1');
      const usedBefore = room.game.state.used.length;
      // Delayed duplicate of t1's FIRST word arrives on t1's new turn.
      room.onAction(sockOf(t1), { word: words[0] },
        actionWindow ? { i: room.game.instanceId, w: w1 } : { i: 'x', w: 'x' });
      await drain();
      assert(room.game.state.alive.includes(t1),
        'stale duplicate word must not knock the player out via repeat rule');
      assert.strictEqual(room.game.state.used.length, usedBefore,
        'stale duplicate word must not be replayed');
      assert.strictEqual(room.game.state.turnPid, t1, 'stale duplicate must not pass the turn');
    } finally {
      room.destroy();
    }
  } finally {
    stub.restore();
  }
  ok('T7 stale turn word dropped (no phantom elimination)');
}

/* T8 (regression): restart disposes old timers; the generation guard   */
/* makes even a leaked gen-1 callback inert against the new game.       */
async function t8TimerDisposal() {
  const stub = stubTimers();
  try {
    const { room } = await setupRoom('trivia', 2);
    try {
      const gen1 = stub.pending.slice(); // timer(s) of the first instance
      assert(gen1.length >= 1, 'expected a pending window-1 timer');
      const r = room.startGame(registry.get('trivia'), {}, room.players[0].id);
      assert(r.ok);
      await drain();
      for (const t of gen1) t.fn(); // simulate leaked gen-1 callbacks firing
      await drain();
      assert.strictEqual(room.game.state.round, 1, 'old timers must not touch the new game');
      assert.strictEqual(room.game.state.phase, 'answer');
      assert.deepStrictEqual(room.game.state.answers, {});
      stub.fireAll(); // the new game's own timers still work
      await drain();
      assert.strictEqual(room.game.state.phase, 'reveal', 'current timers must fire');
    } finally {
      room.destroy();
    }
  } finally {
    stub.restore();
  }
  ok('T8 restart disposes old timers');
}

/* T9 (regression): simultaneous same-window votes all count, exactly once. */
async function t9SimultaneousVotes() {
  const stub = stubTimers();
  try {
    const { room, ps } = await setupRoom('most-likely', 3);
    try {
      const meta = freshMeta(room); // one window for all three voters
      room.onAction(ps[0].socket, { vote: ps[1].id }, meta);
      room.onAction(ps[1].socket, { vote: ps[0].id }, meta);
      room.onAction(ps[2].socket, { vote: ps[0].id }, meta);
      await drain();
      assert.strictEqual(Object.keys(room.game.state.votes).length, 3,
        'all three simultaneous votes must be recorded');
      assert.strictEqual(room.game.state.phase, 'reveal', 'all-in must reveal once');
      assert(room.game.state.last, 'reveal must compute results');
      const totals = { ...room.totals };
      // Replays of the same votes change nothing.
      room.onAction(ps[0].socket, { vote: ps[1].id }, meta);
      room.onAction(ps[1].socket, { vote: ps[0].id }, meta);
      room.onAction(ps[2].socket, { vote: ps[0].id }, meta);
      await drain();
      assert.deepStrictEqual(room.totals, totals, 'vote replays must not double-score');
    } finally {
      room.destroy();
    }
  } finally {
    stub.restore();
  }
  ok('T9 simultaneous votes resolve exactly once');
}

/* T10 (regression): spectators stay muted; roster resumes across drops. */
async function t10SpectatorReconnect() {
  const stub = stubTimers();
  try {
    const { room, ps, socks } = await setupRoom('trivia', 3);
    try {
      const late = room.addPlayer('Late', fakeSock()).player;
      assert(room.isSpectator(late.id), 'mid-game joiner spectates');
      const n0 = socks[0].sent.length;
      room.onAction(late.socket, { pick: 0 }, freshMeta(room));
      await drain();
      assert.strictEqual(socks[0].sent.length, n0, 'spectator action must not broadcast');
      assert(!room.game.state.answers[late.id], 'spectator action must not record');
      // Roster seat drops mid-vote; the connected majority still reveals.
      const p3 = ps[2];
      room.disconnect(p3.socket);
      room.onAction(ps[0].socket, { pick: 0 }, freshMeta(room));
      room.onAction(ps[1].socket, { pick: 1 }, freshMeta(room));
      await drain();
      assert.strictEqual(room.game.state.phase, 'reveal', 'connected majority reveals');
      // ...and the seat resumes as a participant with totals intact.
      const back = fakeSock();
      const resumed = room.addPlayer('P2', back, p3.token);
      assert(resumed.resumed && resumed.player.id === p3.id, 'token must reclaim the seat');
      assert(!room.isSpectator(p3.id), 'resumed roster seat stays a participant');
    } finally {
      room.destroy();
    }
  } finally {
    stub.restore();
  }
  ok('T10 spectator muted; reconnect resumes seat');
}

/* T11: a stale reveal timer must not cut short a NEW round's reveal, even
 * when the new round races ahead of it (phase-only-guard games). */
async function t11CutShortReveal() {
  const stub = stubTimers();
  try {
    const { room, ps } = await setupRoom('funny-answer', 3);
    try {
      // Round 1 needs entries: without them the answer timer takes the
      // documented empty-write shortcut (reveal-skipped), not vote.
      for (const p of ps) room.onAction(p.socket, { answer: 'r1' + p.id }, freshMeta(room));
      await drain();
      assert.strictEqual(room.game.state.phase, 'vote', 'all-in answers must open voting');
      stub.fireNext(); // stale round-1 answer timer: dropped, voting continues
      await drain();
      assert.strictEqual(room.game.state.phase, 'vote', 'stale answer timer must not disturb voting');
      stub.fireNext(); // vote timer -> reveal round 1
      await drain();
      assert.strictEqual(room.game.state.phase, 'reveal');
      assert.strictEqual(room.game.state.round, 1);
      const staleRev1 = stub.pending.find((x) => !x.cleared && !x.fired);
      assert(staleRev1, 'expected a pending round-1 reveal timer');
      room.onAction(ps[0].socket, { next: true }, freshMeta(room)); // host Next
      await drain();
      assert.strictEqual(room.game.state.round, 2);
      // Round 2 races: all answer + all vote via actions (no timers).
      const st2 = room.game.state;
      assert.strictEqual(st2.phase, 'answer');
      for (const p of ps) room.onAction(p.socket, { answer: 'x' + p.id }, freshMeta(room));
      await drain();
      assert.strictEqual(room.game.state.phase, 'vote', 'all-in answers must open voting');
      const opts = room.game.state.options.map((o) => o.aid);
      for (const p of ps) {
        const mine = room.game.state.options.find((o) => o.pid === p.id);
        const pick = opts.find((a) => !mine || a !== mine.aid) || opts[0];
        room.onAction(p.socket, { vote: pick }, freshMeta(room));
      }
      await drain();
      assert.strictEqual(room.game.state.phase, 'reveal', 'all-in votes must reveal round 2');
      assert.strictEqual(room.game.state.round, 2);
      // Now the stale round-1 reveal timer fires during round 2's reveal.
      // Fire ONLY it: round 2's own timers are fresh and legitimately pending.
      staleRev1.fn();
      await drain();
      assert.strictEqual(room.game.state.round, 2, 'stale timer must not cut round-2 reveal short');
      assert.strictEqual(room.game.state.phase, 'reveal');
    } finally {
      room.destroy();
    }
  } finally {
    stub.restore();
  }
  ok('T11 stale timer cannot cut a new reveal short');
}

/* Shared-boundary bulkheads (T13-T16): one throwing game callback must
 * never crash the process or wedge/starve the room. Stub defs (not engines)
 * prove the containment lives in Room, not in any single game. */
function stubDef(over) {
  return Object.assign({
    id: 'stub', minPlayers: 1, maxPlayers: 24,
    manifest: { players: { min: 1, max: 24 } },
    create: () => ({ phase: 'play' }),
    onAction: () => {},
    view: (state) => ({ phase: state.phase }),
  }, over);
}

async function setupStub(over, n = 2) {
  const rooms = new Rooms({});
  const room = rooms.create();
  const socks = [];
  const ps = [];
  for (let i = 0; i < n; i++) {
    const s = fakeSock();
    socks.push(s);
    ps.push(room.addPlayer('P' + i, s).player);
  }
  const r = room.startGame(stubDef(over), {}, ps[0].id);
  assert(r.ok, `stub startGame failed: ${r.error}`);
  await drain();
  return { room, socks, ps };
}

/* Quiet console.error while a test deliberately throws inside game code. */
async function muted(fn) {
  const orig = console.error;
  console.error = () => {};
  try {
    return await fn();
  } finally {
    console.error = orig;
  }
}

/* T13: a throwing create() returns an error and leaves a usable lobby —
 * never a wedged room with game.state null. */
async function t13ThrowingCreate() {
  const rooms = new Rooms({});
  const room = rooms.create();
  try {
    const s1 = fakeSock(); const s2 = fakeSock();
    const p1 = room.addPlayer('A', s1).player;
    room.addPlayer('B', s2).player;
    const r = await muted(() => room.startGame(
      stubDef({ create: (ctx) => {
        ctx.later(60000, () => { throw new Error('orphaned timer'); });
        throw new Error('boom-create');
      } }), {}, p1.id));
    assert(r.error, 'throwing create must return an error, not throw or wedge');
    assert.strictEqual(room.game, null, 'room must be back in the lobby');
    assert.strictEqual(room.lobby.game, null, 'lobby snapshot must show no game');
    assert.strictEqual(room.timers.size, 0, 'a failed create cannot leave timers behind');
    room.disconnect(s1); // must not throw against a half-built game
    await drain();
    const r2 = room.startGame(stubDef({}), {}, p1.id === room.hostId ? p1.id : room.hostId);
    assert(r2.ok, `room must accept a later start: ${r2.error}`);
    await drain();
    assert.strictEqual(room.game.state.phase, 'play');
    assert(statesOf(s2).length >= 1, 'surviving seat must receive state');
  } finally {
    room.destroy();
  }
  ok('T13 throwing create returns an error; room stays usable');
}

/* T14: a throwing timer callback is contained; sibling timers still fire. */
async function t14ThrowingTimer() {
  const stub = stubTimers();
  try {
    const { room, ps } = await setupStub({});
    try {
      const ctx = room.ctx();
      let secondRan = false;
      await muted(async () => {
        ctx.later(10, () => { throw new Error('boom-timer'); });
        ctx.later(10, () => { secondRan = true; });
        await drain(); // window capture before firing
        stub.fireNext(); // must not throw out of the timer
        stub.fireNext();
        await drain();
      });
      assert(secondRan, 'a sibling timer must still run after a throwing one');
      assert.strictEqual(room.game.state.phase, 'play', 'room must be intact');
      room.onAction(ps[0].socket, { ping: 1 }, freshMeta(room));
      await drain();
    } finally {
      room.destroy();
    }
  } finally {
    stub.restore();
  }
  ok('T14 throwing timer callback contained');
}

/* T15: a throwing onTick is contained (the 10 Hz loop has no guard). */
async function t15ThrowingTick() {
  const { room } = await setupStub({ onTick: () => { throw new Error('boom-tick'); } });
  try {
    await muted(async () => { room.onTick(); }); // must not throw
    await drain();
    assert.strictEqual(room.game.state.phase, 'play', 'room must be intact');
  } finally {
    room.destroy();
  }
  ok('T15 throwing onTick contained');
}

/* T16: one bad view/send starves nobody: the rest still get snapshots. */
async function t16BroadcastBulkhead() {
  const rooms = new Rooms({});
  const room = rooms.create();
  try {
    const bad = fakeSock(); const good = fakeSock(); const dead = fakeSock();
    const pBad = room.addPlayer('Bad', bad).player;
    room.addPlayer('Good', good).player;
    const pDead = room.addPlayer('Dead', dead).player;
    dead.send = () => { throw new Error('boom-send'); };
    const r = await muted(() => room.startGame(stubDef({
      view: (state, pid) => {
        if (pid === pBad.id) throw new Error('boom-view');
        return { phase: 'play' };
      },
    }), {}, pBad.id));
    assert(r.ok, `start must succeed despite a bad view: ${r.error}`);
    await muted(async () => {
      bad.sent = []; good.sent = [];
      room.broadcastState(); // must not throw
      await drain();
    });
    assert.strictEqual(bad.sent.length, 0, 'throwing view earns no snapshot');
    assert(statesOf(good).length >= 1, 'healthy seat must still receive state');
    // Reentrant broadcast during create() degrades to lobby, never throws.
    const rooms2 = new Rooms({});
    const room2 = rooms2.create();
    try {
      const s = fakeSock();
      const p = room2.addPlayer('P', s).player;
      const r2 = room2.startGame(stubDef({
        create: (ctx) => { ctx.broadcast(); return { phase: 'play' }; },
      }), {}, p.id);
      assert(r2.ok, 'broadcast-in-create must not fail the start');
      void pDead;
    } finally {
      room2.destroy();
    }
  } finally {
    room.destroy();
  }
  ok('T16 one bad view/send starves nobody; create-time broadcast safe');
}

/* T12: compliment-battle / roast-toast skip rounds via stale timers once
 * real entries exist (the sweep's timer-only drive takes their empty-write
 * shortcut instead, so this drives round 1 with entries + votes). */
async function t12BattleSkip() {
  for (const id of ['compliment-battle', 'roast-toast']) {
    const stub = stubTimers();
    try {
      const { room, ps } = await setupRoom(id, 4);
      try {
        const sockOf = (pid) => room.players.find((x) => x.id === pid).socket;
        const target = room.game.state.target;
        const writers = ps.filter((p) => p.id !== target);
        assert(writers.length >= 2, `${id}: need non-target writers`);
        for (const w of writers) {
          room.onAction(w.socket, { entry: 'xy entry ' + w.id }, freshMeta(room));
        }
        await drain();
        assert.strictEqual(room.game.state.phase, 'vote', `${id}: entries must open voting`);
        const order = room.game.state.order;
        assert(order.length >= 2, `${id}: ballot needs entries`);
        for (const w of writers) {
          const idx = order.findIndex((a) => a !== w.id);
          room.onAction(w.socket, { vote: idx }, freshMeta(room));
        }
        if (id === 'compliment-battle') {
          room.onAction(sockOf(target), { vote: 0 }, freshMeta(room)); // target votes too
        } else {
          room.onAction(sockOf(target), { pick: 0 }, freshMeta(room)); // target picks fave
        }
        await drain();
        assert.strictEqual(room.game.state.phase, 'reveal', `${id}: votes must reveal`);
        assert.strictEqual(room.game.state.round, 1);
        const host = ps[0];
        room.onAction(host.socket, { next: true }, freshMeta(room));
        await drain();
        assert.strictEqual(room.game.state.round, 2, `${id}: host Next reaches round 2`);
        // Fire the three stale round-1 timers (write, vote, reveal) —
        // but NOT round 2's own write timer, which legitimately advances.
        stub.fireNext();
        stub.fireNext();
        stub.fireNext();
        await drain();
        assert.strictEqual(room.game.state.round, 2, `${id}: stale timers must not skip round 2`);
        assert.strictEqual(room.game.state.phase, 'write', `${id}: round 2 must still be writing`);
      } finally {
        room.destroy();
      }
    } finally {
      stub.restore();
    }
  }
  ok('T12 battle games skip nothing with entries (2 games)');
}

/* ------------------------------------------------------------------ */
/* Part 2: end-to-end over real WebSockets against the real server.   */
/* ------------------------------------------------------------------ */
const WS_PORT = 18235;

async function wsPart() {
  const srv = spawn('node', ['server/server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(WS_PORT), HOST: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  srv.stdout.on('data', (d) => { out += d; });
  srv.stderr.on('data', (d) => { out += d; });
  const sockets = [];
  const fail = (msg) => {
    console.error('RACE_FAIL', msg, '\n--- server log ---\n' + out);
    for (const s of sockets) try { s.close(); } catch {}
    srv.kill();
    process.exit(1);
  };
  process.on('uncaughtException', (e) => fail('uncaught: ' + e.stack));
  for (let i = 0; i < 50 && !out.includes('PartyBox on'); i++) await sleep(100);
  if (!out.includes('PartyBox on')) return fail('server did not boot');

  const mk = () => new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${WS_PORT}`);
    ws.msgs = [];
    ws.on('message', (d) => ws.msgs.push(JSON.parse(d)));
    ws.on('open', () => { sockets.push(ws); resolve(ws); });
    ws.on('error', reject);
  });
  const send = (ws, o) => ws.send(JSON.stringify(o));
  const last = (ws, t) => [...ws.msgs].reverse().find((m) => m.t === t);
  const helloOf = async (ws, msg) => {
    send(ws, msg);
    await sleep(150);
    const h = last(ws, 'hello');
    assert(h && h.you, 'expected hello, got ' + JSON.stringify(last(ws, 'error')));
    return h;
  };

  // W1: dead-instance action dropped end-to-end; snapshots carry tokens.
  {
    const a = await mk();
    const ha = await helloOf(a, { t: 'create', name: 'A' });
    const b = await mk();
    await helloOf(b, { t: 'join', name: 'B', code: ha.code });
    send(a, { t: 'start', game: 'trivia' });
    await sleep(250);
    const s1 = last(a, 'state');
    assert(s1 && s1.game === 'trivia', 'expected trivia state');
    assert(s1.instanceId, 'state must carry instanceId');
    assert('w' in s1, 'state must carry the action-window token w');
    const i1 = s1.instanceId;
    send(a, { t: 'start', game: 'trivia' }); // rematch
    await sleep(250);
    const s2 = last(a, 'state');
    assert(s2.instanceId && s2.instanceId !== i1, 'rematch rotates instanceId');
    send(b, { t: 'action', a: { pick: 0 }, i: i1, w: s2.w }); // stale instance, fresh window
    await sleep(200);
    const answeredByB = (last(b, 'state').answered || []);
    const hb = last(b, 'hello');
    assert(!answeredByB.includes(hb.you), 'dead-instance vote must be dropped e2e');
    send(b, { t: 'action', a: { pick: 0 }, i: s2.instanceId, w: s2.w });
    await sleep(200);
    assert((last(b, 'state').answered || []).includes(hb.you), 'fresh vote must count e2e');
    a.close(); b.close();
    ok('W1 stale instance dropped end-to-end');
  }

  // W2: stale-window action dropped end-to-end.
  {
    const a = await mk();
    const ha = await helloOf(a, { t: 'create', name: 'A' });
    const b = await mk();
    const hb = await helloOf(b, { t: 'join', name: 'B', code: ha.code });
    send(a, { t: 'start', game: 'trivia' });
    await sleep(250);
    const w1 = last(a, 'state').w;
    const i = last(a, 'state').instanceId;
    send(a, { t: 'action', a: { pick: 0 }, i, w: w1 });
    send(b, { t: 'action', a: { pick: 1 }, i, w: w1 });
    await sleep(250);
    assert.strictEqual(last(a, 'state').phase, 'reveal', 'all-in reveals');
    send(a, { t: 'action', a: { next: true }, i, w: last(a, 'state').w });
    await sleep(250);
    const r2 = last(a, 'state');
    assert.strictEqual(r2.round, 2, 'host Next reaches round 2');
    send(b, { t: 'action', a: { pick: 2 }, i, w: w1 }); // round-1 window token
    await sleep(200);
    assert(!(last(b, 'state').answered || []).includes(hb.you),
      'stale-window vote must be dropped e2e');
    send(b, { t: 'action', a: { pick: 2 }, i, w: last(b, 'state').w });
    await sleep(200);
    assert((last(b, 'state').answered || []).includes(hb.you), 'fresh vote must count');
    a.close(); b.close();
    ok('W2 stale window dropped end-to-end');
  }

  // W3: simultaneous same-window votes all count, exactly once.
  {
    const ws = [await mk(), await mk(), await mk()];
    const h0 = await helloOf(ws[0], { t: 'create', name: 'A' });
    const h1 = await helloOf(ws[1], { t: 'join', name: 'B', code: h0.code });
    const h2 = await helloOf(ws[2], { t: 'join', name: 'C', code: h0.code });
    send(ws[0], { t: 'start', game: 'most-likely' });
    await sleep(250);
    const s0 = last(ws[0], 'state');
    assert.strictEqual(s0.phase, 'vote');
    // Back-to-back votes sharing one window token (no wait between).
    send(ws[0], { t: 'action', a: { vote: h1.you }, i: s0.instanceId, w: s0.w });
    send(ws[1], { t: 'action', a: { vote: h0.you }, i: s0.instanceId, w: s0.w });
    send(ws[2], { t: 'action', a: { vote: h0.you }, i: s0.instanceId, w: s0.w });
    await sleep(300);
    const done = last(ws[0], 'state');
    assert.strictEqual(done.phase, 'reveal', 'simultaneous all-in reveals');
    assert(done.last && done.last.tallies, 'reveal computes tallies');
    assert.strictEqual(Object.keys(done.votes).length, 3, 'all three votes recorded');
    const totals = JSON.stringify(done.totals);
    send(ws[0], { t: 'action', a: { vote: h1.you }, i: s0.instanceId, w: s0.w });
    await sleep(200);
    assert.strictEqual(JSON.stringify(last(ws[0], 'state').totals), totals,
      'replayed votes must not double-score');
    for (const w of ws) w.close();
    ok('W3 simultaneous votes resolve exactly once (e2e)');
  }

  // W4 (regression): token-less actions keep working (older/embed clients).
  {
    const a = await mk();
    const ha = await helloOf(a, { t: 'create', name: 'A' });
    const b = await mk();
    const hb = await helloOf(b, { t: 'join', name: 'B', code: ha.code });
    send(a, { t: 'start', game: 'trivia' });
    await sleep(250);
    send(a, { t: 'action', a: { pick: 0 } }); // no i/w at all
    await sleep(200);
    assert((last(a, 'state').answered || []).includes(ha.you),
      'token-less action must still be accepted');
    void hb;
    a.close(); b.close();
    ok('W4 token-less actions accepted (back-compat)');
  }

  // W5: resume mid-vote keeps the seat; pre-drop vote counts once.
  {
    const a = await mk();
    const ha = await helloOf(a, { t: 'create', name: 'A' });
    const b = await mk();
    await helloOf(b, { t: 'join', name: 'B', code: ha.code });
    const c = await mk();
    const hc = await helloOf(c, { t: 'join', name: 'C', code: ha.code });
    send(a, { t: 'start', game: 'most-likely' });
    await sleep(250);
    const s0 = last(a, 'state');
    send(c, { t: 'action', a: { vote: ha.you }, i: s0.instanceId, w: s0.w });
    await sleep(200);
    c.close(); // drops AFTER voting
    await sleep(250);
    send(a, { t: 'action', a: { vote: hc.you }, i: s0.instanceId, w: s0.w });
    send(b, { t: 'action', a: { vote: ha.you }, i: s0.instanceId, w: s0.w });
    await sleep(250);
    const rev = last(a, 'state');
    assert.strictEqual(rev.phase, 'reveal', 'connected majority + stored vote reveals');
    assert.strictEqual(rev.votes[hc.you], ha.you, 'pre-drop vote must survive');
    const c2 = await mk();
    const hc2 = await helloOf(c2, { t: 'join', name: 'C', code: ha.code, seatToken: hc.seatToken });
    assert.strictEqual(hc2.you, hc.you, 'token resumes the exact seat');
    await sleep(200);
    assert.strictEqual(last(c2, 'state').spectator, false, 'resumed seat stays a participant');
    a.close(); b.close(); c2.close();
    ok('W5 reconnect keeps seat; pre-drop vote counts');
  }

  for (const s of sockets) try { s.close(); } catch {}
  srv.kill();
}

async function t17CastleDeadlineBroadcast() {
  const realNow = Date.now;
  let now = realNow();
  Date.now = () => now;
  const room = new Rooms({}).create();
  // Archived Castle still checks the shared timer contract directly; it is
  // intentionally absent from the public registry. Castle polls readiness
  // and ammo as well as its deadlines. A callback
  // fired early must keep building; advance the clock with the real delays.
  const timers = stubTimers((ms) => { now += ms; });
  const untilPhase = async (phase) => {
    for (let n = 0; n < 400 && room.game.state.phase !== phase; n++) {
      assert(timers.fireNext(), 'Castle has a pending phase timer');
      await drain();
    }
    assert.strictEqual(room.game.state.phase, phase, 'Castle reaches ' + phase);
    assert(sockets.every((socket) => statesOf(socket).at(-1).phase === phase),
      'Castle broadcasts ' + phase + ' to every seat');
  };
  const sockets = Array.from({ length: 4 }, fakeSock);
  try {
    const players = sockets.map((socket, i) => room.addPlayer('Castle ' + i, socket).player);
    assert(room.startGame(require('../games/castle-clash/server'), { settings: { rounds: 1 } }, players[0].id).ok);
    await drain();
    const buildDeadline = room.game.state.endsAt;
    timers.fireNext(); // The first readiness poll cannot end the build.
    await drain();
    assert(sockets.every((s) => statesOf(s).at(-1).phase === 'build'));
    assert.strictEqual(room.game.state.endsAt, buildDeadline);
    await untilPhase('siege');
    assert.strictEqual(now, buildDeadline, 'idle build runs to its deadline');
    const siegeDeadline = room.game.state.endsAt;
    timers.fireNext(); // Idle ammo poll cannot end the siege.
    await drain();
    assert(sockets.every((s) => statesOf(s).at(-1).phase === 'siege'));
    await untilPhase('resolving');
    assert.strictEqual(now, siegeDeadline, 'idle siege runs to its deadline');
    await untilPhase('done'); // Results follow the final effects, without any action.
    for (const socket of sockets) {
      const final = statesOf(socket).at(-1);
      assert.strictEqual(final.phase, 'done', 'idle Castle deadline must broadcast results to every seat');
      assert.strictEqual(final.endsAt, 0, 'terminal snapshot clears the active deadline');
      assert(final.result, 'terminal snapshot contains the team result');
    }
    const totals = JSON.stringify(room.totals);
    timers.fireAll();
    assert.strictEqual(JSON.stringify(room.totals), totals, 'leftover timers award nothing twice');
    ok('T17 idle Castle deadline broadcasts final results and cleared timer');
  } finally {
    room.clearTimers();
    timers.restore();
    Date.now = realNow;
  }
}

async function main() {
  await registry.get('pocket-karts').initialize();
  console.log('RACE part 1: unit sweep over the registry');
  const ids = registry.list().map((g) => g.id);
  console.log(`RACE sweeping ${ids.length} games: ${ids.join(', ')}`);
  const recs = [];
  const sweepErrors = [];
  for (const id of ids) {
    try {
      const rec = await sweepGame(id);
      recs.push(rec);
      console.log(`RACE sweep: ${id} done=${rec.done} stalled=${rec.stalled || '-'} ` +
        `reveals=[${rec.reveals.join(',')}] ends=[${rec.ends.join(',')}]`);
    } catch (e) {
      sweepErrors.push({ id, e });
      console.log(`RACE sweep: ${id} FAILED: ${e.message}`);
    }
  }
  if (sweepErrors.length) {
    console.error(`RACE_FAIL T1 sweep: ${sweepErrors.length} game(s) failed:`);
    for (const { id, e } of sweepErrors) console.error(`  ${id}: ${e.message}`);
    throw sweepErrors[0].e;
  }
  ok(`T1 sweep complete (${recs.filter((r) => r.done).length} done, ` +
    `${recs.filter((r) => !r.done).length} action-gated)`);
  await t2TriviaSkip();
  await t3DoodleAward();
  await t4SilentReveals();
  await t5StaleWindow();
  await t6StaleInstance();
  await t7StaleTurn();
  await t8TimerDisposal();
  await t9SimultaneousVotes();
  await t10SpectatorReconnect();
  await t11CutShortReveal();
  await t12BattleSkip();
  await t13ThrowingCreate();
  await t14ThrowingTimer();
  await t15ThrowingTick();
  await t16BroadcastBulkhead();
  await t17CastleDeadlineBroadcast();
  if (!process.env.RACE_ONLY) {
    console.log('RACE part 2: end-to-end over WebSockets');
    await wsPart();
  }
  console.log('RACE_PASS');
}

main().catch((e) => {
  console.error('RACE_FAIL', e);
  process.exit(1);
});

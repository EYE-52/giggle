'use strict';
/* Rules plumbing from specs/GAME_RULES_STANDARD.md:
 * - games/_sdk.js roundsSetting / paceSetting / paced / moveTimerSetting;
 * - "End game" (room.endGame): keeps awarded points, optional def.onEnd,
 *   generic frozen final scores without it, Rematch / Change game after;
 * - "Leave" (room.leave): the seat stops playing at once, optional
 *   def.onPlayerGone(state, ctx, pid, 'left'), standalone seat given up,
 *   Giggle seat kept for the next game;
 * - away timeout: def.onPlayerGone(..., 'away') once after the timeout,
 *   cancelled by a reconnect; too few players left ends the match. */
const assert = require('node:assert/strict');
const { Room } = require('../server/room');
const sdk = require('../games/_sdk');
const { validateManifest } = require('../games/_validate');

let checks = 0;
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };
const ok = (a, m) => { assert(a, m); checks++; };
const socket = () => ({ readyState: 1, messages: [], send(s) { this.messages.push(JSON.parse(s)); }, close() { this.readyState = 3; } });
const lastState = (ws) => ws.messages.filter((m) => m.t === 'state').at(-1);
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

/* A tiny round game: 'play' → each action awards 100 → 'done' after 3. */
function makeDef({ onEnd, onPlayerGone, onConnection, min = 2 } = {}) {
  const def = {
    id: 'test-rounds',
    manifest: { name: 'Test rounds', players: { min, max: 8 }, settings: [sdk.roundsSetting({ def: 3 }), sdk.paceSetting()] },
    create(ctx) {
      const scores = {};
      for (const p of ctx.players()) scores[p.id] = 0;
      ctx.later(sdk.pacedMs(ctx, 600), () => { def.timerFired = true; });
      return { phase: 'play', round: 1, scores, gone: [], seen: [] };
    },
    view(S) { return { phase: S.phase, round: S.round, scores: S.scores }; },
    onAction(S, ctx, pid) {
      S.seen.push(pid);
      S.scores[pid] = (S.scores[pid] || 0) + 100;
      ctx.award(pid, 100);
    },
    onTick(S) { S.ticks = (S.ticks || 0) + 1; },
  };
  if (onEnd) def.onEnd = onEnd;
  if (onPlayerGone) def.onPlayerGone = onPlayerGone;
  if (onConnection) def.onConnection = onConnection;
  return def;
}

function seatRoom(n, opts = {}) {
  const room = new Room('TEST', {}, opts);
  const seats = Array.from({ length: n }, (_, i) => {
    const ws = socket();
    const r = opts.giggle ? room.addGigglePlayer('sub-' + i, 'Player ' + i, ws) : room.addPlayer('Player ' + i, ws);
    return { ws, id: r.player.id };
  });
  return { room, seats };
}

/* ---- SDK helpers ---- */
{
  eq(sdk.roundsSetting(), { key: 'rounds', label: 'Rounds', type: 'int', min: 1, max: 12, def: null, autoLabel: 'Auto' }, 'rounds default is Auto 1–12');
  eq(sdk.roundsSetting({ def: 6 }), { key: 'rounds', label: 'Rounds', type: 'int', min: 1, max: 12, def: 6 }, 'rounds with a natural length');
  eq(sdk.roundsSetting({ autoLabel: 'Auto (one per player)' }).autoLabel, 'Auto (one per player)', 'auto label');
  eq(sdk.paceSetting(), { key: 'pace', label: 'Pace', type: 'enum', options: ['Relaxed', 'Normal', 'Quick'], def: 'Normal' }, 'pace labels');
  eq(sdk.moveTimerSetting().options, ['Off', '30 seconds', '60 seconds'], 'move timer options');
  eq([sdk.paced({ pace: 'Relaxed' }, 30), sdk.paced({ pace: 'Normal' }, 30), sdk.paced({ pace: 'Quick' }, 30)], [45, 30, 20], 'pace factors');
  eq(sdk.paced({}, 30), 30, 'missing pace is Normal');
  eq(sdk.paced({ pace: 'Warp' }, 30), 30, 'unknown pace is Normal');
  eq(sdk.paced({ pace: 'Quick' }, 4), 3, 'never below 3 seconds');
  eq(sdk.paced({ pace: 'Quick' }, 7), 5, 'rounded to whole seconds (4.69 → 5)');
  eq(sdk.paced({ settings: () => ({ pace: 'Quick' }) }, 30), 20, 'reads a ctx');
  eq(sdk.pacedMs('Relaxed', 10), 15000, 'milliseconds helper');
  eq([sdk.moveSeconds({ moveTimer: 'Off' }), sdk.moveSeconds({ moveTimer: '30 seconds' }), sdk.moveSeconds({ settings: () => ({ moveTimer: '60 seconds' }) })], [0, 30, 60], 'move seconds');
  const base = { id: 'shape', manifest: { name: 'Shape', players: { min: 1, max: 4 } } };
  ok(validateManifest({ ...base, manifest: { ...base.manifest, settings: [sdk.roundsSetting(), sdk.paceSetting(), sdk.moveTimerSetting()] } }).ok, 'shared helpers validate');
  ok(!validateManifest({ ...base, manifest: { ...base.manifest, settings: [{ key: 'pace', label: 'Speed', type: 'enum', options: ['Relaxed', 'Normal', 'Quick'], def: 'Normal' }] } }).ok, 'pace must keep its label');
  ok(!validateManifest({ ...base, manifest: { ...base.manifest, settings: [{ key: 'pace', label: 'Pace', type: 'enum', options: ['Slow', 'Normal'], def: 'Normal' }] } }).ok, 'pace must keep its options');
  ok(!validateManifest({ ...base, manifest: { ...base.manifest, settings: [{ key: 'rounds', label: 'Turns', type: 'int', min: 1, max: 5, def: 3 }] } }).ok, 'rounds must keep its label');
}

/* ---- End game without onEnd: frozen generic final scores ---- */
{
  const { room, seats } = seatRoom(3);
  const def = makeDef();
  eq(room.startGame(def, {}, seats[0].id).ok, true, 'starts');
  room.onAction(seats[1].ws, {}, {});
  eq(room.totals[seats[1].id], 100, 'awarded before the end');
  eq(room.endGame(seats[1].id).error, 'Only the host can end the game.', 'only host ends');
  eq(room.endGame(seats[0].id).ok, true, 'host ends');
  eq(room.timers.size, 0, 'pending game timers cancelled');
  const S = lastState(seats[2].ws);
  eq(S.matchEnded, true, 'snapshot says the match ended');
  eq(S.matchPoints, { [seats[1].id]: 100 }, 'match points so far');
  eq(room.totals[seats[1].id], 100, 'awarded points stay');
  const before = room.game.state.seen.length;
  room.onAction(seats[2].ws, {}, {});
  room.onTick();
  eq(room.game.state.seen.length, before, 'frozen: actions ignored');
  eq(room.game.state.ticks, undefined, 'frozen: no ticks');
  eq(room.endGame(seats[0].id).already, true, 'ending twice is harmless');
  ok(room.lobby.ended, 'room snapshot says ended');
  // Rematch (start) and Change game (lobby) both work afterwards.
  eq(room.startGame(def, {}, seats[0].id).ok, true, 'rematch after end');
  ok(!room.game.ended, 'fresh match is live');
  eq(room.endGameToLobby(seats[0].id).ok, true, 'change game');
  room.destroy();
}

/* ---- End game with onEnd: the game awards and moves to done ---- */
{
  const calls = [];
  const def = makeDef({
    onEnd(S, ctx, info) {
      calls.push(info.reason);
      ok(ctx.ended(), 'ctx.ended() is true inside onEnd');
      const best = Object.entries(S.scores).sort((a, b) => b[1] - a[1])[0][0];
      ctx.award(best, 300);
      S.phase = 'done';
    },
  });
  const { room, seats } = seatRoom(2);
  room.startGame(def, {}, seats[0].id);
  room.onAction(seats[0].ws, {}, {});
  room.endGame(seats[0].id);
  eq(calls, ['host'], 'onEnd ran once with reason host');
  eq(room.game.state.phase, 'done', 'game moved to done');
  eq(room.totals[seats[0].id], 400, 'whole-match points added');
  const S = lastState(seats[1].ws);
  eq(S.phase, 'done', 'clients see done');
  eq(S.matchEnded, true, 'and the ended flag');
  room.destroy();
}

/* ---- Ending while the round still prepares releases the clock ---- */
{
  const { room, seats } = seatRoom(2);
  room.startGame(makeDef(), { ready: true }, seats[0].id);
  ok(room.game.preparing, 'preparing');
  room.endGame(seats[0].id);
  ok(!room.game.preparing, 'end releases preparation');
  eq(lastState(seats[1].ws).matchEnded, true, 'final scores reach everyone');
  room.destroy();
}

/* ---- Leave (standalone): seat given up, hook runs, room continues ---- */
{
  const gone = [];
  const def = makeDef({ onPlayerGone(S, ctx, pid, reason) { gone.push([pid, reason]); S.gone.push(pid); } });
  const { room, seats } = seatRoom(3);
  room.startGame(def, {}, seats[0].id);
  const leaver = seats[2];
  eq(room.leave(leaver.ws).removed, true, 'standalone leave removes the seat');
  eq(gone, [[leaver.id, 'left']], 'onPlayerGone(left) ran once');
  ok(!room.ctx().players().some((p) => p.id === leaver.id), 'leaver is out of ctx.players()');
  ok(room.activeRosterIds().includes(leaver.id), 'roster order stays stable');
  eq(room.bySocket(leaver.ws), undefined, 'socket owns no seat');
  ok(!room.lobby.players.some((p) => p.id === leaver.id), 'lobby no longer lists the seat');
  const S = lastState(seats[0].ws);
  eq(S.players.find((p) => p.id === leaver.id), { id: leaver.id, name: 'Player 2', connected: false, left: true }, 'snapshot keeps the name, marked left');
  ok(!room.game.ended, 'two players remain: the match goes on');
  const old = room.players.find((p) => p.id === leaver.id);
  ok(!room.preflightAdd(old.token || 'x').resume, 'old seat cannot be resumed');
  const back = room.addPlayer('Player 2', socket());
  eq(back.player.name, 'Player 2', 'name is free again');
  ok(room.isSpectator(back.player.id), 'rejoining mid-match watches');
  room.endGameToLobby(seats[0].id);
  ok(!room.players.some((p) => p.id === leaver.id), 'left seat purged after the match');
  room.destroy();
}

/* ---- Leave (Giggle): seat kept in the room, host handed over ---- */
{
  const { room, seats } = seatRoom(3, { giggle: { squadId: 'sq' } });
  const conn = [];
  room.startGame(makeDef({ onConnection(S, ctx, pid, c) { conn.push([pid, c]); } }), {}, seats[0].id);
  const r = room.leave(seats[0].ws);
  eq(r.removed, false, 'Giggle leave keeps the seat');
  eq(conn, [[seats[0].id, false]], 'fallback onConnection(false) for a game without onPlayerGone');
  ok(room.hostId !== seats[0].id && room.activeRosterIds().includes(room.hostId), 'host handed to a player still playing');
  const S = lastState(seats[0].ws);
  eq(S.youLeft, true, 'leaver sees youLeft');
  eq(S.spectator, true, 'and is a watcher');
  room.onAction(seats[0].ws, {}, {});
  ok(!room.game.state.seen.includes(seats[0].id), 'leaver actions are ignored');
  ok(room.lobby.players.some((p) => p.id === seats[0].id), 'seat still in the room');
  room.startGame(makeDef(), {}, room.hostId);
  ok(room.activeRosterIds().includes(seats[0].id) && !room.hasLeft(seats[0].id), 'leaver plays the next game');
  room.destroy();
}

/* ---- Too few players left ends the match (no hook) ---- */
{
  const { room, seats } = seatRoom(2);
  room.startGame(makeDef(), {}, seats[0].id);
  room.onAction(seats[0].ws, {}, {});
  room.leave(seats[1].ws);
  ok(room.game.ended, 'a duel ends when one player leaves');
  eq(lastState(seats[0].ws).matchEnded, true, 'remaining player sees final scores');
  eq(room.totals[seats[0].id], 100, 'points kept');
  room.destroy();
}

(async () => {
  /* ---- Away timeout: hook after the timeout, cancelled by reconnect ---- */
  const gone = [];
  const def = makeDef({ onPlayerGone(S, ctx, pid, reason) { gone.push([pid, reason]); } });
  const { room, seats } = seatRoom(3, { awayTimeoutMs: 40 });
  room.startGame(def, {}, seats[0].id);
  const token = room.players.find((p) => p.id === seats[1].id).token;
  room.disconnect(seats[1].ws);
  await pause(15);
  const ws2 = socket();
  room.addPlayer('Player 1', ws2, token);
  await pause(60);
  eq(gone, [], 'reconnecting in time cancels the away timeout');
  room.disconnect(seats[2].ws);
  await pause(80);
  eq(gone, [[seats[2].id, 'away']], 'onPlayerGone(away) after the timeout');
  ok(!room.game.ended, 'two connected players remain');
  room.disconnect(ws2);
  await pause(80);
  eq(gone.length, 2, 'second away seat reported');
  ok(room.game.ended, 'only one player left: the match ends');
  room.destroy();

  /* No hook: away seats in a duel end the match after the timeout. */
  const duel = seatRoom(2, { awayTimeoutMs: 30 });
  duel.room.startGame(makeDef(), {}, duel.seats[0].id);
  duel.room.disconnect(duel.seats[1].ws);
  await pause(10);
  ok(!duel.room.game.ended, 'not ended before the timeout');
  await pause(60);
  ok(duel.room.game.ended, 'ended after the timeout');
  duel.room.destroy();

  console.log(`ROOM_END_LEAVE_PASS: ${checks} checks (pace helpers, End game, Leave, away timeout)`);
})().catch((e) => { console.error(e); process.exit(1); });

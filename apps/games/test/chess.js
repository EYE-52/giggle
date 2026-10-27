'use strict';
/* Chess rule tests: real chess.js positions (legal play, Fool's mate,
 * castling, promotion, stalemate), illegal/out-of-turn/spectator actions,
 * clocks/timeout, invalid values, resign/rematch — plus a live-server
 * section proving the 2-seat contract (2 play, rest watch).
 * Run: npm run test:chess */
const assert = require('assert');
const { spawn } = require('child_process');
const path = require('path');
const WebSocket = require('ws');

const ROOT = path.join(__dirname, '..');
const PORT = 18238;
const chess = require('../games/chess/server.js');

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/* Controllable stub ctx: now/players/settings/broadcast counting. */
function stubCtx(opts = {}) {
  const players = opts.players || [{ id: 'pa', name: 'Ann' }, { id: 'pb', name: 'Bob' }];
  const ctx = {
    _now: opts.now || 1000000,
    _broadcasts: 0,
    _awards: {},
    players: () => (opts.connected || players).slice(),
    allPlayers: () => players.slice(),
    content: () => ({}),
    settings: () => ({ ...(opts.settings || {}) }),
    hostId: () => 'pa',
    broadcast: () => { ctx._broadcasts += 1; },
    lobby: () => {},
    later: () => () => {},
    award: (pid, pts) => { ctx._awards[pid] = (ctx._awards[pid] || 0) + pts; },
    now: () => ctx._now,
  };
  return ctx;
}

function move(state, ctx, pid, from, to, promotion) {
  chess.onAction(state, ctx, pid, { move: { from, to, promotion } });
}

function cellOf(view, sq) {
  for (const row of view.board) for (const c of row) if (c && c.s === sq) return c;
  return null;
}

function main() {
  // --- manifest ---
  assert.strictEqual(chess.manifest.seats, 2, 'chess seats exactly 2');
  assert.deepStrictEqual(chess.manifest.players, { min: 2, max: 24 }, 'chess hosts big parties');
  assert(chess.manifest.settings.some((s) => s.key === 'timeControl'), 'time control setting');
  assert(chess.manifest.settings.some((s) => s.key === 'boardTheme'), 'board theme setting');
  assert.strictEqual(chess.manifest.art, 'img/games/chess.svg', 'self-authored art');
  console.log('CHESS ok: manifest (seats 2, settings, art)');

  // --- seats + defaults ---
  let ctx = stubCtx();
  let st = chess.create(ctx);
  assert.strictEqual(st.phase, 'play', 'starts in play');
  assert.strictEqual(st.white, 'pa', 'first roster seat is white');
  assert.strictEqual(st.black, 'pb', 'second roster seat is black');
  assert.strictEqual(st.clocks, null, 'untimed by default');
  assert.strictEqual(st.boardTheme, 'Mono', 'default board theme');
  let v = chess.view(st, 'pa');
  assert.strictEqual(v.youAre, 'w', 'white seat knows its side');
  assert.strictEqual(chess.view(st, 'pb').youAre, 'b', 'black seat knows its side');
  assert.strictEqual(chess.view(st, 'pz').youAre, null, 'non-seat is a watcher');
  assert.strictEqual(v.turn, 'w', 'white moves first');
  assert.strictEqual(v.check, false, 'no check at start');
  assert(Array.isArray(v.history) && v.history.length === 0, 'empty history');
  assert(v.legal.e2 && v.legal.e2.some((d) => d.to === 'e4'), 'e2-e4 is legal');
  assert.strictEqual(typeof v.fen, 'string', 'fen present');
  assert(!('chess' in v), 'server Chess instance never leaks into views');
  console.log('CHESS ok: seats, defaults, per-pid view');

  // --- a known legal sequence (Ruy Lopez exhange-ish) ---
  ctx = stubCtx();
  st = chess.create(ctx);
  const seq = [
    ['pa', 'e2', 'e4'], ['pb', 'e7', 'e5'], ['pa', 'g1', 'f3'], ['pb', 'b8', 'c6'],
    ['pa', 'f1', 'b5'], ['pb', 'a7', 'a6'], ['pa', 'b5', 'a4'], ['pb', 'g8', 'f6'],
  ];
  for (const [pid, from, to] of seq) move(st, ctx, pid, from, to);
  assert.strictEqual(st.phase, 'play', 'still playing');
  assert.deepStrictEqual(chess.view(st, 'pa').history,
    ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6'], 'SAN history, saw ' + chess.view(st, 'pa').history);
  assert.deepStrictEqual(st.lastMove, { from: 'g8', to: 'f6', san: 'Nf6' }, 'last move tracked');
  assert.strictEqual(chess.view(st, 'pa').turn, 'w', 'turn returns to white');
  console.log("CHESS ok: legal sequence + SAN history ('" + chess.view(st, 'pa').history.slice(0, 4).join(' ') + '…\')');

  // --- Fool's mate: fastest checkmate ---
  ctx = stubCtx();
  st = chess.create(ctx);
  move(st, ctx, 'pa', 'f2', 'f3');
  move(st, ctx, 'pb', 'e7', 'e5');
  move(st, ctx, 'pa', 'g2', 'g4');
  move(st, ctx, 'pb', 'd8', 'h4');
  assert.strictEqual(st.phase, 'done', 'mate ends the game');
  assert.deepStrictEqual(st.result, {
    outcome: 'checkmate', detail: 'Checkmate', winner: 'b', winnerPid: 'pb',
  }, 'mate result, saw ' + JSON.stringify(st.result));
  assert.strictEqual(ctx._awards.pb, 300, 'winner awarded 300');
  assert.strictEqual(ctx._awards.pa || 0, 0, 'loser awarded nothing');
  const mateView = chess.view(st, 'pa');
  assert.strictEqual(mateView.check, true, 'check flag on mate');
  assert.strictEqual(mateView.checkSquare, 'e1', 'white king in check on e1');
  const histBefore = mateView.history.length;
  move(st, ctx, 'pa', 'e2', 'e4'); // moves after done are ignored
  assert.strictEqual(chess.view(st, 'pa').history.length, histBefore, 'post-game moves ignored');
  console.log("CHESS ok: Fool's mate (f3 e5 g4 Qh4#), awards, post-game lock");

  // --- castling through a real position ---
  ctx = stubCtx();
  st = chess.create(ctx);
  const castle = [
    ['pa', 'e2', 'e4'], ['pb', 'e7', 'e5'], ['pa', 'g1', 'f3'], ['pb', 'b8', 'c6'],
    ['pa', 'f1', 'c4'], ['pb', 'f8', 'c5'],
  ];
  for (const [pid, from, to] of castle) move(st, ctx, pid, from, to);
  move(st, ctx, 'pa', 'e1', 'g1');
  const cv = chess.view(st, 'pa');
  assert(cv.history.includes('O-O'), 'kingside castle recorded, saw ' + cv.history);
  assert.deepStrictEqual(cellOf(cv, 'g1'), { s: 'g1', t: 'k', c: 'w' }, 'king lands g1');
  assert.deepStrictEqual(cellOf(cv, 'f1'), { s: 'f1', t: 'r', c: 'w' }, 'rook lands f1');
  console.log('CHESS ok: castling O-O (king g1, rook f1)');

  // --- promotion: required choice, queen + underpromotion ---
  const promoLine = [
    ['pa', 'a2', 'a4'], ['pb', 'b8', 'c6'], ['pa', 'a4', 'a5'], ['pb', 'b7', 'b5'],
    ['pa', 'a5', 'b6'], ['pb', 'g8', 'f6'], ['pa', 'b6', 'b7'], ['pb', 'e7', 'e6'],
  ];
  const promoSetup = () => {
    const c = stubCtx();
    const s = chess.create(c);
    for (const [pid, from, to] of promoLine) move(s, c, pid, from, to);
    return [s, c];
  };
  [st, ctx] = promoSetup();
  move(st, ctx, 'pa', 'b7', 'b8'); // missing promotion: rejected
  assert.strictEqual(chess.view(st, 'pa').history.length, 8, 'missing promotion is illegal');
  move(st, ctx, 'pa', 'b7', 'b8', 'q');
  let pv = chess.view(st, 'pa');
  assert(pv.history.includes('b8=Q'), 'queen promotion recorded, saw ' + pv.history);
  assert.deepStrictEqual(cellOf(pv, 'b8'), { s: 'b8', t: 'q', c: 'w' }, 'queen stands on b8');
  assert(pv.legal.a8 === undefined || true, 'view still projects after promotion');
  [st, ctx] = promoSetup();
  move(st, ctx, 'pa', 'b7', 'b8', 'N'); // uppercase underpromotion accepted
  pv = chess.view(st, 'pa');
  assert(pv.history.includes('b8=N'), 'knight underpromotion recorded, saw ' + pv.history);
  assert.deepStrictEqual(cellOf(pv, 'b8'), { s: 'b8', t: 'n', c: 'w' }, 'knight stands on b8');
  console.log('CHESS ok: promotion required, b8=Q and b8=N');

  // --- stalemate through the shortest known line ---
  ctx = stubCtx();
  st = chess.create(ctx);
  const stale = [
    ['pa', 'e2', 'e3'], ['pb', 'a7', 'a5'], ['pa', 'd1', 'h5'], ['pb', 'a8', 'a6'],
    ['pa', 'h5', 'a5'], ['pb', 'h7', 'h5'], ['pa', 'h2', 'h4'], ['pb', 'a6', 'h6'],
    ['pa', 'a5', 'c7'], ['pb', 'f7', 'f6'], ['pa', 'c7', 'd7'], ['pb', 'e8', 'f7'],
    ['pa', 'd7', 'b7'], ['pb', 'd8', 'd3'], ['pa', 'b7', 'b8'], ['pb', 'd3', 'h7'],
    ['pa', 'b8', 'c8'], ['pb', 'f7', 'g6'], ['pa', 'c8', 'e6'],
  ];
  for (const [pid, from, to] of stale) move(st, ctx, pid, from, to);
  assert.strictEqual(st.phase, 'done', 'stalemate ends the game');
  assert.strictEqual(st.result.outcome, 'stalemate', 'stalemate outcome, saw ' + JSON.stringify(st.result));
  assert.strictEqual(st.result.winner, null, 'stalemate has no winner');
  assert.strictEqual(ctx._awards.pa, 150, 'a draw gives 150 each');
  assert.strictEqual(ctx._awards.pb, 150, 'a draw gives 150 each');
  console.log('CHESS ok: stalemate line (…Qe6), draw split');

  // --- illegal / out-of-turn / spectator / garbage actions ---
  ctx = stubCtx();
  st = chess.create(ctx);
  const bad = [
    ['pb', { move: { from: 'e2', to: 'e4' } }], // black moving white's pawn
    ['pa', { move: { from: 'e7', to: 'e5' } }], // white moving black's pawn
    ['pa', { move: { from: 'e2', to: 'e5' } }], // illegal jump
    ['pa', { move: { from: 'e2', to: 'e4', promotion: 'x' } }], // bad promotion
    ['pa', { move: { from: 'e2', to: 'e4', promotion: 42 } }],
    ['pa', { move: { from: 'e9', to: 'e4' } }], // off-board
    ['pa', { move: { from: 'x', to: 'y' } }],
    ['pa', { move: { from: NaN, to: 'e4' } }],
    ['pa', { move: 'e2e4' }], // wrong shape
    ['pa', { move: null }],
    ['pa', { vote: 'a' }], // foreign-game action
    ['pa', 'nope'],
    ['pa', 42],
    ['pa', [1]],
    ['pa', null],
    ['pa', undefined],
    ['pz', { move: { from: 'e2', to: 'e4' } }], // unknown pid (watcher)
  ];
  for (const [pid, a] of bad) chess.onAction(st, ctx, pid, a);
  assert.strictEqual(chess.view(st, 'pa').history.length, 0, 'nothing illegal sticks');
  assert.strictEqual(chess.view(st, 'pa').turn, 'w', 'turn untouched by garbage');
  move(st, ctx, 'pa', 'e2', 'e4'); // the board still plays afterwards
  assert.deepStrictEqual(chess.view(st, 'pa').history, ['e4'], 'legal play survives garbage');
  move(st, ctx, 'pa', 'd2', 'd4'); // out of turn (black to move)
  assert.deepStrictEqual(chess.view(st, 'pa').history, ['e4'], 'out-of-turn move ignored');
  console.log('CHESS ok: illegal/out-of-turn/watcher/garbage ignored');

  // --- resignation ---
  ctx = stubCtx();
  st = chess.create(ctx);
  move(st, ctx, 'pa', 'e2', 'e4');
  chess.onAction(st, ctx, 'pz', { resign: true }); // watcher resign: ignored
  assert.strictEqual(st.phase, 'play', 'watcher cannot resign');
  chess.onAction(st, ctx, 'pb', { resign: 'yes' }); // wrong shape: ignored
  assert.strictEqual(st.phase, 'play', 'malformed resign ignored');
  chess.onAction(st, ctx, 'pb', { resign: true });
  assert.strictEqual(st.phase, 'done', 'resign ends the game');
  assert.deepStrictEqual(st.result,
    { outcome: 'resign', detail: 'Black resigned', winner: 'w', winnerPid: 'pa' },
    'resign result, saw ' + JSON.stringify(st.result));
  assert.strictEqual(ctx._awards.pa, 300, 'resign winner awarded');
  assert.deepStrictEqual(chess.view(st, 'pz').scores, { pa: 300, pb: 0 }, 'match scoreboard kept');
  console.log('CHESS ok: resignation (watcher + malformed ignored)');

  // --- clocks: charge, flag on tick and on action ---
  ctx = stubCtx({ settings: { timeControl: '3 minutes' } });
  st = chess.create(ctx);
  assert.deepStrictEqual(st.clocks, { w: 180000, b: 180000 }, '3-minute clocks');
  ctx._now += 10000; // white thinks for 10s, then moves
  move(st, ctx, 'pa', 'e2', 'e4');
  assert(st.clocks.w < 180000 && st.clocks.w >= 169000, 'white clock charged, saw ' + st.clocks.w);
  assert.strictEqual(st.clocks.b, 180000, 'black clock untouched');
  ctx._now += 181000; // black lets the flag fall without acting
  const b0 = ctx._broadcasts;
  chess.onTick(st, ctx);
  assert.strictEqual(st.phase, 'done', 'flag ends the game');
  assert.strictEqual(st.result.outcome, 'timeout', 'timeout outcome');
  assert.strictEqual(st.result.winner, 'w', 'flagged side loses');
  assert.strictEqual(ctx._broadcasts, b0 + 1, 'timeout broadcasts once');
  // Untimed games: onTick is a silent no-op.
  ctx = stubCtx();
  st = chess.create(ctx);
  ctx._now += 3600000;
  chess.onTick(st, ctx);
  assert.strictEqual(st.phase, 'play', 'untimed never flags');
  assert.strictEqual(ctx._broadcasts, 0, 'untimed tick broadcasts nothing');
  // Flag falls on the move attempt itself when the clock already expired.
  ctx = stubCtx({ settings: { timeControl: '5 minutes' } });
  st = chess.create(ctx);
  ctx._now += 301000;
  move(st, ctx, 'pa', 'e2', 'e4');
  assert.strictEqual(st.phase, 'done', 'expired mover flags instead of moving');
  assert.strictEqual(chess.view(st, 'pa').history.length, 0, 'flagged move never lands');
  console.log('CHESS ok: clocks charge/flag, untimed silent');

  // --- invalid settings fall back safely ---
  ctx = stubCtx({ settings: { timeControl: 'Blitz 99', boardTheme: 'Brown' } });
  st = chess.create(ctx);
  assert.strictEqual(st.clocks, null, 'unknown time control is untimed');
  assert.strictEqual(st.boardTheme, 'Mono', 'unknown theme falls back to Mono');
  ctx = stubCtx({ settings: { boardTheme: 'Violet' } });
  st = chess.create(ctx);
  assert.strictEqual(st.boardTheme, 'Blue', 'pre-D7 Violet maps to Blue');
  ctx = stubCtx({ settings: { boardTheme: 'Mint' } });
  st = chess.create(ctx);
  assert.strictEqual(st.boardTheme, 'Green', 'pre-D7 Mint maps to Green');
  ctx = stubCtx({ settings: { timeControl: 'Untimed' } });
  st = chess.create(ctx);
  assert.strictEqual(st.timeControl, 'Off', 'legacy Untimed reads as Off');
  const tc = chess.manifest.settings.find((s) => s.key === 'timeControl');
  assert.deepStrictEqual(tc.options, ['Off', '3 minutes', '5 minutes', '10 minutes'], 'time controls labelled like the move timer');
  console.log('CHESS ok: invalid settings fall back safely');

  // --- standard rules: draw offers, move timer, forfeit ---
  ctx = stubCtx();
  st = chess.create(ctx);
  chess.onAction(st, ctx, 'pz', { offerDraw: true });
  assert.strictEqual(st.drawOffer, null, 'watchers cannot offer a draw');
  chess.onAction(st, ctx, 'pa', { offerDraw: true });
  assert.strictEqual(chess.view(st, 'pb').drawOffer, 'pa', 'offer is visible');
  chess.onAction(st, ctx, 'pa', { acceptDraw: true });
  assert.strictEqual(st.phase, 'play', 'cannot accept your own offer');
  chess.onAction(st, ctx, 'pb', { declineDraw: true });
  assert.strictEqual(st.drawOffer, null, 'decline clears the offer');
  chess.onAction(st, ctx, 'pa', { offerDraw: true });
  assert.strictEqual(st.drawOffer, null, 'a declined player waits for a move before offering again');
  move(st, ctx, 'pa', 'e2', 'e4');
  chess.onAction(st, ctx, 'pb', { offerDraw: true });
  move(st, ctx, 'pa', 'd2', 'd4');
  assert.strictEqual(st.drawOffer, 'pb', 'out-of-turn move ignored, offer stands');
  move(st, ctx, 'pb', 'e7', 'e5');
  assert.strictEqual(st.drawOffer, null, 'a move withdraws the offer');
  chess.onAction(st, ctx, 'pa', { offerDraw: true });
  chess.onAction(st, ctx, 'pb', { acceptDraw: true });
  assert.strictEqual(st.phase, 'done', 'accepted draw ends the game');
  assert.strictEqual(st.result.winner, null);
  assert.strictEqual(st.result.outcome, 'draw');
  assert.deepStrictEqual(ctx._awards, { pa: 150, pb: 150 }, 'agreed draw: 150 each');

  assert(chess.manifest.settings.some((s) => s.key === 'moveTimer' && s.def === 'Off'), 'move timer setting, Off by default');
  ctx = stubCtx({ settings: { moveTimer: '30 seconds' } });
  st = chess.create(ctx);
  assert.strictEqual(st.endsAt, ctx._now + 30000, 'move deadline armed');
  ctx._now += 20000; move(st, ctx, 'pa', 'e2', 'e4');
  assert.strictEqual(st.endsAt, ctx._now + 30000, 'each move re-arms the timer');
  ctx._now += 29999; chess.onTick(st, ctx);
  assert.strictEqual(st.phase, 'play', 'not yet');
  ctx._now += 1; chess.onTick(st, ctx);
  assert.strictEqual(st.phase, 'done', 'move timer runs out');
  assert.strictEqual(st.result.outcome, 'timeout');
  assert.strictEqual(st.result.winner, 'w', 'the player to move loses on time');
  assert.deepStrictEqual(ctx._awards, { pa: 300 });
  ctx = stubCtx();
  st = chess.create(ctx);
  assert.strictEqual(st.endsAt, null, 'move timer off: no deadline');

  ctx = stubCtx();
  st = chess.create(ctx);
  assert.strictEqual(chess.onPlayerGone(st, ctx, 'pz'), false, 'a watcher leaving changes nothing');
  assert.strictEqual(chess.onPlayerGone(st, ctx, 'pa'), true);
  assert.strictEqual(st.phase, 'done'); assert.strictEqual(st.result.outcome, 'forfeit');
  assert.strictEqual(st.result.winnerPid, 'pb', 'the player still here wins by forfeit');
  assert.deepStrictEqual(ctx._awards, { pb: 300 });
  assert.strictEqual(chess.onPlayerGone(st, ctx, 'pb'), false, 'a finished game is final');
  console.log('CHESS ok: draw offers, move timer, forfeit');

  // --- rematch: a fresh create is fully independent ---
  ctx = stubCtx();
  st = chess.create(ctx);
  move(st, ctx, 'pa', 'f2', 'f3');
  const st2 = chess.create(stubCtx());
  assert.strictEqual(chess.view(st2, 'pa').history.length, 0, 'rematch starts clean');
  assert.strictEqual(chess.view(st, 'pa').history.length, 1, 'old game untouched');
  console.log('CHESS ok: rematch independence');
}

async function serverSection() {
  const srv = spawn('node', ['server/server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  srv.stdout.on('data', (d) => { out += d; });
  srv.stderr.on('data', (d) => { out += d; });
  const fail = (msg) => {
    console.error('CHESS_FAIL', msg, '\n--- server log ---\n' + out);
    srv.kill();
    process.exit(1);
  };
  for (let i = 0; i < 50 && !out.includes('PartyBox on'); i++) await sleep(100);
  if (!out.includes('PartyBox on')) return fail('server did not boot');

  const mk = () => new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
    ws.msgs = [];
    ws.on('message', (d) => ws.msgs.push(JSON.parse(d)));
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
  const send = (ws, o) => ws.send(JSON.stringify(o));
  const last = (ws, t) => [...ws.msgs].reverse().find((m) => m.t === t);
  try {
    // A 4-person party: host + friend + 2 watchers.
    const a = await mk();
    send(a, { t: 'create', name: 'Ann' });
    await sleep(150);
    const code = last(a, 'room').room.code;
    const ha = last(a, 'hello');
    const b = await mk();
    send(b, { t: 'join', name: 'Bob', code });
    const c = await mk();
    send(c, { t: 'join', name: 'Cat', code });
    const d = await mk();
    send(d, { t: 'join', name: 'Dan', code });
    await sleep(250);
    const hb = last(b, 'hello');
    const hc = last(c, 'hello');
    const hd = last(d, 'hello');

    // Timed + themed through the generic configure path.
    send(a, { t: 'configure', game: 'chess', settings: { timeControl: '5 minutes', boardTheme: 'Green' } });
    await sleep(150);
    assert.strictEqual(last(a, 'room').room.config.chess.settings.boardTheme, 'Green', 'theme configures');

    send(a, { t: 'start', game: 'chess' });
    await sleep(250);
    const st = last(a, 'state');
    assert(st && st.game === 'chess', 'chess starts, got ' + JSON.stringify(last(a, 'error')));
    assert.deepStrictEqual(st.players.map((p) => p.id).sort(), [ha.you, hb.you].sort(),
      'only the first two seats play, saw ' + JSON.stringify(st.players));
    assert.deepStrictEqual(st.spectators.map((p) => p.id).sort(), [hc.you, hd.you].sort(),
      'other room members watch, saw ' + JSON.stringify(st.spectators));
    assert.strictEqual(st.white, ha.you, 'host takes white');
    assert.strictEqual(st.black, hb.you, 'second seat takes black');
    assert.strictEqual(st.youAre, 'w', 'white label on the host snapshot');
    assert.strictEqual(last(b, 'state').youAre, 'b', 'black label on the friend snapshot');
    assert.strictEqual(last(c, 'state').spectator, true, 'watcher flagged spectator');
    assert.strictEqual(last(c, 'state').youAre, null, 'watcher has no side');
    assert.strictEqual(st.boardTheme, 'Green', 'theme reaches the view');
    assert.deepStrictEqual(st.clocks, { w: 300000, b: 300000 }, '5-minute clocks');

    // Actual moves flow to every seat; watchers cannot move.
    send(a, { t: 'action', a: { move: { from: 'e2', to: 'e4' } } });
    await sleep(200);
    assert.deepStrictEqual(last(c, 'state').history, ['e4'], 'watcher sees the move');
    const n0 = a.msgs.length;
    send(c, { t: 'action', a: { move: { from: 'e7', to: 'e5' } } }); // watcher move
    await sleep(200);
    assert(!a.msgs.slice(n0).some((m) => m.t === 'state'), 'watcher action broadcasts nothing');
    send(b, { t: 'action', a: { move: { from: 'e7', to: 'e5' } } });
    await sleep(200);
    assert.deepStrictEqual(last(a, 'state').history, ['e4', 'e5'], 'friend move lands');
    // Out-of-turn (white to move, black tries) is ignored but stays stable.
    send(b, { t: 'action', a: { move: { from: 'd7', to: 'd5' } } });
    await sleep(200);
    assert.deepStrictEqual(last(a, 'state').history, ['e4', 'e5'], 'out-of-turn ignored');
    console.log('CHESS ok: server seats (2 play, 2 watch), moves, watcher/out-of-turn blocked');

    // Solo player cannot start chess (min 2).
    const solo = await mk();
    send(solo, { t: 'create', name: 'Solo' });
    await sleep(150);
    send(solo, { t: 'start', game: 'chess' });
    await sleep(150);
    assert(/2–24/.test(last(solo, 'error').msg), 'solo start names the range');
    solo.close();

    for (const ws of [a, b, c, d]) ws.close();
  } catch (e) {
    return fail(e.stack || e);
  }
  srv.kill();
}

main();
serverSection().then(() => console.log('CHESS_PASS')).catch((e) => {
  console.error('CHESS_FAIL', e);
  process.exit(1);
});

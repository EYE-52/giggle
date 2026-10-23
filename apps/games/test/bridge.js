'use strict';
/* Bridge + hardening tests: HTTP malformed/traversal/sibling-prefix,
 * moved-socket semantics, Giggle ticket verification (valid, tamper,
 * expiry, exact 90s window, replay incl. fail-closed overflow, wrong
 * audience/issuer/alg), private room isolation, ack freshness (nonce echo
 * on success only), same-name seats,
 * renew/reconnect lease, claims.exp-bound expiry, expired-lease denial,
 * seat-takeover codes, full-room/malformed-name preservation, WS origin
 * gate, embed origin trust + postMessage validation, and UI-batch static
 * checks. Boots scratch servers; no browser needed.
 * Run: npm run test:bridge */
const { spawn } = require('child_process');
const assert = require('assert');
const fs = require('fs');
const net = require('net');
const path = require('path');
const WebSocket = require('ws');

const ROOT = path.join(__dirname, '..');
const PORT = 18235;
const LEASE_PORT = 18236;
const EXP_PORT = 18237;
const SECRET = 'test-bridge-secret-0123456789abcdef-0123456789';
const ORIGINS = 'http://127.0.0.1:4012,https://gigglemeet.com';

const bridge = require('../server/bridge');
const { Rooms, validJoinName, SEAT_REPLACED_CODE } = require('../server/room');
const { LIMITS } = require('../games/_validate');

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

let children = [];
async function boot(port, extraEnv) {
  const srv = spawn('node', ['server/server.js'], {
    cwd: ROOT,
    env: {
      ...process.env, PORT: String(port), HOST: '127.0.0.1',
      GAME_BRIDGE_SECRET: SECRET, GIGGLE_ALLOWED_ORIGINS: ORIGINS,
      ...extraEnv,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(srv);
  let out = '';
  srv.stdout.on('data', (d) => { out += d; });
  srv.stderr.on('data', (d) => { out += d; });
  for (let i = 0; i < 50 && !out.includes('PartyBox on'); i++) await sleep(100);
  assert(out.includes('PartyBox on'), `server did not boot on ${port}: ${out}`);
  return { srv, out: () => out };
}

function fail(sockets, logs, msg) {
  console.error('BRIDGE_FAIL', msg, '\n--- server logs ---\n' + logs.map((l) => l()).join('\n'));
  for (const s of sockets) try { s.close(); } catch {}
  for (const c of children) try { c.kill(); } catch {}
  process.exit(1);
}

/* Raw HTTP over a socket (no client-side path normalization/validation). */
function rawGet(port, target) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(port, '127.0.0.1', () => {
      sock.write(`GET ${target} HTTP/1.0\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n`);
    });
    let data = '';
    sock.on('data', (d) => { data += d.toString('latin1'); });
    sock.on('end', () => resolve(data));
    sock.on('error', reject);
  });
}

function statusOf(res) {
  const m = /^HTTP\/\d[\d.]* (\d+)/.exec(res);
  return m ? Number(m[1]) : -1;
}

async function main() {
  const logs = [];
  const sockets = [];
  const die = (msg) => fail(sockets, logs, msg);

  /* ---- A. ticket verification matrix (no server) ---- */
  bridge.resetBridgeForTests();
  const good = bridge.mintTicket({ sub: 'u1', squadId: 'sq1', displayName: 'Ann' }, SECRET);
  let v = bridge.verifyTicket(good, { secret: SECRET });
  assert(!v.error && v.claims.sub === 'u1' && v.claims.squadId === 'sq1', 'valid ticket verifies');
  assert(v.claims.exp - v.claims.iat === 90, 'ticket window is 90s');

  const tampered = good.slice(0, -2) + (good.endsWith('aa') ? 'bb' : 'aa');
  assert.equal(bridge.verifyTicket(tampered, { secret: SECRET }).error, 'bad-signature', 'tampered rejected');
  const expired = bridge.mintTicket({ sub: 'u1', squadId: 'sq1', exp: Math.floor(Date.now() / 1000) - 5 }, SECRET);
  assert.equal(bridge.verifyTicket(expired, { secret: SECRET }).error, 'expired', 'expired rejected');
  assert.equal(bridge.verifyTicket(bridge.mintTicket({ aud: 'someone-else' }, SECRET), { secret: SECRET }).error,
    'bad-audience', 'wrong audience rejected');
  assert.equal(bridge.verifyTicket(bridge.mintTicket({ iss: 'impostor' }, SECRET), { secret: SECRET }).error,
    'bad-issuer', 'wrong issuer rejected');
  assert.equal(bridge.verifyTicket(bridge.mintTicket({ alg: 'none' }, SECRET), { secret: SECRET }).error,
    'bad-alg', 'alg=none rejected');
  assert.equal(bridge.verifyTicket('x'.repeat(5000), { secret: SECRET }).error, 'bad-shape', 'oversize rejected');
  assert.equal(bridge.verifyTicket('not.a.jwt.at.all', { secret: SECRET }).error, 'bad-shape', 'malformed rejected');
  assert.equal(bridge.verifyTicket(good, { secret: 'short' }).error, 'bridge-disabled', 'short secret disables bridge');
  // EXACT 90s window: forged long TTLs are rejected even when signed.
  const winNow = Math.floor(Date.now() / 1000);
  assert.equal(bridge.verifyTicket(bridge.mintTicket({ iat: winNow, exp: winNow + 120 }, SECRET), { secret: SECRET }).error,
    'bad-window', '120s ticket rejected');
  assert.equal(bridge.verifyTicket(bridge.mintTicket({ iat: winNow, exp: winNow + 91 }, SECRET), { secret: SECRET }).error,
    'bad-window', '91s ticket rejected');
  assert(!bridge.verifyTicket(bridge.mintTicket({ iat: winNow, exp: winNow + 90 }, SECRET), { secret: SECRET }).error,
    '90s ticket accepted');
  // Single-use: first consume ok, replay rejected.
  const once = bridge.mintTicket({ sub: 'u9', squadId: 'sq9' }, SECRET);
  assert(!bridge.consumeTicket(once, { secret: SECRET }).error, 'first consume ok');
  assert.equal(bridge.consumeTicket(once, { secret: SECRET }).error, 'replayed', 'replay rejected');
  // FAIL CLOSED at capacity: the first consumed token stays rejected after
  // an over-capacity batch, the size is bounded immediately, and new
  // tickets get a distinct capacity error (never evict unexpired jtis).
  const first = bridge.mintTicket({ sub: 'first', squadId: 'sq-first' }, SECRET);
  assert(!bridge.consumeTicket(first, { secret: SECRET }).error, 'first token consumed');
  let sawCapacity = false;
  for (let i = 0; i < bridge.MAX_REPLAY_ENTRIES + 100; i++) {
    const r = bridge.consumeTicket(bridge.mintTicket({ sub: 'flood' }, SECRET), { secret: SECRET });
    if (r.error === 'capacity') sawCapacity = true;
    else assert(!r.error, 'flood consume ok until full');
  }
  assert(sawCapacity, 'full cache rejects new tickets (fail closed)');
  assert.equal(bridge.replayCacheSizeForTests(), bridge.MAX_REPLAY_ENTRIES, 'replay cache exactly bounded immediately');
  assert.equal(bridge.consumeTicket(first, { secret: SECRET }).error, 'replayed', 'first token still replayed after overflow');
  assert.equal(bridge.consumeTicket(bridge.mintTicket({ sub: 'late' }, SECRET), { secret: SECRET }).error,
    'capacity', 'still full for newer tickets');
  // Expiry frees capacity: with time advanced past every entry, a fresh
  // ticket consumes fine and the cache prunes to live entries only.
  const futMs = Date.now() + 200000;
  const futS = Math.floor(futMs / 1000);
  const after = bridge.mintTicket({ iat: futS - 10, exp: futS + 80 }, SECRET);
  assert(!bridge.consumeTicket(after, { secret: SECRET, nowMs: futMs }).error, 'expiry frees capacity');
  assert(bridge.replayCacheSizeForTests() < 10, 'pruned to live entries only');
  assert.deepEqual(bridge.parseAllowedOrigins(' https://a.test, http://127.0.0.1:4012 ,,notaurl,https://a.test ', { allowHttp: true }),
    ['https://a.test', 'http://127.0.0.1:4012'], 'allowed origins parsed strictly');
  assert.deepEqual(bridge.parseAllowedOrigins('https://a.test, http://127.0.0.1:4012', { allowHttp: false }),
    ['https://a.test'], 'http origins dropped when disallowed (production)');
  assert.equal(bridge.allowHttpOrigins({ NODE_ENV: 'production' }), false, 'production denies http origins');
  assert.equal(bridge.allowHttpOrigins({ NODE_ENV: 'development' }), true, 'development allows http origins');
  assert.equal(SEAT_REPLACED_CODE, 4001, 'seat-taken close code is application-scoped');
  assert.equal(bridge.MAX_NONCE_CHARS, 128, 'nonce bound is 128 chars');
  assert(bridge.isValidBridgeNonce('auth-1'), 'valid nonce accepted');
  assert(!bridge.isValidBridgeNonce(''), 'empty nonce rejected');
  assert(!bridge.isValidBridgeNonce('x'.repeat(129)), 'oversize nonce rejected');
  assert(!bridge.isValidBridgeNonce(42), 'non-string nonce rejected');
  assert(!bridge.isValidBridgeNonce(null), 'missing nonce rejected');
  console.log('BRIDGE ok: ticket matrix + exact 90s + fail-closed replay + origins + nonce bounds');
  bridge.resetBridgeForTests();

  /* ---- A2. room preflights + name guard (no server) ---- */
  assert(validJoinName('Ann') && validJoinName(undefined) && validJoinName(null), 'string/missing names valid');
  assert(!validJoinName(JSON.parse('{"toString":null}')), 'hostile name object rejected');
  assert(!validJoinName(42) && !validJoinName(['x']), 'non-string names rejected');
  const unitRooms = new Rooms({});
  const unitRoom = unitRooms.create();
  const fakeSock = () => ({ readyState: 1, send() {}, close() {} });
  assert(!unitRoom.preflightAdd().error, 'space preflights ok');
  for (let i = 0; i < LIMITS.ROOM_CAP; i++) unitRoom.addPlayer('P' + i, fakeSock());
  assert.equal(unitRoom.preflightAdd().error, 'Room is full.', 'full room preflights full');
  assert(unitRoom.preflightAdd(unitRoom.players[0].token).resume === true, 'token resume preflights ok when full');
  const unitGiggle = unitRooms.getOrCreateGiggle('sq-unit');
  assert(!unitGiggle.preflightGiggle('new-sub').error, 'giggle space preflights ok');
  for (let i = 0; i < LIMITS.ROOM_CAP; i++) unitGiggle.addGigglePlayer('gsub-' + i, 'G', fakeSock());
  assert.equal(unitGiggle.preflightGiggle('another-sub').error, 'Room is full.', 'giggle full preflights full');
  assert(unitGiggle.preflightGiggle('gsub-0').resume === true, 'giggle resume preflights ok when full');
  console.log('BRIDGE ok: preflights + name guard');

  /* ---- B. HTTP hardening ---- */
  const main1 = await boot(PORT, {});
  logs.push(main1.out);

  let res = await rawGet(PORT, '/%E0%A4%A');
  assert.equal(statusOf(res), 400, 'malformed encoding -> 400');
  res = await rawGet(PORT, '/');
  assert.equal(statusOf(res), 200, 'server survives malformed request');
  res = await rawGet(PORT, '/..%2Fpackage.json');
  assert.equal(statusOf(res), 404, 'traversal -> 404');
  // Public-sibling prefix: startsWith(PUBLIC) would serve this; the relative
  // check must 404 even though the file exists.
  const evilDir = path.join(ROOT, 'public-evil-tmp');
  fs.mkdirSync(evilDir, { recursive: true });
  fs.writeFileSync(path.join(evilDir, 'marker.txt'), 'sibling-secret');
  try {
    res = await rawGet(PORT, '/../public-evil-tmp/marker.txt');
    assert.equal(statusOf(res), 404, 'public-sibling prefix -> 404');
    assert(!res.includes('sibling-secret'), 'sibling content never leaks');
  } finally {
    fs.rmSync(evilDir, { recursive: true, force: true });
  }
  res = await rawGet(PORT, '/r/AB12');
  assert.equal(statusOf(res), 200, 'client route serves shell');
  res = await rawGet(PORT, '/config.json');
  assert.equal(statusOf(res), 200, '/config.json serves');
  const body = res.slice(res.indexOf('\r\n\r\n') + 4);
  const cfg = JSON.parse(body);
  assert.equal(cfg.bridgeVersion, 'giggle-v1', 'config carries bridge version');
  assert.equal(cfg.giggleEnabled, true, 'config reflects enabled bridge');
  assert(cfg.giggleAllowedOrigins.includes('https://gigglemeet.com'), 'config lists origins');
  assert.equal(cfg.allowHttp, process.env.NODE_ENV !== 'production', 'config exposes allowHttp for this env');
  assert(!body.includes(SECRET), 'config leaks no secret');
  assert(res.includes('frame-ancestors') && res.includes("'self'") && res.includes('https://gigglemeet.com'),
    'frame-ancestors allow self + giggle origins');
  console.log('BRIDGE ok: HTTP 400/traversal/sibling/config/framing');

  /* ---- WS helpers ---- */
  const mk = (port, origin) => new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`, origin ? { origin } : undefined);
    ws.msgs = [];
    ws.on('message', (d) => ws.msgs.push(JSON.parse(d)));
    ws.on('open', () => { sockets.push(ws); resolve(ws); });
    ws.on('error', reject);
  });
  const send = (ws, o) => ws.send(JSON.stringify(o));
  const last = (ws, t) => [...ws.msgs].reverse().find((m) => m.t === t);
  const hellos = (ws) => ws.msgs.filter((m) => m.t === 'hello');

  // Origin gate: unrelated cross-origin sockets are refused.
  await assert.rejects(mk(PORT, 'http://evil.test'), /403/, 'foreign origin rejected');
  const sameHost = await mk(PORT, `http://127.0.0.1:${PORT}`);
  sameHost.close();
  console.log('BRIDGE ok: WS origin gate');

  /* ---- C. moved-socket semantics ---- */
  const a = await mk(PORT);
  const b = await mk(PORT);
  send(a, { t: 'create', name: 'Ann' });
  await sleep(150);
  const room1 = last(a, 'room').room.code;
  send(b, { t: 'join', name: 'Bob', code: room1 });
  await sleep(150);
  assert.equal(last(b, 'room').room.hostId, last(a, 'hello').you, 'first seated hosts room1');
  const countA = a.msgs.length;
  // A moves to a new room: old room must drop A and migrate host to B.
  send(a, { t: 'create', name: 'Ann' });
  await sleep(200);
  const room2 = last(a, 'room').room.code;
  assert.notEqual(room1, room2, 'second room differs');
  const bView = last(b, 'room').room;
  assert.equal(bView.players.filter((p) => p.connected).length, 1, 'A left room1');
  assert.equal(bView.hostId, last(b, 'hello').you, 'host migrated to B');
  // Trigger a room1 broadcast; A must receive no more room1 data.
  const c = await mk(PORT);
  send(c, { t: 'join', name: 'Cat', code: room1 });
  await sleep(200);
  const aAfter = a.msgs.slice(countA);
  assert(!aAfter.some((m) => m.t === 'room' && m.room.code === room1), 'moved socket gets no old-room data');
  assert(!aAfter.some((m) => m.t === 'state'), 'moved socket gets no old-room state');
  // Same-room rejoin is idempotent (no duplicate seat).
  const before = last(a, 'room').room.players.length;
  send(a, { t: 'join', name: 'Ann', code: room2 });
  await sleep(150);
  assert.equal(hellos(a).length, 3, 'rejoin answers hello');
  assert.equal(last(a, 'room').room.players.length, before, 'no duplicate seat on same-room rejoin');
  // Failed join leaves the current room untouched.
  send(a, { t: 'join', name: 'Ann', code: 'ZZZZ' });
  await sleep(150);
  assert(last(a, 'error'), 'bad code errors');
  const d = await mk(PORT);
  send(d, { t: 'join', name: 'Dan', code: room2 });
  await sleep(200);
  assert.equal(last(a, 'room').room.code, room2, 'still attached after failed join');
  // Anonymous token reclaim replaces distinctly (single active seat).
  const dTok = last(d, 'hello').seatToken;
  const dSeat = last(d, 'hello').you;
  const d2 = await mk(PORT);
  let dCode = null;
  d.on('close', (code) => { dCode = code; });
  send(d2, { t: 'join', name: 'Dan', code: room2, seatToken: dTok });
  await sleep(200);
  assert.equal(last(d2, 'hello').you, dSeat, 'token reclaim resumes seat');
  assert.equal(dCode, SEAT_REPLACED_CODE, 'reclaimed socket closed with seat-taken code');
  console.log('BRIDGE ok: moved sockets, same-room idempotence, failed-join safety, token takeover');

  /* ---- C2. full-room + malformed-name preservation (real sockets) ---- */
  const fa = await mk(PORT);
  send(fa, { t: 'create', name: 'Keeper' });
  await sleep(150);
  const keepRoom = last(fa, 'hello').code;
  const keepSeat = last(fa, 'hello').you;
  // Fill a DIFFERENT room to capacity.
  const f0 = await mk(PORT);
  send(f0, { t: 'create', name: 'Seed' });
  await sleep(150);
  const fullRoom = last(f0, 'hello').code;
  for (let i = 1; i < LIMITS.ROOM_CAP; i++) {
    const w = await mk(PORT);
    send(w, { t: 'join', name: 'F' + i, code: fullRoom });
  }
  await sleep(500);
  // The full target errors and the socket's own room/host stay intact.
  send(fa, { t: 'join', name: 'Keeper', code: fullRoom });
  await sleep(150);
  assert(last(fa, 'error') && /full/i.test(last(fa, 'error').msg), 'full target errors');
  const proof = await mk(PORT);
  send(proof, { t: 'join', name: 'Proof', code: keepRoom });
  await sleep(200);
  assert.equal(last(fa, 'room').room.code, keepRoom, 'still in original room after full-room failure');
  assert.equal(last(fa, 'room').room.hostId, keepSeat, 'host intact after full-room failure');
  // Malformed names/codes are rejected before create/detach: no new seat,
  // no leaked room join, original attachment untouched.
  const hellosBefore = hellos(fa).length;
  const hostile = () => JSON.parse('{"toString":null}');
  send(fa, { t: 'create', name: hostile() });
  await sleep(150);
  assert(last(fa, 'error'), 'malformed create name rejected');
  assert.equal(hellos(fa).length, hellosBefore, 'malformed create grants no seat');
  send(fa, { t: 'join', name: hostile(), code: keepRoom });
  await sleep(150);
  assert(last(fa, 'error'), 'malformed join name rejected');
  send(fa, { t: 'join', name: 'Keeper', code: hostile() });
  await sleep(150);
  assert(last(fa, 'error'), 'malformed join code rejected');
  assert.equal(hellos(fa).length, hellosBefore, 'malformed joins grant no seat');
  const proof2 = await mk(PORT);
  send(proof2, { t: 'join', name: 'Proof2', code: keepRoom });
  await sleep(200);
  assert.equal(last(fa, 'room').room.code, keepRoom, 'still attached after malformed names');
  assert.equal(last(fa, 'room').room.hostId, keepSeat, 'host intact after malformed names');
  console.log('BRIDGE ok: full-room + malformed-name preservation');

  /* ---- D. Giggle bridge ---- */
  const ticketFor = (o) => bridge.mintTicket({ squadId: 'sq-alpha', ...o }, SECRET);
  const g1 = await mk(PORT);
  send(g1, { t: 'giggleJoin', ticket: ticketFor({ sub: 'u-ann', displayName: 'Ann' }) });
  await sleep(150);
  const h1 = last(g1, 'hello');
  assert(h1 && h1.giggle === true, 'giggle join answers hello');
  assert(!h1.seatToken, 'giggle hello carries no legacy seat token');
  const gCode = h1.code;
  // Same sub reconnects on a new socket: same seat id, old socket dropped
  // with the distinct seat-taken code (no auto-reconnect fight).
  const g1b = await mk(PORT);
  let g1Closed = false;
  let g1Code = null;
  g1.on('close', (code) => { g1Closed = true; g1Code = code; });
  send(g1b, { t: 'giggleJoin', ticket: ticketFor({ sub: 'u-ann', displayName: 'Ann' }) });
  await sleep(200);
  assert.equal(last(g1b, 'hello').you, h1.you, 'reconnect resumes same seat id');
  assert(g1Closed, 'stale giggle socket dropped');
  assert.equal(g1Code, SEAT_REPLACED_CODE, 'stale socket closed with seat-taken code');
  // Same display name, different sub: distinct seats, deduped names.
  const g2 = await mk(PORT);
  send(g2, { t: 'giggleJoin', ticket: ticketFor({ sub: 'u-ann-2', displayName: 'Ann' }) });
  await sleep(150);
  const h2 = last(g2, 'hello');
  assert.notEqual(h2.you, h1.you, 'same-name users get distinct seats');
  assert.equal(last(g2, 'room').room.code, gCode, 'same squad lands in same room');
  const names = last(g2, 'room').room.players.map((p) => p.name).sort();
  assert(names.includes('Ann') && names.some((n) => n !== 'Ann' && n.startsWith('Ann')), `names deduped: ${names}`);
  // Renew with a fresh ticket keeps the seat.
  send(g2, { t: 'giggleRenew', ticket: ticketFor({ sub: 'u-ann-2', displayName: 'Ann' }) });
  await sleep(150);
  assert.equal(last(g2, 'hello').you, h2.you, 'renew keeps seat');
  // Freshness correlation: a validated request nonce is echoed in the
  // success hello; the renew echo supersedes the join echo. A separate
  // squad keeps sq-alpha's seat counts below intact.
  const nonceTicket = (o) => ticketFor({ squadId: 'sq-nonce', ...o });
  const gN = await mk(PORT);
  send(gN, { t: 'giggleJoin', ticket: nonceTicket({ sub: 'u-nonce', displayName: 'Non' }), n: 'auth-1' });
  await sleep(150);
  const hN1 = last(gN, 'hello');
  assert(hN1 && hN1.n === 'auth-1', 'join echoes the validated nonce');
  const seatN = hN1.you;
  send(gN, { t: 'giggleRenew', ticket: nonceTicket({ sub: 'u-nonce', displayName: 'Non' }), n: 'auth-2' });
  await sleep(150);
  const hN2 = last(gN, 'hello');
  assert.equal(hN2.you, seatN, 'renew keeps the seat');
  assert.equal(hN2.n, 'auth-2', 'renew echoes the NEW nonce (auth-1 superseded)');
  // Ticket-only fixtures stay compatible: verified, but no echo.
  const gBare = await mk(PORT);
  send(gBare, { t: 'giggleJoin', ticket: nonceTicket({ sub: 'u-bare', displayName: 'Bare' }) });
  await sleep(150);
  const hBare = last(gBare, 'hello');
  assert(hBare, 'ticket-only join still verifies');
  assert(!('n' in hBare), 'ticket-only hello carries no echo');
  // Invalid ids never breach the ack chain: the ticket still decides the
  // join, but nothing is echoed for the child to ack with.
  for (const [label, badN] of [['empty', ''], ['oversize', 'x'.repeat(200)], ['non-string', 42]]) {
    const w = await mk(PORT);
    send(w, { t: 'giggleJoin', ticket: nonceTicket({ sub: 'u-badn-' + label, displayName: 'Bad' }), n: badN });
    await sleep(120);
    const hBad = last(w, 'hello');
    assert(hBad, `${label} nonce still joins (ticket decides)`);
    assert(!('n' in hBad), `${label} nonce never echoed`);
  }
  // Error paths echo nothing, even with a valid id attached.
  const wErr = await mk(PORT);
  send(wErr, { t: 'giggleJoin', ticket: tampered, n: 'auth-err-1' });
  await sleep(120);
  const eErr = last(wErr, 'error');
  assert(eErr, 'bad ticket rejected');
  assert(!('n' in eErr), 'ticket failure echoes nothing');
  // Same socket, same squad, NEW verified sub: the old seat detaches BEFORE
  // the new one attaches (one socket never owns two seats).
  send(g2, { t: 'giggleJoin', ticket: ticketFor({ sub: 'u-ann-3', displayName: 'Ann' }) });
  await sleep(200);
  const hNew = last(g2, 'hello');
  assert.notEqual(hNew.you, h2.you, 'new sub gets a new seat on the same socket');
  const switched = last(g2, 'room').room;
  const oldSeat = switched.players.find((p) => p.id === h2.you);
  const newSeat = switched.players.find((p) => p.id === hNew.you);
  assert(oldSeat && oldSeat.connected === false, 'old seat detached, not double-owned');
  assert(newSeat && newSeat.connected === true, 'new seat connected');
  assert.equal(switched.players.filter((p) => p.connected).length, 2, 'no duplicate connected seats');
  assert.equal(switched.hostId, h1.you, 'host stable across the sub switch');
  // Explicit single-active-seat: a new socket for the same sub replaces
  // with 4001, the old close never marks the new seat disconnected, and a
  // deliberate re-takeover stabilizes instead of fighting.
  let g2Code = null;
  g2.on('close', (code) => { g2Code = code; });
  const g2b = await mk(PORT);
  send(g2b, { t: 'giggleJoin', ticket: ticketFor({ sub: 'u-ann-3', displayName: 'Ann' }) });
  await sleep(200);
  assert.equal(last(g2b, 'hello').you, hNew.you, 'takeover resumes same seat');
  assert.equal(g2Code, SEAT_REPLACED_CODE, 'replaced socket closed with seat-taken code');
  await sleep(150);
  assert(last(g2b, 'room').room.players.find((p) => p.id === hNew.you).connected === true,
    'new seat stays connected after the old close');
  let g2bCode = null;
  g2b.on('close', (code) => { g2bCode = code; });
  const g2c = await mk(PORT);
  send(g2c, { t: 'giggleJoin', ticket: ticketFor({ sub: 'u-ann-3', displayName: 'Ann' }) });
  await sleep(200);
  assert.equal(g2bCode, SEAT_REPLACED_CODE, 'second takeover also distinct');
  assert.equal(last(g2c, 'hello').you, hNew.you, 'deliberate re-takeover keeps the seat');
  // Anonymous joins to the private room are rejected.
  const anon = await mk(PORT);
  send(anon, { t: 'join', name: 'Sneaky', code: gCode });
  await sleep(150);
  assert(last(anon, 'error'), 'anonymous join to giggle room rejected');
  assert(!hellos(anon).length, 'sneaky gets no seat');
  // A different squad gets a different room.
  const g3 = await mk(PORT);
  send(g3, { t: 'giggleJoin', ticket: ticketFor({ sub: 'u-bob', squadId: 'sq-beta', displayName: 'Bob' }) });
  await sleep(150);
  assert.notEqual(last(g3, 'hello').code, gCode, 'squads are isolated');
  // Giggle full room: the failed target join errors and the socket keeps
  // its original room/seat (preflight runs before any detach).
  const sqFull = 'sq-full-' + Date.now().toString(36);
  for (let i = 0; i < LIMITS.ROOM_CAP; i++) {
    const w = await mk(PORT);
    send(w, { t: 'giggleJoin', ticket: bridge.mintTicket({ sub: 'fill-' + i, squadId: sqFull, displayName: 'F' + i }, SECRET) });
  }
  await sleep(600);
  send(g3, { t: 'giggleJoin', ticket: ticketFor({ sub: 'u-bob', squadId: sqFull, displayName: 'Bob' }) });
  await sleep(150);
  const g3full = last(g3, 'error');
  assert(g3full && g3full.code === 'ROOM_FULL', 'giggle full room errors ROOM_FULL');
  const beta2 = await mk(PORT);
  send(beta2, { t: 'giggleJoin', ticket: ticketFor({ sub: 'u-beta2', squadId: 'sq-beta', displayName: 'Beta2' }) });
  await sleep(200);
  assert(last(g3, 'room').room.players.some((p) => p.name.includes('Beta2')),
    'giggle socket kept its original room after the full-room failure');
  // Ticket failures: tampered, expired, replayed, wrong aud/iss.
  const badCases = [
    ['tampered', tampered],
    ['expired', expired],
    ['wrong-aud', bridge.mintTicket({ aud: 'nope' }, SECRET)],
    ['wrong-iss', bridge.mintTicket({ iss: 'nope' }, SECRET)],
  ];
  for (const [label, ticket] of badCases) {
    const w = await mk(PORT);
    send(w, { t: 'giggleJoin', ticket });
    await sleep(120);
    assert(last(w, 'error'), `${label} ticket rejected`);
    assert(!hellos(w).length, `${label} gets no seat`);
  }
  // Single-use on the server: the same ticket twice — second join rejected.
  const twice = ticketFor({ sub: 'u-twice', displayName: 'Twyla' });
  const w1 = await mk(PORT);
  send(w1, { t: 'giggleJoin', ticket: twice });
  await sleep(150);
  assert(last(w1, 'hello'), 'first use accepted');
  const w2 = await mk(PORT);
  send(w2, { t: 'giggleJoin', ticket: twice });
  await sleep(150);
  assert(last(w2, 'error') && last(w2, 'error').code === 'TICKET_REPLAYED', 'replayed ticket rejected');
  assert(!hellos(w2).length, 'replay gets no seat');
  console.log('BRIDGE ok: giggle join/resume/switch/takeover/isolation/full-room/ticket failures');

  /* ---- E. lease expiry (short-lease server) ---- */
  const short = await boot(LEASE_PORT, { GIGGLE_LEASE_MS: '1200' });
  logs.push(short.out);
  const mkLease = () => mk(LEASE_PORT);
  const e1 = await mkLease();
  send(e1, { t: 'giggleJoin', ticket: ticketFor({ sub: 'u-lease', displayName: 'Lee' }) });
  await sleep(150);
  assert(last(e1, 'hello'), 'lease server joins');
  // Renew before expiry extends the lease: still authorized afterwards.
  await sleep(800);
  send(e1, { t: 'giggleRenew', ticket: ticketFor({ sub: 'u-lease', displayName: 'Lee' }) });
  await sleep(800);
  const markE1 = e1.msgs.length;
  send(e1, { t: 'lobby' });
  await sleep(200);
  assert(e1.msgs.slice(markE1).some((m) => m.t === 'room'), 'renewed lease allows actions');
  // Let it expire: actions denied, socket disconnected, no room data after.
  await sleep(900);
  const markExp = e1.msgs.length;
  let e1Closed = false;
  e1.on('close', () => { e1Closed = true; });
  send(e1, { t: 'lobby' });
  await sleep(300);
  const tail = e1.msgs.slice(markExp);
  assert(tail.some((m) => m.t === 'error' && m.code === 'LEASE_EXPIRED'), 'expired lease denied');
  assert(!tail.some((m) => m.t === 'room' || m.t === 'state'), 'expired socket gets no room data');
  for (let i = 0; i < 70 && !e1Closed; i++) await sleep(100);
  assert(e1Closed, 'expired socket disconnected until freshly authorized');
  // Fresh ticket after expiry resumes the SAME seat.
  const seatBefore = last(e1, 'hello').you;
  const e2 = await mkLease();
  send(e2, { t: 'giggleJoin', ticket: ticketFor({ sub: 'u-lease', displayName: 'Lee' }) });
  await sleep(200);
  assert.equal(last(e2, 'hello').you, seatBefore, 'post-expiry ticket resumes seat');
  console.log('BRIDGE ok: lease renew/expiry/deny/disconnect/resume');

  /* ---- E2. lease bound to claims.exp (no test override) ---- */
  const expSrv = await boot(EXP_PORT, {});
  logs.push(expSrv.out);
  const mkExp = () => mk(EXP_PORT);
  // A ticket consumed near its expiry buys NO extra time: actions are
  // allowed while unexpired, then denied and disconnected at claims.exp.
  const x1 = await mkExp();
  const x0 = Math.floor(Date.now() / 1000);
  send(x1, { t: 'giggleJoin', ticket: bridge.mintTicket({ sub: 'u-near', squadId: 'sq-exp', displayName: 'Neary', iat: x0, exp: x0 + 3 }, SECRET) });
  await sleep(150);
  assert(last(x1, 'hello'), 'near-expiry join accepted while valid');
  send(x1, { t: 'lobby' });
  await sleep(200);
  assert(last(x1, 'room'), 'action allowed before claims.exp');
  await sleep(3500);
  let x1Closed = false;
  x1.on('close', () => { x1Closed = true; });
  const markX = x1.msgs.length;
  send(x1, { t: 'lobby' });
  await sleep(300);
  const tailX = x1.msgs.slice(markX);
  assert(tailX.some((m) => m.t === 'error' && m.code === 'LEASE_EXPIRED'), 'lease denied exactly at claims.exp');
  assert(!tailX.some((m) => m.t === 'room' || m.t === 'state'), 'no room data past claims.exp');
  for (let i = 0; i < 70 && !x1Closed; i++) await sleep(100);
  assert(x1Closed, 'near-expiry socket disconnected at claims.exp');
  // Continuous renew keeps the IDENTICAL websocket/seat past the old
  // ticket's expiry (no leave/rejoin cycle).
  const y1 = await mkExp();
  const y0 = Math.floor(Date.now() / 1000);
  send(y1, { t: 'giggleJoin', ticket: bridge.mintTicket({ sub: 'u-cont', squadId: 'sq-cont', displayName: 'Conti', iat: y0, exp: y0 + 4 }, SECRET) });
  await sleep(150);
  const seatCont = last(y1, 'hello').you;
  await sleep(1000);
  send(y1, { t: 'giggleRenew', ticket: bridge.mintTicket({ sub: 'u-cont', squadId: 'sq-cont', displayName: 'Conti' }, SECRET) });
  await sleep(150);
  assert.equal(last(y1, 'hello').you, seatCont, 'continuous renew keeps seat');
  await sleep(4500); // past the FIRST ticket's expiry
  assert.equal(y1.readyState, 1, 'same websocket still open past old expiry');
  const markY = y1.msgs.length;
  send(y1, { t: 'lobby' });
  await sleep(200);
  assert(y1.msgs.slice(markY).some((m) => m.t === 'room'), 'renewed lease allows actions past old expiry');
  console.log('BRIDGE ok: lease bound to claims.exp, near-expiry deny, continuous renew same socket');

  /* ---- F. embed postMessage validation (exact ESM bytes via data URL) ---- */
  const embedSrc = fs.readFileSync(path.join(ROOT, 'public/js/embed.js'), 'utf8');
  const embed = await import('data:text/javascript;base64,' + Buffer.from(embedSrc).toString('base64'));
  assert.deepEqual(embed.parseEmbedParams('?embed=1&parentOrigin=' + encodeURIComponent('https://gigglemeet.com')),
    { enabled: true, parentOrigin: 'https://gigglemeet.com' }, 'embed params parse');
  assert.equal(embed.parseEmbedParams('?embed=1').enabled, false, 'embed needs origin');
  assert.equal(embed.parseEmbedParams('').enabled, false, 'standalone by default');
  // Shape says nothing about trust: any well-formed http(s) origin parses.
  assert(embed.isValidParentOrigin('https://gigglemeet.com'), 'https shape ok');
  assert(embed.isValidParentOrigin('http://127.0.0.1:4012'), 'http loopback shape ok');
  assert(embed.isValidParentOrigin('http://divyanshs-mac-mini:4012'), 'http tailnet shape ok');
  assert(!embed.isValidParentOrigin('https://user@gigglemeet.com'), 'credentials rejected');
  assert(!embed.isValidParentOrigin('ftp://x.test'), 'non-http rejected');
  // Trust needs the EXACT configured origin; http only where allowed (dev).
  const devCfg = ['http://127.0.0.1:4012', 'http://divyanshs-mac-mini:4012'];
  assert(embed.isTrustedParentOrigin('http://divyanshs-mac-mini:4012', devCfg, true),
    'configured tailnet origin trusted in dev');
  assert(embed.isTrustedParentOrigin('http://127.0.0.1:4012', devCfg, true),
    'configured loopback trusted in dev');
  assert(!embed.isTrustedParentOrigin('http://divyanshs-mac-mini:4012', devCfg, false),
    'http denied where the server disallows it (production)');
  assert(!embed.isTrustedParentOrigin('http://evil.test:4012', devCfg, true),
    'unconfigured http origin untrusted');
  assert(embed.isTrustedParentOrigin('https://gigglemeet.com', ['https://gigglemeet.com'], false),
    'configured https trusted even in production');
  assert(!embed.isTrustedParentOrigin('https://evil.test', ['https://gigglemeet.com'], true),
    'unconfigured https untrusted');
  assert(!embed.isTrustedParentOrigin('https://user@gigglemeet.com', ['https://user@gigglemeet.com'], true),
    'credentialed origin never trusted');
  const parentWin = { id: 'parent' };
  const otherWin = { id: 'other-frame' };
  let authed = null;
  let authedNonce = null;
  let contexted = null;
  const posted = [];
  const child = embed.createChildBridge({
    expectedOrigin: 'https://gigglemeet.com',
    postFn: (env, origin) => { posted.push([env, origin]); },
    onAuth: (t, n) => { authed = t; authedNonce = n; },
    onContext: (c) => { contexted = c; },
  });
  assert(embed.isValidNonce('auth-1'), 'valid nonce accepted');
  assert(!embed.isValidNonce('') && !embed.isValidNonce('x'.repeat(129)) && !embed.isValidNonce(7),
    'empty/oversize/non-string nonce rejected');
  assert.equal(child.authed('auth-1'), true, 'authed with a validated id posts');
  assert.deepEqual(posted[0], [{ v: 1, t: 'authed', n: 'auth-1' }, 'https://gigglemeet.com'],
    'authed ack echoes the nonce to the exact origin');
  assert.equal(child.authed(), false, 'bare authed posts nothing');
  assert.equal(child.authed(''), false, 'empty-nonce authed posts nothing');
  assert.equal(child.authed('x'.repeat(200)), false, 'oversize-nonce authed posts nothing');
  assert.equal(posted.length, 1, 'no ack without a validated id');
  const authMsg = { v: 1, t: 'auth', ticket: 'tok-1', n: 'auth-1' };
  assert(!child.handleEvent({ origin: 'https://evil.test', source: parentWin, data: authMsg }, parentWin),
    'spoofed origin ignored');
  assert(!child.handleEvent({ origin: 'https://gigglemeet.com', source: otherWin, data: authMsg }, parentWin),
    'unrelated same-origin frame ignored');
  assert(!child.handleEvent({ origin: 'https://gigglemeet.com', source: parentWin, data: { v: 2, t: 'auth', ticket: 'x' } }, parentWin),
    'wrong version ignored');
  assert(!child.handleEvent({ origin: 'https://gigglemeet.com', source: parentWin, data: { v: 1, t: 'auth' } }, parentWin),
    'shapeless auth ignored');
  assert(!child.handleEvent({ origin: 'https://gigglemeet.com', source: parentWin, data: { v: 1, t: 'auth', ticket: 'tok-1' } }, parentWin),
    'auth without nonce ignored (no uncorrelated ack possible)');
  assert(!child.handleEvent({ origin: 'https://gigglemeet.com', source: parentWin, data: { v: 1, t: 'auth', ticket: 'tok-1', n: '' } }, parentWin),
    'auth with empty nonce ignored');
  assert(!child.handleEvent({ origin: 'https://gigglemeet.com', source: parentWin, data: { v: 1, t: 'auth', ticket: 'tok-1', n: 'x'.repeat(200) } }, parentWin),
    'auth with oversize nonce ignored');
  assert(!child.handleEvent({ origin: 'https://gigglemeet.com', source: parentWin, data: { v: 1, t: 'context', theme: 'nope' } }, parentWin),
    'unknown theme ignored');
  assert(child.handleEvent({ origin: 'https://gigglemeet.com', source: parentWin, data: authMsg }, parentWin),
    'valid parent message accepted');
  assert.equal(authed, 'tok-1', 'auth dispatched');
  assert.equal(authedNonce, 'auth-1', 'nonce dispatched with the ticket');
  assert(child.handleEvent({ origin: 'https://gigglemeet.com', source: parentWin, data: { v: 1, t: 'context', theme: 'night' } }, parentWin),
    'valid context accepted');
  assert.equal(contexted.theme, 'night', 'context dispatched');
  assert(child.handleEvent({ origin: 'https://gigglemeet.com', source: parentWin, data: { v: 1, t: 'context', theme: 'lounge' } }, parentWin),
    'pre-D7 theme alias still accepted (maps to day/night in the shell)');
  // Contextual hint: metadata-driven, never per-game ids, total fallback.
  assert.deepEqual(embed.PRESENTATIONS, ['social', 'board', 'immersive', 'balanced'], 'hint enum is bounded');
  assert(embed.isValidPresentation('social') && embed.isValidPresentation('balanced'), 'valid hints pass');
  assert(!embed.isValidPresentation('weird') && !embed.isValidPresentation('') && !embed.isValidPresentation(42),
    'unknown/invalid hints rejected');
  assert.equal(embed.presentationForGame({ communication: 'video', cat: 'speed', renderer: 'dom' }), 'social',
    'video communication => social');
  assert.equal(embed.presentationForGame({ communication: 'any', cat: 'board', renderer: 'dom' }), 'board',
    'board cat => board');
  assert.equal(embed.presentationForGame({ communication: 'any', cat: '3d', renderer: '3d', realtime: true }), 'immersive',
    '3d renderer => immersive');
  assert.equal(embed.presentationForGame({ communication: 'any', cat: 'draw', renderer: 'canvas', realtime: true }), 'immersive',
    'realtime => immersive');
  assert.equal(embed.presentationForGame({ communication: 'any', cat: 'word', renderer: 'dom' }), 'balanced',
    'ordinary game => balanced');
  assert.equal(embed.presentationForGame(null), 'balanced', 'missing catalog => balanced');
  assert.equal(embed.presentationForGame({ cat: 'future-cat', renderer: 'hologram' }), 'balanced',
    'unknown metadata => balanced');
  console.log('BRIDGE ok: embed origin trust + source/shape validation');

  /* ---- G. UI-batch static checks ---- */
  const css = fs.readFileSync(path.join(ROOT, 'public/css/style.css'), 'utf8');
  const app = fs.readFileSync(path.join(ROOT, 'public/js/app.js'), 'utf8');
  const serverSrc = fs.readFileSync(path.join(ROOT, 'server/server.js'), 'utf8');
  assert.match(css, /\[hidden\]\s*\{\s*display:\s*none\s*!important/, 'robust [hidden] rule');
  assert(css.includes('.connbar:not([hidden])'), 'connbar cannot override hidden');
  assert(css.includes('.gstart.feat { display: grid;'), 'featured art/text are grid items');
  assert(css.includes('.feat .ftext > span { display: block; }'), 'featured text stacks');
  assert.match(css, /flex-wrap:\s*nowrap/, 'phone header stays one row');
  assert(!css.includes('.qrtile') && !app.includes('qrserver'), 'third-party QR tile removed');
  assert(app.includes("'/r/' + roomCode + location.search"), 'embed query survives room nav');
  assert(app.includes("'/' + location.search"), 'embed query survives home nav');
  assert(app.includes('LEASE_EXPIRED'), 'client handles lease expiry');
  assert(app.includes('embedBridge.authed(msg.n)'), 'child acks with the server echo only after server hello');
  assert(app.includes('isValidNonce(msg.n)'), 'child validates the echo before acking');
  assert(!app.includes('embedBridge.authed()'), 'no bare uncorrelated ack remains');
  assert(serverSrc.includes('isValidBridgeNonce(msg.n) ? { n: msg.n } : {}'),
    'server echoes a validated id only in the success hello');
  assert(app.includes('players take seats when a match starts.'), 'seat-cap copy covers late joiners without claiming every seat is occupied');
  assert(!app.includes('You will keep watching while they play.'), 'a capacity limit alone does not promise continued watching');
  assert(app.includes('clampCount'), 'presence counts stay typed integers within the room cap');
  assert(app.includes('SEAT_REPLACED_CODE'), 'client honors seat-taken close code');
  assert(app.includes('Playing in another window'), 'takeover banner copy present');
  assert(app.includes('Rejoin here'), 'deliberate rejoin action present');
  assert(app.includes('/config.json'), 'child fetches public config for trust');
  assert(app.includes('embedTrusted'), 'child gates parent messages on trust');
  assert(app.includes('embedctx'), 'embedded context stays compact');
  assert(!/, '\*'\)/.test(embedSrc) && !/, "\*"\)/.test(embedSrc), 'no wildcard postMessage target');
  // Contextual hint wiring: catalog-derived, reported on room/catalog/game
  // change — never per game tick.
  assert(app.includes('presentationForGame'), 'child derives the hint from the catalog');
  assert(app.includes('games.find((g) => g.id === room.game)'), 'hint looks up the running game');
  assert(app.includes('players: n, presentation'), 'state carries the hint');
  assert(app.includes('watchers: w, presentation'), 'seat-capped state carries the hint');
  assert(app.includes('Per-tick\n        // states below never re-report'), 'ticks stay silent');
  console.log('BRIDGE ok: UI-batch static checks');

  for (const s of sockets) try { s.close(); } catch {}
  for (const c of children) try { c.kill(); } catch {}
  console.log('BRIDGE_PASS');
}

main().catch((e) => {
  console.error('BRIDGE_FAIL', e);
  for (const c of children) try { c.kill(); } catch {}
  process.exit(1);
});

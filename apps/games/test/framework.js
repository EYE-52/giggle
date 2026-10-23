'use strict';
/* Framework tests: identity, host ownership, config validation + privacy,
 * per-room isolation, defaults/rematch, disposal. Boots the real server
 * on a scratch port and drives it over WebSockets, plus focused unit
 * tests for Room internals and the doodle-guess client cleanup.
 * Run: npm run test:framework */

const { spawn } = require('child_process');
const path = require('path');
const assert = require('assert');
const WebSocket = require('ws');

const PORT = 18234;
const ROOT = path.join(__dirname, '..');
let child = null;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const srv = spawn('node', ['server/server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child = srv;
  let out = '';
  srv.stdout.on('data', (d) => { out += d; });
  srv.stderr.on('data', (d) => { out += d; });
  const sockets = [];
  const fail = (msg) => {
    console.error('FRAME_FAIL', msg, '\n--- server log ---\n' + out);
    for (const s of sockets) try { s.close(); } catch {}
    srv.kill();
    process.exit(1);
  };
  process.on('uncaughtException', (e) => fail('uncaught: ' + e.stack));

  for (let i = 0; i < 50 && !out.includes('PartyBox on'); i++) await sleep(100);
  if (!out.includes('PartyBox on')) return fail('server did not boot');

  const mk = () => new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
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
  const roomOf = (ws) => {
    const r = last(ws, 'room');
    assert(r && r.room, 'expected room snapshot');
    return r.room;
  };
  const ok = (name) => console.log('FRAME ok:', name);

  // --- 1. connected-seat hijack by name is impossible ---
  const a = await mk();
  const ha = await helloOf(a, { t: 'create', name: 'Ann' });
  assert(ha.seatToken && ha.seatToken.length >= 16, 'hello must carry a seat token');
  const code1 = ha.code;
  const b = await mk();
  const hb = await helloOf(b, { t: 'join', name: 'Ann', code: code1 });
  assert.notStrictEqual(hb.you, ha.you, 'same-name join must not take a live seat');
  assert.notStrictEqual(hb.name, 'Ann', 'duplicate name must get a unique suffix');
  await sleep(150);
  const r1 = roomOf(a);
  const seatA = r1.players.find((p) => p.id === ha.you);
  assert(seatA && seatA.connected, 'original seat must stay connected under its owner');
  ok('connected seat resists name takeover; duplicate suffixed');

  // --- 2. disconnected-seat hijack by name is impossible; token resumes ---
  a.close();
  await sleep(250);
  const c = await mk();
  const hc = await helloOf(c, { t: 'join', name: 'Ann', code: code1 });
  assert.notStrictEqual(hc.you, ha.you, 'name alone must never reclaim a disconnected seat');
  const a2 = await mk();
  const ha2 = await helloOf(a2, { t: 'join', name: 'Alicia', code: code1, seatToken: ha.seatToken });
  assert.strictEqual(ha2.you, ha.you, 'token must reclaim the exact seat');
  await sleep(150);
  const r2 = roomOf(a2);
  assert(r2.players.find((p) => p.id === ha.you && p.connected), 'resumed seat is connected');
  ok('disconnected seat needs token; resume keeps id');

  // --- 3. host authorization + transfer ---
  // Ann disconnected earlier, so host transferred to b and stays there
  // (a resume does not steal the host seat back). c is a non-host.
  assert.strictEqual(roomOf(a2).hostId, hb.you, 'host transferred while Ann was away');
  send(c, { t: 'start', game: 'trivia' });
  await sleep(150);
  assert(last(c, 'error') && /host/i.test(last(c, 'error').msg), 'non-host start must be rejected');
  send(c, { t: 'configure', game: 'charades', settings: { rounds: 2 } });
  await sleep(150);
  assert(/host/i.test(last(c, 'error').msg), 'non-host configure must be rejected');
  send(c, { t: 'lobby' });
  await sleep(150);
  assert(/host/i.test(last(c, 'error').msg), 'non-host lobby must be rejected');
  // Current host (b) disconnects -> host migrates to longest-connected (Ann).
  b.close();
  await sleep(250);
  const rb = roomOf(a2);
  assert.strictEqual(rb.hostId, ha.you, 'host must transfer to longest-connected on disconnect');
  a2.msgs = [];
  send(a2, { t: 'start', game: 'trivia' });
  await sleep(250);
  assert(last(a2, 'state') && last(a2, 'state').game === 'trivia', 'transferred host must be able to start');
  send(a2, { t: 'lobby' });
  await sleep(150);
  ok('host-only control; host transfers on disconnect');

  // --- 4. player counts + room cap ---
  const solo = await mk();
  const hs = await helloOf(solo, { t: 'create', name: 'Solo' });
  send(solo, { t: 'start', game: 'charades' });
  await sleep(150);
  assert(/3–12/.test(last(solo, 'error').msg), 'min/max error must name the range');
  // Room cap: fill a room to 24, the 25th is refused.
  const cap = await mk();
  const hcap = await helloOf(cap, { t: 'create', name: 'Cap0' });
  const fillers = [];
  for (let i = 1; i < 24; i++) {
    const w = await mk();
    fillers.push(w);
    const h = await helloOf(w, { t: 'join', name: 'P' + i, code: hcap.code });
    assert(h.you, 'fill join ' + i);
  }
  const extra = await mk();
  send(extra, { t: 'join', name: 'Extra', code: hcap.code });
  await sleep(200);
  assert(/full/i.test(last(extra, 'error').msg), '25th seat must be refused');
  assert.strictEqual(roomOf(cap).players.length, 24, 'room holds at most 24 seats');
  for (const w of fillers) w.close();
  extra.close();
  // Max enforcement: 13 connected cannot start charades (max 12).
  const mks = [await mk()];
  const hm0 = await helloOf(mks[0], { t: 'create', name: 'M0' });
  for (let i = 1; i < 13; i++) {
    const w = await mk();
    mks.push(w);
    await helloOf(w, { t: 'join', name: 'M' + i, code: hm0.code });
  }
  send(mks[0], { t: 'start', game: 'charades' });
  await sleep(200);
  assert(/3–12/.test(last(mks[0], 'error').msg), 'over-max start must be rejected with the range');
  for (const w of mks) w.close();
  void hs;
  ok('min/max enforced with range; room cap 24');

  // --- 5. config validation boundaries, no partial mutation ---
  const h1 = await mk();
  const hh1 = await helloOf(h1, { t: 'create', name: 'Host' });
  const p2 = await mk();
  await helloOf(p2, { t: 'join', name: 'P2', code: hh1.code });
  const p3 = await mk();
  await helloOf(p3, { t: 'join', name: 'P3', code: hh1.code });
  assert.strictEqual(roomOf(h1).hostId, hh1.you, 'first seated player is host');
  const cfgErr = async (payload) => {
    const before = h1.msgs.length;
    send(h1, { t: 'configure', game: 'charades', ...payload });
    await sleep(150);
    const e = h1.msgs.slice(before).reverse().find((m) => m.t === 'error');
    assert(e, 'expected configure error for ' + JSON.stringify(payload));
    return e.msg;
  };
  assert(/Unknown setting/.test(await cfgErr({ settings: { nope: 1 } })), 'unknown setting key rejected');
  assert(/1\.\.12/.test(await cfgErr({ settings: { rounds: 99 } })), 'out-of-range int rejected');
  assert(/integer/.test(await cfgErr({ settings: { rounds: 'x' } })), 'string int rejected');
  assert(/integer/.test(await cfgErr({ settings: { rounds: 2.5 } })), 'non-integer rejected');
  assert(/Unknown pack/.test(await cfgErr({ pack: { nope: ['a'] } })), 'unknown pack key rejected');
  assert(/at least/.test(await cfgErr({ pack: { words: ['only', 'nine', 'x', 'x', 'x', 'x', 'x', 'x', 'x'] } })), 'short pack rejected');
  assert(/at most/.test(await cfgErr({ pack: { words: Array.from({ length: 201 }, (_, i) => 'w' + i) } })), 'oversize pack rejected');
  assert(/too long/.test(await cfgErr({ pack: { words: [...Array.from({ length: 10 }, (_, i) => 'w' + i), 'z'.repeat(61)] } })), 'oversize item rejected');
  assert(/only strings/.test(await cfgErr({ pack: { words: [...Array.from({ length: 10 }, (_, i) => 'w' + i), 42] } })), 'non-string item rejected');
  // Valid config sticks; a later invalid one leaves it untouched.
  send(h1, { t: 'configure', game: 'charades', settings: { rounds: 2 } });
  await sleep(150);
  assert.strictEqual(roomOf(h1).config.charades.settings.rounds, 2, 'valid settings stored');
  await cfgErr({ settings: { rounds: 99 } });
  assert.strictEqual(roomOf(h1).config.charades.settings.rounds, 2, 'invalid configure must not partially mutate');
  ok('config boundaries enforced; failures keep prior config');

  // --- 6. custom content privacy: counts yes, contents never ---
  const markers = Array.from({ length: 12 }, (_, i) => `zzqx-secret-${i}`);
  send(h1, { t: 'configure', game: 'charades', pack: { words: markers } });
  await sleep(200);
  const meta = roomOf(p2).config.charades;
  assert(meta && meta.packs && meta.packs.words === 12, 'non-host sees pack count metadata');
  for (const [nm, sock] of [['host', h1], ['p2', p2], ['p3', p3]]) {
    const rooms = sock.msgs.filter((m) => m.t === 'room').map((m) => JSON.stringify(m)).join('\n');
    assert(!rooms.includes('zzqx'), `lobby snapshots must never echo pack contents (${nm})`);
  }
  const gamesList = (() => {
    send(h1, { t: 'games' });
    return sleep(150).then(() => last(h1, 'games'));
  })();
  assert(!JSON.stringify(await gamesList).includes('zzqx'), 'games list must not leak pack contents');
  ok('pack contents private; counts public');

  // --- 7. per-room isolation ---
  const o1 = await mk();
  const ho1 = await helloOf(o1, { t: 'create', name: 'Other' });
  const o2 = await mk();
  await helloOf(o2, { t: 'join', name: 'O2', code: ho1.code });
  const o3 = await mk();
  const ho3 = await helloOf(o3, { t: 'join', name: 'O3', code: ho1.code, seatToken: hh1.seatToken });
  assert.notStrictEqual(ho3.you, hh1.you, 'a foreign-room token must grant nothing');
  await sleep(150);
  assert(!roomOf(o1).config.charades, 'room config must not leak across rooms');
  ok('tokens and config are room-scoped');

  // --- 8. defaults, customized timers, rematch retention, reset ---
  const d1 = await mk();
  const hd1 = await helloOf(d1, { t: 'create', name: 'D1' });
  const d2 = await mk();
  await helloOf(d2, { t: 'join', name: 'D2', code: hd1.code });
  const d3 = await mk();
  await helloOf(d3, { t: 'join', name: 'D3', code: hd1.code });
  const d4 = await mk();
  await helloOf(d4, { t: 'join', name: 'D4', code: hd1.code });
  const startAs = async (sock, game) => {
    sock.msgs = [];
    send(sock, { t: 'start', game });
    await sleep(250);
    const st = last(sock, 'state');
    assert(st && st.game === game, `expected ${game} state, got ${JSON.stringify(last(sock, 'error'))}`);
    return st;
  };
  let st = await startAs(d1, 'charades');
  assert.strictEqual(st.rounds, 4, 'unconfigured rounds keep the legacy dynamic default');
  let wait = st.endsAt - Date.now();
  assert(wait > 50000 && wait <= 60000, `default 60s timer, saw ${wait}ms`);
  // Guesser masking still holds.
  const guesser = [d2, d3, d4].map((s) => last(s, 'state')).find((s) => s && s.you !== st.actor);
  assert(guesser && !('word' in guesser) && guesser.masked, 'guesser view masks the word');
  send(d1, { t: 'lobby' });
  await sleep(150);
  send(d1, { t: 'configure', game: 'charades', settings: { rounds: 2, roundSeconds: 10 } });
  await sleep(150);
  st = await startAs(d1, 'charades');
  assert.strictEqual(st.rounds, 2, 'custom rounds apply');
  wait = st.endsAt - Date.now();
  assert(wait > 5000 && wait <= 10000, `custom 10s timer, saw ${wait}ms`);
  st = await startAs(d1, 'charades'); // rematch: no config sent
  assert.strictEqual(st.rounds, 2, 'rematch retains room config');
  send(d1, { t: 'configure', game: 'charades', reset: true });
  await sleep(150);
  assert(!roomOf(d1).config.charades, 'reset clears stored config');
  st = await startAs(d1, 'charades');
  assert.strictEqual(st.rounds, 4, 'reset restores legacy defaults');
  // Funny-answer custom duration + prompts.
  send(d1, { t: 'configure', game: 'funny-answer', settings: { rounds: 1, answerSeconds: 12 }, pack: { prompts: ['fp-a', 'fp-b', 'fp-c', 'fp-d', 'fp-e'] } });
  await sleep(150);
  st = await startAs(d1, 'funny-answer');
  assert.strictEqual(st.rounds, 1, 'punchline custom rounds apply');
  wait = st.endsAt - Date.now();
  assert(wait > 7000 && wait <= 12000, `punchline custom 12s timer, saw ${wait}ms`);
  send(d1, { t: 'lobby' });
  await sleep(150);
  ok('defaults preserved; custom timers apply; rematch retains; reset restores');

  // --- 9. emptied room survives briefly for token resume ---
  const g1 = await mk();
  const hg1 = await helloOf(g1, { t: 'create', name: 'Gone' });
  g1.close();
  await sleep(300);
  const g2 = await mk();
  const hg2 = await helloOf(g2, { t: 'join', name: 'Gone', code: hg1.code, seatToken: hg1.seatToken });
  assert.strictEqual(hg2.you, hg1.you, 'solo creator can refresh and resume within the grace window');
  ok('room grace window allows refresh resume');

  // --- 9b. stable active roster, spectators, instance ids ---
  const qa = await mk();
  const hqa = await helloOf(qa, { t: 'create', name: 'Host' });
  const qb = await mk();
  const hqb = await helloOf(qb, { t: 'join', name: 'P2', code: hqa.code });
  const qc = await mk();
  const hq3 = await helloOf(qc, { t: 'join', name: 'P3', code: hqa.code });
  const gho = await mk();
  const hgh = await helloOf(gho, { t: 'join', name: 'Ghost', code: hqa.code });
  gho.close(); // disconnects BEFORE the start: must never haunt the game
  await sleep(250);
  qa.msgs = [];
  send(qa, { t: 'start', game: 'trivia' });
  await sleep(250);
  const st1 = last(qa, 'state');
  assert(st1 && st1.game === 'trivia', 'expected trivia state, got ' + JSON.stringify(last(qa, 'error')));
  assert(st1.instanceId, 'state must carry a server-issued instanceId');
  assert.deepStrictEqual(
    st1.players.map((p) => p.id).sort(), [hqa.you, hqb.you, hq3.you].sort(),
    'roster = connected-at-start seats only, saw ' + JSON.stringify(st1.players));
  assert(!st1.players.some((p) => p.id === hgh.you), 'pre-start disconnect must not become a gho actor');
  assert(Array.isArray(st1.spectators) && st1.spectators.length === 0, 'no spectators yet');
  assert.strictEqual(st1.spectator, false, 'roster member is not a spectator');
  assert.deepStrictEqual(
    (st1.participants || []).map((p) => p.id).sort(), [hqa.you, hqb.you, hq3.you].sort(),
    'snapshots identify participants');
  const rl = roomOf(qa);
  assert.strictEqual(rl.instanceId, st1.instanceId, 'lobby snapshot carries the same instanceId');
  assert.strictEqual(rl.participants.length, 3, 'lobby snapshot identifies participants');
  // Late joiner spectates until the next start.
  const late = await mk();
  const hl = await helloOf(late, { t: 'join', name: 'Late', code: hqa.code });
  await sleep(250);
  const lst = last(late, 'state');
  assert(lst && lst.spectator === true, 'mid-game joiner must be a spectator');
  assert(lst.spectators.some((s) => s.id === hl.you), 'spectators list names the late joiner');
  assert(!lst.players.some((p) => p.id === hl.you), 'spectator must not join the roster mid-game');
  assert.strictEqual(lst.instanceId, st1.instanceId, 'spectator sees the same instance');
  // Spectator actions cannot mutate: no broadcast, nothing recorded.
  const n0 = qa.msgs.length;
  send(late, { t: 'action', a: { pick: 0 } });
  await sleep(200);
  assert(!qa.msgs.slice(n0).some((m) => m.t === 'state'), 'spectator action must not broadcast');
  send(qb, { t: 'action', a: { pick: 1 } });
  await sleep(200);
  const st2 = last(qa, 'state');
  assert(st2.answered.includes(hqb.you), 'roster answers are recorded');
  assert(!st2.answered.includes(hl.you), 'spectator answers are never recorded');
  // Roster member disconnects mid-game and resumes: still a participant.
  qc.close();
  await sleep(250);
  const r3b = await mk();
  const hr3b = await helloOf(r3b, { t: 'join', name: 'P3', code: hqa.code, seatToken: hq3.seatToken });
  assert.strictEqual(hr3b.you, hq3.you, 'roster seat resumes by token');
  await sleep(250);
  const rst = last(r3b, 'state');
  assert(rst && rst.spectator === false, 'resumed roster member stays a participant');
  // Restart mints a fresh instance id; connected seats join the new roster.
  send(qa, { t: 'start', game: 'trivia' });
  await sleep(250);
  const st3 = last(qa, 'state');
  assert(st3.instanceId && st3.instanceId !== st1.instanceId, 'restart must mint a fresh instanceId');
  assert(st3.players.some((p) => p.id === hl.you), 'connected late joiner joins the next roster');
  assert(!st3.players.some((p) => p.id === hgh.you), 'long-gone seat stays excluded');
  // Rejected lobby request leaves the game running for everyone.
  send(late, { t: 'lobby' });
  await sleep(150);
  assert(/host/i.test(last(late, 'error').msg), 'non-host lobby must be rejected');
  send(qb, { t: 'action', a: { pick: 2 } });
  await sleep(200);
  assert(last(qa, 'state').game === 'trivia', 'game continues after the rejected lobby request');
  ok('roster stable; spectators watch-only; instanceIds rotate; rejected lobby keeps game');

  // --- 13. Room QR + vendor routes (served by the framework server) ---
  {
    const http = require('http');
    const get = (target) => new Promise((resolve, reject) => {
      http.get({ host: '127.0.0.1', port: PORT, path: target }, (res) => {
        let body = '';
        res.on('data', (d) => { body += d; });
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
      }).on('error', reject);
    });
    let r = await get('/qr.svg?code=AB22');
    assert.strictEqual(r.status, 200, 'valid code serves QR, saw ' + r.status);
    assert.match(r.headers['content-type'] || '', /image\/svg\+xml/, 'QR is SVG');
    assert(r.body.startsWith('<svg'), 'QR body is an SVG document');
    assert((r.headers['cache-control'] || '').includes('max-age'), 'QR caches');
    r = await get('/qr.svg?code=AB22&ticket=sekrit&x=%3Cscript%3E');
    assert.strictEqual(r.status, 200, 'extra query keys are ignored, not echoed');
    assert(!r.body.includes('sekrit') && !r.body.includes('script'), 'query never echoes into the image');
    for (const bad of ['/qr.svg', '/qr.svg?code=', '/qr.svg?code=ab22', '/qr.svg?code=AB2',
        '/qr.svg?code=AB222', '/qr.svg?code=AB1I', '/qr.svg?code=../../x', '/qr.svg?code=%3Csvg']) {
      r = await get(bad);
      assert.strictEqual(r.status, 400, `${bad} must 400, saw ${r.status}`);
    }
    r = await get('/vendor/three/three.module.js');
    assert.strictEqual(r.status, 200, 'vendored three.module.js serves');
    assert.match(r.headers['content-type'] || '', /application\/javascript/, 'JS MIME is application/javascript');
    assert(r.body.includes('./three.core.js'), 'module entry references its sibling');
    r = await get('/vendor/three/three.core.js');
    assert.strictEqual(r.status, 200, 'vendored three.core.js serves alongside');
    assert.match(r.headers['content-type'] || '', /application\/javascript/, 'sibling JS MIME matches');
    r = await get('/js/app.js');
    assert.match(r.headers['content-type'] || '', /application\/javascript/, 'app JS MIME matches');
    r = await get('/vendor/three/LICENSE');
    assert.strictEqual(r.status, 200, 'vendor license serves with the build');
  }
  ok('QR route bounded (code-only SVG, no echo) + vendor pair serves as JS');

  for (const s of sockets) try { s.close(); } catch {}
  srv.kill();

  // --- 10. Room unit tests: stale close, dispose, validator edge cases ---
  const { Rooms } = require('../server/room');
  const V = require('../games/_validate');
  const rooms = new Rooms({});
  const room = rooms.create();
  const fakeSock = () => ({
    readyState: 1, closed: false,
    send() {},
    close() { this.readyState = 3; this.closed = true; },
  });
  const s1 = fakeSock();
  const { player: u } = room.addPlayer('U', s1);
  const s2 = fakeSock();
  room.addPlayer('U', s2, u.token); // token resume drops the old socket
  assert(s1.closed, 'resume closes the previous socket');
  room.disconnect(s1); // stale close must not clobber the replacement
  assert(u.connected && u.socket === s2, 'stale disconnect cannot steal the seat');
  let disposed = 0;
  const fakeDef = {
    id: 'fake', minPlayers: 1, maxPlayers: 4,
    create: () => ({ phase: 'x' }),
    onAction() {},
    view: (s) => ({ ...s }),
    dispose: () => { disposed += 1; },
  };
  room.startGame(fakeDef, {}, u.id);
  room.startGame(fakeDef, {}, u.id);
  assert.strictEqual(disposed, 1, 'game change disposes the previous game');
  room.endGameToLobby(u.id);
  assert.strictEqual(disposed, 2, 'leaving to lobby disposes the game');
  // Validator: enums, bools, non-finite ints, manifest shape.
  const vdef = {
    id: 'v', manifest: {
      settings: [
        { key: 'n', type: 'int', min: 1, max: 3, def: 2 },
        { key: 'e', type: 'enum', options: ['a', 'b'], def: 'a' },
        { key: 'f', type: 'bool', def: true },
      ],
      packs: {},
    },
  };
  assert(!V.validateSettings(vdef, { n: NaN }).ok, 'NaN int rejected');
  assert(!V.validateSettings(vdef, { n: Infinity }).ok, 'Infinity int rejected');
  assert(!V.validateSettings(vdef, { e: 'z' }).ok, 'bad enum rejected');
  assert(!V.validateSettings(vdef, { f: 'true' }).ok, 'string bool rejected');
  assert(!V.validateSettings(vdef, { f: 1 }).ok, 'numeric bool rejected');
  assert(V.validateSettings(vdef, { n: 3, e: 'b', f: false }).ok, 'valid enum/bool pass');
  assert(!V.validateManifest({ id: 'x', manifest: { settings: [{ key: 'n', type: 'int', min: 1, max: 2, def: 9 }] } }).ok, 'def outside range rejected');
  assert(!V.validateManifest({ id: 'x', manifest: { packs: { w: { type: 'string', minItems: 1 } } } }).ok, 'bad pack type rejected');
  assert(!V.isValidId('Bad_ID!'), 'unsafe id rejected');
  assert(V.isValidId('ok-id2'), 'safe id accepted');
  // Review regressions: inherited keys are never schema fields, even via
  // parsed JSON, including on a game with no customization. Every shipped
  // game now has Rounds/Pace settings, so a minimal manifest-free game
  // definition stands in for the schema-free case.
  const schemaless = { id: 'schemaless', create() { return {}; }, onAction() {}, view() { return {}; } };
  assert(!schemaless.manifest, 'the stand-in game must stay schema-free for this regression');
  for (const k of ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'valueOf']) {
    const s = V.validateSettings(schemaless, JSON.parse(JSON.stringify({ [k]: true })));
    assert(!s.ok && /Unknown setting/.test(s.error), `schemaless settings must reject ${k}`);
    const p = V.validatePack(schemaless, JSON.parse(JSON.stringify({ [k]: ['x'] })));
    assert(!p.ok && /Unknown pack/.test(p.error), `schemaless pack must reject ${k}`);
  }
  const charades = require('../games/charades/server.js');
  assert(!V.validateSettings(charades, JSON.parse('{"constructor":true}')).ok, 'schema game rejects constructor setting');
  assert(!V.validatePack(charades, JSON.parse('{"constructor":["x"]}')).ok, 'schema game rejects constructor pack');
  assert(!V.validateSettings(charades, JSON.parse('{"__proto__":1}')).ok, 'schema game rejects __proto__ setting');
  assert(V.validateSettings(charades, { rounds: 2 }).ok, 'real setting keys still pass');
  assert(V.validatePack(charades, { words: Array.from({ length: 12 }, (_, i) => 'w' + i) }).ok, 'real pack keys still pass');
  const clrRoom = rooms.create();
  const clrSock = fakeSock();
  clrRoom.addPlayer('Host', clrSock);
  assert(clrRoom.configure('charades', charades, undefined, JSON.parse('{"constructor":null}')).error,
    'clear-pack path must reject constructor');
  assert(clrRoom.configure('charades', charades, undefined, JSON.parse('{"__proto__":null}')).error,
    'clear-pack path must reject __proto__');
  // Review regressions: duplicate full-length names stay unique and short.
  for (const want of ['ABCDEFGHIJKLMNOP', 'ABCDEFGHIJKLMNOPQRST']) {
    const nmRoom = rooms.create();
    const seen = new Set();
    for (let i = 0; i < 3; i++) {
      const { player } = nmRoom.addPlayer(want, fakeSock());
      assert(player.name.length <= 16, `name over 16 chars: ${player.name}`);
      assert(!seen.has(player.name.toLowerCase()), `duplicate name not uniquified: ${player.name}`);
      seen.add(player.name.toLowerCase());
    }
  }
  // Roster unit checks: snapshot at start, spectators excluded from ctx.
  const rsRoom = rooms.create();
  const rsSocks = [fakeSock(), fakeSock(), fakeSock()];
  const rsA = rsRoom.addPlayer('A', rsSocks[0]).player;
  const rsB = rsRoom.addPlayer('B', rsSocks[1]).player;
  rsRoom.addPlayer('Ghost', rsSocks[2]);
  rsRoom.disconnect(rsSocks[2]); // gone before the start
  const rsDef = {
    id: 'rs-fake', minPlayers: 1, maxPlayers: 4,
    create: (ctx) => ({ roster: ctx.allPlayers().map((p) => p.id) }),
    onAction() {},
    view: (s) => ({ ...s }),
  };
  rsRoom.startGame(rsDef, {}, rsA.id);
  assert.deepStrictEqual(rsRoom.rosterIds().sort(), [rsA.id, rsB.id].sort(), 'roster snapshots connected seats');
  assert.deepStrictEqual(rsRoom.game.state.roster.sort(), [rsA.id, rsB.id].sort(), 'ctx.allPlayers is the roster at create');
  const rsLate = rsRoom.addPlayer('Late', fakeSock()).player;
  assert(rsRoom.isSpectator(rsLate.id), 'mid-game joiner is a spectator');
  assert(!rsRoom.isSpectator(rsA.id), 'roster seat is not a spectator');
  assert(!rsRoom.ctx().players().some((p) => p.id === rsLate.id), 'ctx.players excludes spectators');
  assert(!rsRoom.ctx().allPlayers().some((p) => p.id === rsLate.id), 'ctx.allPlayers excludes spectators');
  ok('stale-close safety; server dispose; validator edges');

  // --- 11. Doodle-guess client: window listener is removed by dispose() ---
  // Node treats .js as CJS under this package, so stage byte-identical
  // .mjs copies (browsers already load the originals as ESM).
  const fs = require('fs');
  const os = require('os');
  const { pathToFileURL } = require('url');
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'partybox-cli-'));
  fs.mkdirSync(path.join(stage, 'js', 'games'), { recursive: true });
  const doodleSrc = fs.readFileSync(path.join(ROOT, 'public', 'js', 'games', 'doodle-guess.js'), 'utf8');
  assert(doodleSrc.includes("from '../util.js'"), 'doodle view must import ../util.js');
  fs.writeFileSync(path.join(stage, 'js', 'games', 'doodle-guess.mjs'), doodleSrc.replace("'../util.js'", "'../util.mjs'").replace("'../kit.js'", "'../kit.mjs'"));
  fs.copyFileSync(path.join(ROOT, 'public', 'js', 'util.js'), path.join(stage, 'js', 'util.mjs'));
  // The game kit imports util too; stage it beside util.
  fs.writeFileSync(path.join(stage, 'js', 'kit.mjs'), fs.readFileSync(path.join(ROOT, 'public', 'js', 'kit.js'), 'utf8').replace("'./util.js'", "'./util.mjs'"));
  const adds = { window: 0, canvas: 0 };
  const rems = { window: 0, canvas: 0 };
  globalThis.window = {
    addEventListener: () => { adds.window += 1; },
    removeEventListener: () => { rems.window += 1; },
  };
  const canvas = {
    width: 880, height: 520,
    // Lifecycle fixture has no surrounding zoom viewport.
    closest: () => null,
    addEventListener: () => { adds.canvas += 1; },
    removeEventListener: () => { rems.canvas += 1; },
    getContext: () => ({
      clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {},
      set strokeStyle(v) {}, set lineWidth(v) {}, set lineCap(v) {}, set lineJoin(v) {},
    }),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 880, height: 520 }),
  };
  const el = {
    innerHTML: '',
    querySelector: (sel) => (sel === '#dCanvas' ? canvas : null),
    querySelectorAll: () => [],
  };
  const doodle = (await import(pathToFileURL(path.join(stage, 'js', 'games', 'doodle-guess.mjs')).href)).default;
  assert.strictEqual(typeof doodle.dispose, 'function', 'doodle view must export dispose()');
  const S = {
    phase: 'draw', round: 1, drawer: 'pa', me: 'pa', wordShown: 'apple',
    masked: '_____', strokes: [], guessed: {}, players: [{ id: 'pa', name: 'A' }], scores: {},
  };
  doodle.render(el, S, { send() {}, lobby() {}, name: () => 'A' });
  assert(adds.window >= 1 && adds.canvas >= 1, 'render wires canvas + window listeners');
  doodle.dispose(el);
  doodle.dispose(el);
  assert.strictEqual(rems.window, adds.window, 'dispose removes every window listener');
  assert.strictEqual(rems.canvas, adds.canvas, 'dispose removes every canvas listener');
  delete globalThis.window;
  fs.rmSync(stage, { recursive: true, force: true });
  ok('doodle-guess dispose() removes window + canvas listeners');

  // --- 12. Legacy views: every cached-state view exports dispose(); ---
  // draw-phone drops its window mouseup; truth-dare clears its spinner.
  {
    const fs2 = require('fs');
    const os2 = require('os');
    const { pathToFileURL: toUrl } = require('url');
    const stage2 = fs2.mkdtempSync(path.join(os2.tmpdir(), 'partybox-views-'));
    fs2.mkdirSync(path.join(stage2, 'js', 'games'), { recursive: true });
    fs2.copyFileSync(path.join(ROOT, 'public', 'js', 'util.js'), path.join(stage2, 'js', 'util.mjs'));
    // The game kit imports './util.js'; stage it next to util.mjs.
    fs2.writeFileSync(path.join(stage2, 'js', 'kit.mjs'), fs2.readFileSync(path.join(ROOT, 'public', 'js', 'kit.js'), 'utf8').replace("'./util.js'", "'./util.mjs'"));
    fs2.mkdirSync(path.join(stage2, 'js', 'toolkit'));
    fs2.copyFileSync(path.join(ROOT, 'public', 'js', 'toolkit', 'input-capabilities.mjs'), path.join(stage2, 'js', 'toolkit', 'input-capabilities.mjs'));
    const stateful = ['bluff', 'charades', 'draw-phone', 'emoji-story', 'five-second',
      'funny-answer', 'hot-takes', 'memory-tray', 'rank-it', 'story-builder',
      'truth-dare', 'twenty-questions', 'two-truths', 'typing-race'];
    const views = {};
    for (const id of stateful) {
      const src = fs2.readFileSync(path.join(ROOT, 'public', 'js', 'games', id + '.js'), 'utf8');
      fs2.writeFileSync(path.join(stage2, 'js', 'games', id + '.mjs'), src.replace("'../util.js'", "'../util.mjs'").replace("'../kit.js'", "'../kit.mjs'"));
      views[id] = (await import(toUrl(path.join(stage2, 'js', 'games', id + '.mjs')).href)).default;
      assert.strictEqual(typeof views[id].dispose, 'function', `${id} view must export dispose()`);
      assert.strictEqual(typeof views[id].render, 'function', `${id} view must export render()`);
    }
    // draw-phone: window mouseup from the draw phase is removed by dispose.
    const dAdds = { window: 0, canvas: 0 };
    const dRems = { window: 0, canvas: 0 };
    globalThis.window = {
      addEventListener: () => { dAdds.window += 1; },
      removeEventListener: () => { dRems.window += 1; },
    };
    const dCanvas = {
      width: 880, height: 520,
      addEventListener: () => { dAdds.canvas += 1; },
      removeEventListener: () => { dRems.canvas += 1; },
      getContext: () => ({
        clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {},
        set strokeStyle(v) {}, set lineWidth(v) {}, set lineCap(v) {}, set lineJoin(v) {},
      }),
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 880, height: 520 }),
    };
    const dEl = {
      innerHTML: '',
      querySelector: (sel) => (sel === '#pCanvas' ? dCanvas : null),
      querySelectorAll: () => [],
    };
    views['draw-phone'].render(dEl, {
      phase: 'draw', myPrompt: 'a cat', drawn: [], myStrokes: [],
      players: [{ id: 'pa', name: 'A' }],
    }, { send() {}, lobby() {}, name: () => 'A' });
    assert(dAdds.window >= 1, 'draw phase wires a window mouseup');
    views['draw-phone'].dispose(dEl);
    views['draw-phone'].dispose(dEl);
    assert.strictEqual(dRems.window, dAdds.window, 'draw-phone dispose removes every window listener');
    assert.strictEqual(dRems.canvas, dAdds.canvas, 'draw-phone dispose removes every canvas listener');
    delete globalThis.window;
    // truth-dare: the spin-phase interval is cleared by dispose.
    const realSet = global.setInterval;
    const realClear = global.clearInterval;
    let live = new Set();
    let cleared = 0;
    global.setInterval = (fn, ms) => { const id = realSet(fn, ms); live.add(id); return id; };
    global.clearInterval = (id) => { if (live.has(id)) { live.delete(id); cleared += 1; } return realClear(id); };
    const spinNode = { textContent: '' };
    globalThis.document = { getElementById: (id) => (id === 'tSpin' ? spinNode : null) };
    const tEl = { innerHTML: '', querySelector: () => null, querySelectorAll: () => [] };
    views['truth-dare'].render(tEl, {
      phase: 'spin', round: 1, rounds: 4, target: 'pa',
      players: [{ id: 'pa', name: 'A' }, { id: 'pb', name: 'B' }],
      totals: {},
    }, { send() {}, lobby() {}, name: () => 'A' });
    assert(live.size >= 1, 'spin phase starts an interval');
    views['truth-dare'].dispose(tEl);
    assert.strictEqual(live.size, 0, 'truth-dare dispose clears the spin interval');
    assert(cleared >= 1, 'dispose really called clearInterval');
    global.setInterval = realSet;
    global.clearInterval = realClear;
    delete globalThis.document;
    fs2.rmSync(stage2, { recursive: true, force: true });
  }
  ok('stateful views dispose cleanly (draw-phone listeners, truth-dare timer)');

  // --- 14. Seats / communication / art manifest fields ---
  {
    const V = require('../games/_validate');
    assert(V.validateManifest({ id: 'xx', manifest: { seats: 2, players: { min: 2, max: 24 } } }).ok,
      'seats within range pass');
    for (const seats of [0, -1, 2.5, '2', 25, NaN, Infinity]) {
      assert(!V.validateManifest({ id: 'xx', manifest: { seats } }).ok, `seats ${String(seats)} rejected`);
    }
    assert(!V.validateManifest({ id: 'xx', manifest: { seats: 3, players: { min: 2, max: 2 } } }).ok,
      'seats above players.max rejected');
    assert(V.validateManifest({ id: 'xx', manifest: { communication: 'video' } }).ok, 'video hint passes');
    assert(V.validateManifest({ id: 'xx', manifest: { communication: 'voice' } }).ok, 'voice hint passes');
    assert(!V.validateManifest({ id: 'xx', manifest: { communication: 'smoke' } }).ok, 'bad hint rejected');
    assert(V.validateManifest({ id: 'xx', manifest: { art: 'img/games/chess.svg' } }).ok, 'safe art passes');
    for (const art of ['https://x/y.svg', '/etc/passwd', '../x.svg', 'img/games/x.gif',
        'img/games/X.SVG', 'img/games/a b.svg', '', 42]) {
      assert(!V.validateManifest({ id: 'xx', manifest: { art } }).ok, `art ${JSON.stringify(art)} rejected`);
    }
    assert.strictEqual(V.manifestSeats({ id: 'xx' }), null, 'no seats key means whole roster');
    assert.strictEqual(V.manifestSeats({ id: 'xx', manifest: {} }), null, 'empty manifest means whole roster');
    assert.deepStrictEqual(V.activeIds(['a', 'b', 'c'], { id: 'xx' }), ['a', 'b', 'c'], 'uncapped keeps order');
    assert.deepStrictEqual(V.activeIds(['a', 'b', 'c'], { id: 'xx', manifest: { seats: 2 } }), ['a', 'b'],
      'capped slices the stable front');
    const registry = require('../games/registry');
    const ch = registry.meta('chess');
    assert(ch && ch.seats === 2 && ch.communication === 'any' && ch.art === 'img/games/chess.svg',
      'chess registry entry carries seats/art');
    const chz = registry.meta('charades');
    assert(chz && chz.communication === 'video', 'charades tagged video');
    const pk = registry.meta('pocket-karts');
    assert(pk && pk.seats === 8 && pk.renderer === '3d', 'karts registry entry carries seats/3d');
    const tr = registry.meta('trivia');
    assert(tr && tr.seats === null && tr.communication === 'any' && tr.art === 'img/games/trivia.webp',
      'legacy game defaults keep their semantics and use the compressed original cover');
    assert(!registry.get('castle-clash') && !registry.list().some((g) => g.id === 'castle-clash'),
      'retired Castle cannot be selected or started');
  }
  ok('seats/communication/art validation + registry passthrough');

  console.log('FRAME_PASS');
};

main().catch((e) => {
  console.error('FRAME_FAIL', e);
  try { if (child) child.kill(); } catch {}
  process.exit(1);
});

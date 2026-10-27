'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), net = require('node:net');
const { spawn } = require('node:child_process'), WebSocket = require('ws');
const { mintTicket } = require('../server/bridge');
const ROOT = path.resolve(__dirname, '..'), SECRET = 'board-room-fixture-0123456789abcdef0123456789';
const sleep = ms => new Promise(r => setTimeout(r, ms)), sockets = [];
let child, port, logs = '', checks = 0;
const check = (yes, message) => { checks++; assert(yes, message); };
const equal = (a, b, message) => { checks++; assert.deepEqual(a, b, message); };
async function freePort() { const s = net.createServer(); await new Promise(r => s.listen(0, '127.0.0.1', r)); const p = s.address().port; await new Promise(r => s.close(r)); return p; }
async function wait(ws, type, predicate = () => true, after = 0) {
  for (let n = 0; n < 160; n++) { const m = ws.messages.slice(after).find(m => m.t === type && predicate(m)); if (m) return m; await sleep(15); }
  throw Error('No ' + type + ' response; latest=' + JSON.stringify(ws.messages.slice(-2)));
}
const last = (ws, type) => ws.messages.filter(m => m.t === type).at(-1);
const send = (ws, value) => ws.send(JSON.stringify(value));
async function connect() { const ws = new WebSocket('ws://127.0.0.1:' + port); ws.messages = []; ws.on('message', raw => ws.messages.push(JSON.parse(raw))); sockets.push(ws); await new Promise((resolve, reject) => { ws.on('open', resolve); ws.on('error', reject); }); return ws; }
function board(S) { return S.board || S.pits; }
function legalAction(S) {
  if (S.game === 'kalah') return { pit: S.legal[0], revision: S.revision };
  const from = Number(Object.keys(S.legal)[0]); return { from, to: S.legal[from][0].to, revision: S.revision };
}
async function act(ws, a, stamp = {}) {
  const S = last(ws, 'state'), offset = ws.messages.length;
  send(ws, { t: 'action', i: S.instanceId, w: S.w, a, ...stamp });
  return wait(ws, 'state', () => true, offset);
}
async function flush(ws) { const id = 'flush-' + Date.now() + '-' + Math.random(), offset = ws.messages.length; send(ws, { t: 'clock', id }); await wait(ws, 'clock', m => m.id === id, offset); await sleep(25); }
async function testRoom(id, privateRoom) {
  const label = (privateRoom ? 'private ' : 'public ') + id, squad = 'board-' + id;
  let a = await connect(), b = await connect(), watcher = await connect(), late = await connect();
  async function join(ws, name, identity, code, resume) {
    const offset = ws.messages.length;
    if (privateRoom) send(ws, { t: 'giggleJoin', n: 'board-' + Date.now(), ticket: mintTicket({ sub: identity, squadId: squad, displayName: name }, SECRET) });
    else send(ws, { t: code ? 'join' : 'create', name, code, ...(resume ? { seatToken: resume } : {}) });
    return wait(ws, 'hello', () => true, offset);
  }
  const ha = await join(a, 'Alex', 'a-' + id), code = ha.code;
  const hb = await join(b, 'Bo', 'b-' + id, code);
  const hw = await join(watcher, 'Watcher', 'w-' + id, code);
  await wait(a, 'room', m => m.room.players.length === 3);
  if (privateRoom) {
    const outsider = await connect(); send(outsider, { t: 'join', name: 'Outsider', code }); const e = await wait(outsider, 'error'); check(/not found/i.test(e.msg), label + ' denies anonymous code join'); outsider.close();
  }
  send(a, { t: 'start', game: id });
  const initial = await wait(a, 'state', m => m.game === id); await wait(b, 'state'); await wait(watcher, 'state');
  equal(initial.seats, [ha.you, hb.you], label + ' two active seat ids');
  equal(initial.players.map(p => p.id), [ha.you, hb.you], label + ' only two participants');
  equal(last(watcher, 'state').youAre, null, label + ' roster watcher no seat'); check(last(watcher, 'state').spectator, label + ' roster watcher flagged');
  const hl = await join(late, 'Late', 'l-' + id, code); await wait(late, 'state');
  check(last(late, 'state').spectator, label + ' late join watches'); equal(last(late, 'state').youAre, null, label + ' late join no seat');
  equal(last(late, 'state').seats, initial.seats, label + ' late join does not replace seat');
  check(!('repetition' in last(late, 'state')), label + ' no server bookkeeping in public board projection');
  const action = legalAction(initial); const progressed = await act(a, action);
  equal(progressed.revision, 1, label + ' move advances once'); await wait(watcher, 'state', m => m.revision === 1); equal(board(last(watcher, 'state')), board(progressed), label + ' watcher observes confirmed board');
  const stable = board(progressed).slice(); await act(a, action); equal(last(a, 'state').revision, 1, label + ' duplicate revision ignored');
  await act(a, { ...legalAction(last(a, 'state')), revision: 1 }); equal(board(last(a, 'state')), stable, label + ' wrong seat cannot use legal opponent move');
  for (const ws of [watcher, late]) { send(ws, { t: 'action', i: progressed.instanceId, w: progressed.w, a: { ...legalAction(progressed), revision: 1 } }); await flush(ws); }
  equal(board(last(a, 'state')), stable, label + ' watchers cannot act');
  const afterB = await act(b, legalAction(last(b, 'state'))); equal(afterB.revision, 2, label + ' second seat moves');
  const beforeDisconnect = board(afterB).slice(), firstInstance = afterB.instanceId;
  a.close(); await wait(b, 'room', m => m.room.hostId === hb.you);
  a = await connect(); const resumed = await join(a, 'Alex', 'a-' + id, code, ha.seatToken); await wait(a, 'state');
  equal(resumed.you, ha.you, label + ' reconnect retains identity'); equal(last(a, 'state').youAre, 0, label + ' reconnect retains board side'); equal(last(a, 'state').instanceId, firstInstance, label + ' reconnect retains match'); equal(board(last(a, 'state')), beforeDisconnect, label + ' reconnect retains exact board');
  equal(last(a, 'room').room.hostId, hb.you, label + ' reconnect does not steal host');
  const errOffset = a.messages.length; send(a, { t: 'lobby' }); await wait(a, 'error', m => /host/i.test(m.msg), errOffset); equal(last(a, 'state').instanceId, firstInstance, label + ' non-host cannot end match');
  const end = await act(a, { resign: true, revision: last(a, 'state').revision }); equal(end.phase, 'done', label + ' resignation ends real match'); equal(end.result.winnerPid, hb.you, label + ' winner correct'); equal(end.totals[hb.you], 300, label + ' award exactly once'); equal(end.endsAt, null, label + ' result clears deadline');
  await act(a, { resign: true, revision: end.revision }); equal(last(a, 'state').totals[hb.you], 300, label + ' terminal re-award denied');
  a.close(); await flush(b); a = await connect(); await join(a, 'Alex', 'a-' + id, code, ha.seatToken); const finished = await wait(a, 'state'); equal(finished.phase, 'done', label + ' finished reconnect result intact'); equal(finished.totals[hb.you], 300, label + ' finished reconnect no re-award');
  const rematchOffset = b.messages.length; send(b, { t: 'start', game: id }); const restarted = await wait(b, 'state', m => m.instanceId !== firstInstance, rematchOffset); await wait(a, 'state', m => m.instanceId === restarted.instanceId);
  equal(restarted.revision, 0, label + ' rematch resets revision'); equal(restarted.phase, 'play', label + ' rematch playable'); equal(restarted.result, null, label + ' rematch drops result'); equal(restarted.seats, initial.seats, label + ' rematch original stable connected seat order');
  const opening = board(restarted).slice(); send(a, { t: 'action', i: firstInstance, w: initial.w, a: legalAction(last(a, 'state')) }); await flush(a); equal(board(last(a, 'state')), opening, label + ' stale old instance cannot mutate rematch');
  send(a, { t: 'action', i: restarted.instanceId, w: 'old-window', a: legalAction(last(a, 'state')) }); await flush(a); equal(board(last(a, 'state')), opening, label + ' stale window ignored');
  const current = await act(a, legalAction(last(a, 'state'))); equal(current.revision, 1, label + ' legal move after stale probes works'); equal(current.totals[hb.you], 300, label + ' room totals survive rematch');
  if (id === 'kalah') equal(current.pits.reduce((a, b) => a + b), 48, label + ' all seeds present through websocket flow');
  for (const ws of [a, b, watcher, late]) ws.close();
  console.log('BOARD_ROOMS ok: ' + label);
}
(async () => {
  port = await freePort(); child = spawn(process.execPath, ['server/server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', GAME_BRIDGE_SECRET: SECRET, GIGGLE_ALLOWED_ORIGINS: 'https://gigglemeet.com,http://127.0.0.1:4012' }, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', d => logs += d); child.stderr.on('data', d => logs += d);
  for (let n = 0; n < 100 && !logs.includes('PartyBox on'); n++) await sleep(25);
  check(logs.includes('PartyBox on'), 'scratch server starts');
  for (const id of ['checkers', 'kalah']) for (const privateRoom of [false, true]) await testRoom(id, privateRoom);
  fs.mkdirSync('/tmp/giggle-board-games-20261007', { recursive: true }); fs.writeFileSync('/tmp/giggle-board-games-20261007/checkers-kalah-rooms.json', JSON.stringify({ pass: true, checks, rooms: ['public checkers', 'private checkers', 'public kalah', 'private kalah'] }, null, 2));
  console.log('CHECKERS_KALAH_ROOMS_PASS: ' + checks + ' assertions; public/private rooms, roster/late watchers, duplicates, stale turns/windows/instances, reconnect, host migration, settled results and rematch');
})().catch(e => { console.error('CHECKERS_KALAH_ROOMS_FAIL', e.stack, logs); process.exitCode = 1; }).finally(() => { for (const ws of sockets) try { ws.terminate(); } catch {} if (child) child.kill(); });

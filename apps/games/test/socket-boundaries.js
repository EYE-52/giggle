'use strict';
// Real shipping authority: reject one malformed peer while legal rooms keep
// playing. Only an isolated localhost child receives invalid test frames.
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const net = require('node:net');
const path = require('node:path');
const WebSocket = require('ws');
const registry = require('../games/registry');
const { LIMITS, defaultSettings, validatePack } = require('../games/_validate');
const MAX = 1024 * 1024;
const peers = [], sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let checks = 0;
function check(value, label) { assert.ok(value, label); checks++; }
function equal(actual, expected, label) { assert.deepEqual(actual, expected, label); checks++; }
async function until(predicate, label) {
  const end = Date.now() + 6000;
  while (Date.now() < end) { if (predicate()) return; await sleep(10); }
  throw new Error(label);
}
const latest = (peer, type) => peer.messages.findLast(message => message.t === type);
const send = (peer, message) => peer.ws.send(JSON.stringify(message));

async function main() {
  const reservation = net.createServer();
  reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening');
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  // No bridge credentials, report store or public endpoint in this child.
  const child = spawn(process.execPath, ['server/server.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: { PATH: process.env.PATH, PORT: String(port), HOST: '127.0.0.1', NODE_ENV: 'test' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  for (const stream of [child.stdout, child.stderr]) stream.on('data', data => { output += data; });
  const cases = [], configurations = [];
  try {
    await until(() => output.includes('PartyBox on') || child.exitCode !== null, 'authority did not boot');
    equal(child.exitCode, null, 'shipping authority is alive');
    async function connect(hello) {
      const peer = { ws: new WebSocket(`ws://127.0.0.1:${port}`), messages: [], close: null };
      peers.push(peer);
      peer.ws.on('error', error => { peer.error = error.code; });
      peer.ws.on('close', code => { peer.close = code; });
      peer.ws.on('message', raw => {
        const message = JSON.parse(raw); peer.messages.push(message);
        if (message.t === 'state' && message.preparing && !message.spectator) {
          send(peer, { t: 'game-ready', i: message.instanceId, w: message.w });
        }
      });
      await once(peer.ws, 'open');
      if (hello) {
        send(peer, hello);
        await until(() => latest(peer, 'hello') && latest(peer, 'room'), 'seat did not join');
      }
      return peer;
    }
    async function clock(peer, id) {
      send(peer, { t: 'clock', id });
      await until(() => peer.messages.some(message => message.t === 'clock' && message.id === id), 'healthy clock lost: ' + id);
      check(Number.isSafeInteger(latest(peer, 'clock').serverNow), 'clock retains server time');
    }
    const host = await connect({ t: 'create', name: 'Boundary host' });
    const code = latest(host, 'hello').code;
    const guest = await connect({ t: 'join', name: 'Healthy opponent', code });

    // Exercise every current pack schema at its accepted item/length bounds.
    // A non-whitespace control character needs six JSON bytes per code unit.
    // These are synthetic private lists, never returned in public packets.
    for (const meta of registry.list()) {
      const def = registry.get(meta.id), pack = {};
      for (const [key, rule] of Object.entries(def.manifest?.packs || {})) {
        const maxLen = rule.maxLen ?? LIMITS.MAX_ITEM_LEN;
        const count = Math.min(rule.maxItems ?? LIMITS.MAX_PACK_ITEMS,
          Math.floor((rule.maxBytes ?? LIMITS.MAX_PACK_BYTES) / maxLen));
        pack[key] = Array(count).fill('\u0001'.repeat(maxLen));
      }
      check(validatePack(def, pack).ok, meta.id + ' boundary list satisfies existing schema');
      const requestId = 'boundary-' + meta.id;
      const raw = JSON.stringify({ t: 'configure', game: meta.id, requestId, settings: defaultSettings(def), pack });
      const bytes = Buffer.byteLength(raw);
      check(bytes < MAX, meta.id + ' largest escaped canonical configuration fits receive cap');
      const start = host.messages.length;
      host.ws.send(raw);
      await until(() => host.messages.slice(start).some(message => message.requestId === requestId), meta.id + ' configure acknowledgement missing');
      equal(host.messages.slice(start).find(message => message.requestId === requestId),
        { t: 'configured', game: meta.id, requestId }, meta.id + ' entire permitted list saves');
      configurations.push({ game: meta.id, bytes, packs: Object.keys(pack).length });
    }
    equal(configurations.length, 42, 'all shipping definitions included');
    const schemaCeiling = LIMITS.MAX_PACK_KEYS * LIMITS.MAX_PACK_ITEMS * (LIMITS.MAX_ITEM_LEN * 6 + 3)
      + LIMITS.MAX_PACK_KEYS * 40 + LIMITS.MAX_SETTINGS_KEYS * 96 + 1024;
    check(schemaCeiling < MAX, 'four-pack schema ceiling plus envelope fits cap');
    const exact = await connect();
    const raw = JSON.stringify({ t: 'clock', id: 'exact-message-boundary' });
    exact.ws.send(raw + ' '.repeat(MAX - Buffer.byteLength(raw)));
    await until(() => latest(exact, 'clock'), 'exactly 1 MiB JSON must be handled');
    equal(latest(exact, 'clock').id, 'exact-message-boundary', 'inclusive decoded message boundary remains valid');
    equal(exact.ws.readyState, WebSocket.OPEN, 'at-boundary connection stays open');
    exact.ws.close();

    send(host, { t: 'start', game: 'four-in-a-row', ready: true });
    await until(() => [host, guest].every(peer => latest(peer, 'state')?.phase === 'play' && !latest(peer, 'state').preparing), 'legal match did not release');
    const instance = latest(host, 'state').instanceId;
    for (const [name, expectedClose, transmit] of [
      ['invalid-utf8', 1007, ws => ws.send(Buffer.from([0xc0, 0xaf]), { binary: false })],
      ['oversized-text', 1009, ws => ws.send(' '.repeat(MAX + 1))],
      ['oversized-binary', 1009, ws => ws.send(Buffer.alloc(MAX + 1, 32))],
      ['oversized-fragmented', 1009, ws => {
        ws.send(' '.repeat(MAX / 2), { fin: false });
        ws.send(' '.repeat(MAX / 2 + 1), { fin: true });
      }],
    ]) {
      const bad = await connect({ t: 'join', name, code });
      const pid = latest(bad, 'hello').you;
      await until(() => latest(bad, 'state')?.spectator, name + ' is attached as watcher');
      transmit(bad.ws);
      await until(() => bad.close !== null || child.exitCode !== null, name + ' must close');
      equal(child.exitCode, null, name + ' cannot crash authority');
      equal(bad.close, expectedClose, name + ' closes only offender with protocol code');
      await until(() => latest(host, 'room')?.room.players.some(player => player.id === pid && !player.connected), name + ' normal close detaches bad seat');
      await clock(host, name + '-host'); await clock(guest, name + '-guest');
      equal(latest(host, 'state').instanceId, instance, name + ' leaves healthy match intact');
      const response = await fetch(`http://127.0.0.1:${port}/config.json`);
      equal(response.status, 200, name + ' HTTP stays available');
      equal((await response.json()).version, require('../package.json').version, name + ' serves current version');
      cases.push({ name, peerClose: bad.close, authorityAlive: true });
    }
    // Complete a legal match after all rejected frames, not just a clock ping.
    for (const [peer, column] of [[host, 0], [guest, 1], [host, 0], [guest, 1], [host, 0], [guest, 1], [host, 0]]) {
      const state = latest(peer, 'state'), rev = state.rev;
      send(peer, { t: 'action', i: state.instanceId, w: state.w, a: { drop: column, rev } });
      await until(() => [host, guest].every(p => latest(p, 'state').rev === rev + 1), 'legal move after receive rejection did not settle');
    }
    equal(latest(host, 'state').result.winnerPid, latest(host, 'hello').you, 'healthy host wins legal four after errors');
    equal(latest(guest, 'state').phase, 'done', 'healthy opponent sees settled result');
    equal(latest(host, 'state').totals[latest(host, 'hello').you], 300, 'healthy score awarded once');
    check(output.includes('WebSocket receive error: WS_ERR_INVALID_UTF8'), 'invalid frame is logged by static protocol code');
    check(output.includes('WebSocket receive error: WS_ERR_UNSUPPORTED_MESSAGE_LENGTH'), 'oversize is logged by static protocol code');
    check(!output.includes("Unhandled 'error' event"), 'receive errors are handled');
    check(!output.includes('exact-message-boundary') && !output.includes('boundary-story-builder') && !output.includes('\\u0001'), 'transport logs omit private message contents');
    send(host, { t: 'lobby' });
    await until(() => latest(host, 'room').room.game === null, 'healthy match returns to lobby');
    console.log(JSON.stringify({ pass: true, checks, node: process.version, maxPayload: MAX, schemaCeiling,
      largestConfiguration: configurations.reduce((a, b) => a.bytes > b.bytes ? a : b), configurations, cases,
      final: { game: 'four-in-a-row', revisions: 7, winnerScore: 300 },
      scope: 'Isolated production Node server and localhost WebSockets. No compression, public attack, browser, physical device or perceptual audio verdict.' }, null, 2));
  } catch (error) {
    error.message += '\nIsolated server output:\n' + output.slice(-4000); throw error;
  } finally {
    for (const peer of peers) peer.ws.terminate();
    if (child.exitCode === null) { const exit = once(child, 'exit'); child.kill(); await exit; }
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });

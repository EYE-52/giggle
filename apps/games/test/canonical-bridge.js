'use strict';
// Cross-app contract: the canonical Meet issuer feeds the actual Games
// verifier, Room and loopback WebSocket join/renew handlers. Synthetic people
// and an ephemeral secret only; no API, Redis, account or media access.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const WebSocket = require('ws');
const issuer = require('../../../server/src/services/gameBridgeService');
const { publicEncounterIdentity } = require('../../../server/src/services/encounterIdentityService');
const bridge = require('../server/bridge');
const { Rooms } = require('../server/room');

const secret = crypto.randomBytes(32).toString('hex');
process.env.ENCOUNTER_IDENTITY_SECRET = secret;
const env = { NODE_ENV: 'development', GAMES_PUBLIC_URL: 'http://127.0.0.1:8123', GAME_BRIDGE_SECRET: secret };
const encounterId = 'enc_canonical_contract';
const hidden = ['507f1f77bcf86cd799439011', '507f1f77bcf86cd799439022', 'Private Alice', 'Private Bruno'];
const identities = ['Quiet Fox', 'Calm Owl'].map((alias, i) => publicEncounterIdentity({
  encounterId, viewerSquadId: i ? 'squad-A' : 'squad-B', memberSquadId: i ? 'squad-B' : 'squad-A',
  member: { userId: hidden[i], displayName: hidden[i + 2] },
  user: { anonymousInEncounters: true, encounterAlias: alias },
}));
const ticket = (i, extra = {}) => issuer.issueEncounterGameTicket({
  encounterId, userId: identities[i].callId, displayName: identities[i].displayName,
  team: i ? 'B' : 'A', teamName: i ? 'Day Larks' : 'Night Owls', ...extra,
}, env).ticket;
const claims = token => bridge.verifyTicket(token, { secret }).claims;
const legacyTicket = () => issuer.issueGameTicket({ squadId: 'enc:' + encounterId,
  userId: identities[0].callId, displayName: identities[0].displayName }, env).ticket;
function resign(token, patch) {
  const [header, body] = token.split('.');
  const payload = { ...JSON.parse(Buffer.from(body, 'base64url')), ...patch };
  const data = header + '.' + Buffer.from(JSON.stringify(payload)).toString('base64url');
  return data + '.' + crypto.createHmac('sha256', secret).update(data).digest('base64url');
}
const noPrivateIdentity = value => {
  const serialized = JSON.stringify(value);
  for (const text of [...hidden, secret]) assert(!serialized.includes(text), 'private identity or secret escaped');
};
const socket = () => ({ readyState: 1, messages: [], send(text) { this.messages.push(JSON.parse(text)); }, close() { this.readyState = 3; } });

const first = ticket(0), second = ticket(1);
const a = claims(first), b = claims(second);
assert.equal(a.squadId, b.squadId);
assert.equal(a.squadId, 'enc:' + encounterId);
assert.equal(a.sub, identities[0].callId);
assert.equal(b.sub, identities[1].callId);
assert.equal(a.team, 'A'); assert.equal(b.team, 'B');
assert.equal(a.teamName, 'Night Owls'); assert.equal(b.teamName, 'Day Larks');
assert.equal(a.exp - a.iat, 90);
assert.equal(claims(ticket(0, { teamName: 'x'.repeat(60) })).teamName.length, 32, 'canonical issuer bounds squad names');
assert.equal(claims(resign(first, { teamName: undefined })).teamName, 'Squad', 'optional name has a safe fallback');
assert.equal(claims(legacyTicket()).team, undefined, 'legacy tickets remain valid');
for (const patch of [{ team: 'C' }, { team: '' }, { team: null }, { team: 1 },
  { teamName: 'x'.repeat(33) }, { teamName: null }, { teamName: {} }, { team: undefined, teamName: 'Orphan' }]) {
  assert.equal(bridge.verifyTicket(resign(first, patch), { secret }).error, 'bad-fields');
}
const tampered = resign(first, { team: 'B' }).split('.');
tampered[2] = first.split('.')[2];
assert.equal(bridge.verifyTicket(tampered.join('.'), { secret }).error, 'bad-signature', 'a side cannot be edited without signing');
assert.equal(bridge.verifyTicket(first, { secret, nowMs: a.exp * 1000 }).error, 'expired');
bridge.resetBridgeForTests();
assert(!bridge.consumeTicket(first, { secret }).error);
assert.equal(bridge.consumeTicket(first, { secret }).error, 'replayed');

const rooms = new Rooms({}), room = rooms.getOrCreateGiggle(a.squadId);
const add = (verified, ws) => room.addGigglePlayer(verified.sub, verified.displayName, ws, verified);
const sa = socket(), sb = socket();
const seatA = add(a, sa).player, seatB = add(b, sb).player;
assert.equal(room.players.length, 2);
assert.equal(room.lobby.players.find(p => p.id === seatA.id).team, 'A');
assert.equal(room.lobby.players.find(p => p.id === seatB.id).team, 'B');
assert.equal(room.lobby.players.find(p => p.id === seatA.id).callUserId, identities[0].callId);
assert.equal(add(claims(ticket(0, { teamName: 'Renamed Owls' })), sa).player.id, seatA.id);
assert.equal(seatA.teamName, 'Renamed Owls', 'fresh signed metadata replaces prior metadata');
assert(room.addGigglePlayer(a.sub, 'Forged', sa, { team: 'C' }).error);
assert.equal(seatA.name, identities[0].displayName, 'invalid metadata cannot mutate a seat');
add(claims(legacyTicket()), sa);
assert.equal(seatA.team, undefined, 'legacy renewal clears stale signed metadata');
assert.equal(seatA.teamName, undefined);
assert(!Object.hasOwn(room.lobby.players.find(p => p.id === seatA.id), 'team'));
noPrivateIdentity(room.lobby);
const plain = rooms.create();
plain.addPlayer('Standalone', socket());
assert(!Object.hasOwn(plain.lobby.players[0], 'team'));
assert(!Object.hasOwn(plain.lobby.players[0], 'callUserId'));
room.destroy(); plain.destroy();

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(check, message) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) { const result = check(); if (result) return result; await pause(20); }
  throw Error(message);
}
async function main() {
  const probe = net.createServer();
  probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
  const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'canonical-games-bridge-'));
  const server = spawn(process.execPath, ['server/server.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: { PATH: process.env.PATH, NODE_ENV: 'development', HOST: '127.0.0.1', PORT: String(port),
      GAME_BRIDGE_SECRET: secret, GIGGLE_ALLOWED_ORIGINS: 'https://www.gigglemeet.com', GAME_REPORT_DB: path.join(scratch, 'reports.sqlite') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const clients = []; let log = '';
  server.stdout.on('data', chunk => { log += chunk; }); server.stderr.on('data', chunk => { log += chunk; });
  async function connect() {
    const ws = new WebSocket('ws://127.0.0.1:' + port, { origin: 'https://www.gigglemeet.com', handshakeTimeout: 3000 });
    clients.push(ws); ws.messages = []; ws.on('message', text => ws.messages.push(JSON.parse(text)));
    await once(ws, 'open'); return ws;
  }
  async function request(ws, input, type) {
    const start = ws.messages.length; ws.send(JSON.stringify(input));
    return waitFor(() => ws.messages.slice(start).find(message => message.t === type), 'Missing ' + type);
  }
  async function join(ws, input) {
    const start = ws.messages.length, hello = await request(ws, input, 'hello');
    const snapshot = await waitFor(() => ws.messages.slice(start).find(message => message.t === 'room'), 'Missing room');
    assert.equal(hello.n, input.n); return { hello, room: snapshot.room };
  }
  try {
    await waitFor(() => log.includes('PartyBox on'), 'Games server did not boot: ' + log);
    const wa = await connect(), wb = await connect();
    const joinedA = await join(wa, { t: 'giggleJoin', ticket: ticket(0), n: 'canonical-a', team: 'B', teamName: 'Forged', displayName: hidden[2] });
    const joinedB = await join(wb, { t: 'giggleJoin', ticket: ticket(1), n: 'canonical-b' });
    assert.equal(joinedA.hello.code, joinedB.hello.code, 'both canonical sides join the same private room');
    assert.equal(joinedB.room.players.find(p => p.id === joinedA.hello.you).team, 'A', 'unsigned WS metadata is ignored');
    assert.equal(joinedB.room.players.find(p => p.id === joinedB.hello.you).team, 'B');
    assert.equal(joinedB.room.players.find(p => p.id === joinedA.hello.you).name, identities[0].displayName);
    const renewal = ticket(0, { teamName: 'Fresh Owls' });
    const renewed = await join(wa, { t: 'giggleRenew', ticket: renewal, n: 'renew-a', team: 'B' });
    assert.equal(renewed.hello.you, joinedA.hello.you);
    assert.equal(renewed.room.players.length, 2);
    assert.equal(renewed.room.players.find(p => p.id === renewed.hello.you).teamName, 'Fresh Owls');
    assert.equal((await request(wa, { t: 'giggleRenew', ticket: renewal }, 'error')).code, 'TICKET_REPLAYED');
    const expired = resign(ticket(0), { iat: Math.floor(Date.now() / 1000) - 91, exp: Math.floor(Date.now() / 1000) - 1 });
    assert.equal((await request(wa, { t: 'giggleRenew', ticket: expired }, 'error')).code, 'TICKET_EXPIRED');
    assert.equal((await request(wa, { t: 'giggleRenew', ticket: tampered.join('.') }, 'error')).code, 'TICKET_INVALID');
    const legacy = await join(wa, { t: 'giggleRenew', ticket: legacyTicket(), n: 'legacy-a', team: 'A', teamName: 'Unsigned' });
    assert.equal(legacy.hello.you, joinedA.hello.you);
    assert(!Object.hasOwn(legacy.room.players.find(p => p.id === legacy.hello.you), 'team'));
    const guest = await connect();
    const guestStart = guest.messages.length;
    await request(guest, { t: 'create', name: 'Standalone', team: 'A', teamName: 'Unsigned' }, 'hello');
    const guestRoom = await waitFor(() => guest.messages.slice(guestStart).find(message => message.t === 'room'), 'Missing standalone room');
    assert(!Object.hasOwn(guestRoom.room.players[0], 'team'));
    for (const client of clients) noPrivateIdentity(client.messages);
    console.log('CANONICAL_BRIDGE_PASS: canonical issuer, opaque aliases, bounded signed sides, Room metadata, real join/renew, replay/expiry/forgery and standalone isolation');
  } finally {
    for (const ws of clients) ws.terminate();
    server.kill(); if (server.exitCode === null && server.signalCode === null) await once(server, 'exit');
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });

'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const WebSocket = require('ws');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let server;
const sockets = [];

(async () => {
  const reservation = net.createServer();
  await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  server = spawn(process.execPath, ['server/server.js'], { cwd: path.resolve(__dirname, '..'), env: { ...process.env, HOST: '127.0.0.1', PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  server.stdout.on('data', b => { log += b; }); server.stderr.on('data', b => { log += b; });
  for (let i = 0; i < 100 && !log.includes('PartyBox on'); i++) { if (server.exitCode !== null) throw new Error(log); await delay(100); }
  assert(log.includes('PartyBox on'), log);
  const html = await fetch(`http://127.0.0.1:${port}/same-room/?game=truth-dare`).then(r => r.text());
  assert(html.includes('/js/same-room.js'));
  async function client() {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`), messages = [];
    sockets.push(ws); ws.on('message', data => messages.push(JSON.parse(data)));
    await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
    return { ws, messages, send: m => ws.send(JSON.stringify(m)), async wait(test) {
      for (let i = 0; i < 100; i++) { const hit = messages.find(test); if (hit) return hit; await delay(50); }
      throw new Error('No expected reply: ' + JSON.stringify(messages.slice(-2)));
    } };
  }
  const a = await client();
  a.send({ t: 'same-start', game: 'truth-dare', names: ['Sam', 'Jess'], settings: { rounds: 1, promptStyle: 'Ask your own' } });
  const created = await a.wait(m => m.t === 'same-created');
  let state = await a.wait(m => m.t === 'same-state');
  assert(!('code' in created) && !('code' in state));
  assert.equal(a.messages.some(m => ['hello', 'room', 'state'].includes(m.t)), false, 'no ordinary room or seat projections');
  const request = async (c, current, op, fields, predicate) => {
    const start = c.messages.length;
    c.send({ t: 'same-input', step: current.step, op, ...fields });
    for (let i = 0; i < 120; i++) {
      const next = c.messages.slice(start).find(m => m.t === 'same-state' && (!predicate || predicate(m)));
      if (next) return next;
      await delay(50);
    }
    throw new Error(`No ${op} reply: ${JSON.stringify(c.messages.slice(-2))}`);
  };
  state = await request(a, state, 'ready', {}, m => m.state?.phase === 'choose');
  state = await request(a, state, 'ready', {}, m => m.running);
  state = await request(a, state, 'action', { a: { deck: 'classic', kind: 'truth' } });
  assert.equal(state.gate, 'pass'); assert.equal(state.state, undefined);
  state = await request(a, state, 'unlock', {}); assert.equal(state.state.phase, 'compose');
  state = await request(a, state, 'ready', {});
  state = await request(a, state, 'action', { a: { entry: 'A private prompt from Jess' } });
  assert.equal(state.gate, 'return'); assert.equal(state.state, undefined);
  state = await request(a, state, 'back', {}); assert.equal(state.state.prompt, 'A private prompt from Jess');
  state = await request(a, state, 'ready', {});
  state = await request(a, state, 'action', { a: { ready: true } });
  assert.equal(state.gate, 'pass'); assert(!JSON.stringify(state).includes('A private prompt'));
  const b = await client(); b.send({ t: 'same-resume', token: created.token });
  assert.match((await b.wait(m => m.t === 'same-error')).msg, /another window/);
  await new Promise(resolve => { a.ws.once('close', resolve); a.ws.close(); });
  b.messages.length = 0; b.send({ t: 'same-resume', token: created.token });
  state = await b.wait(m => m.t === 'same-state'); assert.equal(state.gate, 'pass');
  state = await request(b, state, 'unlock', {});
  state = await request(b, state, 'ready', {});
  state = await request(b, state, 'action', { a: { vote: 'yes' } });
  assert.equal(state.state, undefined);
  state = await request(b, state, 'back', {});
  assert.equal(state.state.phase, 'reveal'); assert.equal(state.state.last.targetPts, 100);
  b.send({ t: 'same-stop' }); await b.wait(m => m.t === 'same-stopped');

  // The ordinary three-person path: one real target chooses and performs,
  // then the other two seats judge under their own private projections.
  const c = await client();
  c.send({ t: 'same-start', game: 'truth-dare', names: ['Sam', 'Jess', 'Mo'], settings: { rounds: 1, promptStyle: 'Random card' } });
  state = await c.wait(m => m.t === 'same-state');
  assert.equal(state.state.phase, 'spin');
  const target = state.state.target;
  const targetName = state.players.find(p => p.id === target).name;
  const checkTarget = phase => {
    assert.equal(state.state.phase, phase);
    assert.equal(state.player, target, `${phase}: the target acts now`);
    assert.equal(state.state.me, target, `${phase}: real game view uses the same actor`);
    assert.equal(state.players.find(p => p.id === state.state.me).name, targetName);
  };
  checkTarget('spin');
  state = await request(c, state, 'ready', {}, m => m.state?.phase === 'choose');
  checkTarget('choose');
  state = await request(c, state, 'ready', {}, m => m.running);
  state = await request(c, state, 'action', { a: { deck: 'funny', kind: 'truth' } });
  checkTarget('perform');
  assert(state.state.prompt);
  state = await request(c, state, 'ready', {}, m => m.running);
  state = await request(c, state, 'action', { a: { ready: true } });
  const judges = new Set();
  for (let i = 0; i < 2; i++) {
    assert.equal(state.gate, 'pass'); assert.equal(state.state, undefined);
    state = await request(c, state, 'unlock', {});
    assert.equal(state.state.phase, 'vote');
    assert.equal(state.player, state.state.me);
    assert.notEqual(state.player, target);
    judges.add(state.player);
    state = await request(c, state, 'ready', {}, m => m.running);
    state = await request(c, state, 'action', { a: { vote: 'yes' } });
    assert.equal(state.gate, 'return'); assert.equal(state.state, undefined);
    state = await request(c, state, 'back', {});
  }
  assert.equal(judges.size, 2);
  assert.equal(state.state.phase, 'reveal');
  assert.equal(state.state.last.targetPts, 100);
  state = await request(c, state, 'ready', {}, m => m.running);
  state = await request(c, state, 'action', { a: { next: true } });
  assert.equal(state.state.phase, 'done');
  c.send({ t: 'same-stop' }); await c.wait(m => m.t === 'same-stopped');

  b.send({ t: 'same-start', game: 'pose-party', names: ['Sam', 'Jess'] });
  assert.match((await b.wait(m => m.t === 'same-error' && /separate/.test(m.msg))).msg, /separate devices/);
  assert(!/handle error|one-device game failed/.test(log), log);
  console.log('SAME_ROOM_TRANSPORT_PASS: real HTTP/WS entry; full three-person target/perform/two-judge round; no public code; private write/vote; one controller; disconnect/resume; authoritative scoring; unsupported rejection');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  for (const ws of sockets) ws.terminate();
  server?.kill('SIGTERM');
});

'use strict';
const assert = require('node:assert/strict');
const { once } = require('node:events');
const WebSocket = require('ws');
const { createServer } = require('./doodle-guess-browser');
const ink = { pts: [[.1, .2], [.7, .2]], color: '#111111', size: 7, tool: 'pen' };
async function main() {
  const server = createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = 'http://127.0.0.1:' + server.address().port;
  const { session } = await (await fetch(base + '/session')).json();
  const clients = {};
  let checks = 0;
  async function join(role) {
    const ws = new WebSocket(base.replace('http', 'ws') + '/socket');
    const client = { ws, frames: [], state: null };
    ws.on('message', text => { const m = JSON.parse(text); client.frames.push(m); if (m.t === 'state') { client.state = m; if(m.preparing&&!m.spectator)ws.send(JSON.stringify({t:'game-ready',i:m.instanceId,w:m.w})); } });
    await once(ws, 'open'); ws.send(JSON.stringify({ t: 'join', session, role }));
    await until(() => client.state, role + ' first snapshot'); clients[role] = client; return client;
  }
  async function until(fn, message) {
    for (let n = 0; n < 150; n++) { if (fn()) return; await new Promise(r => setTimeout(r, 10)); }
    throw Error(message);
  }
  async function send(role, a, meta = {}) {
    await until(()=>Object.values(clients).filter(c=>c.ws.readyState===WebSocket.OPEN).every(c=>c.state&&!c.state.preparing),'production preparation release');
    const client = clients[role], before = client.frames.length;
    client.ws.send(JSON.stringify({ t: 'action', a, i: client.state.instanceId, w: client.state.w, ...meta }));
    await until(() => client.frames.slice(before).some(f => f.t === 'qa-ack'), role + ' action acknowledgement');
  }
  const all = predicate => Object.values(clients).every(c => !c.state.preparing && predicate(c.state));
  try {
    await join('artist'); await join('guesser'); await join('other');
    await send('artist', { choose: clients.artist.state.choices[0] });
    await until(() => all(s => s.phase === 'draw'), 'choose draw snapshots');
    const word = clients.artist.state.wordShown;
    const meta = (gestureId, chunk = 0) => ({ inkNonce: clients.artist.state.inkNonce, inkRevision: clients.artist.state.inkRevision, gestureId, chunk });
    await send('artist', { preview: ink, ...meta(1), sample: 1 });
    await until(() => clients.guesser.state.preview, 'preview stream');
    assert.equal(clients.guesser.state.strokes.length, 0);
    await join('watcher');
    assert(clients.watcher.state.spectator);
    assert.equal(clients.watcher.state.word, undefined);
    assert.equal(clients.watcher.state.inkNonce, undefined);
    assert.equal(clients.watcher.state.preview.pts.length, 2); checks += 4;
    const first = { stroke: ink, ...meta(1), finished: false };
    await send('artist', first); await send('artist', first);
    await send('artist', { stroke: ink, ...meta(1, 1), finished: true });
    await until(() => all(s => s.strokes.length === 2), 'two chunk gesture');
    assert.equal(clients.watcher.state.strokes[0].gestureId, clients.watcher.state.strokes[1].gestureId);
    await send('artist', { undo: true, ...meta(1) });
    await until(() => all(s => s.strokes.length === 0), 'undo transport');
    await send('artist', first);
    assert.equal(clients.watcher.state.strokes.length, 0); checks += 2;
    const prior = { preview: ink, ...meta(2), sample: 1 };
    await send('artist', prior);
    await send('artist', { clear: true, ...meta(2) });
    await send('artist', { ...prior, preview: undefined, stroke: ink, finished: true });
    assert.equal(clients.watcher.state.preview, null);
    assert.equal(clients.watcher.state.strokes.length, 0); checks += 2;
    await send('artist', { stroke: ink, ...meta(3), finished: true });
    const oldSocket = clients.artist.ws; oldSocket.close(); await once(oldSocket, 'close');
    await join('artist');
    assert.equal(clients.artist.state.strokes.length, 1);
    assert(clients.artist.state.inkNonce); checks += 2;
    await send('guesser', { guess: 'wrong' });
    await send('guesser', { guess: word.toUpperCase() });
    assert.equal(clients.watcher.state.guesses.at(-1).text, undefined);
    assert(!JSON.stringify(clients.watcher.state.guesses).toLowerCase().includes(word.toLowerCase())); checks += 2;
    await send('other', { guess: word });
    await until(() => all(s => s.phase === 'reveal'), 'reveal transport');
    assert.equal(clients.watcher.state.word, word);
    await send('artist', { next: true });
    await until(() => all(s => s.phase === 'done'), 'done transport'); checks += 2;
    const instance = clients.artist.state.instanceId;
    clients.artist.ws.send(JSON.stringify({ t: 'qa-rematch' }));
    await until(() => all(s => s.instanceId !== instance), 'rematch transport');
    const role = Object.keys(clients).find(role => clients[role].state.choices);
    await send(role, { choose: clients[role].state.choices[0] });
    await send(role, { stroke: ink, ...first, inkNonce: first.inkNonce }, { i: instance });
    assert.equal(clients[role].state.strokes.length, 0);
    assert.notEqual(clients[role].state.inkNonce, first.inkNonce); checks += 2;
    // The actual host seat may leave; remaining players keep their match alive.
    const host = Object.values(clients).find(c => c.state.players[0].id === c.state.you);
    host.ws.close(); await once(host.ws, 'close');
    const remaining = Object.values(clients).filter(c => c.ws.readyState === WebSocket.OPEN);
    assert(remaining.length >= 2);
    remaining[0].ws.send(JSON.stringify({t:'qa-expire',i:remaining[0].state.instanceId,w:remaining[0].state.w}));
    await until(()=>remaining.every(c=>!c.state.preparing&&c.state.phase==='reveal'),'host-left deadline continues');
    remaining[0].ws.send(JSON.stringify({t:'qa-advance',i:remaining[0].state.instanceId,w:remaining[0].state.w}));
    await until(()=>remaining.every(c=>c.state.phase==='done'),'host-left auto finish continues'); checks += 3;
  } finally {
    for (const client of Object.values(clients)) client.ws.terminate();
    await fetch(base + '/close?session=' + session, { method: 'POST' });
    await new Promise(resolve => server.close(resolve));
  }
  console.log(`DOODLE_TRANSPORT_PASS: ${checks} real WebSocket multi-client choose/draw/guess/reveal/done/rematch/watch/reconnect checks`);
}
main().catch(e => { console.error(e); process.exitCode = 1; });

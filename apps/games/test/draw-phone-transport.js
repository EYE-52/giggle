'use strict';
// Real Room/WebSocket clients; native browser evidence is captured separately.
const assert = require('node:assert/strict');
const { once } = require('node:events');
const WebSocket = require('ws');
const { createServer } = require('./draw-phone-browser');
const ink = { pts: [[.1, .2], [.7, .2]], color: '#111111', size: 7 };
function checkTelephoneAssignments() {
  const game = require('../games/draw-phone/server');
  const random = Math.random;
  let seed = 937;
  Math.random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  try {
    for (let count = 3; count <= 12; count++) {
      for (let run = 0; run < 10; run++) {
        let now = 0;
        const players = Array.from({length: count}, (_, i) => ({id: 'seat-' + i}));
        const ctx = {content: () => ({starters: ['Starter']}), allPlayers: () => players,
          players: () => players, now: () => now, later() {}, award() {}};
        const state = game.create(ctx);
        for (const player of players) game.onAction(state, ctx, player.id, {phrase: player.id});
        now = state.endsAt;
        game.onAction(state, ctx, players[0].id, {});
        assert.equal(new Set(Object.values(state.guessAssign)).size, count, 'Every drawing is captioned once');
        for (const player of players) {
          const drawer = state.guessAssign[player.id];
          assert.equal(new Set([player.id, drawer, state.drawAssign[drawer]]).size, 3,
            'Captioner cannot see their own drawing or their own original phrase');
        }
      }
    }
  } finally { Math.random = random; }
}
async function main() {
  checkTelephoneAssignments();
  const server = createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = 'http://127.0.0.1:' + server.address().port;
  const { session } = await (await fetch(base + '/session')).json();
  const clients = {}; let checks = 0;
  async function until(fn, message) {
    for (let n = 0; n < 150; n++) { if (fn()) return; await new Promise(r => setTimeout(r, 10)); }
    throw Error(message);
  }
  async function join(role) {
    const ws = new WebSocket(base.replace('http', 'ws') + '/socket');
    const c = { ws, state: null, frames: [] };
    ws.on('message', text => { const m = JSON.parse(text); c.frames.push(m); if (m.t === 'state') { c.state = m; if(m.preparing&&!m.spectator)ws.send(JSON.stringify({t:'game-ready',i:m.instanceId,w:m.w})); } });
    await once(ws, 'open'); ws.send(JSON.stringify({ t: 'join', session, role }));
    await until(() => c.state, role + ' first snapshot'); clients[role] = c; return c;
  }
  async function send(role, a, meta = {}) {
    await until(()=>Object.values(clients).filter(c=>c.ws.readyState===WebSocket.OPEN).every(c=>c.state&&!c.state.preparing),'production preparation release');
    const c = clients[role], before = c.frames.length;
    c.ws.send(JSON.stringify({ t: 'action', a, i: c.state.instanceId, w: c.state.w, ...meta }));
    await until(() => c.frames.slice(before).some(f => f.t === 'qa-ack'), role + ' acknowledgement');
  }
  const all = fn => Object.values(clients).filter(c => c.ws.readyState === WebSocket.OPEN).every(c => !c.state.preparing && fn(c.state));
  const meta = (role, gestureId, chunk = 0) => ({ inkNonce: clients[role].state.inkNonce, inkRevision: clients[role].state.inkRevision, gestureId, chunk });
  try {
    for (const role of ['first','second','third']) await join(role);
    for (const role of ['first','second','third']) await send(role, { phrase: 'Private story from ' + role });
    await until(() => all(s => s.phase === 'draw'), 'draw opens');
    await join('watcher');
    assert(clients.watcher.state.spectator);
    assert(!clients.watcher.state.inkNonce && !clients.watcher.state.myPrompt && clients.watcher.state.myStrokes.length === 0); checks += 2;
    assert.notEqual(clients.first.state.inkNonce, clients.second.state.inkNonce); checks++;
    const first = { stroke: ink, ...meta('first',1), finished: false };
    await send('first', first); await send('first', first);
    const end = { stroke: ink, ...meta('first',1,1), finished: true };
    await send('first', end);
    assert.equal(clients.first.state.myStrokes.length,2);
    assert.equal(clients.second.state.myStrokes.length,0); checks += 2;
    await send('first', { undo: true, ...meta('first',1) }); await send('first',end);
    assert.equal(clients.first.state.myStrokes.length,0); checks++;
    const prior = { preview: ink, ...meta('first',2), sample:1 };
    await send('first',prior);
    await send('first',{clear:true,...meta('first',2)});
    await send('first',{...prior,preview:undefined,stroke:ink,finished:true});
    assert.equal(clients.first.state.myStrokes.length,0); checks++;
    await send('first',{stroke:ink,...meta('first',3),finished:true});
    const nonce = clients.first.state.inkNonce;
    clients.first.ws.close(); await once(clients.first.ws,'close'); await join('first');
    assert.equal(clients.first.state.myStrokes.length,1); assert.equal(clients.first.state.inkNonce,nonce); checks += 2;
    for (const role of ['second','third']) await send(role,{stroke:ink,...meta(role,1),finished:true});
    // An in-progress private preview is retained once at the drawing deadline.
    await send('first',{preview:ink,...meta('first',4),sample:1});
    clients.second.ws.send(JSON.stringify({t:'qa-expire',i:clients.second.state.instanceId,w:clients.second.state.w}));
    await until(() => all(s => s.phase === 'guess'),'caption opens');
    assert(!clients.first.state.inkNonce && !clients.first.state.myPrompt);
    assert.equal(clients.watcher.state.myDrawing.length,0);
    assert(Object.values(clients).some(c=>c.state.myDrawing?.length===2)); checks += 3;
    for (const role of ['first','second','third']) await send(role,{guess:'Caption from '+role});
    await until(() => all(s=>s.phase==='reveal'),'reveal opens');
    assert.equal(clients.watcher.state.chains.length,3); checks++;
    for (const chain of clients.watcher.state.chains) {
      assert.equal(new Set([chain.origin, chain.drawBy, chain.guessBy]).size, 3,
        'Each telephone book must pass through three different players'); checks++;
    }
    const oldHost = Object.keys(clients).find(role=>clients[role].state.you===clients[role].state.hostId);
    clients[oldHost].ws.close(); await once(clients[oldHost].ws,'close');
    await until(()=>Object.values(clients).filter(c=>c.ws.readyState===WebSocket.OPEN).every(c=>c.state.hostId!==clients[oldHost].state.you),'host migrates');
    const newHost=Object.keys(clients).find(role=>clients[role].ws.readyState===WebSocket.OPEN&&clients[role].state.you===clients[role].state.hostId);
    assert(newHost && newHost!=='watcher');
    await send(newHost,{next:true}); assert.equal(clients[newHost].state.revealIdx,1);
    await send(newHost,{prev:true}); assert.equal(clients[newHost].state.revealIdx,0); checks += 3;
    await send('watcher',{next:true}); assert.equal(clients[newHost].state.revealIdx,0); checks++;
    for(let n=1;n<=3;n++)await send(newHost,{next:true});
    await until(()=>all(s=>s.phase==='done'),'new host finishes stories'); checks++;
    const old=clients[newHost].state; clients[newHost].ws.send(JSON.stringify({t:'qa-rematch'}));
    await until(()=>all(s=>s.instanceId!==old.instanceId),'rematch');
    assert(all(s=>s.phase==='write')); await send(newHost,{phrase:'stale private phrase'},{i:old.instanceId,w:old.w});
    assert.equal(clients[newHost].state.myPhrase,''); checks += 2;
    console.log('DRAW_PHONE_TRANSPORT_PASS:',checks,'real WebSocket privacy, gesture undo/revision, deadline, reconnect, host migration, replay and rematch checks');
  } finally {
    for (const c of Object.values(clients)) c.ws.close();
    await fetch(base+'/close?session='+session,{method:'POST'});
    await new Promise(r=>server.close(r));
  }
}
main().catch(e=>{console.error(e);process.exitCode=1;});

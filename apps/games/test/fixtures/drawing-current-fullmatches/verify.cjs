'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { spawnSync } = require('node:child_process');
const WebSocket = require('ws');
const { createServer } = require('../../drawing-current-fullmatches-browser');

async function verify() {
  let checks = 0;
  const ok = (v, m) => { assert(v, m); checks++; };
  const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'drawing-full-verify-'));
  const server = createServer(directory), peers = [];
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = 'http://127.0.0.1:' + server.address().port;
  async function until(fn, timeout = 5000) { const end = Date.now() + timeout; while (Date.now() < end) { if (fn()) return; await new Promise(r => setTimeout(r, 5)); } throw Error('Drawing transport condition timed out'); }
  async function join(session, role) {
    const p = { role, state: null, receipts: [], messages: [], ws: new WebSocket(base.replace('http', 'ws') + '/socket') };
    p.ws.on('message', text => { const m = JSON.parse(text); p.messages.push(m); if (m.t === 'state') p.state = m; if (m.t === 'qa-ack') p.receipts.push(m); });
    await once(p.ws, 'open'); p.ws.send(JSON.stringify({ t: 'join', session, role })); await until(() => p.state); peers.push(p); return p;
  }
  let sequence = 0;
  async function action(p, a, meta = {}) { const qaId = ++sequence; p.ws.send(JSON.stringify({ t: 'action', a, i: p.state.instanceId, w: p.state.w, qaId, ...meta })); await until(() => p.receipts.some(r => r.qaId === qaId)); return p.receipts.find(r => r.qaId === qaId); }
  async function release(ps, count = 3) { await until(() => ps.every(p => p.state.preparing)); for (const p of ps.slice(0, count)) p.ws.send(JSON.stringify({ t: 'game-ready', i: p.state.instanceId, w: p.state.w })); await until(() => ps.every(p => !p.state.preparing)); }
  try {
    for (const route of ['/', '/client', '/qa/client.mjs', '/qa/hub.mjs', '/js/game-host.js', '/js/toolkit/result-presentation.mjs', '/css/issues.css']) {
      const response = await fetch(base + route), body = await response.text(); eq(response.status, 200, route + ' serves');
      if (route.endsWith('.mjs') || route.endsWith('.js')) { ok(response.headers.get('content-type').includes('javascript'), route + ' module MIME'); const parsed = spawnSync(process.execPath, ['--check', '--input-type=module'], { input: body, encoding: 'utf8' }); eq(parsed.status, 0, route + ' syntax ' + parsed.stderr); }
      if (route === '/client') ok(body.includes('game-report-icon') && body.includes('issues.css') && body.includes('src="/qa/client.mjs"'), 'Client uses extracted production Report and module');
    }
    for (const game of ['doodle-guess', 'draw-phone']) {
      const data = await (await fetch(base + '/session?game=' + game + '&hints=off', { method: 'POST' })).json();
      const ps = await Promise.all(data.roles.map(r => join(data.session, r)));
      ok(ps.every(p => p.state.preparing), game + ' initial real readiness holds'); ok(ps[3].state.spectator, game + ' actual late watcher');
      const premature = game === 'doodle-guess' ? { choose: ps.find(p => p.state.choices)?.state.choices[0] } : { phrase: 'too early' };
      eq((await action(ps[0], premature)).accepted, false, game + ' preparation rejects action');
      ps[3].ws.send(JSON.stringify({ t: 'game-ready', i: ps[3].state.instanceId, w: ps[3].state.w })); await release(ps);
      if (game === 'doodle-guess') {
        eq(ps[0].state.hints, false, 'Legal hint configuration reaches projection');
        const drawers = new Set();
        for (let round = 1; round <= 3; round++) {
          const artist = ps.find(p => p.state.you === p.state.drawer), guessers = ps.slice(0, 3).filter(p => p !== artist); drawers.add(artist.role);
          ok((await action(artist, { choose: artist.state.choices[0] })).accepted, 'Real word choice accepted'); await release(ps);
          const word = artist.state.wordShown; for (const p of guessers) ok((await action(p, { guess: word })).accepted, 'Correct guess accepted'); await release(ps);
          eq(ps[0].state.phase, 'reveal', 'Guesses reveal real word'); ok((await action(artist, { next: true })).accepted, 'Released artist advances');
          if (round < 3) await release(ps); else await until(() => ps.every(p => p.state.phase === 'done'));
        }
        eq(drawers.size, 3, 'Three-turn transport match has all original artists');
      } else {
        for (const p of ps.slice(0, 3)) ok((await action(p, { phrase: 'Owned phrase ' + p.role })).accepted, 'Real private phrase accepted'); await release(ps);
        for (const p of ps.slice(0, 3)) ok((await action(p, { stroke: { pts: [[.2, .5], [.8, .5]], color: '#111111', size: 7 }, gestureId: 1, chunk: 0, finished: true, inkNonce: p.state.inkNonce, inkRevision: p.state.inkRevision })).accepted, 'Real private ink accepted');
        const start = Date.now(); await until(() => ps.every(p => p.state.phase === 'guess' && p.state.preparing), 35000); ok(Date.now() - start >= 29000, 'Unmodified production drawing timer actually elapsed'); await release(ps);
        for (const p of ps.slice(0, 3)) ok((await action(p, { guess: 'Actual caption ' + p.role })).accepted, 'Real caption accepted'); await release(ps);
        const host = ps.find(p => p.state.you === p.state.hostId); for (let i = 0; i < 3; i++) ok((await action(host, { next: true })).accepted, 'Actual host advances story'); await until(() => ps.every(p => p.state.phase === 'done'));
        eq(ps[3].state.chains.length, 3, 'Watcher receives completed actual chains');
      }
      const old = { instanceId: ps[0].state.instanceId, window: ps[0].state.w }, host = ps[0];
      // a is the still-connected initial host in this transport-only check.
      host.ws.send(JSON.stringify({ t: 'rematch' })); await until(() => ps.every(p => p.state.instanceId !== old.instanceId && p.state.preparing)); await release(ps, 4);
      ok(ps.every(p => !p.state.spectator && p.state.players.length === 4), game + ' former watcher naturally joins rematch');
      const freshArtist = game === 'doodle-guess' ? ps.find(p => p.state.choices) : ps[0]; const payload = game === 'doodle-guess' ? { choose: freshArtist.state.choices[0] } : { phrase: 'retired' };
      eq((await action(freshArtist, payload, { i: old.instanceId, w: old.window })).accepted, false, game + ' retired instance rejected');
      eq((await action(freshArtist, payload, { w: old.window })).accepted, false, game + ' retired window rejected');
      await fetch(base + '/close?session=' + data.session, { method: 'POST' });
      for (const p of ps) { if (p.ws.readyState !== WebSocket.CLOSED) { p.ws.close(); await once(p.ws, 'close'); } }
    }
    const bad = await fetch(base + '/results?name=../../outside', { method: 'POST', body: '{}' }); eq(bad.status, 400, 'Report name cannot escape fixture directory');
    console.log('DRAWING_CURRENT_FULLMATCHES_TRANSPORT_PASS: ' + checks + ' script/MIME, real WS/readiness/legal flow/natural deadline/rematch/stale assertions; no browser or visual acceptance.');
  } finally {
    await Promise.all(peers.map(p => p.ws.readyState === WebSocket.CLOSED ? Promise.resolve() : new Promise(r => { p.ws.once('close', r); p.ws.close(); })));
    await new Promise(r => server.close(r)); fs.rmSync(directory, { recursive: true, force: true });
  }
}
module.exports = { verify };

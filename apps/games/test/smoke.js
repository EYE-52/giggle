'use strict';
/* Smoke: boot the real server, drive a 3-player room through every
 * registered game (start + a few legal actions), assert snapshots flow.
 * Run: npm test (spawns server on a scratch port). */
const { spawn } = require('child_process');
const path = require('path');
const WebSocket = require('ws');
const expectedGames = require('../games/registry').list().map(g => g.id).sort();

const PORT = 18233;
const ROOT = path.join(__dirname, '..');

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const srv = spawn('node', ['server/server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  srv.stdout.on('data', (d) => { out += d; });
  srv.stderr.on('data', (d) => { out += d; });
  const fail = (msg) => {
    console.error('SMOKE_FAIL', msg, '\n--- server log ---\n' + out);
    srv.kill();
    process.exit(1);
  };
  for (let i = 0; i < 50 && !out.includes('PartyBox on'); i++) await sleep(100);
  if (!out.includes('PartyBox on')) return fail('server did not boot');

  const mk = () => new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
    ws.msgs = [];
    ws.arrivals = [];
    ws.on('message', (d) => {
      const message = JSON.parse(d);
      ws.msgs.push(message);
      ws.arrivals.push({ at: performance.now(), t: message.t, game: message.game, instanceId: message.instanceId, phase: message.phase });
      if (ws.arrivals.length > 32) ws.arrivals.shift();
    });
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
  const conns = [await mk(), await mk(), await mk(), await mk(), await mk()];
  const [a, b, c, d, e] = conns;
  const send = (ws, o) => ws.send(JSON.stringify(o));
  const last = (ws, t) => [...ws.msgs].reverse().find((m) => m.t === t);

  send(a, { t: 'create', name: 'Ann' });
  await sleep(150);
  const room = last(a, 'room');
  if (!room) return fail('no room snapshot after create');
  const code = room.room.code;
  send(b, { t: 'join', name: 'Bob', code });
  send(c, { t: 'join', name: 'Cat', code });
  send(d, { t: 'join', name: 'Dan', code });
  send(e, { t: 'join', name: 'Eve', code });
  await sleep(200);

  send(a, { t: 'games' });
  await sleep(150);
  const games = last(a, 'games');
  if (!games || !games.games.length) return fail('empty game list');
  console.log('SMOKE games:', games.games.map((g) => g.id).join(','));
  // Auto-discovered board games must appear in the same live catalogue,
  // and every listed game below goes through the real room lifecycle.
  const receivedGames = games.games.map(g => g.id).sort();
  if (JSON.stringify(receivedGames) !== JSON.stringify(expectedGames)) return fail('live catalogue differs from the registered games');
  for (const id of ['chess', 'pocket-karts']) {
    if (!games.games.some((g) => g.id === id)) return fail(`missing game ${id}`);
  }
  const chessMeta = games.games.find((g) => g.id === 'chess');
  if (chessMeta.seats !== 2 || chessMeta.cat !== 'board') return fail('chess metadata wrong');
  const kartsMeta = games.games.find((g) => g.id === 'pocket-karts');
  if (kartsMeta.seats !== 8 || kartsMeta.renderer !== '3d') return fail('karts metadata wrong');

  for (const g of games.games) {
    const previousInstance = last(a, 'state')?.instanceId;
    for (const ws of conns) { ws.msgs = []; ws.arrivals = []; }
    const startAt = performance.now();
    send(a, { t: 'start', game: g.id });
    // Starting a real physics world can exceed a fixed receipt sleep. Await
    // the published fresh instance, without granting readiness or changing
    // the game's clocks; a missing state still fails within five seconds.
    let st;
    while (performance.now() - startAt < 5000) {
      const current = last(a, 'state');
      if (current?.game === g.id && current.instanceId && current.instanceId !== previousInstance) { st = current; break; }
      if (last(a, 'error')) break;
      await sleep(20);
    }
    console.log('SMOKE_START_STATE', JSON.stringify({ game: g.id, elapsedMs: performance.now() - startAt, matched: !!st, arrivals: a.arrivals.map(({ at, ...arrival }) => ({ ...arrival, afterStartMs: at - startAt })) }));
    if (!st || st.game !== g.id) return fail(`no state for ${g.id} (want state, got ${JSON.stringify(last(a, 'error'))})`);
    // A few generic actions must never crash the game.
    for (const [ws, act] of [
      [a, { vote: 'a' }], [b, { guess: 'x' }], [c, { next: true }],
      [d, { text: 'hello' }], [e, { tap: true }],
    ]) {
      send(ws, { t: 'action', a: act });
    }
    await sleep(250);
    const st2 = last(a, 'state');
    if (!st2 || st2.game !== g.id || st2.instanceId !== st.instanceId) return fail(`state broke for ${g.id}`);
    send(a, { t: 'lobby' });
    await sleep(150);
    console.log('SMOKE ok:', g.id);
  }
  for (const ws of conns) ws.close();
  srv.kill();
  console.log('SMOKE_PASS');
}

main().catch((e) => {
  console.error('SMOKE_FAIL', e);
  process.exit(1);
});

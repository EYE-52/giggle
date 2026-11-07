// Client-side smoothness probe for Pocket Karts. Runs the real Room and bot
// drivers in-process, delivers one observer's frames through a simulated
// network link (default 42 ms each way, jitter and rare spikes, in order like
// TCP), and drives the shipping browser prediction module at 60 fps.
// Usage: node tools/realtime/client-sim.mjs [drivers=8] [seconds=12] [oneWayMs=42] [jitterMs=8]
// Reports self correction pops, per-frame jerk, remote error against server
// truth, remote stalls, and bytes per second at the observer.
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';
import RAPIER from '@dimforge/rapier3d-compat';
import { createKartBot } from './kart-bot.mjs';
import { createClassicPrediction } from '../../public/js/engines/kart-classic-prediction.mjs';
const require = createRequire(import.meta.url);
const { Room } = require('../../server/room.js');
const pocket = require('../../games/pocket-karts/server.js');
let decodeFrame = null;
try { ({ decodeFrame } = await import('../../public/js/toolkit/realtime/client.mjs')); } catch { /* baseline build */ }

const drivers = Number(process.argv[2] || 8), seconds = Number(process.argv[3] || 12);
const oneWay = Number(process.argv[4] || 42), jitter = Number(process.argv[5] ?? 8);
const map = process.argv[6] || 'Garden Circuit';
await RAPIER.init(); await pocket.initialize();
let seed = 7; const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const gauss = () => Math.sqrt(-2 * Math.log(rand() || 1e-9)) * Math.cos(2 * Math.PI * rand());
const delay = () => Math.max(2, oneWay + gauss() * jitter + (rand() < .03 ? 30 + rand() * 40 : 0));

const room = new Room('SIM1', {});
const seats = [];
function socket(observer) {
  const s = { readyState: 1, bufferedAmount: 0, last: null, bytes: 0, queue: [], lastDue: 0,
    send(data) {
      const n = typeof data === 'string' ? Buffer.byteLength(data) : data.byteLength;
      if (observer) { s.bytes += n; const due = Math.max(s.lastDue, performance.now() + delay()); s.lastDue = due; s.queue.push({ due, data }); }
      if (typeof data === 'string' && data.startsWith('{"t":"state"')) s.last = JSON.parse(data);
      else if (typeof data !== 'string' && decodeFrame) s.last = s.decoder(data) || s.last;
    }, close() { s.readyState = 3; } };
  if (decodeFrame) { const d = decodeFrame(); s.decoder = data => d.apply(data, s.last); }
  return s;
}
for (let i = 0; i < drivers; i++) {
  const sock = socket(i === 0), r = room.addPlayer('Driver ' + (i + 1), sock, undefined);
  if (decodeFrame && process.env.RT !== '0') sock.realtime = 'rt1';
  seats.push({ id: r.player.id, socket: sock, seq: 0, bot: createKartBot(r.player.id, i === 0 ? rand : Math.random) });
}
const start = room.startGame(pocket, { settings: { map, mode: 'Zap Battle', winRule: 'Time limit', roundSeconds: 180 } }, seats[0].id);
if (start.error) throw Error(start.error);

// Observer client state: decoded snapshots, prediction, pending input queue.
const me = seats[0], client = { S: null, decoder: decodeFrame ? decodeFrame({ eventDeltas: true }) : null, inputs: [] };
let prediction = null, intent = { steer: 0, throttle: 0, boost: false, drift: false, nitro: false };
const metrics = { pops: [], selfJerk: [], remoteJerk: [], remoteErr: [], remoteLagMs: [], stalls: 0, remoteFrames: 0, ingests: 0, snapshotGaps: [] };
const hist = new Map(); let lastIngest = 0;
const t0 = performance.now(); let lastFrame = t0, sentAt = 0;
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return +(s[Math.min(s.length - 1, Math.floor(p * s.length))] || 0).toFixed(3); };
function track(key, pos, list) {
  const h = hist.get(key) || []; h.push(pos); if (h.length > 3) h.shift(); hist.set(key, h);
  if (h.length === 3) list.push(Math.hypot(h[2].x - 2 * h[1].x + h[0].x, h[2].z - 2 * h[1].z + h[0].z));
  return h;
}
await new Promise(resolve => {
  const loop = setInterval(() => {
    const now = performance.now(), serverNow = Date.now();
    room.onTick(serverNow);
    // Other bots act on their own (undelayed) last view.
    for (const seat of seats.slice(1)) {
      const v = seat.socket.last; if (!v?.inputAck || v.phase !== 'drive') continue;
      room.onAction(seat.socket, { input: seat.bot(v, serverNow), seq: ++seat.seq, life: v.inputAck.life, controlEpoch: v.inputAck.controlEpoch }, { i: v.instanceId, w: v.w });
    }
    // Deliver due frames to the observer.
    const q = me.socket.queue;
    while (q.length && q[0].due <= now) {
      const { data } = q.shift();
      let S = null;
      if (typeof data === 'string') { const m = JSON.parse(data); if (m.t === 'state') S = m; }
      else S = client.decoder.apply(data, client.S);
      if (!S) continue;
      client.S = S; metrics.ingests++;
      if (lastIngest) metrics.snapshotGaps.push(now - lastIngest); lastIngest = now;
      if (!prediction && S.motionProfile) prediction = createClassicPrediction(RAPIER);
      if (prediction) {
        const before = prediction.frame(S, intent, 0, now, serverNow);
        prediction.ingest(S, now, serverNow);
        const after = prediction.frame(S, intent, 0, now, serverNow);
        if (before && after && S.phase === 'drive') metrics.pops.push(Math.hypot(after.x - before.x, after.z - before.z));
      }
    }
    const S = client.S;
    // Observer input: bot on the client's view, sent through the uplink delay.
    if (S?.inputAck && S.phase === 'drive' && now - sentAt >= 33) {
      sentAt = now; const next = me.bot(S, serverNow); intent = { ...next, drift: false, nitro: false };
      const msg = { input: next, seq: ++me.seq, life: S.inputAck.life, controlEpoch: S.inputAck.controlEpoch };
      prediction?.sent(msg.seq);
      client.inputs.push({ due: now + delay(), msg, meta: { i: S.instanceId, w: S.w } });
    }
    while (client.inputs.length && client.inputs[0].due <= now) { const x = client.inputs.shift(); room.onAction(me.socket, x.msg, x.meta); }
    // 60 fps render.
    if (now - lastFrame >= 16.6 && prediction && S?.phase === 'drive') {
      const dt = (now - lastFrame) / 1000; lastFrame = now;
      const self = prediction.frame(S, intent, dt, now, serverNow);
      if (self) track('self', self, metrics.selfJerk);
      const truth = new Map(room.game.state.karts.map(k => [k.pid, k]));
      for (const k of S.karts) {
        if (k.pid === me.id) continue;
        const r = prediction.remote(k.pid, now, serverNow), t = truth.get(k.pid);
        if (!r || !t || t.respawn > 0) { hist.delete(k.pid); continue; }
        const h = track(k.pid, r, metrics.remoteJerk); metrics.remoteFrames++;
        if (h.length >= 2 && Math.abs(t.speed) > 3 && Math.hypot(h.at(-1).x - h.at(-2).x, h.at(-1).z - h.at(-2).z) < 1e-4) metrics.stalls++;
        const err = Math.hypot(r.x - t.x, r.z - t.z); metrics.remoteErr.push(err);
        if (Math.abs(t.speed) > 5) metrics.remoteLagMs.push(err / Math.abs(t.speed) * 1000);
      }
    } else if (now - lastFrame >= 16.6) lastFrame = now;
    if (now - t0 > (seconds + 3.5) * 1000) { clearInterval(loop); resolve(); }
  }, 2);
});
const elapsed = (performance.now() - t0) / 1000;
console.log(JSON.stringify({
  drivers, oneWayMs: oneWay, jitterMs: jitter, mode: me.socket.realtime ? 'realtime' : 'json',
  observerKBps: +(me.socket.bytes / elapsed / 1024).toFixed(1),
  snapshotGapMs: { p50: pct(metrics.snapshotGaps, .5), p95: pct(metrics.snapshotGaps, .95) },
  selfPopM: { p50: pct(metrics.pops, .5), p95: pct(metrics.pops, .95), max: pct(metrics.pops, 1) },
  selfJerkM: { p95: pct(metrics.selfJerk, .95), p99: pct(metrics.selfJerk, .99) },
  remoteJerkM: { p95: pct(metrics.remoteJerk, .95), p99: pct(metrics.remoteJerk, .99) },
  remoteErrM: { p50: pct(metrics.remoteErr, .5), p95: pct(metrics.remoteErr, .95) },
  remoteLagMs: { p50: pct(metrics.remoteLagMs, .5), p95: pct(metrics.remoteLagMs, .95) },
  remoteStallPct: +(100 * metrics.stalls / Math.max(1, metrics.remoteFrames)).toFixed(2),
}));
prediction?.dispose(); pocket.dispose(room.game.state); process.exit(0);

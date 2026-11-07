// Real-time profile for Pocket Karts: an in-process Room with fake sockets,
// the shipping Rapier motion core and bot drivers. Prints server tick cost,
// per-recipient snapshot bytes and send rate for N drivers on a classic map.
// Usage: node tools/realtime/profile.mjs [drivers=8] [seconds=10] [map="Garden Circuit"]
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';
import { createKartBot } from './kart-bot.mjs';
const require = createRequire(import.meta.url);
const { Room } = require('../../server/room.js');
const pocket = require('../../games/pocket-karts/server.js');

const drivers = Number(process.argv[2] || 8), seconds = Number(process.argv[3] || 10);
const map = process.argv[4] || 'Garden Circuit';
// RT=0 profiles the JSON transport; otherwise sockets take 'rt1' binary frames.
const rt = process.env.RT !== '0';
const { decodeFrame } = await import('../../public/js/toolkit/realtime/client.mjs');
await pocket.initialize();

const sockets = [];
function fakeSocket(name) {
  const s = { name, readyState: 1, bufferedAmount: 0, frames: 0, bytes: 0, binary: 0, last: null, decoder: rt ? decodeFrame() : null,
    ...(rt ? { realtime: 'rt1' } : {}),
    pending: [],
    // Count bytes now; decode later, outside the timed broadcast.
    send(data) { s.frames++; const n = typeof data === 'string' ? Buffer.byteLength(data) : data.byteLength; s.bytes += n;
      if (typeof data !== 'string') s.binary++; s.pending.push(data); },
    drain() { for (const data of s.pending) { if (typeof data !== 'string') s.last = s.decoder.apply(data) || s.last; else if (data.startsWith('{"t":"state"')) s.last = JSON.parse(data); } s.pending = []; },
    close() { s.readyState = 3; } };
  sockets.push(s); return s;
}
const room = new Room('PROF', {});
const seats = [];
for (let i = 0; i < drivers; i++) {
  const r = room.addPlayer('Driver ' + (i + 1), fakeSocket('d' + i));
  if (r.error) throw Error(r.error);
  seats.push({ player: r.player, socket: sockets.at(-1), seq: 0, bot: createKartBot(r.player.id) });
}
const start = room.startGame(pocket, { settings: { map, mode: 'Zap Battle', winRule: 'Time limit', roundSeconds: 180 } }, seats[0].player.id);
if (start.error) throw Error(start.error);

const tickCosts = [], sendCosts = [];
const originalTick = pocket.onTick;
let inBroadcast = 0;
const roomBroadcast = room.broadcastState.bind(room);
room.broadcastState = opts => { const t = performance.now(); roomBroadcast(opts); sendCosts.push(performance.now() - t); inBroadcast++; };

const t0 = Date.now(); let ticks = 0;
for (const s of sockets) { s.frames = 0; s.bytes = 0; }
await new Promise(resolve => {
  const pump = setInterval(() => {
    const now = Date.now();
    for (const seat of seats) {
      seat.socket.drain();
      const v = seat.socket.last; if (!v?.inputAck || v.phase !== 'drive') continue;
      room.onAction(seat.socket, { input: seat.bot(v, now), seq: ++seat.seq, life: v.inputAck.life, controlEpoch: v.inputAck.controlEpoch }, { i: v.instanceId, w: v.w });
    }
    const before = room.game.nextTickAt, t = performance.now();
    room.onTick(now);
    if (room.game.nextTickAt !== before && room.game.state.phase === "drive") { tickCosts.push(performance.now() - t); ticks++; }
    if (now - t0 > seconds * 1000 + 3000) { clearInterval(pump); resolve(); }
  }, 5);
});
const elapsed = (Date.now() - t0) / 1000;
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))] || 0; };
const avg = a => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
const per = sockets.map(s => s.bytes / elapsed), frames = sockets.map(s => s.frames / elapsed);
sockets[0].drain(); const sample = sockets[0].last;
const kartBytes = sample ? Buffer.byteLength(JSON.stringify(sample.karts)) : 0;
const mapBytes = sample ? Buffer.byteLength(JSON.stringify(sample.map)) : 0;
const out = {
  drivers, map, seconds: +elapsed.toFixed(1), tickHz: +(ticks / elapsed).toFixed(1),
  tickMs: { avg: +avg(tickCosts).toFixed(2), p95: +pct(tickCosts, .95).toFixed(2), max: +Math.max(...tickCosts).toFixed(2) },
  tickMsPerKart: +(avg(tickCosts) / drivers).toFixed(3),
  sendMsPerTick: +avg(sendCosts).toFixed(2),
  framesPerSecPerClient: +avg(frames).toFixed(1),
  kbPerSecPerClient: +(avg(per) / 1024).toFixed(1),
  kbPerSecServerOut: +(per.reduce((a, b) => a + b, 0) / 1024).toFixed(0),
  binaryFrames: sockets.reduce((a, s) => a + s.binary, 0),
  lastSnapshotBytes: sample ? Buffer.byteLength(JSON.stringify(sample)) : null,
  lastKartsBytes: kartBytes, lastMapBytes: mapBytes,
  avgSpeed: sample ? +avg(sample.karts.map(k => Math.abs(k.speed))).toFixed(1) : 0, phase: sample?.phase,
};
console.log(JSON.stringify(out));
pocket.dispose(room.game.state);
process.exit(0);

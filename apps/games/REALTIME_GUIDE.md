# Real-time layer

A shared transport for action games: binary snapshot frames, JSON deltas,
interest management, an adaptive tick rate on the server, and an adaptive
interpolation buffer plus prediction helpers in the browser. Pocket Karts
(classic arenas) runs on it. Turn-based and party games don't need it; their
JSON `state` messages stay as they are.

| Piece | File | Runs on |
| --- | --- | --- |
| Wire codec (delta, patch, binary records, frames) | `public/js/toolkit/realtime/codec.mjs` | both |
| Interest tiers | `public/js/toolkit/realtime/interest.mjs` | both |
| Channel + tick governor | `server/realtime.js` | server |
| Frame decoder, interpolation buffer, input history | `public/js/toolkit/realtime/client.mjs` | browser |
| Load fixtures | `tools/realtime/profile.mjs`, `client-sim.mjs`, `kart-bot.mjs` | node |

## How a frame is built

Each tick, `Room.broadcastState` asks the game for a real-time spec. If the
game has one, every socket that advertised the `rt1` capability gets a
binary frame and the other sockets get the old JSON message:

1. **Public view, once per tick.** `spec.publicView(state)` plus the room
   envelope (players, totals, clocks). It is snapshotted through JSON, so the
   history holds exactly what the JSON transport would have sent.
2. **Streams, once per tick.** Every entity in a stream (`karts`) whose
   schema fields are all present is packed into a fixed-size binary record
   (75 bytes for a kart, against about 1.4 KB of JSON). Those fields are
   removed from the JSON copy and the entity is marked `$rt`.
3. **Delta, once per tick.** The stripped public view is diffed against the
   previous tick. Keyed arrays (`id`/`pid`) diff per item, so a new combat
   event costs one item rather than the whole list.
4. **Per socket.** The shared patch (or a patch from an older base if the
   socket skipped frames, or a keyframe), the socket's private fields
   (`privateView`), and the entity records that interest management makes
   due this tick.

The browser decoder (`decodeFrame`) rebuilds exactly the object the JSON
transport would have delivered, plus `rtAge` on streamed entities that were
not updated this frame. `app.js` passes it to `onMsg` like any other
`state` message, so views and frame games never see the transport.

Interest tiers (`interest.mjs`): for each recipient, the 10 nearest
entities (or anything within 28 m) update every tick, the next 8 (or within
60 m) every 2nd tick, the rest every 4th, staggered so the work spreads
evenly. An entity whose JSON half changed (respawn, new life) always ships
its record that tick. Spectators without a kart get everything at half rate.

The tick governor (`createTickGovernor`) starts a room at `tickRate.target`
(33 ms, about 30 Hz) and steps it to 40, 50 or 66 ms when the room's own tick
plus broadcast takes more than half the interval, or when the process is
busy more than 55% of wall time. It steps back once both are calm, and
changes level at most once a second. The server pump runs every 5 ms so a
33 ms cadence stays even.

## Adopting it in a game

Server (`games/<id>/server.js`):

```js
const MY_STREAM = {
  path: 'players', key: 'id',            // array in the view, and its key
  fields: [
    ['x', 'f32'], ['y', 'f32'],          // float32
    ['vx', 'i16', 0.01], ['vy', 'i16', 0.01],   // scaled ints: round(v / scale)
    ['angle', 'i16', Math.PI / 32767],
    [['jumping', 'crouched'], 'bits'],   // up to 8 booleans in one byte
  ],
};
module.exports = {
  // ...the usual definition...
  tickRate: { target: 33, max: 66 },     // adaptive 30 Hz (or state => rate | null)
  realtime: state => ({
    streams: [MY_STREAM],
    publicView: state => view(state, null),        // built once per tick
    privateView: (state, pid) => ({ hand: state.hands[pid] }), // per recipient
  }),                                    // interest focus: your own entity (key === pid)
};
```

Return `null` from `realtime(state)` to keep JSON for that state (Pocket
Karts does this for elevated arenas). Field types: `f32`, `f64`, `i8`, `u8`,
`i16`, `u16`, `u32`, `quat` (unit quaternion as 4 x i16), `bits`, and `list`
(`[path, 'list', {count, fields}]` for fixed arrays such as wheels). An
entity missing any field travels as plain JSON.

`publicView` must not depend on the recipient. Anything that does (your own
hand, input acks, wallet) goes in `privateView`, which is merged on top.

Client: nothing to do for transport. For smooth motion use the helpers:

```js
import { createInterpolationBuffer, createInputHistory, reconcile } from '/js/toolkit/realtime/client.mjs';
const remotes = createInterpolationBuffer();
// on each snapshot
remotes.observe(state.simAt, serverNow());
for (const p of state.players) if (p.id !== state.you) remotes.push(p.id, state.simAt - (p.rtAge || 0), p, { life: p.life });
// each rendered frame
const now = serverNow(); remotes.advance(now);
const pose = remotes.sample(id, now, (a, b, t, ahead) => ({ x: a.x + (b.x - a.x) * t + b.vx * ahead, y: a.y + (b.y - a.y) * t + b.vy * ahead }));
```

Sample on **server time** (`serverNow()`, the calibrated clock), not local
arrival time: arrival jitter then stops showing up as stutter. The buffer's
delay is one send interval plus the measured spread of sample age, slewed
by at most 6%, so it shrinks on good links and grows on bad ones.

For your own player, record inputs with `createInputHistory()` and, on each
authoritative state, `reconcile({authoritative, ackSeq, history, step})`
replays the unacknowledged inputs with the same step the server runs. Blend
small corrections visually; snap large ones. Pocket Karts does this with its
Rapier world (`kart-classic-prediction.mjs`) and also blends between the
last two fixed physics steps so motion is even at 60, 90 or 120 Hz.

## Measuring

```bash
node tools/realtime/profile.mjs 32 10            # server tick cost, bytes per client
RT=0 node tools/realtime/profile.mjs 8 10        # same on the JSON transport
node tools/realtime/client-sim.mjs 8 12 42 8     # client smoothness at 42 ms one way, 8 ms jitter
node test/realtime-transport.mjs                 # codec, tiers, buffer, governor, decode == JSON
node test/kart-32-browser.cjs                    # 32 drivers in headless Chromium
```

## Measured before and after (2026-11-07)

Pocket Karts, Garden Circuit, bot drivers, this Mac. "Before" is `main` at
3a363c5 (JSON snapshots, 20 Hz); "after" is this layer. Client numbers come
from `client-sim.mjs` with 42 ms each way (the Patna to Singapore link) and
8 ms jitter unless noted.

| 8 drivers | Before | After |
| --- | --- | --- |
| Snapshot rate | 20 Hz | 30 Hz |
| Download per player | 337 KB/s | 33 to 37 KB/s |
| Server upload, whole room | 2.7 MB/s | 0.26 MB/s |
| Server tick incl. broadcast (avg) | 3.4 ms | 1.6 ms |
| Remote karts behind live (p50 / p95) | 117 / 150 ms | 78 / 103 ms |
| Remote kart jerk p99 (8 ms / 20 ms jitter) | 0.24 / 0.70 m | 0.14 / 0.14 m |
| Own kart jerk p95 per frame | 0.21 m | 0.02 m |
| Own kart correction pop (max) | 0 m | 0.06 m |

| 32 drivers | Before | After |
| --- | --- | --- |
| Possible | no (8 karts, 24 seats) | yes |
| Download per player | 1.6 MB/s if it were JSON | 70 to 80 KB/s |
| Server tick incl. broadcast (avg / p95) | 14.4 / 25 ms if it were JSON | 2.3 / 2.8 ms |
| Remote karts behind live (p50) | n/a | 90 ms |
| Own kart jerk p95 | n/a | 0.04 m |
| Headless Chromium, 844x390 @2x, software GL | n/a | about 300 draw calls a frame, the same as 8 drivers (far karts draw as one instanced batch); no errors |

"Jerk" is the second difference of rendered position per 60 fps frame:
how much a kart's motion changes from one frame to the next, which is what
reads as stutter. The own-kart gain comes from blending between the last
two fixed physics steps; before, a 60 Hz display alternated between 0, 1 and
2 physics steps per frame. The remote gain comes from sampling on server
time with an adaptive delay instead of a fixed 100 ms after local arrival.

'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
(async () => {
  const source = fs.readFileSync(path.join(__dirname, '../public/js/server-clock.js'), 'utf8');
  const { createServerClock } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
  let local = 0, wall = 300000;
  const clock = createServerClock({ monotonic: () => local, wallTime: () => wall });
  clock.observe(100000); assert.equal(clock.now(), 100000);
  let req = clock.request(); local = 100;
  assert.equal(clock.accept({ id: 'forged', serverNow: 900000 }), false);
  assert.equal(clock.accept({ id: req.id, serverNow: 100050 }), true);
  assert.equal(clock.now(), 100100); // 50 ms in each direction
  wall = -200000; local = 1100; assert.equal(clock.now(), 101100);
  clock.observe(999999); assert.equal(clock.now(), 101100); // slow snapshots cannot reset it
  req = clock.request(); local = 1300;
  clock.accept({ id: req.id, serverNow: 101260 });
  assert.equal(clock.now(), 101300); // lower-latency previous sample wins
  assert.equal(clock.accept({ id: req.id, serverNow: 999999 }), false); // no replay
  req = clock.request(); local = 1320;
  clock.accept({ id: req.id, serverNow: 101310 }); assert.equal(clock.now(), 101320);
  req = clock.request(); local += 10001;
  assert.equal(clock.accept({ id: req.id, serverNow: 111330 }), false); // stale round trip
  req = clock.request(); assert.equal(clock.accept({ id: req.id, serverNow: Infinity }), false);
  clock.reset(); clock.observe(200000); assert.equal(clock.now(), 200000);
  // Different local wall clocks agree on the same deadline.
  let a = 0, b = 500;
  const ca = createServerClock({ monotonic: () => a, wallTime: () => 1 });
  const cb = createServerClock({ monotonic: () => b, wallTime: () => 90000000 });
  const ra = ca.request(), rb = cb.request(); a += 80; b += 80;
  ca.accept({ id: ra.id, serverNow: 400040 }); cb.accept({ id: rb.id, serverNow: 400040 });
  assert.equal(450000 - ca.now(), 450000 - cb.now());
  console.log('SERVER_CLOCK_PASS: skew, wall jumps, latency, replay, reconnect and shared deadlines');
})().catch(e => { console.error(e); process.exitCode = 1; });

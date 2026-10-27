// Runs in Node and in the isolated browser fixture with the SAME adapter/config.
import RAPIER from '@dimforge/rapier3d-compat';
import CONFIG from '../public/js/engines/kart-physics-config.mjs';
import ADAPTER from '../games/engines/kart-physics.js';
import { PROTOTYPE_SOLIDS } from './fixtures/kart-elevation/layout.mjs';

let ready;
export function initializePhysics() { return ready ||= RAPIER.init(); }
export { RAPIER, CONFIG, ADAPTER };

export async function runPhysicsChecks() {
  await initializePhysics();
  const started = performance.now(), results = [], measurements = {};
  const check = (label, truth) => {
    if (!truth) throw new Error(label);
    results.push(label);
  };
  const throws = (label, fn) => { let thrown = false; try { fn(); } catch { thrown = true; } check(label, thrown); };
  const create = (solids = [PROTOTYPE_SOLIDS[0]]) => {
    const w = ADAPTER.createKartPhysics(RAPIER, CONFIG);
    for (const d of solids) w.addStatic(d);
    return w;
  };
  const step = (w, n) => { for (let i = 0; i < n; i++) w.step(); };
  const spawn = (x = 0, y = 1, z = 0, rotation) => ({ position: { x, y, z }, rotation });
  const validPose = (p) => [p.position, p.rotation, p.linearVelocity, p.angularVelocity].every((v) => Object.values(v).every(Number.isFinite)) && p.wheels.every((w) => [w.length, w.rotation, w.steering].every(Number.isFinite));

  {
    const w = create();
    try {
      w.addKart('driver', spawn()); step(w, 180);
      const a = w.pose('driver'); step(w, 120); const b = w.pose('driver');
      check('four actual grounded suspension wheels identify the floor', b.wheels.length === 4 && b.wheels.every((v) => v.contact && v.surfaceId === 'floor'));
      check('idle suspension supports chassis above ground without persistent drift', b.position.y > 0.5 && b.position.y < 0.9 && Math.abs(a.position.y - b.position.y) < 0.025 && Math.abs(b.position.z - a.position.z) < 0.08);
      check('suspension is compressed by physical weight', b.wheels.every((v) => v.length > 0.1 && v.length < CONFIG.suspension.restLength));
      check('pose is finite plain serializable data', validPose(b) && JSON.stringify(b).length < 3000 && !Object.keys(b).some((k) => /world|handle|body|controller/i.test(k)));
      const copy = w.pose('driver'); copy.position.y = 900; copy.wheels[0].length = 900;
      check('returned pose cannot mutate private body/controller', w.pose('driver').position.y < 1 && w.pose('driver').wheels[0].length < 1);
      w.applyIntent('driver', { steer: 0, throttle: 1 }); step(w, 120);
      const straight = w.pose('driver');
      check('positive throttle drives nose +Z near the shared forward cap', straight.position.z > 12 && Math.abs(straight.position.x) < 0.05 && straight.speed > CONFIG.handling.maxForward * .85 && straight.speed < CONFIG.handling.maxForward);
      w.applyIntent('driver', { steer: 1, throttle: 1 }); step(w, 40);
      const right = w.pose('driver');
      check('driver-right steering turns toward -X at yaw zero', right.position.x < -2 && right.rotation.y < -0.2);
      w.resetKart('driver', spawn()); step(w, 120); w.applyIntent('driver', { steer: 1, throttle: -1 }); step(w, 100);
      const reverse = w.pose('driver');
      check('reverse throttle drives -Z and reverses yaw response', reverse.position.z < -3 && reverse.speed < -2 && reverse.rotation.y > 0.25 && reverse.position.x < -1);
      w.resetKart('driver', spawn()); step(w, 120); w.applyIntent('driver', { steer: 0, throttle: 1 }); step(w, 90);
      const fast = w.pose('driver').speed; w.applyIntent('driver', { steer: 0, throttle: 0, brake: 1 }); step(w, 50);
      check('brake stops physical forward motion', fast > 9 && Math.abs(w.pose('driver').speed) < 0.5);
      const epoch = w.pose('driver').epoch;
      w.applyIntent('driver', { steer: 1, throttle: 1 });
      const reset = w.resetKart('driver', spawn(2, 6, 3));
      check('reset clears velocity, held intent and wheel history', reset.epoch === epoch + 1 && Math.hypot(...Object.values(reset.linearVelocity)) === 0 && reset.wheels.every((v) => !v.contact && v.rotation === 0));
      step(w, 15); const falling = w.pose('driver');
      check('unsupported chassis falls under gravity without scripted y', falling.position.y < 5.7 && falling.linearVelocity.y < -3 && !falling.grounded && Math.abs(falling.position.x - 2) < 0.01 && Math.abs(falling.position.z - 3) < 0.01);
      step(w, 120); check('fall lands and suspension restores support', w.pose('driver').grounded && w.pose('driver').position.y < 0.9);
      check('malformed intent is rejected', w.applyIntent('driver', { throttle: NaN, steer: 1 }) === false);
      throws('non-finite spawn rejected', () => w.resetKart('driver', spawn(0, Infinity, 0)));
      throws('Float32-overflow spawn rejected before body mutation', () => w.resetKart('driver', spawn(0, Number.MAX_VALUE, 0)));
      throws('zero quaternion rejected', () => w.resetKart('driver', spawn(0, 1, 0, { x: 0, y: 0, z: 0, w: 0 })));
      throws('duplicate kart id rejected', () => w.addKart('driver', spawn()));
      throws('variable/invalid time stepping rejected', () => w.step(0.1));
      throws('unbounded catchup rejected', () => w.step(16));
      throws('invalid collider size rejected', () => w.addStatic({ id: 'bad', shape: 'box', half: { x: -1, y: 1, z: 1 }, position: { x: 0, y: 0, z: 0 } }));
      throws('duplicate surface id rejected', () => w.addStatic(PROTOTYPE_SOLIDS[0]));
    } finally { w.dispose(); w.dispose(); }
    check('idempotent disposal clears owned resources', w.stats().disposed && w.stats().karts === 0 && w.stats().statics === 0);
    throws('disposed world rejects step', () => w.step());
  }

  {
    const w = create(PROTOTYPE_SOLIDS);
    try {
      w.addKart('driver', spawn(0, 1, -20)); step(w, 120); w.applyIntent('driver', { steer: 0, throttle: 1 });
      let ramp = false, bridge = false, down = false, maxY = 0, rotated = false, landed = false;
      for (let i = 0; i < 330; i++) {
        w.step(); const p = w.pose('driver'); maxY = Math.max(maxY, p.position.y);
        ramp ||= p.wheels.some((v) => v.surfaceId === 'ramp-up') && p.position.y > 2;
        bridge ||= p.wheels.some((v) => v.surfaceId === 'bridge') && p.position.y > 4;
        down ||= p.wheels.some((v) => v.surfaceId === 'ramp-down');
        rotated ||= Math.abs(p.rotation.x) > 0.06;
        landed ||= p.position.z > 34 && p.grounded && p.position.y < 1;
      }
      measurements.rampMaxChassisY = maxY;
      check('kart physically ascends the +Z closed wedge', ramp && maxY > 4.5);
      check('body orientation responds to ramp slope', rotated);
      check('finite raised deck supports suspension', bridge);
      check('opposite wedge permits descent and ground landing', down && landed);
    } finally { w.dispose(); }
  }

  {
    const w = create(PROTOTYPE_SOLIDS);
    try {
      w.addKart('driver', spawn(18, 1, -20)); step(w, 120); w.applyIntent('driver', { steer: 0, throttle: 1 });
      const flight = []; let landed = false;
      for (let i = 0; i < 280; i++) {
        w.step(); const p = w.pose('driver');
        if (p.position.z > 7 && !p.grounded) flight.push(p);
        if (flight.length && p.grounded && p.position.z > 13 && p.position.y < 1) landed = true;
      }
      measurements.airborneSteps = flight.length;
      check('ramp momentum produces actual unsupported flight', flight.length > 20 && flight.some((p) => p.linearVelocity.y > 0));
      const apex = flight.reduce((a, b) => a.position.y > b.position.y ? a : b);
      measurements.jumpMaxChassisY = apex.position.y;
      check('gravity creates an apex and descending airborne phase', apex.position.y > 3.5 && flight.some((p) => p.linearVelocity.y < -5));
      check('jump lands back on physical floor', landed);
    } finally { w.dispose(); }
  }

  {
    const w = create([PROTOTYPE_SOLIDS[0], PROTOTYPE_SOLIDS[2]]);
    try {
      const upperSupport = w.supportAt({ x: 0, y: 5, z: 13 }, 2), lowerSupport = w.supportAt({ x: 0, y: 2, z: 13 }, 3);
      check('read-only support query distinguishes layers before first step', upperSupport?.surfaceId === 'bridge' && Math.abs(upperSupport.point.y - 4) < 1e-5 && lowerSupport?.surfaceId === 'floor' && Math.abs(lowerSupport.point.y) < 1e-5 && w.stats().tick === 0);
      check('support query obeys caller distance and does not invent ground', w.supportAt({ x: 0, y: 5, z: 13 }, 0.5) === null && w.supportAt({ x: 100, y: 5, z: 13 }, 100) === null);
      w.addKart('lower', spawn(0, 1, 13)); w.addKart('upper', spawn(0, 4.8, 13)); step(w, 180);
      const lower = w.pose('lower'), upper = w.pose('upper');
      check('same x/z supports distinct bridge and underpass layers', lower.wheels.every((v) => v.surfaceId === 'floor') && upper.wheels.every((v) => v.surfaceId === 'bridge') && upper.position.y - lower.position.y > 3.9);
      check('upper/lower chassis do not spuriously collide', Math.abs(upper.position.x) < 0.02 && Math.abs(lower.position.x) < 0.02 && Math.abs(upper.position.z - lower.position.z) < 0.1);
      w.resetKart('lower', spawn(-10, 1, 13, { x: 0, y: Math.SQRT1_2, z: 0, w: Math.SQRT1_2 })); step(w, 120);
      w.applyIntent('lower', { steer: 0, throttle: 1 }); step(w, 120);
      const passed = w.pose('lower');
      check('kart can traverse beneath finite deck', passed.position.x > 7 && passed.position.y < 1 && passed.grounded);
    } finally { w.dispose(); }
  }

  {
    // Roof begins BEFORE the ascending kart reaches it. The collision is
    // with its underside, not a front wall or an artificially dropped kart.
    const roof = { id: 'low-roof', shape: 'deck', half: { x: 5, y: 0.35, z: 11 }, position: { x: 18, y: 3.85, z: 6 } };
    const w = create([PROTOTYPE_SOLIDS[0], PROTOTYPE_SOLIDS[4], roof]);
    try {
      w.addKart('driver', spawn(18, 1, -20)); step(w, 120); w.applyIntent('driver', { steer: 0, throttle: 1 });
      let maxY = 0, maxZ = -20;
      for (let i = 0; i < 280; i++) { w.step(); const p = w.pose('driver'); maxY = Math.max(maxY, p.position.y); maxZ = Math.max(maxZ, p.position.z); }
      check('solid deck underside blocks upward ramp motion', measurements.jumpMaxChassisY > 3.7 && maxY < 3.2 && maxZ > 3 && maxZ < 5);
    } finally { w.dispose(); }
  }

  {
    const wall = { id: 'wall', shape: 'box', half: { x: 8, y: 3, z: 0.5 }, position: { x: 0, y: 3, z: 16 } };
    const w = create([PROTOTYPE_SOLIDS[0], wall]);
    try {
      w.addKart('driver', spawn(0, 1, 0)); step(w, 120); w.applyIntent('driver', { steer: 0, throttle: 1 });
      let maxZ = 0;
      for (let i = 0; i < 240; i++) { w.step(); maxZ = Math.max(maxZ, w.pose('driver').position.z); }
      check('chassis cannot tunnel through static wall', maxZ < 14.1 && w.pose('driver').position.z > 13.5);
      check('pushing against wall keeps all states finite', validPose(w.pose('driver')));
    } finally { w.dispose(); }
    const pair = create();
    try {
      pair.addKart('a', spawn(0, 1, -7)); pair.addKart('b', spawn(0, 1, 7, { x: 0, y: 1, z: 0, w: 0 })); step(pair, 120);
      pair.applyIntent('a', { steer: 0, throttle: 1 }); pair.applyIntent('b', { steer: 0, throttle: 1 });
      let crossed = false, near = false;const contacts=[];
      pair.drainImpacts();
      for (let i = 0; i < 180; i++) { pair.step(); contacts.push(...pair.drainImpacts());const a = pair.pose('a'), b = pair.pose('b'); crossed ||= a.position.z > b.position.z; near ||= b.position.z - a.position.z < 3.2; }
      check('two dynamic chassis meet without passing through each other', near && !crossed);
      check('kart contact leaves finite full body poses', pair.poses().every(validPose));
      check('head-on collision identifies both chassis with a real world contact point',contacts.some(c=>c.ids.includes('a')&&c.ids.includes('b')&&c.surfaceId===null&&Object.values(c.position).every(Number.isFinite)&&c.impulse>100));
      check('consumed collision events are not retained or replayed',pair.drainImpacts().length===0);
    } finally { pair.dispose(); }
  }

  {
    const a = create(), b = create();
    try {
      a.addKart('same-id', spawn()); b.addKart('same-id', spawn()); step(a, 120); step(b, 120);
      const before = b.pose('same-id'); a.applyIntent('same-id', { steer: 0, throttle: 1 }); step(a, 100);
      check('worlds with identical ids remain independent', a.pose('same-id').position.z > 10 && JSON.stringify(before) === JSON.stringify(b.pose('same-id')));
      a.dispose(); step(b, 60);
      check('disposing one world does not invalidate another', b.pose('same-id').grounded && b.stats().tick === 180);
    } finally { a.dispose(); b.dispose(); }
  }

  {
    const w = create();
    try {
      for (let i = 0; i < 8; i++) { w.addKart('p' + i, spawn((i - 3.5) * 6, 1, -30)); w.applyIntent('p' + i, { steer: 0, throttle: 1 }); }
      throws('ninth driver is bounded', () => w.addKart('overflow', spawn()));
      const samples = [];
      for (let i = 0; i < 360; i++) { const start = performance.now(); w.step(); samples.push(performance.now() - start); }
      samples.sort((a, b) => a - b);
      measurements.eightKartStepMs = { p50: samples[Math.floor(samples.length * 0.5)], p95: samples[Math.floor(samples.length * 0.95)], max: samples.at(-1), samples: samples.length };
      check('eight-driver step remains finite', w.poses().length === 8 && w.poses().every(validPose));
    } finally { w.dispose(); }
  }
  {
    const w = create([PROTOTYPE_SOLIDS[0], PROTOTYPE_SOLIDS[2]]);
    try {
      const ray = w.sweepStatic({x:0,y:2,z:13},{x:0,y:6,z:13});
      const ball = w.sweepStatic({x:0,y:2,z:13},{x:0,y:6,z:13},0.25);
      check('v2 ray hits actual finite deck underside', w.apiVersion === 2 && ray?.surfaceId === 'bridge' && ray.normal.y < -0.99);
      check('v2 swept sphere reaches solid before its centre ray', ball?.surfaceId === 'bridge' && ball.fraction < ray.fraction && ball.normal.y < -0.99);
      check('v2 query permits clear underpass and detects occupied hull', w.sweepStatic({x:-10,y:1,z:13},{x:10,y:1,z:13},0.2) === null && w.overlapsStatic({x:0,y:4,z:13}) && !w.overlapsStatic({x:0,y:1,z:13}));
      throws('v2 sweep rejects malformed bounded input', () => w.sweepStatic({x:0,y:NaN,z:0},{x:0,y:1,z:0},0.2));
      throws('v2 tuning rejects unknown and non-finite values', () => w.tuneKart('absent',{top:NaN}));
      w.addKart('driver',spawn(0,6,13)); w.freezeKart('driver',true); const frozen = w.pose('driver'); step(w,120);
      check('v2 freeze holds full airborne pose against gravity', JSON.stringify(w.pose('driver').position) === JSON.stringify(frozen.position) && w.applyIntent('driver',{steer:0,throttle:1}) === false);
      w.freezeKart('driver',false); step(w,120);
      check('v2 unfreeze restores physical gravity and neutral input', w.pose('driver').grounded && w.pose('driver').position.y < 5 && Math.abs(w.pose('driver').speed) < 0.1);
      w.resetKart('driver',spawn(0,1,-12)); w.setKartEnabled('driver',false); step(w,120);
      check('v2 disabled hull has no controller motion or gravity', w.pose('driver').position.y === 1 && !w.pose('driver').grounded);
      w.addKart('rival',spawn(0,1,-20)); step(w,120); w.applyIntent('rival',{steer:0,throttle:1}); step(w,100);
      check('v2 disabled hull is non-solid to a rival', w.pose('rival').position.z > -8);
      w.setKartEnabled('driver',true); w.resetKart('driver',spawn(15,1,-30)); step(w,120);
      w.tuneKart('driver',{top:1.5,engine:1.75,steering:0.75,traction:0.8}); w.applyIntent('driver',{steer:0,throttle:1}); step(w,140);
      check('v2 bounded tuning produces real higher forward speed', w.pose('driver').speed > CONFIG.handling.maxForward * 1.35 && w.pose('driver').speed < CONFIG.handling.maxForward * 1.5);
      throws('v2 tuning rejects non-finite multiplier before mutation', () => w.tuneKart('driver',{top:NaN}));
      throws('v2 tuning rejects out-of-contract key', () => w.tuneKart('driver',{acceleration:1}));
    } finally { w.dispose(); }
    throws('v2 disposed query cannot touch freed world', () => w.sweepStatic({x:0,y:0,z:0},{x:1,y:0,z:0}));
  }
  {
    const w=create();
    try {
      w.addKart('offline',spawn(0,1,0));w.addKart('rival',spawn(0,1,-10));step(w,120);w.freezeKart('offline',true);
      const held=w.pose('offline').position;w.applyIntent('rival',{steer:0,throttle:1});step(w,150);
      check('v2 frozen offline hull remains solid without drifting from contact',distance3(w.pose('offline').position,held)<1e-6&&w.pose('rival').position.z<-3);
    }finally{w.dispose();}
    const a=create(),b=create();
    try {
      for(const w of [a,b]){w.addKart('driver',spawn());step(w,120);w.applyIntent('driver',{steer:1,throttle:1});}
      b.tuneKart('driver',{steering:0.5,traction:0.2});a.step();b.step();
      check('v2 steering tuning changes actual front-wheel steering',Math.abs(b.pose('driver').wheels[0].steering/a.pose('driver').wheels[0].steering-0.5)<1e-6);
      a.tuneKart('driver',{steering:0.5});for(const w of [a,b]){w.resetKart('driver',spawn());step(w,120);w.applyIntent('driver',{steer:1,throttle:1});}
      step(a,150);step(b,150);
      check('v2 traction tuning changes physical turn trajectory while finite',distance3(a.pose('driver').position,b.pose('driver').position)>1&&validPose(a.pose('driver'))&&validPose(b.pose('driver')));
    }finally{a.dispose();b.dispose();}
  }
  return { pass: true, checks: results.length, results, measurements, elapsedMs: performance.now() - started, physicsVersion: 2, configVersion: CONFIG.version, rapierVersion: RAPIER.version() };
}

function distance3(a,b){return Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);}

if (typeof process !== 'undefined' && process.argv?.[1]?.endsWith('/kart-elevation-physics.mjs')) {
  console.log(JSON.stringify(await runPhysicsChecks(), null, 2));
}

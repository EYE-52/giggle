'use strict';
/* {{NAME}} (Game Kit 3D starter): drive a glowing orb, grab dots before the
 * timer ends. Boundaries: this file owns the SIMULATION (positions, dots,
 * scores) and validates intents; the client owns RENDER + INPUT and sends
 * {input:{steer,throttle}} only — the server never trusts coordinates. */

const id = '{{ID}}';
const ARENA = 20;
const BOUND = ARENA - 1;
const MAX_SPEED = 10;
const ACCEL = 14;
const TURN = 2.5;
const PICKUP_R = 1.6;
const MAX_DT = 0.25;

const manifest = {
  name: '{{NAME}}',
  tagline: 'A tiny 3D starter: drive, collect, win',
  howto: 'Steer your orb with WASD/arrows and collect more dots than anyone before time runs out.',
  cat: '3d',
  renderer: '3d',
  layout: 'immersive',
  realtime: true,
  players: { min: 2, max: 8 },
  settings: [
    { key: 'roundSeconds', label: 'Round length (seconds)', type: 'int', min: 30, max: 180, def: 60 },
    { key: 'palette', label: 'Arena palette', type: 'enum', options: ['Daybreak', 'Starlight'], def: 'Daybreak' },
  ],
};

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function create(ctx) {
  const s = (ctx.settings ? ctx.settings() : {}) || {};
  const roundSeconds = Number.isInteger(s.roundSeconds) ? clamp(s.roundSeconds, 30, 180) : 60;
  const palette = s.palette === 'Starlight' ? 'Starlight' : 'Daybreak';
  const drivers = ctx.allPlayers();
  const orbs = drivers.map((p, i) => {
    const a = (i / Math.max(1, drivers.length)) * Math.PI * 2;
    return {
      pid: p.id, x: Math.cos(a) * 8, z: Math.sin(a) * 8,
      angle: a, speed: 0, dots: 0, input: { steer: 0, throttle: 0 },
    };
  });
  return {
    phase: 'drive', // drive -> done
    roundMs: roundSeconds * 1000,
    palette,
    endsAt: ctx.now() + roundSeconds * 1000,
    lastTick: ctx.now(),
    orbs,
    dots: [
      { id: 'd0', x: 0, z: 0 }, { id: 'd1', x: 10, z: 6 },
      { id: 'd2', x: -10, z: 6 }, { id: 'd3', x: 10, z: -6 }, { id: 'd4', x: -10, z: -6 },
    ],
    result: null,
    scores: {},
  };
}

/* Intents only: steer/throttle numbers in [-1,1]. Anything else in the
 * action (x, z, dots…) is ignored — coordinates are never trusted. */
function cleanInput(a) {
  const raw = a && typeof a === 'object' ? a.input : undefined;
  if (!raw || typeof raw !== 'object') return null;
  if (typeof raw.steer !== 'number' || typeof raw.throttle !== 'number' ||
      !Number.isFinite(raw.steer) || !Number.isFinite(raw.throttle)) {
    return { steer: 0, throttle: 0 };
  }
  return { steer: clamp(raw.steer, -1, 1), throttle: clamp(raw.throttle, -1, 1) };
}

function onAction(state, ctx, pid, a) {
  const intent = cleanInput(a);
  if (!intent) return;
  const orb = state.orbs.find((o) => o.pid === pid);
  if (!orb || state.phase === 'done') return false;
  orb.input = intent;
  return false; // input-only: the 10 Hz tick broadcast carries it
}

function onTick(state, ctx) {
  if (state.phase === 'done') return;
  const now = ctx.now();
  const dt = clamp((now - state.lastTick) / 1000, 0, MAX_DT);
  state.lastTick = now;
  const connected = new Set(ctx.players().map((p) => p.id));
  for (const orb of state.orbs) {
    if (!connected.has(orb.pid)) orb.input = { steer: 0, throttle: 0 };
    orb.speed = clamp(orb.speed + ACCEL * orb.input.throttle * dt - orb.speed * 1.5 * dt,
      -MAX_SPEED / 2, MAX_SPEED);
    orb.angle += orb.input.steer * TURN * dt;
    orb.x = clamp(orb.x + Math.sin(orb.angle) * orb.speed * dt, -BOUND, BOUND);
    orb.z = clamp(orb.z + Math.cos(orb.angle) * orb.speed * dt, -BOUND, BOUND);
    for (const dot of state.dots) {
      if (dot.taken) continue;
      const dx = orb.x - dot.x;
      const dz = orb.z - dot.z;
      if (dx * dx + dz * dz < PICKUP_R * PICKUP_R) {
        dot.taken = true;
        orb.dots += 1;
        state.scores[orb.pid] = orb.dots;
      }
    }
  }
  if (now >= state.endsAt || state.dots.every((d) => d.taken)) {
    state.phase = 'done';
    state.endsAt = 0;
    const standings = state.orbs
      .map((o) => ({ pid: o.pid, dots: o.dots }))
      .sort((a, b) => b.dots - a.dots);
    const winner = standings.length && standings[0].dots > 0 ? standings[0].pid : null;
    state.result = { standings, winner };
    for (const r of standings) ctx.award(r.pid, r.dots * 10 + (r.pid === winner ? 50 : 0));
  }
  ctx.broadcast();
}

function view(state, pid) {
  return {
    phase: state.phase,
    palette: state.palette,
    endsAt: state.endsAt,
    youDrive: state.orbs.some((o) => o.pid === pid),
    orbs: state.orbs.map((o) => ({
      pid: o.pid, x: +o.x.toFixed(3), z: +o.z.toFixed(3),
      angle: +o.angle.toFixed(4), dots: o.dots,
    })),
    dots: state.dots.filter((d) => !d.taken).map((d) => ({ id: d.id, x: d.x, z: d.z })),
    scores: { ...state.scores },
    result: state.result,
  };
}

module.exports = { id, minPlayers: 2, maxPlayers: 8, manifest, create, onAction, onTick, view };

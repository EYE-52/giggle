'use strict';

const crypto = require('crypto');
const { createElevatedCombat } = require('./kart-elevated-combat');
const { rankStandings } = require('./kart-standings');

const PROFILE = 'elevated-combat-v1';
const MAP_LABELS = Object.freeze({
  'Alpine Courtyard': 'garden',
  'Frost Quarry': 'frost',
  'Neon Harbor': 'neon',
  'Harbor Heights': 'harbor',
});
const INPUT_KEYS = new Set(['type', 'seq', 'life', 'controlEpoch', 'steer', 'throttle', 'brake', 'nitro', 'use']);

// Elevated arenas run Zap Battle only (no Star Rush stars or Garage
// upgrades there). Both win rules work: a score target ends the match at
// the first knockout that reaches it, with the round length as the cap.
function preflightElevated(settings) {
  return settings.mode !== 'Zap Battle' || settings.garage === true
    ? { error: 'Elevated arenas require Zap Battle with Garage off.' } : { ok: true };
}
const GONE_AFTER_MS = 60000;
const END_REASONS = { deadline: 'timeout', target: 'goal', 'players-left': 'players-left' };

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const item of Object.values(value)) freeze(item);
    Object.freeze(value);
  }
  return value;
}

async function loadElevatedDependencies() {
  const [rapier, config, maps] = await Promise.all([
    import('@dimforge/rapier3d-compat'),
    import('../../public/js/engines/kart-physics-config.mjs'),
    import('../../public/js/engines/kart-elevated-maps.mjs'),
  ]);
  const RAPIER = rapier.default;
  await RAPIER.init();
  if (RAPIER.version() !== '0.21.0') throw new Error('Elevated arenas require Rapier 0.21.0.');
  return { RAPIER, config: config.default,
    maps: Object.fromEntries(Object.values(MAP_LABELS).map(id => [id, maps.elevatedMap(id)])) };
}

const number = (value, digits = 3) => {
  if (!Number.isFinite(value)) throw new Error('Invalid elevated projection.');
  return +value.toFixed(digits);
};
const vector = value => ({ x: number(value.x), y: number(value.y), z: number(value.z) });
const rotation = value => ({ x: number(value.x, 6), y: number(value.y, 6), z: number(value.z, 6), w: number(value.w, 6) });

function resultOf(raw) {
  if (!raw.result) return null;
  const { standings, winners, winner, draw } = rankStandings(raw.result.scores.map(s => ({ pid: s.id, score: s.hits, out: s.out === true })));
  return { standings, winners, winner, draw,
    endReason: END_REASONS[raw.result.reason] || 'timeout', endedAt: raw.result.endedAt };
}

function project(raw, map, settings) {
  const result = resultOf(raw);
  return {
    profile: PROFILE, waitForResult: true, combat:raw.combat, projectileRadii:raw.projectileRadii, physicsVersion: raw.physicsVersion, configVersion: raw.configVersion,
    mapRevision: raw.mapRevision, mapId: raw.mapId,
    map: { id: raw.mapId, label: map.name, environment: map.environment, half: map.half },
    phase: raw.phase, endsAt: raw.phase === 'done' ? 0 : raw.phase === 'countdown' ? raw.liveAt : raw.deadline,
    liveAt: raw.liveAt, deadline: raw.deadline, roundMs: raw.deadline - raw.liveAt,
    simTick: raw.simTick, simAt: raw.simAt, mode: 'battle', modeLabel: 'Zap Battle', garage: false,
    winRule: settings.winRule === 'Score target' ? 'Score target' : 'Time limit', targetHits: settings.targetHits, palette: settings.palette, lightCycle: settings.lightCycle,
    skyCycle: settings.lightCycle === 'Live sunset'
      ? { startedAt: raw.liveAt, durationMs: raw.deadline - raw.liveAt,
        ...(raw.phase === 'done' ? { endedAt: raw.result?.endedAt ?? raw.deadline } : {}) } : null,
    karts: raw.karts.map(k => ({ id: k.id, connected: k.connected, ...(k.out ? { out: true } : {}), alive: k.alive, health:k.health, maxHealth:k.maxHealth,
      hits: k.hits, deaths: k.deaths, spawnSeq: k.spawnSeq, controlEpoch: k.controlEpoch,
      weapon: k.weapon, ammo: k.ammo, firing:k.firing===true, shield: number(k.shield), ramT: number(k.ramT), spikesT: number(k.spikesT), respawn: number(k.respawn),
      empT: number(k.empT), nitro: number(k.nitro), nitroActive: k.nitroActive,
      pose: { position: vector(k.pose.position), rotation: rotation(k.pose.rotation),
        linearVelocity: vector(k.pose.linearVelocity), angularVelocity: vector(k.pose.angularVelocity),
        grounded: k.pose.grounded, speed: number(k.pose.speed), epoch: k.pose.epoch,
        wheels: k.pose.wheels.map(w => ({ length: number(w.length, 4), rotation: number(w.rotation, 4), steering: number(w.steering, 4) })) } })),
    crates: raw.crates.map(c => ({ id: c.id, position: vector(c.position), available: c.available })),
    projectiles: raw.projectiles.map(p => ({ id: p.id, owner: p.owner, weapon: p.weapon,
      position: vector(p.position), velocity: vector(p.velocity), radius: number(p.radius), ttl: number(p.ttl) })),
    sentries: (raw.sentries||[]).map(t=>({id:t.id,owner:t.owner,position:vector(t.position),direction:vector(t.direction),ttl:number(t.ttl)})),
    mines: raw.mines.map(m => ({ id: m.id, owner: m.owner, position: vector(m.position), normal: vector(m.normal),
      radius:number(m.radius), arm: number(m.arm), ttl: number(m.ttl), armed: m.armed })),
    grenades: raw.grenades.map(g => ({ id: g.id, owner: g.owner, position: vector(g.position), velocity: vector(g.velocity),
      weapon:g.weapon||'grenade', radius:number(g.radius), arm:number(g.arm||0), fuse: number(g.fuse||0),
      ttl:number(g.ttl||0),landed:g.landed===true,armed:g.armed===true,warning: g.warning })),
    events: raw.events.map(e => {
      const event = { id: e.id, tick: e.tick, type: e.type, pid: e.pid };
      for (const key of ['other', 'weapon', 'damage', 'health', 'maxHealth', 'crateId', 'spawnSeq', 'controlEpoch', 'reason', 'surfaceId', 'impulse']) {
        if (e[key] !== undefined) event[key] = e[key];
      }
      for (const key of ['position', 'direction', 'normal', 'from']) {
        if (e[key]) event[key] = vector(e[key]);
      }
      if (e.type === 'result') event.winners = result ? result.winners.slice() : [];
      return event;
    }),
    scores: Object.fromEntries(raw.karts.map(k => [k.id, k.hits])), result,
  };
}

function createElevatedKartAdapter({ RAPIER, config, maps, defaults, createMatch = createElevatedCombat }) {
  if (!RAPIER || typeof RAPIER.World !== 'function' || RAPIER.version() !== '0.21.0' || !config || config.version !== 1) {
    throw new Error('Elevated arena dependencies are unavailable.');
  }
  const deps = Object.freeze({ RAPIER: Object.freeze({ ...RAPIER }), config: freeze(structuredClone(config)),
    maps: freeze(structuredClone(maps)), defaults: freeze(structuredClone(defaults)), createMatch });
  for (const id of Object.values(MAP_LABELS)) {
    if (!deps.maps[id] || deps.maps[id].id !== id || !deps.maps[id].revision) throw new Error('Elevated arena maps are unavailable.');
  }
  const matches = new WeakMap();
  const settingsOf = settings => ({ ...deps.defaults, ...settings });
  function preflight(settings) {
    return preflightElevated(settingsOf(settings));
  }
  function refresh(state, record, raw) {
    // Room reads this projection without mutating it. Freeze once per refresh
    // instead of cloning the same public tree for every transport recipient.
    record.view = freeze(project(raw, record.map, record.settings));
    state.phase = record.view.phase;
    state.endsAt = record.view.endsAt;
    // Cache compact private status without rebuilding the public World per seat.
    // Older diagnostic createMatch facades may expose only snapshot().
    for (const k of raw.karts) record.private.set(k.id, record.match.privateStatus
      ? record.match.privateStatus(k.id) : record.match.snapshot(k.id).you);
  }
  function create(ctx) {
    const settings = settingsOf(ctx.settings());
    const check = preflight(settings);
    if (check.error) throw new Error(check.error);
    const map = deps.maps[MAP_LABELS[settings.map]], state = { profile: PROFILE, phase: 'countdown', endsAt: 0 };
    if (!map) throw new Error('Choose an elevated arena.');
    const match = deps.createMatch(deps.RAPIER, deps.config, map, ctx.allPlayers(), {
      instance: ctx.instanceId, seed: crypto.randomBytes(4).readUInt32LE(0), startAt: ctx.now(), roundMs: settings.roundSeconds * 1000,
      ...(settings.winRule === 'Score target' ? { targetHits: settings.targetHits } : {}),
    });
    const record = { match, map, settings, private: new Map(), gone: new Map(), disposed: false, awarded: false, view: null };
    try { refresh(state, record, match.snapshot()); }
    catch (error) { match.dispose(); throw error; }
    matches.set(state, record);
    return state;
  }
  function retire(state, record) {
    record.disposed = true;
    try { record.match.dispose(); } catch (error) { console.error('elevated arena dispose error', error); }
    state.phase = 'done'; state.endsAt = 0;
    record.view = freeze({ ...record.view, phase: 'done', endsAt: 0, waitForResult: false,
      error: 'The arena stopped. Start a new round.',
      result: { standings: [], winners: [], winner: null, endReason: 'simulation-failure' },
      projectiles: [], mines: [], grenades: [], sentries: [] });
  }
  function awardOnce(record, ctx) {
    if (record.disposed || !record.view.result || record.awarded) return;
    record.awarded = true;
    for (const s of record.view.result.standings) if (s.points > 0) ctx.award(s.pid, s.points);
  }
  function onTick(state, ctx) {
    const record = matches.get(state);
    if (!record || record.disposed || state.phase === 'done') return;
    // Gone for a minute: drop out (the room hook does the same; idempotent).
    for (const [pid, since] of record.gone) {
      if (ctx.now() - since < GONE_AFTER_MS) continue;
      record.gone.delete(pid);
      try { record.match.drop(pid); } catch (error) { retire(state, record); console.error('elevated arena retired', error); return; }
    }
    try { refresh(state, record, record.match.advance(ctx.now())); }
    catch (error) { retire(state, record); console.error('elevated arena retired', error); }
    awardOnce(record, ctx);
    ctx.broadcast(state.phase === 'done' ? undefined : { discardable: true });
  }
  function onAction(state, ctx, pid, action) {
    const record = matches.get(state);
    if (!record || record.disposed || state.phase === 'done' || !action || typeof action !== 'object' || Array.isArray(action) ||
        action.type !== 'input' || Object.keys(action).some(key => !INPUT_KEYS.has(key))) return false;
    const { type, ...intent } = action;
    record.match.input(pid, { ...intent, instance: ctx.instanceId }, ctx.now());
    return false;
  }
  function onConnection(state, ctx, pid, connected) {
    const record = matches.get(state);
    if (!record || record.disposed) return;
    if (connected) record.gone.delete(pid); else if (!record.gone.has(pid)) record.gone.set(pid, ctx.now());
    try { record.match.setConnected(pid, connected); refresh(state, record, record.match.snapshot()); }
    catch (error) { retire(state, record); console.error('elevated arena retired', error); }
  }
  // Leaving (or 60 s away): the driver drops out and the others play on.
  function onPlayerGone(state, ctx, pid) {
    const record = matches.get(state);
    if (!record || record.disposed || state.phase === 'done') return false;
    let dropped = false;
    try { dropped = record.match.drop(pid); if (dropped) refresh(state, record, record.match.snapshot()); }
    catch (error) { retire(state, record); console.error('elevated arena retired', error); }
    if (dropped) { awardOnce(record, ctx); ctx.broadcast?.(); }
    return dropped;
  }
  function viewForTransport(state, pid) {
    const record = matches.get(state);
    const own = record.private.get(pid);
    return { ...record.view, youDrive: !!own,
      inputAck: own ? { receivedSeq: own.receivedSeq, appliedInputSeq: own.appliedInputSeq, life: own.life, controlEpoch: own.controlEpoch } : null,
      coins: own ? own.coins : 0 };
  }
  // Ordinary callers retain independent, mutable snapshots.
  function view(state, pid) { return structuredClone(viewForTransport(state, pid)); }
  function dispose(state) {
    const record = matches.get(state);
    if (!record || record.disposed) return;
    record.disposed = true;
    record.match.dispose();
  }
  return Object.freeze({ preflight, create, onAction, onTick, onConnection, onPlayerGone, view, viewForTransport, dispose, owns: state => matches.has(state) });
}

module.exports = { GONE_AFTER_MS, PROFILE, MAP_LABELS, preflightElevated, loadElevatedDependencies, createElevatedKartAdapter };

'use strict';
/* Pocket Karts: all original maps use the shared Rapier motion core.
 * Explicit elevated labels opt into a separately initialized authority.
 * Simulation stays in the engines, with one private World per instance. */

const { createKartGame } = require('../engines/kart-engine');
const { defaultSettings } = require('../_validate');
const { MAP_LABELS, preflightElevated, loadElevatedDependencies, createElevatedKartAdapter } = require('../engines/kart-elevated-adapter');

let classicDependencies;
const { KART_STREAM } = require('../engines/kart-realtime');
const {createClassicMotion}=require('../../public/js/engines/kart-classic-motion.mjs');
const legacy = createKartGame({
  createMotion(state){if(!classicDependencies)throw Error('Kart physics is not initialized');return createClassicMotion(classicDependencies.RAPIER,classicDependencies.config,state);},
  id: 'pocket-karts',
  name: 'Pocket Karts',
  tagline: 'Kart battles with weapons and nitro',
  howto: 'Grab a box, fire with Space, and knock out rivals by taking all 3 of their hearts; most knockouts wins. Drive with WASD/arrows or the thumb stick; Space or the item button fires the whole clip, and N/Nitro boosts. There are 16 weapons. Pulse, Scatter, Mine, Seeker, Rail Laser, Thunder Strike, Boomerang, Oil Slick, Frost Bomb, Cluster Bomb, Bounce Ball and Turbo Ram take 1 heart; Rocket and Proximity Bomb take 2; a Nuke knocks out every rival in its blast. Rail Laser fires two very fast bolts. Thunder Strike hits the nearest rival ahead (or the nearest anywhere) at once. A Boomerang curves out and back and can hit going and coming. An Oil Slick spins out whoever drives over it. A Frost Bomb slows everyone in its splash for 2 seconds. A Cluster Bomb bursts into bomblets. A Bounce Ball ricochets off walls up to 4 times. Turbo Ram gives you 3 seconds of speed, and touching a rival takes a heart. Shield blocks the next hit. Each pickup hurts a rival once, however many of its shots land, and every Mine and Oil Slick is its own trap. Pulse, Scatter, Mine, Rail Laser, Boomerang, Oil Slick and Bounce Ball are common; Rocket, Seeker, Proximity Bomb, Shield, Thunder Strike, Frost Bomb, Cluster Bomb and Turbo Ram are uncommon; the Nuke is rare. A knockout returns you after two seconds with full hearts and brief spawn protection; attacking ends that protection. Choose elevated arenas in Maps & settings for climbs, bridges and jumps; Shift brakes there. Elevated arenas play Zap Battle with Garage off. Classic arenas use Shift to drift and also offer Star Rush and Garage Battle. Rounds last 1 to 15 minutes; with a score target the first to reach it ends the match early. Places earn 300, 200 and 100 points, and tied drivers share a place. A driver who leaves or is away for a minute drops out and the others play on. Skyport and Foundry have three floors and support 2 to 32 drivers; other elevated arenas support 8. Extra friends watch. Classic arenas also have launch cannons that fling you across the map, paired portal rings that link two spots, and water or pits: falling in costs you one point.',
  guide: {
    goal: 'Grab a box, fire with Space, take all 3 hearts. Most knockouts wins.',
    controls: [
      { keys: ['WASD', '↑ ↓ ← →'], touch: 'Stick', does: 'Drive and steer' },
      { keys: ['Space'], touch: 'Item button', does: 'Fire your weapon' },
      { keys: ['N'], touch: 'Nitro', does: 'Speed boost' },
      { keys: ['Shift'], touch: 'Drift', does: 'Drift (brake on elevated maps)' },
    ],
    tips: [
      'Most weapons take 1 heart. Rocket and Proximity Bomb take 2.',
      'A Nuke knocks out everyone nearby. Shield blocks the next hit.',
      'Thunder hits the rival ahead, Boomerangs come back, Oil spins, Frost slows.',
      'Turbo Ram: 3 seconds of speed, and ramming a rival takes a heart.',
      'Cannons fling you across, portals link two rings, falling in costs 1 point.',
    ],
  },
  art: 'img/games/pocket-karts.svg',
  seats: 32,
  players: { min: 2, max: 32 },
  layout: 'immersive',
  modes: ['starrush', 'battle'],
  maps: ['ring', 'blocks', 'garden', 'frost', 'neon'],
  garage: true,
  defaults: {
    roundSeconds: 180,
    targetStars: 15,
    targetHits: 10,
    mode: 'battle',
    map: 'garden',
    palette: 'Daybreak',
    winRule: 'Time limit',
    lightCycle: 'Live sunset',
    garage: false,
  },
});

// Original labels preserve their authored layouts and rules; elevated labels select their separate map authority.
// The wrapper owns defaults for both authorities. The classic builder only
// understands flat IDs and would silently normalize an elevated default.
const DEFAULT_ARENA = 'Garden Circuit';
const defaults = Object.freeze({ ...defaultSettings(legacy), map: DEFAULT_ARENA });
let elevated = null, initialization = null;
const ELEVATED_SEATS = 8;
const opted = settings => Object.hasOwn(MAP_LABELS, settings.map);
const owns = state => elevated && elevated.owns(state);
const def = {
  ...legacy,
  manifest: { ...legacy.manifest, settings: legacy.manifest.settings.map(s => s.key === 'map'
    ? { ...s, def: DEFAULT_ARENA, options: [...s.options, ...Object.keys(MAP_LABELS)] } : s) },
  async initialize(load = loadElevatedDependencies) {
    if (!initialization) initialization = Promise.resolve().then(load).then(deps => {
      classicDependencies=deps;
      elevated = createElevatedKartAdapter({ ...deps, defaults });
      return true;
    });
    return initialization;
  },
  // Complex arenas and classic arenas take 32; smaller elevated arenas take 8.
  seatsFor: settings => { const s = resolveSettings(settings); return ['Skyport', 'Foundry'].includes(s.map) ? 32 : opted(s) ? ELEVATED_SEATS : 32; },
  preflight(settings) {
    const resolved = resolveSettings(settings);
    if (!classicDependencies) return { error: 'Kart arenas are unavailable right now. Try another game.' };
    if (!opted(resolved)) return { ok: true };
    const check = preflightElevated(resolved);
    if (check.error) return check;
    return elevated ? elevated.preflight(resolved) : { error: 'Elevated arenas are unavailable right now. Choose an existing arena.' };
  },
  create(ctx) {
    const resolved = resolveSettings(ctx.settings());
    if (!opted(resolved)) return legacy.create(contextWithSettings(ctx, resolved));
    const check = def.preflight(resolved);
    if (check.error) throw new Error(check.error);
    return elevated.create(contextWithSettings(ctx, resolved));
  },
  onAction: (state, ctx, pid, action) => owns(state) ? elevated.onAction(state, ctx, pid, action) : legacy.onAction(state, ctx, pid, action),
  onTick: (state, ctx) => owns(state) ? elevated.onTick(state, ctx) : legacy.onTick(state, ctx),
  view: (state, pid) => owns(state) ? elevated.view(state, pid) : legacy.view(state, pid),
  viewForTransport: (state, pid) => owns(state) ? elevated.viewForTransport(state, pid) : legacy.view(state, pid),
  dispose: state => { if (owns(state)) elevated.dispose(state);else legacy.dispose(state); },
  onConnection: (state, ctx, pid, connected) => owns(state) ? elevated.onConnection(state, ctx, pid, connected) : legacy.onConnection(state, ctx, pid, connected),
  onPlayerGone: (state, ctx, pid) => owns(state) ? elevated.onPlayerGone(state, ctx, pid) : legacy.onPlayerGone(state, ctx, pid),
  requiresActionTokens: state => !!owns(state) || !!state.motionProfile || !!classicDependencies,
  // Classic arenas: adaptive 30 Hz (the room's governor slows a busy room to
  // 25, 20 or 15 Hz). Elevated arenas keep their fixed 20 Hz JSON cadence.
  tickRate: state => owns(state) ? null : CLASSIC_RATE,
  tickInterval: () => 50,
  realtime: state => owns(state) ? null : CLASSIC_REALTIME,
};

// Preserve prototype/private context methods while overriding only settings.
function contextWithSettings(ctx, settings) {
  return new Proxy(ctx, { get(target, key) {
    if (key === 'settings') return () => settings;
    const value = Reflect.get(target, key, target);
    return typeof value === 'function' ? value.bind(target) : value;
  } });
}

const resolveSettings = settings => ({ ...defaults, ...defaultSettings(def), ...settings });

const CLASSIC_RATE = Object.freeze({ target: 33, max: 66 });
// Classic arenas: karts stream as binary records, the rest is a JSON delta.
const CLASSIC_REALTIME = Object.freeze({
  streams: [KART_STREAM],
  publicView: state => legacy.publicView(state),
  privateView: (state, pid) => legacy.privateView(state, pid),
});

module.exports = def;

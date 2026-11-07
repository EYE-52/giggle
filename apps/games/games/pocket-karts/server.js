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
  howto: 'Grab a box for a quick item reveal. Press Space or the item button to skip it and fire the full payload. Drive with WASD, arrows or the stick; N boosts. Each kart has 3 hearts. Machine Gun fires straight for 2 seconds; Tri-Shot fires three tight fans. Missiles lock only ahead at launch, then home gently. Thunder needs a 30 degree forward cone within 35 metres; otherwise it misses. Cannon hits take 2 hearts, nearby splash takes 1. Blades orbit locally for 6 seconds; the returning Boomerang is harmless. Supernova blocks every hit for 3 seconds, then bursts for 2 hearts within 9 metres. A Nuke knocks out rivals in its warning ring. Mine, Oil Slick, Frost Bomb, Thunder Strike, Boomerang and Turbo Ram each take 1 heart. Each pickup hurts each rival once; each mine or oil trap is separate. Most knockouts wins; you return after 2 seconds with full hearts and brief protection. Classic maps allow 32 drivers, elevated maps 8; extra friends watch. Shift drifts on classic maps and brakes on elevated maps. Common: Machine Gun, Tri-Shot, Mine, Oil Slick, Boomerang. Uncommon: Homing Missile, Cannon, Spinning Blades, Frost Bomb, Thunder Strike, Turbo Ram. Rare: Supernova, Nuke.',
  guide: {
    goal: 'Take all 3 hearts to score a knockout. Most knockouts wins.',
    controls: [
      { keys: ['WASD', 'Arrows'], touch:'Stick', does: 'Drive' },
      { keys: ['Space'], touch:'Item', does: 'Fire the full weapon payload' },
      { keys: ['N'], touch:'Nitro', does: 'Hold for a speed boost' },
      { keys: ['Shift'], does: 'Drift classic / brake elevated' },
    ],
    tips: [
      'Grab a box; fire skips the quick item reveal. Line up your straight shots.',
      'Lock missiles ahead. Thunder needs a narrow cone within 35 metres.',
      'Blades stay close for 6s. Supernova guards 3s, then bursts within 9m.',
      'Leave the Nuke warning ring. Each pickup hurts each rival once.',
      'Mine and Oil trap; Frost slows, Thunder strikes, Boomerang returns, Ram boosts.',
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
const defaults = Object.freeze(defaultSettings(legacy));
let elevated = null, initialization = null;
const ELEVATED_SEATS = 8;
const opted = settings => Object.hasOwn(MAP_LABELS, settings.map);
const owns = state => elevated && elevated.owns(state);
const def = {
  ...legacy,
  manifest: { ...legacy.manifest, settings: legacy.manifest.settings.map(s => s.key === 'map'
    ? { ...s, options: [...s.options, ...Object.keys(MAP_LABELS)] } : s) },
  async initialize(load = loadElevatedDependencies) {
    if (!initialization) initialization = Promise.resolve().then(load).then(deps => {
      classicDependencies=deps;
      elevated = createElevatedKartAdapter({ ...deps, defaults });
      return true;
    });
    return initialization;
  },
  // Elevated arenas keep their authored eight seats; classic arenas take 32.
  seatsFor: settings => opted({ ...defaults, ...settings }) ? ELEVATED_SEATS : 32,
  preflight(settings) {
    const resolved = { ...defaults, ...settings };
    if (!classicDependencies) return { error: 'Kart arenas are unavailable right now. Try another game.' };
    if (!opted(resolved)) return { ok: true };
    const check = preflightElevated(resolved);
    if (check.error) return check;
    return elevated ? elevated.preflight(resolved) : { error: 'Elevated arenas are unavailable right now. Choose an existing arena.' };
  },
  create(ctx) {
    if (!opted(ctx.settings())) return legacy.create(ctx);
    const check = def.preflight(ctx.settings());
    if (check.error) throw new Error(check.error);
    return elevated.create(ctx);
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

const CLASSIC_RATE = Object.freeze({ target: 33, max: 66 });
// Classic arenas: karts stream as binary records, the rest is a JSON delta.
const CLASSIC_REALTIME = Object.freeze({
  streams: [KART_STREAM],
  publicView: state => legacy.publicView(state),
  privateView: (state, pid) => legacy.privateView(state, pid),
});

module.exports = def;

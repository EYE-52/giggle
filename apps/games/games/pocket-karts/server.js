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
  howto: 'Grab a box for a quick item reveal. Press Space or the item button to skip it and fire the full payload. Drive with WASD, arrows or the stick; N boosts. Each kart has 3 hearts. There are 13 weapons. Machine Gun fires straight for 2 seconds; Tri-Shot fires three tight fans. Missiles lock only ahead at launch, then home gently. Thunder needs a 30 degree forward cone within 35 metres; otherwise it misses. Cannon hits take 2 hearts, nearby splash takes 1. Blades orbit locally for 6 seconds; the returning Boomerang is harmless. Supernova blocks every hit for 3 seconds, then bursts for 2 hearts within 9 metres. A Nuke knocks out rivals in its warning ring. Mine, Oil Slick, Frost Bomb, Thunder Strike, Boomerang and Turbo Ram each take 1 heart. Each pickup hurts each rival once; each mine or oil trap is separate. Most knockouts wins; you return after 2 seconds with full hearts and brief protection. Choose classic or raised arenas in Maps & settings. Classic arenas, Skyport and Foundry allow 2 to 32 drivers; Alpine Courtyard, Frost Quarry, Neon Harbor and Harbor Heights allow 2 to 8. Extra friends watch. Skyport is a three-floor rooftop car park with a spiral ramp, sky bridges, a helipad and a roof jump. Foundry has three floors with furnace tunnels, moving conveyor lanes, a crane yard and a high gantry loop; avoid the molten slag pit. The other raised arenas have connected decks, ramps and underpasses. Raised arenas use Zap Battle with Garage off; classic arenas also offer Star Rush and Garage Battle. Hold Shift or the tyre button in a turn to drift on every arena. Blue, orange and purple sparks give stronger turbo boosts when you release. Ice and gravel have different grip. Raised arenas have bright launch cannons to upper decks and paired portals between levels; drive into the cannon rear or portal ring. Brief cooldowns prevent repeat loops. Common: Machine Gun, Tri-Shot, Mine, Oil Slick, Boomerang. Uncommon: Homing Missile, Cannon, Spinning Blades, Frost Bomb, Thunder Strike, Turbo Ram. Rare: Supernova, Nuke.',
  guide: {
    goal: 'Take all 3 hearts to score a knockout. Most knockouts wins.',
    controls: [
      { keys: ['WASD', 'Arrows'], touch:'Stick', does: 'Drive' },
      { keys: ['Space'], touch:'Item', does: 'Fire the full weapon payload' },
      { keys: ['N'], touch:'Nitro', does: 'Hold for a speed boost' },
      { keys: ['Shift'], touch: 'Tyre', does: 'Hold to drift; release sparks for turbo' },
    ],
    tips: [
      'Grab a box; fire skips the reveal. Each pickup hurts each rival once.',
      'Lock missiles ahead. Thunder needs a narrow cone within 35 metres.',
      'Blades stay close for 6s. Supernova guards 3s, then bursts within 9m.',
      'Dodge Nuke rings. Mine and Oil trap; Frost slows; Boomerang returns; Ram boosts.',
      'Raised: cannons climb; portals cross levels. Release drift sparks for turbo.',
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

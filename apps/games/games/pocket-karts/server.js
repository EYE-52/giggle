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
  howto: 'Grab a box. Your weapon appears on the kart and in the bottom slot. Press Space or Fire to use the full pickup. Drive with WASD, arrows or the stick; N boosts and Shift drifts. Every kart has 100 HP. Take a rival to 0 HP to score a knockout. You return with full HP and brief protection. Machine Gun has 30 bullets at 5 damage each. Tri-Shot has nine pellets at about 17 damage each. Missile and Cannon deal 65 and 70 on direct hits. All blasts lose damage toward the edge of their ring. Mines explode behind you. Frost Bomb slows nearby rivals. Blades and Turbo Ram knock out on real contact. Supernova protects for 3 seconds then bursts. Nuke has a large warning ring: drive away before it explodes. Most knockouts wins. Pick classic or raised arenas in Maps & settings.',
  guide: {
    goal: 'Take a rival from 100 HP to 0 to score a knockout. Most knockouts wins.',
    controls: [
      { keys: ['WASD', 'Arrows'], touch:'Stick', does: 'Drive' },
      { keys: ['Space'], touch:'Fire', does: 'Fire the full weapon payload' },
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
  art: 'img/games/pocket-karts.png',
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
  manifest: { ...legacy.manifest, sameRoom: false, settings: legacy.manifest.settings.map(s => s.key === 'map'
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

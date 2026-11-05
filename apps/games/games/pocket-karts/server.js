'use strict';
/* Pocket Karts: all original maps use the shared Rapier motion core.
 * Explicit elevated labels opt into a separately initialized authority.
 * Simulation stays in the engines, with one private World per instance. */

const { createKartGame } = require('../engines/kart-engine');
const { defaultSettings } = require('../_validate');
const { MAP_LABELS, preflightElevated, loadElevatedDependencies, createElevatedKartAdapter } = require('../engines/kart-elevated-adapter');

let classicDependencies;
const {createClassicMotion}=require('../../public/js/engines/kart-classic-motion.mjs');
const legacy = createKartGame({
  createMotion(state){if(!classicDependencies)throw Error('Kart physics is not initialized');return createClassicMotion(classicDependencies.RAPIER,classicDependencies.config,state);},
  id: 'pocket-karts',
  name: 'Pocket Karts',
  tagline: 'Kart battles with weapons and nitro',
  howto: 'Grab a box, fire with Space, and knock out rivals by taking all 3 of their hearts; most knockouts wins. Drive with WASD/arrows or the thumb stick; Space or the item button fires the whole clip, and N/Nitro boosts. Pulse, Scatter, Mine and Seeker take 1 heart; Rocket and Proximity Bomb take 2; a Nuke knocks out every rival in its blast. Shield blocks the next hit. Each pickup hurts a rival once, however many of its shots land, and every Mine is its own trap. Pulse, Scatter and Mine are common, Rocket, Seeker, Proximity Bomb and Shield are uncommon, and the Nuke is rare. A knockout returns you after two seconds with full hearts and brief spawn protection; attacking ends that protection. Choose elevated arenas in Maps & settings for climbs, bridges and jumps; Shift brakes there. Elevated arenas play Zap Battle with Garage off. Classic arenas use Shift to drift and also offer Star Rush and Garage Battle. Rounds last 1 to 5 minutes; with a score target the first to reach it ends the match early. Places earn 300, 200 and 100 points, and tied drivers share a place. A driver who leaves or is away for a minute drops out and the others play on. Up to 8 drive; extra friends watch.',
  guide: {
    goal: 'Grab a box, fire with Space, take all 3 hearts. Most knockouts wins.',
    controls: [
      { keys: ['WASD', '↑ ↓ ← →'], touch: 'Stick', does: 'Drive and steer' },
      { keys: ['Space'], touch: 'Item button', does: 'Fire your weapon' },
      { keys: ['N'], touch: 'Nitro', does: 'Speed boost' },
      { keys: ['Shift'], touch: 'Drift', does: 'Drift (brake on elevated maps)' },
    ],
    tips: [
      'Pulse, Scatter, Mine, Seeker: 1 heart each.',
      'Rocket and Proximity Bomb: 2 hearts. Nuke: knocks out everyone nearby.',
      'Shield blocks the next hit.',
      'Each pickup hurts a rival once, however many of its shots land.',
      'Knocked out? You are back in 2 seconds with all 3 hearts.',
    ],
  },
  art: 'img/games/pocket-karts.svg',
  seats: 8,
  players: { min: 2, max: 24 },
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
  tickInterval: () => 50,
};

module.exports = def;

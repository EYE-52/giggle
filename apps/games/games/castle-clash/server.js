'use strict';
const { createBlockSiege } = require('../engines/block-siege');
const CASTLE_CONFIG = {
  size: 12, height: 12, maxPieces: 64, support: .3, crownHp: 120,
  buildMs: 60000, siegeMs: 90000, rounds: 3,
  cards: {
    cube: { name: 'Stone cube', material: 'stone', w: 1, d: 1, h: 1, hp: 65, quantity: 12 },
    beam: { name: 'Timber beam', material: 'timber', w: 2, d: 1, h: 1, hp: 35, quantity: 8 },
    slab: { name: 'Stone slab', material: 'stone', w: 2, d: 2, h: .5, hp: 65, quantity: 6 },
    pillar: { name: 'Timber pillar', material: 'timber', w: 1, d: 1, h: 2, hp: 35, quantity: 6 },
    parapet: { name: 'Iron parapet', material: 'iron', w: 2, d: 1, h: 1, hp: 95, quantity: 4 },
  },
  weapons: {
    ballista: { name: 'Ballista', damage: 34, splash: 0, radius: 0, ammo: 8, cooldownMs: 1200, arc: .4, speed: 38, minFlight: 650, maxFlight: 1800 },
    mortar: { name: 'Mortar', damage: 20, splash: 12, radius: 2.5, ammo: 4, cooldownMs: 2800, arc: 10, speed: 15, minFlight: 1800, maxFlight: 3000 },
    rocket: { name: 'Rocket', damage: 52, splash: 18, radius: 2.5, ammo: 2, cooldownMs: 3500, arc: 1.8, speed: 26, minFlight: 950, maxFlight: 2200 },
  },
};
const game = createBlockSiege(CASTLE_CONFIG);
module.exports = {
  id: 'castle-clash', minPlayers: 2, maxPlayers: 24, CASTLE_CONFIG,
  manifest: {
    name: 'Castle Clash', tagline: 'Stack your castle. Protect your Crown.',
    howto: 'Each player builds their own castle. Choose a block card, tap your island or a top surface to stack, and rotate with R. Undo or remove your own blocks. Pieces need 30% support under their center; breaking a support collapses blocks above. Ready starts the siege once all living connected players are ready. Choose ballista, mortar or rocket, select a rival, aim at a point, then Fire. Shots strike the first solid block; defenses shield the Crown. Ballista refills one bolt every five seconds. Last Crown standing wins the round; the clock decides by Crown health, standing height, then damage. Most round wins takes the match. Drag to orbit; scroll or pinch to zoom. Keys 1–5 select cards, R rotates, arrows move the draft and Enter confirms. Extra friends watch and may play the next match.',
    cat: '3d', renderer: '3d', layout: 'immersive', homepage: true, realtime: false, communication: 'voice',
    players: { min: 2, max: 24 }, seats: 4, runtime: { type: 'module', waitForResult: true },
    settings: [
      { key: 'buildSeconds', label: 'Build time (seconds)', type: 'int', min: 15, max: 120, def: 60 },
      { key: 'siegeSeconds', label: 'Siege time (seconds)', type: 'int', min: 15, max: 120, def: 90 },
      { key: 'rounds', label: 'Rounds', type: 'int', min: 1, max: 5, def: 3 },
    ],
    art: 'img/games/castle-clash.svg',
  },
  create: game.create, onAction: game.onAction, view: game.view, dispose: game.dispose,
};

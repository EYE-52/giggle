'use strict';
/* Show & Go: thin config on the shared camera-party engine
 * (games/engines/camera-party.js). Gallery mode: everyone hunts the
 * same everyday object, shows it live on camera, and taps Ready; peers
 * vote Yes on convincing finds, never for themselves. The engine owns
 * phases, timers, voting, reveal, and scoring — this file only declares
 * Show & Go's identity, settings, and content pack. */

const { createCameraParty, cameraSettings } = require('../engines/camera-party');

const id = 'show-and-go';

const manifest = {
  name: 'Show & Go',
  tagline: 'Grab it, show it, win the votes',
  howto: 'Everyone hunts the same everyday object and shows it in Giggle Meet, then taps Ready. Peers vote Yes on convincing finds; you never vote for yourself. An approved find is worth 100 points plus up to 50 for being ready early; judges who agree with the room get 25. Turn on your Meet camera so everyone can see your find. Nothing is recorded.',
  cat: 'social',
  renderer: 'dom',
  realtime: false,
  communication: 'video',
  players: { min: 2, max: 12 },
  settings: cameraSettings('gallery'),
  packs: {
    prompts: { label: 'Custom prompts', type: 'string[]', minItems: 10, maxItems: 200, maxLen: 120 },
  },
  art: 'img/games/show-and-go.svg',
};

const game = createCameraParty({ id, mode: 'gallery' });

module.exports = { id, minPlayers: 2, maxPlayers: 12, manifest, ...game };

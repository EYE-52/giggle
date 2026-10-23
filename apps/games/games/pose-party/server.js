'use strict';
/* Pose Party: thin config on the shared camera-party engine
 * (games/engines/camera-party.js). Spotlight mode: a rotating actor
 * performs the prompt live on camera and taps Ready before the deadline;
 * everyone else watches and votes Yes/No. The engine owns phases,
 * timers, voting, reveal, and scoring — this file only declares
 * Pose Party's identity, settings, and content pack. */

const { createCameraParty, cameraSettings } = require('../engines/camera-party');

const id = 'pose-party';

const manifest = {
  name: 'Pose Party',
  tagline: 'Strike a pose live on camera',
  howto: 'One player performs the prompt in Giggle Meet and taps Ready before time runs out. Everyone else watches and votes Yes or No. An approved pose is worth 100 points plus up to 50 for being ready early; judges who agree with the room get 25. Turn on your Meet camera so everyone can see your pose. Nothing is recorded.',
  cat: 'social',
  renderer: 'dom',
  realtime: false,
  communication: 'video',
  players: { min: 2, max: 12 },
  settings: cameraSettings('spotlight'),
  packs: {
    prompts: { label: 'Custom prompts', type: 'string[]', minItems: 10, maxItems: 200, maxLen: 120 },
  },
  art: 'img/games/pose-party.svg',
};

const game = createCameraParty({ id, mode: 'spotlight' });

module.exports = { id, minPlayers: 2, maxPlayers: 12, manifest, ...game };

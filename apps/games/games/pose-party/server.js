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
  guide: {
    goal: 'Strike poses the room approves to score the most points.',
    tips: [
      'Each round, one player performs the prompt on their Meet camera.',
      'Tap Ready when you are done. Being ready early adds up to 50.',
      'Everyone else votes Yes or No. An approved pose earns 100.',
      'Judges who vote with the room earn 25.',
      'Turn on your camera so everyone can see. Nothing is recorded.',
    ],
  },
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

'use strict';
const fs = require('fs');
const path = require('path');
const { roundsSetting, paceSetting } = require('../_sdk');
const { createEmbeddingProvider, createSemanticGuess } = require('../engines/semantic-guess');

const id = 'warm-words';
const manifest = {
  name: 'Warm Words',
  tagline: 'Follow the meaning. Find the word.',
  howto: 'Everyone races to find the same hidden everyday English word. Each guess gets real AI word-embedding cosine similarity and a vocabulary rank: lower ranks are closer, and rank 1 is the exact answer. Share ideas on the call! Only the exact word wins. The first solver earns 100–200 points depending on time remaining. Optional hints reveal a close word and reduce the round prize by 50 points each, at most twice. Three 90-second rounds by default. Similarity measures meaning, not spelling; the model can make surprising associations. Guesses must be in our 1,507-word vocabulary. Custom targets use supported vocabulary words only; unsupported targets are skipped with a notice.',
  cat: 'word', players: { min: 2, max: 20 }, communication: 'voice',
  art: 'img/games/warm-words.svg',
  settings: [
    roundsSetting({ def: 3 }),
    paceSetting(),
    { key: 'roundSeconds', label: 'Seconds per round', type: 'int', min: 30, max: 300, def: 90 },
    { key: 'hints', label: 'Optional hints (50-point cost)', type: 'bool', def: false },
  ],
  packs: { targets: { label: 'Custom targets (supported everyday words)', type: 'string[]', minItems: 2, maxItems: 200, maxLen: 24 } },
};
// These data files never live under public/. No transformer, model download,
// paid API or inference service is used in a running game.
const read = name => JSON.parse(fs.readFileSync(path.join(__dirname, name), 'utf8'));
const provider = createEmbeddingProvider(read('embeddings.json'));
const game = createSemanticGuess({ contentId: id, provider, targets: read('vocabulary.json').targets, schema: manifest });
module.exports = { id, minPlayers: 2, maxPlayers: 20, manifest, ...game };

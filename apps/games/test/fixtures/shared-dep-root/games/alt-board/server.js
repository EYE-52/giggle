'use strict';
/* Alternate-board authoring fixture: a SECOND game id using the already-
 * approved shared chess.js dependency. Must PASS check-game without any
 * per-game-id special case in the checker (dependency-level allowlist).
 * NOT a real game: lives under test/fixtures, never discovered. */

const { Chess } = require('chess.js');

const id = 'alt-board';

const manifest = {
  name: 'Alt Board',
  tagline: 'Authoring fixture, not a game',
  howto: 'Fixture only.',
  cat: 'board',
  renderer: 'dom',
  players: { min: 2, max: 2 },
};

function create() {
  return { phase: 'play', fen: new Chess().fen(), nudges: 0 };
}

function onAction(state, ctx, pid, a) {
  if (a && a.nudge === true) {
    state.nudges += 1;
    return;
  }
}

function view(state) {
  return { phase: state.phase, fen: state.fen, nudges: state.nudges };
}

module.exports = { id, manifest, create, onAction, view };

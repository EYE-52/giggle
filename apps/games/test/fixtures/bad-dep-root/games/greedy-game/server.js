'use strict';
/* Negative authoring fixture: requires an arbitrary local module that is
 * NOT on the shared allowlist. Must FAIL check-game at the dependency
 * scan (the module itself loads fine, so load success can't mask it). */

const helper = require('./helper');

const id = 'greedy-game';

const manifest = {
  name: 'Greedy Game',
  tagline: 'Authoring fixture, not a game',
  howto: 'Fixture only.',
  cat: 'social',
  renderer: 'dom',
  players: { min: 2, max: 4 },
};

function create() {
  return { phase: 'play', tag: helper.tag() };
}

function onAction() {}

function view(state) {
  return { phase: state.phase, tag: state.tag };
}

module.exports = { id, manifest, create, onAction, view };

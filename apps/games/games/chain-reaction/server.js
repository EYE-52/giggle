'use strict';
const { createChainReaction } = require('../engines/chain-reaction');
const { MOVE_TIMER_SETTING, WIN_POINTS } = require('../engines/board-duel');

const CHAIN_CONFIG = {
  boards: { Compact: { cols: 5, rows: 6 }, Standard: { cols: 6, rows: 8 } },
  defaultBoard: 'Compact', winPoints: WIN_POINTS,
  palettes: {
    Candy: [
      { color: '#ff557c', shape: 'circle', label: 'Raspberry circles' },
      { color: '#36dec4', shape: 'diamond', label: 'Teal diamonds' },
      { color: '#ffd15c', shape: 'triangle', label: 'Honey triangles' },
      { color: '#e28bde', shape: 'square', label: 'Orchid squares' },
      { color: '#68baff', shape: 'star', label: 'Sky stars' },
      { color: '#ff9363', shape: 'cross', label: 'Tangerine crosses' },
    ],
    Ink: [
      { color: '#c8d6e8', shape: 'circle', label: 'Silver circles' },
      { color: '#e784a5', shape: 'diamond', label: 'Wine diamonds' },
      { color: '#7bc8b3', shape: 'triangle', label: 'Forest triangles' },
      { color: '#dabb80', shape: 'square', label: 'Ochre squares' },
      { color: '#88b1dd', shape: 'star', label: 'Blue stars' },
      { color: '#bf96d0', shape: 'cross', label: 'Plum crosses' },
    ],
  },
};

module.exports = {
  id: 'chain-reaction', minPlayers: 2, maxPlayers: 24,
  manifest: {
    name: 'Chain Reaction', tagline: 'One tiny orb. A very big BOOM.',
    howto: 'Two to six players take turns adding an orb to an empty cell or a cell they own. Corners burst at 2, edges at 3, and inner cells at 4. Each burst sends an orb to every neighboring cell and captures it, setting off chain reactions. Everyone gets one turn before players with no orbs are eliminated. Be the last owner standing! With a move timer, a missed turn is skipped. A player who leaves drops out; extra friends watch.',
    cat: 'board', renderer: 'dom', layout: 'immersive', runtime: { type: 'frame', entry: 'index.html', waitForResult: true }, realtime: false, communication: 'any',
    players: { min: 2, max: 24 }, seats: 6, art: 'img/games/chain-reaction.svg',
    settings: [
      { key: 'boardSize', label: 'Board', type: 'enum', options: ['Compact', 'Standard'], def: 'Compact' },
      { ...MOVE_TIMER_SETTING },
      { key: 'palette', label: 'Orb palette', type: 'enum', options: ['Candy', 'Ink'], def: 'Candy' },
    ],
  },
  ...createChainReaction(CHAIN_CONFIG),
  CHAIN_CONFIG,
};

'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { validateManifest } = require('../games/_validate');
const registry = require('../games/registry');

(async () => {
  const base = { id: 'layout-check', manifest: { name: 'Layout check', players: { min: 2, max: 4 } } };
  for (const renderer of ['dom', 'canvas', '3d']) {
    for (const layout of ['standard', 'immersive']) {
      assert.equal(validateManifest({ ...base, manifest: { ...base.manifest, renderer, layout } }).ok, true);
    }
  }
  for (const layout of [null, '', {}, 'fullscreen', '<script>']) {
    assert.equal(validateManifest({ ...base, manifest: { ...base.manifest, layout } }).ok, false);
  }
  const catalog = registry.list();
  assert.equal(catalog.find(g => g.id === 'castle-clash'), undefined, 'retired Castle is not offered');
  assert.equal(registry.get('castle-clash'), null, 'retired Castle cannot be started through the catalogue');
  assert.equal(catalog.find(g => g.id === 'pocket-karts').layout, 'immersive', 'Pocket Karts owns its arena viewport');
  assert.equal(catalog.find(g => g.id === 'chain-reaction').runtime.type, 'frame');
  for (const game of catalog) {
    const manifest = registry.get(game.id).manifest || {};
    assert.equal(game.layout, manifest.layout || (manifest.runtime ? 'immersive' : 'standard'),
      game.id + ': catalog preserves its own layout and defaults only when omitted');
  }
  const src = fs.readFileSync(path.join(__dirname, '../public/js/embed.js'), 'utf8');
  const embed = await import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'));
  assert.equal(embed.presentationForGame({ layout: 'immersive', cat: 'board' }), 'immersive', 'Game chrome choice reaches the call layout');
  assert.equal(embed.presentationForGame({ layout: 'immersive', communication: 'video' }), 'social', 'Video-core games retain call-first layout');
  assert.equal(embed.presentationForGame({ renderer: 'dom' }), 'balanced');
  assert.equal(embed.presentationForGame(null), 'balanced');
  console.log('GAME_LAYOUT_PASS: validated per-game layout, catalog, default compatibility and call presentation');
})().catch(e => { console.error(e); process.exitCode = 1; });

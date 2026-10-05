const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
function load(name) {
  const source = readFileSync(path.join(__dirname, '../lib', name + '.ts'), 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  new Function('module', 'exports', js)(module, module.exports);
  return module.exports;
}
const bridge = load('gameBridge'), { arrangeCameraStage } = load('cameraStage');
test('only bounded public camera scenes enter the authenticated protocol', () => {
  const scene = { mode: 'spotlight', featured: 'verified-user', caption: 'Be a robot' };
  for (const camera of [scene, { mode: 'gallery', featured: null, caption: '' }, null, undefined]) {
    assert.equal(bridge.isGameChildMessage({ v: 1, t: 'state', players: 4, camera }), true);
  }
  for (const camera of [[], 'gallery', { ...scene, featured: '' }, { ...scene, featured: 1 }, { ...scene, caption: 'x'.repeat(121) }, { ...scene, mode: 'grid' }, { ...scene, mode: 'gallery' }]) {
    assert.equal(bridge.isGameChildMessage({ v: 1, t: 'state', camera }), false);
  }
  assert.equal(bridge.resolveGameLayout('auto', 'social', scene), 'stage');
  assert.equal(bridge.resolveGameLayout('stage', 'board', null), 'stage');
  for (const pin of ['faces', 'compact', 'floating']) assert.equal(bridge.resolveGameLayout(pin, 'social', scene), pin);
  assert.equal(bridge.resolveGameLayout('auto', 'board', null), 'balanced');
});
test('camera boxes stay inside desktop and phone viewports, with stable identity', () => {
  for (const [width, height] of [[1000, 620], [390, 360], [320, 200], [1, 1], [680, 260]]) {
    for (let n = 1; n <= 24; n++) {
      const ids = Array.from({ length: n }, (_, i) => 'u' + i);
      for (const featured of [null, 'u0', 'unknown']) {
        const boxes = arrangeCameraStage(ids, width, height, featured);
        assert.equal(boxes.length, n);
        assert.deepEqual(new Set(boxes.map(b => b.id)), new Set(ids));
        for (const b of boxes) {
          assert.ok(b.width > 0 && b.height > 0 && b.x >= 0 && b.y >= 0);
          assert.ok(b.x + b.width <= width + 1e-6 && b.y + b.height <= height + 1e-6);
        }
        if (featured === 'u0' && n > 1) assert.ok(boxes[0].width * boxes[0].height > width * height / 2);
      }
    }
  }
  assert.deepEqual(arrangeCameraStage(['u', 'u'], 390, 300).map(b => b.id), ['u']);
  for (const size of [0, -1, NaN, Infinity]) assert.deepEqual(arrangeCameraStage(['u'], size, 300), []);
});
test('camera changes only geometry; original call hosts and frame remain mounted', () => {
  const component = name => readFileSync(path.join(__dirname, '../components', name), 'utf8');
  const panel = component('GamePanel.tsx');
  assert.match(panel, /onCameraSceneRef\.current\?\.\(camera\)/);
  assert.match(panel, /if \(authedRef\.current\) \{[\s\S]*?isValidCameraScene/);
  assert.match(panel, /cameraKeyRef\.current = cameraKey/);
  assert.match(panel, /<option value="stage">Game stage<\/option>/);
  assert.doesNotMatch(component('CameraGameStage.tsx'), /getUserMedia|createVideoClient|setCamEnabled|setMicEnabled/);
  assert.match(component('FocusVideoStage.tsx'), /key=\{id\}/);
});

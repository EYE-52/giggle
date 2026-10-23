'use strict';
// Exercise the actual ESM host with temporary game modules, without a browser.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'giggle-view-host-'));
  const previousDocument = global.document;
  const originalError = console.error;
  try {
    fs.mkdirSync(path.join(root, 'games'));
    fs.writeFileSync(path.join(root, 'package.json'), '{"type":"module"}');
    fs.copyFileSync(path.join(__dirname, '../public/js/game-host.js'), path.join(root, 'game-host.js'));
    fs.writeFileSync(path.join(root, 'games/reentrant.js'), `
      let api;
      export default {
        mount(el, a) { api = a; }, update() {},
        dispose(el) { el.disposes++; if (el.disposes === 1) api.reset(); }
      };`);
    fs.writeFileSync(path.join(root, 'games/failed-mount.js'), `export default {
      mount() { throw Error('broken mount'); }, update(el) { el.paints++; },
      dispose(el) { el.disposes++; }
    };`);
    fs.writeFileSync(path.join(root, 'games/failed-paint.js'), `export default {
      update() { throw Error('broken paint'); }, dispose(el) { el.disposes++; }
    };`);
    fs.writeFileSync(path.join(root, 'games/healthy.js'), `export default {
      update(el, state) { el.value = state.value; }, dispose(el) { el.disposes++; }
    };`);
    global.document = { activeElement: null, getElementById: () => null };
    console.error = () => {};
    const host = await import(pathToFileURL(path.join(root, 'game-host.js')).href);
    const el = { disposes: 0, paints: 0 };
    await host.show(el, 'reentrant', {}, { reset: host.reset });
    host.reset();
    assert.equal(el.disposes, 1, 'a dispose callback that resets cannot dispose the same view twice');
    assert.equal(host.currentId(), null);

    el.disposes = 0;
    assert.equal(await host.show(el, 'failed-mount', {}, {}), null, 'failed mounts are not reported loaded');
    assert.equal(host.isLoaded('failed-mount'), false);
    assert.equal(el.disposes, 1, 'a partially mounted view is cleaned up');
    assert.equal(el.paints, 0, 'a broken mount never paints');

    el.disposes = 0;
    assert.equal(await host.show(el, 'failed-paint', {}, {}), null, 'failed paint is not reported successful');
    assert.equal(el.disposes, 1);
    assert.equal(host.currentId(), null);
    assert.ok(await host.show(el, 'healthy', { value: 'recovered' }, {}));
    assert.equal(el.value, 'recovered', 'a healthy game can mount after failure');
    const superseded = host.show(el, 'reentrant', {}, { reset: host.reset });
    host.reset();
    assert.equal(await superseded, null, 'loads completing after reset cannot mount');
    assert.equal(host.currentId(), null);
    console.log('GAME HOST PASS: reentrant cleanup, mount/paint failure recovery, stale async load');
  } finally {
    global.document = previousDocument;
    console.error = originalError;
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch((err) => { console.error(err); process.exitCode = 1; });

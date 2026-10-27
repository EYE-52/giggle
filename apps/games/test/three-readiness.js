'use strict';
// The real renderer lifecycle with a deterministic GL renderer: readiness
// means renderer.render succeeded, not that an asset promise completed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const flush = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(fn => { resolve = fn; }); return { promise, resolve }; };
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'giggle-gl-ready-'));
  const originalError = console.error;
  const originals = new Map(['document', 'window', 'ResizeObserver'].map(key => [key, Object.getOwnPropertyDescriptor(global, key)]));
  try {
    const source = fs.readFileSync(process.env.THREE_VIEW_SOURCE || path.join(__dirname, '../public/js/renderers/three-view.js'), 'utf8');
    fs.writeFileSync(path.join(tmp, 'view.mjs'), source.replace("'/vendor/three/three.module.js'", "'./vendor.mjs'"));
    fs.writeFileSync(path.join(tmp, 'vendor.mjs'), `export class WebGLRenderer {
      constructor({canvas}) {this.canvas=canvas;this.released=0;globalThis.glFixture.renderers.push(this);}
      setPixelRatio() {} setSize() {} getContext() {return {};}
      setAnimationLoop(fn) {this.loop=fn;}
      render() {if(globalThis.glFixture.fail)throw Error('GL render failed');globalThis.glFixture.renders++;}
      dispose() {this.released++;}
    }
    export const SRGBColorSpace='srgb';`);
    global.glFixture = { renderers: [], renders: 0, fail: false };
    global.window = { location: { search: '' }, devicePixelRatio: 1, addEventListener() {}, removeEventListener() {} };
    global.document = { createElement() { return { setAttribute() {}, addEventListener() {}, removeEventListener() {}, remove() { this.removed = true; } }; } };
    global.ResizeObserver = class { observe() {} disconnect() {} };
    const { createThreeView } = await import(pathToFileURL(path.join(tmp, 'view.mjs')).href);
    const root = () => ({ clientWidth: 320, clientHeight: 240, appendChild(canvas) { this.canvas = canvas; } });
    const scene = () => ({ traverse() {} });
    const built = () => ({ scene: scene(), camera: {}, frame() {} });
    console.error = () => {};
    const first = await createThreeView(root(), { build: built });
    assert(first.firstFrame instanceof Promise, 'renderer exports actual first-frame readiness');
    let painted = false; first.firstFrame.then(() => { painted = true; }); await flush();
    assert.equal(painted, false, 'scene construction cannot report a usable frame');
    first.renderer.loop(); await first.firstFrame; assert.equal(painted, true); assert.equal(global.glFixture.renders, 1);
    first.dispose(); first.dispose(); assert.equal(first.renderer.released, 1, 'GL disposal is idempotent');

    const frameFailure = await createThreeView(root(), { build: () => ({ ...built(), frame() { throw Error('scene failed'); } }) });
    frameFailure.renderer.loop(); await assert.rejects(frameFailure.firstFrame, /scene failed/); frameFailure.dispose();
    const renderFailure = await createThreeView(root(), { build: built });
    global.glFixture.fail = true; renderFailure.renderer.loop(); await assert.rejects(renderFailure.firstFrame, /GL render failed/); renderFailure.dispose();
    global.glFixture.fail = false;
    const disposed = await createThreeView(root(), { build: built }); disposed.dispose();
    await assert.rejects(disposed.firstFrame, /retired/);

    const waiting = deferred(), signal = new AbortController(), pendingRoot = root(); let releasedScene = 0;
    const pending = createThreeView(pendingRoot, { signal: signal.signal, async build() {
      await waiting.promise; return { ...built(), dispose() { releasedScene++; } };
    } });
    await flush(); signal.abort();
    assert.equal(pendingRoot.canvas.removed, true, 'exit removes an in-flight canvas immediately');
    waiting.resolve(); assert.equal((await pending).reason, 'retired'); assert.equal(releasedScene, 1, 'late-built scenes are cleaned without mounting a loop');
    await flush();
    console.log('THREE_READINESS_PASS: successful first GL frame, frame/render rejection, early disposal and aborted async scene cleanup');
  } finally {
    console.error = originalError; delete global.glFixture;
    for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(global, key, descriptor); else delete global[key]; }
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

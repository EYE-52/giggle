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
      constructor({canvas}) {this.canvas=canvas;this.released=0;this.width=300;this.height=150;this.sizes=[];this.ratios=[];globalThis.glFixture.renderers.push(this);}
      setPixelRatio(ratio) {this.ratios.push(ratio);this.setSize(this.width,this.height,false);}
      setSize(w,h) {this.width=w;this.height=h;this.sizes.push([w,h]);} getContext() {return {};}
      setAnimationLoop(fn) {this.loop=fn;}
      render() {if(globalThis.glFixture.fail)throw Error('GL render failed');globalThis.glFixture.renders++;}
      dispose() {this.released++;}
    }
    export const SRGBColorSpace='srgb';`);
    global.glFixture = { renderers: [], renders: 0, fail: false };
    global.window = { location: { search: '' }, devicePixelRatio: 1, addEventListener() {}, removeEventListener() {} };
    global.document = { createElement() { return { setAttribute() {}, addEventListener() {}, removeEventListener() {}, remove() { this.removed = true; } }; } };
    const observers=[];
    global.ResizeObserver = class { constructor(fn) {this.callback=fn;observers.push(this);} observe() {} disconnect() {} };
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

    const resizeRoot=root();let sceneResizes=0;
    const resizing=await createThreeView(resizeRoot,{build:()=>({...built(),resize(){sceneResizes++;}})});
    const observer=observers.at(-1),initialSizes=resizing.renderer.sizes.length;
    observer.callback();observer.callback();observer.callback();
    assert.equal(resizing.renderer.sizes.length,initialSizes,'unchanged ResizeObserver callbacks never reallocate the drawing buffer');
    assert.equal(sceneResizes,1,'unchanged observations do not rebuild scene projections');
    assert.equal(resizing.renderer.ratios.length,1,'stable DPR is assigned once');
    resizeRoot.clientWidth=640;observer.callback();
    assert.equal(resizing.renderer.sizes.length,initialSizes+1,'a real width change resizes once');
    global.window.devicePixelRatio=1.5;observer.callback();
    assert.equal(resizing.renderer.sizes.length,initialSizes+2,'a DPR-only change uses Three’s internal resize once');
    assert.equal(resizing.renderer.ratios.at(-1),1.5);assert.equal(sceneResizes,3);
    global.window.devicePixelRatio=2;observer.callback();
    assert.equal(resizing.renderer.ratios.at(-1),1.75,'existing pixel ratio quality cap is preserved');
    resizing.dispose();const retiredSizes=resizing.renderer.sizes.length,retiredResizes=sceneResizes;
    resizeRoot.clientWidth=999;observer.callback();
    assert.equal(resizing.renderer.sizes.length,retiredSizes,'a queued observer cannot resize a retired renderer');
    assert.equal(sceneResizes,retiredResizes,'a queued observer cannot revive a retired scene');
    global.window.devicePixelRatio=1;

    let geometryDisposes=0,materialDisposes=0,textureDisposes=0;
    const geometry={dispose(){geometryDisposes++;}},texture={isTexture:true,dispose(){textureDisposes++;}};
    const material={map:texture,normalMap:texture,dispose(){materialDisposes++;}};
    const sharedScene={traverse(fn){for(let i=0;i<1000;i++)fn({geometry,material:[material,material]});}};
    const shared=await createThreeView(root(),{build:()=>({...built(),scene:sharedScene})});shared.dispose();
    assert.deepEqual([geometryDisposes,materialDisposes,textureDisposes],[1,1,1],'shared scene resources dispatch each disposal exactly once');
    let invalidCleanup=0;
    const invalid=await createThreeView(root(),{build:()=>({scene:sharedScene,dispose(){invalidCleanup++;}})});
    assert.equal(invalid.reason,'build-shape');assert.equal(invalidCleanup,1,'invalid build shape releases its owned resources');
    assert.deepEqual([geometryDisposes,materialDisposes,textureDisposes],[2,2,2],'an invalid partially built scene is also released once');
    const malformed=await createThreeView(root(),{build:()=>({scene:{},dispose(){invalidCleanup++;}})});
    assert.equal(malformed.reason,'build-shape','malformed cleanup cannot turn the fallback into an exception');
    assert.equal(invalidCleanup,2);

    const partialDiagnostics=await createThreeView(root(),{build:built,diagnostics:{}});
    partialDiagnostics.renderOnce();await partialDiagnostics.firstFrame;partialDiagnostics.dispose();
    const brokenDiagnostics=await createThreeView(root(),{build:built,diagnostics:{renderFrame(){throw Error('diagnostics unavailable');}}});
    brokenDiagnostics.renderOnce();await brokenDiagnostics.firstFrame;brokenDiagnostics.dispose();
    const brokenErrorDiagnostics=await createThreeView(root(),{build:()=>({...built(),frame(){throw Error('original scene failure');}}),diagnostics:{event(){throw Error('diagnostics unavailable');}}});
    brokenErrorDiagnostics.renderOnce();await assert.rejects(brokenErrorDiagnostics.firstFrame,/original scene failure/);brokenErrorDiagnostics.dispose();

    const inactive = await createThreeView(root(), { build: built });
    let inactivePainted = false; inactive.firstFrame.then(() => { inactivePainted = true; }); await flush();
    assert.equal(inactivePainted, false, 'an inactive frame cannot claim readiness from construction');
    const beforeManual = global.glFixture.renders;
    inactive.renderOnce(); await inactive.firstFrame;
    assert.equal(global.glFixture.renders, beforeManual + 1, 'an inactive view can validate one actual draw without waiting for RAF');
    global.document.defaultView = { frameElement: { closest: () => true } };
    inactive.renderer.loop(); inactive.renderer.loop();
    assert.equal(global.glFixture.renders, beforeManual + 1, 'inert seats do not continuously consume GL work after readiness');
    delete global.document.defaultView;
    inactive.renderer.loop();
    assert.equal(global.glFixture.renders, beforeManual + 2, 'selecting the seat resumes real scene rendering');
    inactive.dispose(); inactive.renderOnce();
    assert.equal(global.glFixture.renders, beforeManual + 2, 'manual draws cannot revive a disposed renderer');

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
    console.log('THREE_READINESS_PASS: real first frame, rejection/retirement, deduplicated disposal, invalid-build cleanup and resize/DPR changes');
  } finally {
    console.error = originalError; delete global.glFixture;
    for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(global, key, descriptor); else delete global[key]; }
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

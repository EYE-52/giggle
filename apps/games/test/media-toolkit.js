'use strict';
/* Media toolkit lifecycle tests: canvas resizing/DPR/frame/dispose, input
 * edges + guaranteed release + field guards, sound unlock/mute/dispose,
 * voice strict-gate/status/request/dispose, and the index re-export graph
 * (including the existing Three helper). Small platform stubs only — no
 * browser, no server, no new deps. Leaf modules load as exact ESM bytes via
 * data URLs (same pattern as test/bridge.js); index.js loads via a .mjs
 * mirror so its relative re-exports resolve for real.
 * Run: node test/media-toolkit.js */

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.join(__dirname, '..');
const TOOLKIT = path.join(ROOT, 'public/js/toolkit');
let passed = 0;

function ok(cond, msg) {
  assert(cond, msg);
  passed += 1;
}

function readTool(name) {
  return fs.readFileSync(path.join(TOOLKIT, name), 'utf8');
}

async function loadLeaf(name) {
  const src = readTool(name + '.js');
  return import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'));
}

/* Event host stub with dispatch + listener accounting. */
function makeEmitter() {
  const listeners = new Map();
  return {
    listeners,
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
    },
    removeEventListener(type, fn) {
      const set = listeners.get(type);
      if (set) set.delete(fn);
    },
    dispatch(type, ev) {
      for (const fn of [...(listeners.get(type) || [])]) fn(ev || {});
    },
    count(type) {
      return (listeners.get(type) || new Set()).size;
    },
    total() {
      let n = 0;
      for (const set of listeners.values()) n += set.size;
      return n;
    },
  };
}

function makeRaf() {
  let next = 1;
  const queued = new Map();
  return {
    requestAnimationFrame(cb) {
      const id = next;
      next += 1;
      queued.set(id, cb);
      return id;
    },
    cancelAnimationFrame(id) {
      queued.delete(id);
    },
    pump(t) {
      const cbs = [...queued.values()];
      queued.clear();
      for (const cb of cbs) cb(t);
    },
    pending: () => queued.size,
  };
}

function withGlobals(stubs, fn) {
  const saved = {};
  for (const k of Object.keys(stubs)) {
    saved[k] = globalThis[k];
    if (stubs[k] === undefined) delete globalThis[k];
    else globalThis[k] = stubs[k];
  }
  try {
    return fn();
  } finally {
    for (const k of Object.keys(stubs)) {
      if (saved[k] === undefined) delete globalThis[k];
      else globalThis[k] = saved[k];
    }
  }
}

async function testCanvasView() {
  const { createCanvasView, reducedMotion } = await loadLeaf('canvas-view');

  ok(typeof reducedMotion === 'function', 'canvas: reducedMotion exported');
  ok(createCanvasView(null, { frame() {} }).reason === 'no-mount', 'canvas: no-mount fallback');
  ok(createCanvasView({ appendChild() {} }, {}).reason === 'no-frame', 'canvas: no-frame fallback');
  await withGlobals({ document: undefined }, () => {
    ok(createCanvasView({ appendChild() {} }, { frame() {} }).reason === 'no-dom', 'canvas: no-dom fallback');
  });

  const raf = makeRaf();
  const win = Object.assign(makeEmitter(), {
    devicePixelRatio: 2,
    matchMedia: () => ({ matches: true }),
    requestAnimationFrame: raf.requestAnimationFrame,
    cancelAnimationFrame: raf.cancelAnimationFrame,
  });
  const roInstances = [];
  class FakeRO {
    constructor(cb) { this.cb = cb; this.targets = []; roInstances.push(this); }
    observe(t) { this.targets.push(t); }
    disconnect() { this.disconnected = true; }
  }
  const setTransforms = [];
  const ctx = { setTransform: (...a) => setTransforms.push(a), fillRect() {} };
  const removed = [];
  const canvasEl = {
    style: {},
    setAttribute() {},
    getContext: (kind) => (kind === '2d' ? ctx : null),
    remove: () => removed.push('canvas'),
  };
  const appended = [];
  const mount = {
    clientWidth: 640,
    clientHeight: 360,
    appendChild: (el) => appended.push(el),
  };
  const doc = { createElement: (tag) => (tag === 'canvas' ? canvasEl : {}) };
  const frames = [];
  const resizes = [];
  let disposedHook = 0;

  await withGlobals({ window: win, document: doc, ResizeObserver: FakeRO }, () => {
    const view = createCanvasView(mount, {
      frame: (c, dt, t, size) => frames.push([c === ctx, dt, t, { ...size }]),
      resize: (w, h, dpr) => resizes.push([w, h, dpr]),
      onDispose: () => { disposedHook += 1; },
    });
    ok(view.fallback === false, 'canvas: live handle');
    ok(appended[0] === canvasEl, 'canvas: element mounted');
    ok(canvasEl.width === 1280 && canvasEl.height === 720, 'canvas: DPR backing store');
    ok(canvasEl.style.width === '640px' && canvasEl.style.height === '360px', 'canvas: CSS size');
    ok(JSON.stringify(setTransforms[0]) === JSON.stringify([2, 0, 0, 2, 0, 0]), 'canvas: ctx pre-scaled');
    ok(resizes.length === 1 && resizes[0][2] === 2, 'canvas: resize hook runs');
    ok(roInstances.length === 1 && roInstances[0].targets[0] === mount, 'canvas: RO observes mount');
    ok(view.running() === true, 'canvas: autostarted');

    raf.pump(1000);
    raf.pump(1016);
    ok(frames.length === 2 && frames[0][0] === true, 'canvas: frames run with ctx');
    ok(frames[1][1] > 0 && frames[1][1] <= 0.1, 'canvas: dt clamped positive');
    ok(frames[1][3].w === 640 && frames[1][3].dpr === 2, 'canvas: size passed to frame');

    mount.clientWidth = 320;
    roInstances[0].cb();
    ok(canvasEl.width === 640 && resizes.length === 2 && resizes[1][0] === 320, 'canvas: RO resize path');

    view.stop();
    ok(view.running() === false && raf.pending() === 0, 'canvas: stop halts loop');
    view.start();
    ok(view.running() === true && raf.pending() === 1, 'canvas: start resumes');
    const before = frames.length;
    view.dispose();
    raf.pump(2000);
    ok(frames.length === before, 'canvas: no frames after dispose');
    ok(view.disposed() === true && disposedHook === 1, 'canvas: dispose hook once');
    ok(roInstances[0].disconnected === true, 'canvas: RO disconnected');
    ok(win.total() === 0, 'canvas: listeners removed');
    ok(removed.length === 1, 'canvas: element removed');
    view.dispose();
    ok(disposedHook === 1, 'canvas: dispose idempotent');
  });

  // No ResizeObserver: window resize still resizes.
  const raf2 = makeRaf();
  const win2 = Object.assign(makeEmitter(), {
    devicePixelRatio: 1,
    requestAnimationFrame: raf2.requestAnimationFrame,
    cancelAnimationFrame: raf2.cancelAnimationFrame,
  });
  const canvas2 = { style: {}, setAttribute() {}, getContext: () => ({ setTransform() {} }), remove() {} };
  const mount2 = { clientWidth: 100, clientHeight: 50, appendChild() {} };
  await withGlobals({ window: win2, document: { createElement: () => canvas2 }, ResizeObserver: undefined }, () => {
    const view = createCanvasView(mount2, { frame() {} });
    ok(view.fallback === false, 'canvas: works without RO');
    mount2.clientWidth = 200;
    win2.dispatch('resize', {});
    ok(canvas2.width === 200, 'canvas: window-resize fallback path');
    view.dispose();
  });

  // No 2D context: honest fallback, nothing mounted.
  await withGlobals({ window: Object.assign(makeEmitter(), {}), document: { createElement: () => ({ getContext: () => null }) } }, () => {
    const view = createCanvasView({ appendChild() { throw new Error('must not mount'); } }, { frame() {} });
    ok(view.fallback === true && view.reason === 'no-2d', 'canvas: no-2d fallback');
  });
}

async function testInput() {
  const { createInput } = await loadLeaf('input');

  const win = makeEmitter();
  const doc = makeEmitter();
  const orientation = makeEmitter();
  win.screen = { orientation };
  doc.hidden = false;
  doc.visibilityState = 'visible';
  const target = makeEmitter();
  target.getBoundingClientRect = () => ({ left: 10, top: 20, width: 200, height: 100 });
  const captured = [];
  target.setPointerCapture = (id) => captured.push(id);
  target.releasePointerCapture = () => {};
  const keys = [];
  const pointers = [];
  const input = createInput(target, {
    window: win,
    document: doc,
    onKey: (e) => keys.push(e),
    onPointer: (e) => pointers.push(e),
    preventKeys: ['Space'],
  });

  let prevented = 0;
  win.dispatch('keydown', { code: 'KeyA', key: 'a', target: {}, preventDefault: () => { prevented += 1; } });
  win.dispatch('keydown', { code: 'KeyA', key: 'a', repeat: true, target: {} });
  ok(keys.length === 1 && keys[0].type === 'down' && keys[0].code === 'KeyA', 'input: down edge once (repeat ignored)');
  ok(input.isDown('KeyA') && input.keys().join() === 'KeyA', 'input: held set');
  win.dispatch('keydown', { code: 'Space', key: ' ', target: {}, preventDefault: () => { prevented += 1; } });
  ok(prevented === 1, 'input: preventKeys only');
  win.dispatch('keyup', { code: 'KeyA', key: 'a' });
  ok(keys.length === 3 && keys[2].type === 'up', 'input: up edge');
  ok(!input.isDown('KeyA'), 'input: released from set');

  // Focused-field guard.
  win.dispatch('keydown', { code: 'KeyB', key: 'b', target: { tagName: 'INPUT' } });
  ok(!input.isDown('KeyB') && keys.length === 3, 'input: typing in fields ignored');
  const input2 = createInput(target, { window: win, document: doc, captureInFields: true, onKey: (e) => keys.push(e) });
  win.dispatch('keydown', { code: 'KeyB', key: 'b', target: { tagName: 'TEXTAREA' } });
  ok(keys.some((k) => k.code === 'KeyB'), 'input: captureInFields opt-in');
  input2.dispose();

  // Pointer mapping + capture.
  target.dispatch('pointerdown', { pointerId: 7, clientX: 110, clientY: 70 });
  ok(captured.join() === '7', 'input: pointer capture attempted');
  ok(pointers.length === 1 && pointers[0].x === 100 && pointers[0].y === 50, 'input: local coords');
  ok(pointers[0].nx === 0.5 && pointers[0].ny === 0.5, 'input: normalized coords');
  target.dispatch('pointermove', { pointerId: 7, clientX: 210, clientY: 120 });
  ok(pointers.length === 2 && pointers[1].type === 'move', 'input: move tracked');
  target.dispatch('pointermove', { pointerId: 9, clientX: 0, clientY: 0 });
  ok(pointers.length === 2, 'input: stray move ignored');
  target.dispatch('pointercancel', { pointerId: 7, clientX: 0, clientY: 0 });
  ok(pointers.length === 3 && pointers[2].type === 'cancel', 'input: cancel releases pointer');
  ok(input.pointers().size === 0, 'input: pointer map cleared');

  // Independent contacts, capture loss and window release remain once-only.
  target.dispatch('pointerdown', { pointerId: 11, clientX: 30, clientY: 40 });
  target.dispatch('pointerdown', { pointerId: 12, clientX: 60, clientY: 70 });
  const contactEvents = pointers.length;
  win.dispatch('pointerup', { pointerId: 90 });
  ok(pointers.length === contactEvents && input.pointers().size === 2, 'input: unrelated finger lift ignored');
  target.releasePointerCapture = id => target.dispatch('lostpointercapture', { pointerId: id });
  win.dispatch('pointerup', { pointerId: 11 });
  target.dispatch('pointerup', { pointerId: 11 });
  ok(pointers.length === contactEvents + 1 && input.pointers().has(12), 'input: outside release and bubbling/capture loss do not double-send');
  target.dispatch('lostpointercapture', { pointerId: 12 });
  ok(input.pointers().size === 0 && pointers.at(-1).type === 'cancel', 'input: capture loss cancels only its contact');
  target.dispatch('pointerdown', { pointerId: 13, clientX: 20, clientY: 30 });
  const beforeRotate = pointers.length;
  win.dispatch('orientationchange', {});
  ok(input.pointers().size === 0 && pointers.length === beforeRotate + 1, 'input: rotation releases capture exactly once');
  target.dispatch('pointerup', { pointerId: 13 });
  ok(pointers.length === beforeRotate + 1, 'input: stale lift after rotation ignored');

  // Layout changes release every contact and key, even if capture loss fires
  // synchronously; repeated change events and delayed lifts are inert.
  for (const [host, type] of [[doc, 'game-screenchange'], [doc, 'fullscreenchange'], [orientation, 'change'], [win, 'orientationchange']]) {
    win.dispatch('keydown', { code: 'KeyF', key: 'f', target: {} });
    win.dispatch('keydown', { code: 'KeyG', key: 'g', target: {} });
    target.dispatch('pointerdown', { pointerId: 21, clientX: 30, clientY: 40 });
    target.dispatch('pointerdown', { pointerId: 22, clientX: 60, clientY: 70 });
    target.dispatch('pointermove', { pointerId: 22, clientX: 110, clientY: 80 });
    const keyCount = keys.length, pointerCount = pointers.length;
    host.dispatch(type, {});
    ok(input.keys().length === 0 && input.pointers().size === 0, 'input: ' + type + ' clears all held input');
    const releasedKeys = keys.slice(keyCount);
    ok(releasedKeys.length === 2 && releasedKeys.every(e => e.type === 'up' && e.released === true), 'input: ' + type + ' releases both keys once');
    const releasedPointers = pointers.slice(pointerCount);
    ok(releasedPointers.length === 2 && releasedPointers.every(e => e.type === 'cancel') && releasedPointers.map(e => e.id).join() === '21,22', 'input: ' + type + ' cancels both contacts once');
    ok(releasedPointers[1].x === 100 && releasedPointers[1].y === 60, 'input: ' + type + ' preserves the last pointer position');
    host.dispatch(type, {});
    for (const id of [21, 22]) {
      target.dispatch('pointermove', { pointerId: id, clientX: 150, clientY: 90 });
      win.dispatch('pointerup', { pointerId: id });
      win.dispatch('pointercancel', { pointerId: id });
      target.dispatch('lostpointercapture', { pointerId: id });
    }
    for (const code of ['KeyF', 'KeyG']) win.dispatch('keyup', { code });
    ok(keys.length === keyCount + 2 && pointers.length === pointerCount + 2, 'input: repeated ' + type + ' and stale lifts do not emit again');
  }

  // Guaranteed release on blur + hidden.
  win.dispatch('keydown', { code: 'KeyC', key: 'c', target: {} });
  target.dispatch('pointerdown', { pointerId: 3, clientX: 10, clientY: 20 });
  win.dispatch('blur', {});
  ok(input.keys().length === 0 && input.pointers().size === 0, 'input: blur releases all');
  ok(keys[keys.length - 1].released === true, 'input: release marked');
  win.dispatch('keydown', { code: 'KeyD', key: 'd', target: {} });
  doc.hidden = true;
  doc.visibilityState = 'hidden';
  doc.dispatch('visibilitychange', {});
  ok(!input.isDown('KeyD'), 'input: hidden releases keys');

  const totalBefore = win.total() + doc.total() + target.total() + orientation.total();
  ok(totalBefore > 0, 'input: listeners attached');
  input.dispose();
  ok(win.total() + doc.total() + target.total() + orientation.total() === 0, 'input: dispose removes listeners including screen orientation');
  ok(input.disposed() === true, 'input: disposed flag');
  win.dispatch('keydown', { code: 'KeyE', key: 'e', target: {} });
  ok(!input.isDown('KeyE'), 'input: dead after dispose');
}

function makeFakeAudio() {
  const created = { osc: 0, gain: 0, started: 0, resumed: 0, closed: 0 };
  const param = () => ({
    value: 0,
    setValueAtTime(v) { this.value = v; },
    linearRampToValueAtTime(v) { this.value = v; },
    exponentialRampToValueAtTime(v) { this.value = v; },
  });
  class FakeContext {
    constructor() {
      this.state = 'suspended';
      this.currentTime = 10;
      this.destination = {};
    }
    createOscillator() {
      created.osc += 1;
      return { type: '', frequency: param(), connect() {}, start: () => { created.started += 1; }, stop() {} };
    }
    createGain() {
      created.gain += 1;
      return { gain: param(), connect() {} };
    }
    resume() {
      created.resumed += 1;
      this.state = 'running';
      return Promise.resolve();
    }
    close() {
      created.closed += 1;
      return Promise.resolve();
    }
  }
  return { created, factory: () => new FakeContext() };
}

async function testAudio() {
  const { createSoundBank, CUES } = await loadLeaf('audio');
  ok(['click', 'turn', 'tick', 'join', 'win', 'lose', 'error'].every((k) => Array.isArray(CUES[k])), 'audio: cue scores defined');

  const { created, factory } = makeFakeAudio();
  let made = 0;
  const bank = createSoundBank({ autoUnlock: false, createContext: () => { made += 1; return factory(); } });
  ok(made === 0, 'audio: lazy (nothing before gesture)');
  ok(bank.cue('click') === false, 'audio: locked cue schedules nothing');
  ok(bank.unlock() === true && made === 1, 'audio: unlock creates context');
  ok(created.resumed === 1, 'audio: unlock resumes suspended ctx');
  bank.unlock();
  ok(made === 1, 'audio: context reused');
  ok(bank.isUnlocked() === true, 'audio: unlocked flag');

  const oscBefore = created.osc;
  ok(bank.cue('win') === true, 'audio: win schedules');
  ok(created.osc - oscBefore === 3 && created.started >= 3, 'audio: win plays 3 tones');
  ok(bank.cue('nope') === false, 'audio: unknown cue rejected');

  bank.setMuted(true);
  ok(bank.isMuted() === true && bank.cue('click') === false, 'audio: mute suppresses');
  bank.setMuted(false);
  ok(bank.cue('click') === true, 'audio: unmute restores');
  ok(bank.cues().includes('lose'), 'audio: cue list');

  bank.dispose();
  ok(created.closed === 1 && bank.disposed() === true, 'audio: dispose closes');
  ok(bank.cue('click') === false && bank.unlock() === false, 'audio: dead after dispose');
  ok(bank.available() === false, 'audio: unavailable after dispose');

  // Gesture auto-unlock path.
  const bank2 = createSoundBank({ createContext: factory });
  const win = makeEmitter();
  await withGlobals({ window: win }, () => {
    const bank3 = createSoundBank({ createContext: factory });
    ok(bank3.isUnlocked() === false, 'audio: starts locked');
    win.dispatch('pointerdown', {});
    ok(bank3.isUnlocked() === true && bank3.cue('tick') === true, 'audio: gesture unlocks');
    ok(win.total() === 2, 'audio: gesture listeners attached');
    bank3.dispose();
    ok(win.total() === 0, 'audio: dispose removes gesture listeners');
  });
  bank2.dispose();

  // No WebAudio: honest no-op, never throws.
  const bank4 = createSoundBank({ autoUnlock: false, createContext: () => null });
  ok(bank4.unlock() === false && bank4.cue('click') === false, 'audio: missing backend safe');
  bank4.dispose();
}

async function testVoice() {
  const voice = await loadLeaf('voice');
  const { createVoiceClient, validVoiceParentMessage, isValidVoiceMic, isValidVoiceId, voiceChildMessage } = voice;
  ok(voice.VOICE_VERSION === 1, 'voice: version 1');
  ok(JSON.stringify(voice.VOICE_MIC_STATES) === JSON.stringify(['active', 'off', 'denied', 'unavailable']), 'voice: bounded mic enum');

  ok(isValidVoiceMic('active') && !isValidVoiceMic('loud') && !isValidVoiceMic('') && !isValidVoiceMic(42), 'voice: mic validation');
  ok(isValidVoiceId('r1') && isValidVoiceId('x'.repeat(128)), 'voice: id bounds ok');
  ok(!isValidVoiceId('') && !isValidVoiceId('x'.repeat(129)) && !isValidVoiceId(7), 'voice: id bounds reject');

  const goodState = { v: 1, t: 'voice-state', mic: 'active', enabled: true };
  ok(validVoiceParentMessage(goodState) === true, 'voice: state shape ok');
  ok(validVoiceParentMessage({ ...goodState, for: 'req-1' }) === true, 'voice: state with echo ok');
  for (const bad of [
    null, 'x', [],
    { v: 2, t: 'voice-state', mic: 'active', enabled: true },
    { v: 1, t: 'voice', mic: 'active', enabled: true },
    { v: 1, t: 'voice-state', mic: 'loud', enabled: true },
    { v: 1, t: 'voice-state', mic: 'active', enabled: 'yes' },
    { v: 1, t: 'voice-state', mic: 'active', enabled: true, for: '' },
    { v: 1, t: 'voice-state', enabled: true },
  ]) {
    ok(validVoiceParentMessage(bad) === false, 'voice: bad state rejected');
  }
  ok(JSON.stringify(voiceChildMessage('voice-request', { id: 'a' })) === JSON.stringify({ v: 1, t: 'voice-request', id: 'a' }), 'voice: child envelope versioned');
  const idA = voice.createVoiceId();
  const idB = voice.createVoiceId();
  ok(isValidVoiceId(idA) && isValidVoiceId(idB) && idA !== idB, 'voice: ids fresh + valid');

  // Standalone: unavailable + honest hint, posts nothing.
  let posts = 0;
  const solo = createVoiceClient({ expectedOrigin: '', postFn: () => { posts += 1; } });
  ok(solo.isStandalone() === true, 'voice: standalone mode');
  ok(solo.request().reason === 'standalone' && posts === 0, 'voice: standalone request posts nothing');
  const soloStatus = solo.getStatus();
  ok(soloStatus.mode === 'standalone' && /Giggle call/.test(soloStatus.hint || ''), 'voice: standalone hint honest');
  ok(solo.handleEvent({ origin: 'https://x.test', source: {}, data: goodState }, {}) === false, 'voice: standalone ignores traffic');
  solo.dispose();

  // Embedded: handshake + strict gates.
  const ORIGIN = 'https://gigglemeet.com';
  const parentWin = { name: 'parent' };
  const sent = [];
  const vc = createVoiceClient({ expectedOrigin: ORIGIN, postFn: (env, o) => sent.push([env, o]) });
  ok(vc.isAuthed() === false, 'voice: starts unauthed');
  ok(vc.request().reason === 'not-authed' && sent.length === 0, 'voice: pre-handshake request silent');
  ok(vc.handleEvent({ origin: ORIGIN, source: parentWin, data: goodState }, parentWin) === false, 'voice: pre-handshake state rejected');
  ok(vc.getStatus().mic === 'unknown', 'voice: no status before handshake');

  vc.setAuthed(true);
  // Forged: wrong origin / wrong source / stale source.
  ok(vc.handleEvent({ origin: 'https://evil.test', source: parentWin, data: goodState }, parentWin) === false, 'voice: forged origin rejected');
  ok(vc.handleEvent({ origin: ORIGIN, source: {}, data: goodState }, parentWin) === false, 'voice: forged source rejected');
  ok(vc.handleEvent({ origin: ORIGIN, source: parentWin, data: goodState }, {}) === false, 'voice: stale parent window rejected');
  ok(vc.handleEvent({ origin: ORIGIN, source: parentWin, data: { ...goodState, mic: 'loud' } }, parentWin) === false, 'voice: bad schema rejected');

  const seen = [];
  const unsub = vc.subscribe((s) => seen.push(s));
  const req = vc.request();
  ok(req.ok === true && isValidVoiceId(req.id), 'voice: request posts with id');
  ok(sent.length === 1 && sent[0][1] === ORIGIN, 'voice: request to exact origin');
  ok(sent[0][0].v === 1 && sent[0][0].t === 'voice-request' && sent[0][0].id === req.id, 'voice: request envelope');
  ok(!('ticket' in sent[0][0]) && JSON.stringify(sent).indexOf('ticket') === -1, 'voice: no secrets in request');

  ok(vc.handleEvent({ origin: ORIGIN, source: parentWin, data: { ...goodState } }, parentWin) === true, 'voice: push applied');
  const live = vc.getStatus();
  ok(live.mic === 'active' && live.enabled === true && live.updatedAt > 0, 'voice: status mirrors parent truth');
  ok(seen.length === 1 && seen[0].mic === 'active', 'voice: subscriber notified');
  ok(!('audio' in seen[0]) || typeof seen[0].audio === 'undefined', 'voice: no raw audio in events');

  // Stale echo: an older request's answer arriving after a newer request.
  const req2 = vc.request();
  ok(req2.ok === true && req2.id !== req.id, 'voice: second request fresh id');
  ok(vc.handleEvent({ origin: ORIGIN, source: parentWin, data: { ...goodState, mic: 'off', for: req.id } }, parentWin) === false, 'voice: stale echo rejected');
  ok(vc.getStatus().mic === 'active', 'voice: stale changes nothing');
  ok(vc.handleEvent({ origin: ORIGIN, source: parentWin, data: { ...goodState, mic: 'off', for: req2.id } }, parentWin) === true, 'voice: fresh echo applied');
  ok(vc.getStatus().mic === 'off', 'voice: fresh echo updates');

  // Parent-disabled capability surfaces unavailable.
  ok(vc.handleEvent({ origin: ORIGIN, source: parentWin, data: { v: 1, t: 'voice-state', mic: 'active', enabled: false } }, parentWin) === true, 'voice: disabled push handled');
  ok(vc.getStatus().mic === 'unavailable' && vc.getStatus().enabled === false, 'voice: disabled surfaces unavailable');

  // Local switch: manifest hint guides layout, never forces permission.
  vc.setEnabled(false);
  ok(vc.request().reason === 'disabled' && vc.handleEvent({ origin: ORIGIN, source: parentWin, data: goodState }, parentWin) === false, 'voice: locally disabled rejects all');
  vc.setEnabled(true);
  vc.setAuthed(false);
  ok(vc.isAuthed() === false && vc.request().reason === 'not-authed', 'voice: de-auth locks again');
  ok(vc.getStatus().mic === 'unknown' && vc.getStatus().enabled === false, 'voice: de-auth clears stale mic status');

  unsub();
  ok(seen.length === 4 && seen.at(-1).mic === 'unknown', 'voice: de-auth notifies subscribers');
  vc.setAuthed(true);
  vc.handleEvent({ origin: ORIGIN, source: parentWin, data: goodState }, parentWin);
  ok(seen.length === 4, 'voice: unsubscribe stops notifications');

  // Attached window listener cleans up on dispose/end.
  const host = makeEmitter();
  host.parent = parentWin;
  const vc2 = createVoiceClient({ expectedOrigin: ORIGIN, postFn: () => {}, authed: true, window: host });
  ok(host.count('message') === 1, 'voice: attaches listener');
  host.dispatch('message', { origin: ORIGIN, source: parentWin, data: goodState });
  ok(vc2.getStatus().mic === 'active', 'voice: attached listener live');
  vc2.end();
  ok(host.count('message') === 0 && vc2.disposed() === true, 'voice: end cleans listeners');
  ok(vc2.request().reason === 'disposed', 'voice: dead after end');
  vc.dispose();

  // Security source scans (comments stripped — only code counts).
  const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
  const voiceCode = strip(readTool('voice.js'));
  ok(!/getUserMedia|RTCPeerConnection|MediaStream|webkitGetUserMedia|AudioContext/i.test(voiceCode), 'voice: never captures audio');
  ok(!/localStorage|sessionStorage|document\.cookie/i.test(voiceCode), 'voice: no storage');
  ok(!/console\.(log|info|debug|error)/i.test(voiceCode), 'voice: no logging');
  ok(!/ticket|secret|token/i.test(voiceCode), 'voice: no secrets/tickets');
  for (const leaf of ['canvas-view.js', 'input.js', 'audio.js', 'voice.js']) {
    const code = strip(readTool(leaf));
    ok(!/\bimport(\s+[^;]*from\s*['"]|\s*\(|\s*['"])/.test(code), `toolkit: ${leaf} import-free`);
  }
  ok(!/kart/i.test(strip(readTool('input.js'))), 'input: kart inputs untouched');
}

async function testIndex() {
  // Mirror the ESM graph to .mjs so the relative re-exports resolve for real.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'media-toolkit-'));
  try {
    fs.mkdirSync(path.join(tmp, 'toolkit'));
    fs.mkdirSync(path.join(tmp, 'renderers'));
    for (const f of ['canvas-view.js', 'input.js', 'audio.js', 'voice.js', 'index.js', ...fs.readdirSync(TOOLKIT).filter(f => f.endsWith('.mjs'))]) {
      const src = readTool(f)
        .replace(/from '\.\/([\w-]+)\.js'/g, "from './$1.mjs'")
        .replace(/from '\.\.\/renderers\/three-view\.js'/, "from '../renderers/three-view.mjs'");
      fs.writeFileSync(path.join(tmp, 'toolkit', f.replace('.js', '.mjs')), src);
    }
    const threeSrc = fs.readFileSync(path.join(ROOT, 'public/js/renderers/three-view.js'), 'utf8');
    fs.writeFileSync(path.join(tmp, 'renderers', 'three-view.mjs'), threeSrc);

    const index = await import(pathToFileURL(path.join(tmp, 'toolkit', 'index.mjs')).href);
    const three = await import(pathToFileURL(path.join(tmp, 'renderers', 'three-view.mjs')).href);
    for (const name of ['createCanvasView', 'createInput', 'createGameScreen', 'createMobileStick', 'normalizeStickVector', 'createSoundBank', 'createVoiceClient', 'createThreeView', 'createSessionToolkit', 'reducedMotion']) {
      ok(typeof index[name] === 'function', `index: exports ${name}`);
    }
    ok(index.createThreeView === three.createThreeView, 'index: three helper is the same module');
    ok(index.VOICE_VERSION === 1 && Array.isArray(index.CUES === undefined ? [] : Object.keys(index.CUES)), 'index: voice/audio constants');

    // Session composer: builds what is asked, nulls the rest, disposes together.
    const session = index.createSessionToolkit({
      voice: { expectedOrigin: '', postFn: () => {} },
      audio: { autoUnlock: false, createContext: () => null },
      input: { target: makeEmitter(), opts: { window: makeEmitter(), document: makeEmitter() } },
      canvas: { mount: null, hooks: { frame() {} } },
    });
    ok(session.errors.length === 0, 'session: no build errors');
    ok(session.voice && session.audio && session.input, 'session: pieces built');
    ok(session.canvas && session.canvas.fallback === true, 'session: canvas fallback preserved');
    ok(typeof session.end === 'function', 'session: end alias');
    session.dispose();
    ok(session.disposed() === true, 'session: disposed flag');
    ok(session.voice.disposed() && session.audio.disposed() && session.input.disposed(), 'session: pieces disposed together');
    session.end();
    ok(session.disposed() === true, 'session: end idempotent');

    const empty = index.createSessionToolkit({});
    ok(empty.canvas === null && empty.input === null && empty.audio === null && empty.voice === null, 'session: missing sections null');
    empty.dispose();
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

async function main() {
  await testCanvasView();
  await testInput();
  await testAudio();
  await testVoice();
  await testIndex();
  console.log(`media-toolkit: ${passed} assertions passed`);
}

main().then(
  () => { process.exitCode = 0; },
  (e) => { console.error('media-toolkit FAILED:', e && e.message ? e.message : e); process.exitCode = 1; },
);

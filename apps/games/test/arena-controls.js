'use strict';
/* Arena-controls tests: the reusable orbit/tap/pinch gesture helper for
 * toy 3D board games (public/js/renderers/arena-controls.mjs). Pure math
 * plus fully mocked element/camera/window gesture flows — rotating or
 * zooming must never fire onTap, taps must raycast exactly once, and
 * dispose must remove every listener. No DOM, no Three.js.
 * Run: node test/arena-controls.js */
const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

/* ---------- mocks ---------- */

class MockTarget {
  constructor(rect) {
    this.listeners = new Map();
    this.style = { touchAction: '' };
    this._rect = rect || { left: 0, top: 0, width: 200, height: 100 };
  }
  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(fn);
  }
  removeEventListener(type, fn) {
    const s = this.listeners.get(type);
    if (s) s.delete(fn);
  }
  dispatch(type, e) {
    const s = this.listeners.get(type);
    if (s) for (const fn of [...s]) fn({ type, preventDefault() {}, ...e });
  }
  count() {
    let n = 0;
    for (const s of this.listeners.values()) n += s.size;
    return n;
  }
  getBoundingClientRect() {
    return { ...this._rect };
  }
}

function mockCamera() {
  return {
    position: { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; } },
    looks: [],
    lookAt(x, y, z) { this.looks.push([x, y, z]); },
  };
}

function press(el, win, x, y, opts = {}) {
  const base = { pointerId: 1, clientX: x, clientY: y, pointerType: 'mouse', button: 0, buttons: 1 };
  el.dispatch('pointerdown', { ...base, ...opts });
  return base.pointerId;
}

async function main() {
  const mod = await import(pathToFileURL(path.join(__dirname, '..', 'public', 'js', 'renderers', 'arena-controls.mjs')).href);
  const {
    TAP_SLOP_PX, TAP_MAX_MS, clamp, isTapGesture, ndcFromClient,
    sphericalOffset, applyOrbit, createArenaControls,
  } = mod;
  assert.strictEqual(typeof createArenaControls, 'function', 'factory exported');

  // --- 1. tap classifier: small+fast taps, drags and slow presses fail ---
  {
    assert.strictEqual(isTapGesture(0, 0, 100), true, 'still press taps');
    assert.strictEqual(isTapGesture(3, 4, 599), true, '5px in time taps');
    assert.strictEqual(isTapGesture(TAP_SLOP_PX, 0, 10), true, 'slop edge taps');
    assert.strictEqual(isTapGesture(TAP_SLOP_PX + 1, 0, 10), false, 'past slop drags');
    assert.strictEqual(isTapGesture(0, 0, TAP_MAX_MS + 1), false, 'slow press is not a tap');
    assert.strictEqual(isTapGesture(0, 0, -1), false, 'negative dt never taps');
    assert.strictEqual(isTapGesture(NaN, 0, 1), false, 'NaN never taps');
    assert.strictEqual(isTapGesture(20, 0, 50, 24), true, 'custom slop honored');
    console.log('ARENA ok: tap classifier');
  }

  // --- 2. math: clamp, NDC mapping, orbit sphere, camera apply ---
  {
    assert.strictEqual(clamp(5, 1, 3), 3, 'clamp high');
    assert.strictEqual(clamp(-1, 0, 2), 0, 'clamp low');
    assert.strictEqual(clamp(NaN, 4, 9), 4, 'clamp NaN falls to lo');
    const rect = { left: 10, top: 20, width: 200, height: 100 };
    assert.deepStrictEqual(ndcFromClient(110, 70, rect), { x: 0, y: 0 }, 'center maps to origin');
    assert.deepStrictEqual(ndcFromClient(10, 20, rect), { x: -1, y: 1 }, 'top-left corner');
    assert.strictEqual(ndcFromClient(0, 0, { width: 0, height: 10 }), null, 'zero rect maps null');
    const o = sphericalOffset(0, Math.PI / 2, 10);
    assert(Math.abs(o.x) < 1e-9 && Math.abs(o.y - 10) < 1e-9 && Math.abs(o.z) < 1e-9, 'pole is overhead');
    const o2 = sphericalOffset(Math.PI / 2, 0, 4);
    assert(Math.abs(o2.x - 4) < 1e-9 && Math.abs(o2.y) < 1e-9 && Math.abs(o2.z) < 1e-9, 'yaw90 faces +x');
    const cam = mockCamera();
    applyOrbit(cam, { x: 1, y: 2, z: 3 }, 0, 0, 5);
    assert.deepStrictEqual([cam.position.x, cam.position.y, cam.position.z], [1, 2, 8], 'camera placed');
    assert.deepStrictEqual(cam.looks[0], [1, 2, 3], 'camera aimed at target');
    console.log('ARENA ok: clamp/ndc/orbit math');
  }

  // --- 3. tap fires once with the pick hit; latest callbacks win ---
  {
    const el = new MockTarget();
    const win = new MockTarget();
    const cam = mockCamera();
    let clock = 1000;
    const taps = [];
    const picks = [];
    const c = createArenaControls({
      element: el, camera: cam, window: win, now: () => clock,
      pick: (ndc) => { picks.push(ndc); return { x: 3, y: 1, team: 'red' }; },
      onTap: (hit) => taps.push(hit),
    });
    press(el, win, 100, 50);
    clock += 120;
    win.dispatch('pointerup', { pointerId: 1, clientX: 102, clientY: 51, pointerType: 'mouse' });
    assert.strictEqual(taps.length, 1, 'one tap fires');
    assert.deepStrictEqual(taps[0], { x: 3, y: 1, team: 'red' }, 'tap carries the pick hit');
    assert.strictEqual(picks.length, 1, 'pick runs exactly once per tap');
    assert(picks[0].x > -0.1 && picks[0].x < 0.1, 'tap NDC near center');
    // setCallbacks replaces the tap target (HUD remounts mid-game).
    const taps2 = [];
    c.setCallbacks({ onTap: (hit) => taps2.push(hit) });
    press(el, win, 100, 50);
    clock += 100;
    win.dispatch('pointerup', { pointerId: 1, clientX: 100, clientY: 50, pointerType: 'mouse' });
    assert.strictEqual(taps.length, 1, 'stale onTap not called again');
    assert.strictEqual(taps2.length, 1, 'latest onTap wins');
    assert.strictEqual(win.count(), 2, 'only lifetime interruption listeners remain after tap');
    c.dispose();
    console.log('ARENA ok: tap fires once, callbacks replaceable');
  }

  // --- 4. drag orbits and never taps; wheel/pinch zoom bounded ---
  {
    const el = new MockTarget();
    const win = new MockTarget();
    const cam = mockCamera();
    let clock = 5000;
    let taps = 0;
    const c = createArenaControls({
      element: el, camera: cam, window: win, now: () => clock,
      distance: 20, minDistance: 10, maxDistance: 30,
      pick: () => ({ x: 0, y: 0, team: 'red' }),
      onTap: () => { taps += 1; },
    });
    const yaw0 = c.getState().goal.yaw;
    press(el, win, 100, 50);
    win.dispatch('pointermove', { pointerId: 1, clientX: 160, clientY: 50, pointerType: 'mouse' });
    clock += 150;
    win.dispatch('pointerup', { pointerId: 1, clientX: 160, clientY: 50, pointerType: 'mouse' });
    assert.strictEqual(taps, 0, 'orbit drag never taps');
    assert(c.getState().goal.yaw < yaw0, 'drag right orbits left');
    assert.strictEqual(c.getState().userMoved, true, 'drag marks userMoved');
    assert.strictEqual(win.count(), 2, 'only lifetime interruption listeners remain after drag');
    // Wheel out clamps at maxDistance and never taps.
    for (let i = 0; i < 40; i++) el.dispatch('wheel', { deltaY: 120 });
    assert.strictEqual(c.getState().goal.distance, 30, 'wheel clamps at max');
    for (let i = 0; i < 80; i++) el.dispatch('wheel', { deltaY: -120 });
    assert.strictEqual(c.getState().goal.distance, 10, 'wheel clamps at min');
    assert.strictEqual(taps, 0, 'wheel never taps');
    // Pinch: fingers apart zooms in (standard), never taps.
    for (let i = 0; i < 5; i++) el.dispatch('wheel', { deltaY: 120 });
    const pinchStart = c.getState().goal.distance;
    assert(pinchStart > 15, 'mid-zoom reset for the pinch leg');
    clock += 1000;
    el.dispatch('pointerdown', { pointerId: 1, clientX: 90, clientY: 50, pointerType: 'touch' });
    el.dispatch('pointerdown', { pointerId: 2, clientX: 110, clientY: 50, pointerType: 'touch' });
    win.dispatch('pointermove', { pointerId: 1, clientX: 60, clientY: 50, pointerType: 'touch' });
    win.dispatch('pointermove', { pointerId: 2, clientX: 140, clientY: 50, pointerType: 'touch' });
    assert(c.getState().goal.distance < pinchStart, 'pinch spread zooms in');
    clock += 200;
    win.dispatch('pointerup', { pointerId: 1, clientX: 60, clientY: 50, pointerType: 'touch' });
    win.dispatch('pointerup', { pointerId: 2, clientX: 140, clientY: 50, pointerType: 'touch' });
    assert.strictEqual(taps, 0, 'pinch never taps');
    // Partial lift: the finger that travelled during the pinch re-anchors,
    // so continuing 5px orbits 5px — no jump from the stale origin, no tap.
    const yawBefore = c.getState().goal.yaw;
    el.dispatch('pointerdown', { pointerId: 1, clientX: 90, clientY: 50, pointerType: 'touch' });
    el.dispatch('pointerdown', { pointerId: 2, clientX: 110, clientY: 50, pointerType: 'touch' });
    win.dispatch('pointermove', { pointerId: 1, clientX: 60, clientY: 50, pointerType: 'touch' });
    win.dispatch('pointerup', { pointerId: 2, clientX: 110, clientY: 50, pointerType: 'touch' });
    win.dispatch('pointermove', { pointerId: 1, clientX: 65, clientY: 50, pointerType: 'touch' });
    clock += 150;
    win.dispatch('pointerup', { pointerId: 1, clientX: 65, clientY: 50, pointerType: 'touch' });
    assert.strictEqual(taps, 0, 'partial pinch lift never taps');
    assert(Math.abs(c.getState().goal.yaw - yawBefore) < 0.05, 're-anchored drag stays smooth');
    c.dispose();
    console.log('ARENA ok: orbit/zoom never tap, zoom bounded');
  }

  // --- 5. hover picks on update only, fires on change, clears on leave ---
  {
    const el = new MockTarget();
    const win = new MockTarget();
    const cam = mockCamera();
    let clock = 9000;
    let cell = { x: 1, y: 1, team: 'blue' };
    let picks = 0;
    const hovers = [];
    const c = createArenaControls({
      element: el, camera: cam, window: win, now: () => clock, hoverThrottleMs: 50,
      pick: () => { picks += 1; return cell; },
      onHover: (hit) => hovers.push(hit),
    });
    el.dispatch('pointermove', { clientX: 100, clientY: 50, pointerType: 'mouse', buttons: 0 });
    assert.strictEqual(picks, 0, 'hover pick waits for the frame loop');
    c.update(0.016);
    assert.strictEqual(picks, 1, 'one pick per frame at most');
    assert.strictEqual(hovers.length, 1, 'first hover fires');
    c.update(0.016);
    assert.strictEqual(hovers.length, 1, 'same cell does not refire');
    clock += 100;
    cell = { x: 2, y: 1, team: 'blue' };
    el.dispatch('pointermove', { clientX: 120, clientY: 50, pointerType: 'mouse', buttons: 0 });
    c.update(0.016);
    assert.strictEqual(hovers.length, 2, 'changed cell refires');
    el.dispatch('pointerleave', {});
    assert.strictEqual(hovers.length, 3, 'leave clears hover');
    assert.strictEqual(hovers[2], null, 'leave reports null');
    c.dispose();
    console.log('ARENA ok: hover throttled + change-fired');
  }

  // --- 6. focus animates, reduced motion snaps, reset restores home ---
  {
    const el = new MockTarget();
    const win = new MockTarget();
    const cam = mockCamera();
    const c = createArenaControls({
      element: el, camera: cam, window: win,
      target: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: 0.9, distance: 26,
    });
    c.focus({ x: 0, y: 1, z: -5 }, { distance: 16, yaw: 0.2 });
    const mid = c.getState();
    assert.strictEqual(mid.goal.distance, 16, 'focus aims the goal');
    assert.strictEqual(mid.distance, 26, 'focus starts from home (animated)');
    c.update(0.05);
    const step1 = c.getState();
    assert(step1.distance < 26 && step1.distance > 16, 'focus travels toward the goal');
    for (let i = 0; i < 200; i++) c.update(0.05);
    const end = c.getState();
    assert(Math.abs(end.distance - 16) < 1e-6, 'focus converges on distance');
    assert(Math.abs(end.target.z + 5) < 1e-6, 'focus converges on target');
    assert.strictEqual(end.userMoved, false, 'programmatic focus clears userMoved');
    c.reset({ instant: true });
    const home = c.getState();
    assert.strictEqual(home.distance, 26, 'reset restores home distance');
    assert.deepStrictEqual(home.target, { x: 0, y: 0, z: 0 }, 'reset restores home target');
    c.dispose();
    // Reduced motion: focus snaps with no travel frames.
    const c2 = createArenaControls({
      element: new MockTarget(), camera: mockCamera(), window: new MockTarget(),
      distance: 26, reducedMotion: () => true,
    });
    c2.focus({ x: 5, y: 0, z: 5 }, { distance: 12 });
    const s2 = c2.getState();
    assert.strictEqual(s2.distance, 12, 'reduced motion snaps distance');
    assert.deepStrictEqual(s2.target, { x: 5, y: 0, z: 5 }, 'reduced motion snaps target');
    c2.dispose();
    console.log('ARENA ok: focus/reset/reduced-motion');
  }

  // --- 7. dispose removes listeners, restores style, silences input ---
  {
    const el = new MockTarget();
    el.style.touchAction = 'pan-y';
    const win = new MockTarget();
    let taps = 0;
    const c = createArenaControls({
      element: el, camera: mockCamera(), window: win,
      pick: () => ({}), onTap: () => { taps += 1; },
    });
    assert.strictEqual(el.style.touchAction, 'none', 'touch-action locked during play');
    assert(el.count() > 0, 'element listeners attached');
    press(el, win, 100, 50); // mid-gesture dispose must still clean up
    assert(win.count() > 0, 'gesture listeners live mid-press');
    c.dispose();
    c.dispose();
    assert.strictEqual(el.count(), 0, 'element listeners removed');
    assert.strictEqual(win.count(), 0, 'window gesture listeners removed');
    assert.strictEqual(el.style.touchAction, 'pan-y', 'touch-action restored');
    win.dispatch('pointerup', { pointerId: 1, clientX: 100, clientY: 50, pointerType: 'mouse' });
    el.dispatch('wheel', { deltaY: -500 });
    assert.strictEqual(taps, 0, 'disposed controls never tap');
    assert.strictEqual(c.getState().disposed, true, 'state reports disposed');
    console.log('ARENA ok: dispose cleans listeners + style');
  }

  // Phone interruptions must never convert an abandoned orbit/pinch into a build/fire tap.
  {
    const el=new MockTarget(), win=new MockTarget(), doc=new MockTarget(); doc.hidden=false;
    let clock=10000,taps=0;
    const c=createArenaControls({element:el,camera:mockCamera(),window:win,document:doc,
      now:()=>clock,pick:()=>({team:'red',x:1,y:1}),onTap:()=>taps++});
    press(el,win,50,50,{pointerId:10,pointerType:'touch'});
    win.dispatch('pointerup',{pointerId:99,clientX:150,clientY:50,pointerType:'touch'});
    clock+=100;
    win.dispatch('pointerup',{pointerId:10,clientX:50,clientY:50,pointerType:'touch'});
    assert.equal(taps,1,'unrelated touch cannot reanchor or cancel the legal tap');
    press(el,win,50,50,{pointerId:11,pointerType:'touch'}); win.dispatch('blur');
    win.dispatch('pointerup',{pointerId:11,clientX:50,clientY:50,pointerType:'touch'});
    assert.equal(taps,1,'background blur never commits an abandoned tap');
    press(el,win,50,50,{pointerId:12,pointerType:'touch'});
    press(el,win,100,50,{pointerId:13,pointerType:'touch'});
    doc.hidden=true; doc.dispatch('visibilitychange');
    assert.equal(win.count(),2,'backgrounding clears pinch listeners immediately');
    win.dispatch('pointerup',{pointerId:12,clientX:50,clientY:50,pointerType:'touch'});
    win.dispatch('pointerup',{pointerId:13,clientX:100,clientY:50,pointerType:'touch'});
    assert.equal(taps,1,'abandoned pinch never builds or fires');
    doc.hidden=false; press(el,win,50,50,{pointerId:14,pointerType:'touch'});clock+=100;
    win.dispatch('pointerup',{pointerId:14,clientX:50,clientY:50,pointerType:'touch'});
    assert.equal(taps,2,'new touches work after returning');
    el.dispatch('pointerdown', {pointerId:6,clientX:60,clientY:50,pointerType:'touch'});
    win.dispatch('orientationchange', {});
    win.dispatch('pointerup', {pointerId:6,clientX:60,clientY:50,pointerType:'touch'});
    assert.equal(taps,2,'rotation cancels an active touch without placement');
    c.dispose(); assert.equal(doc.count(),0); assert.equal(win.count(),0);
    console.log('ARENA ok: unrelated contacts, blur/hidden cleanup and touch resume');
  }

  // --- 8. disabled controls ignore input but keep rendering safe ---
  {
    const el = new MockTarget();
    const win = new MockTarget();
    let taps = 0;
    const c = createArenaControls({
      element: el, camera: mockCamera(), window: win,
      pick: () => ({}), onTap: () => { taps += 1; },
    });
    c.setEnabled(false);
    press(el, win, 100, 50);
    win.dispatch('pointerup', { pointerId: 1, clientX: 100, clientY: 50, pointerType: 'mouse' });
    el.dispatch('wheel', { deltaY: -500 });
    assert.strictEqual(taps, 0, 'disabled controls never tap');
    c.update(0.016); // safe no-op while disabled
    c.setEnabled(true);
    c.dispose();
    console.log('ARENA ok: setEnabled gates input');
  }

  // --- 9. screen/orientation/drawer cancellation: a drag/pinch begun
  // before rotation, fullscreen, or a drawer toggle never becomes a tap.
  {
    const el = new MockTarget(), win = new MockTarget(), doc = new MockTarget();
    const orient = new MockTarget();
    win.screen = { orientation: orient };
    doc.hidden = false;
    let clock = 20000, taps = 0;
    const hovered = [];
    const c = createArenaControls({ element: el, camera: mockCamera(), window: win, document: doc,
      now: () => clock, onHover: (hit) => hovered.push(hit),
      pick: () => ({ team: 'red', x: 1, y: 1 }), onTap: () => { taps += 1; } });
    assert.strictEqual(typeof c.cancel, 'function', 'cancel exposed');
    const drawer = (cls) => ({ closest: (sel) => (sel.includes(cls) ? {} : null) });
    // Drag + shell fullscreen/orientation signal.
    const g0 = c.getState().goal.distance;
    el.dispatch('pointermove', {clientX:50, clientY:50, pointerType:'mouse', buttons:0});
    c.update(0.016);
    assert(hovered.at(-1), 'target hovered before interrupt');
    press(el, win, 50, 50, { pointerId: 21, pointerType: 'touch' });
    win.dispatch('pointermove', { pointerId: 21, clientX: 90, clientY: 50, pointerType: 'touch' });
    doc.dispatch('game-screenchange', {});
    assert.strictEqual(hovered.at(-1), null, 'screen interruption clears the stale target hint');
    assert.strictEqual(win.count(), 2, 'screenchange clears gesture listeners');
    win.dispatch('pointerup', { pointerId: 21, clientX: 90, clientY: 50, pointerType: 'touch' });
    assert.strictEqual(taps, 0, 'pre-rotation drag never taps');
    assert.strictEqual(c.getState().goal.distance, g0, 'cancel keeps framing');
    // Pinch + native orientation change.
    el.dispatch('pointerdown', { pointerId: 22, clientX: 80, clientY: 50, pointerType: 'touch' });
    el.dispatch('pointerdown', { pointerId: 23, clientX: 120, clientY: 50, pointerType: 'touch' });
    orient.dispatch('change', {});
    win.dispatch('pointerup', { pointerId: 22, clientX: 80, clientY: 50, pointerType: 'touch' });
    win.dispatch('pointerup', { pointerId: 23, clientX: 120, clientY: 50, pointerType: 'touch' });
    assert.strictEqual(taps, 0, 'orientation change cancels the pinch');
    // Room drawer + HUD drawers.
    for (const cls of ['room-menu', 'cc3d-help', 'cc3d-camera-menu']) {
      press(el, win, 50, 50, { pointerId: 24, pointerType: 'touch' });
      doc.dispatch('toggle', { target: drawer(cls) });
      clock += 80;
      win.dispatch('pointerup', { pointerId: 24, clientX: 50, clientY: 50, pointerType: 'touch' });
      assert.strictEqual(taps, 0, cls + ' toggle cancels without a tap');
    }
    // Unrelated drawer toggles do not steal a legal tap.
    press(el, win, 50, 50, { pointerId: 25, pointerType: 'touch' });
    doc.dispatch('toggle', { target: drawer('other-panel') });
    clock += 100;
    win.dispatch('pointerup', { pointerId: 25, clientX: 51, clientY: 50, pointerType: 'touch' });
    assert.strictEqual(taps, 1, 'unrelated toggle keeps the tap');
    // Explicit cancel(): capture released, state dropped, framing kept.
    let released = [];
    el.releasePointerCapture = (id) => { released.push(id); };
    el.hasPointerCapture = () => true;
    const gy = c.getState().goal.yaw;
    press(el, win, 60, 50, { pointerId: 26, pointerType: 'touch' });
    c.cancel();
    assert.deepStrictEqual(released, [26], 'cancel releases capture');
    assert.strictEqual(win.count(), 2, 'cancel clears gesture listeners');
    win.dispatch('pointerup', { pointerId: 26, clientX: 60, clientY: 50, pointerType: 'touch' });
    assert.strictEqual(taps, 1, 'cancelled press never taps');
    assert.strictEqual(c.getState().goal.yaw, gy, 'explicit cancel keeps framing');
    press(el, win, 50, 50, { pointerId: 27, pointerType: 'touch' });
    clock += 100;
    win.dispatch('pointerup', { pointerId: 27, clientX: 50, clientY: 50, pointerType: 'touch' });
    assert.strictEqual(taps, 2, 'taps resume after cancel');
    c.cancel();
    c.dispose();
    c.cancel(); // safe after dispose
    assert.strictEqual(el.count(), 0, 'element listeners removed');
    assert.strictEqual(win.count(), 0, 'window listeners removed');
    assert.strictEqual(doc.count(), 0, 'document screenchange/toggle listeners removed');
    assert.strictEqual(orient.count(), 0, 'orientation listener removed');
    console.log('ARENA ok: screen/orientation/drawer cancel without taps, dispose clean');
  }

  console.log('ARENA_CONTROLS_PASS');
}

main().catch((e) => {
  console.error(e && e.stack ? e.stack : e);
  process.exit(1);
});

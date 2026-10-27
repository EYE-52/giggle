/* Reusable thumb-stick regression: pure vector math plus injected
 * DOM/window/document stubs (no browser, no GPU, no timers). Run:
 *   node test/mobile-stick.mjs */
import nativeAssert from 'node:assert/strict';
let assertions = 0;
const assert = new Proxy(nativeAssert, {
  apply(t, self, args) { assertions++; return Reflect.apply(t, self, args); },
  get(t, key) { const v=t[key]; return typeof v === 'function' ? (...args) => { assertions++; return v(...args); } : v; },
});
import { createMobileStick, normalizeStickVector, STICK_DEADZONE } from '../public/js/toolkit/mobile-stick.mjs';

function makeHost({ rect, captureSyncLost = false } = {}) {
  const el = {
    style: { props: {}, setProperty(k, v) { this.props[k] = String(v); } },
    attrs: new Map(),
    listeners: new Map(),
    captures: new Set(),
    releaseCalls: 0,
    rect: rect || { left: 0, top: 0, width: 120, height: 120 },
    setAttribute(k, v) { this.attrs.set(k, String(v)); },
    removeAttribute(k) { this.attrs.delete(k); },
    addEventListener(t, fn) { this.listeners.set(t, [...(this.listeners.get(t) || []), fn]); },
    removeEventListener(t, fn) { this.listeners.set(t, (this.listeners.get(t) || []).filter((f) => f !== fn)); },
    fire(t, e = {}) { for (const f of [...(this.listeners.get(t) || [])]) f(e); },
    getBoundingClientRect() { return { ...this.rect }; },
    setPointerCapture(id) { this.captures.add(id); },
    hasPointerCapture(id) { return this.captures.has(id); },
    releasePointerCapture(id) {
      this.releaseCalls += 1;
      this.captures.delete(id);
      // Optional synchronous lostcapture, like real browsers on release.
      if (captureSyncLost) this.fire('lostpointercapture', { pointerId: id });
    },
  };
  const win = {
    listeners: new Map(),
    addEventListener(t, fn) { this.listeners.set(t, [...(this.listeners.get(t) || []), fn]); },
    removeEventListener(t, fn) { this.listeners.set(t, (this.listeners.get(t) || []).filter((f) => f !== fn)); },
    fire(t, e = {}) { for (const f of [...(this.listeners.get(t) || [])]) f(e); },
  };
  const doc = {
    listeners: new Map(),
    hidden: false,
    addEventListener(t, fn) { this.listeners.set(t, [...(this.listeners.get(t) || []), fn]); },
    removeEventListener(t, fn) { this.listeners.set(t, (this.listeners.get(t) || []).filter((f) => f !== fn)); },
    fire(t, e = {}) { for (const f of [...(this.listeners.get(t) || [])]) f(e); },
  };
  win.screen = { orientation: {...win, listeners:new Map()} };
  return { el, win, doc };
}

const touch = (pointerId, x, y, extra = {}) => ({
  pointerId, pointerType: 'touch', clientX: x, clientY: y,
  preventDefault() { this.defaultPrevented = true; },
  ...extra,
});
const approx = (v, want, eps = 1e-6) => Math.abs(v - want) <= eps;

// --- pure vector: deadzone, partial analog, diagonal clamp, transfer ---
assert.equal(STICK_DEADZONE, 0.14, 'radial deadzone stays ~.14');
assert.deepEqual(normalizeStickVector(5, 0, 60, 0.14), { x: 0, y: 0 }, 'inside deadzone reads zero');
assert.deepEqual(normalizeStickVector(0, 0, 60), { x: 0, y: 0 }, 'center reads zero');
assert.deepEqual(normalizeStickVector(10, 10, 0), { x: 0, y: 0 }, 'degenerate radius reads zero');
{
  // Partial analog: 30px of a 60px radius = 0.5 raw, rescaled to (0.5-.14)/.86.
  const v = normalizeStickVector(30, 0, 60, 0.14);
  assert.ok(approx(v.x, (0.5 - 0.14) / 0.86, 1e-9) && v.y === 0, `partial steer keeps proportion (${v.x})`);
  assert.ok(v.x > 0 && v.x < 0.5, 'deadzone transfer stays below raw magnitude');
}
{
  // Deliberate transfer: just above deadzone starts near zero, pad edge hits 1.
  const edge = normalizeStickVector(8.4, 0, 60, 0.14); // mag exactly .14
  assert.deepEqual(edge, { x: 0, y: 0 }, 'deadzone edge still zero');
  const small = normalizeStickVector(12, 0, 60, 0.14); // mag .2
  assert.ok(small.x > 0 && small.x < 0.1, `small push stays small (${small.x})`);
  assert.deepEqual(normalizeStickVector(60, 0, 60, 0.14), { x: 1, y: 0 }, 'edge reads full');
  assert.deepEqual(normalizeStickVector(0, -60, 60, 0.14), { x: 0, y: -1 }, 'full UP reads -1 (host negates to throttle)');
}
{
  // Diagonal: corner push clamps to unit length, direction preserved.
  const v = normalizeStickVector(60, 60, 60, 0.14);
  const unit = Math.SQRT1_2;
  assert.ok(approx(v.x, unit, 1e-9) && approx(v.y, unit, 1e-9), `diagonal clamps to unit (${v.x},${v.y})`);
  assert.ok(approx(Math.hypot(v.x, v.y), 1, 1e-9), 'diagonal magnitude is exactly full');
}
{
  // Off-pad drags clamp, never exceed [-1,1].
  const v = normalizeStickVector(200, -50, 60, 0.14);
  assert.ok(Math.hypot(v.x, v.y) <= 1 + 1e-9, 'far drag clamps to unit');
  assert.ok(v.x <= 1 && v.y >= -1, 'clamped to [-1,1]');
}

// --- behavior: one stick pointer, capture, fallbacks, unrelated ignored ---
{
  const { el, win, doc } = makeHost();
  const seen = [];
  const stick = createMobileStick(el, { window: win, document: doc, onChange: (v) => seen.push({ ...v }) });
  assert.deepEqual(stick.value(), { x: 0, y: 0 }, 'starts centered');
  // No move when no active contact.
  el.fire('pointermove', touch(9, 90, 60));
  win.fire('pointermove', touch(9, 90, 60));
  assert.equal(seen.length, 0, 'moves without contact emit nothing');

  // Primary down right of center: partial +x, capture acquired.
  const down = touch(1, 90, 60);
  el.fire('pointerdown', down);
  assert.equal(down.defaultPrevented, true, 'primary down prevents scroll');
  assert.ok(el.captures.has(1), 'primary pointer captured for off-pad drags');
  assert.equal(el.attrs.get('data-active'), '', 'dragging sets data-active');
  assert.equal(seen.length, 1, 'primary down emits once');
  assert.ok(seen[0].x > 0.3 && seen[0].x < 0.5 && seen[0].y === 0, `partial analog value (${seen[0].x})`);
  assert.equal(el.style.props['--pk-sx'], String(seen[0].x), 'CSS var mirrors x');
  assert.equal(el.style.props['--pk-sy'], '0', 'CSS var mirrors y');

  // Secondary stick finger rejected WITHOUT interfering.
  const second = touch(2, 30, 60);
  el.fire('pointerdown', second);
  assert.equal(second.defaultPrevented, undefined, 'secondary finger not prevented');
  assert.ok(!el.captures.has(2), 'secondary finger never captured');
  assert.equal(seen.length, 1, 'secondary finger emits nothing');
  assert.deepEqual(stick.value(), seen[0], 'secondary finger cannot move the value');

  // Unrelated window moves (e.g. right-button fingers) ignored.
  win.fire('pointermove', touch(99, 0, 0));
  el.fire('pointermove', touch(2, 0, 0));
  assert.equal(seen.length, 1, 'unrelated moves ignored');

  // Off-pad drag through capture: far right clamps to full.
  el.fire('pointermove', touch(1, 400, 60));
  assert.deepEqual(seen.at(-1), { x: 1, y: 0 }, 'captured drag continues outside the pad');

  // Diagonal proportional intent through the window fallback path.
  win.fire('pointermove', touch(1, 60 + 60 * Math.SQRT1_2, 60 + 60 * Math.SQRT1_2));
  const diag = seen.at(-1);
  assert.ok(approx(diag.x, Math.SQRT1_2, 0.02) && approx(diag.y, Math.SQRT1_2, 0.02), 'diagonal stays proportional');

  // Unrelated up/cancel/lostcapture cannot release the primary.
  win.fire('pointerup', touch(99, 0, 0));
  el.fire('pointercancel', touch(2, 0, 0));
  el.fire('lostpointercapture', { pointerId: 99 });
  assert.notDeepEqual(stick.value(), { x: 0, y: 0 }, 'unrelated releases keep the drag');

  // Primary release springs to zero exactly once.
  const n = seen.length;
  el.fire('pointerup', touch(1, 400, 60));
  assert.deepEqual(seen.at(-1), { x: 0, y: 0 }, 'release springs to zero');
  assert.equal(seen.length, n + 1, 'release emits exactly one zero');
  assert.equal(el.style.props['--pk-sx'], '0', 'CSS var springs back');
  assert.equal(el.attrs.has('data-active'), false, 'data-active cleared for CSS transition');
  assert.equal(el.releaseCalls, 1, 'actual capture released exactly once');
  // Duplicate window up after element up is a no-op.
  win.fire('pointerup', touch(1, 400, 60));
  assert.equal(seen.length, n + 1, 'duplicate release emits nothing');
  assert.equal(el.releaseCalls, 1, 'duplicate release never re-releases');
  stick.dispose();
}

{
  // Fallback window moves when capture is unavailable (setPointerCapture throws).
  const { el, win, doc } = makeHost();
  el.setPointerCapture = () => { throw new Error('no capture'); };
  const seen = [];
  const stick = createMobileStick(el, { window: win, document: doc, onChange: (v) => seen.push({ ...v }) });
  el.fire('pointerdown', touch(7, 60, 30)); // straight UP
  assert.equal(seen.length, 1, 'down without capture still emits');
  assert.ok(seen[0].y < 0 && seen[0].x === 0, 'UP reads negative y');
  win.fire('pointermove', touch(7, 60, 0)); // pad edge via window fallback
  assert.deepEqual(seen.at(-1), { x: 0, y: -1 }, 'window fallback tracks outside the pad');
  win.fire('pointerup', touch(7, 60, 0));
  assert.deepEqual(seen.at(-1), { x: 0, y: 0 }, 'window fallback release springs to zero');
  assert.equal(el.releaseCalls, 0, 'never-captured pointer never released');
  stick.dispose();
}

{
  // Non-left mouse rejected; left mouse still drives (desktop testing).
  const { el, win, doc } = makeHost();
  const seen = [];
  const stick = createMobileStick(el, { window: win, document: doc, onChange: (v) => seen.push({ ...v }) });
  el.fire('pointerdown', { pointerId: 3, pointerType: 'mouse', button: 2, clientX: 90, clientY: 60, preventDefault() {} });
  assert.equal(seen.length, 0, 'right mouse rejected');
  assert.deepEqual(stick.value(), { x: 0, y: 0 }, 'rejected mouse leaves center');
  el.fire('pointerdown', { pointerId: 4, pointerType: 'mouse', button: 0, clientX: 90, clientY: 60, preventDefault() {} });
  assert.equal(seen.length, 1, 'left mouse accepted');
  win.fire('pointermove', { pointerId: 4, pointerType: 'mouse', buttons: 0, clientX: 120, clientY: 60 });
  assert.deepEqual(stick.value(), {x:0,y:0}, 'missed mouseup outside browser chrome springs back');
  assert.equal(seen.length,2, 'missed mouseup emits exactly one neutral');
  assert.equal(el.releaseCalls,1, 'missed mouseup releases capture once');
  el.fire('pointerup', { pointerId: 4, pointerType: 'mouse', clientX: 90, clientY: 60 });
  assert.equal(seen.length,2, 'late mouseup is inert');
  stick.dispose();
}

{
  // Synchronous lostcapture during release cannot double-release or double-emit.
  const { el, win, doc } = makeHost({ captureSyncLost: true });
  const seen = [];
  const stick = createMobileStick(el, { window: win, document: doc, onChange: (v) => seen.push({ ...v }) });
  el.fire('pointerdown', touch(5, 90, 60));
  const n = seen.length;
  el.fire('pointerup', touch(5, 90, 60));
  assert.equal(el.releaseCalls, 1, 'sync lostcapture still releases exactly once');
  assert.equal(seen.length, n + 1, 'sync lostcapture emits one zero');
  assert.deepEqual(seen.at(-1), { x: 0, y: 0 }, 'sync lostcapture ends centered');
  stick.dispose();
}

{
  // Cancel, blur, hidden, and rotation all spring back and release once.
  for (const trigger of ['cancel', 'blur', 'hidden', 'orientation', 'modern', 'screen']) {
    const { el, win, doc } = makeHost();
    const seen = [];
    const stick = createMobileStick(el, { window: win, document: doc, onChange: (v) => seen.push({ ...v }) });
    el.fire('pointerdown', touch(11, 90, 60));
    assert.notDeepEqual(stick.value(), { x: 0, y: 0 }, `${trigger}: drag starts`);
    if (trigger === 'cancel') win.fire('pointercancel', touch(11, 90, 60));
    else if (trigger === 'blur') win.fire('blur', {});
    else if (trigger === 'hidden') { doc.hidden = true; doc.fire('visibilitychange', {}); }
    else if (trigger === 'modern') win.screen.orientation.fire('change', {});
    else if (trigger === 'screen') doc.fire('game-screenchange', {});
    else win.fire('orientationchange', {});
    assert.deepEqual(stick.value(), { x: 0, y: 0 }, `${trigger}: springs back`);
    assert.deepEqual(seen.at(-1), { x: 0, y: 0 }, `${trigger}: emits zero`);
    assert.equal(el.releaseCalls, 1, `${trigger}: releases capture once`);
    // Visible again without contact stays silent.
    doc.hidden = false;
    doc.fire('visibilitychange', {});
    assert.deepEqual(seen.at(-1), { x: 0, y: 0 }, `${trigger}: no extra emit`);
    stick.dispose();
  }
}

{
  // reset(false) silences onChange for host atomic clear; reset() emits.
  const { el, win, doc } = makeHost();
  const seen = [];
  const stick = createMobileStick(el, { window: win, document: doc, onChange: (v) => seen.push({ ...v }) });
  el.fire('pointerdown', touch(1, 90, 60));
  const n = seen.length;
  stick.reset(false);
  assert.equal(seen.length, n, 'silent reset emits nothing');
  assert.deepEqual(stick.value(), { x: 0, y: 0 }, 'silent reset still centers');
  assert.equal(el.releaseCalls, 1, 'silent reset still releases capture');
  el.fire('pointerdown', touch(2, 90, 60));
  const m = seen.length;
  stick.reset();
  assert.equal(seen.length, m + 1, 'loud reset emits zero');
  assert.deepEqual(seen.at(-1), { x: 0, y: 0 }, 'loud reset value is zero');
  // Idle reset is a full no-op.
  stick.reset();
  assert.equal(seen.length, m + 1, 'idle reset emits nothing');
  stick.dispose();
}

{
  // Enabled gate: watcher/done views never start a drag.
  const { el, win, doc } = makeHost();
  const seen = [];
  let enabled = false;
  const stick = createMobileStick(el, { window: win, document: doc, enabled: () => enabled, onChange: (v) => seen.push({ ...v }) });
  el.fire('pointerdown', touch(1, 90, 60));
  assert.equal(seen.length, 0, 'disabled down ignored');
  assert.deepEqual(stick.value(), { x: 0, y: 0 }, 'disabled drag never starts');
  enabled = true;
  el.fire('pointerdown', touch(1, 90, 60));
  assert.equal(seen.length, 1, 'enabled down drives');
  enabled = false;
  el.fire('pointermove', touch(1,120,60));
  assert.deepEqual(stick.value(),{x:0,y:0},'disabling during drag cancels old contact');
  assert.deepEqual(seen.at(-1),{x:0,y:0},'disabling during drag emits neutral');
  assert.equal(el.releaseCalls,1,'disabled contact capture released once');
  stick.dispose();
}

{
  // Pointer id zero is a real identity, not an idle sentinel.
  const { el, win, doc } = makeHost({captureSyncLost:true});
  const seen=[];
  const stick=createMobileStick(el,{window:win,document:doc,onChange:v=>seen.push(v)});
  el.fire('pointerdown',touch(0,90,60));
  assert(el.hasPointerCapture(0),'pointer id zero captures');
  win.fire('pointerup',touch(1,90,60));
  assert(stick.value().x>0,'unrelated up preserves pointer id zero');
  el.fire('pointercancel',touch(0,90,60));
  assert.deepEqual(stick.value(),{x:0,y:0});
  assert.equal(el.releaseCalls,1);
  assert.equal(seen.length,2,'id zero cancel emits one neutral despite synchronous lost capture');
  stick.dispose();
}

{
  // Dispose is idempotent, removes listeners, releases once, stays silent after.
  const { el, win, doc } = makeHost();
  const seen = [];
  const stick = createMobileStick(el, { window: win, document: doc, onChange: (v) => seen.push({ ...v }) });
  el.fire('pointerdown', touch(1, 90, 60));
  const n = seen.length;
  stick.dispose();
  stick.dispose();
  assert.equal(el.releaseCalls, 1, 'dispose releases capture exactly once');
  assert.equal(seen.length, n, 'dispose itself emits no stale zero');
  el.fire('pointermove', touch(1, 30, 60));
  win.fire('pointerup', touch(1, 30, 60));
  win.fire('blur', {});
  assert.equal(seen.length, n, 'no callbacks after dispose');
  for (const [t, fns] of el.listeners) assert.equal(fns.length, 0, `element listener removed: ${t}`);
  for (const [t, fns] of win.listeners) assert.equal(fns.length, 0, `window listener removed: ${t}`);
  for (const [t, fns] of doc.listeners) assert.equal(fns.length, 0, `document listener removed: ${t}`);
  for (const [t, fns] of win.screen.orientation.listeners) assert.equal(fns.length,0,`modern orientation listener removed: ${t}`);
  stick.reset();
  assert.equal(seen.length, n, 'reset after dispose stays silent');
}

console.log(`MOBILE_STICK_PASS: ${assertions} assertions; vector, single-pointer capture, fallbacks, missed mouseup, release-once, legacy/modern screen stops and disposal`);

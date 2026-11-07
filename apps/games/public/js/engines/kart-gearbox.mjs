// Four-speed automatic gearbox for what the driver hears and sees: engine
// revs, the gear readout and the shift kick. Physics stays a single
// traction-limited drive (more low-gear torque only spins the tyres), so the
// gear is derived from road speed and every client agrees without new wire.

export const GEAR_COUNT = 4;
// Upshift points as a fraction of the mode's top speed. Downshifts happen a
// little lower so cruising near a shift point does not hunt between gears.
export const GEAR_TOPS = Object.freeze([.24, .47, .72]);
const HYSTERESIS = .05;

// Revs climb from the bottom of each band to the redline; a freshly shifted
// gear starts mid-band, which is the audible drop of a real upshift.
function revsIn(gear, f) {
  const lo = gear > 1 ? GEAR_TOPS[gear - 2] : 0, hi = gear <= GEAR_TOPS.length ? GEAR_TOPS[gear - 1] : 1;
  const x = Math.min(1, Math.max(0, (f - lo) / (hi - lo)));
  return gear > 1 ? .42 + .58 * x : x;
}

// Gear (1..4, 0 = reverse) and revs (0..1) for a signed road speed.
// Pass the previous gear to apply downshift hysteresis.
export function gearState(speed, top, previous = 1) {
  const max = top > 0 ? top : 1;
  if (speed < -0.5) return { gear: 0, rpm: Math.min(1, -speed / (max * .25)) };
  const f = Math.min(1, Math.abs(speed) / max);
  let gear = 1;
  while (gear <= GEAR_TOPS.length && f >= GEAR_TOPS[gear - 1]) gear++;
  // Hold a higher previous gear until speed falls clearly below its band.
  if (previous > gear && previous <= GEAR_COUNT && f >= GEAR_TOPS[previous - 2] - HYSTERESIS) gear = previous;
  return { gear, rpm: revsIn(gear, f) };
}

// Small stateful tracker for a renderer or the audio: reports shifts.
export function createGearbox(top) {
  let gear = 1, rpm = 0;
  return {
    update(speed, maxSpeed = top) {
      const before = gear, next = gearState(speed, maxSpeed, gear);
      gear = next.gear; rpm = next.rpm;
      return { gear, rpm, shift: gear && before && gear !== before ? Math.sign(gear - before) : 0 };
    },
    get gear() { return gear; },
    get rpm() { return rpm; },
    reset() { gear = 1; rpm = 0; },
  };
}

// Gear badge beside the speed readout. Writes only when the gear changes
// and pops with a transform, so the HUD never reflows mid-race.
export function paintGear(el, state) {
  if (!el || !state) return;
  const label = state.gear ? String(state.gear) : 'R';
  if (el.textContent === label) return;
  el.textContent = label;
  el.setAttribute('aria-label', state.gear ? 'Gear ' + state.gear : 'Reverse');
  el.dataset.gear = label;
  const still = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (state.shift && !still && typeof el.animate === 'function')
    el.animate([{ transform: 'scale(1.45)' }, { transform: 'scale(1)' }], { duration: 260, easing: 'cubic-bezier(.34,1.56,.64,1)' });
}

export default { GEAR_COUNT, GEAR_TOPS, gearState, createGearbox, paintGear };

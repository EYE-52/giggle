// Four-speed automatic gearbox and the procedural engine layers it drives.
import assert from 'node:assert/strict';
import { GEAR_COUNT, GEAR_TOPS, gearState, createGearbox } from '../public/js/engines/kart-gearbox.mjs';
import { createKartAudio } from '../public/js/engines/kart-audio.mjs';

let checks = 0;
const ok = (truth, label) => { assert.ok(truth, label); checks++; };

{
  const top = 20, seen = [];
  for (let v = 0; v <= top; v += .25) { const s = gearState(v, top); if (seen.at(-1) !== s.gear) seen.push(s.gear); }
  ok(GEAR_COUNT === 4 && GEAR_TOPS.length === 3, 'gearbox: four forward gears');
  ok(seen.join('') === '1234', 'gearbox: a full-throttle climb shifts 1-2-3-4 in order: ' + seen.join(''));
  ok(gearState(-3, top).gear === 0, 'gearbox: reverse is its own gear');
  ok(gearState(top * 3, top).gear === 4 && gearState(top * 3, top).rpm === 1, 'gearbox: nitro beyond the cap holds 4th at the redline');
  const below = gearState(GEAR_TOPS[0] * top - .01, top), above = gearState(GEAR_TOPS[0] * top + .01, top);
  ok(below.rpm > .97 && above.rpm < .5, 'gearbox: an upshift drops the revs into the next band');
  ok(gearState(GEAR_TOPS[1] * top - .5, top, 3).gear === 3, 'gearbox: downshift waits for hysteresis');
  ok(gearState(GEAR_TOPS[1] * top - 2, top, 3).gear === 2, 'gearbox: a clear slowdown downshifts');
}

{
  const box = createGearbox(20), shifts = [];
  for (let v = 0; v <= 20; v += .2) { const s = box.update(v); if (s.shift) shifts.push(s.shift); }
  ok(shifts.length === 3 && shifts.every(s => s === 1), 'tracker: reports exactly three upshifts');
  ok(box.update(20).shift === 0, 'tracker: a steady speed never reports a shift');
  let hunts = 0;
  for (let i = 0; i < 200; i++) hunts += Math.abs(box.update(GEAR_TOPS[2] * 20 + Math.sin(i) * .4).shift);
  ok(hunts <= 1, 'tracker: cruising on a shift point does not hunt (' + hunts + ')');
}

// Minimal Web Audio stand-in that counts nodes and records automation.
function fakeAudio() {
  const nodes = [], param = (v = 0) => {
    const p = { value: v, events: [] };
    for (const m of ['setTargetAtTime', 'setValueAtTime', 'linearRampToValueAtTime', 'exponentialRampToValueAtTime'])
      p[m] = (value, t) => { p.events.push([m, value, t]); p.value = value; };
    p.cancelScheduledValues = t => p.events.push(['cancel', 0, t]);
    return p;
  };
  const node = (kind, extra = {}) => {
    const n = { kind, links: [], connect(to) { n.links.push(to); }, disconnect() { n.gone = true; }, start() { n.started = true; }, stop() { n.stopped = true; }, ...extra };
    nodes.push(n); return n;
  };
  const ctx = {
    currentTime: 5, state: 'running', sampleRate: 8000, destination: {},
    createGain: () => node('gain', { gain: param(1) }),
    createBiquadFilter: () => node('filter', { type: 'lowpass', frequency: param(350), Q: param(1) }),
    createOscillator: () => node('osc', { type: 'sine', frequency: param(440) }),
    createBufferSource: () => node('buf', { buffer: null, loop: false, playbackRate: param(1) }),
    createDynamicsCompressor: () => node('comp', { threshold: param(), ratio: param(), attack: param(), release: param() }),
    createBuffer: (ch, len, rate) => { const data = new Float32Array(len); return { length: len, sampleRate: rate, getChannelData: () => data }; },
    decodeAudioData: () => Promise.resolve({ duration: .5 }),
    resume: () => Promise.resolve(), close: () => Promise.resolve(),
  };
  return { ctx, nodes };
}

{
  const { ctx, nodes } = fakeAudio();
  const audio = createKartAudio({ createContext: () => ctx, loader: () => Promise.resolve(new ArrayBuffer(8)) });
  globalThis.document ??= { hidden: false, addEventListener() {}, removeEventListener() {} };
  ok(audio.unlock() === true, 'engine: graph builds with the procedural layer');
  const noise = nodes.find(n => n.kind === 'buf' && n.loop && n.buffer?.length);
  ok(noise && noise.started, 'engine: one generated noise loop starts with the graph');
  const data = noise.buffer.getChannelData();
  ok(data.some(v => v > .5) && data.some(v => v < -.5), 'engine: noise loop is filled, not silent');
  const saw = nodes.find(n => n.kind === 'osc');
  ok(saw.links.some(l => l.kind === 'gain' && l.links.some(t => t && t.events)), 'engine: the engine saw gates the exhaust rasp at the firing rate');

  const box = createGearbox(26), count = nodes.length;
  const drive = (speed, throttle = 1) => { const g = box.update(speed); audio.update({ speed, throttle, gear: g.gear, rpm: g.rpm, shift: g.shift, active: true }); return g; };
  let pitchBefore = 0, pitchAfter = 0, crackles = 0;
  for (let v = 0; v <= 26; v += .4) {
    const before = saw.frequency.value, g = drive(v);
    if (g.shift > 0 && !pitchBefore) { pitchBefore = before; pitchAfter = saw.frequency.value; }
    ctx.currentTime += 1 / 60;
  }
  const crackle = nodes.filter(n => n.kind === 'gain').find(n => n.gain.events.some(e => e[0] === 'linearRampToValueAtTime' && e[1] > .2));
  crackles = crackle ? crackle.gain.events.filter(e => e[0] === 'cancel').length : 0;
  ok(nodes.length === count, 'engine: a full climb through every gear allocates no nodes');
  ok(pitchAfter < pitchBefore * .85, `engine: the first upshift drops engine pitch (${pitchBefore.toFixed(0)} -> ${pitchAfter.toFixed(0)} Hz)`);
  ok(crackles === 3, 'engine: each upshift fires one exhaust crackle (' + crackles + ')');
  const road = nodes.filter(n => n.kind === 'gain' && n.links.length).map(n => n.gain.value);
  ok(road.every(Number.isFinite), 'engine: every level stays finite');
  audio.dispose();
  ok(noise.stopped && noise.gone, 'engine: dispose stops and disconnects the noise loop');
}

console.log(`KART_GEARBOX_PASS: ${checks} assertions`);

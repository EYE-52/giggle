/* Recorded gameplay foley + DOM confetti. Navigation stays quiet.
 * Kenney CC0 provenance: /assets/game-audio/manifest.json. */
import { store } from './util.js';

let ctx = null;
let enabled = store.get('pb_sound') !== 'off';
const buffers = new Map();
const loading = new Set();
const voices = new Set();
const lastPlayed = new Map();
const CUES = {
  piece: { gain: 0.30, gap: 80 }, capture: { gain: 0.28, gap: 120 },
  dice: { gain: 0.32, gap: 250 }, deal: { gain: 0.22, gap: 100 },
  place: { gain: 0.24, gap: 100 }, burst: { gain: 0.17, gap: 100 },
  correct: { gain: 0.18, gap: 250 }, reveal: { gain: 0.16, gap: 250 },
  win: { gain: 0.16, gap: 800 },
};

function unlock() {
  if (!enabled) return;
  if (!ctx) {
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
    } catch { return; }
  }
  if (ctx.state === 'suspended' || ctx.state === 'interrupted') ctx.resume().catch(() => {});
  // Warm after a real gesture. Cold cues are dropped, never queued to
  // sound later after a phase change or an asynchronous resume/decode.
  for (const name of Object.keys(CUES)) {
    if (buffers.has(name) || loading.has(name)) continue;
    loading.add(name);
    (async () => {
      try {
        const response = await fetch(`/assets/game-audio/${name}.wav`);
        if (!response.ok) return;
        const buffer = await ctx.decodeAudioData(await response.arrayBuffer());
        buffers.set(name, buffer);
      } catch { /* Missing/blocked audio must leave gameplay usable. */ }
      finally { loading.delete(name); }
    })();
  }
}

function release(voice) {
  if (!voices.delete(voice)) return;
  try { voice.source.disconnect(); } catch { /* Already disconnected. */ }
  try { voice.gain.disconnect(); } catch { /* Already disconnected. */ }
}

function play(name, options = {}) {
  if (!enabled || !CUES[name] || (typeof document !== 'undefined' && document.hidden)) return false;
  // Keyboard activation can be the first gesture; the app's pointerdown
  // unlock remains the usual path. Background phase updates cannot unlock.
  const buffer = buffers.get(name);
  if ((!ctx || ctx.state !== 'running' || !buffer) && window.navigator?.userActivation?.isActive) unlock();
  if (!ctx || ctx.state !== 'running' || !buffer || voices.size >= 4) return false;
  const now = performance.now();
  if (now - (lastPlayed.get(name) ?? -Infinity) < CUES[name].gap) return false;
  let voice;
  try {
    const source = ctx.createBufferSource();
    const gain = ctx.createGain();
    voice = { source, gain };
    voices.add(voice);
    source.buffer = buffer;
    gain.gain.value = CUES[name].gain * Math.max(0, Math.min(1, Number.isFinite(options.gain) ? options.gain : 1));
    if (source.playbackRate) source.playbackRate.value = Math.max(0.9, Math.min(1.1, Number.isFinite(options.rate) ? options.rate : 1));
    source.connect(gain).connect(ctx.destination);
    source.onended = () => release(voice);
    source.start();
    lastPlayed.set(name, now);
    return true;
  } catch {
    if (voice) release(voice);
    return false;
  }
}

function stop() {
  for (const voice of [...voices]) {
    try { voice.source.stop(); } catch { /* Already ended. */ }
    release(voice);
  }
  lastPlayed.clear();
}

export const sound = {
  get enabled() { return enabled; },
  toggle() {
    enabled = !enabled;
    store.set('pb_sound', enabled ? 'on' : 'off');
    if (!enabled) stop();
    return enabled;
  },
  unlock,
  stop,
  cue: play,
  // Older embedded consumers retain a quiet navigation API.
  click() {}, lock() {}, tick() {}, turn() {}, pop() {},
  reveal() { return play('reveal'); },
  win() { play('win'); },
};

/* Avatar: deterministic party color + dark initial. Light tints only so the
 * dark initial stays readable; no emoji, no purple, no muddy green/brown. */
const PALETTE = ['#ffb020', '#ff9ebb', '#7cc4f2', '#5fd4c4', '#ffa552', '#ff8a8a', '#ff7aa8', '#8fd6f2'];
export function avatarColor(pid) {
  let h = 0;
  for (let i = 0; i < pid.length; i++) h = (h * 31 + pid.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

export function reducedMotion() {
  return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}

/* One-shot staggered card entrance via Web Animations: runs only when the
 * caller invokes it (first lobby paint per room, home paint), so search
 * typing and WebSocket repaints never replay it. Nodes painted later get
 * no animation — nothing to clean up. */
export function staggerIn(box, sel) {
  if (!box || reducedMotion()) return;
  const kids = box.querySelectorAll(sel);
  kids.forEach((el, i) => {
    if (!el.animate) return;
    el.animate(
      [{ opacity: 0, transform: 'translateY(14px) scale(.97)' }, { opacity: 1, transform: 'none' }],
      { duration: 380, delay: Math.min(i, 7) * 45, easing: 'cubic-bezier(.2,.9,.3,1.15)', fill: 'backwards' },
    );
  });
}

/* Confetti burst from the top. Honors reduced motion. */
export function confetti() {
  if (reducedMotion()) return;
  const layer = document.createElement('div');
  layer.className = 'confetti';
  const colors = ['#de1e6a', '#ffb020', '#f2545b', '#0e9b8a', '#3e9be0', '#ff7aa8'];
  for (let i = 0; i < 70; i++) {
    const p = document.createElement('i');
    p.style.left = Math.random() * 100 + '%';
    p.style.background = colors[i % colors.length];
    p.style.animationDelay = (Math.random() * 0.5) + 's';
    p.style.animationDuration = (1.6 + Math.random() * 1.4) + 's';
    p.style.transform = `rotate(${Math.random() * 360}deg)`;
    if (i % 3 === 0) p.style.borderRadius = '50%';
    layer.appendChild(p);
  }
  document.body.appendChild(layer);
  setTimeout(() => layer.remove(), 3600);
}

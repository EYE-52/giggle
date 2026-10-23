/* Native WebAudio sound cues (Media Toolkit).
 *
 * Tiny synthesized UI/game cues (no audio assets, no network): click, turn,
 * tick, join, win, lose, error. The AudioContext is created lazily and only
 * Starts making sound after unlock() runs inside a real user gesture (call
 * it from the game's start/tap handler); before that, cue() returns false
 * and schedules nothing. Mute is in-memory (no storage) and dispose() closes
 * the context and removes the gesture listeners.
 *
 * Mount: createSoundBank({ muted?, autoUnlock?, createContext? }).
 * - createContext injects the AudioContext factory (tests pass a stub).
 * - autoUnlock (default true) attaches one-shot pointerdown/keydown
 *   listeners that call unlock() on the first gesture.
 *
 * No imports, no globals at module scope. Never throws for audio failures:
 * missing WebAudio just makes cue() return false and available() false.
 */

/* Cue score: [freqHz, seconds, type, gain, delaySeconds]. */
export const CUES = {
  click: [[660, 0.07, 'sine', 0.18, 0]],
  turn: [[520, 0.09, 'triangle', 0.22, 0], [780, 0.12, 'triangle', 0.2, 0.08]],
  tick: [[880, 0.05, 'square', 0.08, 0]],
  join: [[440, 0.1, 'sine', 0.2, 0], [660, 0.14, 'sine', 0.2, 0.09]],
  win: [[523, 0.12, 'triangle', 0.24, 0], [659, 0.12, 'triangle', 0.24, 0.1], [784, 0.2, 'triangle', 0.26, 0.2]],
  lose: [[330, 0.16, 'sawtooth', 0.1, 0], [220, 0.24, 'sawtooth', 0.1, 0.14]],
  error: [[196, 0.18, 'square', 0.1, 0]],
};

function defaultFactory() {
  try {
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    return typeof AC === 'function' ? new AC() : null;
  } catch {
    return null;
  }
}

export function createSoundBank(opts) {
  opts = opts || {};
  const factory = typeof opts.createContext === 'function' ? opts.createContext : defaultFactory;
  let win = null;
  try {
    win = globalThis.window || globalThis;
  } catch {
    win = globalThis;
  }

  let ctx = null;
  let muted = opts.muted === true;
  let unlocked = false;
  let disposed = false;
  const tracked = [];

  const ensure = () => {
    if (ctx || disposed) return ctx;
    try {
      ctx = factory();
    } catch {
      ctx = null;
    }
    return ctx;
  };

  /* Run inside a user gesture (tap/click/key). Creates/resumes the context
   * so later cue() calls actually sound. Safe to call repeatedly. */
  const unlock = () => {
    if (disposed) return false;
    unlocked = true;
    const c = ensure();
    if (!c) return false;
    try {
      if (c.state === 'suspended' && typeof c.resume === 'function') {
        const r = c.resume();
        if (r && typeof r.catch === 'function') r.catch(() => {});
      }
    } catch { /* noop */ }
    return true;
  };

  const gestureUnlock = () => {
    unlock();
  };

  if (opts.autoUnlock !== false && win && typeof win.addEventListener === 'function') {
    try {
      win.addEventListener('pointerdown', gestureUnlock);
      tracked.push([win, 'pointerdown', gestureUnlock]);
      win.addEventListener('keydown', gestureUnlock);
      tracked.push([win, 'keydown', gestureUnlock]);
    } catch { /* noop */ }
  }

  const tone = (c, freq, dur, type, gain, when) => {
    const osc = c.createOscillator();
    const amp = c.createGain();
    osc.type = type;
    if (osc.frequency && typeof osc.frequency.setValueAtTime === 'function') {
      osc.frequency.setValueAtTime(freq, when);
    } else if (osc.frequency) {
      osc.frequency.value = freq;
    }
    const peak = Math.max(0.0001, gain);
    if (amp.gain && typeof amp.gain.setValueAtTime === 'function') {
      amp.gain.setValueAtTime(0.0001, when);
      amp.gain.linearRampToValueAtTime(peak, when + 0.012);
      amp.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    } else if (amp.gain) {
      amp.gain.value = peak;
    }
    osc.connect(amp);
    amp.connect(c.destination);
    try {
      osc.start(when);
      osc.stop(when + dur + 0.05);
    } catch {
      try { osc.start(); osc.stop(c.currentTime + dur + 0.05); } catch { /* noop */ }
    }
  };

  /* Schedule a named cue. Returns true when scheduled, false when muted,
   * locked (no gesture yet), disposed, unknown, or WebAudio is missing. */
  const cue = (name) => {
    if (disposed || muted || !unlocked) return false;
    const score = CUES[name];
    if (!score) return false;
    const c = ensure();
    if (!c || typeof c.createOscillator !== 'function' || typeof c.createGain !== 'function') return false;
    let base = 0;
    try {
      base = typeof c.currentTime === 'number' ? c.currentTime : 0;
    } catch {
      base = 0;
    }
    try {
      for (const [freq, dur, type, gain, delay] of score) {
        tone(c, freq, dur, type, gain, base + (delay || 0));
      }
    } catch {
      return false;
    }
    return true;
  };

  return {
    unlock,
    cue,
    cues: () => Object.keys(CUES),
    setMuted: (m) => { muted = m === true; },
    isMuted: () => muted,
    isUnlocked: () => unlocked,
    available: () => {
      if (disposed) return false;
      if (ctx) return true;
      try {
        return typeof globalThis.AudioContext === 'function' || typeof globalThis.webkitAudioContext === 'function';
      } catch {
        return false;
      }
    },
    disposed: () => disposed,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      for (const [t, type, fn] of tracked) {
        try { t.removeEventListener(type, fn); } catch { /* noop */ }
      }
      tracked.length = 0;
      if (ctx) {
        try {
          if (typeof ctx.close === 'function') {
            const r = ctx.close();
            if (r && typeof r.catch === 'function') r.catch(() => {});
          }
        } catch { /* noop */ }
        ctx = null;
      }
    },
  };
}

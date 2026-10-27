/* Media Toolkit entry: 2D canvas, input, sound, voice, and 3D.
 *
 * One import for game views (from public/js/games/<game>.js):
 *   import { createCanvasView, createInput, createSoundBank,
 *     createVoiceClient, createThreeView, createSessionToolkit }
 *     from '../toolkit/index.js';
 * or via the shell's api.toolkit (same factories, same behavior).
 *
 * Views choose their pieces and dispose them on unmount. Nothing here is
 * automatic: the shell never appends a canvas, captures input, or starts
 * audio/voice for a game — DOM games use none of it. createThreeView is
 * the existing shared GL lifecycle helper re-exported — same module, same
 * behavior, no second copy. createSessionToolkit is an opt-in composer
 * for views that want several pieces disposed together (see
 * MEDIA_TOOLKIT_GUIDE.md). Voice is page-lifetime and shell-owned; games
 * use api.voice (getStatus/subscribe/request), never a private client.
 */

import { createCanvasView, reducedMotion } from './canvas-view.js';
import { createInput } from './input.js';
import { createSoundBank, CUES } from './audio.js';
import {
  createVoiceClient,
  createVoiceId,
  isValidVoiceId,
  isValidVoiceMic,
  validVoiceParentMessage,
  voiceChildMessage,
  VOICE_VERSION,
  VOICE_MIC_STATES,
  MAX_VOICE_ID_CHARS,
  STANDALONE_VOICE_HINT,
} from './voice.js';

export { createCanvasView, reducedMotion };
export { createInput };
export { createGameScreen } from './game-screen.mjs';
export { createMobileStick, normalizeStickVector, STICK_DEADZONE } from './mobile-stick.mjs';
export { createSoundBank, CUES };
export {
  createVoiceClient,
  createVoiceId,
  isValidVoiceId,
  isValidVoiceMic,
  validVoiceParentMessage,
  voiceChildMessage,
  VOICE_VERSION,
  VOICE_MIC_STATES,
  MAX_VOICE_ID_CHARS,
  STANDALONE_VOICE_HINT,
};
export { createThreeView } from '../renderers/three-view.js';

/* Build one game session's toolkit pieces and dispose them together.
 * config: { canvas?: { mount, hooks } | null, input?: { target, opts } | null,
 *   audio?: opts | null, voice?: opts | null }. Missing sections stay null.
 * A section whose builder throws becomes null with the error collected in
 * `errors` — one bad mount never blocks the rest, and dispose() still runs
 * everything that built. */
export function createSessionToolkit(config) {
  const cfg = config || {};
  const errors = [];
  let canvas = null;
  let input = null;
  let audio = null;
  let voice = null;

  if (cfg.canvas) {
    try {
      canvas = createCanvasView(cfg.canvas.mount, cfg.canvas.hooks);
    } catch (e) {
      errors.push({ section: 'canvas', error: e });
      canvas = null;
    }
  }
  if (cfg.input) {
    try {
      input = createInput(cfg.input.target, cfg.input.opts);
    } catch (e) {
      errors.push({ section: 'input', error: e });
      input = null;
    }
  }
  if (cfg.audio !== undefined && cfg.audio !== null) {
    try {
      audio = createSoundBank(cfg.audio);
    } catch (e) {
      errors.push({ section: 'audio', error: e });
      audio = null;
    }
  }
  if (cfg.voice !== undefined && cfg.voice !== null) {
    try {
      voice = createVoiceClient(cfg.voice);
    } catch (e) {
      errors.push({ section: 'voice', error: e });
      voice = null;
    }
  }

  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    for (const piece of [input, audio, voice, canvas]) {
      if (piece && typeof piece.dispose === 'function') {
        try { piece.dispose(); } catch { /* one bad dispose never blocks the rest */ }
      }
    }
  };

  const api = {
    canvas,
    input,
    audio,
    voice,
    errors,
    disposed: () => disposed,
    dispose,
  };
  /* Call/session end: identical cleanup under the lifecycle name. */
  api.end = api.dispose;
  return api;
}

/* Game Kit browser entry (ESM): the reusable client side of the
 * framework — canvas/input/audio/voice/3D toolkit factories, shared DOM
 * helpers, and the kart/camera/build-battle view helpers. Every export
 * below re-exports an existing module; nothing is forked here.
 *
 * Views stay autonomous: these factories are optional sugar. A game may
 * use all, some, or none of them and ship bespoke markup/canvas/Three.js
 * against the same snapshots and mount/update/dispose lifecycle.
 *
 * Repo use:   import {...} from './sdk/browser.mjs';
 * Packed use: import {...} from 'giggle-game-kit/browser';
 */

export const KIT_VERSION = '0.1.38';
export { createGameClient } from '../public/js/game-client.js';

// Reusable 3D orbit/tap controls. Game views provide their own raycast,
// scene and HUD; the helper only handles gestures and camera movement.
export {
  createArenaControls,
  isTapGesture,
  ndcFromClient,
  sphericalOffset,
  applyOrbit,
} from '../public/js/renderers/arena-controls.mjs';

/* Media toolkit factories (canvas 2D, input, sound, voice-over-parent,
 * Three.js lifecycle, session composer). */
export {
  createCanvasView,
  reducedMotion,
  createInput,
  createGameScreen,
  createMobileStick,
  normalizeStickVector,
  STICK_DEADZONE,
  createSoundBank,
  CUES,
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
  createThreeView,
  createSessionToolkit,
} from '../public/js/toolkit/index.js';

/* Shared DOM helpers (escape, storage, names, calibrated countdowns). */
export {
  esc,
  store,
  nameOf,
  countdown,
  artGradient,
  artInitial,
} from '../public/js/util.js';

/* Camera-party shared renderer (controls companion to the real call). */
export {
  renderCameraParty,
  disposeCameraParty,
  CAMERA_PARTY_CSS_ID,
  CAMERA_PARTY_CSS_HREF,
  STANDALONE_CALL_HINT,
} from '../public/js/toolkit/camera-party.js';

/* Kart-arena view factory + shared pose math (pure, no DOM). */
export { createKartView } from '../public/js/engines/kart-view.js';
export {
  MAX_SPEED,
  MAX_REVERSE,
  ACCEL,
  BRAKE,
  DRAG,
  TURN_RATE,
  BOOST_SPEED,
  BOOST_TIME,
  BOOST_CD,
  NITRO_DRAIN,
  NITRO_RECHARGE,
  NITRO_REARM,
  NITRO_SPEED,
  NITRO_PUNCH,
  EMP_TOP_SCALE,
  EMP_ACCEL_SCALE,
  EMP_TURN_SCALE,
  BOUND,
  KART_R,
  SELF_BLEND,
  SELF_ANGLE_BLEND,
  SELF_SPEED_BLEND,
  SELF_SNAP_DIST,
  SELF_SNAP_ANGLE,
  REMOTE_SNAP_DIST,
  REMOTE_EASE,
  EXTRAPOLATE_MS,
  MAX_FRAME_DT,
  forwardOf,
  screenRightOf,
  canvasNoseRotation,
  angDiff,
  intentFromKeys,
  stepSelf,
  createPoseStore,
  resetPoseStore,
  ingestSnapshot,
  framePoses,
} from '../public/js/engines/kart-pose.mjs';

/* Block stacking / siege renderer; games can supply their own meshes/HUD. */
export { createCastleScene } from '../public/js/engines/castle-scene.js';
export { createBlockSiegeScene } from '../public/js/engines/block-siege-scene.js';

/* Build-battle view math (pure geometry/status helpers, no DOM). */
export {
  zoneCells,
  cellKey,
  gridMap,
  inZone,
  hpBand,
  hpPct,
  cooldownLeft,
  fmtSeconds,
  pieceGlyph,
  weaponGlyph,
} from '../public/js/engines/build-battle-view.js';

import {paintKartWeapon} from './kart-weapon-hud.mjs';
import {kartResultView} from './kart-results.mjs';
import physicsConfig from './kart-physics-config.mjs';
/* Shared kart-arena view factory. createKartView(config) builds a complete
 * mount/update/dispose view: Three.js chase-cam arena, 2D top-down
 * fallback on the SAME snapshots, DOM HUD, keyboard + touch intents.
 * Server snapshots drive everything; the client sends steer/throttle/
 * boost INTENTS only — never coordinates.
 *
 * Config: { title, hooks: { buildKartMesh?, sceneExtra?, hudExtra? } }
 * - title: game name for aria labels and announcements.
 * - hooks.buildKartMesh(THREE, color, pid): return a game-owned kart
 *   Group (nose MUST face +z at yaw 0 so rotation.y = angle matches the
 *   shared forward model). Default: the locally authored Giggle GLB kart.
 * - hooks.sceneExtra(THREE, { scene, camera, poses, S, dt }): per-frame
 *   custom Three.js overlay (game-owned decorations only — never poses).
 * - hooks.hudExtra(rootEl, S): per-snapshot custom DOM inside .pk-hud.
 * The factory never restricts views: a game may ignore it entirely and
 * ship bespoke HTML/canvas/Three.js against the same snapshots.
 *
 * Steering convention: +steer = screen right under the chase camera
 * (forwardOf/screenRightOf in kart-pose.mjs, shared with the server). */

import {loadClassicPhysics,createClassicPrediction} from './kart-classic-prediction.mjs';
import { esc } from '../util.js';
import { createThreeView } from '../renderers/three-view.js';
import { readInputCapabilities, touchControlsFor } from '../toolkit/input-capabilities.mjs';
import { createMobileStick } from '../toolkit/mobile-stick.mjs';
import { createKartLighting } from './kart-lighting.mjs';
import { loadKartAssets, weaponThumbnailArt } from './kart-assets.mjs';
import { createKartWorld } from './kart-world.mjs';
import { createKartModel, animateKartModel, createStarModel } from './kart-model.mjs';
import { createKartAudio } from './kart-audio.mjs';
import { createKartCombatArt, projectileContactInset } from './kart-combat-art.mjs';
import { createKartHealthBars } from './kart-health-bars.mjs';
import {createKartImpactFX} from './kart-impact-fx.mjs';
import {createKartFeedback} from './kart-feedback.mjs';
import { projectilePose, grenadePose } from './kart-flight.mjs';
import {createGroundMarker,placeGroundMarker,placeGroundProp} from './kart-ground-markers.mjs';
import {
  createPoseStore, resetPoseStore, ingestSnapshot, framePoses,
  forwardOf, canvasNoseRotation,
} from './kart-pose.mjs';

const KART_COLORS = [0xde1e6a, 0xf2545b, 0xffb020, 0x3e9be0, 0xf07b1d, 0x0e9b8a, 0xff7aa8, 0x2b1220];
/* Arcade arena palettes. bg/floor/wall/line drive the 2D fallback; the 3D
 * scene adds sky/horizon/track/apron/cream/leaf/rock/stand per palette.
 * All three stay clearly different: sunny lagoon, dusk canyon, night neon. */
const PALETTES = {
  Daybreak: {
    bg: 0xbfe6f7, floor: 0x35b26b, wall: 0xde1e6a, line: 0xfff6e8,
    sky: 0x2f9df0, horizon: 0xd8f3ff, track: 0x5f7285, apron: 0xf2d06b,
    cream: 0xfff6e8, leaf: 0x2e9e5b, trunk: 0x8a5a2b, stand: 0xe8628a,
    cloud: 0xffffff, kinds: 'palms',
  },
  Sunset: {
    bg: 0x7a4a52, floor: 0x70b55b, wall: 0xd45469, line: 0xfff1dc,
    sky: 0x2b3a67, horizon: 0xff9a5c, track: 0x566675, apron: 0xf8b3b6,
    cream: 0xffe3b3, leaf: 0x8a4a2e, trunk: 0x5a2e22, stand: 0xe0703a,
    cloud: 0xffd9c2, kinds: 'rocks',
  },
  Starlight: {
    bg: 0x101a33, floor: 0x16233f, wall: 0x2a3f66, line: 0xffc531,
    sky: 0x050a18, horizon: 0x1c3a5e, track: 0x1e2c52, apron: 0x0e9b8a,
    cream: 0x43a5f5, leaf: 0x2a7fbf, trunk: 0x1a2c4a, stand: 0xffc531,
    cloud: 0xcfe4ff, kinds: 'crystals',
  },
};
const LEGACY_PALETTES = { Violet: 'Starlight', Mint: 'Daybreak' };
function paletteFor(name) {
  const want = LEGACY_PALETTES[name] || name;
  return PALETTES[want] || PALETTES.Daybreak;
}
/* Bounded input keepalive: changes send at once, and a held intent is
 * re-sent every SEND_MS so it survives the server's 1500 ms receipt-time
 * TTL. Silence (crash, killed tab) still expires server-side; release and
 * blur send zeros immediately. Analog moves use a bounded timeout below;
 * the frame loop never sends inputs. */
const SEND_MS = 500;
const ANALOG_SEND_MS = 1000 / 30;
/* Distinct vector artwork per weapon (DOM SVG, no dependency). Each of the
 * eight silhouettes echoes the 3D rig at 22px: black-steel machine gun with a
 * brass drum, triple barrels with three bores, toothed mine disc with a red
 * status lamp, hex shield, side rocket, twin rails, handled grenade, pronged
 * EMP. Colors stay fixed so the slot reads identically across palettes and
 * night theme. The Fire button reuses these SVGs with an ammo badge; the
 * empty state is a crosshair, never a sentence. */
const WEAPON_ART = {
  pulse: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="10" width="9" height="5" rx="1.5" fill="#1b2433"/><rect x="11" y="11.2" width="11" height="2.6" rx="1" fill="#5a6b84"/><rect x="19.5" y="10.4" width="2.5" height="4.2" rx="1" fill="#5a6b84"/><rect x="4" y="6.3" width="3" height="3.7" rx="1" fill="#5a6b84"/><circle cx="7" cy="17.2" r="3.1" fill="#e8b73a"/><circle cx="7" cy="17.2" r="1.2" fill="#7a5b17"/></svg>',
  scatter: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="7.5" r="3.6" fill="#5a6b84"/><circle cx="8" cy="14.2" r="3.6" fill="#5a6b84"/><circle cx="16" cy="14.2" r="3.6" fill="#5a6b84"/><circle cx="12" cy="7.5" r="1.6" fill="#05070a"/><circle cx="8" cy="14.2" r="1.6" fill="#05070a"/><circle cx="16" cy="14.2" r="1.6" fill="#05070a"/><rect x="10.4" y="17.2" width="3.2" height="4" rx="1" fill="#e8b73a"/></svg>',
  mine: '<svg viewBox="0 0 24 24" aria-hidden="true"><g fill="#5a6b84"><rect x="11" y="2.6" width="2" height="3.4" rx="1"/><rect x="11" y="2.6" width="2" height="3.4" rx="1" transform="rotate(45 12 13)"/><rect x="11" y="2.6" width="2" height="3.4" rx="1" transform="rotate(90 12 13)"/><rect x="11" y="2.6" width="2" height="3.4" rx="1" transform="rotate(135 12 13)"/><rect x="11" y="2.6" width="2" height="3.4" rx="1" transform="rotate(180 12 13)"/><rect x="11" y="2.6" width="2" height="3.4" rx="1" transform="rotate(225 12 13)"/><rect x="11" y="2.6" width="2" height="3.4" rx="1" transform="rotate(270 12 13)"/><rect x="11" y="2.6" width="2" height="3.4" rx="1" transform="rotate(315 12 13)"/><circle cx="12" cy="13" r="6.2"/></g><circle cx="12" cy="13" r="4" fill="#1b2433"/><circle cx="12" cy="13" r="2.2" fill="#ff2a35"/></svg>',
  shield: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5 19 6v6.2c0 4.4-3 7.4-7 9.3-4-1.9-7-4.9-7-9.3V6z" fill="none" stroke="#83e4cc" stroke-width="2.2" stroke-linejoin="round"/><path d="M12 6.5v9M8.5 9.5l7 4M15.5 9.5l-7 4" stroke="#83e4cc" stroke-width="1.4" stroke-linecap="round" opacity=".8"/></svg>',
  rocket: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13.5 2c3.4 2 4.6 5.6 3.6 9.4l2.6 3.2-3.3.4-1.4 3.1-2.5-2.2c-3.5-.6-6-3.3-6.6-6.9z" fill="#ffd458"/><circle cx="12.4" cy="8.6" r="1.6" fill="#25354b"/><path d="M6 14.5 3 21l2.4-.6L4.4 17zM9 17.5l-2 4.5 2.4-.6-.5-3.4z" fill="#ed526d"/></svg>',
  rail: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3v18M17 3v18" stroke="#9fc4e8" stroke-width="2.6" stroke-linecap="round"/><path d="M7 8h10M7 16h10" stroke="#e8f4ff" stroke-width="1.6"/><path d="M12 4.5 10.4 9.5h3.2L12 14.5l3.4 5h-2.6l-3.2-5H12z" fill="#e8f4ff"/></svg>',
  grenade:'<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="9" width="10" height="11" rx="3" fill="#5a6b84"/><path d="M7 12.5h10M7 16h10" stroke="#1b2433" stroke-width="1.4"/><rect x="6" y="8" width="2.4" height="9" rx="1.2" fill="#9fb2c8"/><rect x="10" y="5.5" width="4" height="4" rx="1" fill="#e8b73a"/><circle cx="15.4" cy="4.6" r="1.8" fill="none" stroke="#9fb2c8" stroke-width="1.6"/></svg>',
  emp:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19V5m16 14V5M4 19h16" fill="none" stroke="#8dd6ff" stroke-width="3"/><path d="m13 3-5 8h5l-2 8 6-10h-5z" fill="#ffd458"/></svg>',
  crate: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="7" width="16" height="13" rx="2" fill="none" stroke="#9ad2d7" stroke-width="2"/><path d="M4 10.5h16M12 7v13" stroke="#9ad2d7" stroke-width="1.4" opacity=".7"/><circle cx="12" cy="13.5" r="2.4" fill="#9ad2d7"/></svg>',
};
function weaponArt(kind) {
  return WEAPON_ART[kind] || WEAPON_ART.crate;
}
/* Touch-cluster artwork (DOM SVG, no dependency). Empty Fire is a crosshair;
 * Nitro pairs a bottle/lightning glyph with a charge ring updated in place;
 * Drift is a tyre with skid marks; race mode fires a plain boost bolt. */
const CROSSHAIR_ART = '<svg viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke="#f5f8ff" stroke-width="1.8"><circle cx="12" cy="12" r="6"/><path d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4"/></g></svg>';
const NITRO_GLYPH = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.5 2.5h5V6l2.2 3.2V19a2 2 0 0 1-2 2h-5.4a2 2 0 0 1-2-2V9.2L9.5 6z" fill="none" stroke="#22d7ef" stroke-width="1.8" stroke-linejoin="round"/><path d="m13 8.5-3.6 5.2h2.9L11.4 18l3.6-5.2h-2.9z" fill="#ffcb24"/></svg>';
const DRIFT_ART = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15.5 3.5c2.6 1 4.7 3 5.7 5.6M18.5 2.5c1.9 1 3.3 2.4 4.3 4.2" stroke="#f5f8ff" stroke-width="1.6" fill="none" stroke-linecap="round" opacity=".8"/><circle cx="10" cy="14.5" r="6.5" fill="#141a26" stroke="#9fb2c8" stroke-width="1.8"/><circle cx="10" cy="14.5" r="2.2" fill="#9fb2c8"/></svg>';
const BOOST_ART = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m13 2-7 12h5l-2 8 9-13h-5z" fill="#ffcb24"/></svg>';
/* Nitro charge ring: r=10, circumference 62.8. paintHud moves ONLY the arc
 * dash offset so the glyph is never rebuilt by text updates. */
const NITRO_RING = '<svg class="pk-nitro-ring" viewBox="0 0 24 24" aria-hidden="true"><circle class="pk-arc-track" cx="12" cy="12" r="10" fill="none" stroke="#f5f8ff" stroke-opacity=".25" stroke-width="2"/><circle class="pk-nitro-arc" cx="12" cy="12" r="10" fill="none" stroke="#22d7ef" stroke-width="2" stroke-linecap="round" stroke-dasharray="62.8" stroke-dashoffset="0" transform="rotate(-90 12 12)"/></svg>';
const NITRO_ARC_LEN = 62.8;
const ITEMS = {
  pulse: {label:'Pulse', action:'Fire pulse', short:'FIRE'},
  scatter: {label:'Scatter', action:'Fire scatter', short:'FAN'},
  mine: {label:'Mine', action:'Drop mine', short:'DROP'},
  shield: {label:'Invincibility', action:'Activate invincibility', short:'INVINCIBLE'},
  rocket: {label:'Rocket', action:'Launch rocket', short:'LAUNCH'},
  rail: {label:'Rail', action:'Fire rail', short:'RAIL'},
  grenade:{label:'Grenade',action:'Lob grenade',short:'LOB'},
  emp:{label:'EMP',action:'Discharge EMP',short:'EMP'},
};
/* Classic arenas for the game-owned Results chooser. Use the same captured
 * map overviews as setup; profile keys keep these distinct from elevated maps.
 * Labels match the engine manifest (configure accepts labels or ids). */
const ARENA_CHOOSER = [
  { id: 'ring', label: 'Rookie Ring', blurb: 'A small, open arena for close battles.' },
  { id: 'blocks', label: 'Bumper Blocks', blurb: 'A small arena with four solid cover blocks.' },
  { id: 'garden', label: 'Garden Circuit', blurb: 'Rolling roads, hedge cover and boost strips.' },
  { id: 'frost', label: 'Frosty Pass', blurb: 'Snowy ridges and slippery ice shortcuts.' },
  { id: 'neon', label: 'Neon Yard', blurb: 'Raised cargo lanes, cover and boost strips.' },
];
function arenaByMap(map) {
  if (!map) return null;
  const id = map.id || map;
  const label = map.label || map;
  return ARENA_CHOOSER.find((a) => a.id === id || a.label === label) || null;
}
/* Shoot tutorial, shown once per browser (bounded single-key storage).
 * First pickup teaches Space/action; later pickups stay concise. */
const TUTORIAL_KEY = 'pk-shoot-tutorial-v1';
let tutorialSeenMem = false;
function tutorialSeen() {
  if (tutorialSeenMem) return true;
  try {
    if (typeof localStorage !== 'undefined' && localStorage.getItem(TUTORIAL_KEY)) {
      tutorialSeenMem = true;
      return true;
    }
  } catch { /* private mode: fall through to memory */ }
  return false;
}
function markTutorialSeen() {
  tutorialSeenMem = true;
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(TUTORIAL_KEY, '1');
  } catch { /* memory flag above still bounds repeats this session */ }
}

export function createKartView(viewConfig) {
  const cfg = viewConfig && typeof viewConfig === 'object' ? viewConfig : {};
  const title = cfg.title || 'Kart Arena';
  const hooks = cfg.hooks && typeof cfg.hooks === 'object' ? cfg.hooks : {};

  let S = null;
  let apiRef = null;
  let rootEl = null;
  let mountGen = 0;
  let gl = null; // three-view handle (null in fallback)
  let sceneState = null;
  const feedback = createKartFeedback();
  let poseStore = createPoseStore();
  let physicalPrediction,physicalReady,physicalSeq=0,physicalLocalPose;
  let keys = new Set();
  let touch = { gas: false, brake: false, drift: false, nitro: false };
  let autoGas = false;
  let stick = null;
  let stickValue = { x: 0, y: 0 };
  let suppressStickSend = false;
  let fireHeld = false;
  let pulseHoldLife = null;
  const clearHolds = new Set();
  let boostEdge = false;
  let predictBoost = false; // local visual pop; cleared on every snapshot
  let fbLastT = 0;
  let lastSent = '';
  let sendTimer = 0;
  let analogTimer = 0;
  let analogMoving = false;
  let lastInputSentAt = 0;
  let lastPhase = '';
  let lastCount = -1;
  let lastStandKey = '';
  let lastResultKey = '';
  let lastFireKey = '';
  let seenEvents = new Set();
  let cueUntil = 0;
  let cueText = '';
  let keycapUntil=0;
  let firstEvents = true;
  let bound = [];
  let fbBound = [];
  let fbCanvas = null;
  let sceneReady;
  let fbObserver = null;
  let fbRaf = 0;
  let audio = null;
  let wasTurbo = false;
  let garagePending = null;
  let controlsPreference = 'auto';
  function paintControls() {
    if (!rootEl) return;
    const caps=readInputCapabilities({navigator:window.navigator,matchMedia:q=>window.matchMedia?.(q)});
    rootEl.querySelector('.pk')?.classList.toggle('pk-touch-enabled',touchControlsFor(controlsPreference,caps));
    const picker=rootEl.querySelector('#pk-controls');
    if(picker)picker.value=controlsPreference;
  }
  let arenaPending = null;
  let arenaNotice = '';

  function updateAudio() {
    if (!audio) return;
    const me=myKart(), predicted=S?.motionProfile?physicalLocalPose:poseStore.self;
    audio.setMuted(apiRef?.context?.().sound === false);
    audio.update({speed:predicted?.speed ?? me?.speed ?? 0,throttle:intentFromState().throttle,
      drifting:predicted?.drifting ?? me?.drifting,boost:me?.boost>0||me?.turbo>0||me?.nitroActive===true,
      active:S?.phase==='drive' && !S?.preparing && !document.hidden && apiRef?.context?.().connected!==false && !apiRef?.context?.().roomActionPending,
      engineActive:!!S?.youDrive && !!me && !(me.respawn>0)});
    const turbo=me?.boost>0||me?.turbo>0||me?.nitroActive===true;
    if(turbo&&!wasTurbo)audio.cue('boost');
    wasTurbo=turbo;
  }

  function on(t, type, fn, opts) {
    if (!t || !t.addEventListener) return;
    t.addEventListener(type, fn, opts);
    bound.push([t, type, fn, opts]);
  }

  function reducedMotion() {
    try {
      return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch {
      return false;
    }
  }

  function isBattle() {
    return !!(S && S.mode === 'battle');
  }

  function scoreOf(k) {
    return isBattle() ? (k.hits || 0) : (k.stars || 0);
  }

  function countLabel(n, noun) {
    return `${n} ${noun}${n === 1 ? '' : 's'}`;
  }

  function scoreNoun() {
    return isBattle() ? 'KOs' : '★';
  }

  function colorFor(pid) {
    const ids = (S && S.karts ? S.karts : []).map((k) => k.pid);
    const i = ids.indexOf(pid);
    return KART_COLORS[(i < 0 ? 0 : i) % KART_COLORS.length];
  }

  function nameOf(pid) {
    const p = (S && (S.players || S.participants) ? (S.players || S.participants) : []).find((q) => q.id === pid);
    if (p) return p.name;
    const w = (S && S.spectators ? S.spectators : []).find((q) => q.id === pid);
    return w ? w.name : '???';
  }

  function myKart() {
    if (!S || !S.karts || !S.you) return null;
    return S.karts.find((k) => k.pid === S.you) || null;
  }

  /* ---------------- input ---------------- */

  function guardTarget(e) {
    const t = e.target;
    if (!t || !t.tagName) return false;
    const tag = t.tagName.toLowerCase();
    if (tag === 'button' && t.closest && t.closest('.pk-touch')) return e.code === 'Space' || e.code === 'Enter';
    if (['input', 'select', 'textarea', 'button', 'a', 'summary'].includes(tag)) return true;
    if (t.isContentEditable) return true;
    // A dialog (customizer) owns the keyboard while open.
    if (typeof document !== 'undefined' && document.querySelector('#dlg-root .dlg')) return true;
    return false;
  }

  function clampIntent(v) {
    const n = Number(v) || 0;
    return n < -1 ? -1 : n > 1 ? 1 : n;
  }

  function canDriveControls() {
    if (!S?.youDrive || S.preparing || !['countdown', 'drive'].includes(S.phase) || meRespawning() || document.hidden) return false;
    const context=apiRef?.context?.();
    if (context?.connected === false || context?.preparing || context?.roomActionPending) return false;
    return !document.querySelector('.room-menu[open]') && !document.querySelector('#dlg-root .dlg') && !rootEl?.querySelector('#pk-help')?.open;
  }

  /* Intent merge policy (analog thumb stick + digital + keyboard):
   * - Steering: keyboard wins while left/right is held (digital -1/0/1,
   *   both held = 0); otherwise the stick x float (-1 left .. +1 right).
   * - Throttle, first match wins: digital brake/down (-1, keeps reverse and
   *   overrides positive stick/Auto gas) > manual gas/up (+1) > nonzero
   *   stick vertical (-y: UP pushes, DOWN brakes/reverses, proportional) >
   *   Auto gas (+1 when nothing else drives) > 0.
   * - Nitro (N / NITRO button) rides alongside as intent.nitro, fully
   *   independent of the Space fire edge and the Shift drift hold.
   * Sends ONLY { steer, throttle, boost, drift, nitro } — never
   * coordinates or timestamps (server stamps receipt time, 1500 ms TTL). */
  function pulseLife() {
    const me=myKart();
    return isBattle()&&S?.phase==='drive'&&me?.weapon==='pulse'&&me.ammo>0&&!me.respawn
      ? `${S.instanceId}:${me.spawnSeq}:${me.controlEpoch??0}` : null;
  }
  function latchPulseHold() {
    if(fireHeld||keys.has('action'))pulseHoldLife=pulseLife();
  }

  function intentFromState() {
    let steer = 0;
    if (keys.has('left') || keys.has('right')) {
      steer = (keys.has('right') ? 1 : 0) - (keys.has('left') ? 1 : 0);
    } else {
      steer = clampIntent(stickValue.x);
    }
    let throttle = 0;
    if (keys.has('down') || touch.brake) throttle = -1;
    else if (keys.has('up') || touch.gas) throttle = 1;
    else if (stickValue.y !== 0) throttle = clampIntent(-stickValue.y);
    else if (autoGas) throttle = 1;
    return { steer, throttle, boost: boostEdge || (pulseHoldLife!==null&&pulseHoldLife===pulseLife()&&(fireHeld||keys.has('action'))), drift: keys.has('drift') || touch.drift, nitro: keys.has('nitro') || touch.nitro };
  }

  function isInputActive() {
    return keys.size > 0 || touch.gas || touch.brake || touch.drift || touch.nitro ||
      stickValue.x !== 0 || stickValue.y !== 0 || autoGas || boostEdge || fireHeld;
  }

  /* Silent clear: drops stick + digital identities, visual-held state,
   * captured pointers and Auto gas WITHOUT emitting. Callers follow with
   * one final sendInput(true) so a global stop never leaks an intermediate
   * packet (e.g. steer-zero while gas is still held). */
  function clearDriveInput() {
    pulseHoldLife=null;
    cancelAnalogSend();
    analogMoving = false;
    keys.clear();
    try {
      stick?.reset(false);
    } catch { /* unmounted stick still clears host state */ }
    stickValue = { x: 0, y: 0 };
    for (const clear of clearHolds) clear();
    touch = { gas: false, brake: false, drift: false, nitro: false };
    autoGas = false;
    boostEdge = false;
    predictBoost = false;
    paintAutoGas();
    lastSent = '';
  }

  function atomicStop() {
    suppressStickSend = true;
    try {
      clearDriveInput();
    } finally {
      suppressStickSend = false;
    }
    sendInput(true);
  }

  function paintAutoGas() {
    const b = rootEl?.querySelector('#pk-auto');
    if (!b) return;
    b.hidden = !S?.youDrive || !['countdown','drive'].includes(S?.phase);
    b.textContent = autoGas ? 'Auto gas · on' : 'Auto gas · off';
    b.setAttribute('aria-pressed', String(autoGas));
  }

  /* Intent for visual self-prediction: live keys plus a locally queued
   * action pop. sendInput() consumes boostEdge for the wire immediately,
   * so the frame loop would never see the edge — predictBoost carries it
   * visually until the next snapshot (cleared in update(); server boost
   * state then takes over). In battle the pose helper ignores the pop
   * (the button fires; there is no boost). Never sent; prediction only. */
  function intentForPrediction() {
    const it = intentFromState();
    it.boost = it.boost || predictBoost;
    return it;
  }

  function nowMs() {
    try {
      if (typeof performance !== 'undefined' && performance.now) return performance.now();
    } catch { /* noop */ }
    return Date.now();
  }

  /* Calibrated server time for HUD deadlines (api.now when the shell
   * provides it, else wall). Pose prediction keeps its own nowMs(). */
  function serverNow() {
    if (apiRef && typeof apiRef.now === 'function') {
      try {
        const v = apiRef.now();
        if (Number.isFinite(v)) return v;
      } catch { /* wall clock below */ }
    }
    return Date.now();
  }

  /* Kart-owned stylesheet (public/css/kart-arena.css): the arena's own
   * kart-arena identity, injected once and scoped under .pk so other games
   * are untouched. Kept across dispose/remount (still scoped, cached). */
  function ensureKartCss() {
    try {
      if (typeof document === 'undefined') return;
      if (document.querySelector('link[data-kart-arena]')) return;
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = '/css/kart-arena.css';
      link.setAttribute('data-kart-arena', '1');
      document.head.appendChild(link);
    } catch { /* unstyled HUD still plays */ }
  }

  function sendInput(force) {
    cancelAnalogSend();
    if (!S || !apiRef || !S.youDrive) return;
    if (S.phase !== 'drive' && S.phase !== 'countdown') return;
    const intent = myKart()?.respawn > 0 ? {steer:0,throttle:0,boost:false,drift:false,nitro:false} : intentFromState();
    const key = intent.steer + ',' + intent.throttle + ',' + (intent.boost ? '1' : '0') + ',' + (intent.drift ? '1' : '0') + ',' + (intent.nitro ? '1' : '0');
    boostEdge = false;
    if (!force && key === lastSent) return;
    lastSent = key;
    lastInputSentAt = nowMs();
    // Intents only — never positions or client timestamps (the server
    // stamps receipt time and owns the TTL). Silent: realtime intents and
    // the 500 ms keepalive must never click (see api.send).
    const seq=S.motionProfile?++physicalSeq:undefined;
    physicalPrediction?.sent(seq);
    apiRef.send({ input: intent,...(seq?{seq,life:myKart()?.spawnSeq||0,controlEpoch:S.inputAck?.controlEpoch||0}: {}) }, { silent: true });
  }

  function cancelAnalogSend() {
    if (analogTimer) { clearTimeout(analogTimer); analogTimer = 0; }
  }

  /* Prediction sees each new vector immediately. Only sustained analog
   * motion is coalesced to 30 Hz; one timeout sends the latest vector.
   * First movement and neutral release bypass the wait, as do discrete
   * controls, keepalive and every global stop through sendInput(). */
  function sendStickInput() {
    const moving = stickValue.x !== 0 || stickValue.y !== 0;
    if (!moving || !analogMoving) {
      analogMoving = moving;
      sendInput(false);
      return;
    }
    const wait = ANALOG_SEND_MS - (nowMs() - lastInputSentAt);
    if (wait <= 0) sendInput(false);
    else if (!analogTimer) analogTimer = setTimeout(() => {
      analogTimer = 0;
      sendInput(false);
    }, wait);
  }

  function keyName(e) {
    if (e.code === 'ArrowLeft' || e.code === 'KeyA') return 'left';
    if (e.code === 'ArrowRight' || e.code === 'KeyD') return 'right';
    if (e.code === 'ArrowUp' || e.code === 'KeyW') return 'up';
    if (e.code === 'ArrowDown' || e.code === 'KeyS') return 'down';
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') return 'drift';
    if (e.code === 'KeyN') return 'nitro';
    return null;
  }

  /* ---------------- HUD (DOM overlay; never inside WebGL) ---------------- */

  function fmtTime(ms) {
    const s = Math.max(0, Math.ceil(ms / 1000));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }

  function buildHud() {
    // Clock at the center, one score/inventory console at the right. Full
    // names and the objective live in disclosures, leaving the chase clear.
    rootEl.querySelector('.pk-hud').innerHTML = `
    <div class="pk-top pk-racestrip" role="group" aria-label="Match status">
      <div class="pk-clock"><span class="pk-chip pk-timer" id="pk-timer" role="timer" aria-label="Time left">–</span>
      </div><div class="pk-status">
      <span class="pk-sr" id="pk-mine">–</span>
      <details class="pk-board" id="pk-board">
      <summary class="pk-lead" id="pk-lead" aria-label="Leaderboard standings, expand for full timing"></summary>
      <div class="pk-standpanel"><span class="pk-goal" id="pk-goal">–</span><div class="pk-stand" id="pk-stand" aria-label="Standings"></div></div>
      </details><span id="pk-health" class="pk-health" role="img" aria-label="Health 100 of 100"><svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 27 5 16C-2 8 9 1 16 9c7-8 18-1 11 7Z" fill="#ff6375"/></svg><span><i id="pk-healthfill"></i></span></span></div>
    </div>
    <div class="pk-count" id="pk-count" hidden></div>
    <div class="pk-tip" id="pk-tip" role="status" hidden></div>
    <div class="pk-readout" role="group" aria-label="Weapon, speed and nitro">
      <div class="pk-equip kart-item" id="pk-boost" role="group" aria-label="Weapon" hidden></div>
      <div class="pk-instruments">
      <div class="pk-speed" aria-label="Speed"><b id="pk-speed">0</b><small>km/h</small></div>
      <div class="pk-tech"><span id="pk-map"></span><span id="pk-handling"></span>
      <div class="pk-driftmeter" role="progressbar" aria-label="Drift charge" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i id="pk-driftfill"></i></div>
      <div class="pk-nitrometer" role="progressbar" aria-label="Nitro charge" aria-valuemin="0" aria-valuemax="100" aria-valuenow="100"><i id="pk-nitrofill"></i><span id="pk-nitrolabel">Nitro</span></div></div>
      <details class="pk-help" id="pk-help"><summary aria-label="Driving controls help">?</summary>
      <div class="pk-helpbody"><button type="button" id="pk-resume" class="pk-resume">Resume</button><label class="pk-controls-label">Controls<select id="pk-controls" aria-label="Controls"><option value="auto">Auto</option><option value="keyboard">Keyboard</option><option value="touch">Touch</option></select></label><button type="button" id="pk-auto" class="pk-auto" aria-pressed="false" hidden>Auto gas · off</button><p class="pk-helpkeys"><b>Drive</b> WASD / arrows or left stick: up for gas, down to brake / reverse · <b>Drift</b> hold Shift / tyre button in a turn, release a full meter for turbo · <b>Nitro</b> hold N / bottle button with gas for a rechargeable boost · <b>Item</b> Space / action button · Ice is slippery, mint strips boost.</p><a href="/assets/karts/audio/CREDITS.txt" target="_blank" rel="noopener">Sound credits</a></div></details></div></div>
    <canvas id="pk-radar" class="pk-radar" width="120" height="120" role="img" aria-label="Arena map: players, cover and glowing pickups"></canvas>
    <div class="pk-respawn" id="pk-respawn" hidden></div>
    <div class="pk-result" id="pk-result" hidden></div>
    <div class="pk-glnote" id="pk-glnote" hidden></div>`;
    // Standings open on demand, leaving the arena clear on every screen.
    lastStandKey = '';
    lastResultKey = '';
  }

  function paintHud() {
    if (!rootEl || !S) return;
    if (arenaPending) {
      if (S.phase !== 'done' || hostContext().isHost !== true) {
        arenaPending = null; arenaNotice = '';
      } else if (nextMapSetting() === arenaPending.label) {
        const label = arenaPending.label;
        arenaPending = null; arenaNotice = '';
        try { apiRef.announce(`Next arena: ${label}. Applies on rematch.`); } catch { /* best-effort */ }
      } else if (nowMs() - arenaPending.at > 5000) {
        arenaPending = null; arenaNotice = 'Arena was not saved. Try again.';
      }
    }
    const timer = rootEl.querySelector('#pk-timer');
    const goal = rootEl.querySelector('#pk-goal');
    const mine = rootEl.querySelector('#pk-mine');
    const boost = rootEl.querySelector('#pk-boost');
    const count = rootEl.querySelector('#pk-count');
    const stand = rootEl.querySelector('#pk-stand');
    const tip = rootEl.querySelector('#pk-tip');
    const result = rootEl.querySelector('#pk-result');
    if (!timer) return;
    const battle = isBattle();

    if (S.preparing || (!gl && !fbCanvas)) {
      timer.textContent = 'Getting ready…';
      count.hidden = true;
      count.textContent = '';
      lastCount = -1;
    } else if (S.phase === 'countdown' && S.endsAt) {
      const left = Math.max(0, S.endsAt - serverNow());
      const n = Math.ceil(left / 1000);
      timer.textContent = 'Starting…';
      count.hidden = false;
      if (String(n) !== count.textContent) {
        count.textContent = n > 0 ? String(n) : 'GO';
        if (lastCount !== n && apiRef) {
          lastCount = n;
          if (n <= 0) apiRef.announce(battle ? 'Go! Tag your rivals.' : 'Go! Collect the stars.');
        }
      }
    } else if (S.phase === 'drive' && S.endsAt) {
      timer.textContent = fmtTime(S.endsAt - serverNow());
      count.hidden = true;
    } else if (S.phase === 'done') {
      timer.textContent = 'Finished';
      count.hidden = true;
    }
    goal.textContent = S.winRule === 'Time limit' ? (battle ? 'Most KOs wins' : 'Most stars wins') : battle ? `${S.targetHits || 0} KOs to win` : `★ ${S.targetStars || 0} to win`;
    drawRadar();
    const respawn = rootEl.querySelector('#pk-respawn');
    if (respawn) {
      respawn.hidden = !meRespawning();
      respawn.textContent = meRespawning() ? `Back in ${Math.max(1, Math.ceil(myKart().respawn))}…` : '';
    }
    const cue = rootEl.querySelector('#pk-cue');
    if (cue) { cue.hidden = !cueText || nowMs() > cueUntil || S.phase !== 'drive'; cue.textContent = cueText; }

    const me = myKart();
    const health=rootEl.querySelector('#pk-health'),healthFill=rootEl.querySelector('#pk-healthfill');
    if(health){health.hidden=!battle||!me;const maximum=me?.maxHealth||100,hp=Math.max(0,Math.min(maximum,me?.health??100));health.setAttribute('aria-label',`Health ${hp} of ${maximum}`);health.dataset.low=String(hp<=maximum*.3);if(healthFill)healthFill.style.transform=`scaleX(${hp/maximum})`;}
    const mapLabel = rootEl.querySelector('#pk-map');
    const handling = rootEl.querySelector('#pk-handling');
    const speedDigits = rootEl.querySelector('#pk-speed');
    const driftFill = rootEl.querySelector('#pk-driftfill');
    const driftMeter = rootEl.querySelector('.pk-driftmeter');
    const nitroFill = rootEl.querySelector('#pk-nitrofill');
    const nitroMeter = rootEl.querySelector('.pk-nitrometer');
    const nitroLabel = rootEl.querySelector('#pk-nitrolabel');
    const charge = Math.min(1, Math.max(0, Number(me && me.driftCharge) || 0));
    const nitro = me && me.nitro !== undefined ? Math.min(1, Math.max(0, Number(me.nitro) || 0)) : 1;
    const nitroLocked = me?.nitroLocked === true;
    const nitroActive = me?.nitroActive === true;
    const kmh = Math.round(Math.abs((me && me.speed) || 0) * 3.6);
    if (mapLabel) mapLabel.textContent = (S.map && (S.map.label || S.map.id)) || 'Arena';
    if (speedDigits) speedDigits.textContent = me ? String(kmh) : '–';
    if (handling) {
      const feel = !me ? 'Watching the arena'
        : me.drifting ? (charge >= 1 ? 'Release for turbo!' : 'Charging drift')
        : (me.boost > 0 || me.turbo > 0 || nitroActive) ? (nitroActive && !(me.boost > 0 || me.turbo > 0) ? 'Nitro!' : 'Turbo!')
        : me.grip < 0.8 ? 'Ice · ease into turns'
        : me.respawn > 0 ? 'Rejoining…'
        : (me.shield > 0 && battle) ? `Shielded ${Math.ceil(me.shield)}s`
        : me.empT > 0 ? `EMP slow · ${Math.ceil(me.empT)}s`
        : nitroLocked ? 'Nitro charging…'
        : me.speed < -1 ? 'Reversing'
        : '';
      handling.textContent = feel;
      handling.hidden = !feel;
    }
    if (driftFill) driftFill.style.transform = `scaleX(${charge})`;
    if (driftMeter) {
      driftMeter.hidden = !me;
      driftMeter.setAttribute('aria-valuenow', String(Math.round(charge * 100)));
    }
    if (nitroFill) nitroFill.style.transform = `scaleX(${nitro})`;
    if (nitroMeter) {
      nitroMeter.hidden = !me;
      nitroMeter.setAttribute('aria-valuenow', String(Math.round(nitro * 100)));
      nitroMeter.classList.toggle('pk-empty', nitroLocked);
      nitroMeter.classList.toggle('pk-boosting', nitroActive);
    }
    if (nitroLabel) nitroLabel.textContent = !me ? 'Nitro' : nitroActive ? 'Nitro!' : nitroLocked ? `Charging ${Math.round(nitro * 100)}%` : `Nitro ${Math.round(nitro * 100)}%`;
    const driftButton = rootEl.querySelector('#pk-th');
    if (driftButton) driftButton.classList.toggle('pk-held', !!(me && me.drifting));
    const nitroButton = rootEl.querySelector('#pk-tn');
    if (nitroButton) {
      nitroButton.disabled = S.phase !== 'drive' && S.phase !== 'countdown' || !me || me.respawn > 0;
      // Charge moves ONLY the ring arc offset; the glyph markup is static
      // from mount and is never rebuilt by HUD text updates.
      try {
        const arc = nitroButton.querySelector('.pk-nitro-arc');
        if (arc) arc.setAttribute('stroke-dashoffset', (NITRO_ARC_LEN * (1 - nitro)).toFixed(1));
      } catch { /* unstyled still plays */ }
      nitroButton.setAttribute('aria-label', !me ? 'Nitro' : nitroActive ? `Nitro boosting, ${Math.round(nitro * 100)} percent left` : nitroLocked ? `Nitro charging, ${Math.round(nitro * 100)} percent` : `Hold for nitro boost, ${Math.round(nitro * 100)} percent`);
      nitroButton.classList.toggle('pk-boosting', nitroActive);
      nitroButton.classList.toggle('pk-empty', nitroLocked);
    }
    const readout = rootEl.querySelector('.pk-readout');
    if (readout) {
      readout.classList.toggle('pk-drifting', !!(me && me.drifting));
      readout.classList.toggle('pk-charged', !!(me && me.drifting && charge >= 1));
      readout.classList.toggle('pk-nitroing', nitroActive);
    }
    rootEl.querySelector('.pk')?.classList.toggle('pk-battle', battle);
    if (battle) {
      const item = ITEMS[me?.weapon];
      const loaded = !!(item && me && me.ammo > 0);
      mine.textContent = me ? `You · ${me.hits || 0} KO${me.hits === 1 ? '' : 's'}` : 'Watching';
      boost.hidden = !me;
      const hint=loaded&&S.phase==='drive'&&nowMs()<keycapUntil&&!touchControlsFor(controlsPreference,readInputCapabilities());
      paintKartWeapon(boost,me,weaponArt(me?.weapon||'crate'),{hint});
    } else {
      mine.textContent = me ? `You ★ ${me.stars}` : (S.youDrive ? 'You ★ 0' : 'Watching');
      boost.hidden=true;
    }

    // Standings rewrite only when the order/scores actually change: this
    // runs on every 10 Hz snapshot plus the 500 ms timer, so an unchanged
    // innerHTML churn would cost layout on every tick while driving.
    // Equal scores share a rank; drivers who dropped out sit last.
    const rows = [...(S.karts || [])].sort((a, b) => (a.out === true) - (b.out === true) || scoreOf(b) - scoreOf(a)).slice(0, 8);
    const ranks = [];
    rows.forEach((k, i) => { ranks[i] = i && !k.out && !rows[i - 1].out && scoreOf(k) === scoreOf(rows[i - 1]) ? ranks[i - 1] : i + 1; });
    const myIndex = S.you ? rows.findIndex((k) => k.pid === S.you) : -1;
    const myRank = myIndex >= 0 ? ranks[myIndex] : 0;
    const standKey = (battle ? 'b' : 'r') + '|' + (S.you || '') + '|' +
      rows.map((k) => k.pid + ':' + scoreOf(k) + (k.out ? ':out' : '')).join(',');
    if (standKey !== lastStandKey) {
      lastStandKey = standKey;
      const lead = rootEl.querySelector('#pk-lead');
      if (lead) {
        const top = rows[0];
        const scoreTxt = (k) => (battle ? `${countLabel(scoreOf(k), 'KO')}` : `★ ${scoreOf(k)}`);
        // Folded: rank and score only. Full names stay in the standings.
        const self = myIndex >= 0 ? rows[myIndex] : null;
        const leader = self || top;
        if (leader) {
          const fullName = nameOf(leader.pid);
          const rank = self ? myRank : 1;
          lead.setAttribute('aria-label', `${fullName}, rank ${rank}, ${scoreTxt(leader)}. Expand standings.`);
          lead.innerHTML = `<span class="pk-leadrank">P${rank}</span>` +
            `<span class="pk-leadscore">${scoreOf(leader)}${battle ? '<small> KO</small>' : ' ★'}</span>` +
            `<span class="pk-chev" aria-hidden="true">▾</span>`;
        } else {
          lead.setAttribute('aria-label', 'Expand standings');
          lead.innerHTML = '<span class="pk-leadtxt">–</span><span class="pk-chev" aria-hidden="true">▾</span>';
        }
      }
      stand.innerHTML = rows.map((k, i) =>
        `<div class="pk-row${k.pid === S.you ? ' pk-self' : ''}${k.out ? ' pk-out' : ''}">` +
        `<span class="pk-rank">${ranks[i]}</span>` +
        `<span class="pk-dot" style="background:#${colorFor(k.pid).toString(16).padStart(6, '0')}"></span>` +
        `<span class="pk-name">${esc(nameOf(k.pid))}${k.out ? ' <small>Left</small>' : ''}</span>` +
        `<span class="pk-score">${battle ? `${countLabel(scoreOf(k), 'KO')}` : `★ ${scoreOf(k)}`}</span></div>`
      ).join('');
    }

    if (S.phase === 'done' && S.result) {
      result.hidden = false;
      const wins = S.result.winners || (S.result.winner ? [S.result.winner] : []);
      const reason = (S.result && S.result.endReason) || 'timeout';
      const resKey = (battle ? 'b' : 'r') + '|' + reason + '|' + wins.join(',') + '|' +
        (S.result.standings || []).map((r) => r.pid + ':' + r.score + ':' + r.points + ':' + (r.out ? 1 : 0)).join(',') + '|' + S.you + '|' +
        JSON.stringify([S.coins,S.upgrades?.[S.you],S.garageResult,nextMapSetting(),hostContext().isHost,S.map?.id,typeof apiRef?.configure,arenaPending?.label,arenaNotice]);
      if (resKey !== lastResultKey) {
        lastResultKey = resKey;
        const unit = (n) => (battle ? `${n} KO${n === 1 ? '' : 's'}` : `${n} star${n === 1 ? '' : 's'}`);
        const target = battle ? (S.targetHits || 0) : (S.targetStars || 0);
        const final = kartResultView({ result: S.result, you: S.you, nameOf, unit, target,
          targetUnit: battle ? (target === 1 ? 'KO' : 'KOs') : (target === 1 ? 'star' : 'stars') });
        const scrollTop = result.scrollTop || 0;
        const focusKey = result.contains?.(document.activeElement) ? document.activeElement?.getAttribute?.('data-arena') : null;
        result.innerHTML = final.html + mapChooserHtml() + garageHtml();
        result.scrollTop = scrollTop;
        if (focusKey) result.querySelector(`[data-arena="${focusKey}"]`)?.focus?.({ preventScroll: true });
      }
    } else {
      result.hidden = true;
      if (lastResultKey !== '') {
        lastResultKey = '';
        result.innerHTML = '';
      }
    }

    // Concise contextual state only — the driving keys live in the help
    // disclosure inside the telemetry readout, not as a permanent paragraph.
    const arenaName = (S.map && (S.map.label || S.map.id)) || '';
    const tipTxt = !S.youDrive
      ? `Watching — ${(S.karts || []).length} driving.`
      : S.phase === 'countdown' ? (arenaName ? `Get ready… · ${arenaName}` : 'Get ready…')
      : S.phase === 'drive' && meRespawning() ? 'Knocked out — rejoining…'
      : '';
    tip.textContent = tipTxt;
    tip.hidden = !tipTxt;

    // Fire button shows the equipped weapon SVG + remaining ammo (empty
    // crosshair when unarmed). Markup rebuilds only on a changed key; no
    // textContent write ever wipes the icon or the ammo badge.
    const tb = rootEl.querySelector('#pk-tb');
    if (tb) {
      const item = battle ? ITEMS[me?.weapon] : null;
      const loaded = !!(item && me && me.ammo > 0);
      const fireKey = !battle ? 'race' : !me || me.respawn > 0 ? 'rejoin'
        : loaded ? `${me.weapon}|${me.ammo}` : 'empty';
      if (fireKey !== lastFireKey) {
        lastFireKey = fireKey;
        const art = !battle ? BOOST_ART : loaded ? weaponThumbnailArt(me.weapon,weaponArt(me.weapon)) : CROSSHAIR_ART;
        const ammo = loaded ? `<span class="pk-fire-ammo">${esc(String(me.ammo))}</span>`
          : '<span class="pk-fire-ammo" hidden></span>';
        tb.innerHTML = `<span class="pk-fire-art">${art}</span>${ammo}`;
      }
      const label = !battle ? 'Boost'
        : loaded ? me.firing ? 'Weapon firing' : `Activate ${item.label}, full payload`
        : !me || me.respawn > 0 ? 'Rejoining' : 'No item';
      if (tb.getAttribute('aria-label') !== label) tb.setAttribute('aria-label', label);
      tb.disabled = S.phase !== 'drive' || !me || me.respawn > 0 || (battle && (!loaded || me.firing));
    }

    if (typeof hooks.hudExtra === 'function') {
      try { hooks.hudExtra(rootEl, S); } catch { /* game-owned extra must not break HUD */ }
    }
  }

  function garageHtml() {
    if (!isBattle() || !S.youDrive || !S.garagePrices) return '';
    const levels=S.upgrades?.[S.you]||{},table=S.garagePrices;
    const defs=[['engine','Engine','Faster acceleration & top speed','+5% per level'],
      ['handling','Handling','Sharper turns','+4% per level'],['reload','Quick reload','Fire again sooner','6% faster per level']];
    const feedback=S.garageResult;
    if (feedback?.nonce===garagePending) garagePending=null;
    return `<section class="pk-garage" aria-label="Your kart garage"><header><h4>Your garage</h4><b class="pk-wallet">${Math.max(0,S.coins||0)} coins</b></header>`+
      `<p>${S.garage?'Upgrades apply next rematch.':'Upgrades apply in Garage Battle.'} Your garage stays with you in this room.</p>`+
      `<div class="pk-upgrades">${defs.map(([category,name,desc,perk])=>{
        const level=Math.min(table.max||3,Math.max(0,levels[category]||0));
        const max=level>=(table.max||3),price=table.prices?.[level]??20;
        return `<div class="pk-upgrade"><div><strong>${name} <small>${level}/${table.max||3}</small></strong><span>${desc}</span><em>${perk}</em></div>`+
          `<button type="button" data-upgrade="${category}" ${max||(S.coins||0)<price||garagePending?'disabled':''} aria-label="${max?`${name} maxed`:`Upgrade ${name} for ${price} coins`}">${max?'Maxed':`${price} coins`}</button></div>`;
      }).join('')}</div><p class="pk-garage-feedback" role="status">${feedback?esc(feedback.ok?`${defs.find(d=>d[0]===feedback.category)?.[1]||'Kart'} upgraded to level ${feedback.level}!`:feedback.error||'Try again.'):'KOs +10 · pickups +1 · finish +5 · win +15'}</p></section>`;
  }

  function hostContext() {
    try { return apiRef?.context?.() || {}; } catch { return {}; }
  }

  function nextMapSetting() {
    const s = hostContext().settings || {};
    return typeof s.map === 'string' ? s.map : null;
  }

  function mapChooserHtml() {
    const active = arenaByMap(S.map) || ARENA_CHOOSER[0];
    const ctx = hostContext();
    const isHost = ctx.isHost === true;
    const canConfigure = isHost && S.phase === 'done' && !arenaPending && apiRef && typeof apiRef.configure === 'function';
    const nextRaw = nextMapSetting();
    const next = (nextRaw && arenaByMap({ id: nextRaw, label: nextRaw })) || active;
    const buttons = ARENA_CHOOSER.map((a) => {
      const isActive = a.id === active.id;
      const isNext = a.id === next.id;
      const tag = arenaPending?.label === a.label ? 'Saving…' : isActive && isNext ? 'Now + Next' : isActive ? 'Now' : isNext ? 'Next' : '';
      const aria = `${a.label}, ${a.blurb}${isActive ? ' (current arena)' : ''}${isNext ? ' (next)' : ''}${canConfigure ? '' : isHost ? ' (configure unavailable)' : ' (host picks)'}`;
      return `<button type="button" class="pk-arena" data-arena="${a.id}" ${canConfigure ? '' : 'disabled'} aria-pressed="${isNext ? 'true' : 'false'}" aria-label="${esc(aria)}" title="${esc(a.label)} · ${esc(a.blurb)}"><img class="pk-arena-preview" src="/assets/karts/previews/legacy-${a.id}.webp" width="480" height="270" alt="" aria-hidden="true" decoding="async"><span class="pk-arenalabel">${esc(a.label)}</span>${tag ? `<span class="pk-tag${isNext && !isActive ? ' pk-next' : ''}">${esc(tag)}</span>` : ''}</button>`;
    }).join('');
    const note = arenaPending ? `Saving ${arenaPending.label}…` : arenaNotice ? arenaNotice : !apiRef || typeof apiRef.configure !== 'function'
      ? 'Arena preview — host rematch settings unavailable here.'
      : isHost ? (next.id === active.id ? 'Pick next arena for rematch — current shown.' : `Next: ${next.label} — applies on rematch.`) : `Host picks next arena — showing ${next.label} next.`;
    return `<section class="pk-arenas" aria-label="Next arena"><header><h4>Next arena</h4><span class="pk-arena-note" role="status">${esc(note)}</span></header><div class="pk-arenagrid">${buttons}</div></section>`;
  }

  function buyUpgrade(event) {
    const button=event.target?.closest?.('[data-upgrade]');
    if (!button || button.disabled || garagePending || S?.phase!=='done' || !S?.youDrive) return;
    const category=button.getAttribute('data-upgrade');
    if (!['engine','handling','reload'].includes(category)) return;
    garagePending=typeof crypto!=='undefined'&&crypto.randomUUID?crypto.randomUUID():`buy-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    button.disabled=true;
    const feedback=rootEl.querySelector('.pk-garage-feedback');
    if(feedback)feedback.textContent='Adding your upgrade…';
    apiRef.send({garage:{category,nonce:garagePending}});
  }

  function chooseArena(event) {
    const button=event.target?.closest?.('[data-arena]');
    if (!button || button.disabled || arenaPending || S?.phase !== 'done') return;
    if (hostContext().isHost !== true) return;
    if (!apiRef || typeof apiRef.configure !== 'function') return;
    const arena = ARENA_CHOOSER.find((a) => a.id === button.getAttribute('data-arena'));
    if (!arena) return;
    if (nextMapSetting() === arena.label) return;
    let ok = false;
    try { ok = apiRef.configure({ map: arena.label }) === true; } catch { ok = false; }
    arenaPending = ok ? { label: arena.label, at: nowMs() } : null;
    arenaNotice = ok ? '' : 'Arena was not saved. Try again.';
    lastResultKey = '';
    paintHud();
  }

  function resultClick(event) {
    buyUpgrade(event);
    chooseArena(event);
  }

  function meRespawning() { return !!(myKart()?.respawn > 0 && S?.phase === 'drive'); }

  function skyPhase() {
    const cycle = S?.skyCycle;
    return cycle && cycle.durationMs > 0 ? Math.max(0, Math.min(1, ((Number.isFinite(cycle.endedAt) ? cycle.endedAt : serverNow()) - cycle.startedAt) / cycle.durationMs)) : null;
  }

  function drawRadar() {
    const canvas = rootEl.querySelector('#pk-radar');
    if (!canvas?.getContext) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const size = 120, half = S.map?.half || 30, scale = 108 / (half * 2);
    const xy = n => 60 + n * scale;
    ctx.clearRect(0,0,size,size);
    ctx.fillStyle = '#192d3be8'; ctx.fillRect(0,0,size,size);
    ctx.strokeStyle = '#9ad2d755'; ctx.lineWidth = 1; ctx.strokeRect(6,6,108,108);
    ctx.fillStyle = '#849aa58a';
    for (const b of S.map?.blocks || []) ctx.fillRect(xy(b.x-b.hw),xy(b.z-b.hd),b.hw*2*scale,b.hd*2*scale);
    ctx.fillStyle = '#89f5d9';
    for (const c of S.crates || S.stars || []) { ctx.beginPath(); ctx.arc(xy(c.x),xy(c.z),2.3,0,Math.PI*2); ctx.fill(); }
    for (const k of S.karts || []) {
      if (k.respawn > 0 || k.connected === false || k.out) continue;
      const self = k.pid === S.you;
      ctx.save(); ctx.translate(xy(k.x),xy(k.z)); ctx.rotate(canvasNoseRotation(k.angle));
      ctx.fillStyle = self ? '#fff9df' : '#' + colorFor(k.pid).toString(16).padStart(6,'0');
      ctx.beginPath(); ctx.moveTo(0,-(self?5:3.5)); ctx.lineTo(-3,3); ctx.lineTo(3,3); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
    ctx.fillStyle = '#c4dddd'; ctx.font = '9px sans-serif'; ctx.fillText('N',56,12);
  }

  function showGlNote(html) {
    const note = rootEl && rootEl.querySelector('#pk-glnote');
    if (!note) return;
    if (!html) { note.hidden = true; note.innerHTML = ''; return; }
    note.hidden = false;
    note.innerHTML = html;
    note.querySelectorAll('[data-glaction]').forEach((b) => {
      on(b, 'click', () => glAction(b.dataset.glaction));
    });
  }

  function glAction(kind) {
    if (kind === 'retry3d') {
      // Dispose the EXISTING handle first: after context loss its renderer,
      // ResizeObserver, and window listener are still held — mounting over
      // them leaks one observer + listener per retry. The generation bump
      // also supersedes any in-flight mount.
      mountGen += 1;
      stopFallback();
      disposeGl();
      sceneReady = mount3d();
    } else if (kind === 'use2d') {
      disposeGl();
      startFallback('Top-down view (graphics unavailable).');
    }
  }

/* ---------------- 3D scene ---------------- */

  function buildKartMesh(THREE, color, pid, assets) {
    if (typeof hooks.buildKartMesh === 'function') {
      try {
        const custom = hooks.buildKartMesh(THREE, color, pid);
        if (custom) {
          custom.userData = custom.userData || {};
          return custom; // game-owned mesh; flame/shield toggles skipped
        }
      } catch { /* fall through to the stock kart */ }
    }
    const model = createKartModel(THREE, { assets, color });
    model.userData.giggleKart = true;
    return model;
  }

  async function mount3d() {
    const gen = mountGen;
    const stage = rootEl && rootEl.querySelector('.pk-stage');
    if (!stage) return;
    stage.innerHTML = '<div class="pk-loading muted">Loading the arena…</div>';
    const handle = await createThreeView(stage, {
      signal: apiRef?.signal,
      diagnostics: apiRef?.diagnostics,
      build: (THREE, helper) => buildScene(THREE, helper, gen),
      onContextLost: () => {
        showGlNote(`<span>The 3D view paused.</span>
        <span class="row"><button class="btn ghost" data-glaction="retry3d">Retry 3D</button>
        <button class="howto-btn" data-glaction="use2d">Continue in 2D</button></span>`);
        if (apiRef) apiRef.announce('The 3D view paused. Retry 3D or continue in 2D.');
      },
    });
    if (gen !== mountGen) {
      if (handle && !handle.fallback) handle.dispose();
      return; // superseded by dispose/remount
    }
    if (!handle || handle.fallback) {
      gl = null;
      const reason = (handle && handle.reason) || 'webgl-unavailable';
      startFallback(reason === 'forced'
        ? 'Top-down view (3D disabled for this session).'
        : 'Top-down view — 3D is unavailable on this device.');
      if (reason !== 'forced') {
        showGlNote(`<span>3D did not start.</span>
        <span class="row"><button class="btn ghost" data-glaction="retry3d">Retry 3D</button></span>`);
      }
      return;
    }
    gl = handle;
    const equipped = rootEl.querySelector('#pk-boost');
    if (equipped) equipped.dataset.equipKey = '';
    lastFireKey = '';
    paintHud();
    const loading = stage.querySelector('.pk-loading');
    if (loading) loading.remove();
    showGlNote('');
  }

  async function buildScene(THREE, helper, gen) {
    const pal = paletteFor(S && S.palette);
    const scene = new THREE.Scene();
    let disposeLighting;
    let disposeCombat;
    let healthBars;
    let impactFX;
    try {
      const assets = await loadKartAssets(THREE, scene);
      if (gen !== mountGen) throw new Error('Retired kart scene');
      const world = createKartWorld(THREE, {scene, palette: S && S.palette, assets, map: S && S.map});
      world.syncMap((S && S.map) || {id:'ring',blocks:[]});
      world.group.getObjectByName('obstacles')?.traverse(mesh => {if (mesh.isMesh) mesh.castShadow=true;});
      const mood = world.palette || {sky: pal.sky, horizon: pal.horizon};
      scene.background = new THREE.Color(mood.horizon);
      scene.fog = new THREE.Fog(mood.horizon, ...(mood.fog || [78, 180]));
      const camera = new THREE.PerspectiveCamera(60, 4 / 3, 0.1, 400);
      camera.position.set(0, 7.5, -23);
      camera.lookAt(0, 1, -5);
      const renderer = helper.renderer();
      disposeLighting = createKartLighting(THREE, renderer, scene, mood, {half: world.bounds?.arena || S.map?.half || 30});

      const karts = new Map(); // pid -> mesh
      const stars = new Map(); // id -> group (gem + pickup-zone ring)
      const crates = new Map(); // id -> group (box + pickup-zone ring)
      const shotDirection=new THREE.Vector3(),shotForward=new THREE.Vector3(0,0,1);
      const zaps = new Map(); // id -> mesh (eased toward snapshots)
      const mines = new Map();
      const grenades = new Map(), combatEffects = new Map();
      const combat = createKartCombatArt(THREE,{assets:{get:name=>
        assets.pulse?.getObjectByName(name)||assets.arsenal?.getObjectByName(name)||
        (name!=='ScatterShot'&&assets.secondary?.getObjectByName(name))||assets.combat?.getObjectByName(name)
      },pickupAsset:assets.crate});
      disposeCombat=combat.dispose;
      healthBars=createKartHealthBars(THREE,scene);
      impactFX=createKartImpactFX(THREE,scene,{reducedMotion:()=>rm});
      const zoneGeo = new THREE.RingGeometry(2.22, 2.4, 36);
      const zoneMat = new THREE.MeshBasicMaterial({color:0xffd961,transparent:true,opacity:0.16,depthWrite:false,side:THREE.DoubleSide});
      const crateZoneMat = new THREE.MeshBasicMaterial({color:0x72e8f0,transparent:true,opacity:0.16,depthWrite:false,side:THREE.DoubleSide});
      const grenadeRingGeo=new THREE.RingGeometry(3.8,4,32);
      const grenadeRingMat=new THREE.MeshBasicMaterial({color:0xe65832,transparent:true,opacity:.65,depthWrite:false,side:THREE.DoubleSide});
      const coneVertices=[];
      for(let i=0;i<16;i++){const a=-.55+i/16*1.1,b=-.55+(i+1)/16*1.1;coneVertices.push(Math.sin(a)*12,.12,Math.cos(a)*12,Math.sin(b)*12,.12,Math.cos(b)*12);}
      for(const a of [-.55,0,.55])coneVertices.push(0,.12,0,Math.sin(a)*12,.12,Math.cos(a)*12);
      const empGeo=new THREE.BufferGeometry();empGeo.setAttribute('position',new THREE.Float32BufferAttribute(coneVertices,3));
      const empMat=new THREE.LineBasicMaterial({color:0x2585ff,transparent:true,opacity:.95});
      const blastGeo=new THREE.RingGeometry(3.3,4,32);
      const blastMat=new THREE.MeshBasicMaterial({color:0xff973d,transparent:true,opacity:.7,depthWrite:false,side:THREE.DoubleSide});
      const driftSparks = new THREE.InstancedMesh(new THREE.OctahedronGeometry(0.11),
        new THREE.MeshBasicMaterial({color:0x83ffe0}), 48);
      driftSparks.count = 0; driftSparks.frustumCulled = false; scene.add(driftSparks);
      const sparkMatrix = new THREE.Matrix4();
      const pops = new THREE.InstancedMesh(new THREE.BoxGeometry(.32,.16,.5),new THREE.MeshBasicMaterial({color:0xffcf80}),64);
      pops.count=0; pops.frustumCulled=false; scene.add(pops);
      const popSites=[]; // bounded accepted KO/contact/blast debris
      const effectSeen=new Set();

      // Reserve shared effect resources in the hidden library so disposal also
      // handles a frame with zero live pickups/projectiles.
      const reserve = new THREE.Group(); reserve.visible = false; scene.add(reserve);
      reserve.add(new THREE.Mesh(zoneGeo,zoneMat),new THREE.Mesh(zoneGeo,crateZoneMat),new THREE.Mesh(grenadeRingGeo,grenadeRingMat),new THREE.LineSegments(empGeo,empMat),new THREE.Mesh(blastGeo,blastMat));
      const markerTypes={star:[zoneGeo,zoneMat,true,false],crate:[zoneGeo,crateZoneMat,true,false],grenade:[grenadeRingGeo,grenadeRingMat,true,false],blast:[blastGeo,blastMat,true,false],emp:[empGeo,empMat,false,true]};
      const markerPools=new Map(Object.entries(markerTypes).map(([kind,args])=>[kind,Array.from({length:Math.max(kind==='blast'||kind==='emp'?24:12,S[kind==='star'?'stars':'crates']?.length||0)},()=>{
        const marker=createGroundMarker(THREE,...args);marker.userData.markerPool=kind;reserve.add(marker);return marker;
      })]));
      const groundAt=world.groundAt||(()=>0);
      function takeMarker(kind){const marker=markerPools.get(kind).pop()||createGroundMarker(THREE,...markerTypes[kind]);marker.userData.markerPool=kind;marker.visible=true;marker.scale.setScalar(1);marker.rotation.set(0,0,0);scene.add(marker);return marker;}
      function returnMarker(marker){marker.visible=false;reserve.add(marker);markerPools.get(marker.userData.markerPool).push(marker);}
      sceneState = {karts,stars,crates,zaps,mines,grenades};
      world.group.traverse((mesh) => { if (mesh.isMesh) mesh.receiveShadow = true; });
      const rm = reducedMotion();
      const syncBlocks = () => world.syncMap((S && S.map) || {id:'ring',blocks:[]});
      const tmpV = new THREE.Vector3();
      let cameraEpoch = null;
      // Warm every combat variant before readiness. The hidden source library
      // alone is never rendered: first fire used to upload these buffers and
      // compile tracer/EMP/instanced-effect programs in a live driving frame.
      const warm=new THREE.Group();scene.add(warm);
      for(const pool of markerPools.values())for(const marker of pool)warm.add(marker);
      for(const k of S.karts||[]) {const bar=healthBars.add(k.pid);bar.visible=true;bar.position.y=-100;}
      for(const kind of ['pulse','scatter','mine','shield','rocket','rail','grenade','emp'])warm.add(combat.weapon(kind));
      const shotPools=new Map(),shotCues=[],shotContactInsets=new Map();
      function prepareShotContact(object,kind,radius){
        const c=object.userData.combat,key=kind+':'+radius;
        if(radius>0&&!shotContactInsets.has(key))shotContactInsets.set(key,projectileContactInset(THREE,object,radius));
        c.contactRadius=radius;c.contactInset=radius>0?shotContactInsets.get(key):0;
      }
      const cueBounds=new THREE.Box3(),cueCenter=new THREE.Vector3();
      for(const kind of ['pulse','scatter','rocket','rail','grenade']) {
        const pool=[];
        for(let i=0;i<12;i++){const object=combat.projectile(kind);prepareShotContact(object,kind,S.combat?.staticSweepRadii?.[kind]||0);object.visible=false;scene.add(object);pool.push(object);}
        shotPools.set(kind,pool);pool[0].visible=true;warm.add(pool[0]);
        const tail=pool[0].userData.combat.tail;
        if(tail)for(let i=0;i<12;i++){
          const object=new THREE.Group(),mesh=tail.clone(false);object.add(mesh);
          cueBounds.setFromObject(object);cueBounds.getCenter(cueCenter);mesh.position.sub(cueCenter);
          object.name='CombatConfirmedShot';object.visible=false;scene.add(object);
          shotCues.push({object,kind,length:cueBounds.max.z-cueBounds.min.z,until:0});
          if(i===0){object.visible=true;warm.add(object);}
        }
      }
      for(const own of [true,false]){
        const model=combat.mine(own);
        placeGroundProp(THREE,model,0,0,0,groundAt,world.propGroundAt||groundAt);
        warm.add(model);
      }
      warm.position.y=-100;warm.traverse(object=>{object.frustumCulled=false;});
      reserve.visible=true;reserve.position.y=-100;reserve.traverse(object=>{object.frustumCulled=false;});
      await renderer.compileAsync(scene,camera);renderer.render(scene,camera);
      warm.removeFromParent();reserve.visible=false;reserve.position.y=0;
      for(const pool of markerPools.values())for(const marker of pool){marker.visible=false;reserve.add(marker);}
      for(const k of S.karts||[])healthBars.add(k.pid).visible=false;
      for(const pool of shotPools.values())for(const object of pool){object.removeFromParent();object.visible=false;object.position.set(0,0,0);scene.add(object);}
      for(const cue of shotCues){cue.object.removeFromParent();cue.object.visible=false;cue.object.position.set(0,0,0);scene.add(cue.object);}
      await impactFX.warmup(renderer,camera);
      if(gen!==mountGen)throw new Error('Retired kart scene');
      let impactEpoch='',impactSince=0;
      const frame = (dt, t) => {
        if (!S) return;
        syncBlocks();
        if (world.animate) world.animate(rm ? 0 : dt,rm ? 0 : t,skyPhase());
        if (disposeLighting?.update) disposeLighting.update(world.palette);
        // Karts: shared visual poses (predicted self, eased remotes) — the
        // SAME helper the 2D fallback draws, so both renderers agree.
        const poses = framePoses(poseStore, S, intentForPrediction(), dt, nowMs(), { reducedMotion: rm, map: S.map, serverNow: serverNow() });
        const physicalSelf=physicalPrediction?.frame(S,intentForPrediction(),dt,nowMs(),serverNow());physicalLocalPose=physicalSelf;if(physicalSelf)poses.set(S.you,physicalSelf);for(const k of S.karts){if(k.pid===S.you)continue;const pose=physicalPrediction?.remote(k.pid,nowMs());if(pose)poses.set(k.pid,pose);}
        updateAudio();
        const nextImpactEpoch=`${S.instanceId}:${S.you}:${S.inputAck?.life}:${S.inputAck?.controlEpoch}:${!!S.audioBaseline}`;
        if(nextImpactEpoch!==impactEpoch){impactFX.reset();impactEpoch=nextImpactEpoch;impactSince=nowMs();}
        impactFX.update(dt);
        const acceptedEffects=feedback.current(nowMs());
        for(const cue of shotCues)if(cue.until<=nowMs())cue.object.visible=false;
        for(const e of acceptedEffects){if(effectSeen.has(e.id))continue;effectSeen.add(e.id);
          if(e.at>=impactSince&&e.position)impactFX.emit(e);
          if(e.kind==='fire')combat.recoil(karts.get(e.pid)?.userData.rig);
          if((e.kind==='fire'||e.kind==='impact')&&e.position){
            let cue=null;
            for(const candidate of shotCues)if(candidate.kind===e.weapon&&(!cue||!candidate.object.visible||candidate.until<cue.until)){cue=candidate;if(!candidate.object.visible)break;}
            if(cue){
              const from=e.from||e.position;
              shotDirection.set(e.position.x-from.x,e.position.y-from.y,e.position.z-from.z);
              let length=shotDirection.length();
              if(length<1e-6&&e.direction){shotDirection.set(e.direction.x,e.direction.y,e.direction.z);length=.8;}
              if(shotDirection.lengthSq()>1e-8){
                shotDirection.normalize();cue.object.position.set(from.x,from.y,from.z).addScaledVector(shotDirection,length*.5);
                cue.object.quaternion.setFromUnitVectors(shotForward,shotDirection);
                cue.object.scale.set(1.6,1.6,length/Math.max(.01,cue.length));cue.until=e.until;cue.object.visible=true;
              }
            }
          }
          if(e.kind==='ko'||(e.kind==='blast'&&!e.position)){
            if(!rm){if(popSites.length>=8)popSites.shift();popSites.push({x:e.position?.x??e.x,y:e.position?.y??((world.groundAt?.(e.x,e.z)||0)+.6),z:e.position?.z??e.z,t,kind:e.kind});}
            if(e.kind==='ko'&&e.inferred&&e.pid===S.you&&e.weapon!=='grenade')audio?.cue('ko');
          }
          if((e.kind==='collision'||e.kind==='landing')&&e.pid===S.you)
            audio?.cue(e.kind,{strength:Math.min(1,(e.impulse||100)/1000)});
          if(e.kind==='emp'||(e.kind==='blast'&&!e.position)||e.kind==='ko'){
            const mesh=takeMarker(e.kind==='emp'?'emp':'blast');
            if(e.kind==='emp')mesh.rotation.y=e.angle;
            placeGroundMarker(mesh,e.x,e.z,groundAt);
            scene.add(mesh);combatEffects.set(e.id,{mesh,until:e.kind==='ko'?e.at+500:e.until,at:e.at,kind:e.kind});
          }
        }
        while(effectSeen.size>48)effectSeen.delete(effectSeen.values().next().value);
        for(const [id,e]of combatEffects){if(nowMs()>=e.until){returnMarker(e.mesh);combatEffects.delete(id);}else if(e.kind!=='emp'&&!rm){const progress=(nowMs()-e.at)/(e.until-e.at);e.mesh.scale.setScalar(.2+progress*.8);placeGroundMarker(e.mesh,e.mesh.position.x,e.mesh.position.z,groundAt);}}
        const live = new Set();
        let sparkCount = 0;
        for (const k of S.karts || []) {
          live.add(k.pid);
          const pose = poses.get(k.pid) || { x: k.x, z: k.z, angle: k.angle };
          let mesh = karts.get(k.pid);
          if (!mesh) {
            mesh = buildKartMesh(THREE, colorFor(k.pid), k.pid, assets);
            scene.add(mesh);
            karts.set(k.pid, mesh);
            mesh.userData.wasRespawning = k.respawn > 0;
          }
          // A newly accepted KO keeps a short wreck silhouette visible
          // before the respawn pause. Historical/dead joins stay quiet.
          const wreck=acceptedEffects.find(e=>e.kind==='ko'&&e.pid===k.pid);
          const wreckAge=wreck?Math.max(0,(nowMs()-wreck.at)/1000):1;
          // A driver who dropped out leaves the arena entirely.
          mesh.visible=!k.out&&(!(k.respawn>0)||!!wreck&&wreckAge<.8);
          const wreckGround=wreck?.position?wreck.position.y+physicsConfig.chassis.modelOriginY-.35:(world.groundAt?.(pose.x,pose.z)||0);
          mesh.position.set(pose.x,k.respawn>0&&wreck&&!rm?wreckGround+Math.sin(Math.min(1,wreckAge/.8)*Math.PI)*1.4:0,pose.z);
          mesh.rotation.x=k.respawn>0&&wreck&&!rm?wreckAge*2.5:0;
          mesh.rotation.z=k.respawn>0&&wreck&&!rm?wreckAge*1.5:0;
          mesh.scale.setScalar(k.respawn>0&&wreck&&!rm?Math.max(.15,1-wreckAge/.9):1);
          /* Mesh yaw EQUALS the pose angle: the nose faces +z at yaw 0, and a
           * Three.js Y-rotation maps +z to (sin a, cos a) — exactly the
           * shared forwardOf(angle) the server integrates. Visual forward
           * always matches motion by construction. */
          const inner=mesh.userData.kart?.inner;
          if(k.physicalPose&&!(k.respawn>0)){
            const physical=pose.physicalPose||k.physicalPose;
            mesh.position.set(physical.position.x,physical.position.y,physical.position.z);
            if(inner)inner.position.y=physicsConfig.chassis.modelOriginY;
            mesh.quaternion.set(physical.rotation.x,physical.rotation.y,physical.rotation.z,physical.rotation.w);
          }else{if(inner)inner.position.y=0;mesh.rotation.y=pose.angle;}
          healthBars.update(k.pid,k,mesh.position,(S.players||S.participants||[]).find(p=>p.id===k.pid)?.connected!==false);
          const equipped=k.ammo>0?k.weapon:null;
          if(mesh.userData.equipped!==equipped) {
            if(mesh.userData.rig)mesh.userData.rig.removeFromParent();
            mesh.userData.rig=equipped?combat.weapon(equipped):null;
            mesh.userData.equipped=equipped;
            if(mesh.userData.rig) {const rig=mesh.userData.rig;combat.placeWeapon(rig);(mesh.userData.kart?.inner||mesh).add(rig);}
          }
          if(mesh.userData.rig)combat.animate(mesh.userData.rig,dt,t,rm);
          if (mesh.userData.giggleKart) animateKartModel(mesh, {physicalPose: k.respawn>0 ? null : pose.physicalPose || k.physicalPose,
            speed:pose.speed ?? k.speed ?? 0, steer:k.pid === S.you ? intentFromState().steer : 0,
            boost:Math.max(k.boost || 0,k.turbo || 0,k.nitroActive===true?1:0),shield:k.shield>0&&!(k.ramT>0),invincible:k.ramT>0,dt,reducedMotion:rm});
          if (mesh.userData.flame) mesh.userData.flame.visible = k.boost > 0 || k.turbo > 0 || k.nitroActive === true;
          if (mesh.userData.shield) mesh.userData.shield.visible = (k.shield || 0) > 0;
          if (mesh.visible && !rm && S.phase === 'drive' && k.drifting) {
            const f = forwardOf(pose.angle);
            for (let i=0; i<6 && sparkCount<48; i++) {
              const age=(t*3+i/6)%1, side=i%2 ? 0.92 : -0.92;
              const x=pose.x-f.x*(1.2+age*2)+f.z*side,z=pose.z-f.z*(1.2+age*2)-f.x*side;
              sparkMatrix.makeTranslation(x,(world.groundAt?.(x,z)||0)+.12+Math.sin(age*Math.PI)*.4,z);
              driftSparks.setMatrixAt(sparkCount++,sparkMatrix);
            }
          }
        }
        let popCount=0;
        for (let i=popSites.length-1;i>=0;i--) if (t-popSites[i].t> .65) popSites.splice(i,1);
        for (const site of popSites) {
          const age=Math.max(0,t-site.t);
          const reach=site.kind==='impact'?1.8:site.kind==='collision'?2.2:6;
          for (let i=0;i<8;i++) {
            const angle=i*Math.PI/4;
            sparkMatrix.makeScale(1-age,1-age,1-age);
            sparkMatrix.setPosition(site.x+Math.sin(angle)*age*reach,site.y+Math.sin(age*Math.PI/.65)*(site.kind==='impact'?.5:1.7),site.z+Math.cos(angle)*age*reach);
            pops.setMatrixAt(popCount++,sparkMatrix);
          }
        }
        pops.count=popCount; if(popCount) pops.instanceMatrix.needsUpdate=true;
        driftSparks.count = sparkCount;
        if (sparkCount) driftSparks.instanceMatrix.needsUpdate = true;
        for (const [pid, mesh] of karts) {
          if (!live.has(pid)) {
            scene.remove(mesh);
            karts.delete(pid);
            healthBars.remove(pid);
          }
        }
        // Stars: sync set, spin unless reduced motion.
        const liveS = new Set();
        for (const s of S.stars || []) {
          liveS.add(s.id);
          let group = stars.get(s.id);
          if (!group) {
            group = new THREE.Group();
            const gem = createStarModel(THREE, assets);
            gem.position.y = 1.5;
            group.add(gem);
            const zone = takeMarker('star');
            placeGroundMarker(zone,s.x,s.z,groundAt);
            scene.add(zone);group.userData.zone=zone;
            group.position.set(s.x, s.groundY??world.groundAt?.(s.x,s.z)??0, s.z);
            group.userData.gem = gem;
            scene.add(group);
            stars.set(s.id, group);
          }
          if (!rm) {
            group.userData.gem.rotation.y += dt * 1.3;
            group.userData.gem.position.y = 1.5 + Math.sin(t*2.2 + s.id.length)*0.14;
          }
        }
        for (const [sid, mesh] of stars) {
          if (!liveS.has(sid)) {
            returnMarker(mesh.userData.zone);
            scene.remove(mesh);
            stars.delete(sid);
          }
        }
        // Crates: sync set, static boxes with the honest pickup ring.
        const liveC = new Set();
        for (const c of S.crates || []) {
          liveC.add(c.id);
          if (!crates.get(c.id)) {
            const group = new THREE.Group();
            const box = combat.pickup();
            group.userData.capsule = box;
            group.add(box);
            const zone = takeMarker('crate');
            placeGroundMarker(zone,c.x,c.z,groundAt);
            scene.add(zone);group.userData.zone=zone;
            group.position.set(c.x, c.groundY??world.groundAt?.(c.x,c.z)??0, c.z);
            scene.add(group);
            crates.set(c.id, group);
          }
          combat.animate(crates.get(c.id).userData.capsule,dt,t,rm);
        }
        for (const [cid, mesh] of crates) {
          if (!liveC.has(cid)) {
            returnMarker(mesh.userData.zone);
            scene.remove(mesh);
            crates.delete(cid);
          }
        }
        // Authoritative velocity at the calibrated clock. No chasing packet
        // positions: easing fast shots made them visibly slow and jerky.
        const liveZ = new Set();
        for (const z of S.zaps || []) {
          liveZ.add(z.id);
          let mesh = zaps.get(z.id);
          if (!mesh) {
            mesh = shotPools.get(z.kind)?.pop()||combat.projectile(z.kind);
            mesh.position.set(z.x, 0.7, z.z);
            scene.add(mesh);
            zaps.set(z.id, mesh);
          }
          const flight=projectilePose(z,S,serverNow());
          mesh.position.set(flight.x,flight.y,flight.z);
          if(flight.direction){shotDirection.set(flight.direction.x,flight.direction.y,flight.direction.z).normalize();mesh.quaternion.setFromUnitVectors(shotForward,shotDirection);}
          else mesh.rotation.y=flight.angle;
          if(z.physical===true){
            const radius=Number.isFinite(z.radius)&&z.radius>0?z.radius:0;
            if(mesh.userData.combat.contactRadius!==radius)prepareShotContact(mesh,z.kind,radius);
            const c=mesh.userData.combat;
            mesh.position.addScaledVector(tmpV.copy(shotForward).applyQuaternion(mesh.quaternion),radius-(c.tipZ||0)-c.contactInset);
          }
          mesh.visible=flight.visible;combat.animate(mesh,dt,t,rm);
        }
        for (const [zid, mesh] of zaps) {
          if (!liveZ.has(zid)) {
            mesh.visible=false;
            const pool=shotPools.get(mesh.userData.combat?.kind);if(pool)pool.push(mesh);else scene.remove(mesh);
            zaps.delete(zid);
          }
        }
        const liveG=new Set();
        for(const g of S.grenades||[]){liveG.add(g.id);let group=grenades.get(g.id);
          if(!group){group=new THREE.Group();const body=combat.projectile('grenade');group.add(body);group.userData.body=body;
            const ring=takeMarker('grenade');group.userData.ring=ring;scene.add(group);grenades.set(g.id,group);}
          const flight=grenadePose(g,S,serverNow());group.position.set(flight.x,flight.y+(g.physical ? .45 : .38),flight.z);group.rotation.y=flight.angle;group.visible=flight.visible;
          combat.animate(group.userData.body,dt,t,rm);placeGroundMarker(group.userData.ring,flight.x,flight.z,groundAt);group.userData.ring.visible=flight.visible&&g.warning===true;
        }
        for(const[id,group]of grenades)if(!liveG.has(id)){returnMarker(group.userData.ring);scene.remove(group);grenades.delete(id);}
        const liveM = new Set();
        for (const m of S.mines || []) {
          liveM.add(m.id);
          let mesh = mines.get(m.id);
          if (!mesh) {
            mesh = new THREE.Group();
            const puck = combat.mine(m.owner===S.you); mesh.userData.prop=puck;mesh.add(puck);
            mesh.position.set(m.x,m.y??world.groundAt?.(m.x,m.z)??0,m.z); scene.add(mesh); mines.set(m.id,mesh);
          }
          mesh.userData.prop.userData.combat.armed=m.armed;
          placeGroundProp(THREE,mesh,m.x,m.y??groundAt(m.x,m.z),m.z,groundAt,world.propGroundAt||groundAt);
          combat.animate(mesh.userData.prop,dt,t,rm);
        }
        for (const [id,mesh] of mines) if (!liveM.has(id)) { scene.remove(mesh); mines.delete(id); }
        // Camera: a steeper follow view keeps several pickups plus useful
        // arena in frame; spectators get a tighter overview (no half-empty
        // horizon). Built from the shared forwardOf — the camera sits
        // directly behind the motion direction, never fighting the input.
        const me = myKart();
        const selfPose = me ? poses.get(me.pid) : null;
        if (me && S.youDrive && selfPose) {
          const pose = selfPose;
          const f = forwardOf(pose.angle);
          const portrait = camera.aspect < 0.8;
          const back = portrait ? 10 : 8.8;
          const up = portrait ? 4.2 : 3.2;
          const chassisY=pose.physicalPose?.position.y??me.physicalPose?.position.y??((world.groundAt?.(pose.x,pose.z)||0)+.75);
          const cameraX=pose.x-f.x*back,cameraZ=pose.z-f.z*back;
          tmpV.set(cameraX,Math.max(chassisY+up-.75,(world.groundAt?.(cameraX,cameraZ)||0)+1.2),cameraZ);
          if (rm || cameraEpoch !== me.spawnSeq) camera.position.copy(tmpV);
          else camera.position.lerp(tmpV, 1-Math.exp(-dt*12));
          cameraEpoch = me.spawnSeq;
          const lookX=pose.x+f.x*5,lookZ=pose.z+f.z*5;
          camera.lookAt(lookX,Math.max(chassisY+.85,(world.groundAt?.(lookX,lookZ)||0)+.8),lookZ);
        } else {
          const half = S.map?.half || 30;
          tmpV.set(0, half*1.4, half*.9);
          if (rm) camera.position.copy(tmpV);
          else camera.position.lerp(tmpV, Math.min(1, dt * 2));
          camera.lookAt(0, 0, 0);
        }
        healthBars.face(camera);
        if (typeof hooks.sceneExtra === 'function') {
          try { hooks.sceneExtra(THREE, { scene, camera, poses, S, dt }); } catch { /* game-owned extra must not break frames */ }
        }
      };
      return { scene, camera, frame, dispose: () => {disposeLighting?.();disposeCombat?.();healthBars.dispose();impactFX.dispose();} };
    } catch (error) {
      if (disposeLighting) disposeLighting();
      if (disposeCombat) disposeCombat();
      healthBars?.dispose();
      impactFX?.dispose();
      helper.disposeObject(scene);
      throw error;
    }
  }

/* ---------------- 2D fallback (same snapshots, top-down) ---------------- */

  function startFallback(note) {
    stopFallback(); // drop any previous fallback loop/listeners first
    disposeGl();
    const stage = rootEl && rootEl.querySelector('.pk-stage');
    if (!stage) return;
    stage.innerHTML = '';
    fbCanvas = document.createElement('canvas');
    fbCanvas.className = 'pk-fb';
    fbCanvas.setAttribute('role', 'img');
    fbCanvas.setAttribute('aria-label', `${title} top-down view.`);
    stage.appendChild(fbCanvas);
    const note2 = document.createElement('div');
    note2.className = 'muted small pk-fbnote';
    note2.textContent = note;
    stage.appendChild(note2);
    const myGen = mountGen;
    const loop = () => {
      if (!fbCanvas || myGen !== mountGen) return;
      drawFallback();
      fbRaf = requestAnimationFrame(loop);
    };
    const fit = () => {
      if (!fbCanvas || !stage) return;
      const w = Math.max(1, stage.clientWidth || 320);
      const h = Math.max(1, stage.clientHeight || 300);
      const res = Math.min(1,900/w,700/h);
      fbCanvas.width = Math.round(w*res);
      fbCanvas.height = Math.round(h*res);
    };
    fit();
    if (typeof ResizeObserver !== 'undefined') { fbObserver = new ResizeObserver(fit); fbObserver.observe(stage); }
    // Tracked separately: stopFallback removes it so retry 3D ↔ 2D cycles
    // never stack window listeners.
    if (typeof window !== 'undefined' && window.addEventListener) {
      window.addEventListener('resize', fit);
      fbBound.push([window, 'resize', fit]);
    }
    fbRaf = requestAnimationFrame(loop);
  }

  function stopFallback() {
    if (fbObserver) { fbObserver.disconnect(); fbObserver=null; }
    if (fbRaf) { cancelAnimationFrame(fbRaf); fbRaf = 0; }
    for (const [t, type, fn] of fbBound) {
      try { t.removeEventListener(type, fn); } catch { /* noop */ }
    }
    fbBound = [];
    if (fbCanvas) { try { fbCanvas.remove(); } catch { /* noop */ } fbCanvas = null; }
  }

  function drawFallback() {
    if (!fbCanvas || !S) return;
    const ctx = fbCanvas.getContext('2d');
    if (!ctx) return;
    // SAME shared poses as WebGL (predicted self, eased remotes) — one
    // behavior in both renderers, not a separate snapshotted drawing.
    const now = nowMs();
    const dt = fbLastT ? (now - fbLastT) / 1000 : 0.016;
    fbLastT = now;
    const poses = framePoses(poseStore, S, intentForPrediction(), dt, now, { reducedMotion: reducedMotion(), map: S.map, serverNow: serverNow() });
    const physicalSelf=physicalPrediction?.frame(S,intentForPrediction(),dt,now,serverNow());physicalLocalPose=physicalSelf;if(physicalSelf)poses.set(S.you,physicalSelf);for(const k of S.karts){if(k.pid===S.you)continue;const pose=physicalPrediction?.remote(k.pid,nowMs());if(pose)poses.set(k.pid,pose);}
    updateAudio();
    const poseOf = (k) => poses.get(k.pid) || { x: k.x, z: k.z, angle: k.angle };
    const W = fbCanvas.width;
    const H = fbCanvas.height;
    const basePal = paletteFor(S.palette);
    const theme = S.map && S.map.theme;
    const pal = theme === 'frost' ? {...basePal, floor:0xb8d4df, track:0x8bb5cc, wall:0x466c92}
      : theme === 'neon' ? {...basePal, floor:0x182c43, track:0x293852, wall:0xa1528e}
      : theme === 'garden' ? {...basePal, floor:0x79c47f, track:0x5f6f82, wall:0x3a8b63} : basePal;
    const css = (n) => '#' + n.toString(16).padStart(6, '0');
    const phase = skyPhase();
    const startName = LEGACY_PALETTES[S.palette] || S.palette || 'Daybreak';
    const dusk = phase !== null && startName !== 'Starlight';
    const from = startName === 'Sunset' || (phase !== null && phase >= .6) ? PALETTES.Sunset : PALETTES.Daybreak;
    const to = startName === 'Sunset' || (phase !== null && phase >= .6) ? PALETTES.Starlight : PALETTES.Sunset;
    const blend = startName === 'Sunset' ? phase : phase < .6 ? phase/.6 : (phase-.6)/.4;
    const mix = (a,b,t) => { let c=0; for (const shift of [16,8,0]) c |= Math.round(((a>>shift)&255)*(1-t)+((b>>shift)&255)*t)<<shift; return c; };
    ctx.fillStyle = css(dusk ? mix(from.bg,to.bg,Math.max(0,Math.min(1,blend))) : pal.bg);
    ctx.fillRect(0, 0, W, H);
    const arena = S.map?.half || 30;
    const scale = Math.min(W, H) / (arena * 2 + 6);
    const px = (x) => W / 2 + x * scale;
    const pz = (z) => H / 2 + z * scale;
    ctx.fillStyle = css(pal.floor);
    ctx.fillRect(px(-arena), pz(-arena), arena * 2 * scale, arena * 2 * scale);
    // Exact playable boundary; painted patches carry gameplay surface grip.
    ctx.fillStyle = css(pal.track);
    ctx.fillRect(px(-arena), pz(-arena), arena * 2 * scale, arena * 2 * scale);
    for (const patch of (S.map?.surfaces || [])) {
      ctx.fillStyle = '#b8f2ff';
      ctx.fillRect(px(patch.x-patch.hw), pz(patch.z-patch.hd), patch.hw*2*scale, patch.hd*2*scale);
      ctx.strokeStyle = '#e8fcff'; ctx.lineWidth = 2;
      ctx.strokeRect(px(patch.x-patch.hw), pz(patch.z-patch.hd), patch.hw*2*scale, patch.hd*2*scale);
    }
    for (const pad of (S.map?.pads || [])) {
      ctx.fillStyle = '#61e9bf';
      ctx.fillRect(px(pad.x-pad.hw), pz(pad.z-pad.hd), pad.hw*2*scale, pad.hd*2*scale);
      ctx.strokeStyle = '#fff4a6'; ctx.lineWidth = 2;
      for (const offset of [-0.55,0,0.55]) {
        const z = pad.z + offset*pad.hd;
        ctx.beginPath(); ctx.moveTo(px(pad.x-pad.hw*0.6),pz(z+pad.hd*0.2));
        ctx.lineTo(px(pad.x),pz(z-pad.hd*0.2)); ctx.lineTo(px(pad.x+pad.hw*0.6),pz(z+pad.hd*0.2)); ctx.stroke();
      }
    }
    ctx.strokeStyle = css(pal.line);
    ctx.lineWidth = 2;
    ctx.strokeRect(px(-arena), pz(-arena), arena * 2 * scale, arena * 2 * scale);
    // Obstacle blocks, straight from the snapshot map (single-sourced).
    ctx.fillStyle = css(pal.wall);
    for (const b of ((S.map && S.map.blocks) || [])) {
      ctx.fillRect(px(b.x - b.hw), pz(b.z - b.hd), b.hw * 2 * scale, b.hd * 2 * scale);
      ctx.strokeStyle = css(pal.line);
      ctx.lineWidth = 2;
      ctx.strokeRect(px(b.x - b.hw), pz(b.z - b.hd), b.hw * 2 * scale, b.hd * 2 * scale);
    }
    for (const s of S.stars || []) {
      ctx.fillStyle = '#ffd54a';
      ctx.beginPath();
      ctx.arc(px(s.x), pz(s.z), Math.max(3, 0.9 * scale), 0, Math.PI * 2);
      ctx.fill();
      // Honest pickup ring (2.4 units, like the 3D zone ring and crates).
      ctx.strokeStyle = '#ffd54a';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(px(s.x), pz(s.z), Math.max(4, 2.4 * scale), 0, Math.PI * 2);
      ctx.stroke();
    }
    for (const c of S.crates || []) {
      ctx.fillStyle = '#80ffe0';
      const size=Math.max(6,1.8*scale);ctx.fillRect(px(c.x)-size/2,pz(c.z)-size/2,size,size);
      ctx.fillStyle='#172639';ctx.font=`bold ${Math.max(8,1.2*scale)}px sans-serif`;ctx.textAlign='center';ctx.fillText('?',px(c.x),pz(c.z)+Math.max(3,.5*scale));
      ctx.strokeStyle = '#7fd4ff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(px(c.x), pz(c.z), Math.max(4, 2.4 * scale), 0, Math.PI * 2);
      ctx.stroke();
    }
    for (const z of S.zaps || []) {
      const p=projectilePose(z,S,serverNow());if(!p.visible)continue;
      ctx.strokeStyle=z.kind==='scatter'?'#ffad69':z.kind==='rocket'?'#ffda58':z.kind==='rail'?'#b5afff':'#6af0ff';ctx.lineWidth=Math.max(2,.35*scale);
      ctx.beginPath();ctx.moveTo(px(p.x),pz(p.z));ctx.lineTo(px(p.x-Math.sin(p.angle)*2),pz(p.z-Math.cos(p.angle)*2));ctx.stroke();
    }
    for (const m of S.mines || []) {
      ctx.fillStyle = m.armed ? '#ff83b8' : '#91627a'; ctx.beginPath();
      ctx.arc(px(m.x),pz(m.z),Math.max(3,.9*scale),0,Math.PI*2); ctx.fill();
      ctx.fillStyle=m.armed&&Math.sin(now/150)>0?'#ffeaa0':'#402835';ctx.fillRect(px(m.x)-1,pz(m.z)-1,2,2);
    }
    for(const g of S.grenades||[]){const p=grenadePose(g,S,serverNow());if(!p.visible)continue;
      if(g.warning){ctx.strokeStyle='#e65832';ctx.lineWidth=2;ctx.beginPath();ctx.arc(px(p.x),pz(p.z),4*scale,0,Math.PI*2);ctx.stroke();}
      ctx.fillStyle='#ffd458';ctx.fillRect(px(p.x)-.4*scale,pz(p.z)-.6*scale-p.y*scale,.8*scale,1.2*scale);
      ctx.strokeStyle='#25354b';ctx.lineWidth=1;ctx.strokeRect(px(p.x)-.4*scale,pz(p.z)-.6*scale-p.y*scale,.8*scale,1.2*scale);
    }
    const acceptedEffects=feedback.current(now);
    for(const e of acceptedEffects){const age=Math.max(0,(now-e.at)/1000);ctx.strokeStyle=e.kind==='emp'?'#2585ff':e.kind==='collision'?'#ffe3a1':'#ff963d';ctx.lineWidth=2;
      ctx.beginPath();if(e.kind==='emp'){ctx.moveTo(px(e.x),pz(e.z));ctx.arc(px(e.x),pz(e.z),12*scale,Math.PI/2-e.angle-.55,Math.PI/2-e.angle+.55);ctx.closePath();}else ctx.arc(px(e.x),pz(e.z),Math.max(1,(e.kind==='blast'?4:1+age*5))*scale,0,Math.PI*2);ctx.stroke();
    }
    for (const k of S.karts || []) {
      const wreck=acceptedEffects.find(e=>e.kind==='ko'&&e.pid===k.pid);
      const age=wreck?(now-wreck.at)/1000:1;
      if (k.respawn > 0 && (!wreck||age>=.8)) continue;
      const pose = poseOf(k);
      ctx.save();
      ctx.translate(px(pose.x), pz(pose.z));
      if(k.respawn>0&&!reducedMotion()){const s=Math.max(.15,1-age/.9);ctx.scale(s,s);ctx.rotate(age*3);}
      /* Shared nose mapping: forward (sin a, cos a) with +x right, +z
       * down — canvasNoseRotation is the single source, tested. */
      ctx.rotate(canvasNoseRotation(pose.angle));
      ctx.fillStyle = css(colorFor(k.pid));
      ctx.fillRect(-0.85 * scale, -1.25 * scale, 1.7 * scale, 2.5 * scale);
      ctx.fillStyle = '#14101f';
      ctx.fillRect(-0.45 * scale, -1.9 * scale, 0.9 * scale, 0.7 * scale);
      ctx.restore();
      if ((k.shield || 0) > 0) {
        ctx.strokeStyle = '#7fd4ff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(px(pose.x), pz(pose.z), 2.1 * scale, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (k.pid === S.you) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(px(pose.x), pz(pose.z), 1.9 * scale, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }

  return { ownsTimer: true, styles: ['/css/kart-arena.css'], mount, update, dispose,
    async ready() {
      await sceneReady;
      await physicalReady;
      if (gl) await gl.firstFrame;
      else if (!fbCanvas?.getContext('2d')) throw new Error('No usable kart renderer');
    } };

  /* ---------------- lifecycle ---------------- */

  function disposeGl() {
    if (gl) {
      try { gl.dispose(); } catch { /* noop */ }
      gl = null;
    }
    sceneState = null;
    resetPoseStore(poseStore);
  }

  function disposeAll() {
    physicalPrediction?.dispose();physicalPrediction=null;physicalReady=null;physicalSeq=0;physicalLocalPose=null;
    mountGen += 1;
    // Tell the server zero BEFORE api/S are nulled when currently active.
    // Silent stick reset first (no onChange during teardown), then one zero
    // packet on the live api, then release everything. No stale callbacks
    // after dispose/remount: the stick is disposed and nulled here.
    const wasActive = isInputActive();
    const liveApi = apiRef;
    const liveS = S;
    clearDriveInput();
    try {
      stick?.dispose();
    } catch { /* noop */ }
    stick = null;
    stickValue = { x: 0, y: 0 };
    suppressStickSend = false;
    if (wasActive && liveApi && liveS?.youDrive &&
        (liveS.phase === 'drive' || liveS.phase === 'countdown')) {
      try {
        liveApi.send({ input: { steer: 0, throttle: 0, boost: false, drift: false, nitro: false } }, { silent: true });
      } catch { /* teardown still completes */ }
    }
    if (sendTimer) { clearInterval(sendTimer); sendTimer = 0; }
    stopFallback();
    audio?.dispose();audio=null;wasTurbo=false;
    garagePending=null;arenaPending=null;arenaNotice='';
    for (const [t, type, fn, opts] of bound) {
      try { t.removeEventListener(type, fn, opts); } catch { /* noop */ }
    }
    bound = [];
    disposeGl();
    S = null;
    feedback.reset();
    apiRef = null;
    rootEl = null;
    keys = new Set();
    touch = { gas: false, brake: false, drift: false, nitro: false };
    autoGas = false;
    fireHeld = false;
    pulseHoldLife=null;
    clearHolds.clear();
    boostEdge = false;
    predictBoost = false;
    fbLastT = 0;
    lastInputSentAt = 0;
    lastSent = '';
    lastPhase = '';
    lastCount = -1;
    lastStandKey = '';
    lastResultKey = '';
    lastFireKey = '';
    seenEvents = new Set(); firstEvents = true; cueUntil = 0; cueText = ''; keycapUntil=0;
    sceneState = null;
    resetPoseStore(poseStore);
  }

  function mount(el, api) {
    disposeAll();
    mountGen += 1;
    ensureKartCss();
    apiRef = api;
    rootEl = el;
    audio=createKartAudio({muted:api.context?.().sound===false});
    on(window,'pointerdown',()=>audio?.unlock(),{capture:true});
    on(window,'keydown',()=>audio?.unlock(),{capture:true});
    el.innerHTML = `
      <div class="pk" tabindex="0" data-game-focus aria-label="Kart driving arena">
        <div class="pk-stage" aria-hidden="false"></div>
        <div class="pk-hud"></div>
        <div class="pk-touch" id="pk-touch">
          <div class="pk-stick" id="pk-stick" role="group" tabindex="0" aria-label="Drive stick: push up for gas, down for brake, left and right to steer. Keyboard: arrows or WASD.">
            <span class="pk-stick-marks" aria-hidden="true"></span>
            <span class="pk-stick-thumb" aria-hidden="true"></span>
          </div>
          <div class="pk-tright">
            <button type="button" class="pk-tbtn pk-driftbtn" id="pk-th" aria-label="Hold to drift"><span class="pk-drift-art">${DRIFT_ART}</span></button>
            <button type="button" class="pk-tbtn" id="pk-td" aria-label="Brake and reverse">▼</button>
            <button type="button" class="pk-tbtn pk-gas" id="pk-tg" aria-label="Throttle">▲</button>
            <button type="button" class="pk-tbtn pk-nitrobtn" id="pk-tn" aria-label="Hold for nitro boost">${NITRO_RING}<span class="pk-nitro-art">${NITRO_GLYPH}</span></button>
            <button type="button" class="pk-tbtn pk-boostbtn" id="pk-tb" aria-label="Boost"><span class="pk-fire-art">${CROSSHAIR_ART}</span><span class="pk-fire-ammo" hidden></span></button>
          </div>
        </div>
      </div>`;
    buildHud();
    try { const pref=localStorage.getItem('pk-controls-v1'); controlsPreference=['auto','keyboard','touch'].includes(pref)?pref:'auto'; } catch { controlsPreference='auto'; }
    paintControls();
    on(rootEl.querySelector('#pk-resume'),'click',()=>{const help=rootEl.querySelector('#pk-help');if(help)help.open=false;rootEl.querySelector('.pk')?.focus?.({preventScroll:true});});
    on(rootEl.querySelector('#pk-help'),'toggle',event=>{if(event.target?.open===true)atomicStop();if(event.target?.open===false)rootEl.querySelector('.pk')?.focus?.({preventScroll:true});});
    on(rootEl.querySelector('#pk-controls'),'change',event=>{
      const pref=event.target?.value;
      if(!['auto','keyboard','touch'].includes(pref))return;
      clearDriveInput();sendInput(true);controlsPreference=pref;
      try { localStorage.setItem('pk-controls-v1',pref); } catch { /* private storage still works for this match */ }
      paintControls();
    });
    for(const query of ['(pointer: coarse)','(pointer: fine)','(hover: hover)','(any-pointer: coarse)']) {
      try { const media=window.matchMedia?.(query);if(media?.addEventListener)on(media,'change',()=>{clearDriveInput();sendInput(true);paintControls();}); } catch { /* Auto safely stays on current capability */ }
    }
    on(document,'game-screenchange',paintControls);
    on(rootEl.querySelector('#pk-result'),'click',resultClick);
    on(rootEl.querySelector('#pk-auto'),'click',() => {
      const help=rootEl.querySelector('#pk-help');if(help)help.open=false;
      if (!canDriveControls()) return;
      autoGas = !autoGas;
      paintAutoGas();
      sendInput(false);
    });

    on(window, 'keydown', (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey || guardTarget(e)) return;
      // Drive keys bind ONLY while this player is actively racing: watchers,
      // results, and lobby screens keep normal scrolling and Space never
      // hijacks a focused button, link, or call control. An open room drawer
      // owns the keyboard too (it already stopped the kart on toggle).
      if (!canDriveControls()) return;
      if (e.code === 'Space') {
        e.preventDefault();
        if (!e.repeat && !keys.has('action')) {
          keys.add('action');
          latchPulseHold();
          boostEdge = true;
          predictBoost = true; // instant local pop; snapshot confirms
          sendInput(false);
        }
        return;
      }
      const k = keyName(e);
      if (!k) return;
      e.preventDefault();
      // A held physical key can continue repeating after a global stop.
      // Only a deliberate new press may add it back to the intent set.
      if (e.repeat) return;
      if (!keys.has(k)) {
        keys.add(k);
        sendInput(false);
      }
    });
    on(window, 'keyup', (e) => {
      if (e.code === 'Space') {
        if (keys.delete('action')) {if(!fireHeld)pulseHoldLife=null;sendInput(false);}
        return;
      }
      const k = keyName(e);
      if (!k) return;
      if (k === 'drift' && e.shiftKey) return;
      if (keys.delete(k)) sendInput(false);
    });
    // Atomic stop: blur, hidden tab, rotation, landscape-helper screen
    // change, or an opening room drawer drops stick + digital identities,
    // visual-held state, captured pointers and Auto gas, then sends ONE
    // final zero packet (no intermediate steer/zero while clearing pieces).
    // Registered BEFORE the stick is created so the host silent clear runs
    // before the stick's own global-stop emit (making it a no-op).
    on(window, 'blur', () => atomicStop());
    on(document, 'visibilitychange', () => {
      if (document.hidden) atomicStop();
    });
    on(window, 'orientationchange', () => atomicStop());
    on(document, 'game-screenchange', () => atomicStop());
    try {
      const orient = (typeof screen !== 'undefined' && screen.orientation) ||
        (window && window.screen && window.screen.orientation);
      if (orient && typeof orient.addEventListener === 'function') on(orient, 'change', () => atomicStop());
    } catch { /* orientation API unavailable */ }
    on(document, 'toggle', (e) => {
      if (e.target?.matches?.('.room-menu') && e.target.open) atomicStop();
    }, { capture: true });

    // Touch controls: pointer capture + explicit release/cancel handling.
    const wireHold = (id, field) => {
      const b = el.querySelector('#' + id);
      if (!b) return;
      const pointers = new Set();
      const controlKeys = new Set();
      const paintHeld = () => {
        const held = pointers.size > 0 || controlKeys.size > 0;
        const changed = touch[field] !== held;
        touch[field] = held;
        b.classList.toggle('pk-held', held);
        b.setAttribute('aria-pressed', String(held));
        return changed;
      };
      clearHolds.add(() => {
        const captured = [...pointers];
        pointers.clear(); controlKeys.clear(); paintHeld();
        for (const id of captured) {
          try { if (b.hasPointerCapture(id)) b.releasePointerCapture(id); } catch { /* already lost */ }
        }
      });
      on(b, 'pointerdown', (e) => {
        if (!canDriveControls() || pointers.has(e.pointerId) ||
            (e.pointerType === 'mouse' && e.button !== 0)) return;
        e.preventDefault();
        pointers.add(e.pointerId);
        try { b.setPointerCapture(e.pointerId); } catch { /* noop */ }
        if (paintHeld()) sendInput(false);
      });
      const release = (e) => {
        if (!e || !pointers.delete(e.pointerId)) return;
        if (paintHeld()) sendInput(false);
        try {
          if (e && e.pointerId !== undefined && b.hasPointerCapture(e.pointerId)) {
            b.releasePointerCapture(e.pointerId);
          }
        } catch { /* noop */ }
      };
      on(b, 'pointerup', release);
      on(b, 'pointercancel', release);
      // No-capture fallback: if setPointerCapture threw, a slide-off would
      // otherwise stick the intent until blur. Suppressed while captured.
      on(b, 'pointerleave', e => {
        try { if (b.hasPointerCapture(e.pointerId)) return; } catch { /* capture unavailable */ }
        release(e);
      });
      on(b, 'lostpointercapture', release);
      on(window, 'pointerup', release);
      on(window, 'pointercancel', release);
      on(window, 'pointermove', e => { if (e.pointerType === 'mouse' && e.buttons === 0) release(e); });
      on(b, 'keydown', (e) => {
        if (e.code !== 'Space' && e.code !== 'Enter') return;
        if (!canDriveControls()) return;
        e.preventDefault();
        if (!e.repeat) { controlKeys.add(e.code); if (paintHeld()) sendInput(false); }
      });
      on(b, 'keyup', (e) => {
        if (e.code !== 'Space' && e.code !== 'Enter') return;
        e.preventDefault(); controlKeys.delete(e.code); if (paintHeld()) sendInput(false);
      });
      on(b, 'blur', () => { controlKeys.clear(); if (paintHeld()) sendInput(false); });
      on(b, 'contextmenu', (e) => e.preventDefault());
    };
    wireHold('pk-tg', 'gas');
    wireHold('pk-td', 'brake');
    wireHold('pk-th', 'drift');
    wireHold('pk-tn', 'nitro');
    // Fire is discrete, once per owned contact. A second thumb is normally
    // non-primary in Pointer Events and must still be able to fire. Classify
    // pointer-backed clicks directly; a canceled contact must never swallow
    // the next zero-detail keyboard/assistive click.
    const tb = el.querySelector('#pk-tb');
    if (tb) {
      let pointerId = null;
      const controlKeys = new Set();
      const paintHeld = () => {
        fireHeld = pointerId !== null || controlKeys.size > 0;
        if(!fireHeld&&!keys.has('action'))pulseHoldLife=null;
        tb.classList.toggle('pk-held', fireHeld);
        tb.setAttribute('aria-pressed', String(fireHeld));
      };
      const releaseCapture = id => {
        try { if (id !== null && tb.hasPointerCapture(id)) tb.releasePointerCapture(id); } catch { /* already lost */ }
      };
      const clearFire = () => {
        const id = pointerId;
        pointerId = null; controlKeys.clear(); paintHeld();
        releaseCapture(id);
      };
      clearHolds.add(clearFire);
      const fire = () => {
        latchPulseHold();
        boostEdge = true;
        predictBoost = true;
        sendInput(false);
      };
      on(tb, 'pointerdown', (e) => {
        if (tb.disabled || !canDriveControls() || pointerId !== null) return;
        if (e.pointerType === 'mouse' && (e.button || 0) !== 0) return;
        e.preventDefault();
        pointerId = e.pointerId;
        try { tb.setPointerCapture(pointerId); } catch { /* window release fallback */ }
        paintHeld(); fire();
      });
      const release = e => {
        if (pointerId === null || e.pointerId !== pointerId) return;
        const id = pointerId;
        pointerId = null; paintHeld(); releaseCapture(id);
        sendInput(false);
      };
      for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) on(tb, type, release);
      on(tb, 'pointerleave', e => {
        try { if (tb.hasPointerCapture(e.pointerId)) return; } catch { /* no capture */ }
        release(e);
      });
      on(window, 'pointerup', release);
      on(window, 'pointercancel', release);
      on(window, 'pointermove', e => { if (e.pointerType === 'mouse' && e.buttons === 0) release(e); });
      on(tb, 'keydown', e => {
        if (e.code !== 'Space' && e.code !== 'Enter') return;
        e.preventDefault();
        if (e.repeat || controlKeys.size || tb.disabled || !canDriveControls()) return;
        controlKeys.add(e.code); paintHeld(); fire();
      });
      on(tb, 'keyup', e => {
        if (!controlKeys.delete(e.code)) return;
        e.preventDefault(); paintHeld(); sendInput(false);
      });
      on(tb, 'blur', () => {
        if (!controlKeys.size) return;
        controlKeys.clear(); paintHeld(); sendInput(false);
      });
      on(tb, 'click', e => {
        if (e.detail > 0 || e.pointerType) return;
        if (tb.disabled || !canDriveControls()) return;
        fire();
      });
      on(tb, 'contextmenu', e => e.preventDefault());
    }
    // Left thumb stick: x = steer, UP = throttle, DOWN = brake/reverse.
    // Gated like every other drive input (watcher/done views never steer).
    const stickEl = el.querySelector('#pk-stick');
    if (stickEl && typeof createMobileStick === 'function') {
      try {
        stick = createMobileStick(stickEl, {
          window,
          document,
          deadzone: 0.14,
          enabled: canDriveControls,
          onChange: (v) => {
            if (suppressStickSend) return;
            if (!S?.youDrive || (S?.phase !== 'drive' && S?.phase !== 'countdown')) return;
            stickValue = { x: clampIntent(v.x), y: clampIntent(v.y) };
            sendStickInput();
          },
        });
      } catch {
        stick = null;
      }
    }

    sendTimer = setInterval(() => {
      sendInput(true); // real keepalive: re-sends the held intent (or zeros)
      paintHud(); // local timer countdown between snapshots
    }, SEND_MS);

    sceneReady = mount3d();
  }

  function update(el, Snew, api) {
    if(Snew?.audioBaseline||(S&&Number.isFinite(S.simAt)&&Number.isFinite(Snew?.simAt)&&Snew.simAt-S.simAt>1000))firstEvents=true;
    if (!rootEl || rootEl !== el) {
      // Shell re-mounted the element without mount(): rebuild, then apply
      // this same snapshot (mount clears state, so set it after).
      mount(el, api);
      S = Snew;
      apiRef = api;
    } else {
      S = Snew;
      apiRef = api;
    }
    if(S.motionProfile&&!physicalReady){const gen=mountGen;physicalReady=loadClassicPhysics().then(R=>{if(gen!==mountGen)return;physicalPrediction=createClassicPrediction(R);physicalPrediction.ingest(S,nowMs(),serverNow());});}
    if(S.motionProfile&&physicalPrediction&&S.inputAck?.life!==physicalPrediction.life){atomicStop();physicalPrediction.life=S.inputAck?.life;}
    physicalPrediction?.ingest(S,nowMs(),serverNow());
    // Authoritative snapshot: reconcile prediction (self) and retarget
    // remotes. Clears the local boost carry — the snapshot's boost state
    // (adopted above) now drives visuals. Bounded: one flag, one tick.
    predictBoost = false;
    if(pulseHoldLife!==null&&pulseHoldLife!==pulseLife())pulseHoldLife=null;
    if(firstEvents){const me=myKart();wasTurbo=me?.boost>0||me?.turbo>0||me?.nitroActive===true;}
    if(S.audioBaseline){cueUntil=0;cueText='';keycapUntil=0;}
    updateAudio();
    feedback.ingest(S,nowMs());
    if (S.phase !== 'done') garagePending=null;
    try {
      ingestSnapshot(poseStore, S, S && S.you, nowMs());
    } catch (e) {
      if (typeof console !== 'undefined') console.error('pose ingest error', e);
    }
    for (const event of S.events || []) {
      if (seenEvents.has(event.id)) continue;
      seenEvents.add(event.id);
      if(firstEvents)continue;
      updateAudio();
      const me=myKart(),source=S.karts?.find(k=>k.pid===event.pid);
      const nearby=!S.youDrive||event.pid===S.you||event.other===S.you||
        (me&&source&&Math.hypot(me.x-source.x,me.z-source.z)<24);
      if(nearby&&event.type!=='emp'&&!(event.type==='ko'&&event.weapon==='grenade'))audio?.cue(event.type==='blast'?'grenadeBlast':event.type==='fire'?event.weapon:event.type);
      if (event.pid !== S.you && event.other !== S.you) continue;
      const mineEvent = event.pid === S.you;
      if (event.type === 'pickup' && mineEvent) {
        const label = ITEMS[event.weapon]?.label || 'Item';
        if (!tutorialSeen()) {
          cueText = `${label} ready`;
          if(!touchControlsFor(controlsPreference,readInputCapabilities()))keycapUntil=nowMs()+4000;
          markTutorialSeen();
        } else {
          cueText = `${label} ready`;
        }
      } else cueText = event.type==='emp' ? (mineEvent?'EMP landed!':'EMP hit · slowed briefly') : event.type === 'ko' ? (mineEvent ? `Knockout! ${nameOf(event.other)}` : `${nameOf(event.pid)} got you · back in a moment`)
        : event.type === 'respawn' ? 'Back in! Protection ends when you attack'
        : event.type === 'shield' ? 'Invincibility active' : '';
      if (cueText) { cueUntil = nowMs()+2400; api.announce(cueText); }
    }
    firstEvents = false;
    while (seenEvents.size > 64) seenEvents.delete(seenEvents.values().next().value);
    const first = !lastPhase; // first snapshot since mount/dispose
    if (first) {
      lastSent = '';
      sendInput(true);
    }
    if (S.phase !== lastPhase) {
      lastPhase = S.phase;
      const battleNow = S.mode === 'battle';
      if (S.phase === 'drive') api.announce(battleNow ? 'Battle started. Find items, knock out rivals and respawn.' : 'Star Rush started. Collect the stars.');
      if (S.phase === 'done') {
        const unit = (n) => countLabel(n, battleNow ? 'KO' : 'star');
        const target = battleNow ? (S.targetHits || 0) : (S.targetStars || 0);
        const final = kartResultView({ result: S.result, you: S.you, nameOf, unit, target, targetUnit: battleNow ? 'KOs' : 'stars' });
        api.announce(`${final.title}. ${final.line}`);
        clearDriveInput();
      }
    }
    const touchBar = el.querySelector('#pk-touch');
    if (touchBar) touchBar.hidden = !S.youDrive || S.phase === 'done';
    if (!S.youDrive) clearDriveInput();
    if (meRespawning()) {
      const active = isInputActive();
      clearDriveInput();
      if (active) sendInput(true);
    }
    paintAutoGas();
    // Done phase: the result card carries standings, so the driving HUD
    // (chips, board, tip) steps aside via .pk-done and cannot overlap it.
    if (rootEl) rootEl.querySelector('.pk')?.classList.toggle('pk-done', S.phase === 'done');
    paintHud();
  }

  function dispose() {
    disposeAll();
  }
}

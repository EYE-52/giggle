import {createKartPickupPrediction} from './kart-pickup-prediction.mjs';
import {setKartText,setKartFlag,setKartAttribute} from './kart-hud-write.mjs';
import {createKartPickupPool} from './kart-pickup-pool.mjs';
import {waitKartPreparation} from './kart-warmup-scheduler.mjs';
import {kartLightTier} from './kart-festive-lights.mjs';
import {controlsPickerHtml,wirePickers,syncPickers} from '../pickers.js';
import {WEAPON_IDS,WEAPON_DISPLAY,CURATED_MUZZLE,equippedKartWeapon,weaponForward,normalizeWeapon} from './kart-weapon-contract.mjs';
import {paintKartWeapon,kartWeaponArt} from './kart-weapon-hud.mjs';
import {paintKartHearts,createKartHitFeedback,landedText,kartEventCue} from './kart-hearts.mjs';
import {kartResultView} from './kart-results.mjs';
import {createKartArenaPicker} from './kart-next-arena.mjs';
import {kartModeInfo,kartScore,kartScoreText,kartGoalText,kartTeam,kartTeamTag,paintKartObjectiveHud} from './kart-mode-ui.mjs';
import {createKartObjectives} from './kart-objectives.mjs';
import {kartGarageHtml,createKartGarageUI,garagePreviewKey} from './kart-garage-ui.mjs';
import {createGarageThumbnail} from './kart-garage-thumbnail.mjs';
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
import { loadKartAssets, matchKartDrivers } from './kart-assets.mjs';
import { createKartWorld } from './kart-world.mjs';
import { createKartModel, animateKartModel, createStarModel } from './kart-model.mjs';
import { createKartLod, crowdColor } from './kart-lod.mjs';
import { createKartAudio } from './kart-audio.mjs';
import { createGearbox, paintGear } from './kart-gearbox.mjs';
import { CLASSIC_MAX_FORWARD } from './kart-classic-motion.mjs';
import { createKartCombatArt, projectileContactInset } from './kart-combat-art.mjs';
import { createKartHealthBars } from './kart-health-bars.mjs';
import {createKartImpactFX} from './kart-impact-fx.mjs';
import {createArsenalFX} from './kart-arsenal-fx.mjs';
import {createKartArenaStructures,drawArenaRoads2d,drawArenaStructures2d} from './kart-arena-structure-art.mjs';
import {createKartArenaFeatures,drawArenaFeatures2d} from './kart-arena-features-art.mjs';
import {createKartSkids,kartSliding} from './kart-skids.mjs';
import {createKartDrivingFX} from './kart-driving-fx.mjs';
import {createKartWarmupLibrary,warmKartRenderer} from './kart-render-warmup.mjs';
import {classicStatics} from './kart-classic-motion.mjs';
import {createKartCameraCollision} from './kart-camera-collision.mjs';
import {setKartCameraLens} from './kart-camera-lens.mjs';
import {createSurfaceIndex,surfaceTuning} from './kart-surface.mjs';
import {driftTier,DRIFT_TIERS} from './kart-drift.mjs';
import {createKartThreats} from './kart-threats.mjs';
import {createKartFeedback} from './kart-feedback.mjs';
import { createProjectilePlayback, projectilePose, grenadePose, visibleGroundMines } from './kart-flight.mjs';
import {createGroundMarker,placeGroundMarker,prepareGroundProp,placeGroundProp} from './kart-ground-markers.mjs';
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
 * status lamp, side rocket, finned seeker, sensor charge, hex shield and the
 * warhead. Colors stay fixed so the slot reads identically across palettes and
 * night theme. The Fire button reuses these SVGs with an ammo badge; the
 * empty state is a crosshair, never a sentence. */
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
// Ground blast ring size per weapon (the ring geometry is a 4u radius).
const BLAST_SCALE = { missile:.75,cannon:.7,supernova:2.25,nuke:3.5 };
export function createKartView(viewConfig) {
  const cfg = viewConfig && typeof viewConfig === 'object' ? viewConfig : {};
  const title = cfg.title || 'Kart Arena';
  const hooks = cfg.hooks && typeof cfg.hooks === 'object' ? cfg.hooks : {};

  let S = null;
  let firstSnapshot=Promise.resolve(),releaseFirstSnapshot=null;
  let lastSnapshotArrival = null,snapshotOffset=null;
  let apiRef = null;
  let rootEl = null;
  let hitFx = null; // screen-edge flash, hit marker, toast and camera shake
  const arsenalEvents = []; // accepted events for the second-eight weapon effects
  let predictedPickup=null;
  const echoedFireIds=new Set();
  const pickupPrediction=createKartPickupPrediction({now:()=>nowMs(),onPredict:c=>{predictedPickup=c;audio?.cue('pickup');paintHud();},onReject:paintHud});
  let mountGen = 0;
  let gl = null; // three-view handle (null in fallback)
  let sceneState = null;
  let radarCanvas=null,radarAt=-Infinity,radarMap=null;
  const feedback = createKartFeedback();
  let poseStore = createPoseStore();
  let physicalPrediction,physicalReady,physicalSeq=0,physicalLocalPose,physicalPending,localFlash;
  const shotPlayback=createProjectilePlayback();
  function flushPhysical(){
    if(!physicalPending||!physicalPrediction)return;
    const pending=physicalPending;physicalPending=null;
    physicalPrediction.ingest(pending.snapshot,pending.now,pending.serverAt);
  }
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
  /* Shots answer the press at once: the sound and recoil play locally and
   * the server's matching fire event is skipped, so a 150ms round trip no
   * longer delays the feel of a hit. One local cue absorbs one echo. */
  let localFires = [], localRecoil = false;
  function localFireCue() {
    const me = myKart();
    if (!isBattle() || S?.phase !== 'drive' || !me || me.respawn || me.firing || localFires.some(f=>f.weapon===me.weapon&&nowMs()-f.at<800) || !(me.ammo > 0) || !WEAPON_DISPLAY[me.weapon]) return;
    audio?.cue(me.weapon);
    localFires.push({ weapon: me.weapon, at: nowMs() });
    const kind=normalizeWeapon(me.weapon);
    // Only the authority knows which rival the tracking blaster can see.
    if(kind==='machinegun')return;
    localRecoil = true;
    const pose=physicalLocalPose?.physicalPose||me.physicalPose;
    if(['trishot','missile','cannon','frost','nuke'].includes(kind)&&pose){
      const q=pose.rotation,v={x:CURATED_MUZZLE.x,y:CURATED_MUZZLE.y,z:CURATED_MUZZLE.z},t={x:2*(q.y*v.z-q.z*v.y),y:2*(q.z*v.x-q.x*v.z),z:2*(q.x*v.y-q.y*v.x)};
      localFlash={kind,at:nowMs(),position:{x:pose.position.x+v.x+q.w*t.x+q.y*t.z-q.z*t.y,y:pose.position.y+v.y+q.w*t.y+q.z*t.x-q.x*t.z,z:pose.position.z+v.z+q.w*t.z+q.x*t.y-q.y*t.x},direction:weaponForward(q)};
    }
  }
  function claimLocalFire(event) {
    const now = nowMs();
    localFires = localFires.filter(f => now - f.at < 800);
    const i = localFires.findIndex(f => f.weapon === event.weapon);
    if (i < 0) return false;
    localFires.splice(i, 1);
    return true;
  }
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
  let arenaSeen = new Set(); // arena feature events (cannon/portal/fall) already voiced
  let cueUntil = 0;
  let cueText = '';
  let firstEvents = true;
  let feedbackEpoch = 0;
  let bound = [];
  let fbBound = [];
  let fbCanvas = null;
  let sceneReady, shellAudioReady, rendererWarmup, startAudio;
  let fbObserver = null;
  let fbRaf = 0;
  let audio = null;
  let wasTurbo = false;
  const gearbox = createGearbox(CLASSIC_MAX_FORWARD);
  let garagePending = null;
  const garageUI = createKartGarageUI();
  let controlsPreference = 'auto';
  function paintControls() {
    if (!rootEl) return;
    const caps=readInputCapabilities({navigator:window.navigator,matchMedia:q=>window.matchMedia?.(q)});
    rootEl.querySelector('.pk')?.classList.toggle('pk-touch-enabled',touchControlsFor(controlsPreference,caps));
    const picker=rootEl.querySelector('#pk-controls');
    if(picker)picker.value=controlsPreference;
    syncPickers(rootEl);
  }
  const arenaPicker = createKartArenaPicker({ now: () => nowMs() });

  let drivingInstance=null,drivingMapId=null,drivingSurfaceIndex=null;
  function drivingSurfaceAt(x,z){
    if(S?.instanceId!==drivingInstance||S?.map?.id!==drivingMapId||!drivingSurfaceIndex){
      drivingInstance=S?.instanceId;drivingMapId=S?.map?.id;drivingSurfaceIndex=createSurfaceIndex(S?.map||{});
    }
    return surfaceTuning(drivingSurfaceIndex,x||0,z||0);
  }

  function updateAudio() {
    if (!audio) return;
    const me=myKart(), predicted=S?.motionProfile?physicalLocalPose:poseStore.self;
    audio.setMuted(apiRef?.context?.().sound === false);
    const speed=predicted?.speed ?? me?.speed ?? 0,gear=me?gearbox.update(speed):gearbox.update(0);
    paintGear(rootEl?.querySelector('#pk-gear'),gear);
    audio.update({speed,throttle:intentFromState().throttle,gear:gear.gear,rpm:gear.rpm,shift:gear.shift,
      surface:drivingSurfaceAt(predicted?.x??me?.x,predicted?.z??me?.z).kind,grounded:predicted?.physicalPose?.grounded??me?.physicalPose?.grounded??true,
      drifting:predicted?.drifting ?? me?.drifting,boost:me?.boost>0||(predicted?.turbo??me?.turbo)>0||me?.nitroActive===true,
      active:S?.phase==='drive' && !S?.preparing && !document.hidden && apiRef?.context?.().connected!==false && !apiRef?.context?.().roomActionPending,
      engineActive:!!S?.youDrive && !!me && !(me.respawn>0)});
    const turbo=me?.boost>0||(predicted?.turbo??me?.turbo)>0||me?.nitroActive===true;
    if(turbo&&!wasTurbo)audio.cue('boost');
    wasTurbo=turbo;
  }

  function on(t, type, fn, opts) {
    if (!t || !t.addEventListener) return;
    t.addEventListener(type, fn, opts);
    bound.push([t, type, fn, opts]);
  }

  let motionPreference;
  function reducedMotion() {
    try {
      motionPreference ??= window.matchMedia?.('(prefers-reduced-motion: reduce)');
      return motionPreference?.matches === true;
    } catch {
      return false;
    }
  }

  function isBattle() {
    return !!(S && S.mode === 'battle');
  }

  function scoreOf(k) {
    return kartScore(k,S);
  }

  function countLabel(n, noun) {
    return `${n} ${noun}${n === 1 ? '' : 's'}`;
  }

  function scoreNoun() {
    return isBattle() ? 'KOs' : '★';
  }

  function colorFor(pid) {
    const chosen = lookOf(pid)?.color;
    if (Number.isInteger(chosen)) return chosen;
    const ids = (S && S.karts ? S.karts : []).map((k) => k.pid);
    const i = ids.indexOf(pid);
    return crowdColor(i < 0 ? 0 : i, KART_COLORS);
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
    return isBattle()&&S?.phase==='drive'&&me?.weapon==='machinegun'&&me.ammo>0&&!me.respawn
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
    setKartFlag(b, 'hidden', !S?.youDrive || !['countdown','drive'].includes(S?.phase));
    setKartText(b, autoGas ? 'Auto gas · on' : 'Auto gas · off');
    setKartAttribute(b, 'aria-pressed', autoGas);
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

  function ordnanceFresh(maxAge=120) {
    return S?.phase!=='done'&&nowMs()-(lastSnapshotArrival??-Infinity)<=maxAge&&apiRef?.context?.().connected!==false;
  }

  function groundMines() {
    return visibleGroundMines(S?.mines, nowMs()-(lastSnapshotArrival??-Infinity), S?.phase!=='done'&&apiRef?.context?.().connected!==false);
  }

  // Simulation may pause while the arena prepares. Advance from the latest
  // accepted simulation stamp, using monotonic receipt age (including jitter).
  function ordnanceNow(){
    return Number.isFinite(S?.simAt)?S.simAt+Math.max(0,nowMs()-(lastSnapshotArrival??nowMs())):serverNow();
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
      </details></div>
    </div><span id="pk-health" class="pk-health kart-hp" role="img" aria-label="100 of 100 HP"></span>
    <div class="pk-count" id="pk-count" hidden></div>
    <div class="pk-tip" id="pk-tip" role="status" hidden></div>
    <div class="pk-readout" role="group" aria-label="Weapon, speed and nitro">
      <div class="pk-equip kart-item" id="pk-boost" role="group" aria-label="Weapon" hidden></div>
      <div class="pk-instruments">
      <div class="pk-speed" aria-label="Speed"><b id="pk-speed">0</b><small>km/h</small></div><i id="pk-gear" class="kart-gear" role="img" aria-label="Gear 1">1</i>
      <div class="pk-tech"><span id="pk-map"></span><span id="pk-handling"></span>
      <div class="pk-driftmeter" role="progressbar" aria-label="Drift charge" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i id="pk-driftfill"></i></div>
      <div class="pk-nitrometer" role="progressbar" aria-label="Nitro charge" aria-valuemin="0" aria-valuemax="100" aria-valuenow="100"><i id="pk-nitrofill"></i><span id="pk-nitrolabel">Nitro</span></div></div>
      <details class="pk-help" id="pk-help"><summary aria-label="Driving controls help">?</summary>
      <div class="pk-helpbody"><button type="button" id="pk-resume" class="pk-resume">Resume</button>${controlsPickerHtml('pk-controls',controlsPreference)}<button type="button" id="pk-auto" class="pk-auto" aria-pressed="false" hidden>Auto gas · off</button><p class="pk-helpkeys"><b>Drive</b> WASD / arrows or left stick: up for gas, down to brake / reverse · <b>Drift</b> hold Shift / tyre button in a turn, release blue, orange or purple sparks for a growing turbo · <b>Nitro</b> hold N / bottle button with gas for a rechargeable boost · <b>Item</b> Space / action button · Ice is slippery, mint strips boost.</p><a href="/assets/karts/audio/CREDITS.txt" target="_blank" rel="noopener">Sound credits</a></div></details></div></div>
    <canvas id="pk-radar" class="pk-radar" width="240" height="240" role="img" aria-label="Arena map: players, cover and glowing pickups"></canvas>
    <section class="kart-objective-hud" id="pk-objective" aria-label="Team objective" aria-live="polite" hidden></section>
    <div class="pk-respawn" id="pk-respawn" hidden></div>
    <div class="pk-result" id="pk-result" hidden></div>
    <div class="pk-glnote" id="pk-glnote" hidden></div>`;
    // Standings open on demand, leaving the arena clear on every screen.
    lastStandKey = '';
    lastResultKey = '';
  }

  function paintHud() {
    if (!rootEl || !S) return;
    const arenaKey = arenaPicker.sync(S, apiRef);
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
      setKartText(timer, '–:––'); // no running time yet; the shell says why
      setKartFlag(count,'hidden',true);
      setKartText(count, '');
      lastCount = -1;
    } else if (S.phase === 'countdown' && S.endsAt) {
      const left = Math.max(0, S.endsAt - serverNow());
      const n = Math.ceil(left / 1000);
      setKartText(timer, 'Starting…');
      setKartFlag(count,'hidden',false);
      if (String(n) !== count.textContent) {
        setKartText(count, n > 0 ? String(n) : 'GO');
        if (lastCount !== n && apiRef) {
          lastCount = n;
          if (n <= 0) apiRef.announce(battle ? 'Go! Tag your rivals.' : 'Go! Collect the stars.');
        }
      }
    } else if (S.phase === 'drive' && S.endsAt) {
      setKartText(timer, fmtTime(S.endsAt - serverNow()));
      setKartFlag(count,'hidden',true);
    } else if (S.phase === 'done') {
      setKartText(timer, 'Finished');
      setKartFlag(count,'hidden',true);
    }
    setKartText(goal,kartGoalText(S));
    paintKartObjectiveHud(rootEl.querySelector('#pk-objective'),S,nameOf);
    drawRadar();
    const respawn = rootEl.querySelector('#pk-respawn');
    if (respawn) {
      setKartFlag(respawn,'hidden',!meRespawning());
      setKartText(respawn, meRespawning() ? `Back in ${Math.max(1, Math.ceil(myKart().respawn))}…` : '');
    }
    const cue = rootEl.querySelector('#pk-cue');
    if (cue) { setKartFlag(cue,'hidden',!cueText || nowMs() > cueUntil || S.phase !== 'drive'); setKartText(cue,cueText); }

    const me = myKart();
    const health=rootEl.querySelector('#pk-health');
    if(health){setKartFlag(health,'hidden',!battle||!me||!S.youDrive||S.phase==='done');if(me)paintKartHearts(health,me);}
    const mapLabel = rootEl.querySelector('#pk-map');
    const handling = rootEl.querySelector('#pk-handling');
    const speedDigits = rootEl.querySelector('#pk-speed');
    const driftFill = rootEl.querySelector('#pk-driftfill');
    const driftMeter = rootEl.querySelector('.pk-driftmeter');
    const nitroFill = rootEl.querySelector('#pk-nitrofill');
    const nitroMeter = rootEl.querySelector('.pk-nitrometer');
    const nitroLabel = rootEl.querySelector('#pk-nitrolabel');
    const charge = Math.min(1, Math.max(0, Number(physicalLocalPose?.driftCharge??me?.driftCharge) || 0));
    const tier=driftTier(charge);
    const nitro = me && me.nitro !== undefined ? Math.min(1, Math.max(0, Number(me.nitro) || 0)) : 1;
    const nitroLocked = me?.nitroLocked === true;
    const nitroActive = me?.nitroActive === true;
    const kmh = Math.round(Math.abs((me && me.speed) || 0) * 3.6);
    if (mapLabel) setKartText(mapLabel, (S.map && (S.map.label || S.map.id)) || 'Arena');
    if (speedDigits) setKartText(speedDigits, me ? String(kmh) : '–');
    if (handling) {
      const feel = !me ? 'Watching the arena'
        : me.drifting ? (tier ? DRIFT_TIERS[tier-1].label+' · release for turbo!' : 'Charging drift')
        : (me.boost > 0 || me.turbo > 0 || nitroActive) ? (nitroActive && !(me.boost > 0 || me.turbo > 0) ? 'Nitro!' : 'Turbo!')
        : me.surface==='ice' ? 'Ice · ease into turns'
        : me.respawn > 0 ? 'Rejoining…'
        : (me.shield > 0 && battle) ? `Protected ${Math.ceil(me.shield)}s`
        : (me.guard && battle) ? 'Shield ready'
        : nitroLocked ? 'Nitro charging…'
        : me.speed < -1 ? 'Reversing'
        : '';
      setKartText(handling, feel);
      setKartFlag(handling,'hidden',!feel);
    }
    if (driftFill) {driftFill.style.transform = `scaleX(${charge})`;driftFill.style.background=tier?DRIFT_TIERS[tier-1].css:'#6d829c';}
    if (driftMeter) {
      setKartFlag(driftMeter,'hidden',!me);
      setKartAttribute(driftMeter,'aria-valuenow', String(Math.round(charge * 100)));
      setKartAttribute(driftMeter,'aria-valuetext',tier?DRIFT_TIERS[tier-1].label+' turbo ready':'Charging drift');
    }
    if (nitroFill) nitroFill.style.transform = `scaleX(${nitro})`;
    if (nitroMeter) {
      setKartFlag(nitroMeter,'hidden',!me);
      setKartAttribute(nitroMeter,'aria-valuenow', String(Math.round(nitro * 100)));
      nitroMeter.classList.toggle('pk-empty', nitroLocked);
      nitroMeter.classList.toggle('pk-boosting', nitroActive);
    }
    if (nitroLabel) setKartText(nitroLabel, !me ? 'Nitro' : nitroActive ? 'Nitro!' : nitroLocked ? `Charging ${Math.round(nitro * 100)}%` : `Nitro ${Math.round(nitro * 100)}%`);
    const driftButton = rootEl.querySelector('#pk-th');
    if (driftButton) driftButton.classList.toggle('pk-held', !!(me && me.drifting));
    const nitroButton = rootEl.querySelector('#pk-tn');
    if (nitroButton) {
      setKartFlag(nitroButton,'disabled',S.phase !== 'drive' && S.phase !== 'countdown' || !me || me.respawn > 0);
      // Charge moves ONLY the ring arc offset; the glyph markup is static
      // from mount and is never rebuilt by HUD text updates.
      try {
        const arc = nitroButton.querySelector('.pk-nitro-arc');
        if (arc) setKartAttribute(arc,'stroke-dashoffset', (NITRO_ARC_LEN * (1 - nitro)).toFixed(1));
      } catch { /* unstyled still plays */ }
      setKartAttribute(nitroButton,'aria-label', !me ? 'Nitro' : nitroActive ? `Nitro boosting, ${Math.round(nitro * 100)} percent left` : nitroLocked ? `Nitro charging, ${Math.round(nitro * 100)} percent` : `Hold for nitro boost, ${Math.round(nitro * 100)} percent`);
      nitroButton.classList.toggle('pk-boosting', nitroActive);
      nitroButton.classList.toggle('pk-empty', nitroLocked);
    }
    const readout = rootEl.querySelector('.pk-readout');
    if (readout) {
      setKartFlag(readout,'hidden',!S.youDrive);
      readout.classList.toggle('pk-drifting', !!(me && me.drifting));
      readout.classList.toggle('pk-charged', !!(me && me.drifting && charge >= 1));
      readout.classList.toggle('pk-nitroing', nitroActive);
    }
    rootEl.querySelector('.pk')?.classList.toggle('pk-battle', battle);
    rootEl.querySelector('.pk')?.classList.toggle('kart-has-teams',!!S.teamMode);
    if (battle) {
      setKartText(mine, me&&S.youDrive ? `You · ${kartScoreText(scoreOf(me),S)}` : 'Watching');
      setKartFlag(boost,'hidden',!me||!S.youDrive);
      const hint=S.phase==='drive'&&!touchControlsFor(controlsPreference,readInputCapabilities());
      paintKartWeapon(boost,me,{hint});
    } else {
      setKartText(mine, me&&S.youDrive ? `You ★ ${me.stars}` : (S.youDrive ? 'You ★ 0' : 'Watching'));
      setKartFlag(boost,'hidden',true);
    }

    // Standings rewrite only when the order/scores actually change: this
    // runs on every 10 Hz snapshot plus the 500 ms timer, so an unchanged
    // innerHTML churn would cost layout on every tick while driving.
    // Equal scores share a rank; drivers who dropped out sit last.
    // Big matches list the top seven plus your own row with its real rank.
    const sorted = [...(S.karts || [])].sort((a, b) => (a.out === true) - (b.out === true) || scoreOf(b) - scoreOf(a));
    const allRanks = [];
    sorted.forEach((k, i) => { allRanks[i] = i && !k.out && !sorted[i - 1].out && scoreOf(k) === scoreOf(sorted[i - 1]) ? allRanks[i - 1] : i + 1; });
    const selfAt = S.you ? sorted.findIndex((k) => k.pid === S.you) : -1;
    const shown = selfAt >= 8 ? [...sorted.keys()].slice(0, 7).concat(selfAt) : [...sorted.keys()].slice(0, 8);
    const rows = shown.map((i) => sorted[i]), ranks = shown.map((i) => allRanks[i]);
    const hiddenCount = sorted.length - rows.length;
    const myIndex = S.you ? rows.findIndex((k) => k.pid === S.you) : -1;
    const myRank = myIndex >= 0 ? ranks[myIndex] : 0;
    const standKey = (battle ? 'b' : 'r') + '|' + (S.you || '') + '|' + hiddenCount + '|' +
      rows.map((k) => k.pid + ':' + scoreOf(k) + ':' + S.teamByPlayer?.[k.pid] + (k.out ? ':out' : '')).join(',');
    if (standKey !== lastStandKey) {
      lastStandKey = standKey;
      const lead = rootEl.querySelector('#pk-lead');
      if (lead) {
        const top = rows[0];
        const scoreTxt = k=>kartScoreText(scoreOf(k),S);
        // Folded: rank and score only. Full names stay in the standings.
        const self = myIndex >= 0 ? rows[myIndex] : null;
        const leader = self || top;
        if (leader) {
          const fullName = nameOf(leader.pid);
          const rank = self ? myRank : 1;
          setKartAttribute(lead,'aria-label', `${fullName}, rank ${rank}, ${scoreTxt(leader)}. Expand standings.`);
          lead.innerHTML = `<span class="pk-leadrank">P${rank}</span>` +
            `<span class="pk-leadscore">${scoreOf(leader)}<small> ${kartModeInfo(S).unit}${scoreOf(leader)===1?'':'s'}</small></span>` +
            `<span class="pk-chev" aria-hidden="true">▾</span>`;
        } else {
          setKartAttribute(lead,'aria-label', 'Expand standings');
          lead.innerHTML = '<span class="pk-leadtxt">–</span><span class="pk-chev" aria-hidden="true">▾</span>';
        }
      }
      stand.innerHTML = rows.map((k, i) =>
        `<div class="pk-row${k.pid === S.you ? ' pk-self' : ''}${k.out ? ' pk-out' : ''}">` +
        `<span class="pk-rank">${ranks[i]}</span>` +
        `<span class="pk-dot" style="background:#${colorFor(k.pid).toString(16).padStart(6, '0')}"></span>` +
        `<span class="pk-name">${esc(nameOf(k.pid))}${kartTeamTag(S,k.pid)}${k.out ? ' <small>Left</small>' : ''}</span>` +
        `<span class="pk-score">${kartScoreText(scoreOf(k),S)}</span></div>`
      ).join('') + (hiddenCount > 0 ? `<div class="pk-row pk-more"><span class="pk-rank"></span><span class="pk-name"><small>+${hiddenCount} more</small></span></div>` : '');
    }

    if (S.phase === 'done' && S.result) {
      setKartFlag(result,'hidden',false);
      const bought = !!(garagePending && S.garageResult?.nonce === garagePending && S.garageResult.ok);
      if (S.garageResult?.nonce === garagePending) garagePending = null;
      const wins = S.result.winners || (S.result.winner ? [S.result.winner] : []);
      const reason = (S.result && S.result.endReason) || 'timeout';
      const resKey = (battle ? 'b' : 'r') + '|' + reason + '|' + wins.join(',') + '|' +
        (S.result.standings || []).map((r) => r.pid + ':' + r.score + ':' + r.points + ':' + (r.out ? 1 : 0)).join(',') + '|' + S.you + '|' +
        JSON.stringify([S.coins,S.upgrades?.[S.you],S.garageResult,arenaKey,S.map?.id,garagePending,lookOf(S.you),S.teamResult,S.modeLabel]);
      if (resKey !== lastResultKey) {
        lastResultKey = resKey;
        const unit=n=>kartScoreText(n,S),mode=kartModeInfo(S);
        const target=S[mode.target] || 0;
        const final = kartResultView({ result: S.result, you: S.you, nameOf, unit, target,
          targetUnit:mode.unit+(target===1?'':'s'),teams:S.teams,teamResult:S.teamResult,teamByPlayer:S.teamByPlayer });
        const scrollTop = result.scrollTop || 0;
        const focused = result.contains?.(document.activeElement) ? document.activeElement : null;
        const focusArena = focused?.getAttribute?.('data-arena'),focusMode=focused?.getAttribute?.('data-next-mode'), focusPart = focused?.getAttribute?.('data-upgrade') || focused?.getAttribute?.('data-part');
        result.innerHTML = final.html + garageHtml() + arenaPicker.html(S, apiRef);
        garageUI.paint(result,S,{bought,reducedMotion:reducedMotion(),key:garagePreviewKey(garagePreviewSpec())},apiRef);
        result.scrollTop = scrollTop;
        if (focusMode) result.querySelector(`[data-next-mode="${focusMode}"]`)?.focus?.({preventScroll:true});
        if (focusArena) result.querySelector(`[data-arena="${focusArena}"]`)?.focus?.({ preventScroll: true });
        if (focusPart) {
          const button=result.querySelector(`[data-upgrade="${focusPart}"]`);
          if(button && !button.disabled) button.focus?.({preventScroll:true});
          else { const card=result.querySelector(`[data-part="${focusPart}"]`);card?.setAttribute('tabindex','-1');card?.focus?.({preventScroll:true}); }
        }
      }
    } else {
      setKartFlag(result,'hidden',true);
      if (lastResultKey !== '') {
        lastResultKey = '';
        result.innerHTML = '';
        garageUI.reset();
      }
    }

    // Concise contextual state only — the driving keys live in the help
    // disclosure inside the telemetry readout, not as a permanent paragraph.
    const arenaName = (S.map && (S.map.label || S.map.id)) || '';
    const tipTxt = !S.youDrive
      ? `Watching — ${(S.karts || []).length} driving.`
      : S.phase === 'countdown' ? (S.preparing ? '' : arenaName ? `Get ready · ${arenaName}` : 'Get ready…')
      : S.phase === 'drive' && meRespawning() ? (myKart()?.fell ? 'Fell in — rejoining…' : 'Knocked out — rejoining…')
      : '';
    setKartText(tip, tipTxt);
    setKartFlag(tip,'hidden',!tipTxt);

    // Fire button shows the equipped weapon SVG + remaining ammo (empty
    // crosshair when unarmed). Markup rebuilds only on a changed key; no
    // textContent write ever wipes the icon or the ammo badge.
    const tb = rootEl.querySelector('#pk-tb');
    if (tb) {
      const item = battle ? WEAPON_DISPLAY[me?.weapon] : null;
      const loaded=!!item && me.ammo>0;
      const fireKey = !battle ? 'race' : !me || me.respawn > 0 ? 'rejoin'
        : loaded ? `${me.weapon}|${me.ammo}` : 'empty';
      if (fireKey !== lastFireKey) {
        lastFireKey = fireKey;
        const art = !battle ? BOOST_ART : loaded ? kartWeaponArt(me.weapon) : CROSSHAIR_ART;
        const count=me?.weapon==='trishot'?Math.ceil(me.ammo/3):me?.ammo;
        const ammo = loaded ? `<span class="pk-fire-ammo">${esc(String(count))}</span>`
          : '<span class="pk-fire-ammo" hidden></span>';
        tb.innerHTML = `<span class="pk-fire-art">${art}</span>${ammo}<span class="kart-fire-label" aria-hidden="true">${item?.short || (battle?'Fire':'Boost')}</span>`;
      }
      const label = !battle ? 'Boost'
        : loaded ? me.firing ? 'Weapon firing' : item.action
        : !me || me.respawn > 0 ? 'Rejoining' : 'No item';
      if (tb.getAttribute('aria-label') !== label) setKartAttribute(tb,'aria-label', label);
      setKartFlag(tb,'disabled',S.phase !== 'drive' || !me || me.respawn > 0 || (battle && (!loaded || me.firing)));
    }

    if (typeof hooks.hudExtra === 'function') {
      try { hooks.hudExtra(rootEl, S); } catch { /* game-owned extra must not break HUD */ }
    }
  }

  function garagePreviewSpec() {
    return {color:colorFor(S.you),driver:lookOf(S.you)?.driver ?? S.you,levels:S.upgrades?.[S.you] || {}};
  }

  function garageHtml() {
    return kartGarageHtml(S,garagePending,garagePreviewSpec());
  }

  function hostContext() {
    try { return apiRef?.context?.() || {}; } catch { return {}; }
  }

  // A player's garage pick ({ driver, color }) from the host, if any.
  function lookOf(pid) {
    const looks = hostContext().looks;
    return looks && Object.hasOwn(looks, pid) ? looks[pid] : null;
  }

  function buyUpgrade(event) {
    const button=event.target?.closest?.('[data-upgrade]');
    if (!button || button.disabled || garagePending || S?.phase!=='done' || !S?.youDrive) return;
    const category=button.getAttribute('data-upgrade');
    if (!['engine','handling','reload'].includes(category)) return;
    garagePending=typeof crypto!=='undefined'&&crypto.randomUUID?crypto.randomUUID():`buy-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const keepFocus=document.activeElement===button;
    button.disabled=true;
    if(keepFocus) {
      const card=button.closest?.('[data-part]');
      card?.setAttribute('tabindex','-1');card?.focus?.({preventScroll:true});
    }
    const feedback=rootEl.querySelector('.pk-garage-feedback');
    if(feedback)feedback.textContent='Adding your upgrade…';
    apiRef.send({garage:{category,nonce:garagePending}});
    paintHud();
  }

  function resultClick(event) {
    buyUpgrade(event);
    if (arenaPicker.choose(event, S, apiRef)) { lastResultKey = ''; paintHud(); }
  }

  function meRespawning() { return !!(myKart()?.respawn > 0 && S?.phase === 'drive'); }

  function skyPhase() {
    const cycle = S?.skyCycle;
    return cycle && cycle.durationMs > 0 ? Math.max(0, Math.min(1, ((Number.isFinite(cycle.endedAt) ? cycle.endedAt : serverNow()) - cycle.startedAt) / cycle.durationMs)) : null;
  }

  function drawRadar() {
    const canvas = rootEl.querySelector('#pk-radar');
    if (!canvas?.getContext) return;
    // The room can deliver 30 snapshots/s.
    // Canvas work was a top CPU cost during weapon use. A 120px radar needs
    // only 10 updates/s; the main scene still draws every animation frame.
    const now=nowMs(),mapKey=S.instanceId+':'+S.map?.id;
    if(canvas===radarCanvas&&mapKey===radarMap&&now-radarAt<100)return;
    radarCanvas=canvas;radarMap=mapKey;radarAt=now;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const size = 240, half = S.map?.half || 30, scale = 216 / (half * 2);
    const xy = n => 120 + n * scale;
    ctx.clearRect(0,0,size,size);
    ctx.fillStyle = '#294b60'; ctx.fillRect(0,0,size,size);
    ctx.strokeStyle = '#b4d8e4'; ctx.lineWidth = 2; ctx.strokeRect(12,12,216,216);
    ctx.fillStyle = '#9bb8c7';
    for (const b of S.map?.blocks || []) ctx.fillRect(xy(b.x-b.hw),xy(b.z-b.hd),b.hw*2*scale,b.hd*2*scale);
    ctx.fillStyle = '#89f5d9';
    for (const c of S.crates || S.stars || []) { ctx.beginPath(); ctx.arc(xy(c.x),xy(c.z),5,0,Math.PI*2); ctx.fill(); }
    for (const k of S.karts || []) {
      if (k.respawn > 0 || k.connected === false || k.out) continue;
      const self = k.pid === S.you;
      ctx.save(); ctx.translate(xy(k.x),xy(k.z)); ctx.rotate(canvasNoseRotation(k.angle));
      ctx.fillStyle = self ? '#fff9df' : '#' + colorFor(k.pid).toString(16).padStart(6,'0');
      ctx.beginPath(); ctx.moveTo(0,-(self?14:11)); ctx.lineTo(-9,9); ctx.lineTo(9,9); ctx.closePath(); ctx.fill(); ctx.strokeStyle = '#102b3e'; ctx.lineWidth = 3; ctx.stroke();
      ctx.restore();
    }
    ctx.fillStyle = '#183044'; ctx.fillRect(103,0,34,36);
    ctx.fillStyle = '#f4fbff'; ctx.font = '800 30px Nunito, sans-serif'; ctx.textAlign = 'center'; ctx.fillText('N',120,29);
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
    const model = createKartModel(THREE, { assets, color, driver: lookOf(pid)?.driver ?? pid });
    model.userData.giggleKart = true;
    return model;
  }

  async function mount3d() {
    const gen = mountGen;
    const stage = rootEl && rootEl.querySelector('.pk-stage');
    if (!stage) return;
    stage.innerHTML = '<div class="pk-loading muted" role="status">Loading the arena…</div>';
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
        : 'Top-down view · Retry 3D in controls.', reason !== 'forced');
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
    // Mount can finish its module imports before the first public snapshot.
    // Wait for its map/driver list instead of loading the full asset library.
    await firstSnapshot;
    if(gen!==mountGen||!S)throw new Error('Retired kart scene');
    const pal = paletteFor(S && S.palette);
    const scene = new THREE.Scene();
    let disposeLighting,warmup;
    let disposeCombat;
    let healthBars;
    let world,impactFX,skids,drivingFX,threats,arsenalFX,arena,structures,garageThumbnail,cameraCollision,objectives;
    try {
      const assets = await loadKartAssets(THREE, scene, {map:S.map,drivers:matchKartDrivers(S.karts,hostContext().looks)});
      if (gen !== mountGen) throw new Error('Retired kart scene');
      world = createKartWorld(THREE, {scene, palette: S && S.palette, assets, map: S && S.map,quality:()=>kartLightTier(helper.renderer()),reducedMotion:()=>helper.reducedMotion()});
      world.syncMap((S && S.map) || {id:'ring',blocks:[]});
      world.group.getObjectByName('obstacles')?.traverse(mesh => {if (mesh.isMesh) mesh.castShadow=true;});
      const mood = world.palette || {sky: pal.sky, horizon: pal.horizon};
      scene.background = new THREE.Color(mood.horizon);
      scene.fog = new THREE.Fog(mood.horizon, ...(mood.fog || [78, 180]));
      const camera = new THREE.PerspectiveCamera(60, 4 / 3, 0.1, 400);
      camera.position.set(0, 7.5, -23);
      camera.lookAt(0, 1, -5);
      const renderer = helper.renderer();
      disposeLighting = createKartLighting(THREE, renderer, scene, mood, {half: world.bounds?.arena || S.map?.half || 30,preparationSignal:apiRef?.preparationSignal});

      const karts = new Map(); // pid -> mesh
      const stars = new Map(); // id -> group (gem + pickup-zone ring)
      const crates = new Map(); // id -> group (box + pickup-zone ring)
      const statusOptions={time:0,elapsed:0,groundRoot:false};
      const shotDirection=new THREE.Vector3(),shotForward=new THREE.Vector3(0,0,1);
      const zaps = new Map(); // id -> mesh (eased toward snapshots)
      const mines = new Map();
      const grenades = new Map(), combatEffects = new Map();
      const combat = createKartCombatArt(THREE,{assets:{get:name=>
        assets.pickupGear?.getObjectByName(name)||assets.pulse?.getObjectByName(name)||assets.arsenal?.getObjectByName(name)||
        (name!=='ScatterShot'&&assets.secondary?.getObjectByName(name))||assets.combat?.getObjectByName(name)
      },pickupAsset:assets.crate});
      disposeCombat=combat.dispose;
      healthBars=createKartHealthBars(THREE,scene);
      objectives=createKartObjectives(THREE,scene,{state:S});
      impactFX=createKartImpactFX(THREE,scene,{reducedMotion:()=>rm});
      arsenalFX=createArsenalFX(THREE,scene,{reducedMotion:()=>rm,groundAt:(x,z)=>world.groundAt?.(x,z)||0});
      arena=createKartArenaFeatures(THREE,scene,{groundAt:(x,z)=>world.groundAt?.(x,z)||0,reducedMotion:()=>reducedMotion()});
      arena.sync(S?.map);
      structures=createKartArenaStructures(THREE,scene,{groundAt:(x,z)=>world.groundAt?.(x,z)||0});structures.sync(S?.map);
      cameraCollision=createKartCameraCollision(THREE,classicStatics({...S.map,half:S.map?.half||30}));
      skids=createKartSkids(THREE,scene,{groundAt:(x,z)=>world.groundAt?.(x,z)||0});
      threats=createKartThreats(THREE,scene,rootEl.querySelector('.pk'),{reducedMotion:()=>rm,beep:level=>audio?.beep?.(level)});
      const zoneGeo = new THREE.RingGeometry(2.22, 2.4, 36);
      const zoneMat = new THREE.MeshBasicMaterial({color:0xffd961,transparent:true,opacity:0.16,depthWrite:false,side:THREE.DoubleSide});
      const crateZoneMat = new THREE.MeshBasicMaterial({color:0x72e8f0,transparent:true,opacity:0.16,depthWrite:false,side:THREE.DoubleSide});
      // The Nuke's warning ring marks its whole 14u knockout radius.
      const nukeRingGeo=new THREE.RingGeometry(13.4,14,64);
      const nukeRingMat=new THREE.MeshBasicMaterial({color:0xe65832,transparent:true,opacity:.65,depthWrite:false,side:THREE.DoubleSide});
      const blastGeo=new THREE.RingGeometry(3.3,4,32);
      const blastMat=new THREE.MeshBasicMaterial({color:0xff973d,transparent:true,opacity:.7,depthWrite:false,side:THREE.DoubleSide});
      drivingFX=createKartDrivingFX(THREE,scene,camera,{groundAt:(x,z)=>world.groundAt?.(x,z)||0,reducedMotion:reducedMotion()});
      // Big matches draw distant karts as one instanced proxy batch.
      const kartLod = createKartLod(THREE); scene.add(kartLod.object);
      let lodProxied = new Set();
      const sparkMatrix = new THREE.Matrix4();
      const pops = new THREE.InstancedMesh(new THREE.BoxGeometry(.32,.16,.5),new THREE.MeshBasicMaterial({color:0xffcf80}),64);
      pops.count=0; pops.frustumCulled=false; scene.add(pops);
      const popSites=[]; // bounded accepted KO/contact/blast debris
      const effectSeen=new Set();

      // Reserve shared effect resources in the hidden library so disposal also
      // handles a frame with zero live pickups/projectiles.
      const reserve = new THREE.Group(); reserve.visible = false; scene.add(reserve);
      reserve.add(new THREE.Mesh(zoneGeo,zoneMat),new THREE.Mesh(zoneGeo,crateZoneMat),new THREE.Mesh(nukeRingGeo,nukeRingMat),new THREE.Mesh(blastGeo,blastMat));
      const markerTypes={star:[zoneGeo,zoneMat,true,false],crate:[zoneGeo,crateZoneMat,true,false],nuke:[nukeRingGeo,nukeRingMat,true,false],blast:[blastGeo,blastMat,true,false]};
      const markerPools=new Map(Object.entries(markerTypes).map(([kind,args])=>[kind,Array.from({length:Math.max(kind==='blast'?24:12,S[kind==='star'?'stars':'crates']?.length||0)},()=>{
        const marker=createGroundMarker(THREE,...args);marker.userData.markerPool=kind;reserve.add(marker);return marker;
      })]));
      const groundAt=world.groundAt||(()=>0);
      function takeMarker(kind){const marker=markerPools.get(kind).pop()||createGroundMarker(THREE,...markerTypes[kind]);marker.userData.markerPool=kind;marker.visible=true;marker.scale.setScalar(1);marker.rotation.set(0,0,0);scene.add(marker);return marker;}
      function returnMarker(marker){marker.visible=false;reserve.add(marker);markerPools.get(marker.userData.markerPool).push(marker);}
      sceneState = {karts,stars,crates,zaps,mines,grenades};
      world.group.traverse((mesh) => { if (mesh.isMesh) mesh.receiveShadow = true; });
      const rm = reducedMotion();
      let syncedMap=null;
      const syncBlocks = () => {if(S?.map&&S.map!==syncedMap){world.syncMap(S.map);syncedMap=S.map;}};
      const tmpV=new THREE.Vector3(),shakeOffset=new THREE.Vector3(),cameraFocus=new THREE.Vector3(),cameraLook=new THREE.Vector3(),beforeShake=new THREE.Vector3(),cameraCandidate=new THREE.Vector3();
      const cameraAngles=[Math.PI/4,-Math.PI/4,Math.PI*.42,-Math.PI*.42,Math.PI/2,-Math.PI/2,Math.PI*.75,-Math.PI*.75,Math.PI];let cameraSide=0;
      let cameraEpoch = null,driftSwing=0;
      // Prepare shared combat variants during loading. The hidden source library
      // alone is never rendered: first fire used to upload these buffers and
      // compile tracer/instanced-effect programs in a live driving frame.
      const rigPools=new Map(WEAPON_IDS.map(kind=>[kind,Array.from({length:Math.max(8,S.karts.length)},()=>combat.weapon(kind))]));
      const warm=new THREE.Group();scene.add(warm);
      for(const k of S.karts||[]){const model=buildKartMesh(THREE,colorFor(k.pid),k.pid,assets);karts.set(k.pid,model);scene.add(model);arsenalFX.warmStatus(model);model.position.y=-100;warm.add(model);}

      for(const pool of markerPools.values())for(const marker of pool)warm.add(marker);
      for(const k of S.karts||[]) {const bar=healthBars.add(k.pid);bar.visible=true;bar.position.y=-100;}
      for(const pool of rigPools.values())warm.add(pool[0]);
      for(const kind of ['frost','cluster','bomblet'])warm.add(combat.projectile(kind));
      for(const object of arsenalFX.objects()){object.visible=true;warm.add(object);}
      {const dummy=new THREE.Group();arsenalFX.warmStatus(dummy);warm.add(dummy);}
      // Every deployed body is reserved before Ready, including both mine tints.
      const minePools=new Map(),grenadePools=new Map();
      for(const kind of ['mine','proximity','fakecrate'])for(const own of [true,false]){
        const key=kind+':'+own,pool=[];
        // Prepare shared footprints and per-trap scratch vectors now. Spare
        // traps have no ground position yet; fitting all of them to (0,0)
        // repeats thousands of road-height queries with no visible result.
        for(let i=0;i<16;i++){const group=new THREE.Group(),prop=combat.mine(own,kind);group.add(prop);group.userData.prop=prop;group.userData.poolKey=key;prepareGroundProp(THREE,group);group.visible=false;scene.add(group);pool.push(group);}
        minePools.set(key,pool);warm.add(pool[0]);pool[0].visible=true;
      }
      for(const kind of ['nuke','frost']){
        const pool=[];for(let i=0;i<12;i++){const group=new THREE.Group(),body=combat.projectile(kind);group.add(body);group.userData.body=body;group.userData.poolKey=kind;group.visible=false;scene.add(group);pool.push(group);}grenadePools.set(kind,pool);warm.add(pool[0]);pool[0].visible=true;
      }
      // Reserve every pickup body before warm-up. Server ids change when
      // boxes respawn; a fresh id must never clone a model during driving.
      const starPool=createKartPickupPool(()=>{
        const group=new THREE.Group(),gem=createStarModel(THREE,assets);
        gem.position.y=1.5;group.add(gem);group.userData.gem=gem;return group;
      },Math.max(32,S.stars?.length||0));
      const cratePool=createKartPickupPool(()=>{
        const group=new THREE.Group(),box=combat.pickup();
        group.add(box);group.userData.capsule=box;return group;
      },Math.max(32,S.crates?.length||0));
      for(const pool of [starPool,cratePool]){const object=pool.objects[0];object.visible=true;warm.add(object);}
      const shotPools=new Map(),shotCues=[],shotContactInsets=new Map();
      function prepareShotContact(object,kind,radius){
        const c=object.userData.combat,key=kind+':'+radius;
        if(radius>0&&!shotContactInsets.has(key))shotContactInsets.set(key,projectileContactInset(THREE,object,radius));
        c.contactRadius=radius;c.contactInset=radius>0?shotContactInsets.get(key):0;
      }
      const cueBounds=new THREE.Box3(),cueCenter=new THREE.Vector3();
      for(const kind of ['machinegun','trishot','missile','cannon','nuke']) {
        const pool=[];
        for(let i=0;i<64;i++){const object=combat.projectile(kind);object.userData.flight={x:0,y:0,z:0,angle:0,visible:false,direction:{x:0,y:0,z:0}};prepareShotContact(object,kind,S.combat?.staticSweepRadii?.[kind]||0);object.visible=false;scene.add(object);pool.push(object);}
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
      {const charge=combat.projectile('proximity');charge.userData.combat.landed=true;warm.add(charge);}
      warm.position.y=-100;warm.traverse(object=>{object.frustumCulled=false;});
      reserve.visible=true;reserve.position.y=-100;reserve.traverse(object=>{object.frustumCulled=false;});
      const warmLibrary=createKartWarmupLibrary(THREE,scene,assets,combat);
      await waitKartPreparation(disposeLighting.ready,apiRef?.preparationSignal);
      // State/countdown paint signals can expire while this arena still lives.
      // Scope required GPU preparation to its generation. Then allow six
      // seconds for other bindings; no queue resumes after scene handoff.
      warmup=await warmKartRenderer(THREE,renderer,scene,camera,{isAlive:()=>gen===mountGen,
        requiredRoots:[warm,reserve,warmLibrary,pops,objectives.root,scene.getObjectByName('KartImpactFX')],
        budgetMs:6000,priorityRoots:[world.group,...karts.values(),starPool.objects[0],cratePool.objects[0],warmLibrary.children[0],drivingFX.particles,drivingFX.speedLines],
        onProgress:({completed,total})=>{if(gen===mountGen){const loading=rootEl?.querySelector('.pk-loading'),text=`Preparing graphics… ${Math.round(completed/total*100)}%`;if(loading&&loading.textContent!==text)loading.textContent=text;}},
        roots:[warm,reserve,warmLibrary,pops,kartLod.object,drivingFX.particles,drivingFX.speedLines,
          scene.getObjectByName('KartSkidMarks'),scene.getObjectByName('KartThreatRing'),
          scene.getObjectByName('arena-feature-fx'),scene.getObjectByName('KartImpactFX')]}).catch(()=>null);
      if(gen!==mountGen){warmup?.cancel();throw new Error('Retired kart scene');}
      // No shader reflection, hidden uploads or shadow-mode switches after
      // handing the scene to the real render loop. Pools stay ready to use.
      warmup?.cancel();
      rendererWarmup=warmup;
      arsenalFX.reset();
      // Keep reserved bodies off the live scene graph. Three updates world
      // matrices even for invisible objects; hundreds of spare projectiles
      // were paying that cost on every frame after warm-up.
      for(const pool of minePools.values())for(const object of pool){object.removeFromParent();object.visible=false;}
      for(const pool of grenadePools.values())for(const object of pool){object.removeFromParent();object.visible=false;}

      for(const model of karts.values()){model.removeFromParent();scene.add(model);model.position.set(0,0,0);arsenalFX.status(model,null);}
      warm.removeFromParent();reserve.visible=false;reserve.position.y=0;
      for(const pool of markerPools.values())for(const marker of pool){marker.visible=false;reserve.add(marker);}
      for(const k of S.karts||[])healthBars.add(k.pid).visible=false;
      for(const pool of [starPool,cratePool])for(const object of pool.objects){object.removeFromParent();object.visible=false;}
      for(const pool of shotPools.values())for(const object of pool){object.removeFromParent();object.visible=false;object.position.set(0,0,0);}
      for(const cue of shotCues){cue.object.removeFromParent();cue.object.visible=false;cue.object.position.set(0,0,0);scene.add(cue.object);}
      if(gen!==mountGen)throw new Error('Retired kart scene');
      const live=new Set(),liveS=new Set(),liveC=new Set(),liveZ=new Set(),liveG=new Set(),liveM=new Set(),lodEntries=[];
      let impactEpoch=-1,impactSince=nowMs(),lastEffectTime=null;
      const frame = (dt, t) => {
        if (!S) return;
        flushPhysical();
        if(S.phase==='done' && isBattle() && S.youDrive && S.garagePrices) {
          const spec=garagePreviewSpec();
          garageUI.preview(rootEl,garagePreviewKey(spec),()=>{
            garageThumbnail ||= createGarageThumbnail(THREE,renderer,assets);
            return garageThumbnail.draw(spec);
          });
        }
        syncBlocks();
        if (world.animate) world.animate(rm ? 0 : dt,rm ? 0 : t,skyPhase());
        if (disposeLighting?.update) disposeLighting.update(world.palette);
        // Karts: shared visual poses (predicted self, eased remotes) — the
        // SAME helper the 2D fallback draws, so both renderers agree.
        const poses = framePoses(poseStore, S, intentForPrediction(), dt, nowMs(), { reducedMotion: rm, map: S.map, serverNow: serverNow() });
        const physicalSelf=physicalPrediction?.frame(S,intentForPrediction(),dt,nowMs(),serverNow());physicalLocalPose=physicalSelf;if(physicalSelf)poses.set(S.you,physicalSelf);for(const k of S.karts){if(k.pid===S.you)continue;const pose=physicalPrediction?.remote(k.pid,nowMs(),serverNow());if(pose)poses.set(k.pid,pose);}
        const pickupPose=poses.get(S.you);pickupPrediction.update(myKart(),pickupPose?.physicalPose?.position||pickupPose,S.crates,S.phase==='drive'&&S.youDrive&&apiRef?.context?.().connected!==false);
        updateAudio();
        const effectDt=lastEffectTime===null?dt:Math.max(0,t-lastEffectTime);lastEffectTime=t;
        if(feedbackEpoch!==impactEpoch){
          impactFX.reset();skids.reset();drivingFX.reset();threats.clear();arsenalFX.reset();arsenalEvents.length=0;arena.resetHistory();impactEpoch=feedbackEpoch;
          for(const cue of shotCues)cue.object.visible=false;
          for(const e of combatEffects.values())returnMarker(e.mesh);
          combatEffects.clear();popSites.length=0;effectSeen.clear();
        }
        if(predictedPickup){popSites.push({x:predictedPickup.x,y:(predictedPickup.groundY||0)+1,z:predictedPickup.z,t,kind:'pickup'});predictedPickup=null;}
        impactFX.update(effectDt);skids.update(effectDt);drivingFX.update(effectDt,S.phase==='drive'&&S.youDrive?(physicalLocalPose?.speed??myKart()?.speed??0):0,S.phase==='drive'&&S.youDrive&&((physicalLocalPose?.turbo??myKart()?.turbo)>0||myKart()?.boost>0||myKart()?.nitroActive===true));arsenalFX.update(effectDt);
        while(arsenalEvents.length){const queued=arsenalEvents.shift();const age=Math.max(0,(nowMs()-queued.at)/1000);if(age>=.14)continue;const e=queued.event;
          if(e.type==='fire'&&e.weapon==='machinegun')combat.aim(karts.get(e.pid)?.userData.rig,e.direction);
          if(['fire','mine'].includes(e.type)&&e.pid===S.you&&echoedFireIds.has(e.id))continue;arsenalFX.event(e,age);arsenalFX.react(e,karts,age);}
        // Arena features: cannons, portals, fall zones (map.features + arenaEvents).
        structures.sync(S.map);structures.animate();
        arena.sync(S.map);arena.ingest(S.arenaEvents,S.karts);arena.animate(effectDt,t,S,poses);
        if(localFlash){
          if(nowMs()-localFlash.at<140){const e={type:'fire',pid:S.you,weapon:localFlash.kind,position:localFlash.position,direction:localFlash.direction};impactFX.emit(e,(nowMs()-localFlash.at)/1000);arsenalFX.event(e,(nowMs()-localFlash.at)/1000);arsenalFX.react(e,karts,(nowMs()-localFlash.at)/1000);}
          localFlash=null;
        }
        if(localRecoil){const rig=karts.get(S.you)?.userData.rig;if(rig){localRecoil=false;combat.recoil(rig);}}
        const acceptedEffects=feedback.current(nowMs());
        for(const cue of shotCues)if(cue.until<=nowMs())cue.object.visible=false;
        for(const e of acceptedEffects){if(effectSeen.has(e.id))continue;effectSeen.add(e.id);if(nowMs()-e.at>=140)continue;
          if(e.at>=impactSince&&e.position&&!(e.kind==='fire'&&e.pid===S.you&&echoedFireIds.has(e.sourceId))){impactFX.emit(e,(nowMs()-e.at)/1000);if(e.kind==='blast'&&e.weapon==='nuke'){const own=S.karts.find(k=>k.pid===S.you),p=own?.physicalPose?.position;if(own&&Math.hypot((p?.x??own.x)-e.position.x,(p?.y??0)-e.position.y,(p?.z??own.z)-e.position.z)<14)hitFx?.rumble?.();}}
          if(e.kind==='fire'&&!(e.pid===S.you&&echoedFireIds.has(e.sourceId)))combat.recoil(karts.get(e.pid)?.userData.rig);
          if((e.kind==='fire'||e.kind==='impact')&&e.position){
            let cue=null;
            for(const candidate of shotCues)if(candidate.kind===e.weapon&&(!cue||!candidate.object.visible||candidate.until<cue.until)){cue=candidate;if(!candidate.object.visible)break;}
            if(cue){
              const from=e.from||e.position;
              shotDirection.set(e.position.x-from.x,e.position.y-from.y,e.position.z-from.z);
              let length=shotDirection.length();
              if(length<1e-6&&e.direction){shotDirection.set(e.direction.x,e.direction.y,e.direction.z);length=.8;}
              if(shotDirection.lengthSq()>1e-8){
                shotDirection.normalize();length=Math.min(length,1.25);
                // Keep the accepted contact endpoint; never stretch one slug
                // over the whole final sweep like a solid orange road slab.
                const end=e.from?e.position:from;
                cue.object.position.set(end.x,end.y,end.z).addScaledVector(shotDirection,(e.from?-1:1)*length*.5);
                cue.object.quaternion.setFromUnitVectors(shotForward,shotDirection);
                cue.object.scale.set(1,1,length/Math.max(.01,cue.length));cue.until=Math.min(e.until,e.at+140);cue.object.visible=true;
              }
            }
          }
          if(e.kind==='ko'||(e.kind==='blast'&&!e.position)){
            if(!rm){if(popSites.length>=8)popSites.shift();popSites.push({x:e.position?.x??e.x,y:e.position?.y??((world.groundAt?.(e.x,e.z)||0)+.6),z:e.position?.z??e.z,t:t-(nowMs()-e.at)/1000,kind:e.kind});}
            if(e.kind==='ko'&&e.inferred&&e.pid===S.you&&e.weapon!=='nuke')audio?.cue('ko');
          }
          if((e.kind==='collision'||e.kind==='landing')&&e.pid===S.you)
            audio?.cue(e.kind,{strength:Math.min(1,(e.impulse||100)/1000)});
          if((e.kind==='blast'&&!e.position)||e.kind==='ko'){
            const mesh=takeMarker('blast');
            placeGroundMarker(mesh,e.x,e.z,groundAt);
            scene.add(mesh);combatEffects.set(e.id,{mesh,until:Math.min(e.until,e.at+140),at:e.at,kind:e.kind,size:e.kind==='blast'?BLAST_SCALE[e.weapon]||1:1});
          }
        }
        while(effectSeen.size>48)effectSeen.delete(effectSeen.values().next().value);
        for(const [id,e]of combatEffects){if(nowMs()>=e.until){returnMarker(e.mesh);combatEffects.delete(id);}else if(!rm){const progress=(nowMs()-e.at)/(e.until-e.at);e.mesh.scale.setScalar((.2+progress*.8)*e.size);placeGroundMarker(e.mesh,e.mesh.position.x,e.mesh.position.z,groundAt);}}
        live.clear();
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
          arena.dressKart(k,mesh,pose.flight);
          const surface=drivingSurfaceAt(mesh.position.x,mesh.position.z),sliding=kartSliding(k,pose,k.pid===S.you&&intentForPrediction().throttle<0);
          skids.track(k.pid,mesh.position.x,mesh.position.z,pose.angle,sliding,surface);
          if(mesh.visible&&S.phase==='drive')drivingFX.track(k.pid,mesh.position.x,mesh.position.y,mesh.position.z,pose.angle,pose.speed??k.speed,sliding,pose.driftCharge??k.driftCharge,surface,(pose.physicalPose||k.physicalPose)?.grounded!==false);
          healthBars.update(k.pid,k,mesh.position,(!S.youDrive||k.pid!==S.you)&&(S.players||S.participants||[]).find(p=>p.id===k.pid)?.connected!==false);
          if(!mesh.visible)healthBars.add(k.pid).visible=false;
          const equipped=equippedKartWeapon(k);
          if(mesh.userData.equipped!==equipped) {
            if(mesh.userData.rig){const old=mesh.userData.rig;old.removeFromParent();rigPools.get(old.userData.combat.kind)?.push(old);}
            mesh.userData.rig=equipped?rigPools.get(equipped)?.pop():null;
            mesh.userData.equipped=equipped;
            if(mesh.userData.rig) {const rig=mesh.userData.rig;combat.placeWeapon(rig);(mesh.userData.kart?.inner||mesh).add(rig);}
          }
          if(mesh.userData.rig){
            const equipment=mesh.userData.rig.userData.combat;
            equipment.ammo=k.ammo;equipment.active=k.bladesT>0;equipment.firing=k.firing;
            combat.animate(mesh.userData.rig,dt,t,rm);
          }
          if (mesh.userData.giggleKart && !lodProxied.has(mesh)) animateKartModel(mesh, {physicalPose: k.respawn>0 ? null : pose.physicalPose || k.physicalPose,
            speed:pose.speed ?? k.speed ?? 0, steer:k.pid === S.you ? intentFromState().steer : 0,driftHop:pose.driftHop??k.driftHop??0,drivingJuice:true,
            boost:Math.max(k.boost || 0,(pose.turbo??k.turbo) || 0,k.nitroActive===true?1:0),shield:k.shield>0||k.guard===true,invincible:false,dt,reducedMotion:rm});
          statusOptions.time=t;statusOptions.elapsed=Math.max(0,(nowMs()-(lastSnapshotArrival??nowMs()))/1000);statusOptions.groundRoot=!(k.physicalPose&&!(k.respawn>0));arsenalFX.status(mesh,k,statusOptions);
          if (mesh.userData.flame) mesh.userData.flame.visible = k.boost > 0 || (pose.turbo??k.turbo) > 0 || k.nitroActive === true || k.rammingT > 0;
          if (mesh.userData.shield) mesh.userData.shield.visible = (k.shield || 0) > 0;

        }
        let lodCount=0;
        for(const [pid,mesh]of karts)if(live.has(pid)){
          const entry=lodEntries[lodCount]||(lodEntries[lodCount]={});
          entry.mesh=mesh;entry.color=colorFor(pid);entry.visible=mesh.visible;lodCount++;
        }
        lodEntries.length=lodCount;
        lodProxied=kartLod.update(camera,lodEntries);
        let popCount=0;
        for (let i=popSites.length-1;i>=0;i--) if (t-popSites[i].t>= .14) popSites.splice(i,1);
        for (const site of popSites) {
          const age=Math.max(0,t-site.t);
          const reach=site.kind==='impact'?1.8:site.kind==='collision'?2.2:6;
          for (let i=0;i<8;i++) {
            const angle=i*Math.PI/4;
            const fade=Math.max(0,1-age/.14);sparkMatrix.makeScale(fade,fade,fade);
            sparkMatrix.setPosition(site.x+Math.sin(angle)*age*reach,site.y+Math.sin(age*Math.PI/.14)*(site.kind==='impact'?.5:1.7),site.z+Math.cos(angle)*age*reach);
            pops.setMatrixAt(popCount++,sparkMatrix);
          }
        }
        pops.count=popCount; if(popCount) pops.instanceMatrix.needsUpdate=true;
        for (const [pid, mesh] of karts) {
          if (!live.has(pid)) {
            scene.remove(mesh);
            karts.delete(pid);
            healthBars.remove(pid);skids.forget(pid);drivingFX.forget(pid);
          }
        }
        // Stars: sync set, spin unless reduced motion.
        liveS.clear();
        for(const s of S.stars||[])liveS.add(s.id);
        for(const [id,mesh]of stars)if(!liveS.has(id)){returnMarker(mesh.userData.zone);starPool.release(mesh);stars.delete(id);}
        for (const s of S.stars || []) {
          liveS.add(s.id);
          let group = stars.get(s.id);
          if (!group) {
            group = starPool.take();
            if(!group)continue;
            const zone = takeMarker('star');
            placeGroundMarker(zone,s.x,s.z,groundAt);
            scene.add(zone);group.userData.zone=zone;
            group.position.set(s.x, s.groundY??s.y??world.groundAt?.(s.x,s.z)??0, s.z);
            scene.add(group);
            stars.set(s.id, group);
          }
          if (!rm) {
            group.userData.gem.rotation.y += dt * 1.3;
            group.userData.gem.position.y = 1.5 + Math.sin(t*2.2 + s.id.length)*0.14;
          }
        }
        // Crates: sync set, static boxes with the honest pickup ring.
        liveC.clear();
        for(const c of S.crates||[])liveC.add(c.id);
        for(const [id,mesh]of crates)if(!liveC.has(id)){returnMarker(mesh.userData.zone);cratePool.release(mesh);crates.delete(id);}
        for (const c of S.crates || []) {
          liveC.add(c.id);
          if (!crates.get(c.id)) {
            const group = cratePool.take();
            if(!group)continue;
            const zone = takeMarker('crate');
            placeGroundMarker(zone,c.x,c.z,groundAt);
            scene.add(zone);group.userData.zone=zone;
            group.position.set(c.x, c.groundY??world.groundAt?.(c.x,c.z)??0, c.z);
            scene.add(group);
            crates.set(c.id, group);
          }
          const box=crates.get(c.id);box.visible=!pickupPrediction.hidden(c.id);box.userData.zone.visible=box.visible;combat.animate(box.userData.capsule,dt,t,rm);
        }
        // Authoritative velocity at the calibrated clock. No chasing packet
        // positions: easing fast shots made them visibly slow and jerky.
        shotPlayback.setDelay(physicalPrediction?.remoteDelay()??100);
        liveZ.clear();
        const currentZ=(ordnanceFresh()?S.zaps:[])||[];
        for(const z of currentZ)liveZ.add(z.id);
        for(const [id,mesh]of zaps)if(!liveZ.has(id)){impactFX.retire(mesh);mesh.visible=false;mesh.removeFromParent();shotPools.get(mesh.userData.combat.kind)?.push(mesh);zaps.delete(id);}
        for (const z of currentZ) {
          liveZ.add(z.id);
          let mesh = zaps.get(z.id);
          if (!mesh) {
            mesh = shotPools.get(z.kind)?.pop()||combat.projectile(z.kind);
            mesh.userData.combat.trailClock=0;mesh.userData.combat.trailX=Infinity;
            mesh.position.set(z.x, 0.7, z.z);
            scene.add(mesh);
            zaps.set(z.id, mesh);
          }
          const flight=shotPlayback.sample(z,S,ordnanceNow(),mesh.userData.flight);
          mesh.position.set(flight.x,flight.y,flight.z);
          if(flight.direction){shotDirection.set(flight.direction.x,flight.direction.y,flight.direction.z).normalize();mesh.quaternion.setFromUnitVectors(shotForward,shotDirection);}
          else mesh.rotation.y=flight.angle;
          if(z.physical===true){
            const radius=Number.isFinite(z.radius)&&z.radius>0?z.radius:0;
            if(mesh.userData.combat.contactRadius!==radius)prepareShotContact(mesh,z.kind,radius);
            const c=mesh.userData.combat;
            mesh.position.addScaledVector(tmpV.copy(shotForward).applyQuaternion(mesh.quaternion),radius-(c.tipZ||0)-c.contactInset);
          }
          mesh.visible=flight.visible;combat.animate(mesh,dt,t,rm);impactFX.trail(mesh,dt);
        }
        for (const [zid, mesh] of zaps) {
          if (!liveZ.has(zid)) {
            impactFX.retire(mesh);mesh.visible=false;mesh.removeFromParent();
            const pool=shotPools.get(mesh.userData.combat?.kind);if(pool)pool.push(mesh);else scene.remove(mesh);
            zaps.delete(zid);
          }
        }
        liveG.clear();const currentG=(ordnanceFresh()?S.grenades:[])||[];
        for(const g of currentG)liveG.add(g.id);
        for(const[id,group]of grenades)if(!liveG.has(id)){impactFX.retire(group.userData.body);if(group.userData.ring)returnMarker(group.userData.ring);group.userData.ring=null;group.visible=false;group.removeFromParent();grenadePools.get(group.userData.poolKey).push(group);grenades.delete(id);}
        for(const g of currentG){liveG.add(g.id);let group=grenades.get(g.id);
          if(!group){const kind=g.kind==='frost'?'frost':'nuke';group=grenadePools.get(kind).pop();group.visible=true;const c=group.userData.body.userData.combat;c.trailClock=0;c.trailX=c.trailY=c.trailZ=Infinity;
            // Only the Nuke marks its knockout radius on the ground.
            const ring=kind==='nuke'?takeMarker('nuke'):null;group.userData.ring=ring;scene.add(group);grenades.set(g.id,group);}
          const flight=grenadePose(g,S,ordnanceNow());group.position.set(flight.x,flight.y+(g.physical ? .45 : .38),flight.z);group.rotation.y=flight.angle;group.visible=flight.visible;
          combat.animate(group.userData.body,dt,t,rm);if(!flight.visible)impactFX.retire(group.userData.body);if(flight.visible)impactFX.trail(group.userData.body,dt,group.position);if(group.userData.ring){placeGroundMarker(group.userData.ring,flight.x,flight.z,groundAt);group.userData.ring.visible=flight.visible&&g.warning===true;}
        }
        for(const[id,group]of grenades)if(!liveG.has(id)){impactFX.retire(group.userData.body);if(group.userData.ring)returnMarker(group.userData.ring);group.visible=false;grenadePools.get(group.userData.poolKey).push(group);grenades.delete(id);}
        liveM.clear();const currentM=groundMines();
        for(const m of currentM)liveM.add(m.id);
        for(const[id,mesh]of mines)if(!liveM.has(id)){mesh.visible=false;mesh.removeFromParent();minePools.get(mesh.userData.poolKey).push(mesh);mines.delete(id);}
        for (const m of currentM) {
          liveM.add(m.id);
          let mesh = mines.get(m.id);
          if(!mesh){const key=(m.kind||'mine')+':'+(m.owner===S.you);mesh=minePools.get(key).pop();mesh.visible=true;scene.add(mesh);mines.set(m.id,mesh);}
          mesh.userData.prop.userData.combat.armed=m.armed;
          placeGroundProp(THREE,mesh,m.x,m.y??groundAt(m.x,m.z),m.z,groundAt,world.propGroundAt||groundAt);
          combat.animate(mesh.userData.prop,dt,t,rm);
        }
        for (const [id,mesh] of mines) if (!liveM.has(id)) {mesh.visible=false;minePools.get(mesh.userData.poolKey).push(mesh);mines.delete(id);}
        // Camera: a steeper follow view keeps several pickups plus useful
        // arena in frame; spectators get a tighter overview (no half-empty
        // horizon). Built from the shared forwardOf — the camera sits
        // directly behind the motion direction, never fighting the input.
        const me = myKart();
        const selfPose = me ? poses.get(me.pid) : null;
        arsenalFX.target(ordnanceFresh()?S:null,karts,camera);
        camera.position.sub(shakeOffset);shakeOffset.set(0,0,0);
        if (me && S.youDrive && selfPose) {
          const pose = selfPose;
          const f = forwardOf(pose.angle);
          const portrait = camera.aspect < 0.8;
          const back = portrait ? 10 : 8.8;
          const up = portrait ? 4.2 : 3.2;
          const chassisY=pose.physicalPose?.position.y??me.physicalPose?.position.y??((world.groundAt?.(pose.x,pose.z)||0)+.75);
          const slide=pose.slip??me.slip??0;
          const swing=rm?0:Math.max(-1.15,Math.min(1.15,-slide*.13));
          driftSwing+=(swing-driftSwing)*(1-Math.exp(-dt*5));
          const cameraX=pose.x-f.x*back+f.z*driftSwing,cameraZ=pose.z-f.z*back-f.x*driftSwing;
          tmpV.set(cameraX,Math.max(chassisY+up-.75,(world.groundAt?.(cameraX,cameraZ)||0)+1.2),cameraZ);
          // Use the chassis as the clear anchor, including the dressed path
          // through a cannon mouth. A look-ahead point can be beyond a wall.
          const model=karts.get(me.pid);
          if(model)cameraFocus.copy(model.position);else cameraFocus.set(pose.x,chassisY,pose.z);
          let cramped=cameraCollision.constrain(tmpV,cameraFocus);
          // Portrait needs more room for a side-on kart during launch recovery.
          const flying=!!(pose.flight||me.flight),minimumCameraDistanceSq=flying?(portrait?64:36):25;
          const orbitClearanceSq=flying?minimumCameraDistanceSq:36;
          // At a rear wall a simple pull-in can put the eye inside the kart.
          // Prefer a clear side of the same chase orbit, retaining that side
          // until the rear is clear so contact does not flicker left/right.
          // At a cannon muzzle only the forward half of the orbit may clear
          // the lip; use it briefly rather than pulling inside the kart.
          // Low cover can hide the wheels/body while the centre ray is clear.
          const lowCover=(S.map?.barriers||[]).some(b=>Math.abs(pose.x-b.x)<b.hw+3&&Math.abs(pose.z-b.z)<b.hd+3);
          if(lowCover&&!pose.flight&&!me.flight&&!cramped&&model)model.updateMatrixWorld(true);
          const hidden=lowCover&&!pose.flight&&!me.flight&&!cramped&&model&&!cameraCollision.visible(tmpV,model);
          if(cramped&&tmpV.distanceToSquared(cameraFocus)<minimumCameraDistanceSq||hidden){
            let chosen=0;
            for(let pass=0;pass<(cameraSide?2:1)&&!chosen;pass++)for(const angle of cameraAngles){
              if(cameraSide&&(pass===0?Math.sign(angle)!==cameraSide:Math.sign(angle)===cameraSide))continue;
              const sin=Math.sin(angle),cos=Math.cos(angle),x=-f.x*back,z=-f.z*back;
              cameraCandidate.set(cameraFocus.x+x*cos+z*sin,Math.max(chassisY+up-.75,cameraFocus.y+2),cameraFocus.z+z*cos-x*sin);
              cameraCollision.constrain(cameraCandidate,cameraFocus);
              if(cameraCandidate.distanceToSquared(cameraFocus)>orbitClearanceSq&&(!hidden||cameraCollision.visible(cameraCandidate,model))){tmpV.copy(cameraCandidate);chosen=angle;break;}
            }
            cameraSide=chosen?Math.sign(chosen):0;
          }else cameraSide=0;
          // A portal jump is a pose-epoch change: cut, never sweep across the map.
          const camLife=me.spawnSeq+':'+(pose.physicalPose?.epoch??'');
          if (rm || cameraEpoch !== camLife) camera.position.copy(tmpV);
          else camera.position.lerp(tmpV, 1-Math.exp(-dt*12));
          cramped=cameraCollision.constrain(camera.position,cameraFocus)||cramped;
          // A straight blend between opposite clear orbits may cut through
          // the tube. Switch to the clear orbit before the eye enters the kart.
          // The desired eye can be clear before a launch's eased eye has
          // left the tube. Recover even after the side-orbit flag clears.
          if((cameraSide||flying)&&tmpV.distanceToSquared(cameraFocus)>orbitClearanceSq&&(camera.position.distanceToSquared(cameraFocus)<minimumCameraDistanceSq||hidden&&!cameraCollision.visible(camera.position,model)))camera.position.copy(tmpV);
          cameraEpoch = camLife;
          const lookX=pose.x+f.x*5,lookZ=pose.z+f.z*5;
          cameraLook.set(lookX,Math.max(chassisY+.85,(world.groundAt?.(lookX,lookZ)||0)+.8),lookZ);
          const recoveringSide=flying&&Math.abs((camera.position.x-cameraFocus.x)*f.z-(camera.position.z-cameraFocus.z)*f.x)>back*.15;
          if(cameraSide||recoveringSide){cameraLook.copy(cameraFocus);cameraLook.y+=.6;}
          else if(cramped)cameraLook.lerp(cameraFocus,Math.max(0,1-camera.position.distanceTo(cameraFocus)/5));
          camera.lookAt(cameraLook);
        } else {
          const half = S.map?.half || 30;
          tmpV.set(0, half*1.4, half*.9);
          if (rm) camera.position.copy(tmpV);
          else camera.position.lerp(tmpV, Math.min(1, dt * 2));
          camera.lookAt(0, 0, 0);
        }
        const boosting=(selfPose?.turbo??me?.turbo)>0||me?.boost>0||me?.nitroActive===true;
        const targetFov=rm||!S.youDrive||S.phase!=='drive'?60:60+Math.min(5,Math.max(0,(Math.abs(selfPose?.speed??me?.speed??0)-14)*.4))+(boosting?4:0);
        const nextFov=rm?60:camera.fov+(targetFov-camera.fov)*(1-Math.exp(-dt*5));
        setKartCameraLens(camera, nextFov, S.youDrive);
        const shake=hitFx?.shake(nowMs());
        if(shake&&(shake.x||shake.y)){
          beforeShake.copy(camera.position);shakeOffset.set(shake.x,shake.y,0).applyQuaternion(camera.quaternion);camera.position.add(shakeOffset);
          if(me&&S.youDrive&&selfPose)cameraCollision.constrain(camera.position,cameraFocus);
          shakeOffset.copy(camera.position).sub(beforeShake);
        }
        const ownKart=me&&S.youDrive&&!(me.respawn>0)?karts.get(me.pid):null;
        threats.update(ordnanceFresh()?S:null,S.you,S.phase==='drive'?ownKart?.position:null,camera,nowMs(),currentM);
        healthBars.face(camera);
        objectives.update(S,karts,camera,t,rm);
        if (typeof hooks.sceneExtra === 'function') {
          try { hooks.sceneExtra(THREE, { scene, camera, poses, S, dt }); } catch { /* game-owned extra must not break frames */ }
        }
      };
      return { scene, camera, frame, dispose: () => {warmup?.cancel();if(rendererWarmup===warmup)rendererWarmup=null;cameraCollision.dispose();garageThumbnail?.dispose();objectives.dispose();world.dispose();disposeLighting?.();disposeCombat?.();healthBars.dispose();impactFX.dispose();arsenalFX.dispose();arsenalEvents.length=0;arena.dispose();structures.dispose();skids.dispose();drivingFX.dispose();threats.dispose();} };
    } catch (error) {
      warmup?.cancel();if(rendererWarmup===warmup)rendererWarmup=null;
      cameraCollision?.dispose();
      garageThumbnail?.dispose();
      world?.dispose();
      if (disposeLighting) disposeLighting();
      if (disposeCombat) disposeCombat();
      healthBars?.dispose();objectives?.dispose();
      impactFX?.dispose();structures?.dispose();skids?.dispose();drivingFX?.dispose();threats?.dispose();
      helper.disposeObject(scene);
      throw error;
    }
  }

/* ---------------- 2D fallback (same snapshots, top-down) ---------------- */

  function startFallback(note, canRetry = true) {
    stopFallback(); // drop any previous fallback loop/listeners first
    disposeGl();
    showGlNote('');
    const roomMenu = document.getElementById('roomMenu');
    if (canRetry) {
      const retry = document.createElement('button');
      retry.id = 'pk-retry3d'; retry.type = 'button'; retry.className = 'btn ghost';
      retry.textContent = 'Retry 3D';
      const menuPanel = roomMenu?.querySelector('.room-menu-panel') || rootEl.querySelector('.pk-helpbody');
      menuPanel?.appendChild(retry);
      const retryAction = () => {
        if (roomMenu) roomMenu.open = false;
        const help = rootEl?.querySelector('#pk-help');
        if (help) help.open = false;
        glAction('retry3d');
      };
      retry.addEventListener('click', retryAction);
      fbBound.push([retry, 'click', retryAction]);
    }
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
    note2.textContent = canRetry ? `Top-down view · Retry 3D in ${roomMenu ? 'menu' : 'controls'}.` : note;
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
    document.querySelector('#pk-retry3d')?.remove();
    if (fbCanvas) { try { fbCanvas.remove(); } catch { /* noop */ } fbCanvas = null; }
  }

  function drawFallback() {
    if (!fbCanvas || !S) return;
    flushPhysical();
    shotPlayback.setDelay(physicalPrediction?.remoteDelay()??100);
    const ctx = fbCanvas.getContext('2d');
    if (!ctx) return;
    // SAME shared poses as WebGL (predicted self, eased remotes) — one
    // behavior in both renderers, not a separate snapshotted drawing.
    const now = nowMs();
    const dt = fbLastT ? (now - fbLastT) / 1000 : 0.016;
    fbLastT = now;
    const poses = framePoses(poseStore, S, intentForPrediction(), dt, now, { reducedMotion: reducedMotion(), map: S.map, serverNow: serverNow() });
    const physicalSelf=physicalPrediction?.frame(S,intentForPrediction(),dt,now,serverNow());physicalLocalPose=physicalSelf;if(physicalSelf)poses.set(S.you,physicalSelf);for(const k of S.karts){if(k.pid===S.you)continue;const pose=physicalPrediction?.remote(k.pid,nowMs(),serverNow());if(pose)poses.set(k.pid,pose);}
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
    if(S.map?.roads)drawArenaRoads2d(ctx,S.map,px,pz,scale);
    else{ctx.fillStyle = css(pal.track);ctx.fillRect(px(-arena), pz(-arena), arena * 2 * scale, arena * 2 * scale);}
    for (const patch of (S.map?.surfaces || [])) {
      ctx.fillStyle = '#b8f2ff';
      ctx.fillRect(px(patch.x-patch.hw), pz(patch.z-patch.hd), patch.hw*2*scale, patch.hd*2*scale);
      ctx.strokeStyle = '#e8fcff'; ctx.lineWidth = 2;
      ctx.strokeRect(px(patch.x-patch.hw), pz(patch.z-patch.hd), patch.hw*2*scale, patch.hd*2*scale);
    }
    drawArenaFeatures2d(ctx,S.map,px,pz,scale);
    drawArenaStructures2d(ctx,S.map,px,pz,scale);
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
    // Objective locations stay visible when WebGL is unavailable, including
    // for spectators. Use the same authority colours and A/B team symbols.
    if (S.teamMode) for (const base of S.bases || []) {
      const team = (S.teams || []).find(team => team.id === base.teamId);
      if (!team) continue;
      const x = px(base.position.x), z = pz(base.position.z);
      ctx.strokeStyle = css(team.color); ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(x, z, Math.max(9, 2.8 * scale), 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = css(team.color); ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(`${team.id === 'blue' ? 'A' : 'B'} base`, x, z + Math.max(19, 4.3 * scale));
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
    for (const z of (ordnanceFresh()?S.zaps:[]) || []) {
      const p=shotPlayback.sample(z,S,ordnanceNow(),{direction:{}});if(!p.visible)continue;
      ctx.strokeStyle=z.kind==='trishot'?'#ffad69':z.kind==='cannon'?'#ffda58':z.kind==='missile'?'#91d451':'#6af0ff';ctx.lineWidth=Math.max(2,.35*scale);
      const angle=Number.isFinite(z.vx)&&Number.isFinite(z.vz)?Math.atan2(z.vx,z.vz):p.angle;
      ctx.beginPath();ctx.moveTo(px(p.x),pz(p.z));ctx.lineTo(px(p.x-Math.sin(angle)*2),pz(p.z-Math.cos(angle)*2));ctx.stroke();
    }
    if(localFlash){
      if(nowMs()-localFlash.at<100){ctx.fillStyle='#fff3a0';ctx.beginPath();ctx.arc(px(localFlash.position.x),pz(localFlash.position.z),Math.max(3,scale*.6),0,Math.PI*2);ctx.fill();}else localFlash=null;
    }
    for (const m of groundMines()) {
      if(m.kind==='fakecrate'){
        const size=Math.max(6,1.8*scale);
        ctx.fillStyle='#80ffe0';ctx.fillRect(px(m.x)-size/2,pz(m.z)-size/2,size,size);
        ctx.fillStyle='#172639';ctx.font=`bold ${Math.max(8,1.2*scale)}px sans-serif`;ctx.textAlign='center';ctx.fillText('?',px(m.x),pz(m.z)+Math.max(3,.5*scale));
        continue;
      }
      ctx.fillStyle = m.kind==='proximity'?'#fa534c':m.armed ? '#ff83b8' : '#91627a'; ctx.beginPath();
      ctx.arc(px(m.x),pz(m.z),Math.max(3,(m.kind==='proximity'?1.3:.9)*scale),0,Math.PI*2); ctx.fill();
      ctx.fillStyle=m.armed&&Math.sin(now/150)>0?'#ffeaa0':'#402835';ctx.fillRect(px(m.x)-1,pz(m.z)-1,2,2);
    }
    for(const g of (ordnanceFresh()?S.grenades:[])||[]){const p=grenadePose(g,S,ordnanceNow());if(!p.visible)continue;
      if(g.warning){ctx.strokeStyle='#e65832';ctx.lineWidth=2;ctx.beginPath();ctx.arc(px(p.x),pz(p.z),14*scale,0,Math.PI*2);ctx.stroke();}
      ctx.fillStyle='#ffd458';ctx.fillRect(px(p.x)-.4*scale,pz(p.z)-.6*scale-p.y*scale,.8*scale,1.2*scale);
      ctx.strokeStyle='#25354b';ctx.lineWidth=1;ctx.strokeRect(px(p.x)-.4*scale,pz(p.z)-.6*scale-p.y*scale,.8*scale,1.2*scale);
    }
    const acceptedEffects=feedback.current(now);
    for(const e of acceptedEffects){const age=Math.max(0,(now-e.at)/1000);if(age>=.14)continue;ctx.strokeStyle=e.kind==='collision'?'#ffe3a1':'#ff963d';ctx.lineWidth=2;
      ctx.beginPath();ctx.arc(px(e.x),pz(e.z),Math.max(1,(e.kind==='blast'?4*(BLAST_SCALE[e.weapon]||1):1+age*5))*scale,0,Math.PI*2);ctx.stroke();
    }
    for (const k of S.karts || []) {
      if (k.out || k.connected === false) continue;
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
      const team = S.teamMode && (S.teams || []).find(team => team.id === S.teamByPlayer?.[k.pid]);
      if (team && !(k.respawn > 0)) {
        const x = px(pose.x) + Math.max(9, 2.4 * scale), z = pz(pose.z) - Math.max(8, 2.2 * scale);
        ctx.fillStyle = css(team.color);
        if (team.id === 'blue') {ctx.beginPath(); ctx.arc(x, z, 7, 0, Math.PI * 2); ctx.fill();}
        else ctx.fillRect(x - 7, z - 7, 14, 14);
        ctx.fillStyle = '#102132'; ctx.font = 'bold 10px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(team.id === 'blue' ? 'A' : 'B', x, z + 3);
      }
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
    if (S.teamMode) for (const flag of S.flags || []) {
      const team = (S.teams || []).find(team => team.id === flag.teamId);
      if (!team) continue;
      const carrier = flag.state === 'carried' && (S.karts || []).find(kart => kart.pid === flag.carrierId && !kart.out && kart.connected !== false && !(kart.respawn > 0));
      const point = carrier ? poseOf(carrier) : flag.position;
      if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.z)) continue;
      const x = px(point.x) + (carrier ? Math.max(6, 1.6 * scale) : 0), z = pz(point.z);
      const size = Math.max(10, 2 * scale);
      ctx.strokeStyle = '#fff4e3'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x, z + size * .6); ctx.lineTo(x, z - size); ctx.stroke();
      ctx.fillStyle = css(team.color); ctx.fillRect(x, z - size, size * 1.3, size * .9);
      ctx.fillStyle = '#102132'; ctx.font = 'bold 9px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(team.id === 'blue' ? 'A' : 'B', x + size * .65, z - size * .3);
      if (flag.state === 'dropped') {
        ctx.strokeStyle = css(team.color); ctx.setLineDash([3, 2]);
        ctx.beginPath(); ctx.arc(x, z, size * 1.5, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
      }
    }
  }

  return { ownsTimer: true, styles: ['/css/kart-arena.css'], mount, update, dispose,
    async ready() {
      await sceneReady;
      await physicalReady;
      // Hidden same-origin seats may have throttled RAF. Render the current
      // prepared scene once, then require the same real GL success promise.
      if (gl) { gl.renderOnce?.(); await gl.firstFrame; }
      else if (!fbCanvas?.getContext('2d')) throw new Error('No usable kart renderer');
    } };

  /* ---------------- lifecycle ---------------- */

  function disposeGl() {
    rendererWarmup?.cancel();rendererWarmup=null;
    if (gl) {
      try { gl.dispose(); } catch { /* noop */ }
      gl = null;
    }
    sceneState = null;
    resetPoseStore(poseStore);
  }

  function disposeAll() {
    physicalPrediction?.dispose();physicalPrediction=null;physicalReady=null;physicalSeq=0;physicalLocalPose=null;physicalPending=null;localFlash=null;shotPlayback.reset();
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
    audio?.dispose();audio=null;startAudio=null;wasTurbo=false;
    garageUI.dispose();
    garagePending=null;arenaPicker.reset();
    for (const [t, type, fn, opts] of bound) {
      try { t.removeEventListener(type, fn, opts); } catch { /* noop */ }
    }
    bound = [];
    disposeGl();
    hitFx?.dispose();hitFx=null;
    S = null;lastSnapshotArrival=null;snapshotOffset=null;
    releaseFirstSnapshot?.();releaseFirstSnapshot=null;
    radarCanvas=null;radarAt=-Infinity;radarMap=null;
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
    seenEvents = new Set(); arenaSeen = new Set(); firstEvents = true; cueUntil = 0; cueText = '';
    sceneState = null;
    resetPoseStore(poseStore);
  }

  function mount(el, api) {
    disposeAll();
    mountGen += 1;
    ensureKartCss();
    apiRef = api;
    rootEl = el;
    firstSnapshot=new Promise(resolve=>{releaseFirstSnapshot=resolve;});
    audio=createKartAudio({muted:api.context?.().sound===false});
    // Optional recordings start after every seat has its required scene and
    // physics. They keep their existing gesture, mute and decode lifecycle.
    startAudio=()=>{audio?.prep?.();shellAudioReady=api.audioPrepare?.();Promise.allSettled([audio?.ready?.(),shellAudioReady]);startAudio=null;};
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
    hitFx=createKartHitFeedback(rootEl.querySelector('.pk'),{reducedMotion});
    try { const pref=localStorage.getItem('pk-controls-v1'); controlsPreference=['auto','keyboard','touch'].includes(pref)?pref:'auto'; } catch { controlsPreference='auto'; }
    wirePickers(rootEl);
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
          localFireCue();
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
        localFireCue();
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

  /* Arena feature events (classic arenas): cannon boom/whoosh, landing
   * thud, portal swirl and the fall splash, voiced near the local driver;
   * a fall by the local driver also shows the "Fell!" notice. */
  function noteArenaEvents(api, quiet) {
    for (const e of S?.arenaEvents || []) {
      if (arenaSeen.has(e.id)) continue;
      arenaSeen.add(e.id);
      if (quiet) continue;
      const me = myKart(), mine = e.pid === S.you;
      const at = e.type === 'warp' ? e.from : e;
      const distance = me && at && Number.isFinite(at.x) ? Math.hypot(me.x - at.x, me.z - at.z) : 0;
      const gain = mine || !S.youDrive ? 1 : Math.max(0, 1 - distance / 40);
      if (gain > .08) audio?.arenaCue?.(e.type, { gain });
      if (mine && e.type === 'fell') {
        cueText = S.mode === 'battle' ? 'Fell! −1 KO · back in a moment' : 'Fell! −1 star';
        cueUntil = nowMs() + 2600; hitFx?.hurt(nowMs()); hitFx?.notice?.(S.mode === 'battle' ? 'Fell! −1 KO' : 'Fell! −1 star');
        api.announce('Fell! You lose one point.');
      }
    }
    while (arenaSeen.size > 48) arenaSeen.delete(arenaSeen.values().next().value);
  }

  function update(el, Snew, api) {
    if(S?.instanceId!=null&&S.instanceId===Snew?.instanceId&&S.phase==='done'&&Snew.phase!=='done')return;
    if(S?.instanceId===Snew?.instanceId&&(
      Number.isFinite(S?.simTick)&&Number.isFinite(Snew?.simTick)&&Snew.simTick<S.simTick||
      Number.isFinite(S?.simAt)&&Number.isFinite(Snew?.simAt)&&Snew.simAt<S.simAt))return;
    if(S?.phase!==Snew.phase||S?.preparing!==Snew.preparing)snapshotOffset=null;
    if(S?.instanceId!==Snew.instanceId||S?.map?.id!==Snew.map?.id){snapshotOffset=null;shotPlayback.reset();localFlash=null;physicalPending=null;}
    const advanced=!S||Snew.instanceId!==S.instanceId||(!Number.isFinite(Snew.simTick)&&!Number.isFinite(Snew.simAt))||Snew.simTick!==S.simTick||Snew.simAt!==S.simAt;
    const life=state=>`${state?.instanceId}:${state?.you}:${state?.inputAck?.life}:${state?.inputAck?.controlEpoch}`;
    if(Snew?.audioBaseline||!S||Snew.instanceId!==S.instanceId||(Number.isFinite(S.simAt)&&Number.isFinite(Snew?.simAt)&&Snew.simAt-S.simAt>150)){
      firstEvents=true;feedback.reset();seenEvents.clear();feedbackEpoch++;
    }else if(life(Snew)!==life(S)){
      feedback.clearPresentation();feedbackEpoch++;localFlash=null;localFires.length=0;echoedFireIds.clear();localRecoil=false;
    }
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
    releaseFirstSnapshot?.();releaseFirstSnapshot=null;
    // Defer optional recordings until all seats finish loading.
    if(!S.preparing)startAudio?.();
    pickupPrediction.sync(S.instanceId,S.inputAck?.life??myKart()?.spawnSeq);
    if(advanced||Snew.audioBaseline){
      const arrival=nowMs();
      // Arrival alone would give a delayed packet a brand-new visual lease.
      if(Number.isFinite(S.simAt)){
        const offset=arrival-S.simAt;snapshotOffset=snapshotOffset===null?offset:Math.min(snapshotOffset,offset);
        lastSnapshotArrival=Math.min(arrival,S.simAt+snapshotOffset);
      }else lastSnapshotArrival=arrival;
    }
    if(S.motionProfile&&!physicalReady){const gen=mountGen;physicalReady=loadClassicPhysics().then(R=>{if(gen!==mountGen)return;physicalPrediction=createClassicPrediction(R);physicalPrediction.ingest(S,nowMs(),serverNow());});}
    if(S.motionProfile&&physicalPrediction&&S.inputAck?.life!==physicalPrediction.life){atomicStop();physicalPrediction.life=S.inputAck?.life;}
    const receivedAt=nowMs(),receivedServerAt=serverNow();
    physicalPrediction?.observe(S,receivedAt,receivedServerAt);
    if(physicalPrediction)physicalPending={snapshot:S,now:receivedAt,serverAt:receivedServerAt};
    shotPlayback.ingest(S.zaps,S.simAt);
    // Authoritative snapshot: reconcile prediction (self) and retarget
    // remotes. Clears the local boost carry — the snapshot's boost state
    // (adopted above) now drives visuals. Bounded: one flag, one tick.
    predictBoost = false;
    if(pulseHoldLife!==null&&pulseHoldLife!==pulseLife())pulseHoldLife=null;
    if(firstEvents){const me=myKart();wasTurbo=me?.boost>0||me?.turbo>0||me?.nitroActive===true;}
    if(S.audioBaseline){cueUntil=0;cueText='';}
    updateAudio();
    feedback.ingest(S,lastSnapshotArrival??nowMs());
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
      if(['fire','mine','blast','burst','bounce','splat','hit'].includes(event.type)){arsenalEvents.push({event,at:lastSnapshotArrival??nowMs()});if(arsenalEvents.length>24)arsenalEvents.shift();}
      updateAudio();
      const me=myKart(),source=S.karts?.find(k=>k.pid===event.pid);
      const nearby=!S.youDrive||event.pid===S.you||event.other===S.you||
        (me&&source&&Math.hypot(me.x-source.x,me.z-source.z)<24);
      const echoed=event.pid===S.you&&(['fire','mine'].includes(event.type)&&claimLocalFire(event)||event.type==='pickup'&&pickupPrediction.accept(event.crateId));
      if(echoed&&event.weapon!=='machinegun'&&['fire','mine'].includes(event.type)){echoedFireIds.add(event.id);if(echoedFireIds.size>64)echoedFireIds.delete(echoedFireIds.values().next().value);}
      if(event.type==='hit'&&event.pid===S.you&&event.weapon==='ram')audio?.cue('hitDing');
      if(nearby&&!echoed&&!(event.type==='ko'&&event.weapon==='nuke')){const cue=kartEventCue(event,S.you);if(cue)audio?.cue(cue);}
      if (event.pid !== S.you && event.other !== S.you) continue;
      const mineEvent = event.pid === S.you;
      if(event.other===S.you&&event.type==='hit')hitFx?.hurt(nowMs());
      if(event.other===S.you&&event.type==='ko')hitFx?.notice('KO!');
      if(mineEvent&&event.other&&event.other!==S.you&&['hit','ko','block'].includes(event.type))hitFx?.landed(landedText(event));
      if(mineEvent&&event.type==='ko'&&event.other&&event.other!==S.you)hitFx?.knockout(nameOf(event.other));
      if (event.type === 'pickup' && mineEvent) {
        pickupPrediction.accept(event.crateId);
        const label = WEAPON_DISPLAY[event.weapon]?.label || 'Item';
        cueText = `${label} ready`;
      } else cueText = event.type === 'ko' ? (mineEvent ? `Knockout! ${nameOf(event.other)}` : `${nameOf(event.pid)} got you · back in a moment`)
        : event.type === 'hit' && !mineEvent ? `${nameOf(event.pid)} hit you · −${event.damage||1} HP`
        : event.type === 'block' && !mineEvent ? 'Shield blocked a hit'
        : event.type === 'respawn' ? 'Back in with full HP'
        : event.type === 'shield' ? 'Shield ready · blocks the next hit' : '';
      if (cueText) { cueUntil = nowMs()+2400; api.announce(cueText); }
    }
    noteArenaEvents(api, firstEvents);
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

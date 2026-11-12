/* Giggle Karts runtime vehicle models (pure Three.js, no DOM).
 *
 * Clones the GLB templates root loads (assets.kart/star/crate are the
 * loaded glTF scenes) into per-driver instances. Cloning shares
 * geometries and materials across every kart EXCEPT the KartPaint
 * material, which is cloned once per kart and recolored per driver.
 *
 * Conventions (authored by scripts/build-kart-assets.py, verified in the
 * GLB by vehicle-stats.json):
 * - Kart nose points +Z at yaw 0; ground is y=0; origin under the kart.
 * - Pivots: FrontSteer_L/R (rotation.y steer) -> WheelSpin_* (rotation.x
 *   spin, +x rolls forward) -> WheelMesh_*. KartBody carries every
 *   non-wheel mesh; lean applies to KartBody only, NEVER to the root.
 * - Wheel rolling radii: front 0.385, rear 0.465 (hub height = tread
 *   contact radius).
 *
 * animateKartModel is cosmetic only: wheel spin, steer smoothing, subtle
 * chassis lean, boost flame and respawn shield. It sends no gameplay, it
 * never touches the root group's rotation, and it allocates no
 * geometries/materials (shared flame/shield resources are built once per
 * process and reused by every kart).
 */

import {KART_LOOK_DRIVERS} from './kart-looks.mjs';
import {KART_PHYSICS_CONFIG as CONFIG} from './kart-physics-config.mjs';

const PAINT_NAME = 'KartPaint';

const SPIN_KEYS = ['FL', 'FR', 'RL', 'RR'];
const SPIN_RADIUS = { FL: 0.385, FR: 0.385, RL: 0.465, RR: 0.465 };
const STEER_NAMES = ['FrontSteer_L', 'FrontSteer_R'];
const BODY_NAME = 'KartBody';

const MAX_STEER = 0.45; // radians at full lock
const STEER_EASE = 10; // per-second smoothing rate
const MAX_DT = 0.05; // clamp tab-away ticks

/* Process-wide shared cosmetics: one flame cone, one shield contour, reused
 * by every kart instance. Never disposed per kart (see disposeKartModel). */
let sharedCosmetics = null;

function cosmetics(THREE) {
  if (sharedCosmetics && sharedCosmetics.THREE === THREE) return sharedCosmetics;
  const flameGeo = new THREE.ConeGeometry(0.16, 0.7, 12, 1, true);
  const flameMat = new THREE.MeshBasicMaterial({
    color: 0xff9f1a, transparent: true, opacity: 0.9,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const shieldGeo = new THREE.TorusGeometry(1, .022, 4, 48);
  shieldGeo.rotateX(-Math.PI / 2);
  const shieldMat = new THREE.MeshBasicMaterial({
    color: 0x7bedff, transparent: true, opacity: 0.85,
    depthWrite: false, toneMapped: false,
  });
  const invincibilityTrailGeo=new THREE.BoxGeometry(.06,.07,1);
  const invincibilityTrailMats=[0xffd36a,0x6cf3ff].map(color=>new THREE.MeshBasicMaterial({color,transparent:true,opacity:.75,depthWrite:false}));
  // Soft contact shadow: one radial alpha texture (no DOM) under every kart,
  // so the kart sits on the ground instead of floating over flat grass.
  const size = 64, blob = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = (x + .5) / size * 2 - 1, dy = (y + .5) / size * 2 - 1, d = Math.min(1, Math.hypot(dx, dy));
    const i = (y * size + x) * 4; blob[i] = blob[i + 1] = blob[i + 2] = 0; blob[i + 3] = Math.round(255 * Math.pow(1 - d, 1.6) * .78);
  }
  const blobTex = new THREE.DataTexture(blob, size, size, THREE.RGBAFormat);
  blobTex.needsUpdate = true; blobTex.magFilter = THREE.LinearFilter; blobTex.minFilter = THREE.LinearFilter;
  const blobGeo = new THREE.PlaneGeometry(2.5, 3.6); blobGeo.rotateX(-Math.PI / 2);
  const blobMat = new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false, color: 0x000000,
    polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
  sharedCosmetics = { THREE, flameGeo, flameMat, shieldGeo, shieldMat, invincibilityTrailGeo, invincibilityTrailMats, blobGeo, blobMat, blobTex };
  return sharedCosmetics;
}

/* Fresnel rim light: a bright edge on every kart and driver material so the
 * silhouette separates from grass and asphalt at chase distance. Applied once
 * per material (template materials are shared by every kart). */
const rimmed = new WeakSet();
export const KART_RIM = Object.freeze({ color: [1, .97, .9], strength: .55, power: 2.6 });
// Toy finish: near-black trim and tyres read as holes from the chase camera,
// so lift them to soft charcoal and let the paint carry a little more gloss.
export const KART_TOY_TONE = Object.freeze({ DarkTrim: { color: 0x2b3140, roughness: .5 }, TireDark: { color: 0x1d2028, roughness: .72 }, VisorDark: { color: 0x1a2236 } });
function toyTone(material) {
  const tone = KART_TOY_TONE[material.name];
  if (!tone) return;
  if (tone.color !== undefined) material.color?.setHex(tone.color);
  if (tone.roughness !== undefined) material.roughness = tone.roughness;
}
function addRim(material) {
  if (!material || rimmed.has(material) || !(material.isMeshStandardMaterial || material.isMeshPhongMaterial || material.isMeshLambertMaterial)) return;
  rimmed.add(material);
  toyTone(material);
  const previous = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    previous?.call(material, shader, renderer);
    shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
  float kartRim = pow(1.0 - clamp(abs(dot(normalize(normal), normalize(vViewPosition))), 0.0, 1.0), ${KART_RIM.power.toFixed(2)});
  totalEmissiveRadiance += vec3(${KART_RIM.color.map(v => v.toFixed(2)).join(',')}) * kartRim * ${KART_RIM.strength.toFixed(2)};`);
  };
  const key = material.customProgramCacheKey?.bind(material);
  material.customProgramCacheKey = () => (key ? key() : '') + '|kart-rim-v1';
  material.needsUpdate = true;
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function meshMaterials(mesh) {
  return Array.isArray(mesh.material) ? mesh.material : [mesh.material];
}

/* Clone the template's paint material once per source material, recolor it,
 * and set shadow flags (opaque meshes cast; transparent cosmetics never). */
function prepareKartClone(inner, color) {
  const paintClones = new Map();
  const owned = [];
  const paint = [];
  inner.traverse((obj) => {
    if (!obj || !obj.isMesh) return;
    const mats = meshMaterials(obj);
    let transparent = false;
    const remapped = mats.map((mat) => {
      if (!mat) return mat;
      if (mat.transparent) transparent = true;
      if (mat.name !== PAINT_NAME) return mat;
      let clone = paintClones.get(mat);
      if (!clone) {
        clone = mat.clone();
        if (color !== undefined && color !== null) {
          // Slightly richer player colours read against the arena.
          clone.color.set(color);
          const hsl = {}; clone.color.getHSL(hsl);
          clone.color.setHSL(hsl.h, Math.min(1, hsl.s * 1.15 + .05), Math.min(.62, hsl.l));
        }
        paintClones.set(mat, clone);
        owned.push(clone);
        paint.push(clone);
      }
      return clone;
    });
    obj.material = Array.isArray(obj.material) ? remapped : remapped[0];
    for (const mat of remapped) if (!mat?.transparent) addRim(mat);
    obj.castShadow = !transparent;
    obj.receiveShadow = !transparent;
  });
  return { owned, paint };
}

/* Per-driver kart instance. assets.kart is root's loaded glTF scene
 * template (never mutated). Returns a Group the scene yaws/moves; the
 * clone lives one level down so animate() can lean children freely. */
// Stable driver choice for a player key (pid), so a player keeps the same
// character for the whole match on every screen.
export function kartDriverIndex(key, count) {
  if (!(count > 1) || key == null) return 0;
  let h = 2166136261;
  for (const ch of String(key)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return (h >>> 0) % count;
}

export function createKartModel(THREE, { assets, color, number = 1, driver } = {}) {
  const rootGroup = new THREE.Group();
  rootGroup.name = 'GiggleKart';
  const variants = assets && assets.kartVariants;
  // A chosen driver id ('fox') picks its own variant; anything else (a pid)
  // hashes to a stable one.
  const driverId = KART_LOOK_DRIVERS.some(d=>d.id===driver) ? driver : KART_LOOK_DRIVERS[kartDriverIndex(driver,KART_LOOK_DRIVERS.length)].id;
  const chosen = variants?.find(v => v.userData.driver != null && v.userData.driver === driverId);
  const template = chosen || (variants?.length ? variants[kartDriverIndex(driver, variants.length)] : assets && assets.kart);
  if (!template) {
    rootGroup.userData.missing = 'kart';
    return rootGroup;
  }
  const inner = template.clone(true);
  inner.name = 'KartInstance';
  rootGroup.add(inner);

  const { owned, paint } = prepareKartClone(inner, color);

  const wheels = [];
  inner.updateWorldMatrix(true, true);
  const centre = new THREE.Vector3();
  for (const key of SPIN_KEYS) {
    const node = inner.getObjectByName(`WheelSpin_${key}`);
    if (node) {
      node.getWorldPosition(centre);
      inner.worldToLocal(centre);
      wheels.push({ key, node, radius: SPIN_RADIUS[key], angle: 0,
        index: SPIN_KEYS.indexOf(key), baseY: node.position.y, centreY: centre.y });
    }
  }
  const steers = [];
  for (const name of STEER_NAMES) {
    const node = inner.getObjectByName(name);
    if (node) steers.push(node);
  }
  const body = inner.getObjectByName(BODY_NAME);

  // Fixed-bounded boost flame behind the exhausts (tip points -Z).
  const shared = cosmetics(THREE);
  const flame = new THREE.Mesh(shared.flameGeo, shared.flameMat);
  flame.name = 'BoostFlame';
  flame.rotation.x = -Math.PI / 2;
  flame.position.set(0, 0.62, -1.78);
  flame.visible = false;
  flame.castShadow = false;
  flame.receiveShadow = false;
  flame.frustumCulled = false;
  (body || inner).add(flame);

  // Spawn protection hugs the bumper line; no surface covers the driver.
  const shield = new THREE.Mesh(shared.shieldGeo, shared.shieldMat);
  shield.name = 'RespawnShield';
  shield.position.set(0, .45, 0);
  shield.scale.set(1.68, 1, 2.08);
  shield.visible = false;
  shield.castShadow = false;
  shield.receiveShadow = false;
  shield.frustumCulled = false;
  inner.add(shield);

  const contactShadow = new THREE.Mesh(shared.blobGeo, shared.blobMat);
  contactShadow.name = 'KartContactShadow';
  contactShadow.position.set(0, .03, .05);
  contactShadow.castShadow = false; contactShadow.receiveShadow = false; contactShadow.renderOrder = 1;
  inner.add(contactShadow);

  const invincibilityTrails=shared.invincibilityTrailMats.map((material,index)=>{
    const trail=new THREE.Mesh(shared.invincibilityTrailGeo,material);trail.name='InvincibilityTrail';trail.position.set(index===0?-.75:.75,.35,-1.3);trail.visible=false;trail.castShadow=false;inner.add(trail);return trail;
  });

  rootGroup.userData.kart = {
    inner, body, wheels, steers, flame, shield, invincibilityTrails, contactShadow,
    paint, ownedMaterials: owned,
    paintEmission: paint.map(material=>({material,color:material.emissive?.clone(),intensity:material.emissiveIntensity})),
    number, color: color === undefined ? null : color,
    steerSmooth: 0, time: 0,
  };
  rootGroup.userData.flame = flame;
  rootGroup.userData.shield = shield;
  return rootGroup;
}

/* Cosmetic animation only. speed in units/s (signed), steer in [-1, 1]
 * (+1 = screen right), boost/shield booleans, dt seconds. reducedMotion
 * snaps smoothing and freezes flicker/pulse/lean. The root group's
 * rotation is never touched; lean applies to KartBody alone. */
export function animateKartModel(group, {
  speed = 0, steer = 0, boost = false, shield = false, invincible = false,
  dt = 0.016, reducedMotion = false, physicalPose = null, driftHop = 0, drivingJuice = false,
} = {}) {
  const u = group && group.userData && group.userData.kart;
  if (!u) return;
  const step = clamp(Number(dt) || 0, 0, MAX_DT);
  const v = Number(speed) || 0;
  const s = clamp(Number(steer) || 0, -1, 1);
  u.time += step;

  for (let i = 0; i < u.wheels.length; i++) {
    const w = u.wheels[i];
    const physical = physicalPose?.wheels?.[w.index];
    w.angle = Number.isFinite(physical?.rotation) ? physical.rotation : w.angle + (v / w.radius) * step;
    w.node.rotation.x = w.angle;
    // The GLB origin is on the ground; physics owns a chassis-centred pose.
    // Move the authored wheel pivot to the raycast suspension's actual hub.
    const anchor = CONFIG.wheels[w.index];
    w.node.position.y = Number.isFinite(physical?.length)
      ? w.baseY + anchor.y - physical.length - CONFIG.chassis.modelOriginY - w.centreY
      : w.baseY;
  }

  if (reducedMotion) {
    u.steerSmooth = s;
  } else {
    u.steerSmooth += (s - u.steerSmooth) * Math.min(1, step * STEER_EASE);
  }
  // +steer turns toward screen right (-x at yaw 0): negative yaw.
  const lock = -u.steerSmooth * MAX_STEER;
  for (let i = 0; i < u.steers.length; i++) {
    const physical = physicalPose?.wheels?.[i];
    u.steers[i].rotation.y = Number.isFinite(physical?.steering) ? physical.steering : lock;
  }

  if (u.body) {
    if(u.bodyBaseY===undefined){u.bodyBaseY=u.body.position.y;u.bodyScaleX=u.body.scale.x;u.bodyScaleY=u.body.scale.y;u.bodyScaleZ=u.body.scale.z;}
    const grounded=physicalPose?.grounded!==false;
    if(grounded&&u.wasGrounded===false&&(u.lastVerticalSpeed||0)<-1.8){u.landing=.3;u.landingStrength=clamp(-u.lastVerticalSpeed/9,.2,1);}
    if(u.hopWas>0&&driftHop<=0){u.landing=.18;u.landingStrength=.35;}
    u.wasGrounded=grounded;u.lastVerticalSpeed=physicalPose?.linearVelocity?.y||0;u.hopWas=driftHop;
    u.landing=Math.max(0,(u.landing||0)-step);
    const squash=reducedMotion||!drivingJuice?0:Math.sin(u.landing/.3*Math.PI)*(u.landingStrength||0)*.13;
    const hop=reducedMotion?0:Math.sin(clamp(driftHop/.24,0,1)*Math.PI)*.18;
    u.body.position.y=u.bodyBaseY+hop;
    u.body.scale.set(u.bodyScaleX*(1+squash*.4),u.bodyScaleY*(1-squash),u.bodyScaleZ*(1+squash*.4));
    if (reducedMotion || physicalPose&&!drivingJuice) {
      u.body.rotation.x = 0;
      u.body.rotation.z = 0;
    } else {
      const grip = clamp(Math.abs(v) / 14, 0, 1);
      const turn=physicalPose?clamp(-(physicalPose.angularVelocity?.y||0)/1.5,-1,1):u.steerSmooth;
      u.body.rotation.z = turn * grip * (drivingJuice?.085:.025);
      u.body.rotation.x = clamp(v * 0.0006, -0.008, 0.015);
    }
  }

  const flame = u.flame;
  if (flame) {
    flame.visible = !!boost;
    if (flame.visible) {
      if (reducedMotion) {
        flame.scale.set(1, 1.2, 1);
      } else {
        const flick = 1 + 0.15 * Math.sin(u.time * 40);
        const stretch = (1 + clamp(Math.abs(v) / 22, 0, 0.8)) * flick;
        flame.scale.set(flick, stretch, flick);
      }
    }
  }

  for(const saved of u.paintEmission||[]) {
    if(!saved.color)continue;
    if(invincible){saved.material.emissive.setHex(reducedMotion?0xffcc55:Math.sin(u.time*5)>0?0xffcc55:0x55ffff);saved.material.emissiveIntensity=.55;}
    else{saved.material.emissive.copy(saved.color);saved.material.emissiveIntensity=saved.intensity;}
  }

  for(const trail of u.invincibilityTrails||[]){trail.visible=!!invincible&&!reducedMotion&&Math.abs(v)>1;trail.scale.z=clamp(Math.abs(v)/20,.2,1.3);}

  // A steady outline remains readable at rest and with reduced motion.
  if (u.shield) u.shield.visible = !!shield;
}

/* Release ONLY this kart's owned resources: the cloned KartPaint
 * material(s). Shared template geometries/materials and the shared
 * flame/shield cosmetics belong to the process and are never disposed
 * here; root's scene disposal releases the templates themselves. */
export function disposeKartModel(group) {
  const u = group && group.userData && group.userData.kart;
  if (!u) return;
  for (let i = 0; i < u.ownedMaterials.length; i++) {
    const mat = u.ownedMaterials[i];
    if (mat && typeof mat.dispose === 'function') mat.dispose();
  }
  u.ownedMaterials.length = 0;
  u.paint.length = 0;
}

function clonePickup(THREE, template, name, missing, receive) {
  const rootGroup = new THREE.Group();
  rootGroup.name = name;
  if (!template) {
    rootGroup.userData.missing = missing;
    return rootGroup;
  }
  const inner = template.clone(true);
  inner.name = `${name}Inner`;
  rootGroup.add(inner);
  inner.traverse((obj) => {
    if (!obj || !obj.isMesh) return;
    const mats = meshMaterials(obj);
    let transparent = false;
    for (let i = 0; i < mats.length; i++) {
      if (mats[i] && mats[i].transparent) transparent = true;
    }
    obj.castShadow = !transparent;
    obj.receiveShadow = receive && !transparent;
  });
  rootGroup.userData.pickup = { inner, ready: true };
  return rootGroup;
}

/* Gold star pickup, centred on its origin. The scene mounts it at y~1.2
 * and owns the spin/bob; no pivots needed. Shares template resources. */
export function createStarModel(THREE, assets) {
  const template = assets && assets.star;
  return clonePickup(THREE, template, 'GiggleStar', 'star', false);
}

/* Zap crate pickup: x/z centred, bottom at y=0, ~1.5 tall. Root mounts it
 * at y=0. Shares template resources. */
export function createCrateModel(THREE, assets) {
  const template = assets && assets.crate;
  return clonePickup(THREE, template, 'GiggleCrate', 'crate', true);
}

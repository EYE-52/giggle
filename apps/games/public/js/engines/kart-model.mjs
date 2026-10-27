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

import {KART_PHYSICS_CONFIG as CONFIG} from './kart-physics-config.mjs';

const PAINT_NAME = 'KartPaint';

const SPIN_KEYS = ['FL', 'FR', 'RL', 'RR'];
const SPIN_RADIUS = { FL: 0.385, FR: 0.385, RL: 0.465, RR: 0.465 };
const STEER_NAMES = ['FrontSteer_L', 'FrontSteer_R'];
const BODY_NAME = 'KartBody';

const MAX_STEER = 0.45; // radians at full lock
const STEER_EASE = 10; // per-second smoothing rate
const MAX_DT = 0.05; // clamp tab-away ticks

/* Process-wide shared cosmetics: one flame cone, one shield shell, reused
 * by every kart instance. Never disposed per kart (see disposeKartModel). */
let sharedCosmetics = null;

function cosmetics(THREE) {
  if (sharedCosmetics && sharedCosmetics.THREE === THREE) return sharedCosmetics;
  const flameGeo = new THREE.ConeGeometry(0.16, 0.7, 12, 1, true);
  const flameMat = new THREE.MeshBasicMaterial({
    color: 0xff9f1a, transparent: true, opacity: 0.9,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const shieldGeo = new THREE.SphereGeometry(1, 24, 16);
  const shieldMat = new THREE.MeshBasicMaterial({
    color: 0x7bedff, transparent: true, opacity: 0.25,
    depthWrite: false, side: THREE.DoubleSide,
  });
  const invincibilityTrailGeo=new THREE.BoxGeometry(.06,.07,1);
  const invincibilityTrailMats=[0xffd36a,0x6cf3ff].map(color=>new THREE.MeshBasicMaterial({color,transparent:true,opacity:.75,depthWrite:false}));
  sharedCosmetics = { THREE, flameGeo, flameMat, shieldGeo, shieldMat, invincibilityTrailGeo, invincibilityTrailMats };
  return sharedCosmetics;
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
        if (color !== undefined && color !== null) clone.color.set(color);
        paintClones.set(mat, clone);
        owned.push(clone);
        paint.push(clone);
      }
      return clone;
    });
    obj.material = Array.isArray(obj.material) ? remapped : remapped[0];
    obj.castShadow = !transparent;
    obj.receiveShadow = !transparent;
  });
  return { owned, paint };
}

/* Per-driver kart instance. assets.kart is root's loaded glTF scene
 * template (never mutated). Returns a Group the scene yaws/moves; the
 * clone lives one level down so animate() can lean children freely. */
export function createKartModel(THREE, { assets, color, number = 1 } = {}) {
  const rootGroup = new THREE.Group();
  rootGroup.name = 'GiggleKart';
  const template = assets && assets.kart;
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

  // Fixed-bounded respawn shield shell around the whole kart.
  const shield = new THREE.Mesh(shared.shieldGeo, shared.shieldMat);
  shield.name = 'RespawnShield';
  shield.position.set(0, 1.05, 0);
  shield.scale.set(1.55, 1.35, 1.95);
  shield.visible = false;
  shield.castShadow = false;
  shield.receiveShadow = false;
  shield.frustumCulled = false;
  inner.add(shield);

  const invincibilityTrails=shared.invincibilityTrailMats.map((material,index)=>{
    const trail=new THREE.Mesh(shared.invincibilityTrailGeo,material);trail.name='InvincibilityTrail';trail.position.set(index===0?-.75:.75,.35,-1.3);trail.visible=false;trail.castShadow=false;inner.add(trail);return trail;
  });

  rootGroup.userData.kart = {
    inner, body, wheels, steers, flame, shield, invincibilityTrails,
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
  dt = 0.016, reducedMotion = false, physicalPose = null,
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
    if (reducedMotion || physicalPose) {
      u.body.rotation.x = 0;
      u.body.rotation.z = 0;
    } else {
      const grip = clamp(Math.abs(v) / 14, 0, 1);
      u.body.rotation.z = u.steerSmooth * grip * 0.025;
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

  const bubble = u.shield;
  if (bubble) {
    bubble.visible = !!shield;
    if (bubble.visible && !reducedMotion) {
      bubble.rotation.y += step * 0.8;
      const pulse = 1 + 0.02 * Math.sin(u.time * 3);
      bubble.scale.set(1.55 * pulse, 1.35 * pulse, 1.95 * pulse);
    }
  }
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

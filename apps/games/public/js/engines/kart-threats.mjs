/* Incoming-fire warnings for the local driver. Reads authority snapshots only
 * (never predicts a hit): a Seeker locked on you, a Rocket whose straight
 * path passes close to you soon, a rival Proximity Bomb or a live Nuke near
 * you. Shows a pulsing red ring under your kart, up to MAX_ARROWS screen-edge
 * arrows pointing at threats that are off screen, and asks for a warning
 * beep whose rate rises with the danger. Everything is pooled: the frame
 * path allocates nothing, and every cue clears itself when the threat goes. */
export const MAX_THREATS = 6;
export const MAX_ARROWS = 3;
const ROCKET_HORIZON = 1.6; // seconds of straight flight worth warning about
const ROCKET_MISS = 3.5; // closest approach that still counts as aimed at you
const CHARGE_RANGE = 9;
const NUKE_RANGE = 17;

function slot() { return { x: 0, y: 0, z: 0, level: 0, kind: '' }; }

// Scratch state for the finder: module-level, so a frame allocates nothing.
const scan = { out: null, n: 0, you: null, me: null };
function push(x, y, z, level, kind) {
  if (scan.n >= scan.out.length || !(level > 0)) return;
  const t = scan.out[scan.n++]; t.x = x; t.y = y; t.z = z; t.level = Math.min(1, level); t.kind = kind;
}
function shot(kind, owner, target, x, y, z, vx, vy, vz) {
  const me = scan.me;
  if (owner === scan.you || !['missile','cannon','rocket','seeker'].includes(kind)) return;
  const dx = me.x - x, dy = me.y - y, dz = me.z - z, d = Math.hypot(dx, dy, dz);
  if ((kind === 'missile'||kind === 'seeker') && target === scan.you) { push(x, y, z, 1 - Math.min(1, d / 45) * .7, kind); return; }
  const v2 = vx * vx + vy * vy + vz * vz;
  if (v2 < 1e-6) return;
  const t = (dx * vx + dy * vy + dz * vz) / v2;
  if (t <= 0 || t > ROCKET_HORIZON) return;
  if (Math.hypot(dx - vx * t, dy - vy * t, dz - vz * t) > ROCKET_MISS) return;
  push(x, y, z, 1 - t / ROCKET_HORIZON * .75, kind);
}
function charge(owner, x, y, z, range, kind, hot) {
  if (owner === scan.you) return;
  const d = Math.hypot(scan.me.x - x, scan.me.z - z);
  if (d < range) push(x, y, z, (hot ? .55 : .25) + .45 * (1 - d / range), kind);
}

// Fill `out` (pooled slots) with threats to `me` ({x,y,z}); returns the count.
export function findKartThreats(S, you, me, out, mines=S?.mines) {
  if (!me || (!S && !mines?.length)) return 0;
  scan.out = out; scan.n = 0; scan.you = you; scan.me = me;
  for (const z of S?.zaps || []) shot(z.kind, z.owner, z.targetId, z.x, z.y ?? me.y, z.z, z.vx || 0, z.vy || 0, z.vz || 0);
  for (const p of S?.projectiles || []) if (p.position && p.velocity)
    shot(p.weapon, p.owner, p.targetId, p.position.x, p.position.y, p.position.z, p.velocity.x, p.velocity.y, p.velocity.z);
  for (const m of mines || []) if (m.kind === 'proximity') {
    const p=m.position || m;
    charge(m.owner, p.x, p.y ?? me.y, p.z, CHARGE_RANGE, 'proximity', m.armed);
  }
  for (const g of S?.grenades || []) {
    const kind = g.weapon || g.kind, p = g.position || g;
    if (kind === 'nuke') charge(g.owner, p.x, p.y ?? me.y, p.z, NUKE_RANGE, 'nuke', true);
    else if (kind === 'proximity') charge(g.owner, p.x, p.y ?? me.y, p.z, CHARGE_RANGE, 'proximity', g.armed);
  }
  const n = scan.n; scan.out = scan.me = null;
  return n;
}

export function createKartThreats(THREE, scene, host, { reducedMotion = () => false, beep = () => {} } = {}) {
  const ringGeo = new THREE.RingGeometry(2.05, 2.5, 48); ringGeo.rotateX(-Math.PI / 2);
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xff2440, transparent: true, opacity: 0, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  // Drawn (invisibly, far below) by the loading warm-up, hidden from the first update on.
  ring.name = 'KartThreatRing'; ring.position.y = -1000; ring.renderOrder = 7; ring.frustumCulled = false;
  scene.add(ring);
  const layer = document.createElement('div');
  layer.className = 'kart-threats'; layer.setAttribute('aria-hidden', 'true');
  layer.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:6;overflow:hidden';
  const arrows = Array.from({ length: MAX_ARROWS }, () => {
    const a = document.createElement('i');
    a.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;border-left:15px solid transparent;border-right:15px solid transparent;border-bottom:26px solid #ff2a44;filter:drop-shadow(0 0 6px rgba(255,40,70,.9));opacity:0;will-change:transform';
    layer.append(a); return a;
  });
  host.append(layer);
  const threats = Array.from({ length: MAX_THREATS }, slot), v = new THREE.Vector3();
  let count = 0, level = 0, nextBeep = 0, disposed = false;
  // me: {x,y,z} ground position of the local kart; S: latest snapshot.
  function update(S, you, me, camera, now = performance.now(), mines=S?.mines) {
    if (disposed) return 0;
    count = me ? findKartThreats(S, you, me, threats, mines) : 0;
    level = 0;
    for (let i = 0; i < count; i++) level = Math.max(level, threats[i].level);
    ring.visible = count > 0;
    if (ring.visible) {
      ring.position.set(me.x, me.y + .06, me.z);
      const pulse = reducedMotion() ? .7 : .45 + .45 * Math.abs(Math.sin(now / (190 - level * 110)));
      ringMat.opacity = pulse * (.45 + .55 * level);
      ring.scale.setScalar(reducedMotion() ? 1 : 1 + .08 * Math.sin(now / 120));
    }
    const w = layer.clientWidth || host.clientWidth || 0, h = layer.clientHeight || host.clientHeight || 0;
    let used = 0;
    for (let i = 0; i < count && used < MAX_ARROWS && camera && w && h; i++) {
      const t = threats[i];
      v.set(t.x, t.y + .6, t.z).project(camera);
      const behind = v.z > 1;
      let nx = behind ? -v.x : v.x, ny = behind ? -v.y : v.y;
      if (!behind && Math.abs(nx) < .88 && Math.abs(ny) < .82) continue; // on screen: the shot itself is visible
      const m = Math.max(Math.abs(nx) / .9, Math.abs(ny) / .84, 1e-6); nx /= m; ny /= m;
      const px = (nx * .5 + .5) * w, py = (-ny * .5 + .5) * h, angle = Math.atan2(nx, ny);
      const a = arrows[used++];
      a.style.transform = `translate(${(px - 15).toFixed(1)}px,${(py - 13).toFixed(1)}px) rotate(${angle.toFixed(3)}rad)`;
      a.style.opacity = String((.55 + .45 * t.level).toFixed(2));
    }
    for (let i = used; i < MAX_ARROWS; i++) if (arrows[i].style.opacity !== '0') arrows[i].style.opacity = '0';
    if (count && now >= nextBeep) { beep(level); nextBeep = now + 520 - level * 390; }
    if (!count) nextBeep = 0;
    return count;
  }
  function clear() { count = 0; ring.visible = false; for (const a of arrows) a.style.opacity = '0'; nextBeep = 0; }
  function dispose() { if (disposed) return; disposed = true; ring.removeFromParent(); ringGeo.dispose(); ringMat.dispose(); layer.remove(); }
  return Object.freeze({ update, clear, dispose, ring, get level() { return level; }, get count() { return count; } });
}

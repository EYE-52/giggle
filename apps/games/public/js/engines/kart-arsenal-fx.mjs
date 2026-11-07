/* Presentation for the second eight weapons, shared by both kart views.
 * Reads authoritative events and kart status only; never touches gameplay.
 *
 *   const fx = createArsenalFX(THREE, scene, { reducedMotion, groundAt });
 *   fx.event(e)                  // accepted event: thunder/frost blast,
 *                                // cluster burst+pops, bounce, oil splat, ram hit
 *   fx.status(model, kart, opts) // ram front shield, frost shell, oil dizzy stars
 *   fx.update(dt)                // ages pooled effects; nothing lingers
 *   fx.objects()                 // pooled meshes, for shader warm-up
 *   fx.reset(); fx.dispose();
 *
 * Every effect is pooled and short (<= 0.6 s); a full pool recycles the
 * oldest. Status attachments live on the kart model and hide themselves
 * the moment the authority's timer reaches zero.
 */

const TAU = Math.PI * 2;

export function createArsenalFX(THREE, scene, { reducedMotion = () => false, groundAt = () => 0 } = {}) {
  const root = new THREE.Group(); root.name = 'ArsenalFX'; scene.add(root);
  const geos = [], mats = [];
  const keepG = g => { geos.push(g); return g; };
  const keepM = m => { mats.push(m); return m; };
  const additive = (color, opacity) => keepM(new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }));
  const rm = () => (typeof reducedMotion === 'function' ? reducedMotion() : reducedMotion) === true;

  // ---- thunder bolts: two crossed jagged ribbons + a flash ball ----
  const SEGMENTS = 10;
  function ribbonGeometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array((SEGMENTS + 1) * 4 * 3), 3));
    const index = [];
    for (let plane = 0; plane < 2; plane++) for (let i = 0; i < SEGMENTS; i++) {
      const a = plane * (SEGMENTS + 1) * 2 + i * 2;
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    g.setIndex(index);
    return keepG(g);
  }
  const flashGeo = keepG(new THREE.IcosahedronGeometry(1, 1));
  const bolts = Array.from({ length: 4 }, (_, i) => {
    // A solid (not additive) core stays readable against a pale daytime sky.
    const core = new THREE.Mesh(ribbonGeometry(), keepM(new THREE.MeshBasicMaterial({ color: 0xfff3a0, transparent: true, opacity: 1, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }))), halo = new THREE.Mesh(ribbonGeometry(), additive(0x9fd8ff, .5));
    const flash = new THREE.Mesh(flashGeo, additive(0xfff1a0, .8));
    const group = new THREE.Group(); group.name = 'ThunderBolt' + i; group.add(halo, core, flash); group.visible = false;
    for (const m of [core, halo, flash]) m.frustumCulled = false;
    root.add(group);
    return { group, core, halo, flash, age: 0, life: .6 };
  });
  function shapeBolt(bolt, p, seed) {
    const top = 24, pts = [];
    for (let i = 0; i <= SEGMENTS; i++) {
      const f = i / SEGMENTS, jag = i === 0 || i === SEGMENTS ? 0 : 1.4 * (1 - f * .6);
      pts.push([Math.sin(seed * 7.1 + i * 2.3) * jag, top * (1 - f), Math.cos(seed * 5.3 + i * 3.1) * jag]);
    }
    for (const [mesh, width] of [[bolt.core, .2], [bolt.halo, .65]]) {
      const a = mesh.geometry.attributes.position;
      for (let plane = 0; plane < 2; plane++) for (let i = 0; i <= SEGMENTS; i++) {
        const [x, y, z] = pts[i], w = width * (1 - i / SEGMENTS * .4), base = (plane * (SEGMENTS + 1) + i) * 2;
        if (plane === 0) { a.setXYZ(base, x - w, y, z); a.setXYZ(base + 1, x + w, y, z); }
        else { a.setXYZ(base, x, y, z - w); a.setXYZ(base + 1, x, y, z + w); }
      }
      a.needsUpdate = true; mesh.geometry.computeBoundingSphere();
    }
    bolt.group.position.set(p.x, p.y, p.z);
  }

  // ---- ground rings (frost, bounce, ram clang, burst, oil splat) ----
  const ringGeo = keepG(new THREE.RingGeometry(.78, 1, 36)); ringGeo.rotateX(-Math.PI / 2);
  const RING = { frost: [0xbff4ff, 4.5, .5], bounce: [0xff7ad9, 1.3, .25], ram: [0xffd34a, 2.2, .3], burst: [0xff8a3c, 2, .3], oil: [0x9c7dff, 1.8, .4], thunder: [0xfff1a0, 3, .4] };
  const rings = Array.from({ length: 10 }, (_, i) => {
    // Normal blending keeps each ring's colour on bright daytime ground.
    const mesh = new THREE.Mesh(ringGeo, keepM(new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: .8, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }))); mesh.name = 'ArsenalRing' + i; mesh.visible = false; mesh.frustumCulled = false; root.add(mesh);
    return { mesh, age: 0, life: 0, size: 1 };
  });
  let ringHead = 0;
  function ring(kind, p) {
    const spec = RING[kind]; if (!spec) return;
    const r = rings.find(v => !v.mesh.visible) || rings[ringHead++ % rings.length];
    r.mesh.material.color.setHex(spec[0]); r.size = spec[1]; r.life = spec[2]; r.age = 0;
    r.mesh.position.set(p.x, p.y + .06, p.z); r.mesh.visible = true; r.mesh.scale.setScalar(.2 * r.size);
  }

  // ---- shards and stars (one instanced mesh, per-instance colour) ----
  const SHARDS = 64;
  const shardMesh = new THREE.InstancedMesh(keepG(new THREE.OctahedronGeometry(.16, 0)), keepM(new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false })), SHARDS);
  shardMesh.name = 'ArsenalShards'; shardMesh.frustumCulled = false; shardMesh.count = 0; root.add(shardMesh);
  const shardColor = new THREE.Color();
  for (let i = 0; i < SHARDS; i++) shardMesh.setColorAt(i, shardColor.setHex(0xffffff));
  const shards = Array.from({ length: SHARDS }, () => ({ live: false, p: new THREE.Vector3(), v: new THREE.Vector3(), age: 0, life: 0, size: 1, color: 0xffffff }));
  let shardHead = 0;
  function burst(p, count, color, speed, life, up = 2.5, size = 1) {
    if (rm()) return;
    for (let i = 0; i < count; i++) {
      const s = shards[shardHead]; shardHead = (shardHead + 1) % SHARDS;
      const a = i * 2.39996 + p.x * .37;
      s.live = true; s.age = 0; s.life = life; s.size = size; s.color = color;
      s.p.set(p.x, p.y + .3, p.z); s.v.set(Math.cos(a) * speed * (.7 + (i % 3) * .2), up + (i % 4) * .6, Math.sin(a) * speed * (.7 + (i % 3) * .2));
    }
  }
  const dummy = new THREE.Object3D();

  // ---- kart status attachments ----
  const domeGeo = keepG(new THREE.SphereGeometry(1, 20, 10, 0, TAU, 0, Math.PI / 2)); domeGeo.rotateX(Math.PI / 2);
  const shellGeo = keepG(new THREE.IcosahedronGeometry(1, 1));
  const starGeo = keepG(new THREE.OctahedronGeometry(.13, 0));
  const swirlGeo = keepG(new THREE.TorusGeometry(1.25, .05, 6, 40)); swirlGeo.rotateX(Math.PI / 2);
  const ramMat = additive(0xffb347, .5), frostMat = additive(0x9fe8ff, .32), starMat = keepM(new THREE.MeshBasicMaterial({ color: 0xffe066, toneMapped: false })), swirlMat = additive(0x9c7dff, .55);
  function attach(model) {
    let s = model.userData.arsenalStatus;
    if (s) return s;
    const group = new THREE.Group(); group.name = 'ArsenalStatus';
    const ram = new THREE.Mesh(domeGeo, ramMat); ram.name = 'TurboRamShield'; ram.scale.set(1.35, .75, .9);
    const frost = new THREE.Mesh(shellGeo, frostMat); frost.name = 'FrostShell'; frost.scale.set(1.45, .85, 1.95);
    const dizzy = new THREE.Group(); dizzy.name = 'OilDizzy';
    for (let i = 0; i < 3; i++) { const star = new THREE.Mesh(starGeo, starMat); star.name = 'DizzyStar'; dizzy.add(star); }
    const swirl = new THREE.Mesh(swirlGeo, swirlMat); swirl.name = 'OilSwirl'; dizzy.add(swirl);
    for (const o of [ram, frost, dizzy]) { o.visible = false; group.add(o); }
    group.traverse(o => { o.castShadow = false; o.receiveShadow = false; });
    model.add(group);
    s = model.userData.arsenalStatus = { group, ram, frost, dizzy, swirl };
    return s;
  }
  /* opts.groundRoot: the model root sits on the ground (planar karts), not
   * at the chassis centre. */
  function status(model, kart, { time = 0, groundRoot = false } = {}) {
    if (!model) return;
    const ramOn = kart?.rammingT > 0, frostOn = kart?.frostT > 0, spinOn = kart?.spinT > 0;
    if (!ramOn && !frostOn && !spinOn && !model.userData.arsenalStatus) return;
    const s = attach(model), lift = groundRoot ? .72 : 0, still = rm();
    s.group.position.y = lift;
    s.ram.visible = !!ramOn; s.frost.visible = !!frostOn; s.dizzy.visible = !!spinOn;
    if (ramOn) { s.ram.position.set(0, -.05, 1.55); const p = still ? 1 : 1 + .07 * Math.sin(time * 18); s.ram.scale.set(1.35 * p, .75 * p, .9 * p); }
    if (frostOn) { s.frost.position.set(0, .05, 0); s.frost.rotation.y = still ? 0 : time * .4; }
    if (spinOn) {
      s.dizzy.position.set(0, 1.25, -.25);
      s.dizzy.children.forEach((star, i) => {
        if (star === s.swirl) return;
        const a = (still ? 0 : time * 6) + i * TAU / 3;
        star.position.set(Math.cos(a) * .55, .1 * Math.sin(a * 2), Math.sin(a) * .55); star.rotation.y = a;
      });
      s.swirl.position.set(0, -1.85, .25); s.swirl.rotation.y = still ? 0 : -time * 5;
    }
  }

  function at(e) {
    const p = e.position;
    if (p && [p.x, p.y, p.z].every(Number.isFinite)) return { x: p.x, y: p.y, z: p.z };
    if (Number.isFinite(e.x) && Number.isFinite(e.z)) return { x: e.x, y: groundAt(e.x, e.z) + .4, z: e.z };
    return null;
  }
  // Rings sit on the floor: the height field when there is one, else just
  // under the event point (elevated decks have no height field).
  const floorOf = p => { const g = groundAt(p.x, p.z); return { x: p.x, y: Number.isFinite(g) ? Math.min(p.y, g + .05) : p.y - .6, z: p.z }; };
  let strikes = 0;
  function event(e) {
    if (!e || !e.type) return false;
    const p = at(e); if (!p) return false;
    if (e.type === 'blast' && e.weapon === 'thunder') {
      const bolt = bolts.find(b => !b.group.visible) || bolts.reduce((a, b) => (a.age > b.age ? a : b));
      shapeBolt(bolt, p, ++strikes + (p.x * .13));
      bolt.age = 0; bolt.group.visible = true; bolt.flash.scale.setScalar(.6);
      ring('thunder', floorOf(p)); burst(p, 8, 0xfff1a0, 4, .4, 3, .8);
      return true;
    }
    if (e.type === 'blast' && e.weapon === 'frost') { ring('frost', floorOf(p)); burst(p, 14, 0xbff4ff, 6, .55, 3.5, 1.1); return true; }
    if (e.type === 'blast' && e.weapon === 'cluster') { burst(p, 5, 0xffd34a, 3, .35, 2.5, .7); return true; }
    if (e.type === 'burst') { ring('burst', floorOf(p)); burst(p, 6, 0xff8a3c, 2.5, .3, 2, .7); return true; }
    if (e.type === 'bounce') { ring('bounce', floorOf(p)); burst(p, 4, 0xff7ad9, 2, .25, 1.5, .5); return true; }
    if (e.type === 'splat') { ring('oil', floorOf(p)); burst(p, 6, 0x6a54c9, 2.2, .35, 2, .7); return true; }
    if (e.type === 'hit' && e.weapon === 'ram') { ring('ram', floorOf(p)); burst(p, 10, 0xffd34a, 5, .4, 3, .9); return true; }
    return false;
  }

  function update(dt) {
    const step = Math.max(0, Math.min(.1, Number(dt) || 0));
    for (const b of bolts) {
      if (!b.group.visible) continue;
      b.age += step; const f = b.age / b.life;
      if (f >= 1) { b.group.visible = false; continue; }
      // A double flicker, then a fade: lightning, not a beam.
      const flicker = f < .25 ? 1 : f < .35 ? .25 : 1 - (f - .35) / .65;
      b.core.material.opacity = flicker; b.halo.material.opacity = .45 * flicker;
      b.flash.material.opacity = .8 * (1 - f); b.flash.scale.setScalar(.6 + f * 2.4);
    }
    for (const r of rings) {
      if (!r.mesh.visible) continue;
      r.age += step; const f = r.age / r.life;
      if (f >= 1) { r.mesh.visible = false; continue; }
      r.mesh.scale.setScalar((.2 + .8 * Math.sqrt(f)) * r.size); r.mesh.material.opacity = .85 * (1 - f);
    }
    let n = 0;
    for (const s of shards) {
      if (!s.live) continue;
      s.age += step; if (s.age >= s.life) { s.live = false; continue; }
      s.v.y -= 12 * step; s.p.addScaledVector(s.v, step);
      const k = (1 - s.age / s.life) * s.size;
      dummy.position.copy(s.p); dummy.rotation.set(s.age * 9, s.age * 7, 0); dummy.scale.setScalar(k); dummy.updateMatrix();
      shardMesh.setMatrixAt(n, dummy.matrix); shardMesh.setColorAt(n, shardColor.setHex(s.color)); n++;
    }
    shardMesh.count = n;
    if (n) { shardMesh.instanceMatrix.needsUpdate = true; shardMesh.instanceColor.needsUpdate = true; }
  }
  function active() {
    return bolts.some(b => b.group.visible) || rings.some(r => r.mesh.visible) || shards.some(s => s.live);
  }
  function reset() {
    // A shader warm-up may have borrowed pooled objects: take them back.
    for (const o of objects()) if (o.parent !== root) { o.removeFromParent(); o.position.set(0, 0, 0); root.add(o); }
    for (const b of bolts) b.group.visible = false;
    for (const r of rings) r.mesh.visible = false;
    for (const s of shards) s.live = false;
    shardMesh.count = 0;
  }
  // Pooled objects, made visible for a shader warm-up by the caller.
  function objects() { return [...bolts.map(b => b.group), ...rings.map(r => r.mesh), shardMesh]; }
  // A status-only dummy so every status material compiles before play.
  function warmStatus(model) { const s = attach(model); s.ram.visible = s.frost.visible = s.dizzy.visible = true; return s.group; }
  let disposed = false;
  function dispose() {
    if (disposed) return; disposed = true; reset(); root.removeFromParent();
    for (const g of geos) g.dispose();
    for (const m of mats) m.dispose();
  }
  return Object.freeze({ event, status, update, active, reset, objects, warmStatus, dispose });
}

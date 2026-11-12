import {WEAPON_FEEL,CURATED_MUZZLE} from './kart-weapon-contract.mjs';
/* Pooled weapon effects and timed attachments, shared by both kart views.
 * Reads authoritative events and kart status only; never touches gameplay.
 *
 *   const fx = createArsenalFX(THREE, scene, { reducedMotion, groundAt });
 *   fx.event(e)                  // accepted event: frost blast,
 *                                // cluster burst, bounce, ram hit
 *   fx.status(model, kart, opts) // ram bumper and frost shell
 *   fx.update(dt)                // ages pooled effects; nothing lingers
 *   fx.objects()                 // pooled meshes, for shader warm-up
 *   fx.reset(); fx.dispose();
 *
 * Every burst is pooled and short (<= 0.55 s); a full pool recycles the
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
  const attachments=[];let eventAge=0;
  const rm = () => (typeof reducedMotion === 'function' ? reducedMotion() : reducedMotion) === true;
  // ---- ground rings (blasts, frost, bounce, ram clang) ----
  const ringGeo = keepG(new THREE.RingGeometry(.94, 1, 36)); ringGeo.rotateX(-Math.PI / 2);
  const RING = {mine:[0xff697b,4,.55],nuke:[0xffc35a,4.5,.55],supernova:[0x73ffe0,4.2,.55],cannon:[0xffbc54,2.8,.5],missile:[0xff8c56,3,.5], frost: [0xbff4ff, 4.5, .55], bounce: [0xff7ad9, 1.3, .25], ram: [0xffd34a, 2.2, .3], burst: [0xff8a3c, 2, .3] };
  const rings = Array.from({ length: 10 }, (_, i) => {
    // Normal blending keeps each ring's colour on bright daytime ground.
    const mesh = new THREE.Mesh(ringGeo, keepM(new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: .22, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }))); mesh.name = 'ArsenalRing' + i; mesh.visible = false; mesh.frustumCulled = false; root.add(mesh);
    return { mesh, age: 0, life: 0, size: 1 };
  });
  let ringHead = 0;
  function ring(kind, p) {
    const spec = RING[kind]; if (!spec) return;
    const r = rings.find(v => !v.mesh.visible) || rings[ringHead++ % rings.length];
    r.mesh.material.color.setHex(spec[0]); r.size = spec[1]; r.life = Math.min(.3,spec[2]); r.age = eventAge; r.mesh.material.opacity=.22*Math.pow(1-r.age/r.life,2);
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
      s.live = true; s.age = eventAge; s.life = Math.min(.55,life); s.size = size; s.color = color;
      s.p.set(p.x, p.y + .3, p.z); s.v.set(Math.cos(a) * speed * (.7 + (i % 3) * .2), up + (i % 4) * .6, Math.sin(a) * speed * (.7 + (i % 3) * .2));
    }
  }
  const dummy = new THREE.Object3D();

  // Brass shells use one reserved instanced draw, rather than turning the
  // whole muzzle burst into sparks. They tumble out and retire after .6 s.
  const CASINGS=64;
  const casingMesh=new THREE.InstancedMesh(keepG(new THREE.CylinderGeometry(.035,.035,.14,6)),keepM(new THREE.MeshStandardMaterial({color:0xffc24b,metalness:.55,roughness:.35})),CASINGS);
  casingMesh.name='MachineGunCasings';casingMesh.frustumCulled=false;casingMesh.count=0;root.add(casingMesh);
  const casings=Array.from({length:CASINGS},()=>({live:false,p:new THREE.Vector3(),v:new THREE.Vector3(),age:0}));let casingHead=0;
  function eject(p,d,count){if(rm())return;for(let i=0;i<count;i++){
    const c=casings[casingHead];casingHead=(casingHead+1)%CASINGS;c.live=true;c.age=eventAge;c.p.set(p.x,p.y,p.z);c.v.set(d.z*(2+i*.2),2.4+i*.15,-d.x*(2+i*.2));
  }}

  const lockMesh=new THREE.Mesh(keepG(new THREE.RingGeometry(.92,1.02,32)),additive(0xffd34a,.95));
  lockMesh.name='MissileLockReticle';lockMesh.visible=false;lockMesh.frustumCulled=false;root.add(lockMesh);
  function target(snapshot,models,camera){
    lockMesh.visible=false;if(!snapshot)return;
    const own=snapshot.karts?.find(k=>(k.id||k.pid)===snapshot.you);if(!own||own.alive===false||own.respawn>0||own.connected===false)return;
    let id=own.weapon==='missile'?own.lockTarget:null;
    if(!own.weapon)for(const shot of snapshot.projectiles||snapshot.zaps||[])if(shot.owner===snapshot.you&&shot.targetId){id=shot.targetId;break;}
    const kart=snapshot.karts?.find(k=>(k.id||k.pid)===id),model=id&&models.get(id);
    if(!model||kart?.alive===false||kart?.respawn>0||kart?.connected===false)return;
    lockMesh.position.copy(model.position);lockMesh.position.y+=2.1;lockMesh.quaternion.copy(camera.quaternion);lockMesh.scale.setScalar(1);lockMesh.visible=true;
  }
  const muzzleDirection=new THREE.Vector3(),muzzleRotation=new THREE.Quaternion(),forward=new THREE.Vector3(0,0,1);
  function react(e,models,age=0){
    const type=e.type||e.kind;
    if(type==='fire'||type==='mine'){
      const model=models.get(e.pid);
      if(!model)return;
      const s=attach(model);
      s.fireAge=age;s.firePower=WEAPON_FEEL[e.weapon]?.recoil||.1;
      s.muzzlePower=e.weapon==='cannon'||e.weapon==='missile'?1.6:1;
      s.muzzleOn=['machinegun','trishot','missile','cannon'].includes(e.weapon);
      if(s.muzzleOn){
        muzzleDirection.copy(forward);
        if(e.direction){
          model.getWorldQuaternion(muzzleRotation);
          muzzleDirection.copy(e.direction).applyQuaternion(muzzleRotation.invert()).normalize();
        }
        s.muzzle.quaternion.setFromUnitVectors(forward,muzzleDirection);
        s.muzzle.position.set(CURATED_MUZZLE.x,CURATED_MUZZLE.y,CURATED_MUZZLE.z).addScaledVector(muzzleDirection,.06);
      }
    }
    if(type==='hit'){const model=models.get(e.other);if(model){const s=attach(model);s.hitAge=0;s.hitPower=Math.min(1.3,.3+(WEAPON_FEEL[e.weapon]?.kick||1)/8);}}
  }
  // ---- kart status attachments ----
  const domeGeo = keepG(new THREE.SphereGeometry(1, 20, 10, 0, TAU, 0, Math.PI / 2)); domeGeo.rotateX(Math.PI / 2);
  const shellGeo = keepG(new THREE.IcosahedronGeometry(1, 1));
  const ramMat = additive(0xffb347, .5), frostMat = additive(0x9fe8ff, .32);
  const bladeGeo=keepG(new THREE.TorusGeometry(2.2,.021,4,12,.39)),bladeMat=additive(0x6bffda,.95),novaMat=additive(0x73ffe0,.25);
  const novaRimGeo=keepG(new THREE.TorusGeometry(1,.035,4,40));novaRimGeo.rotateX(Math.PI/2);
  const novaRimMat=additive(0x9affde,.9);
  const starShape=new THREE.Shape();for(let i=0;i<16;i++){const a=i*Math.PI/8,r=i%2?.24:.75;if(i)starShape.lineTo(Math.cos(a)*r,Math.sin(a)*r);else starShape.moveTo(r,0);}starShape.closePath();
  const muzzleGeo=keepG(new THREE.ShapeGeometry(starShape)),muzzleMat=additive(0xffe587,.95);
  function attach(model) {
    let s = model.userData.arsenalStatus;
    if (s) return s;
    const group = new THREE.Group(); group.name = 'ArsenalStatus';
    const ram = new THREE.Mesh(domeGeo, ramMat); ram.name = 'TurboRamShield'; ram.scale.set(1.35, .75, .9);
    const frost = new THREE.Mesh(shellGeo, frostMat); frost.name = 'FrostShell'; frost.scale.set(1.65, 1.2, 2.1);
    const muzzle=new THREE.Group();muzzle.name='KartWeaponMuzzleFlash';for(let i=0;i<2;i++){const face=new THREE.Mesh(muzzleGeo,muzzleMat);face.rotation.y=i*Math.PI/2;muzzle.add(face);}muzzle.position.set(CURATED_MUZZLE.x,CURATED_MUZZLE.y,CURATED_MUZZLE.z+.06);
    const blades=new THREE.Group();blades.name='SpinningBlades';for(let i=0;i<3;i++){const b=new THREE.Mesh(bladeGeo,bladeMat);b.name='OrbitBlade';blades.add(b);}
    const nova=new THREE.Mesh(shellGeo,novaMat);nova.name='SupernovaBubble';nova.scale.set(2.3,1.7,2.6);
    const rim=new THREE.Mesh(novaRimGeo,novaRimMat);rim.name='SupernovaRim';nova.add(rim);
    for (const o of [ram, frost,blades,nova,muzzle]) { o.visible = false; group.add(o); }
    group.traverse(o => { o.castShadow = false; o.receiveShadow = false; });
    model.add(group);
    const authoredBody=model.userData.kart?.body;let body=null;
    if(authoredBody?.parent){body=new THREE.Group();body.name='WeaponBodyReaction';authoredBody.parent.add(body);body.add(authoredBody);}
    s = model.userData.arsenalStatus = {group,ram,frost,blades,nova,muzzle,muzzleOn:false,muzzlePower:1,body,baseZ:body?.position.z||0,fireAge:Infinity,hitAge:Infinity,firePower:0,hitPower:0};attachments.push(s);
    return s;
  }
  /* opts.groundRoot: the model root sits on the ground (planar karts), not
   * at the chassis centre. */
  function status(model, kart, { time = 0, groundRoot = false, elapsed = 0 } = {}) {
    if (!model) return;
    const connected=kart?.connected!==false&&elapsed<=.12,ramOn=connected&&kart?.rammingT>elapsed,frostOn=connected&&kart?.frostT>elapsed;
    if (!ramOn && !frostOn && !(kart?.bladesT>0) && !(kart?.supernovaT>0) && !model.userData.arsenalStatus) return;
    const s = attach(model), lift = groundRoot ? .72 : 0, still = rm();
    if(s.body){
      const fire=!still&&s.fireAge<.18?Math.sin(s.fireAge/.18*Math.PI)*s.firePower:0;
      const hit=!still&&s.hitAge<.3?Math.sin(s.hitAge/.3*Math.PI*3)*(1-s.hitAge/.3)*s.hitPower:0;
      s.body.position.z=s.baseZ-fire;s.body.rotation.x=fire*.2;s.body.rotation.z=hit*.17;
    }
    s.group.position.y = lift;
    s.muzzle.visible=connected&&s.muzzleOn&&s.fireAge<(still?.07:.14);
    if(s.muzzle.visible)s.muzzle.scale.setScalar(s.muzzlePower*(still?.65:1.15-s.fireAge*3));
    s.nova.visible=connected&&kart?.supernovaT>elapsed;s.blades.visible=connected&&kart?.bladesT>elapsed;
    if(s.blades.visible){s.blades.position.set(0,.35,0);s.blades.quaternion.copy(model.quaternion).invert();for(let i=0;i<3;i++){const b=s.blades.children[i],a=((kart.bladesAge||0)+elapsed)*7+i*TAU/3;b.rotation.set(Math.PI/2,0,a);}}
    s.nova.position.y=.35;
    if(s.nova.visible)s.nova.rotation.y=still?0:time*.6;
    s.ram.visible = !!ramOn; s.frost.visible = !!frostOn;
    if (ramOn) { s.ram.position.set(0, -.05, 1.55); const p = still ? 1 : 1 + .07 * Math.sin(time * 18); s.ram.scale.set(1.35 * p, .75 * p, .9 * p); }
    if (frostOn) { s.frost.position.set(0, .05, 0); s.frost.rotation.y = still ? 0 : time * .4; }

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
  function event(e,age=0) {
    if (!e || !e.type || age>=.14) return false;eventAge=Math.max(0,age);
    const p = at(e); if (!p) return false;
    if(e.type==='blast'&&['nuke','supernova','cannon','missile','mine'].includes(e.weapon)){ring(e.weapon,floorOf(p));return true;}
    if(e.type==='fire'&&(e.weapon==='machinegun'||e.weapon==='trishot')){eject(p,e.direction||{x:0,y:0,z:1},e.weapon==='trishot'?3:1);return true;}
    if (e.type === 'blast' && e.weapon === 'frost') { ring('frost', floorOf(p)); burst(p, 14, 0xbff4ff, 6, .55, 3.5, 1.6); return true; }
    if (e.type === 'blast' && e.weapon === 'cluster') { burst(p, 5, 0xffd34a, 3, .35, 2.5, .7); return true; }
    if (e.type === 'burst') { ring('burst', floorOf(p)); burst(p, 6, 0xff8a3c, 2.5, .3, 2, .7); return true; }
    if (e.type === 'bounce') { ring('bounce', floorOf(p)); burst(p, 4, 0xff7ad9, 2, .25, 1.5, .5); return true; }
    if (e.type === 'hit' && e.weapon === 'ram') { ring('ram', floorOf(p)); burst(p, 10, 0xffd34a, 5, .4, 3, .9); return true; }
    return false;
  }

  function update(dt) {
    const elapsed=Math.max(0,Number(dt)||0),step=Math.min(.1,elapsed);
    for(const s of attachments){s.fireAge+=elapsed;s.hitAge+=elapsed;}
    for (const r of rings) {
      if (!r.mesh.visible) continue;
      r.age += elapsed; const f = r.age / r.life;
      if (f >= 1) { r.mesh.visible = false; continue; }
      r.mesh.scale.setScalar((rm()?1:(.2 + .8 * Math.sqrt(f))) * r.size); r.mesh.material.opacity = .22 * (1 - f) * (1 - f);
    }
    let n = 0;
    for (const s of shards) {
      if (!s.live) continue;
      s.age += elapsed; if (s.age >= s.life) { s.live = false; continue; }
      s.v.y -= 12 * step; s.p.addScaledVector(s.v, step);
      const k = (1 - s.age / s.life) * s.size;
      dummy.position.copy(s.p); dummy.rotation.set(s.age * 9, s.age * 7, 0); dummy.scale.setScalar(k); dummy.updateMatrix();
      shardMesh.setMatrixAt(n, dummy.matrix); shardMesh.setColorAt(n, shardColor.setHex(s.color)); n++;
    }
    shardMesh.count = n;
    let shells=0;
    for(const c of casings){if(!c.live)continue;c.age+=elapsed;if(c.age>=.14){c.live=false;continue;}c.v.y-=9.8*step;c.p.addScaledVector(c.v,step);dummy.position.copy(c.p);dummy.rotation.set(c.age*17,c.age*11,c.age*8);dummy.scale.setScalar(Math.min(1,(.14-c.age)*12));dummy.updateMatrix();casingMesh.setMatrixAt(shells++,dummy.matrix);}
    casingMesh.count=shells;if(shells)casingMesh.instanceMatrix.needsUpdate=true;
    if (n) { shardMesh.instanceMatrix.needsUpdate = true; shardMesh.instanceColor.needsUpdate = true; }
  }
  function active() {
    return rings.some(r => r.mesh.visible) || shards.some(s => s.live)||casings.some(c=>c.live);
  }
  function reset() {
    // A shader warm-up may have borrowed pooled objects: take them back.
    for (const o of objects()) if (o.parent !== root) { o.removeFromParent(); o.position.set(0, 0, 0); root.add(o); }
    for (const r of rings) r.mesh.visible = false;
    for (const s of shards) s.live = false;
    lockMesh.visible=false;for(const s of attachments){s.muzzle.visible=false;s.fireAge=s.hitAge=Infinity;if(s.body){s.body.position.z=s.baseZ;s.body.rotation.set(0,0,0);}}
    shardMesh.count = 0;for(const c of casings)c.live=false;casingMesh.count=0;
  }
  // Pooled objects, made visible for a shader warm-up by the caller.
  function objects() { return [...rings.map(r => r.mesh), shardMesh,casingMesh,lockMesh]; }
  // A status-only dummy so every status material compiles before play.
  function warmStatus(model) {shardMesh.count=SHARDS;casingMesh.count=CASINGS; const s = attach(model); s.muzzle.visible=s.ram.visible = s.frost.visible = s.blades.visible = s.nova.visible = true; return s.group; }
  let disposed = false;
  function dispose() {
    if (disposed) return; disposed = true; reset(); root.removeFromParent();
    for (const g of geos) g.dispose();
    for (const m of mats) m.dispose();
  }
  return Object.freeze({event,status,update,active,reset,objects,warmStatus,react,target,dispose});
}

'use strict';
// Run the real scene and Three.js geometry with only the GL host replaced.
// This protects rematch/reconnect effects and portrait camera fitting.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');


function surface() {
  const listeners = new Map();
  return {
    style: {},
    addEventListener(t, f) { if (!listeners.has(t)) listeners.set(t, new Set()); listeners.get(t).add(f); },
    removeEventListener(t, f) { listeners.get(t)?.delete(f); },
    getBoundingClientRect() { return {left:0,top:0,width:390,height:844}; },
    count() { return [...listeners.values()].reduce((n,s)=>n+s.size,0); },
  };
}
(async () => {
  const THREE = await import('three');
  const {createArenaControls} = await import('../public/js/renderers/arena-controls.mjs');
  const canvas = surface(), win = surface();
  win.matchMedia = () => ({matches:false});
  let built, controls, glDisposals = 0;
  const context = {
    createArenaControls: (opts) => { controls = createArenaControls(opts); return controls; }, console, window:win,
    createThreeView: async (mount, hooks) => {
      built = hooks.build(THREE, {canvas:()=>canvas,reducedMotion:()=>false,track(){}});
      built.resize(mount.clientWidth,mount.clientHeight);
      return {fallback:false,canvas,dispose(){glDisposals++;}};
    },
  };
  const source = fs.readFileSync('public/js/engines/castle-scene.js','utf8')
    .replace(/^import .+;$/gm,'')
    .replace(/^export async function createCastleScene/m, 'async function createCastleScene');
  vm.runInNewContext(source+'\nthis.makeScene=createCastleScene;', context);
  const mount = {clientWidth:390,clientHeight:844,isConnected:true};
  const view = await context.makeScene(mount);
  assert.equal(view.fallback,false);
  assert(built.scene.isScene && built.camera.isPerspectiveCamera);
  const arena = {cols:8,rows:8,zones:{red:{x0:0,y0:0,x1:7,y1:2},blue:{x0:0,y0:5,x1:7,y1:7}}};
  const core = (y)=>({x:3,y,piece:'core',objective:true,hp:100,maxHp:100,level:1});
  const state = (instanceId,log,round=1)=>({instanceId,round,phase:'siege',arena,
    grids:{red:[core(0)],blue:[core(7)]},objectives:{red:core(0),blue:core(7)},log});
  const hit = (id)=>({id,when:5000+id,kind:'hit',by:'red',victimTeam:'blue',weapon:'catapult',x:3,y:7,dealt:12,at:1});
  const selection = {team:'red',mode:'build',piece:'wall',weapon:'catapult',canAct:true,canTarget:()=>true};
  function shots() {
    let n=0;
    built.scene.traverse(o=>{
      if (o.visible && o.isMesh && o.geometry.type==='SphereGeometry' && o.material.color?.getHex()===0x6b6259) n++;
    });
    return n;
  }
  view.update(state('one',[hit(1)]),selection);
  assert.equal(shots(),0,'reconnected history is baselined');
  view.update(state('one',[hit(1),hit(2)]),selection);
  assert.equal(shots(),1,'new accepted shot gets one projectile');
  view.update(state('one',[hit(1),hit(2)]),selection);
  assert.equal(shots(),1,'duplicate snapshot never repeats it');
  built.frame(0.1,1); built.frame(0.8,2);
  assert.equal(shots(),0,'projectile resolves and leaves the pool');
  view.update(state('two',[hit(1)]),selection);
  assert.equal(shots(),0,'rematch starts with no history effects');
  view.update(state('two',[hit(1),hit(2)]),selection);
  assert.equal(shots(),1,'reused event id in a new battle still animates');
  view.update(state('two',[hit(3)],2),selection);
  assert.equal(shots(),0,'next round baselines old effects');
  view.update(state('two',[hit(3),hit(4)],2),selection);
  assert.equal(shots(),1,'next round accepts its new event');
  view.update(state('two',[{id:10,when:6000,kind:'unlock',by:'red',unlockKind:'piece',unlockId:'cannon',at:120},{id:11,when:6001,kind:'survive',by:'red',hp:100,bonus:50},{id:12,when:6002,kind:'roundEnd',detail:'x',at:2},{id:13,when:6003,kind:'siege',detail:'y',at:2},{id:14,when:6004,kind:'wipe',detail:'z',at:2}],2),selection);
  assert.equal(shots(),1,'non-shot entries never animate');
  view.update(state('two',[{id:15,when:6005,kind:'hit',by:'red',victimTeam:'blue',weapon:'catapult',dealt:5,at:2},{id:16,when:6006,kind:'hit',by:'green',victimTeam:'blue',weapon:'catapult',x:3,y:7,dealt:5,at:2},{id:17,when:6007,kind:'nuke',by:'red',x:3,y:7,at:2}],2),selection);
  assert.equal(shots(),1,'invalid shot entries never animate');
  const many=[]; for(let i=20;i<40;i++) many.push(hit(i));
  view.update(state('pool',[],1),selection);
  assert.equal(shots(),0,'fresh instance clears pools');
  view.update(state('pool',many,1),selection);
  assert(shots()>=1&&shots()<=4,'burst animates a bounded few, saw '+shots());
  console.log('SCENE ok: real geometry, baseline, duplicates, rematch, rounds');
  console.log('SCENE ok: non-shot/invalid entries silent, burst bounded');

  // Project all fort corners through the actual portrait perspective camera.
  for (const [team, zs, outerSign] of [['red',[-9.1,-2.9],-1],['blue',[2.9,9.1],1]]) {
    view.focus(team);
    for(let i=0;i<80;i++) built.frame(0.1,3+i/10);
    built.camera.updateMatrixWorld();
    assert(built.camera.position.z * outerSign > 9.1, team + ' camera approaches from own outer edge');
    for(const x of [-8,8]) for(const z of zs) {
      const p=new THREE.Vector3(x,1,z).project(built.camera);
      assert(Math.abs(p.x)<1, team + ': all playable columns fit portrait width');
      assert(Math.abs(p.y)<1, team + ': all playable rows fit portrait height');
    }
  }
  assert(canvas.count()>0,'input listeners installed');
  // At 320px the fitted orbit enters the decorative cloud ring. A real
  // cloud sphere intersects a ray toward a playable plot; it must be hidden.
  const clouds = [];
  built.scene.traverse(o => {
    if (o.isGroup && o.children.length === 4 && o.children.every(c => c.isMesh && c.geometry.type === 'SphereGeometry')) clouds.push(o);
  });
  assert.equal(clouds.length, 5, 'real cloud groups remain in the scene');
  mount.clientWidth = 320;
  built.resize(320,844);
  view.focus('red');
  for(let i=0;i<80;i++) built.frame(0.05,5+i/20);
  built.scene.updateMatrixWorld(true);
  const eye = built.camera.position.clone();
  let obstructing = 0;
  for (const cloud of clouds) {
    const sphere = new THREE.Box3().setFromObject(cloud).getBoundingSphere(new THREE.Sphere());
    for (const x of [-7,-5,-3,-1,1,3,5,7]) for (const z of [-7,-5,-3]) {
      const plot = new THREE.Vector3(x,1.04,z);
      const ray = new THREE.Ray(eye,plot.clone().sub(eye).normalize());
      const intersection = ray.intersectSphere(sphere,new THREE.Vector3());
      if (intersection && eye.distanceTo(intersection) < eye.distanceTo(plot)) {
        assert.equal(cloud.visible,false,'a cloud in front of a playable plot is hidden');
        obstructing++;
      }
    }
  }
  assert(obstructing > 0, 'fixture reproduces actual foreground plot obstruction');
  const nearCloud = clouds.find(c => c.position.y === 18);
  win.matchMedia = () => ({matches:true});
  for(let i=0;i<120;i++) built.frame(0,9);
  const frozenCloud = nearCloud.position.clone();
  view.focus('blue'); built.frame(0,9);
  assert.equal(nearCloud.visible,true,'cloud behind the opposite fort remains visible');
  view.focus('red'); built.frame(0,9);
  assert.equal(nearCloud.visible,false,'foreground visibility also updates under reduced motion');
  assert(nearCloud.position.equals(frozenCloud),'reduced motion keeps cloud drift still');
  win.matchMedia = () => ({matches:false});
  for(let i=0;i<120;i++) built.frame(0,9);
  mount.clientWidth = 390;
  built.resize(390,844);
  view.focus('red');
  console.log('SCENE ok: foreground clouds cannot hide 320px playable plots');
  // Zoom API: one stop per call, target/yaw/pitch preserved, clamped.
  assert.equal(typeof view.zoom,'function','zoom method present');
  function orbitOf(target) {
    const p = built.camera.position;
    const dx = p.x - target.x, dy = p.y - target.y, dz = p.z - target.z;
    const dist = Math.hypot(dx, dy, dz);
    return { dist, yaw: Math.atan2(dx, dz), pitch: Math.asin(Math.max(-1, Math.min(1, dy / dist))) };
  }
  function angDiff(a, b) {
    let d = a - b;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    return Math.abs(d);
  }
  const RED_T = { x: 0, y: 1.3, z: -5 };
  view.focus('red');
  for(let i=0;i<120;i++) built.frame(0.05,10+i/20);
  built.camera.updateMatrixWorld();
  const z0 = orbitOf(RED_T);
  assert(z0.dist > 9 && z0.dist < 59,'red preset starts inside the zoom range, saw '+z0.dist.toFixed(2));
  const shotsBefore = shots();
  const beforeZoom = controls.getState().goal;
  view.zoom('in');
  const afterZoom = controls.getState().goal;
  assert.deepEqual(afterZoom.target, beforeZoom.target, 'zoom preserves the real orbit target');
  assert.equal(afterZoom.yaw, beforeZoom.yaw, 'zoom preserves goal yaw before tweening');
  assert.equal(afterZoom.pitch, beforeZoom.pitch, 'zoom preserves goal pitch before tweening');
  for(let i=0;i<120;i++) built.frame(0.05,20+i/20);
  built.camera.updateMatrixWorld();
  const z1 = orbitOf(RED_T);
  assert(z1.dist < z0.dist - 0.5,'zoom in steps closer: '+z0.dist.toFixed(2)+' -> '+z1.dist.toFixed(2));
  assert(Math.abs(z1.dist - z0.dist / 1.25) < 0.6,'one stop is /1.25, saw '+z1.dist.toFixed(2));
  assert(angDiff(z1.yaw, z0.yaw) < 0.02,'zoom keeps yaw');
  assert(Math.abs(z1.pitch - z0.pitch) < 0.02,'zoom keeps pitch');
  assert.equal(shots(),shotsBefore,'zoom animates no gameplay');
  for (const [w,h] of [[390,844],[844,390],[320,844]]) {
    built.resize(w,h);
    assert.deepEqual(controls.getState().goal, afterZoom, 'resize preserves explicit button zoom at '+w+'x'+h);
  }
  view.zoom('out');
  for(let i=0;i<120;i++) built.frame(0.05,30+i/20);
  built.camera.updateMatrixWorld();
  const z2 = orbitOf(RED_T);
  assert(z2.dist > z1.dist + 0.5,'zoom out steps farther');
  assert(Math.abs(z2.dist - z0.dist) < 0.8,'in+out returns near the start');
  assert(angDiff(z2.yaw, z0.yaw) < 0.02 && Math.abs(z2.pitch - z0.pitch) < 0.02,'out keeps framing');
  view.zoom(1); // numeric + zooms in like the + button
  for(let i=0;i<120;i++) built.frame(0.05,40+i/20);
  built.camera.updateMatrixWorld();
  const z3 = orbitOf(RED_T);
  assert(z3.dist < z2.dist,'numeric zoom(1) zooms in');
  view.zoom(-1);
  for(let i=0;i<120;i++) built.frame(0.05,50+i/20);
  built.camera.updateMatrixWorld();
  const z4 = orbitOf(RED_T);
  assert(z4.dist > z3.dist,'numeric zoom(-1) zooms out');
  const zb = orbitOf(RED_T);
  view.zoom(0); view.zoom(null); view.zoom('bogus');
  for(let i=0;i<30;i++) built.frame(0.05,60+i/20);
  built.camera.updateMatrixWorld();
  const za = orbitOf(RED_T);
  assert(Math.abs(za.dist - zb.dist) < 1e-6,'invalid zoom is a safe noop');
  for(let i=0;i<40;i++) view.zoom('in');
  for(let i=0;i<160;i++) built.frame(0.05,70+i/20);
  built.camera.updateMatrixWorld();
  const zMin = orbitOf(RED_T);
  assert(zMin.dist >= 8 - 0.05 && zMin.dist <= 8.6,'zoom in clamps at min distance, saw '+zMin.dist.toFixed(2));
  for(let i=0;i<40;i++) view.zoom('out');
  for(let i=0;i<160;i++) built.frame(0.05,90+i/20);
  built.camera.updateMatrixWorld();
  const zMax = orbitOf(RED_T);
  assert(zMax.dist <= 60 + 0.05 && zMax.dist >= 59,'zoom out clamps at max distance, saw '+zMax.dist.toFixed(2));
  assert(angDiff(zMax.yaw, z0.yaw) < 0.03 && Math.abs(zMax.pitch - z0.pitch) < 0.03,'clamped zoom keeps framing');
  console.log('SCENE ok: zoom steps, preserves framing, clamps, ignores junk');
  const fbView = await context.makeScene(null);
  assert.equal(fbView.fallback,true,'no-mount still falls back');
  assert.equal(typeof fbView.zoom,'function','fallback handle carries zoom');
  fbView.zoom('in'); fbView.zoom('out');
  view.zoom('in'); // warmed below; dispose must silence it
  view.dispose(); view.dispose();
  view.zoom('in'); view.zoom('out');
  assert.equal(glDisposals,1,'GL host disposed exactly once');
  assert.equal(canvas.count()+win.count(),0,'input listeners removed');
  view.update(state('two',[hit(5)]),selection);
  assert.equal(shots(),0,'disposed scene animates nothing');
  console.log('SCENE ok: portrait framing and idempotent teardown');
  console.log('CASTLE_SCENE_PASS');
})().catch(e=>{console.error(e);process.exitCode=1;});

/* Authoring proof for the elevated combat layouts, using the actual
 * Rapier adapter. Verifies supported sockets/spawns and driveable routes,
 * not cosmetic heights, baked images or mocked collision results.
 */
import assert from 'node:assert/strict';
import RAPIER from '@dimforge/rapier3d-compat';
import ADAPTER from '../games/engines/kart-physics.js';
import COMBAT from '../games/engines/kart-elevated-combat.js';
import CONFIG from '../public/js/engines/kart-physics-config.mjs';
import { elevatedMap, elevatedMapIds } from '../public/js/engines/kart-elevated-maps.mjs';

await RAPIER.init();
let checks = 0;
function check(label, value) { assert.ok(value,label); checks++; }
function step(world,n) { for(let i=0;i<n;i++) world.step(); }
const measurements = [];

for(const id of elevatedMapIds) {
  const map = elevatedMap(id), world = ADAPTER.createKartPhysics(RAPIER,CONFIG);
  try {
    map.colliders.forEach(d=>world.addStatic(d));
    check(`${id}: eight legal driver support points`,map.spawns.length===8);
    check(`${id}: randomized crate pool has more than 20 candidate sockets`,map.sockets.length>=24);
    check(`${id}: unique collider, spawn and crate IDs`,[map.colliders,map.spawns,map.sockets].every(a=>new Set(a.map(p=>p.id)).size===a.length));
    check(`${id}: no laps, finish order, checkpoints or baked content`, !['laps','checkpoints','finishLine','promptImage'].some(k=>k in map));
    for(const p of [...map.spawns,...map.sockets]) {
      const hit=world.supportAt({x:p.x,y:p.y+0.8,z:p.z},1.2);
      check(`${id}/${p.id}: supported on the declared real surface`,hit && hit.surfaceId===p.surface && Math.abs(hit.point.y-p.y)<0.03 && hit.normal.y>0.98);
      check(`${id}/${p.id}: comfortably inside the arena`,Math.max(Math.abs(p.x),Math.abs(p.z))<map.half-3);
    }
    for(const [i,p] of map.spawns.entries()) {
      for(const dx of [-CONFIG.chassis.half.x,CONFIG.chassis.half.x]) {
        for(const dz of [-CONFIG.chassis.half.z,CONFIG.chassis.half.z]) {
          const hit=world.supportAt({x:p.x+dx,y:p.y+0.8,z:p.z+dz},1.2);
          check(`${id}/${p.id}: hull footprint is supported`,hit && hit.surfaceId===p.surface && Math.abs(hit.point.y-p.y)<0.03);
        }
      }
      world.addKart(`driver-${i}`,{position:{x:p.x,y:p.y+1,z:p.z},rotation:{x:0,y:Math.sin(p.angle/2),z:0,w:Math.cos(p.angle/2)}});
    }
    step(world,150);
    const poses=world.poses();
    check(`${id}: eight spawns settle with grounded finite bodies`,poses.every(p=>p.grounded && Object.values(p.position).every(Number.isFinite) && p.position.y>0.5 && p.position.y<1));
    check(`${id}: no spawn forced sideways out of a solid`,poses.every((p,i)=>Math.hypot(p.position.x-map.spawns[i].x,p.position.z-map.spawns[i].z)<0.2));
    const copy=elevatedMap(id); copy.colliders[0].half.x=0;
    check(`${id}: a private instance cannot corrupt map geometry`,elevatedMap(id).colliders[0].half.x===map.half);
  } finally { world.dispose(); }

  // Each shipped socket must be collectible by an ordinary approach. A ray
  // proving its centre has support misses cover beside it and floor/deck LOS.
  // Narrow the test's random pool to two IDs at the same actual authored point;
  // retain all shipped solids, movement, pickup rules and sequenced inputs.
  for(const socket of map.sockets){
    let collected=false;
    for(const angle of [0,Math.PI/2,Math.PI,-Math.PI/2]){
      const dx=Math.sin(angle),dz=Math.cos(angle),start={x:socket.x-dx*5,y:socket.y,z:socket.z-dz*5};
      const probe=ADAPTER.createKartPhysics(RAPIER,CONFIG);
      let legal=false,startSurface;
      try{
        map.colliders.forEach(d=>probe.addStatic(d));
        const q={x:0,y:Math.sin(angle/2),z:0,w:Math.cos(angle/2)};
        const support=probe.supportAt({...start,y:start.y+.4},.8);
        if(support){start.y=support.point.y;startSurface=support.surfaceId;}
        legal=!!support&&support.normal.y>.98&&!probe.overlapsStatic({...start,y:start.y+1},q);
        for(const w of CONFIG.wheels){
          const at={x:start.x+w.x*Math.cos(angle)+w.z*dx,y:start.y+.4,z:start.z-w.x*dx+w.z*Math.cos(angle)};
          const hit=probe.supportAt(at,.8);legal&&=!!hit&&Math.abs(hit.point.y-start.y)<.15&&hit.normal.y>.65;
        }
      }finally{probe.dispose();}
      if(!legal)continue;
      const authored=structuredClone(map);
      authored.spawns=[{id:'approach',surface:startSurface,...start,angle},map.spawns.find(p=>Math.hypot(p.x-start.x,p.z-start.z)>12)];
      authored.sockets=[socket,{...socket,id:'pickup-backup'}];
      const match=COMBAT.createElevatedCombat(RAPIER,CONFIG,authored,[{id:'driver'},{id:'rival'}],{instance:`pickup-${id}-${socket.id}`,seed:1,startAt:0,countdownMs:0,roundMs:8000,crates:1});
      try{
        for(let i=0;i<180&&!collected;i++){
          const s=match.snapshot('driver');
          if(i%6===0)check(`${id}/${socket.id}: legal approach intent`,match.input('driver',{instance:s.instance,life:s.you.life,controlEpoch:s.you.controlEpoch,seq:s.you.receivedSeq+1,steer:0,throttle:1,brake:0,nitro:false,use:false},s.serverAt).ok);
          const next=match.advance(s.serverAt+CONFIG.fixedDt*1000);
          collected=next.events.some(e=>e.type==='pickup'&&e.pid==='driver'&&Math.hypot(e.position.x-socket.x,e.position.z-socket.z)<.01);
        }
      }finally{match.dispose();}
      if(collected)break;
    }
    check(`${id}/${socket.id}: actual drive reaches and collects the supported pickup`,collected);
  }

  for(const route of map.routes) {
    const physics=ADAPTER.createKartPhysics(RAPIER,CONFIG);
    try {
      map.colliders.forEach(d=>physics.addStatic(d));
      const r=map.colliders.find(d=>d.id===route.via);
      const angle=2*Math.atan2(r.rotation.y,r.rotation.w);
      const fx=Math.sin(angle),fz=Math.cos(angle);
      const origin={x:r.position.x-fx*(r.half.z+3),y:1,z:r.position.z-fz*(r.half.z+3)};
      physics.addKart('driver',{position:origin,rotation:r.rotation});
      step(physics,120); physics.applyIntent('driver',{throttle:1,steer:0});
      let onRamp=false,onDeck=false,maxY=0;
      for(let i=0;i<360;i++) {
        physics.step(); const p=physics.pose('driver');
        onRamp ||= p.wheels.some(w=>w.surfaceId===route.via);
        onDeck ||= p.wheels.some(w=>w.surfaceId===route.to);
        maxY=Math.max(maxY,p.position.y);
      }
      check(`${id}/${route.id}: actual driven ramp contact`,onRamp);
      check(`${id}/${route.id}: reaches the actual destination deck`,onDeck);
      check(`${id}/${route.id}: authoritative height exceeds the ramp rise`,maxY>r.half.y*2+0.35);
      measurements.push({map:id,route:route.id,maxChassisY:Number(maxY.toFixed(3))});
      // Touching the deck during flight is not proof of a usable connection.
      // Start beyond the top seam and drive the same authored route downward.
      const descentAngle=angle+Math.PI;
      const start={x:r.position.x+fx*(r.half.z+3),z:r.position.z+fz*(r.half.z+3)};
      const support=physics.supportAt({...start,y:r.position.y+r.half.y+1},2);
      check(`${id}/${route.id}: ramp crest joins destination without a gap`,support?.surfaceId===route.to);
      physics.resetKart('driver',{position:{...start,y:support.point.y+1},rotation:{x:0,y:Math.sin(descentAngle/2),z:0,w:Math.cos(descentAngle/2)}});
      physics.applyIntent('driver',{throttle:0,steer:0});step(physics,120);
      check(`${id}/${route.id}: crest has stable supported room for the full kart`,physics.pose('driver').grounded);
      physics.applyIntent('driver',{throttle:1,steer:0});
      let descendingRamp=false,returned=false;
      for(let i=0;i<300&&!returned;i++){
        physics.step();const p=physics.pose('driver');
        descendingRamp ||= p.wheels.some(w=>w.contact&&w.surfaceId===route.via);
        const along=(p.position.x-r.position.x)*fx+(p.position.z-r.position.z)*fz;
        returned=descendingRamp&&along< -r.half.z-2&&p.grounded&&p.wheels.every(w=>w.contact&&w.surfaceId===route.from);
      }
      check(`${id}/${route.id}: ordinary descent returns all wheels to ground`,returned);
    } finally { physics.dispose(); }
  }
  const bridge=map.colliders.find(d=>d.shape==='deck');
  const layered=ADAPTER.createKartPhysics(RAPIER,CONFIG);
  try {
    map.colliders.forEach(d=>layered.addStatic(d));
    const x=bridge.position.x,z=bridge.position.z;
    const upper=layered.supportAt({x,y:bridge.position.y+bridge.half.y+1,z},2);
    const lower=layered.supportAt({x,y:2,z},3);
    check(`${id}: deck and road underneath are different physical surfaces`,upper?.surfaceId===bridge.id && lower?.surfaceId==='floor' && upper.point.y-lower.point.y>5);
    layered.addKart('underpass',{position:{x,y:1,z}});
    layered.addKart('upper',{position:{x,y:upper.point.y+1,z}});
    step(layered,180);
    check(`${id}: karts at equal x/z stay on separate layers`,layered.pose('upper').position.y-layered.pose('underpass').position.y>5 && layered.pose('upper').grounded && layered.pose('underpass').grounded);
  } finally { layered.dispose(); }
  if(id==='frost') {
    const jump=ADAPTER.createKartPhysics(RAPIER,CONFIG);
    try {
      map.colliders.forEach(d=>jump.addStatic(d));
      jump.addKart('driver',{position:{x:2,y:1,z:-30}});
      step(jump,120); jump.applyIntent('driver',{throttle:1,steer:0});
      let kicker=false,airborne=0,landed=false,maxY=0;
      for(let i=0;i<240;i++) {
        jump.step(); const p=jump.pose('driver'); maxY=Math.max(maxY,p.position.y);
        kicker ||= p.wheels.some(w=>w.surfaceId==='quarry-kicker');
        if(kicker && p.position.z>-13 && !p.grounded) airborne++;
        if(airborne && p.grounded && p.wheels.some(w=>w.surfaceId==='ice-basin')) landed=true;
      }
      check('frost: optional kicker produces physical unsupported flight',kicker && airborne>5 && maxY>2.6);
      check('frost: flight ends in a supported landing on solid ice',landed);
      measurements.push({map:id,route:'optional-quarry-jump',maxChassisY:Number(maxY.toFixed(3)),airborneFixedSteps:airborne});
    } finally { jump.dispose(); }
  }
}
assert.throws(()=>elevatedMap('unknown'),RangeError); checks++;
console.log(`ELEVATED COMBAT MAPS PASS: ${checks} actual surface, spawn, route and layer checks`);
console.log(JSON.stringify({status:'development-profile-only',routes:measurements}));

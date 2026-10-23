import assert from 'node:assert/strict';
import RAPIER from '@dimforge/rapier3d-compat';
import config from '../public/js/engines/kart-physics-config.mjs';
import {createClassicMotion} from '../public/js/engines/kart-classic-motion.mjs';
import {createRoadTerrain} from '../public/js/engines/kart-road-terrain.mjs';
import engine from '../games/engines/kart-engine.js';
import maps from '../games/engines/kart-maps.js';
import battle from '../games/engines/kart-rules-battle.js';

await RAPIER.init();
function fixture(id,mode='battle'){
  let now=1000000,sequence=0,motion;
  const players=[{id:'driver',name:'Driver'},{id:'rival',name:'Rival'}];
  const game=engine.createKartGame({id:'recovery-fixture',name:'Recovery',maps:maps.mapIds(),
    createMotion:s=>(motion=createClassicMotion(RAPIER,config,s))});
  const ctx={instanceId:'recovery-'+id,now:()=>now,players:()=>players.slice(0,1),allPlayers:()=>players,
    settings:()=>({map:id,mode,roundSeconds:180,winRule:'Time limit'}),broadcast(){},award(){},later:()=>()=>{}};
  const state=game.create(ctx);now+=3000;game.onTick(state,ctx);now+=50;game.onTick(state,ctx);
  state.crates=[];state.stars=[];state.events=[];
  const driver=state.karts[0],terrain=createRoadTerrain({id,...maps.mapDef(id)});
  if(mode==='battle')driver.hits=2;else driver.stars=3;
  state.scores[driver.pid]=mode==='battle'?2:3;
  return {game,ctx,state,driver,motion,terrain,
    place(position,angle=0,velocity={x:0,y:0,z:0}){motion.restore(driver,{...driver.physicalPose,position,
      rotation:{x:0,y:Math.sin(angle/2),z:0,w:Math.cos(angle/2)},linearVelocity:velocity,angularVelocity:{x:0,y:0,z:0}});},
    input(input){const ack=game.view(state,'driver').inputAck;game.onAction(state,ctx,'driver',{seq:++sequence,life:ack.life,controlEpoch:ack.controlEpoch,input:{steer:0,throttle:0,boost:false,...input}});},
    tick(ms=50){now+=ms;game.onTick(state,ctx);},dispose(){game.dispose(state);}};
}
const metrics=[];
for(const id of maps.mapIds())for(const mode of ['battle','starrush']){
  const f=fixture(id,mode),{driver,motion,state,game,terrain}=f;
  try{
    const old=game.view(state,'driver').inputAck,score=state.scores.driver,coins=game.view(state,'rival').coins,deaths=state.karts.map(k=>k.deaths||0);
    // Geometric fixture: wholly past the outer wall face, with a real
    // airborne rigid body and latched controls that must never survive it.
    f.place({x:state.half+1.1,y:terrain.wallHeight+2,z:0},Math.PI/2,{x:30,y:1,z:0});
    if(mode==='battle'){
      const socket=battle.respawnPose(state,driver),from=driver.physicalPose.position,
        dx=socket.x-from.x,dz=socket.z-from.z,len=Math.hypot(dx,dz),
        mid={x:(socket.x+from.x)/2,y:(terrain.heightAt(socket.x,socket.z)+.75+from.y)/2,z:(socket.z+from.z)/2},
        perp={x:-dz/len,z:dx/len};
      state.zaps=[{id:'teleport-crossing',owner:'rival',kind:'pulse',physical:true,
        x:mid.x-perp.x*2.75,y:mid.y,z:mid.z-perp.z*2.75,vx:perp.x*110,vy:0,vz:perp.z*110,ttl:1,angle:Math.atan2(perp.x,perp.z)}];
    }
    f.input({throttle:1,steer:.7,drift:true,nitro:true,boost:true});
    driver.pendingFire=true;driver.machineHeld=true;driver.driftCharge=1;
    f.tick();
    const fresh=game.view(state,'driver').inputAck;
    assert.equal(game.view(state,'rival').karts.find(k=>k.pid==='driver').spawnSeq,fresh.life,id+' '+mode+' remote observers receive fresh-life epoch');
    assert.equal(fresh.life,old.life+1,id+' '+mode+' new spawn life');
    assert.equal(fresh.controlEpoch,old.controlEpoch+1,id+' new control epoch');
    assert.equal(fresh.appliedInputSeq,0);assert.equal(fresh.receivedSeq,0);
    assert.equal(state.scores.driver,score,id+' fall preserves earned score');
    assert.equal(game.view(state,'rival').coins,coins,id+' fall awards no rival coins');
    assert.deepEqual(state.karts.map(k=>k.deaths||0),deaths,id+' fall is not a knockout');
    assert.ok(!state.events.some(e=>e.type==='ko'||e.type==='hit'||e.type==='fire'),id+' no fall KO/fire events');
    if(mode==='battle')assert.ok(!state.events.some(e=>e.type==='impact'&&e.other==='driver'),id+' no phantom hit along recovery teleport');
    assert.ok(state.spawns.some(s=>Math.hypot(s.x-driver.x,s.z-driver.z)<.00001),id+' farthest original legal respawn socket');
    assert.ok(driver.physicalPose.position.y>=terrain.heightAt(driver.x,driver.z)+.7,id+' respawn has real terrain height');
    assert.deepEqual(driver.input,{steer:0,throttle:0,boost:false});
    assert.ok(!driver.pendingFire&&!driver.machineHeld&&!driver.nitroActive&&!driver.drifting&&driver.driftCharge===0);
    assert.equal(driver.physicalPose.epoch,old.life+1,id+' actual body epoch changes');
    game.onAction(state,f.ctx,'driver',{seq:999,life:old.life,controlEpoch:old.controlEpoch,input:{steer:0,throttle:1,boost:true}});
    assert.equal(driver.input.throttle,0,id+' old-life network intent rejected');
    game.onAction(state,f.ctx,'driver',{seq:999,life:fresh.life,controlEpoch:old.controlEpoch,input:{steer:0,throttle:1,boost:true}});
    assert.equal(driver.input.throttle,0,id+' retired control epoch rejected');
    f.tick(100);assert.equal(driver.spawnSeq,fresh.life,id+' recovery does not loop');
    f.input({throttle:1});f.tick(100);assert.ok(driver.speed>0,id+' fresh input drives recovered kart');

    const life=driver.spawnSeq;
    // High in-map flight alone
    // must never invoke recovery, regardless of height or ground contact.
    f.place({x:0,y:terrain.wallHeight+12,z:0},0,{x:0,y:5,z:0});
    f.input({throttle:0});f.tick(100);
    assert.equal(driver.spawnSeq,life,id+' valid high in-map jump remains physical');
    assert.ok(!driver.physicalPose.grounded&&driver.physicalPose.position.y>10);
    f.place({x:0,y:-3.1,z:0},0,{x:0,y:-2,z:0});f.tick();
    assert.equal(driver.spawnSeq,life+1,id+' below-floor failure safely recovers');
    assert.ok(driver.physicalPose.position.y>0);
  }finally{f.dispose();}
}

// Natural legal-control matrix: let the controller climb and jump itself.
// Each cardinals/offset route is replayed with full nitro and with late
// drift steering, so fences, hills, airborne exits and safe recovery all
// take part without invented velocity or projected/clamped coordinates.
for(const id of maps.mapIds()){
  let recoveries=0,maxFlightY=0,maxSpeed=0,trajectories=0;
  for(const angle of [0,Math.PI/2,Math.PI,-Math.PI/2])for(const fraction of [-.65,-.3,0,.3,.65])for(const drift of [false,true]){
    const f=fixture(id),{driver,state,terrain}=f;
    try{
      const s=Math.sin(angle),c=Math.cos(angle),x=-s*(state.half-4)+c*fraction*state.half,z=-c*(state.half-4)-s*fraction*state.half;
      f.place({x,y:terrain.heightAt(x,z)+.75,z},angle);
      for(let i=0;i<180;i++){
        // Start nitro near the raised side of the route so it is still
        // powered on the actual exit rather than drained during approach.
        const along=driver.x*s+driver.z*c;
        f.input({throttle:1,nitro:along>0,drift:drift&&along>state.half*.4,steer:drift&&along>state.half*.4?.2:0});
        f.tick();maxFlightY=Math.max(maxFlightY,driver.physicalPose.position.y);maxSpeed=Math.max(maxSpeed,Math.abs(driver.speed));
        assert.ok(Object.values(driver.physicalPose.position).every(Number.isFinite));
        assert.ok(!f.motion.isOutOfBounds(driver.physicalPose),id+' authority recovers exits before publishing pose');
        if(driver.spawnSeq>0){recoveries++;assert.equal(driver.input.throttle,0);break;}
      }
      assert.equal(state.scores.driver,2,id+' natural fall preserves scores');
      assert.ok(!state.events.some(e=>e.type==='ko'),id+' natural fall never becomes a rival KO');
      trajectories++;
    }finally{f.dispose();}
  }
  assert.ok(recoveries>0,id+' natural boosted/drift exit actually exercises recovery');
  metrics.push({id,trajectories,recoveries,maxFlightY,maxSpeed});
}
console.log(JSON.stringify({pass:true,scope:'shipping engine with actual Rapier controlled fixtures and legal boosted/drift trajectories',metrics},null,2));

import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import * as THREE from 'three';
import R from '@dimforge/rapier3d-compat';
import C from '../public/js/engines/kart-physics-config.mjs';
import {createKartPhysics} from '../public/js/engines/kart-physics-core.mjs';
import {elevatedMap,elevatedMapIds} from '../public/js/engines/kart-elevated-maps.mjs';
import {createKartElevatedWorld} from '../public/js/engines/kart-elevated-world.mjs';
import {raisedSurfaceHeight,createRaisedPoseSupport} from '../public/js/engines/kart-raised-support.mjs';
import {blendElevatedPose} from '../public/js/engines/kart-elevated-pose.mjs';
import {createRaisedCameraQuery} from '../public/js/engines/kart-raised-camera.mjs';
import {createElevatedPrediction} from '../public/js/engines/kart-elevated-prediction.mjs';
import COMBAT from '../games/engines/kart-elevated-combat.js';
import {auditAssets,auditRaised} from './helpers/kart-raised-audit.mjs';
await R.init();const evidence={renderBudgets:[],ramps:0,surfaceSamples:0,replayFrames:0,wallEscapes:0,entryPosesCorrected:0};
const qYaw=a=>new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),a),point=new THREE.Vector3(),q=new THREE.Quaternion(),matrix=new THREE.Matrix4();
// Compare the ACTUAL visible skins (including scaled complex instances) with
// independent Rapier casts. Query envelopes are deliberately excluded.
for(const id of elevatedMapIds){
  const map=elevatedMap(id),world=createKartElevatedWorld(THREE,{map}),conform=createRaisedPoseSupport(THREE,map);world.group.updateMatrixWorld(true);
  for(const d of map.colliders.filter(d=>d.shape==='wedge')){
    const physics=createKartPhysics(R,C);physics.addStatic(d);const targets=[];
    world.solids.traverseVisible(m=>{if(!m.isMesh)return;if(m.isInstancedMesh){if(m.userData.colliderIds?.includes(d.id))targets.push(m);}else if(m.userData.colliderId===d.id||m.name.endsWith(':merged')&&m.material===world.colliderMeshes.get(d.id).body.material)targets.push(m);});
    assert(targets.length,id+'/'+d.id+' has a visible ramp skin');const a=2*Math.atan2(d.rotation?.y||0,d.rotation?.w??1),yaw=qYaw(a);
    for(const x of[-.65,0,.65])for(const z of[-.9,-.5,0,.5,.9]){
      point.set(x*d.half.x,0,z*d.half.z).applyQuaternion(yaw).add(new THREE.Vector3().copy(d.position));const height=raisedSurfaceHeight(d,point.x,point.z);
      const ray=new THREE.Raycaster(new THREE.Vector3(point.x,height+.08,point.z),new THREE.Vector3(0,-1,0),0,.2),hits=ray.intersectObjects(targets,false).filter(h=>!h.object.isInstancedMesh||h.object.userData.colliderIds[h.instanceId]===d.id);
      assert(hits.length,id+'/'+d.id+' rendered slope is present at sample');const support=physics.supportAt({x:point.x,y:height+.08,z:point.z},.2);
      assert(support&&Math.abs(hits[0].point.y-support.point.y)<.02,id+'/'+d.id+' render/collider height agree within 2cm');evidence.surfaceSamples++;
    }
    physics.addKart('bot',{position:{x:0,y:1,z:0}});
    // A flat entry/interpolation pose can have wheel support on a slope before
    // its rotation catches up. The oversized bumper art must follow that slope.
    const entry={grounded:true,position:{...d.position,y:d.position.y+.65},rotation:yaw,wheels:Array.from({length:4},()=>({contact:true,surfaceId:d.id}))};
    const corrected=conform(entry,{position:{},rotation:{}});let wasBelow=false;
    const compact=conform({...entry,wheels:entry.wheels.map(()=>({length:.3,rotation:0,steering:0}))},{position:{},rotation:{}});
    for(const x of[-1.38,1.38])for(const z of[-2.2,2.2]){
      point.set(x,-.42,z).applyQuaternion(yaw).add(entry.position);wasBelow||=point.y-raisedSurfaceHeight(d,point.x,point.z)<-.02;
      point.set(x,-.42,z).applyQuaternion(q.copy(corrected.rotation)).add(corrected.position);assert(point.y-raisedSurfaceHeight(d,point.x,point.z)>-.02,'supported ramp-entry art clears '+id+'/'+d.id);
      point.set(x,-.42,z).applyQuaternion(q.copy(compact.rotation)).add(compact.position);assert(point.y-raisedSurfaceHeight(d,point.x,point.z)>-.02,'compact remote ramp-entry art clears '+id+'/'+d.id);
    }
    if(wasBelow)evidence.entryPosesCorrected++;
    for(const sign of[1,-1]){
      const z=sign*(-d.half.z+1),start=new THREE.Vector3(0,d.half.y*z/d.half.z+1,z).applyQuaternion(yaw).add(new THREE.Vector3().copy(d.position));
      const rotation=yaw.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),-Math.atan(d.half.y/d.half.z))).multiply(qYaw(sign<0?Math.PI:0));
      physics.resetKart('bot',{position:start,rotation});physics.applyIntent('bot',{steer:0,throttle:.65,brake:0});let before=null,visited=0;
      for(let i=0;i<180;i++){
        physics.step();const pose=physics.pose('bot');if(pose.grounded){
          for(const x of[-C.chassis.half.x,C.chassis.half.x])for(const z of[-C.chassis.half.z,C.chassis.half.z]){
            point.set(x,-C.chassis.half.y,z).applyQuaternion(q.copy(pose.rotation)).add(pose.position);const h=raisedSurfaceHeight(d,point.x,point.z);assert(point.y-h>-.02,id+'/'+d.id+' physical chassis stays above the ramp');
          }
          const current={alive:true,spawnSeq:1,controlEpoch:1,pose},interpolated=blendElevatedPose(before,current,.4),shown=conform(interpolated,{position:{},rotation:{}});
          for(const x of[-1.38,1.38])for(const z of[-2.2,2.2]){point.set(x,-.42,z).applyQuaternion(q.copy(shown.rotation)).add(shown.position);const h=raisedSurfaceHeight(d,point.x,point.z);assert(point.y-h>-.02,id+'/'+d.id+' interpolated bumper art clears the ramp');}
          before=current;visited++;
        }evidence.replayFrames++;
      }assert(visited>5,id+'/'+d.id+' replay drives on the slope in both directions');
    }
    evidence.ramps++;physics.dispose();
  }
  world.dispose();
}
assert(evidence.entryPosesCorrected>10,'regression covers entry poses that visibly clipped before conformance');
// Production prediction, compact remote packet fields, and the real Foundry
// loading ramp. Drive up, then reverse down with authority corrections at 20Hz.
{
  const map=elevatedMap('foundry'),ramp=map.colliders.find(d=>d.id==='west-loading-ramp'),conform=createRaisedPoseSupport(THREE,map);
  map.spawns[0].angle=0; // Point this replay directly at the climb, away from the normal opening lane.
  const game=COMBAT.createElevatedCombat(R,C,map,[{id:'a'},{id:'b'}],{instance:'ramp-replay',seed:4,countdownMs:0,roundMs:30000,crates:1}),prediction=createElevatedPrediction(R),step=1000/60;
  const packet=()=>{const s=game.snapshot('a');return{...s,instanceId:s.instance,you:'a',youDrive:true,inputAck:s.you,karts:s.karts.map(k=>({...k,pose:{...k.pose,
    position:Object.fromEntries(Object.entries(k.pose.position).map(([a,n])=>[a,+n.toFixed(3)])),rotation:Object.fromEntries(Object.entries(k.pose.rotation).map(([a,n])=>[a,+n.toFixed(6)])),
    wheels:k.pose.wheels.map(w=>({length:w.length,rotation:w.rotation,steering:w.steering}))}}))};};
  let maxError=0,up=0,down=0;
  try{
    game.advance(step);let snapshot=packet();prediction.ingest(snapshot,1000,snapshot.serverAt);
    for(let n=1;n<=1050;n++){
      const input={throttle:n<=310?1:-1,steer:0,brake:0,nitro:false,use:false},s=game.snapshot('a'),at=s.serverAt+step,arrival=1000+n*step;
      assert(game.input('a',{...input,instance:s.instance,life:s.you.life,controlEpoch:s.you.controlEpoch,seq:s.you.receivedSeq+1},s.serverAt).ok);
      const predicted=prediction.frame(snapshot,input,C.fixedDt,arrival,at);game.advance(at);const current=packet();
      if(predicted){maxError=Math.max(maxError,Math.hypot(...['x','y','z'].map(a=>predicted.pose.position[a]-current.karts[0].pose.position[a])));
        const shown=conform(predicted.renderPose,{position:{},rotation:{}}),remote=conform(current.karts[0].pose,{position:{},rotation:{}});
        if(Number.isFinite(raisedSurfaceHeight(ramp,shown.position.x,shown.position.z))){
          if(n<=310)up++;else down++;
          for(const p of[shown,remote])for(const x of[-1.38,1.38])for(const z of[-2.2,2.2]){point.set(x,-.42,z).applyQuaternion(q.copy(p.rotation)).add(p.position);assert(point.y-raisedSurfaceHeight(ramp,point.x,point.z)>-.02,'live predicted/compact remote bumper clears the loading ramp');}
        }
      }
      if(n%3===0){snapshot=current;prediction.ingest(snapshot,arrival,at);}
    }
    assert(up>60&&down>60,'authority/prediction replay visits the slope in both directions: '+JSON.stringify({up,down}));assert(maxError<.12,'ramp prediction matches authority within 12cm: '+maxError);evidence.prediction={maxError,up,down};
  }finally{prediction.dispose();game.dispose();}
}
// Drive a real kart obliquely into each map's boundary; throttle must slide
// along it and reverse must escape. No recovery timer or teleport is used.
for(const id of elevatedMapIds){
  const map=elevatedMap(id),physics=createKartPhysics(R,C),wall=map.colliders.find(d=>d.id==='north-boundary');
  physics.addStatic({id:'floor',shape:'box',position:{x:0,y:-1,z:0},half:{x:map.half,y:1,z:map.half},grip:1});physics.addStatic(wall);
  physics.addKart('bot',{position:{x:-12,y:1,z:map.half-7},rotation:qYaw(.65)});for(let i=0;i<90;i++)physics.step();
  physics.applyIntent('bot',{throttle:1,steer:0,brake:0});for(let i=0;i<150;i++)physics.step();const contact=physics.pose('bot');
  assert(contact.position.x>-5,id+' glances along the wall instead of sticking');
  physics.applyIntent('bot',{throttle:-1,steer:0,brake:0});for(let i=0;i<180;i++)physics.step();const reverse=physics.pose('bot');
  assert(Math.hypot(reverse.position.x-contact.position.x,reverse.position.z-contact.position.z)>4,id+' reverses away after contact');assert(reverse.position.z<map.half-2,id+' reverse leaves the wall');physics.dispose();evidence.wallEscapes++;
}
// Cached broad phase must preserve exact camera hits while rejecting distant
// meshes. Repeated queries create no new scene geometry or materials.
{
  const world=createKartElevatedWorld(THREE,{map:'foundry'}),meshes=[...world.colliderMeshes.values()].map(r=>r.cameraBody),query=createRaisedCameraQuery(THREE,meshes),ray=new THREE.Raycaster(),a=[],b=[];
  for(let i=0;i<2000;i++){
    const x=-105+(i%43)*5,z=-105+(i%41)*5;ray.set(new THREE.Vector3(x,i%3===0?11:3,z),new THREE.Vector3(Math.sin(i),.1,Math.cos(i)).normalize());ray.far=12;a.length=b.length=0;ray.intersectObjects(meshes,false,a);query.intersect(ray,b);
    assert.equal(a[0]?.object,b[0]?.object);if(a[0])assert(Math.abs(a[0].distance-b[0].distance)<1e-6);
  }
  for(const mesh of meshes){
    const box=new THREE.Box3().setFromObject(mesh);ray.set(box.getCenter(new THREE.Vector3()),new THREE.Vector3(0,-1,0));ray.far=3;a.length=b.length=0;ray.intersectObjects(meshes,false,a);query.intersect(ray,b);assert.equal(a[0]?.object,b[0]?.object,'rays inside collider bounds keep exact hits');
  }
  evidence.camera=query.stats();assert(evidence.camera.candidates<evidence.camera.fullCandidates*.15,'camera broad phase rejects at least 85% of full mesh visits');world.dispose();
}
const assets=await auditAssets();
for(const id of['foundry','skyport','harbor'])for(const tier of['high','medium','low'])for(const players of[2,8,32]){
  const audit=auditRaised({id,assets,tier,players});assert(audit.stats.draws<=90,id+'/'+tier+'/'+players+' <=90 colour+shadow draws');assert(audit.stats.triangles<=70000,id+' <=70k triangles including shadows');
  if(tier==='low')assert(audit.stats.shadowDraws===0,id+' low tier has no shadow pass');
  evidence.renderBudgets.push({id,tier,players,...audit.stats});audit.dispose();
}
await writeFile('/tmp/codex-raised-regressions.json',JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify({pass:true,...evidence,scope:'real geometry, Rapier replays, exact camera queries; conservative unculled draw/triangle census, not GPU timing'}));

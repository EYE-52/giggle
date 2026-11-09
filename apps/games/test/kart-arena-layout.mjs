// Shipping layouts, actual Rapier and shared prediction. No planar substitute.
import assert from 'node:assert/strict';
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import config from '../public/js/engines/kart-physics-config.mjs';
import {classicStatics,classicControls,createClassicMotion} from '../public/js/engines/kart-classic-motion.mjs';
import {createClassicPrediction} from '../public/js/engines/kart-classic-prediction.mjs';
import {createSurfaceIndex,onRoad,surfaceTuning} from '../public/js/engines/kart-surface.mjs';
import {createRoadTerrain} from '../public/js/engines/kart-road-terrain.mjs';
import {portalExit} from '../public/js/engines/kart-map-features.mjs';
import {createKartArenaStructures,drawArenaRoads2d,drawArenaStructures2d} from '../public/js/engines/kart-arena-structure-art.mjs';
import POCKET from '../games/pocket-karts/server.js';
import maps from '../games/engines/kart-maps.js';
await RAPIER.init();
let checks=0;const ok=(v,m)=>{assert.ok(v,m);checks++;};
const distance=(r,x,z)=>Math.hypot(Math.max(0,Math.abs(x-r.x)-r.hw),Math.max(0,Math.abs(z-r.z)-r.hd));
const rampRect=r=>({x:r.x,z:r.z,hw:Math.abs(Math.cos(r.angle))*r.hw+Math.abs(Math.sin(r.angle))*r.hl,hd:Math.abs(Math.sin(r.angle))*r.hw+Math.abs(Math.cos(r.angle))*r.hl});
const kart=(x,z,angle=0)=>({pid:'a',x,z,angle,speed:0,input:{throttle:1,steer:0},nitro:1,boost:0,boostCd:0,turbo:0,padCd:0,spawnSeq:0,connected:true});
const stateFor=(m,k)=>({...structuredClone(m),map:m.id,mode:'battle',karts:[k],physicalEvents:[],physicalEventSeq:0});
const online=new Set(['a']),reports=[];

function navigation(m){
 const bound=m.half-3,size=bound*2+1,seen=new Uint8Array(size*size),queue=new Int32Array(size*size),solids=[...m.blocks,...m.barriers,...(m.features?.falls||[])];
 function blocked(x,z,radius=1.6){
  if(Math.max(Math.abs(x),Math.abs(z))>bound||solids.some(r=>distance(r,x,z)<radius))return true;
  return m.ramps.some(r=>{const dx=x-r.x,dz=z-r.z,c=Math.cos(r.angle),s=Math.sin(r.angle),u=dx*c-dz*s,v=dx*s+dz*c;return Math.hypot(Math.abs(u)-r.hw,Math.max(0,Math.abs(v)-r.hl))<radius;});
 }
 const cell=(x,z)=>(Math.round(z)+bound)*size+Math.round(x)+bound;
 const start=cell(m.spawns[0].x,m.spawns[0].z);let head=0,tail=0;queue[tail++]=start;seen[start]=1;
 while(head<tail){const i=queue[head++],x=i%size-bound,z=Math.floor(i/size)-bound;for(const [dx,dz]of [[1,0],[-1,0],[0,1],[0,-1]]){if(blocked(x+dx,z+dz))continue;const n=cell(x+dx,z+dz);if(!seen[n]){seen[n]=1;queue[tail++]=n;}}}
 let unreachable=0;for(let z=-bound;z<=bound;z++)for(let x=-bound;x<=bound;x++)if(!blocked(x,z)&&!seen[cell(x,z)])unreachable++;
 return {unreachable,blocked,reached:(x,z)=>!blocked(Math.round(x),Math.round(z))&&seen[cell(x,z)]===1,cells:tail};
}
// Named fight regions and crate pockets have measured, clear mouths. The
// full one-metre flood above also checks every destination and off-road loop.
const regions={
 ring:[{at:[0,0],gates:[[-10,-6,0,6],[10,-6,0,6],[-10,6,0,6],[10,6,0,6]]}],
 blocks:[{at:[0,0],gates:[[0,-7,6,0],[0,7,6,0]]},
  {at:[-22,-7],gates:[[-22,-7,0,6],[-22,7,0,6]]}],
 garden:[{at:[0,-17],gates:[[0,-23,10,0],[17,0,0,10],[-17,0,0,10],[0,23,10,0]]}],
 frost:[{at:[0,0],gates:[[-27,0,0,7],[27,0,0,7],[0,-6,10,0],[0,6,10,0]]}],
 neon:[{at:[0,0],gates:[[0,-9,8,0],[0,23,8,0],[-16,-9,0,7],[16,23,0,7]]}],
};
for(const id of maps.mapIds()){
 const m={id,...maps.mapDef(id)},terrain=createRoadTerrain(m),solids=[...m.blocks,...m.barriers,...m.ramps.map(rampRect)],nav=navigation(m),index=createSurfaceIndex(m);
 ok(m.roads.length>=3&&m.barriers.length>=6&&m.ramps.length>=1,id+' authored layout');ok(classicStatics(m).length<=128,id+' static budget');ok(nav.unreachable===0,id+' every open grid cell connected '+nav.unreachable);
 for(const [label,points,margin]of [['spawn',m.spawns,3],['spot',m.spots.map(([x,z])=>({x,z})),2.5],['cannon',m.features.cannons,3],['landing',m.features.cannons.map(c=>c.land),3]])for(const p of points){
  ok(solids.every(r=>distance(r,p.x,p.z)>=margin-1e-5),id+' clear '+label+' '+JSON.stringify(p));ok(nav.reached(p.x,p.z),id+' reachable '+label+' '+JSON.stringify(p));
 }
 for(const c of m.features.cannons)ok(onRoad(index,c.land.x,c.land.z),id+' cannon lands on a fast route');
 for(const p of m.pads){ok(solids.every(r=>distance({...r,hw:r.hw+p.hw,hd:r.hd+p.hd},p.x,p.z)>=1.5),id+' whole pad footprint clear');ok(nav.reached(p.x,p.z),id+' reachable pad');ok(onRoad(index,p.x,p.z),id+' fast pad');}
 for(const p of m.features.portals.flat()){
  ok(solids.every(r=>distance(r,p.x,p.z)>=2.5),id+' portal footprint clear');const e=portalExit(p);
  for(let d=0;d<=8;d+=.5)ok(solids.every(r=>distance(r,e.x+Math.sin(p.angle)*d,e.z+Math.cos(p.angle)*d)>=1.6),id+' portal exit eight metres clear');
  ok(nav.reached(e.x,e.z),id+' reachable portal exit');ok(nav.reached(p.x+Math.sin(p.angle)*3,p.z+Math.cos(p.angle)*3),id+' reachable ring approach');
 }
 for(const f of m.features.falls){ok(solids.every(r=>distance({...r,hw:r.hw+f.hw,hd:r.hd+f.hd},f.x,f.z)>=1.5),id+' fall footprint clear');ok([[f.x-f.hw-3,f.z],[f.x+f.hw+3,f.z],[f.x,f.z-f.hd-3],[f.x,f.z+f.hd+3]].some(([x,z])=>nav.reached(x,z)),id+' reachable fall edge');}
 for(const r of [...m.barriers,...m.ramps.map(rampRect)])for(const x of [-r.hw,0,r.hw])for(const z of [-r.hd,0,r.hd])ok(terrain.heightAt(r.x+x,r.z+z)===0,id+' flat structure foundation');
 for(const [i,r]of m.ramps.entries()){
  for(let d=r.hl;d<=r.hl+12;d+=.5){const x=r.x+Math.sin(r.angle)*d,z=r.z+Math.cos(r.angle)*d;ok(Math.max(Math.abs(x),Math.abs(z))+r.hw<m.half-2,id+' ramp '+i+' fence setback');ok([...m.blocks,...m.barriers].every(b=>distance(b,x,z)>r.hw+.5),id+' ramp '+i+' flight clear');}
  const x=r.x+Math.sin(r.angle)*(r.hl+12),z=r.z+Math.cos(r.angle)*(r.hl+12);
  // Pond/goo shortcuts cross water in the air; their touchdown must be dry.
  ok(m.features.falls.every(f=>distance(f,x,z)>2),id+' ramp '+i+' dry landing');
 }
 for(const region of regions[id]){ok(region.gates.length>=(region.pocket?1:2),id+' enough exits');ok(nav.reached(...region.at),id+' connected region');for(const [x,z,w,d]of region.gates){ok(Math.max(w,d)>(region.pocket?5:4),id+' mouth width');for(let t=-.5;t<=.5;t+=.1)ok(!nav.blocked(x+w*t,z+d*t,.2)&&nav.reached(x,z),id+' open gate '+[x,z,w,d]);}}
 const b=m.barriers[id==='ring'?1:id==='blocks'?4:0],alongX=b.hw<b.hd,sign=(alongX?b.x:b.z)<0?-1:1;
 const k=kart(b.x+(alongX?sign*(b.hw+4):0),b.z+(!alongX?sign*(b.hd+4):0),alongX?-sign*Math.PI/2:sign>0?Math.PI:0);k.input.nitro=true;
 const state=stateFor(m,k),motion=createClassicMotion(RAPIER,config,state);let contact=false,maxCross=-Infinity;
 try{
  // Start at boosted road speed in the real body, then keep full nitro.
  motion.restore(k,{...k.physicalPose,linearVelocity:{x:Math.sin(k.angle)*32,y:0,z:Math.cos(k.angle)*32}});
  // A low-friction glance may eventually drive around a finite wall's end.
  // Check crossing while the kart centre is still opposite its solid face.
  for(let i=0;i<65;i++){motion.advance(1/60,online);contact ||= state.physicalEvents.some(e=>e.surfaceId?.startsWith('barrier-'));if(Math.abs((alongX?k.z:k.x)-(alongX?b.z:b.x))<=(alongX?b.hd:b.hw))maxCross=Math.max(maxCross,-sign*((alongX?k.x:k.z)-(alongX?b.x:b.z)));}
  ok(contact&&maxCross<0,id+' wall stops full-speed nitro '+JSON.stringify({contact,maxCross,x:k.x,z:k.z,y:k.physicalPose.position.y}));
  const ray=(y,radius=.05)=>motion.sweepStatic({x:b.x+(alongX?-3:0),y,z:b.z+(!alongX?-3:0)},{x:b.x+(alongX?3:0),y,z:b.z+(!alongX?3:0)},radius);
  ok(ray(.5)?.surfaceId.startsWith('barrier-')&&!ray(1.25,.22),id+' full-radius pulse clears the low wall');
 }finally{motion.dispose();}
 const jumps=[];
 for(const [i,r]of m.ramps.entries()){
  const d=r.hl+(id==='blocks'?4:10),k=kart(r.x-Math.sin(r.angle)*d,r.z-Math.cos(r.angle)*d,r.angle),state=stateFor(m,k),motion=createClassicMotion(RAPIER,config,state);let peak=0,air=false,land=false,hazard=false;
  try{
   for(let j=0;j<240;j++){
    motion.advance(1/60,online);const p=k.physicalPose,progress=(k.x-r.x)*Math.sin(r.angle)+(k.z-r.z)*Math.cos(r.angle);
    if(progress>=-r.hl&&progress<r.hl+16){peak=Math.max(peak,p.position.y-terrain.heightAt(k.x,k.z));if(!p.grounded&&progress>0)air=true;if(air&&p.grounded&&progress>r.hl+1)land=true;}
    if(air&&m.features.falls.some(f=>distance(f,k.x,k.z)<.5)&&p.position.y<.8)hazard=true;
    ok(Math.max(Math.abs(k.x),Math.abs(k.z))<m.half,id+' ramp stays inside');if(land)break;
   }
   ok(peak>=.8&&air&&land&&!hazard,id+' ramp '+i+' air and safe landing '+JSON.stringify({peak,air,land,hazard}));jumps.push(+peak.toFixed(2));
  }finally{motion.dispose();}
 }
 reports.push({id,roads:m.roads.length,barriers:m.barriers.length,ramps:m.ramps.length,reachableCells:nav.cells,jumpPeaks:jumps});
}
const flat={id:'surface-fixture',half:300,blocks:[],pads:[{x:30,z:30,hw:2,hd:3}],surfaces:[{x:40,z:40,hw:4,hd:4,grip:.3}],barriers:[],ramps:[],roads:[{points:[[-20,-200],[-20,200]],width:8}],offroad:{kind:'grass',top:.7,traction:.8}},index=createSurfaceIndex(flat);
// Profiles now include shared presentation metadata alongside motion values.
assert.equal(surfaceTuning(index,-20,0).top,1);assert.equal(surfaceTuning(index,-20,0).traction,1);assert.equal(surfaceTuning(index,20,0).top,.7);assert.equal(surfaceTuning(index,20,0).traction,.8);assert.equal(surfaceTuning(index,40,40).kind,'ice');
ok(onRoad(index,-15.7,0)&&!onRoad(index,-15.69,0),'road .3m margin');ok(onRoad(index,30,30)&&onRoad(index,40,40),'pad and ice overrides');assert.strictEqual(surfaceTuning(index,20,0),surfaceTuning(index,21,1));ok(onRoad(createSurfaceIndex({}),1e3,-1e3),'legacy handling');ok(onRoad(createSurfaceIndex({roads:[{points:[[0,0],[10,0],[10,10]],width:2,closed:true}]}),4,4),'closing road segment');
const grounded={...kart(20,0),physicalPose:{grounded:true,angularVelocity:{y:0}}},control=classicControls(grounded,1/60,flat,true,index);
ok(control.tuning.top===.7&&control.tuning.traction===.8&&control.tuning.rearTraction===1,'surface traction applies once to both axles');grounded.spinT=1;ok(classicControls(grounded,1/60,flat,true,index).tuning.rearTraction===.12,'oil rear grip stays valid without squaring the surface traction');grounded.spinT=0;grounded.physicalPose.grounded=false;ok(classicControls(grounded,1/60,flat,true,index).tuning.top===1,'airborne momentum');
// A spinning kart off road must not send grip below Rapier's valid range.
{const k=kart(20,-150);k.spinT=1;const motion=createClassicMotion(RAPIER,config,stateFor(flat,k));try{for(let i=0;i<60;i++)motion.advance(1/60,online);ok(Number.isFinite(k.speed),'actual offroad spin remains valid');}finally{motion.dispose();}}
const speeds=[];
for(const x of [-20,20]){
 const k=kart(x,-150),state=stateFor(flat,k),authority=createClassicMotion(RAPIER,config,state),prediction=createClassicPrediction(RAPIER),snap=()=>({instanceId:'surface-'+x,phase:'drive',you:'a',youDrive:true,mode:'battle',map:flat,karts:[structuredClone(k)]});
 try{for(let i=0;i<480;i++)authority.advance(1/60,online);speeds.push(k.speed);prediction.ingest(snap(),8000);authority.advance(1/60,online);const p=prediction.frame(snap(),k.input,1/60,8016.6667),sim=prediction.selfPose().position;
  // Compare the simulated pose; drawn frames blend between fixed steps.
  ok(Math.abs(p.speed-k.speed)<1e-5&&Math.hypot(sim.x-k.physicalPose.position.x,sim.z-k.physicalPose.position.z)<1e-5,'one-step prediction '+x);}finally{authority.dispose();prediction.dispose();}
}
ok(speeds[1]<=speeds[0]*.85,'real Rapier offroad >=15% slower '+speeds);
await POCKET.initialize();const players=[{id:'a',name:'A'},{id:'b',name:'B'}],ctx={now:()=>10000,settings:()=>({map:'Garden Circuit',mode:'Zap Battle'}),players:()=>players,allPlayers:()=>players,broadcast(){},award(){},later:()=>()=>{}},state=POCKET.create(ctx);
try{
 const view=POCKET.view(state,'a');
 for(const key of ['roads','offroad','barriers','ramps']){
  assert.deepEqual(view.map[key],maps.mapDef('garden')[key],key+' reaches snapshot');
  ok(view.karts.every(k=>!Object.hasOwn(k,key)),key+' belongs only to snapshot.map');
 }
}finally{POCKET.dispose(state);}
// The shipping engine must also allow the pond/goo crossing. Its old fall
// trigger looked only at X/Z, which would KO even a successful physical jump.
for(const id of ['garden','neon'])for(const mode of ['Zap Battle','Star Rush']){
 const m=maps.mapDef(id),r=m.ramps[0],f=m.features.falls[0];let now=20000;
 const ctx={instanceId:id+'-ramp-'+mode,now:()=>now,settings:()=>({map:m.label,mode}),players:()=>players,allPlayers:()=>players,broadcast(){},award(){},later:()=>()=>{}};
 const state=POCKET.create(ctx),k=state.karts[0];
 try{
  now+=3000;POCKET.onTick(state,ctx);state.crates=[];state.stars=[];
  const d=r.hl+10;Object.assign(k,{x:r.x-Math.sin(r.angle)*d,z:r.z-Math.cos(r.angle)*d,angle:r.angle,spawnSeq:(k.spawnSeq||0)+1,shield:0});POCKET.onTick(state,ctx);
  const life=k.spawnSeq;let sequence=0,crossed=false,landed=false;
  for(let i=0;i<240;i++){
   if(i%3===0){const ack=POCKET.view(state,k.pid).inputAck;POCKET.onAction(state,ctx,k.pid,{seq:++sequence,life:ack.life,controlEpoch:ack.controlEpoch,input:{throttle:1,steer:0,boost:false}});}
   now+=1000/60;POCKET.onTick(state,ctx);
   if(!k.physicalPose.grounded&&((k.x-r.x)*Math.sin(r.angle)+(k.z-r.z)*Math.cos(r.angle))>0)crossed=true;
   const progress=(k.x-r.x)*Math.sin(r.angle)+(k.z-r.z)*Math.cos(r.angle);
   if(crossed&&progress>r.hl+12&&k.physicalPose.grounded){landed=true;break;}
  }
  ok(crossed&&landed&&k.spawnSeq===life&&!(k.respawn>0)&&!state.featureEvents.some(e=>e.type==='fell'),id+' '+mode+' shipping jump launches and lands safely '+JSON.stringify({crossed,landed,x:k.x,z:k.z,life,spawnSeq:k.spawnSeq,respawn:k.respawn,events:state.featureEvents}));
 }finally{POCKET.dispose(state);}
}
const scene=new THREE.Scene(),art=createKartArenaStructures(THREE,scene),resources=new Set();
for(const id of maps.mapIds()){
 const m={id,...maps.mapDef(id)};art.sync(m);const st=art.stats();ok(st.drawCalls===5&&st.barriers===m.barriers.length&&st.ramps===m.ramps.length,id+' five structure draws including contact shadows');
 const meshes=[];art.root.traverse(o=>{if(o.isMesh){ok(o.isInstancedMesh,id+' instanced structures');meshes.push(o);resources.add(o.geometry);resources.add(o.material);}});
 const buffers=meshes.map(o=>o.instanceMatrix.array);for(let i=0;i<180;i++){art.sync(m);art.animate();}meshes.forEach((o,i)=>assert.strictEqual(o.instanceMatrix.array,buffers[i]));
 const wedgeGeometry=art.root.getObjectByName('arena-ramp-wedges').geometry;
 ok(Number.isFinite(wedgeGeometry.attributes.normal.getY(0)),id+' finite wedge normals');
 const positions=wedgeGeometry.attributes.position,indices=wedgeGeometry.index,ab=new THREE.Vector3(),ac=new THREE.Vector3(),a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3();let upward=0;
 for(let i=0;i<indices.count;i+=3){a.fromBufferAttribute(positions,indices.getX(i));b.fromBufferAttribute(positions,indices.getX(i+1));c.fromBufferAttribute(positions,indices.getX(i+2));ab.subVectors(b,a);ac.subVectors(c,a);if(ab.cross(ac).y>0)upward++;}
 ok(upward===2,id+' wedge top has outward visible winding');
 const matrix=new THREE.Matrix4();art.root.getObjectByName('arena-ramp-wedges').getMatrixAt(0,matrix);const top=new THREE.Vector3(0,1,1).applyMatrix4(matrix),r=m.ramps[0];ok(Math.abs(top.x-r.x-Math.sin(r.angle)*r.hl)<1e-5&&Math.abs(top.z-r.z-Math.cos(r.angle)*r.hl)<1e-5&&Math.abs(top.y-r.h)<1e-5,id+' matching wedge heading');
}
let released=0;for(const r of resources)r.addEventListener('dispose',()=>released++);art.dispose();art.dispose();ok(released===resources.size&&!scene.getObjectByName('arena-structures'),'dispose exactly once');
let painted=0;const canvas=new Proxy({},{get:(t,k)=>t[k]||(()=>painted++),set:(t,k,v)=>(t[k]=v,true)});drawArenaRoads2d(canvas,maps.mapDef('garden'),x=>x,z=>z,2);drawArenaStructures2d(canvas,maps.mapDef('garden'),x=>x,z=>z,2);ok(painted>30,'2D fallback paints structures and roads');
console.log(JSON.stringify({pass:true,checks,reports,speeds,scope:'layout grid and mouths, actual Rapier structures/surfaces, prediction, art, transport'}));

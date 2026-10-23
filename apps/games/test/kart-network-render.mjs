import assert from 'node:assert/strict';
import {createPoseStore,ingestSnapshot,framePoses,REMOTE_BUFFER_MS,stepSelf} from '../public/js/engines/kart-pose.mjs';
import {createRequire} from 'node:module';
import {projectilePose,grenadePose} from '../public/js/engines/kart-flight.mjs';
const kart=(pid,z,extra={})=>({pid,x:0,z,angle:0,speed:14,vx:0,vz:14,spawnSeq:0,...extra});
const snap=(simAt,karts)=>({phase:'drive',mode:'battle',simAt,karts,map:{bound:58,blocks:[]}});
const input={steer:0,throttle:1};
const st=createPoseStore();let S=snap(1000,[kart('me',0)]);
ingestSnapshot(st,S,'me',1080);
framePoses(st,S,input,.1,1180,{serverNow:1180});
const before=framePoses(st,S,input,0,1180,{serverNow:1180}).get('me');
S=snap(1100,[kart('me',1.4)]);ingestSnapshot(st,S,'me',1180);
const after=framePoses(st,S,input,0,1180,{serverNow:1180}).get('me');
assert(Math.hypot(before.x-after.x,before.z-after.z)<1e-9,'packet reconciliation never pops visible self');
S=snap(1200,[kart('me',2.8,{respawn:2,speed:0})]);ingestSnapshot(st,S,'me',1280);
for(let n=1;n<=20;n++)assert.equal(framePoses(st,S,input,1/60,1280+n*16.7,{}).get('me').z,2.8,'KO cannot visually drive');
S=snap(1300,[kart('me',40,{spawnSeq:1,speed:0})]);ingestSnapshot(st,S,'me',1380);
assert.equal(framePoses(st,S,input,0,1380,{}).get('me').z,40,'respawn snaps without old error offset');
const remote=createPoseStore();
for(const t of [1000,1100,1200,1300])ingestSnapshot(remote,snap(t,[kart('r',(t-1000)*.014,{vx:3,vz:14,slip:3})]),'me',t+80);
const remoteS=snap(1300,[kart('r',4.2)]);
let prev=null,maxStep=0;
for(let t=1200;t<=1300;t+=10){
 const p=framePoses(remote,remoteS,input,.01,t,{serverNow:t+REMOTE_BUFFER_MS}).get('r');
 assert(Math.abs(p.z-(t-1000)*.014)<1e-8,'interpolation follows simulation time, not packet arrival');
 if(prev)maxStep=Math.max(maxStep,Math.abs(p.z-prev.z));prev=p;
}
assert(maxStep<.141);
const corpse={...remoteS,karts:[kart('r',7,{x:3,respawn:2})]};assert.deepEqual(framePoses(remote,corpse,input,.016,1350,{serverNow:1350}).get('r'),{x:3,z:7,angle:0},'remote KO draws at the accepted wreck location');
const offline={...remoteS,karts:[kart('r',8,{connected:false})]};assert.equal(framePoses(remote,offline,input,.016,1350,{serverNow:1350}).get('r').z,8,'offline rival cannot visually coast');
const samples=remote.rem.get('r').samples.length;
ingestSnapshot(remote,snap(1300,[kart('r',4.2,{vx:3,vz:14,slip:3})]),'me',1500);
assert.equal(remote.rem.get('r').samples.length,samples,'duplicate timestamp does not extend history');
ingestSnapshot(remote,snap(1100,[kart('r',50)]),'me',1510);
assert.equal(remote.rem.get('r').sz,4.2,'older samples cannot rewind');
const lead=framePoses(remote,remoteS,input,.01,1500,{serverNow:1550}).get('r');
assert(lead.x>0,'extrapolation uses actual lateral velocity');
const frozen=framePoses(remote,remoteS,input,.01,8000,{serverNow:8000}).get('r');
assert(frozen.z<=6.31,'packet loss lead is bounded');
const shot={x:0,z:0,angle:0,kind:'rail',speed:110,ttl:1};
assert.equal(projectilePose(shot,snap(1000,[]),1100).z,11,'shots move at real server speed between packets');
assert.equal(projectilePose(shot,{...snap(1000,[]),map:{bound:58,blocks:[{x:0,z:5,hw:3,hd:1}]}},1100).z,3.55,'fast cosmetic shots stop at cover');
assert.equal(projectilePose(shot,snap(1000,[]),1400).visible,false,'lost-packet projectiles disappear');
assert.equal(projectilePose({...shot,ttl:.03},snap(1000,[]),1100).visible,false,'TTL respected');
for(let t=1400;t<4000;t+=50)ingestSnapshot(remote,snap(t,[kart('r',4.2)]),'me',t+80);
assert(remote.rem.get('r').samples.length<=8,'history bounded');
const {helpers}=createRequire(import.meta.url)('../games/engines/kart-engine.js');
for(const level of [0,1,2,3]){
 const server={x:0,z:0,angle:0,speed:0,slip:0,boost:0,boostCd:0,turbo:0,padCd:0,driftCharge:0,drifting:false,garage:true,upgrades:{engine:level,handling:level},input:{steer:.35,throttle:1,drift:false}};
 const predicted={...server,tuning:helpers.tuningFor(server)};
 for(let tick=0;tick<90;tick++){
   server.input={steer:tick>40?-.45:.35,throttle:1,drift:tick>20&&tick<42};
   helpers.stepKart(server,.1,{allowBoost:false,bound:58});
   stepSelf(predicted,server.input,.1,{allowBoost:false,bound:58});
   for(const key of ['x','z','angle','speed','slip','turbo'])assert(Math.abs(server[key]-predicted[key])<1e-9,`garage level${level} prediction mirrors ${key}`);
 }
}
// A chord between two legal remote poses may cross cover; both timestamped
// interpolation and legacy easing must project the visible hull back outside.
const cover={x:0,z:0,hw:2,hd:2},coverS=t=>({...snap(t,[kart('r',-5,{x:-5,angle:1.5})]),map:{bound:58,blocks:[cover]}});
const curved=createPoseStore();let cs=coverS(1000);ingestSnapshot(curved,cs,'me',1000);
cs={...coverS(1100),karts:[kart('r',5,{x:5,angle:1.5})]};ingestSnapshot(curved,cs,'me',1100);
const safe=p=>Math.hypot(Math.max(0,Math.abs(p.x)-2),Math.max(0,Math.abs(p.z)-2))>=2.05-1e-8;
for(let t=1000;t<=1100;t+=5)assert(safe(framePoses(curved,cs,input,.016,t,{serverNow:t+REMOTE_BUFFER_MS}).get('r')),'remote interpolation never cuts through cover');
curved.rem.get('r').samples=[];
for(let i=0;i<20;i++)assert(safe(framePoses(curved,cs,input,.016,1100+i*16,{}).get('r')),'legacy remote ease stays outside cover');
const grenade={x:0,z:0,y:1,angle:0,vx:0,vz:22,vy:8,fuse:1,warning:false};
assert.equal(grenadePose(grenade,{...snap(1000,[]),map:{bound:58,blocks:[{x:0,z:3,hw:3,hd:1}]}},1200).z,1.55,'canister lead stops at full-height cover');
assert.equal(grenadePose({...grenade,fuse:.03},snap(1000,[]),1100).visible,false,'expired fuse never draws stale canister');
assert.equal(grenadePose(grenade,snap(1000,[]),1400).visible,false,'missing-packet grenade lead expires');
console.log('KART_NETWORK_RENDER_PASS: continuous self correction, frozen KO, respawn epochs, timestamped remote buffering, slip, stale/duplicate packets, bounded shot flight and cover');

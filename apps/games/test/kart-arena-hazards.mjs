// Fall-off zones through the real Pocket Karts engine (KO, score, respawn,
// no credit) and client prediction staying bounded through a cannon launch
// and a portal teleport. Run: node test/kart-arena-hazards.mjs
import assert from 'node:assert/strict';
import RAPIER from '@dimforge/rapier3d-compat';
import config from '../public/js/engines/kart-physics-config.mjs';
import {createClassicMotion} from '../public/js/engines/kart-classic-motion.mjs';
import {createClassicPrediction} from '../public/js/engines/kart-classic-prediction.mjs';
import * as F from '../public/js/engines/kart-map-features.mjs';
import pocket from '../games/pocket-karts/server.js';
import maps from '../games/engines/kart-maps.js';
import battle from '../games/engines/kart-rules-battle.js';
await RAPIER.init();
await pocket.initialize();
let checks=0;const ok=(v,m)=>{assert.ok(v,m);checks++;};const eq=(a,b,m)=>{assert.deepEqual(a,b,m);checks++;};

function stubCtx(settings,ids=['pa','pb','pc']){
 const players=ids.map(id=>({id,name:id.toUpperCase()}));
 const ctx={_now:7000000,_awards:{},instanceId:'hazard-'+Math.random().toString(36).slice(2),
  players:()=>players.slice(),allPlayers:()=>players.slice(),content:()=>({}),settings:()=>({...settings}),hostId:()=>ids[0],
  broadcast(){},lobby(){},later:()=>()=>{},award(pid,pts){ctx._awards[pid]=(ctx._awards[pid]||0)+pts;},now:()=>ctx._now};
 return ctx;
}
function start(settings){
 const ctx=stubCtx(settings),st=pocket.create(ctx);
 ctx._now+=3000;pocket.onTick(st,ctx);eq(st.phase,'drive','countdown reaches drive');
 return {ctx,st,tick(ms=50){ctx._now+=ms;for(const k of st.karts)k.lastInputAt=ctx._now;pocket.onTick(st,ctx);}};
}
// Place a kart through a fresh life (the motion resets the body there).
const place=(k,x,z,angle=0)=>{k.x=x;k.z=z;k.angle=angle;k.spawnSeq=(k.spawnSeq||0)+1;};

// ---- battle: a fall is a self-KO costing one KO, never below zero, with
// the normal respawn, and nobody is credited ----
for(const id of ['garden','frost','neon','ring','blocks']){
 const label=maps.mapDef(id).label,g=start({map:label,mode:'Zap Battle'}),{st}=g;
 const zone=maps.mapDef(id).features.falls[0];
 const [a,b,c]=st.karts;
 a.hits=2;st.scores[a.pid]=2;b.hits=1;st.scores[b.pid]=1;c.hits=0;st.scores[c.pid]=0;
 for(const k of st.karts)k.shield=0;
 // Park the rivals far from the hazard so only the faller is involved.
 place(b,0,id==='ring'||id==='blocks'?-18:-30);place(c,id==='ring'||id==='blocks'?18:30,0);
 g.tick();
 const coinsBefore=JSON.stringify(st.coins);
 place(a,zone.x,zone.z,0);
 g.tick();
 ok(a.respawn>0,id+': falling in starts the KO/respawn flow');
 eq([a.hits,st.scores[a.pid]],[1,1],id+': the faller loses one KO');
 eq([b.hits,c.hits,st.scores[b.pid],st.scores[c.pid]],[1,0,1,0],id+': nobody is credited');
 const feed=st.events.filter(e=>e.pid===a.pid||e.other===a.pid);
 ok(feed.some(e=>e.type==='fell'&&e.pid===a.pid&&e.other===undefined),id+': the feed records a fall');
 ok(!st.events.some(e=>e.type==='ko'&&e.other===a.pid),id+': no knockout is recorded against anyone');
 eq(JSON.stringify(st.coins),coinsBefore,id+': no coins change hands');
 const view=pocket.view(st,a.pid),me=view.karts.find(k=>k.pid===a.pid);
 ok(me.fell===true&&me.respawn>0,id+': view marks the faller');
 ok(view.arenaEvents.some(e=>e.type==='fell'&&e.pid===a.pid&&Number.isFinite(e.x)),id+': fall presentation event for the splash');
 ok(view.map.features&&view.map.features.falls.length===1,id+': view carries the arena features');
 // Respawn completes on the normal timer, outside the hazard.
 const life=a.spawnSeq;
 for(let i=0;i<60&&a.respawn>0;i++)g.tick();
 ok(a.respawn===0&&a.spawnSeq===life+1,id+': normal respawn returns the kart');
 ok(!F.fallAt(maps.mapDef(id).features,a.x,a.z),id+': respawned outside the fall zone');
 g.tick();
 ok(pocket.view(st,a.pid).karts.find(k=>k.pid===a.pid).fell===false,id+': fall marker clears after respawn');
 // A second fall at one KO goes to zero, a third stays at zero.
 a.shield=0;place(a,zone.x,zone.z,0);g.tick();
 eq(a.hits,0,id+': second fall reaches zero');
 for(let i=0;i<60&&a.respawn>0;i++)g.tick();
 a.shield=0;place(a,zone.x,zone.z,0);g.tick();
 eq([a.hits,st.scores[a.pid]],[0,0],id+': score never drops below zero');
 ok(a.respawn>0,id+': still knocked out at zero');
 pocket.dispose(st);
}
ok(typeof battle.fallOut==='function','battle exports the fall rule');

// ---- Star Rush: lose a star (never below zero) and recover at once ----
{
 const g=start({map:'Garden Circuit',mode:'Star Rush'}),{st}=g,[a]=st.karts,zone=maps.mapDef('garden').features.falls[0];
 a.stars=3;st.scores[a.pid]=3;const life=a.spawnSeq||0;
 place(a,zone.x,zone.z,0);g.tick();
 eq([a.stars,st.scores[a.pid]],[2,2],'star rush: a fall drops one star');
 ok(a.spawnSeq===life+2&&!F.fallAt(maps.mapDef('garden').features,a.x,a.z),'star rush: the kart is recovered at a spawn');
 ok(st.featureEvents.some(e=>e.type==='fell'&&e.pid===a.pid),'star rush: fall presentation event');
 a.stars=0;st.scores[a.pid]=0;place(a,zone.x,zone.z,0);g.tick();
 eq(a.stars,0,'star rush: never below zero');
 pocket.dispose(st);
}

// ---- engine view: launch and landing events plus flight state on the wire ----
{
 const g=start({map:'Garden Circuit',mode:'Zap Battle'}),{st}=g,[a]=st.karts,c=maps.mapDef('garden').features.cannons[0];
 place(a,c.x+Math.cos(c.angle)*6,c.z-Math.sin(c.angle)*6,c.angle-Math.PI/2);
 a.input={steer:0,throttle:1,boost:false};
 let flying=null;
 for(let i=0;i<80;i++){g.tick();const me=pocket.view(st,a.pid).karts.find(k=>k.pid===a.pid);if(me.flight&&!flying)flying=me;}
 const view=pocket.view(st,a.pid);
 ok(flying&&flying.flight.c===0&&Number.isFinite(flying.flight.ly),'flight state is published while airborne');
 ok(view.arenaEvents.some(e=>e.type==='launch'&&e.pid===a.pid)&&view.arenaEvents.some(e=>e.type==='land'&&e.pid===a.pid),'launch and landing events are published');
 ok(view.karts.every(k=>'cannonCd' in k&&'portalCd' in k&&'flight' in k),'feature timers are always on the wire');
 pocket.dispose(st);
}

// ---- prediction: bounded through a launch and a teleport ----
function predictedRun(kind){
 const id='garden',m=maps.mapDef(id),f=m.features;
 const target=kind==='cannon'?f.cannons[0]:f.portals[0][0];
 // Approach from a clear side at 12 m, facing the feature.
 const side=kind==='cannon'?target.angle-Math.PI/2:target.angle;
 const k={pid:'a',x:target.x+Math.sin(side)*12,z:target.z+Math.cos(side)*12,angle:side+Math.PI,speed:0,boost:0,boostCd:0,turbo:0,padCd:0,nitro:1,
  input:{throttle:1,steer:0},spawnSeq:0,connected:true,flight:null,cannonCd:0,portalCd:0};
 // The correction pair must share the new roads, grip and structures too.
 const state={map:id,mode:'battle',half:m.half,blocks:m.blocks,pads:m.pads,surfaces:m.surfaces,roads:m.roads,offroad:m.offroad,barriers:m.barriers,ramps:m.ramps,features:f,karts:[k],physicalEvents:[],physicalEventSeq:0,featureEvents:[],featureEventSeq:0};
 const authority=createClassicMotion(RAPIER,config,state),client=createClassicPrediction(RAPIER),online=new Set(['a']);
 const epoch=1800000000000;let t=0,seq=1,packets=[],previous,steps=[],maxError=0,jumps=0;
 const snap=()=>({instanceId:'predict-'+kind,phase:'drive',you:'a',youDrive:true,mode:'battle',simAt:epoch+t,
  map:{id,half:m.half,blocks:m.blocks,pads:m.pads,surfaces:m.surfaces,roads:m.roads,offroad:m.offroad,barriers:m.barriers,ramps:m.ramps,features:f},karts:[structuredClone(k)],inputAck:{appliedInputSeq:k._appliedSeq||0,controlEpoch:0}});
 k._receivedSeq=seq;client.ingest(snap(),0,epoch);client.sent(seq);
 for(let frame=1;frame<=60*5;frame++){
  t=frame*1000/60;
  authority.advance(1/60,online);
  if(frame%3===0)packets.push({at:t+[60,90,75][frame%9/3|0],s:snap()});
  while(packets.length&&packets[0].at<=t)client.ingest(packets.shift().s,t,epoch+t);
  const draw=client.frame(snap(),{throttle:1,steer:0},1/60,t,epoch+t);
  ok(draw&&Object.values(draw.physicalPose.position).every(Number.isFinite),kind+': finite predicted pose');
  if(previous){const step=Math.hypot(draw.x-previous.x,draw.y-previous.y,draw.z-previous.z);if(step>5)jumps++;else steps.push(step);}
  maxError=Math.max(maxError,Math.hypot(draw.x-k.x,draw.z-k.z));
  previous=draw;
 }
 // Let the last packets land, then compare to authority.
 t+=200;for(const p of packets)client.ingest(p.s,t,epoch+t);
 const settled=client.frame(snap(),{throttle:1,steer:0},0,t,epoch+t);
 const finalError=Math.hypot(settled.x-k.x,settled.z-k.z);
 authority.dispose();client.dispose();
 return {events:state.featureEvents.map(e=>e.type),maxStep:Math.max(...steps),jumps,maxError,finalError};
}
{
 const launch=predictedRun('cannon');
 ok(launch.events.includes('launch')&&launch.events.includes('land'),'prediction fixture: authority launched and landed');
 ok(launch.jumps===0,'launch: no discontinuity in the drawn pose');
 ok(launch.maxStep<1.1,'launch: per-frame drawn motion stays bounded ('+launch.maxStep.toFixed(3)+' m)');
 ok(launch.finalError<.5,'launch: prediction converges on authority ('+launch.finalError.toFixed(3)+' m)');
 const warp=predictedRun('portal');
 ok(warp.events.filter(e=>e==='warp').length===1,'prediction fixture: authority warped once');
 ok(warp.jumps===1,'teleport: exactly one snap, no rubber band back');
 ok(warp.maxStep<1.1,'teleport: every other frame stays bounded ('+warp.maxStep.toFixed(3)+' m)');
 ok(warp.finalError<.5,'teleport: prediction converges on authority ('+warp.finalError.toFixed(3)+' m)');
 console.log(JSON.stringify({pass:true,checks,scope:'engine falls + shared-core prediction fixture (scheduled delays, not measured network)',launch,warp}));
}

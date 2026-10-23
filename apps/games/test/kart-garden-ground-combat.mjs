// Controlled inventory/body/life fixtures in the initialized shipping Pocket
// engine. Every kart pose and static query belongs to its actual Rapier world;
// these are integration checks, not native gameplay acceptance.
import assert from 'node:assert/strict';
import POCKET from '../games/pocket-karts/server.js';
import maps from '../games/engines/kart-maps.js';
import {createRoadTerrain} from '../public/js/engines/kart-road-terrain.mjs';

await POCKET.initialize();
const terrain=createRoadTerrain({id:'garden',...maps.mapDef('garden')});
let checks=0;
const check=(ok,label)=>{assert.ok(ok,label);checks++;};
function fixture(mode='Zap Battle') {
  let now=4000000;
  const players=[{id:'hill-a',name:'A'},{id:'hill-b',name:'B'}],seq=new Map();
  const ctx={instanceId:'garden-ground-combat-unit',now:()=>now,
    settings:()=>({mode,map:'Garden Circuit',roundSeconds:60,winRule:'Time limit',garage:false}),
    players:()=>players,allPlayers:()=>players,broadcast(){},award(){},later:()=>()=>{}};
  const s=POCKET.create(ctx);
  const tick=ms=>{now+=ms;POCKET.onTick(s,ctx);};
  tick(3000);
  // Exercise the ordinary physical life-reset contract, rather than mutating
  // physicalPose while its actual body remains somewhere else.
  function place(k,x,z,angle=0) {
    k.x=x;k.z=z;k.angle=angle;k.spawnSeq=(k.spawnSeq||0)+1;
    tick(0);k.shield=0;
  }
  function fire(k,weapon) {
    k.weapon=weapon;k.ammo=1;k.fireCd=0;k.prevAction=false;
    const ack=POCKET.view(s,k.pid).inputAck,n=(seq.get(k.pid)||0)+1;seq.set(k.pid,n);
    POCKET.onAction(s,ctx,k.pid,{seq:n,life:ack.life,controlEpoch:ack.controlEpoch,
      input:{steer:0,throttle:0,boost:true}});
    tick(0);
  }
  return {s,ctx,tick,place,fire,dispose:()=>POCKET.dispose(s)};
}

{
  const f=fixture(),{s}=f,[a,b]=s.karts;
  try {
    s.crates=[];f.place(a,-38,-36);f.place(b,20,20);
    check(a.physicalPose.position.y>5,'Actual hill life reset places chassis above five meters');
    f.fire(a,'mine');const mine=s.mines[0];
    check(mine?.physical===true&&mine.y>4,'Accepted mine retains physical hill support height');
    check(Math.abs(mine.y-terrain.heightAt(mine.x,mine.z))<.015,'Mine height matches actual shared road triangles');
    const view=POCKET.view(s,a.pid),event=view.events.find(e=>e.type==='mine');
    check(event?.position.y===mine.y&&view.mines[0].groundY===mine.y,'Accepted mine event and projection preserve full height');
    // The same x/z with a declared fixture mine eight meters below the
    // physically initialized chassis must not produce a planar ghost hit.
    f.place(b,mine.x,mine.z);mine.armed=true;mine.armT=0;mine.y-=8;
    f.tick(0);check(b.health===100&&s.mines.length===1,'Large vertical separation never triggers a mine');
    mine.y+=8;f.tick(0);
    check(b.health<100&&s.mines.length===0,'Same hill ground mine damages the actual nearby chassis once');
    check(s.events.find(e=>e.type==='hit')?.position.y>4,'Damage event preserves elevated physical hull center');
    const health=b.health;f.tick(0);check(b.health===health,'Consumed mine cannot damage twice');
  } finally {f.dispose();}
}

for (const dt of [50,250]) {
  const f=fixture(),{s}=f,[a,b]=s.karts;
  try {
    s.crates=[];f.place(a,-38,-36);f.place(b,20,20);f.fire(a,'grenade');
    const accepted=s.events.find(e=>e.type==='fire'&&e.weapon==='grenade');
    check(s.grenades[0]?.physical&&s.grenades[0].y>4&&accepted?.position.y>4,'Mounted hill grenade launches at real muzzle height');
    let bounced=false,observed=0;
    while(s.grenades.length) {
      f.tick(dt);
      for(const g of s.grenades) {
        observed++;bounced ||= g.bounces>0;
        check(g.y>=terrain.heightAt(g.x,g.z)-.015,'Full-radius grenade sweep never ghosts below the hill at '+dt+'ms');
        check(Math.abs(g.groundY-terrain.heightAt(g.x,g.z))<.015,'Grenade warning projection follows current terrain support');
      }
    }
    check(observed>2&&bounced,'Hill grenade uses physical bounce response at '+dt+'ms');
    const blasts=s.events.filter(e=>e.type==='blast'&&e.weapon==='grenade');
    check(blasts.length===1&&Number.isFinite(blasts[0].position.y)&&
      blasts[0].position.y>=terrain.heightAt(blasts[0].x,blasts[0].z)+.43,
      'Fuse emits exactly one full-height blast above its current road support');
    f.tick(dt);check(s.events.filter(e=>e.type==='blast').length===1,'Retired physical grenade never replays blast');
  } finally {f.dispose();}
}

// The same actual cover collider is passable above its finite top and
// solid at canister height. A full-height planar approximation fails this.
for (const high of [false,true]) {
  const f=fixture(),{s}=f,[a,b]=s.karts;
  try {
    s.crates=[];f.place(a,0,0);f.place(b,20,20);
    const block=s.blocks[0],left=block.x-block.hw;
    s.grenades=[{id:'declared-cover-lob',owner:a.pid,physical:true,x:left-1,y:high?5:.6,z:block.z,
      vx:40,vy:0,vz:0,fuse:1,bounces:0}];
    f.tick(250);const g=s.grenades[0];
    check(high?g.x>left+.5:g.x<=left-.44,
      high?'Actual finite cover allows a physical grenade above its top':'Actual cover sweep never ghosts a low physical grenade through its face');
  } finally {f.dispose();}
}

{
  const f=fixture(),{s}=f,[a,b]=s.karts;
  try {
    s.crates=[];f.place(a,0,0);f.place(b,20,20);
    s.grenades=[{id:'declared-wall-roll',owner:a.pid,physical:true,x:s.half-1,y:.6,z:0,
      vx:40,vy:0,vz:0,fuse:1,bounces:0}];
    f.tick(0);check(s.grenades[0].x===s.half-1,'Physical canister keeps its accepted pose beyond the old planar gameplay bound');
    f.tick(250);const g=s.grenades[0];
    check(g.x<=s.half+.05-.44&&g.bounces>0,'Actual wall stops full-radius physical canister at its finite collider face');
  } finally {f.dispose();}
}

{
  const f=fixture(),{s}=f,[a,b]=s.karts;
  try {
    s.crates=[];f.place(a,0,0);f.place(b,-38,-36);
    const p=b.physicalPose.position;
    s.grenades=[{id:'declared-airburst',owner:a.pid,physical:true,x:p.x,y:p.y+8,z:p.z,
      vx:0,vy:0,vz:0,fuse:0,bounces:0}];
    f.tick(0);check(b.health===100,'Airburst outside physical 3D radius never damages a planar-near kart');
    check(s.events.find(e=>e.type==='blast')?.position.y>12,'High physical blast is not clamped to old flat-fixture twelve-meter ceiling');
    s.crates=[{id:'declared-ground-crate',x:b.x,z:b.z}];
    const projection=POCKET.view(s,b.pid);
    check(projection.crates[0].groundY>4,'Crate ground projection follows hill triangles');
    f.tick(0);check(!!b.weapon,'Grounded actual hill kart can collect a crate');
  } finally {f.dispose();}
}

{
  const f=fixture('Star Rush'),{s}=f,[a]=s.karts;
  try {
    f.place(a,-38,-36);s.stars=[{id:'declared-ground-star',x:a.x,z:a.z}];
    check(POCKET.view(s,a.pid).stars[0].groundY>4,'Star ground projection follows hill triangles');
    f.tick(0);check(a.stars===1,'Grounded actual hill kart can collect a star');
  } finally {f.dispose();}
}

for (const scenario of [
  {name:'clear hill',from:[-38,-36],to:[-38,-31],hits:true},
  {name:'hill crest blocks line of sight',from:[34,-32],to:[38.5156645,-42.9017785],hits:false},
  {name:'height separation exceeds three meters',from:[20,-46],to:[27.1735609,-39.0329329],hits:false},
]) {
  const f=fixture(),{s}=f,[a,b]=s.karts;
  try {
    s.crates=[];
    const angle=Math.atan2(scenario.to[0]-scenario.from[0],scenario.to[1]-scenario.from[1]);
    f.place(a,...scenario.from,angle);f.place(b,...scenario.to);
    const source=a.physicalPose.position,target=b.physicalPose.position;
    check(Math.hypot(source.x-target.x,source.y-target.y,source.z-target.z)<12,
      'EMP fixture is physically inside its range: '+scenario.name);
    if(scenario.name.includes('height separation'))check(Math.abs(source.y-target.y)>3,'Actual hill fixture exceeds physical EMP height limit');
    f.fire(a,'emp');
    check((b.empT>0)===scenario.hits,'Physical EMP '+scenario.name);
    const accepted=s.events.find(e=>e.type==='fire'&&e.weapon==='emp');
    check(accepted?.position.y>1&&accepted.direction.y===0,'Accepted physical EMP publishes source height and horizontal yaw direction');
    check(a.weapon===null&&a.ammo===0,'Accepted physical EMP consumes once even when all targets are blocked');
    if(scenario.hits)check(s.events.find(e=>e.type==='emp')?.position.y===accepted.position.y,
      'Physical EMP victim event retains the same full source height');
    else check(!s.events.some(e=>e.type==='emp'),'Blocked physical EMP never publishes a phantom victim event');
  } finally {f.dispose();}
}
console.log(JSON.stringify({pass:true,checks,scope:'Initialized shipping Pocket Rapier with controlled life/inventory/body fixtures; no native acceptance claim'}));

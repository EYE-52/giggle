// Declared integration unit fixtures: inventory, projectile entities and life
// reset positions are controlled here. Pocket's initialized private Rapier
// world owns every body pose, fixed step, static sweep and combat outcome.
// This is authority coverage, not native input or visual acceptance.
import assert from 'node:assert/strict';
import RAPIER from '@dimforge/rapier3d-compat';
import POCKET from '../games/pocket-karts/server.js';
import maps from '../games/engines/kart-maps.js';
import battle from '../games/engines/kart-rules-battle.js';
import config from '../public/js/engines/kart-physics-config.mjs';
import {createRoadTerrain} from '../public/js/engines/kart-road-terrain.mjs';
import {classicStatics} from '../public/js/engines/kart-classic-motion.mjs';
import physics from '../games/engines/kart-physics.js';
import rooms from '../server/room.js';

await POCKET.initialize();
let serial=0,checks=0;
const reports=[];
const check=(ok,label)=>{assert.ok(ok,label);checks++;};
function fixture(id,mode='Zap Battle'){
  let now=9000000+(++serial)*100000;
  const players=[{id:'map-a',name:'A'},{id:'map-b',name:'B'}];
  const ctx={instanceId:'all-map-unit-'+serial,now:()=>now,
    settings:()=>({map:maps.mapDef(id).label,mode,roundSeconds:60,winRule:'Time limit'}),
    players:()=>players,allPlayers:()=>players,broadcast(){},award(){},later:()=>()=>{}};
  const s=POCKET.create(ctx),[a,b]=s.karts;
  const tick=(ms=50)=>{now+=ms;POCKET.onTick(s,ctx);};
  tick(3000);s.crates=[];s.stars=[];
  function place(k,x,z,angle=0){
    Object.assign(k,{x,z,angle,spawnSeq:(k.spawnSeq||0)+1,input:{steer:0,throttle:0,boost:false}});
    tick(0);k.shield=0;
  }
  function input(k,value={},tokens){
    const ack=POCKET.view(s,k.pid).inputAck;
    const action={seq:(ack.receivedSeq||0)+1,life:ack.life,controlEpoch:ack.controlEpoch,input:{steer:0,throttle:0,boost:false,...value},...tokens};
    POCKET.onAction(s,ctx,k.pid,action);return action;
  }
  function fire(k,weapon){k.weapon=weapon;k.ammo=1;k.fireCd=0;k.prevAction=false;input(k,{boost:false});input(k,{boost:true});tick(0);input(k,{boost:false});}
  return{s,ctx,a,b,tick,place,input,fire,dispose:()=>POCKET.dispose(s)};
}
const body=k=>k.physicalPose.position;
const gap=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
const blast=(f,at,id='declared-airburst')=>{f.s.grenades=[{id,owner:f.a.pid,physical:true,x:at.x,y:at.y-battle.constants.GRENADE_R,z:at.z,vx:0,vy:0,vz:0,fuse:0,bounces:0}];f.tick(0);};
// These road fixtures independently satisfy one exclusion apiece: a clear
// line whose altitude gap exceeds EMP's 3m limit, and an in-range line through
// the actual hillside triangles with a small altitude gap. Rookie Ring and
// Bumper Blocks relief is below 1m; their finite-cover/range tests apply there.
const terrainEmp={
  garden:[{from:[26,-50],to:[30,-42],height:true},{from:[26,-42],to:[30,-32]}],
  frost:[{from:[-16,-45],to:[-6,-43],height:true},{from:[-18,-45],to:[-14,-55]}],
  neon:[{from:[-50,-49],to:[-42,-41],height:true},{from:[-50,-43],to:[-40,-49]}],
};

for(const id of maps.mapIds()){
  const before=checks,map={id,...maps.mapDef(id)},terrain=createRoadTerrain(map);
  let hill={x:0,z:0,height:0};
  for(let x=-map.half+4;x<map.half-4;x++)for(let z=-map.half+4;z<map.half-4;z++){
    const height=terrain.heightAt(x,z);if(height>hill.height)hill={x,z,height};
  }
  check(hill.height>.5,id+': shared shipping road contains real relief');
  check(POCKET.preflight({map:map.label,mode:'Zap Battle'}).ok,id+': initialized production preflight accepts map');
  const oracle=physics.createKartPhysics(RAPIER,config);
  classicStatics(map).forEach(d=>oracle.addStatic(d));
  try{
    {
      const f=fixture(id);try{
        check(f.s.phase==='drive'&&f.s.karts.every(k=>k.physicalPose?.position&&Object.values(body(k)).every(Number.isFinite)),id+': readiness supplies actual finite Rapier bodies');
        f.place(f.a,hill.x,hill.z);f.place(f.b,0,0);
        check(Math.abs(body(f.a).y-hill.height-.75)<.015,id+': life reset uses exact terrain support height');
        f.fire(f.a,'mine');const mine=f.s.mines[0];
        check(mine?.physical&&Math.abs(mine.y-terrain.heightAt(mine.x,mine.z))<.015,id+': accepted mine rests on real hill triangles');
        check(POCKET.view(f.s,f.a.pid).mines[0].groundY===mine.y,id+': mine projection preserves support altitude');
        f.place(f.b,mine.x,mine.z);mine.armed=true;mine.armT=0;mine.y-=8;f.tick(0);
        check(f.b.health===100&&f.s.mines.length===1,id+': mine excludes vertically separated hull');
        mine.y+=8;f.tick(0);check(f.b.health===50&&f.s.mines.length===0,id+': supported mine deals exactly 50 once');
        f.tick(0);check(f.b.health===50,id+': consumed mine cannot repeat');
      }finally{f.dispose();}
    }
    for(const [weapon,damage] of [['pulse',10],['scatter',27],['rail',25]]){
      const f=fixture(id);try{
        f.place(f.a,0,-4);f.place(f.b,0,0);f.fire(f.a,weapon);
        const volley=f.s.zaps.slice();
        check(volley.length===(weapon==='scatter'?3:1)&&volley.every(p=>p.physical),id+': accepted '+weapon+' launches its physical mounted volley');
        const packets=POCKET.view(f.s,f.a.pid).zaps;
        check(volley.every(p=>p.radius===battle.viewExtra(f.s).combat.staticSweepRadii[weapon])&&packets.every(p=>p.radius===volley[0].radius),id+': real accepted '+weapon+' preserves exact static radius through public packets');
        for(let i=0;i<8&&f.s.zaps.length;i++)f.tick(50);
        check(f.b.health===100-damage&&f.a.ammo===0&&f.a.weapon===null,id+': '+weapon+' deals configured damage and spends exactly one round');
        f.tick(50);check(f.b.health===100-damage,id+': retired '+weapon+' volley does not repeat damage');
      }finally{f.dispose();}
    }
    {
      const f=fixture(id);try{
        f.place(f.a,0,-6);f.place(f.b,0,4,Math.PI);f.fire(f.a,'shield');
        check(f.a.shield===4&&f.a.ramT>0&&f.a.ammo===0&&f.a.weapon===null,id+': Shield accepts one four-second defensive activation');
        f.fire(f.b,'rocket');for(let i=0;i<8;i++)f.tick(50);
        check(f.a.health===100&&f.s.zaps.length===0&&f.s.events.filter(e=>e.type==='shield').length===1,id+': Shield absorbs a real mounted Rocket once');
      }finally{f.dispose();}
    }
    {
      const f=fixture(id);try{
        f.place(f.a,0,-2);f.place(f.b,3,-2);f.fire(f.a,'spikes');
        check(f.a.spikesT===5&&f.a.ammo===0&&f.a.weapon===null,id+': Spikes accepts one five-second activation');
        f.tick(50);check(f.b.health===70,id+': physical in-range Spikes deals 30 damage');
        f.tick(100);check(f.b.health===70,id+': Spikes cooldown prevents per-frame repeated damage');
      }finally{f.dispose();}
    }
    for(const dt of [50,250]){
      const f=fixture(id);try{
        f.place(f.a,hill.x,hill.z);f.place(f.b,0,0);f.fire(f.a,'grenade');
        check(f.s.grenades[0]?.physical&&f.s.events.some(e=>e.type==='fire'&&e.weapon==='grenade'&&e.position.y>hill.height),id+': grenade launches at actual hill muzzle '+dt+'ms');
        let bounce=false,observed=0;
        while(f.s.grenades.length){f.tick(dt);for(const g of f.s.grenades){observed++;bounce ||=g.bounces>0;
          check(g.y>=terrain.heightAt(g.x,g.z)-.015,id+': swept grenade stays above terrain '+dt+'ms');
          check(Math.abs(g.groundY-terrain.heightAt(g.x,g.z))<.015,id+': warning altitude uses real support '+dt+'ms');
        }}
        check(observed>2&&bounce,id+': hill grenade physically bounces '+dt+'ms');
        const events=f.s.events.filter(e=>e.type==='blast'&&e.weapon==='grenade');
        check(events.length===1&&events[0].position.y>=terrain.heightAt(events[0].x,events[0].z)+.43,id+': exactly one supported grenade detonation '+dt+'ms');
        f.tick(dt);check(f.s.events.filter(e=>e.type==='blast').length===1,id+': retired canister cannot replay');
      }finally{f.dispose();}
    }
    for(const high of [false,true]){
      const f=fixture(id);try{
        f.place(f.a,0,-8);f.place(f.b,0,8);
        const cover=map.blocks[0],left=cover?cover.x-cover.hw:map.half+.05,z=cover?.z||0;
        const support=cover?Math.max(...classicStatics(map).filter(d=>d.id==='cover-0'||d.id==='cover-top-0').map(d=>d.position.y+d.half.y)):terrain.wallHeight;
        f.s.grenades=[{id:'declared-finite-cover',owner:f.a.pid,physical:true,x:left-1,y:high?support+2:.6,z,vx:40,vy:0,vz:0,fuse:1,bounces:0}];
        f.tick(250);const g=f.s.grenades[0];
        check(high?g.x>left+.2:g.x<=left-.44,id+': finite '+(cover?'cover':'boundary')+(high?' permits high lob':' blocks full-radius low canister'));
      }finally{f.dispose();}
    }
    {
      const f=fixture(id);try{
        f.place(f.a,0,-8);f.place(f.b,0,8);
        f.s.zaps=[{id:'declared-hill-strike',owner:f.a.pid,kind:'pulse',physical:true,x:hill.x,y:hill.height+.8,z:hill.z,vx:0,vy:-30,vz:0,angle:0,ttl:1}];
        f.tick(50);const impact=f.s.events.find(e=>e.type==='impact');
        check(f.s.zaps.length===0&&impact&&Math.abs(impact.position.y-hill.height-battle.viewExtra(f.s).combat.staticSweepRadii.pulse)<.015,id+': physical projectile sphere stops above actual hillside triangles');
        check(f.b.health===100,id+': hillside collision does not invent a hull hit');
      }finally{f.dispose();}
    }
    {
      const f=fixture(id);try{
        f.place(f.a,0,-6);f.place(f.b,0,4);const old=POCKET.view(f.s,f.b.pid).inputAck;
        f.fire(f.a,'rocket');
        check(f.s.zaps[0]?.radius===battle.viewExtra(f.s).combat.staticSweepRadii.rocket&&POCKET.view(f.s,f.a.pid).zaps[0]?.radius===f.s.zaps[0]?.radius,id+': accepted mounted Rocket packet retains exact static radius');
        for(let i=0;i<8&&f.b.health;i++)f.tick(50);
        check(f.b.health===0&&f.b.respawn>0&&f.a.hits===1&&f.b.deaths===1,id+': direct mounted Rocket kills full-health rival once');
        check(f.s.events.filter(e=>e.type==='hit'&&e.other===f.b.pid).length===1,id+': direct plus splash does not double-damage');
        f.input(f.b,{throttle:1});check(f.b.input.throttle===0,id+': KO rejects movement');
        for(let i=0;i<41;i++)f.tick(50);
        const current=POCKET.view(f.s,f.b.pid).inputAck;
        check(f.b.health===100&&f.b.respawn===0&&f.b.shield>0&&current.life>old.life,id+': fresh respawn restores health and defensive protection');
        const p=body(f.b);blast(f,{x:p.x,y:p.y+.35,z:p.z});
        check(f.b.health===100&&f.b.deaths===1,id+': respawn protection absorbs a close physical blast');
        const seq=current.receivedSeq;
        f.input(f.b,{throttle:1},{seq:seq+1,life:old.life,controlEpoch:old.controlEpoch});
        check(POCKET.view(f.s,f.b.pid).inputAck.receivedSeq===seq&&f.b.input.throttle===0,id+': old-life intent cannot control respawn');
      }finally{f.dispose();}
    }
    {
      const f=fixture(id);try{
        f.place(f.a,0,-8);f.place(f.b,hill.x,hill.z);const p=body(f.b);
        blast(f,{x:p.x,y:p.y+8,z:p.z});check(f.b.health===100,id+': high airburst outside 3D splash range is harmless');
        blast(f,{x:p.x+1,y:p.y+.35,z:p.z},'declared-visible-burst');
        check(f.b.health===35&&f.s.events.filter(e=>e.type==='hit').length===1,id+': visible in-range 3D splash deals 65 once');
      }finally{f.dispose();}
    }
    for(const distance of [6,13]){
      const f=fixture(id);try{
        f.place(f.a,0,-8);f.place(f.b,0,-8+distance);f.fire(f.a,'emp');
        check((f.b.empT>0)===(distance<12),id+': physical EMP '+(distance<12?'slows clear in-range rival':'excludes out-of-range rival'));
        check(f.a.weapon===null&&f.a.ammo===0&&f.a.hits===0,id+': EMP consumes once without a KO award');
      }finally{f.dispose();}
    }
    for(const scenario of terrainEmp[id]||[]){
      const f=fixture(id);try{
        const yaw=Math.atan2(scenario.to[0]-scenario.from[0],scenario.to[1]-scenario.from[1]);
        f.place(f.a,...scenario.from,yaw);f.place(f.b,...scenario.to);
        const source={...body(f.a),y:body(f.a).y+.35},target={...body(f.b),y:body(f.b).y+.35},hit=oracle.sweepStatic(source,target);
        check(gap(source,target)<12,id+': hill EMP fixture is in actual 3D range');
        check(scenario.height?Math.abs(source.y-target.y)>3&&!hit:Math.abs(source.y-target.y)<3&&hit?.surfaceId==='floor',id+': hill EMP isolates '+(scenario.height?'height limit with clear LOS':'terrain LOS with legal height'));
        f.fire(f.a,'emp');check(f.b.empT===0&&!f.s.events.some(e=>e.type==='emp'),id+': hill EMP excludes '+(scenario.height?'separate altitude':'terrain-occluded rival')+' without phantom victim event');
      }finally{f.dispose();}
    }
    if(map.blocks.length){
      {
        const f=fixture(id);try{
          const b=map.blocks[0];f.place(f.a,b.x,b.z-b.hd-1.8,Math.PI);f.place(f.b,0,0);f.fire(f.a,'mine');
          const mine=f.s.mines[0];
          check(mine?.physical&&Math.abs(mine.y-terrain.heightAt(mine.x,mine.z))<.015,id+': mine retries blocked rear drop onto actual supported road');
          check(!map.blocks.some(b=>Math.abs(mine.x-b.x)<b.hw+.5&&Math.abs(mine.z-b.z)<b.hd+.5),id+': supported mine never spawns inside cover clearance');
        }finally{f.dispose();}
      }
      {
        const f=fixture(id);try{
          const b=map.blocks[0],top=Math.max(...classicStatics(map).filter(d=>d.id==='cover-0'||d.id==='cover-top-0').map(d=>d.position.y+d.half.y));
          f.place(f.a,0,-8);f.place(f.b,0,8);
          f.s.grenades=[{id:'declared-cover-support',owner:f.a.pid,physical:true,x:b.x,y:top+1,z:b.z,vx:0,vy:0,vz:0,fuse:1.2,bounces:0}];
          let bounced=false;
          while(f.s.grenades.length){f.tick(50);for(const g of f.s.grenades){bounced ||=g.bounces>0;check(g.y>=top-.015,id+': grenade full-radius sweep stays above authored cover top');}}
          const event=f.s.events.find(e=>e.type==='blast');
          check(bounced&&event?.position.y>=top+battle.constants.GRENADE_R-.015,id+': grenade bounces and detonates supported on actual cover top');
        }finally{f.dispose();}
      }
      const f=fixture(id);try{
        const b=map.blocks[0],acrossX=b.hw<=b.hd;
        if(acrossX){f.place(f.a,b.x-b.hw-1.8,b.z,Math.PI/2);f.place(f.b,b.x+b.hw+1.8,b.z);}
        else{f.place(f.a,b.x,b.z-b.hd-1.8);f.place(f.b,b.x,b.z+b.hd+1.8);}
        const source={...body(f.a),y:body(f.a).y+.35},target={...body(f.b),y:body(f.b).y+.35};
        check(gap(source,target)<12&&oracle.sweepStatic(source,target),id+': EMP cover fixture is in range with actual blocking solid');
        f.fire(f.a,'emp');check(f.b.empT===0,id+': finite cover blocks physical EMP');
        f.place(f.b,b.x+b.hw+1.8,b.z+b.hd-1.7);
        const center=body(f.b),at={x:b.x+b.hw-1.2,y:center.y+.35,z:b.z+b.hd+.5};
        check(gap(at,{...center,y:center.y+.35})<4&&oracle.sweepStatic(at,{...center,y:center.y+.35}),id+': covered blast is within radius but physically occluded');
        blast(f,at,'declared-covered-burst');check(f.b.health===100,id+': cover blocks in-range 3D splash');
      }finally{f.dispose();}
    }
    for(const mode of ['Zap Battle','Star Rush','Garage Battle']){
      const f=fixture(id,mode);try{
        f.place(f.a,hill.x,hill.z-5);f.place(f.b,0,0);for(let i=0;i<15;i++)f.tick(50);
        const field=mode==='Star Rush'?'stars':'crates';f.s[field]=[{id:'declared-hill-pickup',x:hill.x,z:hill.z}];
        check(Math.abs(POCKET.view(f.s,f.a.pid)[field][0].groundY-hill.height)<.015,id+' '+mode+': pickup projection follows slope support');
        check(Math.hypot(f.a.x-hill.x,f.a.z-hill.z)>4,id+' '+mode+': approach starts outside pickup radius');
        for(let i=0;i<160&&(mode==='Star Rush'?f.a.stars===0:f.a.weapon===null);i++){
          if(i%3===0)f.input(f.a,{throttle:.65});f.tick(25);
        }
        check(mode==='Star Rush'?f.a.stars===1:!!f.a.weapon,id+' '+mode+': ordinary fixed-step driving reaches slope pickup');
        check(f.a.physicalPose.grounded,id+' '+mode+': collecting slope driver has actual wheel support');
        check(f.s.garage===(mode==='Garage Battle'),id+' '+mode+': correct progression mode');
      }finally{f.dispose();}
    }
    const flights=[];
    for(const mode of ['Zap Battle','Star Rush','Garage Battle']){
      const f=fixture(id,mode);try{
        // Deterministic straight driving launches from shipped terrain. The
        // pickup canary is introduced only after the private Rapier body is
        // airborne; no cached pose, velocity or physics body is replaced.
        const yaw=id==='frost'?Math.PI*1.5:Math.PI,offset=['ring','blocks'].includes(id)?0:16;
        f.place(f.a,hill.x-Math.sin(yaw)*offset,hill.z-Math.cos(yaw)*offset,yaw);f.place(f.b,0,0);
        let flight;
        for(let i=0;i<180&&!flight;i++){
          if(i%3===0)f.input(f.a,{throttle:1,nitro:true});f.tick(25);
          const p=body(f.a),clearance=p.y-terrain.heightAt(p.x,p.z);
          const supportedArea=Math.abs(p.x)<map.half-2&&Math.abs(p.z)<map.half-2&&!map.blocks.some(b=>Math.abs(p.x-b.x)<b.hw+1&&Math.abs(p.z-b.z)<b.hd+1);
          if(clearance>2.65&&supportedArea&&!f.a.physicalPose.grounded)flight={...p,clearance,step:i};
        }
        check(!!flight,id+' '+mode+': real throttle/Nitro trajectory becomes airborne above reachable road');
        const field=mode==='Star Rush'?'stars':'crates';f.s[field]=[{id:'declared-overflight-canary',x:flight.x,z:flight.z}];
        const old=JSON.stringify(body(f.a));f.tick(0);
        check(JSON.stringify(body(f.a))===old,id+' '+mode+': zero-time pickup check preserves actual private flight pose');
        check(mode==='Star Rush'?f.a.stars===0:f.a.weapon===null,id+' '+mode+': actual airborne overflight cannot collect supported pickup');
        check(f.s[field].some(p=>p.id==='declared-overflight-canary'),id+' '+mode+': airborne exclusion leaves pickup available');
        flights.push({mode,step:flight.step,clearance:flight.clearance});
      }finally{f.dispose();}
    }
    reports.push({map:id,label:map.label,hill,flights,checks:checks-before,cover:map.blocks.length?'authored solid cover':'open arena; finite boundary tested'});
  }finally{oracle.dispose();}
}

// Actual Room readiness, rematch and stop contracts on every classic map.
const realNow=Date.now;let now=50000000;Date.now=()=>now;
try{for(const id of maps.mapIds()){
  const r=new rooms.Room('TEST',{}),sockets=Array.from({length:2},()=>({readyState:1,bufferedAmount:0,frames:[],send(raw){this.frames.push(JSON.parse(raw));},close(){this.readyState=3;}}));
  const players=sockets.map((ws,i)=>r.addPlayer('Map '+i,ws).player);
  const settings={map:maps.mapDef(id).label,mode:'Zap Battle',roundSeconds:60,winRule:'Time limit'};
  const latest=ws=>ws.frames.filter(f=>f.t==='state').at(-1);
  try{
    check(r.startGame(POCKET,{settings,ready:true},r.hostId).ok,id+': Room starts real map in readiness barrier');
    const initial=r.game,at=initial.state.lastTick;now+=1000;r.onTick();
    check(initial.preparing&&initial.state.lastTick===at,id+': preparation freezes authority clock');
    for(const ws of sockets){const v=latest(ws);r.onReady(ws,{i:v.instanceId,w:v.w});}
    check(!r.game.preparing,id+': only both actual seat ACKs release preparation');
    now+=3000;r.onTick();for(const ws of sockets){const v=latest(ws);r.onReady(ws,{i:v.instanceId,w:v.w});}
    const first=latest(sockets[0]);check(first.motionProfile==='rapier-classic-v1'&&first.inputAck,id+': live Room projection contains physical input readiness');
    const snapshot=JSON.stringify(initial.state.karts.map(k=>k.physicalPose));
    check(r.startGame(POCKET,{settings,ready:true},r.hostId).ok&&r.game.instanceId!==initial.instanceId,id+': rematch creates fresh private world and instance');
    const fresh=latest(sockets[0]);check(fresh.inputAck.receivedSeq===0&&fresh.karts.every(k=>k.hits===0&&k.health===100),id+': rematch clears ACKs and combat scores');
    r.onAction(sockets[0],{seq:1,life:first.inputAck.life,controlEpoch:first.inputAck.controlEpoch,input:{steer:0,throttle:1,boost:false}},{i:first.instanceId,w:first.w});
    check(latest(sockets[0]).inputAck.receivedSeq===0,id+': Room rejects previous-instance input');
    check(r.endGameToLobby(r.hostId).ok&&r.game===null,id+': host stop disposes map and returns lobby');
    now+=5000;r.onTick();check(JSON.stringify(initial.state.karts.map(k=>k.physicalPose))===snapshot,id+': stopped/rematched world never receives retained Room ticks');
  }finally{r.destroy();r.destroy();}
}}
finally{Date.now=realNow;}
console.log(JSON.stringify({pass:true,checks,reports,scope:'Initialized Pocket + actual Rapier road/cover; explicitly controlled unit inventory/entities/life reset positions. Real Room readiness/rematch/stop. No native acceptance claim.'},null,2));

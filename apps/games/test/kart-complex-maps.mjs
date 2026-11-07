/* Real Rapier oracle for the complete three-storey complexes. No mocked
 * surfaces, teleports during driving, or navigation links taken on trust. */
import assert from 'node:assert/strict';
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import PHYSICS from '../games/engines/kart-physics.js';
import COMBAT from '../games/engines/kart-elevated-combat.js';
import CONFIG from '../public/js/engines/kart-physics-config.mjs';
import {elevatedMap} from '../public/js/engines/kart-elevated-maps.mjs';
import {createKartElevatedWorld} from '../public/js/engines/kart-elevated-world.mjs';
import {applyElevatedBelts,elevatedFallZone} from '../public/js/engines/kart-elevated-surfaces.mjs';
await RAPIER.init();
const check=(v,label)=>assert.ok(v,label),evidence=[];
const yaw=a=>({x:0,y:Math.sin(a/2),z:0,w:Math.cos(a/2)});
const step=(w,n)=>{for(let i=0;i<n;i++)w.step();};
function physics(map){const w=PHYSICS.createKartPhysics(RAPIER,CONFIG);map.colliders.forEach(d=>w.addStatic(d));return w;}

function navigation(w,map){
  const nodes=[],columns=new Map(),spacing=4;
  for(let x=-116;x<=116;x+=spacing)for(let z=-116;z<=116;z+=spacing){
    const column=[];
    for(let top=0;top<=22.5;top+=2.5){
      const hit=w.supportAt({x,y:top+.5,z},2.6);
      if(!hit||hit.normal.y<.65||column.some(n=>Math.abs(n.y-hit.point.y)<.1))continue;
      const p={x,y:hit.point.y,z};
      if(p.y<-.1||p.y>22||w.overlapsStatic({...p,y:p.y+.9},yaw(0),{x:1.8,y:.3,z:1.8}))continue;
      const n={...p,surface:hit.surfaceId,index:nodes.length,edges:[]};nodes.push(n);column.push(n);
    }
    columns.set(x+':'+z,column);
  }
  for(const n of nodes)for(const [dx,dz]of [[4,0],[0,4],[4,4],[-4,4]])for(const next of columns.get((n.x+dx)+':'+(n.z+dz))||[]){
    if(Math.abs(next.y-n.y)>1.8)continue;
    const p={x:(n.x+next.x)/2,y:(n.y+next.y)/2,z:(n.z+next.z)/2},support=w.supportAt({...p,y:p.y+.5},.9);
    if(!support||Math.abs(support.point.y-p.y)>.36||w.overlapsStatic({...p,y:p.y+.9},yaw(0),{x:1.8,y:.3,z:1.8}))continue;
    n.edges.push(next.index);next.edges.push(n.index);
  }
  const nearest=p=>nodes.reduce((best,n)=>Math.abs(n.y-p.y)<.4&&Math.hypot(n.x-p.x,n.z-p.z)<(best?.distance??Infinity)?{n,distance:Math.hypot(n.x-p.x,n.z-p.z)}:best,null);
  function flood(start,blocked){const seen=new Set([start]),queue=[start];for(let k=0;k<queue.length;k++)for(const i of nodes[queue[k]].edges)if(!seen.has(i)&&nodes[i].surface!==blocked){seen.add(i);queue.push(i);}return seen;}
  return {nodes,nearest,flood};
}

for(const id of ['skyport','foundry']){
  const map=elevatedMap(id),w=physics(map);
  try{
    const ratio=map.half**2/elevatedMap('harbor').half**2;
    check(ratio>=1.9&&ratio<=2.1,id+' approximately twice the largest old footprint');
    check(map.spawns.length===32&&new Set(map.spawns.map(p=>p.y)).size===3,id+' 32 spawns spread across all three floors');
    check(map.colliders.length<=CONFIG.maxStatics,id+' bounded authoritative solids');
    check(map.spiral.turns===2&&map.routes.filter(r=>r.id.startsWith('spiral-')).length===8,id+' two actual rising spiral turns');
    for(const y of [0,10,20])check(map.sockets.filter(p=>p.y===y).length>=10,id+' useful pickups on level '+y);
    const nav=navigation(w,map),start=nav.nearest(map.spawns[0]);check(start?.distance<4,id+' first spawn joins clear navigation');
    const reached=nav.flood(start.n.index);
    for(const p of map.spawns){const n=nav.nearest(p);check(n?.distance<4&&reached.has(n.n.index),id+'/'+p.id+' can reach all three connected floors');}
    for(const p of map.sockets){const n=nav.nearest(p);check(n?.distance<5&&reached.has(n.n.index),id+'/'+p.id+' joins the same drive network');}
    for(const y of [0,10,20])check([...reached].filter(i=>Math.abs(nav.nodes[i].y-y)<.1).length>=30,id+' has a substantial reachable level '+y);
    // Losing any single climb still leaves routes between all spawn areas.
    for(const route of map.routes){const alternate=nav.flood(start.n.index,route.via);for(const p of map.spawns)check(alternate.has(nav.nearest(p).n.index),id+' has a bypass for '+route.id);}
    // Every spawn has a usable, physically driven exit, with all solids left
    // in place. A support ray alone would miss a kart boxed in by cover.
    w.addKart('bot',{position:{x:0,y:1,z:0}});let departures=0;
    for(const p of map.spawns){
      let escaped=false;
      for(const angle of [p.angle,0,Math.PI/2,Math.PI,-Math.PI/2]){
        w.resetKart('bot',{position:{x:p.x,y:p.y+1,z:p.z},rotation:yaw(angle)});w.applyIntent('bot',{throttle:0,steer:0});step(w,90);w.applyIntent('bot',{throttle:.5,steer:0});
        for(let t=0;t<150;t++){w.step();const pose=w.pose('bot');check(Object.values(pose.position).every(Number.isFinite),id+' finite bot');if(Math.hypot(pose.position.x-p.x,pose.position.z-p.z)>8&&pose.grounded&&Math.abs(pose.position.y-p.y)<1.5){escaped=true;break;}}
        if(escaped)break;
      }
      check(escaped,id+'/'+p.id+' bot drives out without reset or stuck recovery');departures++;
    }
    // One continuous bot drive through all eight rising lanes and all
    // seven 90-degree transitions. No reset after entering the helix.
    const {x:cx,z:cz}=map.spiral.center,goals=[];
    for(const level of [0,1])for(const [i,x,z]of [[0,-18,-18],[1,18,-18],[2,18,18],[3,-18,18]])goals.push({x:cx+x,z:cz+z,y:level*10+(i+1)*2.5});
    w.resetKart('bot',{position:{x:cx-18,y:1,z:cz+14},rotation:yaw(Math.PI)});w.applyIntent('bot',{throttle:0,steer:0});step(w,120);
    let goalIndex=0;
    for(let t=0;t<3600&&goalIndex<goals.length;t++){
      const p=w.pose('bot'),goal=goals[goalIndex],distance=Math.hypot(goal.x-p.position.x,goal.z-p.position.z);
      check(p.position.y>-.1&&p.grounded,id+' spiral bot retains supported wheel contact');
      if(distance<3.5&&Math.abs(p.position.y-goal.y-.75)<1.3){goalIndex++;continue;}
      const angle=Math.atan2(2*(p.rotation.w*p.rotation.y+p.rotation.x*p.rotation.z),1-2*(p.rotation.y**2+p.rotation.x**2)),desired=Math.atan2(goal.x-p.position.x,goal.z-p.position.z),error=Math.atan2(Math.sin(angle-desired),Math.cos(angle-desired));
      const speed=distance<14||Math.abs(error)>.4?5:12;
      w.applyIntent('bot',{throttle:Math.max(0,Math.min(.7,(speed-p.speed)*.25)),brake:p.speed>speed+1?.2:0,steer:Math.max(-1,Math.min(1,error*2.5))});w.step();
    }
    check(goalIndex===8,id+' continuous spiral bot reaches the third floor without recovery');
    if(id==='skyport'){
      w.resetKart('bot',{position:{x:-38,y:21,z:-18},rotation:yaw(Math.PI/2)});w.applyIntent('bot',{throttle:0,steer:0});step(w,120);w.applyIntent('bot',{throttle:1,steer:0});
      let takeoff=false,flight=0,landed=false;
      for(let t=0;t<240;t++){w.step();const p=w.pose('bot');takeoff ||=p.wheels.some(v=>v.contact&&v.surfaceId==='roof-jump');if(takeoff&&p.position.x>-6&&!p.grounded)flight++;if(flight&&p.wheels.some(v=>v.contact&&['roof-jump-landing','east-2'].includes(v.surfaceId)))landed=true;}
      check(takeoff&&flight>5&&landed,'Skyport physical roof gap has an airborne crossing and a supported landing');
    }
    // The open upper edge is a deliberate drop, not a hidden wall or an
    // absent roof collision. Landing on the street remains a usable flank.
    const drop=id==='skyport'?{x:-50,y:20,z:0,angle:-Math.PI/2,edge:-62}:{x:50,y:20,z:0,angle:Math.PI/2,edge:58};
    w.resetKart('bot',{position:{x:drop.x,y:drop.y+1,z:drop.z},rotation:yaw(drop.angle)});w.applyIntent('bot',{throttle:0,steer:0});step(w,120);w.applyIntent('bot',{throttle:.5,steer:0});
    let leftRoof=false,streetLanding=false;
    for(let t=0;t<300;t++){w.step();const p=w.pose('bot');leftRoof ||=Math.abs(p.position.x)>Math.abs(drop.edge)+2&&!p.grounded;streetLanding ||=leftRoof&&p.grounded&&p.position.y>.4&&p.position.y<1.2;}
    check(leftRoof&&streetLanding,id+' roof-edge drop reaches the lower street');

    // Park/drop tests on every broad deck, including finite ceilings. CCD
    // must catch a fast falling chassis without falling through a floor.
    let decks=0;
    for(const d of map.colliders.filter(d=>d.shape==='deck'&&d.half.x>=8&&d.half.z>=6)){
      let tested=false;
      for(const [dx,dz]of [[0,0],[-4,0],[4,0],[0,-4],[0,4]]){
        const p={x:d.position.x+dx,y:d.position.y+d.half.y,z:d.position.z+dz},hit=w.supportAt({...p,y:p.y+.5},1);
        if(hit?.surfaceId!==d.id||w.overlapsStatic({...p,y:p.y+1},yaw(0)))continue;
        w.resetKart('bot',{position:{...p,y:p.y+1},rotation:yaw(0)});w.applyIntent('bot',{throttle:0,steer:0});step(w,90);
        let pose=w.pose('bot');check(pose.grounded&&Math.abs(pose.position.y-p.y-.75)<.2,id+'/'+d.id+' sustained deck support');
        // Stay below the next storey's ceiling during the drop.
        w.restoreKart('bot',{...pose,position:{...pose.position,y:p.y+4},linearVelocity:{x:0,y:-35,z:0}});step(w,60);pose=w.pose('bot');
        check(pose.grounded&&pose.position.y>p.y+.4&&pose.position.y<p.y+1.1,id+'/'+d.id+' CCD landing cannot fall through');tested=true;decks++;break;
      }
      check(tested,id+'/'+d.id+' has clear driving room');
    }
    const world=createKartElevatedWorld(THREE,{scene:new THREE.Scene(),map}),reference=createKartElevatedWorld(THREE,{map:'harbor'});
    const budget=world.stats(),old=reference.stats();
    check(budget.drawCalls<=old.drawCalls&&budget.drawCalls<=64,id+' world draw calls at most Harbor Heights');
    check(budget.triangles<=old.triangles&&budget.triangles<=25000,id+' world triangles at most Harbor Heights');
    world.dispose();reference.dispose();
    evidence.push({id,areaRatio:ratio,statics:map.colliders.length,navigationNodes:nav.nodes.length,reached:reached.size,botDepartures:departures,deckDropChecks:decks,...budget});
  }finally{w.dispose();}
  // Real combat authority: 2, 8 and 32 active karts, sequenced input,
  // bounded 60 Hz CPU work and a clean public result at the deadline.
  for(const count of [2,8,32]){
    const match=COMBAT.createElevatedCombat(RAPIER,CONFIG,map,Array.from({length:count},(_,i)=>({id:'p'+i})),{instance:id+'-'+count,seed:12,startAt:0,countdownMs:0,roundMs:4000});
    const samples=[];
    for(const y of [0,10,20])check(match.snapshot().crates.filter(c=>Math.abs(c.position.y-y-.6)<.1).length>=3,id+' actual crates present on every level');
    try{for(let t=1;t<=245;t++){
      if(t%6===1)for(let i=0;i<count;i++){const status=match.snapshot();if(status.phase==='done'||!status.karts[i].alive)continue;const s=match.privateStatus('p'+i);check(match.input('p'+i,{instance:id+'-'+count,life:s.life,controlEpoch:s.controlEpoch,seq:s.receivedSeq+1,throttle:.5,steer:(i%2?1:-1)*.2,brake:0,nitro:false,use:false},(t-1)*1000/60).ok,id+' sequenced input');}
      const at=performance.now();match.advance(t*1000/60);samples.push(performance.now()-at);
    }
    const s=match.snapshot();check(s.phase==='done'&&s.karts.length===count&&s.result.scores.length===count,id+' '+count+' driver result');
    check(s.karts.every(k=>Object.values(k.pose.position).every(Number.isFinite)),id+' finite authority poses');samples.sort((a,b)=>a-b);const p95=samples[Math.floor(samples.length*.95)];check(p95<16.67,id+' '+count+' karts within 60 Hz CPU budget: '+p95);evidence.push({id,players:count,stepP95Ms:p95});
    }finally{match.dispose();}
  }
}
// Surface effect checks use the authored Foundry, not a flat substitute.
{
  const m=elevatedMap('foundry'),w=physics(m);try{
    for(const tunnel of m.tunnels){
      const start={x:tunnel.x,y:2,z:tunnel.z};
      for(const side of [-1,1])check(w.sweepStatic(start,{...start,x:start.x+side*12},.1)?.surfaceId.startsWith('tunnel-wall-'),'tunnel has real lateral walls');
      check(w.sweepStatic(start,{...start,y:12},.1)?.surfaceId.endsWith('-dock'),'tunnel has an actual hall ceiling');
      check(w.supportAt({...start,y:1},2)?.surfaceId==='floor','tunnel has a separate road underneath');
    }
    w.addKart('belt',{position:{x:24,y:1,z:-22}});step(w,120);const before=w.pose('belt');
    for(let i=0;i<120;i++){applyElevatedBelts(w,'belt',w.pose('belt'),m,CONFIG.fixedDt);w.step();}
    const after=w.pose('belt');check(after.position.z-before.position.z>2&&after.position.y>.5,'real grounded conveyor pushes chassis along the lane');
    w.resetKart('belt',{position:{x:24,y:11,z:-24}});step(w,120);const upper=w.pose('belt');
    for(let i=0;i<120;i++){applyElevatedBelts(w,'belt',w.pose('belt'),m,CONFIG.fixedDt);w.step();}
    check(Math.hypot(w.pose('belt').position.x-upper.position.x,w.pose('belt').position.z-upper.position.z)<.2,'ground belt cannot push the catwalk above');
    check(!w.supportAt({x:50,y:1,z:60},3),'slag is a real hole in the floor');
    check(elevatedFallZone(m,{x:50,y:-2,z:60})==='molten-slag'&&!elevatedFallZone(m,{x:50,y:21,z:60}),'slag recovery respects vertical layer');
  }finally{w.dispose();}
  // Drive into the actual opening and observe authority recovery/respawn.
  const authored=structuredClone(m);authored.spawns[0]={id:'pit-approach',surface:'floor',x:50,y:0,z:36,angle:0};
  const match=COMBAT.createElevatedCombat(RAPIER,CONFIG,authored,[{id:'a'},{id:'b'}],{instance:'slag-test',seed:1,startAt:0,countdownMs:0,roundMs:12000});
  try{let recovered=false,respawned=false;
    for(let t=1;t<=600;t++){const s=match.snapshot('a');if(t%6===1)match.input('a',{instance:s.instance,life:s.you.life,controlEpoch:s.you.controlEpoch,seq:s.you.receivedSeq+1,throttle:recovered?0:1,steer:0,brake:0,nitro:false,use:false},s.serverAt);const next=match.advance(t*1000/60);recovered ||=next.events.some(e=>e.type==='recovery'&&e.pid==='a');respawned ||=recovered&&next.karts[0].alive&&next.karts[0].spawnSeq>0;}
    check(recovered&&respawned,'slag fall drives through real hole, recovers, and respawns');
  }finally{match.dispose();}
}
console.log(JSON.stringify({pass:true,scope:'Rapier clearance graph, all-spawn exits, CCD decks, belts, pit recovery, 2/8/32 authority and geometry budgets',evidence},null,2));

// Clearance and route-demand audit backed by the shipping Rapier solids.
// Heat is shortest-path demand between authored starts and loot sockets,
// not a claim about real player behaviour. Bot departures use real input.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import PHYSICS from '../games/engines/kart-physics.js';
import COMBAT from '../games/engines/kart-elevated-combat.js';
import CONFIG from '../public/js/engines/kart-physics-config.mjs';
import {elevatedMap,elevatedMapIds} from '../public/js/engines/kart-elevated-maps.mjs';
import {createKartElevatedWorld} from '../public/js/engines/kart-elevated-world.mjs';
import {BACKDROP_THEMES} from '../public/js/engines/kart-backdrop.mjs';
await RAPIER.init();
const evidence=[],dir='/tmp/codex-maps2-shots';fs.mkdirSync(dir,{recursive:true});
const yaw=a=>({x:0,y:Math.sin(a/2),z:0,w:Math.cos(a/2)});
const step=(w,n)=>{for(let i=0;i<n;i++)w.step();};
function navigation(w,map){
  const spacing=map.complex?4:2,extent=Math.floor((map.half-3)/spacing)*spacing,nodes=[],columns=new Map(),max=Math.max(...map.levels.map(l=>l.y));
  const clear=p=>!w.overlapsStatic({...p,y:p.y+.9},yaw(0),{x:1.75,y:.3,z:1.75});
  for(let x=-extent;x<=extent;x+=spacing)for(let z=-extent;z<=extent;z+=spacing){
    const column=[];
    for(let y=0;y<=max+1;y+=1){
      const s=w.supportAt({x,y:y+.5,z},1.6);
      if(!s||s.normal.y<.65||s.point.y<-.02||s.point.y>max+.15||column.some(p=>Math.abs(p.y-s.point.y)<.1)||!clear(s.point))continue;
      const n={x,y:s.point.y,z,surface:s.surfaceId,index:nodes.length,edges:[],heat:0};column.push(n);nodes.push(n);
    }columns.set(x+':'+z,column);
  }
  for(const n of nodes)for(const [dx,dz]of [[spacing,0],[0,spacing],[spacing,spacing],[-spacing,spacing]])for(const next of columns.get((n.x+dx)+':'+(n.z+dz))||[]){
    if(Math.abs(next.y-n.y)>spacing*.65)continue;
    const p={x:(n.x+next.x)/2,y:(n.y+next.y)/2,z:(n.z+next.z)/2},s=w.supportAt({...p,y:p.y+.5},1);
    if(!s||Math.abs(s.point.y-p.y)>.3||!clear(p))continue;
    n.edges.push(next.index);next.edges.push(n.index);
  }
  const nearest=p=>nodes.reduce((best,n)=>Math.abs(n.y-p.y)<.4&&Math.hypot(n.x-p.x,n.z-p.z)<(best?.distance??Infinity)?{n,distance:Math.hypot(n.x-p.x,n.z-p.z)}:best,null);
  function flood(start,blocked){const parents=new Map([[start,-1]]),queue=[start];for(let k=0;k<queue.length;k++)for(const i of nodes[queue[k]].edges)if(!parents.has(i)&&nodes[i].surface!==blocked){parents.set(i,queue[k]);queue.push(i);}return parents;}
  return {nodes,nearest,flood,spacing};
}
for(const id of elevatedMapIds){
  const map=elevatedMap(id),w=PHYSICS.createKartPhysics(RAPIER,CONFIG);map.colliders.forEach(d=>w.addStatic(d));
  try{
    assert(map.designNotes.length>=3&&map.landmarks.length>=map.levels.length,id+' has level landmarks and current design notes');
    assert.equal(BACKDROP_THEMES[map.backdrop].file,{garden:'mountains-day.webp',frost:'frost.webp',neon:'neon.webp',harbor:'harbor.webp',skyport:'harbor.webp',foundry:'quarry.webp'}[id]);
    const nav=navigation(w,map),starts=map.spawns.map(p=>nav.nearest(p)),loot=map.sockets.map(p=>nav.nearest(p));
    assert(starts.every(p=>p?.distance<4)&&loot.every(p=>p?.distance<5),id+' all starts and loot join a kart-width clearance graph');
    const reached=nav.flood(starts[0].n.index);
    assert([...starts,...loot].every(p=>reached.has(p.n.index)),id+' every spawn reaches every crate and every driving level');
    let firstPairDistance=0,cursor=starts[1].n.index;
    while(cursor!==starts[0].n.index){const next=reached.get(cursor);firstPairDistance+=Math.hypot(nav.nodes[next].x-nav.nodes[cursor].x,nav.nodes[next].z-nav.nodes[cursor].z);cursor=next;}
    if(map.complex)assert(firstPairDistance<160,id+' two-player starts share a short climb district');
    for(const route of map.routes){const alternate=nav.flood(starts[0].n.index,route.via);assert(starts.every(p=>alternate.has(p.n.index)),id+' a blocked climb still has a bypass: '+route.id);}
    // Measure the added screens against the same map with those screens
    // removed. Sample identical clear origins, heights and firing angles.
    const sightLines=[];
    if(map.qualityCoverIds){
      const baseline=PHYSICS.createKartPhysics(RAPIER,CONFIG);map.colliders.filter(d=>!map.qualityCoverIds.includes(d.id)).forEach(d=>baseline.addStatic(d));
      try{for(const level of map.levels){let before=0,after=0,rays=0;
        for(let x=-map.half+12;x<map.half-8;x+=12)for(let z=-map.half+12;z<map.half-8;z+=12){
          const support=w.supportAt({x,y:level.y+.4,z},.8);
          if(!support||Math.abs(support.point.y-level.y)>.2)continue;
          const start={x,y:level.y+1.2,z};if(w.overlapsStatic(start,yaw(0),{x:.3,y:.3,z:.3}))continue;
          for(let a=0;a<Math.PI*2;a+=Math.PI/4){
            const dx=Math.sin(a),dz=Math.cos(a),h=map.half-.5;
            const distance=Math.min(Math.abs(dx)<.001?Infinity:(dx>0?h-x:-h-x)/dx,Math.abs(dz)<.001?Infinity:(dz>0?h-z:-h-z)/dz),end={x:x+dx*distance,y:start.y,z:z+dz*distance};
            const span=world=>{const hit=world.sweepStatic(start,end,.1);return hit?Math.hypot(hit.point.x-x,hit.point.z-z):distance;};
            before+=span(baseline);after+=span(w);rays++;
          }
        }assert(after<=before+.01,id+' screens shorten firing lanes on level '+level.y);sightLines.push({level:level.y,rays,meanBefore:before/rays,meanAfter:after/rays});
      }}finally{baseline.dispose();}
    }
    for(const start of starts){const parents=nav.flood(start.n.index);for(const goal of loot){let n=goal.n.index;while(n!==-1){nav.nodes[n].heat++;n=parents.get(n);}}}
    const max=Math.max(...nav.nodes.map(n=>n.heat)),scale=720/(map.half*2);
    const dots=nav.nodes.filter(n=>n.heat).map(n=>`<circle cx="${(n.x+map.half)*scale}" cy="${(map.half-n.z)*scale}" r="${nav.spacing*scale*.6}" fill="hsl(${220-210*n.heat/max} 85% 55%)" opacity=".65"/>`).join('');
    fs.writeFileSync(dir+'/'+id+'-route-demand.svg',`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 760"><rect width="720" height="760" fill="#152532"/>${dots}<text x="12" y="745" fill="white" font-size="15">${map.name}: shortest-route demand, ${map.spawns.length} starts × ${loot.length} loot sockets</text></svg>`);
    // Clear wheel contacts plus actual travel catch starts wedged against
    // nearby cover or railings. No stuck recovery or resets during a run.
    w.addKart('bot',{position:{x:0,y:1,z:0}});
    for(const p of map.spawns){let escaped=false;
      for(const a of [p.angle,0,Math.PI/2,Math.PI,-Math.PI/2]){
        w.resetKart('bot',{position:{x:p.x,y:p.y+1,z:p.z},rotation:yaw(a)});w.applyIntent('bot',{throttle:0,steer:0});step(w,90);w.applyIntent('bot',{throttle:.5,steer:0});
        for(let t=0;t<180;t++){w.step();const pose=w.pose('bot');assert(Object.values(pose.position).every(Number.isFinite));if(Math.hypot(pose.position.x-p.x,pose.position.z-p.z)>6&&pose.grounded&&Math.abs(pose.position.y-p.y)<1.5){escaped=true;break;}}
        if(escaped)break;
      }assert(escaped,id+'/'+p.id+' bot drives clear on its own floor');
    }
    // Every finite broad deck must catch a fast falling chassis. Try clear
    // lanes because the centre is allowed to contain real combat cover.
    let decks=0;
    for(const d of map.colliders.filter(d=>d.shape==='deck'&&d.half.x>=5&&d.half.z>=5)){
      const top=d.position.y+d.half.y;
      const lane=[[0,0],[-3,0],[3,0],[0,-3],[0,3],[-6,0],[6,0]].map(([x,z])=>({x:d.position.x+x,y:top,z:d.position.z+z})).find(p=>w.supportAt({...p,y:top+4.4},5)?.surfaceId===d.id&&!w.overlapsStatic({...p,y:top+4},yaw(0))&&!w.overlapsStatic({...p,y:top+1},yaw(0)));
      assert(lane,id+'/'+d.id+' clear deck lane');w.resetKart('bot',{position:{...lane,y:top+4},rotation:yaw(0)});w.applyIntent('bot',{throttle:0,steer:0});w.restoreKart('bot',{...w.pose('bot'),linearVelocity:{x:0,y:-35,z:0}});step(w,100);
      const p=w.pose('bot');assert(p.grounded&&p.position.y>top+.4&&p.position.y<top+1.1,id+'/'+d.id+' falling kart stays above deck');decks++;
    }
    const world=createKartElevatedWorld(THREE,{map});const budget=world.stats();
    assert(budget.drawCalls<=80&&budget.triangles<=80000&&budget.textureBytes<=12*1024*1024,id+' phone geometry budgets');
    const kit=world.group.getObjectByName('raised-readability');assert(kit&&kit.userData.batches===6,id+' shared obstacle faces, caps, shadows, level washes, drop flags, chevrons');
    for(const phase of [0,.65,1]){world.animate(0,0,phase);assert(world.lighting.sun.intensity>=.9&&world.lighting.sun.intensity<=1.75&&world.lighting.hemisphere.intensity>=1,id+' soft day and bright night fill');}
    world.dispose();
    for(const seed of [0,1,17]){
      const m=COMBAT.createElevatedCombat(RAPIER,CONFIG,map,map.spawns.map((_,i)=>({id:'p'+i})),{instance:'quality-'+id+seed,seed,startAt:0,countdownMs:0,roundMs:1000});
      try{for(const level of map.levels)assert(m.snapshot().crates.some(c=>Math.abs(c.position.y-.6-level.y)<.25),id+' each level gets live loot at seed '+seed);}finally{m.dispose();}
    }
    for(const pit of map.fallZones||[]){
      assert(!w.supportAt({x:pit.x,y:1,z:pit.z},2),id+' hazard has a real opening in the road');
      const approach={x:pit.x,y:0,z:pit.z-pit.halfZ-7,angle:0},surface=w.supportAt({...approach,y:.5},1)?.surfaceId;
      assert(surface,id+' hazard approach is supported');
      const authored=structuredClone(map);authored.spawns=[{...approach,id:'pit-approach',surface},map.spawns.find(p=>Math.hypot(p.x-approach.x,p.z-approach.z)>20)];
      const instance='pit-'+id,m=COMBAT.createElevatedCombat(RAPIER,CONFIG,authored,[{id:'bot'},{id:'rival'}],{instance,seed:42,startAt:0,countdownMs:0,roundMs:10000,crates:2});
      let recovered=false,respawned=false;
      try{for(let t=1;t<=480&&!respawned;t++){
        if(t%6===1){const s=m.privateStatus('bot');m.input('bot',{instance,life:s.life,controlEpoch:s.controlEpoch,seq:s.receivedSeq+1,throttle:recovered?0:.45,steer:0,brake:0,nitro:false,use:false},(t-1)*1000/60);}
        const s=m.advance(t*1000/60);recovered ||= s.events.some(e=>e.type==='recovery'&&e.pid==='bot');respawned ||= recovered&&s.karts.find(k=>k.id==='bot').alive;
      }assert(recovered&&respawned,id+' bot falls into hazard and safely respawns through the real authority');}finally{m.dispose();}
    }
    evidence.push({id,navigationNodes:nav.nodes.length,reachableNodes:reached.size,spawnBotRuns:map.spawns.length,deckDropChecks:decks,routePairs:starts.length*loot.length,firstPairDistance,sightLines,...budget});
  }finally{w.dispose();}
}
fs.writeFileSync(dir+'/quality.json',JSON.stringify(evidence,null,2));
console.log('PASS raised-map reachability, alternate climbs, bot departures, deck CCD, balanced loot, art and lighting');console.log(JSON.stringify(evidence,null,2));

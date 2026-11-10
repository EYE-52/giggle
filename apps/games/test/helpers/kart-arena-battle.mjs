import {createArenaBotPlanner} from './kart-arena-bot.mjs';
import {createKartPhysics} from '../../public/js/engines/kart-physics-core.mjs';
import {elevatedStatics} from '../../public/js/engines/kart-feature-solids.mjs';
import {selectArenaVariant} from '../../public/js/engines/kart-arena-policy.mjs';
import {arenaClearanceGraph} from './kart-arena-audit.mjs';
import combat from '../../games/engines/kart-elevated-combat.js';
// Test opponents seek actual available fixed homes and fire actual payloads.
// They use only normal authority intents. No pose restores or item injection.
export function runArenaBattle(R,C,source,players,{seed=1,seconds=180,fire=true}={}){
 const map=selectArenaVariant(source,players),query=createKartPhysics(R,C);elevatedStatics(map).forEach(d=>query.addStatic(d));
 const nav=arenaClearanceGraph(query,map,1,{turnMargin:.6,supportMargin:2.4}),seats=Array.from({length:players},(_,i)=>({id:'bot'+i})),match=combat.createElevatedCombat(R,C,source,seats,{instance:'battle',seed,startAt:0,countdownMs:0,roundMs:seconds*1000});
 const planner=createArenaBotPlanner(nav);
 let s=match.snapshot(),rng=seed,seen=new Set(),seq=0;const random=()=>((rng=(Math.imul(rng,1664525)+1013904223)>>>0)/4294967296);
 const nearestRoad=p=>nav.nearest(p)||nav.nodes.filter(n=>Math.abs(n.y-p.y)<3.5&&n.y<=p.y+.6).map(n=>({n,distance:Math.hypot(n.x-p.x,n.z-p.z)})).filter(n=>n.distance<12).sort((a,b)=>a.distance-b.distance)[0];
 const homes=s.crates.map(c=>{
  const home=map.sockets.find(h=>h.id===c.homeId),near=nearestRoad(home);if(!near)throw new Error('Home lacks navigation node: '+home.id);
  const field=nav.shortest(near.n.index,null,true),metres=new Float64Array(nav.nodes.length).fill(Infinity);metres[near.n.index]=0;
  for(const n of [...nav.nodes].sort((a,b)=>field.distance[a.index]-field.distance[b.index])){const parent=nav.nodes[field.parents[n.index]];if(parent)metres[n.index]=metres[parent.index]+Math.hypot(n.x-parent.x,n.y-parent.y,n.z-parent.z);}
  return {...home,crateId:c.id,field,metres,visits:0};
 });
 const brains=new Map(seats.map(k=>[k.id,{goal:null,visits:new Set(),levels:new Set(),districts:new Set(),anchor:null,progress:0,reverseUntil:0,unarmedAt:null,avoid:new Map(),seq:0,blocked:new Set()}]));
 const report={players,variant:map.variantId,seed,seconds,pickups:0,shots:0,kos:0,recoveries:[],navigationMisses:0,blockedManoeuvres:0,stuck:[],availability:[],dryMs:Object.fromEntries(map.levels.map(l=>[l.id,0])),maxDryMs:0,unarmedMs:[],unarmedIntervals:[],aliveUnarmedMs:[],visitedHomes:[],levelVisits:{},districtVisits:{},stepMs:[]};
 const distance=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
 // Keep the original wall-clock definition for the acceptance gate: an
 // unfinished unarmed wait continues through a KO/respawn. Also retain a
 // separate alive-only diagnostic. Neither path depends on navigation.
 const send=(k,b,at,controls={})=>{
  const own=match.privateStatus(k.id),ack=match.input(k.id,{instance:'battle',life:own.life,controlEpoch:own.controlEpoch,seq:++b.seq,steer:0,throttle:0,brake:.5,nitro:false,use:fire&&!!k.weapon&&seq%4===0,...controls},at);
  if(!ack.ok)throw new Error('Bot input rejected: '+ack.reason);
 };
 const observe=(snapshot,at)=>{for(const k of snapshot.karts){const b=brains.get(k.id),armed=!!(k.weapon||k.firing),unarmed=k.alive&&!armed;
  if(armed&&b.unarmedAt!==null){const ms=at-b.unarmedAt;report.unarmedMs.push(ms);report.unarmedIntervals.push({pid:k.id,start:b.unarmedAt,end:at,ms,reason:'armed',from:b.unarmedFrom,to:k.pose.position,goal:b.goal?.id});b.unarmedAt=null;}
  if(unarmed&&b.unarmedAt===null){b.unarmedAt=at;b.unarmedFrom=k.pose.position;}
  if(!unarmed&&b.aliveUnarmedAt!=null){report.aliveUnarmedMs.push(at-b.aliveUnarmedAt);b.aliveUnarmedAt=null;}
  if(unarmed&&b.aliveUnarmedAt==null)b.aliveUnarmedAt=at;
 }};
 try{for(let at=0;at<seconds*1000;at+=50){seq++;observe(s,at);
  const reserved=new Map();for(const b of brains.values())if(b.goal&&!b.wasArmed)reserved.set(b.goal.crateId,(reserved.get(b.goal.crateId)||0)+1);
  for(const k of s.karts){const b=brains.get(k.id),pose=k.pose,p=pose.position;if(!k.alive)continue;
   if(b.life!==k.spawnSeq){
    b.life=k.spawnSeq;b.goal=null;b.anchor=null;b.blocked.clear();
    b.available=new Set(s.crates.filter(c=>c.available).map(c=>c.id));
   }
   const armed=!!(k.weapon||k.firing);
   if(b.wasArmed&&!armed)b.goal=null;
   b.wasArmed=armed;
   const hit=query.supportAt({...p,y:p.y+.2},2),supportY=hit?.point.y??p.y-.65,near=nearestRoad({x:p.x,y:supportY,z:p.z});
   if(!near){report.navigationMisses++;send(k,b,at);continue;}
   // Reconstruct the public leave/re-enter rule, including boxes returning
   // under this kart. Availability alone does not mean this kart may claim.
   for(const c of s.crates){
    const d=Math.hypot(p.x-c.position.x,p.y-c.position.y,p.z-c.position.z);
    if(d>3)b.blocked.delete(c.id);
    else if(c.available&&b.available&&!b.available.has(c.id))b.blocked.add(c.id);
   }
   b.available=new Set(s.crates.filter(c=>c.available).map(c=>c.id));
   const level=map.levels.reduce((a,l)=>Math.abs(l.y-supportY)<Math.abs(a.y-supportY)?l:a);b.levels.add(level.id);const district=map.sockets.filter(h=>h.level===level.id).sort((a,b)=>distance(a,p)-distance(b,p))[0]?.district;if(district)b.districts.add(district);
   if(!b.anchor||distance(p,b.anchor)>.5){b.anchor={...p};b.progress=at;b.stallRecorded=false;}
   else {
    if(at-b.progress>3000&&!b.stallRecorded){
     report.stuck.push({pid:k.id,at,position:p,goal:b.goal?.id,speed:pose.speed,frostT:k.frostT,spinT:k.spinT});b.stallRecorded=true;
    }
    if(at-b.progress>1200&&at>=(b.retryAt||0)){
     report.blockedManoeuvres++;if(b.goal)b.avoid.set(b.goal.id,at+5000);
     b.reverseUntil=at+900;b.retryAt=at+1800;b.goal=null;
    }
   }
   const current=s.crates.find(c=>c.id===b.goal?.crateId),arrived=b.goal&&distance(p,b.goal)<2.1&&Math.abs(supportY-b.goal.y)<.6;
   if(arrived){b.visits.add(b.goal.id);b.goal.visits++;}
   if(!b.goal||arrived||(!armed&&at%250===0)||(!armed&&(!current?.available||b.blocked.has(current.id)))){
    const pool=homes.filter(h=>(b.avoid.get(h.id)||0)<at&&((armed&&distance(h,p)>3.2)||(s.crates.find(c=>c.id===h.crateId)?.available&&!b.blocked.has(h.crateId)))&&Number.isFinite(h.field.distance[near.n.index]));
    const yaw=Math.atan2(2*(pose.rotation.w*pose.rotation.y+pose.rotation.x*pose.rotation.z),1-2*(pose.rotation.y**2+pose.rotation.x**2));
    const ranked=pool.map(h=>{let n=near.n;for(let j=0;j<5;j++){const next=h.field.parents[n.index];if(next<0)break;n=nav.nodes[next];}
     const desired=Math.atan2(n.x-p.x,n.z-p.z),angle=Math.abs(Math.atan2(Math.sin(yaw-desired),Math.cos(yaw-desired))),turn=Math.min(angle,Math.PI-angle+.5);
     const travel=h.metres[near.n.index];
     return {h,score:travel+(armed?Math.min(12,h.visits*2):0)+(reserved.get(h.crateId)||0)*3+turn*3+(b.goal?.id===h.id?-5:0)+random()};
    }).sort((a,b)=>a.score-b.score);
    if(ranked[0]){b.goal=ranked[0].h;reserved.set(b.goal.crateId,(reserved.get(b.goal.crateId)||0)+1);}
   }
   if(!b.goal){send(k,b,at);continue;}
   const remaining=b.goal.metres[near.n.index];
   if(b.approachGoal!==b.goal.id||remaining<b.bestRemaining-1){b.approachGoal=b.goal.id;b.bestRemaining=remaining;b.approachAt=at;}
   if(at-b.approachAt>2500){b.escapeUntil=at+1500;b.approachAt=at;}
   let i=near.n.index,look=0,target=b.goal;for(let guard=0;guard<24;guard++){const next=b.goal.field.parents[i];if(next<0)break;const n=nav.nodes[next];look+=Math.hypot(n.x-nav.nodes[i].x,n.z-nav.nodes[i].z);target=n;i=next;if(look>=5)break;}
   if(near.distance>1.4)target=near.n;
   const yaw=Math.atan2(2*(pose.rotation.w*pose.rotation.y+pose.rotation.x*pose.rotation.z),1-2*(pose.rotation.y**2+pose.rotation.x**2)),desired=Math.atan2(target.x-p.x,target.z-p.z),error=Math.atan2(Math.sin(yaw-desired),Math.cos(yaw-desired));
   const wanted=Math.abs(error)>.7?3:Math.abs(error)>.3?6:11,reverse=at<b.reverseUntil||Math.abs(error)>2.2;
   if(process.env.ARENA_TRACE&&at%1000===0)console.log('PATH',JSON.stringify({pid:k.id,at,p,goal:b.goal.id,target:{x:target.x,y:target.y,z:target.z},error,speed:pose.speed,weapon:k.weapon,blocked:[...b.blocked],currentAvailable:current?.available}));
   const planned=near.distance>1.4||at<(b.escapeUntil||0)?null:planner.drive(pose,near.n,b.goal);
   send(k,b,at,{steer:reverse?Math.max(-1,Math.min(1,-Math.atan2(Math.sin(yaw-desired+Math.PI),Math.cos(yaw-desired+Math.PI))*2.5)):Math.max(-1,Math.min(1,Math.atan2(4*Math.sin(error),Math.max(2,distance(target,p)))* (1+Math.abs(pose.speed)*.055)/.43)),throttle:reverse?-.45:Math.max(0,Math.min(.8,(wanted-pose.speed)*.3)),brake:!reverse&&pose.speed>wanted+.8?.3:0,...(planned||{})});

  }
  const start=performance.now();s=match.advance(at+50);report.stepMs.push(performance.now()-start);
  for(const e of s.events)if(!seen.has(e.id)){seen.add(e.id);if(e.type==='pickup'){report.pickups++;const home=homes.find(h=>h.crateId===e.crateId);if(home){home.visits++;brains.get(e.pid)?.visits.add(home.id);brains.get(e.pid)?.blocked.add(home.crateId);}}if(e.type==='fire')report.shots++;if(e.type==='ko')report.kos++;if(e.type==='recovery')report.recoveries.push({at,pid:e.pid});}
  report.availability.push(s.crates.filter(c=>c.available).length/s.crates.length);
  for(const l of map.levels){if(s.crates.some(c=>c.available&&Math.abs(c.position.y-.6-l.y)<.1))report.dryMs[l.id]=0;else report.dryMs[l.id]+=50;report.maxDryMs=Math.max(report.maxDryMs,report.dryMs[l.id]);}
 }
 observe(s,seconds*1000);for(const [pid,b] of brains)if(b.unarmedAt!==null&&b.unarmedAt<seconds*1000){const ms=seconds*1000-b.unarmedAt;report.unarmedMs.push(ms);report.unarmedIntervals.push({pid,start:b.unarmedAt,end:seconds*1000,ms,reason:'round-end',from:b.unarmedFrom,to:s.karts.find(k=>k.id===pid).pose.position,goal:b.goal?.id});}
 const counts=(key,out)=>{for(const b of brains.values())for(const item of b[key])out[item]=(out[item]||0)+1;};counts('levels',report.levelVisits);counts('districts',report.districtVisits);
 report.inputCounts=Object.fromEntries([...brains].map(([pid,b])=>[pid,b.seq]));
 report.finalBots=s.karts.map(k=>({id:k.id,alive:k.alive,position:k.pose.position,unarmedSince:brains.get(k.id).unarmedAt}));
 report.visitedHomes=[...new Set([...brains.values()].flatMap(b=>[...b.visits]))];report.homes=homes.length;
 for(const key of['availability','stepMs','unarmedMs','aliveUnarmedMs']){const values=report[key].sort((a,b)=>a-b),percentile=q=>values[Math.min(values.length-1,Math.floor(values.length*q))]??null;report[key]={median:percentile(.5),p95:percentile(.95),p99:percentile(.99),mean:values.length?values.reduce((a,b)=>a+b,0)/values.length:null,max:values.at(-1)??null,min:values[0]??null,samples:values.length};}
 return report;
 }finally{match.dispose();query.dispose();}
}

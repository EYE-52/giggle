import {createKartPhysics} from '../../public/js/engines/kart-physics-core.mjs';
import {elevatedStatics} from '../../public/js/engines/kart-feature-solids.mjs';
import {selectArenaVariant} from '../../public/js/engines/kart-arena-policy.mjs';
import {arenaClearanceGraph} from './kart-arena-audit.mjs';
import combat from '../../games/engines/kart-elevated-combat.js';
// Test opponents seek actual available fixed homes and fire actual payloads.
// They use only normal authority intents. No pose restores or item injection.
export function runArenaBattle(R,C,source,players,{seed=1,seconds=180,fire=true}={}){
 const map=selectArenaVariant(source,players),query=createKartPhysics(R,C);elevatedStatics(map).forEach(d=>query.addStatic(d));
 const nav=arenaClearanceGraph(query,map,1,{turnMargin:.4}),seats=Array.from({length:players},(_,i)=>({id:'bot'+i})),match=combat.createElevatedCombat(R,C,source,seats,{instance:'battle',seed,startAt:0,countdownMs:0,roundMs:seconds*1000});
 let s=match.snapshot(),rng=seed,seen=new Set(),seq=0;const random=()=>((rng=(Math.imul(rng,1664525)+1013904223)>>>0)/4294967296);
 const homes=s.crates.map(c=>{const home=map.sockets.find(h=>h.id===c.homeId),near=nav.nearest(home);if(!near)throw new Error('Home lacks navigation node');return {...home,crateId:c.id,field:nav.shortest(near.n.index,null,true),visits:0};});
 const brains=new Map(seats.map(k=>[k.id,{goal:null,visits:new Set(),levels:new Set(),districts:new Set(),anchor:null,progress:0,wait:0,reverseUntil:0,unarmedAt:0,seq:0,stuck:0}]));
 const report={players,variant:map.variantId,seed,seconds,pickups:0,shots:0,kos:0,recoveries:[],stuck:[],availability:[],dryMs:Object.fromEntries(map.levels.map(l=>[l.id,0])),maxDryMs:0,unarmedMs:[],visitedHomes:[],levelVisits:{},districtVisits:{},stepMs:[]};
 const distance=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
 try{for(let at=0;at<seconds*1000;at+=50){seq++;
  const reserved=new Map();for(const b of brains.values())if(b.goal)reserved.set(b.goal.crateId,(reserved.get(b.goal.crateId)||0)+1);
  for(const k of s.karts){const b=brains.get(k.id),pose=k.pose,p=pose.position;if(!k.alive)continue;
   const hit=query.supportAt({...p,y:p.y+.2},2),supportY=hit?.point.y??p.y-.65,near=nav.nearest({x:p.x,y:supportY,z:p.z});
   if(!near)continue;
   const level=map.levels.reduce((a,l)=>Math.abs(l.y-supportY)<Math.abs(a.y-supportY)?l:a);b.levels.add(level.id);b.districts.add((p.x<0?'west':'east')+'-'+(p.z<16?'north':'south')+'-'+level.id);
   if(!b.anchor||distance(p,b.anchor)>.5){b.anchor={...p};b.progress=at;b.stuck=0;}else if(at-b.progress>3000&&b.reverseUntil<at){
    const traffic=s.karts.some(o=>o.id!==k.id&&o.alive&&Math.abs(o.pose.position.y-p.y)<2&&distance(o.pose.position,p)<5);
    if(!traffic){b.stuck++;if(b.stuck===1)report.stuck.push({pid:k.id,at,position:p,goal:b.goal?.id});}
    b.reverseUntil=at+1400;b.progress=at;b.goal=null;
   }
   const current=s.crates.find(c=>c.id===b.goal?.crateId),arrived=b.goal&&distance(p,b.goal)<2.1&&Math.abs(supportY-b.goal.y)<.6;
   if(arrived){b.visits.add(b.goal.id);b.goal.visits++;}
   if(!b.goal||arrived||(!k.weapon&&!current?.available)){
    const pool=homes.filter(h=>(k.weapon||s.crates.find(c=>c.id===h.crateId)?.available)&&Number.isFinite(h.field.distance[near.n.index]));
    const ranked=pool.map(h=>({h,score:h.field.distance[near.n.index]+(k.weapon?h.visits*14:0)+(reserved.get(h.crateId)||0)*(k.weapon?5:12)+random()*3})).sort((a,b)=>a.score-b.score);
    if(ranked[0]){b.goal=ranked[0].h;reserved.set(b.goal.crateId,(reserved.get(b.goal.crateId)||0)+1);}
   }
   if(!b.goal)continue;
   let i=near.n.index,look=0,target=b.goal;for(let guard=0;guard<24;guard++){const next=b.goal.field.parents[i];if(next<0)break;const n=nav.nodes[next];look+=Math.hypot(n.x-nav.nodes[i].x,n.z-nav.nodes[i].z);target=n;i=next;if(look>=4)break;}
   const yaw=Math.atan2(2*(pose.rotation.w*pose.rotation.y+pose.rotation.x*pose.rotation.z),1-2*(pose.rotation.y**2+pose.rotation.x**2)),desired=Math.atan2(target.x-p.x,target.z-p.z),error=Math.atan2(Math.sin(yaw-desired),Math.cos(yaw-desired));
   const wanted=Math.abs(error)>.5?2.6:6,reverse=at<b.reverseUntil||Math.abs(error)>2.2,own=match.privateStatus(k.id);
   const use=fire&&!!k.weapon&&seq%4===0;match.input(k.id,{instance:'battle',life:own.life,controlEpoch:own.controlEpoch,seq:++b.seq,steer:reverse?Math.max(-1,Math.min(1,-Math.atan2(Math.sin(yaw-desired+Math.PI),Math.cos(yaw-desired+Math.PI))*2.5)):Math.max(-1,Math.min(1,error*2.5)),throttle:reverse?-.45:Math.max(0,Math.min(.8,(wanted-pose.speed)*.3)),brake:!reverse&&pose.speed>wanted+.8?.3:0,nitro:false,use},at);
   if(!k.weapon&&!k.firing&&b.unarmedAt===null)b.unarmedAt=at;
   if((k.weapon||k.firing)&&b.unarmedAt!==null){report.unarmedMs.push(at-b.unarmedAt);b.unarmedAt=null;}
  }
  const start=performance.now();s=match.advance(at+50);report.stepMs.push(performance.now()-start);
  for(const e of s.events)if(!seen.has(e.id)){seen.add(e.id);if(e.type==='pickup'){report.pickups++;const home=homes.find(h=>h.crateId===e.crateId);if(home){home.visits++;brains.get(e.pid)?.visits.add(home.id);}}if(e.type==='fire')report.shots++;if(e.type==='ko')report.kos++;if(e.type==='recovery')report.recoveries.push({at,pid:e.pid});}
  if(at%250===0)report.availability.push(s.crates.filter(c=>c.available).length/s.crates.length);
  for(const l of map.levels){if(s.crates.some(c=>c.available&&Math.abs(c.position.y-.6-l.y)<.1))report.dryMs[l.id]=0;else report.dryMs[l.id]+=50;report.maxDryMs=Math.max(report.maxDryMs,report.dryMs[l.id]);}
 }
 const counts=(key,out)=>{for(const b of brains.values())for(const item of b[key])out[item]=(out[item]||0)+1;};counts('levels',report.levelVisits);counts('districts',report.districtVisits);
 report.visitedHomes=[...new Set([...brains.values()].flatMap(b=>[...b.visits]))];report.homes=homes.length;
 for(const key of['availability','stepMs','unarmedMs']){const values=report[key].sort((a,b)=>a-b),percentile=q=>values[Math.min(values.length-1,Math.floor(values.length*q))]??null;report[key]={median:percentile(.5),p95:percentile(.95),p99:percentile(.99),min:values[0]??null,samples:values.length};}
 return report;
 }finally{match.dispose();query.dispose();}
}

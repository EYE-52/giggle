import combat from '../../games/engines/kart-elevated-combat.js';
import {arenaPoint,arenaSupport} from '../../public/js/engines/kart-arena-authoring.mjs';
// Real authority inputs, with a diagnostic initial start only. A traversal
// never resets, restores, teleports or calls an authority-private helper.
export function driveArenaRoute(RAPIER,config,map,points,{seed=42,speed=5,seconds=180,continuous=false}={}){
 const first=points[0],second=points[1],angle=Math.atan2(second.x-first.x,second.z-first.z),copy=structuredClone(map);
 const initial=arenaPoint('route-start',arenaSupport(copy,first.x,first.y,first.z),first.x,first.y,first.z,angle,{district:'core'});
 const rival=copy.spawnCandidates.filter(p=>p.y===0).map(p=>({p,clear:Math.min(...points.map(q=>Math.hypot(p.x-q.x,p.y-q.y,p.z-q.z)))})).sort((a,b)=>b.clear-a.clear)[0].p;
 copy.spawns=[initial,rival];copy.spawnCandidates=[initial,...copy.spawnCandidates];
 const match=combat.createElevatedCombat(RAPIER,config,copy,[{id:'bot'},{id:'rival'}],{instance:'route',seed,startAt:0,countdownMs:0,roundMs:Math.min(600000,seconds*1000+5000)});
 let goal=1,seq=0,at=0,stuck=0,anchor=first,lastProgress=0;const poses=[],events=new Set();
 try{
  let snapshot=match.snapshot();
  for(let frame=0;at<seconds*1000&&goal<points.length;frame++){
   const bot=snapshot.karts[0],p=bot.pose,target=points[goal],distance=Math.hypot(target.x-p.position.x,target.z-p.position.z);
   for(const e of snapshot.events)if(['recovery','recover','respawn'].includes(e.type)&&e.pid==='bot')events.add(e.id+':'+e.type);
   if(distance<1.8&&Math.abs(p.position.y-target.y-.7)<1.2){goal++;if(continuous&&goal===points.length)goal=1;lastProgress=at;continue;}
   const yaw=Math.atan2(2*(p.rotation.w*p.rotation.y+p.rotation.x*p.rotation.z),1-2*(p.rotation.y**2+p.rotation.x**2)),desired=Math.atan2(target.x-p.position.x,target.z-p.position.z),error=Math.atan2(Math.sin(yaw-desired),Math.cos(yaw-desired));
   const wanted=Math.abs(error)>.4||distance<8?Math.min(speed,3):speed;
   const status=match.privateStatus('bot');match.input('bot',{instance:'route',life:status.life,controlEpoch:status.controlEpoch,seq:++seq,throttle:Math.max(0,Math.min(.7,(wanted-p.speed)*.3)),brake:p.speed>wanted+.6?.25:0,steer:Math.max(-1,Math.min(1,error*2.5)),nitro:false,use:false},at);
   at+=50;snapshot=match.advance(at);if(frame%4===0)poses.push({at,goal,position:p.position,rotation:p.rotation,grounded:p.grounded});
   if(Math.hypot(p.position.x-anchor.x,p.position.z-anchor.z)>.5){anchor=p.position;stuck=0;}else if(at-lastProgress>3000)stuck+=50;
   if(stuck>=3000)break;
  }
  return {complete:goal===points.length,goal,targets:points.length,at,stuck,events:[...events],poses,final:match.snapshot().karts[0].pose};
 }finally{match.dispose();}
}

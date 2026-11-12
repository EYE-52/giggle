/* Bounded presentation records derived from accepted snapshots. These never
 * affect collisions, scoring or physics. Initial/reconnected history stays quiet. */
export function createKartFeedback({radius=2.05}={}) {
 let instance,primed=false,sequence=0,lastSim=null;const seenEvents=new Set(),seenContacts=new Set(),previous=new Map(),cooldown=new Map();
 const live=[];
 const reset=()=>{primed=false;lastSim=null;seenEvents.clear();seenContacts.clear();previous.clear();cooldown.clear();live.length=0;};
 const add=(effect,now,duration)=>{live.push({...effect,id:++sequence,at:now,until:now+duration});if(live.length>24)live.shift();};
 // The two queues advance independently. New tyre contacts must never
 // evict retained weapon events or make them look like new shots.
 function remember(seen,id){
  if(seen.has(id))return false;
  seen.add(id);
  if(seen.size>48)seen.delete(seen.values().next().value);
  return true;
 }
 function ingest(S,now){
  if(S.instanceId!==instance){instance=S.instanceId;reset();}
  if(S.audioBaseline)reset();
  const sim=Number(S.simAt);if(Number.isFinite(sim)){if(lastSim!==null&&sim-lastSim>1000){primed=false;previous.clear();live.length=0;}lastSim=sim;}
  const events=Array.isArray(S.events)?S.events:[];
  const contacts=Array.isArray(S.physicalEvents)?S.physicalEvents:[];
  if(S.phase!=='drive'){
   for(const e of events)remember(seenEvents,e.id);
   for(const e of contacts)remember(seenContacts,e.id);
   previous.clear();live.length=0;primed=true;return;
  }
  for(const e of events){if(!remember(seenEvents,e.id)||!primed)continue;
   const source=S.karts?.find(k=>k.pid===e.pid),victim=S.karts?.find(k=>k.pid===e.other);
   if(e.type==='ko'&&victim)add({kind:'ko',pid:victim.pid,x:victim.x,z:victim.z,position:e.position||victim.physicalPose?.position,angle:victim.angle,weapon:e.weapon},now,850);
   if(e.type==='blast'&&Number.isFinite(e.x)&&Number.isFinite(e.z))add({kind:'blast',pid:e.pid,weapon:e.weapon,tick:e.tick,x:e.x,z:e.z,position:e.position},now,550);
   if(['fire','mine','hit','impact'].includes(e.type)&&e.position)add({kind:e.type,sourceId:e.id,pid:e.pid,other:e.other,damage:e.damage,weapon:e.weapon,position:e.position,direction:e.direction,from:e.from,normal:e.normal,tick:e.tick},now,140);
  }
  for(const e of contacts){
   if(!remember(seenContacts,e.id))continue;
   if(!primed||e.kind!=='contact'||!e.position)continue;
   const pid=e.ids?.includes(S.you)?S.you:e.ids?.[0];
   // Preserve the solver response all the way to sound and contact sparks.
   // Suspension/floor forces are not bumper crashes; resting contact must
   // not repeatedly manufacture the same burst in consecutive snapshots.
   const landing=e.normal && Math.abs(e.normal.y)>.75;
   if(landing && !(e.impulse>=480))continue;
   const key='contact:'+([...e.ids||[]].sort().join('|'))+':'+(e.surfaceId||'kart');
   if(now-(cooldown.get(key)??-Infinity)<140)continue;
   cooldown.set(key,now);
   add({kind:landing?'landing':'collision',pid,other:e.ids?.find(id=>id!==pid),x:e.position.x,z:e.position.z,
     position:e.position,normal:e.normal,impulse:e.impulse,surfaceId:e.surfaceId,tick:e.tick},now,350);
  }
  const nearSolid=k=>Math.abs(k.x)>=(S.map?.bound||28)-.15||Math.abs(k.z)>=(S.map?.bound||28)-.15||(S.map?.blocks||[]).some(b=>{
   const dx=Math.max(0,Math.abs(k.x-b.x)-b.hw),dz=Math.max(0,Math.abs(k.z-b.z)-b.hd);return Math.hypot(dx,dz)<=radius+.15;
  })||(S.karts||[]).some(b=>b.pid!==k.pid&&b.connected!==false&&!(b.respawn>0)&&Math.hypot(k.x-b.x,k.z-b.z)<=radius*2+.12);
  for(const k of S.karts||[]){const old=previous.get(k.pid),valid=k.connected!==false&&!(k.respawn>0);
   const delta=(S.simAt||S.serverNow||0)-(old?.at||0);
   if(primed&&old?.valid&&k.connected!==false&&k.respawn>0&&k.fell!==true&&old.spawnSeq===k.spawnSeq&&delta>0&&delta<=300&&!live.some(e=>e.kind==='ko'&&e.pid===k.pid&&e.until>now)){
    const nuke=live.some(e=>e.kind==='blast'&&e.weapon==='nuke'&&Math.hypot(k.x-e.x,k.z-e.z)<14);
    add({kind:'ko',pid:k.pid,x:k.x,z:k.z,position:k.physicalPose?.position,angle:k.angle,inferred:true,weapon:nuke?'nuke':undefined},now,850);
   }
   if(!k.physicalPose&&primed&&valid&&old?.valid&&old.spawnSeq===k.spawnSeq&&delta>0&&delta<=300&&Math.abs(old.speed)>4&&Math.abs(old.speed)-Math.abs(k.speed)>3&&nearSolid(k)&&now-(cooldown.get(k.pid)||-Infinity)>650){
    add({kind:'collision',pid:k.pid,x:k.x,z:k.z,angle:k.angle},now,350);cooldown.set(k.pid,now);
   }
   previous.set(k.pid,{speed:k.speed||0,valid,spawnSeq:k.spawnSeq,at:S.simAt||S.serverNow||0});
  }
  primed=true;
 }
 function current(now){for(let i=live.length-1;i>=0;i--)if(live[i].until<=now)live.splice(i,1);return live;}
 // A normal respawn retires the previous life's visuals, but keeps event
 // identity/priming so fresh respawn/fire feedback in that packet still plays.
 const clearPresentation=()=>{previous.clear();cooldown.clear();live.length=0;};
 return {ingest,current,reset,clearPresentation};
}

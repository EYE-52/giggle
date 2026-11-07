/* Cosmetic flight only. Server sweeps/impacts remain authoritative. Render
 * at the calibrated server clock instead of easing after stale 10Hz points.
 * A short lead expires on missing packets, and stops at visible cover. */
const PHYSICAL_LEAD=.15;
export function projectilePose(shot, snapshot, serverNow) {
  const speed=Number(shot.speed)||({machinegun:140,trishot:95,missile:60,cannon:44,pulse:110,scatter:95,rocket:85,rail:160}[shot.kind]||110);
  const age=Number.isFinite(snapshot.simAt) ? Math.max(0,(serverNow-snapshot.simAt)/1000) : 0;
  const lead=Math.min(age,.2,Math.max(0,Number(shot.ttl)||0));
  // Bridges/undersides are absent from the planar cover projection.
  if(shot.physical===true){
    const t=Math.min(age,PHYSICAL_LEAD,Math.max(0,Number(shot.ttl)||0)),g=shot.kind==='cannon'?12:0;
    return {x:shot.x+(shot.vx||0)*t,y:shot.y+(shot.vy||0)*t-.5*g*t*t,z:shot.z+(shot.vz||0)*t,angle:shot.angle,
      direction:{x:shot.vx,y:(shot.vy||0)-g*t,z:shot.vz},visible:age<=PHYSICAL_LEAD&&age<(Number(shot.ttl)||0)};
  }
  const dx=(Number.isFinite(shot.vx)?shot.vx:Math.sin(shot.angle)*speed)*lead, dz=(Number.isFinite(shot.vz)?shot.vz:Math.cos(shot.angle)*speed)*lead;
  let hit=1;
  const bound=snapshot.map?.bound||28;
  for (const [p,d] of [[shot.x,dx],[shot.z,dz]]) {
    if(d>0)hit=Math.min(hit,(bound-.45-p)/d);
    else if(d<0)hit=Math.min(hit,(-bound+.45-p)/d);
  }
  for(const b of snapshot.map?.blocks||[]) {
    let lo=0,hi=1;
    for(const [p,d,c,r] of [[shot.x,dx,b.x,b.hw+.45],[shot.z,dz,b.z,b.hd+.45]]) {
      if(Math.abs(d)<1e-9) {if(p<c-r||p>c+r){lo=2;break;}}
      else {const a=(c-r-p)/d,e=(c+r-p)/d;lo=Math.max(lo,Math.min(a,e));hi=Math.min(hi,Math.max(a,e));}
    }
    if(lo<=hi&&lo<=1&&hi>=0)hit=Math.min(hit,Math.max(0,lo));
  }
  hit=Math.max(0,Math.min(1,hit));
  return {x:shot.x+dx*hit,y:shot.y??.8,z:shot.z+dz*hit,angle:shot.angle,visible:age<=.25&&age<(Number(shot.ttl)||0)};
}
/* Ballistic visual lead shares the authoritative velocity/gravity but never
 * predicts through full-height cover. Bounces and the fuse stay server-owned. */
export const GRENADE_GRAVITY = 30;
export function grenadePose(g, snapshot, serverNow) {
  const age=Number.isFinite(snapshot.simAt) ? Math.max(0,(serverNow-snapshot.simAt)/1000) : 0;
  const fuse=Math.max(0,Number(g.fuse ?? g.ttl)||0),lead=Math.min(age,.2,fuse);
  if(g.physical===true)return {x:g.x,y:g.y,z:g.z,angle:Number(g.angle)||0,warning:g.warning===true,visible:age<=.25&&age<fuse};
  const bound=(Number(snapshot.map?.bound)||0)>0 ? Number(snapshot.map.bound) : 28;
  const x=Number(g.x)||0,z=Number(g.z)||0,dx=(Number(g.vx)||0)*lead,dz=(Number(g.vz)||0)*lead;
  let hit=1;
  for(const [p,d]of [[x,dx],[z,dz]]){
    if(d>0)hit=Math.min(hit,(bound-.45-p)/d);
    else if(d<0)hit=Math.min(hit,(-bound+.45-p)/d);
  }
  for(const b of snapshot.map?.blocks||[]){
    let lo=0,hi=1;
    for(const [p,d,c,r]of [[x,dx,b.x,b.hw+.45],[z,dz,b.z,b.hd+.45]]){
      if(Math.abs(d)<1e-9){if(p<c-r||p>c+r){lo=2;break;}}
      else{const a=(c-r-p)/d,e=(c+r-p)/d;lo=Math.max(lo,Math.min(a,e));hi=Math.min(hi,Math.max(a,e));}
    }
    if(lo<=hi&&lo<=1&&hi>=0)hit=Math.min(hit,Math.max(0,lo));
  }
  hit=Math.max(0,Math.min(1,hit));const t=lead*hit;
  const y=Math.max(0,(Number(g.y)||0)+(Number(g.vy)||0)*t-.5*GRENADE_GRAVITY*t*t);
  return {x:x+dx*hit,z:z+dz*hit,y,angle:Number(g.angle)||0,warning:g.warning===true,visible:age<=.25&&age<fuse};
}

// Physical shots share the remote playback clock and lead along velocity
// during a stall. Only a newer authority packet can retire an absent shot.
export function createProjectilePlayback(){
 const records=new Map();let stamp=null,delay=100;
 function ingest(shots,simAt){
  if(!Number.isFinite(simAt)||stamp!==null&&simAt<=stamp)return;
  stamp=simAt;
  for(const shot of shots||[]){
   let r=records.get(shot.id);
   if(!r){r={current:shot,list:[],at:simAt};records.set(shot.id,r);}
   r.current=shot;r.at=simAt;r.list.push({at:simAt,shot});
   while(r.list.length>1&&r.list[1].at<simAt-1500)r.list.shift();
  }
  for(const[id,r]of records)if(r.at!==simAt)records.delete(id);
 }
 function sample(shot,snapshot,now,out){
  if(shot.physical!==true)return projectilePose(shot,snapshot,now);
  const r=records.get(shot.id),time=now-delay,at=r?.at??snapshot.simAt,age=Number.isFinite(at)?Math.max(0,(now-at)/1000):0;
  let a=r?.current||shot,b=a,alpha=1;
  if(r){
   a=b=r.list[0].shot;
   for(let i=r.list.length-1;i>0;i--)if(time>=r.list[i-1].at){const from=r.list[i-1],to=r.list[i];a=from.shot;b=to.shot;alpha=Math.max(0,Math.min(1,(time-from.at)/(to.at-from.at)));break;}
  }
  const ahead=Math.max(0,(time-at)/1000)||0,lead=Math.min(ahead,PHYSICAL_LEAD),g=b.kind==='cannon'?12:0;
  out.x=a.x+(b.x-a.x)*alpha+(b.vx||0)*lead;out.y=a.y+(b.y-a.y)*alpha+(b.vy||0)*lead-.5*g*lead*lead;out.z=a.z+(b.z-a.z)*alpha+(b.vz||0)*lead;
  out.angle=b.angle;const v=out.direction;
  v.x=(a.vx||0)+((b.vx||0)-(a.vx||0))*alpha;v.y=(a.vy||0)+((b.vy||0)-(a.vy||0))*alpha-g*lead;v.z=(a.vz||0)+((b.vz||0)-(a.vz||0))*alpha;
  out.visible=age<=1&&ahead<=PHYSICAL_LEAD&&ahead<(Number((r?.current||b).ttl)||0)&&(!r||time>=r.list[0].at)&&!(stamp>at&&!r);return out;
 }
 return {ingest,sample,setDelay(ms){delay=Math.max(0,Number(ms)||0);},reset(){stamp=null;delay=100;records.clear();}};
}

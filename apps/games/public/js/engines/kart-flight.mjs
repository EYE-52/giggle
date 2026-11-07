/* Cosmetic flight only. Server sweeps/impacts remain authoritative. Render
 * at the calibrated server clock instead of easing after stale 10Hz points.
 * A short lead expires on missing packets, and stops at visible cover. */
export function projectilePose(shot, snapshot, serverNow) {
  const speed=Number(shot.speed)||({machinegun:140,trishot:95,missile:60,cannon:44,pulse:110,scatter:95,rocket:85,rail:160}[shot.kind]||110);
  const age=Number.isFinite(snapshot.simAt) ? Math.max(0,(serverNow-snapshot.simAt)/1000) : 0;
  const lead=Math.min(age,.2,Math.max(0,Number(shot.ttl)||0));
  // Physical cover can include bridges/undersides absent from the planar
  // map projection. Draw the accepted 3D position, never extrapolate it
  // through an unseen surface; confirmed sweep cues cover short shots.
  if(shot.physical===true)return {x:shot.x,y:shot.y,z:shot.z,angle:shot.angle,
    direction:{x:shot.vx,y:shot.vy,z:shot.vz},visible:age<=.25&&age<(Number(shot.ttl)||0)};
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

// Interpolate only accepted physical samples. This removes the old 10 Hz
// stop/start motion without guessing future hits, turns, or cover contacts.
// The renderer owns `out`, so sampling makes no objects in a driving frame.
export function createProjectilePlayback(){
 const records=new Map();let stamp=null;
 function ingest(shots,simAt){
  if(!Number.isFinite(simAt)||simAt===stamp)return;
  const gap=stamp===null?0:simAt-stamp;
  if(gap<0||gap>500)records.clear();
  stamp=simAt;
  for(const shot of shots||[]){
   let r=records.get(shot.id);
   if(!r){r={previous:shot,current:shot,before:simAt,at:simAt};records.set(shot.id,r);}
   else {r.previous=r.current;r.before=r.at;r.current=shot;r.at=simAt;}
  }
  for(const[id,r]of records)if(r.at!==simAt)records.delete(id);
 }
 function sample(shot,snapshot,now,out){
  if(shot.physical!==true)return projectilePose(shot,snapshot,now);
  const r=records.get(shot.id),span=r?r.at-r.before:0;
  const alpha=span>0?Math.max(0,Math.min(1,(now-Math.min(100,span)-r.before)/span)):1;
  const a=r?.previous||shot,b=r?.current||shot;
  out.x=a.x+(b.x-a.x)*alpha;out.y=a.y+(b.y-a.y)*alpha;out.z=a.z+(b.z-a.z)*alpha;
  out.angle=shot.angle;const v=out.direction;
  v.x=a.vx+(b.vx-a.vx)*alpha;v.y=a.vy+(b.vy-a.vy)*alpha;v.z=a.vz+(b.vz-a.vz)*alpha;
  const age=Number.isFinite(snapshot.simAt)?Math.max(0,(now-snapshot.simAt)/1000):0;
  out.visible=age<=.25&&age<shot.ttl;return out;
 }
 return {ingest,sample,reset(){stamp=null;records.clear();}};
}

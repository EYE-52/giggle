/* Render-only full-pose interpolation. The authority owns collisions and
 * outcomes; stale or changed lives never blend across a respawn/recovery. */
const XYZ=['x','y','z'],XYZW=['x','y','z','w'];
export function blendElevatedPose(previous, current, alpha, output) {
  const p = current.pose;
  if (!previous || previous.spawnSeq !== current.spawnSeq || previous.controlEpoch !== current.controlEpoch || !current.alive || !previous.alive || current.connected===false || previous.connected===false) return p;
  const a = previous.pose, t = Math.max(0, Math.min(1, alpha));
  const result=output||{position:{},rotation:{}},position=result.position,q=result.rotation;
  for(const k of XYZ)position[k]=a.position[k]+(p.position[k]-a.position[k])*t;
  // Shortest-arc normalized quaternion interpolation over adjacent ticks.
  const sign = a.rotation.x*p.rotation.x+a.rotation.y*p.rotation.y+a.rotation.z*p.rotation.z+a.rotation.w*p.rotation.w < 0 ? -1 : 1;
  for(const k of XYZW)q[k]=a.rotation[k]*(1-t)+p.rotation[k]*sign*t;
  const norm = Math.hypot(q.x,q.y,q.z,q.w) || 1;
  for (const k of XYZW) q[k] /= norm;
  const wheels=p.wheels?(result.wheels||[]):undefined;
  if(wheels)for(let i=0;i<p.wheels.length;i++){
    const wheel=p.wheels[i],before=a.wheels?.[i],out=wheels[i]||(wheels[i]={});Object.assign(out,wheel);
    if(!before)continue;
    // Rapier reports accumulated wheel rotation, so wrapping loses full turns.
    out.length=before.length+(wheel.length-before.length)*t;
    out.rotation=before.rotation+(wheel.rotation-before.rotation)*t;
    out.steering=before.steering+(wheel.steering-before.steering)*t;
  }
  Object.assign(result,p);result.position=position;result.rotation=q;result.wheels=wheels;result.speed=a.speed+(p.speed-a.speed)*t;return result;
}

/* Render confirmed simulation history only. A bounded clock/jitter reserve
 * prevents late ordered packets from spending the whole catch-up in one frame.
 * Missing history freezes; a fresh baseline never invents a motion segment. */
export function createElevatedTimeline(bufferMs=75) {
  const samples=[];let offset=null,played=-Infinity,lastFrame=null,lastArrival=null,jitter=0;
  const reset=()=>{samples.length=0;offset=null;played=-Infinity;lastFrame=null;lastArrival=null;jitter=0;};
  function ingest(snapshot,arrival){
    const latest=samples.at(-1),at=snapshot.simAt;
    if(!Number.isFinite(at))return;
    if(latest&&snapshot.instanceId===latest.snapshot.instanceId&&at<latest.snapshot.simAt)return;
    if(latest&&(snapshot.instanceId!==latest.snapshot.instanceId||at-latest.snapshot.simAt>1000))reset();
    if(samples.at(-1)?.snapshot.simAt===at)return;
    offset=offset===null?arrival-at:Math.min(offset,arrival-at);
    // The 20Hz stream's ordinary <=25ms jitter already fits the 75ms floor.
    // Grow promptly for a late burst; release its reserve by 50ms per second.
    jitter=Math.max(0,arrival-at-offset,jitter-Math.max(0,arrival-(lastArrival??arrival))*.05);
    lastArrival=arrival;
    while(samples.length>1&&samples[1].snapshot.simAt<=played)samples.shift();
    // Keep the active bracket. If accepted history exceeds the bounded queue,
    // adopt the fresh confirmed pose rather than interpolate a missing path.
    if(samples.length>=16){reset();offset=arrival-at;lastArrival=arrival;}
    samples.push({snapshot,karts:new Map(snapshot.karts.map(k=>[k.id,k]))});
  }
  function frame(time){
    if(!samples.length)return null;
    const reserve=Math.min(350,Math.max(bufferMs,50+jitter)),wanted=time-offset-reserve,latest=samples.at(-1).snapshot.simAt;
    if(lastFrame===null)played=Math.min(latest,wanted);
    else{
      const dt=Math.max(0,Math.min(100,time-lastFrame)),rate=Math.max(.9,Math.min(1.1,1+(wanted-played-dt)/1000));
      played=Math.min(latest,played+dt*rate);
    }
    lastFrame=Math.max(lastFrame??time,time);
    let end=1;while(end<samples.length&&samples[end].snapshot.simAt<played)end++;
    const current=samples[Math.min(end,samples.length-1)],previous=samples[Math.max(0,end-1)];
    const span=current.snapshot.simAt-previous.snapshot.simAt;
    return {previous,current,alpha:span>0?Math.max(0,Math.min(1,(played-previous.snapshot.simAt)/span)):1,at:played};
  }
  return {ingest,frame,reset};
}

export function nextElevatedInput(snapshot, sequence, controls) {
  const ack = snapshot?.inputAck;
  if (!snapshot?.youDrive || !ack || !['countdown','live'].includes(snapshot.phase)) return null;
  return {type:'input',seq:Math.max(sequence,ack.receivedSeq || 0)+1,life:ack.life,controlEpoch:ack.controlEpoch,
    steer:Math.max(-1,Math.min(1,controls.steer)),throttle:Math.max(-1,Math.min(1,controls.throttle)),
    brake:Math.max(0,Math.min(1,controls.brake)),nitro:!!controls.nitro,use:!!controls.use};
}

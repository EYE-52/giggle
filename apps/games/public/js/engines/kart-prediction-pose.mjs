// A checkpoint can arrive before the next local fixed step. Keep the last
// simulated step available for drawing, in the checkpoint's corrected frame.
// This is presentation history only; it is never restored into physics.
export function rebasePreviousPose(previous,before,after){
  if(!previous||!before||previous.epoch!==after.epoch||before.epoch!==after.epoch)return null;
  const multiply=(a,b)=>({x:a.w*b.x+a.x*b.w+a.y*b.z-a.z*b.y,y:a.w*b.y-a.x*b.z+a.y*b.w+a.z*b.x,z:a.w*b.z+a.x*b.y-a.y*b.x+a.z*b.w,w:a.w*b.w-a.x*b.x-a.y*b.y-a.z*b.z});
  const a=before.rotation,q=multiply(after.rotation,{x:-a.x,y:-a.y,z:-a.z,w:a.w});
  const x=previous.position.x-before.position.x,y=previous.position.y-before.position.y,z=previous.position.z-before.position.z;
  const tx=2*(q.y*z-q.z*y),ty=2*(q.z*x-q.x*z),tz=2*(q.x*y-q.y*x);
  const position={x:after.position.x+x+q.w*tx+q.y*tz-q.z*ty,y:after.position.y+y+q.w*ty+q.z*tx-q.x*tz,z:after.position.z+z+q.w*tz+q.x*ty-q.y*tx};
  const wheels=after.wheels?.map((wheel,i)=>{
    const old=before.wheels?.[i],prior=previous.wheels?.[i];if(!old||!prior)return {...wheel};
    const out={...wheel};for(const key of ['rotation','length','steering'])if(Number.isFinite(wheel[key])&&Number.isFinite(old[key])&&Number.isFinite(prior[key]))out[key]=wheel[key]+prior[key]-old[key];return out;
  });
  return {...after,position,rotation:multiply(q,previous.rotation),...(wheels?{wheels}:{})};
}

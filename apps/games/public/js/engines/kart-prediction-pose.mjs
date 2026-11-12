// A checkpoint can arrive before the next local fixed step. Keep the last
// simulated step available for drawing, in the checkpoint's corrected frame.
// This is presentation history only; it is never restored into physics.
function multiplyRotations(a,b){
  return {
    x:a.w*b.x+a.x*b.w+a.y*b.z-a.z*b.y,
    y:a.w*b.y-a.x*b.z+a.y*b.w+a.z*b.x,
    z:a.w*b.z+a.x*b.y-a.y*b.x+a.z*b.w,
    w:a.w*b.w-a.x*b.x-a.y*b.y-a.z*b.z,
  };
}

function rotateOffset(offset,rotation){
  const {x:qx,y:qy,z:qz,w:qw}=rotation;
  const crossX=2*(qy*offset.z-qz*offset.y);
  const crossY=2*(qz*offset.x-qx*offset.z);
  const crossZ=2*(qx*offset.y-qy*offset.x);
  return {
    x:offset.x+qw*crossX+qy*crossZ-qz*crossY,
    y:offset.y+qw*crossY+qz*crossX-qx*crossZ,
    z:offset.z+qw*crossZ+qx*crossY-qy*crossX,
  };
}

export function rebasePreviousPose(previous,before,after){
  if(!previous||!before||previous.epoch!==after.epoch||before.epoch!==after.epoch)return null;

  const oldRotation=before.rotation;
  const inverseBefore={x:-oldRotation.x,y:-oldRotation.y,z:-oldRotation.z,w:oldRotation.w};
  const rotationDelta=multiplyRotations(after.rotation,inverseBefore);
  const offset={
    x:previous.position.x-before.position.x,
    y:previous.position.y-before.position.y,
    z:previous.position.z-before.position.z,
  };
  const rotatedOffset=rotateOffset(offset,rotationDelta);
  const position={
    x:after.position.x+rotatedOffset.x,
    y:after.position.y+rotatedOffset.y,
    z:after.position.z+rotatedOffset.z,
  };
  const rotation=multiplyRotations(rotationDelta,previous.rotation);

  const wheels=after.wheels?.map((wheel,i)=>{
    const beforeWheel=before.wheels?.[i],previousWheel=previous.wheels?.[i];
    if(!beforeWheel||!previousWheel)return {...wheel};
    const rebasedWheel={...wheel};
    for(const key of ['rotation','length','steering']){
      if(Number.isFinite(wheel[key])&&Number.isFinite(beforeWheel[key])&&Number.isFinite(previousWheel[key])){
        rebasedWheel[key]=wheel[key]+previousWheel[key]-beforeWheel[key];
      }
    }
    return rebasedWheel;
  });
  return {...after,position,rotation,...(wheels?{wheels}:{})};
}

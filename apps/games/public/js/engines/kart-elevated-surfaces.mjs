// Authority-only surface effects. No client pose or map data is accepted.
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export function applyElevatedBelts(physics,id,pose,map,dt){
  if(!pose.grounded)return false;
  const belt=map.belts?.find(b=>Math.abs(pose.position.x-b.x)<b.halfX&&Math.abs(pose.position.z-b.z)<b.halfZ&&Math.abs(pose.position.y-b.y-.75)<.6&&pose.wheels.some(w=>w.contact&&w.surfaceId===b.surface));
  if(!belt)return false;
  const speed=Math.hypot(belt.velocity.x,belt.velocity.z),dx=belt.velocity.x/speed,dz=belt.velocity.z/speed;
  const along=pose.linearVelocity.x*dx+pose.linearVelocity.z*dz,change=clamp(speed-along,0,12*dt);
  // Restore preserves body, suspension controller, pose epoch and all other
  // velocity axes. A belt cannot launch a kart or push the floor above it.
  if(change)physics.restoreKart(id,{...pose,linearVelocity:{...pose.linearVelocity,x:pose.linearVelocity.x+dx*change,z:pose.linearVelocity.z+dz*change}});
  return true;
}
export function elevatedFallZone(map,position){
  return map.fallZones?.find(z=>position.y<z.below&&Math.abs(position.x-z.x)<z.halfX&&Math.abs(position.z-z.z)<z.halfZ)?.id||null;
}

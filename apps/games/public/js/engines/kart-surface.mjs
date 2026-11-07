// Pure, shared surface lookup. Only construction allocates; queries return
// the index's immutable tuning records, including the no-roads legacy case.
export function createSurfaceIndex(map) {
  const segments=[];
  for(const road of map.roads||[]) {
    const points=road.points;
    for(let i=0;i<points.length-(road.closed?0:1);i++) {
      const a=points[i],b=points[(i+1)%points.length],dx=b[0]-a[0],dz=b[1]-a[1];
      segments.push({x:a[0],z:a[1],dx,dz,inv:1/(dx*dx+dz*dz||1),r2:(road.width/2+.3)**2});
    }
  }
  return {segments,rects:[...(map.pads||[]),...(map.surfaces||[])],legacy:!map.roads,
    road:Object.freeze({top:1,traction:1}),
    offroad:Object.freeze({top:map.offroad?.top??1,traction:map.offroad?.traction??1})};
}
export function onRoad(index,x,z) {
  if(index.legacy)return true;
  for(let i=0;i<index.rects.length;i++) {
    const r=index.rects[i];if(Math.abs(x-r.x)<=r.hw&&Math.abs(z-r.z)<=r.hd)return true;
  }
  for(let i=0;i<index.segments.length;i++) {
    const s=index.segments[i],x0=x-s.x,z0=z-s.z;
    const t=Math.max(0,Math.min(1,(x0*s.dx+z0*s.dz)*s.inv));
    if((x0-s.dx*t)**2+(z0-s.dz*t)**2<=s.r2+1e-9)return true;
  }
  return false;
}
export function surfaceTuning(index,x,z) {return onRoad(index,x,z)?index.road:index.offroad;}

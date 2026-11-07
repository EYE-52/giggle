// One immutable record drives motion, dust, skids and tyre audio. Map values
// override the defaults; sampling never allocates or reads rendered geometry.
const profile=(kind,top,traction,driftEase,dust,skid,opacity,tyreHz,tyreGain,squeal)=>Object.freeze({kind,top,traction,driftEase,dust,skid,opacity,tyreHz,tyreGain,squeal});
export const SURFACE_PROFILES=Object.freeze({
  road:profile('road',1,1,1,0xaaa9b0,0x14121a,.55,340,.16,1),
  concrete:profile('concrete',.98,.92,1.04,0xb8cbd0,0x344958,.45,480,.13,1),
  metal:profile('metal',.98,.82,1.12,0xa5c0cf,0x405868,.38,1100,.12,1.08),
  grass:profile('grass',.72,.78,1.12,0x86b95c,0x496137,.3,210,.24,.25),
  sand:profile('sand',.70,.58,1.22,0xd8b27a,0x977448,.4,740,.30,.18),
  snow:profile('snow',.66,.48,1.26,0xdaefff,0xa4c1d3,.25,420,.19,.25),
  ice:profile('ice',.96,.20,1.3,0xb6eaff,0x8bd8ee,.13,2900,.065,1.18),
  boost:profile('boost',1,1,1,0x60ffe1,0x22675e,.35,900,.18,.8),
  gravel:profile('gravel',.74,.67,1.18,0xba8cf0,0x715788,.4,1500,.32,.35),
});
export const surfaceProfile=kind=>SURFACE_PROFILES[kind==='asphalt'?'road':kind==='dirt'?'sand':kind==='turbo'?'boost':kind]||SURFACE_PROFILES.road;
function authored(data,fallback) {
  const base=surfaceProfile(data?.kind||fallback);
  return Object.freeze({...base,top:data?.top??base.top,traction:data?.traction??data?.grip??base.traction,driftEase:data?.driftEase??base.driftEase});
}
export function createSurfaceIndex(map) {
  const segments=[];
  for(const road of map.roads||[]) {
    const points=road.points;
    for(let i=0;i<points.length-(road.closed?0:1);i++) {
      const a=points[i],b=points[(i+1)%points.length],dx=b[0]-a[0],dz=b[1]-a[1];
      segments.push({x:a[0],z:a[1],dx,dz,inv:1/(dx*dx+dz*dz||1),r2:(road.width/2+.3)**2});
    }
  }
  const zones=(map.surfaces||[]).map(s=>({...s,tuning:authored(s,s.grip<.6?'ice':'road')}));
  const pads=(map.pads||[]).map(s=>({...s,tuning:authored(s,'boost')}));
  return {segments,rects:[...pads,...zones],zones,pads,legacy:!map.roads,
    road:SURFACE_PROFILES.road,offroad:authored(map.offroad,map.offroad?.kind||'road')};
}
const contains=(r,x,z)=>Math.abs(x-r.x)<=r.hw&&Math.abs(z-r.z)<=r.hd;
export function onRoad(index,x,z) {
  if(index.legacy)return true;
  for(let i=0;i<index.rects.length;i++)if(contains(index.rects[i],x,z))return true;
  for(let i=0;i<index.segments.length;i++) {
    const s=index.segments[i],x0=x-s.x,z0=z-s.z,t=Math.max(0,Math.min(1,(x0*s.dx+z0*s.dz)*s.inv));
    if((x0-s.dx*t)**2+(z0-s.dz*t)**2<=s.r2+1e-9)return true;
  }
  return false;
}
export function surfaceTuning(index,x,z) {
  for(let i=0;i<index.pads.length;i++)if(contains(index.pads[i],x,z))return index.pads[i].tuning;
  for(let i=0;i<index.zones.length;i++)if(contains(index.zones[i],x,z))return index.zones[i].tuning;
  return onRoad(index,x,z)?index.road:index.offroad;
}

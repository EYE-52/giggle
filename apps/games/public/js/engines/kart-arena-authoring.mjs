// Shared numeric tools, with no renderer dependency. All coordinates are metres.
export const arenaYaw=a=>({x:0,y:Math.sin(a/2),z:0,w:Math.cos(a/2)});
export const arenaBox=(id,x,y,z,hx,hy,hz,material='stone',extra={})=>({id,shape:'box',position:{x,y,z},half:{x:hx,y:hy,z:hz},material,grip:1,...extra});
export const arenaDeck=(id,x,y,z,hx,hz,material='stone',extra={})=>({...arenaBox(id,x,y-.4,z,hx,.4,hz,material,extra),shape:'deck'});
export const arenaPoint=(id,surface,x,y,z,angle=0,extra={})=>({id,surface,x,y,z,angle,...extra});
export function arenaRamp(id,a,b,width,material='stone',extra={}){
 const run=Math.hypot(b.x-a.x,b.z-a.z),rise=b.y-a.y;
 if(rise<=0||run<rise*3.9)throw new RangeError('Ordinary climb must be at most 1:4');
 return {id,shape:'wedge',position:{x:(a.x+b.x)/2,y:(a.y+b.y)/2,z:(a.z+b.z)/2},half:{x:width/2,y:rise/2,z:run/2},rotation:arenaYaw(Math.atan2(b.x-a.x,b.z-a.z)),material,grip:1,...extra};
}
// Rectangle union boundary. Joined slabs never get a rail across the seam.
export function arenaBoundary(rects,{height=1.1,width=.3,y=0,prefix='guard',material='barrier'}={}){
 const xs=[...new Set(rects.flatMap(r=>[r[0],r[2]]))].sort((a,b)=>a-b),zs=[...new Set(rects.flatMap(r=>[r[1],r[3]]))].sort((a,b)=>a-b),inside=(x,z)=>rects.some(r=>x>r[0]&&x<r[2]&&z>r[1]&&z<r[3]);
 const edges=[];
 for(let i=0;i<xs.length-1;i++)for(let j=0;j<zs.length-1;j++){
  const x=(xs[i]+xs[i+1])/2,z=(zs[j]+zs[j+1])/2;if(!inside(x,z))continue;
  for(const [axis,pos,low,high,ox,oz]of [['x',xs[i],zs[j],zs[j+1],-.001,0],['x',xs[i+1],zs[j],zs[j+1],.001,0],['z',zs[j],xs[i],xs[i+1],0,-.001],['z',zs[j+1],xs[i],xs[i+1],0,.001]]){
   const tx=axis==='x'?pos:x,tz=axis==='z'?pos:z;if(!inside(tx+ox,tz+oz))edges.push({axis,pos,low,high});
  }
 }
 edges.sort((a,b)=>a.axis.localeCompare(b.axis)||a.pos-b.pos||a.low-b.low);const merged=[];
 for(const e of edges){const last=merged.at(-1);if(last&&last.axis===e.axis&&last.pos===e.pos&&last.high===e.low)last.high=e.high;else merged.push({...e});}
 return merged.map((e,i)=>arenaBox(prefix+'-'+i,e.axis==='x'?e.pos:(e.low+e.high)/2,y+height/2,e.axis==='z'?e.pos:(e.low+e.high)/2,e.axis==='x'?width/2:(e.high-e.low)/2,height/2,e.axis==='z'?width/2:(e.high-e.low)/2,material));
}
export function arenaFloor(rects,material='asphalt',prefix='floor'){
 return rects.map(([x0,z0,x1,z1],i)=>arenaBox(prefix+'-'+i,(x0+x1)/2,-.6,(z0+z1)/2,(x1-x0)/2,.6,(z1-z0)/2,material));
}
export function arenaSupport(map,x,y,z){
 let best=null;
 for(const d of map.colliders){if(d.shape!=='deck'&&d.shape!=='wedge'&&!d.id.startsWith('floor'))continue;
  const a=2*Math.atan2(d.rotation?.y||0,d.rotation?.w??1),dx=x-d.position.x,dz=z-d.position.z,lx=Math.cos(a)*dx-Math.sin(a)*dz,lz=Math.sin(a)*dx+Math.cos(a)*dz;
  if(Math.abs(lx)>d.half.x+.001||Math.abs(lz)>d.half.z+.001)continue;
  const top=d.position.y+(d.shape==='wedge'?lz*d.half.y/d.half.z:d.half.y);
  if(Math.abs(top-y)<.05&&(!best||d.id<best.id))best=d;
 }return best?.id;
}

// A solid guard follows the exact ramp slope. Its visual bars stay inside
// this envelope, so camera clearance and authority collisions agree.
export function arenaRampGuards(d,{height=1.1,width=.28}={}){
 const yaw=2*Math.atan2(d.rotation.y,d.rotation.w),pitch=-Math.atan2(d.half.y,d.half.z),sy=Math.sin(yaw/2),cy=Math.cos(yaw/2),sp=Math.sin(pitch/2),cp=Math.cos(pitch/2);
 return [-1,1].map(side=>arenaBox(d.id+'-rail-'+side,d.position.x+Math.cos(yaw)*side*(d.half.x-width/2),d.position.y+height/2,d.position.z-Math.sin(yaw)*side*(d.half.x-width/2),width/2,height/2,Math.hypot(d.half.z,d.half.y),'barrier',{rotation:{x:cy*sp,y:sy*cp,z:-sy*sp,w:cy*cp},role:'rail'}));
}
// A bounded group of ordinary guard boxes becomes one fixed collision mesh.
// This is only for rails, never terrain: each part remains available to art
// and camera queries with the exact same world transform.
export function arenaGuardGroup(id,parts){
 if(!parts.length||parts.length>16||parts.some(p=>p.shape!=='box'||p.material!=='barrier'))throw new TypeError('Guard boxes required');
 const vertices=[],indices=[];
 for(const d of parts){const base=vertices.length/3,q=d.rotation||{x:0,y:0,z:0,w:1};
  for(let i=0;i<8;i++){
   const x=(i&1?1:-1)*d.half.x,y=(i&2?1:-1)*d.half.y,z=(i&4?1:-1)*d.half.z;
   const tx=2*(q.y*z-q.z*y),ty=2*(q.z*x-q.x*z),tz=2*(q.x*y-q.y*x);
   vertices.push(d.position.x+x+q.w*tx+q.y*tz-q.z*ty,d.position.y+y+q.w*ty+q.z*tx-q.x*tz,d.position.z+z+q.w*tz+q.x*ty-q.y*tx);
  }
  for(const f of[[0,4,6,2],[1,3,7,5],[0,1,5,4],[2,6,7,3],[0,2,3,1],[4,5,7,6]])indices.push(base+f[0],base+f[1],base+f[2],base+f[0],base+f[2],base+f[3]);
 }
 return {id,shape:'trimesh',position:{x:0,y:0,z:0},half:{x:Math.max(...parts.map(d=>Math.abs(d.position.x)+d.half.x)),y:Math.max(...parts.map(d=>Math.abs(d.position.y)+d.half.y)),z:Math.max(...parts.map(d=>Math.abs(d.position.z)+d.half.z))},material:'barrier',parts,vertices:new Float32Array(vertices),indices:new Uint32Array(indices),grip:1};
}
// Variant geometry may shrink uniformly, preserving ramp grades and all
// support/proxy transforms. Quaternions, indices, angles and colours do not scale.
export function arenaScale(source,factor){
 const map=structuredClone(source);
 function visit(value){
  if(!value||typeof value!=='object')return;
  if(value instanceof Float32Array){for(let i=0;i<value.length;i++)value[i]*=factor;return;}
  if(ArrayBuffer.isView(value)||Number.isFinite(value.w))return;
  if(['x','y','z'].every(k=>Number.isFinite(value[k])))for(const k of['x','y','z'])value[k]*=factor;
  if(Number.isFinite(value.apex))value.apex*=factor;
  for(const child of Object.values(value))visit(child);
 }
 visit(map);for(const level of map.levels)level.y*=factor;map.playBounds.halfX*=factor;map.playBounds.halfZ*=factor;map.playBounds.outline=map.playBounds.outline.map(r=>r.map(n=>n*factor));
 if(map.reviewPoses)map.reviewPoses=map.reviewPoses.map(p=>p.map((n,i)=>i<3?n*factor:n));map.artScale=factor;return map;
}

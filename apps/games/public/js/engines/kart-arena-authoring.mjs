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

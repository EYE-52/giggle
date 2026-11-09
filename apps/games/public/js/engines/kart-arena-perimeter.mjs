// Exposed perimeter of joined, flat convex plates and rectangles. Sampling
// removes internal joins; collinear spans merge before exact guard creation.
import {arenaPointInPolygon} from './kart-arena-polygons.mjs';
import {arenaBox,arenaYaw} from './kart-arena-authoring.mjs';
export function arenaSurfaceGuards(map,y,{openings=[],prefix='rim'}={}){
 const polygons=map.colliders.filter(d=>(d.polygon||d.shape==='deck'||d.id.startsWith('floor'))&&Math.abs((d.surfaceY??d.position.y+d.half.y)-y)<.03).map(d=>d.polygon||[[d.position.x-d.half.x,d.position.z-d.half.z],[d.position.x+d.half.x,d.position.z-d.half.z],[d.position.x+d.half.x,d.position.z+d.half.z],[d.position.x-d.half.x,d.position.z+d.half.z]]);
 const inside=(x,z)=>polygons.some(p=>arenaPointInPolygon(p,x,z)),lines=new Map();
 for(const p of polygons)for(let i=0;i<p.length;i++){
  const a=p[i],b=p[(i+1)%p.length],dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz),n=Math.ceil(length/.25);let run=null;
  const emit=(lo,hi)=>{let ux=dx/length,uz=dz/length;if(ux<-.0001||Math.abs(ux)<.0001&&uz<0){ux=-ux;uz=-uz;}const nx=-uz,nz=ux,offset=a[0]*nx+a[1]*nz,key=[ux,uz,offset].map(v=>v.toFixed(4)).join(','),t0=(a[0]+dx*lo)*ux+(a[1]+dz*lo)*uz,t1=(a[0]+dx*hi)*ux+(a[1]+dz*hi)*uz;if(!lines.has(key))lines.set(key,{ux,uz,nx,nz,offset,spans:[]});lines.get(key).spans.push([Math.min(t0,t1),Math.max(t0,t1)]);};
  for(let j=0;j<=n;j++){const t=(j+.5)/n,x=a[0]+dx*t,z=a[1]+dz*t,exposed=j<n&&!inside(x+dz/length*.13,z-dx/length*.13);if(exposed&&run===null)run=j/n;if(!exposed&&run!==null){emit(run,j/n);run=null;}}
 }
 const guards=[];
 for(const line of lines.values()){
  const {ux,uz,nx,nz,offset}=line;line.spans.sort((a,b)=>a[0]-b[0]);let spans=[];for(const s of line.spans){const last=spans.at(-1);if(last&&s[0]<=last[1]+.02)last[1]=Math.max(last[1],s[1]);else spans.push([...s]);}
  for(const rect of openings){let lo=-Infinity,hi=Infinity;for(const [u,base,min,max]of[[ux,nx*offset,rect[0],rect[2]],[uz,nz*offset,rect[1],rect[3]]]){if(Math.abs(u)<1e-8){if(base<min||base>max){lo=1;hi=0;break;}}else {const a=(min-base)/u,b=(max-base)/u;lo=Math.max(lo,Math.min(a,b));hi=Math.min(hi,Math.max(a,b));}}if(lo>=hi)continue;spans=spans.flatMap(([a,b])=>lo>=b||hi<=a?[[a,b]]:[[a,Math.max(a,lo)],[Math.min(b,hi),b]].filter(([a,b])=>b-a>.1));}
  for(const [a,b]of spans){const t=(a+b)/2;guards.push(arenaBox(prefix+'-'+guards.length,ux*t+nx*offset,y+.55,uz*t+nz*offset,.14,.55,(b-a)/2,'barrier',{rotation:arenaYaw(Math.atan2(ux,uz))}));}
 }
 return guards;
}

// Bounded flat convex slabs only. Top, bottom and side buffers are shared by
// Rapier, visible road skins and camera proxies; no height-field terrain.
import {arenaBox,arenaYaw} from './kart-arena-authoring.mjs';
export function arenaPointInPolygon(points,x,z){
 let inside=false;for(let i=0,j=points.length-1;i<points.length;j=i++){
  const a=points[j],b=points[i],cross=(x-a[0])*(b[1]-a[1])-(z-a[1])*(b[0]-a[0]);
  if(Math.abs(cross)<1e-6&&x>=Math.min(a[0],b[0])-1e-6&&x<=Math.max(a[0],b[0])+1e-6&&z>=Math.min(a[1],b[1])-1e-6&&z<=Math.max(a[1],b[1])+1e-6)return true;
  if((a[1]>z)!==(b[1]>z)&&x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0])inside=!inside;
 }return inside;
}
export function arenaPolygonFloor(id,points,{y=0,thickness=1.2,material='asphalt'}={}){
 if(points.length<3||points.length>16||points.some(p=>p.length!==2||!p.every(Number.isFinite)))throw new TypeError('Bounded convex floor required');
 let area=0;for(let i=0;i<points.length;i++){const a=points[i],b=points[(i+1)%points.length];area+=a[0]*b[1]-b[0]*a[1];}
 const p=area<0?[...points].reverse():points.map(p=>[...p]),n=p.length;
 for(let i=0;i<n;i++){const a=p[i],b=p[(i+1)%n],c=p[(i+2)%n];if((b[0]-a[0])*(c[1]-b[1])-(b[1]-a[1])*(c[0]-b[0])<-.00001)throw new TypeError('Convex floor required');}
 const vertices=[...p.flatMap(([x,z])=>[x,y,z]),...p.flatMap(([x,z])=>[x,y-thickness,z])],indices=[];
 for(let i=1;i<n-1;i++)indices.push(0,i+1,i,n,n+i,n+i+1);
 for(let i=0;i<n;i++){const j=(i+1)%n;indices.push(i,j,n+j,i,n+j,n+i);}
 return {id,shape:'trimesh',position:{x:0,y:0,z:0},half:{x:Math.max(...p.map(p=>Math.abs(p[0]))),y:thickness/2,z:Math.max(...p.map(p=>Math.abs(p[1])))},polygon:p,surfaceY:y,vertices:new Float32Array(vertices),indices:new Uint32Array(indices),material,grip:1};
}
export function arenaPolygonGuards(points,{y=0,height=1.1,width=.28,prefix='edge'}={}){
 return points.map((a,i)=>{const b=points[(i+1)%points.length],dx=b[0]-a[0],dz=b[1]-a[1];return arenaBox(prefix+'-'+i,(a[0]+b[0])/2,y+height/2,(a[1]+b[1])/2,width/2,height/2,Math.hypot(dx,dz)/2,'barrier',{rotation:arenaYaw(Math.atan2(dx,dz))});});
}

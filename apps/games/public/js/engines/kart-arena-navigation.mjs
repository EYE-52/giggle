// Authoring/replay checks only. Uses the real authority's support and hull
// queries. Directed shortcuts are intentionally excluded from normal access.
import {arenaYaw} from './kart-arena-authoring.mjs';
export function auditArenaEdge(physics,edge,{spacing=.5}={}){
 const failures=[];let distance=0,samples=0;
 for(let i=1;i<edge.points.length;i++){
  const a=edge.points[i-1],b=edge.points[i],run=Math.hypot(b.x-a.x,b.z-a.z),angle=Math.atan2(b.x-a.x,b.z-a.z);distance+=run;
  const n=Math.ceil(run/spacing),q=arenaYaw(angle);
  for(let k=0;k<=n;k++){
   const t=k/n,p={x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,z:a.z+(b.z-a.z)*t},hit=physics.supportAt({...p,y:p.y+.4},.9);samples++;
   if(!hit||Math.abs(hit.point.y-p.y)>.15||hit.normal.y<.65)failures.push({reason:'support',...p});
   // Orient to the slope so the nose does not falsely hit a rising surface.
   const pitch=-Math.atan2(b.y-a.y,run),sin=Math.sin(pitch/2),cos=Math.cos(pitch/2),rotation={x:q.w*sin,y:q.y*cos,z:-q.y*sin,w:q.w*cos};
   if(physics.overlapsStatic({...p,y:p.y+.85},rotation,{x:1.28,y:.25,z:1.6}))failures.push({reason:'hull',...p});
  }
 }
 return {id:edge.id,kind:edge.kind||'drive',distance,samples,failures};
}
export function arenaOrdinaryConnectivity(nodes,edges,blocked=null){
 const graph=new Map(nodes.map(n=>[n,new Set()]));
 for(const e of edges)if((e.kind||'drive')==='drive'&&e.id!==blocked){graph.get(e.from)?.add(e.to);if(e.bidirectional!==false)graph.get(e.to)?.add(e.from);}
 const reached=new Set(),queue=[nodes[0]];while(queue.length){const n=queue.shift();if(reached.has(n))continue;reached.add(n);queue.push(...(graph.get(n)||[]));}
 return reached.size===nodes.length;
}

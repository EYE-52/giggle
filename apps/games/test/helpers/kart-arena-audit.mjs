import {raisedSurfaceHeight} from '../../public/js/engines/kart-raised-support.mjs';
const rotation={x:0,y:0,z:0,w:1};
// Half-metre raster of the final loaded support union, counting accessible
// surfaces once per height. Full hull margins/cover are removed. Ramps count
// their horizontal usable projection, matching the plan's road-area basis.
export function measureArenaArea(physics,map,spacing=.5){
 const surfaces=map.colliders.filter(d=>d.shape==='deck'||d.shape==='wedge'||d.id.startsWith('floor')),areas={};
 for(let x=-map.playBounds.halfX+spacing/2;x<map.playBounds.halfX;x+=spacing)for(let z=-map.playBounds.halfZ+spacing/2;z<map.playBounds.halfZ;z+=spacing){
  const heights=[...new Set(surfaces.map(d=>raisedSurfaceHeight(d,x,z)).filter(Number.isFinite))];
  for(const y of heights){const support=physics.supportAt({x,y:y+.4,z},.8);
   if(!support||Math.abs(support.point.y-y)>.04||physics.overlapsStatic({x,y:y+.85,z},rotation,{x:1.22,y:.3,z:1.55}))continue;
   const level=map.levels.find(l=>Math.abs(l.y-y)<.01)?.id||'ramps';areas[level]=(areas[level]||0)+spacing**2;
  }
 }
 return {spacing,areas,total:Object.values(areas).reduce((a,b)=>a+b,0)};
}
export function arenaClearanceGraph(physics,map,spacing=1,{turnMargin=0,supportMargin=0}={}){
 const surfaces=map.colliders.filter(d=>d.shape==='deck'||d.shape==='wedge'||d.id.startsWith('floor'));
 const nodes=[],columns=new Map(),max=Math.max(...map.levels.map(l=>l.y)),clear=p=>{
  if(physics.overlapsStatic({...p,y:p.y+.9},rotation,{x:1.3+turnMargin,y:.3,z:1.6+turnMargin}))return false;
  // Test-driver routes must support the whole turning vehicle at open drops,
  // not just its centre ray. Ordinary topology audits retain their old mask.
  if(supportMargin)for(let i=0;i<8;i++){
   const a=i*Math.PI/4,s=physics.supportAt({x:p.x+Math.cos(a)*supportMargin,y:p.y+1,z:p.z+Math.sin(a)*supportMargin},1.8);
   if(!s||s.normal.y<.65||Math.abs(s.point.y-p.y)>.8)return false;
  }
  return true;
 };
 const extentX=Math.floor(map.playBounds.halfX/spacing)*spacing,extentZ=Math.floor(map.playBounds.halfZ/spacing)*spacing;
 for(let x=-extentX;x<=extentX;x+=spacing)for(let z=-extentZ;z<=extentZ;z+=spacing){const column=[];
  for(const y of new Set(surfaces.map(d=>raisedSurfaceHeight(d,x,z)).filter(Number.isFinite))){const s=physics.supportAt({x,y:y+.4,z},.9);if(!s||s.normal.y<.65||s.point.y<-.02||s.point.y>max+.1||column.some(p=>Math.abs(p.y-s.point.y)<.1)||!clear(s.point))continue;
   const n={x,y:s.point.y,z,surface:s.surfaceId,index:nodes.length,edges:[]};column.push(n);nodes.push(n);
  }columns.set(x+':'+z,column);
 }
 for(const n of nodes)for(const[dx,dz]of[[spacing,0],[0,spacing],[spacing,spacing],[-spacing,spacing]])for(const next of columns.get((n.x+dx)+':'+(n.z+dz))||[]){
  if(Math.abs(next.y-n.y)>spacing*.3)continue;
  const p={x:(n.x+next.x)/2,y:(n.y+next.y)/2,z:(n.z+next.z)/2},s=physics.supportAt({...p,y:p.y+.4},.9);if(!s||Math.abs(s.point.y-p.y)>.15||!clear(p))continue;
  n.edges.push(next.index);next.edges.push(n.index);
 }
 const nearest=p=>{let best=null;const x=Math.round(p.x/spacing)*spacing,z=Math.round(p.z/spacing)*spacing;
  for(let dx=-spacing;dx<=spacing;dx+=spacing)for(let dz=-spacing;dz<=spacing;dz+=spacing)for(const n of columns.get((x+dx)+':'+(z+dz))||[]){const distance=Math.hypot(n.x-p.x,n.z-p.z);if(Math.abs(n.y-p.y)<.3&&distance<(best?.distance??Infinity))best={n,distance};}return best;
 };
 function flood(start,blocked){const parents=new Map([[start,-1]]),queue=[start];for(let k=0;k<queue.length;k++)for(const i of nodes[queue[k]].edges)if(!parents.has(i)&&!(typeof blocked==='function'?blocked(nodes[i]):blocked instanceof Set?blocked.has(nodes[i].surface):nodes[i].surface===blocked)){parents.set(i,queue[k]);queue.push(i);}return parents;}
 const boundary=nodes.filter(n=>n.edges.length<8);for(const n of nodes)n.clearance=Infinity;for(const n of boundary)n.clearance=0;
 for(let i=0;i<boundary.length;i++){const n=boundary[i];for(const j of n.edges)if(nodes[j].clearance>n.clearance+spacing){nodes[j].clearance=n.clearance+spacing;boundary.push(nodes[j]);}}
 function shortest(start,blocked,comfort=false){
  const distance=new Float64Array(nodes.length).fill(Infinity),parents=new Int32Array(nodes.length).fill(-1),heap=[];
  const push=(i,d)=>{let k=heap.length;heap.push({i,d});while(k){const p=(k-1)>>1;if(heap[p].d<=d)break;heap[k]=heap[p];k=p;}heap[k]={i,d};};
  const pop=()=>{const first=heap[0],last=heap.pop();if(heap.length){let k=0;while(k*2+1<heap.length){let c=k*2+1;if(c+1<heap.length&&heap[c+1].d<heap[c].d)c++;if(heap[c].d>=last.d)break;heap[k]=heap[c];k=c;}heap[k]=last;}return first;};
  distance[start]=0;push(start,0);
  while(heap.length){const {i,d}=pop();if(distance[i]!==d)continue;const n=nodes[i];for(const j of n.edges){if(typeof blocked==='function'?blocked(nodes[j]):blocked instanceof Set?blocked.has(nodes[j].surface):nodes[j].surface===blocked)continue;const next=nodes[j],value=d+Math.hypot(n.x-next.x,n.y-next.y,n.z-next.z)*(comfort?1+4/(1+next.clearance):1);if(value<distance[j]){distance[j]=value;parents[j]=i;push(j,value);}}}
  return {distance,parents,path(target){const path=[];if(!Number.isFinite(distance[target]))return path;for(let i=target;i!==-1;i=parents[i])path.push(nodes[i]);return path.reverse();}};
 }
 return {nodes,nearest,flood,shortest};
}

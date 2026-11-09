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
export function arenaClearanceGraph(physics,map,spacing=1){
 const nodes=[],columns=new Map(),max=Math.max(...map.levels.map(l=>l.y)),clear=p=>!physics.overlapsStatic({...p,y:p.y+.9},rotation,{x:1.3,y:.3,z:1.6});
 const extentX=Math.floor(map.playBounds.halfX/spacing)*spacing,extentZ=Math.floor(map.playBounds.halfZ/spacing)*spacing;
 for(let x=-extentX;x<=extentX;x+=spacing)for(let z=-extentZ;z<=extentZ;z+=spacing){const column=[];
  for(let y=0;y<=max+1;y+=.5){const s=physics.supportAt({x,y:y+.4,z},.9);if(!s||s.normal.y<.65||s.point.y<-.02||s.point.y>max+.1||column.some(p=>Math.abs(p.y-s.point.y)<.1)||!clear(s.point))continue;
   const n={x,y:s.point.y,z,surface:s.surfaceId,index:nodes.length,edges:[]};column.push(n);nodes.push(n);
  }columns.set(x+':'+z,column);
 }
 for(const n of nodes)for(const[dx,dz]of[[spacing,0],[0,spacing],[spacing,spacing],[-spacing,spacing]])for(const next of columns.get((n.x+dx)+':'+(n.z+dz))||[]){
  if(Math.abs(next.y-n.y)>spacing*.3)continue;
  const p={x:(n.x+next.x)/2,y:(n.y+next.y)/2,z:(n.z+next.z)/2},s=physics.supportAt({...p,y:p.y+.4},.9);if(!s||Math.abs(s.point.y-p.y)>.15||!clear(p))continue;
  n.edges.push(next.index);next.edges.push(n.index);
 }
 const nearest=p=>nodes.reduce((best,n)=>Math.abs(n.y-p.y)<.3&&Math.hypot(n.x-p.x,n.z-p.z)<(best?.distance??Infinity)?{n,distance:Math.hypot(n.x-p.x,n.z-p.z)}:best,null);
 function flood(start,blocked){const parents=new Map([[start,-1]]),queue=[start];for(let k=0;k<queue.length;k++)for(const i of nodes[queue[k]].edges)if(!parents.has(i)&&nodes[i].surface!==blocked){parents.set(i,queue[k]);queue.push(i);}return parents;}
 return {nodes,nearest,flood};
}

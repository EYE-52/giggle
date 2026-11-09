import {arenaBox as box,arenaDeck,arenaFloor,arenaBoundary,arenaRampGuards,arenaGuardGroup} from './kart-arena-authoring.mjs';
export const arenaP=(x,y,z)=>({x,y,z});
export function arenaBase({id,name,artId,backdrop=artId,heights,rects,minPlayers,maxPlayers,half}){
 return {id,name,artId,backdrop,environment:artId,revision:id+'-1',arenaVersion:1,half,minPlayers,maxPlayers,levels:heights.map((y,i)=>({id:'L'+i,y,name:['Lower loop','Raised loop','Lookout'][i],color:[0x7eafac,0xffd17a,0x7fc8bd][i]})),playBounds:{halfX:Math.max(...rects.flatMap(r=>[Math.abs(r[0]),Math.abs(r[2])])),halfZ:Math.max(...rects.flatMap(r=>[Math.abs(r[1]),Math.abs(r[3])])),outline:rects},colliders:[...arenaFloor(rects),...arenaBoundary(rects)],routes:[],spawns:[],spawnCandidates:[],sockets:[],drops:[],landmarks:[],features:{cannons:[],portals:[],falls:[]},fallZones:[],belts:[]};
}
function openGuards(guards,openings){
 return guards.flatMap(d=>{const axis=d.half.x>d.half.z?'x':'z',other=axis==='x'?'z':'x',pos=d.position[other];let spans=[[d.position[axis]-d.half[axis],d.position[axis]+d.half[axis]]];
  for(const r of openings){const lo=axis==='x'?r[0]:r[1],hi=axis==='x'?r[2]:r[3],near=axis==='x'?r[1]:r[0],far=axis==='x'?r[3]:r[2];if(pos<near-.01||pos>far+.01)continue;spans=spans.flatMap(([a,b])=>lo>=b||hi<=a?[[a,b]]:[[a,Math.max(a,lo)],[Math.min(b,hi),b]].filter(([x,y])=>y-x>.1));}
  return spans.map(([a,b],i)=>({...d,id:d.id+'-'+i,position:{...d.position,[axis]:(a+b)/2},half:{...d.half,[axis]:(b-a)/2}}));
 });
}
export function arenaLevel(map,id,y,rects,{openings=[],material='deck'}={}){
 for(const [i,[x0,z0,x1,z1]]of rects.entries())map.colliders.push(arenaDeck(id+'-'+i,(x0+x1)/2,y,(z0+z1)/2,(x1-x0)/2,(z1-z0)/2,material));
 map.colliders.push(...openGuards(arenaBoundary(rects,{y,prefix:id+'-rail',height:1.1,width:.28}),openings));
}
export function arenaAddRamp(map,d,points,from,to){map.colliders.push(d,...arenaRampGuards(d));map.routes.push({id:d.id,from,to,kind:'drive',bidirectional:true,points});}
export function arenaFinish(map){
 const guards=map.colliders.filter(d=>d.material==='barrier').flatMap(d=>d.parts||[d]);map.colliders=map.colliders.filter(d=>d.material!=='barrier');
 for(let i=0;i<guards.length;i+=16)map.colliders.push(arenaGuardGroup('guard-batch-'+i/16,guards.slice(i,i+16)));return map;
}
export function arenaWithVariants(builds,poses){
 const base=structuredClone(builds.at(-1).geometry);base.variants=builds.map(b=>{const p=poses[b.id]||{};return {id:b.id,minPlayers:b.min,maxPlayers:b.max,usableArea:p.usableArea||1,floorWeights:b.weights,districts:['core',...new Set([...(p.sockets||[]),...(p.spawnCandidates||[])].map(s=>s.district))],startIds:(p.spawns||[]).map(s=>s.id),layout:{...b.geometry,...p,sockets:arenaProfileHomes(b.geometry,p.sockets||[])}};});Object.assign(base,poses.full||{});base.sockets=arenaProfileHomes(base,base.sockets);return base;
}
export function arenaArc(cx,y,cz,r,a,b,n=8){return Array.from({length:n},(_,i)=>{const t=a+(b-a)*(i+1)/n;return arenaP(cx+r*Math.cos(t),y,cz+r*Math.sin(t));});}
export function arenaRectangleLoop(hx,hz,y,r=6){
 return [arenaP(-hx,y,0),arenaP(-hx,y,-hz+r),...arenaArc(-hx+r,y,-hz+r,r,Math.PI,Math.PI*1.5),arenaP(hx-r,y,-hz),...arenaArc(hx-r,y,-hz+r,r,Math.PI*1.5,Math.PI*2),arenaP(hx,y,hz-r),...arenaArc(hx-r,y,hz-r,r,0,Math.PI/2),arenaP(-hx+r,y,hz),...arenaArc(-hx+r,y,hz-r,r,Math.PI/2,Math.PI),arenaP(-hx,y,0)];
}
export function arenaOpenRails(map,openings){map.colliders=map.colliders.flatMap(d=>d.material==='barrier'?openGuards([d],openings):[d]);}

export function arenaProfileHomes(map,homes){
 const materials=new Map(map.colliders.map(d=>[d.id,d.material])),rows=homes.map(h=>({...h,profile:'safe'}));
 const exposed=[...rows].sort((a,b)=>((materials.get(b.surface)==='ice'?1000:0)+b.y*2+50-Math.hypot(b.x,b.z))-((materials.get(a.surface)==='ice'?1000:0)+a.y*2+50-Math.hypot(a.x,a.z)));
 for(const h of exposed.slice(0,Math.floor(rows.length*.3)))h.profile='exposed';
 let risks=0;for(const p of map.riskHomes||[]){const nearest=rows.filter(h=>h.y===p.y&&h.profile!=='risk').sort((a,b)=>Math.hypot(a.x-p.x,a.z-p.z)-Math.hypot(b.x-p.x,b.z-p.z))[0];if(nearest&&Math.hypot(nearest.x-p.x,nearest.z-p.z)<=8&&risks<Math.floor(rows.length*.1)){nearest.profile='risk';risks++;}}
 return rows;
}

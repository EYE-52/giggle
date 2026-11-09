import {arenaBox as box,arenaDeck,arenaRamp as ramp,arenaScale} from './kart-arena-authoring.mjs';
import {arenaPolygonFloor} from './kart-arena-polygons.mjs';
import {arenaSurfaceGuards} from './kart-arena-perimeter.mjs';
import {arenaBase,arenaP as P,arenaAddRamp,arenaFinish,arenaWithVariants,arenaArc} from './kart-launch-support.mjs';
import {foundryPoses} from './kart-foundry-poses.mjs';
const oct=(rx,rz)=>{const q=Math.SQRT2-1,a=rx*q,b=rz*q;return [[-a,-rz],[a,-rz],[rx,-b],[rx,b],[a,rz],[-a,rz],[-rx,b],[-rx,-b]];};
function ring(map,level,y,outer,inner){const a=oct(...outer),b=oct(...inner);for(let i=0;i<8;i++)map.colliders.push(arenaPolygonFloor('floor-'+level+'-'+i,[a[i],a[(i+1)%8],b[(i+1)%8],b[i]],{y,thickness:y?.8:1.2,material:y?'steel':'asphalt'}));}
function rounded(points,y,trim=6){const out=[];for(let i=0;i<points.length;i++){const a=points[(i+points.length-1)%points.length],b=points[i],c=points[(i+1)%points.length],l=Math.hypot(a[0]-b[0],a[1]-b[1]),r=Math.hypot(c[0]-b[0],c[1]-b[1]),u=[b[0]+(a[0]-b[0])*trim/l,b[1]+(a[1]-b[1])*trim/l],v=[b[0]+(c[0]-b[0])*trim/r,b[1]+(c[1]-b[1])*trim/r];out.push(P(u[0],y,u[1]));for(let k=1;k<=8;k++){const t=k/8;out.push(P((1-t)**2*u[0]+2*t*(1-t)*b[0]+t*t*v[0],y,(1-t)**2*u[1]+2*t*(1-t)*b[1]+t*t*v[1]));}}out.push({...out[0]});return out;}
export function foundryGeometry(scale=1){
 const m=arenaBase({id:'foundry-wheel',name:'Foundry Wheel',artId:'foundry',backdrop:'quarry',heights:[0,8,16],rects:[[-68,-64,68,64]],minPlayers:8,maxPlayers:32,half:74});m.colliders=[];m.authorDiagonalStarts=true;m.playBounds.outline=oct(68,64);m.playBounds.outlineKind='polygon';m.levels[1].color=0xc9b18c;m.levels[2].color=0xe2c36e;
 ring(m,'L0',0,[68,64],[44,40]);ring(m,'L1',8,[54,50],[30,26]);ring(m,'L2',16,[42,40],[26,24]);
 for(const tier of[1,2])for(const side of[-1,1]){const x=side*(tier===1?60:46),lowZ=-side*16,highZ=side*16,y=(tier-1)*8,top=tier*8;
  const x0=side<0?x-6:tier===1?38:24,x1=side<0?(tier===1?-38:-24):x+6,z0=side<0?-32:16,z1=side<0?-16:32;
  m.colliders.push(arenaDeck('landing-'+tier+'-'+side,(x0+x1)/2,top,(z0+z1)/2,(x1-x0)/2,(z1-z0)/2,'steel'));
  const endX=side*(tier===1?40:28),turnZ=side*26;
  const points=side<0?[P(x,y,lowZ+4),P(x,y,lowZ),P(x,top,highZ),P(x,top,-20),...arenaArc(x+6,top,-20,6,Math.PI,Math.PI*1.5),P(endX,top,turnZ)]:[P(x,y,lowZ-4),P(x,y,lowZ),P(x,top,highZ),P(x,top,20),...arenaArc(x-6,top,20,6,0,Math.PI/2),P(endX,top,turnZ)];
  arenaAddRamp(m,ramp('service-'+tier+'-'+side,P(x,y,lowZ),P(x,top,highZ),12,'steel'),points,'L'+(tier-1),'L'+tier);
 }
 for(const [i,y,rx,rz]of[[0,0,50,52],[1,8,36,38],[2,16,34,32]])m.routes.push({id:'ring-'+i,from:'L'+i,to:'L'+i,kind:'drive',bidirectional:true,points:rounded(oct(rx,rz),y)});
 // Make a single perimeter per height, including the landing/sector unions.
 for(const y of[0,8,16]){const openings=y===8?[[-66.1,-16.2,-53.9,-15.8],[53.9,15.8,66.1,16.2],[-3,49.8,3,50.2]]:y===16?[[-52.1,-16.2,-39.9,-15.8],[39.9,15.8,52.1,16.2],[-3,-40.2,3,-39.8]]:[];m.colliders.push(...arenaSurfaceGuards(m,y,{prefix:'rim-'+y,openings}));}
 // Furnace is sealed by the inner ring rails. Its art fits this core envelope.
 m.colliders.push(box('furnace-core',0,9,0,14,9,14,'furnace',{role:'furnace-core'}));
 for(const side of[-1,1]){const z=side*52;m.colliders.push(box('service-roof-'+side,0,7.2,z,9,.4,4,'steel',{role:'tunnel'}));for(const x of[-8,8])for(const dz of[-5.6,5.6])m.colliders.push(box('tunnel-pier-'+side+'-'+x+'-'+(dz<0?'a':'b'),x,3.4,z+dz,.45,3.4,.45,'pillar',{role:'pillar'}));}
 for(const [i,x,z]of[[0,-44,-44],[1,44,44]])m.colliders.push(box('tank-'+i,x,2.2,z,2.1,2.2,2.1,'tank'));
 // Belts are height-isolated surface math, with fixed bounded trigger areas.
 m.belts=[{id:'ore-belt',surface:'floor-L0-2',x:48,y:0,z:0,halfX:3,halfZ:10,velocity:{x:0,z:6}},{id:'return-belt',surface:'floor-L0-6',x:-48,y:0,z:0,halfX:3,halfZ:10,velocity:{x:0,z:-6}},{id:'sorter-belt',surface:'floor-L2-0',x:0,y:16,z:-32,halfX:8,halfZ:3,velocity:{x:5,z:0}}];
 m.features.cannons=[{x:24,y:0,z:-58,angle:Math.atan2(-10,26),surface:'floor-L0-0',land:{x:14,y:16,z:-32,surface:'floor-L2-0'},apex:19,flight:1.8}];
 m.features.portals=[[{x:-14,y:0,z:58,angle:Math.PI/2,surface:'floor-L0-4'},{x:0,y:8,z:44,angle:Math.PI/2,surface:'floor-L1-4'}]];
 m.drops=[{id:'gantry-drop',from:P(0,16,-40),to:P(0,8,-45)},{id:'service-drop',from:P(0,8,50),to:P(0,0,56)}];m.riskHomes=[P(12,16,-32),P(-12,8,42)];m.landmarks=[{id:'A',symbol:'A',x:-60,y:0,z:19},{id:'B',symbol:'B',x:0,y:8,z:-42},{id:'P',symbol:'P',x:0,y:16,z:32}];m.reviewPoses=[[0,0,-56,Math.PI/2],[0,8,-42,Math.PI/2],[0,16,32,Math.PI/2]];
 const result=arenaFinish(m);return scale===1?result:arenaScale(result,scale);
}
export function foundryBuilds(){return [['compact',8,8,.85,[20,12,12],[4,2,2],[14,7,7]],['medium',9,16,.9,[24,14,18],[8,4,4],[18,10,10]],['wide',17,24,.95,[28,16,20],[12,6,6],[19,13,11]],['full',25,32,1,[28,16,20],[16,8,8],[20,16,12]]].map(([id,min,max,scale,homes,starts,weights])=>({id,min,max,geometry:foundryGeometry(scale),homes,starts,weights}));}
export function foundryWheel(){return arenaWithVariants(foundryBuilds(),foundryPoses);}

import {arenaBox as box,arenaRamp as ramp} from './kart-arena-authoring.mjs';
import {arenaPolygonFloor,arenaPolygonGuards} from './kart-arena-polygons.mjs';
import {arenaBase,arenaP as P,arenaLevel,arenaAddRamp,arenaFinish,arenaWithVariants,arenaArc,arenaRectangleLoop} from './kart-launch-support.mjs';
import {neonPoses} from './kart-neon-poses.mjs';
export function neonGeometry(size='full'){
 const small=size==='small',medium=size==='medium',hx=small?44:medium?54:60,hz=small?34:medium?38:42,corner=small?30:medium?38:44,rx=small?28:medium?36:44,rz=small?18:medium?22:24,rampZ=rz+8;
 const polygon=[[-corner,-hz],[corner,-hz],[hx,0],[corner,hz],[-corner,hz],[-hx,0]];
 const m=arenaBase({id:'neon-switchyard',name:'Neon Switchyard',artId:'neon',heights:[0,7],rects:[[-hx,-hz,hx,hz]],minPlayers:6,maxPlayers:24,half:64});
 m.colliders=[arenaPolygonFloor('floor-hexagon',polygon),...arenaPolygonGuards(polygon)];m.playBounds.outline=polygon;m.playBounds.outlineKind='polygon';m.levels[0].color=0x6686ad;m.levels[1].color=0xa7d0e4;
 const upper=[[-rx,-rz,rx,-rz+12],[-rx,rz-12,rx,rz],[-rx,-rz+12,-rx+12,rz-12],[rx-12,-rz+12,rx,rz-12],[2,-rampZ-6,18,-rampZ+10],[-18,rampZ-10,-2,rampZ+6]];
 arenaLevel(m,'sign-loop',7,upper,{openings:[[1.8,-rampZ-6.1,2.2,-rampZ+6.1],[-2.2,rampZ-6.1,-1.8,rampZ+6.1],[-rx-.3,-3,-rx+.3,3],[rx-.3,-3,rx+.3,3]]});
 const north=[P(-29,0,-rampZ),P(-26,0,-rampZ),P(2,7,-rampZ),...arenaArc(2,7,-rampZ+6,6,-Math.PI/2,0),P(8,7,-rz+6)];
 const south=north.map(p=>P(-p.x,p.y,-p.z));arenaAddRamp(m,ramp('north-climb',P(-26,0,-rampZ),P(2,7,-rampZ),12,'steel'),north,'L0','L1');arenaAddRamp(m,ramp('south-climb',P(26,0,rampZ),P(-2,7,rampZ),12,'steel'),south,'L0','L1');
 m.routes.push({id:'sign-loop',from:'L1',to:'L1',kind:'drive',bidirectional:true,points:arenaRectangleLoop(rx-6,rz-6,7,5)});
 for(const [i,x,z]of[[0,-18,-5],[1,18,5],[2,-3,10],[3,3,-10]])m.colliders.push(box('market-'+i,x,1.4,z,4,1.4,2.5,i%2?'market-pink':'market-cyan'));
 for(const side of[-1,1])m.colliders.push(box('sign-cover-'+side,side*rx/3,8.2,side*(rz-1.2),3,1.2,1,side<0?'market-cyan':'market-pink'));
 for(const sx of[-1,1])for(const sz of[-1,1])m.colliders.push(box('sign-pier-'+sx+'-'+sz,sx*(rx-1),3.1,sz*(rz-1),.6,3.1,.6,'pillar',{role:'pillar'}));
 m.landmarks=[{id:'cyan',symbol:'A',x:-rx+14,y:7,z:-rz+6},{id:'pink',symbol:'B',x:rx-14,y:7,z:rz-6}];m.reviewPoses=[[-12,0,0,Math.PI/2],[0,7,-rz+6,Math.PI/2]];
 m.drops=[{id:'west-sign-drop',from:P(-rx,7,0),to:P(-rx-7,0,0)},{id:'east-sign-drop',from:P(rx,7,0),to:P(rx+7,0,0)}];
 return arenaFinish(m);
}
export function neonBuilds(){return [{id:'small',min:6,max:8,geometry:neonGeometry('small'),homes:[18,14],starts:[6,2],weights:[12,6]},{id:'medium',min:9,max:16,geometry:neonGeometry('medium'),homes:[24,24],starts:[12,4],weights:[16,12]},{id:'full',min:17,max:24,geometry:neonGeometry(),homes:[24,24],starts:[16,8],weights:[20,18]}];}
export function neonSwitchyard(){return arenaWithVariants(neonBuilds(),neonPoses);}

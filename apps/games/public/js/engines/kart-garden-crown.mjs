import {arenaBox as box,arenaRamp as ramp} from './kart-arena-authoring.mjs';
import {arenaBase,arenaP as P,arenaLevel,arenaAddRamp,arenaFinish,arenaWithVariants,arenaArc,arenaRectangleLoop} from './kart-launch-support.mjs';
import {gardenPoses} from './kart-garden-poses.mjs';
export function gardenGeometry(small=false){
 const rx=small?22:28,rz=small?18:24,x=rx+10,low=rz+8,high=low-28;
 const rects=small?[[-44,-16,44,16],[-16,-38,16,38],[-44,-16,-26,32],[26,-32,44,16]]:[[-50,-16,50,16],[-16,-48,16,48],[-44,-32,-16,32],[16,-32,44,32],[-44,24,-20,44],[20,-44,44,-24]];
 const m=arenaBase({id:'garden-crown',name:'Garden Crown',artId:'garden',heights:[0,7],rects,minPlayers:4,maxPlayers:16,half:54});
 const crown=[[-rx,-rz,rx,-rz+12],[-rx,rz-12,rx,rz],[-rx,-rz+12,-rx+12,rz-12],[rx-12,-rz+12,rx,rz-12],[-x-6,high-16,-x+18,high],[x-18,-high,x+6,-high+16]];
 arenaLevel(m,'crown',7,crown,{openings:[[-x-6.1,high-.2,-x+6.1,high+.2],[x-6.1,-high-.2,x+6.1,-high+.2],[-4,rz-.3,4,rz+.3]]});
 const west=[P(-x,0,low+3),P(-x,0,low),P(-x,7,high),P(-x,7,high-6),...arenaArc(-x+6,7,high-6,6,Math.PI,Math.PI*1.5),P(-rx+6,7,high-12)];
 const east=west.map(p=>P(-p.x,p.y,-p.z));arenaAddRamp(m,ramp('west-climb',P(-x,0,low),P(-x,7,high),12,'garden-deck'),west,'L0','L1');arenaAddRamp(m,ramp('east-climb',P(x,0,-low),P(x,7,-high),12,'garden-deck'),east,'L0','L1');
 m.routes.push({id:'crown-loop',from:'L1',to:'L1',kind:'drive',bidirectional:true,points:arenaRectangleLoop(rx-6,rz-6,7,5)});
 m.colliders.push(box('fountain',0,1.2,0,5,1.2,5,'fountain'),box('fountain-crown',0,3.5,0,.85,1.1,.85,'fountain-core',{role:'fountain-core'}));
 if(!small)for(const side of[-1,1])m.colliders.push(box('hedge-'+side,side*34,1.1,side*22,3.5,1.1,2,'hedge'));
 for(const sx of[-1,1])for(const sz of[-1,1])m.colliders.push(box('crown-pier-'+sx+'-'+sz,sx*(rx-1),3.1,sz*(rz-1),.6,3.1,.6,'pillar',{role:'pillar'}));
 m.drops=[{id:'crown-drop',from:P(0,7,rz),to:P(0,0,rz+8)}];m.landmarks=[{id:'fountain',symbol:'A',x:0,y:0,z:12},{id:'crown',symbol:'B',x:0,y:7,z:-rz+6}];
 m.reviewPoses=[[0,0,24,Math.PI],[0,7,-rz+6,Math.PI/2]];
 return arenaFinish(m);
}
export function gardenBuilds(){return [{id:'small',min:4,max:8,geometry:gardenGeometry(true),homes:[18,10],starts:[6,2],weights:[12,6]},{id:'full',min:9,max:16,geometry:gardenGeometry(),homes:[24,16],starts:[12,4],weights:[18,10]}];}
export function gardenCrown(){return arenaWithVariants(gardenBuilds(),gardenPoses);}

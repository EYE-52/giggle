import {arenaBox as box,arenaRamp as ramp} from './kart-arena-authoring.mjs';
import {arenaBase,arenaP as P,arenaLevel,arenaAddRamp,arenaFinish,arenaWithVariants,arenaArc} from './kart-launch-support.mjs';
import {harborPoses} from './kart-harbor-poses.mjs';
export function harborGeometry(size='full'){
 const compact=size==='compact'||size==='medium',wide=size==='wide',c=compact?36:wide?42:46,w=compact?24:wide?30:36,hx=c+w/2,front=compact?-36:wide?-44:-56,rear=compact?24:wide?28:32,end=compact?50:wide?54:58,low=compact?-32:wide?-40:-48,high=low+28,rx=c+16;
 const rects=[[-hx,front,-c+w/2,rear],[-w/2,front,w/2,rear],[c-w/2,front,hx,rear],[-hx,rear,hx,end]];
 const m=arenaBase({id:'harbor-fork',name:'Harbor Fork',artId:'harbor',heights:[0,7,14],rects,minPlayers:8,maxPlayers:32,half:70});m.playBounds.halfX=Math.max(hx,rx);m.levels[1].color=0xc2dcda;m.levels[2].color=0xf3ce9a;
 const mid=[[-rx,high,rx,high+12],[-rx,20,rx,32],[-rx,high+12,-c+16,20],[c-16,high+12,rx,20],[-10,high+12,10,20]];
 const lowerOpen=[[-c-6.1,high-.2,-c+6.1,high+.2],[c-6.1,high-.2,c+6.1,high+.2],[-3,high-.2,3,high+.2]];
 arenaLevel(m,'crossdock',7,mid,{openings:lowerOpen});
 for(const side of[-1,1]){const x=side*c;arenaAddRamp(m,ramp('dock-climb-'+side,P(x,0,low),P(x,7,high),12,'steel'),[P(x,0,low-2),P(x,0,low),P(x,7,high),...arenaArc(x-side*6,7,high,6,side<0?Math.PI:0,Math.PI/2),P(0,7,high+6)],'L0','L1');}
 const upperLow=Math.max(2,high+16),upperHigh=upperLow+28,topZ=upperHigh+8,topEnd=Math.max(end-2,topZ+12),upper=[[-rx,topZ,rx,topEnd],[-c-6,upperHigh,-c+6,topZ+4],[c-6,upperHigh,c+6,topZ+4]];
 m.playBounds.halfZ=Math.max(end,topEnd);arenaLevel(m,'lookout',14,upper,{openings:[[-c-6.1,upperHigh-.2,-c+6.1,upperHigh+.2],[c-6.1,upperHigh-.2,c+6.1,upperHigh+.2],[-3,topZ-.2,3,topZ+.2]]});
 for(const side of[-1,1]){const x=side*c;arenaAddRamp(m,ramp('lookout-climb-'+side,P(x,7,upperLow),P(x,14,upperHigh),12,'steel'),[P(x,7,upperLow-4),P(x,7,upperLow),P(x,14,upperHigh),P(x,14,topZ),...arenaArc(x-side*6,14,topZ,6,side<0?Math.PI:0,Math.PI/2),P(0,14,topZ+6)],'L1','L2');}
 // Continuous cross-dock and lookout circuits, with wide bays at the forks.
 const north=high+6,south=26,left=-c+11,right=c-11,r=5;
 m.routes.push({id:'dock-loop',from:'L1',to:'L1',kind:'drive',bidirectional:true,points:[P(left,7,north+r),...arenaArc(left+r,7,north+r,r,Math.PI,Math.PI*1.5),P(right-r,7,north),...arenaArc(right-r,7,north+r,r,-Math.PI/2,0),P(right,7,south-r),...arenaArc(right-r,7,south-r,r,0,Math.PI/2),P(left+r,7,south),...arenaArc(left+r,7,south-r,r,Math.PI/2,Math.PI),P(left,7,north+r)]});
 // Top is a long shared lookout, with a safe reverse/turn bay at both ends.
 m.routes.push({id:'lookout-crossing',from:'L2',to:'L2',kind:'drive',bidirectional:true,points:[P(-c+6,14,topZ+6),P(c-6,14,topZ+6)]});
 for(const [i,x,z]of[[0,-8,front+10],[1,8,front+28],[2,-c+10,rear+10],[3,c-10,rear+10]])m.colliders.push(box('cargo-'+i,x,1.7,z,3,1.7,2,'cargo'));
 for(const side of[-1,1]){m.colliders.push(box('dock-cargo-'+side,side*18,8.4,high+10,3,1.4,1.4,'cargo'));m.colliders.push(box('lookout-cover-'+side,side*18,15.3,topEnd-2,3,1.3,1.4,'cargo'));}
 for(const x of[-c,c])for(const z of[high+3,29])m.colliders.push(box('dock-pier-'+x+'-'+z,x,3.1,z,.7,3.1,.7,'pillar',{role:'pillar'}));
 for(const x of[-c,c])m.colliders.push(box('lookout-pier-'+x,x,10.1,topZ+3,.65,3.1,.65,'pillar',{role:'pillar'}));
 m.features.cannons=[{id:'west-crane',x:-c+7,y:0,z:low+7,angle:Math.atan2(c-7,27),surface:'floor-0',land:{x:0,y:7,z:high+6,surface:'crossdock-0'},apex:17,flight:1.7}];
 m.drops=[{id:'dock-drop',from:P(0,7,high),to:P(0,0,high-9)},{id:'lookout-drop',from:P(0,14,topZ),to:compact?P(0,0,topZ-10):P(0,7,26)}];
 m.landmarks=[{id:'A',symbol:'A',x:-c+7,y:7,z:high+6},{id:'B',symbol:'B',x:c-7,y:7,z:26},{id:'P',symbol:'P',x:0,y:14,z:topZ+6}];m.reviewPoses=[[0,0,front+18,0],[0,7,high+6,Math.PI/2],[0,14,topZ+6,Math.PI/2]];
 return arenaFinish(m);
}
export function harborBuilds(){return [{id:'compact',min:8,max:8,geometry:harborGeometry('compact'),homes:[20,12,8],starts:[4,2,2],weights:[13,8,4]},{id:'medium',min:9,max:16,geometry:harborGeometry('medium'),homes:[24,16,8],starts:[8,4,4],weights:[16,10,8]},{id:'wide',min:17,max:24,geometry:harborGeometry('wide'),homes:[32,20,12],starts:[12,6,6],weights:[22,14,12]},{id:'full',min:25,max:32,geometry:harborGeometry(),homes:[32,20,12],starts:[16,8,8],weights:[22,14,12]}];}
export function harborFork(){return arenaWithVariants(harborBuilds(),harborPoses);}

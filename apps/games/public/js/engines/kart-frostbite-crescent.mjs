import {arenaBox as box,arenaRamp as ramp} from './kart-arena-authoring.mjs';
import {arenaBase,arenaP as P,arenaLevel,arenaAddRamp,arenaFinish,arenaWithVariants,arenaArc,arenaRectangleLoop,arenaOpenRails} from './kart-launch-support.mjs';
import {frostPoses} from './kart-frostbite-poses.mjs';
export function frostGeometry(small=false){
 const east=small?44:52,north=44;
 const rects=[[-44,-north,28,-36],[-44,-36,-4,-24],[4,-36,28,-24],[20,-32,east,32],[-36,24,28,north],[-52,-24,-32,-8],[-44,8,-24,24],[0,-24,20,24]];
 const m=arenaBase({id:'frostbite-crescent',name:'Frostbite Crescent',artId:'frost',heights:[0,8],rects,minPlayers:6,maxPlayers:16,half:56});
 // The inner bowl is real low-grip ground; starts remain on the dry shore.
 m.levels[0].color=0xb8dce6;m.levels[1].color=0xafd0e1;
 const ice=m.colliders.find(d=>d.id==='floor-7');ice.material='ice';ice.grip=.35;m.noStartMaterials=['ice'];m.homeMaterialMinimums={ice:6};m.riskHomes=[P(10,0,-30),P(26,8,4)];
 arenaOpenRails(m,[[-4.3,-34,-3.7,-26],[3.7,-34,4.3,-26]]);
 const shelf=[[-20,-26,32,-14],[20,-14,32,26],[-20,14,20,26],[-20,-14,-8,14],[-44,-36,-8,-18],[2,24,18,40]];
 arenaLevel(m,'shelf',8,shelf,{openings:[[-44.1,-18.2,-31.9,-17.8],[1.8,26,2.2,38],[31.7,-4,32.3,4]]});
 const west=[P(-38,0,18),P(-38,0,14),P(-38,8,-18),P(-38,8,-24),...arenaArc(-32,8,-24,6,Math.PI,Math.PI*1.5),P(-20,8,-30),...arenaArc(-20,8,-24,6,-Math.PI/2,0),P(-14,8,-20)];
 arenaAddRamp(m,ramp('west-climb',P(-38,0,14),P(-38,8,-18),12,'slate'),west,'L0','L1');
 const eastPoints=[P(-33,0,32),P(-30,0,32),P(2,8,32),...arenaArc(2,8,26,6,Math.PI/2,0),P(8,8,20)];
 arenaAddRamp(m,ramp('south-climb',P(-30,0,32),P(2,8,32),12,'slate'),eastPoints,'L0','L1');
 m.routes.push({id:'shelf-loop',from:'L1',to:'L1',kind:'drive',bidirectional:true,points:arenaRectangleLoop(20,20,8,5).map(p=>P(p.x+6,p.y,p.z))});
 const kicker=ramp('inlet-kicker',P(-10,0,-30),P(-4,1.2,-30),8,'slate');m.colliders.push(kicker);
 m.routes.push({id:'inlet-jump',from:'L0',to:'L0',kind:'jump',bidirectional:false,points:[P(-20,0,-30),P(-4,1.2,-30),P(12,0,-30)],catch:'regular-water-recovery'});
 for(const sx of[-1,1])for(const sz of[-1,1])m.colliders.push(box('shelf-pier-'+sx+'-'+sz,sx<0?-19:31,3.6,sz*25,.65,3.6,.65,'pillar',{role:'pillar'}));
 m.colliders.push(box('quarry-cover',-27,1.2,-40,3.5,1.2,1.8,'slate'));
 m.landmarks=[{id:'ice',symbol:'A',x:10,y:0,z:0},{id:'shelf',symbol:'B',x:8,y:8,z:-20}];m.reviewPoses=[[12,0,12,Math.PI],[-14,8,0,Math.PI]];
 m.drops=[{id:'shelf-drop',from:P(32,8,0),to:P(40,0,0)}];
 return arenaFinish(m);
}
export function frostBuilds(){return [{id:'small',min:6,max:8,geometry:frostGeometry(true),homes:[20,12],starts:[6,2],weights:[12,6]},{id:'full',min:9,max:16,geometry:frostGeometry(),homes:[26,18],starts:[12,4],weights:[18,10]}];}
export function frostbiteCrescent(){return arenaWithVariants(frostBuilds(),frostPoses);}

import {arenaBox as box,arenaDeck as deck,arenaRamp as ramp,arenaFloor,arenaBoundary,arenaRampGuards,arenaYaw,arenaGuardGroup,arenaScale} from './kart-arena-authoring.mjs';
import {arenaWithVariants,arenaArc} from './kart-launch-support.mjs';
import {skyportPoses} from './kart-skyport-poses.mjs';
const P=(x,y,z)=>({x,y,z});
export function skyportGeometry(compact=false,scale=1){
 const x=compact?66:72,z=compact?50:56,rects=compact?[
  [-66,-26,-52,40],[-52,26,-10,40],[-24,-12,-10,26],[-52,12,-24,26],
  [52,-48,66,40],[10,26,52,40],[10,-48,26,-34],[10,-48,24,26],[24,12,52,26],[-10,12,10,26]
 ]:[[-72,-56,-56,56],[-56,-56,-10,-40],[-56,40,-10,56],[-24,-40,-10,40],[-56,12,-24,28],
 [56,-56,72,56],[10,-56,56,-34],[10,40,56,56],[10,-34,24,40],[24,12,56,28],[-10,12,10,28]];
 const m={id:'skyport-split',name:'Skyport Split',revision:'skyport-split-2',arenaVersion:1,environment:'harbor',artId:'skyport',backdrop:'harbor',half:76,minPlayers:8,maxPlayers:32,levels:[{id:'L0',y:0,name:'Blue streets',color:0x7dabc8},{id:'L1',y:10,name:'Teal parking',color:0x64c6bd},{id:'L2',y:20,name:'Yellow rooftops',color:0xffd36c}],playBounds:{halfX:x,halfZ:z,outline:rects},colliders:[...arenaFloor(rects),...arenaBoundary(rects)],routes:[],sockets:[],spawns:[],spawnCandidates:[],fallZones:[],belts:[],drops:[],features:{cannons:[],portals:[],falls:[]}};
 for(const side of[-1,1])for(const level of[1,2])m.colliders.push(deck((side<0?'west':'east')+'-'+level,side*40,level*10,20,16,18,'parking'));
 for(let storey=0;storey<2;storey++){
  const base=storey*10,points=[P(-58,base,-10),P(-58,base,-16),P(-58,base+2.5,-40)];
  const arc=(cx,cz,a,b,y)=>{for(let j=1;j<=8;j++){const t=a+(b-a)*j/8;points.push(P(cx+6*Math.cos(t),y,cz+6*Math.sin(t)));}};
  arc(-52,-40,Math.PI,1.5*Math.PI,base+2.5);points.push(P(-28,base+5,-46));arc(-28,-40,1.5*Math.PI,2*Math.PI,base+5);
  points.push(P(-22,base+7.5,-16));arc(-28,-16,0,Math.PI/2,base+7.5);points.push(P(-52,base+10,-10));arc(-52,-4,-Math.PI/2,-Math.PI,base+10);points.push(P(-58,base+10,2));arc(-52,2,Math.PI,Math.PI/2,base+10);points.push(P(-46,base+10,8));
  const climbs=[[-58,-28,Math.PI],[-40,-46,Math.PI/2],[-22,-28,0],[-40,-10,-Math.PI/2]],turns=[[-58,-46],[-22,-46],[-22,-10],[-58,-10]];
  for(let i=0;i<4;i++){
   const [cx,cz,a]=climbs[i],from=P(cx-Math.sin(a)*12,base+i*2.5,cz-Math.cos(a)*12),to=P(cx+Math.sin(a)*12,base+(i+1)*2.5,cz+Math.cos(a)*12);
   const d=ramp('helix-'+storey+'-'+i,from,to,12,'parking');m.colliders.push(d,...arenaRampGuards(d));
   const [tx,tz]=turns[i];m.colliders.push(deck('helix-turn-'+storey+'-'+i,tx,base+(i+1)*2.5,tz,6,6,'parking'));
   // Two outer guard edges leave the wide inside of every turn open.
   const sx=tx<-40?-1:1,sz=tz<-28?-1:1;
   m.colliders.push(arenaGuardGroup('helix-corner-'+storey+'-'+i,[box('helix-turn-x-'+storey+'-'+i,tx+sx*5.86,base+(i+1)*2.5+.55,tz,.14,.55,6,'barrier'),...(i===3?[]:[box('helix-turn-z-'+storey+'-'+i,tx,base+(i+1)*2.5+.55,tz+sz*5.86,6,.55,.14,'barrier')])]));
  }
  m.colliders.push(deck('helix-exit-'+(storey+1),-56,base+10,0,8,8,'parking'));
  m.routes.push({id:'west-helix-'+storey,from:'L'+storey,to:'L'+(storey+1),kind:'drive',bidirectional:true,points});
 }
 const street=ramp('east-street-climb',P(18,0,-42),P(58,10,-42),12,'parking'),roof=ramp('east-roof-climb',P(58,10,-18),P(18,20,-18),12,'parking');
 m.colliders.push(deck('roof-turn',18,20,8,12,8,'parking'),street,roof,...arenaRampGuards(street),...arenaRampGuards(roof),deck('east-switchback',64,10,-26,6,22,'parking'),deck('middle-feeder',56,10,2,14,8,'parking'),deck('roof-feeder',12,20,-4,6,20,'parking'));
 for(const height of[10,20])m.colliders.push(deck('safe-bridge-'+height,0,height,30,24,6,'parking'));
 m.colliders.push(deck('middle-north-bridge',0,10,12,24,6,'parking'),deck('gap-west',-14,20,12,10,6,'parking'),deck('gap-east',14,20,12,10,6,'parking'),ramp('roof-kicker',P(-12,20,12),P(-4,21.6,12),12,'parking'));
 m.routes.push({id:'east-street',from:'L0',to:'L1',kind:'drive',bidirectional:true,points:[P(14,0,-42),P(18,0,-42),P(58,10,-42),P(64,10,-42),P(64,10,2),P(48,10,8)]},{id:'east-roof',from:'L1',to:'L2',kind:'drive',bidirectional:true,points:[P(64,10,-18),P(58,10,-18),P(18,20,-18),P(12,20,-18),P(12,20,8),P(32,20,8)]});
 for(const y of[10,20])m.routes.push({id:'safe-crossing-'+y,from:'L'+y/10,to:'L'+y/10,kind:'drive',bidirectional:true,points:[P(-40,y,30),P(40,y,30)]});
 m.routes.push({id:'roof-gap',from:'L2',to:'L2',kind:'jump',bidirectional:false,points:[P(-18,20,12),P(-4,21.6,12),P(12,20,12)],catch:'middle-north-bridge'});
 for(const side of[-1,1])for(const zz of[16,34])m.colliders.push(box('pier-'+side+'-'+zz,side*52,9.6,zz,.8,9.6,.8,'pillar',{role:'pillar'}));
 for(const [i,cx,yy,zz]of[[0,-40,0,18],[1,40,0,30],[4,-40,20,15],[5,40,20,18]])m.colliders.push(box('cover-'+i,cx,yy+1.4,zz,4,1.4,2.5,'cargo'));
 m.colliders.push(box('helix-core',-40,9.6,-28,8,9.6,8,'pillar',{role:'core'}));
 // Tower edges are marked drops; protected long bridge edges keep the safe
 // crossing distinct from the signed roof gap and its visible lower catch.
 for(const y of[10,20])for(const side of[-1,1])m.colliders.push(box('bridge-rail-'+y+'-'+side,0,y+.55,30+side*5.86,24,.55,.14,'barrier'));
 m.reviewPoses=[[-40,0,22,Math.PI/2],[0,10,30,Math.PI/2],[0,20,30,Math.PI/2]];
 m.landmarks=[{id:'helipad',symbol:'H',x:-40,y:20,z:7},{id:'parking',symbol:'P',x:40,y:10,z:14},{id:'roof-east',symbol:'2',x:40,y:20,z:8}];
 m.drops=[{id:'west-maintenance',from:P(-55,20,24),to:P(-60,0,24)},{id:'east-maintenance',from:P(40,20,37),to:P(40,10,32)}];
 const featurePoint=(x,y,z,a=0)=>({x,y,z,angle:a,surface:y?(x<0?'west-':'east-')+y/10:x<0?'floor-0':'floor-1'});
 m.features.cannons=[[-62,-40],[62,40]].map(([cx,lx])=>{const start=featurePoint(cx,0,34),land=featurePoint(lx,20,30);return {...start,angle:Math.atan2(land.x-start.x,land.z-start.z),land,apex:18,flight:1.6};});
 m.features.portals=[[{...featurePoint(-6,0,20,Math.PI/2),surface:'floor-2'},featurePoint(-48,10,20,0)]];
 const guards=m.colliders.filter(d=>d.material==='barrier').flatMap(d=>d.parts||[d]);m.colliders=m.colliders.filter(d=>d.material!=='barrier');
 for(let i=0;i<guards.length;i+=16)m.colliders.push(arenaGuardGroup('guard-batch-'+i/16,guards.slice(i,i+16)));
 if(compact)m.features.cannons=[];const result=scale===1?m:arenaScale(m,scale),q=scale,h=10*q;
 result.routes.find(e=>e.id==='east-street').points=[P(14*q,0,-42*q),P(18*q,0,-42*q),P(58*q,h,-42*q),...arenaArc(58*q,h,-42*q+6,6,-Math.PI/2,0),P(58*q+6,h,8*q-6),...arenaArc(58*q,h,8*q-6,6,0,Math.PI/2),P(48*q,h,8*q)];
 result.routes.find(e=>e.id==='east-roof').points=[P(64*q,h,-18*q),P(58*q,h,-18*q),P(18*q,2*h,-18*q),...arenaArc(18*q,2*h,-18*q+6,6,-Math.PI/2,-Math.PI),P(18*q-6,2*h,8*q-6),...arenaArc(18*q,2*h,8*q-6,6,Math.PI,Math.PI/2),P(32*q,2*h,8*q)];
 return result;
}
export function skyportBuilds(){
 return [['compact',8,8,[20,10,10],[4,2,2],[13,6,6],true,.75],['medium',9,16,[24,12,12],[8,4,4],[13,8,8],true,.8],['wide',17,24,[28,14,22],[12,6,6],[18,10,10],false,.85],['full',25,32,[32,16,24],[16,8,8],[22,12,14],false,1]].map(([id,min,max,homes,starts,weights,compact,scale])=>({id,min,max,homes,starts,weights,geometry:skyportGeometry(compact,scale)}));
}
export function skyportSplit(){return arenaWithVariants(skyportBuilds(),skyportPoses);}

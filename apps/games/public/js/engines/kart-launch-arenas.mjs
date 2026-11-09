import {gardenCrown} from './kart-garden-crown.mjs';
import {rookieTravel} from './kart-rookie-travel.mjs';
import {skyportSplit} from './kart-skyport-split.mjs';
import {arenaBox as box,arenaDeck as deck,arenaRamp as ramp,arenaPoint as point,arenaFloor,arenaBoundary,arenaSupport,arenaRampGuards} from './kart-arena-authoring.mjs';
const P=(x,y,z)=>({x,y,z});
function rookie(){
 const rects=[[-38,-20,-8,28],[8,-20,38,28],[-32,-24,-14,24],[14,-24,32,24],[-8,-14,8,14]];
 const map={id:'rookie-ribbons',revision:'rookie-ribbons-1',arenaVersion:1,name:'Rookie Ribbons',environment:'toy',artId:'ring',backdrop:'grove',half:42,minPlayers:2,maxPlayers:8,
  levels:[{id:'L0',y:0,name:'Driving school',color:0x63c4bf},{id:'L1',y:6,name:'Toy arch',color:0xffc76c}],
  playBounds:{halfX:38,halfZ:28,outline:rects},features:{cannons:[],portals:[],falls:[]},fallZones:[],belts:[],
  colliders:[...arenaFloor(rects),...arenaBoundary(rects),
   deck('arch',0,6,-10,32,6,'toy-deck'),
   ramp('west-climb',P(-26,0,20),P(-26,6,-4),12,'toy-deck'),
   ramp('east-climb',P(26,0,20),P(26,6,-4),12,'toy-deck'),
   box('arch-north-guard',0,6.6,-15.8,32,.6,.2,'barrier'),
   box('arch-west-guard',-31.8,6.6,-10,.2,.6,6,'barrier'),
   box('arch-east-guard',31.8,6.6,-10,.2,.6,6,'barrier'),
   box('west-school-block',-14,1.2,-18,2.5,1.2,1.8,'toy-coral'),
   box('east-school-block',14,1.2,-18,2.5,1.2,1.8,'toy-blue')],
  sockets:[],spawns:[],spawnCandidates:[],routes:[
   {id:'west-climb',from:'L0',to:'L1',kind:'drive',bidirectional:true,points:[P(-26,0,22),P(-26,0,20),P(-26,6,-4),P(-26,6,-10)]},
   {id:'east-climb',from:'L0',to:'L1',kind:'drive',bidirectional:true,points:[P(26,0,22),P(26,0,20),P(26,6,-4),P(26,6,-10)]},
   {id:'arch-link',from:'L1',to:'L1',kind:'drive',bidirectional:true,points:[P(-26,6,-10),P(26,6,-10)]},
   {id:'lower-link',from:'L0',to:'L0',kind:'drive',bidirectional:true,points:[P(-14,0,8),P(14,0,8)]}],
  drops:[{id:'west-drop',from:P(-7,6,-3.8),to:P(-7,0,6)},{id:'east-drop',from:P(7,6,-3.8),to:P(7,0,6)}],
  landmarks:[{id:'school',symbol:'A',x:-14,y:2.4,z:-18},{id:'garage',symbol:'B',x:14,y:2.4,z:-18}],
  designNotes:['Two ordinary 1:4 climbs, a finite 5.2m underside and guarded dumbbell ground. South arch edge has visible lower catch ground.']};
 const ground=[[-35,-17,0],[35,17,Math.PI],[-35,17,Math.PI],[35,-17,0],[-14,18,Math.PI],[14,18,Math.PI],[-35,-8,0],[35,8,Math.PI],[-35,8,Math.PI],[35,-8,0],[-14,12,Math.PI],[14,12,Math.PI]];
 for(const [x,z,a]of ground)map.spawnCandidates.push(point('start-'+map.spawnCandidates.length,arenaSupport(map,x,0,z),x,0,z,a,{district:'core',level:'L0'}));
 for(const [x,z,a]of [[-24,-10,Math.PI/2],[24,-10,-Math.PI/2],[-18,-10,Math.PI/2],[18,-10,-Math.PI/2]])map.spawnCandidates.push(point('start-'+map.spawnCandidates.length,'arch',x,6,z,a,{district:'core',level:'L1'}));
 for(const side of[-1,1])for(const [zone,coords]of [['north',[[34,-8],[24,-14],[14,-10],[34,0]]],['south',[[34,8],[14,2],[14,10],[24,22]]]])for(let i=0;i<coords.length;i++){
  const [abs,z]=coords[i],x=abs*side;map.sockets.push(point('home-'+map.sockets.length,arenaSupport(map,x,0,z),x,0,z,0,{level:'L0',district:i===3?'retreat':(side<0?'west-':'east-')+zone,profile:'safe'}));
 }
 for(const x of[-15,-5,5,15])map.sockets.push(point('home-'+map.sockets.length,'arch',x,6,-10,0,{level:'L1',district:'arch',profile:x===5?'risk':'exposed'}));
 const districts=['core','west-north','west-south','east-north','east-south','arch'];
 const fullStarts=['start-0','start-1','start-2','start-3','start-4','start-5','start-12','start-13'];
 const duelRects=[[-30,-16,-6,28],[6,-16,30,28],[-6,-14,6,14]];
 const duel={colliders:[...arenaFloor(duelRects),...arenaBoundary(duelRects),deck('arch',0,6,-10,24,6,'toy-deck'),
  ramp('west-climb',P(-18,0,20),P(-18,6,-4),10,'toy-deck'),ramp('east-climb',P(18,0,20),P(18,6,-4),10,'toy-deck'),
  box('arch-north-guard',0,6.6,-15.8,24,.6,.2,'barrier'),box('arch-west-guard',-23.8,6.6,-10,.2,.6,6,'barrier'),box('arch-east-guard',23.8,6.6,-10,.2,.6,6,'barrier'),
  box('west-school-block',-9,1.2,-13,2.5,1.2,1.8,'toy-coral'),box('east-school-block',9,1.2,-13,2.5,1.2,1.8,'toy-blue')],
  spawnCandidates:[],sockets:[],playBounds:{halfX:30,halfZ:28,outline:duelRects},
  routes:map.routes.map(e=>({...e,points:e.points.map(p=>({...p,x:p.x===-26?-18:p.x===26?18:p.x===-14?-9:p.x===14?9:p.x}))})),
  landmarks:[{id:'school',symbol:'A',x:-9,y:2.4,z:-13},{id:'garage',symbol:'B',x:9,y:2.4,z:-13}]};
 for(const [x,z,a]of[[-9,22,Math.PI],[9,22,Math.PI],[-27,22,Math.PI],[27,22,Math.PI]])duel.spawnCandidates.push(point('duel-start-'+duel.spawnCandidates.length,arenaSupport(duel,x,0,z),x,0,z,a,{district:'core',level:'L0'}));
 for(const side of[-1,1])for(const x0 of[9,27])for(const z of[-8,2,12]){const x=x0*side;duel.sockets.push(point('duel-home-'+duel.sockets.length,arenaSupport(duel,x,0,z),x,0,z,0,{level:'L0',district:(side<0?'west-':'east-')+(z<0?'north':'south'),profile:'safe'}));}
 for(const x of[-15,-5,5,15])duel.sockets.push(point('duel-home-'+duel.sockets.length,'arch',x,6,-10,0,{level:'L1',district:'arch',profile:x===5?'risk':'exposed'}));
 for(const [layout,span] of [[map,20],[duel,13]]){
  layout.colliders.push(...layout.colliders.filter(d=>d.shape==='wedge').flatMap(d=>arenaRampGuards(d)));
  for(const side of[-1,1])layout.colliders.push(box('bridge-pier-'+side,side*span,2.6,-10,.65,2.6,.65,'pillar',{role:'pillar'}));
  for(const [i,lo,hi]of [[0,-span,-9],[1,-5,5],[2,9,span]])layout.colliders.push(box('arch-front-rail-'+i,(lo+hi)/2,6.55,-4.12,(hi-lo)/2,.55,.14,'barrier',{role:'rail'}));
 }
 map.travelAtlas=rookieTravel.full;duel.travelAtlas=rookieTravel.duel;
 map.variants=[{id:'duel',minPlayers:2,maxPlayers:2,usableArea:2117,districts,startIds:['duel-start-0','duel-start-1'],floorWeights:[8,4],layout:duel},
  {id:'full',minPlayers:3,maxPlayers:8,usableArea:3160.5,districts:[...districts,'retreat'],startIds:fullStarts,starts:{4:['start-0','start-1','start-12','start-13']},floorWeights:[14,4]}];
 map.spawns=fullStarts.map(id=>map.spawnCandidates.find(s=>s.id===id));return map;
}
export const launchArenas=Object.freeze({'rookie-ribbons':rookie(),'skyport-split':skyportSplit(),'garden-crown':gardenCrown()});
export const launchArenaIds=Object.freeze(Object.keys(launchArenas));

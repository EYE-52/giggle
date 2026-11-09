'use strict';
/* Single source for classic collision, navigation, pickups and presentation.
 * Snapshots carry these arrays to the client; never copy this table there.
 * Dimensions are metres; angles face (sin(a), cos(a)). See docs/kart-map-designs.md. */
const rect=(x,z,hw,hd)=>({x,z,hw,hd});
const road=(points,width=7,closed=false)=>({points,width,closed,curb:true});
const loop=(e,r,width)=>road([[-e+r,-e],[e-r,-e],[e,-e+r],[e,e-r],[e-r,e],[-e+r,e],[-e,e-r],[-e,-e+r]],width,true);
const E=Math.PI/2,W=-E,N=0,S=Math.PI;
const ramp=(x,z,angle,hw=2,hl=2.5,h=1.2)=>({x,z,angle,hw,hl,h});
const cannon=(x,z,lx,lz,angle=N,flight=1.4)=>({x,z,angle:Math.atan2(lx-x,lz-z),land:{x:lx,z:lz,angle},flight,apex:8});
const pool=list=>list.map(([x,z,angle])=>({x,z,angle:angle??Math.atan2(-x,-z)}));

const MAPS={
 ring:{
  label:'Rookie Ring',theme:'ring',half:30,revision:'ring-bowtie-20261109-1',
  blocks:[],
  // Two lobes meet only at the crossover. No shared oval/cross template.
  roads:[road([[0,0],[-16,-10],[-16,-19],[0,-24],[16,-19],[16,-10],[0,0]],8),
   road([[0,0],[-16,10],[-16,19],[0,24],[16,19],[16,10],[0,0]],8),road([[-5,-3],[5,3]],8)],
  barriers:[rect(0,-14,4,1),rect(-5,-14,.5,2),rect(5,-14,.5,2),
   rect(0,14,4,1),rect(-5,14,.5,2),rect(5,14,.5,2)],
  ramps:[ramp(0,-24,W,1.8,2.5,1),ramp(0,24,E,1.8,2.5,1)],
  pads:[rect(16,-13,1.8,2.5),rect(-16,13,1.8,2.5)],surfaces:[],
  offroad:{kind:'grass',top:.72,traction:.78},
  spawns:pool([[-14,-6,Math.PI/3],[14,6,-2*Math.PI/3],[14,-6,-Math.PI/3],[-14,6,2*Math.PI/3],[-13,-21,E],[13,21,W],[13,-21,W],[-13,21,E]]),
  features:{cannons:[cannon(24,-24,-2,0,-Math.PI/4,1.3)],
   portals:[[{x:-24,z:-24,angle:Math.PI/4},{x:24,z:24,angle:-3*Math.PI/4}]],
   falls:[{...rect(-26,0,2,3.5),kind:'pit'}]},
 },
 blocks:{
  label:'Bumper Blocks',theme:'blocks',half:30,revision:'blocks-switchback-20261109-2',
  blocks:[rect(-7,-14,9,2),rect(16,-14,3,2),rect(-16,14,3,2),rect(7,14,9,2),rect(-12,0,2,3),rect(12,0,2,3)],
  roads:[road([[-23,-22],[0,-22],[23,-22],[23,-7],[-23,-7],[-23,7],[23,7],[23,22],[0,22],[-23,22]],6),
   road([[-23,-22],[-23,22]],6),road([[7.5,-24],[7.5,-7],[-7.5,7],[-7.5,24]],7)],
  barriers:[rect(-22,-14,.5,2),rect(22,-14,.5,2),rect(-22,14,.5,2),rect(22,14,.5,2),rect(-5,0,.5,2),rect(5,0,.5,2)],
  ramps:[ramp(7.5,-20,N,1.4,2.5,1.3)],
  pads:[rect(-12,-7,2,1.4),rect(12,7,2,1.4)],surfaces:[],
  offroad:{kind:'sand',top:.7,traction:.58},
  spawns:pool([[-18,-7,E],[18,7,W],[18,-7,W],[-18,7,E],[-7,-23,E],[7,23,W],[0,-23,W],[-7,23,E]]),
  features:{cannons:[cannon(-24,-24,0,7,W,1.3)],
   portals:[[{x:16,z:-25,angle:W},{x:-16,z:25,angle:E}]],
   falls:[{...rect(25,0,2,2),kind:'pit'}]},
 },
 garden:{
  label:'Garden Circuit',theme:'garden',half:60,revision:'garden-fountain-20261109-1',
  blocks:[{...rect(0,0,4,4),pieces:[
   {w:6,h:.18,d:6,y:1.57,material:'cap'},
   {w:5.5,h:.06,d:5.5,y:1.69,material:'water'},
   {w:.65,h:.55,d:.65,y:1.96,material:'base'},
   {w:1.5,h:.12,d:1.5,y:2.27,material:'cap'},
   {w:1.2,h:.04,d:1.2,y:2.35,material:'water'},
  ]},rect(-24,-23,7,2),rect(24,-23,7,2),rect(-24,23,7,2),rect(24,23,7,2)],
  roads:[loop(46,14,9),road([[0,-17],[17,0],[0,17],[-17,0]],8,true),
   road([[0,-46],[0,-17]],7),road([[0,17],[0,46]],7),road([[-46,0],[-17,0]],7),road([[17,0],[46,0]],7)],
  barriers:[rect(-18,-32,7,.55),rect(18,-32,7,.55),rect(-18,32,7,.55),rect(18,32,7,.55),
   rect(-32,-13,.55,5),rect(32,-13,.55,5),rect(-32,13,.55,5),rect(32,13,.55,5)],
  ramps:[ramp(-8,-28,N,1.8,2.5,1),ramp(51,28,N,2,3,1.2),ramp(-51,35,S,2,3,1.2)],
  pads:[rect(46,10,2,5),rect(-46,-12,2,5),rect(0,-46,5,2),rect(0,46,5,2)],surfaces:[],
  offroad:{kind:'grass',top:.72,traction:.78},
  spawns:pool([[0,-19,E],[0,19,W],[-16,0,N],[19,0,S],[-38,-30,N],[38,32,S],[0,-42,E],[0,42,W],[-43,26,S],[43,-26,N]]),
  features:{cannons:[cannon(-16,-52,16,0,E),cannon(16,53,-16,0,W)],
   portals:[[{x:-54,z:0,angle:E},{x:55,z:2,angle:W}]],
   falls:[{...rect(-25,7,3.5,2.5),kind:'water'}]},
 },
 frost:{
  label:'Frosty Pass',theme:'frost',half:60,revision:'frost-split-lake-20261109-1',
  blocks:[rect(-28,-15,4,3),rect(28,15,4,3),rect(-16,35,5,3),rect(16,-35,5,3),rect(-40,20,3,4),rect(40,-20,3,4)],
  // Two shore horseshoes meet a causeway, rather than another cross arena.
  roads:[road([[-49,0],[-49,-32],[-30,-48],[30,-48],[49,-32],[49,0]],8),
   road([[-49,0],[-49,32],[-30,48],[30,48],[49,32],[49,0]],8),
   road([[-49,0],[49,0]],8),road([[0,-48],[0,-38]],7),road([[0,38],[0,48]],7)],
  barriers:[rect(-16,-6,8,.55),rect(16,-6,8,.55),rect(-16,6,8,.55),rect(16,6,8,.55),rect(-36,-6,3,.55),rect(36,6,3,.55)],
  ramps:[ramp(0,-30,N,2.3,3,1.3),ramp(0,30,S,2.3,3,1.3)],
  pads:[rect(-49,-25,2,4),rect(49,25,2,4)],
  surfaces:[{...rect(0,-19,21,10),grip:.3},{...rect(0,19,21,10),grip:.3}],
  offroad:{kind:'snow',top:.66,traction:.48},
  spawns:pool([[-25,0,E],[25,0,W],[0,-36,E],[0,36,W],[-40,12,N],[40,-12,S],[-28,-22,E],[28,22,W],[-12,-25,E],[12,25,W]]),
  features:{cannons:[cannon(32,-44,0,0,E,1.5),cannon(-36,48,-28,0,E,1.5)],
   portals:[[{x:24,z:-54,angle:W},{x:-30,z:52,angle:E}]],
   falls:[{...rect(-30,23,3.5,2),kind:'ice'}]},
 },
 neon:{
  label:'Neon Yard',theme:'neon',half:60,revision:'neon-city-20261109-1',
  // Six city blocks enclose a market; opposite alleys are deliberately offset.
  blocks:[rect(-24,-25,9,8),rect(25,-25,10,8),rect(-27,8,7,7),rect(27,10,7,7),rect(-23,35,10,6),rect(25,36,9,7)],
  roads:[road([[-46,-44],[46,-44],[46,48],[-46,48]],9,true),
   road([[-46,-9],[46,-9]],8),road([[-46,23],[46,23]],8),
   road([[0,-44],[0,-9],[-7,7],[0,23],[0,48]],9),
   road([[-14,-6],[13,-6],[14,15],[-12,15]],8,true)],
  barriers:[rect(-7,-31,.55,4),rect(8,36,.55,4),rect(-39,9,.55,4),rect(39,10,.55,4),rect(-18,-40,5,.55),rect(22,46,5,.55)],
  ramps:[ramp(-4,7,N,2,3,1.2)],
  pads:[rect(0,-14,2.5,2.5),rect(0,28,2.5,2.5),rect(-46,-15,2,4),rect(46,18,2,4)],surfaces:[],
  offroad:{kind:'gravel',top:.74,traction:.67},
  spawns:pool([[0,-22,N],[0,24,S],[-18,-9,E],[18,23,W],[-36.5,-25,N],[37.5,36,S],[-36.5,35,S],[38.5,-25,N],[0,-46,E],[0,46,W]]),
  features:{cannons:[cannon(-52,0,-8,-9,E,1.3),cannon(32,-52,44,-2,N)],
   portals:[[{x:-52,z:-52,angle:E},{x:52,z:52,angle:W}]],
   falls:[{...rect(11,-21,1.5,3),kind:'goo'}]},
 },
};

// Authored pickup trails: perimeter, junctions, cover flanks and risky cuts.
// The filter reserves real clearance around all geometry and feature mouths.
const TRAILS={
 ring:[[-17,-12],[-17,-18],[-9,-23],[9,-23],[17,-18],[17,-12],[-17,12],[-17,18],[-9,23],[9,23],[17,18],[17,12],[-12,-5],[12,-5],[-12,5],[12,5],[-6,-4],[6,-4],[-6,4],[6,4],[0,0],[0,-7],[0,7],[-21,-6],[21,-6],[-21,6],[21,6],[-9,-19],[9,19],[-9,19],[9,-19]],
 blocks:[[-24,-7],[-16,-7],[-8,-7],[0,-7],[8,-7],[16,-7],[24,-7],[-24,7],[-16,7],[-8,7],[0,7],[8,7],[16,7],[24,7],[-22,-21],[-12,-22],[-4,-24],[5,-23],[23,-22],[-23,22],[-5,23],[4,24],[12,22],[23,22],[0,0],[0,13],[0,-12],[-23,0],[19,0]],
 garden:[[-48,-48],[-24,-48],[0,-48],[24,-48],[48,-48],[-48,-24],[48,-28],[-46,-8],[-46,8],[48,-8],[44,24],[-52,20],[-34,20],[36,34],[52,36],[-48,44],[-24,44],[0,48],[24,48],[48,48],[-40,-36],[0,-17],[12,-12],[17,0],[12,12],[0,17],[-12,12],[-17,0],[-12,-12],[0,-40],[0,30],[0,40],[-36,0],[36,0],[-24,-12],[24,-12],[-24,12],[24,12],[-10,-40],[10,40]],
 frost:[[-48,-48],[-24,-48],[0,-48],[48,-48],[-48,-28],[48,-28],[-48,-8],[-8,-18],[8,-18],[28,-14],[52,-20],[-48,12],[-28,8],[-8,18],[8,18],[28,8],[48,8],[-48,32],[-28,40],[0,40],[24,40],[48,40],[-48,50],[-12,50],[0,52],[12,52],[48,50],[-8,-38],[8,35],[-16,0],[16,0],[8,0],[-8,0],[-40,0],[40,0],[0,-19],[0,19],[-12,-28],[12,28]],
 neon:[[-48,-48],[-24,-46],[0,-46],[24,-44],[48,-48],[-46,-28],[0,-24],[46,-32],[-46,-8],[-28,-8],[-8,-9],[8,-9],[28,-9],[48,-8],[-46,12],[-10,4],[8,8],[46,8],[-46,32],[-28,23],[-8,23],[8,23],[28,23],[46,36],[-12,48],[0,46],[36,48],[0,0],[12,0],[-40,-20],[40,20],[-7,-36],[0,35],[-35,-40],[35,46],[-35,24],[-16,4],[15,20]],
};
const distance=(r,x,z)=>Math.hypot(Math.max(0,Math.abs(x-r.x)-r.hw),Math.max(0,Math.abs(z-r.z)-r.hd));
for(const [id,m]of Object.entries(MAPS)){
 const solids=[...m.blocks,...m.barriers,...m.ramps.map(r=>rect(r.x,r.z,Math.abs(Math.cos(r.angle))*r.hw+Math.abs(Math.sin(r.angle))*r.hl,Math.abs(Math.sin(r.angle))*r.hw+Math.abs(Math.cos(r.angle))*r.hl))];
 m.spots=TRAILS[id].filter(([x,z])=>solids.every(r=>distance(r,x,z)>=2.5)&&m.features.falls.every(r=>distance(r,x,z)>=3.2)&&m.features.cannons.every(c=>Math.hypot(x-c.x,z-c.z)>=6)&&m.features.portals.flat().every(p=>Math.hypot(x-p.x,z-p.z)>=5));
}
function mapIds(){return Object.keys(MAPS);}
function mapDef(id){return MAPS[id]||MAPS.ring;}
function normalizeMapId(id,allowed){const list=Array.isArray(allowed)&&allowed.length?allowed:mapIds();return list.includes(id)||MAPS[id]?id:list[0]||'ring';}
module.exports={MAPS,mapIds,mapDef,normalizeMapId};

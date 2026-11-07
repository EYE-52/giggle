/* Authored shortcuts. Heights are support heights, never chassis centres.
 * Cannons approach the outside of buildings; portals connect an opposite
 * street district to an open deck lane. Ramps remain full bypass routes. */
const point=(surface,x,y,z,angle=0)=>({surface,x,y,z,angle});
const cannon=(start,land,apex=14)=>({...start,angle:Math.atan2(land.x-start.x,land.z-start.z),land,apex,flight:1.6});
const FEATURES={
  garden:{cannons:[cannon(point('floor',-42,0,-8),point('courtyard',18,7,0))],portals:[[point('floor',-40,0,32,Math.PI/2),point('courtyard',30,7,16,Math.PI)]]},
  frost:{cannons:[cannon(point('floor-west',-44,0,-10),point('quarry-shelf',-27,8,0))],portals:[[point('floor-south',4,0,-42,Math.PI/2),point('east-landing',17,8,16,-Math.PI/2)]]},
  neon:{cannons:[cannon(point('floor',-26,0,-6),point('loading-deck',28,6,4))],portals:[[point('floor',-40,0,40,Math.PI/2),point('loading-deck',16,6,22,Math.PI)]]},
  harbor:{cannons:[cannon(point('floor',-76,0,-42),point('west-balcony',-61,7,12))],portals:[[point('floor',70,0,-62),point('upper-dock',10,7,24,-Math.PI/2)]]},
  skyport:{cannons:[cannon(point('floor',92,0,-76),point('east-2',48,20,-20),18),cannon(point('floor',-92,0,70),point('west-2',-48,20,20,Math.PI),18)],portals:[[point('floor',-100,0,-30),point('west-1',-48,10,-20)]]},
  foundry:{cannons:[cannon(point('floor',102,0,30),point('east-gantry',50,20,32,Math.PI),18),cannon(point('floor',-104,0,28),point('west-gantry',-50,20,32,Math.PI),18)],portals:[[point('floor-north',-10,0,90,Math.PI/2),point('west-catwalk',0,10,-24,Math.PI/2)]]},
};
export function addRaisedFeatures(map){
  map.features={...structuredClone(FEATURES[map.id]),falls:[]};
  map.revision+='-routes-1';
  map.designNotes.push('Bright launch cannons reach the upper combat loop from the open streets; a paired portal links a far street district to the middle deck. Launch pads and exits have clear supported lanes. Cannon landing and portal grace cooldowns prevent loops.');
  map.description=(map.description||map.name)+ ' Cannons climb; linked portals cross levels.';
  return map;
}

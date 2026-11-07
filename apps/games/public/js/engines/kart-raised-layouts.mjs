// Readability and route updates shared by the six raised battle maps.
// Kerbs are real, short solids. Their gaps preserve every ramp, bridge,
// pickup approach and authored drop; painted stripes never block a kart.
const box=(id,x,y,z,hx,hy,hz,material='cover')=>({id,shape:'box',position:{x,y,z},half:{x:hx,y:hy,z:hz},material,grip:1});
const kerb=(id,x,y,z,hx,hz)=>box('kerb-'+id,x,y+.3,z,hx,.3,hz,'kerb');
function addPit(map,{id,x,z,halfX,halfZ,label}){
  const h=map.half,left=x-halfX,right=x+halfX,south=z-halfZ,north=z+halfZ;
  const slab=(name,x0,x1,z0,z1)=>box(name,(x0+x1)/2,-1,(z0+z1)/2,(x1-x0)/2,1,(z1-z0)/2,'asphalt');
  const slabs=[slab('floor',-h,h,north,h),slab('floor-south',-h,h,-h,south),slab('floor-west',-h,left,south,north),slab('floor-east',right,h,south,north)];
  map.colliders.splice(map.colliders.findIndex(d=>d.id==='floor'),1,...slabs,box('pit-bed',x,-9,z,halfX,1,halfZ,'pit'));
  const floorAt=(x,z)=>slabs.find(d=>Math.abs(x-d.position.x)<=d.half.x&&Math.abs(z-d.position.z)<=d.half.z)?.id;
  for(const p of [...map.spawns,...map.sockets])if(p.surface==='floor')p.surface=floorAt(p.x,p.z);
  for(const r of map.routes){const d=map.colliders.find(d=>d.id===r.via),a=2*Math.atan2(d.rotation?.y||0,d.rotation?.w??1);if(r.from==='floor')r.from=floorAt(d.position.x-Math.sin(a)*(d.half.z+3),d.position.z-Math.cos(a)*(d.half.z+3));}
  map.fallZones=[{id,x,z,halfX,halfZ,below:-1}];
  map.landmarks.push({x,y:0,z,label});map.designNotes.push(label+' is a striped physical opening with two road bypasses. Falling below the rim uses the existing elevated recovery and safe respawn.');
}
const ORIGINALS={
  garden:{backdrop:'garden',levels:[{y:0,name:'Green fountain plaza',color:0x489d7a},{y:7,name:'Gold courtyard',color:0xe1b961}],
    cover:[box('plaza-screen',-31,1.4,-20,3,1.4,2,'stone'),box('courtyard-screen',24,8.3,8,2,1.3,1.5,'stone')],
    kerbs:[kerb('courtyard-west',10.3,7,8,.3,8),kerb('courtyard-east',37.7,7,8,.3,8)],
    upper:[['courtyard',26,7,15],['courtyard',18,7,0]],
    landmarks:[{x:-12,y:0,z:-4,label:'Fountain plaza'},{x:24,y:7,z:8,label:'Gold courtyard'}],
    designNotes:['Two opposite ramps connect the fountain plaza, courtyard and open underpass.','Low plaza and courtyard screens break the long west sight line and split upper combat into two flanks.','Six street spawns and two courtyard spawns; three crates per level keep both ramps contested. Side kerbs leave north and south drops open.']},
  frost:{backdrop:'frost',levels:[{y:0,name:'Blue ice basin',color:0x82c4e4},{y:8,name:'Gold quarry shelf',color:0xe4bf72}],
    cover:[box('east-quarry-screen',28,1.6,6,3,1.6,3,'slate'),box('shelf-screen',-34,9.3,12,2,1.3,2,'slate')],
    kerbs:[kerb('shelf-west',-37.7,8,12,.3,12),kerb('shelf-east-south',-16.3,8,2,.3,5),kerb('shelf-east-north',-16.3,8,26,.3,1.5),kerb('bridge-south',-2,8,11.3,12,.3),kerb('bridge-north',-2,8,20.7,12,.3)],
    upper:[['east-landing',17,8,18],['quarry-shelf',-30,8,8]],
    landmarks:[{x:0,y:.12,z:0,label:'Blue ice rink'},{x:-27,y:8,z:12,label:'Gold shelf'},{x:17,y:8,z:16,label:'East bridge landing'}],
    designNotes:['Three climbs form a shelf and bridge loop with an independent icy underpass.','East ground cover and a shelf screen shorten clear firing lanes while leaving both sides open.','Ice is solid low-grip ground. The optional kicker crosses its edge; gold bridge kerbs mark the high route. Three crates on each level.']},
  neon:{backdrop:'neon',levels:[{y:0,name:'Blue cargo streets',color:0x469bab},{y:6,name:'Pink loading deck',color:0xdc8cb9}],
    cover:[box('central-cargo-screen',-12,1.6,-8,3,1.6,2,'cargo-teal'),box('loading-screen',22,7.3,14,2,1.3,2,'cargo-orange')],
    kerbs:[kerb('loading-west',8.3,6,14,.3,9),kerb('loading-east',35.7,6,14,.3,9)],
    upper:[['loading-deck',16,6,18],['loading-deck',28,6,8]],
    landmarks:[{x:-32,y:0,z:16,label:'Teal cargo yard'},{x:22,y:6,z:14,label:'Pink loading deck'}],
    designNotes:['Opposite climbs connect the pink loading deck and blue cargo streets.','Central and upper cargo screens create short flanks, keeping rockets from owning the whole plaza.','Six street spawns and two deck spawns; equal crate counts make both levels useful. Open deck ends remain marked drop shortcuts. The neon painting is independent of harbor scenery.']},
  harbor:{backdrop:'harbor',levels:[{y:0,name:'Teal dock roads',color:0x4caaaf},{y:7,name:'Gold bridge loop',color:0xe9b271}],
    cover:[box('south-apron-screen',0,1.5,-48,5,1.5,2.5,'cargo-teal'),box('west-apron-screen',-57,1.4,50,3,1.4,2.5,'cargo-orange')],
    kerbs:[...[-37,37].flatMap(x=>[kerb('span-'+x+'-south',x,7,13.3,12,.3),kerb('span-'+x+'-north',x,7,26.7,12,.3)]),kerb('west-balcony',-70.7,7,20,.3,12),kerb('east-balcony',70.7,7,20,.3,12),kerb('dock-north',-8,7,35.7,14,.3),kerb('dock-south',8,7,4.3,11,.3)],
    upper:[['west-balcony',-60,7,28],['east-balcony',60,7,28]],
    landmarks:[{x:-36,y:0,z:-35,label:'Teal warehouse'},{x:0,y:7,z:20,label:'Gold bridge dock'},{x:61,y:7,z:20,label:'East jump balcony'}],
    designNotes:['Four climbs and two bridges form a full upper loop above the open east-west underpass.','South and west apron screens break the longest empty runs. Two far corner sockets move to the south junction and north ramp approach.','Six road spawns and two balcony spawns; three crates per level keep the bridge loop contested. Bridge kerbs protect the narrow spans; the east kicker and dock end drops stay open.']},
};
export function improveRaisedLayout(map){
  const spec=ORIGINALS[map.id];
  map.balancedLoot=true;
  if(spec){
    map.revision='combat-elevation-2';map.backdrop=spec.backdrop;map.levels=spec.levels;map.landmarks=spec.landmarks;map.designNotes=spec.designNotes;
    map.qualityCoverIds=spec.cover.map(d=>d.id);
    map.colliders.push(...spec.cover,...spec.kerbs);
    spec.upper.forEach(([surface,x,y,z],i)=>Object.assign(map.spawns[6+i],{surface,x,y,z,angle:Math.atan2(-x,-z)}));
    if(map.id==='harbor'){
      Object.assign(map.sockets[1],{x:0,z:-36});
      Object.assign(map.sockets[7],{x:32,z:60});
    }
    if(map.id==='frost')addPit(map,{id:'quarry-shaft',x:44,z:-10,halfX:4,halfZ:4,label:'East quarry shaft'});
    if(map.id==='neon'){
      // Keep the entire start footprint on one road slab beside the basin.
      map.spawns[4].z=-16;map.spawns[4].angle=Math.atan2(-map.spawns[4].x,16);
      addPit(map,{id:'dock-water',x:-42,z:-14,halfX:4,halfZ:5,label:'West dock basin'});
    }
  }else{
    // Short safety kerbs on the long spans leave wide access at both ends.
    const bridges=map.colliders.filter(d=>d.shape==='deck'&&(/bridge/.test(d.id)||/high-crossing/.test(d.id)));
    for(const d of bridges)for(const side of [-1,1])map.colliders.push(kerb(d.id+'-'+side,d.position.x,d.position.y+d.half.y,d.position.z+side*(d.half.z-.3),Math.max(2,d.half.x-4),.3));
    map.designNotes=[map.description,'The first two starts use the same loading-ramp district, cutting their driving separation to about 145 metres while later seats spread around the full complex.','Blue/charcoal streets, teal/orange middle routes and yellow/green roofs have separate landmarks and guaranteed crate supply.','All 32 starts and all sockets join one drivable network. The spiral and outer ramps offer alternate climbs; open, striped roof edges offer drops. Short real bridge kerbs leave approach and jump gaps clear.',map.id==='foundry'?'Ground belts and the upper sorter are height-isolated. Slag is a real hole with recovery below the rim; service tunnels have side exits. Steel floor panels, tank cages, service pipes and a glowing furnace mouth share batches; warm lighting sits against the quarry painting.':'The two-turn car park spiral, P parking signs and H helipad orient players. The roof jump has a wide bypass bridge. Painted concrete tiles, van-shaped solid cover, numbered lighted pillars and detailed roof service rooms mark each floor.'];
  }
  return map;
}

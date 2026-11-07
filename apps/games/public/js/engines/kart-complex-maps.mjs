/* Original three-storey battle complexes. Metres, +Y up. Every floor,
 * spiral segment, cover block and tunnel ceiling is an authority solid.
 * 244² m is 2.01 times Harbor Heights' 172² m footprint. */
const yaw = a => ({x:0,y:Math.sin(a/2),z:0,w:Math.cos(a/2)});
const solid = (id,x,y,z,hx,hy,hz,material='concrete') => ({id,shape:'box',position:{x,y,z},half:{x:hx,y:hy,z:hz},material,grip:1});
const deck = (id,x,y,z,hx,hz,material='level-1') => ({...solid(id,x,y-.4,z,hx,.4,hz,material),shape:'deck'});
const ramp = (id,x,z,width,run,base,rise,a=0) => ({id,shape:'wedge',position:{x,y:base+rise/2,z},half:{x:width/2,y:rise/2,z:run/2},rotation:yaw(a),material:'ramp',grip:1});
const point = (id,surface,x,y,z,angle=0) => ({id,surface,x,y,z,angle});
const boundary = () => [solid('north-boundary',0,2,122,122,2,.5,'barrier'),solid('south-boundary',0,2,-122,122,2,.5,'barrier'),solid('west-boundary',-122,2,0,.5,2,122,'barrier'),solid('east-boundary',122,2,0,.5,2,122,'barrier')];

// A real square helix: four rising lanes and wide turning landings per
// storey. The second turn passes ten metres over the first, not through it.
function spiral(map,cx,cz){
  for(let storey=0;storey<2;storey++){
    const base=storey*10;
    for(let i=0;i<4;i++){
      const [dx,dz,a]=[[-18,0,Math.PI],[0,-18,Math.PI/2],[18,0,0],[0,18,-Math.PI/2]][i];
      const [lx,lz]=[[-18,-18],[18,-18],[18,18],[-18,18]][i];
      const id=`spiral-${storey}-${i}`,from=i?`turn-${storey}-${i-1}`:storey?'turn-0-3':'floor',to=`turn-${storey}-${i}`;
      map.colliders.push(ramp(id,cx+dx,cz+dz,12,24,base+i*2.5,2.5,a),deck(to,cx+lx,base+(i+1)*2.5,cz+lz,6,6,storey?'level-2':'level-1'));
      map.routes.push({id,from,via:id,to});
    }
  }
  map.spiral={center:{x:cx,z:cz},turns:2};
}
function finish(map,spawns,sockets){
  map.spawns=spawns.map(([s,x,y,z,a],i)=>point('spawn-'+i,s,x,y,z,a??Math.atan2(-x,-z)));
  map.sockets=sockets.map(([s,x,y,z],i)=>point('crate-'+i,s,x,y,z));
  // Route labels are also used by the driving acceptance test.
  map.levels=[{y:0,name:map.id==='skyport'?'Blue streets':'Charcoal tunnels',color:map.id==='skyport'?0x407bb4:0x53646e},{y:10,name:map.id==='skyport'?'Teal parking':'Orange furnace hall',color:map.id==='skyport'?0x30b9b2:0xc96f39},{y:20,name:map.id==='skyport'?'Yellow rooftops':'Green gantry',color:map.id==='skyport'?0xe8bb49:0x65ad88}];
  return map;
}
function skyport(){
  const m={id:'skyport',name:'Skyport',revision:'complex-1',complex:true,environment:'harbor',backdrop:'harbor',half:122,maxPlayers:32,description:'Three floors of parking, a spiral climb, twin roofs and sky bridges.',colliders:[solid('floor',0,-1,0,122,1,122,'asphalt'),...boundary()],routes:[],fallZones:[]};
  for(const [name,x] of [['west',-40],['east',40]])for(const level of [1,2])m.colliders.push(deck(`${name}-${level}`,x,level*10,0,22,30,`level-${level}`));
  for(const level of [1,2])for(const z of [18,-18]){
    if(level===2&&z===-18)continue;
    m.colliders.push(deck(`bridge-${level}-${z>0?'north':'south'}`,0,level*10,z,18,6,`level-${level}`));
  }
  m.colliders.push(ramp('street-climb',40,-62,14,64,0,10),
    deck('east-feeder',76,10,60,8,36),deck('east-feeder-elbow',62,10,24,22,6),deck('north-feeder',58,10,96,26,6),
    ramp('roof-climb',40,60,14,60,10,10,Math.PI),
    deck('roof-jump-landing',10,20,-18,8,6,'level-2'),ramp('roof-jump',-12,-18,12,12,20,1.8,Math.PI/2));
  m.routes.push({id:'street-climb',from:'floor',via:'street-climb',to:'east-1'},{id:'roof-climb',from:'north-feeder',via:'roof-climb',to:'east-2'});
  spiral(m,-40,-58);
  for(const level of [1,2])m.colliders.push(deck('spiral-exit-'+level,-58,level*10,-30,6,5,`level-${level}`));
  // Pillars leave twelve-metre aisles, including a clear street under each
  // tower. Rooftop utility rooms and middle-floor cover create short flanks.
  for(const x of [-58,-22,22,58])for(const z of [-20,20])m.colliders.push(solid(`pillar-${x}-${z}`,x,9.6,z,1,9.6,1,'pillar'));
  for(const level of [0,1,2])for(const [i,x,z] of [[0,-40,10],[1,40,-8]])m.colliders.push(solid(`cover-${level}-${i}`,x,level*10+1.6,z,4,1.6,3,level===2?'utility':'cover'));
  for(const [i,x,z] of [[0,-88,36],[1,8,-80],[2,86,-40],[3,-12,68]])m.colliders.push(solid('street-cover-'+i,x,2,z,6,2,4,'cover'));
  m.landmarks=[{kind:'helipad',surface:'west-2',x:-40,y:20,z:-8,label:'H / Rooftop'},{kind:'parking',surface:'east-1',x:40,y:10,z:12,label:'P / Parking'},{kind:'street',surface:'floor',x:0,y:0,z:45,label:'Blue streets'},{kind:'jump',surface:'roof-jump',x:-12,y:20.9,z:-18,label:'Roof gap'}];
  m.drops=[{from:'west-2',to:'floor',x:-62,z:0},{from:'east-2',to:'east-1',x:40,z:30}];
  const s=[['floor',40,0,-104,0],['east-1',40,10,20],['west-2',-40,20,-20],['floor',100,0,100],['west-1',-40,10,-18],['east-2',40,20,20],['floor',-90,0,90],['east-1',54,10,4]];
  for(const [surface,x,y,z] of [['floor',-40,0,-8],['floor',40,0,16],['floor',-100,0,0],['floor',100,0,0],['floor',0,0,100],['floor',0,0,-104],['floor',-96,0,65],['floor',96,0,-80]])s.push([surface,x,y,z]);
  for(const level of [1,2])for(const side of [-1,1])for(const [dx,z]of [[-8,-8],[8,-20],[0,26],[0,2]])s.push([`${side<0?'west':'east'}-${level}`,side*40+dx,level*10,z]);
  const c=[];
  for(const [x,z]of [[-104,-76],[-80,-100],[0,-100],[80,-100],[104,-60],[104,40],[84,100],[0,102],[-80,100],[-104,40],[-40,-8],[40,12],[-8,0],[0,48],[88,0],[-88,0]])c.push(['floor',x,0,z]);
  for(const level of [1,2]){
    for(const side of [-1,1])for(const [dx,z] of [[0,-20],[-10,-6],[10,12],[0,24],[-12,24],[12,-20]])c.push([`${side<0?'west':'east'}-${level}`,side*40+dx,level*10,z]);
    c.push([`bridge-${level}-north`,0,level*10,18],['spiral-exit-'+level,-58,level*10,-33]);
  }
  c.push(['bridge-1-south',0,10,-18],['roof-jump-landing',8,20,-18]);
  return finish(m,s,c);
}
function foundry(){
  const m={id:'foundry',name:'Foundry',revision:'complex-1',complex:true,environment:'industrial',backdrop:'quarry',half:122,maxPlayers:32,description:'Furnace tunnels, moving belts, a crane yard and a high gantry loop.',colliders:[
    solid('floor',0,-1,-39,122,1,83,'asphalt'),solid('floor-north',0,-1,99,122,1,23,'asphalt'),solid('floor-west',-43,-1,60,79,1,16,'asphalt'),solid('floor-east',93,-1,60,29,1,16,'asphalt'),solid('slag-bed',50,-18,60,14,1,16,'slag'),...boundary()],routes:[],fallZones:[{id:'molten-slag',x:50,z:60,halfX:14,halfZ:16,below:-1}],belts:[]};
  for(const side of [-1,1]){
    const key=side<0?'west':'east',x=side*50;
    m.colliders.push(deck(key+'-dock',x,10,0,10,30),deck(key+'-catwalk',0,10,side*24,40,6),
      deck(key+'-gantry',x,20,0,8,48,'level-2'),deck(key+'-high-crossing',0,20,side*40,42,8,'level-2'),
      ramp(key+'-loading-ramp',x,-62,14,64,0,10),
      deck(key+'-feeder',side*68,10,66,12,36),deck(key+'-feeder-elbow',side*50,10,36,10,12),
      ramp(key+'-gantry-ramp',x,72,14,48,10,10,Math.PI));
    m.routes.push({id:key+'-loading',from:'floor',via:key+'-loading-ramp',to:key+'-dock'},{id:key+'-gantry',from:'north-feed',via:key+'-gantry-ramp',to:key+'-gantry'});
  }
  m.colliders.push(deck('north-feed',0,10,102,80,6),deck('hall-west-crossing',-25,10,0,15,6),deck('hall-east-crossing',25,10,0,15,6),solid('furnace',0,10,0,9,10,9,'furnace'));
  spiral(m,-76,-66);
  m.colliders.push(deck('spiral-exit-1',-80,10,-36,20,6),deck('spiral-access',-66,10,-18,6,18),deck('spiral-exit-2',-79,20,-36,21,6,'level-2'));
  for(const x of [-36,36])for(const z of [-24,24])m.colliders.push(solid(`hall-pillar-${x}-${z}`,x,4.6,z,1,4.6,1,'pillar'));
  // Enclosed service tunnels under both hall wings. The centre openings
  // give each tunnel two end portals and two lateral exits, never a trap.
  for(const x of [-59,-41,41,59])for(const z of [-18,18])m.colliders.push(solid(`tunnel-wall-${x}-${z}`,x,4.6,z,.5,4.6,10,'pillar'));
  m.tunnels=[{id:'west-service',x:-50,z:20},{id:'east-service',x:50,z:20}];
  for(const [i,x,z]of [[0,87,-60],[1,101,-16]])m.colliders.push(solid('crane-foot-'+i,x,6,z,2.5,6,2.5,'pillar'));
  for(const level of [0,1,2])for(const side of [-1,1])m.colliders.push(solid(`cover-${level}-${side<0?'w':'e'}`,side*50,level*10+1.5,side*12,3,1.5,3,'cover'));
  for(const [i,x,z]of [[0,-26,-56],[1,20,32],[2,92,92],[3,-44,76]])m.colliders.push(solid('yard-cargo-'+i,x,2,z,5,2,4,'cover'));
  // Flush belts only push grounded karts in their own vertical layer.
  m.belts=[{id:'ore-belt',surface:'floor',x:24,y:0,z:-8,halfX:5,halfZ:25,velocity:{x:0,z:6}},{id:'return-belt',surface:'floor',x:-24,y:0,z:-8,halfX:5,halfZ:25,velocity:{x:0,z:-6}},{id:'sorter-belt',surface:'east-catwalk',x:0,y:10,z:24,halfX:24,halfZ:4,velocity:{x:5,z:0}}];
  m.landmarks=[{kind:'furnace',x:0,y:20,z:0,label:'Furnace'},{kind:'crane',x:94,y:12,z:-38,label:'Crane yard'},{kind:'gantry',surface:'east-high-crossing',x:0,y:20,z:40,label:'Green gantry'},{kind:'tunnel',surface:'floor',x:-50,y:0,z:0,label:'Service tunnels'},{kind:'slag',x:50,y:-1,z:60,label:'Molten slag'}];
  m.drops=[{from:'east-gantry',to:'floor',x:58,z:0},{from:'west-high-crossing',to:'floor',x:20,z:-48}];
  const s=[['floor',-50,0,-104,0],['west-dock',-50,10,18],['east-gantry',50,20,-16],['floor',100,0,-100],['east-dock',50,10,-18],['west-gantry',-50,20,20],['floor-north',0,0,114],['west-catwalk',0,10,-24]];
  for(const [surface,x,z] of [['floor',0,-104],['floor',100,0],['floor',-14,-38],['floor',14,-38],['floor',-104,-100],['floor-north',-100,100],['floor-east',104,60],['floor-west',-12,60]])s.push([surface,x,0,z]);
  for(const side of [-1,1])for(const z of [-24,0,24,36])s.push([`${side<0?'west':'east'}-gantry`,side*50,20,z]);
  for(const z of [-24,24])for(const x of [-26,-12,12,26])s.push([`${z<0?'west':'east'}-catwalk`,x,10,z]);
  const c=[];
  for(const [surface,x,z]of [['floor',-104,-92],['floor',0,-102],['floor',104,-84],['floor',96,-34],['floor',-104,20],['floor',0,-24],['floor',0,24],['floor',-24,12],['floor',24,12],['floor-west',0,60],['floor-east',96,60],['floor-north',72,104],['floor-north',-72,104],['floor',-50,6],['floor',50,6],['floor',78,16]])c.push([surface,x,0,z]);
  for(const side of [-1,1]){
    const key=side<0?'west':'east';
    for(const z of [-24,0,24])c.push([key+'-dock',side*50,10,z]);
    for(const x of [-26,0,26])c.push([key+'-catwalk',x,10,side*24]);
    for(const z of [-34,-22,22,34])c.push([key+'-gantry',side*50,20,z]);
    for(const x of [-24,0,24])c.push([key+'-high-crossing',x,20,side*40]);
  }
  c.push(['spiral-exit-1',-84,10,-36],['spiral-exit-2',-84,20,-36],['north-feed',0,10,102]);
  return finish(m,s,c);
}
export const complexMaps = {skyport:skyport(),foundry:foundry()};

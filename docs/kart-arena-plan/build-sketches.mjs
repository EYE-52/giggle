/** Planning drawings only. Does not write game files. See ../kart-arena-plan.md. */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {elevatedMap, elevatedMapIds} from '../../apps/games/public/js/engines/kart-elevated-maps.mjs';
import {elevatedStatics} from '../../apps/games/public/js/engines/kart-feature-solids.mjs';
const require=createRequire(import.meta.url);
const {MAPS}=require('../../apps/games/games/engines/kart-maps.js');
const {crowdSpawns}=require('../../apps/games/games/engines/kart-spawns.js');
const dir=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(dir,'../..');
const C={bg:'#102633',panel:'#183542',grid:'#294653',text:'#f4f1dc',muted:'#b9cccf',L0:'#79bda8',L1:'#eec764',L2:'#c49df4',ramp:'#ef9372',cover:'#516979',box:'#ffcf49',spawn:'#f5ffff',hazard:'#e55e67'};
const esc=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const text=(x,y,s,size=16,color=C.text)=>`<text x="${x}" y="${y}" font-size="${size}" fill="${color}">${esc(s)}</text>`;
const start=(title,sub,w=1000,h=760)=>`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(title)}"><rect width="100%" height="100%" fill="${C.bg}"/><g font-family="Arial, sans-serif">${text(30,40,title,27)}${text(30,69,sub,15,C.muted)}`;
const end='</g></svg>';
const legend=(y=706)=>`${text(30,y,'L0 ground',15,C.L0)}${text(150,y,'L1 deck',15,C.L1)}${text(260,y,'L2 roof',15,C.L2)}${text(370,y,'coral = ramp',15,C.ramp)}${text(520,y,'■ box / cluster',15,C.box)}${text(710,y,'△ spawn bay',15,C.spawn)}${text(30,y+25,'Red = danger / void   •   Dark blocks = cover   •   Dashed arrows = drops / jumps   •   N = −z',14,C.muted)}`;
const write=(name,svg)=>{fs.writeFileSync(path.join(dir,name+'.svg'),svg);return name+'.svg';};
const group=a=>Object.fromEntries([...new Set(a.map(p=>Math.round(p.y||0)))].sort((a,b)=>a-b).map(y=>[y,a.filter(p=>Math.round(p.y||0)===y).length]));
const distance=(p,q)=>Math.hypot(p.x-q.x,(p.y||0)-(q.y||0),p.z-q.z);
const minimum=a=>Math.min(...a.flatMap((p,i)=>a.slice(i+1).map(q=>distance(p,q))));
let records=[];
for(const [id,m] of Object.entries(MAPS))records.push({kind:'classic',id:'classic-'+id,name:m.label,width:2*m.half,levels:[0],sockets:m.spots.length,live:'6 / 10 / 10',starts:m.spawns.length,startsMax:32,firstPair:distance(...m.spawns.slice(0,2)),minMax:minimum(crowdSpawns(m,32)),revision:m.revision,map:m});
for(const id of elevatedMapIds){const m=elevatedMap(id);records.push({kind:'raised',id:'raised-'+id,name:m.name,width:2*m.half,levels:m.levels.map(l=>l.y),sockets:m.sockets.length,socketsByLevel:group(m.sockets),live:m.complex?'9 / 9 / 12':'6 / 6 / unavailable',starts:m.spawns.length,startsMax:m.spawns.length,spawnsByLevel:group(m.spawns),firstPair:distance(...m.spawns.slice(0,2)),minMax:minimum(m.spawns),mapColliders:m.colliders.length,totalStatics:elevatedStatics(m).length,revision:m.revision,map:m});}
fs.writeFileSync(path.join(dir,'audit-data.json'),JSON.stringify({note:'Source-derived geometry, not playtest or FPS evidence. Live box columns: 2 / 8 / 32 players. Frost y=.12 is grouped into L0. Distance is Euclidean in 3D.',maps:records.map(({map,...r})=>r)},null,2)+'\n');
const files=[];
for(const r of records){
 const m=r.map,n=r.levels.length,panelW=n===1?620:Math.floor(920/n),panelH=n===1?510:470,ox=n===1?190:40,oy=112;
 let s=start('CURRENT · '+r.name,`${r.width} × ${r.width} m square bounds · ${r.sockets} placed sockets · live boxes at 2 / 8 / 32 seats: ${r.live}`);
 for(let i=0;i<n;i++){
  const level=r.levels[i],size=Math.min(panelW-24,panelH-45),sc=size/(2*m.half),x=ox+i*panelW+12,y=oy+40;
  const px=v=>x+(v+m.half)*sc,pz=v=>y+(v+m.half)*sc;
  const rect=(cx,cz,hx,hz,fill,stroke='none',extra='')=>`<rect x="${px(cx-hx)}" y="${pz(cz-hz)}" width="${2*hx*sc}" height="${2*hz*sc}" fill="${fill}" stroke="${stroke}" ${extra}/>`;
  s+=text(x,oy+15,`L${i} · y=${level} m`,18,[C.L0,C.L1,C.L2][i]);
  s+=rect(0,0,m.half,m.half,C.panel,C.grid);
  for(let k=-m.half;k<=m.half;k+=m.half/4)s+=`<path d="M${px(k)} ${pz(-m.half)}V${pz(m.half)} M${px(-m.half)} ${pz(k)}H${px(m.half)}" stroke="${C.grid}" stroke-width=".7"/>`;
  if(r.kind==='classic'){
   for(const d of m.roads)s+=`<polyline points="${[...d.points,...(d.closed?[d.points[0]]:[])].map(([a,b])=>[px(a),pz(b)].join(',')).join(' ')}" fill="none" stroke="${C.L0}" stroke-opacity=".45" stroke-width="${d.width*sc}" stroke-linejoin="round"/>`;
   for(const d of m.surfaces)s+=rect(d.x,d.z,d.hw,d.hd,'#83cbea','none','opacity=".65"');
   for(const d of [...m.blocks,...m.barriers])s+=rect(d.x,d.z,d.hw,d.hd,C.cover,'#9cb2ba');
   for(const d of m.ramps)s+=`<g transform="translate(${px(d.x)} ${pz(d.z)}) rotate(${-d.angle*180/Math.PI})"><rect x="${-d.hw*sc}" y="${-d.hl*sc}" width="${2*d.hw*sc}" height="${2*d.hl*sc}" fill="${C.ramp}"/></g>`;
   for(const d of m.features.falls)s+=rect(d.x,d.z,d.hw,d.hd,C.hazard);
  }else{
   // Slice: only surfaces at this height; no opaque upper decks hiding lower routes.
   for(const d of m.colliders){
    const top=d.position.y+d.half.y,base=d.position.y-d.half.y;
    if(d.material==='ice'&&i===0)s+=rect(d.position.x,d.position.z,d.half.x,d.half.z,'#83cbea');
    if(d.shape==='deck'&&Math.abs(top-level)<.2)s+=rect(d.position.x,d.position.z,d.half.x,d.half.z,[C.L0,C.L1,C.L2][i],C.muted,'opacity=".7"');
    if(d.shape==='wedge'&&base>=level-.2&&base<level+10)s+=`<g transform="translate(${px(d.position.x)} ${pz(d.position.z)}) rotate(${-2*Math.atan2(d.rotation?.y||0,d.rotation?.w??1)*180/Math.PI})"><rect x="${-d.half.x*sc}" y="${-d.half.z*sc}" width="${2*d.half.x*sc}" height="${2*d.half.z*sc}" fill="${C.ramp}" opacity=".8"/></g>`;
    if(d.shape==='box'&&base<=level+.2&&top>level+.5&&!/^floor|boundary|bed/.test(d.id))s+=rect(d.position.x,d.position.z,d.half.x,d.half.z,C.cover,'#9cb2ba');
   }
   if(i===0)for(const d of m.fallZones||[])s+=rect(d.x,d.z,d.halfX,d.halfZ,C.hazard);
  }
  const pts=r.kind==='classic'?m.spots.map(([x,z])=>({x,z,y:0})):m.sockets;
  for(const p of pts.filter(p=>Math.abs((p.y||0)-level)<.3))s+=`<rect x="${px(p.x)-2.7}" y="${pz(p.z)-2.7}" width="5.4" height="5.4" fill="${C.box}"/>`;
  for(const [j,p] of m.spawns.entries())if(Math.abs((p.y||0)-level)<.3){const a=p.angle||0;s+=`<g transform="translate(${px(p.x)} ${pz(p.z)}) rotate(${-a*180/Math.PI})"><path d="M0 5 L-4 -4 L4 -4 Z" fill="${C.spawn}" stroke="${C.bg}" stroke-width=".8"/></g>`;if(j<2)s+=text(px(p.x)+5,pz(p.z)-4,String(j+1),13);}
  for(const c of m.features?.cannons||[])if(Math.abs((c.y||0)-level)<.3)s+=text(px(c.x)-4,pz(c.z)+4,'C',13,C.ramp);
  for(const p of m.features?.portals?.flat()||[])if(Math.abs((p.y||0)-level)<.3)s+=text(px(p.x)-4,pz(p.z)+4,'P',13,C.L2);
  s+=text(x,y+size+22,`N ↑ · grid = ${m.half/4} m`,13,C.muted);
 }
 if(n>1){s+=text(40,645,`Starts per level: ${JSON.stringify(r.spawnsByLevel)} · sockets per level: ${JSON.stringify(r.socketsByLevel)}`,16);s+=text(40,673,`${r.mapColliders} map solids / ${r.totalStatics} including feature frames · triangles are not inferred from this diagram`,14,C.muted);}
 else s+=text(30,682,`${m.spawns.length} authored starts; crowd pool produces 32. Small kickers do not create a second fighting level.`,15,C.muted);
 s+=legend()+end;files.push(write('audit-'+r.id,s));
}
// New plans are route diagrams, not collider blueprints. Coordinates are in metres.
// route: level, width, points. Ground silhouette must be actual legal ground.
const plans=[
 {id:'rookie-ribbons',name:'Rookie Ribbons',size:[76,48],heights:[0,6],shape:[[-38,-18],[-28,-24],[-12,-20],[-6,-10],[6,-10],[12,-20],[28,-24],[38,-18],[38,18],[28,24],[12,20],[6,10],[-6,10],[-12,20],[-28,24],[-38,18]],routes:[[0,10,[[-26,-12],[-12,0],[-26,12],[-30,0],[-26,-12]]],[0,10,[[26,-12],[12,0],[26,12],[30,0],[26,-12]]],[0,10,[[-12,0],[12,0]]],[1,10,[[-16,-12],[-8,-12],[8,-12],[16,-12]]]],ramps:[[[-26,4],[-26,-12],[-16,-12]],[[26,4],[26,-12],[16,-12]]],cover:[[-23,0,3,3],[23,0,3,3]],boxes:[[-30,-12,4,0],[-30,12,4,0],[30,-12,4,0],[30,12,4,0],[0,-12,4,1]],spawns:[[-33,0],[33,0],[-18,16],[18,16]],labels:[[-10,15,'A · lower crossing'],[-8,-20,'B · toy arch L1']],drops:[[[-8,-12],[-8,0]],[[8,-12],[8,0]]],side:'Two low ramps reach the arch. Open lower crossing runs beneath it.',section:[[60,280],[180,280],[300,160],[600,160],[720,280],[920,280]],sideLabels:['L1 +6 m · arch bridge','L0 0 m · both lobes'],note:'Dumbbell · 2–8 seats · 20 sockets · 12–18 live',socketLevels:[16,4]},
 {id:'garden-crown',name:'Garden Crown',size:[100,96],heights:[0,7],shape:[[-16,-48],[16,-48],[24,-34],[44,-34],[50,-16],[36,0],[50,16],[44,34],[24,34],[16,48],[-16,48],[-24,34],[-44,34],[-50,16],[-36,0],[-50,-16],[-44,-34],[-24,-34]],routes:[[0,12,[[0,-32],[30,0],[0,32],[-30,0],[0,-32]]],[0,10,[[-30,0],[30,0]]],[1,12,[[-22,-12],[0,-28],[22,-12],[22,12],[0,28],[-22,12],[-22,-12]]]],ramps:[[[-34,-22],[-30,-10],[-22,-12]],[[34,22],[30,10],[22,12]]],cover:[[0,0,7,7],[-25,22,5,2],[25,-22,5,2]],boxes:[[0,-35,6,0],[35,0,6,0],[0,35,6,0],[-35,0,6,0],[-19,-12,4,1],[0,-25,4,1],[19,12,4,1],[0,25,4,1]],spawns:[[0,-42],[42,-16],[0,42],[-42,16],[-30,-28],[30,28]],labels:[[-11,4,'A · fountain'],[-20,-35,'B · crown walk L1']],drops:[[[-22,12],[-30,16]],[[22,-12],[30,-16]]],side:'Garden rooms connect under the crown. Fountain stays below the sightline.',section:[[60,280],[170,280],[320,140],[650,140],[790,280],[920,280]],sideLabels:['L1 +7 m · crown promenade','L0 0 m · fountain / garden rooms'],note:'Four-lobe clover · 4–16 seats · 40 sockets · 13–28 live',socketLevels:[24,16]},
 {id:'frostbite-crescent',name:'Frostbite Crescent',size:[104,88],heights:[0,8],shape:[[-52,-20],[-36,-40],[-8,-44],[24,-36],[44,-16],[52,12],[36,36],[8,44],[-24,40],[-44,24],[-20,24],[0,26],[20,16],[20,-4],[4,-20],[-20,-20],[-36,-8]],routes:[[0,12,[[-38,-22],[-22,-32],[2,-32],[30,-20],[38,8],[24,27],[0,33],[-24,30]]],[0,12,[[-20,30],[0,30],[20,22],[28,0]]],[1,12,[[-22,-29],[0,-25],[24,-12],[28,10],[10,24]]]],ramps:[[[-42,-16],[-34,-28],[-22,-29]],[[28,30],[22,26],[10,24]]],cover:[[-29,-24,3,2],[31,-2,3,4],[4,29,3,2]],boxes:[[-36,-20,5,0],[-8,-32,5,0],[35,10,5,0],[-20,30,5,0],[25,8,6,0],[-19,-29,6,1],[20,-14,6,1],[13,23,6,1]],spawns:[[-43,-16],[3,-38],[41,18],[-16,34],[-24,-30],[22,30]],labels:[[25,8,'A · low-grip ice'],[-2,-29,'B · quarry shelf L1']],drops:[[[24,-12],[18,-5]],[[10,24],[0,18]]],side:'The shelf crosses above the solid ice bowl; the inner bite is marked water.',section:[[60,280],[190,280],[360,120],[650,120],[810,280],[920,280]],sideLabels:['L1 +8 m · quarry bridge / shelf','L0 0 m · shore / ice bowl'],note:'Crescent · 6–16 seats · 44 sockets · 16–28 live',socketLevels:[26,18]},
 {id:'neon-switchyard',name:'Neon Switchyard',size:[120,84],heights:[0,7],shape:[[-60,-18],[-40,-42],[40,-42],[60,-18],[60,18],[40,42],[-40,42],[-60,18]],routes:[[0,12,[[-44,-22],[0,-28],[44,-22],[44,22],[0,28],[-44,22],[-44,-22]]],[0,10,[[-44,4],[-12,4],[12,-4],[44,-4]]],[1,12,[[-30,-12],[0,-12],[30,-12],[30,12],[0,12],[-30,12],[-30,-12]]]],ramps:[[[-50,20],[-50,-6],[-30,-12]],[[50,-20],[50,6],[30,12]]],cover:[[-17,0,5,3],[17,0,5,3],[-22,28,5,2],[22,-28,5,2]],boxes:[[-42,-23,6,0],[42,-23,6,0],[-42,23,6,0],[42,23,6,0],[-26,-12,6,1],[26,12,6,1],[0,-12,6,1],[0,12,6,1]],spawns:[[-52,0],[52,0],[-32,-33],[32,33],[32,-33],[-32,33]],labels:[[-23,8,'A · market lanes'],[-18,-17,'B · sign bridge L1']],drops:[[[-20,-12],[-20,-22]],[[20,12],[20,22]]],side:'Market lanes pass below two sign bridges. The middle remains open sky.',section:[[60,280],[180,280],[320,140],[420,140],[480,280],[540,280],[600,140],[700,140],[820,280],[920,280]],sideLabels:['L1 +7 m · twin bridges','L0 0 m · offset market streets'],note:'Long hexagon · 6–24 seats · 48 sockets · 16–38 live',socketLevels:[24,24]},
 {id:'harbor-fork',name:'Harbor Fork',size:[128,112],heights:[0,7,14],shape:[[-64,-56],[-36,-56],[-36,-12],[-16,-12],[-16,-56],[16,-56],[16,-12],[36,-12],[36,-56],[64,-56],[64,56],[-64,56]],routes:[[0,14,[[-50,-40],[-50,36],[50,36],[50,-40]]],[0,14,[[0,-40],[0,36]]],[1,14,[[-50,0],[0,0],[50,0]]],[1,14,[[-50,0],[-50,22],[0,22],[50,22],[50,0]]],[2,14,[[-24,35],[0,35],[24,35]]]],ramps:[[[-50,-42],[-50,-18],[-50,0]],[[50,-42],[50,-18],[50,0]],[[-46,44],[-24,44],[-24,35]],[[46,44],[24,44],[24,35]]],cover:[[-28,38,5,4],[28,38,5,4],[0,-4,4,5]],boxes:[[-50,-35,8,0],[0,-35,8,0],[50,-35,8,0],[-42,36,8,0],[-45,4,8,1],[45,4,8,1],[0,22,4,1],[0,35,12,2]],spawns:[[-53,-48],[0,-48],[53,-48],[-53,48],[0,48],[53,48],[-24,22],[24,22]],labels:[[-29,-24,'A · open water gaps'],[-25,16,'B · dock loop L1'],[-20,47,'C · lookout L2']],drops:[[[-24,35],[-34,42]],[[24,35],[34,42]]],side:'Three ground fingers join at the back. The lookout has two climbs.',section:[[60,280],[190,280],[330,175],[410,175],[510,70],[620,70],[720,175],[780,175],[900,280]],sideLabels:['L2 +14 m · lookout','L1 +7 m · cargo loop','L0 0 m · three dock fingers'],note:'Trident · 8–32 seats · 64 sockets · 23–48 live',socketLevels:[32,20,12]},
 {id:'skyport-split',name:'Skyport Split',size:[144,112],heights:[0,10,20],shape:[[-72,-36],[-52,-56],[-20,-56],[-12,-20],[12,-20],[20,-56],[52,-56],[72,-36],[72,36],[52,56],[20,56],[12,20],[-12,20],[-20,56],[-52,56],[-72,36]],routes:[[0,16,[[-46,-32],[-26,0],[-46,32],[-58,0],[-46,-32]]],[0,16,[[46,-32],[26,0],[46,32],[58,0],[46,-32]]],[0,14,[[-26,0],[26,0]]],[1,16,[[-46,-22],[46,-22],[46,22],[-46,22],[-46,-22]]],[2,16,[[-46,-22],[-46,22],[46,22],[46,-22]]],[2,16,[[-46,-22],[-6,-22]]],[2,16,[[6,-22],[46,-22]]]],ramps:[[[-62,-30],[-60,0],[-46,-22]],[[62,30],[60,0],[46,22]],[[-58,36],[-40,40],[-46,22]],[[58,-36],[40,-40],[46,-22]]],cover:[[-46,0,6,6],[46,0,6,6]],boxes:[[-58,-24,8,0],[-58,24,8,0],[58,-24,8,0],[58,24,8,0],[-38,-22,8,1],[38,22,8,1],[-38,22,8,2],[38,-22,8,2],[0,22,8,2]],spawns:[[-60,-36],[60,36],[-60,36],[60,-36],[-30,-28],[30,28],[-30,28],[30,-28]],labels:[[-62,10,'A · west tower'],[28,10,'B · east tower'],[-19,29,'C · roof bridge'],[-24,-30,'J · optional gap']],drops:[[[ -6,-22],[6,-22]],[[-38,22],[-24,8]],[[38,-22],[24,-8]]],side:'Two towers face across a street saddle; one safe roof bridge bypasses the gap.',section:[[60,280],[180,280],[330,175],[400,175],[520,70],[650,70],[750,175],[820,175],[920,280]],sideLabels:['L2 +20 m · rooftop loop','L1 +10 m · parking loop','L0 0 m · street saddle'],note:'Twin-lobe silhouette · 8–32 seats · 72 sockets · 25–48 live',socketLevels:[32,16,24]},
 {id:'foundry-wheel',name:'Foundry Wheel',size:[136,128],heights:[0,8,16],shape:[[-40,-64],[40,-64],[68,-36],[68,36],[40,64],[-40,64],[-68,36],[-68,-36]],hole:[[-18,-18],[18,-18],[18,18],[-18,18]],routes:[[0,16,[[-42,-38],[42,-38],[48,32],[0,46],[-48,32],[-42,-38]]],[1,14,[[-42,-36],[42,-36],[42,36],[-42,36],[-42,-36]]],[2,14,[[-34,-28],[-34,28],[34,28],[34,-28],[-34,-28]]]],ramps:[[[-56,-40],[-56,-6],[-35,-28]],[[56,40],[56,6],[35,28]],[[-52,44],[-28,44],[-34,28]],[[52,-44],[28,-44],[34,-28]]],cover:[[-44,0,4,6],[44,0,4,6],[0,-42,6,3],[0,44,6,3]],boxes:[[-48,-32,8,0],[48,32,8,0],[-45,32,6,0],[45,-32,6,0],[-32,-25,8,1],[32,25,8,1],[-32,25,8,2],[32,-25,8,2],[0,28,4,2]],spawns:[[-56,-34],[56,34],[-56,34],[56,-34],[-24,-52],[24,52],[-24,52],[24,-52]],labels:[[-14,5,'A · furnace void'],[-60,8,'B · belt'],[27,-8,'C · return belt'],[-22,38,'D · gantry L2']],drops:[[[-34,28],[-46,32]],[[34,-28],[46,-32]]],side:'Three rings surround a sealed furnace void; two service ramps reach each tier.',section:[[60,280],[180,280],[340,160],[420,160],[530,70],[650,70],[750,160],[830,160],[920,280]],sideLabels:['L2 +16 m · gantry ring','L1 +8 m · service ring','L0 0 m · conveyor yard'],note:'Octagonal ring · 8–32 seats · 64 sockets · 24–48 live',socketLevels:[28,16,20]},
];
for(const p of plans){
 const sc=Math.min(830/p.size[0],480/p.size[1]),px=x=>500+x*sc,pz=z=>362+z*sc;
 const pts=a=>a.map(([x,z])=>`${px(x)},${pz(z)}`).join(' ');
 let s=start('PLAN · '+p.name,p.note);
 s+=`<defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0 0 L6 3 L0 6" fill="none" stroke="${C.ramp}"/></marker></defs>`;
 s+=`<polygon points="${pts(p.shape)}" fill="${C.panel}" stroke="${C.L0}" stroke-width="3"/>`;
 if(p.hole)s+=`<polygon points="${pts(p.hole)}" fill="${C.bg}" stroke="${C.hazard}" stroke-width="4"/>`;
 for(const [level,width,route] of p.routes)s+=`<polyline points="${pts(route)}" stroke="${[C.L0,C.L1,C.L2][level]}" stroke-width="${width*sc}" fill="none" stroke-linejoin="round" opacity="${level===0?.4:.75}"/>`;
 for(const route of p.ramps)s+=`<polyline points="${pts(route)}" fill="none" stroke="${C.ramp}" stroke-width="${6*sc}" stroke-linejoin="round"/><polyline points="${pts(route)}" fill="none" stroke="${C.bg}" stroke-width="1.5" marker-end="url(#arrow)"/>`;
 for(const [x,z,hx,hz] of p.cover)s+=`<rect x="${px(x-hx)}" y="${pz(z-hz)}" width="${hx*2*sc}" height="${hz*2*sc}" fill="${C.cover}" stroke="${C.muted}"/>`;
 for(const [x,z,count,level] of p.boxes)s+=`<rect x="${px(x)-18}" y="${pz(z)-11}" width="36" height="22" rx="4" fill="${C.box}" stroke="${C.bg}"/><text x="${px(x)}" y="${pz(z)+5}" text-anchor="middle" font-size="14" fill="${C.bg}">${count}</text>${text(px(x)+19,pz(z)+4,'L'+level,11,C.box)}`;
 for(const [x,z] of p.spawns)s+=`<path d="M${px(x)} ${pz(z)-8}l-7 14h14Z" fill="${C.spawn}" stroke="${C.bg}" stroke-width="2"/>`;
 for(const route of p.drops)s+=`<polyline points="${pts(route)}" fill="none" stroke="${C.ramp}" stroke-width="2" stroke-dasharray="6 4" marker-end="url(#arrow)"/>`;
 // Numbered callouts are placed outside the road drawing to keep routes visible.
 s+=text(30,101,'N ↑',17)+text(740,101,`Bounds ${p.size.join(' × ')} m`,17);
 p.labels.forEach(([_x,_z,label],i)=>{s+=text(30+(i%2)*480,642+Math.floor(i/2)*23,label,15);});
 s+=legend()+end;files.push(write('plan-'+p.id+'-top',s));
 let e=start('SECTION · '+p.name,'Schematic route height profile · horizontal distance is not to scale',1000,450);
 for(let i=0;i<p.heights.length;i++){const y=p.heights.length===2?(i===0?280:p.heights[1]===8?120:p.heights[1]===6?160:140):i===0?280:i===1?(p.heights[1]===10||p.heights[1]===7?175:160):70;e+=`<path d="M45 ${y}H950" stroke="${C.grid}" stroke-dasharray="5 6"/>`;}
 e+=`<polyline points="${p.section.map(([x,y])=>[330+(x-60)*.65,110+y*.65].join(',')).join(' ')}" fill="none" stroke="${C.L1}" stroke-width="11" stroke-linejoin="round"/>`;
 // Lower bypass remains independent of the upper height profile.
 e+=`<path d="M330 304H920" stroke="${C.L0}" stroke-width="9"/>${text(30,337,'Ground bypass stays open; every upper route has two ways down.',15,C.L0)}`;
 p.sideLabels.forEach((l,i)=>{e+=text(30,130+i*29,l,17,[C.L2,C.L1,C.L0].slice(3-p.heights.length)[i]);});
 e+=text(30,370,p.side,16)+text(30,403,'Heights are support surfaces. Ramps need measured runs; this is not a ramp angle drawing.',14,C.muted)+end;
 files.push(write('plan-'+p.id+'-side',e));
}
fs.writeFileSync(path.join(dir,'plan-data.json'),JSON.stringify(plans,null,2)+'\n');
fs.writeFileSync(path.join(dir,'sketch-index.json'),JSON.stringify(files,null,2)+'\n');
if(process.argv.includes('--render')){
 const moduleName=process.env.KART_PLAN_PLAYWRIGHT||'playwright';
 const {chromium}=await import(moduleName);
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage({viewport:{width:3500,height:2800},deviceScaleFactor:1});
  const cards=files.map(f=>`<div class="card"><img alt="${esc(f)}" src="data:image/svg+xml;base64,${fs.readFileSync(path.join(dir,f)).toString('base64')}"/></div>`).join('');
  await page.setContent(`<html><head><style>*{box-sizing:border-box}body{margin:0;background:${C.bg};display:grid;grid-template-columns:repeat(5,700px)}.card{height:560px;border:3px solid ${C.grid};display:flex;align-items:center}.card img{display:block;width:100%;max-height:100%;object-fit:contain}</style></head><body>${cards}</body></html>`);
  await page.evaluate(()=>Promise.all([...document.images].map(i=>i.decode())));
  const out=path.join(root,'artifacts/kart-arena-plan');fs.mkdirSync(out,{recursive:true});
  await page.screenshot({path:path.join(out,'contact-sheet.png'),fullPage:true});
 }finally{await browser.close();}
}
console.log(`Wrote ${records.length} source audits, ${plans.length} proposed layouts, ${files.length} SVG sketches${process.argv.includes('--render')?' and contact sheet':''}.`);

// Small, merged detail pieces share the world materials and metre-scale atlas.
// Solid decoration stays inside authored cover. Floor paint is flat; scenery
// signs sit outside the guarded footprint. There is no per-frame prop work.
export function addLaunchDetails(THREE,{map,soft,scenery,geo,add,M,glow,unit}){
 const flat=geo(new THREE.PlaneGeometry(1,1).rotateX(-Math.PI/2));
 const glyphs={H:['11011','11011','11011','11111','11011','11011','11011'],P:['11110','11011','11011','11110','11000','11000','11000'],'2':['11110','00011','00011','01110','11000','11000','11111'],A:['01110','11011','11011','11111','11011','11011','11011'],B:['11110','11011','11011','11110','11011','11011','11110']};
 for(const p of map.landmarks||[]){const glyph=glyphs[p.symbol];if(!glyph||map.artId==='ring')continue;
  const scale=1.1;for(let row=0;row<7;row++)for(let col=0;col<5;col++)if(glyph[row][col]==='1')add(soft,flat,M.white,[p.x+(col-2)*scale,p.y+.035,p.z+(row-3)*scale],[scale*.9,1,scale*.9]);
 }
 if(map.artId==='skyport'){
  // Parking stripes and generous turning bays are bounded by their deck.
  for(const d of map.colliders.filter(d=>/^(west|east)-[12]$/.test(d.id))){const y=d.position.y+d.half.y+.025;
   for(const side of[-1,1])for(let z=d.position.z-d.half.z+6;z<d.position.z+d.half.z-4;z+=7){
    const x=d.position.x+side*(d.half.x-4);add(soft,flat,M.white,[x,y,z],[6.5,1,.14]);add(soft,flat,M.yellow,[d.position.x+side*(d.half.x-.8),y,z],[.14,1,5.8]);
   }
   for(let z=d.position.z-d.half.z+4;z<d.position.z+d.half.z-3;z+=5)add(soft,flat,M.yellow,[d.position.x,y,z],[.15,1,2]);
  }
  // The core is the structural and visual anchor of the west helix.
  const core=map.colliders.find(d=>d.role==='core');if(core){const {x,y,z}=core.position,h=core.half,s=map.artScale||1;for(const side of[-1,1])for(let yy=y-h.y+3*s;yy<y+h.y;yy+=3*s){add(soft,unit,M.blue,[x,yy,z+side*(h.z-.01)],[h.x*1.75,.8*s,.02]);add(soft,unit,glow,[x,yy+.5*s,z+side*(h.z+.01)],[h.x*1.6,.08*s,.02]);}for(let dx=-h.x*.6;dx<h.x*.7;dx+=2*s)add(soft,unit,M.dark,[x+dx,y+h.y+.05,z],[.35*s,.05,h.z*1.75]);}
  // Ground taxi kiosks and roof utility pods use the same cover envelopes.
  const wheel=geo(new THREE.CylinderGeometry(.65,.65,.3,10).rotateX(Math.PI/2)),vent=geo(new THREE.CylinderGeometry(.8,.8,.08,12));
  for(const d of map.colliders.filter(d=>d.material==='cargo')){
   const {x,y,z}=d.position,h=d.half;
   for(const side of[-1,1]){
    add(soft,unit,M.blue,[x,y+.35,z+side*(h.z-.01)],[h.x*1.65,.85,.025]);
    for(const dx of[-2.7,2.7])add(soft,wheel,M.dark,[x+dx*h.x/4,y-h.y+.7*(map.artScale||1),z+side*(h.z-.2)],Array(3).fill(map.artScale||1));
    for(const dx of[-3.3,3.3])add(soft,unit,glow,[x+dx*h.x/4,y-.4*(map.artScale||1),z+side*(h.z-.005)],[.5,.28,.025]);
   }
   for(const dx of[-1.4,1.4]){add(soft,vent,M.dark,[x+dx*h.x/4,y+h.y-.03,z]);for(let i=0;i<3;i++)add(soft,unit,M.white,[x+dx*h.x/4,y+h.y+.015,z],[1.1,.025,.08],[0,i*Math.PI/3,0]);}
  }
  // Tiny runway lamps border real streets; no extra point lights.
  for(const d of map.colliders.filter(d=>d.id.startsWith('floor'))){const {x,z}=d.position,h=d.half;for(let t=-h.z+2;t<h.z;t+=8)for(const side of[-1,1])add(soft,unit,glow,[x+side*(h.x-.45),.025,z+t],[.35,.05,.7]);}
 }
 if(map.artId==='garden'){
  const water=new THREE.MeshLambertMaterial({color:0x69cfdd,emissive:0x154959,emissiveIntensity:.4});M.own(water);
  const fountain=map.colliders.find(d=>d.material==='fountain');if(fountain){const {x,y,z}=fountain.position,h=fountain.half;
   add(soft,unit,water,[x,y+h.y+.015,z],[h.x*1.7,.025,h.z*1.7]);
   const bowl=geo(new THREE.TorusGeometry(2,.24,6,20).rotateX(Math.PI/2));add(soft,bowl,M.white,[x,y+h.y+.05,z]);
   const stream=geo(new THREE.CylinderGeometry(.12,.3,1.8,6));add(soft,stream,water,[x,y+h.y+.9,z]);
   for(const side of[-1,1])for(const t of[-3.7,-1.85,0,1.85,3.7])add(soft,unit,M.blue,[x+t,y+.1,z+side*(h.z+.008)],[.65,1.6,.02]);
  }
  const core=map.colliders.find(d=>d.role==='fountain-core');if(core){
   add(soft,geo(new THREE.CylinderGeometry(.3,.55,1.5,8)),M.white,[0,3.15,0]);
   add(soft,geo(new THREE.CylinderGeometry(.75,.35,.4,8)),M.yellow,[0,3.95,0]);
   for(const sx of[-1,1])for(const sz of[-1,1])add(soft,unit,M.yellow,[sx*.55,4.3,sz*.55],[.28,.55,.28]);
   add(soft,geo(new THREE.CylinderGeometry(.6,.6,.03,12)),water,[0,4.16,0]);
  }
  const bush=geo(new THREE.IcosahedronGeometry(.7,0));for(const d of map.colliders.filter(d=>d.material==='hedge'))for(let x=-d.half.x+.7;x<d.half.x;x+=1.1)for(const side of[-1,1])add(soft,bush,M.green,[d.position.x+x,d.position.y+.35,d.position.z+side*(d.half.z-.6)],[1,.75,.85]);
  const bloom=geo(new THREE.IcosahedronGeometry(.3,0)),stem=geo(new THREE.CylinderGeometry(.05,.05,.6,5));
  for(const sx of[-1,1])for(const sz of[-1,1]){const x=sx*41,z=sz*40;add(scenery,unit,M.edge,[x,-.9,z],[7,.8,7]);add(scenery,unit,M.dark,[x,-.48,z],[6.5,.05,6.5]);
   for(let dx=-2;dx<=2;dx+=2)for(let dz=-2;dz<=2;dz+=2){add(scenery,stem,M.green,[x+dx,-.1,z+dz]);add(scenery,bloom,sx===sz?M.cover:M.yellow,[x+dx,.25,z+dz],[1.3,.6,1.3]);}
  }
 }

 if(map.artId==='frost'){
  const ice=map.colliders.find(d=>d.material==='ice');if(ice){let seed=416;const rand=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);for(let i=0;i<36;i++)add(soft,flat,M.white,[3.5+rand()*13,.025,-20+rand()*40],[2+rand()*4,1,.05],[0,rand()*Math.PI,0]);for(let z=-20;z<=20;z+=8)add(soft,flat,M.white,[20.1,.02,z],[.24,1,2]);}
  // A quarry hoist outside the shore guard gives the crescent a fixed north.
  add(scenery,unit,M.dark,[-28,5,-55],[2,13,2]);add(scenery,unit,M.yellow,[-12,11,-55],[34,1.2,2]);
  for(let x=-27;x<=3;x+=5)add(scenery,unit,M.blue,[x,11,-55],[.25,3,1.3],[0,0,.6]);
  add(scenery,unit,M.dark,[2,7,-55],[.12,7,.12]);add(scenery,unit,M.yellow,[2,3.8,-55],[1.2,.5,1.2]);
  const snow=geo(new THREE.IcosahedronGeometry(3,0));for(const side of[-1,1])for(let i=0;i<4;i++)add(scenery,snow,M.white,[side*(map.playBounds.halfX+8),-.6,-30+i*20],[1.5,.65,1]);
 }

 if(map.artId==='neon'){
  // Shuttered market stalls: patterned awnings and insets remain inside each
  // physical cover mass. Colour and glyphs identify opposite route choices.
  for(const d of map.colliders.filter(d=>d.material?.startsWith('market-'))){const {x,y,z}=d.position,h=d.half,paint=d.material==='market-pink'?M.pink:M.blue;
   for(const side of[-1,1]){add(soft,unit,M.dark,[x,y-.2,z+side*(h.z-.01)],[h.x*1.8,h.y*1.4,.02]);for(let dx=-h.x+.6;dx<h.x;dx+=.8)add(soft,unit,paint,[x+dx,y+h.y-.3,z+side*(h.z-.02)],[.45,.5,.03]);
    for(let yy=-h.y+.35;yy<h.y-.6;yy+=.4)add(soft,unit,M.blue,[x,y+yy,z+side*(h.z-.005)],[h.x*1.65,.06,.02]);
    add(soft,unit,glow,[x,y+h.y-.06,z+side*(h.z-.005)],[h.x*1.8,.1,.02]);}
   for(let dx=-h.x+.45;dx<h.x;dx+=.9)add(soft,unit,paint,[x+dx,y+h.y-.025,z],[.48,.035,h.z*1.9]);
  }
  // Off-arena illuminated billboards are landmarks, never hidden collision.
  for(const side of[-1,1]){const x=side*(map.playBounds.halfX+5),z=-side*15,paint=side<0?M.blue:M.pink;
   add(scenery,unit,M.dark,[x,5,z],[1.5,14,1.5]);add(scenery,unit,paint,[x,12,z],[9,5,.7]);add(scenery,unit,M.dark,[x,12,z+.36],[8.2,4.2,.03]);
   const glyph=glyphs[side<0?'A':'B'];for(let row=0;row<7;row++)for(let col=0;col<5;col++)if(glyph[row][col]==='1')add(scenery,unit,glow,[x+(col-2)*.52,12+(3-row)*.52,z+.39],[.44,.44,.04]);
   for(let dx=-3;dx<=3;dx+=1.5)add(scenery,unit,M.white,[x+dx,9.7,z+.38],[.65,.1,.03]);
  }
  // Signal lamps and road studs use emissive batches, without point lights.
  for(const d of map.colliders.filter(d=>d.shape==='deck')){const y=d.position.y+d.half.y+.02;for(let x=-d.half.x+3;x<d.half.x-2;x+=6)add(soft,flat,glow,[d.position.x+x,y,d.position.z],[.25,1,.7]);}
 }

}

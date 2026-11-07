import {createKartFestiveLights} from './kart-festive-lights.mjs';
import {createRaisedReadability,applyRaisedLighting} from './kart-raised-readability.mjs';
import {createKartBackdrop,createKartSky} from './kart-backdrop.mjs';
import {complexSurfaceTexture,tileComplexMaterial} from './kart-complex-surfaces.mjs';
import {addComplexDetails} from './kart-complex-details.mjs';

/* A small shared geometry kit. Collider skins are instanced by material;
 * markings stay on the surface, and every raised prop has a real solid.
 * No GLBs, per-prop textures, shadowed interior lights or animated allocations. */
export function createKartComplexWorld(THREE,{scene,map,palette,lighting=true,quality='high',reducedMotion=false,solidGeometry}){
  const data=structuredClone(map),skyport=data.id==='skyport',group=new THREE.Group();group.name='elevated-combat-'+data.id;scene?.add(group);
  const solids=new THREE.Group(),scenery=new THREE.Group(),soft=new THREE.Group();solids.name='authored-solid-envelopes';scenery.name='outside-arena-scenery';soft.name='complex-markings';group.add(solids,scenery,soft);
  const geometries=new Set(),materials=new Set(),textures=new Set(),instances=[],colliderMeshes=new Map(),buckets=new Map();let disposed=false;
  const geo=g=>(geometries.add(g),g),mat=m=>(materials.add(m),m);
  const standard=(color,extra={})=>mat(new THREE.MeshStandardMaterial({color,roughness:.82,...extra}));
  const tones={asphalt:skyport?0x9cabb8:0xc5dce4,concrete:0xc2c5bd,'level-1':skyport?0x91c2bc:0xffc394,'level-2':skyport?0xead6a1:0x94d8bf,ramp:skyport?0xb5bdb8:0xc6dfe5,pillar:skyport?0x7191a5:0x72bac5,cover:skyport?0x3da6b7:0x78908b,utility:0x99a4aa,kerb:0x497785,barrier:0xa5a99f,furnace:0xff9854,slag:0xfa7130};
  const M=Object.fromEntries(Object.entries(tones).map(([k,c])=>[k,standard(c,k==='slag'?{emissive:0xff5c18,emissiveIntensity:1.8}:k==='furnace'?{emissive:0x681c04,emissiveIntensity:.35}:{} )]));
  const atlas=Object.fromEntries(['asphalt',skyport?'pavers':'steel','panels'].map(kind=>{const t=complexSurfaceTexture(THREE,kind);textures.add(t);return[kind,t];}));
  for(const [key,m]of Object.entries(M))if(key!=='slag')tileComplexMaterial(m,atlas[key==='asphalt'?'asphalt':key==='level-1'||key==='level-2'||key==='ramp'?(skyport?'pavers':'steel'):'panels'],key==='asphalt'?8:4);
  const ink=standard(0x243e52),white=standard(0xe5f0ee),yellow=standard(0xffd368),orange=standard(0xf69c45),green=standard(0x7cdbc3),light=standard(0xffdf94,{emissive:0xffb657,emissiveIntensity:1.1});
  for(const m of [ink,white,yellow,orange,green,light])m.side=THREE.DoubleSide;
  const box=geo(new THREE.BoxGeometry(1,1,1)),plane=geo(new THREE.PlaneGeometry(1,1));
  const wedge=geo(solidGeometry(THREE,{shape:'wedge',half:{x:.5,y:.5,z:.5}}));
  const identity=new THREE.Quaternion(),dummy=new THREE.Object3D();
  function item(parent,key,g,m,p,s,q=identity,colliderId){
    const id=parent.uuid+':'+g.uuid+':'+m.uuid;if(!buckets.has(id))buckets.set(id,{parent,key,g,m,items:[],tags:new Set()});
    buckets.get(id).tags.add(key);
    buckets.get(id).items.push({p,s,q,colliderId});
  }
  function block(parent,key,m,x,y,z,w,h,d,a=0){
    const q=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),a);
    // Painted stripes and face panels need two triangles, not a tiny box.
    if(parent===soft&&Math.min(w,h,d)<=.08){
      if(h<=w&&h<=d){q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),-Math.PI/2));item(parent,key,plane,m,{x,y,z},{x:w,y:d,z:1},q);}
      else if(w<d){q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),Math.PI/2));item(parent,key,plane,m,{x,y,z},{x:d,y:h,z:1},q);}
      else item(parent,key,plane,m,{x,y,z},{x:w,y:h,z:1},q);
    }else item(parent,key,box,m,{x,y,z},{x:w,y:h,z:d},q);
  }
  // Hidden exact query envelopes stay separate from the rendered instance
  // batches, so the chase camera uses the same finite ceilings as Rapier.
  for(const d of data.colliders){
    const root=new THREE.Group();root.name=d.id;root.position.copy(d.position);if(d.rotation)root.quaternion.set(d.rotation.x,d.rotation.y,d.rotation.z,d.rotation.w);solids.add(root);
    const geometry=geo(solidGeometry(THREE,d)),body=new THREE.Mesh(geometry,M[d.material]||M.concrete);body.name=d.id+'-body';body.visible=false;root.add(body);
    const cameraGeometry=d.shape==='wedge'?geometry:geo(new THREE.BoxGeometry(d.half.x*2,d.half.y*2,d.half.z*2));
    const cameraBody=new THREE.Mesh(cameraGeometry,M.concrete);cameraBody.visible=false;cameraBody.name=d.id+'-camera-solid';cameraBody.userData.cameraCollider=true;root.add(cameraBody);
    colliderMeshes.set(d.id,{group:root,body,cameraBody,descriptor:structuredClone(d)});
    if(!skyport&&d.material==='cover'){
      // Tanks have a real rectangular protective cage. Open face panels
      // reveal the cylinders, while the frame still marks the full solid.
      const h=d.half,p=d.position;
      for(const side of [-1,1]){
        item(solids,'tank-cage-sides',box,M.cover,{x:p.x+side*(h.x-.08),y:p.y,z:p.z},{x:.16,y:h.y*2,z:h.z*2},identity,d.id);
        for(const dy of [-1,1])item(solids,'tank-cage-rails',box,M.cover,{x:p.x,y:p.y+dy*(h.y-.12),z:p.z+side*(h.z-.08)},{x:h.x*2,y:.24,z:.16},identity,d.id);
      }
    }else item(solids,d.shape==='wedge'?'ramps':d.material,d.shape==='wedge'?wedge:box,M[d.material]||M.concrete,d.position,{x:d.half.x*2,y:d.half.y*2,z:d.half.z*2},root.quaternion,d.id);
    if(d.shape==='deck'){
      const top=d.position.y+d.half.y,color=top>15?yellow:skyport?green:orange;
      for(const side of [-1,1])block(soft,'level-edge-'+(top>15?2:1),color,d.position.x+side*(d.half.x-.2),top+.006,d.position.z,.30,.012,d.half.z*2);
    }
    if(d.material==='pillar'){
      for(const y of [1.4,11.4])if(y<d.position.y+d.half.y)block(soft,'pillar-bands',yellow,d.position.x,y,d.position.z,d.half.x*2+.025,.38,d.half.z*2+.025);
    }
    if(d.material==='cover'||d.material==='utility'){
      const h=d.half;for(const side of [-1,1])block(soft,'cover-inset-bands',yellow,d.position.x,d.position.y+h.y*.45,d.position.z+side*(h.z+.009),h.x*1.7,.22,.018);
    }
  }
  // Lane arrows, white parking bays and level-colour edge strips use the
  // same two triangle/box kit. They add no walls or invisible obstructions.
  function stripe(m,x,y,z,w,d,a=0){block(soft,'mark-'+m.uuid,m,x,y+.012,z,w,.012,d,a);}
  function arrow(x,y,z,a,m=yellow){stripe(m,x,y,z,.22,4,a);const dx=Math.sin(a),dz=Math.cos(a);for(const sign of [-1,1])stripe(m,x+dx*1.5+Math.cos(a)*sign*.5,y,z+dz*1.5-Math.sin(a)*sign*.5,.22,1.8,a+sign*.72);}
  for(const x of [-76,0,76])for(let z=-110;z<=110;z+=14){stripe(white,x,0,z,.2,6);if(z%28===0)arrow(x+4,0,z,0,white);}
  for(const z of [-102,106])stripe(yellow,0,0,z,224,.22);
  if(skyport){
    for(const x of [-40,40])for(const level of [1,2]){
      const y=level*10;
      for(const z of [-24,-12,0,12,24])for(const side of [-1,1])stripe(white,x+side*15,y,z,9,.15);
      for(const z of [-24,0,24])arrow(x,y,z,0,level===1?green:yellow);
    }
    // A big broken-ring helipad and H are readable from the street and roof.
    const ring=geo(new THREE.RingGeometry(8.8,9.15,48));
    item(soft,'helipad-painted-base',geo(new THREE.CircleGeometry(9.3,32)),ink,{x:-40,y:20.008,z:-8},{x:1,y:1,z:1},new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),-Math.PI/2));
    item(soft,'helipad-ring',ring,white,{x:-40,y:20.03,z:-8},{x:1,y:1,z:1},new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),-Math.PI/2));
    for(const x of [-42,-38])stripe(white,x,20,-8,.6,7);stripe(white,-40,20,-8,4,.6);
    // Large P at the east parking arrival.
    stripe(white,40,10,10,.65,7);stripe(white,42,10,13,4,.65);stripe(white,42,10,10,4,.65);stripe(white,44,10,11.5,.65,3);
    arrow(-12,20.94,-18,Math.PI/2);arrow(40,20,25,Math.PI);
    for(const level of [1,2])for(const x of [-40,40])for(const z of [-30,30])block(soft,'floor-fascia-'+level,level===1?green:yellow,x,level*10-.32,z,44,.22,.025);
  }else{
    for(const belt of data.belts){
      stripe(ink,belt.x,belt.y,belt.z,belt.halfX*2,belt.halfZ*2);
      const a=Math.atan2(belt.velocity.x,belt.velocity.z),alongX=!!belt.velocity.x;
      for(let t=-18;t<=18;t+=6)arrow(belt.x+(alongX?t:0),belt.y+.025,belt.z+(alongX?0:t),a,orange);
      for(const side of [-1,1])stripe(yellow,belt.x+(alongX?0:side*(belt.halfX-.15)),belt.y+.03,belt.z+(alongX?side*(belt.halfZ-.15):0),alongX?belt.halfX*2:.25,alongX?.25:belt.halfZ*2);
    }
    // Furnace ribs stay on its real 18x20x18 blocking envelope.
    for(let y=2;y<20;y+=3)for(const side of [-1,1]){
      block(soft,'furnace-hot-seams',light,0,y,side*9.015,15,.32,.025);block(soft,'furnace-hot-seams',light,side*9.015,y,0,.025,.32,15);
    }
    // The crane is a high open landmark; its feet are authority cover.
    block(soft,'crane-beams',yellow,94,12.6,-38,20,1.2,2);
    for(const x of [85,103])block(soft,'crane-beams',yellow,x,13.8,-38,.7,1.2,49);
    block(soft,'crane-hook',ink,94,10,-38,.18,5,.18);block(soft,'crane-hook',orange,94,7.5,-38,1.4,.6,1.4);
    // The slag is a physical opening in four floor slabs. Rim paint shows
    // the danger without fencing off the tempting shortcut beside it.
    for(const side of [-1,1]){
      stripe(yellow,50+side*14.5,0,60,1,33);stripe(yellow,50,0,60+side*16.5,29,1);
      for(let t=-12;t<=12;t+=4)stripe(ink,50+side*14.5,0,60+t,1.1,1.2,.4);
    }
    for(const x of [-50,50])for(const z of [-32,0,32])arrow(x,20,z,0,green);
    // Tunnel entrance lintel markings are painted onto the actual decks.
    for(const z of [-30,30])for(const x of [-24,0,24])stripe(orange,x,10,z+Math.sign(z)*.05,6,.3);
  }
  addComplexDetails(THREE,{map:data,soft,geo,mat,texture:t=>(textures.add(t),t),block,item,box,ink,white,yellow,orange,green,light});
  // Remote buildings never overlap the drive field. A compact skyline
  // supplies parallax beneath the existing painted harbor/neon panorama.
  for(let i=0;i<20;i++){
    const a=i*Math.PI/10,r=184,h=8+(i*13%24),x=Math.cos(a)*r,z=Math.sin(a)*r;
    block(scenery,'distant-complexes',M.pillar,x,h/2-2,z,12,h,14,a);
    block(scenery,'distant-windows',light,x,h*.68,z,12.1,.5,14.1,a);
  }
  function flush(){
    for(const {parent,key,g,m,items,tags}of buckets.values()){
      const mesh=new THREE.InstancedMesh(g,m,items.length);mesh.name='complex-'+key;mesh.castShadow=parent===solids;mesh.receiveShadow=true;
      const ids=[];
      items.forEach((v,i)=>{dummy.position.copy(v.p);dummy.scale.copy(v.s);dummy.quaternion.copy(v.q);dummy.updateMatrix();mesh.setMatrixAt(i,dummy.matrix);if(v.colliderId)ids.push(v.colliderId);});
      if(ids.length)mesh.userData.colliderIds=ids;
      mesh.userData.detailKinds=[...tags];
      mesh.instanceMatrix.needsUpdate=true;mesh.computeBoundingSphere();parent.add(mesh);instances.push(mesh);
    }buckets.clear();
  }
  flush();
  const resources={isAlive:()=>!disposed,geometry:geo,material:mat,texture:t=>(textures.add(t),t)};
  const festive=createKartFestiveLights(THREE,{parent:soft,map:data,quality,reducedMotion});
  const readability=createRaisedReadability(THREE,{parent:soft,map:data,...resources});
  const backdrop=createKartBackdrop(THREE,{parent:scenery,theme:data.backdrop,radius:350,...resources});
  const sky=createKartSky(THREE,{parent:soft,radius:460,widthSegments:24,heightSegments:12,geometry:geo,material:mat});
  const sun=new THREE.DirectionalLight(0xffe8c4,2.2),hemi=new THREE.HemisphereLight(0xcce8ff,0x7794a3,1.5);sun.name='elevated-sun';hemi.name='elevated-ambient';sun.position.set(-85,130,-65);sun.castShadow=true;sun.shadow.mapSize.set(1024,1024);Object.assign(sun.shadow.camera,{left:-132,right:132,top:132,bottom:-132,near:10,far:350});sun.shadow.normalBias=.12;sun.shadow.bias=-.0005;sun.target.position.set(0,0,0);if(lighting)group.add(sun,hemi,sun.target);
  const fixed=palette==='Starlight'?1:palette==='Sunset'?.65:0;
  // Unshadowed fill reaches downward-facing decks and deep tunnels too.
  // Lights add no draw calls; keep the warm key and bright, cool bounce.
  const interiorFill=skyport?null:new THREE.AmbientLight(0xe7f4ff,.5);
  if(interiorFill){interiorFill.name='foundry-interior-fill';if(lighting)group.add(interiorFill);}
  const lightingState={phase:fixed,sun,hemisphere:hemi,interiorFill,fogColor:new THREE.Color(),fogNear:210,fogFar:450,exposure:1.05};
  function animate(dt,time,phase){
    if(disposed)return;const p=Number.isFinite(phase)?Math.max(0,Math.min(1,phase)):fixed;
    festive.animate(time);
    lightingState.phase=p;sky.setPhase(p);lightingState.fogColor.copy(sky.horizon);
    applyRaisedLighting(sun,hemi,p);
    if(!skyport){
      sun.color.set(p>.65?0xffc18a:0xffdfb3);
      hemi.color.set(0xffedd8);hemi.groundColor.set(0xb2d9ed);hemi.intensity=1.65;
      interiorFill.intensity=.5+.15*p;
    }
    sun.position.set(-85,130-p*65,-65);backdrop.tint(sky.horizon,p<=.65?0:(p-.65)/.35);
  }
  function stats(){
    const out={drawCalls:0,triangles:0,instanced:0,meshes:0,textureBytes:0,textureCount:textures.size,colliders:colliderMeshes.size};
    group.traverse(o=>{if(!o.isMesh||!o.visible)return;out.drawCalls++;out.triangles+=(o.geometry.index?o.geometry.index.count:o.geometry.attributes.position.count)/3*(o.isInstancedMesh?o.count:1);o.isInstancedMesh?out.instanced++:out.meshes++;});
    for(const t of textures)out.textureBytes+=Math.round((t.image?.width||0)*(t.image?.height||0)*4*4/3);return out;
  }
  function dispose(){if(disposed)return;disposed=true;group.removeFromParent();festive.dispose();readability.dispose();for(const i of instances)i.dispose();for(const r of [...geometries,...materials,...textures])r.dispose();sun.dispose();hemi.dispose();interiorFill?.dispose();group.clear();colliderMeshes.clear();}
  animate(0,0);return {group,solids,scenery,colliderMeshes,festive,layout:data,lighting:lightingState,animate,updateDetail(){},stats,dispose,get disposed(){return disposed;}};
}

import {mergeStaticMeshes} from './kart-instancing.mjs';
import {createRaisedReadability,applyRaisedLighting} from './kart-raised-readability.mjs';
import {createKartSky,createKartBackdrop} from './kart-backdrop.mjs';
// The launch arenas reuse the raised solid skin and readability system. The
// art ID is independent of the immutable layout ID and its selected variant.
export function createKartLaunchWorld(THREE,{scene,map,palette='Daybreak',lighting=true,solidGeometry}={}){
 const group=new THREE.Group();group.name='launch-arena-'+map.id;scene?.add(group);
 const solids=new THREE.Group(),scenery=new THREE.Group(),soft=new THREE.Group();solids.name='authored-solid-envelopes';scenery.name='outside-arena-scenery';group.add(solids,scenery,soft);
 const geometries=new Set(),materials=new Set(),textures=new Set(),colliderMeshes=new Map();let disposed=false;
 const geo=g=>(geometries.add(g),g),mat=m=>(materials.add(m),m),texture=t=>(textures.add(t),t);
 const themes={ring:{road:0x8dc3bf,deck:0xffd17b,edge:0xf5e1bc,cover:0xef866c},garden:{road:0xa8c2a0,deck:0xf0d28a,edge:0xeee1bb,cover:0x45986b},frost:{road:0xaec7db,deck:0xbdcddd,edge:0xdcecf4,cover:0x718da9},neon:{road:0x627f9a,deck:0x7bcad2,edge:0x9cd3df,cover:0xe68fbf},harbor:{road:0x9db6bc,deck:0xbdd5d7,edge:0xead8ae,cover:0xf49c6a},skyport:{road:0x8fadb8,deck:0xb8d4e2,edge:0xe9d4ab,cover:0x6aafc3},foundry:{road:0xa2a9af,deck:0xbcc9cd,edge:0xf6c16b,cover:0xc97d58}};
 const colors=themes[map.artId]||themes.ring,cache=new Map();
 function material(key,color){if(!cache.has(key))cache.set(key,mat(new THREE.MeshLambertMaterial({color})));return cache.get(key);}
 const grainBytes=new Uint8Array(64*64*4);let grainSeed=1909;for(let i=0;i<64*64;i++){grainSeed=(Math.imul(grainSeed,1664525)+1013904223)>>>0;const value=238+(grainSeed>>>28);grainBytes.set([value,value,value,255],i*4);}const roadGrain=texture(new THREE.DataTexture(grainBytes,64,64));roadGrain.wrapS=roadGrain.wrapT=THREE.RepeatWrapping;roadGrain.colorSpace=THREE.SRGBColorSpace;roadGrain.needsUpdate=true;
 const M={road:material('road',colors.road),deck:material('deck',colors.deck),edge:material('edge',colors.edge),cover:material('cover',colors.cover),blue:material('blue',0x6bbbc8),dark:material('dark',0x415c71),white:material('white',0xfff4d6)};
 M.road.map=roadGrain;M.road.needsUpdate=true;
 function add(parent,g,m,p=[0,0,0],scale=[1,1,1],rotation=[0,0,0]){const mesh=new THREE.Mesh(g,m);mesh.position.set(...p);mesh.scale.set(...scale);mesh.rotation.set(...rotation);mesh.receiveShadow=true;parent.add(mesh);return mesh;}
 for(const d of map.colliders){
  const g=new THREE.Group();g.name=d.id;g.position.copy(d.position);if(d.rotation)g.quaternion.copy(d.rotation);solids.add(g);
  const m=d.material==='barrier'?M.edge:d.material==='toy-blue'?M.blue:d.shape==='deck'||d.shape==='wedge'?M.deck:d.id.startsWith('floor')?M.road:M.cover;
  const geometry=geo(d.id.startsWith('floor')?new THREE.BoxGeometry(d.half.x*2,d.half.y*2,d.half.z*2):solidGeometry(THREE,d));
  if(d.id.startsWith('floor')){const p=geometry.attributes.position,uv=geometry.attributes.uv;for(let i=0;i<p.count;i++)uv.setXY(i,(p.getX(i)+d.position.x)/8,(p.getZ(i)+d.position.z)/8);}
  const body=add(g,geometry,m);body.name=d.id+'-body';
  if(map.artId==='ring'&&d.id==='arch')for(let x=-d.half.x+4;x<d.half.x;x+=8)add(g,geo(new THREE.BoxGeometry(6.8,.4,.04)),x<0?M.blue:M.cover,[x,0,d.half.z-.03]);
  const cameraBody=new THREE.Mesh(d.shape==='wedge'?geometry:geo(new THREE.BoxGeometry(d.half.x*2,d.half.y*2,d.half.z*2)),m);cameraBody.visible=false;cameraBody.userData.cameraCollider=true;g.add(cameraBody);
  colliderMeshes.set(d.id,{group:g,body,cameraBody,descriptor:structuredClone(d)});
  // Insets sit inside the authority envelope, never widen a corner or a lane.
  if(d.material?.startsWith('toy-')&&d.shape==='box'){
   for(const side of[-1,1])add(g,geo(new THREE.BoxGeometry(d.half.x*1.4,.12,.05)),M.white,[0,.1,side*(d.half.z-.03)]);
  }
 }
 const readability=createRaisedReadability(THREE,{parent:soft,map,geometry:geo,material:mat,texture});
 const unit=geo(new THREE.BoxGeometry(1,1,1));
 // Repeated school lane ticks follow both ground escape loops. The centre is
 // kept quiet so silhouettes and the next turn remain readable at kart height.
 if(map.artId==='ring'){
  for(const side of[-1,1])for(let z=-10;z<=10;z+=5)add(soft,unit,M.white,[side*(map.playBounds.halfX-3),.015,z],[.18,.03,1.8]);
  for(let x=-12;x<=12;x+=4)add(soft,unit,M.white,[x,.015,8],[1.8,.03,.18]);
  // Big A/B floor emblems, built from batched bars rather than signboards in
  // the driving/camera volume. Different shapes help colour-blind drivers.
  const flat=geo(new THREE.PlaneGeometry(1,1).rotateX(-Math.PI/2));
  for(const {x,symbol:letter}of map.landmarks){
   const glyph=letter==='A'?['01110','11011','11011','11111','11011','11011','11011']:['11110','11011','11011','11110','11011','11011','11110'];
   for(let row=0;row<7;row++)for(let col=0;col<5;col++)if(glyph[row][col]==='1')add(soft,flat,M.white,[x+(col-2)*.65,.025,2+(row-3)*.65],[.6,1,.6]);
  }
 }
 // A low ground apron is scenery only. The shaped driving slabs and guards
 // above it are the complete physical footprint; there is no square collider.
 const ground=material('backdrop-ground',map.artId==='frost'?0xd1e5ed:map.artId==='neon'?0x304c68:0x82b59a);
 add(scenery,geo(new THREE.CylinderGeometry(map.half+18,map.half+23,3,12)),ground,[0,-3.1,0]);
 const sky=createKartSky(THREE,{parent:scenery,radius:330,geometry:geo,material:mat});
 const backdrop=createKartBackdrop(THREE,{parent:scenery,theme:map.backdrop||map.artId,radius:map.half+130,geometry:geo,material:mat,texture,isAlive:()=>!disposed});
 // Trees sit outside the guarded road and never hide a route decision.
 const trunk=material('trunk',0x89704e),leaf=material('leaf',0x4a9672),trunkG=geo(new THREE.CylinderGeometry(.4,.6,3,6)),leafG=geo(new THREE.IcosahedronGeometry(2.6,0));
 for(let i=0;i<12;i++){const angle=i*Math.PI/6,r=map.half+10,x=Math.cos(angle)*r,z=Math.sin(angle)*r;add(scenery,trunkG,trunk,[x,-.3,z]);add(scenery,leafG,leaf,[x,2.2,z]);}
 for(const parent of[solids,scenery,soft])for(const {mesh}of mergeStaticMeshes(THREE,parent))geo(mesh.geometry);
 const sun=new THREE.DirectionalLight(0xffedce,1.75),hemi=new THREE.HemisphereLight(0xe4eeff,0x819d87,1.25);sun.castShadow=true;sun.shadow.mapSize.set(1024,1024);sun.shadow.bias=-.0004;sun.shadow.normalBias=.06;Object.assign(sun.shadow.camera,{left:-map.half-10,right:map.half+10,top:map.half+10,bottom:-map.half-10,near:5,far:220});sun.position.set(-45,75,35);if(lighting)group.add(sun,hemi,sun.target);
 const fixed=palette==='Starlight'?1:palette==='Sunset'?.65:0;
 const lightingState={phase:fixed,sun,hemisphere:hemi,fogColor:new THREE.Color(),fogNear:180,fogFar:400,exposure:1.05};
 function animate(dt,time,skyPhase){if(disposed)return;const p=Number.isFinite(skyPhase)?Math.max(0,Math.min(1,skyPhase)):fixed;sky.setPhase(p);backdrop.tint(sky.horizon,Math.max(0,(p-.65)/.35));applyRaisedLighting(sun,hemi,p,{neon:map.artId==='neon'});lightingState.phase=p;lightingState.fogColor.copy(sky.horizon);}
 function stats(){const out={drawCalls:0,triangles:0,textureBytes:0,textureCount:textures.size,colliders:colliderMeshes.size};group.traverseVisible(o=>{if(!o.isMesh||o.userData.cameraCollider)return;out.drawCalls+=Array.isArray(o.material)?o.geometry.groups.length:1;out.triangles+=(o.geometry.index?.count??o.geometry.attributes.position.count)/3*(o.isInstancedMesh?o.count:1);});for(const t of textures)out.textureBytes+=Math.round((t.image?.width||0)*(t.image?.height||0)*4*4/3);return out;}
 function dispose(){if(disposed)return;disposed=true;group.removeFromParent();readability.dispose();group.traverse(o=>{if(o.isInstancedMesh)o.dispose();});for(const r of[...geometries,...materials,...textures])r.dispose();sun.dispose();hemi.dispose();colliderMeshes.clear();group.clear();}
 animate(0,0);return {group,solids,scenery,colliderMeshes,layout:map,lighting:lightingState,animate,updateDetail(){},stats,dispose,get disposed(){return disposed;}};
}

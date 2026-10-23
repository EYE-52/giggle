/* Elevated combat art adapter. No simulation, racing route or backdrop image.
 * The shared map descriptors are the only solids in the legal drive field.
 * Texture/shape details stay inside those envelopes; scenery is outside half+2.
 * createKartElevatedWorld(THREE,{scene,map,palette,lighting=true}) returns an
 * owned group, exact collider records, metadata, animate(dt,time,skyPhase),
 * stats() and idempotent dispose(). A null phase uses the chosen fixed palette;
 * a finite phase is caller-owned 0..1 daylight -> sunset -> readable night.
 */
import { createStylizedAlpineLandscape } from './kart-stylized-landscape.mjs';
import { elevatedMap } from './kart-elevated-maps.mjs';

const TAU=Math.PI*2;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
function random(seed){return()=>{seed|=0;seed=seed+0x6d2b79f5|0;let n=Math.imul(seed^seed>>>15,1|seed);n^=n+Math.imul(n^n>>>7,61|n);return((n^n>>>14)>>>0)/4294967296;};}

// Closed smooth wedge, identical local support convention to the collider:
// -Z is the low entry; +Z is the full rise. Never subdivided into steps.
export function elevatedSolidGeometry(THREE,d){
  if(d.shape!=='wedge')return beveledBox(THREE,d.half,Math.min(.16,d.half.y*.25));
  const {x,y,z}=d.half,p=[[-x,-y,-z],[x,-y,-z],[-x,-y,z],[x,-y,z],[-x,y,z],[x,y,z]];
  const indices=[0,2,4,1,5,3,0,1,3,0,3,2,2,3,5,2,5,4,0,4,5,0,5,1];
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(indices.flatMap(i=>p[i]),3));g.computeVertexNormals();physicalUV(THREE,g);return g;
}
function physicalUV(THREE,g){
  const p=g.attributes.position,n=g.attributes.normal,uv=[];
  for(let i=0;i<p.count;i++){
    const ax=Math.abs(n.getX(i)),ay=Math.abs(n.getY(i)),az=Math.abs(n.getZ(i));
    uv.push((ay>=ax&&ay>=az?p.getX(i):ax>=az?p.getZ(i):p.getX(i))/8,(ay>=ax&&ay>=az?p.getZ(i):p.getY(i))/8);
  }
  g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
}
function beveledBox(THREE,h,b){
  const verts=[],H=[h.x,h.y,h.z],inner=H.map(v=>v-b);
  function face(points,normal){
    const a=points[0],u=points[1].map((v,i)=>v-a[i]),v=points[2].map((v,i)=>v-a[i]);
    const cross=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];
    if(cross.reduce((s,v,i)=>s+v*normal[i],0)<0)points=[...points].reverse();
    for(let i=1;i<points.length-1;i++)verts.push(...points[0],...points[i],...points[i+1]);
  }
  for(let a=0;a<3;a++)for(const s of [-1,1]){
    const t=[0,1,2].filter(i=>i!==a),normal=[0,0,0];normal[a]=s;
    face([[-1,-1],[1,-1],[1,1],[-1,1]].map(([u,v])=>{const p=[0,0,0];p[a]=H[a]*s;p[t[0]]=inner[t[0]]*u;p[t[1]]=inner[t[1]]*v;return p;}),normal);
  }
  for(let free=0;free<3;free++)for(const s of [-1,1])for(const t of [-1,1]){
    const [a,c]=[0,1,2].filter(i=>i!==free),normal=[0,0,0];normal[a]=s;normal[c]=t;
    face([[-1,0],[1,0],[1,1],[-1,1]].map(([f,side])=>{const p=[0,0,0];p[free]=inner[free]*f;p[a]=(side?inner[a]:H[a])*s;p[c]=(side?H[c]:inner[c])*t;return p;}),normal);
  }
  for(const x of [-1,1])for(const y of [-1,1])for(const z of [-1,1])face([[H[0]*x,inner[1]*y,inner[2]*z],[inner[0]*x,H[1]*y,inner[2]*z],[inner[0]*x,inner[1]*y,H[2]*z]],[x,y,z]);
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(verts,3));g.computeVertexNormals();physicalUV(THREE,g);return g;
}

export function createKartElevatedWorld(THREE,{scene,map,palette,lighting=true,terrain,assets={}}={}){
  const data=typeof map==='string'?elevatedMap(map):structuredClone(map||elevatedMap('garden'));
  if(!Array.isArray(data.colliders)||!Number.isFinite(data.half))throw new TypeError('An authored elevated map is required');
  const harbor=data.environment==='harbor',frost=data.environment==='frost',half=data.half;
  const group=new THREE.Group();group.name='elevated-combat-'+data.id;scene?.add(group);
  const solids=new THREE.Group(),scenery=new THREE.Group(),soft=new THREE.Group();
  solids.name='authored-solid-envelopes';scenery.name='outside-arena-scenery';soft.name='soft-cosmetics';group.add(solids,scenery,soft);
  const geometries=new Set(),materials=new Set(),textures=new Set(),borrowedTextures=new Set(),colliderMeshes=new Map(),batches=new Map();
  const grassBatches=[],natureBatches=[],grassTime={value:0},fountainTime={value:0};let meadowEdge;
  let disposed=false;const geo=g=>(geometries.add(g),g),mat=m=>(materials.add(m),m);
  const basic=(color,extra={})=>mat(new THREE.MeshBasicMaterial({color,...extra}));
  const standard=(color,extra={})=>mat(new THREE.MeshStandardMaterial({color,roughness:.78,...extra}));
  function pattern(kind,size=512){
    const color=new Uint8Array(size*size*4),height=new Uint8Array(size*size*4),R=random(kind.length*1909+kind.charCodeAt(0)*21);
    const base=kind==='stone'?[171,181,184]:kind==='slate'?[156,178,198]:kind==='metal'||kind==='plate'?[205,213,217]:kind==='wood'?[111,73,43]:kind==='ice'?[174,221,239]:kind==='grass'?[35,154,83]:kind==='asphalt'?[101,120,132]:[66,75,86];
    for(let y=0;y<size;y++)for(let x=0;x<size;x++){
      let grain=(R()-.5)*18,seam=false,bump=128+grain*2;
      if(kind==='stone'||kind==='slate'){
        const row=Math.floor(y/64),col=Math.floor((x+(row%2)*32)/64);
        seam=y%64<3||(x+(row%2)*32)%64<3;
        let tile=(row*73856093^col*19349663)>>>0;tile=Math.imul(tile^tile>>>16,0x45d9f3b);grain+=((tile>>>0)/4294967296-.5)*14+Math.sin(x*.064+Math.sin(y*.021)*8)*2;bump=seam?92:138+grain*.12;
      }else if(kind==='wood'){grain+=Math.sin(y*.35+Math.sin(x*.017)*6)*13+Math.sin(y*.09)*12;bump=128+grain;}
      else if(kind==='metal'){grain+=Math.sin(x*Math.PI/16)*10;bump=128+Math.sin(x*Math.PI/16)*25+grain*.3;}
      else if(kind==='plate'){seam=x%32===0||y%32===0;grain=grain*.18+Math.sin(y*1.4)*1.5;bump=seam?125:128+grain*.08;}
      else if(kind==='ice'){const crack=Math.abs((x+y*.43+Math.floor(y/83)*17)%137-68.5);grain=grain*.2+(crack<1.5?23:0);bump=128+(crack<1.5?-4:grain*.08);}
      else{grain+=(R()<.008?-32:0);bump=128+grain;}
      const i=(y*size+x)*4;
      for(let c=0;c<3;c++){color[i+c]=clamp(base[c]+grain-(seam?37:0),0,255);height[i+c]=clamp(bump,0,255);}color[i+3]=height[i+3]=255;
    }
    const make=(pixels,srgb)=>{const t=new THREE.DataTexture(pixels,size,size,THREE.RGBAFormat);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.magFilter=THREE.LinearFilter;t.minFilter=THREE.LinearMipmapLinearFilter;t.generateMipmaps=true;t.anisotropy=8;t.colorSpace=srgb?THREE.SRGBColorSpace:THREE.NoColorSpace;t.needsUpdate=true;textures.add(t);return t;};
    return{map:make(color,true),bumpMap:make(height,false)};
  }
  const stylized=data.environment==='alpine'&&!!assets.stylized;
  const realTerrain=!stylized&&!harbor&&!frost&&terrain?.sets?.grass&&terrain.sets.earth&&terrain.sets.limestone&&terrain.sets.wall;
  const pbr=s=>({map:s.map,normalMap:s.normalMap,roughnessMap:s.roughnessMap,normalScale:new THREE.Vector2(.55,.55)});
  const stoneTex=stylized?{}:realTerrain?pbr(terrain.sets.wall):pattern(frost?'slate':'stone'),metalTex=stylized||realTerrain?{}:pattern('metal'),plateTex=stylized||realTerrain?{}:pattern('plate',128),woodTex=stylized||realTerrain?{}:pattern('wood'),floorTex=stylized?{}:harbor?pattern('asphalt'):realTerrain?pbr(terrain.sets.limestone):stoneTex,iceTex=frost?pattern('ice'):null;
  const M={stone:standard(frost?0xc9dcf1:0xe0e6e9,{...stoneTex,bumpScale:.008}),slate:standard(frost?0xcbd7e3:0x91a8ba,{...stoneTex,bumpScale:.010}),steel:standard(0xc0d0dc,{...plateTex,metalness:.55,roughness:.49,bumpScale:.001}),wood:standard(0xffffff,{...woodTex,roughness:.76,bumpScale:.004}),floor:standard(harbor?0xffffff:frost?0x99c0ee:0xd3e1e5,{...floorTex,bumpScale:harbor?.002:.005,roughness:harbor?.90:.91,metalness:0}),iron:standard(0x263746,{metalness:.72,roughness:.44}),brass:standard(0xe6b657,{metalness:.62,roughness:.4}),leaf:standard(frost?0x286c58:0x288a58,{roughness:1}),trunk:standard(0x704d34),snow:standard(0xe5f0f8,{roughness:.84}),cargoTeal:standard(0x25b7c3,{...metalTex,metalness:.12,roughness:.62,bumpScale:.002}),cargoOrange:standard(0xfc8549,{...metalTex,metalness:.12,roughness:.62,bumpScale:.002}),light:standard(0xffc56e,{emissive:0xffac46,emissiveIntensity:1.6}),ice:frost?standard(0xffffff,{...iceTex,roughness:.22,metalness:.12,bumpScale:.001}):null};
  M.pine=mat(M.leaf.clone());M.pine.vertexColors=true;
  if(stylized){
    M.floor.color.set(0xffffff);M.floor.roughness=1;
    M.stone.color.set(0xc4c4b6);
    const authoredBrick=assets.stylized.getObjectByName('CottageA_Brick')?.material;
    if(authoredBrick){
      M.stone.color.copy(authoredBrick.color);
      for(const key of ['map','normalMap','roughnessMap'])if(authoredBrick[key]){
        const texture=authoredBrick[key].clone();texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.repeat.set(2,2);texture.needsUpdate=true;textures.add(texture);M.stone[key]=texture;
      }
      M.stone.normalScale.set(.25,.25);
    }
M.slate.color.set(0x7e91a6);M.leaf.color.set(0x338854);M.iron.color.set(0x254157);M.brass.color.set(0xd3a754);
    // A single white map enables the ordinary world-aligned UV path. Color
    // comes from the clean painted surface shader, not photographic scans.
    const white=new THREE.DataTexture(new Uint8Array([255,255,255,255]),1,1,THREE.RGBAFormat);white.colorSpace=THREE.SRGBColorSpace;white.needsUpdate=true;textures.add(white);M.floor.map=white;
  }
  if(realTerrain){M.floor.color.set(0xffffff);M.stone.color.set(0xffffff);M.slate.color.set(0xa9bbb5);}
  if(!harbor&&!frost){
    // The meadow is a flush material treatment of the existing floor, not
    // a second drivable surface. Wide connected stone drives lead to both
    // ramps, the underpass, fountain and cover; all grass remains legal.
    const turf=stylized?null:realTerrain?terrain.sets.grass:pattern('grass',256);
    if(!realTerrain&&!stylized){turf.bumpMap.dispose();textures.delete(turf.bumpMap);}
    const size=512,pixels=new Uint8Array(size*size*4);
    const routes=[[-44,-40,-12,-4,9],[-40,42,-12,-4,9],[-12,-4,16,-32,10],[-12,-4,24,8,11],[-12,-46,16,-32,8],[42,42,32,48,10],[32,48,24,8,10],[24,8,42,-38,10],[42,-38,42,-24,11]];
    const distance=(x,z,a,b,c,d)=>{const vx=c-a,vz=d-b,t=clamp(((x-a)*vx+(z-b)*vz)/(vx*vx+vz*vz),0,1);return Math.hypot(x-a-vx*t,z-b-vz*t);};
    meadowEdge=(wx,wz)=>{
      let edge=Math.min(...routes.map(([a,b,c,d,w])=>distance(wx,wz,a,b,c,d)-w/2),Math.hypot(wx+12,wz+4)-13,Math.hypot(wx-42,wz+24)-8);
      if(wx>9&&wx<39&&wz>-5&&wz<21)edge=Math.min(edge,-1);
      if(realTerrain||stylized)edge+=Math.sin(wx*1.13+wz*.21)*.19+Math.sin(wx*.35-wz*.87)*.25;
      return edge;
    };
    for(let y=0;y<size;y++)for(let x=0;x<size;x++){
      const wx=(x/(size-1)-.5)*half*2,wz=(y/(size-1)-.5)*half*2;
      const edge=meadowEdge(wx,wz);
      // Paving under the real raised courtyard makes both open passages
      // legible, while the surrounding beds provide large green areas.
      const i=(y*size+x)*4;
      if(realTerrain||stylized){
        // A worn earth verge follows the actual connected drive approaches.
        // Irregular edges belong to the material, never alter support height.
        const paved=clamp(.5-edge*(stylized?1.5:.85),0,1),earth=(1-clamp(Math.abs(edge)/(stylized?.5:1.25),0,1))*(stylized?.4:.78);
        const stone=paved*(1-earth),grass=(1-paved)*(1-earth);
        pixels[i]=Math.round(stone*255);pixels[i+1]=Math.round(earth*255);pixels[i+2]=Math.round(grass*255);
      }else{const value=Math.round(clamp(.5-edge*1.6,0,1)*255);pixels[i]=pixels[i+1]=pixels[i+2]=value;}
      pixels[i+3]=255;
    }
    const mask=new THREE.DataTexture(pixels,size,size,THREE.RGBAFormat);mask.wrapS=mask.wrapT=THREE.RepeatWrapping;mask.magFilter=mask.minFilter=THREE.LinearFilter;mask.needsUpdate=true;textures.add(mask);
    M.floor.onBeforeCompile=shader=>{
      if(stylized){
        shader.uniforms.alpineMask={value:mask};
        shader.uniforms.alpineMeadow={value:new THREE.Color(0x3bba5b)};
        shader.uniforms.alpineDrive={value:new THREE.Color(0xc1d0d1)};
        shader.uniforms.alpineVerge={value:new THREE.Color(0x7baf60)};
        shader.vertexShader='varying vec3 vAlpinePosition;\n'+shader.vertexShader;
        shader.vertexShader=shader.vertexShader.replace('#include <project_vertex>','vAlpinePosition=(modelMatrix*vec4(transformed,1.0)).xyz;\n#include <project_vertex>');
        shader.fragmentShader='varying vec3 vAlpinePosition;uniform sampler2D alpineMask;uniform vec3 alpineMeadow;uniform vec3 alpineDrive;uniform vec3 alpineVerge;\n'+shader.fragmentShader;
        shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',`
vec2 alpineWorld=vAlpinePosition.xz;
vec3 alpineWeights=texture2D(alpineMask,alpineWorld/${half*2}.0+.5).rgb;
alpineWeights/=max(.001,alpineWeights.r+alpineWeights.g+alpineWeights.b);
// Large quiet pavers have narrow softened joints. No photographed grit.
vec2 stoneUV=alpineWorld/vec2(1.7,.85);stoneUV.x+=mod(floor(stoneUV.y),2.0)*.5;
vec2 tile=fract(stoneUV);vec2 edge=min(tile,1.0-tile);
float grout=1.0-smoothstep(.006,.022,min(edge.x,edge.y));
float tileLight=.97+.035*sin(floor(stoneUV.x)*4.13+floor(stoneUV.y)*3.17);
vec3 paved=alpineDrive*tileLight*(1.0-grout*.13);
float meadowLight=.97+.035*sin(alpineWorld.x*.10+sin(alpineWorld.y*.07)*3.0);
vec3 ground=paved*alpineWeights.r+alpineVerge*alpineWeights.g+alpineMeadow*meadowLight*alpineWeights.b;
diffuseColor.rgb*=ground;`);
        return;
      }
      if(realTerrain){
        const sets=terrain.sets;
        shader.uniforms.alpineMask={value:mask};
        for(const key of ['grass','earth','limestone'])for(const channel of ['map','normalMap','roughnessMap'])shader.uniforms['alpine_'+key+'_'+channel]={value:sets[key][channel]};
        shader.vertexShader='varying vec3 vAlpinePosition;\n'+shader.vertexShader;
        shader.vertexShader=shader.vertexShader.replace('#include <project_vertex>','vAlpinePosition=(modelMatrix*vec4(transformed,1.0)).xyz;\n#include <project_vertex>');
        shader.fragmentShader=`varying vec3 vAlpinePosition;
uniform sampler2D alpineMask;
uniform sampler2D alpine_grass_map;uniform sampler2D alpine_grass_normalMap;uniform sampler2D alpine_grass_roughnessMap;
uniform sampler2D alpine_earth_map;uniform sampler2D alpine_earth_normalMap;uniform sampler2D alpine_earth_roughnessMap;
uniform sampler2D alpine_limestone_map;uniform sampler2D alpine_limestone_normalMap;uniform sampler2D alpine_limestone_roughnessMap;
`+shader.fragmentShader;
        shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',`
vec2 alpineWorld=vAlpinePosition.xz;
vec3 alpineWeights=texture2D(alpineMask,alpineWorld/${half*2}.0+.5).rgb;
alpineWeights/=max(.001,alpineWeights.r+alpineWeights.g+alpineWeights.b);
vec2 alpineGrassUV=alpineWorld/${sets.grass.tileMeters};
vec2 alpineEarthUV=alpineWorld/${sets.earth.tileMeters};
vec2 alpineStoneUV=alpineWorld/${sets.limestone.tileMeters}.0;
vec3 alpineAlbedo=texture2D(alpine_limestone_map,alpineStoneUV).rgb*alpineWeights.r+texture2D(alpine_earth_map,alpineEarthUV).rgb*alpineWeights.g+texture2D(alpine_grass_map,alpineGrassUV).rgb*alpineWeights.b;
float alpineVariation=.98+.025*sin(alpineWorld.x*.13+sin(alpineWorld.y*.19)*2.0);
diffuseColor.rgb*=alpineAlbedo*alpineVariation;`);
        shader.fragmentShader=shader.fragmentShader.replace('#include <roughnessmap_fragment>',`
float roughnessFactor=clamp(texture2D(alpine_limestone_roughnessMap,alpineStoneUV).g*alpineWeights.r+texture2D(alpine_earth_roughnessMap,alpineEarthUV).g*alpineWeights.g+texture2D(alpine_grass_roughnessMap,alpineGrassUV).g*alpineWeights.b,.55,1.0);`);
        shader.fragmentShader=shader.fragmentShader.replace('#include <normal_fragment_maps>',`
vec3 alpineGrassN=texture2D(alpine_grass_normalMap,alpineGrassUV).xyz*2.0-1.0;alpineGrassN.xy*=.3;
vec3 alpineEarthN=texture2D(alpine_earth_normalMap,alpineEarthUV).xyz*2.0-1.0;alpineEarthN.xy*=.5;
vec3 alpineStoneN=texture2D(alpine_limestone_normalMap,alpineStoneUV).xyz*2.0-1.0;alpineStoneN.xy*=.75;
vec3 alpineN=normalize(alpineStoneN*alpineWeights.r+alpineEarthN*alpineWeights.g+alpineGrassN*alpineWeights.b);
normal=normalize(tbn*alpineN);`);
        return;
      }
      shader.uniforms.meadowDriveMask={value:mask};shader.uniforms.meadowTurf={value:turf.map};
      shader.fragmentShader='uniform sampler2D meadowDriveMask;uniform sampler2D meadowTurf;\n'+shader.fragmentShader;
      shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>','#include <map_fragment>\nfloat drive=texture2D(meadowDriveMask,vMapUv*'+(8/(half*2)).toFixed(8)+'+.5).r;vec3 grass=texture2D(meadowTurf,vMapUv*2.0).rgb;diffuseColor.rgb=mix(grass,diffuseColor.rgb,drive);');
    };
    M.floor.customProgramCacheKey=()=>stylized?'elevated-alpine-stylized-v1':realTerrain?'elevated-alpine-pbr-v1':'elevated-alpine-meadow-v1';M.floor.userData.floorComposition={routes:structuredClone(routes),meadow:true,raised:false,pbr:!!realTerrain,style:stylized?'stylized':realTerrain?'photographic':'original'};M.floor.userData.meadowTextures=stylized?[M.floor.map,mask]:realTerrain?[...terrain.textures,mask]:[turf.map,mask];
  }
  const unitBox=geo(new THREE.BoxGeometry(1,1,1)),unitCylinder=geo(new THREE.CylinderGeometry(1,1,1,12)),unitSphere=geo(new THREE.SphereGeometry(1,10,6)),leafSphere=geo(new THREE.SphereGeometry(1,8,4));
  const dummy=new THREE.Object3D();
  function part(parent,geometry,material,position,scale=[1,1,1],rotation=[0,0,0],name=''){
    const o=new THREE.Mesh(geometry,material);o.position.set(...position);o.scale.set(...scale);o.rotation.set(...rotation);o.name=name;o.castShadow=true;o.receiveShadow=true;parent.add(o);return o;
  }
  function batch(parent,key,geometry,material,items){
    if(!items.length)return;const o=new THREE.InstancedMesh(geometry,material,items.length);o.name=key;o.castShadow=true;o.receiveShadow=true;
    items.forEach(([x,y,z,w,h,d,ry=0,rx=0,rz=0],i)=>{dummy.position.set(x,y,z);dummy.scale.set(w,h,d);dummy.rotation.set(rx,ry,rz);dummy.updateMatrix();o.setMatrixAt(i,dummy.matrix);});o.instanceMatrix.needsUpdate=true;o.computeBoundingSphere();parent.add(o);batches.set(key,o);return o;
  }
  // Borrow optimized authored meshes from the scene-owned GLB library.
  // Their original topology/UVs and alpha-cutout foliage are retained.
  function assetBatch(parent,key,source,placements,{grass=false,shadow=true}={}){
    if(!source||!placements.length)return [];
    source.updateWorldMatrix(true,true);const inverse=source.matrixWorld.clone().invert(),out=[];
    source.traverse(mesh=>{
      if(!mesh.isMesh||Array.isArray(mesh.material))return;
      const material=mat(mesh.material.clone());
      for(const value of Object.values(material))if(value?.isTexture)borrowedTextures.add(value);
      if(grass){
        material.onBeforeCompile=shader=>{
          shader.uniforms.alpineGrassTime=grassTime;
          shader.vertexShader='uniform float alpineGrassTime;\n'+shader.vertexShader;
          shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>
vec3 grassWorld=(modelMatrix*instanceMatrix*vec4(position,1.0)).xyz;
transformed.x+=max(0.0,position.y)*.08*sin(alpineGrassTime*1.7+grassWorld.x*.65+grassWorld.z*.35);`);
        };
        material.customProgramCacheKey=()=> 'alpine-authored-grass-wind-v1';
      }
      const transform=new THREE.Matrix4().multiplyMatrices(inverse,mesh.matrixWorld);
      const instance=new THREE.InstancedMesh(mesh.geometry,material,placements.length);
      instance.name=key+'-'+mesh.name;instance.castShadow=!grass&&shadow;instance.receiveShadow=true;
      for(let i=0;i<placements.length;i++){
        const[x,y,z,s,ry]=placements[i];dummy.position.set(x,y,z);dummy.scale.setScalar(s);dummy.rotation.set(0,ry,0);dummy.updateMatrix();
        instance.setMatrixAt(i,new THREE.Matrix4().multiplyMatrices(dummy.matrix,transform));
      }
      instance.instanceMatrix.needsUpdate=true;instance.computeBoundingSphere();parent.add(instance);batches.set(instance.name,instance);
      out.push({mesh:instance,placements,transform});
    });return out;
  }
  if(realTerrain&&assets.grass){
    const plants=[],R=random(5217);
    const occupied=(x,z)=>data.colliders.some(d=>d.id!=='floor'&&Math.abs(x-d.position.x)<d.half.x+.7&&Math.abs(z-d.position.z)<d.half.z+.7);
    for(let i=0;i<16000&&plants.length<850;i++){
      const x=(R()-.5)*112,z=(R()-.5)*112,edge=meadowEdge(x,z);
      if(edge<.85||edge>5||occupied(x,z)||data.spawns.some(p=>Math.hypot(x-p.x,z-p.z)<3)||data.sockets.some(p=>Math.hypot(x-p.x,z-p.z)<1.3))continue;
      plants.push([x,.008,z,2.6+R()*1.2,R()*TAU]);
    }
    grassBatches.push(...assetBatch(soft,'meadow-authored-grass-near',assets.grass,plants,{grass:true}).map(b=>({...b,near:true})));
    if(assets.grassLOD)grassBatches.push(...assetBatch(soft,'meadow-authored-grass-far',assets.grassLOD,plants,{grass:true}).map(b=>({...b,near:false})));
    for(const b of grassBatches)b.mesh.count=0;
  }
  const materialFor=d=>d.id==='floor'?M.floor:d.material==='ice'?M.ice:d.material==='steel'?M.steel:d.material==='barrier'?(harbor?M.steel:frost?M.slate:M.stone):d.material==='hedge'?M.leaf:d.material==='cargo-teal'?M.cargoTeal:d.material==='cargo-orange'?M.cargoOrange:d.material==='slate'?M.slate:M.stone;
  for(const d of data.colliders){
    const root=new THREE.Group();root.name=d.id;root.position.copy(d.position);if(d.rotation)root.quaternion.set(d.rotation.x,d.rotation.y,d.rotation.z,d.rotation.w).normalize();
    root.userData.collider=structuredClone(d);solids.add(root);const material=materialFor(d);
    const geometry=geo(elevatedSolidGeometry(THREE,d));let bodyMaterial=material;
    if(stylized&&(d.shape==='deck'||d.shape==='wedge')){
      // Driving faces use the same quiet paving as their approaches. Brick
      // remains on structural sides, never stretched over a giant roof.
      // Index ordering changes only presentation; every support vertex stays.
      const top=[],sides=[],normal=geometry.attributes.normal;
      for(let i=0;i<normal.count;i+=3)(normal.getY(i)>.65?top:sides).push(i,i+1,i+2);
      geometry.setIndex([...top,...sides]);geometry.addGroup(0,top.length,1);geometry.addGroup(top.length,sides.length,0);
      bodyMaterial=[material,M.floor];
    }
    const body=part(root,geometry,bodyMaterial,[0,0,0]);body.name=d.id+'-body';body.userData.colliderId=d.id;body.castShadow=d.id!=='floor';
    // Visible skins may be inset (cargo ribs) or rounded at corners. Camera
    // clearance still uses the whole shared authority solid, never that skin.
    const cameraGeometry=d.shape==='wedge'?geometry:geo(new THREE.BoxGeometry(d.half.x*2,d.half.y*2,d.half.z*2));
    const cameraBody=new THREE.Mesh(cameraGeometry,material);cameraBody.name=d.id+'-camera-solid';cameraBody.visible=false;cameraBody.userData.cameraCollider=true;root.add(cameraBody);
    colliderMeshes.set(d.id,{group:root,body,cameraBody,descriptor:structuredClone(d)});
    const h=d.half;
    if(d.material?.startsWith('cargo-')){
      // Inset skin makes true ribs and corner fittings legible without ever
      // exceeding the exact physical box. Each map uses the same treatment.
      body.scale.set((h.x-.12)/h.x,(h.y-.10)/h.y,(h.z-.12)/h.z);
      const ribs=[],corners=[],fittings=[];
      for(const side of [-1,1]){
        for(let x=-h.x+.35;x<h.x-.3;x+=.65)ribs.push([x,0,side*(h.z-.055),.10,h.y*2-.3,.10]);
        for(let z=-h.z+.35;z<h.z-.3;z+=.65)ribs.push([side*(h.x-.055),0,z,.10,h.y*2-.3,.10]);
        for(const x of [-1,1])corners.push([x*(h.x-.13),0,side*(h.z-.13),.26,h.y*2,.26]);
        for(const y of [-1,1])fittings.push([0,y*(h.y-.10),side*(h.z-.055),h.x*2-.25,.18,.1]);
        for(const x of [-1,1])fittings.push([x*(h.x-.42),0,side*(h.z-.06),.07,h.y*2-.7,.1]);
      }
      batch(root,d.id+'-corrugated-ribs',unitBox,material,ribs);batch(root,d.id+'-corner-castings',unitBox,M.iron,corners);batch(root,d.id+'-door-lock-bars',unitBox,M.brass,fittings);
    }else if(d.shape==='deck'){
      const edges=[],bolts=[];
      for(const s of [-1,1]){
        edges.push([s*(h.x-.12),-.10,0,.18,.38,h.z*2-.24],[0,-.10,s*(h.z-.12),h.x*2-.24,.38,.18]);
        for(let x=-h.x+1;x<h.x;x+=2)bolts.push([x,h.y-.023,s*(h.z-.38),.045,.022,.045]);
      }
      batch(root,d.id+'-finite-edge-beams',unitBox,d.material==='steel'?M.iron:M.slate,edges);batch(root,d.id+'-recessed-fixings',unitCylinder,M.brass,bolts);
    }else if(d.id.includes('pier')){
      const trims=[];for(const y of [-h.y+.12,h.y-.12])trims.push([0,y,0,h.x*2-.08,.20,h.z*2-.08]);
      batch(root,d.id+'-pier-caps',unitBox,d.material==='steel'?M.iron:M.slate,trims);
    }else if(d.material==='hedge'){
      if(stylized&&assets.stylized.getObjectByName('BushA')){
        const source=assets.stylized.getObjectByName('BushA'),bounds=new THREE.Box3().setFromObject(source),size=bounds.getSize(new THREE.Vector3());
        const scale=Math.min((h.y*2-.12)/size.y,1.4),width=size.x*scale,depth=size.z*scale,plants=[];
        const cols=Math.max(1,Math.floor((h.x*2-.2)/width)),rows=Math.max(1,Math.floor((h.z*2-.2)/depth));
        for(let x=0;x<cols;x++)for(let z=0;z<rows;z++)plants.push([(x-(cols-1)/2)*width,-h.y+.04,(z-(rows-1)/2)*depth,scale,0]);
        body.scale.y=.4;body.position.y=-h.y*.6;
        assetBatch(root,d.id+'-painted-flower-bushes',source,plants);
        continue;
      }
      body.scale.y=.85;body.position.y=-h.y*.15;
      const leaves=[],flowers=[],R=random(d.id.length*67);
      for(let i=0;i<140;i++){let x=(R()-.5)*(h.x*2-.8),y=h.y-.45,z=(R()-.5)*(h.z*2-.8);if(i%2){y=(R()-.5)*(h.y*2-.8);if(i%4===1)x=(i%8===1?1:-1)*(h.x-.35);else z=(i%8===3?1:-1)*(h.z-.35);}leaves.push([x,y,z,.35,.40,.35]);}
      for(let i=0;i<26;i++)flowers.push([(R()-.5)*(h.x*2-.4),h.y-.13,(R()-.5)*(h.z*2-.4),.10,.1,.1]);
      const leafMesh=batch(root,d.id+'-clipped-leaf-clusters',leafSphere,M.leaf,leaves),flowerMesh=batch(root,d.id+'-flowers',leafSphere,standard(0xffffff,{roughness:.8}),flowers),leafTones=[0xdbe5b8,0xa9d4b5,0x90b589],flowerTones=[0xffcc64,0xf197ca,0xcfe7ff];
      for(let i=0;i<leaves.length;i++)leafMesh.setColorAt(i,new THREE.Color(leafTones[i%3]));for(let i=0;i<flowers.length;i++)flowerMesh.setColorAt(i,new THREE.Color(flowerTones[i%3]));
    }else if(d.id==='fountain-base'){
      const fountain=data.environment==='alpine'&&assets.fountain?.getObjectByName('FountainA');
      if(fountain){
        // The authored square plinth fills the existing 8x8 silhouette. Its
        // octagonal water inset is only 10cm below the 2.4m collision ceiling;
        // the carved central rosette also stays below that support height.
        body.visible=false;
        const pieces=assetBatch(root,'fountain-authored',fountain,[[0,-h.y,0,1,0]]);
        for(const {mesh} of pieces){
          // The broad shallow coping self-shadows at this world's large
          // directional-light texel size. It still casts its arena shadow;
          // ordinary lighting supplies the carved stone's facet contrast.
          if(mesh.name.endsWith('FountainA_Stone'))mesh.receiveShadow=false;
          if(!mesh.name.endsWith('FountainA_Water'))continue;
          mesh.castShadow=false;mesh.material.emissive.set(0x0c3338);mesh.material.emissiveIntensity=.12;
          mesh.material.onBeforeCompile=shader=>{
            shader.uniforms.fountainTime=fountainTime;
            shader.vertexShader='varying vec3 vFountainPosition;\n'+shader.vertexShader;
            shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvFountainPosition=position;');
            shader.fragmentShader='varying vec3 vFountainPosition;uniform float fountainTime;\n'+shader.fragmentShader;
            shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
float ripple=sin(length(vFountainPosition.xz)*15.0-fountainTime*1.8+sin(vFountainPosition.x*3.0)*.5);
float glint=pow(max(0.0,ripple),12.0)*.045;
diffuseColor.rgb+=vec3(.65,.90,.94)*glint;`);
          };
          mesh.material.customProgramCacheKey=()=> 'alpine-inset-fountain-shimmer-v1';
        }
        root.userData.authoredFountain={root:'FountainA',waterInset:.10,collisionEnvelope:[8,2.4,8]};
        continue;
      }
      body.scale.y=.28;body.position.y=-h.y*.72;
      const rim=[];for(const s of [-1,1])rim.push([s*(h.x-.24),.02,0,.48,h.y*2-.1,h.z*2],[0,.02,s*(h.z-.24),h.x*2-.48,h.y*2-.1,.48]);
      batch(root,'fountain-carved-rim',unitBox,M.stone,rim);
      const water=part(root,geo(new THREE.BoxGeometry(h.x*2-.65,.02,h.z*2-.65)),standard(0x3994a2,{metalness:.2,roughness:.24}),[0,.72,0]);water.name='fountain-basin-water';
      part(root,unitCylinder,M.stone,[0,.22,0],[.72,1.75,.72]);part(root,unitSphere,M.stone,[0,.87,0],[.72,.26,.72]);
    }
  }

  // Three original mountain layers have physically faceted faces and snow
  // above a varying snowline; they never wall off or collide with the arena.
  function ridge(radius,height,seed,name){
    const verts=[],colors=[],idx=[],N=112,B=6,color=new THREE.Color(),rock=new THREE.Color(frost?0x8bafc5:0x7f9caa),snow=new THREE.Color(0xd3e7f3),green=new THREE.Color(0x3d7365),distanceBlue=new THREE.Color(0x88b5d0);
    for(let i=0;i<=N;i++)for(let j=0;j<=B;j++){
      const a=i/N*TAU,f=j/B,r=radius+f*44+Math.sin(a*13+seed)*3,valley=.38+.62*Math.pow(.5+.5*Math.sin(a*2+seed*.3),.7),peak=(.47+.30*Math.pow(.5+.5*Math.sin(a*7+seed),3)+.23*Math.pow(.5+.5*Math.cos(a*19+seed),2))*valley;
      const y=-3+height*peak*Math.pow(Math.sin(f*Math.PI),1.3)+Math.sin(a*29+j)*1.5;
      verts.push(Math.cos(a)*r,y,Math.sin(a)*r);color.copy(rock).multiplyScalar(.82+.13*Math.sin(a*31+j*2));if(!frost)color.lerp(green,clamp(1-y/14,0,.75));color.lerp(snow,clamp((y-height*(frost?.25:.43))/8,0,1));color.lerp(distanceBlue,clamp((radius-105)/240,0,.55));colors.push(color.r,color.g,color.b);
      if(i<N&&j<B){const k=i*(B+1)+j;idx.push(k,k+B+1,k+1,k+1,k+B+1,k+B+2);}
    }
    const g=geo(new THREE.BufferGeometry());g.setAttribute('position',new THREE.Float32BufferAttribute(verts,3));g.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));g.setIndex(idx);g.computeVertexNormals();part(scenery,g,standard(0xffffff,{vertexColors:true,roughness:1,flatShading:true,side:THREE.DoubleSide}),[0,0,0],[1,1,1],[0,0,0],name);
  }
  function pineGeometry(){
    const p=[],n=[],colors=[],leafColor=new THREE.Color();for(let tier=0;tier<6;tier++){
      const crown=new THREE.ConeGeometry(.66-tier*.085,.36,10).toNonIndexed(),positions=crown.attributes.position;
      for(let i=0;i<positions.count;i++){const x=positions.getX(i),z=positions.getZ(i),a=Math.atan2(z,x),r=1+.22*Math.sin(a*3+tier*1.7)+.11*Math.cos(a*5+tier);positions.setXYZ(i,x*r+Math.sin(tier*2)*.095,positions.getY(i)+.39+tier*.105+.04*Math.cos(a*3+tier),z*r+Math.cos(tier*1.3)*.075);leafColor.set(0xffffff).multiplyScalar(.69+tier*.047+.12*Math.sin(a*3));colors.push(leafColor.r,leafColor.g,leafColor.b);}
      crown.computeVertexNormals();p.push(...positions.array);n.push(...crown.attributes.normal.array);crown.dispose();
    }
    const g=geo(new THREE.BufferGeometry());g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.setAttribute('normal',new THREE.Float32BufferAttribute(n,3));g.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));return g;
  }
  if(!harbor&&!stylized){
    ridge(112,19,1.3,'valley-foothills');ridge(184,39,3.7,'alpine-distant-ridges');ridge(268,60,7.1,'snow-summit-horizon');
    const turf=standard(frost?0xb9ccd0:0xffffff,{...(realTerrain?pbr(terrain.sets.grass):pattern('grass',256)),roughness:1,bumpScale:.003});
    for(const[x,z,w,d]of[[-137,0,150,400],[137,0,150,400],[0,-137,124,150],[0,137,124,150]]){const ground=geo(new THREE.PlaneGeometry(w,d).rotateX(-Math.PI/2));physicalUV(THREE,ground);const meadow=part(scenery,ground,turf,[x,-.35,z],[1,1,1],[0,0,0],'outside-valley-meadow');meadow.castShadow=false;}
    if(realTerrain&&assets.nature){
      // Authored fir cards/bark and scanned rock topology retain their UVs.
      // Roots sit on the outside meadow, with complete crowns/rocks beyond
      // the authoritative field. The hidden GLB library owns their resources.
      const trees=[[],[]],rocks=[],R=random(230);
      for(let i=0;i<64;i++){
        const side=i%4,along=-94+Math.floor(i/4)*12.5+(R()-.5)*8,out=half+13+R()*25;
        const x=side<2?along:(side===2?-out:out),z=side<2?(side===0?-out:out):along;
        trees[(Math.floor(i/4)+side)%2].push([x,-.35,z,1.35+R()*.95,R()*TAU]);
      }
      for(let i=0;i<20;i++){
        const side=i%4,along=-79+Math.floor(i/4)*37+(R()-.5)*12,out=half+10+R()*13;
        rocks.push([side<2?along:side===2?-out:out,-.35,side<2?side===0?-out:out:along,1.2+R()*1.1,R()*TAU]);
      }
      for(const[index,name]of ['SpruceA','SpruceB'].entries()){
        natureBatches.push(...assetBatch(scenery,'authored-fir-near-'+name,assets.nature.getObjectByName(name),trees[index]).map(b=>({...b,near:true})));
        natureBatches.push(...assetBatch(scenery,'authored-fir-far-'+name,assets.nature.getObjectByName(name+'_Low'),trees[index],{shadow:false}).map(b=>({...b,near:false})));
      }
      assetBatch(scenery,'authored-limestone-outcrops',assets.nature.getObjectByName('LimestoneOutcrop'),rocks);
      for(const b of natureBatches)b.mesh.count=0;
    }else{
      const crowns=[],trunks=[],snowTips=[],R=random(frost?491:230),pine=pineGeometry();
      for(let i=0;i<115;i++){
        const side=i%4,cluster=Math.floor(i/4)%8,along=-85+cluster*24+(R()-.5)*12,out=half+13+R()*30;
        const x=side<2?along:(side===2?-out:out),z=side<2?(side===0?-out:out):along;
        const h=4.2+R()*4,w=2.5+R()*2;crowns.push([x,0,z,w,h,w,R()*TAU]);trunks.push([x,h*.19,z,.16,h*.38,.16]);if(frost)snowTips.push([x,h*.84,z,w*.15,h*.14,w*.15]);
      }
      batch(scenery,'clustered-fir-crowns',pine,M.pine,crowns);batch(scenery,'clustered-fir-trunks',unitCylinder,M.trunk,trunks);if(frost)batch(scenery,'fir-snow-tips',geo(new THREE.ConeGeometry(1,1,10)),M.snow,snowTips);
      const rock=geo(new THREE.DodecahedronGeometry(1,0)),items=[];
      for(let i=0;i<50;i++){const side=i%4,out=half+12+R()*16,along=(R()-.5)*145;items.push([side<2?along:side===2?-out:out,1+R()*2,side<2?side===0?-out:out:along,2+R()*3,2+R()*3,2+R()*3,R()*TAU]);}
      batch(scenery,'broken-limestone-outcrops',rock,M.slate,items);
    }
  }

  if(stylized){
    const library=assets.stylized,turf=standard(0x3bba5b,{roughness:1});
    for(const[x,z,w,d]of[[-137,0,150,400],[137,0,150,400],[0,-137,124,150],[0,137,124,150]]){
      const meadow=part(scenery,geo(new THREE.PlaneGeometry(w,d).rotateX(-Math.PI/2)),turf,[x,-.35,z],[1,1,1],[0,0,0],'stylized-outside-meadow');meadow.castShadow=false;
    }
    createStylizedAlpineLandscape(THREE,{parent:scenery,half,geometry:geo,material:mat,part});
    const cloudParts=[],C=random(509);
    for(const[x,y,z]of [[-104,41,151],[12,48,199],[123,41,179],[-136,45,-113],[126,43,-147]])for(let i=0;i<7;i++)cloudParts.push([x+(i-3)*5.2,y+(i%3)*1.3,z+(C()-.5)*4,7+ C()*3,3.1+C()*1.8,5+C()*3]);
    const clouds=batch(soft,'stylized-soft-clouds',geo(new THREE.SphereGeometry(1,12,8)),standard(0xf6fbff,{roughness:1,emissive:0xc7e1f7,emissiveIntensity:.10}),cloudParts);clouds.castShadow=false;

    const R=random(2091),treeKinds=['PineA','PineB','TreeA'],trees=treeKinds.map(()=>[]),rocks=[];
    for(let i=0;i<75;i++){
      const side=i%4,along=-94+Math.floor(i/4)*10+(R()-.5)*9,out=half+16+R()*27;
      const x=side<2?along:side===2?-out:out,z=side<2?side===0?-out:out:along;
      trees[i%3].push([x,-.35,z,1.65+R()*.8,R()*TAU]);
    }
    // Painted trees form the distant border. Avoid repeated alpha-cutout shadow passes.
    for(const[index,name]of treeKinds.entries())natureBatches.push(...assetBatch(scenery,'stylized-tree-'+name,library.getObjectByName(name),trees[index],{shadow:false}).map(b=>({...b,near:true,styled:true})));
    for(let i=0;i<24;i++){
      const side=i%4,along=-88+Math.floor(i/4)*32+(R()-.5)*12,out=half+12+R()*9;
      rocks.push([side<2?along:side===2?-out:out,-.35,side<2?side===0?-out:out:along,1.1+R()*.9,R()*TAU]);
    }
    for(const[index,name]of ['RockA','RockB'].entries())assetBatch(scenery,'stylized-rock-'+name,library.getObjectByName(name),rocks.filter((_,i)=>i%2===index));
    const homes=[[18,-.35,half+21,1,Math.PI],[-9,-.35,half+23,.88,Math.PI-.07],[44,-.35,half+25,.9,Math.PI+.10],[-half-21,-.35,13,.95,Math.PI/2],[-half-22,-.35,-14,.84,Math.PI/2]];
    assetBatch(scenery,'stylized-painted-cottages',library.getObjectByName('CottageA'),homes);
    const plants=[],blooms=[];
    const occupied=(x,z)=>data.colliders.some(d=>d.id!=='floor'&&Math.abs(x-d.position.x)<d.half.x+.7&&Math.abs(z-d.position.z)<d.half.z+.7);
    for(let i=0;i<14000&&plants.length<500;i++){
      const x=(R()-.5)*112,z=(R()-.5)*112,edge=meadowEdge(x,z);
      if(edge<1||edge>4.5||occupied(x,z)||data.spawns.some(p=>Math.hypot(x-p.x,z-p.z)<3)||data.sockets.some(p=>Math.hypot(x-p.x,z-p.z)<1.3))continue;
      const flower=(plants.length+blooms.length)%7===0;(flower?blooms:plants).push([x,.008,z,flower?.8+R()*.25:1+R()*.5,R()*TAU]);
      if(plants.length+blooms.length>=500)break;
    }
    // One geometry set per kit material, with a shared time and bounded range.
    grassBatches.push(...assetBatch(soft,'stylized-meadow-grass',library.getObjectByName('GrassA'),plants,{grass:true}).map(b=>({...b,near:true})));
    grassBatches.push(...assetBatch(soft,'stylized-meadow-flowers',library.getObjectByName('FlowersA'),blooms,{grass:true}).map(b=>({...b,near:true})));
    for(const b of grassBatches)b.mesh.count=0;
  }

  // Original timber/metal landmarks are outside the legal envelope. Detail
  // is structural geometry (braces, roof, window frames), not a giant box.
  const roofGeo=(()=>{const p=[[-1,0,-1],[1,0,-1],[1,0,1],[-1,0,1],[0,.8,-1],[0,.8,1]],i=[0,3,4,3,5,4,1,4,2,2,4,5,0,4,1,3,2,5];const g=geo(new THREE.BufferGeometry());g.setAttribute('position',new THREE.Float32BufferAttribute(i.flatMap(k=>p[k]),3));g.computeVertexNormals();physicalUV(THREE,g);return g;})();
  const villageTimbers=[],villageRails=[],villageWindows=[],villageFrames=[];
  function lodge(x,z,tower=false){
    const height=tower?16:6,w=tower?7:13,depth=tower?7:9,posts=[],rails=[],panels=[],windows=[];
    part(scenery,unitBox,M.stone,[x,height*.15,z],[w,height*.3,depth]);
    part(scenery,unitBox,M.wood,[x,height*.58,z],[w-.2,height*.56,depth-.2]);
    for(const sx of [-1,1])for(const sz of [-1,1])posts.push([x+sx*(w/2-.12),height*.59,z+sz*(depth/2-.12),.36,height*.77,.36]);
    for(const y of [height*.32,height*.70,height*.89])rails.push([x,y,z-depth/2-.05,w+.3,.27,.34],[x-w/2,y,z,.3,.27,depth],[x+w/2,y,z,.3,.27,depth]);
    for(const sx of [-1,1]){windows.push([x+sx*w*.26,height*.6,z-depth/2-.035,w*.22,height*.23,.08]);panels.push([x+sx*w*.26,height*.6,z-depth/2-.11,.13,height*.27,.15]);}
    villageTimbers.push(...posts);villageRails.push(...rails);villageWindows.push(...windows);villageFrames.push(...panels);
    part(scenery,roofGeo,standard(frost?0xdbe6ed:0x465d72,{roughness:.8}),[x,height*.9,z],[w*.59,tower?5:3.9,depth*.64]);
  }
  function crane(x,z,size=1){
    const G=new THREE.Group();G.name='outside-quarry-crane';G.position.set(x,0,z);G.scale.setScalar(size);scenery.add(G);
    const members=[],brace=[],angle=.40;
    for(const s of [-1,1]){members.push([s*3,10,0,.9,20,.9],[0,20,0,17,.8,1],[s*3,2,0,2,4,3]);for(let y=3;y<19;y+=4)members.push([0,y,0,6,.5,.6]);}
    batch(G,'crane-steel-frame-'+x,unitBox,M.iron,members);
    for(let y=4;y<17;y+=4)brace.push([0,y,0,6.6,.3,.35,0,0,y%8?angle:-angle]);batch(G,'crane-diagonal-braces-'+x,unitBox,M.brass,brace);
    part(G,unitCylinder,M.iron,[7,13,0],[.08,13,.08]);part(G,unitBox,M.brass,[7,6.9,0],[1.8,1.8,1.8]);part(G,unitBox,M.steel,[-3,17,0],[3.4,3.6,3]);
  }
  if(!harbor&&!realTerrain&&!stylized){
    lodge(16,half+15,true);lodge(-8,half+15);lodge(38,half+17);if(frost)crane(half+15,12,1.1);
    batch(scenery,'village-timber-posts',unitBox,M.trunk,villageTimbers);batch(scenery,'village-balcony-edgework',unitBox,M.wood,villageRails);batch(scenery,'village-lit-windows',unitBox,M.light,villageWindows);batch(scenery,'village-window-frames',unitBox,M.iron,villageFrames);
    const apron=[];for(let i=0;i<7;i++)apron.push([-half-12-i*2.2,1,8+i*3,1.7,2,18]);batch(scenery,'quarry-cut-rock-face',unitBox,M.slate,frost?apron:[]);
  }else if(harbor){
    const waterMat=mat(new THREE.ShaderMaterial({uniforms:{uTime:{value:0},uWarm:{value:.6}},vertexShader:'varying vec3 vWorld;void main(){vec4 p=modelMatrix*vec4(position,1.0);vWorld=p.xyz;gl_Position=projectionMatrix*viewMatrix*p;}',fragmentShader:'varying vec3 vWorld;uniform float uTime;uniform float uWarm;void main(){float w=sin(vWorld.x*.25+sin(vWorld.z*.13+uTime*.4)*2.0)+sin(vWorld.z*.72-uTime*.6);float glint=pow(max(0.0,w*.5),12.0)*.42;float ribbon=exp(-pow((vWorld.x-25.0)/18.0,2.0));vec3 c=mix(vec3(.04,.19,.26),vec3(.07,.30,.37),w*.15+.5);c+=mix(vec3(.24,.56,.69),vec3(.94,.48,.20),uWarm)*glint*ribbon;gl_FragColor=vec4(c,1.0);\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n}',side:THREE.DoubleSide}));
    const shore=half+2,waterExtent=330,waterSpan=waterExtent-shore,waterCenter=(waterExtent+shore)/2;
    for(const [x,z,w,h]of [[-waterCenter,0,waterSpan,waterExtent*2],[waterCenter,0,waterSpan,waterExtent*2],[0,-waterCenter,shore*2,waterSpan],[0,waterCenter,shore*2,waterSpan]]){const water=part(scenery,geo(new THREE.PlaneGeometry(w,h)),waterMat,[x,-.2,z],[1,1,1],[-Math.PI/2,0,0],'sunset-water-perimeter');water.castShadow=false;}
    const cargo=[],rib=[];
    for(let i=0;i<14;i++){const x=-55+i*8.2,z=half+12+(i%3)*7,levels=i%2?2:1;for(let level=0;level<levels;level++){const y=3+level*6;cargo.push([x,y,z,7,6,6]);for(let a=-3;a<3;a+=.7)rib.push([x+a,y,z-3.04,.13,5.8,.13]);}}
    batch(scenery,'harbor-stacked-cargo',unitBox,M.cargoTeal,cargo);batch(scenery,'harbor-cargo-ribs',unitBox,M.iron,rib);
    const warehouse=new THREE.Group();warehouse.name='loading-warehouse';warehouse.position.set(-22,0,-half-17);scenery.add(warehouse);
    part(warehouse,unitBox,M.steel,[0,6,0],[35,12,17]);part(warehouse,roofGeo,M.iron,[0,12,0],[19,6,10]);
    const doors=[],frames=[];for(const x of [-11,0,11]){doors.push([x,3.5,8.55,8,7,.1]);frames.push([x,7.1,8.7,8.6,.25,.4]);for(const s of [-1,1])frames.push([x+s*4.2,3.5,8.7,.25,7,.4]);}
    batch(warehouse,'warehouse-loading-doors',unitBox,M.iron,doors);batch(warehouse,'warehouse-loading-door-frames',unitBox,M.brass,frames);
    crane(half+18,-32,1.5);crane(-half-18,24,1.6);
    const ship=new THREE.Group();ship.name='distant-freight-ship';ship.position.set(126,0,96);ship.rotation.y=-.3;scenery.add(ship);
    part(ship,geo(beveledBox(THREE,{x:13,y:3,z:32},1.8)),M.iron,[0,2,0]);part(ship,unitBox,M.steel,[0,10,-16],[15,14,12]);
    const lights=[];for(let z=-24;z<20;z+=9)lights.push([0,8,z,17,6,7]);batch(ship,'freight-deck-cargo',unitBox,M.cargoOrange,lights);
    part(ship,unitCylinder,M.iron,[0,23,-16],[.2,13,.2]);
    group.userData.waterMaterial=waterMat;
  }

  // Millimetre-thin cosmetic insets add local material variation. They are
  // never added to the solid list, never obscure raised/ramp surfaces and
  // never masquerade as walls or gaps. Moss stays along the outer curb.
  const groundPlane=geo(new THREE.PlaneGeometry(1,1).rotateX(-Math.PI/2));
  if(!harbor&&!realTerrain&&!stylized){
    const insets=[],moss=[],flowers=[],R=random(frost?923:621);
    const occupied=(x,z)=>data.colliders.some(d=>d.id!=='floor'&&Math.abs(x-d.position.x)<d.half.x+2&&Math.abs(z-d.position.z)<d.half.z+2);
    for(let i=0;i<180;i++){const x=(R()-.5)*110,z=(R()-.5)*110;if(!occupied(x,z))insets.push([x,.003,z,.6+R()*.65,1,.7+R()*.4]);}
    for(let i=0;i<220;i++){const side=i%4,a=(R()-.5)*114,out=56+R()*2.3,x=side<2?a:side===2?-out:out,z=side<2?side===0?-out:out:a;moss.push([x,.005,z,.2+R()*.75,1,.15+R()*.55,R()*TAU]);if(!frost&&i%4===0)flowers.push([x,.035,z,.08,.035,.08]);}
    batch(soft,'flush-paver-insets',groundPlane,standard(frost?0x53616a:0x68695d,{roughness:1,transparent:true,opacity:.25,depthWrite:false}),insets);
    batch(soft,'curb-flat-moss',groundPlane,standard(frost?0x9aaead:0x4d7960,{roughness:1}),moss);
    if(!frost)batch(soft,'curb-yellow-flower-dots',unitSphere,standard(0xefc769),flowers);
  }else if(harbor){
    // These are loading-bay markings rather than a racing circuit. Reuse
    // each solid envelope for its rim pieces instead of adding new cover.
    const paint=[],puddles=[],R=random(1522);
    for(const d of data.colliders.filter(d=>d.material.startsWith('cargo-'))){
      for(const side of [-1,1])paint.push([d.position.x+side*(d.half.x+1),.004,d.position.z,.09,1,d.half.z*2+2],[d.position.x,.004,d.position.z+side*(d.half.z+1),d.half.x*2+2,1,.09]);
    }
    for(let i=0;i<16;i++){const x=(R()-.5)*108,z=(R()-.5)*108;if(data.colliders.some(d=>d.id!=='floor'&&Math.abs(x-d.position.x)<d.half.x+3&&Math.abs(z-d.position.z)<d.half.z+3))continue;puddles.push([x,.003,z,2+R()*3,1,1+R()*2,R()*TAU]);}
    batch(soft,'inset-cargo-bay-paint',groundPlane,M.brass,paint);
    const puddleGeo=geo(new THREE.CircleGeometry(.5,24).rotateX(-Math.PI/2));
    batch(soft,'flush-wet-dock-patches',puddleGeo,standard(0x485a64,{metalness:.3,roughness:.11}),puddles);
  }

  // Cargo ribs, dock fittings and railings share static geometry/materials.
  // Merge their instance buffers across solids; keep every collider body
  // separate for camera obstruction and exact simulation correspondence.
  if(harbor){
    group.updateMatrixWorld(true);
    const buckets=new Map(),instance=new THREE.Matrix4(),transform=new THREE.Matrix4(),inverse=new THREE.Matrix4().copy(solids.matrixWorld).invert();
    solids.traverse(o=>{if(!o.isInstancedMesh||o.instanceColor)return;const key=o.geometry.uuid+':'+o.material.uuid;if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(o);});
    for(const meshes of buckets.values()){
      if(meshes.length<2)continue;
      const first=meshes[0],joined=new THREE.InstancedMesh(first.geometry,first.material,meshes.reduce((n,o)=>n+o.count,0));
      joined.name='shared-dock-detail-'+first.material.name+'-'+batches.size;joined.castShadow=first.castShadow;joined.receiveShadow=first.receiveShadow;
      joined.userData.colliderIds=[];let index=0;
      for(const source of meshes){
        transform.multiplyMatrices(inverse,source.matrixWorld);
        for(let i=0;i<source.count;i++){source.getMatrixAt(i,instance);instance.premultiply(transform);joined.setMatrixAt(index++,instance);joined.userData.colliderIds.push(source.parent.name);}
        source.removeFromParent();batches.delete(source.name);source.dispose();
      }
      joined.instanceMatrix.needsUpdate=true;joined.computeBoundingSphere();solids.add(joined);batches.set(joined.name,joined);
    }
  }

  const skyMat=mat(new THREE.ShaderMaterial({uniforms:{uTop:{value:new THREE.Color()},uMid:{value:new THREE.Color()},uHorizon:{value:new THREE.Color()}},vertexShader:'varying vec3 vPos;void main(){vPos=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',fragmentShader:'varying vec3 vPos;uniform vec3 uTop;uniform vec3 uMid;uniform vec3 uHorizon;void main(){float h=normalize(vPos).y;vec3 c=mix(uHorizon,uMid,smoothstep(-.07,.23,h));c=mix(c,uTop,smoothstep(.18,.82,h));gl_FragColor=vec4(c,1.0);\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n}',side:THREE.BackSide,depthWrite:false,fog:false}));
  const sky=part(soft,geo(new THREE.SphereGeometry(410,32,18)),skyMat,[0,0,0],[1,1,1],[0,0,0],'procedural-sky');sky.castShadow=sky.receiveShadow=false;sky.renderOrder=-10;
  const sunDisc=part(soft,geo(new THREE.SphereGeometry(5.5,20,12)),basic(0xffedce),[145,95,210],[1,1,1],[0,0,0],'sun-disc');sunDisc.castShadow=sunDisc.receiveShadow=false;
  const sun=new THREE.DirectionalLight(0xffdfae,2.0),hemi=new THREE.HemisphereLight(0xb6d4ff,0x284b73,.65);sun.name='elevated-sun';hemi.name='elevated-ambient';sun.castShadow=true;sun.shadow.mapSize.set(1536,1536);Object.assign(sun.shadow.camera,{left:-80,right:80,top:80,bottom:-80,near:5,far:245});sun.shadow.bias=-.0004;sun.shadow.normalBias=.06;sun.shadow.radius=2;sun.target.position.set(0,0,0);if(lighting)group.add(sun,hemi,sun.target);
  const fixed=palette==='Starlight'?1:palette==='Sunset'?.65:0;
  const lightingState={phase:fixed,sun,hemisphere:hemi,fogColor:new THREE.Color(),fogNear:185,fogFar:430,exposure:1.05};
  const channels=['top','mid','horizon'],uniformNames={top:'uTop',mid:'uMid',horizon:'uHorizon'};
  const C={top:new THREE.Color(),mid:new THREE.Color(),horizon:new THREE.Color()};
  const colorSet=(top,mid,horizon)=>({top:new THREE.Color(top),mid:new THREE.Color(mid),horizon:new THREE.Color(horizon)});
  const daylight=colorSet(0x1575d5,0x55a9e7,0xa6d7ef),sunset=colorSet(0x435485,0xd78b8b,0xfcc183),night=colorSet(0x12233e,0x24485f,0x66818b);
  const paintedSkyFill=new THREE.Color(0xf0f8ff),paintedGroundFill=new THREE.Color(0x91bb97);
  function animate(dt,time,skyPhase){
    if(disposed)return;const p=Number.isFinite(skyPhase)?clamp(skyPhase,0,1):fixed,a=p<=.65?daylight:sunset,b=p<=.65?sunset:night,t=p<=.65?p/.65:(p-.65)/.35;
    for(const k of channels){C[k].copy(a[k]).lerp(b[k],t);skyMat.uniforms[uniformNames[k]].value.copy(C[k]);}
    lightingState.phase=p;lightingState.fogColor.copy(C.horizon);sun.color.set(p<.7?0xffe5c4:0xc2dcff);
    // The painted kit needs sky and ground fill on its vertical brick and
    // foliage faces. Strong direct sun with dark olive fill hid those colours.
    const paintedDay=stylized?1-Math.min(1,p/.65):0;
    sun.intensity=(stylized?2.1:realTerrain?1.9:2.4)-p*(stylized?1.35:realTerrain?1.1:1.5)-paintedDay*.35;
    hemi.intensity=(stylized?1.05:realTerrain?1.25:harbor?.95:.65)+p*.2+paintedDay*.6;
    hemi.color.set(p<.7?0xcde3f5:0x9cc1ed).lerp(paintedSkyFill,paintedDay);
    hemi.groundColor.set(stylized?0x6d845b:realTerrain?0x8b9b79:0x284b73).lerp(paintedGroundFill,paintedDay);
    sun.position.set(stylized?-55:106,84-p*54,stylized?-45:48);sunDisc.position.copy(sun.position).multiplyScalar(2.1);sunDisc.material.color.set(p<.7?0xffe5b8:0xd8e8ff);
    grassTime.value=Number.isFinite(time)?time:0;
    fountainTime.value=Number.isFinite(time)?time:0;
    if(group.userData.waterMaterial){group.userData.waterMaterial.uniforms.uTime.value=Number.isFinite(time)?time:0;group.userData.waterMaterial.uniforms.uWarm.value=clamp(1-Math.abs(p-.65)*2,0,1);}
  }
  let detailElapsed=.25;
  function updateDetail(camera,dt=.25){
    detailElapsed+=dt;if((!grassBatches.length&&!natureBatches.length)||detailElapsed<.25)return;detailElapsed=0;
    const eye=camera.position,forward=new THREE.Vector3();camera.getWorldDirection(forward);
    const matrix=new THREE.Matrix4(),hasLOD=grassBatches.some(b=>!b.near);
    for(const b of grassBatches){
      let count=0;
      for(const placement of b.placements){
        const[x,y,z,s,ry]=placement,dx=x-eye.x,dz=z-eye.z,dist=Math.hypot(dx,dz);
        if(dist>45||(dx*forward.x+dz*forward.z)<-4)continue;
        const near=dist<19;if(hasLOD&&near!==b.near)continue;
        dummy.position.set(x,y,z);dummy.scale.setScalar(s*clamp((45-dist)/5,0,1));dummy.rotation.set(0,ry,0);dummy.updateMatrix();
        matrix.multiplyMatrices(dummy.matrix,b.transform);b.mesh.setMatrixAt(count++,matrix);
      }
      b.mesh.count=count;b.mesh.instanceMatrix.needsUpdate=true;
    }
    for(const b of natureBatches){
      let count=0;
      for(const[x,y,z,s,ry]of b.placements){
        const dx=x-eye.x,dz=z-eye.z,dist=Math.hypot(dx,dz);
        if(dist>160||(dx*forward.x+dz*forward.z)<-18||(!b.styled&&(dist<55)!==b.near))continue;
        dummy.position.set(x,y,z);dummy.scale.setScalar(s);dummy.rotation.set(0,ry,0);dummy.updateMatrix();
        matrix.multiplyMatrices(dummy.matrix,b.transform);b.mesh.setMatrixAt(count++,matrix);
      }
      b.mesh.count=count;b.mesh.instanceMatrix.needsUpdate=true;
    }
  }
  function stats(){
    const allTextures=new Set([...textures,...(terrain?.textures||[]),...borrowedTextures]);
    const out={drawCalls:0,triangles:0,instanced:0,meshes:0,textureBytes:0,textureCount:allTextures.size,colliders:colliderMeshes.size};
    group.traverse(o=>{if(!o.isMesh||o.userData.cameraCollider)return;out.drawCalls+=Array.isArray(o.material)?o.geometry.groups.length:1;const n=o.geometry.index?o.geometry.index.count/3:o.geometry.attributes.position.count/3;out.triangles+=n*(o.isInstancedMesh?o.count:1);o.isInstancedMesh?out.instanced++:out.meshes++;});
    for(const t of allTextures)out.textureBytes+=Math.round(t.image.width*t.image.height*4*4/3);return out;
  }
  function dispose(){if(disposed)return;disposed=true;group.removeFromParent();for(const b of batches.values())b.dispose();for(const r of [...geometries,...materials,...textures])r.dispose();terrain?.dispose();sun.dispose();hemi.dispose();group.clear();colliderMeshes.clear();batches.clear();}
  animate(0,0,null);
  return{group,solids,scenery,colliderMeshes,layout:data,lighting:lightingState,animate,updateDetail,stats,dispose,get disposed(){return disposed;}};
}

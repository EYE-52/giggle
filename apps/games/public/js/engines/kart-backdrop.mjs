/* Shared painted sky assets. Optional images never replace procedural art
 * until loaded. Worlds retain ownership of all attached GPU resources. */
export const BACKDROP_THEMES = Object.freeze({
  garden: Object.freeze({file:'mountains-day.webp',aspect:324/2172}),
  grove: Object.freeze({file:'mountains-day.webp',aspect:324/2172}),
  quarry: Object.freeze({file:'quarry.webp',aspect:344/2172}),
  frost: Object.freeze({file:'frost.webp',aspect:344/2172}),
  neon: Object.freeze({file:'neon.webp',aspect:344/2172}),
  harbor: Object.freeze({file:'harbor.webp',aspect:344/2172}),
});
export const CLOUD_FILES = Object.freeze(['cloud-1.webp','cloud-2.webp','cloud-3.webp']);

const keep = resource => resource;

// Use the classic arenas' sky colours above every painted horizon. The sky
// stays unlit and outside tone mapping: fog/indoor lighting must not turn
// the open sky into a flat, grey ceiling. All colours are reused per frame.
export function createKartSky(THREE,{parent,radius=410,widthSegments=32,heightSegments=18,
  geometry=keep,material=keep}={}){
  const colors=(top,mid,horizon)=>[top,mid,horizon].map(c=>new THREE.Color(c));
  const day=colors(0x0877e7,0x2da6ef,0xb7def2),sunset=colors(0x3d4a8c,0xd88ab8,0xffb37a),night=colors(0x030612,0x0e2340,0x2a5a7a);
  const channels=['uTop','uMid','uHorizon'];
  const uniforms=Object.fromEntries(channels.map((k,i)=>[k,{value:day[i].clone()}]));
  const mat=material(new THREE.ShaderMaterial({uniforms,
    vertexShader:'varying vec3 vPos;void main(){vPos=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader:'varying vec3 vPos;uniform vec3 uTop;uniform vec3 uMid;uniform vec3 uHorizon;void main(){float h=normalize(vPos).y;vec3 c=mix(uHorizon,uMid,smoothstep(-.07,.23,h));c=mix(c,uTop,smoothstep(.18,.82,h));gl_FragColor=vec4(c,1.0);\n#include <colorspace_fragment>\n}',
    side:THREE.BackSide,depthWrite:false,fog:false,toneMapped:false}));
  const mesh=new THREE.Mesh(geometry(new THREE.SphereGeometry(radius,widthSegments,heightSegments)),mat);
  mesh.name='procedural-sky';mesh.renderOrder=-10;parent.add(mesh);
  function setPhase(phase){
    const p=Math.max(0,Math.min(1,phase)),a=p<=.65?day:sunset,b=p<=.65?sunset:night,t=p<=.65?p/.65:(p-.65)/.35;
    for(let i=0;i<channels.length;i++)uniforms[channels[i]].value.copy(a[i]).lerp(b[i],t);
  }
  return{mesh,horizon:uniforms.uHorizon.value,setPhase};
}

function canLoad(THREE){
  return typeof THREE.TextureLoader==='function'&&typeof globalThis.document?.createElementNS==='function';
}
function load(THREE,url,onLoad,onError){
  try{new THREE.TextureLoader().load(url,onLoad,undefined,onError);}catch{onError();}
}

export function createKartBackdrop(THREE,{parent,theme,radius,ridges=[],enabled=true,
  isAlive=()=>!!parent.parent,geometry=keep,material=keep,texture=keep}={}){
  const entry=BACKDROP_THEMES[theme],repeats=4;
  const height=2*Math.PI*radius/repeats*(entry?.aspect||0)*1.6;
  const white=new THREE.Color(0xffffff),horizonColor=new THREE.Color(),color=new THREE.Color();
  let panorama;
  function tint(horizon,night){
    horizonColor.set(horizon);
    color.copy(white).lerp(horizonColor,.25+.25*night).multiplyScalar(1-.62*night);
    if(panorama)panorama.material.color.copy(color);
  }
  function loaded(tex){
    if(!isAlive()){tex.dispose();return;}
    tex.colorSpace=THREE.SRGBColorSpace;tex.wrapS=THREE.RepeatWrapping;tex.repeat.set(repeats,1);tex.anisotropy=4;
    const mat=material(new THREE.MeshBasicMaterial({map:texture(tex),color,transparent:true,depthWrite:false,side:THREE.BackSide,fog:true}));
    panorama=new THREE.Mesh(geometry(new THREE.CylinderGeometry(radius,radius,height,96,1,true)),mat);
    panorama.name='mountain-backdrop';panorama.position.y=height/2-6;panorama.renderOrder=-1;parent.add(panorama);
    for(const ridge of ridges)ridge.visible=false;
  }
  if(entry&&enabled&&canLoad(THREE))load(THREE,'/assets/karts/backdrops/'+entry.file,loaded,()=>{
    if(entry.fallback&&isAlive())load(THREE,'/assets/karts/backdrops/'+entry.fallback,loaded,()=>{});
  });
  return{radius,height,tint};
}

export function createKartClouds(THREE,{parent,radius,peakHeight,color,fallback=[],visible=()=>true,
  isAlive=()=>!!parent.parent,material=keep,texture=keep}={}){
  const sprites=[],loaded=new Array(CLOUD_FILES.length);
  let ready=0,failed=false,layer;
  function fail(){
    failed=true;
    for(let i=0;i<loaded.length;i++)if(loaded[i]){loaded[i].dispose();loaded[i]=undefined;}
  }
  function animate(dt){
    if(!layer)return;
    layer.visible=visible();
    const step=Number.isFinite(dt)?Math.max(0,Math.min(.1,dt)):0;
    for(let i=0;i<sprites.length;i++){
      const cloud=sprites[i];cloud.angle=(cloud.angle+cloud.speed*step)%(Math.PI*2);
      cloud.mesh.position.x=Math.cos(cloud.angle)*cloud.radius;
      cloud.mesh.position.z=Math.sin(cloud.angle)*cloud.radius;
    }
  }
  if(canLoad(THREE))CLOUD_FILES.forEach((file,index)=>load(THREE,'/assets/karts/clouds/'+file,tex=>{
    if(failed||!isAlive()){tex.dispose();fail();return;}
    loaded[index]=tex;if(++ready!==CLOUD_FILES.length)return;
    const materials=loaded.map(tex=>{
      tex.colorSpace=THREE.SRGBColorSpace;
      const mat=material(new THREE.SpriteMaterial({map:texture(tex),depthWrite:false,fog:false,opacity:.88}));
      // Share the sphere material's live colour, including day-cycle updates.
      mat.color=color;return mat;
    });
    layer=new THREE.Group();layer.name='painted-clouds';parent.add(layer);
    for(let i=0;i<8;i++){
      const tex=loaded[i%loaded.length],mesh=new THREE.Sprite(materials[i%materials.length]),width=56+(i*13%31);
      // Keep each painting's own proportions (flat wisps to tall puffs).
      mesh.name='painted-cloud-'+i;mesh.scale.set(width,width*(tex.image?.height/tex.image?.width||.34),1);
      mesh.position.y=peakHeight+34+(i%3)*9;layer.add(mesh);
      sprites.push({mesh,angle:i*Math.PI/4+.19,radius:radius+45+(i%3)*8,speed:.0015+(i%4)*.0002});
    }
    for(const mesh of fallback)mesh.visible=false;
    animate(0);
  },fail));
  return{animate};
}

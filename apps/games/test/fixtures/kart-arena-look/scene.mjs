import * as THREE from 'three';
import RAPIER from '/vendor/rapier/rapier.mjs';
import config from '/js/engines/kart-physics-config.mjs';
import {loadKartAssets} from '/js/engines/kart-assets.mjs';
import {createKartWorld} from '/js/engines/kart-world.mjs';
import {createKartLighting} from '/js/engines/kart-lighting.mjs';
import {createKartModel} from '/js/engines/kart-model.mjs';
import {createKartArenaFeatures} from '/js/engines/kart-arena-features-art.mjs';
import {createKartArenaStructures} from '/js/engines/kart-arena-structure-art.mjs';
import {createClassicMotion} from '/js/engines/kart-classic-motion.mjs';
await RAPIER.init();
const query=new URLSearchParams(location.search),id=query.get('map')||'neon',palette=query.get('palette')||'Starlight',view=query.get('view')||'world';
const entry=(await (await fetch('/maps')).json()).find(m=>m.key==='legacy-'+id),map=entry.map;
const scene=new THREE.Scene(),renderer=new THREE.WebGLRenderer({canvas:document.querySelector('canvas'),antialias:true,preserveDrawingBuffer:true});
renderer.setSize(1120,700);renderer.setPixelRatio(1);renderer.outputColorSpace=THREE.SRGBColorSpace;
const assets=await loadKartAssets(THREE,scene),world=createKartWorld(THREE,{scene,map,palette,assets});world.syncMap(map);
world.group.getObjectByName('obstacles').traverse(o=>{if(o.isMesh)o.castShadow=true;});
scene.background=new THREE.Color(world.palette.horizon);scene.fog=new THREE.Fog(world.palette.horizon,...world.palette.fog);
const lighting=createKartLighting(THREE,renderer,scene,world.palette,{half:map.half});
const art=createKartArenaFeatures(THREE,scene,{groundAt:world.groundAt});art.sync(map);
const structures=createKartArenaStructures(THREE,scene,{groundAt:world.groundAt});structures.sync(map);
const c=map.features.cannons[0],s=Math.sin(c.angle),co=Math.cos(c.angle),camera=new THREE.PerspectiveCamera(view==='world'?55:48,1120/700,.1,800);
if(view==='world'){camera.position.set(20,11,-32);camera.lookAt(0,1,0);}else{camera.position.set(c.x-s*13+co*10,world.groundAt(c.x,c.z)+7,c.z-co*13-s*10);camera.lookAt(c.x+s*2,2,c.z+co*2);}
if(view==='obstacles'){
 // The same height and distance used by the normal chase camera.
 const b=map.barriers[0],alongX=b.hw>b.hd;
 camera.fov=60;camera.position.set(b.x+(alongX?0:-8.8),3.2,b.z+(alongX?-8.8:0));
 camera.lookAt(b.x+(alongX?0:5),1.3,b.z+(alongX?5:0));camera.updateProjectionMatrix();
}
const k={pid:'preview',x:c.x-s*5,z:c.z-co*5,angle:c.angle,speed:0,input:{throttle:1,steer:0},nitro:1,boost:0,boostCd:0,turbo:0,padCd:0,spawnSeq:0,connected:true};
const state={...structuredClone(map),map:id,mode:'battle',karts:[k],physicalEvents:[],physicalEventSeq:0,featureEvents:[],featureEventSeq:0},online=new Set([k.pid]);
const motion=createClassicMotion(RAPIER,config,state),kart=createKartModel(THREE,{assets,color:0xf45367}),poses=new Map();scene.add(kart);
if(view==='world')for(const [x,z,color]of [[-5,-12,0xffd047],[1,-10,0xf25667],[7,-7,0x5cc9e9]]){const mesh=createKartModel(THREE,{assets,color});mesh.position.set(x,world.groundAt(x,z),z);mesh.rotation.y=.6;scene.add(mesh);}
let elapsed=0,launchAt=null,playing=false;
function frame(dt=0){
 if(view!=='world'&&dt){motion.advance(dt,online);elapsed+=dt;if(k.flight&&launchAt===null)launchAt=elapsed;}
 world.animate(dt,elapsed,null);lighting.update(world.palette);art.ingest(state.featureEvents,state.karts);art.animate(dt,elapsed,state,poses);
 kart.visible=view!=='world';const pose=k.physicalPose;
 if(pose){kart.position.set(pose.position.x,pose.position.y,pose.position.z);kart.quaternion.set(pose.rotation.x,pose.rotation.y,pose.rotation.z,pose.rotation.w);kart.userData.kart.inner.position.y=config.chassis.modelOriginY;}
 if(view!=='world')art.dressKart(k,kart);
 renderer.render(scene,camera);
 return{elapsed,flight:k.flight?.t??null,visible:kart.visible,position:kart.position.toArray(),draws:renderer.info.render.calls,launchAt};
}
window.arenaLook={frame,advance(seconds){for(let i=0;i<Math.round(seconds*60);i++)frame(1/60);return frame();},launchFrame(time){while(launchAt===null&&elapsed<4)frame(1/60);while(k.flight&&k.flight.t<time)frame(1/60);return frame();},state,world,renderer,scene};
document.querySelector('#play').onclick=()=>{if(playing)return;playing=true;function tick(){if(!playing)return;frame(1/60);if(elapsed>5)playing=false;else requestAnimationFrame(tick);}tick();};
await new Promise(r=>setTimeout(r,1200));frame();document.querySelector('#status').textContent='Ready: '+entry.label+' / '+palette;window.arenaLook.ready=true;

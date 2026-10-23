import {MeshoptDecoder} from '/public/vendor/three/libs/meshopt_decoder.mjs';
await MeshoptDecoder.ready;
import * as THREE from 'three';
import {GLTFLoader} from '/public/vendor/three/loaders/GLTFLoader.js';
import {mergeGeometries} from '/public/vendor/three/utils/BufferGeometryUtils.js';
import {batchKartBody} from '/public/js/engines/kart-batching.mjs';
import {createKartModel,animateKartModel,disposeKartModel,createCrateModel} from '/public/js/engines/kart-model.mjs';
import {createKartCombatArt} from '/public/js/engines/kart-combat-art.mjs';
import {createKartElevatedWorld} from '/public/js/engines/kart-elevated-world.mjs';
import {closeKartAssetBitmaps} from '/public/js/engines/kart-assets.mjs';
import {elevatedMap} from '/public/js/engines/kart-elevated-maps.mjs';
import CONFIG from '/public/js/engines/kart-physics-config.mjs';

const params=new URLSearchParams(location.search),mapId=params.get('map')||'garden',mode=params.get('mode')||'art',view=params.get('camera')||'chase',seat=params.get('seat')||'driver';
const phase=params.get('phase')==='live'?null:Number(params.get('phase')||0),map=elevatedMap(mapId),$=id=>document.getElementById(id),canvas=$('stage');
document.body.classList.toggle('art',mode==='art');
const renderer=new THREE.WebGLRenderer({canvas,antialias:true,powerPreference:'high-performance'});renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFShadowMap;renderer.toneMapping=THREE.NeutralToneMapping;
const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(52,1,.1,650);let world;
camera.position.set(99,98,-116);camera.lookAt(0,0,0);
const assets={},models=new Map(),items=new Map(),rigs=new Map(),effects=new Map(),library=new THREE.Group();library.visible=false;library.name='borrowed-original-asset-library';scene.add(library);
let art,environment,retired=false,animation=0,last=performance.now(),start=last,previous=null,current=null,arrival=last,seq=0,socket,ready=false,lastSend=0,cameraInitialized=false;
const frameTimes=[],inputLog=[],seen=new Set(),eventLog=[],errors=[];
const keys=new Set(),pointers=new Map(),target=new THREE.Vector3(),desired=new THREE.Vector3(),nose=new THREE.Vector3(),q=new THREE.Quaternion(),q2=new THREE.Quaternion();
function report(text){parent.postMessage({type:'status',text},location.origin);}
function record(type,extra={}){inputLog.push({type,trusted:extra.trusted,at:performance.now(),instance:current?.instance,tick:current?.simTick,...extra});if(inputLog.length>250)inputLog.shift();}
function clearInput(neutral=true){keys.clear();pointers.clear();for(const button of document.querySelectorAll('[data-control]'))button.classList.remove('active');if(neutral)send(true);}
function controls(){const held=new Set(pointers.values()),has=(name,...codes)=>held.has(name)||codes.some(code=>keys.has(code));return{steer:Number(has('right','KeyD','ArrowRight'))-Number(has('left','KeyA','ArrowLeft')),throttle:Number(has('forward','KeyW','ArrowUp'))-Number(has('reverse','KeyS','ArrowDown')),brake:Number(has('brake','ShiftLeft','ShiftRight')),nitro:has('nitro','KeyN'),use:has('use','Space')};}
function send(force=false){
  const me=current?.karts.find(k=>k.id===seat);
  if(mode!=='live'||socket?.readyState!==WebSocket.OPEN||!current?.you||!me?.alive||!me?.connected||current.phase!=='live')return;
  const time=performance.now();if(!force&&time-lastSend<40)return;lastSend=time;
  socket.send(JSON.stringify({type:'input',value:{instance:current.instance,life:current.you.life,controlEpoch:current.you.controlEpoch,seq:++seq,...controls()}}));
}
for(const button of document.querySelectorAll('[data-control]')){
  button.addEventListener('pointerdown',event=>{event.preventDefault();button.setPointerCapture(event.pointerId);pointers.set(event.pointerId,button.dataset.control);button.classList.add('active');record('pointerdown',{control:button.dataset.control,trusted:event.isTrusted});send(true);});
  const release=event=>{if(!pointers.delete(event.pointerId))return;button.classList.remove('active');record('pointerup',{control:button.dataset.control,trusted:event.isTrusted,event:event.type});send(true);};
  for(const name of ['pointerup','pointercancel','lostpointercapture'])button.addEventListener(name,release);
}
addEventListener('keydown',event=>{if(/INPUT|SELECT|TEXTAREA|BUTTON/.test(event.target.tagName)||!['KeyW','KeyA','KeyS','KeyD','KeyN','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space','ShiftLeft','ShiftRight'].includes(event.code))return;event.preventDefault();if(!keys.has(event.code))record('keydown',{code:event.code,trusted:event.isTrusted});keys.add(event.code);send(true);});
addEventListener('keyup',event=>{if(keys.delete(event.code)){event.preventDefault();record('keyup',{code:event.code,trusted:event.isTrusted});send(true);}});
addEventListener('blur',clearInput);document.addEventListener('visibilitychange',()=>{if(document.hidden)clearInput();});canvas.addEventListener('pointerdown',()=>canvas.focus({preventScroll:true}));
function makeModel(id,color){const model=createKartModel(THREE,{assets,color});scene.add(model);models.set(id,model);return model;}
function mount(model,kind){
  const old=rigs.get(model.uuid);if(old?.kind===kind)return;
  old?.object.removeFromParent();rigs.delete(model.uuid);
  if(!kind)return;const object=art.weapon(kind);object.position.set(...object.userData.combat.mount);model.userData.kart.inner.add(object);rigs.set(model.uuid,{kind,object});
}
function updateBodies(snapshot,alpha,dt){
  const old=new Map((previous?.karts||[]).map(k=>[k.id,k]));
  for(const kart of snapshot.karts){
    const model=models.get(kart.id)||makeModel(kart.id,kart.id===seat?0xf59539:0x25a9a1),a=old.get(kart.id),p=kart.pose;
    model.visible=kart.alive;
    if(a&&a.spawnSeq===kart.spawnSeq&&previous.instance===snapshot.instance){model.position.set(a.pose.position.x,a.pose.position.y,a.pose.position.z).lerp(new THREE.Vector3(p.position.x,p.position.y,p.position.z),alpha);q.set(a.pose.rotation.x,a.pose.rotation.y,a.pose.rotation.z,a.pose.rotation.w);q2.set(p.rotation.x,p.rotation.y,p.rotation.z,p.rotation.w);model.quaternion.copy(q).slerp(q2,alpha);}
    else{model.position.copy(p.position);model.quaternion.set(p.rotation.x,p.rotation.y,p.rotation.z,p.rotation.w);}
    model.userData.kart.inner.position.y=CONFIG.chassis.modelOriginY;
    animateKartModel(model,{speed:p.speed,steer:kart.id===seat?controls().steer:0,boost:kart.nitroActive,shield:kart.shield>0,dt});
    // Actual suspension positions, steering and wheel roll from authority.
    for(let i=0;i<4;i++){
      const anchor=CONFIG.wheels[i],wheel=p.wheels[i],spin=model.userData.kart.wheels[i]?.node,steer=anchor.front?model.userData.kart.steers[i]:null;
      if(steer){steer.position.y=anchor.y-wheel.length-CONFIG.chassis.modelOriginY;steer.rotation.y=wheel.steering;}
      else if(spin)spin.position.y=anchor.y-wheel.length-CONFIG.chassis.modelOriginY;
      if(spin)spin.rotation.x=wheel.rotation;
    }
    mount(model,kart.weapon);
  }
}
function syncObjects(list,prefix,factory){
  const active=new Set();
  for(const value of list){const id=prefix+value.id;active.add(id);let object=items.get(id);if(!object){object=factory(value);scene.add(object);items.set(id,object);}object.position.copy(value.position);if(prefix==='crate:')object.position.y-=.6;object.visible=value.available!==false;object.userData.live=value;}
  for(const[id,object]of items)if(id.startsWith(prefix)&&!active.has(id)){object.removeFromParent();items.delete(id);}
}
function updateSnapshot(snapshot){
  if(snapshot.mapId!==mapId)return;
  if(current?.instance!==snapshot.instance){previous=null;seq=0;clearInput(false);seen.clear();eventLog.length=0;$('results').replaceChildren();}
  else{previous=current;if(current.you?.life!==snapshot.you?.life||current.you?.controlEpoch!==snapshot.you?.controlEpoch)clearInput(false);}
  current=snapshot;seq=Math.max(seq,current.you?.receivedSeq||0);arrival=performance.now();
  for(const event of snapshot.events)if(!seen.has(event.id)){seen.add(event.id);eventLog.push(event);if(eventLog.length>100)eventLog.shift();}
  syncObjects(snapshot.crates,'crate:',()=>createCrateModel(THREE,assets));
  syncObjects(snapshot.projectiles,'shot:',value=>art.projectile(value.weapon));syncObjects(snapshot.mines,'mine:',value=>art.mine(value.owner===seat));syncObjects(snapshot.grenades,'grenade:',v=>art.projectile(v.weapon||'grenade'));
  if(snapshot.phase==='done'&&!$('results').children.length){
    const title=document.createElement('h2');title.textContent='Round complete';$('results').append(title);
    for(const kart of snapshot.karts){const row=document.createElement('p'),name=document.createElement('span'),score=document.createElement('strong');name.textContent=kart.name;score.textContent=kart.hits+' KOs';row.append(name,score);$('results').append(row);}
    const button=document.createElement('button');button.id='rematch';button.textContent='Rematch';button.onclick=async()=>{button.disabled=true;await fetch('/api/reset',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({map:mapId,rematch:true})});canvas.focus({preventScroll:true});};$('results').append(button);
  }
}
function poseArt(dt,time){
  const model=models.get('art-driver'),rival=models.get('art-rival');
  const x=mapId==='frost'?38:-42,z=-41+Math.sin(time*.10)*4;
  model.position.set(x,0,z);model.rotation.set(0,.18,0);rival.position.set(map.spawns[1].x,0,map.spawns[1].z);rival.rotation.y=map.spawns[1].angle;
  animateKartModel(model,{speed:.4,dt});animateKartModel(rival,{speed:0,dt});
}
function frame(){
  if(retired)return;
  const now=performance.now(),dt=Math.min(.08,(now-last)/1000),time=(now-start)/1000;last=now;
  if(ready){
    const progress=current?THREE.MathUtils.clamp((current.serverAt-current.liveAt)/(current.deadline-current.liveAt),0,1):0;
    const sky=phase??(mode==='live'?(mapId==='neon'?.65+progress*.25:Math.max(0,progress-.6)/.4*.65):mapId==='neon'?.65:0);
    world.animate(dt,time,sky);scene.fog.color.copy(world.lighting.fogColor);
    if(mode==='live'&&current){updateBodies(current,Math.min(1,(now-arrival)/50),dt);send();const me=current.karts.find(k=>k.id===seat);$('score').textContent=(me?.name||seat)+' · '+(me?.hits||0)+' KOs';$('timer').textContent=current.phase==='done'?'Complete':Math.ceil(Math.max(0,(current.phase==='countdown'?current.liveAt:current.deadline)-current.serverAt)/1000)+'s';$('item').textContent=me?.weapon?me.weapon+' · '+me.ammo:'Find a mystery crate';for(const button of document.querySelectorAll('[data-control]'))button.disabled=!current.you||!me?.alive||current.phase!=='live';$('use').disabled||=!me?.weapon;$('nitro').disabled||=me?.nitro<.15;$('notice').textContent=!current.you?'Watching':current.phase==='countdown'?'Get ready · '+Math.ceil((current.liveAt-current.serverAt)/1000):!me?.alive?'Respawning · '+Math.ceil(me?.respawn||0)+'s':'';}
    else if(mode==='art')poseArt(dt,time);
    const model=models.get(mode==='live'?seat:'art-driver');
    if(view==='overview'){desired.set(99,98,-116);target.set(0,0,0);}
    else if(view==='orbit'){const a=time*.035;desired.set(Math.sin(a)*108,63,Math.cos(a)*108);target.set(0,3,0);}
    else if(view==='fountain'&&mapId==='garden'){desired.set(-3,8,-16);target.set(-12,2.2,-4);}
    else if(view==='structure'){
      if(mapId==='garden'){desired.set(55,20,-18);target.set(24,3.5,8);}else if(mapId==='frost'){desired.set(38,23,-27);target.set(-10,4,14);}else{desired.set(55,21,-18);target.set(22,3,14);}
    }else if(model){nose.set(0,0,1).applyQuaternion(model.quaternion);nose.y=0;nose.normalize();desired.copy(model.position).addScaledVector(nose,-8.5);desired.y+=4.4;target.copy(model.position).addScaledVector(nose,4);target.y+=1.4;}
    if(view==='chase'&&!model){desired.set(99,98,-116);target.set(0,0,0);}
    if(!cameraInitialized){camera.position.copy(desired);if(model||view!=='chase')cameraInitialized=true;}else camera.position.lerp(desired,Math.min(1,dt*8));camera.lookAt(target);
    for(const object of items.values()){if(object.userData.combat)art.animate(object,dt,time,false);if(object.userData.live?.velocity){const velocity=object.userData.live.velocity;object.lookAt(object.position.x+velocity.x,object.position.y+velocity.y,object.position.z+velocity.z);}}
    for(const rig of rigs.values())art.animate(rig.object,dt,time,false);
    world.updateDetail(camera,dt);renderer.render(scene,camera);if(time>2&&frameTimes.length<1200)frameTimes.push(dt*1000);
  }
  animation=requestAnimationFrame(frame);
}
function geometry(){return{viewport:{width:innerWidth,height:innerHeight},document:{width:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight},canvas:{width:canvas.clientWidth,height:canvas.clientHeight},controls:[...document.querySelectorAll('button,.tag')].filter(e=>e.getClientRects().length).map(e=>({label:e.getAttribute('aria-label')||e.textContent,interactive:e.tagName==='BUTTON',...Object.fromEntries(['x','y','width','height','right','bottom'].map(k=>[k,e.getBoundingClientRect()[k]]))})),renderer:{calls:renderer.info.render.calls,triangles:renderer.info.render.triangles},errors:errors.slice()};}
async function save(){const sorted=frameTimes.slice().sort((a,b)=>a-b),reportData={type:'native elevated world/combat evidence',mapId,mode,view,geometry:geometry(),world:world.stats(),renderer:{calls:renderer.info.render.calls,triangles:renderer.info.render.triangles,textures:renderer.info.memory.textures,geometries:renderer.info.memory.geometries,p95AnimationFrameMs:sorted[Math.floor(sorted.length*.95)]||null,samples:sorted.length,devicePixelRatio:renderer.getPixelRatio()},authority:current,inputLog,eventLog,errors};const response=await fetch('/evidence',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(reportData)});report('Saved '+await response.text()+' · '+map.name+' '+mode);}
addEventListener('message',event=>{if(event.origin!==location.origin)return;if(event.data.type==='save')save();if(event.data.type==='focus')canvas.focus({preventScroll:true});});
const resize=()=>{renderer.setSize(innerWidth,innerHeight,false);camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();};addEventListener('resize',resize);resize();
try{
  const loader=new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const files=[['kart','giggle-kart.meshopt','kart-20261007'],['crate','giggle-crate.meshopt','question-20261007'],['combat','combat/combat.meshopt','combat-20261007'],['pulse','combat/pulse-mounted.meshopt','bfaaaf39'],['arsenal','combat/arsenal-mounted.meshopt','8bd555ac']];
  if(map.environment==='alpine')files.push(['stylized','environment/stylized-alpine','9426a0ed'],['fountain','environment/alpine-fountain','7a687cd3']);
  const loaded=await Promise.allSettled(files.map(async([key,file,version])=>{const gltf=await loader.loadAsync('/public/assets/karts/'+file+'.glb?v='+version);assets[key]=gltf.scene;library.add(gltf.scene);}));
  if(loaded.some((r,i)=>r.status==='rejected'&&files[i][0]!=='fountain'))throw Error('Combat assets did not load');
  if(assets.stylized)for(const name of ['PineA','PineB','TreeA','GrassA','FlowersA','RockA','RockB','CottageA'])if(!assets.stylized.getObjectByName(name))throw new Error('The stylized Alpine library is incomplete');
  world=createKartElevatedWorld(THREE,{scene,map,assets});
  scene.fog=new THREE.Fog(world.lighting.fogColor,world.lighting.fogNear,world.lighting.fogFar);renderer.toneMappingExposure=world.lighting.exposure;
  batchKartBody(THREE,assets.kart,mergeGeometries);
  const combatAssets={get:name=>(name==='Pulse'?assets.pulse.getObjectByName(name):assets.arsenal.getObjectByName(name))||assets.combat.getObjectByName(name)};
  if(!assets.pulse.getObjectByName('Pulse')||['Rocket','RocketShot','Mine','MineTrap','Seeker','SeekerShot','Bomb','BombShot'].some(name=>!assets.arsenal.getObjectByName(name)))throw Error('The mounted arsenal did not load');
  art=createKartCombatArt(THREE,{assets:combatAssets,pickupAsset:assets.crate});
  // Original procedural light capture, retained once for satin-metal response.
  const capture=new THREE.Scene(),lightGeo=new THREE.SphereGeometry(10,16,8),lightMat=new THREE.MeshBasicMaterial({color:0xd6e5ed,side:THREE.BackSide});capture.add(new THREE.Mesh(lightGeo,lightMat));const pmrem=new THREE.PMREMGenerator(renderer);try{environment=pmrem.fromScene(capture,.1,.1,100,{size:64});scene.environment=environment.texture;scene.environmentIntensity=.25;}finally{pmrem.dispose();lightGeo.dispose();lightMat.dispose();}
  $('name').textContent=map.name+(mode==='art'?' · visual review':'');
  if(mode==='art'){
    makeModel('art-driver',0xf59539);makeModel('art-rival',0x2caaa2);mount(models.get('art-driver'),'rocket');
    for(const s of map.sockets.filter((_,i)=>i%4===0)){const object=createCrateModel(THREE,assets);object.position.set(s.x,s.y,s.z);scene.add(object);items.set('art:'+s.id,object);}
  }else{
    socket=new WebSocket(location.origin.replace('http','ws')+'/control?seat='+seat+'&map='+mapId);
    socket.onmessage=event=>{try{const value=JSON.parse(event.data);if(value.type==='snapshot')updateSnapshot(value.value);else if(value.type==='rejected'&&/stale|not live|dead|sequence|inactive seat/.test(value.result?.reason||'')){record('authority rejected stale transition',{reason:value.result.reason});}else{errors.push(value);report('Authority '+JSON.stringify(value));}}catch(error){errors.push(error.message);report(error.message);}};
    socket.onerror=()=>{errors.push('WebSocket error');report('WebSocket connection failed');};socket.onclose=()=>{if(!retired){$('notice').textContent='Disconnected · reload to reconnect';clearInput();}};
  }
  ready=true;report(map.name+' · '+mode+' · original GLBs loaded');animation=requestAnimationFrame(frame);
  if(params.get('probe')==='1')setTimeout(()=>parent.postMessage({type:'geometry',value:geometry()},location.origin),mode==='live'?700:350);
}catch(error){errors.push(error.message);$('name').textContent='Failed: '+error.message;report(error.message);throw error;}
addEventListener('error',e=>errors.push(e.message));addEventListener('unhandledrejection',e=>errors.push(String(e.reason)));
addEventListener('pagehide',()=>{
  retired=true;clearInput();cancelAnimationFrame(animation);socket?.close();world?.dispose();for(const model of models.values())disposeKartModel(model);art?.dispose();environment?.dispose();
  const resources=new Set();library.traverse(o=>{if(o.geometry)resources.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:[o.material])if(m){resources.add(m);for(const value of Object.values(m))if(value?.isTexture)resources.add(value);}});for(const resource of resources)resource.dispose();const closedBitmaps=closeKartAssetBitmaps(library);models.clear();items.clear();rigs.clear();renderer.dispose();renderer.forceContextLoss();navigator.sendBeacon('/evidence',JSON.stringify({type:'renderer cleanup',mapId,worldDisposed:world?.disposed,models:models.size,animationRetired:retired,ownedGLBResources:resources.size,closedBitmaps}));
});

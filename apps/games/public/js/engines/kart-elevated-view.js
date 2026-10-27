import {paintKartWeapon} from './kart-weapon-hud.mjs';
import {createKartImpactFX} from './kart-impact-fx.mjs';
/* Elevated combat presentation for real Room snapshots. No gameplay or
 * client coordinates are sent: only sequenced, life-scoped intent. */
import {createThreeView} from '../renderers/three-view.js';
import {kartResultView} from './kart-results.mjs';
import {createMobileStick} from '../toolkit/mobile-stick.mjs';
import {readInputCapabilities,touchControlsFor} from '../toolkit/input-capabilities.mjs';
import {createKartModel,animateKartModel,createCrateModel} from './kart-model.mjs';
import {batchKartBody} from './kart-batching.mjs';
import {createKartCombatArt,projectileContactInset} from './kart-combat-art.mjs';
import {createKartHealthBars} from './kart-health-bars.mjs';
import {createKartElevatedWorld} from './kart-elevated-world.mjs';
import {MeshoptDecoder,closeKartAssetBitmaps,loadKartWeaponThumbnails,weaponThumbnailArt} from './kart-assets.mjs';
import {elevatedMap} from './kart-elevated-maps.mjs';
import CONFIG from './kart-physics-config.mjs';
import {createKartAudio} from './kart-audio.mjs';
import {blendElevatedPose,nextElevatedInput,createElevatedTimeline} from './kart-elevated-pose.mjs';

const ICONS={
  spikes:'<path d="m16 2 4 10 10 4-10 4-4 10-4-10-10-4 10-4Z" fill="#d3a34b"/>',
  sentry:'<path d="M6 8h20v6H6zm9 6h4v9h-4zM7 28l9-10 9 10" fill="#c2cbd1" stroke="#f1b848"/>',
  nuke:'<path d="m16 2 6 8v15H10V10Z" fill="#e5d35b"/><circle cx="16" cy="17" r="5" fill="#393e41"/>',
  proximity:'<ellipse cx="16" cy="21" rx="11" ry="6" fill="#829299"/><path d="M7 10c5-6 13-6 18 0m-15 4c3-3 8-3 11 0" stroke="#ff6154"/><circle cx="16" cy="21" r="3" fill="#ff6154"/>',
  rocket:'<path d="M15 4C9 5 7 9 7 15l4 4c6 0 10-2 11-8l-7-7Z" fill="#ff7541"/><path d="m7 12-4 3v6l6-3m7 1-3 6h6l3-4" fill="#d6ecf3"/><circle cx="16" cy="10" r="2" fill="#e5f7ff"/><path d="m5 22-2 5 5-2" stroke="#ffcb44"/>',
  pulse:'<path d="M7 9h9v12H7z" fill="#edb44d"/><path d="M7 9c0-7 9-7 9 0m-9 6h9M3 24h18" stroke="#e8f2f8"/><path d="m21 7 5-3m-4 9h6" stroke="#ffcc49"/>',
  scatter:'<path d="M3 18h18v6H3zm2-9h19v5H5z" fill="#e0b769"/><path d="m24 10 5-4m-5 14 5 4m-5-8h5" stroke="#fff"/>',
  mine:'<ellipse cx="15" cy="18" rx="11" ry="6" fill="#667a88"/><path d="M7 14v-4m8 2V7m8 7v-4" stroke="#e3edf4"/><circle cx="15" cy="17" r="3" fill="#fa564f"/>',
  rail:'<path d="M3 12h21v6H3z" fill="#527c99"/><path d="M7 12v6m5-6v6m5-6v6m7-3h6" stroke="#68ebf1"/>',
  grenade:'<path d="M11 7h8v5h-8z" fill="#a7b8c0"/><path d="M8 12h14v14H8z" fill="#699152"/><path d="M9 17h12M15 12v14m3-19h6" stroke="#e9f2df"/>',
  shield:'<path d="m15 3 11 4v10c0 7-11 12-11 12S4 24 4 17V7l11-4Z" fill="#45c6e8"/><path d="m10 16 4 4 7-9" stroke="#fff"/>',
  seeker:'<path d="M16 3c-5 4-7 10-7 17h14c0-7-2-13-7-17Z" fill="#91d451"/><path d="m9 18-5 8 7-3m12-5 5 8-7-3" fill="#e5f0f5"/><circle cx="16" cy="11" r="3" fill="#1c3539"/>',
  bomb:'<path d="M10 7h12v21H10z" fill="#677683"/><path d="M10 12h12m-12 9h12M14 7V3h7" stroke="#ffcd48"/><path d="m13 15 6 3-6 3" fill="#ffcd48"/>',
  emp:'<path d="m17 2-11 15h8l-2 12 12-17h-8l1-10Z" fill="#99e6ee"/>',
};
const svg=(path)=>`<svg viewBox="0 0 32 32" aria-hidden="true" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
const NITRO=svg('<path d="m18 2-12 16h9l-2 12 12-18h-9l2-10Z" fill="#83ebff"/>');
const TARGET=svg('<circle cx="16" cy="16" r="9" stroke="#fff"/><path d="M16 2v9m0 10v9M2 16h9m10 0h9" stroke="#fff"/>');
// These additional authority weapons reuse the matching recorded activation,
// firing or canister sound; no new audio assets or delayed cue queue.
const WEAPON_CUES={spikes:'shield',sentry:'pulse',proximity:'mine',nuke:'bomb'};
const neutral=()=>({steer:0,throttle:0,brake:0,nitro:false,use:false});
const colors=[0xf59539,0x21a9af,0xca49b0,0x5c8ceb,0xec5765,0x7eb643,0xaf7cde,0xffd451];

export function createElevatedKartView() {
  let root,api,S,sequence=0,epoch='',generation=0,gl,audio,stick,preference='auto',pending=false,gfxReady=false,graphicsFailed=false;
  let analog={x:0,y:0},lastSend=0,lastKey='',timer=0,inputTimer=0,resultsTimer=0,firstEvents=true,itemKey='',standingsKey='',audioDrifting=false,feedbackEpoch=0;
  let sceneReady;
  const timeline=createElevatedTimeline();
  const listeners=[],keys=new Set(),pointers=new Map(),seen=new Set(),newEvents=[],nodes=new Map();
  const on=(target,type,fn,opts)=>{target.addEventListener(type,fn,opts);listeners.push([target,type,fn,opts]);};
  const $=name=>nodes.get(name)||root?.querySelector('[data-'+name+']');
  const now=()=>api?.now?.() ?? Date.now();
  const self=()=>S?.karts.find(k=>k.id===S.you);
  const blocked=()=>document.hidden||api?.context?.().connected===false||api?.context?.().roomActionPending||$('menu')?.open||document.getElementById('roomMenu')?.open;
  const active=()=>gfxReady&&!S?.preparing&&S?.youDrive&&self()?.alive&&self()?.connected&&!blocked()&&['countdown','live'].includes(S.phase);
  function intent(){
    if(!active())return neutral();
    const held=new Set(pointers.values()),has=(name,...codes)=>held.has(name)||codes.some(c=>keys.has(c));
    return {steer:analog.x+Number(has('right','KeyD','ArrowRight'))-Number(has('left','KeyA','ArrowLeft')),
      throttle:-analog.y+Number(has('gas','KeyW','ArrowUp'))-Number(has('reverse','KeyS','ArrowDown')),
      brake:Number(has('brake','ShiftLeft','ShiftRight')),nitro:has('nitro','KeyN'),use:has('use','Space')};
  }
  function send(force=false){
    if(!S||!api)return;
    const value=intent(),key=JSON.stringify(value),time=performance.now();
    if(!force&&time-lastSend<40){
      if(key!==lastKey&&!inputTimer)inputTimer=setTimeout(()=>{inputTimer=0;send();},40-(time-lastSend));
      return;
    }
    if(!force&&key===lastKey&&time-lastSend<250)return;
    clearTimeout(inputTimer);inputTimer=0;
    const message=nextElevatedInput(S,sequence,value);if(!message)return;
    sequence=message.seq;lastSend=time;lastKey=key;api.send(message,{silent:true});
  }
  function stop(sendNeutral=true){clearTimeout(inputTimer);inputTimer=0;const captured=[...pointers.keys()];keys.clear();pointers.clear();analog={x:0,y:0};stick?.reset(false);for(const b of root?.querySelectorAll('[data-held]')||[]){b.removeAttribute('data-held');for(const id of captured)try{if(typeof id==='number'&&b.hasPointerCapture?.(id))b.releasePointerCapture(id);}catch{}}if(sendNeutral)send(true);updateAudio();}
  function updateAudio(drifting=audioDrifting){
    const context=api?.context?.(),k=self();audio?.setMuted(context?.sound===false);
    audioDrifting=drifting&&!!k?.pose.grounded&&Math.abs(k.pose.speed)>4;
    audio?.update({speed:k?.pose.speed||0,throttle:intent().throttle,drifting:audioDrifting,boost:k?.nitroActive,
      active:gfxReady&&!S?.preparing&&S?.phase==='live'&&!document.hidden&&context?.connected!==false&&!context?.roomActionPending,
      engineActive:!!S?.youDrive&&!!k?.alive&&!!k?.connected&&!blocked()});
  }
  function touch(){const show=touchControlsFor(preference,readInputCapabilities())&&S?.youDrive&&S.phase!=='done';$('touch').hidden=!show;root.classList.toggle('pke-touch-mode',show);}
  function paint(){
    if(!S||!root)return;
    const me=self(),watch=!S.youDrive;
    // Equal knockouts share a rank; drivers who dropped out sit last.
    const ranked=[...S.karts].sort((a,b)=>(a.out===true)-(b.out===true)||b.hits-a.hits);
    const ranks=[];ranked.forEach((k,i)=>{ranks[i]=i&&!k.out&&!ranked[i-1].out&&k.hits===ranked[i-1].hits?ranks[i-1]:i+1;});
    const mine=ranked.findIndex(k=>k.id===S.you),rank=mine>=0?ranks[mine]:0,name=api.name?.(S.you)||S.you;
    const kos=me?.hits||0;
    $('score').textContent=watch?'Watching':`P${rank} · ${kos} KO${kos===1?'':'s'}`;
    $('score').setAttribute('aria-label',watch?'Watching the battle':`Rank ${rank}, ${name}, ${me?.hits||0} knockouts`);
    const nextItem=me?.weapon||(me?.ramT>0?'shield':'');
    if(nextItem!==itemKey){const icon=weaponThumbnailArt(nextItem,ICONS[nextItem]?svg(ICONS[nextItem]):TARGET);$('use-icon').innerHTML=icon;itemKey=nextItem;}
    const equipped=paintKartWeapon($('weapon'),me,ICONS[nextItem]?svg(ICONS[nextItem]):TARGET);
    $('weapon').hidden=!me;
    $('use-ammo').textContent=me?.weapon?String(me.ammo):'';
    $('use-ammo').hidden=!me?.weapon;
    $('use').setAttribute('aria-label',me?.firing?'Weapon firing':me?.weapon?`Activate ${equipped.label}, full payload`:'Use weapon');
    $('protection').hidden=!(me?.shield>0&&!(me?.ramT>0));$('protection').title='Spawn protection';
    const hp=Math.max(0,Math.min(me?.maxHealth||100,me?.health??100)),maximum=me?.maxHealth||100;
    $('health').hidden=!me;$('health').setAttribute('aria-label',`Health ${hp} of ${maximum}`);
    $('health').dataset.low=String(hp<=maximum*.3);$('health-fill').style.transform=`scaleX(${hp/maximum})`;
    $('use').disabled=!me?.weapon||me?.firing||!active()||S.phase!=='live';
    $('nitro').disabled=!active()||me?.nitro<.15;
    $('controls').value=preference;
    $('notice').textContent=me&&!me.connected?'Reconnecting…':me&&!me.alive?'Respawning…':watch?'Watching the battle':'';
    $('notice').hidden=!$('notice').textContent;
    $('arena').textContent=S.map?.label||'Pocket Karts';
    $('goal').textContent=S.winRule==='Score target'&&S.targetHits?`First to ${S.targetHits} KO${S.targetHits===1?'':'s'} wins.`:'Most knockouts wins.';
    $('result').hidden=S.phase!=='done';
    const nextStandings=S.phase==='done'?JSON.stringify([S.result,S.you,ranked.map(k=>api.name?.(k.id)||k.id),S.winRule,S.targetHits]):'';
    if(nextStandings!==standingsKey){
      standingsKey=nextStandings;
      if(S.phase==='done'&&S.result){
        const unit=n=>`${n} KO${n===1?'':'s'}`,target=S.targetHits||0;
        const final=kartResultView({result:S.result,you:S.you,nameOf:id=>api.name?.(id)||id,unit,target,targetUnit:target===1?'KO':'KOs'});
        $('result').innerHTML=final.html;
        api.announce?.(`${final.title}. ${final.line}`);
      }else $('result').replaceChildren();
    }
    // Final scores own the screen: the driving HUD steps aside (as in classic).
    root.classList.toggle('pke-done',S.phase==='done');
    if(S.phase==='done')stop();
    touch();
  }
  function clock(){
    if(!S||!root)return;
    const ms=S.phase==='done'?0:Math.max(0,S.endsAt-now()),seconds=Math.ceil(ms/1000);
    const status=!gfxReady?(graphicsFailed?'Retry':'Loading'):S.preparing?'Ready':null;
    $('clock').textContent=status??(S.phase==='done'?'0:00':S.phase==='countdown'?String(seconds):`${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`);
    $('clock').setAttribute('aria-label',!gfxReady?(graphicsFailed?'Arena unavailable; retry 3D':'Loading arena'):S.preparing?'Arena ready; waiting for players':S.phase==='done'?'Round complete':`${seconds} seconds remaining`);
    $('clock').dataset.kos=S.youDrive?`${self()?.hits||0} KOs`:'Watching';
    const k=self();$('speed').textContent=String(Math.round(Math.abs(k?.pose.speed||0)*3.6));
    const charge=String(Math.max(0,Math.min(1,k?.nitro||0)));
    $('charge').style.setProperty('--charge',charge);$('nitro').style.setProperty('--charge',charge);
    $('nitro').setAttribute('aria-label',`Hold for Nitro, ${Math.round(Number(charge)*100)} percent charged`);
  }
  async function scene(THREE,helper,gen){
    const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(52,1,.1,650),renderer=helper.renderer();
    let world,art,library,healthBars,impactFX;const models=new Map(),spikes=new Map(),rigs=new Map(),objects=new Map(),effects=[];
    try{
      const map=elevatedMap(S.mapId);if(map.revision!==S.mapRevision)throw Error('Arena revision mismatch');
      if(gen!==generation)throw Error('Retired arena');
      const {GLTFLoader}=await import('../../vendor/three/loaders/GLTFLoader.js');
      const {mergeGeometries}=await import('../../vendor/three/utils/BufferGeometryUtils.js');
      await MeshoptDecoder.ready;
      const loader=new GLTFLoader().setMeshoptDecoder(MeshoptDecoder),assets={};library=new THREE.Group();library.visible=false;scene.add(library);
      const files=[['kart','giggle-kart.meshopt','kart-20261007'],['crate','giggle-crate.meshopt','question-20261007'],['combat','combat/combat.meshopt','combat-20261007'],['pulse','combat/pulse-mounted.meshopt','bfaaaf39'],['arsenal','combat/arsenal-mounted.meshopt','8bd555ac'],['secondary','combat/arsenal-secondary.meshopt','31eec689']];
      if(map.environment==='alpine')files.push(['stylized','environment/stylized-alpine','9426a0ed'],['fountain','environment/alpine-fountain','7a687cd3']);
      const loaded=await Promise.allSettled([...files.map(async([key,file,version])=>{const gltf=await loader.loadAsync(`/assets/karts/${file}.glb?v=${version}`);assets[key]=gltf.scene;library.add(gltf.scene);}),loadKartWeaponThumbnails()]);
      if(loaded.some((r,i)=>r.status==='rejected'&&files[i]?.[0]!=='fountain'))throw Error('Combat assets did not load');
      if(gen!==generation)throw Error('Retired arena');
      if(assets.stylized)for(const name of ['PineA','PineB','TreeA','GrassA','FlowersA','RockA','RockB','CottageA'])if(!assets.stylized.getObjectByName(name))throw new Error('The stylized Alpine library is incomplete');
      world=createKartElevatedWorld(THREE,{scene,map,palette:S.palette,assets});
      scene.fog=new THREE.Fog(world.lighting.fogColor,world.lighting.fogNear,world.lighting.fogFar);
      renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFShadowMap;renderer.toneMapping=THREE.NeutralToneMapping;renderer.toneMappingExposure=world.lighting.exposure;
      batchKartBody(THREE,assets.kart,mergeGeometries);
      // The source pack's foam dart is an inspection candidate. Combat keeps
      // the compact metal Scatter slug; mounted source rigs are independent.
      const combatAssets={get:name=>assets.pulse.getObjectByName(name)||assets.arsenal.getObjectByName(name)||(name!=='ScatterShot'&&assets.secondary.getObjectByName(name))||assets.combat.getObjectByName(name)};
      if(!assets.pulse.getObjectByName('Pulse')||['Rocket','RocketShot','Mine','MineTrap','Seeker','SeekerShot','Bomb','BombShot'].some(name=>!assets.arsenal.getObjectByName(name))||['Scatter','Rail','Grenade','EMP','GrenadeShot'].some(name=>!assets.secondary.getObjectByName(name)))throw Error('The mounted arsenal did not load');
      art=createKartCombatArt(THREE,{assets:combatAssets,pickupAsset:assets.crate});
      healthBars=createKartHealthBars(THREE,scene);impactFX=createKartImpactFX(THREE,scene,{reducedMotion:()=>helper.reducedMotion()});
      const cameraTarget=new THREE.Vector3(),cameraPosition=new THREE.Vector3(),forward=new THREE.Vector3(0,0,1),up=new THREE.Vector3(0,1,0),hits=[];
      const target=new THREE.Vector3(),desired=new THREE.Vector3(),nose=new THREE.Vector3(),direction=new THREE.Vector3(),ray=new THREE.Raycaster();
      const collisionMeshes=[...world.colliderMeshes.values()].map(value=>value.cameraBody||value.body);
      function clearCamera(position,focus){
        direction.subVectors(position,focus);const distance=direction.length();if(distance<.001)return;
        ray.set(focus,direction.normalize());ray.far=distance;hits.length=0;ray.intersectObjects(collisionMeshes,false,hits);
        const hit=hits[0];if(hit&&hit.distance<distance){position.copy(focus).addScaledVector(direction,Math.max(.05,hit.distance-.2));return true;}
      }
      let cameraKick=0;const wrecks=new Map(),flashes=[];
      const fxGeometry=new THREE.BoxGeometry(.065,.065,.26),fxMaterial=new THREE.MeshBasicMaterial({color:0xffffff});
      // Prepare shot materials/geometries and particle buffers while the loading
      // screen is still up. Firing reuses these objects rather than uploading
      // a new InstancedMesh or calibrating the complete arsenal in a live frame.
      const pools=new Map(),warm=[],contactInsets=new Map();
      function projectile(kind){
        const object=art.projectile(kind),radius=S.projectileRadii?.[kind];
        if(radius!=null){
          const key=kind+':'+radius;
          if(!contactInsets.has(key))contactInsets.set(key,projectileContactInset(THREE,object,radius));
          object.userData.combat.contactInset=contactInsets.get(key);object.userData.combat.contactRadius=radius;
        }
        return object;
      }
      const shotKinds=['pulse','scatter','rocket','rail','seeker','grenade','bomb','nuke','proximity','sentry'];
      const poolKey=(prefix,value)=>prefix+(value.weapon||'grenade');
      for(const kind of shotKinds){const pool=[];for(let i=0;i<12;i++){const object=projectile(kind);object.visible=false;scene.add(object);pool.push(object);}pools.set('shot:'+kind,pool);if(['grenade','bomb','nuke','proximity'].includes(kind)){const grenades=[];for(let i=0;i<4;i++){const object=art.projectile(kind);object.visible=false;scene.add(object);grenades.push(object);}pools.set('grenade:'+kind,grenades);}warm.push(pool[0]);}
      // Confirmed final sweeps remain readable when the shot itself never
      // reaches a snapshot. Borrow only existing tracer art, prepared once.
      const confirmedPools=new Map(),confirmedShots=[],shotBounds=new THREE.Box3(),shotCenter=new THREE.Vector3();
      let confirmedEpoch=feedbackEpoch;
      for(const kind of ['pulse','scatter','rail','sentry']){
        const source=pools.get('shot:'+kind)[0],tail=source.userData.combat.tail,pool=[];
        source.updateWorldMatrix(true,true);
        for(let i=0;i<12;i++){
          const object=new THREE.Group(),mesh=tail.clone(false);tail.matrixWorld.decompose(mesh.position,mesh.quaternion,mesh.scale);object.add(mesh);
          shotBounds.setFromObject(object);shotBounds.getCenter(shotCenter);mesh.position.sub(shotCenter);
          object.name='CombatConfirmedShot';object.userData.confirmedShot=kind;object.visible=false;scene.add(object);
          const cue={object,length:shotBounds.max.z-shotBounds.min.z,age:0};pool.push(cue);confirmedShots.push(cue);
        }
        confirmedPools.set(kind,pool);warm.push(pool[0].object);
      }
      for(const own of [false,true]){const object=art.mine(own);scene.add(object);warm.push(object);}
      for(const factory of [()=>art.sentry(),()=>art.spikes()]){const object=factory();scene.add(object);warm.push(object);}
      for(const kind of Object.keys(ICONS)){const object=art.weapon(kind);scene.add(object);warm.push(object);}
      const normal=new THREE.Vector3(),basis=new THREE.Quaternion();
      const sparkColor=new THREE.Color();
      for(let i=0;i<12;i++){const mesh=new THREE.InstancedMesh(fxGeometry,fxMaterial,24);mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);for(let j=0;j<24;j++)mesh.setColorAt(j,sparkColor.setHex(0xffdf8b));mesh.frustumCulled=false;mesh.visible=false;scene.add(mesh);effects.push({mesh,count:0,position:new THREE.Vector3(),velocities:Array.from({length:24},()=>new THREE.Vector3()),age:0,duration:0});}
      const flashGeometry=new THREE.ConeGeometry(.18,.65,6);flashGeometry.rotateX(Math.PI/2);
      const flashMaterial=new THREE.MeshBasicMaterial({color:0xffe6a1,transparent:true,opacity:.9,depthWrite:false});
      for(let i=0;i<12;i++){const mesh=new THREE.Mesh(flashGeometry,flashMaterial);mesh.name='CombatMuzzleFlash';mesh.visible=false;scene.add(mesh);flashes.push({mesh,age:0});}
      // Every kart body is prepared before the first live frame too.
      for(let index=0;index<S.karts.length;index++){const k=S.karts[index],model=createKartModel(THREE,{assets,color:k.id===S.you?colors[0]:colors[(index+1)%colors.length]});model.userData.elevatedPose={position:{},rotation:{}};models.set(k.id,model);scene.add(model);warm.push(model);}
      for(const k of S.karts)warm.push(healthBars.add(k.id));
      warm.push(...flashes.map(f=>f.mesh));
      warm.push(...effects.map(f=>f.mesh));camera.position.set(0,5,-9);camera.lookAt(0,0,0);
      for(const object of warm){object.visible=true;object.position.set(0,-100,0);object.traverse(o=>{o.frustumCulled=false;});}
      await renderer.compileAsync(scene,camera);renderer.render(scene,camera);
      for(const object of warm){object.visible=false;object.position.set(0,0,0);const combat=object.userData.combat;if(combat&&combat.type!=='projectile')object.removeFromParent();}
      await impactFX.warmup(renderer,camera);
      if(gen!==generation)throw Error('Retired arena');
      function effect(e){
        if(!e.position)return;
        impactFX.emit(e);
        const pool=e.type==='impact'&&e.from&&confirmedPools.get(e.weapon);
        if(pool){
          direction.subVectors(e.position,e.from);const length=direction.length();
          if(length>1e-6){
            let cue=pool[0];for(const candidate of pool){if(!candidate.object.visible){cue=candidate;break;}if(candidate.age>cue.age)cue=candidate;}
            cue.age=0;cue.object.position.copy(e.from).addScaledVector(direction,.5);cue.object.quaternion.setFromUnitVectors(forward,direction.multiplyScalar(1/length));cue.object.scale.set(1,1,length/cue.length);cue.object.visible=true;
          }
        }
        if(e.type==='fire')art.recoil(rigs.get(e.pid)?.object);
        if(e.type==='fire'&&e.direction&&['pulse','scatter','rocket','rail','seeker','sentry','nuke'].includes(e.weapon)){
          const f=flashes.find(f=>!f.mesh.visible)||flashes[0];f.mesh.visible=true;f.age=0;f.mesh.position.copy(e.position);f.mesh.quaternion.setFromUnitVectors(forward,direction.copy(e.direction).normalize());f.mesh.scale.setScalar(e.weapon==='rocket'||e.weapon==='nuke'?1.6:1);return;
        }
        if(e.type==='hit'&&e.other===S.you)$('damage')?.animate?.([{opacity:.6},{opacity:0}],{duration:220});
        if(e.type==='ko'&&e.other)wrecks.set(e.other,{age:0,position:{...e.position},life:S.karts.find(k=>k.id===e.other)?.spawnSeq});
        if(e.type==='blast'||e.type==='impact')return;
        if(!['ko','collision','landing','hit'].includes(e.type))return;
        const strength=e.impulse===undefined?1:Math.max(.12,Math.min(1,e.impulse/1000));
        if((e.pid===S.you||e.other===S.you)&&!helper.reducedMotion())cameraKick=Math.max(cameraKick,(e.type==='collision'?.10:e.type==='ko'?.16:.05)*strength);
        if(e.type==='landing'||e.type==='collision'||helper.reducedMotion())return;
        const small=['impact','collision','hit'].includes(e.type),f=effects.find(f=>!f.mesh.visible)||effects.reduce((a,b)=>a.age>b.age?a:b);
        f.count=small?8:24;f.mesh.count=f.count;f.mesh.visible=true;f.position.copy(e.position);f.age=0;f.duration=small?.28:.75;
        normal.copy(e.normal||up);if(normal.lengthSq()<.01)normal.copy(up);normal.normalize();basis.setFromUnitVectors(up,normal);
        for(let j=0;j<f.count;j++){const angle=j*2.39996,speed=(j%3+3)*(.45+.55*strength);f.velocities[j].set(Math.cos(angle)*speed,2+j%4,Math.sin(angle)*speed).applyQuaternion(basis).y+=1.2;f.mesh.setColorAt(j,sparkColor.setHex(small?(j%2?0xffe3a0:0xf5fbff):(j%3?0xff8128:0xffdc68)));}f.mesh.instanceColor.needsUpdate=true;
      }
      function bodies(dt,time,playback){
        const alpha=playback?.alpha??1;
        for(let index=0;index<S.karts.length;index++){
          const k=S.karts[index];let model=models.get(k.id);
          if(!model){model=createKartModel(THREE,{assets,color:k.id===S.you?colors[0]:colors[(index+1)%colors.length]});model.userData.elevatedPose={position:{},rotation:{}};models.set(k.id,model);scene.add(model);}
          const sample=playback?.current.karts.get(k.id);
          const current=sample?.spawnSeq===k.spawnSeq&&sample?.controlEpoch===k.controlEpoch&&k.alive&&k.connected!==false?sample:k;
          const p=blendElevatedPose(playback?.previous.karts.get(k.id),current,alpha,model.userData.elevatedPose),wreck=wrecks.get(k.id);
          if(wreck&&(k.alive||wreck.life!==k.spawnSeq||wreck.age>=.65))wrecks.delete(k.id);
          const exploding=wrecks.get(k.id);model.visible=!k.out&&(k.alive||!!exploding);model.scale.setScalar(1);
          model.position.copy(p.position);model.quaternion.set(p.rotation.x,p.rotation.y,p.rotation.z,p.rotation.w);model.userData.kart.inner.position.y=CONFIG.chassis.modelOriginY;
          if(exploding){exploding.age+=dt;model.position.copy(exploding.position);if(!helper.reducedMotion()){model.position.y+=Math.sin(exploding.age/.65*Math.PI)*.8;model.rotateZ(exploding.age*1.6);model.scale.setScalar(Math.max(.15,1-exploding.age/.65));}}
          healthBars.update(k.id,k,model.position);
          animateKartModel(model,{physicalPose:p,speed:p.speed,steer:k.id===S.you?intent().steer:0,boost:k.nitroActive,shield:k.shield>0&&!(k.ramT>0),invincible:k.ramT>0,dt,reducedMotion:helper.reducedMotion()});
          let orbit=spikes.get(k.id);if(k.spikesT>0&&k.alive){if(!orbit){orbit=art.spikes();model.add(orbit);spikes.set(k.id,orbit);}art.animate(orbit,dt,time,helper.reducedMotion());}else if(orbit){orbit.removeFromParent();spikes.delete(k.id);}
          const rig=rigs.get(k.id);if(rig?.kind!==k.weapon){rig?.object.removeFromParent();rigs.delete(k.id);if(k.weapon){const object=art.weapon(k.weapon);object.position.set(...object.userData.combat.mount);model.userData.kart.inner.add(object);rigs.set(k.id,{kind:k.weapon,object});}}
        }
      }
      function sync(list,prefix,factory){
        const ids=new Set();for(const value of list||[]){const id=prefix+value.id;ids.add(id);let object=objects.get(id);if(!object){const key=poolKey(prefix,value);object=pools.get(key)?.pop()||factory(value);object.userData.poolKey=pools.has(key)?key:null;scene.add(object);objects.set(id,object);}object.position.copy(value.position);object.visible=value.available!==false;if(prefix==='crate:')object.position.y-=.6;
          if(value.direction||value.velocity){direction.copy(value.direction||value.velocity);if(direction.lengthSq()>0){const aim=prefix==='sentry:'?object.userData.combat?.turret:object;if(aim)aim.quaternion.setFromUnitVectors(forward,direction.normalize());}}
          // Mine packets carry the sphere centre along the support normal; art starts at its base.
          if(prefix==='mine:'){direction.copy(value.normal||up).normalize();object.position.addScaledVector(direction,-((value.radius||.41)+.015)+.02);object.quaternion.setFromUnitVectors(up,direction);}
          if(prefix==='mine:'&&object.userData.combat)object.userData.combat.armed=value.armed;
          if(prefix==='grenade:'&&['bomb','proximity'].includes(value.weapon)&&object.userData.combat){
            const c=object.userData.combat;c.armed=value.armed===true;c.landed=value.landed===true;
            c.rollRate=value.velocity?Math.hypot(value.velocity.x,value.velocity.z)/(value.radius||.6):0;
          }
          if(prefix==='grenade:')object.scale.setScalar(1);
        }
        for(const[id,object]of objects)if(id.startsWith(prefix)&&!ids.has(id)){object.visible=false;if(object.userData.poolKey)pools.get(object.userData.poolKey).push(object);else object.removeFromParent();objects.delete(id);}
      }
      let objectTick='',started=false,cameraLife='',sideYaw=0,selectedSideYaw=0,recovery=0,sideSettling=false;
      const cameraAnchor=new THREE.Vector3(),sideEye=new THREE.Vector3(),recoveryEye=new THREE.Vector3(),modelBox=new THREE.Box3(),meshBox=new THREE.Box3(),corner=new THREE.Vector3(),probeCamera=new THREE.PerspectiveCamera(52,1,.1,650);
      const cameraModels=new WeakMap(),contactBoxes=new WeakMap(),contactPoint=new THREE.Vector3(),sideAngles=[25,-25,45,-45,60,-60,75,-75,90,-90];
      for(const [id,value]of world.colliderMeshes){const descriptor=value.descriptor||map.colliders?.find(d=>d.id===id),body=value.cameraBody||value.body;if(descriptor?.shape==='box'){body.updateWorldMatrix(true,false);body.geometry.computeBoundingBox();contactBoxes.set(body,{box:body.geometry.boundingBox,inverse:new THREE.Matrix4().copy(body.matrixWorld).invert()});}}
      function cameraModel(model){
        let data=cameraModels.get(model);if(data)return data;
        data={meshes:[],samples:[]};
        // Cache actual base-art surface extrema once, not a recursive traversal
        // every chase frame. Cosmetics and mounted weapons do not size the car.
        model.userData.kart.inner.traverse(mesh=>{
          if(!mesh.isMesh||mesh.name==='BoostFlame'||mesh.name==='RespawnShield'||mesh.name==='InvincibilityTrail')return;
          for(let parent=mesh.parent;parent&&parent!==model.userData.kart.inner;parent=parent.parent)if(parent.userData.combat)return;
          mesh.geometry.computeBoundingBox();data.meshes.push(mesh);
          if(!/^(Chassis|DriverHelmet|DriverVisor|DriverTorso|FrontBumper|RearBumper|SidePod|WheelMesh)/.test(mesh.name))return;
          const positions=mesh.geometry.attributes.position,indices=new Set();
          for(let axis=0;axis<3;axis++){
            let min=0,max=0;for(let i=1;i<positions.count;i++){if(positions.getComponent(i,axis)<positions.getComponent(min,axis))min=i;if(positions.getComponent(i,axis)>positions.getComponent(max,axis))max=i;}
            indices.add(min);indices.add(max);
          }
          for(const index of indices)data.samples.push({mesh,contact:mesh.name==='RearBumper',local:new THREE.Vector3().fromBufferAttribute(positions,index),world:new THREE.Vector3()});
        });
        cameraModels.set(model,data);return data;
      }
      function prepareCameraModel(model,data){
        model.updateMatrixWorld(true);modelBox.makeEmpty();
        for(const mesh of data.meshes){meshBox.copy(mesh.geometry.boundingBox).applyMatrix4(mesh.matrixWorld);modelBox.union(meshBox);}
        for(const sample of data.samples){sample.world.copy(sample.local).applyMatrix4(sample.mesh.matrixWorld);sample.world.y=Math.max(.03,sample.world.y);}
      }
      function sideCameraFits(data){
        probeCamera.fov=camera.fov;probeCamera.aspect=camera.aspect;probeCamera.updateProjectionMatrix();probeCamera.position.copy(sideEye);probeCamera.lookAt(cameraAnchor);probeCamera.updateMatrixWorld();
        for(let i=0;i<8;i++){
          corner.set(i&1?modelBox.max.x:modelBox.min.x,i&2?modelBox.max.y:modelBox.min.y,i&4?modelBox.max.z:modelBox.min.z).project(probeCamera);
          if(Math.abs(corner.x)>.95||Math.abs(corner.y)>.95||corner.z< -1||corner.z>1)return false;
        }
        for(const sample of data.samples){
          direction.subVectors(sample.world,sideEye);ray.far=Math.max(0,direction.length()-.03);ray.set(sideEye,direction.normalize());hits.length=0;ray.intersectObjects(collisionMeshes,false,hits);
          for(const hit of hits){
            const solid=sample.contact&&contactBoxes.get(hit.object);
            if(solid){
              contactPoint.copy(sample.world).applyMatrix4(solid.inverse);const b=solid.box,p=contactPoint;
              // The visible rear bumper extends ~10cm past the physics body.
              // Only its genuinely embedded contact patch may be hidden; a
              // roof hiding a wheel/driver or detached bumper is never waived.
              if(b.containsPoint(p)&&Math.min(p.x-b.min.x,b.max.x-p.x,p.z-b.min.z,b.max.z-p.z)<=.12)continue;
            }
            return false;
          }
        }
        return true;
      }
      function trySideCamera(yaw,data){
        sideEye.copy(nose).negate().applyAxisAngle(up,yaw*Math.PI/180).multiplyScalar(8.5).add(cameraAnchor);sideEye.y+=3;
        clearCamera(sideEye,cameraAnchor);return sideCameraFits(data);
      }const dummy=new THREE.Object3D();
      function movingItems(list,prefix,previousList,currentList,alpha){
        for(const value of list||[]){
          const object=objects.get(prefix+value.id),before=previousList?.find(v=>v.id===value.id),current=currentList?.find(v=>v.id===value.id)||value;
          if(!object)continue;
          object.position.copy(value.position);if(before)object.position.lerpVectors(before.position,current.position,alpha);
          if(value.velocity){
            direction.copy(value.velocity);if(before?.velocity)direction.lerpVectors(before.velocity,current.velocity||value.velocity,alpha);
            if(direction.lengthSq()>.001){
              object.quaternion.setFromUnitVectors(nose.set(0,0,1),direction.normalize());
              if(prefix==='shot:'){
                const radius=current.radius??value.radius??.18,combat=object.userData.combat;
                const inset=radius===combat?.contactRadius?combat.contactInset:0;
                object.position.addScaledVector(direction,radius-(combat?.tipZ||0)-inset);
              }
            }
          }
        }
      }
      helper.canvas().setAttribute('aria-hidden','false');helper.canvas().setAttribute('aria-label','Pocket Karts combat arena');helper.canvas().tabIndex=0;
      helper.track(helper.canvas(),'pointerdown',()=>helper.canvas().focus({preventScroll:true}));
      return {scene,camera,frame(dt,time){
        if(gen!==generation||!S)return;
        // Preserve useful horizontal framing on portrait screens without
        // changing the normal landscape lens or camera clearance geometry.
        const fov=Math.min(80,Math.max(52,2*Math.atan(Math.tan(Math.PI/10)/camera.aspect)*180/Math.PI));
        if(camera.fov!==fov){camera.fov=fov;camera.updateProjectionMatrix();}
        const cycle=S.skyCycle,sky=cycle?Math.max(0,Math.min(1,(now()-cycle.startedAt)/cycle.durationMs)):undefined;
        const playback=timeline.frame(performance.now());
        world.animate(dt,time,sky);scene.fog.color.copy(world.lighting.fogColor);
        // dt describes time before this frame. Age existing flashes before
        // accepting new fire, so a 100ms hitch cannot erase a new 90ms flash.
        for(const f of flashes){if(!f.mesh.visible)continue;f.age+=dt;if(f.age>=.09)f.mesh.visible=false;}
        for(const cue of confirmedShots){if(confirmedEpoch!==feedbackEpoch)cue.object.visible=false;if(!cue.object.visible)continue;cue.age+=dt;if(cue.age>=.09)cue.object.visible=false;}
        if(confirmedEpoch!==feedbackEpoch)impactFX.reset();
        confirmedEpoch=feedbackEpoch;impactFX.update(dt);
        while(newEvents.length)effect(newEvents.shift());
        bodies(dt,time,playback);
        const itemSnapshot=playback?.current.snapshot||S;
        const itemTick=itemSnapshot.simTick+':'+S.simTick;
        if(objectTick!==itemTick){objectTick=itemTick;sync(S.crates,'crate:',()=>createCrateModel(THREE,assets));sync((itemSnapshot.projectiles||[]).filter(v=>S.projectiles?.some(latest=>latest.id===v.id)),'shot:',v=>projectile(v.weapon));sync(S.mines,'mine:',v=>art.mine(v.owner===S.you));sync(S.sentries,'sentry:',()=>art.sentry());sync((itemSnapshot.grenades||[]).filter(v=>S.grenades?.some(latest=>latest.id===v.id)),'grenade:',v=>art.projectile(v.weapon||'grenade'));}
        const itemAlpha=playback?.alpha??1;movingItems(itemSnapshot.projectiles,'shot:',playback?.previous.snapshot.projectiles,playback?.current.snapshot.projectiles,itemAlpha);movingItems(itemSnapshot.grenades,'grenade:',playback?.previous.snapshot.grenades,playback?.current.snapshot.grenades,itemAlpha);
        for(const object of objects.values())art.animate(object,dt,time,helper.reducedMotion());
        for(let i=effects.length-1;i>=0;i--){const f=effects[i];f.age+=dt;if(!f.mesh.visible)continue;if(f.age>=f.duration){f.mesh.visible=false;continue;}for(let j=0;j<f.count;j++){const v=f.velocities[j],fade=Math.max(.02,1-f.age/f.duration);dummy.position.set(f.position.x+v.x*f.age,f.position.y+v.y*f.age-f.age*f.age*7,f.position.z+v.z*f.age);dummy.quaternion.setFromUnitVectors(nose.set(0,0,1),direction.copy(v).normalize());dummy.scale.set(fade,fade,fade*2.5);dummy.updateMatrix();f.mesh.setMatrixAt(j,dummy.matrix);}f.mesh.instanceMatrix.needsUpdate=true;}
        for(const rig of rigs.values())art.animate(rig.object,dt,time,helper.reducedMotion());
        const followed=self()||S.karts[0];
        const life=`${S.instanceId}:${followed?.id}:${followed?.spawnSeq}:${followed?.controlEpoch}`;if(life!==cameraLife){cameraLife=life;started=false;sideYaw=0;selectedSideYaw=0;recovery=0;sideSettling=false;}
        const model=models.get(followed?.id);
        if(model){
          nose.set(0,0,1).applyQuaternion(model.quaternion);nose.y=0;if(nose.lengthSq()<.05)nose.set(0,0,1);nose.normalize();
          target.copy(model.position).addScaledVector(nose,4);target.y+=1.4;
          // A look-ahead beyond a wall would cast clearance from its far side.
          desired.copy(model.position);desired.y+=1.4;clearCamera(target,desired);
          desired.copy(model.position).addScaledVector(nose,-8.5);desired.y+=4.4;let cramped=clearCamera(desired,target);
          const rear=-direction.subVectors(desired,model.position).dot(nose);
          // Keep recovery aim attached to the moving chassis while orbiting.
          let returning=direction.subVectors(model.position,cameraAnchor).dot(nose)<-.001;
          if(sideSettling){direction.subVectors(model.position,cameraAnchor);direction.y+=1.4;returning=direction.dot(nose)<-.001;cameraPosition.add(direction);cameraTarget.add(direction);}
          cameraAnchor.copy(model.position);cameraAnchor.y+=1.4;
          let sideMode=sideYaw!==0;
          // Only cancel a reversing recovery when a rear obstacle remains near.
          // This bounded ray prevents unrelated open-space reversing latching it.
          if(returning&&sideMode){recoveryEye.copy(model.position).addScaledVector(nose,-17);recoveryEye.y+=7.4;returning=clearCamera(recoveryEye,cameraAnchor);}
          if(sideMode){if(returning){sideYaw=selectedSideYaw;recovery=0;}else recovery=rear>4.1&&!cramped?recovery+dt:0;}
          if(sideMode||cramped){
            const data=cameraModel(model);prepareCameraModel(model,data);
            let valid=sideMode&&trySideCamera(sideYaw,data);
            // Recover along the same bounded orbit, not a twelve-metre chord.
            if(valid&&recovery>=.25){
              const nextYaw=Math.sign(sideYaw)*Math.max(0,Math.abs(sideYaw)-90*dt);
              if(trySideCamera(nextYaw,data)){sideYaw=nextYaw;if(!sideYaw){sideMode=false;valid=false;}}
              else {recovery=0;trySideCamera(sideYaw,data);}
            }
            if(!valid&&(sideMode||cramped)){
              recovery=0;
              const preferred=Math.sign(sideYaw);sideYaw=0;
              // Smallest clear departure; keep the selected side while valid.
              for(let pass=0;pass<(preferred?2:1)&&!valid;pass++)for(let index=0;index<sideAngles.length;index++){
                // A reversing approach needs the clear side before eye clearance
                // collapses; slow stationary/forward cases keep minimal yaw.
                const yaw=sideAngles[returning?sideAngles.length-1-index:index];
                if(preferred&&(pass===0?Math.sign(yaw)!==preferred:Math.sign(yaw)===preferred))continue;
                if(trySideCamera(yaw,data)){sideYaw=selectedSideYaw=yaw;valid=true;break;}
              }
            }
            if(valid){desired.copy(sideEye);target.copy(cameraAnchor);sideMode=true;sideSettling=true;}else sideMode=false;
          }
          // Keep the kart anchor until the eased eye has completed its orbit.
          const lateral=Math.abs((cameraPosition.x-model.position.x)*nose.z-(cameraPosition.z-model.position.z)*nose.x);
          if(sideSettling&&!sideMode&&lateral>.1)target.copy(cameraAnchor);
          if(!started){cameraPosition.copy(desired);cameraTarget.copy(target);started=true;}
          else {const ease=1-Math.exp(-dt*(sideSettling?6:12));
            if(sideSettling){
              const x=cameraPosition.x-cameraAnchor.x,z=cameraPosition.z-cameraAnchor.z,dx=desired.x-cameraAnchor.x,dz=desired.z-cameraAnchor.z;
              const angle=Math.atan2(z,x),delta=Math.atan2(Math.sin(Math.atan2(dz,dx)-angle),Math.cos(Math.atan2(dz,dx)-angle));
              const nextAngle=angle+Math.max(-Math.PI/2*dt,Math.min(Math.PI/2*dt,delta));
              const radius=Math.hypot(x,z),nextRadius=radius+Math.max(-8.5*Math.PI/2*dt,Math.min(8.5*Math.PI/2*dt,Math.hypot(dx,dz)-radius));
              cameraPosition.x=cameraAnchor.x+Math.cos(nextAngle)*nextRadius;cameraPosition.z=cameraAnchor.z+Math.sin(nextAngle)*nextRadius;cameraPosition.y+=(desired.y-cameraPosition.y)*ease;
            }else cameraPosition.lerp(desired,ease);
            cameraTarget.lerp(target,ease);if(!sideMode&&lateral<.1&&Math.abs(cameraPosition.y-desired.y)<.1&&cameraTarget.distanceToSquared(target)<.01)sideSettling=false;}
          // Final eased and shaken eyes must still be clear, including beneath
          // ceilings where none of the bounded camera candidates is valid.
          cramped=clearCamera(cameraPosition,cameraTarget)||cramped;
          cramped=clearCamera(cameraPosition,cameraAnchor)||cramped;
          camera.position.copy(cameraPosition);
          if(cameraKick>0&&!helper.reducedMotion()){
            camera.position.x+=Math.sin(time*95)*cameraKick;camera.position.y+=Math.cos(time*77)*cameraKick*.65;
            cameraKick=Math.max(0,cameraKick-dt*.55);cramped=clearCamera(camera.position,cameraTarget)||cramped;
            cramped=clearCamera(camera.position,cameraAnchor)||cramped;
          }
          const finalRear=-direction.subVectors(camera.position,model.position).dot(nose);
          const lookAhead=cramped&&!sideMode?Math.max(0,Math.min(1,(finalRear-CONFIG.chassis.half.z)/(8.5-CONFIG.chassis.half.z))):1;
          target.copy(cameraTarget).lerp(cameraAnchor,1-lookAhead);clearCamera(camera.position,target);clearCamera(camera.position,cameraAnchor);
          camera.lookAt(target);healthBars.face(camera);
        }
        world.updateDetail(camera,dt);
        const k=self();
        const lateral=model&&k?.pose.linearVelocity?Math.abs(direction.copy(k.pose.linearVelocity).dot(nose.set(1,0,0).applyQuaternion(model.quaternion))):0;
        updateAudio(!!k?.pose.grounded&&Math.abs(k.pose.speed)>4&&lateral>1.4);clock();
      },dispose(){world.dispose();art.dispose();healthBars.dispose();impactFX.dispose();for(const f of effects)f.mesh.dispose();for(const cue of confirmedShots){cue.object.visible=false;cue.object.removeFromParent();}confirmedShots.length=0;confirmedPools.clear();closeKartAssetBitmaps(library);models.clear();objects.clear();rigs.clear();spikes.clear();}};
    }catch(error){world?.dispose();art?.dispose();healthBars?.dispose();impactFX?.dispose();helper.disposeObject(scene);closeKartAssetBitmaps(library);throw error;}
  }
  function graphicsFailure(){
    graphicsFailed=true;gfxReady=false;stop();clock();newEvents.length=0;$('loading').hidden=false;$('loading').replaceChildren();const text=document.createElement('p');text.textContent='The 3D arena could not load. Retry or return to the room.';const retry=document.createElement('button');retry.textContent='Retry 3D';retry.setAttribute('data-watchok','');retry.onclick=()=>{if(pending)return;retry.disabled=true;gl?.dispose();gl=null;graphicsFailed=false;loadScene();};$('loading').append(text,retry);
    if(api.context?.().isHost){const back=document.createElement('button');back.textContent='Back to room';back.onclick=()=>api.lobby();$('loading').append(back);}
  }
  async function loadScene(){
    if(pending||gl||!S||graphicsFailed)return;pending=true;const gen=generation;
    const handle=await createThreeView($('stage'),{signal:api?.signal,diagnostics:api?.diagnostics,build:(THREE,helper)=>scene(THREE,helper,gen),onContextLost:graphicsFailure});
    if(gen!==generation){if(!handle.fallback)handle.dispose();return;}
    pending=false;if(handle.fallback){graphicsFailure();return;}gl=handle;handle.canvas.setAttribute('data-game-focus','');gfxReady=true;itemKey='';$('loading').hidden=true;paint();clock();if(S.youDrive&&!blocked())handle.canvas.focus({preventScroll:true});
  }
  function mount(el,platform){
    dispose();root=document.createElement('section');root.className='pke';root.setAttribute('aria-label','Pocket Karts');el.append(root);api=platform;
    const style=document.createElement('link');style.rel='stylesheet';style.href='/css/kart-elevated.css';style.dataset.elevatedKart='';document.head.append(style);listeners.push([style,'owned-style',null]);
    root.innerHTML=`<div data-stage class="pke-stage"></div><div data-loading class="pke-loading" role="status">Loading arena…</div>
      <div class="pke-top"><details data-menu class="pke-menu"><summary aria-label="Game menu">☰</summary><div class="pke-panel"><h2 data-arena></h2><p data-goal>Most knockouts wins.</p><label>Controls <select data-controls aria-label="Controls"><option value="auto">Auto</option><option value="keyboard">Keyboard</option><option value="touch">Touch</option></select></label><p>WASD / arrows · drive<br>Space · weapon &nbsp; N · Nitro<br>Shift · brake</p><button data-resume>Resume</button></div></details><span class="pke-score" data-score>0 KOs</span><time data-clock>Loading</time><span data-protection class="pke-protection" title="Spawn protection">${svg(ICONS.shield)}</span></div>
      <div data-health class="pke-health" role="img" aria-label="Health 100 of 100">${svg('<path d="M16 27 5 16C-2 8 9 1 16 9c7-8 18-1 11 7Z" fill="#ff6375" stroke="none"/>')}<span><i data-health-fill></i></span></div><div data-damage class="pke-damage" aria-hidden="true"></div>
      <p data-notice class="pke-notice" role="status" hidden></p><div class="pke-bottom"><div data-weapon class="kart-item" role="group" aria-label="Weapon"></div><div class="pke-instruments"><span class="pke-speed"><b data-speed>0</b><small>km/h</small></span><span data-charge class="pke-charge" role="img" aria-label="Nitro charge">${NITRO}</span></div></div>
      <div data-touch class="pke-touch" hidden><div data-stick class="pke-stick" role="group" aria-label="Drive stick"><span></span></div><div class="pke-actions"><button data-gas aria-label="Hold to accelerate">${svg('<path d="m10 21 6-11 6 11" stroke="#f3f9ff" stroke-width="3"/>')}</button><button data-reverse aria-label="Hold to reverse">${svg('<path d="m10 11 6 11 6-11" stroke="#f3f9ff" stroke-width="3"/>')}</button><button data-brake aria-label="Hold to brake">${svg('<path d="M8 7h5v18H8zm11 0h5v18h-5z" fill="#e5f5ff"/>')}</button><button data-nitro aria-label="Hold for Nitro">${NITRO}</button><button data-use aria-label="Use weapon"><span data-use-icon>${TARGET}</span><b data-use-ammo hidden></b></button></div></div>
      <aside data-result class="pke-result pk-final" role="status" hidden></aside>`;
    for(const node of root.querySelectorAll('*'))for(const attr of node.attributes)if(attr.name.startsWith('data-'))nodes.set(attr.name.slice(5),node);
    // The platform already owns the Room launcher. Put game controls in
    // that drawer instead of drawing a second menu on top of it.
    const roomMenu=document.getElementById('roomMenu'),roomPanel=roomMenu?.querySelector('.room-menu-panel');
    if(roomPanel){const panel=$('menu').querySelector('.pke-panel');panel.classList.add('pke-room-settings');roomPanel.append(panel);listeners.push([panel,'owned-panel',null]);$('menu').hidden=true;$('resume').hidden=true;root.classList.add('pke-has-room');on(roomMenu,'toggle',()=>{stop();paint();if(!roomMenu.open&&active()&&roomMenu.contains(document.activeElement))gl?.canvas.focus({preventScroll:true});});}
    try{preference=localStorage.getItem('pk-controls-v1')||'auto';}catch{preference='auto';}if(!['auto','keyboard','touch'].includes(preference))preference='auto';
    audio=createKartAudio({muted:api.context?.().sound===false});
    on(root,'pointerdown',()=>audio?.unlock());on(window,'keydown',()=>{if(root.contains(document.activeElement))audio?.unlock();});
    on($('resume'),'click',()=>{$('menu').open=false;if(roomMenu)roomMenu.open=false;gl?.canvas.focus({preventScroll:true});});on($('menu'),'toggle',()=>{stop();paint();});
    on($('controls'),'change',event=>{stop();preference=event.target.value;try{localStorage.setItem('pk-controls-v1',preference);}catch{}touch();});
    for(const[name,control]of [['gas','gas'],['reverse','reverse'],['brake','brake'],['nitro','nitro'],['use','use']]){const b=$(name),paintHeld=()=>{if([...pointers.values()].includes(control))b.setAttribute('data-held','');else b.removeAttribute('data-held');};on(b,'pointerdown',event=>{if(b.disabled||!active()||pointers.has(event.pointerId)||(event.pointerType==='mouse'&&event.button!==0))return;event.preventDefault();pointers.set(event.pointerId,control);try{b.setPointerCapture?.(event.pointerId);}catch{}paintHeld();send(true);});const release=e=>{if(pointers.get(e.pointerId)!==control)return;pointers.delete(e.pointerId);try{if(b.hasPointerCapture?.(e.pointerId))b.releasePointerCapture(e.pointerId);}catch{}paintHeld();send(true);};for(const type of ['pointerup','pointercancel','lostpointercapture'])on(b,type,release);for(const type of ['pointerup','pointercancel'])on(window,type,release);on(b,'pointerleave',e=>{if(!b.hasPointerCapture?.(e.pointerId))release(e);});on(window,'pointermove',e=>{if(e.pointerType==='mouse'&&e.buttons===0)release(e);});
      on(b,'keydown',event=>{if(!['Space','Enter'].includes(event.code)||!active())return;event.preventDefault();if(event.repeat)return;pointers.set('key-'+name,control);b.setAttribute('data-held','');send(true);});
      const keyRelease=()=>{if(!pointers.delete('key-'+name))return;paintHeld();send(true);};on(b,'keyup',event=>{if(['Space','Enter'].includes(event.code)){event.preventDefault();keyRelease();}});on(b,'blur',keyRelease);
    }
    on(window,'keydown',event=>{if(event.metaKey||event.ctrlKey||event.altKey||!root.contains(document.activeElement)||/INPUT|SELECT|TEXTAREA|BUTTON|SUMMARY/.test(event.target?.tagName)||!active())return;if(!['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','ShiftLeft','ShiftRight','Space','KeyN'].includes(event.code))return;event.preventDefault();if(event.repeat)return;keys.add(event.code);send(true);});
    on(window,'keyup',event=>{if(keys.delete(event.code)){event.preventDefault();send(true);}});
    on(document,'focusin',()=>{if(keys.size&&(!root.contains(document.activeElement)||/INPUT|SELECT|TEXTAREA|BUTTON|SUMMARY/.test(document.activeElement?.tagName))){keys.clear();send(true);}});
    on(window,'blur',stop);on(window,'orientationchange',stop);on(document,'visibilitychange',()=>{if(document.hidden)stop();});on(document,'game-screenchange',()=>{stop();paint();});
    if(window.screen?.orientation?.addEventListener)on(window.screen.orientation,'change',stop);
    stick=createMobileStick($('stick'),{enabled:active,onChange:value=>{const wasMoving=analog.x!==0||analog.y!==0;analog=value;const moving=value.x!==0||value.y!==0;send(!moving||!wasMoving);}});
    timer=setInterval(()=>send(),80);
  }
  function update(el,snapshot,platform){
    api=platform;if(!root)mount(el,platform);
    const key=`${snapshot.instanceId}:${snapshot.inputAck?.life}:${snapshot.inputAck?.controlEpoch}`;
    if(key!==epoch){stop(false);feedbackEpoch++;newEvents.length=0;epoch=key;sequence=snapshot.inputAck?.receivedSeq||0;timeline.reset();}
    const was=S;S=snapshot;if(S.audioBaseline){firstEvents=true;newEvents.length=0;timeline.reset();feedbackEpoch++;}timeline.ingest(S,performance.now());sequence=Math.max(sequence,S.inputAck?.receivedSeq||0);updateAudio();
    if(was?.instanceId!==S.instanceId){seen.clear();newEvents.length=0;firstEvents=true;feedbackEpoch++;}
    for(const e of S.events||[]){
      if(seen.has(e.id))continue;
      seen.add(e.id);
      if(firstEvents||!gfxReady)continue;
      newEvents.push(e);if(newEvents.length>32)newEvents.shift();
      const pose=(self()||S.karts[0])?.pose;
      if(!e.position||!pose)continue;
      const dx=e.position.x-pose.position.x,dy=e.position.y-pose.position.y,dz=e.position.z-pose.position.z;
      const distance=Math.hypot(dx,dy,dz);
      if(distance>=50)continue;
      const rotation=pose.rotation,rightX=1-2*(rotation.y*rotation.y+rotation.z*rotation.z),rightZ=2*(rotation.x*rotation.z-rotation.w*rotation.y);
      const cue=e.type==='fire'?(WEAPON_CUES[e.weapon]||e.weapon):e.type==='blast'?(['rocket','seeker'].includes(e.weapon)?'rocketBlast':e.weapon==='bomb'?'bombBlast':'grenadeBlast'):e.type;
      audio?.cue(cue,{strength:e.impulse?Math.min(1,e.impulse/1000):1,
        gain:Math.pow(Math.max(0,1-Math.max(0,distance-8)/42),2),
        pan:distance>2?Math.max(-.85,Math.min(.85,(dx*rightX+dz*rightZ)/distance)):0});
    }
    while(seen.size>64)seen.delete(seen.values().next().value);firstEvents=false;
    paint();clock();if(!pending&&!gl&&!graphicsFailed)sceneReady=loadScene();
    if(S.phase==='done'&&was?.phase!=='done'&&was?.instanceId===S.instanceId){clearTimeout(resultsTimer);resultsTimer=setTimeout(()=>{if(S?.instanceId===snapshot.instanceId&&S.phase==='done')api.resultsReady?.(S.instanceId);},900);}
  }
  function dispose(){
    stop(false);generation++;clearInterval(timer);clearTimeout(resultsTimer);timer=resultsTimer=0;stick?.dispose();stick=null;audio?.dispose();audio=null;gl?.dispose();gl=null;
    for(const[target,type,fn,opts]of listeners.splice(0)){if(type==='owned-style'||type==='owned-panel')target.remove();else target.removeEventListener(type,fn,opts);}
    root?.remove();root=null;S=null;api=null;epoch='';pending=gfxReady=graphicsFailed=false;timeline.reset();newEvents.length=0;seen.clear();nodes.clear();firstEvents=true;sequence=0;itemKey=standingsKey='';audioDrifting=false;
  }
  return {ownsTimer:true,ownsInputs:true,styles:['/css/kart-elevated.css'],mount,update,dispose,
    async ready(){await sceneReady;if(!gfxReady)throw new Error('The 3D arena could not load');await gl.firstFrame;}};
}

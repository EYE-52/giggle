import {createKartPickupPrediction} from './kart-pickup-prediction.mjs';
import {setKartText,setKartAttribute,setKartFlag} from './kart-hud-write.mjs';
import {waitKartPreparation} from './kart-warmup-scheduler.mjs';
import {createKartLod} from './kart-lod.mjs';
import {createRaisedPoseSupport} from './kart-raised-support.mjs';
import {createRaisedPickups} from './kart-raised-pickups.mjs';
import {createRaisedCameraQuery} from './kart-raised-camera.mjs';
import {createRaisedShadows,disableRaisedStaticShadows} from './kart-raised-shadows.mjs';
import {kartLightTier} from './kart-festive-lights.mjs';
import {controlsPickerHtml,wirePickers,syncPickers} from '../pickers.js';
import {WEAPON_DISPLAY,WEAPON_IDS,CURATED_MUZZLE,equippedKartWeapon,weaponForward} from './kart-weapon-contract.mjs';
import {paintKartWeapon,kartWeaponArt} from './kart-weapon-hud.mjs';
import {paintKartHearts,createKartHitFeedback,landedText,kartEventCue} from './kart-hearts.mjs';
import {createKartImpactFX} from './kart-impact-fx.mjs';
import {createArsenalFX} from './kart-arsenal-fx.mjs';
import {createKartSkids,kartSliding} from './kart-skids.mjs';
import {createKartThreats} from './kart-threats.mjs';
import {createKartDrivingFX} from './kart-driving-fx.mjs';
import {surfaceProfile} from './kart-surface.mjs';
import {driftTier,DRIFT_TIERS} from './kart-drift.mjs';
import {createKartArenaFeatures} from './kart-arena-features-art.mjs';
import {loadElevatedPhysics,createElevatedPrediction} from './kart-elevated-prediction.mjs';
import {createKartWarmupLibrary,warmKartRenderer} from './kart-render-warmup.mjs';
import {createKartCameraCollision} from './kart-camera-collision.mjs';
import {arenaFeatureSolids} from './kart-feature-solids.mjs';
/* Elevated combat presentation for real Room snapshots. No gameplay or
 * client coordinates are sent: only sequenced, life-scoped intent. */
import {createThreeView} from '../renderers/three-view.js';
import {kartResultView} from './kart-results.mjs';
import {createKartArenaPicker} from './kart-next-arena.mjs';
import {kartModeInfo,kartScore,kartScoreText,kartGoalText,kartTeamTag,paintKartObjectiveHud} from './kart-mode-ui.mjs';
import {createKartObjectives} from './kart-objectives.mjs';
import {kartGarageHtml,createKartGarageUI,garagePreviewKey} from './kart-garage-ui.mjs';
import {createGarageThumbnail} from './kart-garage-thumbnail.mjs';
import {createMobileStick} from '../toolkit/mobile-stick.mjs';
import {readInputCapabilities,touchControlsFor} from '../toolkit/input-capabilities.mjs';
import {createKartModel,animateKartModel} from './kart-model.mjs';
import {batchKartBody} from './kart-batching.mjs';
import {createKartCombatArt,projectileContactInset} from './kart-combat-art.mjs';
import {createKartHealthBars} from './kart-health-bars.mjs';
import {createKartElevatedWorld} from './kart-elevated-world.mjs';
import {loadKartGLB} from './kart-prefetch.mjs';
import {MeshoptDecoder,closeKartAssetBitmaps,loadKartWeaponThumbnails,loadKartDrivers,matchKartDrivers,KART_ELEVATED_FILES,buildKartDriverVariants} from './kart-assets.mjs';
import {cleanKartLook,kartPaintHex} from './kart-looks.mjs';
import {elevatedMap} from './kart-elevated-maps.mjs';
import CONFIG from './kart-physics-config.mjs';
import {createKartAudio} from './kart-audio.mjs';
import {createGearbox,paintGear} from './kart-gearbox.mjs';
import {blendElevatedPose,nextElevatedInput,createElevatedTimeline} from './kart-elevated-pose.mjs';

const PROTECTION='<path d="m15 3 11 4v10c0 7-11 12-11 12S4 24 4 17V7l11-4Z" fill="#45c6e8"/><path d="m10 16 4 4 7-9" stroke="#fff"/>';
const svg=(path)=>`<svg viewBox="0 0 32 32" aria-hidden="true" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
const NITRO=svg('<path d="m18 2-12 16h9l-2 12 12-18h-9l2-10Z" fill="#83ebff"/>');
const DRIFT=svg('<path d="M22 4c4 1 7 4 9 8M25 2c3 1 5 3 7 6" stroke="#f5f8ff" stroke-width="2"/><circle cx="13" cy="20" r="9" fill="#141a26" stroke="#9fb2c8" stroke-width="2"/><circle cx="13" cy="20" r="3" fill="#9fb2c8"/>');
const TARGET=svg('<circle cx="16" cy="16" r="9" stroke="#fff"/><path d="M16 2v9m0 10v9M2 16h9m10 0h9" stroke="#fff"/>');
const neutral=()=>({steer:0,throttle:0,brake:0,nitro:false,use:false});
const colors=[0xf59539,0x21a9af,0xca49b0,0x5c8ceb,0xec5765,0x7eb643,0xaf7cde,0xffd451];

export function createElevatedKartView() {
  let root,api,S,sequence=0,epoch='',generation=0,gl,audio,stick,preference='auto',pending=false,gfxReady=false,graphicsFailed=false;
  let hitFx=null,analog={x:0,y:0},lastSend=0,lastKey='',timer=0,inputTimer=0,resultsTimer=0,firstEvents=true,itemKey='',standingsKey='',audioDrifting=false,feedbackEpoch=0;
  const gearbox=createGearbox(CONFIG.handling.maxForward);
  let sceneReady,shellAudioReady,rendererWarmup,startAudio,lastSnapshotArrival=null,snapshotOffset=null,prediction=null,predicted=null;
  const timeline=createElevatedTimeline();
  const pickupPrediction=createKartPickupPrediction({onPredict:c=>{audio?.cue('pickup');newEvents.push({event:{type:'pickup',pid:S.you,position:c.position},at:performance.now()});paint();},onReject:()=>{paint();}});
  let localUseHeld=false;const localFires=[];
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
    if(value.use&&!localUseHeld&&self()?.weapon&&!self()?.firing&&!localFires.some(f=>f.weapon===self()?.weapon&&time-f.at<800)&&S.phase==='live'){
      const k=self();localFires.push({weapon:k.weapon,at:time});audio?.cue(k.weapon);
      // The first tracking shot uses its confirmed direction, including behind the kart.
      if(k.weapon!=='machinegun'){
        const p=predicted?.pose||k.pose,q=p.rotation,v=CURATED_MUZZLE;
        const t={x:2*(q.y*v.z-q.z*v.y),y:2*(q.z*v.x-q.x*v.z),z:2*(q.x*v.y-q.y*v.x)};
        const position={x:p.position.x+v.x+q.w*t.x+q.y*t.z-q.z*t.y,y:p.position.y+v.y+q.w*t.y+q.z*t.x-q.x*t.z,z:p.position.z+v.z+q.w*t.z+q.x*t.y-q.y*t.x};
        newEvents.push({event:{type:'fire',pid:S.you,weapon:k.weapon,position,direction:weaponForward(q),local:true},at:time});
      }
    }
    localUseHeld=value.use;
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
    const gear=gearbox.update(k?.alive?k.pose.speed||0:0);paintGear(root?.querySelector('[data-gear]'),gear);
    audio?.update({speed:k?.pose.speed||0,throttle:intent().throttle,gear:gear.gear,rpm:gear.rpm,shift:gear.shift,drifting:!!predicted?.drifting||!!k?.drifting||audioDrifting,boost:k?.nitroActive||(predicted?.turbo??k?.turbo)>0,surface:predicted?.surface||k?.surface,grounded:(predicted?.pose||k?.pose)?.grounded===true,
      active:gfxReady&&!S?.preparing&&S?.phase==='live'&&!document.hidden&&context?.connected!==false&&!context?.roomActionPending,
      engineActive:!!S?.youDrive&&!!k?.alive&&!!k?.connected&&!blocked()});
  }
  function touch(){
    const controls=$('controls');
    if(controls.value!==preference){controls.value=preference;syncPickers(controls.parentNode);}
    const show=touchControlsFor(preference,readInputCapabilities())&&S?.youDrive&&S.phase!=='done';setKartFlag($('touch'),'hidden',!show);root.classList.toggle('pke-touch-mode',show);}
  const arenaPicker=createKartArenaPicker(),garageUI=createKartGarageUI();
  let garagePending=null;
  const garageSpec=()=>({...kartLookFor(S.you,0),levels:S.upgrades?.[S.you] || {}});
  let resultAnnouncementKey='';
  function paint(){
    if(!S||!root)return;
    const me=self(),watch=!S.youDrive;
    setKartFlag(root.querySelector('.pke-bottom'),'hidden',watch);
    root.classList.toggle('kart-has-teams',!!S.teamMode);
    // Equal knockouts share a rank; drivers who dropped out sit last.
    const ranked=[...S.karts].sort((a,b)=>(a.out===true)-(b.out===true)||kartScore(b,S)-kartScore(a,S));
    const ranks=[];ranked.forEach((k,i)=>{ranks[i]=i&&!k.out&&!ranked[i-1].out&&kartScore(k,S)===kartScore(ranked[i-1],S)?ranks[i-1]:i+1;});
    const mine=ranked.findIndex(k=>k.id===S.you),rank=mine>=0?ranks[mine]:0,name=api.name?.(S.you)||S.you;
    const score=kartScore(me,S),mode=kartModeInfo(S),battle=S.mode!=='starrush';
    setKartText($('score'),watch?'Watching':`P${rank} · ${kartScoreText(score,S)}`);
    setKartAttribute($('score'),'aria-label',watch?'Watching the arena':`Rank ${rank}, ${name}, ${kartScoreText(score,S)}`);
    paintKartObjectiveHud($('objective'),S,id=>api.name?.(id)||id);
    const nextItem=me?.weapon||(me?.supernovaT>0?'supernova':'');
    if(nextItem!==itemKey){const icon=nextItem?kartWeaponArt(nextItem):TARGET;$('use-icon').innerHTML=icon;itemKey=nextItem;}
    const equipped=paintKartWeapon($('weapon'),me,{hint:!touchControlsFor(preference,readInputCapabilities())});
    setKartFlag($('weapon'),'hidden',!me||!battle||!S.youDrive);
    setKartText($('use-ammo'),me?.weapon?equipped.count.slice(1):'');
    setKartText($('use-label'),WEAPON_DISPLAY[me?.weapon]?.short || 'Fire');
    setKartFlag($('use-ammo'),'hidden',!me?.weapon);
    setKartAttribute($('use'),'aria-label',me?.firing?'Weapon firing':me?.weapon?WEAPON_DISPLAY[me.weapon]?.action||equipped.label:'Use weapon');
    setKartFlag($('protection'),'hidden',!S.youDrive||!(me?.shield>0));
    setKartFlag($('health'),'hidden',!me||!battle||!S.youDrive);if(me)paintKartHearts($('health'),me);
    setKartFlag($('use'),'hidden',!battle);
    setKartFlag($('use'),'disabled',!me?.weapon||me?.firing||!active()||S.phase!=='live');
    setKartFlag($('nitro'),'disabled',!active()||me?.nitro<.15);
    setKartText($('notice'),me&&!me.connected?'Reconnecting…':me&&!me.alive?'Respawning…':watch?'Watching the battle':'');
    setKartFlag($('notice'),'hidden',!$('notice').textContent);
    setKartText($('arena'),S.map?.label||'Pocket Karts');
    setKartText($('goal'),kartGoalText(S));
    setKartFlag($('result'),'hidden',S.phase!=='done');
    const arenaKey=arenaPicker.sync(S,api),bought=!!(garagePending&&S.garageResult?.nonce===garagePending&&S.garageResult.ok);
    if(garagePending&&S.garageResult?.nonce===garagePending)garagePending=null;
    const nextStandings=S.phase==='done'?JSON.stringify([S.result,S.you,ranked.map(k=>api.name?.(k.id)||k.id),S.winRule,S.targetHits,S.targetStars,S.targetFlags,S.modeLabel,S.teamResult,S.coins,S.upgrades?.[S.you],S.garageResult,garagePending,arenaKey]):'';
    if(nextStandings!==standingsKey){
      standingsKey=nextStandings;
      if(S.phase==='done'&&S.result){
        const unit=n=>kartScoreText(n,S),target=S[mode.target]||0;
        const final=kartResultView({result:S.result,you:S.you,nameOf:id=>api.name?.(id)||id,unit,target,targetUnit:mode.unit+(target===1?'':'s'),teams:S.teams,teamResult:S.teamResult,teamByPlayer:S.teamByPlayer});
        const result=$('result'),scroll=result.scrollTop,focused=result.contains(document.activeElement)?document.activeElement:null;
        const focusedArena=focused?.getAttribute?.('data-arena'),focusedMode=focused?.getAttribute?.('data-next-mode'),focusedPart=focused?.getAttribute?.('data-upgrade')||focused?.getAttribute?.('data-part');
        result.innerHTML=final.html+kartGarageHtml(S,garagePending,garageSpec())+arenaPicker.html(S,api);
        garageUI.paint(result,S,{bought,reducedMotion:matchMedia?.('(prefers-reduced-motion: reduce)').matches===true,key:garagePreviewKey(garageSpec())},api);
        if(focusedArena)result.querySelector(`[data-arena="${focusedArena}"]`)?.focus({preventScroll:true});
        if(focusedMode)result.querySelector(`[data-next-mode="${focusedMode}"]`)?.focus({preventScroll:true});
        if(focusedPart){const button=result.querySelector(`[data-upgrade="${focusedPart}"]`);if(button&&!button.disabled)button.focus({preventScroll:true});else{const card=result.querySelector(`[data-part="${focusedPart}"]`);card?.setAttribute('tabindex','-1');card?.focus({preventScroll:true});}}
        result.scrollTop=scroll;
        const announcementKey=JSON.stringify([S.instanceId,S.result,S.you]);
        if(announcementKey!==resultAnnouncementKey){resultAnnouncementKey=announcementKey;api.announce?.(`${final.title}. ${final.line}`);}
      }else{$('result').replaceChildren();garageUI.reset();}
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
    setKartText($('clock'),status??(S.phase==='done'?'0:00':S.phase==='countdown'?String(seconds):`${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`));
    setKartAttribute($('clock'),'aria-label',!gfxReady?(graphicsFailed?'Arena unavailable; retry 3D':'Loading arena'):S.preparing?'Arena ready; waiting for players':S.phase==='done'?'Round complete':`${seconds} seconds remaining`);
    setKartAttribute($('clock'),'data-kos',S.youDrive?kartScoreText(kartScore(self(),S),S):'Watching');
    const k=self();setKartText($('speed'),String(Math.round(Math.abs(k?.pose.speed||0)*3.6)));
    const charge=String(Math.round(Math.max(0,Math.min(1,k?.nitro||0))*100)/100);
    if($('charge').style.getPropertyValue('--charge')!==charge)$('charge').style.setProperty('--charge',charge);if($('nitro').style.getPropertyValue('--charge')!==charge)$('nitro').style.setProperty('--charge',charge);
    setKartAttribute($('nitro'),'aria-label',`Hold for Nitro, ${Math.round(Number(charge)*100)} percent charged`);
    const slide=predicted||k,tier=driftTier(slide?.driftCharge||0),meter=$('drift');
    const meterHidden=!tier&&!(slide?.turbo>0);if(meter.hidden!==meterHidden)meter.hidden=meterHidden;const label=tier?DRIFT_TIERS[tier-1].label+' · release for turbo':slide?.turbo>0?'Turbo!':'';
    if(meter.textContent!==label)meter.textContent=label;
    const meterColor=tier?DRIFT_TIERS[tier-1].css:'#83ebff';if(meter.dataset.tier!==String(tier)){meter.style.color=meterColor;meter.dataset.tier=String(tier);}
  }
  async function scene(THREE,helper,gen){
    const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(52,1,.1,650),renderer=helper.renderer();
    let warmup,world,art,library,healthBars,impactFX,skids,threats,arsenalFX,cameraCollision,arena,drivingFX,scenePrediction,pickups,shadows,kartLod,objectives,garageThumbnail,lastPredictionTime=null;const slidePose={angle:0,physicalPose:{linearVelocity:null,grounded:true}};const lodEntries=[],models=new Map(),rigs=new Map(),objects=new Map(),effects=[];
    try{
      const physicsReady=S.youDrive?loadElevatedPhysics().catch(()=>null):Promise.resolve(null);
      const map=elevatedMap(S.mapId,S.variantId);if(map.revision!==S.mapRevision)throw Error('Arena revision mismatch');
      if(gen!==generation)throw Error('Retired arena');
      const {GLTFLoader}=await import('../../vendor/three/loaders/GLTFLoader.js');
      const {mergeGeometries}=await import('../../vendor/three/utils/BufferGeometryUtils.js');
      await MeshoptDecoder.ready;
      const loader=new GLTFLoader().setMeshoptDecoder(MeshoptDecoder),assets={};library=new THREE.Group();library.visible=false;scene.add(library);
      const files=[...KART_ELEVATED_FILES];
      if(S.mode==='starrush')files.push(['star','giggle-star','star-rush-v1']);
      if(map.environment==='alpine')files.push(['stylized','environment/stylized-alpine','9426a0ed'],['fountain','environment/alpine-fountain','7a687cd3']);
      const drivers=loadKartDrivers(loader,matchKartDrivers(S.karts,api?.context?.()?.looks)).then(values=>{assets.drivers=values;for(const driver of values)if(driver)library.add(driver);});
      const loaded=await Promise.allSettled([...files.map(async([key,file,version])=>{const gltf=await loadKartGLB(loader,`/assets/karts/${file}.glb?v=${version}`);assets[key]=gltf.scene;library.add(gltf.scene);}),loadKartWeaponThumbnails(),drivers]);
      if(loaded.some((r,i)=>r.status==='rejected'&&files[i]?.[0]!=='fountain'))throw Error('Combat assets did not load');
      if(gen!==generation)throw Error('Retired arena');
      if(assets.stylized)for(const name of ['PineA','PineB','TreeA','GrassA','FlowersA','RockA','RockB','CottageA'])if(!assets.stylized.getObjectByName(name))throw new Error('The stylized Alpine library is incomplete');
      const conformPose=createRaisedPoseSupport(THREE,map);
      world=createKartElevatedWorld(THREE,{scene,map,palette:S.palette,assets,quality:()=>kartLightTier(renderer),reducedMotion:()=>helper.reducedMotion()});
      arena=createKartArenaFeatures(THREE,scene,{reducedMotion:()=>helper.reducedMotion()});arena.sync(map);disableRaisedStaticShadows(world.group);disableRaisedStaticShadows(arena.root);
      pickups=createRaisedPickups(THREE,scene,48,assets.pickupGear.getObjectByName('PickupCrateLOD'));kartLod=createKartLod(THREE,{fullDetail:8,keepNear:6,far:48,originY:.55+CONFIG.chassis.modelOriginY});/* Same distance rule as classic maps: full models up to 8 karts and for the nearest few; boxes only for far karts in big crowds. A hard cap of 1 drew most rivals as blocks. */kartLod.object.visible=false;scene.add(kartLod.object);shadows=createRaisedShadows(THREE,{sun:world.lighting.sun,quality:()=>kartLightTier(renderer)});
      const R=await physicsReady;if(gen!==generation)throw Error('Retired arena');
      if(R&&S.youDrive){scenePrediction=createElevatedPrediction(R);prediction=scenePrediction;prediction.ingest(S,performance.now(),now());}
      scene.fog=new THREE.Fog(world.lighting.fogColor,world.lighting.fogNear,world.lighting.fogFar);
      renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFShadowMap;renderer.toneMapping=THREE.NeutralToneMapping;renderer.toneMappingExposure=world.lighting.exposure;
      assets.kartVariants=buildKartDriverVariants(THREE,assets.kart,assets.drivers,mergeGeometries,library);
      batchKartBody(THREE,assets.kart,mergeGeometries);
      // The source pack's foam dart is an inspection candidate. Combat keeps
      // the compact metal Scatter slug; mounted source rigs are independent.
      const combatAssets={get:name=>assets.pickupGear?.getObjectByName(name)||assets.pulse.getObjectByName(name)||assets.arsenal.getObjectByName(name)||(name!=='ScatterShot'&&assets.secondary.getObjectByName(name))||assets.combat.getObjectByName(name)};
      if(!assets.pulse.getObjectByName('Pulse')||['Rocket','RocketShot','Mine','MineTrap','Seeker','SeekerShot','Bomb','BombShot'].some(name=>!assets.arsenal.getObjectByName(name))||!assets.secondary.getObjectByName('Scatter'))throw Error('The mounted arsenal did not load');
      art=createKartCombatArt(THREE,{assets:combatAssets,pickupAsset:assets.crate});
      objectives=createKartObjectives(THREE,scene,{state:S,assets,renderStars:true});
      healthBars=createKartHealthBars(THREE,scene);impactFX=createKartImpactFX(THREE,scene,{reducedMotion:()=>helper.reducedMotion()});
      // Elevated decks have no height field: effects use the event point's own floor.
      arsenalFX=createArsenalFX(THREE,scene,{reducedMotion:()=>helper.reducedMotion(),groundAt:()=>NaN});
      // Elevated decks have no height field: marks sit at the sliding kart's own wheel plane.
      let skidGround=0;skids=createKartSkids(THREE,scene,{groundAt:()=>skidGround});
      drivingFX=createKartDrivingFX(THREE,scene,camera,{groundAt:()=>skidGround,reducedMotion:helper.reducedMotion()});
      threats=createKartThreats(THREE,scene,root,{reducedMotion:()=>helper.reducedMotion(),beep:level=>audio?.beep?.(level)});
      const statusOptions={time:0,elapsed:0},absentStatusOptions={elapsed:Infinity};
      const cameraTarget=new THREE.Vector3(),cameraPosition=new THREE.Vector3(),forward=new THREE.Vector3(0,0,1),up=new THREE.Vector3(0,1,0),hits=[];
      const target=new THREE.Vector3(),desired=new THREE.Vector3(),nose=new THREE.Vector3(),direction=new THREE.Vector3(),ray=new THREE.Raycaster();
      const collisionMeshes=[...world.colliderMeshes.values()].map(value=>value.cameraBody||value.body);
      const cameraQuery=createRaisedCameraQuery(THREE,collisionMeshes);
      cameraCollision=createKartCameraCollision(THREE,[...collisionMeshes,...arenaFeatureSolids(map.features)]);
      function clearCamera(position,focus){
        direction.subVectors(position,focus);const distance=direction.length();if(distance<.001)return;
        ray.set(focus,direction.normalize());ray.far=distance;hits.length=0;cameraQuery.intersect(ray,hits);
        const hit=hits[0];if(hit&&hit.distance<distance){position.copy(focus).addScaledVector(direction,Math.max(.05,hit.distance-.2));return true;}
      }
      let cameraKick=0;const wrecks=new Map(),flashes=[];
      const fxGeometry=new THREE.BoxGeometry(.065,.065,.26),fxMaterial=new THREE.MeshBasicMaterial({color:0xffffff});
      // Prepare shot materials/geometries and particle buffers while the loading
      // screen is still up. Firing reuses these objects rather than uploading
      // a new InstancedMesh or calibrating the complete arsenal in a live frame.
      const rigPools=new Map(WEAPON_IDS.map(kind=>[kind,Array.from({length:Math.max(8,S.karts.length)},()=>art.weapon(kind))]));
      const pools=new Map(),warm=[],warmFrustum=new Map(),contactInsets=new Map();
      function projectile(kind){
        const object=art.projectile(kind),radius=S.projectileRadii?.[kind];
        if(radius!=null){
          const key=kind+':'+radius;
          if(!contactInsets.has(key))contactInsets.set(key,projectileContactInset(THREE,object,radius));
          object.userData.combat.contactInset=contactInsets.get(key);object.userData.combat.contactRadius=radius;
        }
        return object;
      }
      const shotKinds=['machinegun','trishot','missile','cannon','nuke'];
      const poolKey=(prefix,value)=>prefix==='mine:'?prefix+(value.kind||value.weapon||'mine')+':'+(value.owner===S.you):prefix+value.weapon;
      for(const kind of shotKinds){const pool=[];for(let i=0;i<64;i++){const object=projectile(kind);object.visible=false;scene.add(object);pool.push(object);}pools.set('shot:'+kind,pool);if(kind==='nuke'){const grenades=[];for(let i=0;i<12;i++){const object=art.projectile(kind);object.visible=false;scene.add(object);grenades.push(object);}pools.set('grenade:'+kind,grenades);}warm.push(pool[0]);}
      // Confirmed final sweeps remain readable when the shot itself never
      // reaches a snapshot. Borrow only existing tracer art, prepared once.
      const confirmedPools=new Map(),confirmedShots=[],shotBounds=new THREE.Box3(),shotCenter=new THREE.Vector3();
      let confirmedEpoch=feedbackEpoch,lastEffectTime=null;
      for(const kind of ['machinegun','trishot']){
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
      for(const kind of ['frost']){const grenades=[];for(let i=0;i<12;i++){const object=art.projectile(kind);object.visible=false;scene.add(object);grenades.push(object);}pools.set('grenade:'+kind,grenades);warm.push(grenades[0]);}
      for(const kind of ['mine','proximity','fakecrate'])for(const own of [false,true]){
        const pool=[];for(let i=0;i<16;i++){const object=art.mine(own,kind);object.visible=false;scene.add(object);pool.push(object);}pools.set('mine:'+kind+':'+own,pool);warm.push(pool[0]);
      }
      const warningGeometry=new THREE.RingGeometry(13.4,14,64);warningGeometry.rotateX(-Math.PI/2);
      const warningMaterial=new THREE.MeshBasicMaterial({color:0xff8c45,transparent:true,opacity:.65,depthWrite:false,side:THREE.DoubleSide});
      const warnings=[];for(let i=0;i<12;i++){const object=new THREE.Mesh(warningGeometry,warningMaterial);object.name='NukeWarningRing';object.visible=false;scene.add(object);warnings.push(object);}pools.set('warning:nuke',warnings);warm.push(warnings[0]);
      warm.push(...arsenalFX.objects());
      const statusDummy=new THREE.Group();arsenalFX.warmStatus(statusDummy);scene.add(statusDummy);warm.push(statusDummy);
      for(const pool of rigPools.values()){scene.add(pool[0]);warm.push(pool[0]);}
      const normal=new THREE.Vector3(),basis=new THREE.Quaternion();
      const sparkColor=new THREE.Color();
      for(let i=0;i<12;i++){const mesh=new THREE.InstancedMesh(fxGeometry,fxMaterial,24);mesh.name='RaisedCombatParticles';mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);for(let j=0;j<24;j++)mesh.setColorAt(j,sparkColor.setHex(0xffdf8b));mesh.frustumCulled=false;mesh.visible=false;scene.add(mesh);effects.push({mesh,count:0,position:new THREE.Vector3(),velocities:Array.from({length:24},()=>new THREE.Vector3()),age:0,duration:0});}
      const flashGeometry=new THREE.ConeGeometry(.18,.65,6);flashGeometry.rotateX(Math.PI/2);
      const flashMaterial=new THREE.MeshBasicMaterial({color:0xffe6a1,transparent:true,opacity:.9,depthWrite:false});
      for(let i=0;i<12;i++){const mesh=new THREE.Mesh(flashGeometry,flashMaterial);mesh.name='CombatMuzzleFlash';mesh.visible=false;scene.add(mesh);flashes.push({mesh,age:0});}
      // Every kart body is prepared before the first live frame too.
      for(let index=0;index<S.karts.length;index++){const k=S.karts[index],model=createKartModel(THREE,{assets,...kartLookFor(k.id,index)});model.userData.lodColor=kartLookFor(k.id,index).color;model.userData.elevatedPose={position:{},rotation:{}};models.set(k.id,model);scene.add(model);shadows.add(model);arsenalFX.warmStatus(model);warm.push(model);}
      for(const k of S.karts)warm.push(healthBars.add(k.id));
      pickups.update(S.crates,0);pickups.mesh.count=Math.max(1,pickups.mesh.count);warm.push(pickups.mesh);kartLod.object.count=1;warm.push(kartLod.object);
      warm.push(...flashes.map(f=>f.mesh));
      warm.push(...effects.map(f=>f.mesh));camera.position.set(0,5,-9);camera.lookAt(0,0,0);
      for(const object of warm){object.visible=true;object.position.set(0,-100,0);object.traverse(o=>{if(!warmFrustum.has(o))warmFrustum.set(o,o.frustumCulled);o.frustumCulled=false;});}
      shadows.update();
      const warmLibrary=createKartWarmupLibrary(THREE,scene,assets,art);
      // State/countdown paint signals can expire while this arena still lives.
      // Scope required GPU preparation to its generation. Then allow six
      // seconds for other bindings; no queue resumes after scene handoff.
      warmup=await warmKartRenderer(THREE,renderer,scene,camera,{isAlive:()=>gen===generation,
        requiredRoots:[...warm,warmLibrary,objectives.root,scene.getObjectByName('KartImpactFX')],
        budgetMs:6000,priorityRoots:[world.group,...models.values(),pickups.mesh,drivingFX.particles,drivingFX.speedLines],
        onProgress:({completed,total})=>{if(gen===generation){const loading=$('loading'),text=`Preparing graphics… ${Math.round(completed/total*100)}%`;if(loading&&loading.textContent!==text)loading.textContent=text;}},
        roots:[...warm,warmLibrary,arena.root,drivingFX.particles,drivingFX.speedLines,scene.getObjectByName('KartSkidMarks'),
          scene.getObjectByName('KartThreatRing'),scene.getObjectByName('KartImpactFX')]}).catch(()=>null);
      if(gen!==generation){warmup?.cancel();throw Error('Retired arena');}
      // Loading is the only time reserved geometry may be drawn for warm-up.
      warmup?.cancel();
      rendererWarmup=warmup;
      for(const object of warm){object.visible=false;object.position.set(0,0,0);const combat=object.userData.combat;if(combat&&combat.type!=='projectile')object.removeFromParent();}
      kartLod.object.count=0;
      for(const [o,flag]of warmFrustum)o.frustumCulled=flag;warmFrustum.clear();
      // Reserved bodies stay uploaded, but need no scene traversal or world
      // matrix updates until an authoritative item actually uses them.
      for(const pool of pools.values())for(const object of pool)object.removeFromParent();
      statusDummy.removeFromParent();arsenalFX.reset();
      if(gen!==generation)throw Error('Retired arena');
      function effect(e,age=0){
        if(!e.position)return;
        impactFX.emit(e,age);arsenalFX.event(e,age);arsenalFX.react(e,models,age);if(e.type==='blast'&&e.weapon==='nuke'&&!helper.reducedMotion()){const p=self()?.pose.position;if(p&&Math.hypot(p.x-e.position.x,p.y-e.position.y,p.z-e.position.z)<14)cameraKick=Math.max(cameraKick,.35);}
        const pool=e.type==='impact'&&e.from&&confirmedPools.get(e.weapon);
        if(pool){
          direction.subVectors(e.position,e.from);const length=direction.length();
          if(length>1e-6){
            let cue=pool[0];for(const candidate of pool){if(!candidate.object.visible){cue=candidate;break;}if(candidate.age>cue.age)cue=candidate;}
            cue.age=age;direction.multiplyScalar(1/length);const visibleLength=Math.min(length,1.25);cue.object.position.copy(e.position).addScaledVector(direction,-visibleLength*.5);cue.object.quaternion.setFromUnitVectors(forward,direction);cue.object.scale.set(1,1,visibleLength/cue.length);cue.object.visible=age<.09;
          }
        }
        if(e.type==='fire'){if(e.weapon==='machinegun')art.aim(rigs.get(e.pid)?.object,e.direction);art.recoil(rigs.get(e.pid)?.object);}
        if(e.type==='fire'&&e.direction&&['machinegun','trishot','missile','cannon','nuke','frost'].includes(e.weapon)){
          const f=flashes.find(f=>!f.mesh.visible)||flashes[0];f.mesh.visible=age<.09;f.age=age;f.mesh.position.copy(e.position);f.mesh.quaternion.setFromUnitVectors(forward,direction.copy(e.direction).normalize());f.mesh.scale.setScalar(e.weapon==='cannon'||e.weapon==='missile'||e.weapon==='nuke'?1.6:1);return;
        }
        if(e.type==='hit'&&e.other===S.you)hitFx?.hurt();
        if(e.pid===S.you&&e.other&&e.other!==S.you&&['hit','ko','block'].includes(e.type))hitFx?.landed(landedText(e));
        if(e.type==='ko'&&e.other===S.you)hitFx?.notice('KO!');
        if(e.type==='ko'&&e.pid===S.you&&e.other&&e.other!==S.you)hitFx?.knockout(api.name?.(e.other)||e.other);
        if(e.type==='ko'&&e.other)wrecks.set(e.other,{age:0,at:performance.now()/1000,position:{...e.position},life:S.karts.find(k=>k.id===e.other)?.spawnSeq});
        if(e.type==='blast'||e.type==='impact')return;
        if(!['ko','collision','landing','hit','pickup'].includes(e.type))return;
        const strength=e.impulse===undefined?1:Math.max(.12,Math.min(1,e.impulse/1000));
        if((e.pid===S.you||e.other===S.you)&&!helper.reducedMotion())cameraKick=Math.max(cameraKick,(e.type==='collision'?.10:e.type==='ko'?.16:.05)*strength);
        if(e.type==='landing'||e.type==='collision'||helper.reducedMotion())return;
        const small=['impact','collision','hit'].includes(e.type),f=effects.find(f=>!f.mesh.visible)||effects.reduce((a,b)=>a.age>b.age?a:b);
        f.count=small?8:24;f.mesh.count=f.count;f.mesh.visible=true;f.position.copy(e.position);f.age=0;f.at=performance.now()/1000-age;f.duration=.14;
        normal.copy(e.normal||up);if(normal.lengthSq()<.01)normal.copy(up);normal.normalize();basis.setFromUnitVectors(up,normal);
        for(let j=0;j<f.count;j++){const angle=j*2.39996,speed=(j%3+3)*(.45+.55*strength);f.velocities[j].set(Math.cos(angle)*speed,2+j%4,Math.sin(angle)*speed).applyQuaternion(basis).y+=1.2;f.mesh.setColorAt(j,sparkColor.setHex(small?(j%2?0xffe3a0:0xf5fbff):(j%3?0xff8128:0xffdc68)));}f.mesh.instanceColor.needsUpdate=true;
      }
      function hideAbsentModel(model,id){
        // Keep prepared models for reuse, but absence is authoritative too.
        // A departed player must not leave its last tilted/wreck pose behind.
        for(let i=0;i<S.karts.length;i++)if(S.karts[i].id===id)return;
        model.visible=false;model.scale.setScalar(1);model.quaternion.identity();wrecks.delete(id);
        healthBars.add(id).visible=false;arsenalFX.status(model,null,absentStatusOptions);skids.forget(id);drivingFX.forget(id);
        const rig=rigs.get(id);if(rig){rig.object.removeFromParent();rigPools.get(rig.kind)?.push(rig.object);rigs.delete(id);}
      }
      function bodies(dt,time,playback){
        models.forEach(hideAbsentModel);
        const alpha=playback?.alpha??1;
        for(let index=0;index<S.karts.length;index++){
          const k=S.karts[index];let model=models.get(k.id);
          if(!model){model=createKartModel(THREE,{assets,...kartLookFor(k.id,index)});model.userData.lodColor=kartLookFor(k.id,index).color;model.userData.elevatedPose={position:{},rotation:{}};models.set(k.id,model);scene.add(model);shadows.add(model);}
          const sample=playback?.current.karts.get(k.id);
          const current=sample?.spawnSeq===k.spawnSeq&&sample?.controlEpoch===k.controlEpoch&&k.alive&&k.connected!==false?sample:k;
          const moving=k.id===S.you&&predicted?predicted:k;
          const rawPose=k.id===S.you&&predicted?(predicted.renderPose||predicted.pose):blendElevatedPose(playback?.previous.karts.get(k.id),current,alpha,model.userData.elevatedPose),p=conformPose(rawPose,model.userData.supportPose||(model.userData.supportPose={position:{},rotation:{}})),wreck=wrecks.get(k.id);
          if(wreck)wreck.age=Math.max(0,time-wreck.at);
          if(wreck&&(k.alive||wreck.life!==k.spawnSeq||wreck.age>=.65))wrecks.delete(k.id);
          const exploding=wrecks.get(k.id);model.visible=!k.out&&(k.alive||!!exploding);model.scale.setScalar(1);
          model.userData.poseEpoch=p.epoch;model.position.copy(p.position);model.quaternion.set(p.rotation.x,p.rotation.y,p.rotation.z,p.rotation.w);model.userData.kart.inner.position.y=CONFIG.chassis.modelOriginY;
          if(exploding){model.position.copy(exploding.position);if(!helper.reducedMotion()){model.position.y+=Math.sin(exploding.age/.65*Math.PI)*.8;model.rotateZ(exploding.age*1.6);model.scale.setScalar(Math.max(.15,1-exploding.age/.65));}}
          healthBars.update(k.id,k,model.position,!S.youDrive||k.id!==S.you);
          {const q=model.quaternion;skidGround=model.position.y+CONFIG.chassis.modelOriginY;slidePose.angle=Math.atan2(2*(q.w*q.y+q.x*q.z),1-2*(q.x*q.x+q.y*q.y));slidePose.physicalPose.linearVelocity=p.linearVelocity;slidePose.physicalPose.grounded=p.grounded!==false;
            const sliding=k.alive&&kartSliding(moving,slidePose,k.id===S.you&&intent().brake>0),surface=surfaceProfile(moving.surface);
            skids.track(k.id,model.position.x,model.position.z,slidePose.angle,sliding,surface);
            if(k.alive&&S.phase==='live')drivingFX.track(k.id,model.position.x,model.position.y,model.position.z,slidePose.angle,p.speed,sliding,moving.driftCharge||0,surface,p.grounded!==false);}
          animateKartModel(model,{physicalPose:p,speed:p.speed,steer:k.id===S.you?intent().steer:0,boost:k.nitroActive||moving.turbo>0||k.rammingT>0,drivingJuice:true,driftHop:moving.driftHop||0,shield:k.shield>0||k.guard===true,invincible:false,dt,reducedMotion:helper.reducedMotion()});
          statusOptions.time=time;statusOptions.elapsed=Math.max(0,(performance.now()-(lastSnapshotArrival??performance.now()))/1000);arsenalFX.status(model,k.alive?k:null,statusOptions);
          const featureKart=model.userData.featureKart||(model.userData.featureKart={pid:k.id});featureKart.respawn=k.respawn;featureKart.out=k.out;featureKart.spawnSeq=k.spawnSeq;
          arena.dressKart(featureKart,model,moving.flight);
          const equipped=equippedKartWeapon(k);const rig=rigs.get(k.id);if(rig?.kind!==equipped){if(rig){rig.object.removeFromParent();rigPools.get(rig.kind)?.push(rig.object);}rigs.delete(k.id);if(equipped){const object=rigPools.get(equipped)?.pop();if(!object)continue;object.position.set(...object.userData.combat.mount);model.userData.kart.inner.add(object);rigs.set(k.id,{kind:equipped,object});}}
          const equipment=rigs.get(k.id)?.object.userData.combat;
          if(equipment){equipment.ammo=k.ammo;equipment.active=k.bladesT>0;equipment.firing=k.firing;}
        }
      }
      const syncIds=new Set();
      function sync(list,prefix,factory){
        const ids=syncIds;ids.clear();for(const value of list||[])ids.add(prefix+value.id);
        for(const[id,object]of objects)if(id.startsWith(prefix)&&!ids.has(id)){impactFX.retire(object);object.visible=false;object.removeFromParent();if(object.userData.poolKey)pools.get(object.userData.poolKey).push(object);objects.delete(id);}
        for(const value of list||[]){const id=prefix+value.id;ids.add(id);let object=objects.get(id);if(!object){const key=poolKey(prefix,value);object=pools.get(key)?.pop()||factory(value);object.userData.poolKey=pools.has(key)?key:null;scene.add(object);objects.set(id,object);object.quaternion.identity();object.scale.setScalar(1);
            if(object.userData.combat){const c=object.userData.combat;c.trailClock=0;c.trailX=c.trailY=c.trailZ=Infinity;}
            // A new mine leaves through the back of its kart and arcs down to its spot.
            if(prefix==='mine:'){const owner=minesSeen&&models.get(value.owner);object.userData.drop=owner?{from:owner.localToWorld(new THREE.Vector3(0,.75,-1.1)),at:null}:null;}}object.position.copy(value.position);object.visible=prefix==='warning:'?value.warning===true:value.available!==false;if(prefix==='crate:')object.position.y-=.6;
          if(value.direction||value.velocity){direction.copy(value.direction||value.velocity);if(direction.lengthSq()>0){const aim=object;if(aim)aim.quaternion.setFromUnitVectors(forward,direction.normalize());}}
          // Mine packets carry the sphere centre along the support normal; art starts at its base.
          if(prefix==='mine:'){direction.copy(value.normal||up).normalize();object.position.addScaledVector(direction,-((value.radius||.41)+.015)+.02);object.quaternion.setFromUnitVectors(up,direction);}
          if(prefix==='mine:'&&object.userData.combat)object.userData.combat.armed=value.armed;
          if(prefix==='mine:'&&object.userData.drop)(object.userData.dropTo||(object.userData.dropTo=new THREE.Vector3())).copy(object.position);
          if(prefix==='grenade:'&&value.weapon==='proximity'&&object.userData.combat){
            const c=object.userData.combat;c.armed=value.armed===true;c.landed=value.landed===true;
            c.rollRate=value.velocity?Math.hypot(value.velocity.x,value.velocity.z)/(value.radius||.6):0;
          }
          if(prefix==='grenade:')object.scale.setScalar(1);
        }
        if(prefix==='mine:')minesSeen=true; // later mines are fresh drops; the first batch was already down
        for(const[id,object]of objects)if(id.startsWith(prefix)&&!ids.has(id)){impactFX.retire(object);object.visible=false;object.removeFromParent();if(object.userData.poolKey)pools.get(object.userData.poolKey).push(object);objects.delete(id);}
      }
      let minesSeen=false,objectTick='',started=false,cameraLife='',sideYaw=0,selectedSideYaw=0,sideHeight=3,recovery=0,sideSettling=false;
      const cameraAnchor=new THREE.Vector3(),cameraSolidAnchor=new THREE.Vector3(),sideEye=new THREE.Vector3(),recoveryEye=new THREE.Vector3(),modelBox=new THREE.Box3(),meshBox=new THREE.Box3(),corner=new THREE.Vector3(),probeCamera=new THREE.PerspectiveCamera(52,1,.1,650);
      const cameraModels=new WeakMap(),contactBoxes=new WeakMap(),contactPoint=new THREE.Vector3(),sideAngles=[25,-25,45,-45,60,-60,75,-75,90,-90];
      const launchHeights=[0,3,7,11],launchAngles=[0,25,-25,45,-45,90,-90,135,-135,180];
      for(const [id,value]of world.colliderMeshes){const descriptor=value.descriptor||map.colliders?.find(d=>d.id===id),body=value.cameraBody||value.body;if(descriptor?.shape==='box'){body.updateWorldMatrix(true,false);body.geometry.computeBoundingBox();contactBoxes.set(body,{box:body.geometry.boundingBox,inverse:new THREE.Matrix4().copy(body.matrixWorld).invert()});}}
      function cameraModel(model){
        let data=cameraModels.get(model);if(data)return data;
        data={meshes:[],samples:[]};
        // Cache actual base-art surface extrema once, not a recursive traversal
        // every chase frame. Cosmetics and mounted weapons do not size the car.
        model.userData.kart.inner.traverse(mesh=>{
          if(!mesh.isMesh||mesh.name==='BoostFlame'||mesh.name==='RespawnShield'||mesh.name==='InvincibilityTrail'||mesh.name==='KartContactShadow'||mesh.name==='KartShadowProxy')return;
          for(let parent=mesh.parent;parent&&parent!==model.userData.kart.inner;parent=parent.parent)if(parent.userData.combat)return;
          mesh.geometry.computeBoundingBox();data.meshes.push(mesh);
          // The source parts remain under OriginalKartBody after batching.
          // Probe those exact surfaces, including the animal, so a merged
          // material name cannot hide the driver from the clearance test.
          let animal=false;for(let parent=mesh;parent;parent=parent.parent)if(parent.name==='KartDriver'){animal=true;break;}
          if(!animal&&!/^(Chassis|DriverHelmet|DriverVisor|DriverTorso|FrontBumper|RearBumper|SidePod|WheelMesh)/.test(mesh.name))return;
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
          direction.subVectors(sample.world,sideEye);ray.far=Math.max(0,direction.length()-.03);ray.set(sideEye,direction.normalize());hits.length=0;cameraQuery.intersect(ray,hits);
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
        sideEye.copy(nose).negate().applyAxisAngle(up,yaw*Math.PI/180).multiplyScalar(8.5).add(cameraAnchor);sideEye.y+=sideHeight;
        clearCamera(sideEye,cameraAnchor);cameraCollision.constrain(sideEye,cameraSolidAnchor);return sideCameraFits(data);
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
      for(const model of models.values())cameraModel(model);
      return {scene,camera,frame(dt,time){
        if(gen!==generation||!S)return;
        if(S.phase==='done'&&S.youDrive&&S.garagePrices){const spec=garageSpec();garageUI.preview(root,garagePreviewKey(spec),()=>{garageThumbnail ||= createGarageThumbnail(THREE,renderer,assets);return garageThumbnail.draw(spec);});}
        // Preserve useful horizontal framing on portrait screens without
        // changing the normal landscape lens or camera clearance geometry.
        const fov=Math.min(80,Math.max(52,2*Math.atan(Math.tan(Math.PI/10)/camera.aspect)*180/Math.PI));
        if(camera.fov!==fov){camera.fov=fov;camera.updateProjectionMatrix();}
        const cycle=S.skyCycle,sky=cycle?Math.max(0,Math.min(1,(now()-cycle.startedAt)/cycle.durationMs)):undefined;
        // Use the full elapsed frame for prediction; the renderer clips dt for
        // camera/FX. Prediction applies its own 250ms budget and fixed substeps.
        const predictionTime=performance.now(),predictionDt=lastPredictionTime===null?dt:Math.max(0,(predictionTime-lastPredictionTime)/1000);lastPredictionTime=predictionTime;
        predicted=prediction?.frame(S,intent(),predictionDt,predictionTime,now())||null;
        const playback=timeline.frame(performance.now());
        pickupPrediction.update(self(),predicted?.pose?.position||self()?.pose?.position,S.crates,S.phase==='live'&&S.youDrive&&api?.context?.().connected!==false);
        shadows.update();pickups.update(S.crates,time,id=>pickupPrediction.hidden(id));
        world.animate(dt,time,sky);scene.fog.color.copy(world.lighting.fogColor);
        // Camera/physics dt is clipped by the renderer. Presentation lifetime
        // uses elapsed monotonic time so a stalled/hidden frame cannot stretch
        // a 90ms tracer or old explosion into several seconds.
        const effectDt=lastEffectTime===null?dt:Math.max(0,time-lastEffectTime);lastEffectTime=time;
        if(confirmedEpoch!==feedbackEpoch){skids.reset();drivingFX.reset();arena.resetHistory();threats.clear();
          for(const f of flashes)f.mesh.visible=false;
          for(const f of effects)f.mesh.visible=false;
          for(const cue of confirmedShots)cue.object.visible=false;
          wrecks.clear();cameraKick=0;impactFX.reset();arsenalFX.reset();
        }
        // dt describes time before this frame. Age existing flashes before
        // accepting new fire, so a 100ms hitch cannot erase a new 90ms flash.
        for(const f of flashes){if(!f.mesh.visible)continue;f.age+=effectDt;if(f.age>=.09-1e-9)f.mesh.visible=false;}
        for(const cue of confirmedShots){if(!cue.object.visible)continue;cue.age+=effectDt;if(cue.age>=.09-1e-9)cue.object.visible=false;}
        confirmedEpoch=feedbackEpoch;impactFX.update(effectDt);arsenalFX.update(effectDt);
        while(newEvents.length){const queued=newEvents.shift();const age=Math.max(0,(performance.now()-queued.at)/1000);if(age<.14)effect(queued.event,age);}
        arena.ingest(S.events,S.karts);arena.animate(effectDt,time,S,models);
        bodies(dt,time,playback);
        drivingFX.update(effectDt,predicted?.pose.speed??self()?.pose.speed??0,(predicted?.turbo??self()?.turbo)>0||self()?.nitroActive===true);
        const itemSnapshot=playback?.current.snapshot||S;
        // Do not keep drawing ordnance from a frozen authority snapshot or a
        // terminal round. A fresh snapshot may show genuinely current objects
        // again; no motion, collision or gameplay lifetime is invented here.
        const itemsFresh=S.phase!=='done'&&performance.now()-(lastSnapshotArrival??-Infinity)<=120&&api?.context?.().connected!==false;
        const itemTick=itemSnapshot.simTick+':'+S.simTick+':'+itemsFresh;
        if(objectTick!==itemTick){objectTick=itemTick;sync(itemsFresh?(itemSnapshot.projectiles||[]).filter(v=>S.projectiles?.some(latest=>latest.id===v.id)):[],'shot:',v=>projectile(v.weapon));sync(itemsFresh?S.mines:[],'mine:',v=>art.mine(v.owner===S.you,v.kind||v.weapon));sync(itemsFresh?(itemSnapshot.grenades||[]).filter(v=>S.grenades?.some(latest=>latest.id===v.id)):[],'grenade:',v=>art.projectile(v.weapon));sync(itemsFresh?(itemSnapshot.grenades||[]).filter(v=>v.weapon==='nuke'&&S.grenades?.some(latest=>latest.id===v.id)):[],'warning:',()=>{throw Error('Nuke warning pool exhausted');});}
        const itemAlpha=playback?.alpha??1;movingItems(itemSnapshot.projectiles,'shot:',playback?.previous.snapshot.projectiles,playback?.current.snapshot.projectiles,itemAlpha);movingItems(itemSnapshot.grenades,'grenade:',playback?.previous.snapshot.grenades,playback?.current.snapshot.grenades,itemAlpha);
        for(const object of objects.values())art.animate(object,dt,time,helper.reducedMotion());
        for(const object of objects.values()){const d=object.userData.drop,to=object.userData.dropTo;if(!d||!to)continue;if(d.at===null)d.at=time;const t=helper.reducedMotion()?1:Math.min(1,(time-d.at)/.32);if(t>=1){object.position.copy(to);object.userData.drop=null;continue;}object.position.lerpVectors(d.from,to,t*(2-t));object.position.y+=Math.sin(t*Math.PI)*.45;}
        for(let i=effects.length-1;i>=0;i--){const f=effects[i];if(!f.mesh.visible)continue;f.age=Math.max(0,time-f.at);if(f.age>=f.duration){f.mesh.visible=false;continue;}for(let j=0;j<f.count;j++){const v=f.velocities[j],fade=Math.max(.02,1-f.age/f.duration);dummy.position.set(f.position.x+v.x*f.age,f.position.y+v.y*f.age-f.age*f.age*7,f.position.z+v.z*f.age);dummy.quaternion.setFromUnitVectors(nose.set(0,0,1),direction.copy(v).normalize());dummy.scale.set(fade,fade,fade*2.5);dummy.updateMatrix();f.mesh.setMatrixAt(j,dummy.matrix);}f.mesh.instanceMatrix.needsUpdate=true;}
        for(const rig of rigs.values())art.animate(rig.object,dt,time,helper.reducedMotion());
        for(const [id,object] of objects){
          if(id.startsWith('shot:')||id.startsWith('grenade:'))impactFX.trail(object,dt);
          if(id.startsWith('warning:')){const body=objects.get('grenade:'+id.slice(8));if(body){object.position.copy(body.position);object.position.y-=.46;}}
        }
        arsenalFX.target(itemsFresh?S:null,models,camera);
        warningMaterial.opacity=helper.reducedMotion()?.65:.58+.1*Math.sin(time*5);
        const followed=self()||S.karts[0];
        // Keep the followed animal/paint in full detail; batch the crowd.
        lodEntries.length=0;
        for(const [id,model]of models)if(id!==followed?.id){
          const entry=model.userData.lodEntry||(model.userData.lodEntry={mesh:model,color:model.userData.lodColor||0xffcf6f});
          entry.visible=model.visible;lodEntries.push(entry);
        }kartLod.update(camera,lodEntries,kartLightTier(renderer)==='low'?3:6);kartLod.object.visible=kartLod.object.count>0;
        const life=`${S.instanceId}:${followed?.id}:${followed?.spawnSeq}:${followed?.controlEpoch}:${models.get(followed?.id)?.userData.poseEpoch}`;if(life!==cameraLife){cameraLife=life;started=false;sideYaw=0;selectedSideYaw=0;sideHeight=3;recovery=0;sideSettling=false;}
        const model=models.get(followed?.id),launch=followed?.id===S.you&&predicted?predicted.flight:followed?.flight;
        if(model){
          cameraSolidAnchor.copy(model.position);
          nose.set(0,0,1).applyQuaternion(model.quaternion);nose.y=0;if(nose.lengthSq()<.05)nose.set(0,0,1);nose.normalize();
          target.copy(model.position).addScaledVector(nose,4);target.y+=1.4;
          // A look-ahead beyond a wall would cast clearance from its far side.
          desired.copy(model.position);desired.y+=1.4;clearCamera(target,desired);
          desired.copy(model.position).addScaledVector(nose,-8.5);desired.y+=4.4;let cramped=clearCamera(desired,target);
          // A head-height look target can sit in a portal frame even when
          // the chassis is clear. Sweep feature shells from the chassis.
          cramped=cameraCollision.constrain(desired,cameraSolidAnchor)||cramped;
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
              sideHeight=3;
              // Smallest clear departure; keep the selected side while valid.
              for(let pass=0;pass<(preferred?2:1)&&!valid;pass++)for(let index=0;index<sideAngles.length;index++){
                // A reversing approach needs the clear side before eye clearance
                // collapses; slow stationary/forward cases keep minimal yaw.
                const yaw=sideAngles[returning?sideAngles.length-1-index:index];
                if(preferred&&(pass===0?Math.sign(yaw)!==preferred:Math.sign(yaw)===preferred))continue;
                if(trySideCamera(yaw,data)){sideYaw=selectedSideYaw=yaw;valid=true;break;}
              }
              // A steep launch tube can close every ordinary side orbit.
              // Look through its open rear at entry, or ahead of the muzzle,
              // rather than allowing clearance to put the eye inside the kart.
              if(!valid&&launch)for(const height of launchHeights){
                sideHeight=height;
                for(const yaw of launchAngles)if(trySideCamera(yaw,data)){sideYaw=selectedSideYaw=yaw;valid=true;break;}
                if(valid)break;
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
          cramped=cameraCollision.constrain(cameraPosition,model.position)||cramped;
          const recoverySnap=!!launch&&sideMode&&cameraPosition.distanceToSquared(model.position)<36&&desired.distanceToSquared(model.position)>36;
          if(recoverySnap){cameraPosition.copy(desired);cameraTarget.copy(target);}
          camera.position.copy(cameraPosition);
          const shake=hitFx?.shake();if(shake&&(shake.x||shake.y)){camera.position.x+=shake.x;camera.position.y+=shake.y;cramped=clearCamera(camera.position,cameraTarget)||cramped;}
          if(cameraKick>0&&!helper.reducedMotion()){
            camera.position.x+=Math.sin(time*95)*cameraKick;camera.position.y+=Math.cos(time*77)*cameraKick*.65;
            cameraKick=Math.max(0,cameraKick-dt*.55);cramped=clearCamera(camera.position,cameraTarget)||cramped;
            cramped=clearCamera(camera.position,cameraAnchor)||cramped;
          }
          // A ray protects only the eye's centre. Sweep the near-plane volume
          // too, after all easing, recovery or shake, from the clear chassis.
          // The eased eye was already swept from all three anchors above.
          // Only recovery, shake or an obstruction can change that result.
          const recheckEye=cramped||recoverySnap||!camera.position.equals(cameraPosition);
          if(recheckEye)cramped=cameraCollision.constrain(camera.position,model.position)||cramped;
          const finalRear=-direction.subVectors(camera.position,model.position).dot(nose);
          const lookAhead=cramped&&!sideMode?Math.max(0,Math.min(1,(finalRear-CONFIG.chassis.half.z)/(8.5-CONFIG.chassis.half.z))):1;
          target.copy(cameraTarget).lerp(cameraAnchor,1-lookAhead);
          if(recheckEye){
            clearCamera(camera.position,target);clearCamera(camera.position,cameraAnchor);
            cameraCollision.constrain(camera.position,model.position);
          }
          camera.lookAt(target);healthBars.face(camera);
        }
        {const own=self(),ownModel=own?.alive&&S.youDrive?models.get(own.id):null;threats.update(itemsFresh&&S.phase==='live'?S:null,S.you,ownModel?.position,camera);}
        objectives.update(S,models,camera,time,helper.reducedMotion());
        skids.update(dt);
        world.updateDetail(camera,dt);
        const k=self();
        const lateral=model&&k?.pose.linearVelocity?Math.abs(direction.copy(k.pose.linearVelocity).dot(nose.set(1,0,0).applyQuaternion(model.quaternion))):0;
        updateAudio(!!k?.pose.grounded&&Math.abs(k.pose.speed)>4&&lateral>1.4);clock();
      },dispose(){warmup?.cancel();if(rendererWarmup===warmup)rendererWarmup=null;cameraCollision.dispose();garageThumbnail?.dispose();objectives.dispose();kartLod.dispose();pickups.dispose();shadows.dispose();scenePrediction?.dispose();if(prediction===scenePrediction){prediction=null;predicted=null;}arena.dispose();drivingFX.dispose();world.dispose();art.dispose();healthBars.dispose();impactFX.dispose();arsenalFX.dispose();skids.dispose();threats.dispose();for(const f of effects)f.mesh.dispose();for(const cue of confirmedShots){cue.object.visible=false;cue.object.removeFromParent();}confirmedShots.length=0;confirmedPools.clear();closeKartAssetBitmaps(library);models.clear();objects.clear();rigs.clear();}};
    }catch(error){warmup?.cancel();if(rendererWarmup===warmup)rendererWarmup=null;cameraCollision?.dispose();garageThumbnail?.dispose();objectives?.dispose();kartLod?.dispose();pickups?.dispose();shadows?.dispose();scenePrediction?.dispose();if(prediction===scenePrediction){prediction=null;predicted=null;}arena?.dispose();drivingFX?.dispose();world?.dispose();art?.dispose();healthBars?.dispose();impactFX?.dispose();arsenalFX?.dispose();skids?.dispose();threats?.dispose();helper.disposeObject(scene);closeKartAssetBitmaps(library);throw error;}
  }
  function graphicsFailure(){
    rendererWarmup?.cancel();
    graphicsFailed=true;gfxReady=false;stop();clock();newEvents.length=0;setKartFlag($('loading'),'hidden',false);$('loading').replaceChildren();const text=document.createElement('p');text.textContent='The 3D arena could not load. Retry or return to the room.';const retry=document.createElement('button');retry.textContent='Retry 3D';retry.setAttribute('data-watchok','');retry.onclick=()=>{if(pending)return;retry.disabled=true;gl?.dispose();gl=null;prediction?.dispose();prediction=null;predicted=null;graphicsFailed=false;loadScene();};$('loading').append(text,retry);
    if(api.context?.().isHost){const back=document.createElement('button');back.textContent='Back to room';back.onclick=()=>api.lobby();$('loading').append(back);}
  }
  async function loadScene(){
    if(pending||gl||!S||graphicsFailed)return;pending=true;const gen=generation;
    const handle=await createThreeView($('stage'),{signal:api?.signal,diagnostics:api?.diagnostics,build:(THREE,helper)=>scene(THREE,helper,gen),onContextLost:graphicsFailure});
    if(gen!==generation){if(!handle.fallback)handle.dispose();return;}
    pending=false;if(handle.fallback){graphicsFailure();return;}gl=handle;handle.canvas.setAttribute('data-game-focus','');gfxReady=true;itemKey='';setKartFlag($('loading'),'hidden',true);paint();clock();if(S.youDrive&&!blocked())handle.canvas.focus({preventScroll:true});
  }
  // Same scene-owned, batched animals and garage paint as the classic view.
  // The host sends resolved colours; raw saved looks are also accepted.
  function kartLookFor(pid,index){let look=null;try{const looks=api?.context?.()?.looks;look=looks&&Object.hasOwn(looks,pid)?looks[pid]:null;}catch{}const clean=cleanKartLook(look);return{driver:clean?.driver??pid,color:Number.isInteger(look?.color)&&look.color>=0&&look.color<=0xffffff?look.color:kartPaintHex(clean?.paint)??(pid===S.you?colors[0]:colors[(index+1)%colors.length])};}
  function mount(el,platform){
    dispose();root=document.createElement('section');root.className='pke';root.setAttribute('aria-label','Pocket Karts');el.append(root);api=platform;
    const style=document.createElement('link');style.rel='stylesheet';style.href='/css/kart-elevated.css';style.dataset.elevatedKart='';document.head.append(style);listeners.push([style,'owned-style',null]);
    root.innerHTML=`<div data-stage class="pke-stage"></div><div data-loading class="pke-loading" role="status">Loading arena…</div>
      <div class="pke-top"><details data-menu class="pke-menu"><summary aria-label="Game menu">☰</summary><div class="pke-panel"><h2 data-arena></h2><p data-goal>Most knockouts wins.</p>${controlsPickerHtml('pke-controls',preference,'data-controls')}<p>WASD / arrows · drive<br>Space · weapon &nbsp; N · Nitro<br>Shift · hold in a turn to drift; release coloured sparks for turbo<br>Bright cannons climb; paired rings cross levels</p><button data-resume>Resume</button></div></details><span class="pke-score" data-score>0 KOs</span><time data-clock>Loading</time><span data-protection class="pke-protection" title="Spawn protection">${svg(PROTECTION)}</span></div>
      <div data-health class="pke-health kart-hp" role="img" aria-label="100 of 100 HP"></div>
      <p data-notice class="pke-notice" role="status" hidden></p><div class="pke-bottom"><div data-weapon class="kart-item" role="group" aria-label="Weapon"></div><div class="pke-instruments"><span class="pke-speed"><b data-speed>0</b><small>km/h</small><i data-gear class="kart-gear" role="img" aria-label="Gear 1">1</i></span><span data-charge class="pke-charge" role="img" aria-label="Nitro charge">${NITRO}</span></div><span data-drift class="pke-drift" role="status" hidden></span></div>
      <div data-touch class="pke-touch" hidden><div data-stick class="pke-stick" role="group" aria-label="Drive stick"><span></span></div><div class="pke-actions"><button data-gas aria-label="Hold to accelerate">${svg('<path d="m10 21 6-11 6 11" stroke="#f3f9ff" stroke-width="3"/>')}</button><button data-reverse aria-label="Hold to reverse">${svg('<path d="m10 11 6 11 6-11" stroke="#f3f9ff" stroke-width="3"/>')}</button><button data-brake aria-label="Hold in a turn to drift; release for turbo">${DRIFT}</button><button data-nitro aria-label="Hold for Nitro">${NITRO}</button><button data-use aria-label="Use weapon"><span data-use-icon>${TARGET}</span><b data-use-ammo hidden></b><span data-use-label class="kart-fire-label" aria-hidden="true">Fire</span></button></div></div>
      <section data-objective class="kart-objective-hud" aria-label="Team objective" aria-live="polite" hidden></section>
      <aside data-result class="pke-result pk-final" role="status" hidden></aside>`;
    for(const node of root.querySelectorAll('*'))for(const attr of node.attributes)if(attr.name.startsWith('data-'))nodes.set(attr.name.slice(5),node);
    hitFx=createKartHitFeedback(root,{reducedMotion:()=>matchMedia?.('(prefers-reduced-motion: reduce)').matches===true});
    // The platform already owns the Room launcher. Put game controls in
    // that drawer instead of drawing a second menu on top of it.
    const roomMenu=document.getElementById('roomMenu'),roomPanel=roomMenu?.querySelector('.room-menu-panel');
    if(roomPanel){const panel=$('menu').querySelector('.pke-panel');panel.classList.add('pke-room-settings');roomPanel.append(panel);listeners.push([panel,'owned-panel',null]);setKartFlag($('menu'),'hidden',true);setKartFlag($('resume'),'hidden',true);root.classList.add('pke-has-room');on(roomMenu,'toggle',()=>{stop();paint();if(!roomMenu.open&&active()&&roomMenu.contains(document.activeElement))gl?.canvas.focus({preventScroll:true});});}
    on($('result'),'click',event=>{
      const button=event.target?.closest?.('[data-upgrade]'),category=button?.getAttribute('data-upgrade');
      if(button&&!button.disabled&&!garagePending&&S?.phase==='done'&&S.youDrive&&['engine','handling','reload'].includes(category)){
        garagePending=globalThis.crypto?.randomUUID?.()||`garage-${Date.now()}`;
        api.send({garage:{category,nonce:garagePending}});standingsKey='';paint();
      }
      if(arenaPicker.choose(event,S,api)){standingsKey='';paint();}
    });
    wirePickers($('controls').parentNode);
    try{preference=localStorage.getItem('pk-controls-v1')||'auto';}catch{preference='auto';}if(!['auto','keyboard','touch'].includes(preference))preference='auto';
    audio=createKartAudio({muted:api.context?.().sound===false});
    startAudio=()=>{audio?.prep?.();shellAudioReady=api.audioPrepare?.();Promise.allSettled([audio?.ready?.(),shellAudioReady]);startAudio=null;};
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
    const was=S;
    // Equal simulation ticks may carry real metadata/ACK/End transitions.
    // Only strictly older same-instance authority is rejected.
    if(was?.instanceId!=null&&was.instanceId===snapshot.instanceId&&was.phase==='done'&&snapshot.phase!=='done')return;
    if(was&&was.instanceId===snapshot.instanceId&&(
      Number.isFinite(was.simTick)&&Number.isFinite(snapshot.simTick)&&snapshot.simTick<was.simTick||
      Number.isFinite(was.simAt)&&Number.isFinite(snapshot.simAt)&&snapshot.simAt<was.simAt))return;
    const arrival=performance.now(),advanced=!was||was.instanceId!==snapshot.instanceId||was.simTick!==snapshot.simTick||was.simAt!==snapshot.simAt;
    const gap=was&&Number.isFinite(snapshot.simAt)&&Number.isFinite(was.simAt)&&snapshot.simAt-was.simAt>1000;
    if(advanced||snapshot.audioBaseline){
      if(was?.instanceId!==snapshot.instanceId||was?.phase!==snapshot.phase||was?.preparing!==snapshot.preparing)snapshotOffset=null;
      if(Number.isFinite(snapshot.simAt)){
        const offset=arrival-snapshot.simAt;snapshotOffset=snapshotOffset===null?offset:Math.min(snapshotOffset,offset);
        lastSnapshotArrival=Math.min(arrival,snapshot.simAt+snapshotOffset);
      }else lastSnapshotArrival=arrival;
    }
    const key=`${snapshot.instanceId}:${snapshot.inputAck?.life}:${snapshot.inputAck?.controlEpoch}`;
    if(key!==epoch){localFires.length=0;localUseHeld=false;stop(false);feedbackEpoch++;newEvents.length=0;epoch=key;sequence=snapshot.inputAck?.receivedSeq||0;timeline.reset();}
    S=snapshot;if(!S.preparing)startAudio?.();prediction?.ingest(S,arrival,now());pickupPrediction.sync(S.instanceId,S.inputAck?.life);if(S.audioBaseline||gap||S.phase==='done'){localFires.length=0;localUseHeld=false;pickupPrediction.reset();}if(S.audioBaseline||gap){firstEvents=true;newEvents.length=0;timeline.reset();feedbackEpoch++;}timeline.ingest(S,arrival);sequence=Math.max(sequence,S.inputAck?.receivedSeq||0);updateAudio();
    if(was?.instanceId!==S.instanceId){seen.clear();newEvents.length=0;firstEvents=true;feedbackEpoch++;}
    for(const e of S.events||[]){
      if(seen.has(e.id))continue;
      seen.add(e.id);
      if(firstEvents||!gfxReady)continue;
      if(S.phase==='done'&&was?.phase==='done')continue;
      const predictedPickup=e.type==='pickup'&&e.pid===S.you&&pickupPrediction.accept(e.crateId);
      while(localFires.length&&arrival-localFires[0].at>800)localFires.shift();
      const localIndex=e.type==='fire'&&e.pid===S.you?localFires.findIndex(f=>f.weapon===e.weapon):-1;
      if(localIndex>=0){localFires.splice(localIndex,1);if(e.weapon!=='machinegun')continue;}
      const eventAge=Number.isFinite(e.tick)&&Number.isFinite(S.simTick)?Math.max(0,S.simTick-e.tick)*CONFIG.fixedDt*1000:0;
      newEvents.push({event:e,at:(lastSnapshotArrival??arrival)-eventAge});if(newEvents.length>32)newEvents.shift();
      if(localIndex>=0)continue; // The press already played its sound.
      const pose=(self()||S.karts[0])?.pose;
      if(!e.position||!pose)continue;
      const dx=e.position.x-pose.position.x,dy=e.position.y-pose.position.y,dz=e.position.z-pose.position.z;
      const distance=Math.hypot(dx,dy,dz);
      if(distance>=50)continue;
      const rotation=pose.rotation,rightX=1-2*(rotation.y*rotation.y+rotation.z*rotation.z),rightZ=2*(rotation.x*rotation.z-rotation.w*rotation.y);
      if(e.type==='hit'&&e.pid===S.you&&e.weapon==='ram')audio?.cue('hitDing');
      if(['launch','land','warp'].includes(e.type)){audio?.arenaCue?.(e.type,{gain:Math.max(0,1-distance/50)});continue;}
      const cue=kartEventCue(e,S.you);if(!cue||predictedPickup)continue;
      audio?.cue(cue,{strength:e.impulse?Math.min(1,e.impulse/1000):1,
        gain:Math.pow(Math.max(0,1-Math.max(0,distance-8)/42),2),
        pan:distance>2?Math.max(-.85,Math.min(.85,(dx*rightX+dz*rightZ)/distance)):0});
    }
    while(seen.size>64)seen.delete(seen.values().next().value);firstEvents=false;
    paint();clock();if(!pending&&!gl&&!graphicsFailed)sceneReady=loadScene();
    if(S.phase==='done'&&was?.phase!=='done'&&was?.instanceId===S.instanceId){clearTimeout(resultsTimer);resultsTimer=setTimeout(()=>{if(S?.instanceId===snapshot.instanceId&&S.phase==='done')api.resultsReady?.(S.instanceId);},900);}
  }
  function dispose(){
    arenaPicker.reset();garageUI.dispose();garagePending=null;resultAnnouncementKey='';stop(false);generation++;rendererWarmup?.cancel();rendererWarmup=null;clearInterval(timer);clearTimeout(resultsTimer);timer=resultsTimer=0;stick?.dispose();stick=null;audio?.dispose();audio=null;startAudio=null;gl?.dispose();gl=null;prediction?.dispose();prediction=null;predicted=null;
    for(const[target,type,fn,opts]of listeners.splice(0)){if(type==='owned-style'||type==='owned-panel')target.remove();else target.removeEventListener(type,fn,opts);}
    hitFx?.dispose();hitFx=null;root?.remove();root=null;S=null;api=null;epoch='';pending=gfxReady=graphicsFailed=false;timeline.reset();newEvents.length=0;seen.clear();nodes.clear();firstEvents=true;sequence=0;itemKey=standingsKey='';audioDrifting=false;lastSnapshotArrival=null;snapshotOffset=null;
  }
  return {ownsTimer:true,ownsInputs:true,styles:['/css/kart-elevated.css'],mount,update,dispose,
    async ready(){await sceneReady;if(!gfxReady)throw new Error('The 3D arena could not load');gl.renderOnce?.();await gl.firstFrame;}};
}

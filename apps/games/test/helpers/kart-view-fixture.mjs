import {waitKartPreparation} from '../../public/js/engines/kart-warmup-scheduler.mjs';
import {createKartLod} from '../../public/js/engines/kart-lod.mjs';
import {createRaisedPoseSupport} from '../../public/js/engines/kart-raised-support.mjs';
import {createRaisedPickups} from '../../public/js/engines/kart-raised-pickups.mjs';
import {createRaisedCameraQuery} from '../../public/js/engines/kart-raised-camera.mjs';
import {createRaisedShadows,disableRaisedStaticShadows} from '../../public/js/engines/kart-raised-shadows.mjs';
import {kartLightTier} from '../../public/js/engines/kart-festive-lights.mjs';
import {createKartDrivingFX} from '../../public/js/engines/kart-driving-fx.mjs';
import {createKartArenaFeatures} from '../../public/js/engines/kart-arena-features-art.mjs';
import {surfaceProfile} from '../../public/js/engines/kart-surface.mjs';
import {driftTier,DRIFT_TIERS} from '../../public/js/engines/kart-drift.mjs';
import {cleanKartLook,kartPaintHex} from '../../public/js/engines/kart-looks.mjs';
import {WEAPON_IDS as combatWeaponIds} from '../../public/js/engines/kart-weapon-contract.mjs';
import {paintKartWeapon,createKartWeaponRoulette} from '../../public/js/engines/kart-weapon-hud.mjs';
import {kartResultView} from '../../public/js/engines/kart-results.mjs';
import {createKartImpactFX} from '../../public/js/engines/kart-impact-fx.mjs';
import {createArsenalFX} from '../../public/js/engines/kart-arsenal-fx.mjs';
import {createKartWarmupLibrary,warmKartRenderer} from '../../public/js/engines/kart-render-warmup.mjs';
import {createKartCameraCollision} from '../../public/js/engines/kart-camera-collision.mjs';
import {arenaFeatureSolids,elevatedStatics} from '../../public/js/engines/kart-feature-solids.mjs';
import {flightPose} from '../../public/js/engines/kart-map-features.mjs';
import {MeshoptDecoder} from '../../public/vendor/three/libs/meshopt_decoder.mjs';
await MeshoptDecoder.ready;
// Execute actual production view/dispatcher source with a finite DOM/timer and
// graphics-loader double. This proves lifecycle/input contracts, not WebGL art.
// Native acceptance separately runs the real app/server/renderer in an iframe.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {mergeGeometries as mergeFixtureGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {batchKartBody as batchFixtureKart} from '../../public/js/engines/kart-batching.mjs';
import {createKartModel,animateKartModel,createCrateModel} from '../../public/js/engines/kart-model.mjs';
import {createKartCombatArt,projectileContactInset} from '../../public/js/engines/kart-combat-art.mjs';
import {createKartHealthBars} from '../../public/js/engines/kart-health-bars.mjs';
import {loadKartWeaponThumbnails,weaponThumbnailArt,loadKartDrivers,buildKartDriverVariants} from '../../public/js/engines/kart-assets.mjs';
globalThis.Image=class{async decode(){const data=fs.readFileSync(new URL('../../public'+this.src,import.meta.url));if(this.src.endsWith('.svg'))assert.match(data.toString(),/<svg/);else assert.equal(data.subarray(0,8).toString('hex'),'89504e470d0a1a0a');}};
import {elevatedSolidGeometry} from '../../public/js/engines/kart-elevated-world.mjs';
import {elevatedMap,elevatedMapIds} from '../../public/js/engines/kart-elevated-maps.mjs';
import {initializePhysics,RAPIER,ADAPTER as PHYSICS} from '../kart-elevation-physics.mjs';
import CONFIG from '../../public/js/engines/kart-physics-config.mjs';
import {fileURLToPath} from 'node:url';
import {blendElevatedPose,nextElevatedInput,createElevatedTimeline} from '../../public/js/engines/kart-elevated-pose.mjs';
import {touchControlsFor} from '../../public/js/toolkit/input-capabilities.mjs';
import COMBAT from '../../games/engines/kart-elevated-combat.js';
import ELEVATED_ADAPTER from '../../games/engines/kart-elevated-adapter.js';
import {CUE_NAMES,ASSET_MAP,SYNTH_CUE_NAMES} from '../../public/js/engines/kart-audio.mjs';
import {createGearbox,paintGear} from '../../public/js/engines/kart-gearbox.mjs';
const repo=fileURLToPath(new URL('../..',import.meta.url));
const results=[];const check=(name,value)=>{assert.ok(value,name);results.push(name);};
class Node {
  constructor(tag,doc,attrs={}){this.tagName=tag.toUpperCase();this.doc=doc;this.attrs={...attrs};this.children=[];this.parentNode=null;this.events=new Map();this.dataset={};this.style={setProperty:(k,v)=>{this.style[k]=String(v);}};this.classList={contains:x=>(this.className||'').split(/\s+/).includes(x),add:(...xs)=>{this.className=[...new Set([...(this.className||'').split(/\s+/).filter(Boolean),...xs])].join(' ')},toggle:(x,v)=>{const on=v??!this.classList.contains(x);this.className=(this.className||'').split(/\s+/).filter(c=>c&&c!==x).concat(on?[x]:[]).join(' ');return on;}};}
  get firstElementChild(){return this.children[0]||null;}
  get childElementCount(){return this.children.length;}
  get attributes(){return Object.entries(this.attrs).map(([name,value])=>({name,value}));}
  get className(){return this.attrs.class||'';}set className(v){this.attrs.class=v;}
  get hidden(){return 'hidden'in this.attrs;}set hidden(v){if(v)this.attrs.hidden='';else delete this.attrs.hidden;}
  get disabled(){return 'disabled'in this.attrs;}set disabled(v){if(v)this.attrs.disabled='';else delete this.attrs.disabled;}
  get textContent(){return(this.text||'')+this.children.map(n=>n.textContent).join('');}set textContent(v){this.text=String(v);this.replaceChildren();}
  append(...nodes){for(const n of nodes){n.remove();n.parentNode=this;this.children.push(n);}}
  remove(){if(this.parentNode){this.parentNode.children=this.parentNode.children.filter(n=>n!==this);this.parentNode=null;}}
  replaceChildren(...nodes){for(const c of this.children)c.parentNode=null;this.children=[];this.append(...nodes);}
  contains(n){for(let p=n;p;p=p.parentNode)if(p===this)return true;return false;}
  matches(sel){if(sel==='*')return true;const tag=sel.match(/^[\w-]+/);if(tag&&this.tagName!==tag[0].toUpperCase())return false;for(const m of sel.matchAll(/\.([\w-]+)/g))if(!this.classList.contains(m[1]))return false;const id=sel.match(/#([\w-]+)/);if(id&&this.attrs.id!==id[1])return false;for(const m of sel.matchAll(/\[([\w-]+)(?:="([^\"]*)")?\]/g))if(!(m[1]in this.attrs)||m[2]!==undefined&&this.attrs[m[1]]!==m[2])return false;return true;}
  querySelectorAll(sel){const out=[];const walk=n=>{for(const c of n.children){if(c.matches(sel))out.push(c);walk(c);}};walk(this);return out;}
  querySelector(sel){return this.querySelectorAll(sel)[0]||null;}
  get innerHTML(){return this.html||'';}set innerHTML(html){this.replaceChildren();this.html=html;this.text='';const stack=[this],re=/<(\/?)([\w-]+)([^>]*)>|([^<]+)/g;let m;while((m=re.exec(html))){if(m[4]){stack.at(-1).text=(stack.at(-1).text||'')+m[4];continue;}const[,closing,tag,raw]=m;if(closing){while(stack.length>1)if(stack.pop().tagName===tag.toUpperCase())break;continue;}const attrs={};for(const a of raw.matchAll(/([:\w-]+)(?:="([^\"]*)"|'([^']*)'|([^\s/]+))?/g))attrs[a[1]]=a[2]??a[3]??a[4]??'';const n=new Node(tag,this.doc,attrs);stack.at(-1).append(n);if(!raw.endsWith('/')&&!['link','input','br','img'].includes(tag))stack.push(n);}}
  animate(frames,options){(this.animations ||= []).push({frames,options});return{cancel(){}};}
  setAttribute(k,v){this.attrs[k]=String(v);}getAttribute(k){return this.attrs[k]??null;}removeAttribute(k){delete this.attrs[k];}
  setPointerCapture(id){this.capture=id;}
  hasPointerCapture(id){return this.capture===id;}
  releasePointerCapture(id){if(this.capture===id)this.capture=null;}
  addEventListener(type,fn){if(!this.events.has(type))this.events.set(type,new Set());this.events.get(type).add(fn);}
  removeEventListener(type,fn){this.events.get(type)?.delete(fn);}
  dispatch(type,extra={}){const e={type,target:this,preventDefault(){this.prevented=true},...extra};for(const fn of [...(this.events.get(type)||[])])fn(e);if(type==='click')this.onclick?.(e);return e;}
  focus(){this.doc.activeElement=this;}
}
const base=()=>({projectileRadii:COMBAT.staticSweepRadii,instanceId:'one',profile:'elevated-combat-v1',mapId:'garden',mapRevision:elevatedMap('garden').revision,map:{label:'Alpine Courtyard'},simTick:1,simAt:50,endsAt:30000,phase:'live',you:'a',youDrive:true,inputAck:{life:1,controlEpoch:1,receivedSeq:0,appliedInputSeq:0},events:[],crates:[],projectiles:[],mines:[],grenades:[],karts:[{id:'a',alive:true,connected:true,spawnSeq:1,controlEpoch:1,hits:0,deaths:0,nitro:1,weapon:null,ammo:0,shield:0,pose:{position:{x:0,y:.64,z:0},rotation:{x:0,y:0,z:0,w:1},speed:0}},{id:'b',alive:true,connected:true,hits:0,deaths:0,pose:{position:{x:10,y:.64,z:0},rotation:{x:0,y:0,z:0,w:1},speed:0}}]});
function rig({room=true,touch=false,graphics=false,colliders=[],aspect=1,thumbnailsReady=true,batched=false,missingDrivers=[],audioPrepare,warmupBudget=Infinity}={}){
  const document=new Node('document');document.doc=document;document.createElement=tag=>new Node(tag,document);document.head=new Node('head',document);document.body=new Node('body',document);document.append(document.head,document.body);document.activeElement=document.body;document.getElementById=id=>document.querySelector('#'+id);
  const el=new Node('main',document);document.body.append(el);
  let roomMenu;if(room){roomMenu=new Node('details',document,{id:'roomMenu'});roomMenu.append(new Node('div',document,{class:'room-menu-panel'}));document.body.append(roomMenu);}
  const window=new Node('window',document);window.screen={orientation:new Node('orientation',document)};
  const assetRequests=[],sent=[],ready=[],loads=[],audios=[],sticks=[],timers=new Map(),storage=new Map();let clock=1000,seq=0,host=true;
  const api={audioPrepare,send:a=>sent.push(structuredClone(a)),name:id=>id==='a'?'Anika':'Bastian',now:()=>clock,context:()=>({isHost:host,sound:false}),resultsReady:i=>ready.push(i),lobby(){}};
  const schedule=(fn,ms,repeat=false)=>{const id=++seq;timers.set(id,{fn,ms,at:clock+ms,repeat});return id;};
  let instanceAllocations=0,projectileAllocations=0,graphicsAllocations=0,prepared=false,reduced=false;
  const renderStats={warmFrames:0,compiles:0,warmObjects:new Set()},projectiles=[];
  const ThreeTest={...THREE,InstancedMesh:class extends THREE.InstancedMesh{constructor(...args){super(...args);instanceAllocations++;}}};
  for(const name of ['Group','Mesh','Vector3','Quaternion','Box3','BoxGeometry','ConeGeometry','MeshBasicMaterial'])ThreeTest[name]=class extends THREE[name]{constructor(...args){super(...args);graphicsAllocations++;}};
  class LocalLoader{setMeshoptDecoder(){return this;}async loadAsync(url){assetRequests.push(url);if(missingDrivers.some(id=>url.endsWith('/drivers/'+id+'.glb')))throw Error('optional driver unavailable');const b=fs.readFileSync(repo+'/public'+url.split('?')[0]);return new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'').catch(error=>{console.error('GLB fixture failed',url,error.message);throw error;});}}
  const context=vm.createContext({createKartDrivingFX,createKartArenaFeatures,surfaceProfile,driftTier,DRIFT_TIERS,loadElevatedPhysics:async()=>null,createElevatedPrediction(){throw Error('Prediction separately tested with real Rapier');},WEAPON_IDS:combatWeaponIds,document,window,LocalLoader,MeshoptDecoder,cleanKartLook,kartPaintHex,loadKartDrivers,buildKartDriverVariants,createGearbox,paintGear,projectileContactInset,createKartModel,animateKartModel,createCrateModel,CONFIG,
    mergeFixtureGeometries,arenaFeatureSolids,createKartCameraCollision,createKartWarmupLibrary,waitKartPreparation,warmKartRenderer:(T,r,s,c,o)=>warmKartRenderer(T,r,s,c,{...o,budgetMs:warmupBudget,yieldTask:async()=>{}}),createKartHealthBars,createKartImpactFX,createArsenalFX,paintKartWeapon,createKartWeaponRoulette,kartResultView,batchKartBody:batched?batchFixtureKart:()=>{},closeKartAssetBitmaps(){},loadKartWeaponThumbnails,weaponThumbnailArt:(kind,fallback)=>thumbnailsReady?weaponThumbnailArt(kind,fallback):fallback,elevatedMap:id=>({id,revision:elevatedMap(id).revision,features:elevatedMap(id).features}),
    createKartLod,createRaisedPoseSupport,createRaisedPickups,createRaisedCameraQuery,createRaisedShadows,disableRaisedStaticShadows,kartLightTier,
    createKartElevatedWorld:()=>{const meshes=new Map();for(const d of colliders){const body=new THREE.Mesh(elevatedSolidGeometry(THREE,d),new THREE.MeshBasicMaterial());body.position.copy(d.position);if(d.rotation)body.quaternion.copy(d.rotation);body.updateMatrixWorld();meshes.set(d.id,{body,descriptor:d});}return {colliderMeshes:meshes,lighting:{fogColor:new THREE.Color(0xaaaaaa),fogNear:100,fogFar:500,exposure:1},animate(){},updateDetail(){},dispose(){for(const {body}of meshes.values()){body.geometry.dispose();body.material.dispose();}}};},
    createKartCombatArt:(...args)=>{const art=createKartCombatArt(...args),projectile=art.projectile;art.projectile=(...a)=>{projectileAllocations++;const object=projectile(...a);projectiles.push(object);return object;};return art;},performance:{now:()=>clock},localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},setInterval:(f,m)=>schedule(f,m,true),clearInterval:id=>timers.delete(id),setTimeout:(f,m)=>schedule(f,m),clearTimeout:id=>timers.delete(id),blendElevatedPose,nextElevatedInput,createElevatedTimeline,touchControlsFor,readInputCapabilities:()=>({preferred:{touch}}),
    createMobileStick:(node,opts)=>{const stick={node,opts,resets:0,disposed:0,reset(){this.resets++},dispose(){this.disposed++}};sticks.push(stick);return stick;},
    createKartAudio:()=>{const a={disposed:0,cues:[],arenaCues:[],frames:[],muted:false,active:true,preps:0,prep(){this.preps++},ready(){return this.readyWait||Promise.resolve(true)},unlock(){},setMuted(value){this.muted=value},update(frame){this.frames.push(frame);this.active=frame.active},arenaCue(name,options){if(!this.muted&&this.active)this.arenaCues.push({name,options});},cue(name,options){if(!this.muted&&this.active)this.cues.push({name,options})},dispose(){this.disposed++}};audios.push(a);return a;},
    createThreeView:(stage,options)=>new Promise(resolve=>loads.push({stage,options,resolve,settled:false})),
    matchMedia:()=>({matches:reduced}),
  });
vm.runInContext(fs.readFileSync(repo+'/public/js/pickers.js','utf8').replace(/^export /gm,''),context);
  for(const file of ['kart-hearts','kart-skids','kart-threats'])vm.runInContext(fs.readFileSync(repo+'/public/js/engines/'+file+'.mjs','utf8').replace(/^export /gm,''),context);
  const file=repo+'/public/js/engines/kart-elevated-view.js';vm.runInContext(fs.readFileSync(file,'utf8').replace(/^import .*;\n/gm,'').replace("const {GLTFLoader}=await import('../../vendor/three/loaders/GLTFLoader.js');",'const GLTFLoader=LocalLoader;').replace("const {mergeGeometries}=await import('../../vendor/three/utils/BufferGeometryUtils.js');",batched?'const mergeGeometries=mergeFixtureGeometries;':'const mergeGeometries=()=>null;').replace('cramped=clearCamera(cameraPosition,cameraTarget)||cramped;', 'const preClearEye=cameraPosition.toArray();cramped=clearCamera(cameraPosition,cameraTarget)||cramped;').replace('camera.lookAt(target);','camera.userData.cameraTrace={preClearEye,sideSettling,sideMode,sideYaw};camera.lookAt(target);').replace('export function createElevatedKartView','function createElevatedKartView')+'\nglobalThis.view=createElevatedKartView();',context,{filename:file});
  const view=context.view;view.mount(el,api);
  const node=name=>el.querySelector('[data-'+name+']')||roomMenu?.querySelector('[data-'+name+']');
  const render=(snapshot=base())=>view.update(el,snapshot,api);
  const flush=async()=>{await Promise.resolve();await Promise.resolve();};
  async function settle(index=loads.length-1,fallback=false){const l=loads[index];l.settled=true;const h={fallback,canvas:new Node('canvas',document),disposals:0,dispose(){this.disposals++;this.built?.dispose();this.canvas.remove();}};if(!fallback){l.stage.append(h.canvas);if(graphics){const renderer={shadowMap:{},async compileAsync(){renderStats.compiles++;},render(scene){renderStats.warmFrames++;scene.traverseVisible(o=>renderStats.warmObjects.add(o.name));}};h.built=await l.options.build(ThreeTest,{canvas:()=>h.canvas,renderer:()=>renderer,reducedMotion:()=>reduced,track(){},disposeObject(){}});h.built.camera.aspect=aspect;h.built.camera.updateProjectionMatrix();prepared=true;}}l.handle=h;l.resolve(h);await flush();return h;}
  function advance(ms){const until=clock+ms;while(true){let next=[...timers].filter(([,t])=>t.at<=until).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;const[id,t]=next;clock=t.at;if(t.repeat)t.at+=t.ms;else timers.delete(id);t.fn();}clock=until;}
  function key(code,type='keydown',target=loads.at(-1)?.handle?.canvas){return window.dispatch(type,{code,target});}
  return{view,el,document,window,roomMenu,api,assetRequests,sent,ready,loads,audios,sticks,timers,node,render,settle,advance,key,flush,host:v=>host=v,renderStats,projectiles,thumbnails:value=>{thumbnailsReady=value;},allocations:()=>({instances:instanceAllocations,projectiles:projectileAllocations,graphics:graphicsAllocations,prepared}),frame:(dt=1/60)=>loads.at(-1).handle.built.frame(dt,clock/1000),motion:v=>reduced=v};
}

export {Node,base,rig};

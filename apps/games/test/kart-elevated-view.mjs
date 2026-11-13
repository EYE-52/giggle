import {createKartPickupPrediction} from '../public/js/engines/kart-pickup-prediction.mjs';
import {waitKartPreparation} from '../public/js/engines/kart-warmup-scheduler.mjs';
import {createKartLod} from '../public/js/engines/kart-lod.mjs';
import {createRaisedPoseSupport} from '../public/js/engines/kart-raised-support.mjs';
import {createRaisedPickups} from '../public/js/engines/kart-raised-pickups.mjs';
import {createRaisedCameraQuery} from '../public/js/engines/kart-raised-camera.mjs';
import {createRaisedShadows,disableRaisedStaticShadows} from '../public/js/engines/kart-raised-shadows.mjs';
import {kartLightTier} from '../public/js/engines/kart-festive-lights.mjs';
import {createKartDrivingFX} from '../public/js/engines/kart-driving-fx.mjs';
import {createKartArenaFeatures} from '../public/js/engines/kart-arena-features-art.mjs';
import {surfaceProfile} from '../public/js/engines/kart-surface.mjs';
import {driftTier,DRIFT_TIERS} from '../public/js/engines/kart-drift.mjs';
import {cleanKartLook,kartPaintHex} from '../public/js/engines/kart-looks.mjs';
import {WEAPON_IDS as combatWeaponIds,CURATED_MUZZLE,weaponForward} from '../public/js/engines/kart-weapon-contract.mjs';
import {paintKartWeapon,kartWeaponArt} from '../public/js/engines/kart-weapon-hud.mjs';
import {kartResultView} from '../public/js/engines/kart-results.mjs';
import {createKartImpactFX} from '../public/js/engines/kart-impact-fx.mjs';
import {createArsenalFX} from '../public/js/engines/kart-arsenal-fx.mjs';
import {createKartWarmupLibrary,warmKartRenderer} from '../public/js/engines/kart-render-warmup.mjs';
import {createKartCameraCollision} from '../public/js/engines/kart-camera-collision.mjs';
import {arenaFeatureSolids,elevatedStatics} from '../public/js/engines/kart-feature-solids.mjs';
import {flightPose} from '../public/js/engines/kart-map-features.mjs';
import {MeshoptDecoder} from '../public/vendor/three/libs/meshopt_decoder.mjs';
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
import {batchKartBody as batchFixtureKart} from '../public/js/engines/kart-batching.mjs';
import {createKartModel,animateKartModel,createCrateModel} from '../public/js/engines/kart-model.mjs';
import {createKartCombatArt,projectileContactInset} from '../public/js/engines/kart-combat-art.mjs';
import {createKartHealthBars} from '../public/js/engines/kart-health-bars.mjs';
import {loadKartWeaponThumbnails,weaponThumbnailArt,loadKartDrivers,matchKartDrivers,buildKartDriverVariants} from '../public/js/engines/kart-assets.mjs';
globalThis.Image=class{async decode(){const data=this.src.startsWith('data:')?Buffer.from(this.src.split(',')[1],'base64'):fs.readFileSync(new URL('../public'+this.src,import.meta.url));if(this.src.endsWith('.svg')||this.src.startsWith('data:image/svg+xml'))assert.match(data.toString(),/<svg/);else assert.equal(data.subarray(0,8).toString('hex'),'89504e470d0a1a0a');}};
import {elevatedSolidGeometry} from '../public/js/engines/kart-elevated-world.mjs';
import {elevatedMap,elevatedMapIds} from '../public/js/engines/kart-elevated-maps.mjs';
import {initializePhysics,RAPIER,ADAPTER as PHYSICS} from './kart-elevation-physics.mjs';
import CONFIG from '../public/js/engines/kart-physics-config.mjs';
import {fileURLToPath} from 'node:url';
import {blendElevatedPose,nextElevatedInput,createElevatedTimeline} from '../public/js/engines/kart-elevated-pose.mjs';
import {touchControlsFor} from '../public/js/toolkit/input-capabilities.mjs';
import COMBAT from '../games/engines/kart-elevated-combat.js';
import ELEVATED_ADAPTER from '../games/engines/kart-elevated-adapter.js';
import {CUE_NAMES,ASSET_MAP,SYNTH_CUE_NAMES} from '../public/js/engines/kart-audio.mjs';
import {createGearbox,paintGear} from '../public/js/engines/kart-gearbox.mjs';
const repo=fileURLToPath(new URL('..',import.meta.url));
const results=[];const check=(name,value)=>{assert.ok(value,name);results.push(name);};
import {Node,base,rig} from './helpers/kart-view-fixture.mjs';
// All maps use the same HUD; check room/practice and touch/keyboard paths.
// This exercises DOM/state, not CSS pixels (a native browser is separate).
for(const mapId of elevatedMapIds)for(const room of [true,false])for(const touch of [true,false]){
  const r=rig({room,touch}),s=base();s.mapId=mapId;s.map={label:elevatedMap(mapId).label};
  s.karts[0].pose.speed=12;s.karts[0].nitro=.6;
  const shown=node=>{for(let p=node;p;p=p.parentNode)if(p.hidden)return false;return true;};
  for(const phase of ['countdown','live']){
    r.render({...s,phase});
    check(mapId+' '+phase+' speed/nitro stay present for '+(room?'room':'practice')+'/'+(touch?'touch':'keys'),shown(r.node('speed'))&&shown(r.node('charge'))&&!r.el.firstElementChild.classList.contains('pke-done'));
    check(mapId+' speed and nitro use authoritative values',r.node('speed').textContent==='43'&&r.node('charge').style['--charge']==='0.6');
  }
  r.render({...s,karts:s.karts.map(k=>({...k,alive:false}))});
  check(mapId+' respawn keeps driving instruments visible',shown(r.node('speed'))&&shown(r.node('charge'))&&!r.el.firstElementChild.classList.contains('pke-done'));
  r.render({...s,phase:'done',result:{winners:['a']}});
  check(mapId+' only results intentionally hide the driving HUD',r.el.firstElementChild.classList.contains('pke-done'));
  r.render({...s,instanceId:'rematch'});
  check(mapId+' rematch restores the driving HUD',!r.el.firstElementChild.classList.contains('pke-done')&&shown(r.node('speed'))&&shown(r.node('charge')));
  r.view.dispose();
}
{
  const r=rig();assert.doesNotThrow(()=>r.render({...base(),instanceId:undefined}),'first legacy snapshot without an instance id is accepted safely');r.view.dispose();
}
{
  const r=rig({thumbnailsReady:false}),s=base();s.karts[0].weapon='missile';s.karts[0].ammo=3;
  r.render(s);check('equipped player uses an icon fallback while thumbnail preparation is pending',r.node('weapon').querySelector('.kart-item-art').innerHTML.includes('<svg')&&!r.node('weapon').querySelector('.kart-item-art').innerHTML.includes('<img'));
  await r.settle(0,true);r.node('loading').querySelector('button').dispatch('click');
  await loadKartWeaponThumbnails();r.thumbnails(true);await r.settle();
  check('successful retry replaces unchanged equipped HUD fallback with decoded licensed thumbnail',r.node('weapon').querySelector('.kart-item-art').innerHTML.includes('<img class="kart-weapon-thumbnail"'));
  check('successful retry updates unchanged touch action thumbnail too',r.node('use-icon').innerHTML.includes('<img class="kart-weapon-thumbnail"'));
  r.view.dispose();
}
{
  let resolveShellAudio,shellPreps=0;
  const shellAudio=new Promise(resolve=>{resolveShellAudio=resolve;});
  const r=rig({audioPrepare:()=>{shellPreps++;return shellAudio;}});r.render();check('mount owns one stylesheet, input interval, Room panel and async load',r.document.head.children.length===1&&r.timers.size===1&&r.roomMenu.querySelectorAll('.pke-room-settings').length===1&&r.loads.length===1);
  check('narrow desktop does not select touch by width',r.node('touch').hidden);
  r.render();check('duplicate snapshots share one pending graphics load',r.loads.length===1);
  const gl=await r.settle();check('successful load hides loader and focuses driver canvas',r.node('loading').hidden&&r.document.activeElement===gl.canvas);
  check('real canvas declares the driving focus target before preparation releases',gl.canvas.getAttribute('data-game-focus')==='');
  check('elevated audio graph prepares during loading',r.audios[0].preps===1);
  check('elevated loading prepares the shell audio bank once',shellPreps===1);
  let resolveAudio,audioReady=false;r.audios[0].readyWait=new Promise(resolve=>{resolveAudio=resolve;});
  const pendingReady=r.view.ready().then(()=>{audioReady=true;});await r.flush();
  check('optional audio does not hold a graphics-ready raised arena',audioReady);resolveAudio(true);await r.flush();
  check('shell audio also decodes in the background',audioReady);resolveShellAudio(true);await pendingReady;
  const deadline=new AbortController();r.api.preparationSignal=deadline.signal;r.audios[0].readyWait=new Promise(()=>{});
  const slowAudio=r.view.ready();deadline.abort();await slowAudio;
  check('elevated optional audio timeout keeps the prepared game and context',r.audios[0].preps===1&&r.node('loading').hidden);
  const shortcut=r.window.dispatch('keydown',{code:'KeyW',metaKey:true,target:gl.canvas});check('Command browser shortcut stays usable without sending kart input',!shortcut.prevented&&r.sent.length===0);
  r.key('KeyW');check('W sends full forward intent scoped to private life/epoch',r.sent.at(-1).throttle===1&&r.sent.at(-1).life===1&&r.sent.at(-1).controlEpoch===1);
  r.key('KeyD');check('D is positive driver-right steer',r.sent.at(-1).steer===1);
  r.key('ShiftLeft');check('Shift sends brake rather than invented drift',r.sent.at(-1).brake===1);
  r.key('KeyN');check('Nitro is independent of braking and driving',r.sent.at(-1).nitro&&r.sent.at(-1).throttle===1);
  r.key('Space');check('Space sends use intent',r.sent.at(-1).use);
  r.key('Space','keyup');check('Space release clears use without clearing driving',!r.sent.at(-1).use&&r.sent.at(-1).throttle===1);
  const before=r.sent.length;r.advance(1000);check('steady held input has bounded keepalive and monotonic ACK sequence',r.sent.length-before>=3&&r.sent.length-before<=4&&r.sent.every((m,i)=>!i||m.seq>r.sent[i-1].seq));
  r.roomMenu.open=true;r.roomMenu.dispatch('toggle');check('opening Room immediately sends neutral intent',r.sent.at(-1).throttle===0&&r.sent.at(-1).steer===0&&!r.sent.at(-1).nitro);
  r.key('KeyW');r.advance(320);check('Room blocks drive despite previously held keyboard input',r.sent.at(-1).throttle===0);
  const roomSummary=new Node('summary',r.document);r.roomMenu.append(roomSummary);roomSummary.focus();
  r.roomMenu.open=false;r.roomMenu.dispatch('toggle');check('closing platform Room restores driver canvas focus',r.document.activeElement===gl.canvas);
  const stopped=r.sent.length;
  for(const code of ['KeyW','ArrowUp','Space'])check(code+' repeat still prevents default after Room closes',r.window.dispatch('keydown',{code,repeat:true,target:gl.canvas}).prevented);
  check('OS repeats after closing Room never add back movement or weapon intent',r.sent.length===stopped);
  r.key('KeyW');check('new deliberate input drives after closing Room',r.sent.at(-1).throttle===1);
  const context=r.api.context;r.api.context=()=>({...context(),roomActionPending:true});r.document.dispatch('game-screenchange');r.key('KeyW');r.advance(320);
  check('pending room transition blocks fresh driving after input neutralization',r.sent.at(-1).throttle===0);
  r.api.context=context;r.advance(320);check('acknowledgement or timeout does not revive blocked held keys',r.sent.at(-1).throttle===0);
  r.api.context=()=>({...context(),connected:false});r.document.dispatch('game-screenchange');const offline=r.sent.length;
  r.key('KeyW');r.node('gas').dispatch('pointerdown',{pointerId:900});
  check('fresh keyboard and accelerator input is ignored while the connection is closed',r.sent.length===offline);
  r.api.context=context;r.window.dispatch('keydown',{code:'KeyW',repeat:true,target:gl.canvas});r.advance(320);check('connection recovery ignores outage input and old OS repeats even before a new epoch snapshot',r.sent.at(-1).throttle===0);
  r.key('KeyW');check('explicit fresh input resumes after pending room transition clears',r.sent.at(-1).throttle===1);
  const input=new Node('input',r.document);r.el.append(input);input.focus();const count=r.sent.length;r.key('KeyS','keydown',input);check('editing an input does not emit drive commands',r.sent.length===count);gl.canvas.focus();
  const epoch=base();epoch.inputAck={...epoch.inputAck,life:2,controlEpoch:4,receivedSeq:40};epoch.karts[0].spawnSeq=2;epoch.karts[0].controlEpoch=4;const prior=r.sent.length;r.render(epoch);
  check('same-instance life/epoch retirement emits no stale neutral packet',r.sent.length===prior);
  r.window.dispatch('keydown',{code:'KeyW',repeat:true,target:gl.canvas});
  r.advance(320);check('fresh epoch starts neutral with received ACK plus one',r.sent.at(-1).life===2&&r.sent.at(-1).controlEpoch===4&&r.sent.at(-1).seq===41&&r.sent.at(-1).throttle===0);
  r.key('KeyW');r.window.screen.orientation.dispatch('change');check('modern orientation change clears all controls',r.sent.at(-1).throttle===0);
  r.key('KeyW');r.document.dispatch('game-screenchange');check('fullscreen/game-screen transition clears all controls',r.sent.at(-1).throttle===0);
  r.key('KeyW');r.window.dispatch('blur');check('window blur sends neutral',r.sent.at(-1).throttle===0);
  r.key('KeyW');r.document.hidden=true;r.document.dispatch('visibilitychange');check('hidden document clears held input',r.sent.at(-1).throttle===0);r.document.hidden=false;
  r.node('controls').value='touch';r.node('controls').dispatch('change');check('explicit touch preference persists and shows tools independent of width',!r.node('touch').hidden);
  r.node('gas').dispatch('pointerdown',{pointerId:7});check('separate accelerator touch control sends full throttle',r.sent.at(-1).throttle===1);
  r.node('gas').dispatch('pointercancel',{pointerId:7});check('cancelled accelerator releases immediately',r.sent.at(-1).throttle===0);
  r.node('reverse').dispatch('pointerdown',{pointerId:8});check('separate reverse touch control sends reverse throttle',r.sent.at(-1).throttle===-1);
  r.node('reverse').dispatch('lostpointercapture',{pointerId:8});check('lost capture releases reverse immediately',r.sent.at(-1).throttle===0);
  r.node('brake').dispatch('pointerdown',{pointerId:9});check('touch brake starts on captured pointer',r.sent.at(-1).brake===1&&r.node('brake').capture===9);
  r.node('brake').dispatch('pointercancel',{pointerId:9});check('pointer cancel retires touch brake',r.sent.at(-1).brake===0);
  r.node('nitro').dispatch('keydown',{code:'Enter',repeat:false});check('keyboard activation of focused touch Nitro sends held intent',r.sent.at(-1).nitro);
  r.node('nitro').dispatch('blur');check('button blur releases keyboard-held Nitro',!r.sent.at(-1).nitro);
  const armed=structuredClone(epoch);armed.karts[0].weapon='missile';armed.karts[0].ammo=1;r.render(armed);check('Use touch icon and accessible label identify actual weapon',r.node('use').getAttribute('aria-label')==='Launch homing missile'&&r.node('use-icon').innerHTML===r.node('weapon').querySelector('.kart-item-art').innerHTML&&r.node('use-ammo').textContent==='1'&&!r.node('use').disabled);
  check('equipped HUD presents the authoritative remaining payload and full activation label',r.node('weapon').querySelector('.kart-item-count').textContent==='×1'&&r.node('weapon').getAttribute('aria-label')==='Homing Missile, Ready, ×1');
  armed.karts[0].firing=true;r.render(armed);
  check('accepted firing sequence remains visible and blocks a second activation',r.node('weapon').dataset.state==='firing'&&r.node('weapon').querySelector('.kart-item-count').textContent==='×1'&&r.node('weapon').getAttribute('aria-label')==='Homing Missile, Firing, ×1'&&r.node('use').disabled&&r.node('use').getAttribute('aria-label')==='Weapon firing');
  armed.karts[0].weapon='mine';armed.karts[0].ammo=2;r.render(armed);
  check('sequential mine deployment announces its remaining trail',r.node('weapon').getAttribute('aria-label')==='Trail Mines, Deploying, ×2'&&r.node('use-ammo').textContent==='2'&&r.node('use').disabled);
  const n=r.sent.length;r.sticks[0].opts.onChange({x:0,y:-1});for(let i=0;i<100;i++)r.sticks[0].opts.onChange({x:i/100,y:-1});check('continuous analog updates coalesce instead of emitting pointer-rate packets',r.sent.length-n===1);
  r.sticks[0].opts.onChange({x:0,y:0});check('stick release immediately sends zero axes',r.sent.at(-1).steer===0&&r.sent.at(-1).throttle===0);
  const retiring=r.sent.length;r.view.dispose();check('dispose emits no frame wrapped in another instance token',r.sent.length===retiring);
  check('dispose retires renderer/stick/audio/style/Room panel/timers/listeners',gl.disposals===1&&r.sticks[0].disposed===1&&r.audios[0].disposed===1&&r.document.head.children.length===0&&r.roomMenu.querySelectorAll('.pke-room-settings').length===0&&r.timers.size===0&&[...r.window.events.values()].every(s=>s.size===0));
  r.view.dispose();check('disposal is idempotent',gl.disposals===1);
}
{
  const r=rig();r.render();await r.settle();
  const stick=r.sticks[0];stick.opts.onChange({x:0,y:-1});const sent=r.sent.length;
  r.advance(1);stick.opts.onChange({x:.25,y:-1});
  r.advance(10);stick.opts.onChange({x:.7,y:-.6});
  check('sustained analog burst owns only one coalesced deadline',r.sent.length===sent&&[...r.timers.values()].filter(t=>!t.repeat).length===1);
  r.advance(28);check('changed analog intent obeys the 40ms packet rate limit',r.sent.length===sent);
  r.advance(1);check('latest analog intent flushes at 40ms without waiting for 80ms keepalive',r.sent.length===sent+1&&r.sent.at(-1).steer===.7&&r.sent.at(-1).throttle===.6);
  r.advance(1);stick.opts.onChange({x:-.5,y:-1});stick.opts.onChange({x:0,y:0});const released=r.sent.length;
  r.advance(39);check('immediate neutral release cancels queued steering and cannot replay it',r.sent.length===released&&r.sent.at(-1).steer===0&&r.sent.at(-1).throttle===0);
  stick.opts.onChange({x:0,y:-1});stick.opts.onChange({x:1,y:-1});r.view.dispose();r.advance(100);
  check('disposed analog deadline emits no stale drive command',r.sent.length===released+1&&r.timers.size===0);
}
{
  const r=rig();r.render();const handle=await r.settle(0,true);check('initial WebGL fallback shows manual Retry for hosts',!r.node('loading').hidden&&r.node('loading').querySelectorAll('button').length===2);
  for(let i=0;i<20;i++){r.render({...base(),simTick:i+2});r.advance(50);}check('snapshot stream never auto-retries failed graphics',r.loads.length===1);
  const retry=r.node('loading').querySelector('button');check('watcher-compatible Retry is explicitly marked',retry.getAttribute('data-watchok')==='');
  retry.dispatch('click');retry.dispatch('click');check('rapid manual Retry taps share one pending graphics load',r.loads.length===2);
  const gl=await r.settle();check('manual Retry restores one usable renderer',r.node('loading').hidden&&r.el.querySelectorAll('canvas').length===1);
  r.loads.at(-1).options.onContextLost();check('context loss blocks driving and sends neutral',r.sent.at(-1).throttle===0&&!r.node('loading').hidden);
  for(let i=0;i<10;i++)r.render(base());check('context-loss snapshots do not create a Retry loop',r.loads.length===2);
  r.node('loading').querySelector('button').dispatch('click');check('manual Retry disposes old failed renderer before loading',gl.disposals===1&&r.loads.length===3);
  r.view.dispose();const retired=await r.settle();check('late successful loader after dispose is immediately retired',retired.disposals===1&&r.el.children.length===0&&r.document.head.children.length===0);
}
{
  const r=rig();r.render();r.roomMenu.open=true;const roomButton=new Node('button',r.document);r.roomMenu.append(roomButton);roomButton.focus();await r.settle();check('async startup never steals focus from open Room',r.document.activeElement===roomButton);r.view.dispose();
  const watcher=rig();watcher.host(false);watcher.render({...base(),you:'watch',youDrive:false,inputAck:null});await watcher.settle(0,true);check('watchers see manual Retry without host lobby authority',watcher.node('loading').querySelectorAll('button').length===1);watcher.key('KeyW');watcher.advance(1000);check('watcher controls cannot emit input',watcher.sent.length===0);watcher.view.dispose();
}
{
  const r=rig();r.render();await r.settle();const done={...base(),phase:'done',result:{winners:['a']}};r.render(done);r.render(done);check('live→done presents exactly one 900ms result settlement timer',r.ready.length===0&&[...r.timers.values()].filter(t=>!t.repeat).length===1&&/ wins$/.test(r.node('result').querySelector('.pk-final-title')?.textContent||''));r.advance(899);check('result gate remains closed before visual settlement',r.ready.length===0);r.advance(1);check('settled result signals once with correct instance',r.ready.length===1&&r.ready[0]==='one');r.render(done);r.advance(2000);check('duplicate result snapshot never replays presentation',r.ready.length===1);r.view.dispose();
  const reconnect=rig();reconnect.render(done);await reconnect.settle();reconnect.advance(2000);check('first reconnect snapshot in done does not replay result animation',reconnect.ready.length===0);reconnect.view.dispose();
  const retire=rig();retire.render();await retire.settle();retire.render(done);retire.view.dispose();retire.advance(2000);check('disposed result callback cannot present old instance',retire.ready.length===0);
}
{
  const r=rig();const event=(id,type,position,extra={})=>({id,type,position,...extra});
  r.api.context=()=>({isHost:true,sound:true});
  const initial={...base(),events:[event(1,'collision',{x:1,y:.64,z:0},{impulse:900})]};
  r.render(initial);await r.settle();check('reconnecting event history is quiet',r.audios[0].cues.length===0);
  const current={...base(),simTick:2,events:[...initial.events,event(2,'collision',{x:1,y:.64,z:0},{impulse:250}),event(3,'blast',{x:30,y:.64,z:0},{weapon:'missile'}),event(4,'blast',{x:60,y:.64,z:0},{weapon:'proximity'})]};
  r.render(current);const cues=r.audios[0].cues;
  check('near contact receives strength without forced spatial spread',cues.length===2&&cues[0].name==='collision'&&cues[0].options.strength===.25&&cues[0].options.gain===1&&cues[0].options.pan===0);
  check('distant guided missile explosion attenuates and pans right',cues[1].name==='missileBlast'&&cues[1].options.gain<.3&&cues[1].options.pan===.85);
  r.render(current);check('duplicate contact history never repeats audible hits',cues.length===2);
  const turned={...base(),simTick:3,simAt:100};turned.karts[0].pose.rotation={x:0,y:1,z:0,w:0};turned.events=[event(5,'fire',{x:10,y:.64,z:0},{weapon:'missile'})];r.render(turned);
  check('audio direction follows actual chassis heading',cues.at(-1).name==='missile'&&cues.at(-1).options.pan===-.85);
  r.render({...base(),simTick:4,simAt:150,you:'watcher',youDrive:false,inputAck:null,events:[event(6,'blast',{x:8,y:.64,z:0},{weapon:'proximity'})]});
  check('watchers hear current explosions relative to followed kart',cues.at(-1).name==='bombBlast'&&cues.at(-1).options.gain===1);
  r.view.dispose();
}
{
  const r=rig();r.render();const gl=await r.settle(),gas=r.node('gas');
  const count=r.sent.length;gas.dispatch('pointerdown',{pointerId:1,pointerType:'mouse',button:2});
  check('secondary mouse contact never drives a touch button',r.sent.length===count);
  gas.setPointerCapture=()=>{throw Error('capture unavailable');};
  assert.doesNotThrow(()=>gas.dispatch('pointerdown',{pointerId:2,pointerType:'touch'}));
  check('capture failure still starts deliberate accelerator intent',r.sent.at(-1).throttle===1);
  r.window.dispatch('pointerup',{pointerId:2});
  check('outside release clears accelerator when pointer capture fails',r.sent.at(-1).throttle===0&&!gas.getAttribute('data-held'));
  gas.dispatch('pointerdown',{pointerId:3,pointerType:'touch'});gas.dispatch('pointerdown',{pointerId:4,pointerType:'touch'});
  gas.dispatch('pointerup',{pointerId:3});
  check('one released contact keeps the other contact and visual hold',r.sent.at(-1).throttle===1&&gas.getAttribute('data-held')==='');
  r.window.dispatch('pointercancel',{pointerId:4});check('outside cancel releases the remaining accelerator',r.sent.at(-1).throttle===0);
  gas.setPointerCapture=Node.prototype.setPointerCapture;gas.dispatch('pointerdown',{pointerId:5});
  r.window.dispatch('blur');check('atomic stop releases captured control pointers',!gas.hasPointerCapture(5)&&r.sent.at(-1).throttle===0);
  gl.canvas.focus();r.key('KeyW');r.node('gas').focus();r.document.dispatch('focusin');r.advance(320);
  check('moving keyboard focus away from playfield does not retain driving',r.sent.at(-1).throttle===0);
  r.view.dispose();
}
{
  const r=rig();r.api.context=()=>({isHost:true,sound:true});r.render();await r.settle();
  const collision=id=>({id,type:'collision',pid:'a',position:{x:1,y:.64,z:0},impulse:800});
  r.render({...base(),simAt:100,simTick:2,events:[collision('one')]});check('new accepted contact cues before a graphics frame',r.audios[0].cues.length===1);
  r.render({...base(),simAt:150,simTick:3,audioBaseline:true,events:[collision('one'),collision('missed')]});
  check('same-instance reconnect baseline seeds unheard event history quietly',r.audios[0].cues.length===1);
  r.render({...base(),simAt:200,simTick:4,events:[collision('missed'),collision('fresh')]});
  check('fresh contact after reconnect resumes exactly once',r.audios[0].cues.length===2);
  r.api.context=()=>({isHost:true,sound:false});r.render({...base(),simAt:250,simTick:5,events:[collision('muted')]});
  check('snapshot mute reaches event audio before the next graphics frame',r.audios[0].cues.length===2&&r.audios[0].muted);
  r.api.context=()=>({isHost:true,sound:true,connected:false});r.render({...base(),simAt:300,simTick:6,events:[collision('offline')]});
  check('closed connection drops events and silences audio synchronously',r.audios[0].cues.length===2&&!r.audios[0].active);
  r.api.context=()=>({isHost:true,sound:true});r.render({...base(),simAt:350,simTick:7,phase:'done',result:{winners:[]},events:[collision('after-round')]});
  check('final snapshot silences active audio before its event loop',r.audios[0].cues.length===2&&!r.audios[0].active);
  r.view.dispose();
}
{
  const r=rig();r.api.context=()=>({isHost:true,sound:true});r.render();await r.settle();
  const weapons=Object.keys(COMBAT.arsenal.weights);
  check('cue coverage matches the authority weapon list',weapons.length===combatWeaponIds.length&&combatWeaponIds.every(id=>weapons.includes(id)));
  for(const weapon of weapons){
    const name=weapon;
    r.render({...base(),events:[{id:'fire-'+weapon,type:weapon==='mine'?'mine':weapon==='shield'?'shield':'fire',weapon,pid:'a',position:{x:0,y:1,z:2}}]});
    check(weapon+' authoritative use maps to an existing recorded or synthesized cue',r.audios[0].cues.at(-1)?.name===name&&(CUE_NAMES.includes(name)&&typeof ASSET_MAP[name]==='string'||SYNTH_CUE_NAMES.includes(name)));
  }
  r.render({...base(),audioBaseline:true,events:[{id:'historical-nuke',type:'fire',weapon:'nuke',pid:'a',position:{x:0,y:1,z:2}}]});
  check('new aliases also stay quiet on reconnect',r.audios[0].cues.length===weapons.length);
  r.view.dispose();
}
{
  const calls=[],stub=kind=>()=>({ownsInputs:kind==='elevated',mount:()=>calls.push(kind+':mount'),update:()=>calls.push(kind+':update'),dispose:()=>calls.push(kind+':dispose')});const context=vm.createContext({createKartView:stub('legacy'),createElevatedKartView:stub('elevated')});const file=repo+'/public/js/games/pocket-karts.js';vm.runInContext(fs.readFileSync(file,'utf8').replace(/^import .*;\n/gm,'').replace('export default view;','globalThis.view=view;'),context,{filename:file});const el={replaceChildren:()=>calls.push('clear')},v=context.view;
  v.update(el,base(),{});v.update(el,base(),{});check('dispatcher reuses renderer for same instance/map revision',calls.filter(v=>v==='elevated:mount').length===1&&v.ownsInputs);
  v.update(el,{...base(),instanceId:'rematch'},{});check('actual rematch identity disposes old elevated scene before mount',calls.slice(-4).join(',')==='elevated:dispose,clear,elevated:mount,elevated:update');
  v.update(el,{phase:'live'},{});check('legacy compatibility route retires elevated and restores legacy ownership',calls.slice(-4).join(',')==='elevated:dispose,clear,legacy:mount,legacy:update'&&!v.ownsInputs);
  v.update(el,base(),{});check('legacy→elevated transition retires legacy scene',calls.slice(-4).join(',')==='legacy:dispose,clear,elevated:mount,elevated:update');v.dispose();v.dispose();check('dispatcher disposal is idempotent and resets ownership',calls.at(-1)==='elevated:dispose'&&!v.ownsInputs);
}
// Graphics fixtures decode the actual embedded PNG bytes without a browser.
globalThis.self=globalThis;
globalThis.createImageBitmap=async blob=>{const bytes=Buffer.from(await blob.arrayBuffer());return {width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20),close(){}};};
// The host's optional audio/asset deadline may expire while GLBs arrive.
// Required render preparation must still run before the arena becomes ready.
{
 const r=rig({graphics:true}),optional=new AbortController();optional.abort();
 r.api.preparationSignal=optional.signal;r.api.signal=optional.signal;
 r.render();await r.settle();await r.view.ready();
 check('expired paint/optional deadline does not skip this arena generation GPU preparation',r.renderStats.compiles>0&&r.node('loading').hidden);
 const compiled=r.renderStats.compiles;
 for(let i=0;i<30;i++){r.advance(16);r.frame();await r.flush();}
 check('required preparation never resumes after Ready',r.renderStats.compiles===compiled);
 r.view.dispose();
}
// If loading runs out of budget, Ready/first input must not resume hidden
// compiles, reflection or uploads. Exercise the real elevated view handoff.
{
  const r=rig({graphics:true,warmupBudget:0});r.render();await r.settle();
  await r.view.ready();const prepared={compiles:r.renderStats.compiles,warmFrames:r.renderStats.warmFrames};
  check('required weapon buffers warm before Ready even with no optional budget',prepared.compiles>0&&prepared.warmFrames>0&&r.renderStats.warmObjects.has('CombatMuzzleFlash'));r.key('KeyW');
  check('expired optional warm-up still allows raised driving',r.sent.at(-1).throttle===1&&r.node('loading').hidden);
  for(let frame=0;frame<120;frame++){r.advance(16);r.frame();await r.flush();}
  check('no optional compile or hidden render after raised Ready/input',r.renderStats.compiles===prepared.compiles&&r.renderStats.warmFrames===prepared.warmFrames);
  r.view.dispose();
}
{
 const r=rig({graphics:true}),s=base();s.karts[0].driftCharge=.6;s.karts[0].driftTier=2;s.karts[0].drifting=true;s.karts[0].pose.grounded=true;s.karts[0].pose.speed=14;s.karts[0].surface='metal';
 r.api.context=()=>({isHost:true,sound:true});r.render(s);const gl=await r.settle();r.frame();
 check('raised drift HUD names the shared orange release tier',r.node('drift').textContent.includes('Orange')&&!r.node('drift').hidden);
 check('raised drift creates the shared bounded spark pool',gl.built.scene.getObjectByName('KartDrivingParticles')?.geometry.attributes.position.count===320);
 check('raised tyre audio receives the real surface and drift hold',r.audios[0].frames.at(-1).surface==='metal'&&r.audios[0].frames.at(-1).drifting);
 const events=['launch','land','warp'].map((type,i)=>({id:'route-'+i,type,pid:'a',position:{x:0,y:.64,z:0},cannon:0,from:{x:0,y:0,z:0},to:{x:1,y:7,z:1}}));
 r.render({...s,simAt:100,simTick:2,events});r.render({...s,simAt:150,simTick:3,events});
 check('confirmed launch/landing/portal events use existing arena audio once',r.audios[0].arenaCues.map(e=>e.name).join(',')==='launch,land,warp');
 r.view.dispose();
}
// The production raised loader seats and batches all four real GLB animals.
// Paint comes from the same room context as classic (and raw garage looks).
{
  const drivers=['fox','bunny','panda','raccoon'],r=rig({graphics:true,batched:true}),s=base();
  s.karts=drivers.map((driver,i)=>({...structuredClone(s.karts[0]),id:'animal-'+i,pose:{position:{x:i*6,y:.64,z:0},rotation:{x:0,y:0,z:0,w:1},speed:0}}));s.you='animal-0';
  const looks={'animal-0':{driver:'fox',color:0xec5765},'animal-1':{driver:'bunny',paint:'teal'},'animal-2':{driver:'panda',color:0},'animal-3':{driver:'raccoon',color:0xaf7cde}};
  r.api.context=()=>({isHost:true,sound:false,looks});r.render(s);const gl=await r.settle();r.frame();
  const models=gl.built.scene.children.filter(o=>o.name==='GiggleKart');
  check('raised loader requests each shared animal once',drivers.every(id=>r.assetRequests.filter(url=>url.endsWith('/drivers/'+id+'.glb')).length===1));
  check('all four chosen animals reach the raised scene in roster order',models.length===4&&models.every((m,i)=>m.userData.kart.inner.userData.driver===drivers[i]));
  check('animals replace every old helmet and steering wheel',models.every(m=>m.getObjectByName('KartDriver')&&!m.getObjectByName('DriverHelmet')&&!m.getObjectByName('SteeringWheel')));
  check('each animal variant uses batched static meshes',models.every(m=>m.getObjectByName('OriginalKartBody')?.visible===false&&m.userData.kart.body.children.some(o=>o.isMesh&&o.name.startsWith('KartBody_'))));
  const expected=[0xec5765,kartPaintHex('teal'),0,0xaf7cde];
  check('room colours, saved garage paint and black paint all survive model selection',models.every((m,i)=>m.userData.kart.color===expected[i]&&m.userData.kart.paint.length>0));
  check('players own separate paint materials',new Set(models.map(m=>m.userData.kart.paint[0])).size===4);
  const prepared=r.allocations();for(let frame=0;frame<60;frame++){r.frame();r.advance(1000/60);}
  check('animal frames allocate no new graphics or loader requests',r.allocations().graphics===prepared.graphics&&r.assetRequests.filter(url=>url.includes('/drivers/')).length===4);
  r.view.dispose();
}
for(const missingDrivers of [['bunny'],['fox','bunny','panda','raccoon']]){
  const r=rig({graphics:true,batched:true,missingDrivers}),s=base();r.api.context=()=>({looks:{a:{driver:'raccoon',color:0x21a9af},b:{driver:'bunny',color:0xffd451}}});r.render(s);const gl=await r.settle();r.frame();
  const models=gl.built.scene.children.filter(o=>o.name==='GiggleKart');
  check('optional animal failure leaves the raised scene playable: '+missingDrivers.length,models.length===2&&r.node('loading').hidden&&models.every(m=>m.userData.kart.paint.length));
  if(missingDrivers.length===1)check('failed bunny never shifts the chosen raccoon id',models[0].userData.kart.inner.userData.driver==='raccoon'&&models[1].userData.kart.inner.userData.driver!=='bunny');
  else check('all failed animal downloads retain the original driver fallback',models.every(m=>m.getObjectByName('DriverHelmet')));
  r.view.dispose();
}
// Transient presentation must retire by elapsed monotonic time, even when
// the renderer clamps a long frame for camera/physics stability.
{
  const r=rig({graphics:true}),shot={id:'retire-me',weapon:'machinegun',position:{x:0,y:1,z:4},velocity:{x:0,y:0,z:110},ttl:.4,radius:.18};
  const mine={id:'still-here',owner:'a',ttl:1,armed:true,radius:.41,position:{x:0,y:.425,z:2},normal:{x:0,y:1,z:0}};
  const traps=()=>gl.built.scene.children.filter(o=>o.visible&&o.userData.combat?.type==='mine').length;
  r.render({...base(),projectiles:[shot],mines:[mine,{...mine,id:'expires-soon',ttl:.18}]});const gl=await r.settle();r.frame();
  const moving=()=>gl.built.scene.children.filter(o=>o.userData.poolKey?.startsWith('shot:')&&o.visible);
  check('fresh authoritative shot remains visible without invented flight',moving().length===1);
  check('both authoritative traps are shown on arrival',traps()===2);
  r.advance(225);r.frame(.1);
  check('only the unexpired stationary trap survives a 225ms packet burst; the bullet is already retired',traps()===1&&moving().length===0);
  r.api.context=()=>({connected:false});r.frame();
  check('disconnect immediately clears a stationary trap',traps()===0);
  r.api.context=()=>({connected:true});r.frame();
  r.advance(775);r.frame(.1);
  check('a frozen raised match retires its last ground trap',traps()===0);
  check('stalled snapshot cannot leave an old bullet visible indefinitely',moving().length===0);
  r.render({...base(),simAt:1050,simTick:21,mines:[mine],projectiles:[{...shot,id:'fresh-shot'}]});r.frame();
  check('fresh current authority can show a genuinely live projectile after a stall',moving().length===1);
  r.render({...base(),simAt:1100,simTick:22,mines:[],projectiles:[shot]});r.frame();
  check('authoritative removal clears a fresh ground trap',traps()===0);
  r.render({...base(),simAt:1150,simTick:23,mines:[mine],projectiles:[shot]});r.frame();
  r.render({...base(),simAt:1150,simTick:23,phase:'done',mines:[mine],projectiles:[shot],result:{winners:[]}});r.frame();
  check('same-tick terminal metadata hides moving ordnance without rejecting the final state',traps()===0&&moving().length===0&&r.node('clock').textContent==='0:00');
  r.render({...base(),simAt:1050,simTick:21,projectiles:[shot]});r.frame();
  check('late equal-clock live packet cannot resurrect a completed instance',traps()===0&&moving().length===0&&r.node('clock').textContent==='0:00');
  r.view.dispose();
}
// A freshly dropped mine leaves through the back of its kart and lands on
// its authoritative spot; mines already down when the view starts never hop.
{
  const r=rig({graphics:true});r.render(base());const gl=await r.settle();r.frame();
  const mine={id:'drop-1',owner:'a',position:{x:0,y:.425,z:-2.8},normal:{x:0,y:1,z:0},radius:.41,armed:false};
  r.render({...base(),simTick:2,simAt:100,mines:[mine]});r.frame();
  const trap=()=>gl.built.scene.children.find(o=>o.visible&&o.userData.combat?.type==='mine');
  const landed=trap().userData.dropTo.clone();
  check('fresh mine starts at the back of its kart, above its landing spot',trap().position.y>landed.y+.5&&trap().position.z>landed.z+1);
  r.advance(100);r.render({...base(),simTick:3,simAt:200,mines:[mine]});r.frame(.1);
  r.advance(50);r.frame(.05);
  check('fresh mine is mid-arc between the kart and its spot',trap().position.distanceTo(landed)>.05&&trap().position.z>landed.z-.01);
  for(let tick=4;tick<=6;tick++){r.advance(100);r.render({...base(),simTick:tick,simAt:100+(tick-2)*100,mines:[mine]});r.frame(.1);}
  check('fresh mine settles exactly on its authoritative spot',trap().position.distanceTo(landed)<1e-6&&trap().userData.drop===null);
  r.view.dispose();
}
{
  const r=rig({graphics:true});r.render();const gl=await r.settle();r.frame();
  const blast=id=>({id,type:'blast',weapon:'missile',pid:'a',position:{x:0,y:1,z:4}});
  r.render({...base(),simAt:100,simTick:2,events:[blast('live-blast')]});r.frame();
  const pool=gl.built.scene.getObjectByName('KartImpactFX').children;
  check('new accepted explosion is visible once',pool.some(o=>o.visible));
  r.advance(2000);r.frame(.1);
  check('old explosion expires across a long frame instead of replaying clipped time',pool.every(o=>!o.visible));
  r.render({...base(),simAt:2100,simTick:42,events:[]});r.frame();
  r.render({...base(),simAt:150,simTick:3,events:[blast('late-old-blast')]});r.frame();
  check('strictly older same-instance snapshots cannot resurrect historical explosions',pool.every(o=>!o.visible));
  const same={...base(),simAt:2100,simTick:42};same.karts[0].weapon='missile';same.karts[0].ammo=3;r.render(same);
  check('equal-tick inventory metadata remains admissible',r.node('weapon').getAttribute('aria-label').includes('Homing Missile'));
  // A new accepted event after a stalled frame must not inherit the stall's
  // elapsed time. Previous effects expire first; fresh effects get one draw.
  r.advance(700);
  const fresh=structuredClone(same);fresh.simAt=r.api.now()-900;fresh.simTick=43;fresh.karts[1].alive=false;
  fresh.events=[{id:'fresh-after-hitch',type:'ko',pid:'a',other:'b',position:{x:10,y:1,z:0}}];
  r.render(fresh);r.frame(.1);
  const sparks=()=>gl.built.scene.children.filter(o=>o.name==='RaisedCombatParticles'&&o.visible);
  const victim=gl.built.scene.children.filter(o=>o.name==='GiggleKart')[1];
  check('fresh KO after a700ms frame hitch receives its first wreck and spark draw',victim.visible&&sparks().length>0);
  r.advance(800);r.frame(.1);
  check('wreck and generic spark pools retire by real elapsed time after a hitch',!victim.visible&&sparks().length===0);
  r.view.dispose();
}
{
 const r=rig();r.render();await r.settle();
 const s=base();s.simAt=100;s.simTick=2;s.karts[0].weapon='cannon';s.karts[0].ammo=1;s.events=[{id:'pickup-reveal',type:'pickup',pid:'a',weapon:'cannon',position:{x:0,y:1,z:0}}];r.render(s);
 check('confirmed item is ready immediately',r.node('weapon').dataset.state==='ready'&&r.node('weapon').dataset.weapon==='cannon');
 r.key('Space');check('elevated fire skips roulette and sends real use intent immediately',r.node('weapon').dataset.state!=='roulette'&&r.sent.at(-1).use===true);
 check('elevated roulette never changes authority inventory',s.karts[0].weapon==='cannon'&&s.karts[0].ammo===1);r.view.dispose();
}
// Execute production scene/frame code with real Three.js model/asset objects.
// The renderer is a double: this proves frame allocations/poses, not GPU time.
{
  // Declared unit layouts isolate three real support types. Items still come
  // from authority collection, and real fixed steps own suspension and release.
  // Exercise production packet rounding and sync against loaded shipping GLBs.
  await initializePhysics();
  for(const mapId of ['garden','frost','neon','harbor'])for(const kind of ['flat','deck','wedge']){
    const y=kind==='flat'?0:kind==='deck'?7:3;
    const floor={id:'floor',shape:'box',half:{x:40,y:1,z:40},position:{x:0,y:-1,z:0}};
    const solid=kind==='wedge'?{id:kind,shape:'wedge',half:{x:12,y:3,z:30},position:{x:0,y:3,z:0},rotation:{x:0,y:0,z:0,w:1}}:{id:kind,shape:'box',half:{x:12,y:.5,z:20},position:{x:0,y:y-.5,z:0}};
    const point=(id,x,z)=>({id,x,y:y+(kind==='wedge'?.1*z:0),z,angle:0,surface:kind});
    const map={...elevatedMap(mapId),half:40,features:{},colliders:kind==='flat'?[solid]:[floor,solid],spawns:[point('a',0,0),point('b',8,10)],sockets:[point('s0',-.7,0),point('s1',.7,0)]};
    let match;
    for(let seed=0;seed<256;seed++){
      const candidate=COMBAT.createElevatedCombat(RAPIER,CONFIG,map,[{id:'a'},{id:'b'}],{instance:'mine-'+mapId+'-'+kind,seed,startAt:0,countdownMs:0,roundMs:20000,crates:1});
      candidate.advance(CONFIG.fixedDt*1000);
      if(candidate.snapshot().karts[0].weapon==='mine'){match=candidate;break;}candidate.dispose();
    }
    assert.ok(match,mapId+' '+kind+' bounded real Mine pickup');
    const probe=PHYSICS.createKartPhysics(RAPIER,CONFIG);for(const d of map.colliders)probe.addStatic(d);
    let adapter,state,view;
    try{
      for(let i=0;i<90;i++)match.advance(match.snapshot().serverAt+CONFIG.fixedDt*1000);
      for(const use of [true,false]){const raw=match.snapshot('a');assert.ok(match.input('a',{instance:raw.instance,life:raw.you.life,controlEpoch:raw.you.controlEpoch,seq:raw.you.receivedSeq+1,steer:0,throttle:0,brake:1,nitro:false,use},raw.serverAt).ok);}
      for(let i=0;i<120&&match.snapshot().mines.length<3;i++){
        const packet=match.snapshot('a');
        if(i%6===0)assert.ok(match.input('a',{instance:packet.instance,life:packet.you.life,controlEpoch:packet.you.controlEpoch,seq:packet.you.receivedSeq+1,steer:0,throttle:1,brake:0,nitro:false,use:false},packet.serverAt).ok);
        match.advance(packet.serverAt+CONFIG.fixedDt*1000);
      }
      const raw=match.snapshot();check(mapId+' '+kind+' grounded real Mine activation sequentially creates three supported traps',raw.mines.length===3&&raw.events.some(e=>e.type==='mine'&&e.pid==='a'));
      if(kind==='wedge')check(mapId+' wedge release has actual sloped support normals',raw.mines.every(m=>Math.abs(m.normal.z)>.09&&m.normal.y<.999));
      adapter=ELEVATED_ADAPTER.createElevatedKartAdapter({RAPIER,config:CONFIG,maps:Object.fromEntries(['skyport','foundry','garden','frost','neon','harbor'].map(id=>[id,id===mapId?map:elevatedMap(id)])),defaults:{mode:'Zap Battle',winRule:'Time limit',garage:false,map:elevatedMap(mapId).name,roundSeconds:20},createMatch:()=>match});
      state=adapter.create({settings:()=>({}),instanceId:raw.instance,now:()=>raw.serverAt,allPlayers:()=>[{id:'a'},{id:'b'}]});
      const viewer=mapId==='garden'||mapId==='neon'?'a':'b';
      const wire={...adapter.viewForTransport(state,viewer),instanceId:raw.instance,you:viewer},packetBefore=JSON.stringify(wire.mines);
      view=rig({graphics:true});view.render(wire);await view.settle();view.frame();
      const scene=view.loads.at(-1).handle.built.scene,traps=scene.children.filter(o=>o.visible&&o.userData.combat?.type==='mine');
      check(mapId+' '+kind+' actual production sync displays every released loaded trail round',traps.length===3&&traps.every(t=>t.getObjectByName('Mine0')?.isMesh));
      for(const [i,m]of wire.mines.entries()){
        const source=raw.mines[i],basePoint=new THREE.Vector3().copy(source.position).addScaledVector(new THREE.Vector3().copy(source.normal),-(source.radius+.015)),support=probe.supportAt({...basePoint,y:basePoint.y+.4},2),normal=new THREE.Vector3().copy(support.normal).normalize();
        check(mapId+' '+kind+' authority packet keeps its swept sphere above independently queried support',support.surfaceId===source.surfaceId&&new THREE.Vector3().copy(source.position).sub(new THREE.Vector3().copy(support.point)).distanceTo(normal.clone().multiplyScalar(source.radius+.015))<1e-5&&new THREE.Vector3().copy(source.normal).distanceTo(normal)<.0001);
        const trap=traps.find(t=>t.position.distanceTo(new THREE.Vector3().copy(support.point).addScaledVector(normal,.02))<.0011);
        assert.ok(trap,mapId+' '+kind+' sync derives the rendered base from physical support along the surface normal');trap.updateMatrixWorld(true);
        const origin=new THREE.Vector3().copy(support.point),v=new THREE.Vector3();let min=Infinity,max=-Infinity;
        trap.traverse(o=>{if(!o.isMesh)return;const p=o.geometry.attributes.position;for(let j=0;j<p.count;j++){const h=v.fromBufferAttribute(p,j).applyMatrix4(o.matrixWorld).sub(origin).dot(new THREE.Vector3().copy(m.normal).normalize());min=Math.min(min,h);max=Math.max(max,h);}});
        check(mapId+' '+kind+' loaded trap base has exact .02m normal clearance and bounded height',Math.abs(min-.02)<.0011&&max<.3);
        check(mapId+' '+kind+' visible trap aligns with independently measured physical plane',Math.abs(trap.position.clone().sub(new THREE.Vector3().copy(support.point)).dot(normal)-.02)<.0011&&new THREE.Vector3(0,1,0).applyQuaternion(trap.quaternion).distanceTo(normal)<.0011);
      }
      check(mapId+' '+kind+' drawing leaves immutable authority packets unchanged',JSON.stringify(wire.mines)===packetBefore&&JSON.stringify(match.snapshot().mines)===JSON.stringify(raw.mines));
    }finally{view?.view.dispose();probe.dispose();if(adapter&&state)adapter.dispose(state);else match.dispose();}
  }
  const r=rig({graphics:true});r.render();await r.settle();r.frame();
  check('raised loading reports warm-up progress',/Preparing graphics.*100%/.test(r.node('loading').textContent));
  check('both shadow quality modes compile and upload in separate small batches',r.allocations().prepared&&r.renderStats.compiles>2&&r.renderStats.warmFrames===r.renderStats.compiles);
  check('raised drift, nitro and cannon/portal particles render during loading', ['KartDrivingParticles','KartSpeedLines','arena-feature-fx'].every(name=>r.renderStats.warmObjects.has(name)));
  const built=r.loads.at(-1).handle.built,impactPool=built.scene.getObjectByName('KartImpactFX').children,effectPool=built.scene.children.filter(o=>o.name==='RaisedCombatParticles');
  const raisedKarts=built.scene.children.filter(o=>o.name==='GiggleKart'),itemBatch=built.scene.getObjectByName('raised-item-boxes'),crowd=built.scene.getObjectByName('kart-lod-proxies');
  check('raised pickups and crowd keep one prepared geometry each, even with no crates',itemBatch?.isInstancedMesh&&crowd?.isInstancedMesh&&crowd.instanceColor&&itemBatch.count===0);
  crowd.geometry.computeBoundingBox();
  check('raised crowd bodies use the chassis model origin rather than floating above it',Math.abs(crowd.geometry.boundingBox.min.y-(.2+CONFIG.chassis.modelOriginY))<1e-5);
  check('loading restores kart culling and uses just one shadow caster per detailed model',raisedKarts.every(k=>{let casters=0;k.traverse(o=>{if(o.isMesh&&o.castShadow)casters++;});return k.frustumCulled&&casters===1&&k.getObjectByName('KartShadowProxy').layers.mask===2;}));
  check('all twelve prepared particle buffers remain attached after warming',effectPool.length===12&&effectPool.every(o=>o.parent===built.scene&&!o.visible));
  const projectilePool=r.projectiles.filter(o=>o.userData.combat?.contactRadius>0);
  check('all reserved projectile bodies stay off the live scene graph',projectilePool.length===Object.keys(COMBAT.staticSweepRadii).length*64&&projectilePool.every(o=>o.parent===null));
  for(const [kind,radius]of Object.entries(COMBAT.staticSweepRadii)){
    const prepared=projectilePool.filter(o=>o.userData.combat.kind===kind);
    check(kind+' all 64 warmed shots share cached authoritative contact calibration',prepared.length===64&&prepared.every(o=>o.userData.combat.contactRadius===radius&&o.userData.combat.contactInset>=.005&&o.userData.combat.contactInset===prepared[0].userData.combat.contactInset));
  }
  // The authority permits twelve simultaneous grenades. Every body and
  // warning ring must already exist, even when all slots use one weapon.
  const saturation=rig({graphics:true});saturation.render();await saturation.settle();saturation.frame();
  const saturationScene=saturation.loads.at(-1).handle.built.scene,beforeGrenades=saturation.allocations();
  for(const [index,weapon]of ['nuke','frost'].entries()){
    const grenades=Array.from({length:12},(_,i)=>({id:weapon+i,weapon,position:{x:i-6,y:8,z:6},velocity:{x:0,y:0,z:0},fuse:1,warning:weapon==='nuke'}));
    saturation.render({...base(),simAt:80+index*100,simTick:10+index,grenades});saturation.advance(100);saturation.frame();
    check(weapon+' maximum twelve bodies use prepared grenade meshes',saturationScene.children.filter(o=>o.visible&&o.userData.poolKey==='grenade:'+weapon).length===12&&saturation.allocations().projectiles===beforeGrenades.projectiles);
  }
  saturation.render({...base(),simAt:290,simTick:12});saturation.advance(50);saturation.frame();
  check('grenade saturation and warning rings retire with the authority',!saturationScene.children.some(o=>o.visible&&(o.userData.poolKey?.startsWith('grenade:')||o.name==='NukeWarningRing')));
  saturation.view.dispose();
  let projectileTraversals=0;
  for(const object of projectilePool){const traverse=object.traverse;object.traverse=function(...args){projectileTraversals++;return traverse.apply(this,args);};}
  const allocations=r.allocations(),event=(id,type)=>({id,type,pid:'a',position:{x:0,y:1,z:3}});
  r.render({...base(),simAt:60,simTick:2,events:[event('queued-before-reconnect','blast')]});
  r.render({...base(),simAt:70,simTick:3,audioBaseline:true,events:[event('queued-before-reconnect','blast'),event('missed-impact','blast')]});r.frame();
  check('reconnect baseline clears impacts already queued before the next frame',effectPool.every(o=>!o.visible)&&impactPool.every(o=>!o.visible));
  for(let i=0;i<30;i++){
    const shot={id:i,weapon:i%2?'missile':'nuke',position:{x:0,y:1,z:4},velocity:{x:0,y:0,z:32},radius:i%2?COMBAT.staticSweepRadii.missile:.5},s={...base(),simTick:i+2,simAt:100+i*50,projectiles:[shot],events:[event(i+1,'blast')]};
    r.render(s);r.advance(50);r.frame();
  }
  check('repeated rocket/nuke shots recycle prepared projectile objects',r.allocations().projectiles===allocations.projectiles);
  check('live projectile frames never traverse meshes to recalibrate contact',projectileTraversals===0);
  check('blast saturation reuses the bounded particle buffer pool',r.allocations().instances===allocations.instances);
  check('repeated rocket blasts leave visible particle buffers in the rendered scene',impactPool.length===4&&impactPool.every(o=>o.parent?.parent===built.scene)&&impactPool.some(o=>o.visible));
  check('prepared rocket visible nose agrees with its calibrated accepted sphere front',built.scene.children.some(o=>{if(o.userData.combat?.kind!=='missile'||!o.visible)return false;o.updateMatrixWorld(true);const tip=o.localToWorld(new THREE.Vector3(0,0,o.userData.combat.tipZ));return Math.abs(tip.z-(4+COMBAT.staticSweepRadii.missile-o.userData.combat.contactInset))<1e-6;}));
  r.render({...base(),simAt:1600,simTick:90,events:[event(90,'blast')]});r.frame();
  check('latest authoritative blast retires its buffered projectile immediately',!built.scene.children.some(o=>o.userData.combat?.type==='projectile'&&o.visible)&&impactPool.some(o=>o.visible));
  const particlePosition=mesh=>{const matrix=new THREE.Matrix4();mesh.getMatrixAt(0,matrix);return new THREE.Vector3().setFromMatrixPosition(matrix);};
  r.render({...base(),simAt:1600,simTick:101,events:[{...event(101,'collision'),position:{x:7,y:1,z:3},normal:{x:1,y:0,z:0},impulse:800}]});r.advance(50);r.frame();
  const contactStreaks=impactPool.find(o=>o.name==='KartImpactEmbers');
  const origins=contactStreaks.geometry.attributes.fxOrigin.array,velocities=contactStreaks.geometry.attributes.fxVelocity.array;
  check('collision uses the warmed contact pool at the actual solver point and direction',contactStreaks.visible&&Array.from({length:origins.length/3},(_,i)=>i).some(i=>origins[i*3]===7&&origins[i*3+1]===1&&origins[i*3+2]===3&&velocities[i*3]>0));
  check('collision no longer starts the generic radial knockout animation',effectPool.every(o=>!o.visible));
  for(const [type,x,count,id]of [['ko',11,24,102]]){
    r.render({...base(),simAt:1600+(id-101)*50,simTick:id,events:[{...event(id,type),position:{x,y:1,z:3}}]});r.advance(50);r.frame();
    check(type+' creates a visible effect at its admission point using an attached prepared buffer',effectPool.some(o=>o.parent===built.scene&&o.visible&&o.count===count&&particlePosition(o).x>x&&particlePosition(o).x<x+1));
    r.advance(50);r.frame(.05);
    check(type+' positioned particles advance after admission without inheriting the previous frame',effectPool.some(o=>o.parent===built.scene&&o.visible&&o.count===count&&particlePosition(o).x>x&&particlePosition(o).x<x+1));
  }
  check('collision and knockout effects retain the same twelve scene buffers',effectPool.every(o=>o.parent===built.scene)&&r.allocations().instances===allocations.instances);
  const model=built.scene.children.find(o=>o.name==='GiggleKart');
  check('production follow camera remains finite through effect saturation',built.camera.matrixWorld.elements.every(Number.isFinite)&&built.camera.position.toArray().every(Number.isFinite));
  const sample=base();sample.simAt=2000;sample.simTick=110;sample.karts[0].guard=true;r.render(sample);r.frame();
  check('a ready Shield guard shows the shield bubble with the stock paint emission',model.userData.kart.shield.visible&&model.userData.kart.paint.every(material=>material.emissiveIntensity!==.55)&&model.userData.kart.invincibilityTrails.every(trail=>!trail.visible));
  check('retired sentry and blade orbit art never appears',!built.scene.getObjectByName('CombatSentry')&&!model.getObjectByName('OrbitingSteelBlades'));
  const spent=structuredClone(sample);spent.simTick=111;spent.simAt=2050;spent.karts[0].guard=false;r.render(spent);r.frame();
  check('a consumed guard drops the shield bubble',!model.userData.kart.shield.visible);
  r.motion(true);r.frame();check('reduced motion suppresses chassis cosmetic lean',model.userData.kart.body.rotation.x===0);
  r.view.dispose();
}
// Actual prepared GLB tracer geometry shows only the confirmed authority
// sweep. There is no owner/weapon pairing or simulated client flight.
{
  const r=rig({graphics:true});r.render();const gl=await r.settle();r.frame();
  const scene=gl.built.scene,cues=scene.children.filter(o=>o.name==='CombatConfirmedShot'),allocation=r.allocations();
  check('confirmed shot pool is prepared and bounded to twelve tracers per straight weapon',cues.length===24&&cues.every(o=>!o.visible&&o.children.length===1&&o.children[0].isMesh));
  for(const kind of ['machinegun','trishot']){
    const source=r.projectiles.find(o=>o.userData.combat?.type==='projectile'&&o.userData.combat.kind===kind).userData.combat.tail;
    check(kind+' feedback borrows prepared projectile tracer geometry and material',cues.filter(o=>o.userData.confirmedShot===kind).every(o=>o.children[0].geometry===source.geometry&&o.children[0].material===source.material));
  }
  check('Pulse white and Scatter amber feedback retain the existing art colors',cues.find(o=>o.userData.confirmedShot==='machinegun').children[0].material.color.getHex()===0xffffff&&cues.find(o=>o.userData.confirmedShot==='trishot').children[0].material.color.getHex()===0xffb020);
  const from={x:.95,y:1.14,z:2.1},position={x:1.6,y:1.5,z:3.1},start=new THREE.Vector3().copy(from),axis=new THREE.Vector3().subVectors(position,from),length=axis.length();axis.normalize();
  const endpoints=cue=>{cue.updateMatrixWorld(true);const mesh=cue.children[0],v=new THREE.Vector3(),vertices=mesh.geometry.attributes.position;let min=Infinity,max=-Infinity;for(let i=0;i<vertices.count;i++){v.fromBufferAttribute(vertices,i).applyMatrix4(mesh.matrixWorld).sub(start);const d=v.dot(axis);min=Math.min(min,d);max=Math.max(max,d);}return Math.abs(min)<1e-6&&Math.abs(max-length)<1e-6;};
  let id=0;
  for(const reduced of [false,true])for(const dt of [.03,.04])for(const weapon of ['machinegun','trishot']){
    r.motion(reduced);const event={id:'confirmed-'+(++id),type:'impact',weapon,pid:'b',other:'a',from,position},snapshot={...base(),simTick:id+1,simAt:r.api.now(),events:[event]};
    r.render(snapshot);r.advance(dt*1000);r.frame(dt);const visible=cues.filter(o=>o.visible);
    check(`${weapon} absent from snapshots shows exact confirmed endpoints after ${dt*1000}ms with reduced motion ${reduced}`,visible.length===1&&visible[0].userData.confirmedShot===weapon&&endpoints(visible[0])&&!scene.children.some(o=>o.visible&&o.userData.combat?.type==='projectile'));
    const matrix=visible[0].matrixWorld.clone();r.render(snapshot);r.advance(40);r.frame(.04);
    check(weapon+' duplicate receipts leave the stationary confirmed segment unchanged',visible[0].visible&&visible[0].matrixWorld.equals(matrix));
    r.advance(51);r.frame(.051);check(weapon+' confirmed feedback expires after its bounded90ms lifetime',cues.every(o=>!o.visible));
  }
  const pellets=Array.from({length:3},(_,i)=>({id:'pellet-'+i,type:'impact',weapon:'trishot',pid:'a',surfaceId:'wall',from,position:{...position,x:position.x+(i-1)*.4}}));
  // Stay under the 1s authority gap that would reseed event history.
  const pelletSnapshot={...base(),simTick:40,simAt:r.api.now(),events:pellets};r.render(pelletSnapshot);r.frame(.1);
  check('three same-owner Scatter pellets produce independent confirmed surface strokes',cues.filter(o=>o.visible&&o.userData.confirmedShot==='trishot').length===3&&new Set(cues.filter(o=>o.visible).map(o=>o.position.x)).size===3);
  r.render(pelletSnapshot);r.advance(100);r.frame(.1);check('repeated pellet receipt cannot renew expired strokes',cues.every(o=>!o.visible));
  r.render({...base(),simTick:40,simAt:r.api.now(),events:[{id:'blocked-barrel',type:'impact',weapon:'machinegun',pid:'a',surfaceId:'barrel-cover',from:{x:.95,y:1.14,z:0},position:{x:.95,y:1.14,z:1.6}}]});r.frame(.1);
  const blockedCue=cues.find(o=>o.visible),blockedBounds=blockedCue&&new THREE.Box3().setFromObject(blockedCue);
  check('blocked barrel feedback stays short and ends at cover before the muzzle',blockedBounds&&Math.abs(blockedBounds.min.z-.35)<1e-6&&Math.abs(blockedBounds.max.z-1.6)<1e-6);
  r.advance(100);r.frame(.1);
  // A buffered projectile may be present before a hitch delivers its impact.
  r.render({...base(),simTick:41,simAt:r.api.now(),projectiles:[{id:'short',weapon:'machinegun',position:from,velocity:{x:0,y:0,z:140}}]});r.frame();
  r.render({...base(),simTick:42,simAt:r.api.now(),events:[{id:'retire-short',type:'impact',weapon:'machinegun',pid:'a',from,position}]});r.frame(.1);
  check('latest impact retires the live projectile immediately while its exact confirmed segment survives',!scene.children.some(o=>o.visible&&o.userData.combat?.type==='projectile')&&cues.some(o=>o.visible&&endpoints(o)));
  r.render({...base(),simTick:43,simAt:r.api.now(),audioBaseline:true});r.frame();check('reconnect baseline clears active confirmed feedback',cues.every(o=>!o.visible));
  r.render({...base(),simTick:44,simAt:r.api.now(),events:Array.from({length:32},(_,i)=>({id:'saturation-'+i,type:'impact',weapon:'machinegun',pid:'a',from,position}))});r.frame(.1);
  check('confirmed feedback saturation stays inside its prepared pool without hot graphics allocations',cues.filter(o=>o.visible).length===12&&JSON.stringify(r.allocations())===JSON.stringify(allocation));
  r.render({...base(),instanceId:'fresh',simTick:1,events:[]});r.frame();check('new instance resets old confirmed strokes',cues.every(o=>!o.visible));
  r.render({...base(),instanceId:'fresh',simTick:2,events:[{id:'disposed-cue',type:'impact',weapon:'machinegun',pid:'a',from,position}]});r.frame();assert.ok(cues.some(o=>o.visible));
  r.view.dispose();check('view disposal detaches and retires every confirmed tracer without owning borrowed resources',cues.every(o=>!o.visible&&o.parent===null)&&gl.disposals===1);r.view.dispose();
}
// Current health and accepted weapon/KO events must agree in the actual scene.
{
  const r=rig({graphics:true}),start=base();for(const k of start.karts){k.health=100;k.maxHealth=100;}
  r.render(start);await r.settle();r.frame();
  const scene=r.loads.at(-1).handle.built.scene,model=scene.children.filter(o=>o.name==='GiggleKart')[0];
  const flashes=scene.children.filter(o=>o.name==='CombatMuzzleFlash'),allocation=r.allocations();
  const bar=scene.getObjectByName('KartHealth:a'),otherBar=scene.getObjectByName('KartHealth:b');
  check('own HP stays in the HUD while full-health rivals have an overhead bar',bar&&!bar.visible&&otherBar&&otherBar.visible);
  check('all twelve muzzle flashes and each active kart are prepared before gameplay',flashes.length===12&&scene.children.filter(o=>o.name==='GiggleKart').length===start.karts.length);
  const hearts=()=>r.node('health').children;
  check('elevated HUD starts at 100 HP',r.node('health').dataset.hp==='100'&&r.node('health').getAttribute('aria-label')==='100 of 100 HP');
  const hit=structuredClone(start);hit.simTick=2;hit.simAt=100;hit.karts[0].health=95;hit.karts[1].health=65;hit.events=[{id:1,type:'hit',pid:'b',other:'a',damage:5,health:95,maxHealth:100,weapon:'machinegun',position:{x:0,y:1,z:3}}];
  r.render(hit);r.frame();
  check('nonlethal accepted hit changes the HP fill without hiding the kart',r.node('health').getAttribute('aria-label')==='95 of 100 HP'&&r.node('health').querySelector('.kart-hp-fill').style.transform==='scaleX(0.95)'&&model.visible);
  check('HP loss triggers one HUD pop',r.node('health').getAttribute('data-shake')!==null);
  const [track,fullHeart]=bar.children;
  check('rival bar shows exact authoritative HP while the own overhead bar stays hidden',!bar.visible&&otherBar.visible&&otherBar.children.length===2&&otherBar.children[1].scale.x===.65);
  check('elevated billboard faces the final chase camera and remains depth occluded',otherBar.quaternion.equals(r.loads.at(-1).handle.built.camera.quaternion)&&otherBar.children.every(o=>o.material.depthTest&&!o.material.depthWrite&&!o.material.map));
  check('first elevated damage adds no graphics resources',JSON.stringify(r.allocations())===JSON.stringify(allocation));
  const flash=r.el.querySelector('.kart-hitfx-flash');
  check('self hit flashes the screen edge once',flash.getAttribute('data-on')==='');
  flash.removeAttribute('data-on');r.render(hit);r.frame();check('repeated authoritative hit does not replay damage',flash.getAttribute('data-on')===null);
  const landed=structuredClone(hit);landed.simTick=2;landed.events=[...hit.events,{id:'landed',type:'hit',pid:'a',other:'b',damage:65,health:35,maxHealth:100,weapon:'missile',position:{x:10,y:1,z:0}}];
  r.render(landed);r.frame();
  check('own landed hit shows the hit marker and HP toast',r.el.querySelector('.kart-hitfx-marker').getAttribute('data-on')===''&&r.el.querySelector('.kart-hitfx-toast').textContent==='−65 HP');
  const fire=structuredClone(hit);fire.simTick=3;fire.simAt=150;fire.events=[{id:2,type:'fire',weapon:'missile',pid:'a',position:{x:4,y:1,z:5},direction:{x:1,y:0,z:0}}];
  r.render(fire);r.frame();
  const muzzle=flashes.find(o=>o.visible);
  check('even a rocket absent between snapshots has a muzzle flash at the actual accepted origin',muzzle&&muzzle.position.distanceTo(new THREE.Vector3(4,1,5))<1e-9&&new THREE.Vector3(0,0,1).applyQuaternion(muzzle.quaternion).distanceTo(new THREE.Vector3(1,0,0))<1e-9);
  r.advance(100);r.frame(.1);check('muzzle flash expires promptly and reuses prepared graphics',flashes.every(o=>!o.visible)&&r.allocations().projectiles===allocation.projectiles&&r.allocations().instances===allocation.instances);
  // three-view caps the elapsed interval before this frame at 100ms. A fire
  // accepted during that interval must reach the subsequent render once;
  // charging that past interval to its new 90ms flash erased it before draw.
  let hitchTick=3;
  for(const reduced of [false,true])for(const dt of [.09,.1])for(const weapon of ['machinegun','trishot','missile','cannon','nuke']){
    r.motion(reduced);
    const accepted=structuredClone(fire);accepted.simTick=++hitchTick;accepted.simAt=r.api.now();accepted.events=[{id:`hitch-${reduced}-${dt}-${weapon}`,type:'fire',weapon,pid:'a',position:{x:4,y:1,z:5},direction:{x:1,y:0,z:0}}];
    r.render(accepted);r.frame(dt);
    const visible=flashes.filter(o=>o.visible);
    check(`${weapon} accepted flash reaches the draw after ${dt*1000}ms with reduced motion ${reduced}`,visible.length===1&&visible[0].position.distanceTo(new THREE.Vector3(4,1,5))<1e-9&&new THREE.Vector3(0,0,1).applyQuaternion(visible[0].quaternion).distanceTo(new THREE.Vector3(1,0,0))<1e-9);
    r.render(accepted);r.advance(dt*1000);r.frame(dt);
    check(`${weapon} hitch flash expires without duplicate event replay or graphics allocation`,flashes.every(o=>!o.visible)&&r.allocations().projectiles===allocation.projectiles&&r.allocations().instances===allocation.instances);
  }
  r.motion(false);
  const ko=structuredClone(fire);ko.simTick=hitchTick+1;ko.simAt=r.api.now();ko.karts[0].health=0;ko.karts[0].alive=false;ko.events=[{id:3,type:'ko',pid:'b',other:'a',position:{x:2,y:1,z:3}}];
  r.render(ko);r.frame();
  check('KO hides the scene health bar while the wreck animation remains visible',!bar.visible);
  check('KO keeps the victim visible on its first impact frame',model.visible&&model.position.x===2&&model.position.z===3&&model.scale.x<=1);
  r.advance(700);r.frame(.1);check('wreck retires after its bounded collapse animation',!model.visible);
  const respawn=structuredClone(start);respawn.simTick=ko.simTick+1;respawn.simAt=r.api.now();respawn.karts[0].spawnSeq=2;respawn.karts[0].pose.position={x:20,y:.64,z:20};
  r.render(respawn);r.frame();
  check('new life restores 100 HP and actual spawn without stale wreck transform',model.visible&&model.scale.x===1&&model.position.x===20&&model.position.z===20&&r.node('health').dataset.hp==='100'&&r.node('health').dataset.life==='2');
  check('own respawn keeps the overhead bar hidden',!bar.visible);
  const watch=structuredClone(respawn);watch.simTick=respawn.simTick+1;watch.simAt=r.api.now();watch.you='watcher';watch.youDrive=false;watch.karts[1].health=1;watch.karts[1].pose.position.y=7;r.render(watch);r.frame();check('watcher has no invented personal health bar',r.node('health').hidden);
  check('watcher sees remote wounded player at its elevated world height',otherBar.visible&&Math.abs(otherBar.position.y-scene.children.filter(o=>o.name==='GiggleKart')[1].position.y-3)<1e-9&&otherBar.children[1].scale.x===.01);
  const offline=structuredClone(watch);offline.simTick=watch.simTick+1;offline.simAt=r.api.now();offline.karts[1].connected=false;r.render(offline);r.frame();check('disconnected elevated player hides its overhead bar',!otherBar.visible);
  r.view.dispose();check('elevated disposal detaches every scene health bar',bar.parent===null&&otherBar.parent===null);
}
// Real Three collider triangles and the shipped chase-camera code. At 20Hz
// snapshots, smoothing a safe desired position used to cut through this deck
// for seven frames. Keep both the camera and its sight line outside the solid.
{
  const deck={id:'deck',shape:'deck',half:{x:8,y:.3,z:6},position:{x:0,y:3.7,z:0}};
  for(const frameMs of [1000/60,1000/30]){
    const r=rig({graphics:true,colliders:[deck]}),initial=base();initial.simAt=0;initial.karts[0].pose.position.z=-18;r.render(initial);
    const gl=await r.settle(),camera=gl.built.camera,solid=new THREE.Mesh(elevatedSolidGeometry(THREE,deck),new THREE.MeshBasicMaterial());solid.position.copy(deck.position);solid.updateMatrixWorld();r.frame();
    const ray=new THREE.Raycaster(),look=new THREE.Vector3();let penetrations=0,occluded=0,frames=0;
    for(let elapsed=frameMs;elapsed<=6000;elapsed+=frameMs){
      const snapshot=base();snapshot.simAt=Math.floor(elapsed/50)*50;snapshot.simTick=Math.floor(elapsed/50);snapshot.karts[0].pose.position.z=-18+snapshot.simAt*.006;
      if(elapsed>2000&&elapsed<2600)snapshot.events=[{id:'camera-contact',type:'collision',pid:'a',position:{x:0,y:1,z:-4},impulse:800}];
      r.render(snapshot);r.advance(frameMs);r.frame(frameMs/1000);frames++;
      const p=camera.position;if(Math.abs(p.x)<7.9&&Math.abs(p.z)<5.9&&p.y>3.41&&p.y<3.99)penetrations++;
      camera.updateMatrixWorld();camera.getWorldDirection(look);ray.set(p,look);ray.far=.19;
      if(ray.intersectObject(solid).length)occluded++;
    }
    check(Math.round(1000/frameMs)+'fps eased/shaken chase camera never enters the real deck',frames>170&&penetrations===0&&occluded===0);
    check(Math.round(1000/frameMs)+'fps follow remains finite and resumes full height after the underpass',camera.position.toArray().every(Number.isFinite)&&camera.position.y>5);
    solid.geometry.dispose();solid.material.dispose();r.view.dispose();
  }
  const watcher=rig({graphics:true}),initial=base();initial.you='watcher';initial.youDrive=false;initial.inputAck=null;watcher.render(initial);
  const gl=await watcher.settle();watcher.frame();
  const respawn=structuredClone(initial);respawn.simAt=100;respawn.simTick=2;respawn.karts[0].spawnSeq=2;respawn.karts[0].controlEpoch=4;respawn.karts[0].pose.position.z=40;
  watcher.render(respawn);watcher.frame();
  check('watcher camera adopts the followed kart fresh life without easing across its teleport',Math.abs(gl.built.camera.position.z-31.5)<1e-6);
  watcher.view.dispose();
}
// Preparation owns the clock presentation until both local graphics and the
// authoritative release are ready, including a slow loader or late watcher.
{
  const r=rig(),preparing={...base(),phase:'countdown',preparing:true,endsAt:4000};
  check('mount has no numeric clock before its first snapshot',r.node('clock').textContent==='Loading');
  r.render(preparing);
  check('delayed graphics clock says Loading rather than starting countdown',r.node('clock').textContent==='Loading'&&r.node('clock').getAttribute('aria-label')==='Loading arena'&&!r.node('loading').hidden);
  r.advance(2000);r.render(preparing);
  check('preparation heartbeats cannot consume visible countdown while assets load',r.node('clock').textContent==='Loading'&&r.node('nitro').disabled);
  await r.settle();
  check('loaded scene waiting for authoritative release says Ready immediately',r.node('clock').textContent==='Ready'&&r.node('clock').getAttribute('aria-label')==='Arena ready; waiting for players'&&r.node('loading').hidden);
  r.advance(2000);r.render(preparing);r.key('KeyW');
  check('expired provisional deadline stays Ready and preparation blocks controls',r.node('clock').textContent==='Ready'&&r.node('nitro').disabled&&r.sent.every(a=>a.throttle===0));
  const released={...preparing,preparing:false,endsAt:r.api.now()+3000};r.render(released);
  check('authoritative release alone presents the full countdown',r.node('clock').textContent==='3'&&r.node('clock').getAttribute('aria-label')==='3 seconds remaining');
  r.advance(1000);r.render(released);check('released countdown follows the supplied deadline',r.node('clock').textContent==='2');
  r.render({...released,phase:'live',endsAt:r.api.now()+90000});check('released live clock presents actual round time',r.node('clock').textContent==='1:30');
  r.loads.at(-1).options.onContextLost();check('context loss replaces stale round time with Retry',r.node('clock').textContent==='Retry'&&r.node('clock').getAttribute('aria-label')==='Arena unavailable; retry 3D');r.view.dispose();
  const watcher=rig();watcher.render({...base(),you:'watcher',youDrive:false,inputAck:null,endsAt:90000});
  check('late watcher with a live round waits for local graphics before showing time',watcher.node('clock').textContent==='Loading');
  await watcher.settle();check('loaded late watcher adopts the running clock immediately',watcher.node('clock').textContent==='1:29');watcher.view.dispose();
}
// A clear camera position also needs a clear look-ahead origin. A ground kart
// can remain inside the field while its four-metre focus crosses a wall; a ray
// cast from that focus used to pull the camera onto the wall's opposite side.
{
  function solids(map){return map.colliders.map(d=>{const mesh=new THREE.Mesh(elevatedSolidGeometry(THREE,d),new THREE.MeshBasicMaterial());mesh.name=d.id;mesh.position.copy(d.position);if(d.rotation)mesh.quaternion.copy(d.rotation);mesh.updateMatrixWorld();return mesh;});}
  function sight(camera,model,meshes){const eye=model.position.clone();eye.y+=1.4;const direction=camera.position.clone().sub(eye),ray=new THREE.Raycaster(eye,direction.clone().normalize(),0,direction.length()-.01);return ray.intersectObjects(meshes,false).length===0;}
  function release(meshes){for(const mesh of meshes){mesh.geometry.dispose();mesh.material.dispose();}}
  for(const mapId of ['garden','frost','neon','harbor'])for(const frameMs of [1000/60,1000/30])for(const [side,nx,nz]of [['west',-1,0],['east',1,0],['south',0,-1],['north',0,1]]){
    const map=elevatedMap(mapId),meshes=solids(map),r=rig({graphics:true,colliders:map.colliders}),initial=base();
    initial.mapId=mapId;initial.simAt=0;initial.karts[0].pose.position={x:nx*(map.half-4.5),y:.64,z:nz*(map.half-4.5)};
    const angle=Math.atan2(nx,nz);initial.karts[0].pose.rotation={x:0,y:Math.sin(angle/2),z:0,w:Math.cos(angle/2)};
    r.render(initial);const gl=await r.settle(),camera=gl.built.camera,model=gl.built.scene.children.find(o=>o.name==='GiggleKart');
    let inside=true,clear=true,finite=true,maxStep=0,last=null,frames=0,previousTick=-1;
    for(let elapsed=0;elapsed<=1000;elapsed+=frameMs){
      const tick=Math.floor((elapsed+1e-6)/50);if(tick!==previousTick){const snapshot=structuredClone(initial);snapshot.simAt=tick*50;snapshot.simTick=tick;snapshot.karts[0].pose.position.x=nx*(map.half-4.5+Math.min(2,tick*.2));snapshot.karts[0].pose.position.z=nz*(map.half-4.5+Math.min(2,tick*.2));r.render(snapshot);previousTick=tick;}
      r.frame(frameMs/1000);frames++;const p=camera.position;
      inside&&=Math.abs(p.x)<map.half-.5&&Math.abs(p.z)<map.half-.5;clear&&=sight(camera,model,meshes);finite&&=p.toArray().every(Number.isFinite);
      if(last)maxStep=Math.max(maxStep,p.distanceTo(last));last=p.clone();r.advance(frameMs);
    }
    const label=map.name+' '+side+' '+Math.round(1000/frameMs)+'fps';
    check(label+' approaching a wall keeps camera on the kart side',inside&&frames>=30);
    check(label+' camera-to-kart sight never passes through an authored collider',clear&&finite);
    check(label+' look-ahead clipping never turns smooth approach into a camera jump',maxStep<.5);
    r.view.dispose();release(meshes);
  }
  // Real held-input Rapier trajectories over the shipping ramps and bridge.
  // Before the boundary, the guard must retain the ordinary eased chase and
  // full vertical motion rather than flattening elevation or shortening it.
  await initializePhysics();
  const allRampRoutes=['garden','frost','neon','harbor'].flatMap(id=>{
    const map=elevatedMap(id);
    return map.routes.map(route=>{
      const ramp=map.colliders.find(d=>d.id===route.via),angle=2*Math.atan2(ramp.rotation.y,ramp.rotation.w),run=ramp.half.z+4;
      return [id,map.name+' '+route.id+' driven camera route','floor',ramp.position.x-Math.sin(angle)*run,0,ramp.position.z-Math.cos(angle)*run,angle,5.6,ramp.position.y+ramp.half.y+.3,false];
    });
  });
  for(const [mapId,label,surface,x,y,z,angle,seconds,minHeight,openChase=false]of [
    ['garden','Alpine ramp, deck and physical drop','floor',16,0,-38,0,4.7,7.5,true],
    ['frost','Frost shelf climb, deck and physical drop','floor',-27,0,-42,0,5.6,8.5],
    ['frost','Frost shelf, bridge and east landing','quarry-shelf',-28,8,16,Math.PI/2,4.2,8.5],
    ['neon','Neon loading ramp, deck and physical drop','floor',14,0,-30,0,4.7,6.5],
    ['harbor','Harbor climb, deck and physical drop','floor',-16,0,-44,0,5.6,7.5,true],
    ['harbor','Harbor balcony and elevated bridge','west-balcony',-61,7,20,Math.PI/2,5.5,7.5,true],
    ...allRampRoutes,
  ]){
    const map=elevatedMap(mapId),probe=PHYSICS.createKartPhysics(RAPIER,CONFIG);map.colliders.forEach(d=>probe.addStatic(d));
    const startSurface=probe.supportAt({x,y:y+.4,z},.8)?.surfaceId;probe.dispose();
    map.spawns=[{id:'camera-route',surface:startSurface,x,y,z,angle},map.spawns.find(p=>Math.hypot(p.x-x,p.z-z)>8)];
    let match;try{match=COMBAT.createElevatedCombat(RAPIER,CONFIG,map,[{id:'a'},{id:'b'}],{instance:'camera-route',seed:1,startAt:0,countdownMs:0,roundMs:30000,crates:1});}catch(error){throw new Error(label+': '+error.message,{cause:error});}
    const snapshots=[];let sequence=0,maxHeight=0,airborne=0;
    try{for(let frame=0;frame<=seconds*60;frame++){
      if(frame%6===0){const v=match.snapshot('a'),ack=v.you;assert.ok(match.input('a',{instance:v.instance,seq:++sequence,life:ack.life,controlEpoch:ack.controlEpoch,steer:0,throttle:1,brake:0,nitro:false,use:false},v.serverAt).ok,label+' held input '+frame);}
      const snapshot=match.advance(frame*1000/60);maxHeight=Math.max(maxHeight,snapshot.karts[0].pose.position.y);if(!snapshot.karts[0].pose.grounded)airborne++;if(frame%3===0)snapshots.push(snapshot);
    }}finally{match.dispose();}
    const meshes=solids(map),r=rig({graphics:true,colliders:map.colliders}),convert=v=>({...base(),instanceId:v.instance,mapId,simAt:v.simAt,simTick:v.simTick,karts:v.karts,events:[],inputAck:{life:v.karts[0].spawnSeq,controlEpoch:v.karts[0].controlEpoch,receivedSeq:0}});
    r.render(convert(snapshots[0]));const gl=await r.settle(),camera=gl.built.camera,model=gl.built.scene.children.find(o=>o.name==='GiggleKart');
    const expectedPosition=new THREE.Vector3(),expectedFocus=new THREE.Vector3(),nose=new THREE.Vector3(),desired=new THREE.Vector3(),focus=new THREE.Vector3(),look=new THREE.Vector3();
    let index=0,clear=true,unchanged=true,finite=true,framed=true,first=true,firstHidden=null,firstUnframed=null;
    const kartBounds=new THREE.Box3(),kartCenter=new THREE.Vector3();
    for(let frame=0;frame<=seconds*60;frame++){
      while(snapshots[index]?.simAt<=frame*1000/60+1e-6)r.render(convert(snapshots[index++]));r.frame();
      nose.set(0,0,1).applyQuaternion(model.quaternion);nose.y=0;nose.normalize();desired.copy(model.position).addScaledVector(nose,-8.5);desired.y+=4.4;focus.copy(model.position).addScaledVector(nose,4);focus.y+=1.4;
      if(first){expectedPosition.copy(desired);expectedFocus.copy(focus);first=false;}else{const ease=1-Math.exp(-12/60);expectedPosition.lerp(desired,ease);expectedFocus.lerp(focus,ease);}
      camera.updateMatrixWorld();camera.getWorldDirection(look);unchanged&&=camera.position.distanceTo(expectedPosition)<1e-6&&look.distanceTo(focus.subVectors(expectedFocus,expectedPosition).normalize())<1e-6;
      const visible=sight(camera,model,meshes);
      if(!visible&&!firstHidden){const anchor=model.position.clone();anchor.y+=1.4;const delta=camera.position.clone().sub(anchor),ray=new THREE.Raycaster(anchor,delta.clone().normalize(),0,delta.length()-.01);firstHidden={frame,at:snapshots[Math.max(0,index-1)]?.simAt,position:model.position.toArray(),eye:camera.position.toArray(),hits:ray.intersectObjects(meshes,false).map(h=>({id:h.object.name,distance:h.distance})),trace:camera.userData.cameraTrace};}
      clear&&=visible;finite&&=camera.position.toArray().every(Number.isFinite);r.advance(1000/60);
      model.updateMatrixWorld(true);baseKartBounds(model,kartBounds);kartBounds.getCenter(kartCenter).project(camera);
      if(!firstUnframed&&(Math.abs(kartCenter.x)>=1||Math.abs(kartCenter.y)>=1||kartCenter.z<=-1||kartCenter.z>=1))firstUnframed={frame,position:model.position.toArray(),eye:camera.position.toArray(),centre:kartCenter.toArray(),trace:camera.userData.cameraTrace};
      framed&&=Math.abs(kartCenter.x)<1&&Math.abs(kartCenter.y)<1&&kartCenter.z> -1&&kartCenter.z<1;
    }
    check(label+' authority supplies actual supported elevation',maxHeight>minHeight&&(y>0||airborne>1));
    // The original Garden/Harbor open trajectories preserve the chase exactly.
    // Other paths pass actual decks/ramp faces behind the vehicle and need
    // clearance; those are checked against independent visibility/framing.
    if(openChase)check(label+' unobstructed follow position and look-ahead retain the original easing',unchanged);
    if(firstHidden)console.log('AUTHORED_ROUTE_CAMERA_HIDDEN '+JSON.stringify({label,firstHidden}));
    if(firstUnframed)console.log('AUTHORED_ROUTE_CAMERA_UNFRAMED '+JSON.stringify({label,firstUnframed}));
    check(label+' finite camera-to-kart sight never crosses an authored collider',clear&&finite);
    check(label+' real loaded kart centre remains in the viewport',framed);
    r.view.dispose();release(meshes);
  }
}
// Invisible shield/flame and mounted combat props are not base kart bounds.
function isKartCameraCore(mesh){
  if(!mesh.isMesh)return false;
  for(let parent=mesh;parent;parent=parent.parent)if(parent.name==='KartDriver')return true;
  return /^(Chassis|DriverHelmet|DriverVisor|DriverTorso|FrontBumper|SidePod|WheelMesh)/.test(mesh.name);
}
function baseKartBounds(model,box){
  box.makeEmpty();const meshBox=new THREE.Box3();
  model.userData.kart.inner.traverse(mesh=>{if(!mesh.isMesh||mesh.name==='BoostFlame'||mesh.name==='RespawnShield'||mesh.name==='InvincibilityTrail'||mesh.name==='KartContactShadow')return;for(let p=mesh.parent;p&&p!==model.userData.kart.inner;p=p.parent)if(p.userData.combat)return;mesh.geometry.computeBoundingBox();box.union(meshBox.copy(mesh.geometry.boundingBox).applyMatrix4(mesh.matrixWorld));});return box;
}
// Public authority pose captured during native Harbor ramp-side reverse contact.
// Real model bounds must remain on screen when world clearance shortens the eye.
for(const aspect of [1,390/844,844/390,568/320,1024/768])for(const frameMs of [1000/60,1000/30])for(const recorded of [{"position":{"x":37.446,"y":0.645,"z":51.894},"rotation":{"x":-0.001351,"y":-0.707095,"z":-0.001351,"w":0.707116},"wheels":[{"length":0.2486,"rotation":477.4126,"steering":0},{"length":0.2486,"rotation":489.143,"steering":0},{"length":0.2412,"rotation":395.4326,"steering":0},{"length":0.2412,"rotation":405.4947,"steering":0}]},{"position":{"x":37.38,"y":0.643,"z":56.337},"rotation":{"x":-0.002653,"y":-0.727211,"z":-0.000202,"w":0.686409},"wheels":[{"length":0.2416,"rotation":434.0259,"steering":0},{"length":0.2505,"rotation":447.5775,"steering":0},{"length":0.2339,"rotation":358.8253,"steering":0},{"length":0.2428,"rotation":370.2884,"steering":0}]},{"position":{"x":37.277,"y":0.643,"z":49.86},"rotation":{"x":-0.000541,"y":-0.64974,"z":-0.002149,"w":0.760153},"wheels":[{"length":0.2499,"rotation":432.5876,"steering":0},{"length":0.2435,"rotation":444.1057,"steering":0},{"length":0.2429,"rotation":357.7022,"steering":0},{"length":0.2366,"rotation":367.4816,"steering":0}]},{"position":{"x":40.491,"y":0.645,"z":-46.551},"rotation":{"x":-2.7e-05,"y":0.999998,"z":0.001891,"w":0},"wheels":[{"length":0.2486,"rotation":286.2199,"steering":0},{"length":0.2485,"rotation":274.2796,"steering":0},{"length":0.2413,"rotation":236.7762,"steering":0},{"length":0.2412,"rotation":226.4877,"steering":0}]}]){
  const map=elevatedMap('harbor'),r=rig({graphics:true,colliders:map.colliders,aspect}),snapshot=base();
  snapshot.mapId='harbor';snapshot.karts[0].pose=structuredClone(recorded);
  r.render(snapshot);const gl=await r.settle(),camera=gl.built.camera,model=gl.built.scene.children.find(o=>o.name==='GiggleKart');
  let framed=true,fullBounds=true,stable=true;const box=new THREE.Box3(),center=new THREE.Vector3(),corner=new THREE.Vector3(),previous=new THREE.Vector3();
  for(let frame=0;frame<90;frame++){
    r.frame(frameMs/1000);camera.updateMatrixWorld();model.updateMatrixWorld(true);
    baseKartBounds(model,box);box.getCenter(center);center.project(camera);
    framed&&=Math.abs(center.x)<1&&Math.abs(center.y)<1&&center.z>-1&&center.z<1;
    if(frame>30){for(let i=0;i<8;i++){corner.set(i&1?box.max.x:box.min.x,i&2?box.max.y:box.min.y,i&4?box.max.z:box.min.z).project(camera);fullBounds&&=Math.abs(corner.x)<1&&Math.abs(corner.y)<1&&corner.z> -1&&corner.z<1;}stable&&=camera.position.distanceTo(previous)<.01;}previous.copy(camera.position);
    r.advance(frameMs);
  }
  check(Math.round(1000/frameMs)+'fps recorded Harbor contact keeps real loaded kart center in the viewport',framed);
  check(Math.round(1000/frameMs)+'fps side fallback frames whole loaded model bounds',fullBounds);
  check(Math.round(1000/frameMs)+'fps stationary contact does not toggle selected side',stable);
  const solids=map.colliders.map(d=>{const m=new THREE.Mesh(elevatedSolidGeometry(THREE,d),new THREE.MeshBasicMaterial());m.position.copy(d.position);if(d.rotation)m.quaternion.copy(d.rotation);m.updateMatrixWorld();return m;}),ray=new THREE.Raycaster(),point=new THREE.Vector3(),direction=new THREE.Vector3();
  let coreClear=true,vertices=0;
  // Independent oracle checks every actual core vertex, stronger than the
  // runtime's cached extrema. Rear bumper wall-contact patch is excluded.
  model.userData.kart.inner.traverse(mesh=>{if(!isKartCameraCore(mesh))return;const positions=mesh.geometry.attributes.position;for(let i=0;i<positions.count;i++){point.fromBufferAttribute(positions,i).applyMatrix4(mesh.matrixWorld);point.y=Math.max(.03,point.y);direction.subVectors(point,camera.position);ray.far=Math.max(0,direction.length()-.03);ray.set(camera.position,direction.normalize());coreClear&&=ray.intersectObjects(solids,false).length===0;vertices++;}});
  check(Math.round(1000/frameMs)+'fps side contact clears every real chassis/driver/wheel vertex except contact bumper',coreClear&&vertices>2000);
  const coreSamples=[];model.userData.kart.inner.traverse(mesh=>{if(!isKartCameraCore(mesh))return;const positions=mesh.geometry.attributes.position,indices=new Set();for(let axis=0;axis<3;axis++){let min=0,max=0;for(let i=1;i<positions.count;i++){if(positions.getComponent(i,axis)<positions.getComponent(min,axis))min=i;if(positions.getComponent(i,axis)>positions.getComponent(max,axis))max=i;}indices.add(min);indices.add(max);}for(const index of indices)coreSamples.push({mesh,local:new THREE.Vector3().fromBufferAttribute(positions,index)});});
  const contactPosition=model.position.clone(),contactNose=new THREE.Vector3(0,0,1).applyQuaternion(model.quaternion);contactNose.y=0;contactNose.normalize();
  let approachSafe=true,transitFramed=true,transitCoreClear=true,firstHidden=null,firstUnframed=null,orbitSafe=true,maxAngular=0,maxRadial=0,corrections=[],maxStep=0,peak=null,legs=[{maxStep:0},{maxStep:0}];const previousEye=camera.position.clone(),previousModel=model.position.clone();
  // Continuous public-pose fixture, not a native input or fabricated acceptance.
  // Leaving/returning by 10m tests entry, stable side retention and recovery.
  for(let leg=0;leg<2;leg++)for(let i=0;i<=120;i++){
    const offset=(leg===0?i:120-i)/12;snapshot.simAt+=frameMs;snapshot.simTick++;snapshot.karts[0].pose.position=contactPosition.clone().addScaledVector(contactNose,offset);r.render(snapshot);r.frame(frameMs/1000);r.advance(frameMs);
    camera.updateMatrixWorld();model.updateMatrixWorld(true);baseKartBounds(model,box);for(let b=0;b<8;b++){corner.set(b&1?box.max.x:box.min.x,b&2?box.max.y:box.min.y,b&4?box.max.z:box.min.z).project(camera);const inside=Math.abs(corner.x)<1&&Math.abs(corner.y)<1&&corner.z>-1&&corner.z<1;if(!inside&&!firstUnframed)firstUnframed={leg,i,offset,position:model.position.toArray(),eye:camera.position.toArray(),ndc:corner.toArray(),sideYaw:camera.userData.cameraTrace.sideYaw};transitFramed&&=inside;}
    for(const sample of coreSamples){point.copy(sample.local).applyMatrix4(sample.mesh.matrixWorld);point.y=Math.max(.03,point.y);direction.subVectors(point,camera.position);ray.far=Math.max(0,direction.length()-.03);ray.set(camera.position,direction.normalize());const clear=ray.intersectObjects(solids,false).length===0;if(!clear&&!firstHidden)firstHidden={leg,i,offset,name:sample.mesh.name};transitCoreClear&&=clear;}
    const trace=camera.userData.cameraTrace,pre=new THREE.Vector3().fromArray(trace.preClearEye),oldOffset=previousEye.clone().sub(previousModel),newOffset=pre.clone().sub(model.position);
    const angular=Math.abs(Math.atan2(Math.sin(Math.atan2(newOffset.z,newOffset.x)-Math.atan2(oldOffset.z,oldOffset.x)),Math.cos(Math.atan2(newOffset.z,newOffset.x)-Math.atan2(oldOffset.z,oldOffset.x)))),radial=Math.abs(Math.hypot(newOffset.x,newOffset.z)-Math.hypot(oldOffset.x,oldOffset.z));
    if(trace.sideSettling){maxAngular=Math.max(maxAngular,angular);maxRadial=Math.max(maxRadial,radial);orbitSafe&&=angular<=Math.PI/2*(frameMs/1000)+1e-6&&radial<=8.5*Math.PI/2*(frameMs/1000)+1e-6;}
    const correction=pre.distanceTo(camera.position);if(correction>1e-6)corrections.push({leg,i,offset,correction});previousModel.copy(model.position);
    approachSafe&&=camera.position.toArray().every(Number.isFinite);const step=camera.position.distanceTo(previousEye);if(step>legs[leg].maxStep)legs[leg]={maxStep:step,i,offset};if(step>maxStep){maxStep=step;peak={leg,i,offset,position:snapshot.karts[0].pose.position,before:previousEye.toArray(),after:camera.position.toArray()};}previousEye.copy(camera.position);
  }

  console.log('CAMERA_TRANSITION '+JSON.stringify({aspect,fps:Math.round(1000/frameMs),contact:recorded.position,maxStep,peak,legs,firstUnframed,firstHidden,maxAngular,maxRadial,corrections}));
  check(Math.round(1000/frameMs)+'fps continuous contact departure/return avoids abrupt side-to-rear chord',approachSafe&&orbitSafe);
  check(Math.round(1000/frameMs)+'fps continuous recovery and re-obstruction keep whole kart bounds framed',transitFramed);
  check(Math.round(1000/frameMs)+'fps continuous recovery and re-obstruction retain chassis/driver/wheel surface LOS',transitCoreClear&&coreSamples.length>70&&coreSamples.some(s=>s.mesh.parent?.name==='KartDriver'||s.mesh.parent?.parent?.name==='KartDriver'));
  const preparedAllocations=r.allocations().graphics;for(let i=0;i<10;i++){r.frame(frameMs/1000);r.advance(frameMs);}check(Math.round(1000/frameMs)+'fps stationary side search allocates no new Three objects',r.allocations().graphics===preparedAllocations);
  for(const solid of solids){solid.geometry.dispose();solid.material.dispose();}
  // Real pose playback moves out from the contact without changing the life.
  // Recovery must converge to the untouched original chase, not latch overhead.
  for(let i=0;i<=240;i++){snapshot.simAt+=frameMs;snapshot.simTick++;snapshot.karts[0].pose.position=contactPosition.clone().addScaledVector(contactNose,i/12);r.render(snapshot);r.frame(frameMs/1000);r.advance(frameMs);}
  let finiteRecovery=true;for(let i=0;i<360;i++){r.frame(frameMs/1000);finiteRecovery&&=camera.position.toArray().every(Number.isFinite);r.advance(frameMs);}
  const recoveredNose=new THREE.Vector3(0,0,1).applyQuaternion(model.quaternion);recoveredNose.y=0;recoveredNose.normalize();const normalEye=model.position.clone().addScaledVector(recoveredNose,-8.5);normalEye.y+=4.4;
  check(Math.round(1000/frameMs)+'fps contact departure recovers original chase with finite easing',finiteRecovery&&camera.position.distanceTo(normalEye)<.001);
  const normalTarget=model.position.clone().addScaledVector(recoveredNose,4);normalTarget.y+=1.4;
  check(Math.round(1000/frameMs)+'fps recovered original chase restores forward look-ahead',camera.getWorldDirection(new THREE.Vector3()).dot(normalTarget.sub(camera.position).normalize())>.999999);
  // Reverse away from the old obstacle after a continuous half-turn in open
  // space. Recovery must not retain side mode merely because speed is negative.
  const openPosition=model.position.clone(),openRotation=model.quaternion.clone(),turnAxis=new THREE.Vector3(0,1,0);
  for(let i=1;i<=120;i++){snapshot.simAt+=frameMs;snapshot.simTick++;snapshot.karts[0].pose.rotation=new THREE.Quaternion().setFromAxisAngle(turnAxis,Math.PI*i/120).multiply(openRotation);r.render(snapshot);r.frame(frameMs/1000);r.advance(frameMs);}
  const reverseNose=new THREE.Vector3(0,0,1).applyQuaternion(model.quaternion);reverseNose.y=0;reverseNose.normalize();
  for(let i=1;i<=120;i++){snapshot.simAt+=frameMs;snapshot.simTick++;snapshot.karts[0].pose.position=openPosition.clone().addScaledVector(reverseNose,-i/12);r.render(snapshot);r.frame(frameMs/1000);r.advance(frameMs);}
  for(let i=0;i<360;i++){r.frame(frameMs/1000);r.advance(frameMs);}
  const reverseEye=model.position.clone().addScaledVector(reverseNose,-8.5);reverseEye.y+=4.4;
  check(Math.round(1000/frameMs)+'fps unrelated open-space reversing and stop regain original chase without side latch',camera.position.distanceTo(reverseEye)<.001&&!camera.userData.cameraTrace.sideMode);

  r.view.dispose();
}
// Presentation trails must never enlarge the base car, including when hidden.
{
  const r=rig({graphics:true});r.render();const gl=await r.settle(),model=gl.built.scene.children.find(o=>o.name==='GiggleKart');
  // The renderer double does not perform the first real scene traversal.
  model.updateMatrixWorld(true);
  const before=baseKartBounds(model,new THREE.Box3()).clone();
  for(const trail of model.userData.kart.invincibilityTrails){trail.position.x+=100;trail.visible=false;}
  model.updateMatrixWorld(true);
  const after=baseKartBounds(model,new THREE.Box3());
  check('hidden invincibility trails do not size the base-art framing bounds',before.min.equals(after.min)&&before.max.equals(after.max));
  r.view.dispose();
}
// Actual public authority samples from the fresh native initial approach.
// Unlike the contact-start fixtures above, this begins with normal chase.
for(const aspect of [1,390/844,844/390,568/320,1024/768])for(const frameMs of [1000/60,1000/30]){
  const packets=JSON.parse(fs.readFileSync(repo+'/test/fixtures/orbital-final-native-entry-public-segment.json','utf8'));
  const map=elevatedMap('harbor'),r=rig({graphics:true,colliders:map.colliders,aspect}),snapshot=base();snapshot.mapId='harbor';snapshot.karts[0].pose=packets[0].pose;r.render(snapshot);const gl=await r.settle(),camera=gl.built.camera,model=gl.built.scene.children.find(o=>o.name==='GiggleKart'),box=new THREE.Box3(),corner=new THREE.Vector3();
  const solids=map.colliders.map(d=>{const m=new THREE.Mesh(elevatedSolidGeometry(THREE,d),new THREE.MeshBasicMaterial());m.position.copy(d.position);if(d.rotation)m.quaternion.copy(d.rotation);m.updateMatrixWorld();return m;}),ray=new THREE.Raycaster(),point=new THREE.Vector3(),direction=new THREE.Vector3(),samples=[];
  model.userData.kart.inner.traverse(mesh=>{if(!isKartCameraCore(mesh))return;const positions=mesh.geometry.attributes.position,indices=new Set();for(let axis=0;axis<3;axis++){let min=0,max=0;for(let i=1;i<positions.count;i++){if(positions.getComponent(i,axis)<positions.getComponent(min,axis))min=i;if(positions.getComponent(i,axis)>positions.getComponent(max,axis))max=i;}indices.add(min);indices.add(max);}for(const index of indices)samples.push({mesh,local:new THREE.Vector3().fromBufferAttribute(positions,index)});});
  let next=0,framed=true,coreClear=true,firstFailure=null,firstHidden=null,maxStep=0,peak=null,sideMaxStep=0,sidePeak=null,maxAngular=0,maxRadial=0,orbitSafe=true,corrections=[],previousEye=null,previousModel=null;
  for(let elapsed=0;elapsed<=packets.at(-1).elapsedMs;elapsed+=frameMs){
    while(next<packets.length&&packets[next].elapsedMs<=elapsed){snapshot.simAt=packets[next].simAt;snapshot.simTick++;snapshot.karts[0].pose=packets[next++].pose;r.render(snapshot);}
    r.frame(frameMs/1000);r.advance(frameMs);camera.updateMatrixWorld();model.updateMatrixWorld(true);baseKartBounds(model,box);
    model.userData.kart.inner.traverse(mesh=>{if(!mesh.isMesh||mesh.name==='BoostFlame'||mesh.name==='RespawnShield'||mesh.name==='InvincibilityTrail'||mesh.name==='KartContactShadow')return;for(let p=mesh.parent;p&&p!==model.userData.kart.inner;p=p.parent)if(p.userData.combat)return;mesh.geometry.computeBoundingBox();const box=mesh.geometry.boundingBox;for(let b=0;b<8;b++){corner.set(b&1?box.max.x:box.min.x,b&2?box.max.y:box.min.y,b&4?box.max.z:box.min.z).applyMatrix4(mesh.matrixWorld).project(camera);const inside=Math.abs(corner.x)<1&&Math.abs(corner.y)<1&&corner.z>-1&&corner.z<1;{if(!inside&&!firstFailure)firstFailure={elapsed,name:mesh.name,position:model.position.toArray(),eye:camera.position.toArray(),ndc:corner.toArray(),trace:camera.userData.cameraTrace};framed&&=inside;}}});
    for(const sample of samples){point.copy(sample.local).applyMatrix4(sample.mesh.matrixWorld);point.y=Math.max(.03,point.y);direction.subVectors(point,camera.position);ray.far=Math.max(0,direction.length()-.03);ray.set(camera.position,direction.normalize());const clear=ray.intersectObjects(solids,false).length===0;if(!clear&&!firstHidden)firstHidden={elapsed,name:sample.mesh.name};coreClear&&=clear;}
    const trace=camera.userData.cameraTrace,pre=new THREE.Vector3().fromArray(trace.preClearEye);
    if(previousEye){const step=camera.position.distanceTo(previousEye);if(step>maxStep){maxStep=step;peak={elapsed,position:model.position.toArray(),before:previousEye.toArray(),after:camera.position.toArray(),sideSettling:trace.sideSettling,sideYaw:trace.sideYaw};}if(trace.sideSettling&&step>sideMaxStep){sideMaxStep=step;sidePeak={elapsed,position:model.position.toArray(),sideYaw:trace.sideYaw};}if(trace.sideSettling){const old=previousEye.clone().sub(previousModel),offset=pre.clone().sub(model.position),angular=Math.abs(Math.atan2(Math.sin(Math.atan2(offset.z,offset.x)-Math.atan2(old.z,old.x)),Math.cos(Math.atan2(offset.z,offset.x)-Math.atan2(old.z,old.x)))),radial=Math.abs(Math.hypot(offset.x,offset.z)-Math.hypot(old.x,old.z));maxAngular=Math.max(maxAngular,angular);maxRadial=Math.max(maxRadial,radial);orbitSafe&&=angular<=Math.PI/2*frameMs/1000+1e-6&&radial<=8.5*Math.PI/2*frameMs/1000+1e-6;}}
    const correction=pre.distanceTo(camera.position);if(correction>1e-6)corrections.push({elapsed,correction});previousEye=camera.position.clone();previousModel=model.position.clone();
  }
  console.log('NATIVE_ENTRY_REPLAY '+JSON.stringify({aspect,fps:Math.round(1000/frameMs),durationMs:packets.at(-1).elapsedMs,framed,coreClear,firstFailure,firstHidden,maxStep,peak,sideMaxStep,sidePeak,maxAngular,maxRadial,corrections,scope:'Recorded public authority poses replayed in a renderer/world unit double; not native acceptance.'}));
  check(Math.round(1000/frameMs)+'fps actual native normal-to-contact approach keeps whole base kart framed',framed);check(Math.round(1000/frameMs)+'fps recorded initial entry retains core surface LOS',coreClear&&samples.length>100);check(Math.round(1000/frameMs)+'fps recorded initial entry retains bounded relative orbit',orbitSafe);for(const solid of solids){solid.geometry.dispose();solid.material.dispose();}r.view.dispose();
}
{
  const r=rig({graphics:true}),snapshot=base();r.render(snapshot);const gl=await r.settle(),camera=gl.built.camera;
  for(const [width,height] of [[390,844],[844,390],[568,320],[1024,768],[200,1000],[390,844],[844,390]]){camera.aspect=width/height;camera.updateProjectionMatrix();r.frame();const expected=Math.min(80,Math.max(52,2*Math.atan(Math.tan(Math.PI/10)/camera.aspect)*180/Math.PI));check(width+'x'+height+' orientation resize updates the bounded portrait lens',Math.abs(camera.fov-expected)<1e-10);check(width+'x'+height+' lens change preserves a finite projection',camera.projectionMatrix.elements.every(Number.isFinite));}
  check('raised driving view leaves room around the kart',camera.zoom===0.85);
  r.render({...snapshot,you:'watcher',youDrive:false});r.frame();
  check('raised spectators keep the follow lens',camera.zoom===1);
  r.view.dispose();
}
// Raised launch tubes now share classic solid shells. A reveal at the muzzle
// must keep the eye outside the shell and outside the kart on both viewports.
for(const mapId of ['skyport','foundry'])for(const aspect of [1.6,390/844]){
  const map=elevatedMap(mapId),c=map.features.cannons[0],r=rig({graphics:true,colliders:map.colliders,aspect}),s={...base(),mapId,mapRevision:map.revision,simAt:0};
  const physics=PHYSICS.createKartPhysics(RAPIER,CONFIG);elevatedStatics(map).forEach(d=>physics.addStatic(d));
  const flight={c:0,t:0,x:c.x,y:c.y+.75,z:c.z,a:c.angle,ly:c.land.y+.75,life:1};
  s.karts[0].flight={...flight};s.karts[0].pose={...flightPose(c,flight),epoch:1,speed:20,grounded:false,wheels:[]};
  r.render(s);const gl=await r.settle(),camera=gl.built.camera,model=gl.built.scene.children.find(o=>o.name==='GiggleKart'),box=new THREE.Box3(),centre=new THREE.Vector3();let firstFailure=null,minDistance=Infinity;
  for(let i=0;i<=36;i++){
    flight.t=i/60;s.simAt=i*1000/60;s.simTick=i;s.karts[0].flight={...flight};s.karts[0].pose={...flightPose(c,flight),epoch:1,speed:20,grounded:false,wheels:[]};r.render(s);r.frame();r.advance(1000/60);
    if(!model.visible)continue;
    camera.updateMatrixWorld();model.updateMatrixWorld(true);baseKartBounds(model,box);box.getCenter(centre).project(camera);
    const distance=camera.position.distanceTo(model.position);minDistance=Math.min(minDistance,distance);
    if(!firstFailure&&(distance<6||Math.abs(centre.x)>=1||Math.abs(centre.y)>=1||physics.overlapsStatic(camera.position,{x:0,y:0,z:0,w:1},{x:.12,y:.12,z:.12})))firstFailure={i,distance,centre:centre.toArray(),eye:camera.position.toArray(),model:model.position.toArray()};
  }
  if(firstFailure)console.log('RAISED_MUZZLE_CAMERA '+JSON.stringify({mapId,aspect,firstFailure,minDistance}));
  check(mapId+' '+aspect+' cannon muzzle keeps the kart framed and eye clear',!firstFailure);r.view.dispose();physics.dispose();
}
// No bounded side ray can frame a car inside this low, enclosed passage.
// Reject every candidate while preserving closest-clear camera/ceiling safety.
for(const frameMs of [1000/60,1000/30]){
  const colliders=[{id:'left',shape:'box',half:{x:.3,y:5,z:3},position:{x:-2,y:5,z:0}},{id:'right',shape:'box',half:{x:.3,y:5,z:3},position:{x:2,y:5,z:0}},{id:'rear',shape:'box',half:{x:3,y:5,z:.3},position:{x:0,y:5,z:-2}},{id:'front',shape:'box',half:{x:3,y:5,z:.3},position:{x:0,y:5,z:2}},{id:'ceiling',shape:'deck',half:{x:3,y:.3,z:3},position:{x:0,y:4,z:0}}];
  const r=rig({graphics:true,colliders}),snapshot=base();r.render(snapshot);const gl=await r.settle();let safe=true;for(let i=0;i<90;i++){r.frame(frameMs/1000);const p=gl.built.camera.position;safe&&=p.toArray().every(Number.isFinite)&&Math.abs(p.x)<1.7&&Math.abs(p.z)<1.7&&p.y<3.7;r.advance(frameMs);}
  check(Math.round(1000/frameMs)+'fps failed side candidates retain clear eye beneath enclosed ceiling',safe);r.view.dispose();
}
{
  const r=rig({graphics:true});r.render();await r.settle();r.frame();
  const built=r.loads.at(-1).handle.built;
  const trapSnapshot=base();
  for(const [i,kind] of ['mine','proximity','fakecrate','proximity'].entries()){
    trapSnapshot.simTick=100+i;trapSnapshot.simAt+=20;
    trapSnapshot.mines=[{id:'trap-'+i,kind,owner:'a',armed:true,radius:.41,position:{x:0,y:.425,z:0},normal:{x:0,y:1,z:0}}];
    r.render(trapSnapshot);r.frame();
    const active=built.scene.children.filter(o=>o.visible&&o.userData.combat?.type==='mine');
    check('live trap pool selects '+kind,active.length===1&&active[0].userData.combat.kind===kind);
  }
  trapSnapshot.mines=[];trapSnapshot.simTick++;r.render(trapSnapshot);r.frame();
  r.view.dispose();
}
console.log(JSON.stringify({pass:true,checks:results.length,results,scope:'Actual production view/dispatcher and scene frames with real Three.js kart/combat assets and authored collider triangles; held-input Rapier ramp/bridge trajectories. World/renderer/audio/mobile-stick doubles; no physical-phone or GPU timing claim.'},null,2));

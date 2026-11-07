import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {MeshoptDecoder} from '../public/vendor/three/libs/meshopt_decoder.mjs';
import {kartGarageHtml,createKartGarageUI,garagePreviewKey} from '../public/js/engines/kart-garage-ui.mjs';
import {createGarageThumbnail} from '../public/js/engines/kart-garage-thumbnail.mjs';
const state={mode:'battle',you:'one',youDrive:true,instanceId:'match',coins:35,garage:true,
  upgrades:{one:{engine:0,handling:0,reload:0}},garagePrices:{max:3,prices:[20,35,55]}};
const card=(html,id)=>html.match(new RegExp(`<article[^>]*data-part="${id}"[\\s\\S]*?</article>`))[0];
let html=kartGarageHtml(state,null,{color:0x21a9af,driver:'bunny'});
for(const id of ['engine','handling','reload']) {
  const part=card(html,id);
  assert.match(part,/data-state="affordable"/);
  assert.doesNotMatch(part,/<button[^>]*disabled/);
  assert.equal((part.match(/<i class="" aria-hidden/g)||[]).length,3);
  assert.match(part,/Level 0 of 3/);
  assert.match(part,/aria-describedby="pk-upgrade-reason-/);
}
assert.match(html,/aria-label="35 coins"/);
assert.match(html,/#21a9af/);assert.match(html,/🐰/);
assert.match(card(html,'engine'),/Speed bonus: 0% now, 5% next level/);
assert.match(card(html,'handling'),/Turn bonus: 0% now, 4% next level/);
assert.match(card(html,'reload'),/Less cooldown: 0% now, 6% next level/);
for(const [label,n] of [['KO',10],['Pickup',1],['Finish',5],['Win',15]]) assert.match(html,new RegExp(label+' <b>\\+'+n));
html=kartGarageHtml({...state,coins:15},null);
for(const id of ['engine','handling','reload']) {
  const part=card(html,id);assert.match(part,/data-state="unaffordable"/);assert.match(part,/<button[^>]*disabled/);assert.match(part,/Need 5 more coins/);
}
html=kartGarageHtml({...state,coins:999,upgrades:{one:{engine:3,handling:3,reload:3}}},null);
for(const id of ['engine','handling','reload']) {
  const part=card(html,id);assert.match(part,/data-state="maxed"/);assert.match(part,/>MAX<\/button>/);assert.match(part,/Fully upgraded/);
  assert.equal((part.match(/<i class="is-filled"/g)||[]).length,3);
  assert.doesNotMatch(part,/next level/);
}
assert.match(kartGarageHtml(state,'buy'),/aria-busy="true"/);
assert.equal(kartGarageHtml({...state,youDrive:false},null),'');
assert.equal(kartGarageHtml({...state,mode:'race'},null),'');
assert.match(kartGarageHtml({...state,garageResult:{ok:false,error:'<bad>'}},null),/&lt;bad&gt;/);
// Same preview is retained across DOM repaints. A look/level change gets one new still.
const nodes=new Map(),root={querySelector:key=>{if(!nodes.has(key))nodes.set(key,{});return nodes.get(key);}};
const ui=createKartGarageUI(),base={color:0x21a9af,driver:'bunny',levels:{engine:0}};
let draws=0;const draw=()=>{draws++;return 'data:image/png;base64,proof';};
ui.preview(root,garagePreviewKey(base),draw);ui.preview(root,garagePreviewKey(base),draw);
assert.equal(draws,1);assert.equal(nodes.get('.pk-garage-thumbnail').hidden,false);
ui.preview(root,garagePreviewKey({...base,levels:{engine:1}}),draw);assert.equal(draws,2);
ui.preview(root,'failed',()=>{draws++;throw Error('context lost');});ui.preview(root,'failed',draw);assert.equal(draws,3,'failed GPU still never retries every frame');
ui.dispose();
// Coin ticks are bounded and canceled on teardown. Reduced motion keeps the cue
// and confirmed value while skipping every movement.
const frames=new Map();let rafId=0,pops=0,cues=0;
globalThis.requestAnimationFrame=fn=>{frames.set(++rafId,fn);return rafId;};
globalThis.cancelAnimationFrame=id=>frames.delete(id);
const digits={textContent:'35'},animated={animate(){pops++;}},motionRoot={querySelector:selector=>selector==='.pk-wallet-digits'?digits:selector.startsWith('[data-part=')?{querySelector:()=>animated}:animated};
const motion=createKartGarageUI(),cueApi={cue(){cues++;}};
motion.paint(motionRoot,state,{},cueApi);assert.equal(pops,0,'mount stays quiet');
const upgraded={...state,coins:15,upgrades:{one:{engine:1}},garageResult:{ok:true,category:'engine',level:1,nonce:'buy'}};
motion.paint(motionRoot,upgraded,{bought:true},cueApi);assert.equal(cues,1);assert.equal(pops,4);
const advance=now=>{const pending=[...frames.values()];frames.clear();for(const f of pending)f(now);};
advance(0);assert.equal(digits.textContent,'35');advance(150);assert(Number(digits.textContent)<35&&Number(digits.textContent)>15);
advance(300);assert.equal(digits.textContent,'15');assert.equal(frames.size,0);
motion.paint(motionRoot,{...upgraded,coins:10},{},cueApi);assert.equal(frames.size,1);motion.dispose();assert.equal(frames.size,0);
const quiet=createKartGarageUI();quiet.paint(motionRoot,state,{reducedMotion:true},cueApi);const beforePops=pops;
quiet.paint(motionRoot,upgraded,{bought:true,reducedMotion:true},cueApi);assert.equal(pops,beforePops);assert.equal(frames.size,0);assert.equal(cues,2);quiet.dispose();
delete globalThis.requestAnimationFrame;delete globalThis.cancelAnimationFrame;
// Real shipped GLB, a renderer spy: the still uses the chosen paint and static
// upgrades, restores the arena render state and releases only owned resources.
await MeshoptDecoder.ready;
const b=readFileSync(new URL('../public/assets/karts/giggle-kart.meshopt.glb',import.meta.url));
const template=(await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'')).scene;
template.userData.driver='bunny';
let currentTarget=null,clearColor=new THREE.Color(0xabcdef),alpha=.8,scissorTest=true;
const viewport=new THREE.Vector4(1,2,300,200),scissor=new THREE.Vector4(4,5,100,80),expectedViewport=viewport.clone(),expectedScissor=scissor.clone();
let rendered,renderTarget;
const renderer={getRenderTarget:()=>currentTarget,setRenderTarget:t=>{currentTarget=t;},getClearColor:c=>c.copy(clearColor),getClearAlpha:()=>alpha,
  setClearColor:(c,a)=>{clearColor.set(c);alpha=a;},getViewport:v=>v.copy(viewport),getScissor:v=>v.copy(scissor),getScissorTest:()=>scissorTest,
  setViewport:(...args)=>args.length===1?viewport.copy(args[0]):viewport.set(...args),setScissor:v=>scissor.copy(v),setScissorTest:v=>{scissorTest=v;},
  clear(){},render:scene=>{rendered=scene.getObjectByName('GiggleKart');renderTarget=currentTarget;},readRenderTargetPixels:()=>{}};
const canvas={getContext:()=>({createImageData:()=>({data:new Uint8ClampedArray(512*320*4)}),putImageData(){}}),toDataURL:()=> 'data:image/png;base64,still'};
const preview=createGarageThumbnail(THREE,renderer,{kart:template,kartVariants:[template]},{canvas:()=>canvas});
assert.equal(preview.draw({...base,levels:{engine:2,handling:1,reload:3}}),canvas.toDataURL());
const kart=rendered.userData.kart;
assert.equal(kart.color,base.color);assert.equal(kart.flame.visible,true);
assert.equal(kart.steers[0].rotation.y,.12);
assert.equal(rendered.children.filter(c=>c.geometry?.type==='CylinderGeometry').length,3);
assert.equal(currentTarget,null);assert.equal(clearColor.getHex(),0xabcdef);assert.equal(alpha,.8);assert.equal(scissorTest,true);
assert.deepEqual(viewport,expectedViewport);assert.deepEqual(scissor,expectedScissor);
let paintDisposed=0,targetDisposed=0,templateDisposed=0;
kart.paint[0].addEventListener('dispose',()=>paintDisposed++);renderTarget.addEventListener('dispose',()=>targetDisposed++);
template.traverse(o=>o.geometry?.addEventListener('dispose',()=>templateDisposed++));
preview.dispose();assert.equal(paintDisposed,1);assert.equal(targetDisposed,1);assert.equal(templateDisposed,0);
assert.equal(preview.draw(base),null);
console.log('Kart garage UI: affordable, unavailable, MAX, preview caching and resource lifecycle pass');

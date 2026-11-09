// Hearts HUD, hit feedback and overhead heart pips shared by both kart
// renderers. A minimal element double stands in for the DOM; the overhead
// pips use the vendored Three.js so geometry/material identity is real.
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {paintKartHearts,createKartHitFeedback,landedText,kartEventCue,SHAKE_MS} from '../public/js/engines/kart-hearts.mjs';
import {createKartHealthBars} from '../public/js/engines/kart-health-bars.mjs';

let assertions=0;
const ok=(value,message)=>{assertions++;assert.ok(value,message);};
const eq=(actual,expected,message)=>{assertions++;assert.deepEqual(actual,expected,message);};

class Element {
  constructor(){this.style={};this.children=[];this.dataset={};this.attrs=new Map();this.textContent='';this.parent=null;this.pops=0;}
  get childElementCount(){return this.children.length;}
  get offsetWidth(){throw new Error('hit feedback must not force a synchronous layout');}
  // Only the classed elements kart-hearts writes become children; nested svg is art.
  set innerHTML(html){this.html=html;this.children=[...html.matchAll(/<(i|b) class="([^"]+)"/g)].map(([,tag,cls])=>Object.assign(new Element(),{tagName:tag,className:cls,parent:this}));}
  get innerHTML(){return this.html||'';}
  setAttribute(name,value){if(name==='data-pop')this.pops++;this.attrs.set(name,String(value));}
  getAttribute(name){return this.attrs.has(name)?this.attrs.get(name):null;}
  hasAttribute(name){return this.attrs.has(name);}
  removeAttribute(name){this.attrs.delete(name);}
  append(child){child.parent=this;this.children.push(child);}
  remove(){if(this.parent)this.parent.children=this.parent.children.filter(c=>c!==this);this.parent=null;}
}
globalThis.document={createElement:()=>new Element()};

/* ---------- authority HP bar ---------- */
{
 const {parseHTML}=await import('linkedom');const {document:doc}=parseHTML('<div></div>');const hud=doc.querySelector('div');
 let value=paintKartHearts(hud,{health:100,maxHealth:100,spawnSeq:1});eq(value,{hp:100,max:100,lost:0});eq(hud.getAttribute('aria-label'),'100 of 100 HP');
 const fill=hud.querySelector('.kart-hp-fill'),markup=hud.innerHTML;
 value=paintKartHearts(hud,{health:65,maxHealth:100,spawnSeq:1});eq(value.lost,35);eq(fill.style.transform,'scaleX(0.65)');
 eq(hud.getAttribute('aria-valuenow'),'65');ok(hud.hasAttribute('data-shake'));ok(hud.querySelector('.kart-hp-fill')===fill,'damage reuses the fill');
 paintKartHearts(hud,{health:16.666,maxHealth:100,spawnSeq:1});eq(hud.dataset.low,'true');eq(hud.querySelector('b').textContent,'17 HP','only display rounds');
 value=paintKartHearts(hud,{health:100,maxHealth:100,spawnSeq:2});eq(value.lost,0);eq(fill.style.transform,'scaleX(1)');
}

/* ---------- createKartHitFeedback ---------- */
{
  const host=new Element();
  const fx=createKartHitFeedback(host);
  const layer=host.children[0];
  ok(layer&&layer.className==='kart-hitfx'&&layer.getAttribute('aria-hidden')==='true','feedback layer is a decorative overlay');
  const [flash,marker,toast]=layer.children;
  eq([flash.className,marker.className,toast.className],['kart-hitfx-flash','kart-hitfx-marker','kart-hitfx-toast']);
  eq(fx.shake(500),{x:0,y:0},'no shake before any hit');
  fx.hurt(1000);
  ok(flash.hasAttribute('data-on'),'hurt flashes the screen edge');
  const first=fx.shake(1000);
  ok(Math.hypot(first.x,first.y)>0,'shake starts immediately');
  let previousBound=Infinity;
  for(let ms=0;ms<SHAKE_MS;ms+=10){
    const offset=fx.shake(1000+ms),t=ms/SHAKE_MS,bound=.22*(1-t)*(1-t);
    ok(Math.abs(offset.x)<=bound+1e-12&&Math.abs(offset.y)<=bound*.7+1e-12&&bound<previousBound,`shake decays within its envelope at ${ms}ms`);
    previousBound=bound;
  }
  eq(fx.shake(1000+SHAKE_MS),{x:0,y:0},'shake is exactly zero at SHAKE_MS');
  eq(fx.shake(1000+SHAKE_MS*4),{x:0,y:0},'shake stays zero afterwards');
  fx.landed('−2 HP');
  ok(marker.hasAttribute('data-on')&&toast.hasAttribute('data-on'),'landed shows marker and toast');
  eq(toast.textContent,'−2 HP','toast carries the landed text');
  fx.landed();eq(toast.textContent,'+1','toast defaults to +1');
  let plays=0;
  const animation={currentTime:99,play(){plays++;}};
  marker.getAnimations=()=>[animation];
  fx.landed();
  eq(animation.currentTime,0,'a repeated hit rewinds the existing animation');
  eq(plays,1,'a repeated hit reuses the browser animation without a layout read');
  fx.dispose();
  eq(host.children.length,0,'dispose removes the overlay');

  let reduced=true;
  const calm=createKartHitFeedback(new Element(),{reducedMotion:()=>reduced});
  calm.hurt(2000);
  for(let ms=0;ms<=SHAKE_MS;ms+=20)eq(calm.shake(2000+ms),{x:0,y:0},`reduced motion never shakes (${ms}ms)`);
  reduced=false;calm.hurt(3000);
  ok(Math.hypot(calm.shake(3000).x,calm.shake(3000).y)>0,'motion shake returns when reduced motion is off');
  reduced=true;
  eq(calm.shake(3010),{x:0,y:0},'turning on reduced motion mid-shake zeroes it at once');
}

/* ---------- landedText / kartEventCue ---------- */
{
  eq(landedText({type:'hit',damage:1}),'−1 HP');
  eq(landedText({type:'hit',damage:2}),'−2 HP','rocket/proximity hits show two hearts');
  eq(landedText({type:'hit'}),'−1 HP','missing damage still credits one heart');
  eq(landedText({type:'ko',damage:3}),'KO!');
  eq(landedText({type:'block'}),'Blocked');

  const you='a';
  eq(kartEventCue({type:'hit',pid:'b',other:'a'},you),'hurt','being hit plays hurt');
  eq(kartEventCue({type:'hit',pid:'a',other:'b'},you),'hitDing','landing a hit plays hit confirm');
  eq(kartEventCue({type:'hit',pid:'b',other:'c'},you),null,'other drivers trading hits stays quiet');
  eq(kartEventCue({type:'ko',pid:'a',other:'b'},you),'ko');
  eq(kartEventCue({type:'block',pid:'a',other:'b'},you),'block');
  eq(kartEventCue({type:'blast',weapon:'nuke'},you),'nukeBlast');
  eq(kartEventCue({type:'blast',weapon:'proximity'},you),'bombBlast');
  eq(kartEventCue({type:'blast',weapon:'missile'},you),'missileBlast');
  eq(kartEventCue({type:'blast',weapon:'missile'},you),'missileBlast');
  for(const weapon of ['machinegun','trishot','missile','missile','proximity','nuke'])eq(kartEventCue({type:'fire',weapon,pid:'b'},you),weapon,`${weapon} fire uses its own cue`);
  eq(kartEventCue({type:'pickup',pid:'a'},you),'pickup');
}

/* ---------- overhead HP bars ---------- */
{
 const scene=new THREE.Scene(),bars=createKartHealthBars(THREE,scene),at=new THREE.Vector3(4,1,-2),bar=bars.add('a');
 eq(bar.children.length,2,'one track and one fill');ok(bar.children[0].geometry===bar.children[1].geometry,'shared geometry');
 bars.update('a',{health:100,maxHealth:100},at);ok(bar.visible,'full HP is visible too');
 bars.update('a',{health:65,maxHealth:100},at);eq(bar.children[1].scale.x,.65);eq(bar.position.toArray(),[4,4,-2]);
 eq(bar.children[1].position.x,-1.2*.35,'left anchored fill');
 const good=bar.children[1].material;bars.update('a',{health:20,maxHealth:100},at);ok(bar.children[1].material!==good,'low HP colour');
 const camera=new THREE.PerspectiveCamera();camera.rotation.y=.4;bars.face(camera);ok(bar.quaternion.equals(camera.quaternion));
 for(const k of [{health:0,maxHealth:100},{health:40,maxHealth:100,respawn:2},{health:40,maxHealth:100,alive:false},{health:40,maxHealth:100,connected:false}]){bars.update('a',k,at);ok(!bar.visible,'dead/away bars hide');}
 bars.dispose();eq(scene.children.length,0);
}
console.log('KART_HP_HUD_PASS '+assertions);

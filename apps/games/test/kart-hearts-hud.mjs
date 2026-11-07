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
  get offsetWidth(){return 0;}
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

/* ---------- paintKartHearts ---------- */
{
  const hud=new Element();
  const full=hud=>hud.children.map(h=>h.dataset.full);
  const pops=hud=>hud.children.map(h=>h.pops);
  let result=paintKartHearts(hud,{health:3,maxHealth:3,spawnSeq:1});
  eq(hud.children.length,3,'renders one heart per maxHealth');
  ok(hud.children.every(h=>h.className==='kart-heart'),'each heart is a .kart-heart');
  eq(full(hud),['true','true','true'],'a full kart marks every heart data-full');
  eq(result,{hearts:3,max:3,lost:0},'first paint reports nothing lost');
  eq(pops(hud),[0,0,0],'first paint pops nothing');
  eq(hud.getAttribute('aria-label'),'3 of 3 hearts','aria-label names the hearts');
  eq(hud.dataset.guard,'false','no guard by default');
  eq(hud.dataset.low,'false');
  const markup=hud.innerHTML;

  result=paintKartHearts(hud,{health:2,maxHealth:3,spawnSeq:1});
  eq(result.lost,1,'one heart lost within the same life');
  eq(full(hud),['true','true','false'],'the lost heart empties from the right');
  eq(pops(hud),[0,0,1],'only the heart just lost pops');
  ok(hud.children[2].hasAttribute('data-pop'),'the popped heart carries data-pop');
  eq(hud.innerHTML,markup,'damage repaints attributes without rebuilding the row');

  paintKartHearts(hud,{health:2,maxHealth:3,spawnSeq:1});
  eq(pops(hud),[0,0,1],'an unchanged repaint never re-pops');

  result=paintKartHearts(hud,{health:0,maxHealth:3,spawnSeq:1,guard:true});
  eq(result.lost,2,'a two-heart hit loses two');
  eq(pops(hud),[1,1,1],'both hearts lost in that hit pop, the earlier one does not pop again');
  eq(full(hud),['false','false','false']);
  eq(hud.dataset.low,'true','one heart or fewer is low');
  eq(hud.dataset.guard,'true','guard reaches data-guard');
  eq(hud.getAttribute('aria-label'),'0 of 3 hearts, shield ready','guard is announced');

  result=paintKartHearts(hud,{health:3,maxHealth:3,spawnSeq:2});
  eq(result.lost,0,'respawn refill loses nothing');
  eq(full(hud),['true','true','true'],'respawn refills every heart');
  eq(pops(hud),[1,1,1],'refill after respawn pops nothing');
  eq(hud.dataset.guard,'false','KO/respawn guard clear is painted');
  eq(hud.dataset.life,'2');

  result=paintKartHearts(hud,{health:1,maxHealth:3,spawnSeq:3});
  eq(result.lost,0,'a new life painted already damaged pops nothing');
  eq(pops(hud),[1,1,1]);

  const fresh=new Element();
  paintKartHearts(fresh,{});
  eq(fresh.children.length,3,'missing authority fields default to three hearts');
  eq(fresh.getAttribute('aria-label'),'3 of 3 hearts');
  paintKartHearts(fresh,{health:2,maxHealth:5,spawnSeq:0});
  eq(fresh.children.length,5,'a different maxHealth rebuilds the row');
  eq(fresh.children.map(h=>h.pops),[0,0,0,0,0],'rebuilding never pops');
  eq(fresh.getAttribute('aria-label'),'2 of 5 hearts');
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
  fx.landed('+2');
  ok(marker.hasAttribute('data-on')&&toast.hasAttribute('data-on'),'landed shows marker and toast');
  eq(toast.textContent,'+2','toast carries the landed text');
  fx.landed();eq(toast.textContent,'+1','toast defaults to +1');
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
  eq(landedText({type:'hit',damage:1}),'+1');
  eq(landedText({type:'hit',damage:2}),'+2','rocket/proximity hits show two hearts');
  eq(landedText({type:'hit'}),'+1','missing damage still credits one heart');
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

/* ---------- overhead heart pips ---------- */
{
  const scene=new THREE.Scene(),bars=createKartHealthBars(THREE,scene),at=new THREE.Vector3(4,1,-2);
  const bar=bars.add('a');
  ok(bar.parent===scene&&bar.name==='KartHealth:a'&&!bar.visible,'a prepared bar is hidden');
  eq(bar.children.length,3,'three heart pips by default');
  ok(bar.children.every(h=>h.geometry===bar.children[0].geometry),'pips share one geometry');
  const fullMaterial=bar.children[0].material;
  ok(bar.children[1].material===fullMaterial&&bar.children[2].material!==fullMaterial,'a prepared bar holds both pip materials for warm-up');
  ok(bar.children.every(h=>h.material.depthTest&&!h.material.depthWrite&&!h.material.map),'pips are depth-tested and texture-free');
  eq(bars.add('a'),bar,'add is idempotent');

  bars.update('a',{health:3,maxHealth:3},at);ok(!bar.visible,'undamaged karts show no pips');
  bars.update('a',{health:2,maxHealth:3},at);
  ok(bar.visible,'a damaged kart shows pips');
  eq(bar.position.toArray(),[4,4,-2],'pips float three units above the kart');
  const emptyMaterial=bar.children[2].material;
  ok(emptyMaterial!==fullMaterial&&bar.children[0].material===fullMaterial&&bar.children[1].material===fullMaterial,'losing a heart swaps that pip to the empty material');
  bars.update('a',{health:1,maxHealth:3},at);
  eq(bar.children.map(h=>h.material===fullMaterial),[true,false,false],'a second loss swaps the next pip');
  ok(bar.children[1].material===emptyMaterial,'empty pips share one material');
  eq(bar.children.length,3,'swapping never rebuilds pips');
  for(const k of [{health:0,maxHealth:3},{health:1,maxHealth:3,respawn:2},{health:1,maxHealth:3,alive:false},{health:1,maxHealth:3,connected:false}]){
    bars.update('a',k,at);ok(!bar.visible,`pips hide for ${JSON.stringify(k)}`);
  }
  bars.update('a',{health:1,maxHealth:3},at,false);ok(!bar.visible,'roster disconnection hides pips');
  bars.update('a',{health:2,maxHealth:3},at);
  eq(bar.children.map(h=>h.material===fullMaterial),[true,true,false],'respawn-to-damaged repaints from authority');
  bars.update('a',{health:3,maxHealth:5},at);
  eq(bar.children.length,5,'a different maxHealth relays out the row');
  eq(bar.children.map(h=>h.material===fullMaterial),[true,true,true,false,false]);
  ok(Math.abs(bar.children[0].position.x+bar.children[4].position.x)<1e-9&&bar.children[2].position.x===0,'pips stay centred');
  const camera=new THREE.PerspectiveCamera();camera.quaternion.setFromEuler(new THREE.Euler(.3,.8,0));
  bars.face(camera);ok(bar.quaternion.equals(camera.quaternion),'visible pips face the camera');
  bars.remove('a');ok(bar.parent===null,'remove detaches the bar');
  bars.add('b');bars.dispose();ok(!scene.getObjectByName('KartHealth:b'),'dispose detaches every bar');
}

console.log(`KART_HEARTS_HUD_PASS: ${assertions} assertions; hearts paint/pop/refill/guard, bounded shake, landed text, event cues and heart pips`);

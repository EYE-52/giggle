// Presentation FX added for the world/kart/weapon polish: skid marks, incoming
// fire warnings, the knockout banner and burst, shot glow and kart rim light.
// Every effect is pooled, bounded and ends on its own timer.
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createKartSkids,kartSliding,SKID_LIMIT,SKID_LIFE} from '../public/js/engines/kart-skids.mjs';
import {createKartThreats,findKartThreats,MAX_ARROWS} from '../public/js/engines/kart-threats.mjs';
import {createKartHitFeedback,BANNER_MS} from '../public/js/engines/kart-hearts.mjs';
import {createKartImpactFX,IMPACT_FX_LIMITS} from '../public/js/engines/kart-impact-fx.mjs';
import {createKartCombatArt,SHOT_GLOW} from '../public/js/engines/kart-combat-art.mjs';

let assertions=0;
const ok=(value,message)=>{assertions++;assert.ok(value,message);};
const eq=(actual,expected,message)=>{assertions++;assert.deepEqual(actual,expected,message);};

class Element {
  constructor(){this.children=[];this.dataset={};this.attrs=new Map();this.style={cssText:'',opacity:'0',transform:''};this.textContent='';this.parent=null;this.runs=[];}
  get clientWidth(){return 800;} get clientHeight(){return 600;} get offsetWidth(){return 0;}
  set innerHTML(html){this.children=[...html.matchAll(/<(i|b) class="([^"]+)"/g)].map(([,tag,cls])=>Object.assign(new Element(),{tagName:tag,className:cls,parent:this}));}
  setAttribute(n,v){this.attrs.set(n,String(v));} removeAttribute(n){this.attrs.delete(n);} hasAttribute(n){return this.attrs.has(n);}
  append(...c){for(const x of c){x.parent=this;this.children.push(x);}}
  remove(){if(this.parent)this.parent.children=this.parent.children.filter(c=>c!==this);this.parent=null;}
  animate(frames,options){const run={frames,options,cancelled:false,cancel(){this.cancelled=true;}};this.runs.push(run);return run;}
}
globalThis.document={createElement:()=>new Element()};

/* ---------- skid marks: pooled ring buffer that fades on a fixed timer ---------- */
{
  const scene=new THREE.Scene(),skids=createKartSkids(THREE,scene,{groundAt:()=>.5});
  const mesh=skids.mesh;
  ok(mesh.isInstancedMesh&&mesh.count===SKID_LIMIT&&mesh.parent===scene,'one instanced mesh holds every mark');
  ok(mesh.visible,'marks are drawn for the loading warm-up');
  skids.update(1/60);ok(!mesh.visible,'no marks: the mesh hides after the first frame');
  const geometry=mesh.geometry,material=mesh.material;
  for(let i=0;i<40;i++){skids.track('a',0,i*.4,0,true);skids.update(1/60);}
  ok(skids.live()>40&&skids.live()<=80,'a straight slide lays a pair of marks per wheel spacing ('+skids.live()+')');
  ok(mesh.visible,'live marks are visible');
  const before=skids.live();
  skids.track('a',0,40,0,true);skids.update(1/60);
  eq(skids.live(),before,'a 24 m jump (respawn) never draws a streak across the map');
  skids.track('a',0,40,0,false);skids.track('a',0,41,0,true);skids.update(1/60);
  eq(skids.live(),before,'lifting off the slide starts a fresh trail');
  for(let i=0;i<4000;i++)skids.track('b',(i%2)*.4,i*.4,0,true);
  ok(skids.live()<=SKID_LIMIT,'the pool never exceeds its limit');
  eq(mesh.geometry,geometry,'no geometry is allocated while sliding');
  for(let i=0;i<Math.ceil(SKID_LIFE*60)+2;i++)skids.update(1/60);
  eq(skids.live(),0,'every mark fades out after SKID_LIFE');
  ok(!mesh.visible,'and the mesh hides again');
  skids.track('c',0,0,0,true);skids.track('c',0,1,0,true);skids.reset();eq(skids.live(),0,'reset clears every mark');
  skids.dispose();ok(!mesh.parent,'dispose detaches the mesh');
  ok(material.uniforms.skidTime.value>SKID_LIFE,'the shader fade clock advanced with frames');
  skids.dispose();ok(true,'dispose is idempotent');

  ok(kartSliding({drifting:true}),'an authored drift slides');
  ok(!kartSliding({respawn:1,drifting:true}),'a knocked-out kart never marks');
  ok(kartSliding({angle:0},{angle:0,physicalPose:{linearVelocity:{x:6,y:0,z:6},grounded:true}}),'a sideways slide marks');
  ok(!kartSliding({angle:0},{angle:0,physicalPose:{linearVelocity:{x:.2,y:0,z:14},grounded:true}}),'straight driving does not');
  ok(kartSliding({angle:0},{angle:0,physicalPose:{linearVelocity:{x:0,y:0,z:14},grounded:true}},true),'hard braking at speed marks');
  ok(!kartSliding({angle:0},{angle:0,physicalPose:{linearVelocity:{x:8,y:0,z:8},grounded:false}}),'airborne karts leave no marks');
}

/* ---------- incoming fire: what counts as a threat ---------- */
{
  const out=Array.from({length:6},()=>({})),me={x:0,y:0,z:0};
  const S=(extra)=>({zaps:[],mines:[],grenades:[],...extra});
  eq(findKartThreats(S({zaps:[{kind:'missile',owner:'b',targetId:'a',x:30,z:0,vx:-60,vz:0}]}),'a',me,out),1,'a seeker locked on you is a threat');
  ok(out[0].level>.3&&out[0].kind==='missile','locked seeker carries a level');
  eq(findKartThreats(S({zaps:[{kind:'missile',owner:'b',targetId:'c',x:30,z:0,vx:0,vz:60}]}),'a',me,out),0,'a seeker chasing someone else, flying away, is not');
  eq(findKartThreats(S({zaps:[{kind:'missile',owner:'b',x:0,z:-40,vx:0,vz:85}]}),'a',me,out),1,'a rocket aimed at you inside 1.6 s is a threat');
  eq(findKartThreats(S({zaps:[{kind:'missile',owner:'b',x:12,z:-40,vx:0,vz:85}]}),'a',me,out),0,'a rocket passing 12 m wide is not');
  eq(findKartThreats(S({zaps:[{kind:'missile',owner:'b',x:0,z:-400,vx:0,vz:85}]}),'a',me,out),0,'a rocket 4.7 s out is not yet');
  eq(findKartThreats(S({zaps:[{kind:'missile',owner:'a',x:0,z:-10,vx:0,vz:85}]}),'a',me,out),0,'your own rocket never warns you');
  eq(findKartThreats(S({zaps:[{kind:'machinegun',owner:'b',x:0,z:-10,vx:0,vz:110}]}),'a',me,out),0,'bullets get their glow, not a warning');
  eq(findKartThreats(S({mines:[{kind:'proximity',owner:'b',x:4,z:0,armed:true}]}),'a',me,out),1,'a rival proximity bomb nearby is a threat');
  eq(findKartThreats(S({mines:[{owner:'b',x:1,z:0,armed:true}]}),'a',me,out),0,'a plain mine is not flagged');
  eq(findKartThreats(S({grenades:[{kind:'nuke',owner:'b',x:10,z:0}]}),'a',me,out),1,'a live nuke within reach is a threat');
  eq(findKartThreats({projectiles:[{weapon:'missile',owner:'b',targetId:'a',position:{x:0,y:1,z:20},velocity:{x:0,y:0,z:-60}}],grenades:[{weapon:'proximity',owner:'b',position:{x:3,y:0,z:0},armed:true}]},'a',me,out),2,'elevated snapshots warn the same way');
  const many=S({zaps:Array.from({length:20},(_,i)=>({kind:'missile',owner:'b',targetId:'a',x:i,z:9,vx:0,vz:-60}))});
  eq(findKartThreats(many,'a',me,out),out.length,'the finder fills at most its pooled slots');
}

/* ---------- warning cues: ring, edge arrows, rising beep ---------- */
{
  const scene=new THREE.Scene(),host=new Element(),beeps=[];
  const camera=new THREE.PerspectiveCamera(60,800/600,.1,500);camera.position.set(0,4,-9);camera.lookAt(0,0,0);camera.updateMatrixWorld();
  const threats=createKartThreats(THREE,scene,host,{beep:l=>beeps.push(l)});
  const layer=host.children[0],arrows=layer.children;
  eq(arrows.length,MAX_ARROWS,'a fixed pool of edge arrows');
  ok(threats.ring.parent===scene&&threats.ring.position.y<-100,'the ring is drawn far below during warm-up');
  eq(threats.update({zaps:[]},'a',{x:0,y:0,z:0},camera,1000),0,'no threats');
  ok(!threats.ring.visible&&arrows.every(a=>a.style.opacity==='0'),'nothing shows without a threat');
  const behind={zaps:[{kind:'missile',owner:'b',targetId:'a',x:0,y:1,z:-30,vx:0,vz:60}]};
  eq(threats.update(behind,'a',{x:0,y:0,z:0},camera,2000),1,'a seeker from behind');
  ok(threats.ring.visible&&threats.ring.position.y<1,'the red ring sits under your kart');
  ok(Number(arrows[0].style.opacity)>.5&&/rotate/.test(arrows[0].style.transform),'an edge arrow points at the off-screen seeker');
  eq(beeps.length,1,'one warning beep');
  threats.update(behind,'a',{x:0,y:0,z:0},camera,2050);eq(beeps.length,1,'beeps are rate limited');
  threats.update(behind,'a',{x:0,y:0,z:0},camera,2700);eq(beeps.length,2,'and repeat while the threat lasts');
  const near={zaps:[{kind:'missile',owner:'b',targetId:'a',x:0,y:1,z:-3,vx:0,vz:60}]};
  threats.update(near,'a',{x:0,y:0,z:0},camera,3400);ok(beeps.at(-1)>beeps[0],'the beep rises as the seeker closes');
  const ahead={zaps:[{kind:'missile',owner:'b',targetId:'a',x:0,y:1,z:8,vx:0,vz:-60}]};
  threats.update(ahead,'a',{x:0,y:0,z:0},camera,4000);
  eq(arrows[0].style.opacity,'0','an on-screen threat needs no arrow');
  threats.update({zaps:[]},'a',{x:0,y:0,z:0},camera,4100);
  ok(!threats.ring.visible&&arrows.every(a=>a.style.opacity==='0'),'every cue clears itself when the threat goes');
  threats.update(behind,'a',null,camera,4200);ok(!threats.ring.visible,'a driver who is out sees nothing');
  threats.dispose();ok(!threats.ring.parent&&!layer.parent,'dispose removes ring and layer');
}

/* ---------- knockout banner: timed, replaces itself ---------- */
{
  const host=new Element(),fx=createKartHitFeedback(host);
  const banner=host.children[0].children.find(c=>c.className==='kart-hitfx-banner');
  eq(fx.knockout('Rival'),'Knocked out Rival!','the shooter sees who they knocked out');
  eq(banner.runs.length,1,'one timed animation');
  eq(banner.runs[0].options.duration,BANNER_MS,'it runs for BANNER_MS');
  eq(banner.runs[0].frames.at(-1).opacity,0,'and ends invisible');
  fx.knockout('Second');ok(banner.runs[0].cancelled&&banner.runs.length===2,'a new knockout replaces the running banner');
  fx.dispose();ok(banner.runs[1].cancelled,'dispose cancels the banner');
}

/* ---------- knockout burst: big, bright, bounded ---------- */
{
  const scene=new THREE.Scene(),fx=createKartImpactFX(THREE,scene);
  ok(fx.emit({type:'ko',id:'k1',pid:'a',position:{x:0,y:1,z:0}}),'a knockout bursts');
  ok(!fx.emit({type:'ko',id:'k1',pid:'a',position:{x:0,y:1,z:0}}),'the same knockout never bursts twice');
  const pools=scene.getObjectByName('KartImpactFX').children;
  ok(pools.some(p=>p.visible),'burst particles are live');
  for(let i=0;i<120;i++)fx.update(1/60);
  ok(pools.every(p=>!p.visible),'every burst particle ends within two seconds');
  ok(IMPACT_FX_LIMITS.embers>=40,'the ember pool holds a full knockout burst');
  fx.dispose();
}

/* ---------- shots glow; karts get a rim light ---------- */
{
  const art=createKartCombatArt(THREE,{});
  for(const kind of Object.keys(SHOT_GLOW)){
    const shot=art.projectile(kind),glow=shot.getObjectByName('ShotGlow');
    ok(glow?.isSprite&&glow.material.blending===THREE.AdditiveBlending&&glow.material.toneMapped===false,kind+' shot has a bright additive glow');
    eq(glow.material,art.projectile(kind).getObjectByName('ShotGlow').material,kind+' glow material is shared');
    for(let i=0;i<30;i++)art.animate(shot,1/60,i/60,false);
    ok(glow.scale.x<=SHOT_GLOW[kind].size*1.15,kind+' glow pulse stays bounded');
  }
  ok(SHOT_GLOW.nuke.size>SHOT_GLOW.rocket.size&&SHOT_GLOW.rocket.size>SHOT_GLOW.pulse.size,'heavier ordnance glows bigger');
  art.dispose();
}

console.log(`KART_WORLD_FX_PASS: ${assertions} assertions; skids, threat warnings, KO banner/burst, shot glow`);

// Synthetic public snapshots exercise the actual production views/renderer.
// This measures presentation first use, not authority, network or phone FPS.
import {createKartView} from '/js/engines/kart-view.js';
import {createElevatedKartView} from '/js/engines/kart-elevated-view.js';
import {elevatedMap} from '/js/engines/kart-elevated-maps.mjs';
import {WEAPON_IDS} from '/js/engines/kart-weapon-contract.mjs';
const id=new URLSearchParams(location.search).get('map')||'skyport',classic=id==='neon';
const map=classic?await(await fetch('/classic-map')).json():elevatedMap(id),p=map.spawns[0];
const root=document.querySelector('#app'),view=classic?createKartView({}):createElevatedKartView();
for(const href of view.styles){const link=document.createElement('link');link.rel='stylesheet';link.href=href;document.head.append(link);}
const glCalls={programs:0,buffers:0,textures:0},frames=[],raf=[],uses=[],first=new Set();let active=false,lastFrame,lastRaf;
let renderer,start=0,stage=-1,seq=0;
function kart(index=0,driver='fox'){
 const x=p.x+(index?index*3:0),z=p.z+(index?6:0),y=(p.y||0)+.75;
 return{id:'p'+index,pid:'p'+index,alive:true,connected:true,spawnSeq:1,controlEpoch:1,hits:0,deaths:0,health:100,maxHealth:100,nitro:1,weapon:null,ammo:0,shield:0,guard:false,look:{driver,paint:'coral'},
  x,z,angle:p.angle||0,speed:0,respawn:0,pose:{position:{x,y,z},rotation:{x:0,y:Math.sin((p.angle||0)/2),z:0,w:Math.cos((p.angle||0)/2)},linearVelocity:{x:0,y:0,z:0},angularVelocity:{x:0,y:0,z:0},epoch:1,speed:0,grounded:true}};
}
const snapshot={instanceId:'warmup-'+id,profile:classic?undefined:'elevated-combat-v1',mapId:id,mapRevision:map.revision,map:classic?map:{label:map.label},mode:'battle',palette:id==='neon'?'Starlight':'Daybreak',
 simTick:1,simAt:Date.now(),endsAt:Date.now()+600000,phase:classic?'drive':'live',you:'p0',youDrive:true,inputAck:{life:1,controlEpoch:1,receivedSeq:0,appliedInputSeq:0},
 events:[],featureEvents:[],physicalEvents:[],crates:[],stars:[],projectiles:[],zaps:[],mines:[],grenades:[],karts:['fox','bunny','panda','raccoon'].map((driver,i)=>kart(i,driver)),players:['fox','bunny','panda','raccoon'].map((name,i)=>({id:'p'+i,name})),
 projectileRadii:{machinegun:.22,trishot:.25,missile:.42,cannon:.48},combat:{staticSweepRadii:{machinegun:.22,trishot:.25,missile:.42,cannon:.48}}};
globalThis.kartStallProbe={
 renderer(r){
  renderer=r;const gl=r.getContext();
  for(const [name,key]of [['createProgram','programs'],['bufferData','buffers'],['texImage2D','textures'],['texStorage2D','textures']]){
    const original=gl[name].bind(gl);gl[name]=(...a)=>{if(active)glCalls[key]++;return original(...a);};
  }
  const render=r.render.bind(r);r.render=(...a)=>{const result=render(...a);if(active&&lastFrame!==undefined){frames.push({ms:performance.now()-lastFrame,draws:r.info.render.calls,triangles:r.info.render.triangles,stage});lastFrame=undefined;}return result;};
 },
 built(b){const frame=b.frame.bind(b);b.frame=(...a)=>{if(active)lastFrame=performance.now();return frame(...a);};},
};
const looks=Object.fromEntries(['fox','bunny','panda','raccoon'].map((driver,i)=>['p'+i,{driver,paint:'coral'}]));
const api={now:()=>Date.now(),send(){},name:id=>id,announce(){},context:()=>({isHost:false,sound:false,connected:true,looks})};
view.mount(root,api);view.update(root,snapshot,api);await view.ready();
const debug=renderer.getContext().getExtension('WEBGL_debug_renderer_info'),gpu=debug?renderer.getContext().getParameter(debug.UNMASKED_RENDERER_WEBGL):'unknown';
function packet(){
 snapshot.simTick++;snapshot.simAt=Date.now();
 if(active){
  const elapsed=(performance.now()-start)/1000,next=Math.floor(elapsed/1.2)%WEAPON_IDS.length,kind=WEAPON_IDS[next],change=next!==stage,me=snapshot.karts[0];
  me.weapon=kind;me.ammo=1;me.shield=kind==='supernova'?1:0;me.guard=kind==='supernova';me.rammingT=kind==='ram'?1:0;me.frostT=kind==='frost'?1:0;me.bladesT=kind==='blades'?1:0;me.supernovaT=kind==='supernova'?1:0;
  snapshot.projectiles=[];snapshot.zaps=[];snapshot.mines=[];snapshot.grenades=[];
  const position={x:p.x+2,y:(p.y||0)+1,z:p.z+5},direction={x:0,y:0,z:1};
  const shot={id:kind,weapon:kind,kind,owner:'p0',position,direction,velocity:{x:0,y:0,z:15},x:position.x,y:position.y,z:position.z,angle:0,vx:0,vy:0,vz:15,ttl:1,available:true};
  if(['machinegun','trishot','missile','cannon'].includes(kind)){snapshot.projectiles=[shot];snapshot.zaps=[shot];}
  if(kind==='mine')snapshot.mines=[{...shot,armed:true,normal:{x:0,y:1,z:0},radius:.41}];
  if(kind==='frost'||kind==='nuke')snapshot.grenades=[{...shot,fuse:1,warning:true,landed:false}];
  if(change){
    stage=next;if(!first.has(kind)){first.add(kind);uses.push({kind,at:elapsed,calls:{...glCalls}});}
    const fire={id:++seq,type:'fire',kind:'fire',pid:'p0',weapon:kind,position,direction,x:position.x,z:position.z};
    const blast={...fire,id:++seq,type:'blast',kind:'blast',tick:snapshot.simTick};
    snapshot.events=[fire,blast];snapshot.physicalEvents=[fire,blast];
  }else{snapshot.events=[];snapshot.physicalEvents=[];}
  snapshot.crates=[{id:'crate',x:p.x+4,z:p.z+3,position:{x:p.x+4,y:(p.y||0)+.6,z:p.z+3},available:true}];
  if(classic)snapshot.stars=[{id:'star',x:p.x-4,z:p.z+3,available:true}];
 }
 view.update(root,structuredClone(snapshot),api);
}
const timer=setInterval(packet,50);
function sample(t){if(active){if(lastRaf!==undefined)raf.push(t-lastRaf);lastRaf=t;}requestAnimationFrame(sample);}requestAnimationFrame(sample);
globalThis.kartStalls={ready:true,gpu,start(){start=performance.now();active=true;},result(){
 const quantile=(values,q)=>{const a=values.slice().sort((a,b)=>a-b);return a[Math.min(a.length-1,Math.floor(a.length*q))]||0;};
 const timing=values=>({n:values.length,p50:quantile(values,.5),p99:quantile(values,.99),max:Math.max(0,...values),over50:values.filter(v=>v>50).length,over100:values.filter(v=>v>100).length});
 return{map:id,gpu,glCalls,uses,frames:timing(frames.map(f=>f.ms)),raf:timing(raf),peakDraws:Math.max(0,...frames.map(f=>f.draws)),peakTriangles:Math.max(0,...frames.map(f=>f.triangles)),drivers:snapshot.karts.length};
},stop(){active=false;clearInterval(timer);view.dispose();}};

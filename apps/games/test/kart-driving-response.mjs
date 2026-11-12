import assert from 'node:assert/strict';
import RAPIER from '@dimforge/rapier3d-compat';
import CONFIG from '../public/js/engines/kart-physics-config.mjs';
import {createKartPhysics} from '../public/js/engines/kart-physics-core.mjs';
import {createClassicMotion} from '../public/js/engines/kart-classic-motion.mjs';
await RAPIER.init();

// Actual fixed-step Rapier rollouts. Flat ground separates handling from map
// relief; the existing map, ramp, drift, contact and prediction suites cover it.
function world(profile){
  const k={pid:'driver',x:0,z:0,angle:0,speed:0,nitro:1,input:{throttle:0,steer:0},spawnSeq:0,connected:true};
  const state={map:'driving-response-flat',mode:'battle',half:900,blocks:[],pads:[],surfaces:[],karts:[k],physicalEvents:[],physicalEventSeq:0};
  let step,dispose;
  if(profile==='classic'){
    const motion=createClassicMotion(RAPIER,CONFIG,state),connected=new Set([k.pid]);
    step=()=>{motion.advance(1/60,connected);state.physicalEvents.length=0;};
    dispose=()=>motion.dispose();
  }else{
    const physics=createKartPhysics(RAPIER,CONFIG);
    physics.addStatic({id:'floor',shape:'box',half:{x:900,y:1,z:900},position:{x:0,y:-1,z:0}});
    physics.addKart(k.pid,{position:{x:0,y:.75,z:0}});
    step=()=>{
      physics.applyIntent(k.pid,k.input);physics.step();const p=physics.pose(k.pid);
      k.physicalPose=p;k.speed=p.speed;k.x=p.position.x;k.z=p.position.z;
      k.angle=Math.atan2(2*(p.rotation.x*p.rotation.z+p.rotation.w*p.rotation.y),1-2*(p.rotation.x**2+p.rotation.y**2));
    };
    dispose=()=>physics.dispose();
  }
  for(let i=0;i<90;i++)step();
  return {k,step(input){k.input=input;step();return k;},dispose};
}
function measure(profile){
  const result={profile},forwardTop=profile==='classic'?20:26;
  {
    const w=world(profile);
    try{
      let to40,to80;
      for(let i=1;i<=600;i++){
        w.step({throttle:1,steer:0});
        if(to40===undefined&&w.k.speed>=40/3.6)to40=i/60;
        if(to80===undefined&&w.k.speed>=forwardTop*.8)to80=i/60;
      }
      const cruise=w.k.speed*3.6;
      let stopped,reverse10;
      for(let i=1;i<=360;i++){
        w.step({throttle:-1,steer:0});
        if(stopped===undefined&&w.k.speed<=0)stopped=i/60;
        if(reverse10===undefined&&w.k.speed<=-10/3.6)reverse10=i/60;
      }
      result.acceleration={to40,to80,cruise};result.forwardToReverse={stopped,reverse10};
    }finally{w.dispose();}
  }
  for(const [name,warmup]of [['normalTurn',60],['fullTurn',600]]){
    const w=world(profile);
    try{
      for(let i=0;i<warmup;i++)w.step({throttle:1,steer:0});
      const initialKmh=w.k.speed*3.6;
      let heading=0,path=0,minUp=1,ticks=0;
      for(;ticks<300&&Math.abs(heading)<Math.PI;ticks++){
        const old={x:w.k.x,z:w.k.z,angle:w.k.angle};w.step({throttle:1,steer:1});
        path+=Math.hypot(w.k.x-old.x,w.k.z-old.z);
        heading+=Math.atan2(Math.sin(w.k.angle-old.angle),Math.cos(w.k.angle-old.angle));
        minUp=Math.min(minUp,1-2*(w.k.physicalPose.rotation.x**2+w.k.physicalPose.rotation.z**2));
      }
      assert(Math.abs(heading)>=Math.PI,profile+' completes its U-turn');
      result[name]={initialKmh,radius:path/Math.abs(heading),seconds:ticks/60,minUp};
    }finally{w.dispose();}
  }
  {
    const w=world(profile);let to10;
    try{
      for(let i=1;i<=360;i++){
        w.step({throttle:-1,steer:0});
        if(to10===undefined&&w.k.speed<=-10/3.6)to10=i/60;
      }
      result.reverse={to10,topKmh:-w.k.speed*3.6};
    }finally{w.dispose();}
  }
  return result;
}
const classic=measure('classic'),elevated=measure('elevated-core');
// Prior measured classic response: .55s to 40 km/h, .95s to 80% top,
// 13.34m full-speed radius, 17.76 km/h reverse, .85s forward to reverse10.
assert(classic.acceleration.to40<=.5,'classic launch reaches 40 km/h promptly');
assert(classic.acceleration.to80<=.85,'classic launch reaches 80% of nominal top promptly');
assert(classic.acceleration.cruise>67&&classic.acceleration.cruise<71,'classic retains its existing forward speed range');
assert(classic.forwardToReverse.reverse10<=.8,'reverse input brakes then backs out promptly');
assert(classic.normalTurn.radius<11&&classic.fullTurn.radius<11,'classic corners are tighter at normal and full speed');
assert(classic.fullTurn.seconds<2,'classic full-speed U-turn is responsive');
for(const result of [classic,elevated]){
  assert(result.normalTurn.minUp>.98&&result.fullTurn.minUp>.98,result.profile+' turns remain upright');
  assert(result.reverse.to10<=.14,result.profile+' reverse responds from rest');
  assert(result.reverse.topKmh>26&&result.reverse.topKmh<29,result.profile+' reverse is useful and bounded');
}
assert(elevated.acceleration.to40<=.5&&elevated.acceleration.to80<=1.08,'elevated launch remains responsive');
assert(elevated.acceleration.cruise>87&&elevated.acceleration.cruise<90,'elevated forward speed range is retained');
assert(elevated.normalTurn.radius<16&&elevated.fullTurn.radius<16,'elevated high-speed cornering is tighter');
assert(elevated.forwardToReverse.reverse10<=.95,'elevated reverse input brakes then backs out promptly');
console.log(JSON.stringify({pass:true,scope:'actual shared Rapier flat-ground handling; km/h and metres; not a native input latency claim',classic,elevated},null,2));

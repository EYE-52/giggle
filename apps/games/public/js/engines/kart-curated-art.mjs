import PHYSICS from './kart-physics-config.mjs';
import {WEAPON_IDS,TRI_FAN,CURATED_MUZZLE} from './kart-weapon-contract.mjs';
export const CURATED_KINDS=WEAPON_IDS;
// Original toy-like models. The centre barrel faces local +Z; Tri-Shot barrels follow the tight fan. All instances
// share geometry/materials; recoil moves the housing, never the muzzle axis.
export function createCuratedArt(THREE){
 const geometries=[],materials=[];let kit=null,seq=0;
 const g=x=>(geometries.push(x),x);
 const m=(color,lit=false)=>{const out=lit?new THREE.MeshBasicMaterial({color,toneMapped:false}):new THREE.MeshStandardMaterial({color,roughness:.42,metalness:.25,flatShading:true});materials.push(out);return out;};
 function build(){if(kit)return kit;
  const barrel=g(new THREE.CylinderGeometry(.13,.17,1,12));barrel.rotateX(Math.PI/2);
  const ball=g(new THREE.IcosahedronGeometry(1,1)),box=g(new THREE.BoxGeometry(1,1,1)),ring=g(new THREE.TorusGeometry(.32,.075,6,16));
  const nose=g(new THREE.ConeGeometry(.22,.4,10));nose.rotateX(Math.PI/2);
  // A short round streak, not a 3.6m opaque slab across the road.
  const tracer=g(new THREE.CapsuleGeometry(.04,.55,2,6));tracer.rotateX(Math.PI/2);
  const finShape=new THREE.Shape();
  [[-.335,-.03],[-.03,-.03],[-.03,-.335],[.03,-.335],[.03,-.03],[.335,-.03],[.335,.03],[.03,.03],[.03,.335],[-.03,.335],[-.03,.03],[-.335,.03]].forEach(([x,y],i)=>i?finShape.lineTo(x,y):finShape.moveTo(x,y));finShape.closePath();
  const fins=g(new THREE.ExtrudeGeometry(finShape,{depth:.32,bevelEnabled:false}));fins.translate(0,0,-.16);
  kit={barrel,ball,box,ring,nose,tracer,fins,ink:m(0x25354b),steel:m(0xb5d7e4),gold:m(0xffcc45),tracerGold:m(0xffb020,true),tracerWhite:m(0xffffff,true),red:m(0xf45a65),mint:m(0x59ffd2,true),white:m(0xfff6d6,true),blue:m(0x75d9ff),pink:m(0xef70d6),lime:m(0xa8e54b),ice:m(0xa6edff),orange:m(0xff943c,true)};return kit;
 }
 function mesh(parent,geo,mat,x=0,y=0,z=0,sx=1,sy=sx,sz=sx){const o=new THREE.Mesh(geo,mat);o.position.set(x,y,z);o.scale.set(sx,sy,sz);o.castShadow=true;parent.add(o);return o;}
 function base(type,kind){const outer=new THREE.Group(),inner=new THREE.Group();outer.add(inner);outer.name='Curated'+kind;outer.userData.combat={type,kind,inner,curated:true,spin:0,seed:++seq,tail:null};return {outer,inner,c:outer.userData.combat};}
 function projectile(kind){const K=build(),{outer,inner,c}=base('projectile',kind);
  if(kind==='cannon'){mesh(inner,K.ball,K.blue,0,0,0,.42);mesh(inner,K.ring,K.orange,0,0,0,1.05);c.tipZ=.42;c.tailZ=-.42;}
  else if(kind==='missile'){
   mesh(inner,K.barrel,K.steel,0,0,-.15,1.3,1.3,.95);mesh(inner,K.nose,K.red,0,0,.52);
   mesh(inner,K.fins,K.red,0,0,-.48);
   c.tail=mesh(inner,K.nose,K.orange,0,0,-.84,.65,.65,-1.1);c.tipZ=.72;c.tailZ=-1.1;
  }else{
   const tri=kind==='trishot';mesh(inner,K.ball,tri?K.gold:K.white,0,0,0,.095,.095,.22);
   c.tail=mesh(inner,K.tracer,tri?K.tracerGold:K.tracerWhite,0,0,-.42);c.tail.name='KartBulletStreak';c.tail.castShadow=false;c.tipZ=.22;c.tailZ=-.735;
  }return outer;
 }
 // Merge all static parts by material once per kind. Each instance then
 // shares 4-6 meshes instead of drawing each bolt, fin and collar separately.
 const templates=new Map();
 function mergeRig(inner){
  const groups=new Map();inner.updateMatrixWorld(true);
  inner.traverse(o=>{if(o.isMesh){let parts=groups.get(o.material);if(!parts)groups.set(o.material,parts=[]);const geo=o.geometry.clone().applyMatrix4(o.matrixWorld);parts.push(geo.index?geo.toNonIndexed():geo);if(geo.index)geo.dispose();}});
  inner.clear();
  for(const [mat,parts]of groups){let n=0;for(const p of parts)n+=p.attributes.position.count;
   const geo=g(new THREE.BufferGeometry());for(const name of ['position','normal']){const data=new Float32Array(n*3);let at=0;for(const p of parts){data.set(p.attributes[name].array,at);at+=p.attributes[name].array.length;}geo.setAttribute(name,new THREE.BufferAttribute(data,3));}
   for(const p of parts)p.dispose();mesh(inner,geo,mat);
  }
 }
 function weapon(kind){const K=build();let template=templates.get(kind);
  if(!template){const holder=new THREE.Group();
   const color=kind==='machinegun'?K.gold:kind==='trishot'?K.red:kind==='missile'?K.red:kind==='cannon'?K.blue:kind==='blades'?K.mint:kind==='mine'?K.red:kind==='frost'?K.ice:kind==='ram'?K.lime:kind==='supernova'?K.pink:K.gold;
   mesh(holder,K.box,K.ink,0,.02,-.2,.95,.16,.85);
   for(const x of [-.32,.32])mesh(holder,K.box,K.ink,x,-.5,-.2,.12,1,.16);mesh(holder,K.box,K.ink,0,-.96,-.2,.95,.12,.55); // bolted saddle
   if(['machinegun','trishot','cannon','missile'].includes(kind)){
    if(kind==='cannon')mesh(holder,K.barrel,color,0,.35,-.12,2.6,2.6,.8);
    else if(kind==='missile')mesh(holder,K.barrel,color,0,.35,-.12,2.2,2.2,.8);
    else mesh(holder,K.box,color,0,.35,-.12,kind==='trishot'?.95:.75,.55,.8);
    // The chase camera sees the breech, not the muzzle. Give each rear
    // face a bold, readable mechanism rather than a plain coloured block.
    if(kind==='trishot')for(const x of [-.29,0,.29]){mesh(holder,K.ring,K.white,x,.37,-.535,.35);mesh(holder,K.ball,K.gold,x,.37,-.55,.07,.07,.04);}
    if(kind==='machinegun'){mesh(holder,K.box,K.ink,0,.35,-.54,.48,.3,.07);for(const y of [.29,.4])mesh(holder,K.box,K.white,0,y,-.59,.36,.035,.06);}
    if(kind==='cannon'){mesh(holder,K.ring,K.gold,0,.35,-.54,.93);mesh(holder,K.box,K.ink,0,.35,-.56,.12,.54,.08);mesh(holder,K.box,K.ink,0,.35,-.57,.54,.12,.08);}
    if(kind==='missile'){mesh(holder,K.ring,K.white,0,.35,-.55,.85);mesh(holder,K.ball,K.ink,0,.35,-.56,.2,.2,.06);for(const x of [-.52,.52])mesh(holder,K.box,K.red,x,.35,-.08,.12,.8,.55);}
    mesh(holder,K.box,K.white,0,.64,-.12,.58,.08,.55);
    if(kind==='trishot')for(let i=0;i<3;i++){const a=TRI_FAN[i],barrel=mesh(holder,K.barrel,K.ink,(i-1)*.2-Math.sin(a)*.4,.35,1.1-Math.cos(a)*.4,1.05,1.05,.8);barrel.rotation.y=a;const rim=mesh(holder,K.ring,K.white,(i-1)*.2,.35,1.065,.48);rim.rotation.y=a;}
    else{const wide=kind==='cannon'?2.5:kind==='missile'?2.15:1;
     mesh(holder,K.barrel,K.ink,0,.35,.55,wide,wide,1.1);
     mesh(holder,K.ring,kind==='cannon'?K.gold:K.white,0,.35,1.045,wide*.45);
     if(kind==='machinegun'){const drum=mesh(holder,K.barrel,K.gold,-.52,.32,-.18,2,2,.3);drum.rotation.y=Math.PI/2;mesh(holder,K.box,K.ink,0,.76,-.05,.14,.18,.2);}
     if(kind==='missile'){mesh(holder,K.nose,K.red,0,.35,1,.8);mesh(holder,K.box,K.red,0,.75,-.12,.12,.3,.48);}
    }
   }else if(kind==='mine'){
    mesh(holder,K.box,color,0,.22,-.2,1.2,.4,.85);
    for(let i=0;i<3;i++){const disc=mesh(holder,K.barrel,K.ink,0,.5+i*.16,-.2,2.5,2.5,.12);disc.rotation.x=Math.PI/2;mesh(holder,K.box,K.red,0,.57+i*.16,-.2,.2,.08,.2);}
   }else if(kind==='ram'){
    mesh(holder,K.box,K.ink,0,.28,.35,1.6,.3,.6);
    for(const x of [-.58,.58]){mesh(holder,K.box,color,x,.36,.62,.45,.5,1.1);mesh(holder,K.box,K.white,x,.37,.045,.19,.34,.05);mesh(holder,K.nose,K.white,x,.36,1.2,1.1,1.1,1.3);}
   }else if(kind==='blades'){
    mesh(holder,K.ball,K.ink,0,.35,0,.3);for(let i=0;i<3;i++){const a=i*Math.PI*2/3,o=mesh(holder,K.box,color,Math.cos(a)*.48,.4,Math.sin(a)*.48,.8,.12,.28);o.rotation.y=-a;}mesh(holder,K.ball,K.white,0,.45,0,.17);
   }else if(kind==='supernova'){
    mesh(holder,K.ball,color,0,.6,0,.42);for(let i=0;i<3;i++){const rib=mesh(holder,K.ring,K.ink,0,.6,0,1.8);rib.rotation.y=i*Math.PI/3;}mesh(holder,K.box,K.white,0,.6,.46,.24,.24,.1);
   }else{
    mesh(holder,K.box,color,0,.24,-.15,1,.3,.65);
    if(kind==='frost'){
     mesh(holder,K.ball,K.ice,0,.62,.18,.53,.57,.7);
     const crystal=mesh(holder,K.ball,K.white,0,1.04,.1,.18,.33,.18);crystal.rotation.z=.2;
     for(const x of [-.48,.48])mesh(holder,K.ball,K.blue,x,.66,.03,.2,.33,.4);
     mesh(holder,K.box,K.ink,0,.62,-.51,.08,.52,.08);mesh(holder,K.box,K.ink,0,.62,-.52,.43,.08,.08);
    }else{
     mesh(holder,K.barrel,K.gold,0,.58,.15,2.3,2.3,.9);mesh(holder,K.nose,K.white,0,.58,.8,1.5);
     mesh(holder,K.ring,K.ink,0,.58,-.32,.85);
     for(const x of [-.48,.48]){mesh(holder,K.box,K.gold,x,.58,-.18,.18,.8,.6);const stripe=mesh(holder,K.box,K.ink,x,.58,-.49,.1,.66,.05);stripe.rotation.z=.35;}
     mesh(holder,K.box,K.ink,0,.58,-.34,.5,.12,.1);
    }
   }
   // Small solid ready lamp: visible in daylight, no light sources or bloom.
   mesh(holder,K.box,K.white,.24,.68,-.56,.17,.1,.08);mergeRig(holder);template=holder;templates.set(kind,template);
  }
  const {outer,inner,c}=base('weapon',kind);inner.add(...template.children.map(o=>o.clone()));
  c.muzzle=[0,.35,1.1];c.mount=[CURATED_MUZZLE.x,CURATED_MUZZLE.y-PHYSICS.chassis.modelOriginY-c.muzzle[1],CURATED_MUZZLE.z-c.muzzle[2]];
  if(kind==='mine')c.mount=[0,1.35,-1.2];
  c.barrels=kind==='trishot'?3:['machinegun','cannon','missile','frost','nuke'].includes(kind)?1:0;c.recoilParts=[];c.trim=inner.children[0];
  if(kind==='nuke')outer.name='NukeLauncher';
  if(kind==='trishot')for(let i=0;i<3;i++){const a=TRI_FAN[i],anchor=new THREE.Object3D();anchor.name='TriBarrel'+i;anchor.position.set((i-1)*.2-Math.sin(a)*.4,.35,1.1-Math.cos(a)*.4);anchor.rotation.y=a;anchor.scale.z=.8;inner.add(anchor);}
  return outer;
 }
 function animate(object,dt,time,reduced){const c=object.userData.combat,inner=c.inner;
  if(c.type==='projectile'){
   c.spin+=Math.min(.1,Math.max(0,dt))*8;inner.rotation.z=reduced?0:c.spin;
   if(c.tail)c.tail.scale.z=(c.kind==='missile'?-1.1:1)*(reduced?1:1+.05*Math.sin(time*31));
  }else{c.recoil=Math.max(0,(c.recoil||0)-dt);inner.position.z=reduced?0:-.2*Math.sin(Math.PI*c.recoil/.16);inner.position.y=reduced?0:.025*Math.sin(time*2.5+c.seed);inner.rotation.y=reduced||c.kind!=='blades'?0:.05*Math.sin(time*2);}
 }
 function dispose(){for(const o of geometries)o.dispose();for(const o of materials)o.dispose();geometries.length=materials.length=0;kit=null;templates.clear();}
 return {projectile,weapon,animate,dispose};
}

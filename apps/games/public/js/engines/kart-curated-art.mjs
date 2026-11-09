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
   mesh(holder,K.box,K.ink,0,.02,-.2,1.25,.16,.95);
   for(const x of [-.32,.32])mesh(holder,K.box,K.ink,x,-.5,-.2,.12,1,.16);mesh(holder,K.box,K.ink,0,-.96,-.2,.95,.12,.55); // bolted saddle
   if(['machinegun','trishot','cannon','missile'].includes(kind)){
    if(kind==='cannon')mesh(holder,K.barrel,color,0,.35,-.12,2.6,2.6,.8);
    else if(kind==='missile')mesh(holder,K.barrel,color,0,.35,-.12,2.2,2.2,.8);
    else mesh(holder,K.box,color,0,.35,-.12,kind==='trishot'?1.4:.95,.65,.8);
    // The chase camera sees the breech, not the muzzle. Give each rear
    // face a bold, readable mechanism rather than a plain coloured block.
    if(kind==='trishot')for(const x of [-.55,0,.55]){
     mesh(holder,K.box,K.red,x,.65,-.15,.36,.65,.8);
     mesh(holder,K.box,K.ink,x,.63,-.58,.27,.42,.08);
     mesh(holder,K.box,K.white,x,.78,-.64,.19,.12,.08);
    }
    if(kind==='machinegun'){
     mesh(holder,K.box,K.ink,0,.4,-.54,.7,.42,.07);
     for(const y of [.31,.47])mesh(holder,K.box,K.white,0,y,-.59,.52,.06,.06);
     mesh(holder,K.box,K.ink,.69,.32,-.1,.3,.65,.7);
     for(const y of [.12,.34,.56])mesh(holder,K.box,K.gold,.87,y,-.16,.16,.1,.5);
    }
    if(kind==='cannon'){
     mesh(holder,K.box,K.blue,0,.4,-.55,.75,.65,.12);
     mesh(holder,K.box,K.gold,0,.45,-.64,.65,.16,.1);
     for(const x of [-.67,.67]){mesh(holder,K.box,K.blue,x,.34,-.05,.3,.7,.9);mesh(holder,K.barrel,K.gold,x,.55,.15,.55,.55,.95);}
    }
    if(kind==='missile'){
     // A closed tail and broad cross fins read as a rocket from the rear.
     // The physical centre tube still aims along the shared +Z muzzle.
     mesh(holder,K.box,K.red,0,.4,-.57,.57,.55,.12);
     mesh(holder,K.ball,K.white,0,.4,-.65,.16,.16,.06);
     for(let i=0;i<4;i++){
      const a=Math.PI/4+i*Math.PI/2,x=Math.sin(a),y=Math.cos(a);
      const fin=mesh(holder,K.box,K.red,x*.52,.5+y*.52,-.1,.25,.85,.8);fin.rotation.z=-a;
      const tip=mesh(holder,K.box,K.white,x*.82,.5+y*.82,-.49,.25,.18,.08);tip.rotation.z=-a;
     }
     mesh(holder,K.barrel,K.white,0,.92,.25,1.05,1.05,.9);mesh(holder,K.nose,K.red,0,.92,.9,.9);
    }
    mesh(holder,K.box,K.white,0,.64,-.12,.58,.08,.55);
    if(kind==='trishot')for(let i=0;i<3;i++){const a=TRI_FAN[i],barrel=mesh(holder,K.barrel,K.ink,(i-1)*.2-Math.sin(a)*.4,.35,1.1-Math.cos(a)*.4,1.05,1.05,.8);barrel.rotation.y=a;const rim=mesh(holder,K.ring,K.white,(i-1)*.2,.35,1.065,.48);rim.rotation.y=a;}
    else{const wide=kind==='cannon'?2.5:kind==='missile'?2.15:1;
     mesh(holder,K.barrel,K.ink,0,.35,.55,wide,wide,1.1);
     mesh(holder,K.ring,kind==='cannon'?K.gold:K.white,0,.35,1.045,wide*.45);
     if(kind==='machinegun'){const drum=mesh(holder,K.barrel,K.gold,-.72,.43,-.18,2.7,2.7,.45);drum.rotation.y=Math.PI/2;mesh(holder,K.box,K.ink,0,.88,-.05,.18,.22,.3);}
     if(kind==='missile'){mesh(holder,K.nose,K.red,0,.35,1,.8);mesh(holder,K.box,K.red,0,.75,-.12,.12,.3,.48);}
    }
   }else if(kind==='mine'){
    mesh(holder,K.box,color,0,.3,-.2,1.5,.4,.95);
    for(const x of [-.64,.64])mesh(holder,K.box,K.white,x,.39,-.2,.16,.7,.85);
    for(let i=0;i<3;i++){const disc=mesh(holder,K.barrel,K.ink,0,.58+i*.2,-.2,3,3,.14);disc.rotation.x=Math.PI/2;mesh(holder,K.box,K.red,0,.67+i*.2,-.2,.3,.08,.3);}
   }else if(kind==='ram'){
    mesh(holder,K.box,K.ink,0,.28,.35,1.9,.35,.6);
    for(const x of [-.76,.76]){mesh(holder,K.box,color,x,.48,.62,.55,.75,1.1);mesh(holder,K.box,K.white,x,.55,.045,.25,.44,.05);mesh(holder,K.nose,K.white,x,.48,1.2,1.3,1.3,1.5);}
   }else if(kind==='blades'){
    mesh(holder,K.box,K.ink,0,.37,0,.26,.75,.26);
    mesh(holder,K.ball,K.ink,0,.78,0,.35);for(let i=0;i<3;i++){const a=i*Math.PI*2/3,o=mesh(holder,K.box,color,Math.cos(a)*.65,.83,Math.sin(a)*.65,1,.16,.4);o.rotation.y=-a;}mesh(holder,K.ball,K.white,0,.92,0,.2);
   }else if(kind==='supernova'){
    mesh(holder,K.ball,color,0,.78,0,.52);for(let i=0;i<3;i++){const rib=mesh(holder,K.ring,K.ink,0,.78,0,2.1);rib.rotation.y=i*Math.PI/3;}for(const x of [-.66,.66])mesh(holder,K.box,K.pink,x,.38,0,.2,.7,.65);mesh(holder,K.box,K.white,0,.78,-.56,.24,.24,.1);
   }else{
    mesh(holder,K.box,color,0,.24,-.15,1,.3,.65);
    if(kind==='frost'){
     mesh(holder,K.ball,K.ice,0,.75,.18,.64,.65,.7);
     const crystal=mesh(holder,K.ball,K.white,0,1.23,.1,.22,.4,.22);crystal.rotation.z=.2;
     for(const x of [-.69,.69])mesh(holder,K.ball,K.blue,x,.85,.03,.25,.48,.4);
     for(let i=0;i<3;i++){const spoke=mesh(holder,K.box,K.white,0,.75,-.54,.12,.73,.08);spoke.rotation.z=i*Math.PI/3;}
    }else{
     mesh(holder,K.barrel,K.gold,0,.58,.15,2.3,2.3,.9);mesh(holder,K.nose,K.white,0,.58,.8,1.5);
     mesh(holder,K.box,K.gold,0,.72,-.37,.9,.9,.12);
     for(const x of [-.7,.7]){mesh(holder,K.box,K.gold,x,.65,-.18,.23,1,.7);const stripe=mesh(holder,K.box,K.ink,x,.65,-.55,.12,.85,.05);stripe.rotation.z=.35;}
     for(const x of [-.25,0,.25]){const stripe=mesh(holder,K.box,K.ink,x,.72,-.46,.12,.7,.05);stripe.rotation.z=-.4;}
     mesh(holder,K.box,K.gold,0,1.15,-.15,1.25,.18,.65);
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

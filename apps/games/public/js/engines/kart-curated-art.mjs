import PHYSICS from './kart-physics-config.mjs';
import {TRI_FAN,CURATED_MUZZLE} from './kart-weapon-contract.mjs';
export const CURATED_KINDS=Object.freeze(['machinegun','trishot','missile','cannon','blades','supernova']);
// Original toy-like models. The centre barrel faces local +Z; Tri-Shot barrels follow the tight fan. All instances
// share geometry/materials; recoil moves the housing, never the muzzle axis.
export function createCuratedArt(THREE){
 const geometries=[],materials=[];let kit=null,seq=0;
 const g=x=>(geometries.push(x),x);
 const m=(color,lit=false)=>{const out=lit?new THREE.MeshBasicMaterial({color,toneMapped:false}):new THREE.MeshStandardMaterial({color,roughness:.42,metalness:.25,flatShading:true});materials.push(out);return out;};
 function build(){if(kit)return kit;
  const barrel=g(new THREE.CylinderGeometry(.13,.17,1,12));barrel.rotateX(Math.PI/2);
  const ball=g(new THREE.IcosahedronGeometry(1,2)),box=g(new THREE.BoxGeometry(1,1,1)),ring=g(new THREE.TorusGeometry(.32,.075,6,16));
  const nose=g(new THREE.ConeGeometry(.22,.4,10));nose.rotateX(Math.PI/2);
  const tracer=g(new THREE.BoxGeometry(.055,.055,.9));
  const finShape=new THREE.Shape();
  [[-.335,-.03],[-.03,-.03],[-.03,-.335],[.03,-.335],[.03,-.03],[.335,-.03],[.335,.03],[.03,.03],[.03,.335],[-.03,.335],[-.03,.03],[-.335,.03]].forEach(([x,y],i)=>i?finShape.lineTo(x,y):finShape.moveTo(x,y));finShape.closePath();
  const fins=g(new THREE.ExtrudeGeometry(finShape,{depth:.32,bevelEnabled:false}));fins.translate(0,0,-.16);
  kit={barrel,ball,box,ring,nose,tracer,fins,ink:m(0x25354b),steel:m(0xb5d7e4),gold:m(0xffcc45),tracerGold:m(0xffb020,true),tracerWhite:m(0xffffff,true),red:m(0xf45a65),mint:m(0x59ffd2,true),white:m(0xfff6d6,true),blue:m(0x75d9ff),orange:m(0xff943c,true)};return kit;
 }
 function mesh(parent,geo,mat,x=0,y=0,z=0,sx=1,sy=sx,sz=sx){const o=new THREE.Mesh(geo,mat);o.position.set(x,y,z);o.scale.set(sx,sy,sz);o.castShadow=true;parent.add(o);return o;}
 function base(type,kind){const outer=new THREE.Group(),inner=new THREE.Group();outer.add(inner);outer.name='Curated'+kind;outer.userData.combat={type,kind,inner,curated:true,spin:0,seed:++seq,tail:null};return {outer,inner,c:outer.userData.combat};}
 function projectile(kind){const K=build(),{outer,inner,c}=base('projectile',kind);
  if(kind==='cannon'){mesh(inner,K.ball,K.ink,0,0,0,.42);mesh(inner,K.ring,K.orange,0,0,0,1.05);c.tipZ=.42;c.tailZ=-.42;}
  else if(kind==='missile'){
   mesh(inner,K.barrel,K.steel,0,0,-.15,1.3,1.3,.95);mesh(inner,K.nose,K.red,0,0,.52);
   mesh(inner,K.fins,K.red,0,0,-.48);
   c.tail=mesh(inner,K.nose,K.orange,0,0,-.84,.65,.65,-1.1);c.tipZ=.72;c.tailZ=-1.1;
  }else{
   const tri=kind==='trishot';mesh(inner,K.ball,tri?K.gold:K.white,0,0,0,.075,.075,.22);
   c.tail=mesh(inner,K.tracer,tri?K.tracerGold:K.tracerWhite,0,0,-.45);c.tipZ=.22;c.tailZ=-.9;
  }return outer;
 }
 function weapon(kind){const K=build(),{outer,inner,c}=base('weapon',kind);
  c.muzzle=[0,.35,1.1];c.mount=[CURATED_MUZZLE.x,CURATED_MUZZLE.y-PHYSICS.chassis.modelOriginY-c.muzzle[1],CURATED_MUZZLE.z-c.muzzle[2]];c.barrels=kind==='trishot'?3:['machinegun','cannon','missile'].includes(kind)?1:0;
  c.recoilParts=[];c.trim=null;
  mesh(inner,K.box,K.ink,0,.04,-.3,.6,.12,.7);
  if(kind==='machinegun'){
   const body=mesh(inner,K.box,K.ink,0,.35,.05,.4,.32,.65);c.recoilParts.push({node:body,z:body.position.z});
   mesh(inner,K.barrel,K.steel,0,.35,.65,.65,.65,.9);mesh(inner,K.ball,K.gold,-.29,.25,-.18,.24,.24,.18);
  }else if(kind==='trishot'){
   for(let i=0;i<3;i++){const a=TRI_FAN[i],b=mesh(inner,K.barrel,K.steel,(i-1)*.2-Math.sin(a)*.5,.35,1.1-Math.cos(a)*.5,.65,.65,1);b.rotation.y=a;b.name='TriBarrel'+i;}
   mesh(inner,K.box,K.gold,0,.2,-.08,.7,.2,.6);
  }else if(kind==='cannon'){
   mesh(inner,K.barrel,K.ink,0,.35,.48,2.5,2.5,1.15);mesh(inner,K.ring,K.gold,0,.35,1.04,1.12);
   mesh(inner,K.box,K.blue,0,.2,-.18,.8,.28,.6);
  }else if(kind==='missile'){
   mesh(inner,K.barrel,K.blue,0,.35,.45,2.1,2.1,1.15);mesh(inner,K.ring,K.red,0,.35,1.05,1.03);
  }else if(kind==='blades'){
   mesh(inner,K.ball,K.ink,0,.35,0,.27);for(let i=0;i<3;i++){const a=i*Math.PI*2/3;const blade=mesh(inner,K.box,K.mint,Math.cos(a)*.35,.38,Math.sin(a)*.35,.55,.06,.18);blade.rotation.y=-a;}
  }else{
   mesh(inner,K.ball,K.blue,0,.4,0,.3);for(let i=0;i<3;i++){const o=mesh(inner,K.ring,K.mint,0,.4,0,1.3);o.rotation.set(i*Math.PI/3,i*Math.PI/3,0);}
  }return outer;
 }
 function animate(object,dt,time,reduced){const c=object.userData.combat,inner=c.inner;
  if(c.type==='projectile'){
   c.spin+=Math.min(.1,Math.max(0,dt))*8;inner.rotation.z=reduced?0:c.spin;
   if(c.tail)c.tail.scale.z=(c.kind==='missile'?-1.1:1)*(reduced?1:1+.05*Math.sin(time*31));
  }else{c.recoil=Math.max(0,(c.recoil||0)-dt);for(const part of c.recoilParts)part.node.position.z=part.z-(reduced?0:.12*Math.sin(Math.PI*c.recoil/.16));}
 }
 function dispose(){for(const o of geometries)o.dispose();for(const o of materials)o.dispose();geometries.length=materials.length=0;kit=null;}
 return {projectile,weapon,animate,dispose};
}

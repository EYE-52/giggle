import PHYSICS from './kart-physics-config.mjs';
import {WEAPON_IDS,TRI_FAN,CURATED_MUZZLE} from './kart-weapon-contract.mjs';
export const CURATED_KINDS=WEAPON_IDS;
// Original toy-like models. The centre barrel faces local +Z; Tri-Shot barrels follow the tight fan. All instances
// share geometry/materials; recoil moves the housing, never the muzzle axis.
export function createCuratedArt(THREE, lookup = () => null){
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
  if(kind==='cannon'){
   const round=lookup('Gear_cannon')?.getObjectByName('Rocket0');
   if(round){
    const clone=round.clone(true);clone.position.x=clone.position.y=0;inner.add(clone);
    c.tail=mesh(inner,K.nose,K.orange,0,0,-.66,.43,.43,-.68);
    c.tipZ=.595;c.tailZ=-.80;c.tailBase=-.68;
    return outer;
   }
  }
  if(kind==='missile'||kind==='cannon'){
   mesh(inner,K.barrel,K.steel,0,0,-.15,1.3,1.3,.95);mesh(inner,K.nose,K.red,0,0,.52);
   mesh(inner,K.fins,K.red,0,0,-.48);
   c.tail=mesh(inner,K.nose,K.orange,0,0,-.84,.65,.65,-1.1);c.tipZ=.72;c.tailZ=-1.1;
  }else{
   const tri=kind==='trishot';mesh(inner,K.ball,tri?K.gold:K.white,0,0,0,.095,.095,.22);
   c.tail=mesh(inner,K.tracer,tri?K.tracerGold:K.tracerWhite,0,0,-.42);c.tail.name='KartBulletStreak';c.tail.castShadow=false;c.tipZ=.22;c.tailZ=-.735;
  }return outer;
 }
 // Renderer instances borrow the library's mesh buffers and material.
 // The fallback is used in isolated fixtures and when a caller supplies no library.
 function weapon(kind){
  const {outer,inner,c}=base('weapon',kind);
  const model=lookup('Gear_'+kind);
  if(model){
   const clone=model.clone(true);
   inner.add(clone);
   clone.traverse(node=>{if(node.isMesh)node.castShadow=false;});
   if(kind==='cannon'||kind==='mine')c.rounds=[0,1,2].map(i=>clone.getObjectByName((kind==='mine'?'Mine':'Rocket')+i));
  }else{
   const K=build();
   if(kind==='blades'){
    const hoop=mesh(inner,K.ring,K.steel,0,0,0,5.1);hoop.rotation.x=-Math.PI/2;
   }else if(kind==='cannon'){
    c.rounds=[[-.18,-.09],[.18,-.09],[0,.19]].map(([x,y])=>{
     const rocket=new THREE.Group();inner.add(rocket);rocket.position.set(x,y,0);
     mesh(rocket,K.barrel,K.steel,0,0,0,.8,.8,.84);
     mesh(rocket,K.nose,K.red,0,0,.46,.65,.65,.8);
     return rocket;
    });
   }else{
    mesh(inner,K.ball,kind==='supernova'?K.pink:kind==='frost'?K.ice:K.gold,0,0,0,.28,.22,.43);
   }
  }
  const rear=kind==='mine'||kind==='proximity'||kind==='fakecrate'||kind==='supernova';
  c.barrels=kind==='trishot'||kind==='cannon'?3:rear||kind==='blades'||kind==='ram'?0:1;
  c.muzzle=[0,0,c.barrels ? .60 : 0];
  c.mount=kind==='blades'?[0,.49,0]:kind==='ram'?[0,.76,.99]:rear?[-1.18,1.30,-1.17]:
   [CURATED_MUZZLE.x,CURATED_MUZZLE.y-PHYSICS.chassis.modelOriginY,CURATED_MUZZLE.z-.60];
  c.recoilParts=[];c.trim=inner.getObjectByProperty('isMesh',true);
  if(kind==='nuke')outer.name='NukeLauncher';
  if(kind==='trishot')for(let i=0;i<TRI_FAN.length;i++){
   const angle=TRI_FAN[i],anchor=new THREE.Object3D();anchor.name='TriBarrel'+i;
   anchor.position.set((i-1)*.2-Math.sin(angle)*.4,0,.60-Math.cos(angle)*.4);
   anchor.rotation.y=angle;anchor.scale.z=.8;inner.add(anchor);
  }
  return outer;
 }
 // Server directions use world coordinates. Keep the weapon upright as it
 // turns on the side pod, including when the chassis is pitched on a ramp.
 const worldRotation=new THREE.Quaternion(),shotDirection=new THREE.Vector3();
 function pointBarrel(c,yaw,pitch){
  c.inner.rotation.set(pitch,yaw,0,'YXZ');
  // The server sweeps every bullet from one side-mounted bore. Turn the
  // model around that point so the opening stays at the start of the shot.
  const tip=c.muzzle[2];
  c.inner.position.set(0,0,-tip).applyQuaternion(c.inner.quaternion);
  c.inner.position.z+=tip;
 }
 function aim(rig,direction){
  const c=rig?.userData.combat;
  if(c?.kind!=='machinegun'||!direction)return;
  rig.getWorldQuaternion(worldRotation);
  shotDirection.copy(direction).applyQuaternion(worldRotation.invert());
  c.aimYaw=Math.atan2(shotDirection.x,shotDirection.z);
  c.aimPitch=-Math.atan2(shotDirection.y,Math.hypot(shotDirection.x,shotDirection.z));
  pointBarrel(c,c.aimYaw,c.aimPitch);
 }
 function animate(object,dt,time,reduced){
  const c=object.userData.combat,inner=c.inner;
  if(c.type==='projectile'){
   c.spin+=Math.min(.1,Math.max(0,dt))*8;inner.rotation.z=reduced?0:c.spin;
   if(c.tail)c.tail.scale.z=(c.tailBase??(c.kind==='missile'||c.kind==='cannon'?-1.1:1))*(reduced?1:1+.05*Math.sin(time*31));
   return;
  }
  c.recoil=Math.max(0,(c.recoil||0)-dt);
  inner.position.z=reduced?0:-.12*Math.sin(Math.PI*c.recoil/.16);
  if(c.rounds)for(let i=0;i<c.rounds.length;i++)if(c.rounds[i])c.rounds[i].visible=i<(c.ammo??3);
  if(c.kind==='machinegun'){
   const yaw=c.firing?(c.aimYaw??0):0,pitch=c.firing?(c.aimPitch??0):0;
   const delta=yaw-inner.rotation.y;
   const step=reduced?1:1-Math.exp(-30*Math.min(dt,.1));
   pointBarrel(c,inner.rotation.y+Math.atan2(Math.sin(delta),Math.cos(delta))*step,
    inner.rotation.x+(pitch-inner.rotation.x)*step);
  }
  if(c.kind==='blades'){
   if(c.active&&!reduced)c.spin=(c.spin+Math.min(dt,.1)*7)%(Math.PI*2);
   inner.rotation.y=c.active&&!reduced?c.spin:0;
  }
 }
 function dispose(){for(const o of geometries)o.dispose();for(const o of materials)o.dispose();geometries.length=materials.length=0;kit=null;}
 return {projectile,weapon,aim,animate,dispose};
}

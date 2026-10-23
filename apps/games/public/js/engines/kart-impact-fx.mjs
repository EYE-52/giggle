/* Accepted-contact presentation only. No physics, radius overlays or camera
 * motion. Three fixed billboard pools use procedural alpha, no textures.
 * Call warmup(renderer,camera) before Ready; reset(epoch) on instance/life or
 * reconnect retirement. Call emit with raw accepted xyz/id/pid/weapon/tick;
 * impact+blast pairs may arrive in either order. Existing history guards
 * remain the renderer's responsibility. */
export const IMPACT_FX_LIMITS=Object.freeze({fire:156,smoke:84,embers:144,history:96,pairs:24});
const VERTEX=`
attribute vec3 fxOrigin;
attribute vec3 fxVelocity;
attribute vec4 fxLife;
attribute vec2 fxSize;
uniform float fxTime;
uniform float fxLayer;
varying vec2 vUv;
varying float vAge;
varying float vSeed;
varying float vFlash;
varying float vAlive;
void main(){
 float age=fxTime-fxLife.x;
 float t=clamp(age/max(fxLife.y,0.0001),0.0,1.0);
 vAlive=step(0.0,age)*(1.0-step(fxLife.y,age))*step(0.0001,fxLife.y);
 vAge=t;vSeed=fxLife.z;vFlash=fxLife.w;vUv=uv;
 vec3 center=fxOrigin+fxVelocity*max(age,0.0);
 if(fxLayer>1.5)center.y-=4.0*max(age,0.0)*max(age,0.0);
 vec4 eye=viewMatrix*modelMatrix*vec4(center,1.0);
 float size=mix(fxSize.x,fxSize.y,t);
 vec2 offset=position.xy*size;
 if(fxLayer>1.5){
  vec2 travel=(viewMatrix*modelMatrix*vec4(fxVelocity,0.0)).xy;
  float len=length(travel);
  vec2 axis=len>0.0001?travel/len:vec2(0.0,1.0);
  offset=vec2(-axis.y,axis.x)*position.x*size+axis*position.y*size*5.0;
 }
 eye.xy+=offset;gl_Position=projectionMatrix*eye;
}`;
const FRAGMENT=`
uniform float fxLayer;
varying vec2 vUv;
varying float vAge;
varying float vSeed;
varying float vFlash;
varying float vAlive;
void main(){
 if(vAlive<0.5)discard;
 vec2 q=vUv*2.0-1.0;
 float r=length(q);
 float ripple=0.075*sin(q.x*8.0+vSeed+vAge*9.0)*sin(q.y*7.0-vSeed);
 float soft=1.0-smoothstep(0.25,1.0,r+ripple);
 vec3 color;float alpha;
 if(fxLayer<0.5){
  float hot=pow(max(0.0,1.0-r),1.4)*(1.0-vAge*0.6);
  color=mix(vec3(1.0,0.12,0.012),vec3(1.0,0.82,0.16),hot);
  if(vFlash>0.5)color=vec3(1.0,0.94,0.66);
  alpha=soft*(1.0-vAge)*(vFlash>0.5?1.0:0.8);
  if(vFlash>1.5)alpha*=0.35;
 }else if(fxLayer<1.5){
  color=mix(vec3(0.075,0.07,0.075),vec3(0.20,0.19,0.18),soft);
  alpha=soft*0.48*smoothstep(0.0,0.15,vAge)*(1.0-smoothstep(0.7,1.0,vAge));
 }else{
  color=mix(vec3(1.0,0.9,0.53),vec3(1.0,0.28,0.025),vAge);
  alpha=soft*(1.0-vAge);
 }
 if(alpha<0.005)discard;
 gl_FragColor=vec4(color,alpha);
}`;

export function createKartImpactFX(THREE,scene,{reducedMotion=false}={}){
 const root=new THREE.Group();root.name='KartImpactFX';scene.add(root);
 let time=0,disposed=false,idHead=0,pairHead=0;
 const ids=Array(IMPACT_FX_LIMITS.history).fill(null);
 const pairs=Array.from({length:IMPACT_FX_LIMITS.pairs},()=>({at:-Infinity,type:'',pid:null,weapon:null,tick:null,x:0,y:0,z:0,paired:false}));
 function pool(name,capacity,layer){
  const geometry=new THREE.InstancedBufferGeometry();
  geometry.setAttribute('position',new THREE.BufferAttribute(new Float32Array([-.5,-.5,0,.5,-.5,0,.5,.5,0,-.5,-.5,0,.5,.5,0,-.5,.5,0]),3));
  geometry.setAttribute('uv',new THREE.BufferAttribute(new Float32Array([0,0,1,0,1,1,0,0,1,1,0,1]),2));
  const origin=new Float32Array(capacity*3),velocity=new Float32Array(capacity*3),life=new Float32Array(capacity*4),size=new Float32Array(capacity*2);
  for(const[key,array,width]of [['fxOrigin',origin,3],['fxVelocity',velocity,3],['fxLife',life,4],['fxSize',size,2]])geometry.setAttribute(key,new THREE.InstancedBufferAttribute(array,width).setUsage(THREE.DynamicDrawUsage));
  geometry.instanceCount=capacity;
  const material=new THREE.ShaderMaterial({vertexShader:VERTEX,fragmentShader:FRAGMENT,uniforms:{fxTime:{value:0},fxLayer:{value:layer}},transparent:true,depthWrite:false,depthTest:true,blending:layer===1?THREE.NormalBlending:THREE.AdditiveBlending,toneMapped:false});
  const mesh=new THREE.Mesh(geometry,material);mesh.name=name;mesh.frustumCulled=false;mesh.visible=false;mesh.renderOrder=20+(layer===1?0:layer===0?1:2);root.add(mesh);
  return {mesh,geometry,material,origin,velocity,life,size,capacity,head:0};
 }
 const bufferNames=['fxOrigin','fxVelocity','fxLife','fxSize'];
 const fire=pool('KartImpactFireFlash',IMPACT_FX_LIMITS.fire,0),smoke=pool('KartImpactSmoke',IMPACT_FX_LIMITS.smoke,1),embers=pool('KartImpactEmbers',IMPACT_FX_LIMITS.embers,2),pools=[fire,smoke,embers];
 function particle(p,x,y,z,vx,vy,vz,duration,startSize,endSize,seed,flash=0){
  const n=p.head;p.head=(n+1)%p.capacity;const a=n*3,b=n*4,c=n*2;
  p.origin[a]=x;p.origin[a+1]=y;p.origin[a+2]=z;p.velocity[a]=vx;p.velocity[a+1]=vy;p.velocity[a+2]=vz;
  p.life[b]=time;p.life[b+1]=duration;p.life[b+2]=seed;p.life[b+3]=flash;p.size[c]=startSize;p.size[c+1]=endSize;
  p.mesh.visible=true;
 }
 function dirty(){for(const p of pools)for(const name of bufferNames)p.geometry.attributes[name].needsUpdate=true;}
 function emit(e){
  if(disposed||!e)return false;
  const type=e.type||e.kind,p=e.position;
  if(!['impact','blast','collision'].includes(type)||!p||!Number.isFinite(p.x)||!Number.isFinite(p.y)||!Number.isFinite(p.z))return false;
  if(e.id!=null){if(ids.includes(e.id))return false;ids[idHead]=e.id;idHead=(idHead+1)%ids.length;}
  if(type==='collision'){
   // Bumper contact is not an explosion: a small scuff at the solver's
   // contact point, with streaks leaving along its actual normal. Pools
   // are already warmed, so the first crash allocates no render resources.
   const strength=Math.max(.1,Math.min(1,(Number.isFinite(e.impulse)?e.impulse:100)/1000));
   const reduce=typeof reducedMotion==='function'?reducedMotion():reducedMotion;
   if(reduce){particle(fire,p.x,p.y,p.z,0,0,0,.10,.25,.25,0,2);dirty();return true;}
   let nx=e.normal?.x??0,ny=e.normal?.y??0,nz=e.normal?.z??0;
   let length=Math.hypot(nx,ny,nz);
   if(!Number.isFinite(length)||length<1e-6){nx=0;ny=1;nz=0;length=1;}
   nx/=length;ny/=length;nz/=length;
   let bx=Math.abs(ny)>.9?1:-nz,bz=Math.abs(ny)>.9?0:nx;
   length=Math.hypot(bx,bz);bx/=length;bz/=length;
   const cx=ny*bz,cy=nz*bx-nx*bz,cz=-ny*bx;
   const count=3+Math.round(strength*7);
   for(let i=0;i<count;i++){
    const angle=i*2.399963,side=.35+(i%3)*.12,speed=1+strength*4+(i%2)*.4;
    particle(embers,p.x,p.y,p.z,(nx+side*(Math.cos(angle)*bx+Math.sin(angle)*cx))*speed,
     (ny+side*Math.sin(angle)*cy)*speed+.5,(nz+side*(Math.cos(angle)*bz+Math.sin(angle)*cz))*speed,
     .14+strength*.10,.045+strength*.045,.015,i*.51);
   }
   if(strength>.25)particle(smoke,p.x,p.y,p.z,nx*.3,.45,nz*.3,.35,.20,.5+strength*.4,.9);
   dirty();return true;
  }
  const explosion=type==='blast'||['rocket','seeker','grenade','bomb','nuke','proximity','mine'].includes(e.weapon);
  if(explosion){
   for(const prior of pairs){
    if(prior.paired||prior.type===type||time-prior.at>.12||(prior.pid!=null&&e.pid!=null&&prior.pid!==e.pid)||(prior.weapon!=null&&e.weapon!=null&&prior.weapon!==e.weapon)||(prior.tick!=null&&e.tick!=null&&prior.tick!==e.tick))continue;
    if(Math.abs(prior.x-p.x)+Math.abs(prior.y-p.y)+Math.abs(prior.z-p.z)>.04)continue;
    prior.paired=true;return false; // opposite impact/blast representation of the same contact
   }
   const prior=pairs[pairHead];pairHead=(pairHead+1)%pairs.length;
   prior.at=time;prior.type=type;prior.pid=e.pid??null;prior.weapon=e.weapon??null;prior.tick=e.tick??null;prior.x=p.x;prior.y=p.y;prior.z=p.z;prior.paired=false;
  }
  const reduce=typeof reducedMotion==='function'?reducedMotion():reducedMotion;
  particle(fire,p.x,p.y,p.z,0,0,0,reduce?.12:.11,reduce?.7:explosion?1.8:.55,reduce?.7:explosion?2.4:.2,0,reduce?2:1);
  if(!reduce){
   if(explosion){
    for(let i=0;i<12;i++){
     const a=i*2.399963,up=(i%4-1.5)*.22,r=.18+(i%3)*.17;
     particle(fire,p.x+Math.cos(a)*r,p.y+up,p.z+Math.sin(a)*r,Math.cos(a)*1.1,1.2+i%3*.35,Math.sin(a)*1.1,.25+(i%4)*.033,.35+(i%3)*.08,1.8+(i%3)*.25,i*.71);
    }
    for(let i=0;i<7;i++){
     const a=i*2.399963;
     particle(smoke,p.x+Math.cos(a)*.3,p.y+(i%3)*.18,p.z+Math.sin(a)*.3,Math.cos(a)*.7,1.2+i%3*.2,Math.sin(a)*.7,.95,.65,2.5+i%3*.3,i*.93);
    }
   }
   // Bullet ricochets point away from the accepted incoming segment/normal.
   const d=e.normal,from=e.from;
   let nx=d?.x??(from?from.x-p.x:0),ny=d?.y??(from?from.y-p.y:1),nz=d?.z??(from?from.z-p.z:0),length=Math.hypot(nx,ny,nz);
   if(!Number.isFinite(length)||length<1e-6){nx=0;ny=1;nz=0;length=1;}nx/=length;ny/=length;nz/=length;
   let bx=Math.abs(ny)>.9?1:-nz,by=0,bz=Math.abs(ny)>.9?0:nx;length=Math.hypot(bx,by,bz);bx/=length;bz/=length;
   const cx=ny*bz,cy=nz*bx-nx*bz,cz=-ny*bx;
   for(let i=0;i<(explosion?12:6);i++){
    const a=i*2.399963,speed=explosion?4+(i%3):3+(i%3),side=explosion?1:.4;
    const dx=nx+side*(Math.cos(a)*bx+Math.sin(a)*cx),dy=ny+side*(Math.cos(a)*by+Math.sin(a)*cy),dz=nz+side*(Math.cos(a)*bz+Math.sin(a)*cz);
    particle(embers,p.x,p.y,p.z,dx*speed,dy*speed,dz*speed,explosion?.38:.2,explosion?.11:.075,.02,i*.51);
   }
  }
  dirty();return true;
 }
 function update(dt){
  if(disposed)return;if(Number.isFinite(dt)&&dt>=0)time+=dt;
  for(const p of pools){p.material.uniforms.fxTime.value=time;let active=false;for(let i=0;i<p.capacity;i++)if(p.life[i*4+1]>0&&time-p.life[i*4]<p.life[i*4+1]){active=true;break;}p.mesh.visible=active;}
 }
 function reset(){
  if(disposed)return;time=0;ids.fill(null);idHead=0;pairHead=0;for(const p of pairs)p.at=-Infinity;
  for(const p of pools){p.life.fill(0);p.head=0;p.material.uniforms.fxTime.value=0;p.mesh.visible=false;p.geometry.attributes.fxLife.needsUpdate=true;}
 }
 async function warmup(renderer,camera){
  if(disposed)throw Error('Retired kart impact FX');
  for(const p of pools)p.mesh.visible=true;
  try{await renderer.compileAsync(scene,camera);if(disposed)throw Error('Retired kart impact FX');renderer.render(scene,camera);}finally{update(0);}
 }
 function dispose(){if(disposed)return;reset();disposed=true;root.removeFromParent();for(const p of pools){p.geometry.dispose();p.material.dispose();}}
 return Object.freeze({emit,update,warmup,reset,dispose});
}

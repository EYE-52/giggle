import {surfaceProfile} from './kart-surface.mjs';
import {driftTier,DRIFT_TIERS} from './kart-drift.mjs';
export const DRIVING_PARTICLE_LIMIT=320;
// One fixed particle batch and one camera line batch, shared by all drivers.
// Typed arrays, a ring cursor and per-driver emission clocks; no frame garbage.
export function createKartDrivingFX(THREE,scene,camera,{groundAt=()=>0,reducedMotion=false}={}) {
  const N=DRIVING_PARTICLE_LIMIT,positions=new Float32Array(N*3),colors=new Float32Array(N*3),sizes=new Float32Array(N),alpha=new Float32Array(N),life=new Float32Array(N),duration=new Float32Array(N),velocity=new Float32Array(N*3);
  const geometry=new THREE.BufferGeometry();
  for(const [name,array,size]of [['position',positions,3],['color',colors,3],['size',sizes,1],['alpha',alpha,1]])geometry.setAttribute(name,new THREE.BufferAttribute(array,size).setUsage(THREE.DynamicDrawUsage));
  const material=new THREE.ShaderMaterial({transparent:true,depthWrite:false,vertexColors:true,
    vertexShader:`attribute float size;attribute float alpha;varying vec3 tint;varying float fade;void main(){tint=color;fade=alpha;vec4 p=modelViewMatrix*vec4(position,1.);gl_Position=projectionMatrix*p;gl_PointSize=clamp(size*360./max(1.,-p.z),1.,32.);}`,
    fragmentShader:`varying vec3 tint;varying float fade;void main(){float r=length(gl_PointCoord-.5)*2.;float a=(1.-smoothstep(.25,1.,r))*fade;if(a<.01)discard;gl_FragColor=vec4(tint,a);}`});
  const particles=new THREE.Points(geometry,material);particles.name='KartDrivingParticles';particles.frustumCulled=false;scene.add(particles);
  const lines=new Float32Array(24*6);
  for(let i=0;i<24;i++){const a=i*Math.PI/12,r=.8+(i%3)*.13;lines.set([Math.cos(a)*r,Math.sin(a)*r,-1.5,Math.cos(a)*(r+.14),Math.sin(a)*(r+.14),-1.5],i*6);}
  const lineGeometry=new THREE.BufferGeometry();lineGeometry.setAttribute('position',new THREE.BufferAttribute(lines,3));
  const lineMaterial=new THREE.LineBasicMaterial({color:0xc4efff,transparent:true,opacity:0,depthTest:false,depthWrite:false});
  const speedLines=new THREE.LineSegments(lineGeometry,lineMaterial);speedLines.name='KartSpeedLines';speedLines.frustumCulled=false;speedLines.renderOrder=20;camera.add(speedLines);if(!camera.parent)scene.add(camera);
  const clocks=new Map();let head=0,time=0,serial=0,disposed=false;
  function emit(x,y,z,vx,vz,color,size,seconds) {
    const i=head,j=i*3;head=(head+1)%N;
    positions[j]=x;positions[j+1]=y;positions[j+2]=z;velocity[j]=vx;velocity[j+1]=.4+(serial++%5)*.16;velocity[j+2]=vz;
    colors[j]=((color>>16)&255)/255;colors[j+1]=((color>>8)&255)/255;colors[j+2]=(color&255)/255;
    sizes[i]=size;life[i]=duration[i]=seconds;alpha[i]=1;
  }
  function track(pid,x,y,z,angle,speed,sliding,charge,surface,grounded=true) {
    if(disposed||reducedMotion||!grounded||Math.abs(speed)<5)return;
    if((clocks.get(pid)??-1)>time)return;
    clocks.set(pid,time+.055);
    const fx=Math.sin(angle),fz=Math.cos(angle),s=surface||surfaceProfile('road'),tier=driftTier(charge),loose=['grass','sand','snow','gravel'].includes(s.kind);
    for(let side=-1;side<=1;side+=2) {
      const px=x-fx*.92+fz*side*1.02,pz=z-fz*.92-fx*side*1.02,py=Math.max(groundAt(px,pz)+.14,y-.47);
      if(sliding&&tier){const color=DRIFT_TIERS[tier-1].color;emit(px,py,pz,-fx*3+fz*side,-fz*3-fx*side,color,.13,.32);emit(px,py,pz,-fx*4+fz*side*2,-fz*4-fx*side*2,color,.08,.24);}
      if(sliding||loose)emit(px,py,pz,-fx*1.4+fz*side*.4,-fz*1.4-fx*side*.4,s.dust,loose?.7:.48,loose?.65:.45);
    }
  }
  function update(dt,speed=0,boost=false) {
    if(disposed)return;const elapsed=Math.max(0,dt),step=Math.min(.1,elapsed);time+=elapsed;
    let live=0;
    for(let i=0;i<N;i++) {
      if(life[i]<=0){alpha[i]=0;continue;}life[i]-=elapsed;if(life[i]<=0){alpha[i]=0;continue;}const j=i*3;
      positions[j]+=velocity[j]*step;positions[j+1]+=velocity[j+1]*step;positions[j+2]+=velocity[j+2]*step;
      alpha[i]=Math.max(0,life[i]/duration[i])*.8;live++;
    }
    particles.visible=!reducedMotion&&live>0;
    geometry.attributes.position.needsUpdate=true;geometry.attributes.color.needsUpdate=true;geometry.attributes.size.needsUpdate=true;geometry.attributes.alpha.needsUpdate=true;
    speedLines.visible=!reducedMotion&&(boost||Math.abs(speed)>18);
    lineMaterial.opacity=speedLines.visible?Math.min(.32,Math.max(0,(Math.abs(speed)-18)/35)+(boost?.16:0)):0;
    speedLines.scale.set(camera.aspect,1,1);
  }
  function reset(){life.fill(0);alpha.fill(0);clocks.clear();particles.visible=false;speedLines.visible=false;}
  function dispose(){if(disposed)return;disposed=true;particles.removeFromParent();speedLines.removeFromParent();geometry.dispose();material.dispose();lineGeometry.dispose();lineMaterial.dispose();clocks.clear();}
  return {particles,speedLines,track,update,reset,forget:pid=>clocks.delete(pid),dispose,stats:()=>({capacity:N,drivers:clocks.size,live:life.reduce((n,v)=>n+(v>0),0)})};
}

/* Decoration only: bright bulb cores, wires/tubes and additive halos in three
 * instanced draws. Animation uses uniforms; no CPU bulb loop, lights or shadows.
 * Dense local fixtures take priority over distant skyline strings. */
import {flightPose,RIDE_HEIGHT,PORTAL_FRAME,PORTAL_HALF_DEPTH} from './kart-map-features.mjs';

const COLOURS={christmas:[0xff271b,0x19ee57,0xffc21d,0x2186ff,0xf23ba9],neon:[0xff23c3,0x00eaff,0x983dff,0x9cff12],festoon:[0xffc55b,0xffe5a0,0xffa338],arcade:[0xffbc24,0x12e0f2,0xff386f]};
export const festiveTheme=id=>id==='frost'?'christmas':id==='neon'?'neon':id==='garden'?'festoon':'arcade';
const initialRatios=new WeakMap();
export function kartLightTier(renderer){
  if(!renderer||typeof renderer!=='object')return 'high';
  const ratio=renderer?.getPixelRatio?.()??1.75;
  // A normal 1x desktop is not a struggling GPU. Follow the SAME renderer's
  // adaptive resolution drop, relative to its starting native/capped ratio.
  if(!initialRatios.has(renderer))initialRatios.set(renderer,ratio);
  const fraction=ratio/initialRatios.get(renderer);
  return fraction<=.6||renderer.shadowMap?.enabled===false?'low':fraction<.9?'medium':'high';
}

export function festiveLightLayout(map,{groundAt=()=>0}={}){
  const theme=festiveTheme(map.id),raised=!!map.colliders,runs=[],bulbs=[],bars=[];
  const colors=COLOURS[theme],diameter=theme==='christmas'||theme==='festoon'?.34:.32;let sequence=0;
  const bulb=(p,phase,size=diameter)=>{
    // The quarter-density prefix must still contain every neon colour.
    const index=sequence+(theme==='neon'?Math.floor(sequence/4):0);sequence++;
    bulbs.push({p,color:colors[index%colors.length],phase,size});
  };
  const bar=(a,b,color=0x315c67,width=.045,phase=-1)=>bars.push({a,b,color,width,phase});
  function string(name,a,b,{sag=0,spacing=.7,neon=theme==='neon'}={}){
    const distance=Math.hypot(...b.map((v,i)=>v-a[i])),n=Math.max(2,Math.ceil(distance/spacing)),first=bulbs.length;
    runs.push({name,a:[...a],b:[...b],sag,spacing:distance/n,first,bulbs:n+1,neon});
    let last;
    for(let i=0;i<=n;i++){
      const t=i/n,p=a.map((v,j)=>v+(b[j]-v)*t-(j===1?sag*4*t*(1-t):0));
      bulb(p,i*.7);
      // A straight neon run is ONE thick tube. Chase moves per fragment
      // along its length, so denser bulbs never increase tube geometry.
      if((neon||sag===0)&&i!==0&&i!==n)continue;
      if(neon||i===0||i===n||i%Math.ceil(n/3)===0){
        if(last)bar(last,p,neon?colors[runs.length%colors.length]:0x315c67,neon?.32:.045,neon?sequence*.7:-1);
        last=p;
      }
    }
  }
  function arch(name,x,z,width,base,angle=0){
    const c=Math.cos(angle),s=Math.sin(angle),y=base+4.3;
    let ends;
    // Spawn gantries are cosmetic. Keep their posts out of the actual portal
    // lane; Alpine's former post stood half a metre from its aperture centre.
    for(const shift of [0,6,-6,12,-12]){
      const cx=x+Math.sin(angle)*shift,cz=z+Math.cos(angle)*shift;
      const candidate=[[cx-width/2*c,y,cz+width/2*s],[cx+width/2*c,y,cz-width/2*s]];
      const blocked=(map.features?.portals||[]).flat().some(p=>Math.abs((p.y??groundAt(p.x,p.z))-base)<.5&&candidate.some(([px,,pz])=>{
        const dx=px-p.x,dz=pz-p.z,ps=Math.sin(p.angle||0),pc=Math.cos(p.angle||0);
        return Math.abs(dx*ps+dz*pc)<PORTAL_HALF_DEPTH+1.8&&Math.abs(dx*pc-dz*ps)<PORTAL_FRAME.radius+.5;
      }));
      if(!blocked){ends=candidate;break;}
    }
    if(!ends)return;
    const [a,b]=ends;
    string(name,a,b,{sag:theme==='festoon'||theme==='christmas'?.3:0});
    for(const p of[a,b])bar([p[0],base,p[2]],p,theme==='neon'?colors[sequence++%colors.length]:0x688795,theme==='neon'?.32:.085,theme==='neon'?sequence*.7:-1);
  }
  function rim(name,x,y,z,hx,hz,{full=theme==='neon'}={}){
    const e=.15,alongX=hx>=hz;
    for(const side of[-1,1]){
      string(name+(alongX?(side<0?' south cap':' north cap'):(side<0?' west cap':' east cap')),
        alongX?[x-hx,y,z+side*(hz+e)]:[x+side*(hx+e),y,z-hz],
        alongX?[x+hx,y,z+side*(hz+e)]:[x+side*(hx+e),y,z+hz]);
    }
    if(full)for(const side of[-1,1])string(name+(alongX?(side<0?' west return':' east return'):(side<0?' south return':' north return')),
      alongX?[x+side*(hx+e),y,z-hz]:[x-hx,y,z+side*(hz+e)],
      alongX?[x+side*(hx+e),y,z+hz]:[x+hx,y,z+side*(hz+e)]);
  }
  if(raised){
    // The real safety kerbs already preserve bridge/ramp openings. Dress
    // their tops rather than stringing invisible wires across those gaps.
    for(const d of map.colliders.filter(d=>d.material==='kerb')){
      const p=d.position,h=d.half,y=p.y+h.y+.2;
      string(d.id+' edge',h.x>=h.z?[p.x-h.x,y,p.z]:[p.x,y,p.z-h.z],h.x>=h.z?[p.x+h.x,y,p.z]:[p.x,y,p.z+h.z]);
    }
    const cover=map.colliders.filter(d=>d.shape==='box'&&!/boundary|pier|pillar|wall|pit|floor|furnace/.test(d.id)&&!['asphalt','ice','kerb','slag'].includes(d.material)&&d.half.y>=.8&&Math.max(d.half.x,d.half.z)<=10).slice(0,16);
    for(const d of cover)rim(d.id,d.position.x,d.position.y+d.half.y+.22,d.position.z,d.half.x,d.half.z);
    const decks=map.colliders.filter(d=>d.shape==='deck'&&(/^[a-z]+-[12]$|gantry|catwalk|courtyard|loading-deck|quarry-shelf/.test(d.id))).slice(0,6);
    for(const d of decks){
      const p=d.position,h=d.half;
      // Short, close edge fixtures keep the deck corners readable without
      // turning the entire far skyline into an expensive string of dots.
      const x=p.x-h.x+.2,z=p.z-h.z+.2;
      string(d.id+' corner edge',[x,p.y+h.y+.9,z],[x+Math.min(12,h.x*2-1),p.y+h.y+.9,z]);
    }
    for(const d of map.colliders.filter(d=>d.shape==='wedge'&&!/spiral|kicker|jump/.test(d.id)).slice(0,4)){
      const a=2*Math.atan2(d.rotation?.y||0,d.rotation?.w??1),s=Math.sin(a),c=Math.cos(a),p=d.position,h=d.half;
      for(const side of[-1,1]){
        const edge=(z,y)=>[p.x+side*(h.x+.18)*c+z*s,p.y+y+.65,p.z+z*c-side*(h.x+.18)*s];
        string(d.id+' ramp '+(side<0?'left':'right'),edge(-h.z,-h.y),edge(h.z,h.y));
      }
    }
    // Each actual start gets a nearby lane gantry, unless an equivalent
    // gantry already covers this lane and storey. All starts have a tested
    // 20m clear lane; the crossbar clears drivers and indoor ceilings.
    const gates=[];
    for(const [i,p]of(map.spawns||[]).entries()){
      const angle=p.angle||0,x=p.x+Math.sin(angle)*8,z=p.z+Math.cos(angle)*8;
      const same=gates.find(g=>Math.abs(g.y-p.y)<.5&&Math.hypot(g.x-x,g.z-z)<13&&Math.cos(g.angle-angle)>.8);
      if(same){same.spawns.push(i);continue;}
      const g={name:'spawn lane '+i,x,z,y:p.y,angle,spawns:[i]};gates.push(g);
      arch(g.name,x,z,7.2,p.y,angle);
    }
    // Visible local landmarks, rather than only the distant boundary wall.
    if(map.id==='frost')arch('rink Christmas arch',0,-12,12,0);
    if(map.id==='garden')string('fountain festoon',[-20,4.4,-9],[-4,4.4,-9],{sag:.5});
    if(map.id==='neon'){
      arch('cargo arcade sign',-24,-24,13,0,Math.PI/4);
      arch('loading deck neon sign',22,22,11,6);
    }
    if(map.id==='skyport'){
      string('helipad marquee',[-54,23.5,-28],[-28,23.5,-28]);
      string('parking marquee',[26,13.5,28],[54,13.5,28]);
    }
    if(map.id==='foundry'){
      string('furnace hall marquee',[-24,14,-18],[24,14,-18]);
      string('crane yard marquee',[72,6,60],[102,6,60]);
    }
  }else{
    // This path deliberately uses only fields present in the real public
    // map snapshot: classic authority does not send its spawn pool.
    for(const[i,b]of(map.barriers||[]).slice(0,8).entries()){
      const y=groundAt(b.x,b.z)+1.18;
      string('barrier '+i+' cap',b.hw>=b.hd?[b.x-b.hw,y,b.z]:[b.x,y,b.z-b.hd],b.hw>=b.hd?[b.x+b.hw,y,b.z]:[b.x,y,b.z+b.hd]);
    }
    for(const[i,b]of(map.blocks||[]).entries())rim('cover '+i,b.x,groundAt(b.x,b.z)+2.55,b.z,b.hw,b.hd);
    arch('central north-south lane',0,0,8,groundAt(0,0));
    arch('central east-west lane',0,0,8,groundAt(0,0),Math.PI/2);
    if((map.half||30)<=30){
      for(const[x,z]of[[18,0],[-18,0],[0,18],[0,-18]])arch('outer lane '+x+'/'+z,x,z,7.2,groundAt(x,z),x?Math.PI/2:0);
    }else{
      for(const x of[-36,36])for(const z of[-36,36])arch('corner lane '+x+'/'+z,x,z,8,groundAt(x,z),Math.atan2(-x,-z));
      if(theme==='christmas')for(const x of[-22,22])string('ski station roof '+x,[x-6,6.15,map.half+24.85],[x+6,6.15,map.half+24.85]);
      if(theme==='festoon')for(const x of[-40,40])string('garden lane festoon '+x,[x,4.4,-10],[x,4.4,2],{sag:.5});
    }
    for(const[i,r]of(map.ramps||[]).slice(0,2).entries()){
      const s=Math.sin(r.angle||0),c=Math.cos(r.angle||0),y=groundAt(r.x,r.z);
      for(const side of[-1,1]){
        const edge=(z,dy)=>[r.x+side*(r.hw+.18)*c+z*s,y+dy+.5,r.z+z*c-side*(r.hw+.18)*s];
        string('ramp '+i+' '+(side<0?'left':'right'),edge(-r.hl,0),edge(r.hl,r.h));
      }
    }
  }
  for(const [i,c]of(map.features?.cannons||[]).entries()){
    const y=c.y??groundAt(c.x,c.z),ly=(c.land.y??groundAt(c.land.x,c.land.z))+RIDE_HEIGHT;
    const muzzle=flightPose(c,{x:c.x,y:y+RIDE_HEIGHT,z:c.z,a:c.angle,ly},.18).position;
    const s=Math.sin(c.angle),co=Math.cos(c.angle),forward=(muzzle.x-c.x)*s+(muzzle.z-c.z)*co,rise=muzzle.y-y-1.5,pitch=Math.atan2(rise,forward),cy=y+1.5+rise;
    runs.push({name:'cannon '+i+' muzzle',center:[muzzle.x,cy,muzzle.z],first:bulbs.length,bulbs:24});
    for(let j=0;j<24;j++){
      const a=j/24*Math.PI*2,u=Math.cos(a)*2.65,v=Math.sin(a)*2.65;
      bulb([muzzle.x+u*co-v*Math.sin(pitch)*s,cy+v*Math.cos(pitch),muzzle.z-u*s-v*Math.sin(pitch)*co],j*.7);
    }
  }
  // Portals own their quiet, colour-matched inner light. Festive bulbs on
  // the aperture overpower the opening and suggest a closed fairground prop.
  return {theme,raised,runs,bulbs,bars,diameter};
}

const vertex=`
attribute vec3 festiveColor;
attribute float festivePhase;
uniform float uHaloScale;
varying vec3 vFestiveColor;
varying vec2 vBulbUv;
varying float vPhase;
varying vec3 vFestiveViewPosition;
#include <fog_pars_vertex>
void main(){
  vFestiveColor=festiveColor;
  vBulbUv=uv*2.0-1.0;
  vPhase=festivePhase;
  vec4 mvPosition;
  #if defined(FESTIVE_BULB) || defined(FESTIVE_HALO)
    mvPosition=modelViewMatrix*instanceMatrix*vec4(0.0,0.0,0.0,1.0);
    vec2 size=vec2(length(instanceMatrix[0].xyz),length(instanceMatrix[1].xyz));
    #ifdef FESTIVE_HALO
      size*=uHaloScale;
    #endif
    mvPosition.xy+=position.xy*size;
  #else
    mvPosition=modelViewMatrix*instanceMatrix*vec4(position,1.0);
    if(festivePhase>=0.0)vPhase+=(position.y+.5)*length(instanceMatrix[1].xyz)*1.0;
  #endif
  vFestiveViewPosition=mvPosition.xyz;
  gl_Position=projectionMatrix*mvPosition;
  #include <fog_vertex>
}`;
const fragment=`
uniform float uTime;
uniform float uMotion;
uniform float uChase;
varying vec3 vFestiveColor;
varying vec2 vBulbUv;
varying float vPhase;
varying vec3 vFestiveViewPosition;
#include <fog_pars_fragment>
void main(){
  // Decorative gantries can cross a chase orbit. Keep their nearby faces
  // from becoming an opaque slab over the kart; gameplay solids stay intact.
  float nearFade=smoothstep(2.5,4.5,length(vFestiveViewPosition));
  float wave=sin(uTime*(uChase>.5?5.5:1.5)-vPhase);
  float intensity=vPhase<0.0?1.0:mix(1.0,uChase>.5?.32+1.05*pow(.5+.5*wave,3.0):.85+.15*wave,uMotion);
  vec3 color=vFestiveColor*intensity;
  #if defined(FESTIVE_BULB) || defined(FESTIVE_HALO)
    float r=dot(vBulbUv,vBulbUv);
    if(r>1.0)discard;
  #endif
  #ifdef FESTIVE_HALO
    gl_FragColor=vec4(color,.55*pow(1.0-r,3.0)*nearFade);
    // Additive glow fades out in fog; it must never add the fog colour.
    #ifdef USE_FOG
      #ifdef FOG_EXP2
        float fade=1.0-exp(-fogDensity*fogDensity*vFogDepth*vFogDepth);
      #else
        float fade=smoothstep(fogNear,fogFar,vFogDepth);
      #endif
      gl_FragColor.a*=1.0-fade;
    #endif
  #else
    #ifdef FESTIVE_BULB
      color*=.85+.15*sqrt(1.0-r);
      color=mix(color,vec3(1.0,.98,.85),.55*pow(max(0.0,1.0-length(vBulbUv-vec2(-.3,.3))*2.5),2.0));
    #endif
    gl_FragColor=vec4(color,nearFade);
    #include <fog_fragment>
  #endif
  #include <colorspace_fragment>
}`;

export function createKartFestiveLights(THREE,{parent,map,groundAt,quality='high',reducedMotion=false,mediumDensity=.5}={}){
  const layout=festiveLightLayout(map,{groundAt}),group=new THREE.Group();group.name='festive-'+layout.theme;group.userData.dynamic=true;parent.add(group);
  const uniforms=THREE.UniformsUtils.merge([THREE.UniformsLib.fog,{uTime:{value:0},uMotion:{value:1},uChase:{value:layout.theme==='neon'||layout.theme==='arcade'?1:0},uHaloScale:{value:4}}]);
  // Near-camera decoration fades smoothly without leaving an invisible depth
  // wall over the kart. Far cores remain fully opaque in the fragment output.
  const material=kind=>new THREE.ShaderMaterial({name:'festive-'+kind,uniforms,vertexShader:vertex,fragmentShader:fragment,defines:kind==='core'?{FESTIVE_BULB:1}:kind==='halo'?{FESTIVE_HALO:1}:{},fog:true,toneMapped:false,transparent:true,depthWrite:false,...(kind==='halo'?{blending:THREE.AdditiveBlending}:{})});
  const bulbGeo=new THREE.PlaneGeometry(1,1),barGeo=new THREE.BoxGeometry(1,1,1),bulbMat=material('core'),barMat=material('tube'),haloMat=material('halo');
  const bulbs=new THREE.InstancedMesh(bulbGeo,bulbMat,layout.bulbs.length),bars=new THREE.InstancedMesh(barGeo,barMat,layout.bars.length),halos=new THREE.InstancedMesh(bulbGeo,haloMat,layout.bulbs.length);
  bulbs.name='festive-bulb-batch';bars.name='festive-wire-tube-batch';halos.name='festive-halo-batch';halos.renderOrder=2;group.add(bulbs,bars,halos);
  const dummy=new THREE.Object3D(),color=new THREE.Color(),up=new THREE.Vector3(0,1,0),direction=new THREE.Vector3();
  const ordered=[];
  for(let residue=0;residue<4;residue++)for(let i=residue;i<layout.bulbs.length;i+=4)ordered.push(layout.bulbs[i]);
  for(const [mesh,entries]of[[bulbs,ordered],[bars,layout.bars]]){
    const colors=new Float32Array(entries.length*3),phases=new Float32Array(entries.length);
    entries.forEach((item,i)=>{
      dummy.quaternion.identity();
      if(item.p){dummy.position.fromArray(item.p);dummy.scale.set(item.size,item.size,1);}
      else{dummy.position.fromArray(item.a).add(new THREE.Vector3().fromArray(item.b)).multiplyScalar(.5);direction.fromArray(item.b).sub(new THREE.Vector3().fromArray(item.a));dummy.quaternion.setFromUnitVectors(up,direction.clone().normalize());dummy.scale.set(item.width,direction.length(),item.width);}
      dummy.updateMatrix();mesh.setMatrixAt(i,dummy.matrix);color.setHex(item.color);color.toArray(colors,i*3);phases[i]=item.phase;
    });
    mesh.geometry.setAttribute('festiveColor',new THREE.InstancedBufferAttribute(colors,3));mesh.geometry.setAttribute('festivePhase',new THREE.InstancedBufferAttribute(phases,1));
    mesh.instanceMatrix.needsUpdate=true;mesh.computeBoundingSphere();
  }
  // Share the core's static GPU matrix buffer and attributes, not a CPU copy.
  halos.instanceMatrix=bulbs.instanceMatrix;
  halos.boundingSphere=bulbs.boundingSphere.clone();halos.boundingSphere.radius+=1;
  for(const mesh of[bulbs,bars,halos])mesh.castShadow=mesh.receiveShadow=false;
  let tier,disposed=false;
  function animate(time=0){
    if(disposed)return;
    const next=typeof quality==='function'?quality():quality;
    if(next!==tier){tier=next;halos.count=bulbs.count=Math.ceil(ordered.length*(tier==='low'?.25:tier==='medium'?mediumDensity:1));uniforms.uHaloScale.value=tier==='low'?4.5:tier==='medium'?4.2:4;}
    uniforms.uTime.value=Number.isFinite(time)?time:0;
    uniforms.uMotion.value=(typeof reducedMotion==='function'?reducedMotion():reducedMotion)?0:1;
  }
  animate();
  return{group,layout,bulbs,bars,halos,uniforms,animate,stats:()=>({theme:layout.theme,drawCalls:3,bulbs:bulbs.count,mediumBulbs:Math.ceil(ordered.length*mediumDensity),bars:bars.count,triangles:bulbs.count*4+bars.count*12,tier}),
    dispose(){if(disposed)return;disposed=true;group.removeFromParent();bulbs.dispose();bars.dispose();halos.dispose();for(const r of[bulbGeo,barGeo,bulbMat,barMat,haloMat])r.dispose();group.clear();}};
}

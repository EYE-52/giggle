// Static arena structure dressing: five draws regardless of wall count.
// Unit geometry and instance buffers live until dispose; frames do no work.
import {obstacleStyle,createObstaclePanelTexture,createObstacleContactTexture,applyCourseLampEmission} from './kart-obstacle-style.mjs';
const EMPTY=Object.freeze([]);
const styleFor=map=>obstacleStyle(map?.id==='blocks'||map?.theme==='blocks'?'quarry':map?.theme);
export function createKartArenaStructures(THREE,scene,{groundAt=()=>0}={}) {
  const root=new THREE.Group();root.name='arena-structures';scene.add(root);
  const box=new THREE.BoxGeometry(1,1,1),wedge=new THREE.BufferGeometry();
  wedge.setAttribute('position',new THREE.Float32BufferAttribute([-1,0,-1,1,0,-1,-1,0,1,1,0,1,-1,1,1,1,1,1],3));
  wedge.setIndex([0,1,2,1,3,2,0,4,1,1,4,5,2,3,4,3,5,4,0,2,4,1,5,3]);wedge.computeVertexNormals();
  const decal=new THREE.BufferGeometry(),coords=[[-.7,-.25],[-.45,-.5],[0,.05],[.45,-.5],[.7,-.25],[0,.65]];
  decal.setAttribute('position',new THREE.Float32BufferAttribute(coords.flatMap(([x,z])=>[x,(z+1)/2+.025,z]),3));
  decal.setIndex([0,1,2,2,3,4,0,2,5,2,4,5]);decal.computeVertexNormals();
  // The thin cap sides overlap the upper body at the same X/Z plane.
  // Bias only that paint so the shaded body cannot stipple through it.
  const bodyMat=new THREE.MeshStandardMaterial({color:0xffffff,roughness:.8}),capMat=new THREE.MeshBasicMaterial({color:0xffffff,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-2});
  // Tile faces in metres using the existing instance scale. Long walls keep
  // diagonal caution stripes instead of stretching them into horizontal lines.
  bodyMat.onBeforeCompile=shader=>{
    applyCourseLampEmission(shader);
    shader.vertexShader=shader.vertexShader.replace('#include <uv_vertex>',`#include <uv_vertex>
      #ifdef USE_INSTANCING
        float obstacleSpan=abs(normal.z)>.5?length(instanceMatrix[0].xyz):length(instanceMatrix[2].xyz);
        #ifdef USE_MAP
          vMapUv.x*=obstacleSpan;
        #endif
      #endif`);
  };
  const contactTex=createObstacleContactTexture(THREE,{lit:true}),contactGeo=new THREE.PlaneGeometry(1,1);
  const contactMat=new THREE.MeshBasicMaterial({map:contactTex,transparent:true,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-2});
  const panels=new Map();
  const rampMat=new THREE.MeshStandardMaterial({color:0x435769,roughness:.7}),arrowMat=new THREE.MeshBasicMaterial({color:0xffed83,side:THREE.DoubleSide});
  const make=(name,g,m,n)=>{const mesh=new THREE.InstancedMesh(g,m,n);mesh.name=name;mesh.count=0;mesh.frustumCulled=false;root.add(mesh);return mesh;};
  const bodies=make('arena-barrier-bodies',box,bodyMat,64),caps=make('arena-barrier-caps',box,capMat,64),ramps=make('arena-ramp-wedges',wedge,rampMat,16),arrows=make('arena-ramp-chevrons',decal,arrowMat,16);
  const contacts=make('arena-barrier-contact',contactGeo,contactMat,64);
  const dummy=new THREE.Object3D(),color=new THREE.Color();let identity,theme,wallCount=-1,rampCount=-1,disposed=false;
  function sync(map) {
    if(disposed)return;
    const walls=map?.barriers||EMPTY,lips=map?.ramps||EMPTY;
    if(identity===map?.id&&theme===map?.theme&&wallCount===walls.length&&rampCount===lips.length)return;
    if(walls.length>64||lips.length>16)throw new RangeError('arena structure budget exceeded');
    identity=map?.id;theme=map?.theme;wallCount=walls.length;rampCount=lips.length;
    const style=styleFor(map);
    if(!panels.has(style))panels.set(style,createObstaclePanelTexture(THREE,style,{hazard:true}));
    bodyMat.map=panels.get(style);bodyMat.emissive.setHex(0xffffff);bodyMat.emissiveIntensity=theme==='neon'?.25:.12;
    bodyMat.needsUpdate=true;
    bodyMat.roughness=theme==='neon'?.5:.8;bodyMat.metalness=theme==='neon'?.25:0;
    bodies.count=caps.count=contacts.count=wallCount;ramps.count=arrows.count=rampCount;
    for(let i=0;i<walls.length;i++){
      const b=walls[i],y=groundAt(b.x,b.z);dummy.rotation.set(0,0,0);
      // One metre still clears the existing pulse path (bottom at 1.03m).
      dummy.position.set(b.x,y+.48,b.z);dummy.scale.set(b.hw*2,.96,b.hd*2);dummy.updateMatrix();bodies.setMatrixAt(i,dummy.matrix);
      dummy.position.y=y+.95;dummy.scale.y=.1;dummy.updateMatrix();caps.setMatrixAt(i,dummy.matrix);caps.setColorAt(i,color.setHex(theme==='neon'&&i%2?0xf9a5d8:style.top));
      dummy.rotation.x=-Math.PI/2;dummy.position.y=y+.025;dummy.scale.set(b.hw*2+.9,b.hd*2+.9,1);dummy.updateMatrix();contacts.setMatrixAt(i,dummy.matrix);
    }
    for(let i=0;i<lips.length;i++){
      const r=lips[i];dummy.position.set(r.x,groundAt(r.x,r.z),r.z);dummy.rotation.set(0,r.angle,0);dummy.scale.set(r.hw,r.h,r.hl);dummy.updateMatrix();ramps.setMatrixAt(i,dummy.matrix);arrows.setMatrixAt(i,dummy.matrix);
    }
    for(const mesh of [bodies,caps,ramps,arrows,contacts]){mesh.instanceMatrix.needsUpdate=true;if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;}
  }
  return {root,sync,animate(){},stats:()=>({barriers:wallCount,ramps:rampCount,drawCalls:(wallCount>0?3:0)+(rampCount>0?2:0)}),dispose(){if(disposed)return;disposed=true;scene.remove(root);for(const mesh of [bodies,caps,ramps,arrows,contacts])mesh.dispose();for(const g of [box,wedge,decal,contactGeo])g.dispose();for(const m of [bodyMat,capMat,rampMat,arrowMat,contactMat])m.dispose();for(const tex of panels.values())tex.dispose();contactTex.dispose();}};
}

export function drawArenaRoads2d(ctx,map,px,pz,scale) {
  for(const road of map?.roads||[]){
    ctx.beginPath();for(let i=0;i<road.points.length;i++){const p=road.points[i];ctx[i?'lineTo':'moveTo'](px(p[0]),pz(p[1]));}if(road.closed)ctx.closePath();
    ctx.strokeStyle='#f6e9c9';ctx.lineWidth=(road.width+1)*scale;ctx.stroke();
    ctx.strokeStyle='#53616a';ctx.lineWidth=road.width*scale;ctx.stroke();
  }
}
export function drawArenaStructures2d(ctx,map,px,pz,scale) {
  const style=styleFor(map);
  ctx.fillStyle='#'+style.body.toString(16).padStart(6,'0');ctx.strokeStyle='#'+style.top.toString(16).padStart(6,'0');ctx.lineWidth=.25*scale;
  for(const b of map?.barriers||[]){ctx.fillRect(px(b.x-b.hw),pz(b.z-b.hd),b.hw*2*scale,b.hd*2*scale);ctx.strokeRect(px(b.x-b.hw),pz(b.z-b.hd),b.hw*2*scale,b.hd*2*scale);}
  for(const r of map?.ramps||[]){
    ctx.save();ctx.translate(px(r.x),pz(r.z));ctx.rotate(-r.angle);ctx.fillStyle='#435769';ctx.fillRect(-r.hw*scale,-r.hl*scale,r.hw*2*scale,r.hl*2*scale);ctx.strokeStyle='#ffed83';ctx.lineWidth=.4*scale;
    ctx.beginPath();ctx.moveTo(-r.hw*.6*scale,-.5*scale);ctx.lineTo(0,1*scale);ctx.lineTo(r.hw*.6*scale,-.5*scale);ctx.stroke();ctx.restore();
  }
}

import {obstacleStyle,createObstaclePanelTexture,createObstacleContactTexture} from './kart-obstacle-style.mjs';

// Six static instance batches: shaded warning faces, bright caps, contact
// shadows, level washes, drop paint and ramp chevrons. No per-frame work.
export function createRaisedReadability(THREE,{parent,map,geometry,material,texture}){
  const root=new THREE.Group();root.name='raised-readability';parent.add(root);
  const theme=['garden','frost','neon'].includes(map.id)?map.id:map.id==='foundry'?'quarry':'neon',style=obstacleStyle(theme);
  const panel=texture(createObstaclePanelTexture(THREE,style,{hazard:true}));
  const contact=texture(createObstacleContactTexture(THREE));
  const faceMat=material(new THREE.MeshStandardMaterial({map:panel,emissiveMap:panel,emissive:0xffffff,emissiveIntensity:.14,roughness:.8}));
  faceMat.onBeforeCompile=shader=>{shader.vertexShader=shader.vertexShader.replace('#include <uv_vertex>',`#include <uv_vertex>
    #ifdef USE_INSTANCING
      float span=length(instanceMatrix[0].xyz)/4.0;
      vMapUv.x*=span;
      vEmissiveMapUv.x*=span;
    #endif`);};
  const bright=material(new THREE.MeshBasicMaterial({color:0xffffff}));
  // The coloured caps sit flush on the collision mesh. Give only their
  // paint a depth bias so the body cannot flicker through at shallow angles.
  const capPaint=material(new THREE.MeshBasicMaterial({color:0xffffff,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-2}));
  const contactMat=material(new THREE.MeshBasicMaterial({map:contact,transparent:true,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-2}));
  const washMat=material(new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:.23,depthWrite:false}));
  const plane=geometry(new THREE.PlaneGeometry(1,1)),flat=geometry(new THREE.PlaneGeometry(1,1).rotateX(-Math.PI/2)),box=geometry(new THREE.BoxGeometry(1,1,1));
  const arrow=geometry(new THREE.BufferGeometry());
  arrow.setAttribute('position',new THREE.Float32BufferAttribute([-.9,0,-.4,-.65,0,-.65,0,0,.05,.65,0,-.65,.9,0,-.4,0,0,.65],3));arrow.setIndex([0,2,1,2,4,3,0,5,2,2,5,4]);arrow.computeVertexNormals();
  const buckets={faces:{g:plane,m:faceMat,rows:[]},caps:{g:box,m:capPaint,rows:[]},contacts:{g:flat,m:contactMat,rows:[]},zones:{g:flat,m:washMat,rows:[]},edges:{g:flat,m:bright,rows:[]},chevrons:{g:arrow,m:bright,rows:[]}};
  const add=(key,p,s,color=0xffffff,q=new THREE.Quaternion())=>buckets[key].rows.push({p,s,color,q});
  const turn=a=>new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),a);
  const levelAt=y=>map.levels?.reduce((best,l)=>Math.abs(l.y-y)<Math.abs(best.y-y)?l:best,map.levels[0])||{y:0,color:style.top};
  function support(d,x,z){
    const a=2*Math.atan2(d.rotation?.y||0,d.rotation?.w??1),dx=x-d.position.x,dz=z-d.position.z,lx=Math.cos(a)*dx-Math.sin(a)*dz,lz=Math.sin(a)*dx+Math.cos(a)*dz;
    if(Math.abs(lx)>d.half.x+.05||Math.abs(lz)>d.half.z+.05)return -Infinity;
    return d.position.y+(d.shape==='wedge'?lz*d.half.y/d.half.z:d.half.y);
  }
  for(const d of map.colliders){
    const {x,y,z}=d.position,h=d.half,top=y+h.y,bottom=y-h.y;
    if(d.shape==='deck'){
      const color=levelAt(top).color;
      // A quiet colour wash marks the entire driving level, not its underside.
      add('zones',[x,top+.008,z],[h.x*2-.12,1,h.z*2-.12],color);
      for(const axis of ['x','z'])for(const side of [-1,1]){
        const along=axis==='x'?h.z:h.x,edge=axis==='x'?h.x:h.z;
        for(let t=-along+2;t<along-1;t+=4){
          const px=x+(axis==='x'?side*(edge-.35):t),pz=z+(axis==='z'?side*(edge-.35):t);
          const outsideX=px+(axis==='x'?side*.8:0),outsideZ=pz+(axis==='z'?side*.8:0);
          if(map.colliders.some(other=>other!==d&&Math.abs(support(other,outsideX,outsideZ)-top)<.25))continue;
          // Alternating black and cream flags are a drop cue, never a rail.
          add('edges',[px,top+.03,pz],axis==='x'?[.65,1,3.7]:[3.7,1,.65],0xffdf88);
          add('edges',[px,top+.034,pz],axis==='x'?[.68,1,1.2]:[1.2,1,.68],0x263b4c,turn(.35));
        }
      }
    }else if(d.shape==='wedge'){
      const a=2*Math.atan2(d.rotation?.y||0,d.rotation?.w??1),slope=h.y/h.z;
      const q=turn(a).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),-Math.atan(slope)));
      for(let t=-h.z+3;t<h.z-1;t+=6)add('chevrons',[x+Math.sin(a)*t,y+t*slope+.04,z+Math.cos(a)*t],[Math.min(3,h.x*.7),1,2],0xffe7a3,q);
    }else if(bottom>=-.01&&!['hedge','fountain','slag'].includes(d.material)){
      const cap=levelAt(bottom).color,tankCage=map.id==='foundry'&&d.material==='cover';
      if(tankCage){
        // Keep the cage outline bright without painting an opaque box over
        // the cylindrical storage tanks and their top ports.
        for(const side of [-1,1]){
          add('caps',[x+side*(h.x-.08),top-.055,z],[.16,.11,h.z*2],cap);
          add('caps',[x,top-.055,z+side*(h.z-.08)],[h.x*2,.11,.16],cap);
        }
      }else add('caps',[x,top-.055,z],[h.x*2,.11,h.z*2],d.material==='kerb'?0xffe4a2:cap);
      // The shadow's height follows the obstacle's support storey. A roof
      // prop must never print a shadow onto a road ten metres below it.
      add('contacts',[x,bottom+.022,z],[h.x*2+.9,1,h.z*2+.9]);
      for(const axis of ['x','z'])for(const side of [-1,1]){
        const half=axis==='x'?h.x:h.z,width=2*(axis==='x'?h.z:h.x),height=tankCage ? .45 : Math.min(2,h.y*2-.1);
        if(height<.2)continue;
        add('faces',[x+(axis==='x'?side*(half+.008):0),bottom+height/2+.035,z+(axis==='z'?side*(half+.008):0)],[width,height,1],0xffffff,turn(axis==='x'?side*Math.PI/2:side===1?0:Math.PI));
      }
    }
  }
  for(const pit of map.fallZones||[])for(const axis of ['x','z'])for(const side of [-1,1]){
    const along=axis==='x'?pit.halfZ:pit.halfX,edge=axis==='x'?pit.halfX:pit.halfZ;
    for(let t=-along;t<=along;t+=2){
      const x=pit.x+(axis==='x'?side*(edge+.55):t),z=pit.z+(axis==='z'?side*(edge+.55):t);
      add('edges',[x,.035,z],axis==='x'?[.8,1,1.85]:[1.85,1,.8],Math.round(t)%4===0?0xffe292:0x263b4c);
    }
  }
  const instances=[],dummy=new THREE.Object3D(),color=new THREE.Color();
  for(const [name,b]of Object.entries(buckets)){
    if(!b.rows.length)continue;
    const mesh=new THREE.InstancedMesh(b.g,b.m,b.rows.length);mesh.name='raised-'+name;mesh.castShadow=false;mesh.receiveShadow=false;
    b.rows.forEach((r,i)=>{dummy.position.set(...r.p);dummy.scale.set(...r.s);dummy.quaternion.copy(r.q);dummy.updateMatrix();mesh.setMatrixAt(i,dummy.matrix);if(name!=='contacts'&&name!=='faces')mesh.setColorAt(i,color.setHex(r.color));});
    mesh.instanceMatrix.needsUpdate=true;mesh.computeBoundingSphere();root.add(mesh);instances.push(mesh);
  }
  root.userData.batches=instances.length;
  return {root,dispose(){for(const mesh of instances)mesh.dispose();}};
}

// Same soft day / teal-filled night values as the shared classic art.
// Apply to the world's existing two lights, avoiding extra draw/light cost.
export function applyRaisedLighting(sun,hemi,phase,{neon=false}={}){
  const p=Math.max(0,Math.min(1,phase)),night=Math.max(0,(p-.65)/.35);
  sun.intensity=(neon?1.35:1.75)*(1-night)+.9*night;
  sun.color.set(night>.5?0xbfe0ff:p>.3?0xffd9a8:0xfff1d6);
  hemi.intensity=neon?1.65:1.25-.25*night;
  hemi.color.set(night>.5?0xb6d8ed:0xe4eeff);
  hemi.groundColor.set(night>.5?neon?0x3e657b:0x397b70:neon?0x436b7b:0x819d87);
}

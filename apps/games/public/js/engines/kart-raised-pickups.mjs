// Bounded question/star boxes and quiet fixed-home outlines. Two draw calls;
// no per-box materials, shadow casters, countdown labels or frame allocations.
export function createRaisedPickups(THREE,scene,capacity=48,source){
  if(!source)throw Error('The raised pickup crate LOD did not load');
  // Combine the three tiny, source-backed LOD surfaces once. The mark selector
  // is per vertex; the risk choice is per instance, retaining a single draw.
  source.updateMatrixWorld(true);
  const positions=[],normals=[],colors=[],marks=[],point=new THREE.Vector3(),normal=new THREE.Vector3(),normalMatrix=new THREE.Matrix3();
  const inverse=new THREE.Matrix4().copy(source.matrixWorld).invert(),matrix=new THREE.Matrix4();
  for(const [name,mark] of [['Shell',0],['Question',1],['Star',2]]){
    const part=source.getObjectByName('PickupCrate'+name);
    if(!part?.isMesh)throw Error('The raised pickup crate '+name+' did not load');
    matrix.multiplyMatrices(inverse,part.matrixWorld);normalMatrix.getNormalMatrix(matrix);
    const g=part.geometry,p=g.attributes.position,n=g.attributes.normal,c=g.attributes.color,index=g.index;
    for(let i=0;i<(index?.count??p.count);i++){
      const j=index?index.getX(i):i;
      point.fromBufferAttribute(p,j).applyMatrix4(matrix);positions.push(point.x,point.y,point.z);
      normal.fromBufferAttribute(n,j).applyMatrix3(normalMatrix).normalize();normals.push(normal.x,normal.y,normal.z);
      colors.push(c.getX(j),c.getY(j),c.getZ(j));marks.push(mark);
    }
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));
  geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));geometry.setAttribute('pickupMark',new THREE.Float32BufferAttribute(marks,1));
  const risk=new THREE.InstancedBufferAttribute(new Float32Array(capacity),1);geometry.setAttribute('homeRisk',risk);
  const material=new THREE.MeshLambertMaterial({vertexColors:true,emissive:0x7895b1,emissiveIntensity:.12});
  material.onBeforeCompile=shader=>{
    shader.vertexShader='attribute float homeRisk;attribute float pickupMark;varying float vPickupRisk;varying float vPickupMark;\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvPickupRisk=homeRisk;vPickupMark=pickupMark;');
    shader.fragmentShader='varying float vPickupRisk;varying float vPickupMark;\n'+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
      if((vPickupMark>0.5&&vPickupMark<1.5&&vPickupRisk>0.5)||(vPickupMark>1.5&&vPickupRisk<0.5))discard;
      if(vPickupRisk>0.5&&vPickupMark<0.5&&diffuseColor.b>diffuseColor.r)diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.32,.055,.39),.75);`);
  };
  const mesh=new THREE.InstancedMesh(geometry,material,capacity);mesh.name='raised-item-boxes';mesh.count=0;mesh.visible=false;mesh.castShadow=false;mesh.receiveShadow=false;mesh.frustumCulled=false;scene.add(mesh);mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  // A square socket ring made from eight triangles, with an empty centre.
  const ringGeometry=new THREE.BufferGeometry(),ringPositions=[],outer=1,inner=.84;
  const corners=[[-1,-1],[1,-1],[1,1],[-1,1]];
  for(let i=0;i<4;i++){const a=corners[i],b=corners[(i+1)%4],p=[a.map(n=>n*outer),b.map(n=>n*outer),b.map(n=>n*inner),a.map(n=>n*inner)];for(const j of[0,2,1,0,3,2])ringPositions.push(p[j][0],0,p[j][1]);}
  ringGeometry.setAttribute('position',new THREE.Float32BufferAttribute(ringPositions,3));ringGeometry.computeVertexNormals();
  const ringMaterial=new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:.5,depthWrite:false,side:THREE.DoubleSide,forceSinglePass:true});
  const homes=new THREE.InstancedMesh(ringGeometry,ringMaterial,capacity);homes.name='raised-box-homes';homes.count=0;homes.frustumCulled=false;scene.add(homes);homes.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const dummy=new THREE.Object3D(),color=new THREE.Color();let disposed=false;
  return {mesh,homes,update(crates,time,hidden=null){if(disposed)return;let n=0,h=0;for(const c of crates||[]){
      if(c.homeId&&h<capacity){dummy.position.copy(c.position);dummy.position.y-=.57;dummy.rotation.set(0,0,0);dummy.scale.setScalar(c.available===false&&c.readyInMs<=750?1+.08*Math.sin(time*12):1);dummy.updateMatrix();homes.setMatrixAt(h,dummy.matrix);homes.setColorAt(h++,color.setHex(c.profile==='risk'?0xffca68:0xb3dfe1));}
      if(c.available===false||hidden?.(c.id)||n>=capacity)continue;
      dummy.position.copy(c.position);dummy.position.y+=.3+Math.sin(time*2+c.position.x)*.12;dummy.rotation.set(0,time*.6,0);dummy.scale.setScalar(c.homeId&&c.readyInMs>0&&c.readyInMs<=750?.9:1);dummy.updateMatrix();mesh.setMatrixAt(n,dummy.matrix);risk.setX(n++,c.profile==='risk'?1:0);
    }mesh.count=n;mesh.visible=n>0;homes.count=h;homes.visible=h>0;if(n){mesh.instanceMatrix.needsUpdate=true;risk.needsUpdate=true;}if(h){homes.instanceMatrix.needsUpdate=true;homes.instanceColor.needsUpdate=true;}},
    dispose(){if(disposed)return;disposed=true;for(const m of[mesh,homes]){m.removeFromParent();m.dispose();}for(const r of[geometry,material,ringGeometry,ringMaterial])r.dispose();}};
}

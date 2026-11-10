// Bounded question/star boxes and quiet fixed-home outlines. Two draw calls;
// no per-box materials, shadow casters, countdown labels or frame allocations.
export function createRaisedPickups(THREE,scene,capacity=48){
  const size=32,data=new Uint8Array(size*size*2*4),glyphs=[['01110','11011','00011','00110','01100','00000','01100'],['00100','00100','11111','01110','11111','01010','10001']];
  for(let layer=0;layer<2;layer++)for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const border=x<2||y<2||x>29||y>29,gx=Math.floor((x-6)/4),gy=Math.floor((29-y)/4),mark=gx>=0&&gx<5&&gy>=0&&gy<7&&glyphs[layer][gy][gx]==='1';
    data.set(mark?[255,249,184,255]:border?[239,170,27,255]:layer?[124,62,131,255]:[36,76,119,255],((layer*size+y)*size+x)*4);
  }
  const texture=new THREE.DataTexture(data,size,size*2);texture.colorSpace=THREE.SRGBColorSpace;texture.magFilter=THREE.NearestFilter;texture.needsUpdate=true;
  const geometry=new THREE.BoxGeometry(1.5,1.5,1.5),uv=geometry.attributes.uv;for(let i=0;i<uv.count;i++)uv.setY(i,uv.getY(i)*.5);
  const risk=new THREE.InstancedBufferAttribute(new Float32Array(capacity),1);geometry.setAttribute('homeRisk',risk);
  const material=new THREE.MeshLambertMaterial({map:texture,emissive:0x7895b1,emissiveIntensity:.25});
  material.onBeforeCompile=shader=>{shader.vertexShader='attribute float homeRisk;\n'+shader.vertexShader;shader.vertexShader=shader.vertexShader.replace('#include <uv_vertex>','#include <uv_vertex>\n#ifdef USE_MAP\nvMapUv.y+=homeRisk*.5;\n#endif');};
  const mesh=new THREE.InstancedMesh(geometry,material,capacity);mesh.name='raised-item-boxes';mesh.count=0;mesh.visible=false;mesh.castShadow=false;mesh.receiveShadow=false;mesh.frustumCulled=false;scene.add(mesh);mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  // A square socket ring made from eight triangles, with an empty centre.
  const ringGeometry=new THREE.BufferGeometry(),positions=[],outer=1,inner=.84;
  const corners=[[-1,-1],[1,-1],[1,1],[-1,1]];
  for(let i=0;i<4;i++){const a=corners[i],b=corners[(i+1)%4],p=[a.map(n=>n*outer),b.map(n=>n*outer),b.map(n=>n*inner),a.map(n=>n*inner)];for(const j of[0,2,1,0,3,2])positions.push(p[j][0],0,p[j][1]);}
  ringGeometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));ringGeometry.computeVertexNormals();
  const ringMaterial=new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:.5,depthWrite:false,side:THREE.DoubleSide,forceSinglePass:true});
  const homes=new THREE.InstancedMesh(ringGeometry,ringMaterial,capacity);homes.name='raised-box-homes';homes.count=0;homes.frustumCulled=false;scene.add(homes);homes.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const dummy=new THREE.Object3D(),color=new THREE.Color();let disposed=false;
  return {mesh,homes,update(crates,time,hidden=null){if(disposed)return;let n=0,h=0;for(const c of crates||[]){
      if(c.homeId&&h<capacity){dummy.position.copy(c.position);dummy.position.y-=.57;dummy.rotation.set(0,0,0);dummy.scale.setScalar(c.available===false&&c.readyInMs<=750?1+.08*Math.sin(time*12):1);dummy.updateMatrix();homes.setMatrixAt(h,dummy.matrix);homes.setColorAt(h++,color.setHex(c.profile==='risk'?0xffca68:0xb3dfe1));}
      if(c.available===false||hidden?.(c.id)||n>=capacity)continue;
      dummy.position.copy(c.position);dummy.position.y+=.3+Math.sin(time*2+c.position.x)*.12;dummy.rotation.set(0,time*.6,0);dummy.scale.setScalar(c.homeId&&c.readyInMs>0&&c.readyInMs<=750?.9:1);dummy.updateMatrix();mesh.setMatrixAt(n,dummy.matrix);risk.setX(n++,c.profile==='risk'?1:0);
    }mesh.count=n;mesh.visible=n>0;homes.count=h;homes.visible=h>0;if(n){mesh.instanceMatrix.needsUpdate=true;risk.needsUpdate=true;}if(h){homes.instanceMatrix.needsUpdate=true;homes.instanceColor.needsUpdate=true;}},
    dispose(){if(disposed)return;disposed=true;for(const m of[mesh,homes]){m.removeFromParent();m.dispose();}for(const r of[geometry,material,texture,ringGeometry,ringMaterial])r.dispose();}};
}

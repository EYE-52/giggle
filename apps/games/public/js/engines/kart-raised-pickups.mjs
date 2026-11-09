// One bounded, textured question-box batch. No sculpted question marks,
// per-crate materials, shadow passes or first-pickup geometry allocations.
export function createRaisedPickups(THREE,scene,capacity=32){
  const size=32,data=new Uint8Array(size*size*4),glyph=['01110','11011','00011','00110','01100','00000','01100'];
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const border=x<2||y<2||x>29||y>29,gx=Math.floor((x-6)/4),gy=Math.floor((29-y)/4),question=gx>=0&&gx<5&&gy>=0&&gy<7&&glyph[gy][gx]==='1';
    data.set(question?[255,249,184,255]:border?[239,170,27,255]:[36,76,119,255],(y*size+x)*4);
  }
  const texture=new THREE.DataTexture(data,size,size);texture.colorSpace=THREE.SRGBColorSpace;texture.magFilter=THREE.NearestFilter;texture.needsUpdate=true;
  const geometry=new THREE.BoxGeometry(1.5,1.5,1.5),material=new THREE.MeshLambertMaterial({map:texture,emissive:0x7895b1,emissiveIntensity:.25});
  const mesh=new THREE.InstancedMesh(geometry,material,capacity);mesh.name='raised-item-boxes';mesh.count=0;mesh.visible=false;mesh.castShadow=false;mesh.receiveShadow=false;mesh.frustumCulled=false;scene.add(mesh);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const dummy=new THREE.Object3D();let disposed=false;
  return {mesh,update(crates,time,hidden=null){if(disposed)return;let n=0;for(const c of crates||[]){if(c.available===false||hidden?.(c.id)||n>=capacity)continue;dummy.position.copy(c.position);dummy.position.y+=.3+Math.sin(time*2+c.position.x)*.12;dummy.rotation.set(0,time*.6,0);dummy.updateMatrix();mesh.setMatrixAt(n++,dummy.matrix);}mesh.count=n;mesh.visible=n>0;if(n)mesh.instanceMatrix.needsUpdate=true;},
    dispose(){if(disposed)return;disposed=true;mesh.removeFromParent();mesh.dispose();geometry.dispose();material.dispose();texture.dispose();}};
}

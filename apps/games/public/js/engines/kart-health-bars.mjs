// Authority health only. Billboard meshes share geometry/materials and remain
// depth-tested against the actual scene; no labels, DOM or texture redraws.
export function createKartHealthBars(THREE,scene) {
  const geometry=new THREE.PlaneGeometry(1,1);
  const materials=[0x18232e,0x713e43,0x8ee7ad].map(color=>new THREE.MeshBasicMaterial({color,depthTest:true,depthWrite:false,toneMapped:false}));
  const bars=new Map();
  function add(id) {
    if(bars.has(id))return bars.get(id);
    const bar=new THREE.Group();bar.name='KartHealth:'+id;
    for(let i=0;i<3;i++) {
      const mesh=new THREE.Mesh(geometry,materials[i]);mesh.scale.set(i?1.8:1.96,i?.14:.28,1);mesh.position.z=i*.003;bar.add(mesh);
    }
    bar.userData.fill=bar.children[2];bar.visible=false;bars.set(id,bar);scene.add(bar);return bar;
  }
  function update(id,k,position,connected=true) {
    const bar=add(id),health=k.health,max=k.maxHealth;
    bar.visible=connected&&k.connected!==false&&k.alive!==false&&!(k.respawn>0)&&Number.isFinite(health)&&Number.isFinite(max)&&health>0&&health<max;
    if(!bar.visible)return;
    bar.position.copy(position);bar.position.y+=3;
    if(bar.userData.health!==health || bar.userData.max!==max) {
      const width=1.8*health/max;bar.userData.fill.scale.x=width;bar.userData.fill.position.x=(width-1.8)/2;
      bar.userData.health=health;bar.userData.max=max;
    }
  }
  function face(camera) {for(const bar of bars.values())if(bar.visible)bar.quaternion.copy(camera.quaternion);}
  function remove(id) {bars.get(id)?.removeFromParent();bars.delete(id);}
  function dispose() {for(const id of bars.keys())remove(id);geometry.dispose();for(const material of materials)material.dispose();}
  return {add,update,face,remove,dispose};
}

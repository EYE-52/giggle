// Authority hearts only. A row of heart billboards above each damaged kart;
// meshes share one geometry and two materials, stay depth-tested against the
// scene, and need no labels, DOM or texture redraws.
export function createKartHealthBars(THREE,scene) {
  const shape=new THREE.Shape();
  shape.moveTo(0,-.5);
  shape.bezierCurveTo(-.15,-.36,-.5,-.12,-.5,.14);
  shape.bezierCurveTo(-.5,.42,-.18,.56,0,.3);
  shape.bezierCurveTo(.18,.56,.5,.42,.5,.14);
  shape.bezierCurveTo(.5,-.12,.15,-.36,0,-.5);
  const geometry=new THREE.ShapeGeometry(shape,6);
  const materials=[0x3a2a31,0xff5068].map(color=>new THREE.MeshBasicMaterial({color,depthTest:true,depthWrite:false,toneMapped:false,side:THREE.DoubleSide}));
  const bars=new Map();
  function layout(bar,max) {
    while(bar.children.length>max)bar.remove(bar.children.at(-1));
    while(bar.children.length<max){const heart=new THREE.Mesh(geometry,materials[1]);heart.scale.setScalar(.52);bar.add(heart);}
    bar.children.forEach((heart,i)=>{heart.position.set((i-(max-1)/2)*.62,0,0);});
  }
  function add(id) {
    if(bars.has(id))return bars.get(id);
    const bar=new THREE.Group();bar.name='KartHealth:'+id;
    // The last pip starts empty so a warm-up render prepares both materials.
    layout(bar,3);bar.children.at(-1).material=materials[0];bar.visible=false;bars.set(id,bar);scene.add(bar);return bar;
  }
  function update(id,k,position,connected=true) {
    const bar=add(id),health=k.health,max=k.maxHealth;
    bar.visible=connected&&k.connected!==false&&k.alive!==false&&!(k.respawn>0)&&Number.isFinite(health)&&Number.isFinite(max)&&health>0&&health<max;
    if(!bar.visible)return;
    bar.position.copy(position);bar.position.y+=3;
    if(bar.userData.health!==health || bar.userData.max!==max) {
      const count=Math.max(1,Math.min(6,Math.round(max)));
      if(bar.children.length!==count)layout(bar,count);
      bar.children.forEach((heart,i)=>{heart.material=materials[i<health?1:0];});
      bar.userData.health=health;bar.userData.max=max;
    }
  }
  function face(camera) {for(const bar of bars.values())if(bar.visible)bar.quaternion.copy(camera.quaternion);}
  function remove(id) {bars.get(id)?.removeFromParent();bars.delete(id);}
  function dispose() {for(const id of [...bars.keys()])remove(id);geometry.dispose();for(const material of materials)material.dispose();}
  return {add,update,face,remove,dispose};
}

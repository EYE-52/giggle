// Shared depth-tested, texture-free HP billboards. Two meshes per kart.
export function createKartHealthBars(THREE,scene){
 const geometry=new THREE.PlaneGeometry(2.4,.28),materials=[0x25354b,0x65edb1,0xff697b].map(color=>new THREE.MeshBasicMaterial({color,depthTest:true,depthWrite:false,toneMapped:false,side:THREE.DoubleSide}));
 const bars=new Map();
 function add(id){if(bars.has(id))return bars.get(id);const bar=new THREE.Group();bar.name='KartHealth:'+id;
  const back=new THREE.Mesh(geometry,materials[0]),fill=new THREE.Mesh(geometry,materials[1]);back.scale.set(1.08,1.5,1);fill.position.z=.01;bar.add(back,fill);bar.visible=false;bars.set(id,bar);scene.add(bar);return bar;}
 function update(id,k,position,connected=true){const bar=add(id),hp=k.health,max=k.maxHealth;
  bar.visible=connected&&k.connected!==false&&k.alive!==false&&!(k.respawn>0)&&Number.isFinite(hp)&&Number.isFinite(max)&&hp>0;
  if(!bar.visible)return;bar.position.copy(position);bar.position.y+=3;
  const ratio=Math.max(0,Math.min(1,hp/max)),fill=bar.children[1];fill.scale.x=ratio;fill.position.x=-1.2*(1-ratio);fill.material=materials[ratio<=.3?2:1];
 }
 function face(camera){for(const bar of bars.values())if(bar.visible)bar.quaternion.copy(camera.quaternion);}
 function remove(id){bars.get(id)?.removeFromParent();bars.delete(id);}
 function dispose(){for(const bar of bars.values())bar.removeFromParent();bars.clear();geometry.dispose();for(const m of materials)m.dispose();}
 return {add,update,face,remove,dispose};
}

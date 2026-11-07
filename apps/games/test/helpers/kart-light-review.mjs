// Geometry/projection evidence only. Uses both production spawn chase cameras
// at 1280x730 (1280x800 page minus the header), not a GPU screenshot verdict.
export function reviewSpawnLights(THREE,{world,map,structures,low=false}){
  world.group.updateMatrixWorld(true);structures?.root.updateMatrixWorld(true);
  const occluders=world.colliderMeshes?[...world.colliderMeshes.values()].map(r=>r.cameraBody||r.body):[];
  if(!world.colliderMeshes){
    world.group.getObjectByName('obstacles')?.traverse(o=>{if(o.isMesh&&!o.material.transparent)occluders.push(o);});
    world.group.traverse(o=>{if(o.isMesh&&/driving-terrain$/.test(o.name))occluders.push(o);});
    structures?.root.traverse(o=>{if(/bodies|wedges/.test(o.name))occluders.push(o);});
  }
  const raised=!!world.colliderMeshes,fov=raised?52:60;
  const {layout}=world.festive,camera=new THREE.PerspectiveCamera(fov,1280/730,.1,650),ray=new THREE.Raycaster(),eye=new THREE.Vector3(),target=new THREE.Vector3(),direction=new THREE.Vector3(),hits=[];
  return(map.spawns||[]).map((p,index)=>{
    const y=p.y??world.groundAt?.(p.x,p.z)??0,a=p.angle||0,s=Math.sin(a),c=Math.cos(a);
    if(raised){eye.set(p.x-s*8.5,y+5.045,p.z-c*8.5);target.set(p.x+s*4,y+2.045,p.z+c*4);}
    else{
      const x=p.x-s*8.8,z=p.z-c*8.8,lx=p.x+s*5,lz=p.z+c*5;
      eye.set(x,Math.max(y+3.2,world.groundAt(x,z)+1.2),z);target.set(lx,Math.max(y+1.6,world.groundAt(lx,lz)+.8),lz);
    }
    // The actual view shortens its eye when the rear camera hits a solid.
    direction.subVectors(eye,target);const rear=direction.length();ray.set(target,direction.normalize());ray.far=rear;hits.length=0;ray.intersectObjects(occluders,false,hits);
    if(raised&&hits[0]&&hits[0].distance<rear)eye.copy(target).addScaledVector(direction,Math.max(.05,hits[0].distance-.2));
    camera.position.copy(eye);camera.lookAt(target);camera.updateMatrixWorld(true);
    const visible=[],focal=730/(2*Math.tan(fov/2*Math.PI/180));
    for(let i=0;i<layout.bulbs.length;i++){
      if(low&&i%4)continue;
      const b=layout.bulbs[i],point=new THREE.Vector3().fromArray(b.p),distance=Math.hypot(point.x-p.x,point.z-p.z);
      if(distance>24)continue;
      const projected=point.clone().project(camera),depth=-point.clone().applyMatrix4(camera.matrixWorldInverse).z,corePixels=b.size*focal/depth;
      if(depth<1||projected.z>1||Math.abs(projected.x)>.92||Math.abs(projected.y)>.92||corePixels<5)continue;
      direction.subVectors(point,eye);const span=direction.length();ray.set(eye,direction.normalize());ray.far=span-.04;hits.length=0;ray.intersectObjects(occluders,false,hits);if(hits.length)continue;
      const run=layout.runs.find(r=>i>=r.first&&i<r.first+r.bulbs);
      visible.push({run:run?.name||'unnamed',distance,corePixels,haloPixels:corePixels*(low?4.5:4),position:b.p});
    }
    const fixtures=[...new Set(visible.map(v=>v.run))].map(name=>{
      const group=visible.filter(v=>v.run===name),best=group.reduce((a,b)=>a.distance<b.distance?a:b);
      return{name,bulbs:group.length,distance:+best.distance.toFixed(1),corePixels:+best.corePixels.toFixed(1),haloPixels:+best.haloPixels.toFixed(1),position:best.position};
    }).sort((a,b)=>a.distance-b.distance);
    return{spawn:p.id??index,position:[p.x,y,p.z],heading:a,visibleBulbs:visible.length,fixtures};
  });
}

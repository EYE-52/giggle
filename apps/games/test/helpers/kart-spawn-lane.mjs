// Real Rapier cuboid casts, plus support beneath the full rotated footprint.
// This is an authoring/test oracle, never work in the 60 Hz game loop.
import {elevatedStatics} from '../../public/js/engines/kart-feature-solids.mjs';
import {wedgeVertices} from '../../public/js/engines/kart-physics-core.mjs';
import CONFIG from '../../public/js/engines/kart-physics-config.mjs';
export const yaw=a=>({x:0,y:Math.sin(a/2),z:0,w:Math.cos(a/2)});
export function spawnLaneOracle(RAPIER,physics,map){
  const h={x:CONFIG.chassis.half.x+.08,y:CONFIG.chassis.half.y,z:CONFIG.chassis.half.z+.08};
  const hull=new RAPIER.Cuboid(h.x,h.y,h.z),zero={x:0,y:0,z:0},identity=yaw(0);
  const shapes=elevatedStatics(map).flatMap(d=>d.parts||[d]).map(d=>({d,shape:d.shape==='trimesh'?new RAPIER.TriMesh(d.vertices,d.indices):d.shape==='wedge'?new RAPIER.ConvexPolyhedron(wedgeVertices(d.half)):new RAPIER.Cuboid(d.half.x,d.half.y,d.half.z)}));
  return function lane(p,distance=20){
    const q=yaw(p.angle),dx=Math.sin(p.angle),dz=Math.cos(p.angle),origin={x:p.x,y:p.y+.75,z:p.z};
    // A continuous swept hull catches even thin poles and corner impacts.
    for(const {d,shape}of shapes){const hit=hull.castShape(origin,q,{x:dx,y:0,z:dz},shape,d.position,d.rotation||identity,zero,.025,distance,true);if(hit)return false;}
    for(let t=0;t<=distance+.01;t+=.5)for(const [sx,sz]of [[0,0],[-h.x,-h.z],[-h.x,h.z],[h.x,-h.z],[h.x,h.z]]){
      const x=p.x+dx*t+Math.cos(p.angle)*sx+dx*sz,z=p.z+dz*t-dx*sx+Math.cos(p.angle)*sz;
      const hit=physics.supportAt({x,y:p.y+.45,z},.95);
      if(!hit||hit.normal.y<.65||Math.abs(hit.point.y-p.y)>.25)return false;
    }
    return true;
  };
}

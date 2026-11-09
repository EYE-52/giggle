import {arenaPointInPolygon} from './kart-arena-polygons.mjs';
// One wedge vertex contract for the rendered skin and Rapier convex hull.
export function raisedWedgeVertices(h){return new Float32Array([-h.x,-h.y,-h.z,h.x,-h.y,-h.z,-h.x,-h.y,h.z,h.x,-h.y,h.z,-h.x,h.y,h.z,h.x,h.y,h.z]);}
export function raisedSurfaceHeight(d,x,z){
  if(d.polygon)return arenaPointInPolygon(d.polygon,x,z)?d.surfaceY:-Infinity;
  const a=2*Math.atan2(d.rotation?.y||0,d.rotation?.w??1),s=Math.sin(a),c=Math.cos(a),dx=x-d.position.x,dz=z-d.position.z,lx=c*dx-s*dz,lz=s*dx+c*dz;
  if(Math.abs(lx)>d.half.x+.001||Math.abs(lz)>d.half.z+.001)return -Infinity;
  return d.position.y+(d.shape==='wedge'?lz*d.half.y/d.half.z:d.half.y);
}
// A kart's bumper art extends beyond its collision box. During slope entry,
// or interpolation over a ramp lip, keep that art above the same support
// planes. This never changes authoritative/predicted simulation positions.
export function createRaisedPoseSupport(THREE,map){
  // Cache every static plane transform; remote wheel/bumper samples must not
  // recalculate dozens of sines and normals for every kart on every frame.
  const byId=new Map((map.colliders||[]).map(d=>{const a=2*Math.atan2(d.rotation?.y||0,d.rotation?.w??1),s=Math.sin(a),c=Math.cos(a),slope=d.shape==='wedge'?d.half.y/d.half.z:0,n=Math.hypot(1,slope);return[d.id,{...d,s,c,slope,nx:-s*slope/n,ny:1/n,nz:-c*slope/n}];}));
  const surfaces=[...byId.values()].filter(d=>d.shape==='wedge'||d.shape==='deck'||/^floor/.test(d.id));
  const normal=new THREE.Vector3(),forward=new THREE.Vector3(),right=new THREE.Vector3(),point=new THREE.Vector3(),q=new THREE.Quaternion(),basis=new THREE.Matrix4();
  const corners=[[-1.38,-.42,-2.2],[1.38,-.42,-2.2],[-1.38,-.42,2.2],[1.38,-.42,2.2]];
  let contacts=0,onRamp=false;
  function heightAt(d,x,z){if(d.polygon)return arenaPointInPolygon(d.polygon,x,z)?d.surfaceY:-Infinity;const dx=x-d.position.x,dz=z-d.position.z,lx=d.c*dx-d.s*dz,lz=d.s*dx+d.c*dz;return Math.abs(lx)>d.half.x+.001||Math.abs(lz)>d.half.z+.001?-Infinity:d.position.y+(d.shape==='wedge'?lz*d.slope:d.half.y);}
  function support(d){contacts++;normal.add(point.set(d.nx,d.ny,d.nz));onRamp||=d.shape==='wedge';}
  return function conform(p,output){
    if(!p.grounded)return p;
    contacts=0;onRamp=false;normal.set(0,0,0);q.copy(p.rotation);
    for(const w of p.wheels||[]){if(!w.contact)continue;const d=byId.get(w.surfaceId);if(d)support(d);}
    // Compact remote packets omit wheel contact IDs. Sample the SAME planes
    // below their four wheels instead of changing the transport protocol.
    if(!contacts)for(const x of[-1.05,1.05])for(const z of[-.92,1.02]){
      point.set(x,0,z).applyQuaternion(q).add(p.position);let best=null,height=-Infinity;
      for(const d of surfaces){const h=heightAt(d,point.x,point.z);if(h>height&&h<=p.position.y+.45&&h>=p.position.y-1.6){height=h;best=d;}}
      if(best)support(best);
    }
    if(onRamp&&contacts>=2&&1-2*(q.x*q.x+q.z*q.z)>.5){
      normal.normalize();forward.set(0,0,1).applyQuaternion(q);forward.y=0;forward.normalize();right.crossVectors(normal,forward).normalize();forward.crossVectors(right,normal).normalize();q.setFromRotationMatrix(basis.makeBasis(right,normal,forward));
    }
    let lift=0;
    for(const c of corners){point.fromArray(c).applyQuaternion(q).add(p.position);
      for(const d of surfaces){const h=heightAt(d,point.x,point.z);if(h>p.position.y+.6||h<p.position.y-1.8)continue;lift=Math.max(lift,h+.025-point.y);}
    }
    // Do not turn a genuine airborne/crash pose into a floor teleport.
    if(lift>.65)return p;
    const out=output||{position:{},rotation:{}},position=out.position,rotation=out.rotation;
    Object.assign(out,p);Object.assign(position,p.position);position.y+=lift;Object.assign(rotation,{x:q.x,y:q.y,z:q.z,w:q.w});out.position=position;out.rotation=rotation;return out;
  };
}

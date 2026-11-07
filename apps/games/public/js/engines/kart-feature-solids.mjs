// Exact solid feature envelopes, shared by classic authority, prediction and
// camera clearance. Hollow tubes/rings stay hollow; their interiors are never
// replaced by a solid bounding box. Generated only when a map is loaded.
import {cannonTube,CANNON_MOUTH_HEIGHT} from './kart-map-features.mjs';

export function arenaFeatureSolids(features,groundAt=()=>0){
  const solids=[];
  function mesh(id,feature){
    const vertices=[],indices=[],s=Math.sin(feature.angle),c=Math.cos(feature.angle),y=groundAt(feature.x,feature.z);
    const point=(x,h,z)=>{const i=vertices.length/3;vertices.push(feature.x+c*x+s*z,y+h,feature.z-s*x+c*z);return i;};
    const quad=(a,b,c,d)=>indices.push(a,b,c,a,c,d);
    const box=(x,y,z,hx,hy,hz)=>{
      const v=[];for(let i=0;i<8;i++)v.push(point(x+(i&1?hx:-hx),y+(i&2?hy:-hy),z+(i&4?hz:-hz)));
      for(const face of [[0,4,6,2],[1,3,7,5],[0,1,5,4],[2,6,7,3],[0,2,3,1],[4,5,7,6]])quad(...face.map(i=>v[i]));
    };
    const cylinder=(x,y,z,top,bottom,height,n,side=false)=>{
      const rings=[[],[]],centres=[];
      for(let end=0;end<2;end++){
        const h=(end-.5)*height,r=end?top:bottom;
        centres.push(side?point(x+h,y,z):point(x,y+h,z));
        for(let i=0;i<n;i++){const a=i/n*Math.PI*2;rings[end].push(side?point(x+h,y+Math.sin(a)*r,z+Math.cos(a)*r):point(x+Math.cos(a)*r,y+h,z+Math.sin(a)*r));}
      }
      for(let i=0;i<n;i++){const j=(i+1)%n;quad(rings[0][i],rings[1][i],rings[1][j],rings[0][j]);indices.push(centres[0],rings[0][i],rings[0][j],centres[1],rings[1][j],rings[1][i]);}
    };
    const finish=()=>solids.push({id,shape:'trimesh',position:{x:0,y:0,z:0},vertices:new Float32Array(vertices),indices:new Uint32Array(indices)});
    return{point,quad,box,cylinder,finish};
  }
  for(const [i,c]of(features?.cannons||[]).entries()){
    const m=mesh('cannon-solid-'+i,c),tube=cannonTube(c,groundAt),cp=Math.cos(tube.pitch),sp=Math.sin(tube.pitch),rings=[[],[],[],[]],n=32;
    for(let ring=0;ring<4;ring++)for(let j=0;j<n;j++){
      const end=ring%2,radius=(end?2.5:2.55)*(ring<2?1:.94),a=j/n*Math.PI*2,x=radius*Math.cos(a),y=radius*Math.sin(a),z=(end-.5)*tube.length;
      rings[ring].push(m.point(x,CANNON_MOUTH_HEIGHT+tube.rise/2+cp*y+sp*z,tube.forward/2-sp*y+cp*z));
    }
    for(let j=0;j<n;j++){
      const k=(j+1)%n;
      m.quad(rings[0][j],rings[0][k],rings[1][k],rings[1][j]);
      m.quad(rings[2][j],rings[3][j],rings[3][k],rings[2][k]);
      m.quad(rings[0][j],rings[2][j],rings[2][k],rings[0][k]);
      m.quad(rings[1][j],rings[1][k],rings[3][k],rings[3][j]);
    }
    const collar=[];
    for(let i=0;i<32;i++){
      const a=i/32*Math.PI*2,ring=[];
      for(let j=0;j<6;j++){
        const b=j/6*Math.PI*2,r=2.53+.07*Math.cos(b),x=r*Math.cos(a),y=r*Math.sin(a),z=.07*Math.sin(b);
        ring.push(m.point(x,CANNON_MOUTH_HEIGHT+tube.rise/2+cp*y+sp*z,tube.forward/2-sp*y+cp*z));
      }collar.push(ring);
    }
    for(let i=0;i<32;i++)for(let j=0;j<6;j++)m.quad(collar[i][j],collar[(i+1)%32][j],collar[(i+1)%32][(j+1)%6],collar[i][(j+1)%6]);
    m.cylinder(0,.16,2.8,2.1,2.35,.32,20);
    for(const side of [-1,1])m.cylinder(side*2.4,.8,2.8,1.05,1.05,.34,18,true);
    // The entrance apron is a shallow drivable wedge, not a painted plane
    // through the tyres. Its top corners match the rendered ramp exactly.
    const apron=[[-2.1,.03,-3.3],[2.1,.03,-3.3],[-1.65,.12,.3],[1.65,.12,.3]],top=apron.map(p=>m.point(...p)),bottom=apron.map(([x,,z])=>m.point(x,0,z));
    m.quad(top[0],top[2],top[3],top[1]);m.quad(bottom[0],bottom[1],bottom[3],bottom[2]);
    for(const [i,j]of [[0,1],[1,3],[3,2],[2,0]])m.quad(bottom[i],top[i],top[j],bottom[j]);
    m.finish();
  }
  for(const [pair,portals]of(features?.portals||[]).entries())for(const [side,p]of portals.entries()){
    const m=mesh(`portal-solid-${pair}-${side}`,p),rings=[],n=40,r=12;
    for(let i=0;i<n;i++){
      const a=i/n*Math.PI*2,ring=[];
      for(let j=0;j<r;j++){const b=j/r*Math.PI*2,d=2.15+.3*Math.cos(b);ring.push(m.point(d*Math.cos(a),2.45+d*Math.sin(a),.3*Math.sin(b)));}rings.push(ring);
    }
    for(let i=0;i<n;i++)for(let j=0;j<r;j++)m.quad(rings[i][j],rings[(i+1)%n][j],rings[(i+1)%n][(j+1)%r],rings[i][(j+1)%r]);
    for(const side of [-1,1])m.box(side*1.75,.25,0,.275,.25,.45);
    m.finish();
  }
  return solids;
}

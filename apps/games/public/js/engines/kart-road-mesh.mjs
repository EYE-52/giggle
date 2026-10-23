// Clip road ribbons to the actual ground triangles. Every interior point
// remains on its supporting plane; long strips cannot cut through a crest.
export function buildTerrainRoads(terrain,routes,options={}){
  const layers={road:[],shoulder:[],curbs:[],curbSides:[],markings:[]};
  const {vertices,segments,half,heightAt}=terrain,stride=segments+1,step=half*2/segments;
  function stamp(quad,layer,lift,color){
    const area=quad.reduce((sum,a,i)=>{const b=quad[(i+1)%quad.length];return sum+a[0]*b[1]-b[0]*a[1];},0);
    const sign=area>0?1:-1;
    const xs=quad.map(p=>p[0]),zs=quad.map(p=>p[1]);
    const x0=Math.max(0,Math.floor((Math.min(...xs)+half)/step)),x1=Math.min(segments-1,Math.floor((Math.max(...xs)+half)/step));
    const z0=Math.max(0,Math.floor((Math.min(...zs)+half)/step)),z1=Math.min(segments-1,Math.floor((Math.max(...zs)+half)/step));
    let flat=true;
    for(let z=z0;z<=z1+1&&flat;z++)for(let x=x0;x<=x1+1;x++)if(vertices[(z*stride+x)*3+1]!==0){flat=false;break;}
    if(flat){
      const ordered=sign<0?quad:[...quad].reverse();
      for(let i=1;i+1<ordered.length;i++)for(const [x,z]of [ordered[0],ordered[i],ordered[i+1]])layers[layer].push(x,lift,z,...color);
      return;
    }
    for(let z=z0;z<=z1;z++)for(let x=x0;x<=x1;x++){
      const a=z*stride+x,b=a+1,c=a+stride,d=c+1;
      for(const ids of [[a,c,b],[b,c,d]]){
        let polygon=ids.map(i=>[vertices[i*3],vertices[i*3+2]]);
        for(let edge=0;edge<quad.length&&polygon.length;edge++){
          const p=quad[edge],q=quad[(edge+1)%quad.length],next=[];
          const distance=v=>sign*((q[0]-p[0])*(v[1]-p[1])-(q[1]-p[1])*(v[0]-p[0]));
          for(let i=0;i<polygon.length;i++){
            const u=polygon[i],v=polygon[(i+1)%polygon.length],du=distance(u),dv=distance(v);
            if(du>=0)next.push(u);
            if((du>=0)!==(dv>=0)){const t=du/(du-dv);next.push([u[0]+(v[0]-u[0])*t,u[1]+(v[1]-u[1])*t]);}
          }
          polygon=next;
        }
        for(let i=1;i+1<polygon.length;i++){
          const points=[polygon[0],polygon[i],polygon[i+1]].map(([x,z])=>[Math.fround(x),Math.fround(z)]),p=points[0],q=points[1],r=points[2];
          // Ignore sub-pixel slivers that collapse when stored in Float32.
          if(Math.abs((q[0]-p[0])*(r[1]-p[1])-(q[1]-p[1])*(r[0]-p[0]))<1e-5)continue;
          for(const [px,pz]of points)layers[layer].push(px,heightAt(px,pz)+lift,pz,...color);
        }
      }
    }
  }
  const white=options.markingColor||[.88,.91,.88],road=[1,1,1],shoulder=options.shoulderColor||[.48,.53,.42];
  const curbColors=options.curbColors||[[.8,.055,.085],[.88,.91,.88]];
  for(const {points,width,curb}of routes){
    // Shared miter endpoints close bends without square slabs or gaps.
    const offsets=points.map((p,i)=>{
      const closed=points[0].distanceTo(points.at(-1))<1e-6;
      const a=points[i?i-1:closed?points.length-2:0],b=points[i+1<points.length?i+1:closed?1:i];
      const dx=b.x-a.x,dz=b.y-a.y,length=Math.hypot(dx,dz)||1;
      return [-dz/length,dx/length];
    });
    let travelled=0,paint=true,remaining=2.4;
    for(let i=1;i<points.length;i++){
      const a=points[i-1],b=points[i],oa=offsets[i-1],ob=offsets[i],length=a.distanceTo(b);
      if(length<1e-6)continue;
      const band=(lo,hi)=>[[a.x+oa[0]*lo,a.y+oa[1]*lo],[b.x+ob[0]*lo,b.y+ob[1]*lo],
        [b.x+ob[0]*hi,b.y+ob[1]*hi],[a.x+oa[0]*hi,a.y+oa[1]*hi]];
      stamp(band(-width/2-.65,-width/2),'shoulder',.018,shoulder);
      stamp(band(width/2,width/2+.65),'shoulder',.018,shoulder);
      stamp(band(-width/2,width/2),'road',.03,road);
      if(curb)for(const side of [-1,1]){
        // Low coloured shoulders follow the grade, rather than a giant
        // road atlas. Their five-centimetre lip keeps crossings traversable.
        stamp(band(side*(width/2+.05),side*(width/2+.52)),'curbs',.055,curbColors[Math.floor(travelled/2)%2]);
      }
      const tx=(b.x-a.x)/length,tz=(b.y-a.y)/length;
      let offset=0;
      while(offset<length-1e-6){
        const span=Math.min(length-offset,remaining);
        if(paint){const x=a.x+tx*offset,z=a.y+tz*offset,bx=x+tx*span,bz=z+tz*span,px=-tz*.085,pz=tx*.085;
          stamp([[x-px,z-pz],[bx-px,bz-pz],[bx+px,bz+pz],[x+px,z+pz]],'markings',.038,white);}
        offset+=span;remaining-=span;
        if(remaining<1e-6){paint=!paint;remaining=paint?2.4:2;}
      }
      travelled+=length;
    }
  }
  // Give the low kerb tops a real lip. Shared triangle edges cancel out,
  // so only the ribbon perimeter gets side faces (one extra geometry batch).
  const edges=new Map(),curbs=layers.curbs;
  const pointKey=i=>Math.round(curbs[i]*1e5)+','+Math.round(curbs[i+2]*1e5);
  for(let i=0;i<curbs.length;i+=18)for(let j=0;j<3;j++) {
    const a=i+j*6,b=i+((j+1)%3)*6,ka=pointKey(a),kb=pointKey(b),key=ka<kb?ka+'|'+kb:kb+'|'+ka;
    if(edges.has(key))edges.delete(key);else edges.set(key,[a,b]);
  }
  for(const [a,b]of edges.values()) {
    const ax=curbs[a],ay=curbs[a+1],az=curbs[a+2],bx=curbs[b],by=curbs[b+1],bz=curbs[b+2],color=curbs.slice(a+3,a+6);
    for(const p of [[ax,ay,az],[ax,ay-.037,az],[bx,by,bz],[bx,by,bz],[ax,ay-.037,az],[bx,by-.037,bz]])layers.curbSides.push(...p,...color);
  }
  return Object.fromEntries(Object.entries(layers).map(([key,value])=>[key,new Float32Array(value)]));
}

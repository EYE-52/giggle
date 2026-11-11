// Two irregular foothill belts, in world space, between the outer guard and
// the painted peaks. The moving chase camera sees each belt at its own depth.
const palettes = {
  ring:    [0x80aa87, 0x567f70, 0x84999c],
  garden:  [0x80ae81, 0x538062, 0x89a599],
  frost:   [0x89b6cd, 0x7294a9, 0xc5dbe4],
  harbor:  [0x80a69a, 0x587f79, 0x91abb1],
  skyport: [0x89ac9e, 0x65877f, 0x9babb3],
  foundry: [0xa48367, 0x82695e, 0xb09788],
  neon:    [0x5c7585, 0x485e73, 0x82879e],
};

export function launchTerrainGeometry(THREE, map, groundColor) {
  const palette = palettes[map.artId] || palettes.ring;
  const ground = new THREE.Color(groundColor);
  const [grass, rock, far] = palette.map(color => new THREE.Color(color));
  const faces = [], colors = [], segments = 64;
  const seed = Object.keys(palettes).indexOf(map.artId) * .71;
  function profile(angle){
    const t=angle+seed,near=4*Math.sin(3*t)+2*Math.cos(7*t);
    const distant=6*Math.sin(5*t+.6)+3*Math.cos(9*t);
    return [
      [0,-1.6], [map.half*.72,-1.6], [map.half+9,-1.6],
      [map.half+23+near*.5,-.5+near*.1], [map.half+39+near,1+near*.25],
      [map.half+57+near,3+near*.65], [map.half+78+distant,-.2],
      [map.half+107+distant,7+distant*.65], [map.half+148,-2],
    ];
  }
  const earth=grass.clone().lerp(new THREE.Color(0xba8e61),.34);
  const shore=['harbor','skyport','frost','neon'].includes(map.artId);
  const shades=[ground,ground,ground,shore?grass:earth,grass,rock,grass.clone().lerp(far,.4),far,far];
  const rings=Array.from({length:segments},(_,i)=>profile(i*Math.PI*2/segments));
  function vertex(i,band){
    const a=i*Math.PI*2/segments,[r,y]=rings[i][band];
    const x=Math.cos(a)*r,z=Math.sin(a)*r,c=shades[band];
    // Long patches break up the apron farther than a single mipmapped tile.
    const tone=1+.095*Math.sin(x*.097+Math.sin(z*.059))+.065*Math.cos(z*.142+x*.037);
    faces.push(x,y,z); colors.push(c.r*tone,c.g*tone,c.b*tone);
  }
  for(let i=0;i<segments;i++){
    const j=(i+1)%segments;
    vertex(i,0);vertex(j,1);vertex(i,1);
    for(let band=1;band<shades.length-1;band++){
      vertex(i,band);vertex(j,band);vertex(i,band+1);
      vertex(j,band);vertex(j,band+1);vertex(i,band+1);
    }
  }
  function heightAt(angle,radius){
    const rings=profile(angle);
    for(let i=1;i<rings.length;i++){
      const [r,y]=rings[i],[previous,low]=rings[i-1];
      if(radius<=r)return low+(y-low)*(radius-previous)/(r-previous);
    }
    return -2;
  }
  const groundVertices=faces.length;
  const canopies=[];
  // Small, irregular groups give the foothills a readable scale at driving
  // height. All silhouettes share the terrain's buffer and draw call.
  const urban = ['harbor','skyport','neon'].includes(map.artId);
  const quarry = map.artId==='foundry';
  let randomState = 271 + Math.round(seed*100);
  function random() {
    randomState=(Math.imul(randomState,1664525)+1013904223)>>>0;
    return randomState/4294967296;
  }
  function triangle(a,b,c,color,shade) {
    faces.push(...a,...b,...c);
    for(let i=0;i<3;i++) colors.push(color.r*shade,color.g*shade,color.b*shade);
  }
  const foliage=new THREE.Color(map.artId==='frost'?0x749a9e:quarry?0x927a66:urban?0x677e88:0x426e55);
  function crown(x,y,z,h,w,color){
    const start=faces.length,spin=random()*Math.PI,sides=5,bottom=[],rim=[],shoulder=[];
    const lean=(random()-.5)*w*.7;
    for(let k=0;k<sides;k++){
      const a=spin+k*Math.PI*2/sides,dx=Math.cos(a)*w,dz=Math.sin(a)*w;
      const reach=.83+.3*random();
      bottom.push([x+dx*.4,y+h*.23,z+dz*.4]);
      rim.push([x+dx*reach,y+h*(.33+random()*.16),z+dz*reach]);
      shoulder.push([x+lean+dx*.67,y+h*(.76+random()*.12),z+dz*.67]);
    }
    const top=[x+lean,y+h,z+w*.08];
    const tipColor=map.artId==='frost'?color.clone().lerp(new THREE.Color(0xd2dee3),.42):color;
    for(let k=0;k<sides;k++){
      const j=(k+1)%sides;
      triangle(bottom[k],rim[k],bottom[j],color,.72);
      triangle(rim[k],rim[j],bottom[j],color,.78);
      triangle(rim[k],shoulder[k],rim[j],color,.92);
      triangle(shoulder[k],shoulder[j],rim[j],color,.95);
      triangle(shoulder[k],top,shoulder[j],tipColor,1.06);
    }
    canopies.push({start,end:faces.length,x,y,z,h,w});
  }
  const bark=new THREE.Color(map.artId==='frost'?0x6b7775:0x71664b);
  for(let cluster=0;cluster<36;cluster++){
    const middle=cluster*Math.PI/18+seed+random()*.12;
    const nearer=cluster%3===0;
    const center=map.half+(nearer?13+random()*13:38+random()*28);
    const count=urban||quarry?4:2+Math.floor(random()*3);
    for(let j=0;j<count;j++){
      const a=middle+(random()-.5)*.14,r=center+(random()-.5)*8;
      const x=Math.cos(a)*r,z=Math.sin(a)*r,y=heightAt(a,r)-.32;
      const h=2.1+random()*4.8,w=(urban?.65:quarry?.88:.37+random()*.18)*h;
      if(!urban&&!quarry){
        const color=foliage.clone().lerp(grass,random()*.43);
        for(let k=0;k<3;k++){
          const a=k*Math.PI*2/3,b=(k+1)*Math.PI*2/3;
          const lo=[x+Math.cos(a)*w*.13,y,z+Math.sin(a)*w*.13];
          const hi=[x+Math.cos(b)*w*.13,y,z+Math.sin(b)*w*.13];
          triangle(lo,[x,y+h*.56,z],hi,bark,.85);
        }
        crown(x,y,z,h,w,color);
        if(nearer&&j===0)crown(x+w*.75,y-.3,z+w*.3,h*.58,w*.68,color);
        continue;
      }
      const sides=urban?4:5,rotation=random(),top=[x,y+h,z];
      for(let k=0;k<sides;k++){
        const angle=rotation+k*Math.PI*2/sides,next=rotation+(k+1)*Math.PI*2/sides;
        const lo=[x+w*Math.cos(angle),y,z+w*Math.sin(angle)],hi=[x+w*Math.cos(next),y,z+w*Math.sin(next)];
        if(urban){
          const roofA=[lo[0],top[1],lo[2]],roofB=[hi[0],top[1],hi[2]];
          triangle(lo,roofA,hi,foliage,.88);triangle(roofA,roofB,hi,foliage,.88);
          triangle(roofA,top,roofB,far,.85);
        }else triangle(lo,top,hi,foliage,.85+.2*Math.sin(angle));
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.Float32BufferAttribute(faces,3));
  g.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
  const uv=[];
  for(let i=0;i<faces.length;i+=3){
    const x=faces[i],z=faces[i+2];
    if(i>=groundVertices){uv.push(.5,.5);continue;}
    uv.push(x/13+.15*Math.sin(z*.056),z/13+.13*Math.sin(x*.049));
  }
  g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
  g.computeVertexNormals();
  const normal=new THREE.Vector3(),normals=g.getAttribute('normal');
  for(const c of canopies)for(let i=c.start;i<c.end;i+=3){
    normal.set((faces[i]-c.x)/c.w,(faces[i+1]-c.y-c.h*.45)/c.h+.35,(faces[i+2]-c.z)/c.w).normalize();
    normals.setXYZ(i/3,normal.x,normal.y,normal.z);
  }
  return g;
}

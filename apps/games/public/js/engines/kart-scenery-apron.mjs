// Cosmetic terrain only. Both world renderers use the same rising meadow;
// the outside ring never enters the legal field or creates a collider.
export function sceneryApronHeight(x,z,half){
  const t=Math.min(1,Math.max(0,(Math.max(Math.abs(x),Math.abs(z))-half-48)/42));
  const noise=.52*Math.sin(x*.071+.7)*Math.cos(z*.083+1.2)
    +.27*Math.sin(x*.18+z*.14)+.21*Math.cos(x*.29-z*.13);
  return t*t*(3-2*t)*(5+noise*3.1);
}

export function outsideSceneryApron(THREE,{half,extent=half+220,baseY=-.35,side=0,color=0xffffff,distantColor=color}={}){
  const segments=24,bands=20,vertices=[],colors=[],indices=[];
  const near=new THREE.Color(color),far=new THREE.Color(distantColor),paint=new THREE.Color();
  for(let i=0;i<=segments;i++){
    const angle=(side-.5+i/segments)*Math.PI/2,c=Math.cos(angle),s=Math.sin(angle),edge=Math.max(Math.abs(c),Math.abs(s));
    for(let j=0;j<=bands;j++){
      const radius=half+2+(extent-half-2)*j/bands,x=c/edge*radius,z=s/edge*radius;
      // A little extra relief remains visible from the raised chase camera
      // without hiding the painted valley behind a high ring of terrain.
      vertices.push(x,baseY+sceneryApronHeight(x,z,half)*1.5,z);
      const fade=Math.min(1,Math.max(0,(radius-half-38)/120));
      const shade=.94+.06*Math.sin(x*.09+z*.13)+.04*Math.sin(x*.035-z*.06);
      paint.copy(near).lerp(far,fade).multiplyScalar(shade);
      colors.push(paint.r,paint.g,paint.b);
      if(i<segments&&j<bands){const k=i*(bands+1)+j;indices.push(k,k+bands+1,k+1,k+1,k+bands+1,k+bands+2);}
    }
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
  geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
  geometry.setIndex(indices);geometry.computeVertexNormals();
  return geometry;
}

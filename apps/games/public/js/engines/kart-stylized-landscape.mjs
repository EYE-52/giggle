/* Sculpted background terrain for the stylized Alpine world. All patches
 * remain outside the legal driving field. No physics state lives here. */
export function createStylizedAlpineLandscape(THREE,{parent,half=60,geometry,material,part}={}){
  const owned=[];
  const paint=new THREE.Color(),low=new THREE.Color(0x3d9d79),high=new THREE.Color(0x84adc7),snow=new THREE.Color(0xecf4fa);
  // Irregular individual silhouettes replace the repeating circular ridge.
  // The near patches open a valley; separate pale peaks supply distance.
  const patches=[
    {x:-153,z:10,rx:0,w:142,d:86,h:20,seed:2,far:false},
    {x:153,z:-6,rx:0,w:142,d:86,h:22,seed:7,far:false},
    {x:-13,z:151,rx:Math.PI/2,w:142,d:88,h:22,seed:12,far:false},
    {x:9,z:-156,rx:Math.PI/2,w:142,d:86,h:19,seed:19,far:false},
    {x:-148,z:220,rx:-.28,w:128,d:82,h:49,seed:24,far:true},
    {x:12,z:245,rx:.10,w:136,d:92,h:56,seed:31,far:true},
    {x:168,z:225,rx:.31,w:134,d:88,h:47,seed:39,far:true},
    {x:12,z:-247,rx:.08,w:168,d:94,h:50,seed:45,far:true},
  ];
  for(const [index,p]of patches.entries()){
    const nx=p.far?40:36,nz=24,vertices=[],colors=[],indices=[];
    const peaks=p.far?[[.25,.50,.40,1],[.71,.47,.33,.88],[.48,.62,.26,.87]]:[[.24,.44,.32,.69],[.62,.54,.34,1],[.81,.30,.25,.57]];
    for(let j=0;j<=nz;j++)for(let i=0;i<=nx;i++){
      const u=i/nx,v=j/nz,x=(u-.5)*p.w,z=(v-.5)*p.d;
      const rim=Math.pow(Math.sin(Math.PI*u)*Math.sin(Math.PI*v),.65);
      let y=0;for(const[a,b,r,h]of peaks)y=Math.max(y,h*Math.exp(-((u-a)**2+(v-b)**2)/(r*r*.55)));
      y*=p.h*rim*(.98+.025*Math.sin(u*29+p.seed)*Math.sin(v*21+p.seed));
      vertices.push(x,y-.35,z);
      paint.copy(p.far?high:low);
      if(p.far){paint.lerp(snow,THREE.MathUtils.smoothstep(y,p.h*.40,p.h*.67));paint.multiplyScalar(.99+.02*Math.sin(u*5+p.seed));}
      else paint.lerp(high,THREE.MathUtils.smoothstep(y,p.h*.4,p.h)*.25);
      colors.push(paint.r,paint.g,paint.b);
      if(i<nx&&j<nz){const k=j*(nx+1)+i;indices.push(k,k+nx+1,k+1,k+1,k+nx+1,k+nx+2);}
    }
    const g=geometry(new THREE.BufferGeometry());g.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));g.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));g.setIndex(indices);g.computeVertexNormals();
    const m=material(new THREE.MeshStandardMaterial({color:0xffffff,vertexColors:true,roughness:1,side:THREE.DoubleSide}));
    const mesh=part(parent,g,m,[p.x,0,p.z],[1,1,1],[0,p.rx,0],(p.far?'stylized-snow-peak-':'stylized-valley-hill-')+index);mesh.castShadow=false;owned.push(mesh);
  }
  // Source-authored trees/buildings occupy the middle layer; terrain only
  // frames it. The explicit record is available to geometry acceptance.
  parent.userData.stylizedTerrain={patches:patches.map(p=>({...p})),legalHalf:half};
  return owned;
}

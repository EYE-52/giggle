// Static dressing for the two complexes. Large props dress existing solids;
// thin face details and flush rollers do not change driving clearance.
export function addComplexDetails(THREE,{map,soft,geo,mat,texture,block,item,box,ink,white,yellow,orange,green,light}){
  const sky=map.id==='skyport',wheel=geo(new THREE.CylinderGeometry(1,1,1,8)),pipe=geo(new THREE.CylinderGeometry(1,1,1,8,1,true));
  // Tank/fitting bottom caps are buried inside their solid base. Keep the
  // visible eight-sided walls and top, without drawing those hidden backs.
  if(!sky){const bottom=wheel.groups.find(g=>g.materialIndex===2);wheel.setIndex(Array.from(wheel.index.array).slice(0,bottom.start));wheel.clearGroups();}
  const axisZ=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),Math.PI/2),axisX=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),Math.PI/2);
  const labelQuads=[];
  function label(word,x,y,z,w,h,a=0){labelQuads.push({word,x,y,z,w,h,a});}
  function cylinder(key,m,x,y,z,r,length,q=axisZ,g=pipe){item(soft,key,g,m,{x,y,z},{x:r,y:length,z:r},q);}
  for(const d of map.colliders){
    const {position:p,half:h}=d,base=p.y-h.y,top=p.y+h.y;
    if(d.material==='cover'&&sky){
      // Box-shaped service vans: the full-height body matches its collider.
      for(const side of [-1,1]){
        block(soft,'parked-van-windows',ink,p.x+h.x*.46,base+h.y*1.5,p.z+side*(h.z+.018),h.x*.85,h.y*.58,.025);
        block(soft,'parked-van-doors',white,p.x-h.x*.3,base+h.y*.95,p.z+side*(h.z+.03),.07,h.y*1.65,.018);
        block(soft,'parked-van-handles',ink,p.x-h.x*.1,base+h.y,p.z+side*(h.z+.044),.42,.09,.018);
        for(const along of [-1,1]){
          cylinder('parked-van-wheels',ink,p.x+along*h.x*.62,base+.66,p.z+side*(h.z-.12),.66,.32,axisZ,wheel);
          cylinder('parked-van-hubs',white,p.x+along*h.x*.62,base+.66,p.z+side*(h.z+.05),.3,.025,axisZ,wheel);
          block(soft,'parked-van-lamps',along>0?light:orange,p.x+along*(h.x+.02),base+.95,p.z+side*h.z*.62,.028,.32,.6);
        }
      }
      block(soft,'parked-van-windscreen',ink,p.x+h.x+.015,base+h.y*1.52,p.z,.025,h.y*.6,h.z*1.55);
      block(soft,'parked-van-grille',ink,p.x+h.x+.025,base+.7,p.z,.025,.4,h.z*.95);
      for(const side of [-1,1])block(soft,'parked-van-roof-rack',white,p.x,top+.035,p.z+side*h.z*.65,h.x*1.7,.06,.08);
      label('SKYPORT',p.x-h.x*.3,base+h.y*1.45,p.z+h.z+.05,h.x*.95,.55);
    }
    if(d.material==='utility'&&sky){
      for(const side of [-1,1]){
        block(soft,'roof-service-doors',ink,p.x-h.x*.45,base+1.25,p.z+side*(h.z+.015),1.5,2.5,.025);
        for(let y=.5;y<2.5;y+=.35)block(soft,'roof-service-louvres',white,p.x+h.x*.35,base+y,p.z+side*(h.z+.035),2.2,.1,.025);
        label('ROOF',p.x,top-.4,p.z+side*(h.z+.06),2.5,.55,side>0?0:Math.PI);
      }
      // Low vent panels, inside the existing utility enclosure's roof.
      for(const x of [-1.7,1.7])for(let z=-1.8;z<=1.8;z+=.45)block(soft,'roof-vent-panels',ink,p.x+x,top+.016,p.z+z,2.5,.025,.12);
    }
    if(d.shape==='deck'){
      const level=top>15?2:1,accent=level===2?(sky?yellow:green):(sky?green:orange);
      for(const side of [-1,1]){
        // Expansion joints, fascia ribs and lights on the real slab edges.
        block(soft,'deck-fascia-frame',ink,p.x,p.y,p.z+side*(h.z+.014),h.x*2,.12,.025);
        for(let x=-h.x+3;x<h.x-1;x+=8){
          block(soft,'deck-fascia-ribs',accent,p.x+x,p.y,p.z+side*(h.z+.03),.18,h.y*1.8,.025);
          block(soft,'deck-edge-lights',light,p.x+x,p.y+.12,p.z+side*(h.z+.05),1,.08,.025);
        }
        if(h.x>=8)label(sky?'P'+level:level===2?'GANTRY':'DOCK',p.x,p.y,p.z+side*(h.z+.06),Math.min(5,h.x),.55,side>0?0:Math.PI);
      }
      // Narrow strips are painted joints, not raised speed bumps.
      for(let z=-h.z+6;z<h.z;z+=12)block(soft,'deck-panel-joints',ink,p.x,top+.007,p.z+z,h.x*2,.008,.035);
    }
    if(d.material==='pillar'){
      if(sky){
        for(const level of [0,1]){
          const y=level*10+4.3;if(y>top-.5)continue;
          for(const side of [-1,1]){
            block(soft,'parking-light-housings',ink,p.x,y,p.z+side*(h.z+.04),h.x*1.6,.36,.08);
            block(soft,'parking-strip-lights',light,p.x,y,p.z+side*(h.z+.085),h.x*1.3,.12,.025);
            label(level===0?'G':'P1',p.x,level*10+2.4,p.z+side*(h.z+.09),1.3,.7,side>0?0:Math.PI);
          }
        }
      }else{
        // Pipework hugs the authority pillar / tunnel wall faces.
        for(const side of [-1,1]){
          const x=p.x+side*(h.x+.035);
          cylinder('service-pipework',white,x,p.y,p.z,.09,h.y*1.8,new THREE.Quaternion());
          for(const y of [base+1,top-1])cylinder('service-pipe-clamps',orange,x,y,p.z,.14,.12,new THREE.Quaternion());
        }
      }
    }
    if(d.material==='kerb'){
      // The short guardrail fits inside the existing 60 cm safety kerb.
      const alongX=h.x>h.z,length=alongX?h.x:h.z;
      for(const side of [-1,1])block(soft,'bridge-guardrails',white,p.x+(alongX?0:side*(h.x+.015)),top-.09,p.z+(alongX?side*(h.z+.015):0),h.x*2,.09,h.z*2);
      for(let t=-length+.3;t<length;t+=2.5)block(soft,'guardrail-posts',ink,p.x+(alongX?t:0),p.y,p.z+(alongX?0:t),alongX?.12:h.x*2+.04,h.y*1.8,alongX?h.z*2+.04:.12);
    }
    if(d.material==='cover'&&!sky){
      // Tanks sit in solid protective cages; their shape does not promise a
      // route through the rectangular blocking envelope.
      for(const side of [-1,1]){
        block(soft,'tank-cage-frames',ink,p.x,top-.16,p.z+side*(h.z+.014),h.x*2,.25,.025);
        for(let x=-h.x+.25;x<h.x;x+=1.4)block(soft,'tank-cage-bars',white,p.x+x,p.y,p.z+side*(h.z+.025),.1,h.y*1.8,.025);
      }
      for(const offset of [-1,1]){
        const x=p.x+offset*h.x*.45,r=Math.min(h.x*.4,h.z*.65);
        cylinder('storage-tanks',orange,x,p.y,p.z,r,h.y*1.8,new THREE.Quaternion(),wheel);
        for(const y of [base+.5,top-.5])cylinder('tank-bands',white,x,y,p.z,r+.03,.14,new THREE.Quaternion(),wheel);
      }
      // Circular tank ports on the top face read from the high gantry.
      for(const x of [-h.x*.45,h.x*.45])cylinder('tank-top-ports',ink,p.x+x,top-h.y*.1+.016,p.z,.55,.025,new THREE.Quaternion(),wheel);
      label('ORE',p.x,p.y,p.z+h.z+.05,Math.min(3,h.x),.7);
    }
  }
  if(!sky){
    const furnace=map.colliders.find(d=>d.material==='furnace'),p=furnace.position;
    for(const side of [-1,1]){
      // Recess-looking hot mouths, vents and ribs stay on its solid face.
      block(soft,'furnace-mouth-frames',ink,p.x,3.2,side*9.035,11,5,.05);
      block(soft,'furnace-glowing-mouths',light,p.x,3.2,side*9.067,9,3.7,.018);
      for(let x=-4;x<=4;x+=1)block(soft,'furnace-mouth-grates',ink,x,3.2,side*9.09,.16,3.7,.025);
      for(let y=8;y<17;y+=.65)block(soft,'furnace-exhaust-louvres',ink,0,y,side*9.04,13,.23,.03);
      label('FURNACE',0,18.2,side*9.07,12,1.3,side>0?0:Math.PI);
      cylinder('furnace-side-pipes',orange,side*9.05,10,0,.18,17,new THREE.Quaternion());
      for(const z of [-6,6])cylinder('furnace-pipe-collars',white,side*9.05,10,z,.3,.16,new THREE.Quaternion());
    }
    for(const belt of map.belts){
      const alongX=!!belt.velocity.x,length=alongX?belt.halfX:belt.halfZ,width=alongX?belt.halfZ:belt.halfX;
      // Almost all of each roller is below the road. The crown is flush.
      for(let t=-length+.6;t<length;t+=2) cylinder('conveyor-rollers',white,belt.x+(alongX?t:0),belt.y-.11,belt.z+(alongX?0:t),.12,width*2-.6,alongX?axisZ:axisX);
    }
    for(const x of [-50,50])for(const z of [-28,28])label('SERVICE',x,4.6,z,6,1.2,z>0?0:Math.PI);
    label('SLAG',50,.7,76.04,8,1.2);label('YARD',94,12.62,-36.97,12,.8);
  }else{
    label('SKYPORT',-40,7,-30.04,19,2,Math.PI);label('SKYPORT',40,17,30.04,19,2);
  }
  // A single mipmapped pixel-letter atlas and one merged mesh for all signs.
  // All text is data pixels, so tests and devices use exactly the same art.
  const words=[...new Set(labelQuads.map(s=>s.word))],size=512,cellW=128,cellH=32,pixels=new Uint8Array(size*128*4);
  const glyphs={A:['01110','10001','10001','11111','10001','10001','10001'],B:['11110','10001','10001','11110','10001','10001','11110'],C:['01111','10000','10000','10000','10000','10000','01111'],D:['11110','10001','10001','10001','10001','10001','11110'],E:['11111','10000','10000','11110','10000','10000','11111'],F:['11111','10000','10000','11110','10000','10000','10000'],G:['01111','10000','10000','10111','10001','10001','01111'],H:['10001','10001','10001','11111','10001','10001','10001'],I:['11111','00100','00100','00100','00100','00100','11111'],K:['10001','10010','10100','11000','10100','10010','10001'],L:['10000','10000','10000','10000','10000','10000','11111'],N:['10001','11001','10101','10011','10001','10001','10001'],O:['01110','10001','10001','10001','10001','10001','01110'],P:['11110','10001','10001','11110','10000','10000','10000'],R:['11110','10001','10001','11110','10100','10010','10001'],S:['01111','10000','10000','01110','00001','00001','11110'],T:['11111','00100','00100','00100','00100','00100','00100'],U:['10001','10001','10001','10001','10001','10001','01110'],V:['10001','10001','10001','10001','01010','01010','00100'],Y:['10001','10001','01010','00100','00100','00100','00100'],'1':['00100','01100','00100','00100','00100','00100','01110'],'2':['01110','10001','00001','00010','00100','01000','11111']};
  function pixel(x,y,c){const i=(y*size+x)*4;pixels.set([...c,255],i);}
  words.forEach((word,index)=>{
    const cx=index%4*cellW,cy=Math.floor(index/4)*cellH;
    for(let y=0;y<cellH;y++)for(let x=0;x<cellW;x++)pixel(cx+x,cy+y,y<2||y>29?[255,211,104]:[32,55,69]);
    const scale=3,x0=Math.floor((cellW-(word.length*6-1)*scale)/2),y0=5;
    [...word].forEach((letter,i)=>(glyphs[letter]||glyphs.O).forEach((row,y)=>[...row].forEach((bit,x)=>{if(bit==='1')for(let dy=0;dy<scale;dy++)for(let dx=0;dx<scale;dx++)pixel(cx+x0+i*6*scale+x*scale+dx,cy+y0+y*scale+dy,[242,244,223]);})));
  });
  const atlas=texture(new THREE.DataTexture(pixels,size,128,THREE.RGBAFormat));atlas.name='complex-wayfinding';atlas.colorSpace=THREE.SRGBColorSpace;atlas.magFilter=THREE.LinearFilter;atlas.minFilter=THREE.LinearMipmapLinearFilter;atlas.generateMipmaps=true;atlas.needsUpdate=true;
  const positions=[],normals=[],uv=[],indices=[];
  labelQuads.forEach((s,i)=>{
    const n=words.indexOf(s.word),u=n%4/4,v=Math.floor(n/4)/4,c=Math.cos(s.a),a=Math.sin(s.a);
    for(const [x,y]of [[-1,-1],[1,-1],[1,1],[-1,1]]){positions.push(s.x+x*s.w/2*c,s.y+y*s.h/2,s.z-x*s.w/2*a);normals.push(a,0,c);uv.push(u+(x+1)/8,v+(1-y)/8);}
    indices.push(i*4,i*4+1,i*4+2,i*4,i*4+2,i*4+3);
  });
  const signs=geo(new THREE.BufferGeometry());signs.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));signs.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));signs.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));signs.setIndex(indices);
  const signMaterial=mat(new THREE.MeshStandardMaterial({map:atlas,emissive:0xffda9a,emissiveMap:atlas,emissiveIntensity:.18,roughness:.8})),mesh=new THREE.Mesh(signs,signMaterial);mesh.name='complex-wayfinding-signs';mesh.userData.words=words;soft.add(mesh);
}

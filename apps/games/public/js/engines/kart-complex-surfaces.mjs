// Small baked surface atlases, tiled in metres across instanced geometry.
// Quiet large joints survive phone-sized views; fine detail has mipmaps.
export function complexSurfaceTexture(THREE,kind){
  const size=256,pixels=new Uint8Array(size*size*4);let seed=713;
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    seed=(Math.imul(seed,1664525)+1013904223)>>>0;
    let v=(kind==='asphalt'?190:kind==='steel'?182:218)+(seed>>>24)/24-5;
    if(kind==='asphalt'){
      if(x%128<2||y%128<2)v-=50;
      if((x*17+y*31)%113<2)v-=18;
    }else if(kind==='pavers'){
      const row=Math.floor(y/64),u=(x+(row%2)*64)%128;
      if(u<2||y%64<2)v-=62;
      v+=(row+Math.floor((x+(row%2)*64)/128))%3*3;
    }else if(kind==='steel'){
      if(x%64<3||y%64<3)v-=60;
      if((x+y)%32<3||(x-y+256)%32<3)v+=25;
    }else{
      if(x%128<3||y%128<3)v-=70;
      if((x%128-9)**2+(y%128-9)**2<7)v=100;
      if(y%128>119&&y%128<123)v+=16;
    }
    const i=(y*size+x)*4;pixels[i]=pixels[i+1]=pixels[i+2]=Math.max(0,Math.min(255,Math.round(v)));pixels[i+3]=255;
  }
  const tex=new THREE.DataTexture(pixels,size,size,THREE.RGBAFormat);tex.name='complex-surface-'+kind;
  tex.colorSpace=THREE.SRGBColorSpace;tex.wrapS=tex.wrapT=THREE.RepeatWrapping;tex.magFilter=THREE.LinearFilter;tex.minFilter=THREE.LinearMipmapLinearFilter;tex.generateMipmaps=true;tex.anisotropy=2;tex.needsUpdate=true;return tex;
}
export function tileComplexMaterial(material,texture,metres=4){
  material.map=texture;
  material.userData.surfaceTileMetres=metres;
  material.onBeforeCompile=shader=>{
    shader.vertexShader=shader.vertexShader.replace('#include <uv_vertex>',`#include <uv_vertex>
      vec3 surfacePosition=position;
      vec3 surfaceNormal=normal;
      #ifdef USE_INSTANCING
        surfacePosition=(instanceMatrix*vec4(position,1.0)).xyz;
        vec3 surfaceScale=vec3(length(instanceMatrix[0].xyz),length(instanceMatrix[1].xyz),length(instanceMatrix[2].xyz));
        surfaceNormal=mat3(instanceMatrix)*(normal/(surfaceScale*surfaceScale));
      #endif
      surfacePosition=(modelMatrix*vec4(surfacePosition,1.0)).xyz;
      surfaceNormal=abs(normalize(mat3(modelMatrix)*surfaceNormal));
      vec2 surfaceUV=surfaceNormal.y>surfaceNormal.x&&surfaceNormal.y>surfaceNormal.z?surfacePosition.xz:surfaceNormal.x>surfaceNormal.z?surfacePosition.zy:surfacePosition.xy;
      #ifdef USE_MAP
        vMapUv=surfaceUV/${metres.toFixed(2)};
      #endif`);
  };
  material.customProgramCacheKey=()=>`complex-world-tiles-${metres}`;
}

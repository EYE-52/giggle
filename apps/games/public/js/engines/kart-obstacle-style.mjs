// Small, shared, baked textures. No canvas, extra lights or frame work.
export const OBSTACLE_STYLES=Object.freeze({
  ring:{body:0xd95549,top:0xfff0ce,stripe:0xffe39a},
  quarry:{body:0x356987,top:0xffd263,stripe:0xffe4a0},
  garden:{body:0x426e7b,top:0xbad989,stripe:0xffe3a0},
  frost:{body:0x3975a4,top:0xf4fbff,stripe:0xffde85},
  neon:{body:0x397d99,top:0x8beaf1,stripe:0xffdc85},
});
export const obstacleStyle=theme=>OBSTACLE_STYLES[theme]||OBSTACLE_STYLES.ring;
const rgb=hex=>[hex>>16&255,hex>>8&255,hex&255];

export function createObstaclePanelTexture(THREE,style,{hazard=false}={}){
  const size=128,data=new Uint8Array(size*size*4),body=rgb(style.body),stripe=rgb(style.stripe);
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const at=(y*size+x)*4,v=y/(size-1);
    let color=body,shade=.72+.4*v;
    // Inset seams and a bright upper edge give even broad faces depth.
    if(x<4||x>123||y<5)shade*=.5;
    else if(x%40<2&&y>20&&y<112)shade*=.65;
    if(y>112&&y<119){color=stripe;shade=.85;}
    if(hazard&&y>18&&y<60){color=(x+y)%128<64?stripe:rgbDark;shade=1;}
    if(!hazard&&y>16&&y<21)shade*=.45;
    for(let c=0;c<3;c++)data[at+c]=Math.min(255,Math.round(color[c]*shade));
    data[at+3]=255;
  }
  const tex=new THREE.DataTexture(data,size,size,THREE.RGBAFormat);
  tex.name=hazard?'obstacle-hazard-panels':'obstacle-shaded-panels';
  tex.colorSpace=THREE.SRGBColorSpace;tex.magFilter=THREE.LinearFilter;
  tex.generateMipmaps=true;tex.minFilter=THREE.LinearMipmapLinearFilter;
  if(hazard)tex.wrapS=THREE.RepeatWrapping;
  tex.needsUpdate=true;
  return tex;
}
const rgbDark=[28,43,54];

export function createObstacleContactTexture(THREE){
  const size=64,data=new Uint8Array(size*size*4);
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const at=(y*size+x)*4,r=Math.max(Math.abs(x/(size-1)*2-1),Math.abs(y/(size-1)*2-1));
    const t=Math.max(0,Math.min(1,(r-.66)/.34));
    data[at]=8;data[at+1]=17;data[at+2]=27;data[at+3]=Math.round(170*(1-t*t*(3-2*t)));
  }
  const tex=new THREE.DataTexture(data,size,size,THREE.RGBAFormat);
  tex.name='obstacle-soft-contact';tex.colorSpace=THREE.SRGBColorSpace;
  tex.magFilter=tex.minFilter=THREE.LinearFilter;tex.needsUpdate=true;return tex;
}

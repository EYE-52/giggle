const clamp=(n,lo,hi)=>Math.max(lo,Math.min(hi,n));
const profiles={
  ring:{half:30,plaza:12,hills:[[0,23,29,15,2.3],[0,-23,29,15,2.3],[23,0,15,29,2.3],[-23,0,15,29,2.3]]},
  blocks:{half:30,plaza:12,rise:.44,hills:[[0,21,16,16,3.4],[0,-21,16,16,3.4],[21,0,16,16,3.4],[-21,0,16,16,3.4]]},
  garden:{half:60,plaza:16,hills:[[-37,-38,24,25,6.4],[38,-35,24,26,6.6],[42,42,22,22,5.8],[-43,23,21,25,5.5]]},
  frost:{half:60,plaza:16,hills:[[-43,-42,23,30,5.7],[43,42,23,30,5.7],[0,-43,28,18,5.2],[0,43,28,18,5.2],[-47,0,17,44,4.8],[47,0,17,44,4.8]]},
  neon:{half:60,plaza:16,rise:.35,hills:[[-37,-32,24,27,6],[38,28,24,31,6.3],[-6,43,30,20,5.2]],deck:true},
};

// One deterministic road mesh shared by rendering, authority and prediction.
// Grid vertices are the source of truth: heightAt samples the same diagonal
// and Float32 heights Rapier and Three consume, rather than an analytic hill.
export function createRoadTerrain(map){
  const half=map?.half;
  const profile=Object.hasOwn(profiles,map?.id)?profiles[map.id]:null;
  if(!profile||!Number.isFinite(half)||half<20||half>1000)return null;
  const segments=Math.min(98,Math.ceil(half*2/1.5)),stride=segments+1,spacing=half*2/segments,scale=half/profile.half;
  const vertices=new Float32Array(stride*stride*3),indices=new Uint32Array(segments*segments*6);
  // Include an entire grid-cell diagonal outside each flat footprint so
  // triangles crossing its short margin also remain exactly at zero.
  const margin=(profile.half===30?1:2)+spacing*Math.SQRT2;
  const flats=[{x:0,z:0,hw:profile.plaza*scale,hd:profile.plaza*scale},...(map.blocks||[]),...(map.pads||[]),...(map.surfaces||[])];
  function authoredHeight(x,z){
    let height=0;
    for(const [cx,cz,rx,rz,h]of profile.hills){
      const r=Math.hypot((x-cx*scale)/(rx*scale),(z-cz*scale)/(rz*scale));
      // Industrial decks keep a broad level crown; the approach ramps and
      // all other arenas use the same continuous cosine shoulders.
      const ramp=profile.deck?clamp((r-.2)/.8,0,1):r;
      if(r<1)height=Math.max(height,h*scale*(1+Math.cos(Math.PI*ramp))/2);
    }
    let distance=Math.max(0,half-Math.max(Math.abs(x),Math.abs(z))-(profile.half===30?6:margin));
    for(const rect of flats){
      const dx=Math.max(0,Math.abs(x-rect.x)-rect.hw-margin),dz=Math.max(0,Math.abs(z-rect.z)-rect.hd-margin);
      distance=Math.min(distance,Math.hypot(dx,dz));
    }
    // A broad smooth rise out of every original placement and barrier. Its
    // derivative stays below the profile's rise. This cap bounds the deck
    // shoulders and diagonals where two different masks meet.
    return Math.min(height,(profile.rise||.38)*(distance-3*(1-Math.exp(-distance/3))));
  }
  for(let z=0;z<=segments;z++)for(let x=0;x<=segments;x++){
    const i=(z*stride+x)*3,px=-half+x*spacing,pz=-half+z*spacing;
    vertices[i]=px;vertices[i+1]=authoredHeight(px,pz);vertices[i+2]=pz;
  }
  for(let z=0,i=0;z<segments;z++)for(let x=0;x<segments;x++){
    const a=z*stride+x,b=a+1,c=a+stride,d=c+1;
    // Upward winding; shared diagonal from the southwest to northeast.
    indices.set([a,c,b,b,c,d],i);i+=6;
  }
  function heightAt(x,z){
    if(!Number.isFinite(x)||!Number.isFinite(z)||Math.abs(x)>half||Math.abs(z)>half)return 0;
    const gx=clamp((x+half)/spacing,0,segments),gz=clamp((z+half)/spacing,0,segments);
    const ix=Math.min(segments-1,Math.floor(gx)),iz=Math.min(segments-1,Math.floor(gz)),a=iz*stride+ix;
    // Use stored coordinates too, so Float32 rounding cannot disagree with
    // collision support even on grids whose spacing is not exactly binary.
    const u=(x-vertices[a*3])/(vertices[(a+1)*3]-vertices[a*3]);
    const v=(z-vertices[a*3+2])/(vertices[(a+stride)*3+2]-vertices[a*3+2]);
    const ha=vertices[a*3+1],hb=vertices[(a+1)*3+1],hc=vertices[(a+stride)*3+1];
    return u+v<=1?ha+(hb-ha)*u+(hc-ha)*v:
      vertices[(a+stride+1)*3+1]*(u+v-1)+hb*(1-v)+hc*(1-u);
  }
  // Visible catch fencing and physical boundaries share the same envelope.
  // Legitimate high jumps that clear it are recovered by the authority.
  return {vertices,indices,heightAt,segments,half,wallHeight:profile.half===30?2.5:3.5};
}

/* Scene-owned PBR textures. A retired/failed load releases every completed
 * texture, including requests that finish after retirement. No global cache. */
const FAMILY = {grass:1.4, earth:1.3, limestone:2, wall:2};
const CHANNELS = {map:'color', normalMap:'normal', roughnessMap:'roughness'};

export async function loadKartTerrainAssets(THREE,{environment,signal,baseURL='/assets/karts/terrain'}={}) {
  const textures=new Set(),released=new Set(),sets={};
  let retired=false;
  const release=texture=>{if(!texture||released.has(texture))return;released.add(texture);textures.delete(texture);texture.dispose();};
  const dispose=()=>{if(retired)return;retired=true;for(const texture of textures)release(texture);};
  if(environment!=='alpine')return {sets,textures,dispose};
  const aborted=()=>signal?.reason!==undefined?signal.reason:new DOMException('Terrain load retired','AbortError');
  if(signal?.aborted)throw aborted();
  const loader=new THREE.TextureLoader();
  let rejectAbort;
  const abortPromise=new Promise((_,reject)=>{rejectAbort=reject;});
  const onAbort=()=>{dispose();rejectAbort(aborted());};
  signal?.addEventListener('abort',onAbort,{once:true});
  const jobs=Object.entries(FAMILY).flatMap(([family,tileMeters])=>{
    sets[family]={tileMeters};
    return Object.entries(CHANNELS).map(async([channel,file])=>{
      const texture=await new Promise((resolve,reject)=>{
        const pending=loader.load(`${baseURL}/${family}-${file}.webp?v=terrain-20261007`,resolve,undefined,reject);
        textures.add(pending);
        if(retired)release(pending);
      });
      if(retired||signal?.aborted){release(texture);throw aborted();}
      texture.name=`alpine-${family}-${file}`;
      texture.colorSpace=channel==='map'?THREE.SRGBColorSpace:THREE.NoColorSpace;
      texture.wrapS=texture.wrapT=THREE.RepeatWrapping;
      texture.magFilter=THREE.LinearFilter;texture.minFilter=THREE.LinearMipmapLinearFilter;
      texture.generateMipmaps=true;texture.anisotropy=8;
      // Solid geometry uses a world-aligned 8 metre UV basis.
      texture.repeat.set(8/tileMeters,8/tileMeters);
      sets[family][channel]=texture;
    });
  });
  try {
    await Promise.race([Promise.all(jobs),abortPromise]);
    return {sets,textures,dispose};
  } catch(error) {dispose();throw error;}
  finally {signal?.removeEventListener('abort',onAbort);}
}

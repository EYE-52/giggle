// Raw GLB bytes only. Each renderer parses its own scene and owns disposal.
// Retain at most the shared match library, never GPU objects or textures.
import {practiceKartCache} from './kart-practice-cache.mjs';
const bytes=practiceKartCache('glb')||new Map();
export function prefetchKartGLB(url) {
  if(bytes.has(url))return bytes.get(url);
  const pending=fetch(url,{priority:'low'}).then(response=>{
    if(!response.ok)throw Error(`Kart asset HTTP ${response.status}`);
    return response.arrayBuffer();
  }).catch(error=>{bytes.delete(url);throw error;});
  if(bytes.size<32)bytes.set(url,pending);
  return pending;
}
export async function loadKartGLB(loader,url) {
  const pending=bytes.get(url);
  if(!pending)return loader.loadAsync(url);
  try {
    const data=await pending;
    // GLTFLoader checks instanceof ArrayBuffer. Copy into this seat's
    // realm as well as its ownership, including bytes from practice's parent.
    const copy=new Uint8Array(data.byteLength);copy.set(new Uint8Array(data));
    return await loader.parseAsync(copy.buffer,url.slice(0,url.lastIndexOf('/')+1));
  }catch{return loader.loadAsync(url);}
}

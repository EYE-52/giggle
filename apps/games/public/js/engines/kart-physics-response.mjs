import {practiceKartCache} from './kart-practice-cache.mjs';
export async function fetchKartWasm(url){
  const cache=practiceKartCache('wasm');
  if(!cache)return fetch(url,{priority:'low'});
  const key=String(url);
  if(!cache.has(key)){
    const pending=fetch(url,{priority:'low'}).then(response=>{
      if(!response.ok)throw Error(`Kart physics HTTP ${response.status}`);
      return response;
    }).catch(error=>{cache.delete(key);throw error;});
    cache.set(key,pending);
  }
  const response=(await cache.get(key)).clone();
  // wasm-bindgen uses instanceof Response. Re-wrap in this seat's realm;
  // a Response cloned from the practice parent has the parent's prototype.
  return new Response(response.body,{status:response.status,statusText:response.statusText,headers:response.headers});
}

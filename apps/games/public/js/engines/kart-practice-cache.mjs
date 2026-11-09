// Practice seats share a link in one tab. Share only downloaded public bytes,
// never physics worlds, scenes or GPU resources. Ordinary rooms own their cache.
export function practiceKartCache(kind){
  try{
    if(typeof window==='undefined')return null;
    const top=window.top;
    if(top.location.origin!==location.origin||!top.document.body.classList.contains('practice-page'))return null;
    const caches=top.__giggleKartDownloads??=(new Map());
    if(!caches.has(kind))caches.set(kind,new Map());
    return caches.get(kind);
  }catch{return null;}
}

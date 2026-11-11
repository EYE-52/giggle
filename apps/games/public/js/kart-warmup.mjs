// This small entry is safe in the shell: other games fetch no kart runtime.
let scheduled=false,started=false;
const links=new Set();
function atIdle(work){
  let done=false;
  const start=()=>{if(done)return;done=true;clearTimeout(fallback);work();};
  // Hidden practice/embedded seats may never receive an idle callback.
  // The fallback starts only low-priority requests, not a renderer.
  const fallback=setTimeout(start,1000);
  if(typeof requestIdleCallback==='function')requestIdleCallback(start,{timeout:1000});
  else {clearTimeout(fallback);setTimeout(start,0);}
}
function modulepreload(href){
  if(links.has(href))return;links.add(href);
  const link=document.createElement('link');link.rel='modulepreload';link.href=href;
  link.fetchPriority='low';document.head.appendChild(link);
}
// The practice chooser can start shared byte downloads before it opens
// seats. It does not create a third renderer or a third physics world.
export function warmPracticeKart(game,options={}){
  if(game!=='pocket-karts')return;
  const idle=()=>{
    import('./engines/kart-physics-response.mjs').then(m=>m.fetchKartWasm(new URL('/vendor/rapier/rapier.wasm',location.href))).then(r=>r.arrayBuffer()).catch(()=>{});
    warmAssets(options.players||[],options.settings||{});
  };
  atIdle(idle);
}
export function warmPickedKart(game,{players=[],settings={}}={}) {
  if(game!=='pocket-karts')return;
  if(!scheduled){
    scheduled=true;
    const idle=()=>{
      started=true;
      for(const href of ['/vendor/three/three.module.js','/vendor/three/three.core.js',
        '/vendor/rapier/rapier.mjs','/vendor/three/loaders/GLTFLoader.js',
        '/vendor/three/utils/BufferGeometryUtils.js','/vendor/three/utils/SkeletonUtils.js','/js/engines/kart-runtime.mjs','/js/games/pocket-karts.js'])modulepreload(href);
      // No renderer, audio context or scene: only code and streaming physics.
      import('./engines/kart-physics-loader.mjs').then(m=>m.loadKartPhysics()).catch(()=>{});
      import('./games/pocket-karts.js').catch(()=>{});
      warmAssets(players,settings);
    };
    atIdle(idle);
  }else if(started)warmAssets(players,settings);
}
async function warmAssets(players,settings){
  try{
    const [{prefetchKartGLB},{matchKartAssetEntries,matchKartDrivers,KART_ELEVATED_FILES,loadKartWeaponThumbnails}]=await Promise.all([
      import('./engines/kart-prefetch.mjs'),import('./engines/kart-assets.mjs')]);
    loadKartWeaponThumbnails().catch(()=>{});
    // Exact URLs match the scene loaders; never download another map's art.
    const classic={'Rookie Ring':'ring','Bumper Blocks':'blocks','Garden Circuit':'garden','Frosty Pass':'frost','Neon Yard':'neon'};
    const name=settings.map||'Rookie Ribbons';
    let urls;
    if(Object.hasOwn(classic,name)){
      urls=matchKartAssetEntries({id:classic[name]}).map(([key,file])=>`/assets/karts/${file}.glb${key==='crate'?'?v=question-20261007':''}`);
    }else{
      const {elevatedEnvironmentByName}=await import('./engines/kart-elevated-maps.mjs');
      // Saved legacy arenas and current layouts use their real game labels.
      if(!Object.hasOwn(elevatedEnvironmentByName,name))return;
      const files=[...KART_ELEVATED_FILES];
      if(elevatedEnvironmentByName[name]==='alpine')files.push(['stylized','environment/stylized-alpine','9426a0ed'],['fountain','environment/alpine-fountain','7a687cd3']);
      urls=files.map(([,file,version])=>`/assets/karts/${file}.glb?v=${version}`);
    }
    const looks=Object.fromEntries(players.map(p=>[p.id,p.kart]));
    for(const driver of matchKartDrivers(players,looks))urls.push(`/assets/karts/drivers/${driver}.glb`);
    await Promise.allSettled(urls.map(prefetchKartGLB));
  }catch{/* A failed warm-up is retried by the actual loader. */}
}

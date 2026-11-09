const reflectedPrograms=new WeakSet();
// Loading only. Three's compileAsync waits for the current program of each
// material. A shared material can also have instanced, coloured and shadow
// variants, so wait for every submitted program before its first draw.
export async function waitKartPrograms(renderer,isAlive=()=>true,step=work=>{if(!isAlive())throw Error('Retired kart shader warmup');return work();}){
  while(true){
    if(!isAlive())throw Error('Retired kart shader warmup');
    const pending=renderer.info?.programs?.some(program=>!program.isReady());
    if(!pending)break;
    await (globalThis.scheduler?.yield?.()??new Promise(resolve=>setTimeout(resolve,10)));
  }
  // Linking completion alone does not initialize Three's uniform/attribute
  // tables. On a cold driver that reflection work can still take tens of ms.
  // Initialize it here in small tasks, rather than in one large first render.
  let start=performance.now();
  for(const program of renderer.info?.programs||[]){
    if(!isAlive())throw Error('Retired kart shader warmup');
    if(reflectedPrograms.has(program))continue;
    await step(()=>program.getUniforms?.());
    await step(()=>program.getAttributes?.());
    reflectedPrograms.add(program);
    if(performance.now()-start>=4){
      await (globalThis.scheduler?.yield?.()??new Promise(resolve=>setTimeout(resolve,0)));start=performance.now();
    }
  }
}

// Submit the exact programs used by a render pass without drawing them yet.
// This includes Three's own shadow/PMREM materials, which scene.compileAsync
// does not visit. Use the real object, camera and render target so instancing,
// alpha cutouts, shadow sides and offscreen colour space match the later draw.
// No async work runs while the renderer method or object is temporarily changed.
export async function prepareKartPass(THREE,renderer,draw,{shadowsOnly=false,isAlive=()=>true}={}){
  const direct=renderer.renderBufferDirect,empty=new THREE.Scene();
  let result;
  renderer.renderBufferDirect=function(camera,scene,geometry,material,object){
    if(shadowsOnly&&scene!==null)return;
    const original=object.material,children=object.children;
    object.material=material;object.children=[];
    try{renderer.compile(object,camera,scene||empty);}
    finally{object.material=original;object.children=children;}
  };
  try{result=draw();}
  finally{renderer.renderBufferDirect=direct;}
  try{await waitKartPrograms(renderer,isAlive);return result;}
  catch(error){result?.dispose?.();throw error;}
}

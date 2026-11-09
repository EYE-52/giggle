import {createKartModel,createStarModel,createCrateModel} from './kart-model.mjs';
import {prepareKartPass,waitKartPrograms} from './kart-shader-warmup.mjs';
import {createKartWarmupScheduler} from './kart-warmup-scheduler.mjs';

// Keep real runtime clones, with their rim/shadow flags, in a hidden library.
// Merely compiling the unmodified GLB templates misses these program variants.
// The scene owns their shared resources and per-clone paint until retirement.
export function createKartWarmupLibrary(THREE,scene,assets,combat){
  const library=new THREE.Group();library.name='KartWarmupLibrary';library.visible=false;
  library.add(combat.pickup(),createCrateModel(THREE,assets));
  if(assets.star)library.add(createStarModel(THREE,assets));
  for(const template of assets.kartVariants?.length?assets.kartVariants:[assets.kart]){
    if(template)library.add(createKartModel(THREE,{assets:{kart:template},color:0xffffff}));
  }
  scene.add(library);return library;
}

// Loading only: work on one renderable at a time in a light-only scene.
// Borrow the shipping object only during a synchronous submission: its exact
// instance binding state stays cached, with all live state restored before
// every await. Hidden pools never become visible in the live scene.
export async function warmKartRenderer(THREE,renderer,scene,camera,{roots=[],priorityRoots=[],requiredRoots=[],
  isAlive=()=>true,budgetMs=Infinity,signal,onProgress,yieldTask}={}){
  const scheduler=createKartWarmupScheduler({budgetMs:requiredRoots.length?Infinity:budgetMs,signal,isAlive,onProgress,yieldTask});
  const sources=new Set(),optional=new Set(),priority=new Set(),required=new Set(),lights=[],textures=new Set();
  const renderable=o=>o.isMesh||o.isSprite||o.isLine||o.isPoints;
  const visit=(o,set,hidden=false)=>{
    if(!o||o.name==='OriginalKartBody'||(!hidden&&!o.visible))return;
    if(renderable(o))set.add(o);
    for(const child of o.children)visit(child,set,hidden);
  };
  for(const root of roots)visit(root,optional,true);
  for(const root of priorityRoots)visit(root,priority,true);
  for(const root of requiredRoots)visit(root,required,true);
  visit(scene,sources);
  for(const source of optional)sources.add(source);
  for(const source of required)sources.add(source);
  // Visible scenery, seated drivers and pickups precede rare weapons and
  // alternate drivers. Prepare both quality modes together so a deadline
  // cannot leave all shadow-off programs cold for the adaptive switch.
  const bindings=new Set();
  const rank=o=>required.has(o)?3:priority.has(o)?2:optional.has(o)?0:1;
  const ordered=[...sources].sort((a,b)=>rank(b)-rank(a)).filter(o=>{
    // Ordinary clones share geometry buffers/VAOs and material programs. One
    // exact binding warms them all. Instance/skin/batch data belongs to each
    // object, so those still need their own upload. Preserve shadow variants.
    const materials=Array.isArray(o.material)?o.material:[o.material];
    const key=[o.geometry?.uuid,o.isInstancedMesh||o.isSkinnedMesh||o.isBatchedMesh?o.uuid:o.type,
      ...materials.map(m=>m?.uuid),o.castShadow,o.receiveShadow,o.layers.mask,
      o.customDepthMaterial?.uuid,o.customDistanceMaterial?.uuid].join('|');
    if(bindings.has(key))return false;bindings.add(key);return true;
  });
  scene.traverseVisible(o=>{if(o.isLight)lights.push(o);});
  const staging=new THREE.Scene();staging.name='KartWarmupPass';
  const syncScene=()=>{for(const key of ['fog','environment','environmentIntensity','environmentRotation'])staging[key]=scene[key];};
  const modes=renderer.shadowMap?.enabled?[true,false]:[false];
  const total=ordered.length*modes.length;let completed=0;
  scheduler.progress(0,total);
  function state(shadows,draw){
    const shadow=renderer.shadowMap,enabled=shadow?.enabled,update=shadow?.needsUpdate;
    const updates=lights.filter(l=>l.shadow).map(l=>[l.shadow,l.shadow.needsUpdate]);
    let viewport,scissor,test;
    try{
      if(shadow){shadow.enabled=shadows;shadow.needsUpdate=true;}
      for(const light of lights)light.updateWorldMatrix(true,false);
      for(const [s]of updates)s.needsUpdate=true;
      if(renderer.getViewport&&renderer.getScissor&&renderer.getScissorTest){
        viewport=renderer.getViewport(new THREE.Vector4());scissor=renderer.getScissor(new THREE.Vector4());test=renderer.getScissorTest();
        renderer.setViewport(0,0,16,16);renderer.setScissor(0,0,0,0);renderer.setScissorTest(true);
      }
      return draw();
    }finally{
      if(shadow){shadow.enabled=enabled;shadow.needsUpdate=update;}
      for(const [s,value]of updates)s.needsUpdate=value;
      if(viewport){renderer.setViewport(viewport);renderer.setScissor(scissor);renderer.setScissorTest(test);}
    }
  }
  function sample(object,shadows,draw){
    object.updateWorldMatrix(true,false);
    const children=object.children,visible=object.visible,culled=object.frustumCulled,instances=object.count;
    // The upload draw uses one instance. Never cache its tiny lazy sphere as
    // the bounds of a whole village/forest after count is restored.
    if(object.isInstancedMesh&&culled&&instances>0&&!object.boundingSphere)object.computeBoundingSphere();
    const sphere=object.boundingSphere,box=object.boundingBox;
    const g=object.geometry,start=g?.drawRange.start,count=g?.drawRange.count,geometryInstances=g?.instanceCount;
    const mats=Array.isArray(object.material)?object.material:[object.material];
    const flags=mats.map(m=>m.visible),qualityChanged=renderer.shadowMap?.enabled!==shadows;
    syncScene();staging.children=[...lights,object];
    try{
      object.children=[];object.visible=true;object.frustumCulled=false;
      if(object.isInstancedMesh)object.count=Math.min(1,object.instanceMatrix.count);
      for(const m of mats){m.visible=true;if(qualityChanged)m.needsUpdate=true;}
      if(g){g.setDrawRange(0,g.index?.count??g.attributes.position?.count??0);if(g.isInstancedBufferGeometry&&g.instanceCount===0)g.instanceCount=1;}
      return state(shadows,draw);
    }finally{
      object.children=children;object.visible=visible;object.frustumCulled=culled;
      if(object.isInstancedMesh){object.count=instances;object.boundingSphere=sphere;object.boundingBox=box;}
      mats.forEach((m,i)=>{m.visible=flags[i];if(qualityChanged)m.needsUpdate=true;});
      if(g){g.setDrawRange(start,count);if(g.isInstancedBufferGeometry)g.instanceCount=geometryInstances;}
      staging.children=[];
    }
  }
  const step=work=>scheduler.step(work),living=()=>scheduler.isAlive();
  async function settleUploads(final=false){
    if(!final&&completed%16!==0)return;
    const gl=renderer.getContext?.();
    if(!gl?.fenceSync)return;
    const fence=gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE,0);
    if(!fence)return;
    try{
      gl.flush();
      while(await step(()=>gl.clientWaitSync(fence,0,0))===gl.TIMEOUT_EXPIRED){
        // A real task gives Chrome's GPU process time to finish; a resolved
        // scheduler promise alone can spin until the preparation budget ends.
        await new Promise(resolve=>setTimeout(resolve,8));
      }
    }finally{gl.deleteSync(fence);}
  }
  return scheduler.run(async()=>{
    const warmTexture=async value=>{
      if(value?.isTexture&&!value.isRenderTargetTexture&&!textures.has(value)){
        textures.add(value);await step(()=>renderer.initTexture?.(value));
      }
    };
    const warmMaterial=async object=>{
      for(const m of Array.isArray(object.material)?object.material:[object.material])if(m){
        for(const value of Object.values(m))await warmTexture(value);
        for(const uniform of Object.values(m.uniforms||{}))for(const value of Array.isArray(uniform.value)?uniform.value:[uniform.value])await warmTexture(value);
      }
    };
    await warmTexture(scene.background);await warmTexture(scene.environment);
    // Required weapon/pickup bindings finish in both modes before the optional
    // scenery budget starts. Exact-binding deduplication keeps their priority.
    const requiredObjects=ordered.filter(o=>required.has(o));
    if(requiredObjects.length){
      for(const shadows of modes){
        // Submit the combat library together, then link/reflect once per mode.
        for(const object of requiredObjects){
          await warmMaterial(object);
          if(shadows&&object.castShadow&&renderer.renderBufferDirect&&renderer.compile){
            await step(()=>sample(object,shadows,()=>prepareKartPass(THREE,renderer,()=>renderer.render(staging,camera),{shadowsOnly:true,isAlive:living,wait:false})));
          }
          await step(()=>sample(object,shadows,()=>renderer.compile?renderer.compile(object,camera,staging):renderer.compileAsync(object,camera,staging)));
        }
        await waitKartPrograms(renderer,living,step);
        for(const object of requiredObjects){
          await step(()=>sample(object,shadows,()=>renderer.render(staging,camera)));
          scheduler.progress(++completed,total);
          await settleUploads(object===requiredObjects.at(-1));
        }
      }
      scheduler.setBudget(budgetMs);
    }
    // Prepare both quality modes for each remaining binding together, so a
    // deadline cannot leave all shadow-off variants cold for adaptive quality.
    for(const object of ordered.filter(o=>!required.has(o)))for(const shadows of modes){
      await warmMaterial(object);
      if(shadows&&object.castShadow&&renderer.renderBufferDirect&&renderer.compile){
        await step(()=>sample(object,shadows,()=>prepareKartPass(THREE,renderer,()=>renderer.render(staging,camera),{shadowsOnly:true,isAlive:living})));
      }
      await step(()=>sample(object,shadows,()=>renderer.compile?renderer.compile(object,camera,staging):renderer.compileAsync(object,camera,staging)));
      await waitKartPrograms(renderer,living,step);
      await step(()=>sample(object,shadows,()=>renderer.render(staging,camera)));
      scheduler.progress(++completed,total);
      await settleUploads(completed===total);
    }
  });
}

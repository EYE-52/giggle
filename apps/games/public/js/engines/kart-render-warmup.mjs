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

// Work on one renderable at a time, using a detached light-only scene.
// Borrow the shipping object only during a synchronous submission: its exact
// instance binding state stays cached, with all live state restored before
// every await. Hidden pools never become visible in the live scene.
export async function warmKartRenderer(THREE,renderer,scene,camera,{roots=[],priorityRoots=[],
  isAlive=()=>true,budgetMs=Infinity,signal,onProgress,yieldTask,idleTask}={}){
  const scheduler=createKartWarmupScheduler({budgetMs,signal,isAlive,onProgress,yieldTask,idleTask});
  const sources=new Set(),optional=new Set(),priority=new Set(),lights=[],textures=new Set();
  const renderable=o=>o.isMesh||o.isSprite||o.isLine||o.isPoints;
  const visit=(o,set,hidden=false)=>{
    if(!o||o.name==='OriginalKartBody'||(!hidden&&!o.visible))return;
    if(renderable(o))set.add(o);
    for(const child of o.children)visit(child,set,hidden);
  };
  for(const root of roots)visit(root,optional,true);
  for(const root of priorityRoots)visit(root,priority,true);
  visit(scene,sources);
  for(const source of optional)sources.add(source);
  // Visible scenery, seated drivers and pickups precede rare weapons and
  // alternate drivers; shadow-off variants come last.
  const ordered=[...sources].sort((a,b)=>(priority.has(b)?2:optional.has(b)?0:1)-(priority.has(a)?2:optional.has(a)?0:1));
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
      if(object.isInstancedMesh)object.count=instances;
      mats.forEach((m,i)=>{m.visible=flags[i];if(qualityChanged)m.needsUpdate=true;});
      if(g){g.setDrawRange(start,count);if(g.isInstancedBufferGeometry)g.instanceCount=geometryInstances;}
      staging.children=[];
    }
  }
  const step=work=>scheduler.step(work),living=()=>scheduler.isAlive();
  return scheduler.run(async()=>{
    const warmTexture=async value=>{
      if(value?.isTexture&&!value.isRenderTargetTexture&&!textures.has(value)){
        textures.add(value);await step(()=>renderer.initTexture?.(value));
      }
    };
    await warmTexture(scene.background);await warmTexture(scene.environment);
    for(const shadows of modes)for(const source of ordered){
      const object=source;
      {
        for(const m of Array.isArray(object.material)?object.material:[object.material])if(m){
          for(const value of Object.values(m))await warmTexture(value);
          for(const uniform of Object.values(m.uniforms||{}))for(const value of Array.isArray(uniform.value)?uniform.value:[uniform.value])await warmTexture(value);
        }
        if(shadows&&object.castShadow&&renderer.renderBufferDirect&&renderer.compile){
          await step(()=>sample(object,shadows,()=>prepareKartPass(THREE,renderer,()=>renderer.render(staging,camera),{shadowsOnly:true,isAlive:living})));
        }
        await step(()=>sample(object,shadows,()=>renderer.compileAsync?renderer.compileAsync(object,camera,staging):renderer.compile(object,camera,staging)));
        await waitKartPrograms(renderer,living,step);
        await step(()=>sample(object,shadows,()=>renderer.render(staging,camera)));
        // A fence is polled, never gl.finish(): a busy GPU must not freeze UI.
        const gl=renderer.getContext?.();
        if(gl?.fenceSync){
          const fence=gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE,0);
          if(fence){try{gl.flush();while(await step(()=>gl.clientWaitSync(fence,0,0))===gl.TIMEOUT_EXPIRED){/* yield on each poll */}}finally{gl.deleteSync(fence);}}
        }
      }
      scheduler.progress(++completed,total);
    }
  });
}

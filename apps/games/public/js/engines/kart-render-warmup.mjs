import {createKartModel,createStarModel,createCrateModel} from './kart-model.mjs';
import {prepareKartPass,waitKartPrograms} from './kart-shader-warmup.mjs';

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

// Loading only: compile is not an upload. Render every reserved buffer once,
// including hidden children and zero-count instance pools. A tiny viewport
// behind the loading screen limits fragment work. Keep the actual output
// target: a regular render target would compile linear/no-tone-map programs
// instead of the canvas's sRGB/tone-mapped programs in Three r187.
export async function warmKartRenderer(THREE,renderer,scene,camera,{roots=[],isAlive=()=>true}={}){
  const nodes=new Map(),counts=new Map(),ranges=new Map(),materials=new Map(),textures=new Set();
  const shadowUpdates=new Map();
  const shadowUpdate=renderer.shadowMap?.needsUpdate;
  let viewport,scissor,scissorTest;
  const alive=()=>{if(!isAlive())throw Error('Retired kart renderer warmup');};
  function show(object){
    if(!object||nodes.has(object)||object.name==='OriginalKartBody')return;
    nodes.set(object,{visible:object.visible,frustumCulled:object.frustumCulled});
    object.visible=true;object.frustumCulled=false;
    if(object.isInstancedMesh){counts.set(object,object.count);object.count=object.instanceMatrix.count;}
    const g=object.geometry;
    if(g&&!ranges.has(g)){
      ranges.set(g,{start:g.drawRange.start,count:g.drawRange.count,instances:g.instanceCount});
      g.setDrawRange(0,g.index?.count??g.attributes.position?.count??0);
      if(g.isInstancedBufferGeometry&&g.instanceCount===0){
        const capacities=Object.values(g.attributes).filter(a=>a.isInstancedBufferAttribute).map(a=>a.count*a.meshPerAttribute);
        g.instanceCount=capacities.length?Math.min(...capacities):1;
      }
    }
    for(const child of object.children)show(child);
  }
  function texture(value){if(value?.isTexture&&!value.isRenderTargetTexture)textures.add(value);}
  try{
    alive();
    for(const root of roots){show(root);for(let p=root?.parent;p&&p!==scene;p=p.parent){
      if(!nodes.has(p))nodes.set(p,{visible:p.visible,frustumCulled:p.frustumCulled});p.visible=true;
    }}
    scene.traverseVisible(object=>{
      for(const m of Array.isArray(object.material)?object.material:[object.material])if(m){
        if(!materials.has(m))materials.set(m,m.visible);m.visible=true;
        for(const value of Object.values(m))texture(value);
        for(const uniform of Object.values(m.uniforms||{})){
          if(Array.isArray(uniform.value))uniform.value.forEach(texture);else texture(uniform.value);
        }
      }
    });
    texture(scene.background);texture(scene.environment);
    for(const tex of textures)renderer.initTexture?.(tex);
    if(renderer.getViewport&&renderer.getScissor&&renderer.getScissorTest){
      viewport=renderer.getViewport(new THREE.Vector4());scissor=renderer.getScissor(new THREE.Vector4());scissorTest=renderer.getScissorTest();
      renderer.setViewport(0,0,16,16);renderer.setScissor(0,0,16,16);renderer.setScissorTest(true);
    }
    // compileAsync(scene) misses the depth materials created inside Three's
    // shadow pass. Submit those exact variants first, without blocking draws.
    if(renderer.shadowMap?.enabled&&renderer.renderBufferDirect&&renderer.compile){
      scene.traverse(object=>{if(object.isLight&&object.castShadow&&object.shadow){
        shadowUpdates.set(object.shadow,object.shadow.needsUpdate);object.shadow.needsUpdate=true;
      }});
      renderer.shadowMap.needsUpdate=true;
      await prepareKartPass(THREE,renderer,()=>renderer.render(scene,camera),{shadowsOnly:true,isAlive});
      renderer.shadowMap.needsUpdate=true;
      for(const shadow of shadowUpdates.keys())shadow.needsUpdate=true;
    }
    // Adaptive quality can disable shadows during a fight. Prepare that
    // exact program variant too: otherwise the next Cannon/Thunder/status
    // material links and reflects its no-shadow shader in a live frame.
    if(renderer.shadowMap?.enabled){
      renderer.shadowMap.enabled=false;
      try{
        for(const m of materials.keys())m.needsUpdate=true;
        if(renderer.compileAsync)await renderer.compileAsync(scene,camera);else renderer.compile(scene,camera);
        await waitKartPrograms(renderer,isAlive);alive();renderer.render(scene,camera);
      }finally{renderer.shadowMap.enabled=true;for(const m of materials.keys())m.needsUpdate=true;}
    }
    if(renderer.compileAsync)await renderer.compileAsync(scene,camera);else renderer.compile(scene,camera);
    await waitKartPrograms(renderer,isAlive);
    alive();renderer.render(scene,camera);
    // Finish uploads before Ready without blocking the UI on WebGL2 GPUs.
    const gl=renderer.getContext?.();
    if(gl?.fenceSync){
      const fence=gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE,0);
      if(!fence)throw Error('Kart renderer upload fence failed');
      try{
        gl.flush();
        while(true){
          alive();const result=gl.clientWaitSync(fence,0,0);
          if(result===gl.WAIT_FAILED)throw Error('Kart renderer uploads failed');
          if(result!==gl.TIMEOUT_EXPIRED)break;
          await new Promise(resolve=>setTimeout(resolve,0));
        }
      }finally{gl.deleteSync(fence);}
    }else gl?.finish?.();
    alive();
  }finally{
    for(const [object,state]of nodes){object.visible=state.visible;object.frustumCulled=state.frustumCulled;}
    for(const [object,count]of counts)object.count=count;
    for(const [g,state]of ranges){g.setDrawRange(state.start,state.count);if(g.isInstancedBufferGeometry)g.instanceCount=state.instances;}
    for(const [m,visible]of materials)m.visible=visible;
    if(renderer.shadowMap)renderer.shadowMap.needsUpdate=shadowUpdate;
    for(const [shadow,update]of shadowUpdates)shadow.needsUpdate=update;
    if(viewport){renderer.setViewport(viewport);renderer.setScissor(scissor);renderer.setScissorTest(scissorTest);}
  }
}

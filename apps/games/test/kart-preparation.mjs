// Deterministic scheduler time, not a claim about a GPU driver's atomic calls.
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createKartWarmupScheduler,waitKartPreparation} from '../public/js/engines/kart-warmup-scheduler.mjs';
import {warmKartRenderer} from '../public/js/engines/kart-render-warmup.mjs';
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};

// Loading submissions yield between jobs. A real driver call can exceed
// this fake cost, which is why none of these jobs may run during play.
{
  let clock=0,taskStart=0,yields=0;const tasks=[],progress=[];
  const scheduler=createKartWarmupScheduler({budgetMs:Infinity,now:()=>clock,
    yieldTask:async()=>{tasks.push(clock-taskStart);taskStart=clock;yields++;},
    onProgress:p=>progress.push(p.completed)});
  const result=await scheduler.run(async()=>{
    for(let i=0;i<120;i++){
      await scheduler.step(()=>{clock+=17;});
      scheduler.progress(i+1,120);
    }
  });
  await result.done;tasks.push(clock-taskStart);
  assert.equal(yields,120);assert.equal(Math.max(...tasks),17);
  assert.ok(tasks.every(ms=>ms<=50),'no scheduler task exceeds 50ms with the fake clock');
  assert.deepEqual(progress,Array.from({length:120},(_,i)=>i+1));
}
// Expiry stops optional work permanently. In particular, a queued 100ms
// driver call must never be resumed by Ready, an idle turn, or first input.
{
  let clock=0,jobs=0,yields=0;
  const scheduler=createKartWarmupScheduler({budgetMs:40,now:()=>clock,yieldTask:async()=>{yields++;}});
  const result=await scheduler.run(async()=>{
    for(let i=0;i<20;i++)await scheduler.step(()=>{jobs++;clock+=i<4?12:100;});
  });
  assert.ok(result.skipped);assert.equal(jobs,4);
  await assert.rejects(result.done,/Retired/);
  const stoppedYields=yields;
  for(let frame=0;frame<120;frame++){clock+=16;await flush();}
  assert.equal(jobs,4,'no optional driver work during two seconds of play');
  assert.equal(yields,stoppedYields,'no competing render/idle loop remains');
  assert.equal('continue' in result,false,'Ready cannot restart a stopped queue');
}
// A never-settling compile also releases loading. No hidden geometry or
// viewport/shadow mutations may leak while the promise waits, including
// after Ready and first input, even when the compile completes late.
{
  const gate=deferred(),compiling=deferred(),controller=new AbortController(),scene=new THREE.Scene(),camera=new THREE.Camera();
  const mesh=new THREE.InstancedMesh(new THREE.BoxGeometry(),new THREE.MeshBasicMaterial(),8);
  mesh.visible=false;mesh.count=0;mesh.geometry.setDrawRange(0,0);scene.add(mesh);
  const originalChildren=mesh.children;
  let viewport=new THREE.Vector4(0,0,800,600),scissor=viewport.clone(),test=false,draws=0;
  const checkState=()=>{
    assert.equal(mesh.visible,false);assert.equal(mesh.count,0);assert.equal(mesh.children,originalChildren);
    assert.equal(mesh.geometry.drawRange.count,0);assert.equal(renderer.shadowMap.enabled,true);
    assert.equal(viewport.z,800);assert.equal(scissor.z,800);assert.equal(test,false);
  };
  const renderer={shadowMap:{enabled:true},
    compileAsync(){compiling.resolve();return gate.promise;},
    render(s){draws++;assert.equal(s.children.filter(o=>o.isMesh).length,1);assert.equal(mesh.count,1);assert.equal(scissor.z,0);},
    getViewport:v=>v.copy(viewport),getScissor:v=>v.copy(scissor),getScissorTest:()=>test,
    setViewport:(...v)=>v.length===1?viewport.copy(v[0]):viewport.set(...v),
    setScissor:(...v)=>v.length===1?scissor.copy(v[0]):scissor.set(...v),setScissorTest:v=>{test=v;},
  };
  const loading=warmKartRenderer(THREE,renderer,scene,camera,{roots:[mesh],signal:controller.signal,
    yieldTask:async()=>{}});
  await compiling.promise;checkState();controller.abort();
  const result=await loading;assert.ok(result.skipped);assert.equal(draws,0);checkState();
  gate.resolve();await assert.rejects(result.done,/Retired/);
  await flush();assert.equal(draws,0,'late compilation never renders after Ready');checkState();
  mesh.geometry.dispose();mesh.material.dispose();
}
// An already-running status poll must stop too, without waiting for a GPU
// that is still busy. There must be no late uniform reflection or upload.
{
  const controller=new AbortController(),scene=new THREE.Scene(),mesh=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshBasicMaterial());scene.add(mesh);
  let draws=0,polls=0,reflections=0;const polling=deferred();
  const renderer={info:{programs:[{isReady(){polls++;polling.resolve();return false;},getUniforms(){reflections++;}}]},compileAsync:async()=>{},render(){draws++;}};
  const loading=warmKartRenderer(THREE,renderer,scene,new THREE.Camera(),{signal:controller.signal,yieldTask:async()=>{}});
  await polling.promise;assert.ok(polls>0);controller.abort();
  const result=await loading;
  await assert.rejects(result.done,/Retired/);assert.equal(draws,0);assert.equal(reflections,0);
  mesh.geometry.dispose();mesh.material.dispose();
}
// A deadline arriving during a yield must cancel the imminent GPU call too.
{
  const controller=new AbortController(),yielded=deferred();let calls=0;
  const scheduler=createKartWarmupScheduler({signal:controller.signal,yieldTask:()=>yielded.promise});
  const loading=scheduler.run(()=>scheduler.step(()=>{calls++;}));
  controller.abort();const result=await loading;yielded.resolve();
  await assert.rejects(result.done,/Retired/);assert.equal(calls,0);
}
// Only the optional deadline is cancelled. Game/audio loaders keep running;
// late failure must be observed, never an unhandled rejection after Ready.
{
  const controller=new AbortController(),audio=deferred();let settled=false;
  const ready=waitKartPreparation(audio.promise,controller.signal).then(()=>{settled=true;});
  await flush();assert.equal(settled,false);controller.abort();await ready;
  audio.reject(Error('late decode failure'));await flush();assert.equal(settled,true);
  await waitKartPreparation(Promise.reject(Error('already expired')),controller.signal);
  const scheduler=createKartWarmupScheduler({budgetMs:Infinity,signal:controller.signal});
  const stopped=await scheduler.run(()=>scheduler.step(()=>assert.fail('retired job ran')));
  stopped.cancel();await assert.rejects(stopped.done,/Retired/);
}
// Current driver/pickup and scenery precede rare FX. Each binding prepares
// both quality modes before a deadline can stop the next binding.
{
  const scene=new THREE.Scene(),camera=new THREE.Camera(),order=[],material=new THREE.MeshBasicMaterial(),geometry=new THREE.BoxGeometry();
  const road=new THREE.Mesh(geometry.clone(),material),rare=new THREE.Mesh(geometry,material.clone()),kart=new THREE.Mesh(geometry,material);
  road.name='road';rare.name='rare';kart.name='kart';scene.add(rare,road,kart);rare.visible=kart.visible=false;
  const renderer={shadowMap:{enabled:true},compileAsync(o){order.push([o.name,this.shadowMap.enabled]);return Promise.resolve();},render(){}};
  await warmKartRenderer(THREE,renderer,scene,camera,{roots:[rare,kart],priorityRoots:[kart],yieldTask:async()=>{}});
  assert.deepEqual(order,[['kart',true],['kart',false],['road',true],['road',false],['rare',true],['rare',false]]);
  geometry.dispose();material.dispose();road.geometry.dispose();rare.material.dispose();
}
console.log('KART_PREPARATION_PASS: loading-only tasks, no post-Ready GPU work, stalled compile, state isolation, cancellation, audio deadline and priority');

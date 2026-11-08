// Deterministic scheduler time, not a claim about a GPU driver's atomic calls.
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createKartWarmupScheduler,waitKartPreparation} from '../public/js/engines/kart-warmup-scheduler.mjs';
import {warmKartRenderer} from '../public/js/engines/kart-render-warmup.mjs';
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};

// Even when each compiler/upload/reflection costs 17ms on a busy device,
// scheduler steps cannot accumulate into a 50ms task. No real sleeps needed.
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
// Budget expiry releases loading, then parks work until Ready explicitly
// enables it. Remaining jobs get idle turns, with the same small task bound.
{
  let clock=0,jobs=0,idles=0,taskStart=0;const tasks=[];
  const boundary=async()=>{tasks.push(clock-taskStart);taskStart=clock;};
  const scheduler=createKartWarmupScheduler({budgetMs:40,now:()=>clock,yieldTask:boundary,
    idleTask:async()=>{idles++;await boundary();}});
  const result=await scheduler.run(async()=>{for(let i=0;i<20;i++)await scheduler.step(()=>{jobs++;clock+=12;});});
  assert.ok(result.deferred);assert.equal(jobs,4);assert.equal(idles,0);
  await flush();assert.equal(jobs,4,'extra work stays parked before Ready');
  result.continue();await result.done;tasks.push(clock-taskStart);
  assert.equal(jobs,20);assert.equal(idles,16);assert.ok(tasks.every(ms=>ms<=50));
}
// A never-settling compile also releases loading. No hidden geometry or
// viewport/shadow mutations may leak while the promise waits, including
// while actual play updates the same object before idle preparation resumes.
{
  const gate=deferred(),controller=new AbortController(),scene=new THREE.Scene(),camera=new THREE.Camera();
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
    compileAsync:()=>gate.promise,
    render(s){draws++;assert.equal(s.children.filter(o=>o.isMesh).length,1);assert.equal(mesh.count,1);assert.equal(scissor.z,0);},
    getViewport:v=>v.copy(viewport),getScissor:v=>v.copy(scissor),getScissorTest:()=>test,
    setViewport:(...v)=>v.length===1?viewport.copy(v[0]):viewport.set(...v),
    setScissor:(...v)=>v.length===1?scissor.copy(v[0]):scissor.set(...v),setScissorTest:v=>{test=v;},
  };
  const loading=warmKartRenderer(THREE,renderer,scene,camera,{roots:[mesh],signal:controller.signal,
    yieldTask:async()=>{},idleTask:async()=>{checkState();}});
  await flush();checkState();controller.abort();
  const result=await loading;assert.ok(result.deferred);assert.equal(draws,0);checkState();
  gate.resolve();await flush();assert.equal(draws,0,'late compilation cannot draw before Ready');
  result.continue();await result.done;assert.equal(draws,2);checkState();
  mesh.geometry.dispose();mesh.material.dispose();
}
// Retirement must also stop a program-status poll, not only queued jobs.
{
  const scene=new THREE.Scene(),mesh=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshBasicMaterial());scene.add(mesh);
  let draws=0;
  const renderer={info:{programs:[{isReady:()=>false}]},compileAsync:async()=>{},render(){draws++;}};
  const result=await warmKartRenderer(THREE,renderer,scene,new THREE.Camera(),{budgetMs:0,idleTask:async()=>{}});
  result.continue();await flush();result.cancel();
  await assert.rejects(result.done,/Retired/);assert.equal(draws,0);
  mesh.geometry.dispose();mesh.material.dispose();
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
// Current driver/pickup and scenery precede rare FX. Shadow-off is last.
{
  const scene=new THREE.Scene(),camera=new THREE.Camera(),order=[],material=new THREE.MeshBasicMaterial(),geometry=new THREE.BoxGeometry();
  const road=new THREE.Mesh(geometry,material),rare=new THREE.Mesh(geometry,material),kart=new THREE.Mesh(geometry,material);
  road.name='road';rare.name='rare';kart.name='kart';scene.add(rare,road,kart);rare.visible=kart.visible=false;
  const renderer={shadowMap:{enabled:true},compileAsync(o){order.push([o.name,this.shadowMap.enabled]);return Promise.resolve();},render(){}};
  await warmKartRenderer(THREE,renderer,scene,camera,{roots:[rare,kart],priorityRoots:[kart],yieldTask:async()=>{}});
  assert.deepEqual(order,[['kart',true],['road',true],['rare',true],['kart',false],['road',false],['rare',false]]);
  geometry.dispose();material.dispose();
}
console.log('KART_PREPARATION_PASS: bounded tasks, loading budget, idle continuation, stalled compile, state isolation, cancellation, audio deadline and priority');

'use strict';
// Real server + seven WebSocket bots + one Chrome keyboard driver. Rendering
// hooks are injected by Playwright routes; shipping modules expose no debug API.
// NODE_PATH=/private/tmp/codex-driving-browser/node_modules node test/kart-performance-browser.cjs
const fs=require('node:fs'),path=require('node:path'),{fork,execFileSync}=require('node:child_process');
const {chromium}=require('playwright'),WebSocket=require('ws');
const ROOT=path.resolve(__dirname,'..'),OUT=process.env.KART_PERF_OUT||'/tmp/kart-performance',PORT=Number(process.env.KART_PERF_PORT||8300);
const maps=(process.env.KART_PERF_MAPS||'Rookie Ring,Bumper Blocks,Garden Circuit,Frosty Pass,Neon Yard,Alpine Courtyard,Frost Quarry,Neon Harbor,Harbor Heights,Skyport,Foundry').split(',');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,label,ms=90000){const end=Date.now()+ms;while(Date.now()<end){if(await fn())return;await sleep(100);}throw Error('timeout: '+label);}
(async()=>{
 fs.mkdirSync(OUT,{recursive:true});
 const {decodeFrame}=await import('../public/js/toolkit/realtime/client.mjs');
 const server=fork(path.join(__dirname,'helpers/kart-performance-server.cjs'),[],{cwd:ROOT,env:{...process.env,PORT:String(PORT),HOST:'127.0.0.1',NODE_ENV:'test',REPORT_DB_PATH:path.join(OUT,'reports.json')},silent:true});
 let log='',browser;server.on('error',error=>{log+='\nSERVER ERROR '+error.message;});server.on('exit',(code,signal)=>{log+='\nSERVER EXIT '+code+' '+signal;fs.writeFileSync(path.join(OUT,'server.log'),log);});server.stdout.on('data',d=>log+=d);server.stderr.on('data',d=>log+=d);
 const results=[],baselineModules=new Map();
 try{
  await until(()=>log.includes('PartyBox on'),'server');
  browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--use-angle=metal','--ignore-gpu-blocklist']});
  for(const map of maps)for(const [width,height]of(process.env.KART_PERF_PHONE==='0'?[[1280,720]]:[[1280,720],[390,844]])){
   const slug=map.toLowerCase().replaceAll(' ','-')+'-'+width,bots=[],errors=[];
   let interval,context,video;
   try{
    async function bot(index,code){const ws=new WebSocket('ws://127.0.0.1:'+PORT),b={ws,seq:0,seen:new Set(),decoder:decodeFrame({eventDeltas:true})};bots.push(b);
     ws.on('message',(raw,binary)=>{const m=binary?b.decoder.apply(new Uint8Array(raw)):JSON.parse(raw);if(!m)return;
      if(m.t==='hello')b.hello=m;if(m.t==='room')b.room=m.room;if(m.t==='state'){b.state=m;if(b.observed)for(const e of m.events||[])if(!b.seen.has(e.id)){b.seen.add(e.id);b.observed.push({...e,wall:Date.now()});}if(m.preparing&&!m.spectator)ws.send(JSON.stringify({t:'game-ready',i:m.instanceId,w:m.w}));}});
     await new Promise(r=>ws.on('open',r));ws.send(JSON.stringify({t:code?'join':'create',name:'Bot '+index,code,realtime:'rt1',kartEvents:'delta-v1'}));await until(()=>b.hello,'bot hello');return b;}
    const host=await bot(0);for(let i=1;i<7;i++)await bot(i,host.hello.code);
    console.log('START '+slug);
    context=await browser.newContext({viewport:{width,height},deviceScaleFactor:1,isMobile:width<500,hasTouch:width<500,recordVideo:process.env.KART_PERF_VIDEO==='1'?{dir:OUT,size:{width,height}}:undefined});
    const instrumentEngine=body=>{body=body.replaceAll('}).catch(()=>null);','}).catch(error=>{globalThis.__kartPerf.preparationError=String(error.stack);return null;});');body=body.replace('onProgress:({completed,total})=>{','onProgress:({completed,total})=>{globalThis.__kartPerf.preparation={completed,total};if(!completed)performance.mark(\'kart:prep-start\');');body=body.replaceAll('rendererWarmup=warmup;','rendererWarmup=warmup;performance.mark(\'kart:prep-end\');globalThis.__kartPerf.prepSkipped=warmup?.skipped;');return body;};
    const instrumentRenderer=body=>{body=body.replace('mountEl.appendChild(canvas);','mountEl.appendChild(canvas); globalThis.__kartPerf.renderer=renderer;').replace('const { scene, camera } = built;','const { scene, camera } = built; globalThis.__kartPerf.scene=scene; globalThis.__kartPerf.camera=camera; const perf=globalThis.__kartPerf, frame=built.frame.bind(built), render=renderer.render.bind(renderer); built.frame=(...a)=>{perf.workStart=performance.now();return frame(...a);};renderer.render=(...a)=>{const result=render(...a);perf.workMs=performance.now()-perf.workStart;return result;};');return body;};
    if(process.env.KART_PERF_BASELINE||process.env.KART_PERF_BASELINE_REF){
    await context.route('**/js/engines/kart-*',async route=>{let body;const file=new URL(route.request().url()).pathname.split('/').pop();if(process.env.KART_PERF_BASELINE)body=fs.readFileSync(path.join(process.env.KART_PERF_BASELINE,file),'utf8');else if(process.env.KART_PERF_BASELINE_REF){if(!baselineModules.has(file))baselineModules.set(file,execFileSync('git',['show',process.env.KART_PERF_BASELINE_REF+':apps/games/public/js/engines/'+file],{cwd:ROOT,encoding:'utf8'}));body=baselineModules.get(file);}else body=await(await route.fetch()).text();body=body.replaceAll('}).catch(()=>null);','}).catch(error=>{globalThis.__kartPerf.preparationError=String(error.stack);return null;});');body=body.replace('onProgress:({completed,total})=>{','onProgress:({completed,total})=>{globalThis.__kartPerf.preparation={completed,total};if(!completed)performance.mark(\'kart:prep-start\');');body=body.replaceAll('rendererWarmup=warmup;','rendererWarmup=warmup;performance.mark(\'kart:prep-end\');globalThis.__kartPerf.prepSkipped=warmup?.skipped;');await route.fulfill({contentType:'text/javascript',body});});
    await context.route('**/js/renderers/three-view.js',async route=>{const response=await route.fetch();let body=await response.text();body=body.replace('mountEl.appendChild(canvas);','mountEl.appendChild(canvas); globalThis.__kartPerf.renderer=renderer;').replace('const { scene, camera } = built;','const { scene, camera } = built; globalThis.__kartPerf.scene=scene; globalThis.__kartPerf.camera=camera; const perf=globalThis.__kartPerf, frame=built.frame.bind(built), render=renderer.render.bind(renderer); built.frame=(...a)=>{perf.workStart=performance.now();return frame(...a);};renderer.render=(...a)=>{const result=render(...a);perf.workMs=performance.now()-perf.workStart;return result;};');await route.fulfill({response,body});});
    }else{
     const {installKartGalleryBundle}=require('./helpers/kart-gallery-bundle.cjs');
     await installKartGalleryBundle(context,{'kart-view.js':instrumentEngine,'kart-elevated-view.js':instrumentEngine,'three-view.js':instrumentRenderer});
    }
    await context.addInitScript(()=>{
     const p=window.__kartPerf={frames:[],tasks:[],events:[],mutations:0,uploads:{programs:0,buffers:0,textures:0},active:false};
     const native=WebSocket.prototype.send;WebSocket.prototype.send=function(data){try{const m=JSON.parse(data);if(m.t==='action')p.lastInput=m;}catch{}return native.call(this,data);};
     for(const C of[WebGLRenderingContext,WebGL2RenderingContext])for(const[name,key]of[['createProgram','programs'],['bufferData','buffers'],['texImage2D','textures'],['texStorage2D','textures']]){const original=C.prototype[name];if(original)C.prototype[name]=function(...a){if(p.active)p.uploads[key]++;return original.apply(this,a);};}
     new PerformanceObserver(list=>{if(p.active)for(const e of list.getEntries())p.tasks.push({at:e.startTime,ms:e.duration});}).observe({type:'longtask',buffered:true});
     new MutationObserver(list=>{if(p.active)p.mutations+=list.length;}).observe(document,{subtree:true,childList:true,characterData:true,attributes:true});
     let last;function frame(t){if(p.active&&p.renderer){if(last)p.frames.push({at:t,ms:t-last,draws:p.renderer.info.render.calls,triangles:p.renderer.info.render.triangles,work:p.workMs});last=t;}else last=undefined;requestAnimationFrame(frame);}requestAnimationFrame(frame);
     p.begin=()=>{performance.mark('kart:measurement-start');p.frames=[];p.tasks=[];p.uploads={programs:0,buffers:0,textures:0};p.mutations=0;p.active=true;p.start=performance.now();};
     p.end=()=>{performance.mark('kart:measurement-end');p.active=false;const q=(a,n)=>{a.sort((a,b)=>a-b);return a[Math.min(a.length-1,Math.floor(a.length*n))]||0;},frames=p.frames,gl=p.renderer.getContext(),debug=gl.getExtension('WEBGL_debug_renderer_info');
      return{preparation:p.preparation,prepSkipped:p.prepSkipped,preparationError:p.preparationError,origin:performance.timeOrigin,start:p.start,fps:frames.length/((performance.now()-p.start)/1000),worst:Math.max(0,...frames.map(f=>f.ms)),p95:q(frames.map(f=>f.ms),.95),workP95:q(frames.map(f=>f.work||0),.95),draws:q(frames.map(f=>f.draws),.5),peakDraws:Math.max(0,...frames.map(f=>f.draws)),triangles:q(frames.map(f=>f.triangles),.5),uploads:p.uploads,mutations:p.mutations,tasks:p.tasks,frames,gpu:debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):'unknown'};};
    });
    const page=await context.newPage();video=page.video();page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
    const cdp=await context.newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
    const startTrace=async()=>{await cdp.send('Profiler.enable');await cdp.send('Profiler.setSamplingInterval',{interval:1000});await cdp.send('Profiler.start');await cdp.send('Tracing.start',{categories:'devtools.timeline,blink.user_timing,v8,disabled-by-default-v8.gc',transferMode:'ReturnAsStream'});};
    if(process.env.KART_PERF_LOAD_TRACE==='1')await startTrace();
    await page.goto('http://127.0.0.1:'+PORT+'/r/'+host.hello.code);
    for(let attempt=0;attempt<6&&host.room?.players.length!==8;attempt++){await page.locator('#nm').fill('Chrome Driver');await page.evaluate(c=>document.getElementById('jc').value=c,host.hello.code);await page.locator('#bJoin').click();await sleep(500);}
    await until(()=>host.room?.players.length===8,'browser seated');
    host.ws.send(JSON.stringify({t:'start',game:'pocket-karts',ready:true,settings:{map,mode:'Zap Battle',winRule:'Time limit',roundSeconds:180}}));
    await until(()=>{if(errors.length)throw Error(errors.join('\n'));return ['drive','live'].includes(host.state?.phase)&&!host.state.preparing;},'live '+map,180000).catch(async e=>{console.error('STATE',host.state?.phase,host.state?.preparing,await page.locator('body').innerText());throw e;});
    await page.waitForFunction(()=>!!window.__kartPerf.renderer&&!!window.__kartPerf.scene,null,{timeout:180000});
    // Bots send the same accepted input schema as their production view.
    interval=setInterval(()=>{for(const b of bots){const s=b.state;if(!s?.inputAck||!['drive','live'].includes(s.phase))continue;const i=++b.seq;
     const a=s.profile?{type:'input',seq:i,life:s.inputAck.life,controlEpoch:s.inputAck.controlEpoch,steer:Math.sin(i/45)*.8,throttle:1,brake:0,nitro:i%100<20,use:i%20===0}:{seq:i,life:s.inputAck.life,controlEpoch:s.inputAck.controlEpoch,input:{steer:Math.sin(i/45)*.8,throttle:1,boost:i%20===0}};
     b.ws.send(JSON.stringify({t:'action',i:s.instanceId,w:s.w,a}));}},50);
    await page.locator('.pk-stage canvas,.pke-stage canvas').click({force:true});await page.keyboard.down('ArrowUp');await sleep(2500);
    if(process.env.KART_PERF_LOAD_TRACE!=='1')await startTrace();
    await page.evaluate(()=>window.__kartPerf.begin());
    const events=host.observed=[],seconds=Number(process.env.KART_PERF_SECONDS||24);
    for(let i=0;i<seconds*2;i++){
     const key=i%4<2?'ArrowLeft':'ArrowRight';await page.keyboard.down(key);if(i%4===0)await page.keyboard.press('Space');await sleep(500);await page.keyboard.up(key);
    }
    const metrics=await page.evaluate(()=>window.__kartPerf.end());
    let stress;
    if(process.env.KART_PERF_STRESS==='1'){
     const stressEvents=host.observed=[];await page.evaluate(()=>window.__kartPerf.begin());
     let commandId=0;
     const command=command=>new Promise((resolve,reject)=>{const id=++commandId,timer=setTimeout(()=>{server.off('message',receive);reject(Error('Scenario IPC timed out: '+log.slice(-1200)));},10000),receive=m=>{if(m.id!==id)return;clearTimeout(timer);server.off('message',receive);m.ok?resolve():reject(Error(m.error));};server.on('message',receive);server.send({command,id},error=>{if(error){clearTimeout(timer);server.off('message',receive);reject(error);}});});
     for(const weapon of ['machinegun','trishot','missile','cannon','blades','supernova','mine','frost','ram','nuke']){await command(weapon);await page.keyboard.press('Space');await sleep(1200);}
     await sleep(3000);await command('ko');await sleep(2500);
     stress={controlled:true,...await page.evaluate(()=>window.__kartPerf.end()),events:stressEvents};
    }
    await page.keyboard.up('ArrowUp');
    const complete=new Promise(r=>cdp.once('Tracing.tracingComplete',r));await cdp.send('Tracing.end');const{stream}=await complete;let trace='';for(;;){const part=await cdp.send('IO.read',{handle:stream});trace+=part.data;if(part.eof)break;}await cdp.send('IO.close',{handle:stream});
    fs.writeFileSync(path.join(OUT,slug+'.trace.json'),trace);
    const {profile}=await cdp.send('Profiler.stop');fs.writeFileSync(path.join(OUT,slug+'.cpuprofile'),JSON.stringify(profile));
    const entries=JSON.parse(trace).traceEvents,marks=entries.filter(e=>e.name==='kart:measurement-start'||e.name==='kart:measurement-end').sort((a,b)=>a.ts-b.ts);
    const gcBetween=(start=-Infinity,end=Infinity)=>entries.filter(e=>e.ph==='X'&&/^(MinorGC|MajorGC)$/.test(e.name)&&e.ts>=start&&e.ts<=end).map(e=>({name:e.name,ms:e.dur/1000,at:(e.ts-start)/1000}));
    const gc=gcBetween(marks[0]?.ts,marks[1]?.ts);if(stress)stress.gc=gcBetween(marks[2]?.ts,marks[3]?.ts);
    await page.screenshot({path:path.join(OUT,slug+'.png')});
    // Every camera angle uses the real assembled scene. onAfterRender records
    // actual GPU submissions; bounds are audited against all world vertices.
    const sweep=await page.evaluate(async()=>{
     const p=window.__kartPerf,r=p.renderer,s=p.scene,c=p.camera,THREE=await import('/vendor/three/three.module.js');const pos=c.position.clone(),quat=c.quaternion.clone();
     const drawn=new Set(),expected=new Map(),badBounds=[],hooks=[];s.updateMatrixWorld(true);
     const point=new THREE.Vector3(),m=new THREE.Matrix4();
     s.traverseVisible(o=>{if(!o.isMesh)return;hooks.push([o,o.onAfterRender]);o.onAfterRender=function(...a){drawn.add(o.uuid);hooks.find(h=>h[0]===o)[1].apply(this,a);};
      let dynamic=false;for(let a=o;a;a=a.parent)if(a.userData.dynamic||a.userData.giggleKart||a.userData.combat)dynamic=true;const mats=Array.isArray(o.material)?o.material:[o.material];
      if(!dynamic&&!o.userData.cameraCollider&&c.layers.test(o.layers)&&mats.every(m=>!m.transparent&&m.side!==THREE.BackSide)&&!o.name.includes('Shadow')&&!/sun-disk|sun-disc/.test(o.name))expected.set(o.uuid,o.name);
      if(o.isInstancedMesh&&o.frustumCulled&&o.boundingSphere){for(let i=0;i<o.count;i++){o.getMatrixAt(i,m);const g=o.geometry;if(!g.boundingSphere)g.computeBoundingSphere();const b=g.boundingSphere.clone().applyMatrix4(m);if(o.boundingSphere.center.distanceTo(b.center)+b.radius>o.boundingSphere.radius+.02){badBounds.push(o.name);break;}}}
     });
     for(let i=0;i<24;i++){const a=i*Math.PI/12;c.position.set(Math.sin(a)*90,35,Math.cos(a)*90);c.lookAt(0,3,0);r.render(s,c);}
     c.position.copy(pos);c.quaternion.copy(quat);for(const[o,fn]of hooks)o.onAfterRender=fn;
     return{angles:24,expected:expected.size,drawn:[...expected.keys()].filter(id=>drawn.has(id)).length,badBounds,missing:[...expected].filter(([id])=>!drawn.has(id)).map(([,name])=>name)};
    });
    const eventWindows=(sample,events)=>events.map(e=>{const at=e.wall-sample.origin;const near=sample.frames.filter(f=>f.at>=at-100&&f.at<=at+300),times=near.map(f=>f.ms).sort((a,b)=>a-b);return{type:e.type||e.kind,weapon:e.weapon,worst:Math.max(0,...times),p95:times[Math.floor(times.length*.95)]||0,draws:Math.max(0,...near.map(f=>f.draws)),triangles:Math.max(0,...near.map(f=>f.triangles)),longTasks:sample.tasks.filter(t=>t.at>=at-100&&t.at<=at+300).length,gc:sample.gc?.filter(g=>g.at+sample.start>=at-100&&g.at+sample.start<=at+300)};});
    const eventFrames=eventWindows(metrics,events);if(stress)stress.eventFrames=eventWindows(stress,stress.events);
    const result={stress,eventFrames,map,width,height,cpuThrottle:4,drivers:host.state.karts.length,browser:browser.version(),...metrics,gc,events,sweep,errors};results.push(result);
    fs.writeFileSync(path.join(OUT,'results.json'),JSON.stringify(results,null,2));console.log(JSON.stringify({map,width,fps:metrics.fps,p95:metrics.p95,worst:metrics.worst,uploads:metrics.uploads,mutations:metrics.mutations,stress:stress&&{fps:stress.fps,p95:stress.p95,worst:stress.worst,uploads:stress.uploads,tasks:stress.tasks.length,events:[...new Set(stress.events.map(e=>e.type))]},sweep,errors}));
   }finally{clearInterval(interval);if(bots[0]?.ws.readyState===WebSocket.OPEN){bots[0].ws.send(JSON.stringify({t:'lobby'}));await sleep(150);}for(const b of bots)b.ws.close();await context?.close();if(video){const file=await video.path();fs.renameSync(file,path.join(OUT,slug+'.webm'));}}
  }
 }finally{await browser?.close();server.kill();fs.writeFileSync(path.join(OUT,'server.log'),log);}
 if(results.some(r=>r.errors.length||r.drivers!==8||!r.frames.length||r.sweep.badBounds.length||r.stress&&Object.values(r.stress.uploads).some(n=>n!==0)))process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;});

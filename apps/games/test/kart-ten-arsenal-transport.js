'use strict';

// Real production server/Room/WebSocket proof. The isolated child preload fixes
// RNG seeds and observes snapshots/disposal only. Authored maps, normal 60 s
// settings, poses, pickups, hits, scores and wall clocks are never injected.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawn}=require('node:child_process'),{once}=require('node:events'),net=require('node:net'),WebSocket=require('ws');
const ROOT=path.join(__dirname,'..'),sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let checks=0;
const ok=(v,label)=>{assert.ok(v,label);checks++;};
const eq=(a,b,label)=>{assert.deepEqual(a,b,label);checks++;};
const finite=v=>typeof v==='number'?Number.isFinite(v):v&&typeof v==='object'?Object.values(v).every(finite):true;
async function until(fn,label,ms=4000){const end=Date.now()+ms;while(Date.now()<end){if(await fn())return;await sleep(20);}throw Error(label);}
function toward(p,target){const q=p.rotation,heading=Math.atan2(2*(q.x*q.z+q.w*q.y),1-2*(q.x*q.x+q.y*q.y));const wanted=Math.atan2(target.x-p.position.x,target.z-p.position.z),error=Math.atan2(Math.sin(wanted-heading),Math.cos(wanted-heading));return{throttle:Math.abs(error)>.5?.45:.8,steer:Math.max(-1,Math.min(1,-error*2.5))};}

async function pickupSeeds(){
  const {loadElevatedDependencies}=require('../games/engines/kart-elevated-adapter');
  const {createElevatedCombat}=require('../games/engines/kart-elevated-combat');
  const {RAPIER,config,maps}=await loadElevatedDependencies(),result={},seats=Array.from({length:8},(_,i)=>({id:'p'+i}));
  for(let seed=0;seed<512&&Object.keys(result).length<2;seed++){
    const w=createElevatedCombat(RAPIER,config,maps.harbor,seats,{instance:'seed-'+seed,seed,startAt:0,countdownMs:0,roundMs:30000,crates:6});
    try{
      if(!w.snapshot().crates.some(c=>c.position.x===-64&&c.position.z===-50))continue;
      for(let n=0;n<480;n++){
        const s=w.snapshot('p0'),k=s.karts[0];
        if(k.weapon){if(['seeker','bomb'].includes(k.weapon)&&result[k.weapon]===undefined)result[k.weapon]=seed;break;}
        if(n%6===0)assert.ok(w.input('p0',{instance:s.instance,seq:s.you.receivedSeq+1,life:s.you.life,controlEpoch:s.you.controlEpoch,brake:0,nitro:false,use:false,...toward(k.pose,{x:-64,z:-49})},s.serverAt).ok);
        w.advance(s.serverAt+config.fixedDt*1000);
      }
    }finally{w.dispose();}
  }
  ok(result.seeker!==undefined&&result.bomb!==undefined,'bounded seeds use actual authored-spawn crate collection for both new items');
  return result;
}

function preloadSource(seeds){
  return `// Isolated test observation. No authority/map/result mutation.
const http=require('node:http'),P=require(${JSON.stringify(path.join(ROOT,'games/engines/kart-physics.js'))});
const physicsFactory=P.createKartPhysics,references=new Map();let lastWorld;
require.cache[require.resolve(${JSON.stringify(path.join(ROOT,'games/engines/kart-physics.js'))})].exports={...P,createKartPhysics:function(...args){const world=physicsFactory.apply(this,args),entry={world,config:args[1],disposed:false};lastWorld=entry;return Object.freeze({...world,dispose(){entry.disposed=true;return world.dispose();}});}};
const C=require(${JSON.stringify(path.join(ROOT,'games/engines/kart-elevated-combat.js'))});
const inspectSeeker=${inspectSeeker.toString()};
const original=C.createElevatedCombat,records=[],fixed=${JSON.stringify([seeds.seeker,seeds.bomb,seeds.bomb])};
function capture(record,view){record.phase=view.phase;record.snapshots.push({simTick:view.simTick,simAt:view.simAt,karts:view.karts,phase:view.phase,projectiles:view.projectiles,grenades:view.grenades,events:view.events});if(record.snapshots.length>120)record.snapshots.shift();}
C.createElevatedCombat=(R,config,map,seats,options)=>{
  const index=records.length,match=original(R,config,map,seats,{...options,seed:fixed[index]??fixed[0]});
  references.set(options.instance,{match,entry:lastWorld});
  const record={instance:options.instance,mapId:map.id,seed:fixed[index]??fixed[0],disposals:0,stats:match.stats(),snapshots:[]};records.push(record);capture(record,match.snapshot());
  return Object.freeze({...match,advance(now){const v=match.advance(now);capture(record,v);return v;},dispose(){record.disposals++;references.delete(options.instance);match.dispose();record.stats=match.stats();}});
};
const create=http.createServer;
http.createServer=function(...args){const at=args.findLastIndex(v=>typeof v==='function'),handler=args[at];args[at]=function(req,res){const url=new URL(req.url,'http://fixture.local');if(url.pathname==='/__kart_transport_eligibility'){
  const instance=url.searchParams.get('instance'),owner=url.searchParams.get('owner'),ref=references.get(instance);
  if(!ref||ref.entry.disposed){res.writeHead(410,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'unknown or disposed instance'}));return;}
  const view=ref.match.snapshot();if(view.phase!=='live'||!view.karts.some(k=>k.id===owner)){res.writeHead(409,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'not a live owner',phase:view.phase,tick:view.simTick}));return;}
  res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(inspectSeeker(ref.entry.world,ref.entry.config,view,owner,C.arsenal.seeker)));return;
}if(req.url==='/__kart_transport_evidence'){res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(records));return;}return handler(req,res);};return create.apply(this,args);};
`;
}
async function boot(preload){
  const reserve=net.createServer();reserve.listen(0,'127.0.0.1');await once(reserve,'listening');const port=reserve.address().port;await new Promise(r=>reserve.close(r));
  const child=spawn(process.execPath,['--require',preload,'server/server.js'],{cwd:ROOT,env:{...process.env,PORT:String(port),HOST:'127.0.0.1'},stdio:['ignore','pipe','pipe']});
  let output='';child.stdout.on('data',v=>output+=v);child.stderr.on('data',v=>output+=v);
  await until(()=>output.includes('PartyBox on'),'production server initialize',8000);
  return{child,http:'http://127.0.0.1:'+port,ws:'ws://127.0.0.1:'+port,output:()=>output};
}
async function connect(server){
  const ws=new WebSocket(server.ws),c={ws,frames:[],state:null,hello:null,seq:0};
  ws.on('message',raw=>{const m=JSON.parse(raw);c.frames.push(m);if(c.frames.length>420)c.frames.shift();if(m.t==='state')c.state=m;if(m.t==='hello')c.hello=m;});
  await once(ws,'open');return c;
}
const send=(c,m)=>c.ws.send(JSON.stringify(m));
function action(c,intent={},meta={}){
  const s=c.state,p=s.inputAck;c.seq=Math.max(c.seq,p?.receivedSeq||0)+1;
  send(c,{t:'action',i:s.instanceId,w:s.w,a:{type:'input',seq:c.seq,life:p?.life||0,controlEpoch:p?.controlEpoch||0,steer:0,throttle:0,brake:0,nitro:false,use:false,...intent},...meta});
  return c.seq;
}
const kart=c=>c.state.karts.find(k=>k.id===c.hello.you);
const evidence=server=>fetch(server.http+'/__kart_transport_evidence').then(r=>r.json());
const frames=c=>c.frames.filter(m=>m.t==='state');
async function start(clients,settings){
  const previous=clients[0].state?.instanceId;send(clients[0],{t:'start',game:'pocket-karts',...(settings?{settings}:{})});
  await until(()=>clients.every(c=>c.state?.instanceId&&c.state.instanceId!==previous),'fresh actual Room start');
  for(const c of clients)c.seq=0;
}
function inspectSeeker(world,config,view,owner,rule){
  const add=(a,b)=>({x:a.x+b.x,y:a.y+b.y,z:a.z+b.z}),sub=(a,b)=>({x:a.x-b.x,y:a.y-b.y,z:a.z-b.z}),mul=(a,n)=>({x:a.x*n,y:a.y*n,z:a.z*n}),length=a=>Math.hypot(a.x,a.y,a.z),dot=(a,b)=>a.x*b.x+a.y*b.y+a.z*b.z;
  const rotate=(v,q)=>{const t={x:2*(q.y*v.z-q.z*v.y),y:2*(q.z*v.x-q.x*v.z),z:2*(q.x*v.y-q.y*v.x)};return{x:v.x+q.w*t.x+q.y*t.z-q.z*t.y,y:v.y+q.w*t.y+q.z*t.x-q.x*t.z,z:v.z+q.w*t.z+q.x*t.y-q.y*t.x};};
    const shooter=view.karts.find(k=>k.id===owner),q=shooter.pose.rotation,muzzle=add(shooter.pose.position,rotate(config.combat.seekerMuzzle||{x:0,y:.5,z:1.9},q)),forward=rotate({x:0,y:0,z:1},q);
    const candidates=view.karts.filter(k=>k.id!==owner).map(k=>{
      const point=add(k.pose.position,rotate({x:0,y:.35,z:0},k.pose.rotation)),delta=sub(point,muzzle),distance=length(delta),projection=dot(delta,forward);
      const start=distance<.001?muzzle:add(muzzle,mul(delta,Math.min(.01/distance,.01))),hit=distance<.001?null:world.sweepStatic(start,point);
      const clear=!hit||hit.fraction>=1-1e-6;
      return{id:k.id,pose:k.pose,life:k.spawnSeq,alive:k.alive,connected:k.connected,shield:k.shield,distance,projection,clear,hit:hit?{surfaceId:hit.surfaceId,fraction:hit.fraction}:null,eligible:k.alive&&k.connected&&k.shield<=0&&distance<=rule.range&&projection>=distance*Math.cos(rule.halfAngle)&&clear};
    }).sort((a,b)=>a.distance-b.distance);
    return{instance:view.instance,tick:view.simTick,simAt:view.simAt,phase:view.phase,ownerPose:shooter.pose,muzzle,forward,candidates,closest:candidates.find(k=>k.eligible)?.id??null};
}
const observeSeeker=(server,instance,owner)=>fetch(server.http+'/__kart_transport_eligibility?instance='+encodeURIComponent(instance)+'&owner='+encodeURIComponent(owner)).then(async r=>{const value=await r.json();if(!r.ok)throw Error('Seeker observer '+r.status+' '+JSON.stringify(value));return value;});
async function establishSeeker(server,a,target){
  let targetSeq=action(target,{throttle:-1}),lastTick=-1,stable=0,last;
  const records=[],end=Date.now()+Math.min(7000,Math.max(0,a.state.deadline-(a.state.gameNow??a.state.serverNow)-500));
  while(Date.now()<end){
    last=await observeSeeker(server,a.state.instanceId,a.hello.you);
    const rival=last.candidates.find(k=>k.id===target.hello.you),applied=target.state.inputAck.appliedInputSeq>=targetSeq;
    const safe=rival.eligible&&rival.distance<=43&&rival.projection>=rival.distance*Math.cos(33*Math.PI/180);
    const ready=last.closest===target.hello.you&&safe&&applied&&Math.abs(rival.pose.speed)>.1&&Math.abs(last.ownerPose.speed)<.4;
    if(last.tick!==lastTick){stable=ready?stable+1:0;lastTick=last.tick;
      records.push({tick:last.tick,simAt:last.simAt,ownerPosition:last.ownerPose.position,ownerSpeed:last.ownerPose.speed,
        target:rival,closest:last.closest,targetSeq,applied,ready});if(records.length>16)records.shift();}
    if(stable>=2){console.log('SEEKER_PREFIRE_CONDITIONS',JSON.stringify(records));return last;}
    if(safe)action(a,{brake:1});else action(a,toward(kart(a).pose,rival.pose.position));
    targetSeq=action(target,{throttle:-1});await sleep(95);
  }
  throw Error('Seeker actual preconditions not established '+JSON.stringify(records));
}
async function collect(c,weapon){
  const end=Date.now()+7000;
  while(Date.now()<end){
    if(kart(c).weapon&&kart(c).weapon!==weapon)throw Error('real seed route collected '+kart(c).weapon+' rather than '+weapon);
    if(kart(c).weapon===weapon){
      // Stop as soon as the real pickup arrives, and keep braking until the
      // physical kart settles. A fixed 200ms brake expires while the faster
      // kart coasts into the ramp's line-of-sight shadow.
      action(c,{brake:1});if(Math.abs(kart(c).pose.speed)<.4)return;await sleep(95);continue;
    }
    action(c,toward(kart(c).pose,{x:-64,z:-49}));await sleep(95);
  }
  throw Error('actual WebSocket drive did not collect '+weapon);
}
// JSON transports signed zero as 0. Keep exact compact precision while
// comparing the same numeric representation that the real WS client receives.
function rounded(v){return Object.fromEntries(Object.entries(v).map(([k,n])=>[k,+n.toFixed(3)||0]));}
async function compare(server,client,frame,kind){
  const ledger=await evidence(server),record=ledger.find(r=>r.instance===frame.instanceId),raw=record?.snapshots.find(s=>s.simTick===frame.simTick);
  ok(raw,'projected physical frame has a matching independently observed authority tick');
  const item=frame[kind][0],original=raw[kind].find(s=>s.id===item.id);
  eq(item.weapon,original.weapon,'weapon id survives authority→adapter→Room→WS');eq(item.position,rounded(original.position),'physical item position survives compact projection');eq(item.velocity,rounded(original.velocity),'physical item velocity survives compact projection');
  if(kind==='grenades'){
    eq(item.warning,original.landed&&original.arm<=1e-8,'Bomb warning follows landed arming');
    eq(item.radius,+original.radius.toFixed(3),'dynamite body radius survives compact projection');
    eq(item.landed,original.landed,'real landing state survives compact projection');eq(item.armed,original.armed,'armed state survives compact projection');
    eq(item.ttl,+original.ttl.toFixed(3),'quiet Bomb lifetime survives compact projection');eq(item.fuse,0,'proximity charges have no timed detonation fuse');
  }
  ok(finite(item),'item wire payload is finite');
  return original;
}

async function main(){
  eq(rounded({x:-.0001,y:0,z:2.2906}),{x:0,y:0,z:2.291},'compact expected vector matches JSON signed-zero and millimetre precision');
  const seeds=await pickupSeeds(),scratch=fs.mkdtempSync(path.join(os.tmpdir(),'kart-ten-transport-')),preload=path.join(scratch,'observe.cjs');
  fs.writeFileSync(preload,preloadSource(seeds));let server;const clients=[],metrics={seeds};
  try{
    server=await boot(preload);clients.push(await connect(server));send(clients[0],{t:'create',name:'Transport 0'});await until(()=>clients[0].hello,'actual room create');
    for(let i=1;i<9;i++){const c=await connect(server);clients.push(c);send(c,{t:'join',code:clients[0].hello.code,name:'Transport '+i});await until(()=>c.hello,'actual seat '+i);}
    await start(clients,{map:'Harbor Heights',mode:'Zap Battle',winRule:'Time limit',roundSeconds:60});
    const a=clients[0],target=clients[6],watcher=clients[8],first=a.state;
    eq(first.mapId,'harbor','normal production settings select authored Harbor');eq(first.map.half,86,'full arena dimension survives transport');eq(first.players.length,8);eq(first.spectators.length,1);eq(watcher.state.inputAck,null);eq(watcher.state.youDrive,false);
    ok(first.karts.every(k=>typeof k.firing==='boolean'&&!('sequence'in k)&&!('itemSeq'in k)),'public firing is present without exposing private scheduler state');
    await until(()=>clients.every(c=>c.state.phase==='live'),'countdown→live on the production wall clock',4500);
    const before=a.state.inputAck.receivedSeq;action(watcher,{throttle:1,use:true});action(a,{throttle:1},{i:'old-instance'});await sleep(180);
    eq(a.state.inputAck.receivedSeq,before,'watcher and wrong outer token cannot drive or spend');eq(watcher.state.coins,0,'watcher has no private pickup wallet');
    await collect(a,'seeker');eq(kart(a).weapon,'seeker','new weapon inventory survives Room projection');
    const prefire=await establishSeeker(server,a,target);
    metrics.seekerPrefire={tick:prefire.tick,closest:prefire.closest,target:target.hello.you};
    action(a,{use:true,brake:1});action(a,{use:false,brake:1});
    await until(()=>frames(a).some(f=>f.instanceId===first.instanceId&&f.projectiles.some(p=>p.weapon==='seeker')),'actual Seeker projectile transport');
    const firstShot=frames(a).find(f=>f.instanceId===first.instanceId&&f.projectiles.some(p=>p.weapon==='seeker'));
    const rawShot=await compare(server,a,firstShot,'projectiles');
    eq(rawShot.targetId,target.hello.you,'real moving in-cone rival was acquired without a target injection');
    await until(()=>frames(watcher).some(f=>f.simTick===firstShot.simTick&&f.instanceId===firstShot.instanceId),'watcher sees same Seeker world tick');
    eq(frames(watcher).find(f=>f.simTick===firstShot.simTick&&f.instanceId===firstShot.instanceId).projectiles,firstShot.projectiles,'watcher sees exactly the public guided-shot trajectory');
    for(let n=0;n<5;n++){action(target,{throttle:-1});await sleep(80);}
    const later=frames(a).find(f=>f.instanceId===first.instanceId&&f.simTick>firstShot.simTick&&f.projectiles.some(p=>p.id===firstShot.projectiles[0].id));
    ok(later,'guided missile receives subsequent physical network poses');ok(Math.hypot(...Object.keys(rawShot.position).map(k=>later.projectiles[0].position[k]-firstShot.projectiles[0].position[k]))>.2,'guided projectile moves across real snapshots');
    await compare(server,a,later,'projectiles');
    metrics.seeker={instance:first.instanceId,initialTick:firstShot.simTick,laterTick:later.simTick,target:rawShot.targetId};
    action(target,{brake:1});

    // Drive into authored warehouse cover; actual Rapier contact events must
    // keep their impulse, surface and normal through the normal Room packet.
    let contactFrame;
    for(let n=0;n<75&&!contactFrame;n++){
      action(a,toward(kart(a).pose,{x:-36,z:-35}));await sleep(90);
      contactFrame=frames(a).find(f=>f.instanceId===first.instanceId&&f.events.some(e=>['collision','landing'].includes(e.type)&&e.pid===a.hello.you&&e.surfaceId&&e.impulse>0));
    }
    ok(contactFrame,'normal driving produces a real positive-impulse static contact');
    const contact=contactFrame.events.find(e=>['collision','landing'].includes(e.type)&&e.pid===a.hello.you&&e.surfaceId&&e.impulse>0),ledger=await evidence(server);
    const rawContact=ledger.find(r=>r.instance===first.instanceId).snapshots.find(s=>s.simTick===contactFrame.simTick)?.events.find(e=>e.id===contact.id);
    ok(rawContact,'contact wire event matches actual authority observation');eq(contact.surfaceId,rawContact.surfaceId,'real collider identity survives projection');eq(contact.impulse,rawContact.impulse,'real bounded contact impulse survives projection');eq(contact.position,rounded(rawContact.position),'actual manifold contact position survives projection');eq(contact.normal,rounded(rawContact.normal),'actual manifold normal survives projection');
    metrics.contact={surfaceId:contact.surfaceId,impulse:contact.impulse,type:contact.type};action(a,{brake:1});
    await until(()=>clients.every(c=>c.state.phase==='done'),'full first production 60 s deadline',64000);
    eq(a.state.result.endedAt,first.deadline,'result uses the original honest server deadline');eq(a.state.endsAt,0,'completed match no longer advertises a running timer');
    const total1={...a.state.totals},done1=a.state;await sleep(180);action(a,{use:true});await sleep(150);eq(a.state.totals,total1,'terminal Use/late pumps cannot consume awards twice');

    await start(clients);const second=a.state;
    ok(second.instanceId!==first.instanceId,'host rematch creates a new instance');eq(second.inputAck.receivedSeq,0,'rematch starts neutral sequence');eq(second.totals,total1,'rematch does not replay previous Room awards');eq(second.mapId,'harbor','host rematch retains normal Harbor settings');
    action(a,{throttle:1,use:true},{i:first.instanceId,w:done1.w});await sleep(150);eq(a.state.inputAck.receivedSeq,0,'previous instance Use cannot spend in a fresh round');
    let records=await evidence(server),retired=records.find(r=>r.instance===first.instanceId);eq(retired.disposals,1,'Room rematch consumes one authority disposal');ok(retired.stats.physics.disposed&&retired.stats.physics.karts===0&&retired.stats.physics.statics===0,'retired world releases actual Rapier resources');
    await until(()=>clients.every(c=>c.state.phase==='live'),'second production countdown',4500);await collect(a,'bomb');eq(kart(a).weapon,'bomb','Bomb inventory id survives normal transport');
    action(a,{use:true,brake:1});action(a,{use:false,brake:1});await until(()=>frames(a).some(f=>f.instanceId===second.instanceId&&f.grenades.some(g=>g.weapon==='bomb')),'actual Bomb wire body');
    const bombFrame=frames(a).find(f=>f.instanceId===second.instanceId&&f.grenades.some(g=>g.weapon==='bomb'));await compare(server,a,bombFrame,'grenades');eq(bombFrame.grenades[0].warning,false,'Bomb initially has no premature warning');
    await until(()=>frames(a).some(f=>f.instanceId===second.instanceId&&f.grenades.some(g=>g.weapon==='bomb'&&g.warning)),'real Bomb landed arming warning',3000);
    const warning=frames(a).find(f=>f.instanceId===second.instanceId&&f.grenades.some(g=>g.weapon==='bomb'&&g.warning));await compare(server,a,warning,'grenades');ok(warning.grenades[0].landed&&warning.grenades[0].armed,'public warning requires real landing and completed arming');
    await until(()=>frames(watcher).some(f=>f.instanceId===warning.instanceId&&f.simTick===warning.simTick),'watcher Bomb warning tick');eq(frames(watcher).find(f=>f.instanceId===warning.instanceId&&f.simTick===warning.simTick).grenades,warning.grenades,'watcher receives identical public Bomb warning/body');
    await until(()=>a.state.grenades.length===0,'unused Bomb quietly reaches its bounded lifetime',13000);
    eq(new Set(frames(a).flatMap(f=>f.instanceId===second.instanceId?f.events.filter(e=>e.type==='blast'&&e.weapon==='bomb').map(e=>e.id):[])).size,0,'unused proximity charge never fabricates a timed blast');
    metrics.bomb={instance:second.instanceId,initialTick:bombFrame.simTick,armedTick:warning.simTick,armedTtl:warning.grenades[0].ttl,expiredQuietly:true};
    await until(()=>clients.every(c=>c.state.phase==='done'),'full second production 60 s deadline',64000);eq(a.state.result.endedAt,second.deadline,'second result remains clock anchored');const total2={...a.state.totals};await sleep(150);eq(a.state.totals,total2,'second terminal result consumes awards once');
    await start(clients);eq(a.state.totals,total2,'second rematch cannot replay totals');send(a,{t:'lobby'});
    await until(async()=>{const r=await evidence(server);return r.length===3&&r.every(v=>v.disposals===1);},'explicit lobby retires third authority exactly once');
    records=await evidence(server);ok(records.every(r=>r.stats.physics.disposed&&r.stats.physics.karts===0&&r.stats.physics.statics===0),'all rematched/lobby worlds release all physical resources');
    ok(!/game tick error|game view error|handle error|elevated arena retired|game dispose error/.test(server.output()),'actual production path has no unexpected lifecycle exceptions');
    metrics.disposals=records.map(r=>({instance:r.instance,disposals:r.disposals}));metrics.scope='Actual Node production server/Room/WebSocket on localhost; two complete normal 60-second rounds and real wall clocks. Deterministic RNG/observation only, no grants/teleports/hits/score injection; no native or WAN performance claim.';
    console.log(JSON.stringify({pass:true,checks,node:process.version,metrics},null,2));
  }finally{
    for(const c of clients)c.ws.terminate();if(server){server.child.kill();if(server.child.exitCode===null)await once(server.child,'exit');}fs.rmSync(scratch,{recursive:true,force:true});
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});

'use strict';
// Acceptance workload against an explicitly supplied local production server.
// Bot peers submit legal intent only; no clock/state/inventory/pose overrides.
const assert = require('node:assert/strict');
const { once } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const WebSocket = require('ws');
const port = Number(process.env.KART_ACCEPTANCE_UPSTREAM || 8447);
const directory = process.env.KART_ACCEPTANCE_EVIDENCE || '/tmp/giggle-kart-acceptance-20261009';
const maps = ['Rookie Ring','Bumper Blocks','Garden Circuit','Frosty Pass','Neon Yard','Alpine Courtyard','Frost Quarry','Neon Harbor','Harbor Heights'];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const finite = data => typeof data === 'number' ? Number.isFinite(data) : data && typeof data === 'object' ? Object.values(data).every(finite) : true;
async function until(fn, label, ms = 5000) { const end = Date.now() + ms; while (!fn()) { if (Date.now() > end) throw Error(label); await sleep(15); } }
const send = (c,msg) => c.ws.send(JSON.stringify(msg));
const position = k => k.pose?.position || { x:k.x,y:0,z:k.z };
const facing = k => { const q=k.pose?.rotation; return q ? Math.atan2(2*(q.x*q.z+q.w*q.y),1-2*(q.x*q.x+q.y*q.y)) : k.angle; };
const wrapped = angle => Math.atan2(Math.sin(angle),Math.cos(angle));
const sockets = [];
async function connect() {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`), c = { ws,seq:0,received:0,errors:[],frames:[] };
  sockets.push(c);
  ws.on('message', raw => {
    const m=JSON.parse(raw); if(m.t==='hello')c.hello=m; if(m.t==='room')c.room=m.room;
    if(m.t==='error')c.errors.push(m.msg);
    if(m.t==='state'){
      assert.ok(finite(m),'non-finite production wire packet');
      assert.ok(Array.isArray(m.karts)&&m.karts.length,'missing production kart snapshot');
      for(const k of m.karts){const p=position(k);assert.ok([p.x,p.y,p.z,k.pose?.speed??k.speed].every(n=>typeof n==='number'&&Number.isFinite(n)),'missing/null/non-finite production motion');}
      c.state=m;c.received++;if(c.frames.length<3)c.frames.push(m);c.observe?.(m);
    }
  });
  await once(ws,'open'); return c;
}
async function room(label) {
  const clients=[await connect()]; send(clients[0],{t:'create',name:'Kart workload 0'});
  await until(()=>clients[0].hello,'room create');
  for(let i=1;i<8;i++){const c=await connect();clients.push(c);send(c,{t:'join',code:clients[0].hello.code,name:'Kart workload '+i});await until(()=>c.hello,'seat join');}
  const metrics={map:label,packets:0,bytes:0,maxPacketBytes:0,events:{},collisions:{},maxHeight:0,maxSpeed:0,maxRadius:0,aliveSamples:0,deadSamples:0,nitroSamples:0,spawnChanges:0,phaseSequence:[],firstAt:null,lastAt:null};
  const events=new Set(),lives=new Map(),receipt=[];
  clients[0].observe=s=>{
    const now=Date.now();metrics.firstAt??=now;metrics.lastAt=now;receipt.push(now);metrics.packets++;const bytes=Buffer.byteLength(JSON.stringify(s));metrics.bytes+=bytes;metrics.maxPacketBytes=Math.max(metrics.maxPacketBytes,bytes);
    if(metrics.phaseSequence.at(-1)!==s.phase)metrics.phaseSequence.push(s.phase);
    for(const k of s.karts){const p=position(k);metrics.maxHeight=Math.max(metrics.maxHeight,p.y);metrics.maxRadius=Math.max(metrics.maxRadius,Math.max(Math.abs(p.x),Math.abs(p.z)));metrics.maxSpeed=Math.max(metrics.maxSpeed,Math.abs(k.pose?.speed??k.speed));(k.alive??!(k.respawn>0))?metrics.aliveSamples++:metrics.deadSamples++;if(k.nitroActive)metrics.nitroSamples++;if(lives.has(k.id||k.pid)&&lives.get(k.id||k.pid)!==k.spawnSeq)metrics.spawnChanges++;lives.set(k.id||k.pid,k.spawnSeq);}
    for(const e of s.events||[]){const id=e.id??`${e.t}:${e.type}:${e.pid}:${e.other}`;if(events.has(id))continue;events.add(id);metrics.events[e.type]=(metrics.events[e.type]||0)+1;if(e.type==='collision'){const key=e.surfaceId||(e.other?'kart':'classic-solid');metrics.collisions[key]=(metrics.collisions[key]||0)+1;}}
  };
  send(clients[0],{t:'start',game:'pocket-karts',settings:{map:label,mode:'Zap Battle',winRule:'Time limit',roundSeconds:60,lightCycle:'Fixed light'}});
  await until(()=>clients.every(c=>c.state),'all workload seats started');
  const started=Date.now();
  let pulse=0;
  const timer=setInterval(()=>{
    pulse++;
    for(let i=0;i<clients.length;i++){
      const c=clients[i],s=c.state,k=s?.karts.find(k=>(k.id||k.pid)===c.hello.you);
      if(!k||!['live','drive'].includes(s.phase)||c.ws.readyState!==1)continue;
      const here=position(k),crates=(s.crates||[]).filter(x=>x.available!==false&&!(x.respawn>0));
      const others=s.karts.filter(x=>(x.id||x.pid)!==c.hello.you&&(x.alive??!(x.respawn>0)));
      const choices=k.weapon?others:crates;
      const target=choices.reduce((best,x)=>{const p=x.pose?position(x):x.position||x;return !best||Math.hypot(p.x-here.x,p.z-here.z)<best.distance?{p,distance:Math.hypot(p.x-here.x,p.z-here.z)}:best;},null);
      const direction=target?Math.atan2(target.p.x-here.x,target.p.z-here.z):facing(k)+Math.sin((Date.now()-started)/3500+i)*.7;
      const delta=wrapped(direction-facing(k)),steer=Math.max(-1,Math.min(1,-delta*2));
      const controls={steer,throttle:target?.distance<3&&k.weapon?0:1,nitro:Math.abs(delta)<.15&&k.nitro>.2};
      let a;
      if(s.inputAck){c.seq=Math.max(c.seq,s.inputAck.receivedSeq)+1;a={type:'input',seq:c.seq,life:s.inputAck.life,controlEpoch:s.inputAck.controlEpoch,...controls,brake:0,use:!!k.weapon&&pulse%2===0};}
      else a={input:{...controls,boost:!!k.weapon&&pulse%2===0,drift:false}};
      send(c,{t:'action',i:s.instanceId,w:s.w,a});
    }
  },200);
  try{
    await until(()=>clients.every(c=>c.state.phase==='done'),'actual timed round did not finish: '+label,40000);
    assert.ok(clients.every(c=>!c.errors.length),'production error during '+label);
    assert.ok(metrics.phaseSequence.includes(clients[0].state.profile?'live':'drive'),'never became actionable: '+label);
    assert.ok(metrics.maxSpeed>2,'legal controls never produced motion: '+label);
    const gaps=receipt.slice(1).map((n,i)=>n-receipt[i]).sort((a,b)=>a-b);metrics.packetGapMs={p50:gaps[Math.floor(gaps.length*.5)],p95:gaps[Math.floor(gaps.length*.95)],max:gaps.at(-1)};
    metrics.durationMs=Date.now()-started;metrics.profile=clients[0].state.profile||'classic';metrics.result=clients[0].state.result||null;metrics.totals=clients[0].state.totals;
    return metrics;
  }finally{clearInterval(timer);const host=clients.find(c=>c.hello.you===c.room?.hostId)||clients[0];if(host.ws.readyState===1)send(host,{t:'lobby'});for(const c of clients)if(c.ws.readyState===1)send(c,{t:'leave'});}
}
(async()=>{
  try{
    const results=await Promise.all(maps.map(room));
    const report={pass:true,scope:'Actual local production server and 72 WebSocket bot seats across all nine maps; legal intent only, wall-clock deadlines. No renderer, physical keyboard/phone or audio-listening claim.',node:process.version,results};
    fs.mkdirSync(directory,{recursive:true});fs.writeFileSync(path.join(directory,'all-map-production-workload.json'),JSON.stringify(report,null,2));
    console.log(JSON.stringify(report,null,2));
  }catch(error){console.error(error);process.exitCode=1;}finally{for(const c of sockets)c.ws.close();}
})();

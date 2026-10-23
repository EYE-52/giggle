'use strict';
// Actual Room/production facade/real Rapier, eight drivers and sixteen watcher
// socket sinks. Controlled 50ms server clock; measures CPU/JSON, not network RTT.
const assert=require('node:assert/strict'),fs=require('node:fs');
const {Room}=require('../server/room');
const {loadElevatedDependencies}=require('../games/engines/kart-elevated-adapter');
const {createElevatedCombat}=require('../games/engines/kart-elevated-combat');
const percentile=(values,p)=>values.slice().sort((a,b)=>a-b)[Math.min(values.length-1,Math.floor(values.length*p))];
async function run(base,legacy,workload){
  delete require.cache[require.resolve('../games/pocket-karts/server')];
  const def=require('../games/pocket-karts/server');let fullReads=0,compactReads=0,match;
  const ordinaryTransport=process.env.KART_STATUS_BUDGET_ORDINARY_VIEW==='1';
  if(ordinaryTransport)delete def.viewForTransport;
  await def.initialize(()=>({...base,createMatch(R,C,M,seats,opts){match=createElevatedCombat(R,C,M,seats,{...opts,seed:42});return {...match,
    snapshot(id){fullReads++;return match.snapshot(id);},
    privateStatus:legacy?undefined:id=>{compactReads++;return match.privateStatus(id);},
  };}}));
  const realNow=Date.now,realClone=global.structuredClone;let now=1000000,viewClones=0;Date.now=()=>now;
  global.structuredClone=(value,...args)=>{if(value?.karts&&value.inputAck!==undefined)viewClones++;return realClone(value,...args);};
  const room=new Room('BUDG',{}),clients=[];
  try{
    for(let i=0;i<24;i++){const socket={readyState:1,bufferedAmount:0,kartEventDeltas:process.env.KART_EVENT_DELTAS==='1',bytes:0,count:0,last:null,send(text){this.bytes+=Buffer.byteLength(text);this.count++;this.last=text;},close(){}};clients.push({socket,p:room.addPlayer('Seat '+i,socket).player});}
    assert(room.startGame(def,{ready:true,settings:{map:'Harbor Heights',mode:'Zap Battle',winRule:'Time limit',roundSeconds:60}},room.hostId).ok);
    for(const c of clients.slice(0,8)){const s=JSON.parse(c.socket.last);room.onReady(c.socket,{i:s.instanceId,w:s.w});}
    assert(!room.game.preparing);
    const samples=[],fields={};let frames=0;
    const initialFull=fullReads,initialCompact=compactReads,initialViewClones=viewClones,cpuStart=process.cpuUsage();
    for(let n=0;n<700&&room.game.state.phase!=='done';n++){
      if(n%2===0)for(let i=0;i<8;i++){
        const c=clients[i],own=match.privateStatus(c.p.id);
        room.onAction(c.socket,{type:'input',seq:own.receivedSeq+1,life:own.life,controlEpoch:own.controlEpoch,steer:workload==='neutral'?0:(i%2?.3:-.3),throttle:workload==='neutral'?0:1,brake:0,nitro:workload==='nitro',use:workload==='nitro'&&n%20===0},{i:room.game.instanceId,w:room._actionToken()});
      }
      now+=50;const start=performance.now();room.onTick(now);samples.push(performance.now()-start);
      if(room.game.preparing)for(const c of clients.slice(0,8)){const s=JSON.parse(c.socket.last);room.onReady(c.socket,{i:s.instanceId,w:s.w});}
      // Field accounting follows the measured pump, never enters tick timing.
      const state=JSON.parse(clients[0].socket.last);
      for(const [key,value]of Object.entries(state))fields[key]=(fields[key]||0)+Buffer.byteLength(JSON.stringify({[key]:value}))-2;
      frames++;
      for(const c of clients.slice(8)){const s=JSON.parse(c.socket.last);assert.equal(s.inputAck,null);assert.equal(s.coins,0);}
    }
    const cpu=process.cpuUsage(cpuStart),transportViewClones=viewClones-initialViewClones;
    if(ordinaryTransport)assert(transportViewClones>=frames*24,'ordinary wire path clones every recipient view');
    else assert.equal(transportViewClones,0,'immutable transport path clones no recipient views');
    assert.equal(room.game.state.phase,'done');
    if(!legacy){assert.equal(fullReads-initialFull,0,'no full snapshots for eight private ACKs per pump');assert.equal(compactReads-initialCompact,frames*8);}
    else assert.equal(fullReads-initialFull,frames*8);
    const own=match.privateStatus(clients[0].p.id),copy=match.snapshot(clients[0].p.id).you;assert.deepEqual(own,copy);own.coins=-9;assert.notEqual(match.privateStatus(clients[0].p.id).coins,-9);assert.equal(match.privateStatus('watcher'),null);
    const view=def.view(room.game.state,clients[0].p.id),other=def.view(room.game.state,clients[1].p.id);view.inputAck.life=-4;view.karts[0].pose.position.x=999;assert.notEqual(def.view(room.game.state,clients[0].p.id).inputAck.life,-4);assert.notEqual(def.view(room.game.state,clients[1].p.id).karts[0].pose.position.x,999);assert.deepEqual(def.view(room.game.state,clients[1].p.id),other);
    return{workload,ordinaryTransport,transportViewClones,legacyFullPrivateSnapshots:legacy,frames,tickMs:{median:percentile(samples,.5),p95:percentile(samples,.95),max:Math.max(...samples)},loopCpuMs:(cpu.user+cpu.system)/1000,fullPrivateReads:fullReads-initialFull,compactPrivateReads:compactReads-initialCompact,meanFieldBytes:Object.fromEntries(Object.entries(fields).map(([k,v])=>[k,+(v/frames).toFixed(2)])),totalSinkJsonBytes:clients.reduce((n,c)=>n+c.socket.bytes,0)};
  }finally{room.destroy();Date.now=realNow;global.structuredClone=realClone;}
}
(async()=>{const base=await loadElevatedDependencies(),results=[];
for(const workload of ['neutral','drive','nitro']){for(const legacy of (process.env.KART_STATUS_BUDGET_REVERSE? [false,true]:[true,false]))results.push(await run(base,legacy,workload));}
for(let n=0;n<results.length;n+=2){assert.equal(results[n].totalSinkJsonBytes,results[n+1].totalSinkJsonBytes,'compact ACK path preserves whole24-seat JSON byte budget');assert.deepEqual(results[n].meanFieldBytes,results[n+1].meanFieldBytes,'every mean wire field byte budget is preserved');}
const report={pass:true,node:process.version,rapier:base.RAPIER.version(),eventDeltas:process.env.KART_EVENT_DELTAS==='1',scope:'Actual24-seat Room/facade, real authored Harbor Heights Rapier world; eight legal drivers/sixteen watcher socket sinks, deterministic seed42, controlled50ms clock,30second matches. Tick timing includes simulation/projection/selected transport views/JSON serialization. Loop CPU additionally includes intent preparation and field/privacy accounting. No live socket compression/network/browser latency verdict.',results};
if(process.env.KART_STATUS_BUDGET_REPORT)fs.writeFileSync(process.env.KART_STATUS_BUDGET_REPORT,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
})().catch(e=>{console.error(e);process.exitCode=1});

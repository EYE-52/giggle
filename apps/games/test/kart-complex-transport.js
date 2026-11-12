'use strict';
// Shipping server and 32 real localhost WebSockets. Separate from the
// numeric oracle: verifies selection, driver capacity and live movement.
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {once}=require('node:events');
const net=require('node:net'),os=require('node:os'),path=require('node:path'),fs=require('node:fs');
const WebSocket=require('ws');
const root=path.resolve(__dirname,'..'),scratch=fs.mkdtempSync(path.join(os.tmpdir(),'kart-complex-'));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,label,ms=10000){const end=Date.now()+ms;while(Date.now()<end){if(fn())return;await sleep(15);}throw Error(label);}
let server;const clients=[];
const send=(c,m)=>c.ws.send(JSON.stringify(m));
(async()=>{
  const probe=net.createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');const port=probe.address().port;await new Promise(r=>probe.close(r));
  let logs='';server=spawn(process.execPath,['server/server.js'],{cwd:root,env:{...process.env,HOST:'127.0.0.1',PORT:String(port),NODE_ENV:'test',GAME_REPORT_DB:path.join(scratch,'reports.sqlite')},stdio:['ignore','pipe','pipe']});
  server.stdout.on('data',v=>logs+=v);server.stderr.on('data',v=>logs+=v);await until(()=>logs.includes('PartyBox on'),'server starts');
  for(let i=0;i<32;i++){
    const c={ws:new WebSocket('ws://127.0.0.1:'+port),hello:null,state:null,count:0,bytes:0};clients.push(c);
    c.ws.on('message',raw=>{const m=JSON.parse(String(raw));if(m.t==='error')c.lastError=m.msg;if(m.t==='hello')c.hello=m;if(m.t==='state'){c.state=m;c.count++;c.bytes=raw.length;}});await once(c.ws,'open');
    send(c,i?{t:'join',code:clients[0].hello.code,name:'Map '+i}:{t:'create',name:'Map 0'});await until(()=>c.hello,'seat '+i+' joins');
  }
  const host=clients[0];
  for(const [label,id] of Object.entries(require('../games/engines/kart-elevated-adapter').MAP_LABELS)){
    const old=host.state?.instanceId;host.lastError=null;send(host,{t:'start',game:'pocket-karts',settings:{map:label,mode:'Zap Battle',roundSeconds:60}});
    await until(()=>clients.every(c=>c.state?.instanceId&&c.state.instanceId!==old),'all clients receive '+label);
    const complex=id==='skyport'||id==='foundry'||['skyport-split','harbor-fork','foundry-wheel'].includes(id),drivers=32;
    for(const [index,c] of clients.entries()){assert.equal(c.state.profile,'elevated-combat-v1');assert.equal(c.state.map.label,label);assert.equal(c.state.mapId,id);assert.equal(c.state.karts.length,drivers);assert.equal(c.state.youDrive,index<drivers);assert.equal(c.state.spectators.length,32-drivers);assert(c.bytes<40000);}
    await until(()=>host.state.phase==='live',label+' live countdown');const self=s=>s.karts.find(k=>k.id===s.you),origin=self(host.state).pose.position,firstCount=host.count;
    for(let i=0;i<12;i++){const s=host.state;send(host,{t:'action',i:s.instanceId,w:s.w,a:{type:'input',seq:s.inputAck.receivedSeq+1,life:s.inputAck.life,controlEpoch:s.inputAck.controlEpoch,throttle:1,steer:0,brake:0,nitro:false,use:false}});await sleep(50);}
    const moved=self(host.state).pose.position;assert(Math.hypot(moved.x-origin.x,moved.z-origin.z)>.5,label+' real input moves kart');assert(host.count-firstCount>=8,label+' live snapshots continue with 32 clients');
    assert.equal(new Set(host.state.crates.map(c=>Math.round(c.position.y-.6))).size,complex?3:2,label+' actual network crates span all floors');
    console.log(label+' production WebSocket PASS: '+drivers+' drivers, '+host.bytes+' byte frame, '+(host.count-firstCount)+' live frames in ~600 ms');
  }
  assert(!/game tick error|game view error|elevated arena retired/.test(logs));
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{
  for(const c of clients)c.ws.terminate();if(server&&server.exitCode===null){server.kill('SIGTERM');await Promise.race([once(server,'exit'),sleep(3000)]);}fs.rmSync(scratch,{recursive:true,force:true});
});

'use strict';
const assert=require('node:assert/strict');
const {Room}=require('../server/room');
const def=require('../games/pocket-karts/server');
const {clientSchema}=require('../games/_validate');
const latest=ws=>ws.frames.filter(f=>f.t==='state').at(-1);
function room(count){
  const r=new Room('MAPS',{}),clients=[];
  for(let i=0;i<count;i++){
    const ws={readyState:1,bufferedAmount:0,frames:[],send(value){this.frames.push(JSON.parse(value));},close(){this.readyState=3;}};
    clients.push({ws,p:r.addPlayer('Driver '+i,ws).player});
  }return {r,clients};
}
(async()=>{
  await def.initialize();const originalNow=Date.now;let now=1000000;Date.now=()=>now;
  try{
    for(const [map,id] of Object.entries(require('../games/engines/kart-elevated-adapter').MAP_LABELS))for(const count of [2,8,32]){
      const {r,clients}=room(count);try{
        assert.deepEqual(r.startGame(def,{settings:{map,mode:'Zap Battle',roundSeconds:60}},r.hostId),{ok:true});
        let s=latest(clients[0].ws);assert.equal(s.profile,'elevated-combat-v1');assert.equal(s.map.label,map);assert.equal(s.mapId,id);assert.equal(s.karts.length,Math.min(count,id==='skyport'||id==='foundry'?32:8));assert(s.youDrive);assert.equal(s.map.half,id==='skyport'||id==='foundry'?122:id==='harbor'?86:60);
        const start=s.karts[0].pose.position;
        now=s.liveAt;r.onTick(now);s=latest(clients[0].ws);
        r.onAction(clients[0].ws,{type:'input',seq:1,life:s.inputAck.life,controlEpoch:s.inputAck.controlEpoch,steer:0,throttle:1,brake:0,nitro:false,use:false},{i:s.instanceId,w:s.w});
        for(let t=0;t<4;t++){now+=50;r.onTick(now);}
        s=latest(clients[0].ws);assert(s.inputAck.receivedSeq===1);assert(Math.hypot(s.karts[0].pose.position.x-start.x,s.karts[0].pose.position.z-start.z)>.02);
        // Every room member receives the same map, including seat 32.
        assert.equal(latest(clients.at(-1).ws).profile,'elevated-combat-v1');assert.equal(latest(clients.at(-1).ws).youDrive,count<=8||id==='skyport'||id==='foundry');
        console.log(map+' '+count+' real Room seats PASS; frame bytes='+Buffer.byteLength(JSON.stringify(s)));
      }finally{r.destroy();}
    }
    // Practice creates ordinary rooms with two seats. This regression also
    // covers an elevated manifest default with no host-supplied map value.
    const setting=def.manifest.settings.find(s=>s.key==='map'),saved=setting.def;
    try{for(const map of Object.keys(require('../games/engines/kart-elevated-adapter').MAP_LABELS)){
      setting.def=map;assert.equal(clientSchema(def).settings.find(s=>s.key==='map').def,map);
      const {r,clients}=room(2);try{assert.deepEqual(r.startGame(def,{settings:{}},r.hostId),{ok:true});const s=latest(clients[0].ws);assert.equal(s.profile,'elevated-combat-v1');assert.equal(s.map.label,map);assert.notEqual(s.map.label,'Garden Circuit');}finally{r.destroy();}
    }}finally{setting.def=saved;}
    console.log('Complex Room routing, 2/8/32 seats and elevated-default practice regression PASS');
  }finally{Date.now=originalNow;}
})().catch(e=>{console.error(e);process.exitCode=1;});

import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import {decodeFrame} from '../public/js/toolkit/realtime/client.mjs';
const require=createRequire(import.meta.url),{Room}=require('../server/room'),def=require('../games/pocket-karts/server');
await def.initialize();const realNow=Date.now;let now=1000000;Date.now=()=>now;const reports=[];
try{for(const [label,players]of[['Rookie Ribbons',8],['Skyport Split',8],['Skyport Split',16],['Skyport Split',32]]){
 const room=new Room('AREN',{}),clients=[];
 try{
  for(let i=0;i<players;i++){const ws={readyState:1,bufferedAmount:0,realtime:i===1?undefined:'rt1',frames:[],send(v){this.frames.push(v);},close(){}},player=room.addPlayer('Driver '+i,ws).player,pid=player.id;clients.push({ws,pid,player,decoder:decodeFrame(),state:null,bytes:0});}
  assert.deepEqual(room.startGame(def,{settings:{map:label,mode:'Zap Battle',roundSeconds:60}},room.hostId),{ok:true});
  let old=[],binaryBytes=0,jsonBytes=0,comparisons=0;const steps=[];
  for(let tick=0;tick<400;tick++){
   for(const c of clients){for(const raw of c.ws.frames){if(typeof raw==='string'){const s=JSON.parse(raw);if(s.t==='state'){c.state=s;if(c===clients[1]&&tick>80)jsonBytes+=Buffer.byteLength(raw);}}else{c.state=c.decoder.apply(raw);assert(c.state,'every frame decodes');if(c===clients[0]&&tick>80)binaryBytes+=raw.byteLength;}}c.ws.frames=[];}
   const a=clients[0].state,b=clients[1].state;if(a&&b&&a.serverNow===b.serverNow){assert.equal(a.variantId,b.variantId);assert.deepEqual(a.crates,b.crates);assert.deepEqual(a.enabledDistricts,b.enabledDistricts);for(const k of a.karts){const other=b.karts.find(o=>o.id===k.id);assert(Math.hypot(k.pose.position.x-other.pose.position.x,k.pose.position.y-other.pose.position.y,k.pose.position.z-other.pose.position.z)<.002);assert.equal(k.rtAge,0,'every pose at 20 Hz');assert.equal(k.health,other.health);assert.equal(k.pose.epoch,other.pose.epoch);}comparisons++;}
   // Ordinary motion and payload edges; every client keeps its own ACK/life.
   for(const c of clients)if(c.state?.phase==='live'&&c.state.youDrive){const s=c.state;room.onAction(c.ws,{type:'input',seq:s.inputAck.receivedSeq+1,life:s.inputAck.life,controlEpoch:s.inputAck.controlEpoch,throttle:tick<110?.2:0,steer:0,brake:tick>=110?1:0,nitro:false,use:tick%4===0},{i:s.instanceId,w:s.w});}
   if(tick===160){old=a.crates.map(c=>c.homeId);room.disconnect(clients.at(-1).ws);}
   if(tick===161){const c=clients.at(-1);room.addPlayer(c.player.name,c.ws,c.player.token);}
   const start=performance.now();now+=50;room.onTick(now);steps.push(performance.now()-start);
  }
  assert(comparisons>300);assert.deepEqual(clients[0].state.crates.map(c=>c.homeId),old,'reconnect preserves fixed homes');
  const elapsed=(400-81)*.05,sorted=steps.sort((a,b)=>a-b),report={label,players,variant:clients[0].state.variantId,comparisons,binaryKiBs:binaryBytes/elapsed/1024,jsonKiBs:jsonBytes/elapsed/1024,updateP95:sorted[Math.floor(sorted.length*.95)],updateP99:sorted[Math.floor(sorted.length*.99)]};
  assert(report.binaryKiBs<100,'launch transport under 100KiB/s per seat');assert(binaryBytes<jsonBytes*.5);reports.push(report);console.log('PASS launch transport',JSON.stringify(report));
 }finally{room.destroy();}
}}finally{Date.now=realNow;}
fs.writeFileSync(new URL('../../../artifacts/kart-arenas/launch-transport.json',import.meta.url),JSON.stringify({reports,scope:'Mixed real Room binary/JSON clients, 20s, motion, ACKs, reconnect and fixed homes; not a 5-minute active-combat bandwidth claim.'},null,2));

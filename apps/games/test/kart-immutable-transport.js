'use strict';
// Real elevated authority with controlled clock. Exact wire/isolation checks,
// not browser, physical-device, WAN-latency or perceived smoothness acceptance.
const assert=require('node:assert/strict');
const {Room}=require('../server/room');
const {loadElevatedDependencies}=require('../games/engines/kart-elevated-adapter');
const {createElevatedCombat}=require('../games/engines/kart-elevated-combat');
let checks=0;
const eq=(a,b,label)=>{assert.deepEqual(a,b,label);checks++;};
const ok=(v,label)=>{assert.ok(v,label);checks++;};
const settings=map=>({map,mode:'Zap Battle',winRule:'Time limit',roundSeconds:60});
const sink=()=>({readyState:1,bufferedAmount:0,raw:[],send(text){this.raw.push(text);},close(){}});
function makeRoom(def,map,count=24){
  const room=new Room('FRZN',{}),clients=[];
  for(let i=0;i<count;i++){const socket=sink();clients.push({socket,p:room.addPlayer('Seat '+i,socket).player});}
  eq(room.startGame(def,{ready:true,settings:settings(map)},room.hostId),{ok:true},'start actual authority');
  return{room,clients};
}
function acknowledge(room,clients){for(const c of clients.slice(0,8)){const s=JSON.parse(c.socket.raw.at(-1));room.onReady(c.socket,{i:s.instanceId,w:s.w});}}
function frozenTree(value){
  if(!value||typeof value!=='object')return;
  ok(Object.isFrozen(value),'every shared public object is frozen');
  for(const child of Object.values(value))frozenTree(child);
}
function equivalence(def,room,clients,phase){
  eq(room.game.state.phase,phase,'expected phase');
  for(const {p}of clients){
    const ordinary=def.view(room.game.state,p.id),wire=def.viewForTransport(room.game.state,p.id);
    eq(wire,ordinary,'transport and ordinary values are exact for every role');
    eq(JSON.stringify(wire),JSON.stringify(ordinary),'view serialization bytes and order are exact');
    if(wire.youDrive){
      ok(wire.inputAck,'driver keeps ACK');
      const original=wire.inputAck.life;wire.inputAck.life=-100;
      eq(def.viewForTransport(room.game.state,p.id).inputAck.life,original,'fresh private ACK per call');
    }else{eq(wire.inputAck,null,'watcher has no ACK');eq(wire.coins,0,'watcher has no coins');}
  }
  const one=def.viewForTransport(room.game.state,clients[0].p.id),two=def.viewForTransport(room.game.state,clients[1].p.id);
  eq(one.karts===two.karts,true,'all recipients share immutable public kart tree');
  for(const[key,value]of Object.entries(one))if(key!=='inputAck')frozenTree(value);
  assert.throws(()=>{one.karts[0].pose.position.x=999;},TypeError);checks++;
  assert.throws(()=>{one.events.push({id:'injected'});},TypeError);checks++;
  const mutable=def.view(room.game.state,clients[0].p.id),original=one.karts[0].pose.position.x;
  mutable.karts[0].pose.position.x=999;mutable.karts[0].pose.wheels[0].length=999;mutable.events.push({id:'injected'});
  eq(def.viewForTransport(room.game.state,clients[0].p.id).karts[0].pose.position.x,original,'ordinary mutable view cannot alter transport');
  eq(def.view(room.game.state,clients[0].p.id).events.some(e=>e.id==='injected'),false,'ordinary event mutation cannot leak');
  room.broadcastState();const optimized=clients.map(c=>c.socket.raw.at(-1)),hook=def.viewForTransport;
  try{def.viewForTransport=undefined;room.broadcastState();}finally{def.viewForTransport=hook;}
  for(let i=0;i<clients.length;i++){
    const fallback=clients[i].socket.raw.at(-1);eq(optimized[i],fallback,'full Room serialized bytes equal ordinary path');
    eq(JSON.parse(optimized[i]),JSON.parse(fallback),'full Room parsed wire equals ordinary path');
  }
}
function receivers(){
  const room=new Room('RCVR',{}),socket=sink(),p=room.addPlayer('Receiver',socket).player;
  const def={id:'receiver-test',marker:'method receiver',view(state,id){eq(this,def,'fallback method receiver preserved');return{phase:state.phase,id,marker:this.marker};},
    viewForTransport(state,id){eq(this,def,'transport method receiver preserved');return this.view(state,id);}};
  room.game={def,state:{phase:'live'},roster:[p.id],instanceId:'receiver',clockOffset:0};
  try{room.broadcastState();eq(JSON.parse(socket.raw.at(-1)).marker,'method receiver','transport hook invoked');delete def.viewForTransport;room.broadcastState();eq(JSON.parse(socket.raw.at(-1)).marker,'method receiver','fallback invoked');}
  finally{room.game=null;room.destroy();}
}
(async()=>{
  receivers();const base=await loadElevatedDependencies();
  delete require.cache[require.resolve('../games/pocket-karts/server')];const def=require('../games/pocket-karts/server');let failNext=false;
  await def.initialize(()=>({...base,createMatch(R,C,M,seats,options){const match=createElevatedCombat(R,C,M,seats,{...options,seed:42});return{...match,advance(now){if(failNext){failNext=false;throw Error('diagnostic retirement');}return match.advance(now);}};}}));
  const nativeNow=Date.now;let now=1000000;Date.now=()=>now;const rooms=[];
  try{
    const {room,clients}=makeRoom(def,'Harbor Heights');rooms.push(room);
    ok(room.game.preparing,'initial readiness is frozen');equivalence(def,room,clients,'countdown');
    acknowledge(room,clients);
    ok(!room.game.preparing,'active quorum releases preparation');equivalence(def,room,clients,'countdown');
    for(let i=0;i<70&&room.game.state.phase!=='live';i++){now+=50;room.onTick(now);}
    equivalence(def,room,clients,'live');
    acknowledge(room,clients);
    for(let i=0;i<1220&&room.game.state.phase!=='done';i++){
      if(i%2===0)for(const c of clients.slice(0,8)){
        const s=JSON.parse(c.socket.raw.at(-1)),ack=s.inputAck;
        room.onAction(c.socket,{type:'input',seq:ack.receivedSeq+1,life:ack.life,controlEpoch:ack.controlEpoch,steer:.3,throttle:1,brake:0,nitro:true,use:i%20===0},{i:s.instanceId,w:s.w});
      }
      now+=50;room.onTick(now);
    }
    equivalence(def,room,clients,'done');ok(def.viewForTransport(room.game.state,clients[0].p.id).events.length>0,'real retained events covered');
    const retired=makeRoom(def,'Alpine Courtyard');rooms.push(retired.room);const stderr=console.error;
    try{console.error=()=>{};acknowledge(retired.room,retired.clients);failNext=true;now+=50;retired.room.onTick(now);}finally{console.error=stderr;}
    equivalence(def,retired.room,retired.clients,'done');eq(def.viewForTransport(retired.room.game.state,retired.clients[0].p.id).result.endReason,'simulation-failure','retirement projection is covered');
    const classic=makeRoom(def,'Garden Circuit',2);rooms.push(classic.room);
    for(const c of classic.clients)eq(def.viewForTransport(classic.room.game.state,c.p.id),def.view(classic.room.game.state,c.p.id),'classic transport uses unchanged ordinary path');
  }finally{for(const room of rooms)room.destroy();Date.now=nativeNow;}
  console.log(JSON.stringify({pass:true,checks,node:process.version,scope:'Actual Rapier and Room, controlled clock; all24 roles in preparation/countdown/live/timeout and simulation retirement; exact serialized and parsed wire, fresh private ACKs, immutable public tree, ordinary mutable isolation, method receivers and classic fallback. No native/browser/WAN verdict.'},null,2));
})().catch(error=>{console.error(error);process.exitCode=1;});

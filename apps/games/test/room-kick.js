'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const WebSocket = require('ws');
const { Room, SEAT_REMOVED_CODE } = require('../server/room');
const registry = require('../games/registry');
const { manifestPlayers } = require('../games/_validate');
const { mintTicket } = require('../server/bridge');
const ROOT = path.resolve(__dirname, '..');
let checks = 0;
const eq = (a,b,m) => { assert.deepEqual(a,b,m); checks++; };
const ok = (a,m) => { assert(a,m); checks++; };
const socket = () => ({ readyState:1, messages:[], send(s){this.messages.push(JSON.parse(s));}, close(code,reason){this.closed={code,reason};this.readyState=3;} });
const pause = ms => new Promise(r=>setTimeout(r,ms));
async function until(check, label) { for(let i=0;i<300;i++){if(check())return;await pause(10);}throw Error('Timed out: '+label); }

async function unit() {
  await registry.get('pocket-karts').initialize();
  for (const entry of registry.list()) {
    const def = registry.get(entry.id), {min,max} = manifestPlayers(def);
    const contentPath=path.join(ROOT,'locales/en',entry.id+'.json');
    const room = new Room('KICK', { [entry.id]:fs.existsSync(contentPath)?JSON.parse(fs.readFileSync(contentPath)):{} });
    const peers = Array.from({length:Math.min(max,Math.max(min,3))}, (_,i)=>room.addPlayer('Player '+i,socket()).player);
    const host=peers[0];
    eq(room.startGame(def,{ready:true},host.id).ok,true,entry.id+' starts real preparation');
    const game=room.game, oldContext=room.ctx(), victim=peers.find(p=>p.id!==host.id&&room.activeRosterIds().includes(p.id));
    ok(victim,entry.id+' active removable seat');
    const watcher=room.addPlayer('Late watcher',socket()).player;
    const totals=JSON.stringify(room.totals);
    ok(room.isSpectator(watcher.id),entry.id+' late seat is watcher');
    eq(room.kickPlayer(watcher.socket,host.id,{i:game.instanceId}).error,'Only the host can remove players.',entry.id+' watcher cannot kick host');
    eq(room.kickPlayer(host.socket,watcher.id,{i:'retired'}).error,'The match changed. Choose the player again.',entry.id+' stale instance rejected');
    eq(room.kickPlayer(host.socket,watcher.id,{i:game.instanceId}).ended,false,entry.id+' watcher removal keeps match');
    eq(room.game,game,entry.id+' watcher removal preserves game identity');
    eq(JSON.stringify(room.totals),totals,entry.id+' watcher removal does not score');
    const oldSocket=victim.socket, oldToken=victim.token;
    const result=room.kickPlayer(host.socket,victim.id,{i:game.instanceId});
    eq(result.ok,true,entry.id+' host removal accepted during preparation');
    eq(oldSocket.closed.code,SEAT_REMOVED_CODE,entry.id+' victim receives terminal close');
    eq(room.bySocket(oldSocket),undefined,entry.id+' removed socket owns no seat');
    ok(room.preflightAdd(oldToken).error,entry.id+' revoked resume fails preflight');
    ok(room.addPlayer('Retry',socket(),oldToken).error,entry.id+' direct old resume is rejected');
    if(entry.id==='pocket-karts') {
      eq(result.ended,false,'Three-driver karts retain two connected drivers');
      eq(room.game,game,'Kart game identity remains stable');
      ok(!game.requiredReady.has(victim.id),'Removed driver is not in preparation quorum');
      for(const p of room.activeRosterPlayers())room.onReady(p.socket,{i:game.instanceId,w:room._actionToken()});
      eq(game.preparing,false,'Remaining drivers release preparation');
      const remaining=room.activeRosterPlayers().find(p=>p.id!==host.id);
      eq(room.kickPlayer(host.socket,remaining.id,{i:game.instanceId}).ended,true,'Too few kart drivers ends safely');
    } else {
      eq(result.ended,true,entry.id+' stable-order/private game ends instead of rewriting roster');
      eq(room.game,null,entry.id+' remaining room reaches lobby');
    }
    eq(room.timers.size,0,entry.id+' old timers retired');
    oldContext.award(host.id,999);eq(JSON.stringify(room.totals),totals,entry.id+' stale context cannot award after removal');
    oldContext.later(1,()=>{throw Error('retired timer ran')});eq(room.timers.size,0,entry.id+' stale context cannot enqueue timer');
    room.disconnect(oldSocket);eq(room.hostId,host.id,entry.id+' late victim close cannot migrate host');
    room.destroy();
  }
  const room=new Room('SUB',{}, {giggle:{squadId:'squad'}}),host=room.addGigglePlayer('host','Host',socket()).player,victim=room.addGigglePlayer('victim','Guest',socket()).player;
  ok(room.kickPlayer(host.socket,host.id,{i:null}).error,'Self-removal is rejected');
  for(const pid of [null,{},[],1,'p123','__proto__'])ok(room.kickPlayer(host.socket,pid,{i:null}).error,'Malformed target rejected');
  eq(room.kickPlayer(host.socket,victim.id,{i:null}).ok,true,'Verified victim removed in lobby');
  ok(room.preflightGiggle('victim').error,'Verified sub remains blocked in lobby');
  ok(room.addGigglePlayer('victim','New display name',socket()).error,'Renaming cannot bypass sub revocation');
  room.endGameToLobby(host.id);ok(room.preflightGiggle('victim').error,'Returning to lobby does not clear removal');
  ok(room.addGigglePlayer('other-sub','Guest',socket()).player,'Removal is identity scoped, not display-name ban');
  room.destroy();
  const kartRoom=new Room('KART',{}),drivers=Array.from({length:3},(_,i)=>kartRoom.addPlayer('Driver '+i,socket()).player);
  let now=Date.now();kartRoom._gameNow=()=>now;
  eq(kartRoom.startGame(registry.get('pocket-karts'),{},drivers[0].id).ok,true,'Actual classic kart match starts');
  now+=3100;kartRoom.onTick();
  eq(kartRoom.game.state.phase,'drive','Actual countdown enters driving');
  for(let n=0;n<5;n++){const frame=kartRoom.game.def.view(kartRoom.game.state,drivers[1].id),ack=frame.inputAck;kartRoom.onAction(drivers[1].socket,{seq:n+1,life:ack.life,controlEpoch:ack.controlEpoch,input:{steer:.5,throttle:1,boost:true,nitro:true,drift:true}},{i:kartRoom.game.instanceId,w:kartRoom._actionToken()});now+=100;kartRoom.onTick();}
  const kart=kartRoom.game.state.karts.find(k=>k.pid===drivers[1].id),pose=[kart.x,kart.z],tank=kart.nitro;
  ok(kart.speed>0,'Victim moved through authority inputs before removal');
  eq(kartRoom.kickPlayer(drivers[0].socket,drivers[1].id,{i:kartRoom.game.instanceId}).ended,false,'Live kart match continues with two drivers');
  eq(kart.input,{steer:0,throttle:0,boost:false},'Removal immediately clears classic held intent');
  eq([kart.speed,kart.slip,kart.driftCharge],[0,0,0],'Removal immediately freezes movement/drift');
  eq([kart.nitroActive,kart.pendingFire,kart.drifting],[false,false,false],'Removal stops nitro and queued fire');
  eq([kart.x,kart.z],pose,'Connection reset does not advance or teleport kart');
  eq(kart.nitro,tank,'Connection reset preserves actual nitro tank');
  kartRoom.destroy();
}

async function freePort(){const server=net.createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;await new Promise(r=>server.close(r));return port;}
async function transport() {
  const port=await freePort(), secret='local-kick-test-secret-0123456789abcdef';
  const child=spawn(process.execPath,['server/server.js'],{cwd:ROOT,env:{...process.env,PORT:String(port),HOST:'127.0.0.1',NODE_ENV:'production',GAME_REPORT_DB:'',GAME_REPORT_ADMIN_TOKEN:'',GAME_BRIDGE_SECRET:secret,GIGGLE_ALLOWED_ORIGINS:'http://127.0.0.1:4012'},stdio:['ignore','pipe','pipe']});
  let output='';child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>output+=d);
  const peers=[];
  async function peer(){const ws=new WebSocket('ws://127.0.0.1:'+port),p={ws,messages:[],closed:null};peers.push(p);ws.on('message',raw=>p.messages.push(JSON.parse(raw)));ws.on('close',(code,reason)=>p.closed={code,reason:String(reason)});await new Promise((r,j)=>{ws.once('open',r);ws.once('error',j)});return p;}
  const send=(p,m)=>p.ws.send(JSON.stringify(m));
  const last=(p,type)=>p.messages.filter(m=>m.t===type).at(-1);
  async function request(p,m,type){const count=p.messages.length;send(p,m);await until(()=>p.messages.slice(count).some(x=>x.t===type),'reply '+type);return p.messages.slice(count).find(x=>x.t===type);}
  try {
    await until(()=>output.includes('PartyBox on'),'scratch production server startup');
    const host=await peer(),hello=(await request(host,{t:'create',name:'Host'},'hello'));
    const victim=await peer(),v=await request(victim,{t:'join',name:'Guest',code:hello.code},'hello');
    const watcher=await peer(),w=await request(watcher,{t:'join',name:'Watcher',code:hello.code},'hello');
    eq((await request(victim,{t:'kick',pid:w.you,you:hello.you,i:null},'error')).code,'KICK_REJECTED','Client sender-id spoof cannot grant host authority');
    ok((await request(host,{t:'kick',pid:v.you},'error')).msg.includes('match changed'),'Missing current-instance marker rejected');
    const started=await request(host,{t:'start',game:'chess',ready:true},'state');
    ok(started.preparing,'Real chess match waits for rendering');
    eq((await request(host,{t:'kick',pid:w.you,i:started.instanceId},'kicked')).ended,false,'Seat-capped watcher kick retains real match');
    await until(()=>watcher.closed,'Watcher close');eq(watcher.closed.code,4003,'Actual watcher socket closes4003');
    const states=host.messages.filter(m=>m.t==='state');eq(states.at(-1).instanceId,started.instanceId,'Watcher kick does not rematch');
    eq((await request(host,{t:'kick',pid:v.you,i:started.instanceId},'kicked')).ended,true,'Active chess removal safely ends preparing match');
    await until(()=>victim.closed,'Victim close');eq(victim.closed.code,4003,'Actual active socket closes4003');
    eq(last(host,'room').room.game,null,'Host and remaining seats receive lobby');
    const retry=await peer();eq((await request(retry,{t:'join',name:'Guest',code:hello.code,seatToken:v.seatToken},'error')).code,'REMOVED_FROM_ROOM','Old seat cannot resume over real WS');
    await until(()=>retry.closed,'Revoked resume close');eq(retry.closed.code,4003,'Revoked unattached resume receives terminal removal close');
    const fresh=await peer();ok((await request(fresh,{t:'join',name:'New guest',code:hello.code},'hello')).you!==v.you,'Anonymous explicit fresh identity is not IP/name banned');
    const away=await peer(),a=await request(away,{t:'join',name:'Away guest',code:hello.code},'hello');
    away.ws.close();await until(()=>away.closed&&last(host,'room').room.players.some(p=>p.id===a.you&&!p.connected),'Away seat disconnect');
    eq((await request(host,{t:'kick',pid:a.you,i:null},'kicked')).ended,false,'Host can remove a disconnected lobby seat');
    const awayRetry=await peer();eq((await request(awayRetry,{t:'join',name:'Away guest',code:hello.code,seatToken:a.seatToken},'error')).code,'REMOVED_FROM_ROOM','Away removal rejects its scheduled token resume');
    await until(()=>awayRetry.closed,'Away removed resume close');eq(awayRetry.closed.code,4003,'Away removed seat receives cleanup close on reconnect');
    const other=await peer(),otherHello=await request(other,{t:'create',name:'Other room host'},'hello');
    eq((await request(other,{t:'join',name:'Guest',code:hello.code,seatToken:v.seatToken},'error')).code,'REMOVED_FROM_ROOM','Revoked target rejects without moving current other-room seat');
    eq(other.ws.readyState,WebSocket.OPEN,'A valid existing other-room seat remains connected');
    eq((await request(other,{t:'join',name:'Other room host',code:otherHello.code},'hello')).you,otherHello.you,'Revoked-target preflight retains current room/seat identity');
    const gh=await peer(),gv=await peer();
    const ticket=sub=>mintTicket({sub,squadId:'kick-squad',displayName:sub},secret);
    const gHello=await request(gh,{t:'giggleJoin',ticket:ticket('verified-host')},'hello');
    const gVictim=await request(gv,{t:'giggleJoin',ticket:ticket('verified-victim')},'hello');
    eq((await request(gh,{t:'kick',pid:gVictim.you,i:null},'kicked')).ended,false,'Verified lobby removal accepted');
    await until(()=>gv.closed,'Verified victim close');eq(gv.closed.code,4003,'Verified removed socket closes4003');
    const renewed=await peer();eq((await request(renewed,{t:'giggleJoin',ticket:ticket('verified-victim')},'error')).code,'REMOVED_FROM_ROOM','Fresh valid ticket cannot bypass room sub revocation');
    await until(()=>renewed.closed,'Revoked verified resume close');eq(renewed.closed.code,4003,'Revoked verified reconnect receives terminal close');
    const alternativePeer=await peer(),alternative=await request(alternativePeer,{t:'giggleJoin',ticket:mintTicket({sub:'verified-victim',squadId:'other-squad',displayName:'Guest'},secret)},'hello');
    ok(alternative.code!==gHello.code,'Revocation is local to the removed room');
  } finally {
    for(const p of peers)p.ws.terminate();
    child.kill();
    await new Promise(r=>child.once('exit',r));
  }
}
(async()=>{await unit();await transport();console.log('ROOM_KICK_PASS: '+checks+' all42 production-game lifecycle and actual WS host/target/instance, watcher, token/sub revocation and close assertions');})().catch(e=>{console.error(e);process.exitCode=1});

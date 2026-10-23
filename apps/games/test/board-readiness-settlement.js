'use strict';
// Real Room preparation/release snapshots, rendered by the shipped clients.
// The shared client rigs control only presentation time, never game authority.
const assert=require('node:assert/strict');
const {Room}=require('../server/room');
const duels=require('./board-duels-view').rig;
const sowing=require('./checkers-kalah-view').rig;
const races=require('./ludo-fleet-view').rig;
const games=['four-in-a-row','reversi','checkers','kalah','ludo','fleet-duel'];
let checks=0;
function ok(value,label){assert(value,label);checks++;}
function eq(a,b,label){assert.deepEqual(a,b,label);checks++;}
const revision=S=>S.rev??S.revision;
function makeRig(game,reduced){return ['checkers','kalah'].includes(game)?sowing(game,{}, {reduced}):['ludo','fleet-duel'].includes(game)?races(game,{reduced}):duels(game,{reduced});}
function controller(game,r){return r.el[{'four-in-a-row':'_four',reversi:'_reversi',ludo:'_ludo','fleet-duel':'_fleet'}[game]];}
function moving(game,r){return !!(r.frames?.size||controller(game,r)?.settling);}
function settle(game,r){if(r.frames){for(const [id,fn]of [...r.frames]){r.frames.delete(id);fn(3000);}}else if(r.advance)r.advance(1000);else r.flush();}
function finalPosition(game,s){
 if(game==='four-in-a-row')return; // A complete natural match below.
 if(game==='reversi'){s.board=Array(64).fill(1);s.board[0]=0;s.board[1]=2;}
 if(game==='checkers'){s.board=Array(64).fill(0);s.board[26]=1;s.board[17]=2;s.repetition={};}
 if(game==='kalah')s.pits=[0,0,0,0,0,1,24,4,4,4,4,4,3,0]; // 48 seeds, a last sow and sweep.
 if(game==='ludo'){s.phase='move';s.die=1;s.pawns[0]=[56,56,56,55];}
 if(game==='fleet-duel'){
  s.phase='play';s.ready=[true,true];s.fleets=[0,1].map(()=>[0,10,20,30,40].map(at=>({at,vertical:false})));
  for(const [ship,length]of [5,4,3,3,2].entries())for(let n=0;n<length;n++)if(ship!==4||n!==1)s.shots[0][ship*10+n]=2;
 }
}
async function table(game,{reduced=false,final=false}={}){
 const room=new Room('SETTLE',{}),def=require('../games/'+game+'/server'),peers=[];
 function peer(name){const p={messages:[],snapshot:null,baseline:true,readyAcks:[],r:null};p.socket={readyState:1,bufferedAmount:0,send(text){const m=JSON.parse(text);p.messages.push(m);if(m.t==='state'){p.snapshot={...m,me:m.you};if(p.r)paint(p);}},close(){}};p.player=room.addPlayer(name,p.socket).player;peers.push(p);return p;}
 const a=peer('Anika'),b=peer('Bastian');ok(room.startGame(def,{ready:true},a.player.id).ok,game+' starts through real readiness');
 const watcher=peer('Watching friend'); // Late arrival must never join the quorum.
 if(final)finalPosition(game,room.game.state);
 room.broadcastState();
 function paint(p){const r=p.r;p.snapshot={...p.snapshot,audioBaseline:p.baseline};p.baseline=false;if(r.view.render)r.view.render(r.el,p.snapshot,r.api);else r.view.update(r.el,p.snapshot,r.api);}
 for(const p of peers){p.r=makeRig(game,reduced);p.results=[];p.r.api.resultsReady=id=>p.results.push(id);p.r.api.ready=meta=>{if(p.snapshot.spectator||!p.snapshot.preparing||meta.instanceId!==p.snapshot.instanceId||meta.window!==p.snapshot.w)return false;p.readyAcks.push(meta);room.onReady(p.socket,{i:meta.instanceId,w:meta.window});return true;};paint(p);}
 function send(p,action){const S=p.snapshot;room.onAction(p.socket,{...action,...(['checkers','kalah'].includes(game)?{revision:S.revision}:{rev:S.actionRev??S.rev})},{i:S.instanceId,w:S.w});}
 async function release(){
  if(!room.game.preparing)return;
  const held=revision(a.snapshot),meta={instanceId:a.snapshot.instanceId,window:a.snapshot.w};
  for(const p of peers)await p.r.view.ready?.(p.r.el);
  eq(watcher.r.api.ready(meta),false,game+' watcher cannot acknowledge the active quorum');
  a.r.api.ready(meta);ok(room.game.preparing,game+' one ready seat cannot release the table');eq(revision(a.snapshot),held,game+' readiness does not mutate a move');
  b.r.api.ready(meta);ok(!room.game.preparing,game+' both loaded active seats release authority');ok(peers.every(p=>!p.snapshot.preparing),game+' release reaches every rendered actual client');
 }
 function active(){return peers.find(p=>p.player.id===room.game.state.seats[game==='four-in-a-row'||game==='reversi'?room.game.state.turn-1:room.game.state.turn]);}
 function choose(p,override){const S=p.snapshot;
  if(game==='four-in-a-row')return {drop:override??3};if(game==='reversi')return {place:override??S.legal[0]};
  if(game==='checkers'){const [from,moves]=Object.entries(S.legal)[0];return {from:Number(from),to:moves[0].to};}
  if(game==='kalah')return {pit:override??S.legal[0]};if(game==='ludo')return S.phase==='roll'?{roll:true}:{move:S.legal[0]};return {fire:override??S.shots[S.youAre].findIndex(n=>!n)};
 }
 function attempt(p,action=choose(p)){const el=p.r.el,click=selector=>{const n=el.querySelector(selector);ok(n,game+' gameplay control exists');n.dispatch('click');};
  if(game==='four-in-a-row')click('[data-column="'+action.drop+'"]');
  if(game==='reversi')click('[data-cell="'+action.place+'"]');
  if(game==='checkers'){click('[data-square="'+action.from+'"]');click('[data-square="'+action.to+'"]');}
  if(game==='kalah')click('[data-pit="'+action.pit+'"]');
  if(game==='ludo')click(action.roll?'[data-roll]':'[data-choice="'+action.move+'"]');
  if(game==='fleet-duel'){click('[data-square="'+action.fire+'"]');click('[data-fire]');}
 }
 function heartbeat(){room.broadcastState();}
 function retire(){for(const p of peers)p.r.view.dispose(p.r.el);room.destroy();}
 async function prepareFleet(){if(game!=='fleet-duel'||room.game.state.phase!=='place')return;for(const p of [a,b])send(p,{auto:true});for(const p of [a,b])send(p,{ready:true});await release();for(const p of peers){p.r.cues.length=0;p.r.sent.length=0;}}
 await release();await prepareFleet();
 return{game,room,def,peers,a,b,watcher,send,release,active,choose,attempt,heartbeat,retire};
}
async function opening(game,reduced){
 const t=await table(game,{reduced});try{
  const {peers,a,b,watcher}=t;eq(peers.map(p=>p.r.cues.length),[0,0,0],game+' initial preparation/release is quiet');
  const p=t.active(),action=t.choose(p,game==='kalah'?0:undefined);t.attempt(p,action);eq(p.r.sent.length,1,game+' released legal UI sends once');
  const rev=revision(p.snapshot);t.send(p,p.r.sent[0]);eq(revision(p.snapshot),rev+1,game+' server accepts the UI action');ok(t.room.game.preparing,game+' accepted action enters production preparation');
  eq(peers.map(p=>p.r.cues.length),[0,0,0],game+' prepared confirmation cannot sound');ok(peers.every(p=>!moving(game,p.r)),game+' move waits for authoritative release');
  const next=t.active(),count=next.r.sent.length;t.attempt(next,t.choose(next));eq(next.r.sent.length,count,game+' prepared next seat cannot send');t.heartbeat();await t.release();
  if(!reduced){ok(peers.every(p=>moving(game,p.r)),game+' every actual client animates the released confirmed revision');
   const timerIds=peers.map(p=>[...(p.r.frames||p.r.timers).keys()]);t.heartbeat();eq(peers.map(p=>[...(p.r.frames||p.r.timers).keys()]),timerIds,game+' released heartbeat retains presentation time');
   t.attempt(next,t.choose(next));eq(next.r.sent.length,count,game+' next player cannot act during previous move settlement');
   if(game!=='fleet-duel')eq(peers.map(p=>p.r.cues.length),[0,0,0],game+' landing audio waits for visible motion');
  }
  for(const peer of peers)settle(game,peer.r);ok(peers.every(p=>!moving(game,p.r)),game+' all moves settle');
  const expected=game==='reversi'?'capture':game==='ludo'?'dice':game==='fleet-duel'?(a.snapshot.lastMove.hit?'capture':'piece'):'piece';
  eq(peers.map(p=>p.r.cues.map(c=>c.name)),[[expected],[expected],[expected]],game+' action plays its semantic cue exactly once per client');
  ok(peers.every(p=>p.r.cues[0].id.startsWith(p.snapshot.instanceId+':')),game+' cue IDs use real instance authority');t.heartbeat();for(const peer of peers)settle(game,peer.r);eq(peers.map(p=>p.r.cues.length),[1,1,1],game+' heartbeat never replays released move');
  const again=t.active(),before=again.r.sent.length;t.attempt(again,t.choose(again));eq(again.r.sent.length,before+1,game+' input resumes after settlement');
  // Reconnection happens while a new move is confirmed but not yet released.
  t.send(again,again.r.sent.at(-1));ok(t.room.game.preparing,game+' second action also requires readiness');
  a.baseline=true;t.heartbeat();ok(a.snapshot.audioBaseline,game+' first reconnect snapshot seeds presentation history');await t.release();settle(game,a.r);eq(a.r.cues.length,1,game+' release after reconnect does not replay historical cue');
  eq(watcher.readyAcks.length,0,game+' watcher stays outside every handshake');ok(a.readyAcks.length>=2&&b.readyAcks.length>=2,game+' production quorum acknowledges changing windows');
 }finally{t.retire();}
}
async function finish(game,reduced){
 const t=await table(game,{reduced,final:true});try{
  if(game==='four-in-a-row')for(const col of [0,6,1,6,2,5]){t.send(t.active(),{drop:col});await t.release();for(const p of t.peers)settle(game,p.r);}
  const last=game==='four-in-a-row'?{drop:3}:game==='fleet-duel'?{fire:41}:t.choose(t.active());
  for(const p of t.peers)p.r.cues.length=0;t.send(t.active(),last);eq(t.a.snapshot.phase,'done',game+' real legal final action ends authority');ok(!t.room.game.preparing,game+' final phase bypasses no required live move');
  if(!reduced){ok(t.peers.every(p=>moving(game,p.r)),game+' final confirmed move animates for both players and watcher');eq(t.peers.map(p=>p.results.length),[0,0,0],game+' results wait for final physical settlement');}
  for(const p of t.peers)settle(game,p.r);eq(t.peers.map(p=>p.results),t.peers.map(p=>[p.snapshot.instanceId]),game+' settled final results report exactly once');
  t.heartbeat();for(const p of t.peers)settle(game,p.r);eq(t.peers.map(p=>p.results.length),[1,1,1],game+' done heartbeat cannot repeat finale');
  const reconnect=makeRig(game,reduced),results=[];reconnect.api.resultsReady=id=>results.push(id);const snap={...t.a.snapshot,audioBaseline:true};if(reconnect.view.render)reconnect.view.render(reconnect.el,snap,reconnect.api);else reconnect.view.update(reconnect.el,snap,reconnect.api);settle(game,reconnect);eq(reconnect.cues,[],game+' terminal reconnect has no historical audio');eq(results,[],game+' terminal reconnect has no historical celebration');reconnect.view.dispose(reconnect.el);
 }finally{t.retire();}
}
async function main(){const failures=[];for(const game of games)for(const reduced of [false,true])for(const run of [opening,finish])try{await run(game,reduced);}catch(error){failures.push(game+' '+(reduced?'reduced':'motion')+' '+run.name+': '+error.message);}
 if(failures.length)throw Error(failures.join('\n'));
 console.log('BOARD_READINESS_SETTLEMENT_PASS: '+checks+' real-Room/shipped-client assertions (active ready quorum, prepared move retention, release motion, input locks, settled cues/results, quiet reconnect, reduced motion)');
}
main().catch(e=>{console.error(e.message);process.exitCode=1});

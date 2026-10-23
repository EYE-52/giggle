'use strict';
// Actual Room input boundary: explicit line mode preserves comma labels;
// legacy comma lists retain their original meaning without partial guessing.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { Room } = require('../server/room');
const game = require('../games/memory-tray/server');
const {makeDocument,surface} = require('./party-mobile');
const data = source => 'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
async function run() {
  const room = new Room('MCOM', {});
  const sockets = Array.from({length:3},()=>({readyState:1,bufferedAmount:0,send(){},close(){}}));
  const players = sockets.slice(0,2).map((socket,i)=>room.addPlayer('Recall '+i,socket).player);
  let time = 1000; const timers = [], base = room.ctx.bind(room);
  room.ctx = ()=>({...base(),now:()=>time,later:(ms,fn)=>timers.push({at:time+ms,fn})});room._gameNow = ()=>time;
  try {
    const long='W'.repeat(37)+', 0',markup='<img src=x onerror=alert(1)>, red';
    const pack={items:['apple','pear','banana','spoon','clock','fish','key','book','quoted" label',markup,long,'apple,key']};
    const random=Math.random;
    try {Math.random=()=>0;assert(room.startGame(game,{settings:{rounds:1,memSeconds:5,recallSeconds:10},pack},players[0].id).ok);}finally{Math.random=random;}
    const tray=[...room.game.state.items];assert.equal(tray.length,8);assert(tray.includes('apple')&&tray.includes('apple,key')&&tray.includes(long)&&tray.includes(markup));
    const watcher=room.addPlayer('Watcher',sockets[2]).player;
    time=6000;timers[0].fn();room.broadcastState();
    const hidden=game.view(room.game.state,watcher.id);assert.equal(hidden.recallFormat,'lines');assert.equal(hidden.items,undefined);assert.equal(hidden.myRecall,null);assert.equal(hidden.last,null);
    const before=JSON.stringify(room.game.state);room.onAction(sockets[2],{recall:tray.join('\n'),recallFormat:'lines'});assert.equal(JSON.stringify(room.game.state),before,'Spectator cannot submit hidden labels');
    room.onAction(sockets[0],{recall:'apple, key'});assert.deepEqual(room.game.state.submissions[players[0].id],['apple','key'],'Old clients retain comma-list semantics');
    room.onAction(sockets[0],{recall:'APPLE,KEY',recallFormat:'lines'});assert.deepEqual(room.game.state.submissions[players[0].id],['apple,key'],'One compound label never guesses its overlapping parts');
    room.onAction(sockets[0],{recall:'apple, key',recallFormat:'lines'});assert.deepEqual(room.game.state.submissions[players[0].id],['apple, key'],'Exact labels retain internal spacing');
    const recall=['',...tray.map(w=>' '+w.toUpperCase()+' '),tray[0],''].join('\r\n');
    room.onAction(sockets[0],{recall,recallFormat:'lines'});assert.equal(room.game.state.submissions[players[0].id].length,8,'CRLF/trim/case/dedup preserve eight exact labels');
    assert.equal(game.view(room.game.state,players[1].id).myRecall,null,'Other participant cannot see a private draft');
    assert.equal(game.view(room.game.state,watcher.id).items,undefined);
    room.onAction(sockets[1],{recall:tray.join('\n'),recallFormat:'lines'});assert.equal(room.game.state.phase,'reveal');
    for(const player of players){const result=room.game.state.last.results[player.id];assert.equal(result.count,8);assert.equal(result.pts,200);assert.equal(room.totals[player.id],200);}
    room.onAction(sockets[0],{recall,recallFormat:'lines'});assert.equal(room.totals[players[0].id],200,'Late recall cannot duplicate awards');
    const oldDocument=global.document;global.document=makeDocument();
    try {
      const util=data(fs.readFileSync(require.resolve('../public/js/util.js'),'utf8'));
      const source=fs.readFileSync(require.resolve('../public/js/games/memory-tray.js'),'utf8').replace("'../util.js'",JSON.stringify(util)).replace("'../kit.js'", JSON.stringify(require('./_kit-url')(util)));
      const view=(await import(data(source))).default,el=surface(global.document),sent=[];
      const S={phase:'recall',round:1,rounds:1,instanceId:'comma-match',me:'a',hostId:'a',players:[{id:'a',name:'Ada'}],scores:{},endsAt:10000,recallFormat:'lines',submitted:[]};
      const api={now:()=>1000,send:a=>sent.push(a)};view.render(el,S,api);const input=el.querySelector('#mAns');assert.equal(input.tagName,'TEXTAREA');input.value=tray.join('\n');input.onkeydown({key:'Enter'});assert.equal(sent.length,0,'Enter inserts a new line instead of submitting');
      view.render(el,{...S,repeated:true},api);assert(el.querySelector('#mAns')===input);assert.equal(input.value,tray.join('\n'),'Snapshot retains multiline recall');el.querySelector('#mSend').click();assert.deepEqual(sent[0],{recall:tray.join('\n'),recallFormat:'lines'});
      view.render(el,{...S,phase:'memorize',items:tray},api);assert(!el.querySelector('img'),'Custom markup stays escaped label text');view.dispose(el);
    } finally {if(oldDocument===undefined)delete global.document;else global.document=oldDocument;}
    console.log('MEMORY_CUSTOM_DELIMITERS_PASS: explicit lines, legacy commas, overlapping exact labels, CRLF/case/dedup, 40-character labels, escaped markup, private/spectator projections, exact awards and shipped multiline controls');
  } finally {room.destroy();}
}
if(require.main===module)run().catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={run};

'use strict';
// Legal definition actions with controlled timers. Native Room migration and
// rematch evidence lives in truth-dare/dare-roulette-full-app-20261010.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const roster = ['original', 'elected', 'successor'].map(id => ({ id, name: id }));
let checks = 0;
function eq(actual, expected, label) { assert.deepEqual(actual, expected, label); checks++; }
function context(id) {
  return {
    host: 'elected', time: 1000, timers: [], awards: {},
    hostId() { return this.host; },
    allPlayers() { return roster.slice(); },
    players() { return roster.filter(p => p.id !== this.away); },
    settings() { return { rounds: 3, dareSeconds: 30 }; },
    content() { return JSON.parse(fs.readFileSync(path.join(__dirname, '../locales/en', id + '.json'), 'utf8')); },
    now() { return this.time; },
    later(ms, fn) { this.timers.push({ at: this.time + ms, fn }); },
    broadcast() {},
    award(pid, pts) { this.awards[pid] = (this.awards[pid] || 0) + pts; },
    deadline(state) {
      const timer = this.timers.findLast(t => !t.fired && (!state.endsAt || t.at === state.endsAt));
      assert(timer, 'the current phase has a natural deadline'); checks++;
      timer.fired = true; this.time = timer.at; timer.fn();
    },
  };
}
const ids = ['truth-dare','dare-roulette','would-you-rather','bluff','compliment-battle','most-likely','lyric-fill','never-ever','rapid-polls','funny-answer','hot-takes','rank-it','pick-one','story-builder','memory-tray','roast-toast','trivia'];
const key = s => [s.phase, s.round, s.index];
const revealViews = [];
function legal(def, state, pid) {
  const id = def.id, v = def.view(state, pid), phase = state.phase;
  if (id === 'truth-dare') return phase === 'choose' ? pid === state.target ? {deck:'classic',kind:'truth'} : null : phase === 'perform' ? pid === state.target ? {ready:true} : null : pid !== state.target ? {vote:'yes'} : null;
  if (id === 'dare-roulette') return phase === 'spin' ? {spin:true} : phase === 'perform' ? pid === state.victim ? {ready:true} : null : pid !== state.victim ? {vote:'done'} : null;
  if (id === 'would-you-rather' || id === 'pick-one') return {vote:'a'};
  if (id === 'never-ever') return {vote:'not'};
  if (id === 'most-likely') return {vote:roster.find(p => p.id !== pid).id};
  if (id === 'rank-it') return {order:[0,1,2,3,4]};
  if (id === 'rapid-polls') return phase === 'pose' ? {pose:{q:'Election question?',options:['Yes','No']}} : {vote:0};
  if (id === 'hot-takes') return phase === 'submit' ? {take:'Election take '+pid} : !v.current?.mine ? {vote:'agree'} : null;
  if (id === 'funny-answer') return phase === 'answer' ? {answer:'Election answer '+pid} : {vote:v.options.find(o => o.aid !== v.myEntry).aid};
  if (id === 'bluff') return phase === 'bluff' ? {fake:'Election bluff '+pid} : {pick:v.options.find(o => o.oid !== v.myOption).oid};
  if (id === 'story-builder') return phase === 'build' ? pid === v.turn ? {line:'Election story line '+pid} : null : {vote:v.lines.findIndex((_, i) => !v.myLines.includes(i))};
  if (id === 'compliment-battle' || id === 'roast-toast') {
    if (phase === 'write') return pid !== v.target ? {entry:'Election note '+pid} : null;
    if (id === 'roast-toast' && pid === v.target) return {pick:0};
    return {vote:v.ballot.find(b => b.i !== v.myEntry).i};
  }
  if (id === 'trivia') return {pick:0};
  if (id === 'lyric-fill') return {text:'world'};
  if (id === 'memory-tray') return {recall:'apple'};
  throw Error(id);
}
function reveal(def, state, ctx) {
  for (let n=0; state.phase !== 'reveal' && n<100; n++) {
    if ((def.id === 'truth-dare' && state.phase === 'spin') || state.phase === 'memorize') ctx.deadline(state);
    else {
      const prior = key(state);
      for (const p of roster) {
        if (JSON.stringify(key(state)) !== JSON.stringify(prior)) break;
        const a = legal(def, state, p.id);
        if (a) def.onAction(state, ctx, p.id, a);
      }
    }
  }
  eq(state.phase, 'reveal', def.id + ' legal actions resolve');
}
for (const id of ids) {
  const def = require('../games/' + id + '/server');
  const ctx = context(id), state = def.create(ctx);
  eq(state.hostId, 'elected', id + ' starts with elected host rather than first roster seat');
  reveal(def, state, ctx);
  ctx.away = 'elected'; ctx.host = 'successor';
  for (const pid of ['original','elected','successor','watcher']) eq(def.view(state,pid,ctx).hostId,'successor',id+' projects current authority to '+pid);
  eq(state.hostId,'elected',id+' stored initial authority remains plain');
  eq(def.view(state,'watcher').hostId,'elected',id+' legacy projection fallback');
  revealViews.push({id, state: {...def.view(state,'successor',ctx), players:roster, me:'successor', spectator:false}});
  const before = key(state);
  // The round's lead player (truth-dare / compliment / roast target, dare-roulette victim) may
  // also press Next during the reveal (GAME_RULES_STANDARD), so skip them.
  const lead = s => def.id === 'truth-dare' || ['compliment-battle','roast-toast'].includes(def.id) ? s.target : def.id === 'dare-roulette' ? s.victim : null;
  for (const pid of ['original','elected','watcher'].filter(pid => pid !== lead(state))) {
    def.onAction(state,ctx,pid,{next:true}); eq(key(state),before,id+' rejects retired/non-player Next '+pid);
  }
  def.onAction(state,ctx,'successor',{next:true});
  eq(JSON.stringify(key(state)) === JSON.stringify(before),false,id+' elected host advances');
  ctx.host='original'; ctx.away=undefined;
  const rematch=def.create(ctx);
  eq(rematch.hostId,'original',id+' rematch stores current authority'); reveal(def,rematch,ctx);
  ctx.host='watcher';
  eq(def.view(rematch,'watcher',ctx).hostId,'watcher',id+' projects spectator Room host');
  const held=key(rematch);
  for (const pid of ['original','elected','successor','watcher'].filter(pid => pid !== lead(rematch))) {
    def.onAction(rematch,ctx,pid,{next:true}); eq(key(rematch),held,id+' spectator-host forbids Next '+pid);
  }
  const awards={...ctx.awards}; ctx.deadline(rematch);
  eq(JSON.stringify(key(rematch)) === JSON.stringify(held),false,id+' natural reveal progression survives spectator host');
  eq(ctx.awards,awards,id+' reveal advancement does not double-award');
}
// Exercise both framework projection hooks with real Room host election.
const { Room } = require('../server/room');
for (const hook of ['view', 'viewForTransport']) {
  const room = new Room('HOSTCTX', {}), peers = [];
  for (const name of ['original', 'elected', 'successor']) {
    const peer = { packets: [] };
    peer.socket = { readyState: 1, bufferedAmount: 0, send(text) { peer.packets.push(JSON.parse(text)); }, close() {} };
    peer.player = room.addPlayer(name, peer.socket).player; peers.push(peer);
  }
  const def = { id: 'truth-dare', minPlayers: 3, maxPlayers: 20,
    create(ctx) { return { phase: 'vote', round: 1, endsAt: 0, hostId: ctx.hostId() }; },
    view() { throw new Error('wrong hook'); },
    onAction() {},
  };
  def[hook] = function(state, pid, ctx) {
    eq(this, def, hook + ' preserves definition receiver');
    eq(ctx.instanceId, room.game.instanceId, hook + ' receives active game context');
    return { hostId: ctx.hostId(), initialHost: state.hostId, me: pid };
  };
  try {
    eq(room.startGame(def, {}, peers[0].player.id).ok, true, hook + ' actual Room starts');
    room.disconnect(peers[0].socket);
    room.broadcastState();
    for (const peer of peers.slice(1)) {
      const snapshot = peer.packets.findLast(p => p.t === 'state');
      eq(snapshot.hostId, peers[1].player.id, hook + ' projects actual elected Room host');
      eq(snapshot.initialHost, peers[0].player.id, hook + ' preserves plain initial state');
    }
  } finally { room.destroy(); }
}
// Mount the real client with engine projections; this verifies controls, not geometry.
(async () => {
  const {makeDocument,surface}=require('./party-mobile');
  const oldDoc=global.document,oldWindow=global.window;
  global.document=makeDocument(); global.window={matchMedia:()=>({matches:true})};
  const data=s=>'data:text/javascript;base64,'+Buffer.from(s).toString('base64');
  const util=data(fs.readFileSync(path.join(__dirname,'../public/js/util.js'),'utf8'));
  try {
    for (const {id,state} of revealViews) {
      const source=fs.readFileSync(path.join(__dirname,'../public/js/games',id+'.js'),'utf8').replace("'../util.js'",JSON.stringify(util)).replace("'../kit.js'", JSON.stringify(require('./_kit-url')(util)));
      const ui=(await import(data(source))).default, el=surface(document), sent=[];
      const render=S=>{ui.dispose?.();ui.render(el,{...structuredClone(S),instanceId:'authority-'+id},{send:a=>sent.push(a)});};
      const next=()=>el.querySelectorAll('button').filter(b=>!b.disabled && /next/i.test(b.textContent));
      render(state); eq(next().length>0,true,id+' current active host has Next');
      // The round's lead player (dared player, truth-or-dare target) keeps Next.
      const leadPid = id === 'dare-roulette' ? state.last?.victim : ['truth-dare','compliment-battle','roast-toast'].includes(id) ? state.last?.target : null;
      render({...state,me:'original'}); eq(next().length,leadPid==='original'?1:0,id+' retired host has no Next unless they lead the round');
      render({...state,me:'watcher',hostId:'watcher',spectator:true}); eq(next().length,0,id+' spectator Room host has no Next');
      render({...state,me:'watcher',hostId:'watcher',spectator:false}); eq(next().length,0,id+' absent roster Room host has no Next');
      ui.dispose?.();
    }
  } finally {global.document=oldDoc;global.window=oldWindow;}
  console.log('PARTY_ELECTED_HOST_PASS '+checks+' across '+ids.length+' games and both Room hooks');
})().catch(e=>{console.error(e);process.exitCode=1;});

'use strict';
const assert = require('node:assert/strict');
const { Room } = require('../server/room');
const { containsAnswer } = require('../games/engines/guess-chat');
assert(containsAnswer('the answer is ＡＰＰＬＥ!', ['apple']));
assert(containsAnswer('maybe a red-fox?', ['red fox']));
assert(!containsAnswer('pineapple', ['apple']));
const roster = ['a','b','c'].map(id => ({ id, name: id }));
for (const id of ['doodle-guess','charades','emoji-story']) {
  const game = require('../games/' + id + '/server');
  const awards = {};
  const ctx = { allPlayers:()=>roster, players:()=>roster, hostId:()=> 'a', settings:()=>({rounds:2}),
    content:()=>require('../locales/en/' + id + '.json'), time:1000, now(){return this.time;}, later(){}, broadcast(){},
    award(pid, pts){awards[pid]=(awards[pid]||0)+pts;} };
  const s=game.create(ctx);
  if(id==='doodle-guess') game.onAction(s,ctx,s.drawer,{choose:s.choices[0]});
  if(id==='emoji-story') game.onAction(s,ctx,s.director,{emoji:'🌊🐟'});
  const director=s.drawer||s.actor||s.director, solver=roster.find(p=>p.id!==director).id;
  const other=roster.find(p=>p.id!==director&&p.id!==solver).id;
  const answer=s.word||s.phrase;
  const before=game.view(s,other,ctx);
  game.onAction(s,ctx,solver,{guess:answer});
  const score={...s.scores}, deadline=s.endsAt;
  assert.deepEqual(awards,{},id+' room totals stay private until reveal');
  assert.deepEqual(game.view(s,other,ctx).scores,before.scores,id+' other scoreboard does not disclose solve');
  const own=game.view(s,solver,ctx), publicView=game.view(s,'watcher',ctx);
  assert(own.mySolved || own.guessed?.[solver],id+' private solve acknowledgement');
  assert(!publicView.guessed?.[solver] && !(publicView.solvers||[]).includes(solver),id+' solver identities stay private');
  game.onAction(s,ctx,solver,{guess:'zqxv blorp'});
  assert.equal(s.guesses.at(-1).text,'zqxv blorp',id+' solver chat accepted');
  const recipient=id==='charades'?director:other;
  assert.equal(game.view(s,recipient,ctx).guesses.at(-1).text,'zqxv blorp',id+' chat in original guess stream');
  if(id==='charades') assert(!game.view(s,other,ctx).guesses.some(g=>g.pid===solver), 'Charades keeps attempts private');
  for (const text of [answer,'the answer is '+answer.toUpperCase()]) game.onAction(s,ctx,solver,{guess:text});
  if(id==='emoji-story') for(const alias of s.aliases) game.onAction(s,ctx,solver,{guess:'try '+alias});
  assert.equal(s.guesses.at(-1).text,'zqxv blorp',id+' answer never enters chat');
  game.onAction(s,ctx,director,{guess:answer});
  game.onAction(s,ctx,'outsider',{guess:'outsider text'});
  assert.equal(s.guesses.at(-1).text,'zqxv blorp',id+' director and outsider cannot chat');
  assert.deepEqual(s.scores,score,id+' chat cannot score again');
  assert.equal(s.endsAt,deadline,id+' chat cannot extend round');
  assert(!JSON.stringify(publicView.guesses).toLowerCase().includes(answer.toLowerCase()),id+' no answer in public guesses');
  assert.equal(game.view(s,solver,ctx).mySolved||!!game.view(s,solver,ctx).guessed?.[solver],true,id+' reconnect projection retains solve');
  game.onAction(s,ctx,other,{guess:answer});
  assert.equal(s.phase,'reveal',id+' last solve still closes round');
  assert(Object.values(awards).some(n=>n>0),id+' points settle at reveal');
  const settled={...awards};game.onAction(s,ctx,solver,{guess:'late text'});game.onEnd(s,ctx);
  assert.deepEqual(awards,settled,id+' reveal/end cannot award twice');
  const late=game.create(ctx);
  if(id==='doodle-guess') game.onAction(late,ctx,late.drawer,{choose:late.choices[0]});
  if(id==='emoji-story') game.onAction(late,ctx,late.director,{emoji:'🌊🐟'});
  const leader=late.drawer||late.actor||late.director, first=roster.find(p=>p.id!==leader).id;
  game.onAction(late,ctx,first,{guess:late.word||late.phrase});
  const count=late.guesses.length;
  ctx.time=late.endsAt;
  game.onAction(late,ctx,first,{guess:'late bluff'});
  assert.equal(late.phase,'reveal',id+' late solver chat closes expired round');
  assert.equal(late.guesses.length,count,id+' late bluff is not published');
  console.log('GUESS_CHAT_ENGINE_PASS '+id);
}
// Actual Room snapshots: room-night totals and public guesses must not identify
// a solver; actions carry the real instance/window checks.
for (const id of ['doodle-guess','charades','emoji-story']) {
  const game=require('../games/'+id+'/server'),room=new Room('CHAT',{[id]:require('../locales/en/'+id+'.json')});
  const sockets=roster.map(()=>({readyState:1,bufferedAmount:0,frames:[],send(text){this.frames.push(JSON.parse(text));}}));
  try {
    const players=sockets.map((socket,i)=>room.addPlayer('Player '+i,socket).player);
    assert(room.startGame(game,{settings:{rounds:2}},players[0].id).ok);
    for(const socket of sockets) room.onReady(socket,{i:room.game.instanceId,w:room._actionToken()});
    const s=room.game.state, action=(pid,a)=>room.onAction(players.find(p=>p.id===pid).socket,a,{i:room.game.instanceId,w:room._actionToken()});
    if(id==='doodle-guess') action(s.drawer,{choose:s.choices[0]});
    if(id==='emoji-story') action(s.director,{emoji:'🌊🐟'});
    const director=s.drawer||s.actor||s.director, solver=players.find(p=>p.id!==director),other=players.find(p=>p.id!==director&&p!==solver);
    action(solver.id,{guess:s.word||s.phrase});action(solver.id,{guess:'zqxv blorp'});
    room.broadcastState();
    const guessesBefore=s.guesses.length;
    room.onAction(solver.socket,{guess:'stale bluff'},{i:'retired-instance',w:room._actionToken()});
    room.onAction(solver.socket,{guess:'stale bluff'},{i:room.game.instanceId,w:'retired-window'});
    assert.equal(s.guesses.length,guessesBefore,id+' retired transport window cannot send chat');
    const latest=p=>p.socket.frames.filter(f=>f.t==='state').at(-1);
    assert.equal(latest(solver).guesses.at(-1).text,'zqxv blorp');
    assert.equal(latest(other).totals[solver.id]||0,0,id+' live totals hide solver');
    assert(!latest(other).guessed?.[solver.id]);
    if(id!=='charades') assert.equal(latest(other).guesses.at(-1).text,'zqxv blorp');
    console.log('GUESS_CHAT_ROOM_PASS '+id);
  } finally {room.destroy();}
}

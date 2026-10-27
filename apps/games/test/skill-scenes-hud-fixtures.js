'use strict';
// Real engine projections for HUD QA. Controlled clocks avoid fixture expiry.
// PEEK only completes Number Hunt / Warm Words after initial legal feedback;
// their secret is never added to an active player/watcher projection.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const ids = ['charades','chess','countdown-word','doodle-guess','draw-phone','memory-tray','number-hunt','pose-party','reaction-tap','scattergories','show-and-go','twenty-questions','typing-race','warm-words','word-chain'];
const players = [{id:'a',name:'Ada'}, {id:'b',name:'Bo'}, {id:'c',name:'Cam'}];
const ink = {pts:[[.12,.7],[.25,.25],[.45,.6],[.66,.2],[.86,.7]],color:'#563ec8',size:8};
class Clock {
 constructor(id, settings={}) { this.id=id;this.time=1700000000000;this.timers=[];this.awards={};this.roster=players.map(p=>({...p}));this.opts={rounds:1,roundSeconds:60,hints:true,timeControl:'5 minutes',...settings}; }
 now(){return this.time} settings(){return this.opts} hostId(){return'a'}
 allPlayers(){return this.roster} players(){return this.roster} broadcast(){} lobby(){}
 content(id){const p=path.join(__dirname,'../locales/en',id+'.json');let data=fs.existsSync(p)?JSON.parse(fs.readFileSync(p,'utf8')):{};if(id==='countdown-word')data={sets:[{letters:'CHOCOLATE'.split(''),best:'chocolate'}]};return data;}
 award(pid,points){this.awards[pid]=(this.awards[pid]||0)+points}
 later(ms,fn){const t={at:this.time+ms,fn,dead:false};this.timers.push(t);return()=>t.dead=true}
 fire(){const t=this.timers.filter(t=>!t.dead).sort((a,b)=>a.at-b.at)[0];assert(t,'expected scheduled transition in '+this.id);t.dead=true;this.time=t.at;t.fn();}
 toPhase(s,phase){for(let n=0;n<12 && s.phase!==phase;n++)this.fire();assert.equal(s.phase,phase,this.id+' reached '+phase);}
}
function create(id){const ctx=new Clock(id);const game=require('../games/'+id+'/server.js');return{ctx,game,s:game.create(ctx)}}
function build(id){const run=create(id),{ctx,game,s}=run;const fixtures=[];const act=(pid,a)=>game.onAction(s,ctx,pid,a);
 const snap=(label,pid='a')=>{const state=JSON.parse(JSON.stringify(game.view(s,pid)));fixtures.push({label, state:{...state,players:ctx.roster,me:pid,you:pid,hostId:'a',instanceId:'hud-'+id,spectator:pid==='watcher',serverNow:ctx.now(),strings:{}}});};
 const watch=()=>snap('Watcher','watcher');
 if(id==='charades'){
  const actor=s.actor,guessers=players.filter(p=>p.id!==actor);snap('Actor',actor);snap('Guess',guessers[0].id);watch();act(guessers[0].id,{guess:'a thoughtful wrong guess'});snap('Feedback',guessers[0].id);act(guessers[0].id,{guess:s.word});snap('Guessed · await room',guessers[0].id);act(guessers[1].id,{guess:s.word});snap('Reveal',actor);act(actor,{next:true});
 }else if(id==='chess'){
  snap('White to move');snap('Black waiting','b');watch();act('a',{move:{from:'e2',to:'e4'}});snap('Move acknowledged');snap('Black to move','b');act('b',{resign:true});
 }else if(id==='countdown-word'){
  snap('Build');watch();act('a',{word:'late',lock:true});snap('Locked');for(const p of players.slice(1))act(p.id,{pass:true});snap('Reveal');act('a',{next:true});
 }else if(id==='doodle-guess'){
  const drawer=s.drawer,g=players.find(p=>p.id!==drawer).id;snap('Choose',drawer);watch();act(drawer,{choose:s.choices[0]});act(drawer,{stroke:ink,inkNonce:game.view(s,drawer).inkNonce,inkRevision:s.inkRevision,gestureId:1,chunk:0,finished:true});snap('Drawing',drawer);snap('Guessing',g);watch();act(g,{guess:s.word});snap('Guessed · await room',g);for(const p of players.filter(p=>p.id!==drawer&&p.id!==g))act(p.id,{guess:s.word});snap('Reveal',drawer);act(drawer,{next:true});
 }else if(id==='draw-phone'){
  snap('Write');watch();act('a',{phrase:'A tiny dragon opening a bakery'});snap('Submitted');for(const p of players.slice(1))act(p.id,{phrase:'A penguin balancing a giant birthday cake'});snap('Draw');watch();for(const p of players)act(p.id,{stroke:ink});snap('Drawing saved');ctx.toPhase(s,'guess');snap('Guess');watch();act('a',{guess:'A birthday dragon'});snap('Guessed · await room');for(const p of players.slice(1))act(p.id,{guess:'A bird carrying a cake'});snap('Reveal');for(let n=0;n<players.length+1&&s.phase!=='done';n++)act('a',{next:true});
 }else if(id==='memory-tray'){
  const seen=[...s.items];snap('Study');watch();ctx.toPhase(s,'recall');snap('Recall');watch();act('a',{recall:seen.slice(0,4).join(',')});snap('Submitted');for(const p of players.slice(1))act(p.id,{recall:seen.slice(0,2).join(',')});snap('Reveal');act('a',{next:true});
 }else if(id==='number-hunt'){
  snap('Hunt');watch();act('a',{guess:s.secret===42?43:42});snap('Temperature');act('b',{guess:s.secret});snap('Overtime');watch();act('a',{guess:s.secret});snap('Found · await room');act('c',{guess:s.secret});snap('Reveal');ctx.toPhase(s,'done');
 }else if(id==='pose-party'||id==='show-and-go'){
  const actor=s.actor||'a';snap('Perform',actor);watch();act(actor,{ready:true});snap('Ready',actor);if(id==='show-and-go')for(const p of players.slice(1))act(p.id,{ready:true});ctx.toPhase(s,'vote');const voter=players.find(p=>p.id!==s.candidates[0]).id;snap('Vote',voter);watch();act(voter,{vote:s.candidates[0],approve:true});snap('Voted',voter);for(const candidate of s.candidates)for(const p of players)if(p.id!==candidate)act(p.id,{vote:candidate,approve:true});snap('Reveal');act('a',{next:true});
 }else if(id==='reaction-tap'){
  snap('Wait');watch();act('c',{tap:true});snap('False start','c');ctx.toPhase(s,'go');snap('Go');watch();ctx.time+=240;act('a',{tap:true});snap('Tapped');ctx.time+=70;act('b',{tap:true});snap('Result');ctx.toPhase(s,'done');
 }else if(id==='scattergories'){
  snap('Write');watch();const words=Array(s.categories.length).fill(s.letter+'imple');act('a',{answers:words,lock:true});snap('Locked');for(const p of players.slice(1))act(p.id,{answers:words,lock:true});snap('Reveal');act('a',{next:true});
 }else if(id==='twenty-questions'){
  const answerer=s.answerer,gs=players.filter(p=>p.id!==answerer);snap('Secret',answerer);snap('Ask',gs[0].id);watch();act(gs[0].id,{question:'Does it belong in a home?'});snap('Question pending',gs[0].id);snap('Answer pending',answerer);act(answerer,{answer:'sometimes',qi:0});act(gs[0].id,{question:'Is it alive?'});act(answerer,{answer:'no',qi:1});act(gs[1].id,{question:'Can I hold it in one hand?'});snap('History',gs[0].id);snap('Answer',answerer);act(gs[0].id,{guess:s.word});snap('Reveal',answerer);act(answerer,{next:true});
 }else if(id==='typing-race'){
  snap('Race');watch();act('b',{typed:s.target.slice(0,Math.round(s.target.length*.4))});snap('Progress');act('a',{typed:s.target});snap('Finished · await room');for(const p of players.slice(1))act(p.id,{typed:s.target});snap('Podium');ctx.toPhase(s,'done');
 }else if(id==='warm-words'){
  snap('Search');watch();act('a',{guess:'kitchen'});snap('Temperature');ctx.time+=400;act('a',{hint:true});snap('Hint');ctx.time+=400;act('a',{guess:s.target});snap('Reveal');act('a',{next:true});
 }else if(id==='word-chain'){
  const pid=s.turnPid;snap('Your turn',pid);snap('Waiting',players.find(p=>p.id!==pid).id);watch();act(pid,{word:s.current==='apple'?'fruit':'apple'});snap('Next link',s.turnPid);act(s.turnPid,{word:''});snap('Eliminated',s.lastOut?.pid||'b');act(s.turnPid,{word:''});
 }
 assert.equal(s.phase,'done',id+' driver finishes');snap('Done');snap('Done watcher','watcher');return fixtures;
}

function accepted(id, view, pid, a) {
 switch(id) {
  case 'charades': return view.guesses?.some(g => g.pid === pid && g.text === a.guess);
  case 'chess': return view.history?.includes('e4');
  case 'countdown-word': return a.pass ? view.myLocked && !view.mine : view.mine === String(a.word || '').trim().toLowerCase() && (!a.lock || view.myLocked);
  case 'doodle-guess': return view.phase === 'draw' && view.wordShown === a.choose;
  case 'draw-phone': return view.myPhrase === a.phrase;
  case 'memory-tray': return Array.isArray(view.myRecall) && String(a.recall || '').split(',').map(w => w.trim().toLowerCase()).filter(Boolean).every(w => view.myRecall.includes(w));
  case 'number-hunt': return view.guesses?.[pid]?.includes(a.guess);
  case 'pose-party': case 'show-and-go': return view.ready?.[pid] === true;
  case 'reaction-tap': return typeof view.taps?.[pid] === 'number';
  case 'scattergories': return Array.isArray(a.answers) && a.answers.every((answer, i) => view.mine?.[i] === answer) && (!a.lock || view.myLocked);
  case 'twenty-questions': return view.questions?.some(q => q.pid === pid && q.text === a.question);
  case 'typing-race': return view.progress?.[pid] === a.typed.length;
  case 'warm-words': return view.history?.some(g => g.pid === pid && g.word === String(a.guess || '').trim().toLowerCase());
  case 'word-chain': return view.current === a.word && view.turnPid !== pid;
 }
 return false;
}
const fixtures=Object.fromEntries(ids.map(id=>[id,build(id)]));
module.exports={ids,players,fixtures,Clock,create,ink,accepted};
if(require.main===module){console.log(JSON.stringify(ids.map(id=>({id,states:fixtures[id].length,phases:[...new Set(fixtures[id].map(f=>f.state.phase))]})),null,2));}

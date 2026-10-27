'use strict';
const assert=require('node:assert/strict');
const def=require('../games/dare-roulette/server');
const ps=['a','b','c'].map(id=>({id,name:id}));
function setup(seconds,rounds=2){let time=1000,host='a';const timers=[],awards={a:700,b:200,c:50};const ctx={now:()=>time,hostId:()=>host,allPlayers:()=>ps,players:()=>ps,content:()=>({dares:['Perform a safe task']}),settings:()=>({rounds,...(seconds===undefined?{}:{dareSeconds:seconds})}),later:(ms,fn)=>timers.push({at:time+ms,fn}),broadcast(){},award:(id,n)=>awards[id]=(awards[id]||0)+n};const s=def.create(ctx);def.onAction(s,ctx,'a',{spin:true});return{s,ctx,timers,awards,setTime:t=>time=t,setHost:id=>host=id};}
for(const seconds of [undefined,10,180]){
 const x=setup(seconds),{s,ctx}=x,victim=s.victim,peer=ps.find(p=>p.id!==victim).id;
 assert.equal(s.phase,'perform');assert.equal(s.endsAt-ctx.now(),(seconds??60)*1000);
 const retired=x.timers.at(-1),snapshot=JSON.stringify(s);
 for(const pid of [peer,'watcher']){def.onAction(s,ctx,pid,{ready:true});def.onAction(s,ctx,pid,{vote:'done'});}
 assert.equal(JSON.stringify(s),snapshot,'peer/watcher cannot end performance or judge early');
 def.onAction(s,ctx,victim,{ready:true});assert.equal(s.phase,'verdict');assert.equal(s.endsAt-ctx.now(),25000);
 retired.fn();assert.equal(s.phase,'verdict','retired performance timer cannot restart verdict');
 const jurors=ps.filter(p=>p.id!==victim);def.onAction(s,ctx,jurors[0].id,{vote:'done'});
 assert.deepEqual(def.view(s,jurors[1].id,ctx).votes,{});assert.equal(def.view(s,jurors[0].id,ctx).myVote,'done');assert.equal(def.view(s,'watcher',ctx).myVote,null);
 const judgeTimer=x.timers.at(-1);def.onAction(s,ctx,jurors[1].id,{vote:'done'});assert.equal(s.phase,'reveal');assert.equal(x.awards[victim],({a:700,b:200,c:50}[victim])+100);assert.deepEqual(s.scores,{[victim]:100});const projection=def.view(s,peer,ctx);projection.scores[victim]=9999;assert.equal(s.scores[victim],100);
 judgeTimer.fn();retired.fn();assert.equal(x.awards[victim],({a:700,b:200,c:50}[victim])+100,'closed timers cannot award twice');assert.deepEqual(def.create(ctx).scores,{},'fresh match scores reset independently of cumulative awards');
 x.setHost('b');assert.equal(def.view(s,'a',ctx).hostId,'b');const outsider=ps.find(p=>p.id!=='b'&&p.id!==victim).id;def.onAction(s,ctx,outsider,{next:true});assert.equal(s.phase,'reveal','neither host nor dared player cannot skip the reveal');def.onAction(s,ctx,victim==='b'?'b':victim,{next:true});assert.equal(s.phase,'spin','the host or the dared player presses Next');
 def.onAction(s,ctx,'a',{spin:true});const second=JSON.stringify(s);retired.fn();judgeTimer.fn();assert.equal(JSON.stringify(s),second,'previous round timers cannot mutate new performance');
}
const streak=setup(10,4),first=streak.s.victim;for(let round=1;round<=4;round++){const victim=streak.s.victim;def.onAction(streak.s,streak.ctx,victim,{ready:true});for(const p of ps.filter(p=>p.id!==victim))def.onAction(streak.s,streak.ctx,p.id,{vote:'done'});def.onAction(streak.s,streak.ctx,'a',{next:true});if(round<4)def.onAction(streak.s,streak.ctx,'a',{spin:true});}assert.equal(streak.s.phase,'done');assert.equal(streak.s.scores[first],225,'second successful dare preserves25point streak bonus');assert.equal(Object.values(streak.s.scores).reduce((a,b)=>a+b,0),425);
const x=setup(60);const perform=x.timers.at(-1);x.setTime(x.s.endsAt-1);assert.equal(x.s.phase,'perform');x.setTime(x.s.endsAt);def.onAction(x.s,x.ctx,x.s.victim,{ready:true});assert.equal(x.s.phase,'verdict');assert.equal(x.s.endsAt-x.ctx.now(),25000);perform.fn();const judging=x.timers.at(-1);x.setTime(x.s.endsAt);def.onAction(x.s,x.ctx,ps.find(p=>p.id!==x.s.victim).id,{vote:'done'});assert.equal(x.s.phase,'reveal');assert.deepEqual(x.s.last.votes,{});assert.deepEqual(x.awards,{a:700,b:200,c:50});judging.fn();assert.deepEqual(x.awards,{a:700,b:200,c:50});
console.log('DARE_PERFORMANCE_PASS configured/default opportunity, actor Ready, early privacy/authority, retirement, exact-once scoring and deadlines');
(async()=>{
 const fs=require('node:fs'),path=require('node:path'),{makeDocument,surface}=require('./party-mobile');
 const data=s=>'data:text/javascript;base64,'+Buffer.from(s).toString('base64');const util=data(fs.readFileSync(path.join(__dirname,'../public/js/util.js'),'utf8'));
 const ui=(await import(data(fs.readFileSync(path.join(__dirname,'../public/js/games/dare-roulette.js'),'utf8').replace("'../util.js'",JSON.stringify(util)).replace("'../kit.js'", JSON.stringify(require('./_kit-url')(util)))))).default;
 const old=global.document;global.document=makeDocument();const el=surface(global.document),sent=[];
 const S={instanceId:'perform',phase:'perform',round:1,rounds:2,victim:'a',me:'a',hostId:'b',players:ps,dare:'A safe complete task',endsAt:61000};
 try{ui.render(el,S,{send:a=>sent.push(a)});const ready=el.querySelector('#drReady');assert(ready);assert(!el.querySelector('[data-v]'));ready.click();assert.deepEqual(sent,[{ready:true}]);const retired=ready.onclick;
 for(const role of [{me:'b'},{me:'watcher',spectator:true},{me:'a',preparing:true}]){ui.render(el,{...S,...role},{send:a=>sent.push(a)});el.querySelector('#drReady')?.click();assert.equal(sent.length,1);assert(!el.querySelector('[data-v]'));}
 ui.render(el,{...S,phase:'verdict',me:'b',voted:[]},{send:a=>sent.push(a)});assert(el.querySelector('[data-v]'));retired();assert.equal(sent.length,1);ui.dispose();retired();assert.equal(sent.length,1);
 ui.render(el,{...S,phase:'done',scores:{a:100,b:100},players:[{id:'a',name:'<Actor>'},{id:'b',name:'Peer'},{id:'c',name:'Third'}]},{send:a=>sent.push(a)});assert.deepEqual(el.querySelectorAll('.gk-rank-row').map(n=>n.querySelector('.gk-rank').textContent+'. '+n.querySelector('.gk-name').textContent),['1. <Actor> (you)','1. Peer','3. Third']);assert(el.textContent.includes("It's a tie: <Actor> and Peer"),'tied leaders are named as a tie');assert.deepEqual(el.querySelectorAll('.gk-rank-row').map(n=>n.querySelector('.gk-pts').textContent),['100 pts','100 pts','0 pts']);assert(!el.querySelector('Actor'),'player name remains text, never injected markup');assert(el.querySelector('[aria-label="Final scores"]'));
 ui.render(el,{...S,phase:'done',scores:{}},{send:a=>sent.push(a)});assert.deepEqual(el.querySelectorAll('.gk-rank-row').map(n=>n.querySelector('.gk-rank').textContent+'. '+n.querySelector('.gk-name').textContent),['1. a (you)','1. b','1. c'],'zero-point match ties all players first');assert(ui.styles.includes('/css/dare-roulette.css'));
 console.log('DARE_RENDER_PASS actor Ready, native-role markup, preparation and retired/disposed handler guards');
 }finally{ui.dispose();if(old===undefined)delete global.document;else global.document=old;}
})().catch(e=>{console.error(e);process.exitCode=1;});

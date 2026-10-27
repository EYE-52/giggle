'use strict';
const assert=require('node:assert/strict');
const def=require('../games/truth-dare/server');
const ps=['a','b','c'].map(id=>({id,name:id}));
function setup(){let time=1000,host='a';const timers=[],awards={};const ctx={now:()=>time,hostId:()=>host,allPlayers:()=>ps,players:()=>ps,content:()=>({truths:{classic:['A safe truth']},dares:{classic:['Perform for 60 seconds']}}),settings:()=>({rounds:1}),later:(ms,fn)=>timers.push({at:time+ms,fn}),broadcast(){},award:(id,n)=>awards[id]=(awards[id]||0)+n};const s=def.create(ctx);const fire=()=>{const t=timers.pop();time=t.at;t.fn();};fire();return{s,ctx,timers,awards,fire,setTime:t=>time=t,setHost:id=>host=id};}
for(const kind of ['truth','dare']){
 const x=setup(),{s,ctx}=x,target=s.target,peer=ps.find(p=>p.id!==target).id;
 def.onAction(s,ctx,target,{deck:'classic',kind});assert.equal(s.phase,'perform');assert.equal(s.endsAt-ctx.now(),60000);
 const retired=x.timers.at(-1); const snapshot=JSON.stringify(s);
 for(const pid of [peer,'watcher']){def.onAction(s,ctx,pid,{ready:true});def.onAction(s,ctx,pid,{vote:'yes'});}
 assert.equal(JSON.stringify(s),snapshot,'peers/watchers cannot close performance or judge early');
 def.onAction(s,ctx,target,{ready:true});assert.equal(s.phase,'vote');assert.equal(s.endsAt-ctx.now(),25000);
 retired.fn();assert.equal(s.phase,'vote','retired performance callback does not restart judging');
 for(const p of ps.filter(p=>p.id!==target))def.onAction(s,ctx,p.id,{vote:'yes'});
 assert.equal(s.phase,'reveal');assert.equal(s.last.targetPts,100,'a yes majority is a good round (100)');assert.equal(Object.values(x.awards).reduce((a,b)=>a+b,0),150,'target 100 plus 25 for each voter on the winning side');
 const scores=JSON.stringify(s.scores);retired.fn();assert.equal(JSON.stringify(s.scores),scores);
 x.setHost(peer);assert.equal(def.view(s,target,ctx).hostId,peer);const third=ps.find(p=>p.id!==target&&p.id!==peer).id;def.onAction(s,ctx,third,{next:true});assert.equal(s.phase,'reveal','a player who is neither host nor target cannot skip the reveal');def.onAction(s,ctx,kind==='truth'?peer:target,{next:true});assert.equal(s.phase,'done','the host or the target can press Next');
}
const x=setup();def.onAction(x.s,x.ctx,x.s.target,{deck:'classic',kind:'dare'});const end=x.s.endsAt;x.setTime(end-1);def.onAction(x.s,x.ctx,'watcher',{ready:true});assert.equal(x.s.phase,'perform');x.setTime(end);def.onAction(x.s,x.ctx,x.s.target,{ready:true});assert.equal(x.s.phase,'vote');assert.equal(x.s.endsAt,end+25000);x.setTime(x.s.endsAt);def.onAction(x.s,x.ctx,'b',{vote:'yes'});assert.equal(x.s.phase,'reveal');assert.deepEqual(x.s.last.votes,{});assert.equal(x.s.last.targetPts,0,'no votes: no verdict and no points');assert.equal(x.s.last.verdict,'none');
console.log('TRUTH_DARE_PERFORMANCE_PASS full60s opportunity, early actor Ready, peer/watcher gating, retirement, exact scores and deadlines');
(async()=>{
 const fs=require('node:fs'),path=require('node:path'); const {makeDocument,surface}=require('./party-mobile');
 const data=s=>'data:text/javascript;base64,'+Buffer.from(s).toString('base64');
 const util=data(fs.readFileSync(path.join(__dirname,'../public/js/util.js'),'utf8'));
 const ui=(await import(data(fs.readFileSync(path.join(__dirname,'../public/js/games/truth-dare.js'),'utf8').replace("'../util.js'",JSON.stringify(util)).replace("'../kit.js'", JSON.stringify(require('./_kit-url')(util)))))).default;
 const old=global.document; global.document=makeDocument(); const el=surface(global.document),sent=[];
 const S={instanceId:'perform-check',phase:'perform',round:1,rounds:1,target:'a',me:'a',hostId:'b',players:ps,prompt:'A complete safe performance prompt',deck:'classic',kind:'dare',endsAt:61000};
 try{
  ui.render(el,S,{send:a=>sent.push(a)});const ready=el.querySelector('#tReady');assert(ready);assert(!el.querySelector('[data-v]'),'actor cannot judge before Ready');ready.click();assert.deepEqual(sent,[{ready:true}]);
  const retired=ready.onclick;
  for(const role of [{me:'b'},{me:'watcher',spectator:true},{me:'a',preparing:true}]){
   ui.render(el,{...S,...role},{send:a=>sent.push(a)});const control=el.querySelector('#tReady');if(control)control.click();assert.equal(sent.length,1,'peer/watcher/preparing cannot send Ready');
  }
  ui.render(el,{...S,phase:'vote',votes:{},voted:[],me:'b'},{send:a=>sent.push(a)});retired();assert.equal(sent.length,1,'retired performance handler cannot act in judging');
  ui.dispose();retired();assert.equal(sent.length,1,'disposed Ready cannot send');
  assert(ui.styles.includes('/css/truth-dare.css'),'declared own short-height stylesheet waits through GameHost');
  console.log('TRUTH_DARE_RENDER_PASS actor Ready, peer/watcher/preparation gates, retired/disposed controls and own stylesheet declaration');
 }finally{ui.dispose();if(old===undefined)delete global.document;else global.document=old;}
})().catch(e=>{console.error(e);process.exitCode=1;});

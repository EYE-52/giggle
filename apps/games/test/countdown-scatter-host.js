'use strict';
const assert=require('node:assert/strict');
for(const id of ['countdown-word','scattergories']) {
 const game=require('../games/'+id+'/server');let host='b';const ps=['a','b'].map(id=>({id,name:id}));
 const ctx={hostId:()=>host,allPlayers:()=>ps,players:()=>ps,settings:()=>({rounds:2}),content:()=>({}),now:()=>0,later:()=>()=>{},award(){},broadcast(){}};
 const s=game.create(ctx);
 assert.equal(game.view(s,'a',ctx).hostId,'b');host='a';assert.equal(game.view(s,'b',ctx).hostId,'a');
 s.phase='reveal';const round=s.round;game.onAction(s,ctx,'b',{next:true});assert.equal(s.round,round,'departed host cannot advance');game.onAction(s,ctx,'a',{next:true});assert.equal(s.round,round+1,'elected host advances');
 assert.equal(game.view(s,'watch',ctx).hostId,'a');assert.equal(game.view(s,'watch').hostId,s.hostId,'legacy no-context fallback retained');
 if(game.dispose)game.dispose(s);
}
console.log('COUNTDOWN_SCATTER_HOST_PASS');
const game=require('../games/scattergories/server');
const ps=['a','b'].map(id=>({id,name:id}));let now=0;const timers=[];const awards={a:900,b:800};
const ctx={hostId:()=> 'a',allPlayers:()=>ps,players:()=>ps,settings:()=>({rounds:2}),content:()=>({letters:['D'],categories:['Foods','Animals','Places','Movies','Names']}),now:()=>now,later:(ms,fn)=>{timers.push(fn);return()=>{};},award:(p,n)=>awards[p]+=n,broadcast(){}};
const s=game.create(ctx);
function answer(p,words){game.onAction(s,ctx,p,{answers:s.categories.map(c=>words[c]||''),lock:true});}
answer('a',{Foods:'Doughnuts',Animals:'Dog'});answer('b',{Foods:'doughnuts',Animals:'Dolphin'});
// 40 per unique answer (rules standard: five unique answers = 200).
assert.equal(s.scores.a,40);assert.equal(s.scores.b,40);assert.equal(s.last.points.a,40,'case duplicates do not score');
game.onAction(s,ctx,'a',{next:true});answer('a',{Foods:'Dates'});answer('b',{});assert.deepEqual(s.scores,{a:80,b:40});game.onAction(s,ctx,'a',{next:true});assert.equal(s.phase,'done');assert.deepEqual(game.view(s,'watch',ctx).scores,{a:80,b:40});assert.deepEqual(game.create(ctx).scores,{},'new match does not use night awards');assert.equal(awards.a,980);
console.log('SCATTER_MATCH_SCORE_PASS');

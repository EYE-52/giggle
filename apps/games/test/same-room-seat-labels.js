'use strict';
// Actual supported party projections and renderers; no authority identity rewrite.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {FIXTURES}=require('./party-scenes-browser'),{makeDocument,surface}=require('./party-mobile');
const supported=new Set(require('../games/registry').list().filter(g=>g.sameRoom).map(g=>g.id));
const root=path.resolve(__dirname,'..'),data=s=>'data:text/javascript;base64,'+Buffer.from(s).toString('base64');
const util=data(fs.readFileSync(path.join(root,'public/js/util.js'),'utf8')),kit=require('./_kit-url')(util);
(async()=>{
 const oldDoc=global.document,oldWindow=global.window,oldSet=global.setInterval,oldClear=global.clearInterval;
 global.document=makeDocument();global.window={matchMedia:()=>({matches:true})};global.setInterval=()=>1;global.clearInterval=()=>{};
 let projections=0;
 try{
  for(const f of FIXTURES.filter(f=>supported.has(f.id))){
   const source=fs.readFileSync(path.join(root,'public/js/games/'+f.id+'.js'),'utf8').replace("'../util.js'",JSON.stringify(util)).replace("'../kit.js'",JSON.stringify(kit));
   const ui=(await import(data(source))).default;
   for(const frame of f.frames){
    const raw=frame.views.find(s=>!s.spectator&&s.me!=='watch');if(!raw)continue;
    const before=JSON.stringify(raw),S={...structuredClone(raw),sameRoom:true},el=surface(document);
    ui.dispose?.();ui.render(el,S,{send(){},now:()=>S.serverNow||0,context:()=>({sameRoom:true,isHost:true})});
    assert(!/\(you\)/i.test(el.textContent),f.id+' '+S.phase+' shared roster/results name people');
    for(const pick of el.querySelectorAll('.pl-pick,.likely-tag.is-mine'))assert(!/Your (pick|vote|answer)/i.test(pick.textContent),f.id+' shared pick label names its actor');
    if(S.phase==='reveal'&&['would-you-rather','pick-one','never-ever'].includes(f.id))assert(!el.querySelector('button[aria-pressed="true"]'),'shared reveal does not highlight the last private ballot');
    assert.equal(JSON.stringify(raw),before,'rendering does not change authority identity or private data');projections++;
   }
   ui.dispose?.();
   if(f.id==='would-you-rather'){
    const raw=f.frames.flatMap(f=>f.views).find(s=>s.phase==='vote'&&!s.spectator&&!s.myVote);
    for(const sameRoom of [true,false]){
     const el=surface(document),sent=[],S={...structuredClone(raw),sameRoom};
     ui.render(el,S,{send:a=>sent.push(a),now:()=>S.serverNow});
     assert.equal(/\(you\)/i.test(el.textContent),!sameRoom,'online roster retains its personal viewer label');
     assert.equal(el.querySelector('#wyrProgress').textContent,`${S.voted.length}/${S.players.length} voted`);
     el.querySelector('[data-v="a"]').onclick();assert.deepEqual(sent,[{vote:'a'}],'same active seat keeps a real vote action');
     const label=el.querySelector('.pl-pick:not([hidden])').textContent;
     assert(label.includes(sameRoom?S.players.find(p=>p.id===S.me).name+'’s pick':'Your pick'),'local names and online own-pick language stay distinct');
     ui.dispose();
    }
   }
  }
  // Both board presentation paths retain active-seat layout and turn styling.
  const board=await import(data(fs.readFileSync(path.join(root,'public/js/games/board-kit.js'),'utf8')));
  for(const shared of [true,false]){
   const el=surface(document),m={players:[{name:'Asha',side:'Red',you:true,shared,turn:true}],player:true};
   el.innerHTML=board.bkPanelStatic({title:'Board'},m);
   assert(el.querySelector('.bk-player.is-you.is-turn'),'shared hotseat keeps its active-seat position and turn');
   assert.equal(el.querySelector('.bk-you').getAttribute('hidden')!==null,shared);
   assert.equal(el.querySelector('.bk-turn-text').textContent,shared?'Turn':'Your turn');
   assert.equal(/, you(?:,|$)/.test(el.querySelector('.bk-player').getAttribute('aria-label')),!shared);
   el.innerHTML=board.bkPanelHTML({title:'Board'});board.bkPaint(el,m);
   assert(el.querySelector('.bk-player.is-you.is-turn'));assert.equal(el.querySelector('.bk-you').hidden,shared);
  }
  console.log('PASS shared-seat labels: '+projections+' actual supported party projections; named local picks, unchanged vote actions, online viewer controls and both board render paths');
 }finally{global.document=oldDoc;global.window=oldWindow;global.setInterval=oldSet;global.clearInterval=oldClear;}
})().catch(e=>{console.error(e);process.exitCode=1;});

'use strict';
// Real engine projections rendered by production clients. Geometry and native
// browser input are covered by party-scenes-browser.js, not this DOM stub.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { FIXTURES } = require('./party-scenes-browser');
const ROOT = path.resolve(__dirname, '..');
const dataModule = (src) => 'data:text/javascript;base64,' + Buffer.from(src).toString('base64');
const util = dataModule(fs.readFileSync(path.join(ROOT,'public/js/util.js'),'utf8'));
const { makeDocument, surface } = require('./party-mobile');
(async()=>{
  let current;
  const oldDoc=global.document,oldWindow=global.window;
  const oldSet=global.setInterval,oldClear=global.clearInterval;
  let intervals=0,clears=0;
  const doc = makeDocument();
  global.document = doc;
  global.window={matchMedia:()=>({matches:true})};
  global.setInterval=()=>{intervals++;return intervals;};
  global.clearInterval=()=>{clears++;};
  try {
    let finals=0;
    for(const f of FIXTURES){
      const src=fs.readFileSync(path.join(ROOT,'public/js/games',f.id+'.js'),'utf8').replace("'../util.js'",JSON.stringify(util)).replace("'../kit.js'",JSON.stringify(require('./_kit-url')(util)));
      const ui=(await import(dataModule(src))).default;
      const done=f.frames.find(frame=>frame.views[0].phase==='done');
      assert(done,f.id+' fixture has an actual done projection');
      for(const pid of ['p1','watch']){
        current=surface(doc);ui.dispose?.();
        const state=structuredClone(done.views.find(v=>v.me===pid));
        state.totals=Object.fromEntries(state.players.map(p=>[p.id,987654321]));
        ui.render(current,state,{send(){throw Error('Rendering cannot send an action');}});
        // Every standard game ends on the same kit Final scores block (no HUD row).
        assert(current.innerHTML.includes('gk-final')&&current.innerHTML.includes('Final scores'),f.id+' shows the kit Final scores');
        assert(!current.innerHTML.includes('gk-hud'),f.id+' final screen has no HUD row');
        assert(!current.innerHTML.includes('987654321'),f.id+' never labels night totals as game scores');
        if(state.scores)for(const p of state.players)assert(current.innerHTML.includes('>'+Number(state.scores[p.id]||0)+'</b>')||current.innerHTML.includes('"gk-pts">'+Number(state.scores[p.id]||0)+' <small')||current.innerHTML.includes('>'+Number(state.scores[p.id]||0)+' <small'),f.id+' retains authoritative match score');
        if(pid==='watch')assert(current.innerHTML.includes('Watching')||current.innerHTML.includes('watched'),f.id+' finale identifies spectator');
        ui.dispose?.();finals++;
      }
      if(f.id==='truth-dare'){
        const spin=f.frames.find(x=>x.views[0].phase==='spin');
        current=surface(doc);ui.render(current,spin.views[0],{send(){}});
        assert.equal(intervals,0,'Reduced motion shows chosen player without spinner interval');
        assert.equal(current.querySelector('#tSpin').textContent,spin.views[0].players.find(p=>p.id===spin.views[0].target).name);
        ui.dispose();
        global.window.matchMedia=()=>({matches:false});
        current=surface(doc);ui.render(current,spin.views[0],{send(){}});
        assert.equal(intervals,1,'Normal motion starts one short spinner');
        ui.dispose();assert.equal(clears,1,'Dispose cancels spinner');
      }
      if(f.id==='dare-roulette'){
        // A real no-vote deadline has no evidence that the player refused.
        const def=require('../games/dare-roulette/server');
        const players=done.views[0].players,timers=[],awards={};
        const ctx={time:1000,now(){return this.time;},players:()=>players,
          hostId:()=>players[0].id,
          allPlayers:()=>players,settings:()=>({rounds:1,dareSeconds:10}),
          content:()=>({dares:['Name three fruits']}),broadcast(){},
          later(ms,fn){timers.push(fn);},award(pid,n){awards[pid]=(awards[pid]||0)+n;}};
        const state=def.create(ctx);
        def.onAction(state,ctx,players[0].id,{spin:true});
        ctx.time=state.endsAt;timers.at(-1)();
        assert.equal(state.phase,'verdict','Performance expiry opens a separate judging window');
        assert.equal(state.endsAt-ctx.now(),25000,'No-vote judging retains its full interval');
        ctx.time=state.endsAt;timers.at(-1)();
        assert.equal(state.phase,'reveal');
        assert.equal(state.last.done+state.last.chicken,0);
        assert.deepEqual(awards,{},'No-vote deadline gives no performance award');
        for(const phase of ['reveal','done']){
          current=surface(doc);
          ui.render(current,{...def.view(state,players[0].id),players,me:players[0].id},{send(){}});
          assert.match(current.textContent,/No verdict/,'No-vote '+phase+' reports a missing verdict');
          assert.doesNotMatch(current.textContent,/chickened out|did not complete|completed the dare/i,'No-vote '+phase+' does not invent a performance outcome');
          def.onAction(state,ctx,state.hostId,{next:true});
        }
      }
    }
    const css=fs.readFileSync(path.join(ROOT,'public/css/party-scenes.css'),'utf8');
    assert.match(css,/@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?animation:\s*none\s*!important/,'Reduced motion removes scene animation');
    assert.match(css,/@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?transition:\s*none\s*!important/,'Reduced motion removes scene transitions');
    console.log('PARTY_HUD_PASS: '+finals+' player/watcher finales, match-score boundary, authoritative reduced-motion spinner and disposal');
  } finally {
    if(oldDoc===undefined)delete global.document;else global.document=oldDoc;
    if(oldWindow===undefined)delete global.window;else global.window=oldWindow;
    global.setInterval=oldSet;global.clearInterval=oldClear;
  }
})().catch(err=>{console.error(err);process.exitCode=1;});

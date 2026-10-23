'use strict';
const assert=require('node:assert/strict'),crypto=require('node:crypto');
const ludo=require('../games/ludo/server'),fleet=require('../games/fleet-duel/server');
let checks=0;
function run(def,n=2){const awards=[];const ctx={allPlayers:()=>Array.from({length:n},(_,i)=>({id:'p'+i})),award:(pid,points)=>awards.push({pid,points})};return{state:def.create(ctx),ctx,awards};}
function act(def,r,pid,a){def.onAction(r.state,r.ctx,pid,{rev:def.view(r.state,pid).actionRev??r.state.rev,...a});}
function rejects(def,r,pid,a){const old=JSON.stringify(r.state);def.onAction(r.state,r.ctx,pid,a);assert.equal(JSON.stringify(r.state),old);checks++;}
function ok(test){assert(test);checks++;}
const randomInt=crypto.randomInt;
try{
 let r=run(ludo,4);crypto.randomInt=()=>6;
 rejects(ludo,r,'watch',{roll:true,rev:0});rejects(ludo,r,'p1',{roll:true,rev:0});rejects(ludo,r,'p0',{roll:true});rejects(ludo,r,'p0',{roll:true,move:0,rev:0});
 act(ludo,r,'p0',{roll:true,die:1});ok(r.state.die===6&&r.state.phase==='move');
 rejects(ludo,r,'p0',{roll:true,rev:0});rejects(ludo,r,'p0',{move:8,rev:1});
 act(ludo,r,'p0',{move:0});ok(r.state.pawns[0][0]===0&&r.state.turn===0&&r.state.phase==='roll');
 crypto.randomInt=()=>1;act(ludo,r,'p0',{roll:true});act(ludo,r,'p0',{move:0});ok(r.state.turn===1);
 act(ludo,r,'p1',{roll:true});ok(r.state.turn===2&&r.state.lastMove.skipped);
 // Concrete capture: p0 reaches global15 where p1 has two pawns at relative2.
 r=run(ludo);ok(JSON.stringify(r.state.lanes)==='[0,2]');r.state.phase='move';r.state.die=3;r.state.pawns=[[12,-1,-1,-1],[41,41,-1,-1]];
 act(ludo,r,'p0',{move:0});ok(r.state.pawns[1].every(p=>p===-1)&&r.state.lastMove.captured.length===2);
 // Global13 is a safe start; stack survives, with no blockade preventing entry.
 r=run(ludo);r.state.phase='move';r.state.die=1;r.state.pawns=[[25,-1,-1,-1],[0,0,-1,-1]];
 act(ludo,r,'p0',{move:0});ok(r.state.pawns[1][0]===0&&r.state.lastMove.captured.length===0);
 r=run(ludo);r.state.phase='move';r.state.die=2;r.state.pawns[0]=[55,56,56,56];
 rejects(ludo,r,'p0',{move:0,rev:0});r.state.die=1;act(ludo,r,'p0',{move:0});ok(r.state.phase==='done'&&JSON.stringify(r.awards)==='[{"pid":"p0","points":300},{"pid":"p1","points":200}]');
 rejects(ludo,r,'p0',{move:0,rev:r.state.rev});
 r=run(ludo,4);act(ludo,r,'p2',{resign:true});ok(r.state.resigned.includes(2)&&r.state.turn===0);act(ludo,r,'p0',{resign:true});ok(r.state.turn===1);act(ludo,r,'p1',{resign:true});ok(r.state.result.winner===3&&r.awards.length===1&&r.awards[0].points===300);ok(JSON.stringify(ludo.view(r.state,'w').places.map(p=>[p.pid,p.rank,p.points,p.out]))==='[["p3",1,300,false],["p1",2,0,true],["p0",3,0,true],["p2",4,0,true]]');
 // Full initial-position race: the test replaces ONLY the server random source.
 r=run(ludo);crypto.randomInt=()=>{const p=r.state.pawns[r.state.turn];if(p.some(x=>x===-1))return 6;const lead=Math.max(...p.filter(x=>x<56));return Math.min(6,56-lead);};
 let steps=0;while(r.state.phase!=='done'&&steps++<1000){const pid=r.state.seats[r.state.turn];if(r.state.phase==='roll')act(ludo,r,pid,{roll:true});else{const moves=ludo.view(r.state,pid).legal;const pawn=moves.sort((a,b)=>r.state.pawns[r.state.turn][b]-r.state.pawns[r.state.turn][a])[0];act(ludo,r,pid,{move:pawn});}}
 ok(r.state.phase==='done'&&r.awards.length===2&&r.awards.find(a=>a.pid===r.state.result.winnerPid).points===300&&r.state.pawns[r.state.result.winner].every(p=>p===56));
 crypto.randomInt=randomInt;
 r=run(fleet);rejects(fleet,r,'watch',{auto:true,rev:0});rejects(fleet,r,'p0',{auto:true});rejects(fleet,r,'p0',{place:{ship:0,at:8,vertical:false},rev:0});
 act(fleet,r,'p0',{place:{ship:0,at:0,vertical:false}});ok(r.state.fleets[0][0].at===0);
 rejects(fleet,r,'p0',{place:{ship:1,at:2,vertical:false},rev:1});rejects(fleet,r,'p0',{place:{ship:1,at:95,vertical:true},rev:1});rejects(fleet,r,'p0',{ready:true,rev:1});
 ok(!JSON.stringify(fleet.view(r.state,'p1')).includes('"at"')&&!JSON.stringify(fleet.view(r.state,'watch')).includes('"at"'));
 ok(fleet.view(r.state,'p1').lastMove===null&&fleet.view(r.state,'watch').ownFleet.length===0);
 act(fleet,r,'p0',{undo:0});ok(r.state.fleets[0][0]===null);
 act(fleet,r,'p0',{auto:true});act(fleet,r,'p1',{auto:true});
 for(const side of [0,1]){const v=fleet.view(r.state,'p'+side),cells=v.ownFleet.flatMap(s=>Array.from({length:s.length},(_,i)=>s.at+i*(s.vertical?10:1)));ok(cells.length===17&&new Set(cells).size===17&&cells.every(c=>c>=0&&c<100));}
 const aRev=fleet.view(r.state,'p0').actionRev,bRev=fleet.view(r.state,'p1').actionRev;
 fleet.onAction(r.state,r.ctx,'p0',{ready:true,rev:aRev});fleet.onAction(r.state,r.ctx,'p1',{ready:true,rev:bRev});ok(r.state.phase==='play');
 rejects(fleet,r,'p0',{auto:true,rev:r.state.rev});rejects(fleet,r,'p1',{fire:0,rev:r.state.rev});rejects(fleet,r,'p0',{fire:100,rev:r.state.rev});
 const hit=fleet.view(r.state,'p1').ownFleet[0].at,old=r.state.rev;
 act(fleet,r,'p0',{fire:hit});ok(r.state.shots[0][hit]===2&&r.state.turn===1);
 rejects(fleet,r,'p0',{fire:hit,rev:old});act(fleet,r,'p1',{fire:99});rejects(fleet,r,'p0',{fire:hit,rev:r.state.rev});
 const hidden=fleet.view(r.state,'watch');ok(hidden.publicFleets.every(f=>f.length===0)&&hidden.lastMove.at===99);
 // Full initial-position match: confirmed placement, alternating blind shots.
 r=run(fleet);for(const side of [0,1])for(let ship=0;ship<5;ship++)act(fleet,r,'p'+side,{place:{ship,at:ship*20,vertical:false}});
 act(fleet,r,'p0',{ready:true});act(fleet,r,'p1',{ready:true});
 const cursor=[0,0];steps=0;while(r.state.phase==='play'&&steps++<200){const side=r.state.turn;act(fleet,r,'p'+side,{fire:cursor[side]++});const v=fleet.view(r.state,'watch');for(let s=0;s<2;s++)for(const ship of v.publicFleets[s])ok(ship.sunk&&Array.from({length:ship.length},(_,i)=>ship.at+i*(ship.vertical?10:1)).every(c=>r.state.shots[1-s][c]===2));}
 ok(r.state.phase==='done'&&r.state.result.winner===0&&r.awards.length===1&&r.awards[0].points===300);
 rejects(fleet,r,'p0',{fire:99,rev:r.state.rev});
 r=run(fleet);act(fleet,r,'p0',{auto:true});act(fleet,r,'p0',{resign:true});ok(r.state.result.winner===1&&fleet.view(r.state,'p1').enemyFleet.length===0&&fleet.view(r.state,'watch').publicFleets[0].length===0);
 const clone=fleet.view(r.state,'p0');clone.ownFleet[0].at=99;ok(r.state.fleets[0][0].at!==99);
 // Standard rules. Ludo: places 300/200/100/0 by progress, ties share a place;
 // a timed-out or gone player drops out and the rest play on.
 function timedRun(def,n,settings){const r=run(def,n);r.t=1000;r.ctx.now=()=>r.t;r.ctx.settings=()=>settings;r.ctx.broadcast=()=>{r.broadcasts=(r.broadcasts||0)+1;};r.state=def.create(r.ctx);return r;}
 for(const def of [ludo,fleet]){const m=def.manifest.settings.find(x=>x.key==='moveTimer');ok(m&&m.def==='Off'&&m.options.join()==='Off,30 seconds,60 seconds');}
 r=run(ludo,4);r.state.pawns=[[56,56,56,55],[10,10,-1,-1],[20,0,-1,-1],[19,-1,-1,-1]];r.state.phase='move';r.state.die=1;act(ludo,r,'p0',{move:3});
 ok(JSON.stringify(ludo.view(r.state,'w').places.map(p=>[p.pid,p.rank,p.points]))==='[["p0",1,300],["p1",2,200],["p2",2,200],["p3",4,0]]');
 ok(JSON.stringify(ludo.view(r.state,'w').scores)==='{"p0":300,"p1":200,"p2":200,"p3":0}');
 r=timedRun(ludo,3,{moveTimer:'30 seconds'});ok(r.state.endsAt===31000);
 crypto.randomInt=()=>2;r.t+=5000;act(ludo,r,'p0',{roll:true});ok(r.state.turn===1&&r.state.endsAt===36000);crypto.randomInt=randomInt;
 r.t+=30000;ludo.onTick(r.state,r.ctx);ok(r.state.resigned.includes(1)&&r.state.outReason[1]==='timeout'&&r.state.turn===2&&r.state.phase==='roll'&&r.state.endsAt===r.t+30000&&r.broadcasts===1);
 ok(ludo.onPlayerGone(r.state,r.ctx,'w')===false);
 ok(ludo.onPlayerGone(r.state,r.ctx,'p0')===true&&r.state.phase==='done'&&r.state.result.winnerPid==='p2'&&r.state.result.reason==='forfeit');
 ok(JSON.stringify(r.awards)==='[{"pid":"p2","points":300}]');
 r=run(ludo,3);ok(ludo.onPlayerGone(r.state,r.ctx,'p1')&&r.state.phase==='roll'&&r.state.turn===0);ok(ludo.onPlayerGone(r.state,r.ctx,'p1')===false);
 // Fleet Duel: resign only (no draws), shot timer, forfeit in any phase.
 r=run(fleet);rejects(fleet,r,'p0',{offerDraw:true,rev:0});
 ok(fleet.onPlayerGone(r.state,r.ctx,'p1')&&r.state.result.winnerPid==='p0'&&r.state.result.reason==='forfeit'&&r.awards[0].points===300);
 r=timedRun(fleet,2,{moveTimer:'60 seconds'});ok(r.state.endsAt===null,'no timer while placing');
 act(fleet,r,'p0',{auto:true});act(fleet,r,'p1',{auto:true});act(fleet,r,'p0',{ready:true});act(fleet,r,'p1',{ready:true});ok(r.state.phase==='play'&&r.state.endsAt===61000);
 r.t+=10000;act(fleet,r,'p0',{fire:0});ok(r.state.turn===1&&r.state.endsAt===71000);
 r.t+=60000;fleet.onTick(r.state,r.ctx);ok(r.state.result.reason==='timeout'&&r.state.result.winnerPid==='p0'&&JSON.stringify(fleet.view(r.state,'w').scores)==='{"p0":300,"p1":0}');
 console.log('LUDO_FLEET_PASS:',checks,'rule, privacy, race, conservation and full initial-position match assertions');
}finally{crypto.randomInt=randomInt;}

'use strict';
const assert=require('node:assert/strict');
const {createBlockSiege,supported,rectangleUnionArea,standingPieces,firstHit,segmentBox,castlePositions}=require('../games/engines/block-siege');
const castle=require('../games/castle-clash/server');
function rig(n=2,settings={rounds:1},config={}){
  const players=Array.from({length:n},(_,i)=>({id:'p'+i,name:'Player '+i,connected:true})),timers=[];
  let now=100000,seq=0;const awards={};
  const ctx={now:()=>now,allPlayers:()=>players,players:()=>players.filter(p=>p.connected),settings:()=>settings,broadcast(){},award(pid,points){awards[pid]=(awards[pid]||0)+points;},later(ms,fn){const t={at:now+ms,fn,cancelled:false};timers.push(t);return()=>{t.cancelled=true;};}};
  const game=createBlockSiege({...castle.CASTLE_CONFIG,...config}),state=game.create(ctx);
  function advance(ms){const end=now+ms;let count=0;while(true){const t=timers.filter(t=>!t.cancelled&&t.at<=end).sort((a,b)=>a.at-b.at)[0];if(!t)break;t.cancelled=true;now=t.at;t.fn();assert(++count<10000,'no timer loop');}now=end;}
  const act=(pid,type,data={})=>game.onAction(state,ctx,pid,{[type]:{...data,nonce:data.nonce||'n'+(++seq)}});
  const place=(pid,card,x,y,z,rotation=0)=>act(pid,'place',{card,x,y,z,rotation});
  const ready=()=>players.forEach(p=>act(p.id,'ready',{value:true}));
  const fire=(pid,target,weapon='ballista',x=0,y=.9,z=0)=>act(pid,'fire',{target,weapon,x,y,z});
  return{game,state,ctx,players,timers,awards,advance,act,place,ready,fire,now:()=>now};
}
function piece(id,x,y,z,w=1,h=1,d=1,hp=65){return{id,x,y,z,w,h,d,hp,maxHp:hp,card:'cube',material:'stone'};}
function run(){
  { const r=rig(); const flat=s=>JSON.stringify(s,(k,v)=>typeof v==='function'?'[fn]':v); const before=flat(r.state); for (const a of [{},[],{zzz_nope:1},{vote:{}},{next:0},{tap:0},{place:[]}]) { r.game.onAction(r.state,r.ctx,'p0',a); r.game.onAction(r.state,r.ctx,'ghost',a); } assert.equal(flat(r.state),before,'garbage actions leave authority and timer token inert'); r.game.dispose(r.state); }
  assert.equal(rectangleUnionArea([{x0:0,x1:2,z0:0,z1:2},{x0:1,x1:3,z0:0,z1:2}]),6,'union never double-counts overlap');
  const beam=piece('beam',0,1,0,2,1,1);
  assert(supported(beam,[piece('under',0,0,0)]),'center supported at 50%');
  assert(!supported(beam,[piece('edge',-.9,0,0,.5,1,1)]),'edge does not support center');
  assert(!supported(piece('big',0,1,0,2,1,2),[piece('tiny',0,0,0,.5,1,.5)]),'center alone is not enough area');
  assert.deepEqual(standingPieces([piece('top',0,2,0),piece('base',0,0,0),piece('mid',0,1,0)]).map(p=>p.id),['base','mid','top']);
  assert.equal(segmentBox({x:-10,y:.5,z:0},{x:10,y:.5,z:0},{x0:-.01,x1:.01,y0:0,y1:1,z0:-1,z1:1}),.4995,'thin wall swept without tunneling');
  for(const n of [2,3,4]){const positions=castlePositions(n);assert.equal(positions.length,n);assert.equal(new Set(positions.map(p=>p.x+','+p.z)).size,n);}
  {
    const r=rig(),c=r.state.castles[0],starting=c.hand.cube;
    r.place('p0','cube',2,.5,0);assert.equal(c.hand.cube,starting-1);assert.equal(c.pieces.length,5);
    r.place('p0','beam',2,1.5,0,1);assert.equal(c.pieces.length,6);assert.equal(c.pieces[5].w,1);assert.equal(c.pieces[5].d,2);
    const hand=JSON.stringify(c.hand),count=c.pieces.length;
    for(const args of [['cube',2,.5,0],['cube',5.5,12,0],['beam',6,0,4],['slab',4,3,4],['cube',0,0,0],['cube',4.2,0,3]])r.place('p0',...args);
    assert.equal(c.pieces.length,count,'overlap/height/zone/unsupported/Crown/non-snap rejected');assert.equal(JSON.stringify(c.hand),hand);
    r.act('p1','remove',{piece:c.pieces[4].id});assert.equal(c.pieces.length,count,'other castle cannot remove actor piece');
    r.act('watcher','place',{card:'cube',x:4,y:0,z:4,rotation:0});assert.equal(c.pieces.length,count,'watcher cannot build');
    const base=c.pieces[4].id;r.act('p0','remove',{piece:base});assert.equal(c.pieces.length,4,'removal cascades dependencies');assert.equal(c.hand.cube,starting);assert.equal(c.hand.beam,8,'construction collapse refunds once');
    const collapse=r.state.events.find(e=>e.type==='collapse');assert.equal(collapse.pieces.length,1);r.act('p0','remove',{piece:base,nonce:'again'});assert.equal(c.hand.beam,8);
    r.act('p0','remove',{piece:c.crown.id});assert(c.crown.hp===120,'Crown protected from remove');r.act('p0','remove',{piece:c.pieces[0].id});assert.equal(c.pieces.length,4,'default foundations cannot remove');
    c.hand.cube=1;r.act('p0','place',{card:'cube',x:4,y:0,z:4,rotation:0,nonce:'last1'});r.act('p0','place',{card:'cube',x:5,y:0,z:4,rotation:0,nonce:'last2'});assert.equal(c.hand.cube,0);assert.equal(c.pieces.length,5,'last card is spent atomically');
    r.act('p0','place',{card:'cube',x:4,y:0,z:4,rotation:0,nonce:'last1'});assert.equal(c.pieces.length,5,'replay no duplicate');
    r.act('p0','undo');assert.equal(c.hand.cube,1);r.act('p0','undo');assert.equal(c.hand.cube,1,'undo cannot refund twice');
    const view=r.game.view(r.state,'p0');view.mine.hand.cube=999;assert.equal(c.hand.cube,1,'view does not leak mutable authority');assert.equal(r.game.view(r.state,'watcher').mine,null);
    r.game.dispose(r.state);assert(r.timers.every(t=>t.cancelled),'disposal clears all wakeups');
  }
  {
    const r=rig(3);r.act('p0','ready',{value:true});r.act('p1','ready',{value:true});assert.equal(r.state.phase,'build','all living connected must explicitly ready');
    r.players[2].connected=false;r.advance(500);assert.equal(r.state.phase,'siege','disconnected seat no longer blocks ready');r.players[2].connected=true;assert.equal(r.state.castles[2].pid,'p2');r.fire('p2','p0');assert.equal(r.state.pending.length,1,'reconnect retains castle and control');
  }
  {
    const r=rig(),target=r.state.castles[1];r.place('p1','pillar',0,.5,2);r.place('p1','beam',0,2.5,2);
    r.ready();r.fire('p0','p1','rocket',0,1,0);assert.equal(r.state.pending.length,1);
    const shot=r.state.pending[0];assert.equal(shot.predictedHit.crown,false,'aiming Crown first hits its defense');assert.equal(shot.predictedHit.piece,target.pieces[4].id);const hand=JSON.stringify(target.hand);
    assert.equal(target.pieces[4].hp,35,'damage delayed during visible flight');r.advance(shot.impactAt-r.now());assert.equal(target.pieces.length,4,'destroyed pillar collapses beam');assert.equal(JSON.stringify(target.hand),hand,'siege rubble refunds no hand');
    const collapses=r.state.events.filter(e=>e.type==='collapse');assert.equal(collapses.length,1);assert.equal(collapses[0].pieces.length,1);assert(target.crown.hp>=102,'direct damage never bypasses defense; only bounded splash may reach Crown');
    r.advance(4000);assert.equal(r.state.events.filter(e=>e.type==='collapse').length,1,'cascade exactly once');
    r.game.dispose(r.state);
  }
  {
    const r=rig();r.ready();const c=r.state.castles[0];r.fire('p0','p1');const ammo=c.ammo.ballista;
    r.fire('p0','p1');assert.equal(c.ammo.ballista,ammo,'double Fire cooldown refused');assert.equal(r.state.pending.length,1);
    const event=r.state.events.find(e=>e.type==='shot');assert.equal(typeof event.id,'number');assert.equal(event.shot.id,'shot-1');
    r.act('p0','fire',{target:'p0',weapon:'rocket',x:0,y:.9,z:0});assert.equal(c.ammo.rocket,2,'friendly fire denied');
    r.act('p0','fire',{target:'p1',weapon:'rocket',x:99,y:.9,z:0});assert.equal(c.ammo.rocket,2,'out-of-bounds aim denied');
    r.advance(5000);assert.equal(c.ammo.ballista,8,'ballista refills automatically, even idle');
    r.game.dispose(r.state);
  }
  {
    const r=rig(),a=r.state.castles[0],b=r.state.castles[1];a.pieces=[];b.pieces=[];a.crown.hp=b.crown.hp=34;r.ready();r.fire('p0','p1');r.fire('p1','p0');
    const end=Math.max(...r.state.pending.map(s=>s.impactAt));r.advance(end-r.now());assert.equal(a.crown.hp,0);assert.equal(b.crown.hp,0);assert.equal(r.state.phase,'resolving','simultaneous lethal impacts both resolve');assert.equal(r.state.result,null,'animation tail precedes result');
    r.advance(1000);assert.equal(r.state.phase,'done');assert.equal(r.state.roundResult.winners.length,0);assert.equal(r.state.roundResult.reason,'All Crowns fell — draw');
    const awards={...r.awards};r.advance(200000);for(const t of r.timers)t.fn();assert.deepEqual(r.awards,awards,'result and score once');
  }
  {
    const r=rig(),a=r.state.castles[0],b=r.state.castles[1];a.pieces=[];b.pieces=[];b.crown.hp=34;r.ready();r.fire('p0','p1');r.advance(4000);assert.equal(r.state.phase,'done');assert.deepEqual(r.state.result.winners,['p0']);assert.equal(r.state.roundResult.reason,'Last Crown standing');assert.equal(r.state.endsAt,0);
  }
  {
    const r=rig();r.ready();r.advance(90000);assert.equal(r.state.phase,'resolving');r.advance(1000);assert.equal(r.state.phase,'done');assert.deepEqual(r.state.result.winners,['p0','p1'],'health/height/damage equality shared match');
  }
  {
    // A later projectile keeps its fixed path through a newly opened gap.
    const r=rig(),target=r.state.castles[1];target.pieces=[];
    target.pieces.push(piece('guard',0,0,4,1,10,1,35));
    r.ready();r.fire('p0','p1','mortar',0,1,0);
    const mortar=r.state.pending[0];assert.equal(mortar.predictedHit.piece,'guard','slow shot originally headed into guard');const oldPath=JSON.stringify([mortar.start,mortar.target,mortar.arc]);
    r.advance(100);r.fire('p0','p1','rocket',0,1,4);
    const rocket=r.state.pending.find(s=>s.weapon==='rocket');
    r.advance(rocket.impactAt-r.now()+2);assert(!target.pieces.some(p=>p.id==='guard'),'fast rocket destroys slow shot blocker first');
    r.advance(mortar.endAt-r.now()+2);assert.equal(JSON.stringify([mortar.start,mortar.target,mortar.arc]),oldPath,'fixed flight path unchanged');
    assert(r.state.events.some(e=>e.type==='impact'&&e.shot===mortar.id&&e.hits.some(h=>h.crown)),'slow shot sweeps into exposed Crown later');
    assert.equal(r.state.events.filter(e=>e.type==='impact'&&e.shot===mortar.id).length,1,'moving shot resolves once');
    r.game.dispose(r.state);
  }
  {
    // A surviving first blocker takes direct pressure and stops the flight.
    const r=rig(),target=r.state.castles[1];target.pieces=[piece('guard',0,0,3,1,3,1,95)];r.ready();r.fire('p0','p1');r.advance(3000);
    assert.equal(target.pieces[0].hp,61);assert.equal(target.crown.hp,120);r.game.dispose(r.state);
  }
  {
    // Splash uses real segment occlusion, and never damages the shooter's castle.
    const r=rig(),target=r.state.castles[1];target.pieces=[];
    target.pieces.push(piece('direct',1,0,2,1,2,1,95),piece('shield',0,0,1,1,2,1,95));
    r.ready();r.fire('p0','p1','rocket',1,1,2);r.advance(3000);
    const impact=r.state.events.find(e=>e.type==='impact');assert(impact.hits.some(h=>h.piece==='direct'));assert(!impact.hits.some(h=>h.crown),'intervening shield blocks Crown splash');assert.equal(r.state.castles[0].crown.hp,120,'friendly splash disabled');r.game.dispose(r.state);
  }
  for(const n of [2,3,4]){
    const r=rig(n,{rounds:3});
    for(let round=1;round<=3;round++){
      assert.equal(r.state.round,round);assert.equal(r.state.phase,'build');
      for(let i=0;i<n;i++)r.place('p'+i,'cube',2,.5,0);
      r.ready();assert.equal(r.state.phase,'siege');
      for(let i=0;i<n;i++)r.fire('p'+i,'p'+((i+1)%n),'ballista',0,.9,0);
      r.advance(4000);assert(r.state.events.some(e=>e.type==='impact'&&e.round===round));
      r.advance(86000);assert.equal(r.state.phase,'resolving');r.advance(1000);
      if(round<3){assert.equal(r.state.phase,'round-result');r.advance(3500);}else assert.equal(r.state.phase,'done');
    }
    assert.equal(Object.keys(r.awards).length,n);assert(r.state.events.every((e,i,a)=>!i||e.id>a[i-1].id),'monotonic events through every round');r.game.dispose(r.state);
  }
  console.log('BLOCK_SIEGE_PASS: 2/3/4 player full matches, support, first-hit, inventory, readiness, clocks, replay, lethal settlement, scoring and disposal');
}
module.exports={run,rig,piece};if(require.main===module)run();

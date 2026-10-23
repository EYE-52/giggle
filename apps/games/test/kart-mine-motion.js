// Planar-mutating unit fixtures use an explicit generic variant, not physical Pocket.
'use strict';
// Real-engine regression for a legitimately dropped mine and authoritative
// movement that crosses its trigger between sampled endpoints.
const assert = require('node:assert/strict');
const game = require('./fixtures/kart-planar-variant.cjs');
function fixture() {
  let now = 1000000;
  const players = [{id:'p0',name:'Layer'},{id:'p1',name:'Rival'}];
  let connected = players;
  const wallet = {};
  const ctx = {now:()=>now,settings:()=>({mode:'Garage Battle',map:'Rookie Ring'}),players:()=>connected,allPlayers:()=>players,session:()=>wallet,broadcast(){},award(){},later:()=>()=>{}};
  const s = game.create(ctx);
  const tick = ms=>{now+=ms;game.onTick(s,ctx);};
  tick(3000);
  for(const c of s.crates){c.x=24;c.z=24;}
  const [owner,rival]=s.karts;
  rival.health=1; // Wounded fast-crossing/KO contract; default100 acceptance is separate.
  Object.assign(owner,{x:0,z:2,angle:0,speed:0,shield:0,weapon:'mine',ammo:1});
  Object.assign(rival,{x:-20,z:-20,speed:0,shield:0});
  game.onAction(s,ctx,'p0',{input:{steer:0,throttle:0,boost:true}});tick(100);
  assert.equal(s.mines.length,1,'accepted drop produces one trap');
  Object.assign(owner,{x:20,z:20,speed:0});
  game.onAction(s,ctx,'p0',{input:{steer:0,throttle:0}});
  for(let i=0;i<8;i++)tick(100);
  assert(s.mines[0].armed,'trap arms before the crossing');
  const cross=(overrides={},ms=250)=>{
    Object.assign(rival,{x:0,z:-2.5,angle:0,speed:22.4,boost:1,shield:0},overrides);
    game.onAction(s,ctx,'p1',{input:{steer:0,throttle:1}});
    tick(ms);
  };
  return {s,ctx,wallet,owner,rival,tick,cross,offline:()=>{connected=[players[0]];}};
}
for(const ms of [250,1000]){
  const f=fixture();f.cross({},ms);
  assert(f.rival.z>2.2,'both sampled endpoints lie outside trigger');
  assert.equal(f.owner.hits,1,'fast crossing must trigger');
  assert.equal(f.rival.respawn,2,'victim is knocked out');
  assert.equal(f.s.mines.length,0,'trap consumed');
  assert.equal(f.wallet.coins.p0,10,'KO awarded once');
  f.tick(100);assert.equal(f.owner.hits,1);assert.equal(f.wallet.coins.p0,10);
}
for(const overrides of [{x:2.2},{x:2.21},{shield:2},{respawn:1}]){
  const f=fixture();f.cross(overrides);assert.equal(f.owner.hits,0,'near miss/protected/KO does not trigger');assert.equal(f.s.mines.length,1);
}
{
  const f=fixture();f.offline();f.cross();assert.equal(f.owner.hits,0,'offline kart does not trigger');
}
for(const [arm,expected] of [[.14,1],[.23,0]]){
  const f=fixture();Object.assign(f.s.mines[0],{armed:false,armT:arm});f.cross();assert.equal(f.owner.hits,expected,'only armed portion of path can trigger');
}
for(const [ttl,expected] of [[.01,0],[.08,1]]){
  const f=fixture();f.s.mines[0].ttl=ttl;f.cross();assert.equal(f.owner.hits,expected,'only alive portion of path can trigger');assert.equal(f.s.mines.length,0);
}
{
  const f=fixture();Object.assign(f.owner,{x:0,z:0,shield:0});f.tick(100);assert.equal(f.owner.respawn,0,'owner can drive over own trap');assert.equal(f.s.mines.length,1);
}
console.log('KART_MINE_MOTION_PASS: accepted drop, sampled crossing/hitch, exact-once economy, timing and immunity');

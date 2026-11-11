// Historical filename: current 100 HP and rarity rules on the real planar authority.
'use strict';
const assert=require('node:assert/strict');
(async()=>{
 const {fixture}=await import('./helpers/kart-planar-combat-fixture.mjs');const {config,weaponForRoll}=require('../games/engines/kart-combat-config');
 assert.equal(config.maxHealth,100);const counts={};for(let i=0;i<10000;i++){const id=weaponForRoll(i/10000);counts[id]=(counts[id]||0)+1;assert(config.weapons[id]);}
 assert.equal(Object.keys(counts).length,12);let common=0,rare=0;for(const [id,n]of Object.entries(counts)){if(config.weapons[id].tier==='common')common+=n;if(config.weapons[id].tier==='rare')rare+=n;}assert.equal(common,5200);assert.equal(rare,500);
 const f=fixture();f.b.health=5;f.arm('machinegun');for(let i=0;i<20;i++)f.step(.05);assert.equal(f.b.health,0);assert.equal(f.a.hits,1);const life=f.b.spawnSeq;for(let i=0;i<45;i++)f.step(.05);assert.equal(f.b.health,100);assert.equal(f.b.spawnSeq,life+1);assert(f.b.shield>0);assert.equal(f.b.weapon,null);assert.equal(f.b.ammo,0);
 console.log('KART_HEARTS_WEAPONS_PASS: 100 HP, twelve-item odds, KO and protected full-HP respawn');
})().catch(e=>{console.error(e);process.exitCode=1;});

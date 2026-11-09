'use strict';
// Performance fixture only. Invoke real authority helpers at known times so
// pickup/blast/KO frame windows are repeatable without random loot luck.
// No production module or map definition is changed on disk.
const Module=require('node:module'),compile=Module.prototype._compile;
Module.prototype._compile=function(source,file){
 if(file.endsWith('/kart-elevated-combat.js'))source=source.replace('  function dispose() {',`  global.__kartPerfScenario = command => {
   const seats=[...karts.values()];
   if(command==='ko'){for(const k of seats.slice(1)){k.shield=0;knockOut(k,seats[0].id,'nuke');}return;}
   if(!COMBAT.weapons[command])throw Error('Unknown weapon: '+command);
   for(const k of seats)if(k.alive){clean(k);k.weapon=command;k.ammo=COMBAT.weapons[command].ammo||1;k.fireCd=0;emit('pickup',k.id,{weapon:command,position:physics.pose(k.id).position});}
  };
  function dispose() {`);
 if(file.endsWith('/kart-rules-battle.js'))source+=`\nmodule.exports.__kartPerfScenario=(state,command)=>{
  if(command==='ko'){for(const k of state.karts.slice(1))if(k.respawn<=0)knockOut(state,k,state.karts[0].pid,'nuke');return;}
  if(!COMBAT.weapons[command])throw Error('Unknown weapon: '+command);
  for(const k of state.karts)if(k.respawn<=0){cancelPayload(k);resetFireInput(k);k.weapon=command;k.ammo=COMBAT.weapons[command].ammo||1;k.fireCd=0;k.prevAction=false;pushEvent(state,'pickup',k.pid,undefined,command);}
 };`;
 return compile.call(this,source,file);
};
const {Rooms}=require('../../server/room'),create=Rooms.prototype.create;let room;
Rooms.prototype.create=function(...args){return room=create.apply(this,args);};
process.on('message',({command,id})=>{try{
 const state=room?.game?.state;if(!state)throw Error('No game state');
 if(state.profile)global.__kartPerfScenario(command);else require('../../games/engines/kart-rules-battle').__kartPerfScenario(state,command);
 process.send({id,ok:true});
}catch(error){process.send({id,ok:false,error:error.message});}});
require('../../server/server');

import {weaponThumbnailArt} from './kart-assets.mjs';
import {normalizeWeapon,WEAPON_IDS} from './kart-weapon-contract.mjs';

// One name and heart cost per weapon; the how-to and HUD read the same list.
export const KART_WEAPON_INFO=Object.freeze({
 machinegun:{name:'Machine Gun',hearts:1},trishot:{name:'Tri-Shot',hearts:1},missile:{name:'Homing Missile',hearts:2},
 cannon:{name:'Cannon',hearts:2},blades:{name:'Spinning Blades',hearts:1},supernova:{name:'Supernova',hearts:2},
 mine:{name:'Mine',hearts:1},oil:{name:'Oil Slick',hearts:1},frost:{name:'Frost Bomb',hearts:1},
 thunder:{name:'Thunder Strike',hearts:1},boomerang:{name:'Boomerang',hearts:1},ram:{name:'Turbo Ram',hearts:1},nuke:{name:'Nuke',hearts:3},
});
const NAMES=Object.fromEntries(Object.entries(KART_WEAPON_INFO).map(([id,v])=>[id,v.name]));

// Both kart renderers present the authority's inventory, never a predicted
// pickup or a reusable clip. Remaining rounds describe an accepted sequence.
export function kartWeaponDisplay(kart){
  if(!kart||kart.alive===false||kart.respawn>0)return {kind:'crate',label:'No weapon',detail:'',count:'',state:'away'};
  const kind=normalizeWeapon(kart.weapon),ammo=Math.max(0,Math.floor(kart.ammo||0));
  if(NAMES[kind]&&ammo>0){
    const deploying=['mine','oil'].includes(kind);
    return {kind,label:NAMES[kind],detail:kart.firing?(deploying?'Deploying':'Firing'):'Ready',count:`×${ammo}`,state:kart.firing?'firing':'ready'};
  }
  if(kart.supernovaT>0)return {kind:'supernova',label:'Supernova',detail:'Protected · blast soon',count:`${Math.ceil(kart.supernovaT)}s`,state:'active'};
  if(kart.bladesT>0)return {kind:'blades',label:'Spinning Blades',detail:'Active',count:`${Math.ceil(kart.bladesT)}s`,state:'active'};
  if(kart.shield>0)return {kind:'shield',label:'Spawn protection',detail:'Active',count:`${Math.ceil(kart.shield)}s`,state:'protected'};
  return {kind:'crate',label:'No weapon',detail:'Find a pickup',count:'',state:'empty'};
}

export function paintKartWeapon(element,kart,fallback,{hint=false,roulette=null}={}){
  const value=roulette?.display(kart)||kartWeaponDisplay(kart);
  const art=weaponThumbnailArt(value.kind,fallback),thumbnail=art.startsWith('<img ');
  const key=[value.kind,value.state,value.count,hint,thumbnail].join('|');
  if(element.dataset.equipKey===key)return value;
  if(!element.firstElementChild){
    element.innerHTML='<span class="kart-item-art" aria-hidden="true"></span><span class="kart-item-copy"><strong></strong><small></small></span><b class="kart-item-count"></b><kbd class="kart-item-key" hidden>Space</kbd>';
  }
  if(element.dataset.weapon!==value.kind||element.dataset.thumbnail!==String(thumbnail)){
    element.querySelector('.kart-item-art').innerHTML=art;
    element.dataset.thumbnail=String(thumbnail);
    element.dataset.weapon=value.kind;
  }
  element.querySelector('strong').textContent=value.label;
  element.querySelector('small').textContent=value.detail;
  element.querySelector('.kart-item-count').textContent=value.count;
  element.querySelector('kbd').hidden=!hint||!['ready','roulette'].includes(value.state);
  element.dataset.state=value.state;
  element.dataset.equipKey=key;
  element.setAttribute('aria-label',[value.label,value.detail,value.count].filter(Boolean).join(', '));
  return value;
}

export const PICKUP_ROULETTE_MS=520;
// A presentation-only reveal. The real item is usable from its pickup tick.
// Existing scene frames drive it; there are no extra timers or input locks.
export function createKartWeaponRoulette({now=()=>performance.now(),reducedMotion=()=>false}={}){
 let at=-Infinity,weapon=null,scope='',rung=-1;
 const slot={kind:'crate',label:'Picking…',detail:'Fire to skip',count:'',state:'roulette'};
 const active=()=>weapon!==null;
 function skip(){const had=active();weapon=null;at=-Infinity;return had;}
 return {active,skip,
  sync(instance,life){const key=instance+':'+life;if(key!==scope){scope=key;skip();}},
  begin(kind){if(reducedMotion())return;weapon=normalizeWeapon(kind);at=now();rung=-1;},
  tick(){if(!active())return false;const age=now()-at;if(age>=PICKUP_ROULETTE_MS){skip();return true;}const n=Math.floor(age/75);if(n===rung)return false;rung=n;return true;},
  display(kart){if(!active())return null;if(!kart||kart.respawn>0||kart.alive===false||normalizeWeapon(kart.weapon)!==weapon||kart.firing){skip();return null;}const age=now()-at;if(age>=PICKUP_ROULETTE_MS){skip();return null;}slot.kind=WEAPON_IDS[(WEAPON_IDS.indexOf(weapon)+1+Math.floor(age/75)*3)%WEAPON_IDS.length];return slot;},
 };
}

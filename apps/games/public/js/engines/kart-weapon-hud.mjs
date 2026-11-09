import {weaponThumbnailArt} from './kart-assets.mjs';
import {normalizeWeapon,WEAPON_IDS,WEAPONS} from './kart-weapon-contract.mjs';

// One name per weapon; the how-to and HUD read the same list.
export const KART_WEAPON_INFO=Object.freeze({
 machinegun:{name:'Machine Gun'},trishot:{name:'Tri-Shot'},missile:{name:'Homing Missile'},cannon:{name:'Cannon'},
 blades:{name:'Spinning Blades'},supernova:{name:'Supernova'},mine:{name:'Mine'},frost:{name:'Frost Bomb'},ram:{name:'Turbo Ram'},nuke:{name:'Nuke'},
});
const NAMES=Object.fromEntries(Object.entries(KART_WEAPON_INFO).map(([id,v])=>[id,v.name]));

// Both kart renderers present the authority's inventory, never a predicted
// pickup or a reusable clip. Remaining rounds describe an accepted sequence.
export function kartWeaponDisplay(kart){
  if(!kart||kart.alive===false||kart.respawn>0)return {kind:'crate',label:'No weapon',detail:'',count:'',state:'away'};
  const kind=normalizeWeapon(kart.weapon),ammo=Math.max(0,Math.floor(kart.ammo||0));
  if(NAMES[kind]&&ammo>0){
    const deploying=kind==='mine';
    return {kind,label:NAMES[kind],detail:kart.firing?(deploying?'Deploying':'Firing'):'Ready',count:`×${ammo}`,state:kart.firing?'firing':'ready'};
  }
  if(kart.supernovaT>0)return {kind:'supernova',label:'Supernova',detail:'Protected · blast soon',count:`${Math.ceil(kart.supernovaT)}s`,state:'active'};
  if(kart.bladesT>0)return {kind:'blades',label:'Spinning Blades',detail:'Active',count:`${Math.ceil(kart.bladesT)}s`,state:'active'};
  if(kart.rammingT>0)return {kind:'ram',label:'Turbo Ram',detail:'Contact = KO',count:`${Math.ceil(kart.rammingT)}s`,state:'active'};
  if(kart.shield>0)return {kind:'shield',label:'Spawn protection',detail:'Active',count:`${Math.ceil(kart.shield)}s`,state:'protected'};
  return {kind:'crate',label:'No weapon',detail:'Find a pickup',count:'',state:'empty'};
}

export function paintKartWeapon(element,kart,fallback,{hint=false,roulette=null}={}){
  const value=roulette?.display(kart)||kartWeaponDisplay(kart);
  const art=weaponThumbnailArt(value.kind,fallback),thumbnail=art.startsWith('<img ');
  const key=[value.kind,value.state,value.count,hint,thumbnail].join('|');
  if(element.dataset.equipKey===key)return value;
  if(!element.firstElementChild){
    element.innerHTML='<span class="kart-item-art" aria-hidden="true"></span><span class="kart-item-copy"><strong></strong><small></small></span><b class="kart-item-count"></b><span class="kart-ammo-pips" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></span><kbd class="kart-item-key" hidden>Space</kbd>';
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
  const capacity=WEAPONS[value.kind]?.ammo||0,ammo=kart?.weapon===value.kind?kart.ammo:0;
  const pips=element.querySelector('.kart-ammo-pips');if(pips){const n=Math.min(6,capacity);for(let i=0;i<6;i++){const pip=pips.children[i];if(!pip)continue;pip.hidden=i>=n;pip.dataset.full=String(ammo>i*capacity/n);}}
  element.dataset.state=value.state;
  element.dataset.equipKey=key;
  element.setAttribute('aria-label',[value.label,value.detail,value.count].filter(Boolean).join(', '));
  return value;
}

export const PICKUP_ROULETTE_MS=520;
// A presentation-only reveal. The real item is usable from its pickup tick.
// Existing scene frames drive it; there are no extra timers or input locks.
export function createKartWeaponRoulette({now=()=>performance.now(),reducedMotion=()=>false}={}){
 let at=-Infinity,weapon=null,scope='',rung=-1,pending=false;
 const slot={kind:'crate',label:'Picking…',detail:'Waiting for item',count:'',state:'roulette'};
 const active=()=>weapon!==null||pending;
 function skip(){const had=active();weapon=null;pending=false;at=-Infinity;return had;}
 return {active,skip,
  sync(instance,life){const key=instance+':'+life;if(key!==scope){scope=key;skip();}},
  predict(){if(active())return false;pending=true;at=now();rung=-1;return true;},
  begin(kind){kind=normalizeWeapon(kind);if(!WEAPONS[kind])return;weapon=kind;pending=false;if(!Number.isFinite(at)||now()-at>900)at=now();rung=-1;},
  tick(){if(!active())return false;const age=now()-at;if(age>=(pending?900:PICKUP_ROULETTE_MS)){skip();return true;}const n=Math.floor(age/75);if(n===rung)return false;rung=n;return true;},
  display(kart){if(!active())return null;if(!kart||kart.respawn>0||kart.alive===false||kart.firing){skip();return null;}
   if(kart.weapon&&pending){weapon=normalizeWeapon(kart.weapon);pending=false;}
   if(!pending&&normalizeWeapon(kart.weapon)!==weapon){skip();return null;}
   const age=now()-at;if(age>=(pending?900:PICKUP_ROULETTE_MS)){skip();return null;}
   slot.kind=reducedMotion()?'crate':WEAPON_IDS[Math.floor(age/75)%WEAPON_IDS.length];slot.detail=pending?'Picking up…':'Fire to skip';return slot;},
 };
}

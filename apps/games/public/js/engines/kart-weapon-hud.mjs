import {weaponThumbnailArt} from './kart-assets.mjs';

const NAMES={pulse:'Machine gun',scatter:'Scatter gun',rocket:'Rockets',seeker:'Homing missile',rail:'Railgun',grenade:'Grenade',bomb:'Dynamite',proximity:'Proximity bomb',mine:'Mine trail',shield:'Invincibility',emp:'EMP',spikes:'Spinning blades',sentry:'Sentry',nuke:'Nuke'};

// Both kart renderers present the authority's inventory, never a predicted
// pickup or a reusable clip. Remaining rounds describe an accepted sequence.
export function kartWeaponDisplay(kart){
  if(!kart||kart.alive===false||kart.respawn>0)return {kind:'crate',label:'No weapon',detail:'',count:'',state:'away'};
  const kind=kart.weapon,ammo=Math.max(0,Math.floor(kart.ammo||0));
  if(NAMES[kind]&&ammo>0){
    const deploying=['mine','sentry','bomb','proximity'].includes(kind);
    return {kind,label:NAMES[kind],detail:kart.firing?(deploying?'Deploying':'Firing'):'Ready',count:`×${ammo}`,state:kart.firing?'firing':'ready'};
  }
  if(kart.ramT>0)return {kind:'shield',label:'Invincibility',detail:'Active',count:`${Math.ceil(kart.ramT)}s`,state:'active'};
  if(kart.shield>0)return {kind:'shield',label:'Spawn protection',detail:'Active',count:`${Math.ceil(kart.shield)}s`,state:'protected'};
  return {kind:'crate',label:'No weapon',detail:'Find a pickup',count:'',state:'empty'};
}

export function paintKartWeapon(element,kart,fallback,{hint=false}={}){
  const value=kartWeaponDisplay(kart);
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
  element.querySelector('kbd').hidden=!hint||value.state!=='ready';
  element.dataset.state=value.state;
  element.dataset.equipKey=key;
  element.setAttribute('aria-label',[value.label,value.detail,value.count].filter(Boolean).join(', '));
  return value;
}

import {weaponThumbnailArt} from './kart-assets.mjs';
import {activeKartPower,normalizeWeapon,WEAPON_DISPLAY} from './kart-weapon-contract.mjs';

const WEAPON_ART = {
  pulse: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="10" width="9" height="5" rx="1.5" fill="#1b2433"/><rect x="11" y="11.2" width="11" height="2.6" rx="1" fill="#5a6b84"/><rect x="19.5" y="10.4" width="2.5" height="4.2" rx="1" fill="#5a6b84"/><rect x="4" y="6.3" width="3" height="3.7" rx="1" fill="#5a6b84"/><circle cx="7" cy="17.2" r="3.1" fill="#e8b73a"/><circle cx="7" cy="17.2" r="1.2" fill="#7a5b17"/></svg>',
  scatter: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="7.5" r="3.6" fill="#5a6b84"/><circle cx="8" cy="14.2" r="3.6" fill="#5a6b84"/><circle cx="16" cy="14.2" r="3.6" fill="#5a6b84"/><circle cx="12" cy="7.5" r="1.6" fill="#05070a"/><circle cx="8" cy="14.2" r="1.6" fill="#05070a"/><circle cx="16" cy="14.2" r="1.6" fill="#05070a"/><rect x="10.4" y="17.2" width="3.2" height="4" rx="1" fill="#e8b73a"/></svg>',
  mine: '<svg viewBox="0 0 24 24" aria-hidden="true"><g fill="#5a6b84"><rect x="11" y="2.6" width="2" height="3.4" rx="1"/><rect x="11" y="2.6" width="2" height="3.4" rx="1" transform="rotate(45 12 13)"/><rect x="11" y="2.6" width="2" height="3.4" rx="1" transform="rotate(90 12 13)"/><rect x="11" y="2.6" width="2" height="3.4" rx="1" transform="rotate(135 12 13)"/><rect x="11" y="2.6" width="2" height="3.4" rx="1" transform="rotate(180 12 13)"/><rect x="11" y="2.6" width="2" height="3.4" rx="1" transform="rotate(225 12 13)"/><rect x="11" y="2.6" width="2" height="3.4" rx="1" transform="rotate(270 12 13)"/><rect x="11" y="2.6" width="2" height="3.4" rx="1" transform="rotate(315 12 13)"/><circle cx="12" cy="13" r="6.2"/></g><circle cx="12" cy="13" r="4" fill="#1b2433"/><circle cx="12" cy="13" r="2.2" fill="#ff2a35"/></svg>',
  shield: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5 19 6v6.2c0 4.4-3 7.4-7 9.3-4-1.9-7-4.9-7-9.3V6z" fill="none" stroke="#83e4cc" stroke-width="2.2" stroke-linejoin="round"/><path d="M12 6.5v9M8.5 9.5l7 4M15.5 9.5l-7 4" stroke="#83e4cc" stroke-width="1.4" stroke-linecap="round" opacity=".8"/></svg>',
  rocket: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13.5 2c3.4 2 4.6 5.6 3.6 9.4l2.6 3.2-3.3.4-1.4 3.1-2.5-2.2c-3.5-.6-6-3.3-6.6-6.9z" fill="#ffd458"/><circle cx="12.4" cy="8.6" r="1.6" fill="#25354b"/><path d="M6 14.5 3 21l2.4-.6L4.4 17zM9 17.5l-2 4.5 2.4-.6-.5-3.4z" fill="#ed526d"/></svg>',
  seeker:'<svg viewBox="0 0 32 32" aria-hidden="true" fill="none" stroke-width="2"><path d="M16 3c-5 4-7 10-7 17h14c0-7-2-13-7-17Z" fill="#91d451"/><path d="m9 18-5 8 7-3m12-5 5 8-7-3" fill="#e5f0f5"/><circle cx="16" cy="11" r="3" fill="#1c3539"/></svg>',
  proximity:'<svg viewBox="0 0 32 32" aria-hidden="true" fill="none" stroke-width="2"><ellipse cx="16" cy="21" rx="11" ry="6" fill="#829299"/><path d="M7 10c5-6 13-6 18 0m-15 4c3-3 8-3 11 0" stroke="#ff6154"/><circle cx="16" cy="21" r="3" fill="#ff6154"/></svg>',
  nuke:'<svg viewBox="0 0 32 32" aria-hidden="true"><path d="m16 2 6 8v15H10V10Z" fill="#e5d35b"/><circle cx="16" cy="17" r="5" fill="#393e41"/></svg>',
  laser:'<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="9" width="10" height="6" rx="2.5" fill="#fff6e8"/><rect x="11" y="10.6" width="11" height="2.8" rx="1.4" fill="#8ff8ff"/><circle cx="6" cy="12" r="1.6" fill="#35d5ff"/></svg>',
  frost:'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="6.5" fill="#a8ecff"/><path d="M12 2.5v19M3.8 7.2l16.4 9.6M3.8 16.8l16.4-9.6" stroke="#fff6e8" stroke-width="1.8" stroke-linecap="round"/></svg>',
  cluster:'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="13" r="7" fill="#f2545b"/><circle cx="7" cy="9" r="2.4" fill="#ffcb44"/><circle cx="17" cy="9" r="2.4" fill="#ffcb44"/><circle cx="12" cy="18" r="2.4" fill="#ffcb44"/><rect x="10.5" y="2.5" width="3" height="4" rx="1.2" fill="#25354b"/></svg>',
  bouncer:'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="10" r="7" fill="#ff6ad5"/><path d="M5.2 9.2c3.6 2 10 2 13.6 0" fill="none" stroke="#ffcb44" stroke-width="2"/><path d="M7 21h10" stroke="#8e6cff" stroke-width="2" stroke-linecap="round"/></svg>',
  ram:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7h9l7 5-7 5H3z" fill="#c3cdd8"/><path d="M19 12 12 7v10z" fill="#ffb347"/><path d="M1.5 10h3M1 14h3" stroke="#ff8a3c" stroke-width="1.8" stroke-linecap="round"/></svg>',
  crate: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="7" width="16" height="13" rx="2" fill="none" stroke="#9ad2d7" stroke-width="2"/><path d="M4 10.5h16M12 7v13" stroke="#9ad2d7" stroke-width="1.4" opacity=".7"/><circle cx="12" cy="13.5" r="2.4" fill="#9ad2d7"/></svg>',
};
Object.assign(WEAPON_ART,{machinegun:WEAPON_ART.pulse,trishot:WEAPON_ART.scatter,missile:WEAPON_ART.seeker,cannon:WEAPON_ART.rocket,blades:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 10 2-8 5 4-4 5 7 5-5 4-5-6-7 6-3-6 8-2Z" fill="#65edc3"/><circle cx="12" cy="12" r="3" fill="#25354b"/></svg>' ,supernova:WEAPON_ART.shield});
const thumbnailMarkup=new Map();
export function kartWeaponArt(kind) {
  if(thumbnailMarkup.has(kind))return thumbnailMarkup.get(kind);
  const art=weaponThumbnailArt(kind, WEAPON_ART[kind] || WEAPON_ART.crate);
  if(art.startsWith('<img '))thumbnailMarkup.set(kind,art);
  return art;
}

// Both kart renderers present the authority's inventory, never a predicted
// pickup or a reusable clip. Remaining rounds describe an accepted sequence.
export function kartWeaponDisplay(kart){
  if(!kart||kart.alive===false||kart.respawn>0)return {kind:'crate',label:'No weapon',detail:'',count:'',state:'away'};
  const active=activeKartPower(kart);
  if(active==='supernova')return {kind:'supernova',label:WEAPON_DISPLAY.supernova.label,detail:'Protected',count:`${Math.ceil(kart.supernovaT)}s`,state:'active'};
  if(active==='blades')return {kind:'blades',label:WEAPON_DISPLAY.blades.label,detail:'Active',count:`${Math.ceil(kart.bladesT)}s`,state:'active'};
  if(active==='ram')return {kind:'ram',label:WEAPON_DISPLAY.ram.label,detail:'Contact = KO',count:`${Math.ceil(kart.rammingT)}s`,state:'active'};
  const kind=normalizeWeapon(kart.weapon),ammo=Math.max(0,Math.floor(kart.ammo||0));
  if(WEAPON_DISPLAY[kind]&&ammo>0){
    const deploying=kind==='mine';
    const remaining=kind==='trishot'?Math.ceil(ammo/3):ammo;
    const detail=kind==='trishot'?(remaining===1?'Burst':'Bursts'):kart.firing?(deploying?'Deploying':'Firing'):'Ready';
    return {kind,label:WEAPON_DISPLAY[kind].label,detail,count:`×${remaining}`,state:kart.firing?'firing':'ready'};
  }
  if(kart.shield>0)return {kind:'shield',label:'Spawn protection',detail:'Active',count:`${Math.ceil(kart.shield)}s`,state:'protected'};
  return {kind:'crate',label:'No weapon',detail:'Find a pickup',count:'',state:'empty'};
}

export function paintKartWeapon(element,kart,{hint=false}={}){
  const value=kartWeaponDisplay(kart);
  const art=kartWeaponArt(value.kind),thumbnail=art.startsWith('<img ');
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
  element.title=WEAPON_DISPLAY[value.kind]?.hint || '';
  element.querySelector('strong').textContent=value.label;
  element.querySelector('small').textContent=value.detail;
  element.querySelector('.kart-item-count').textContent=value.count;
  element.querySelector('kbd').hidden=!hint||value.state!=='ready';
  element.dataset.state=value.state;
  element.dataset.equipKey=key;
  element.setAttribute('aria-label',[value.label,value.detail,value.count].filter(Boolean).join(', '));
  return value;
}

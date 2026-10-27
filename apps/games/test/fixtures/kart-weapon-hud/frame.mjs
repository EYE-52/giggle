import {paintKartWeapon} from '/js/engines/kart-weapon-hud.mjs';
import {loadKartWeaponThumbnails,weaponThumbnailArt} from '/js/engines/kart-assets.mjs';
import {readInputCapabilities,touchControlsFor} from '/js/toolkit/input-capabilities.mjs';
const renderer=new URL(location.href).searchParams.get('renderer')==='elevated'?'elevated':'classic';
const css=document.createElement('link');css.rel='stylesheet';css.href='/css/kart-'+(renderer==='classic'?'arena':'elevated')+'.css';document.head.append(css);
const cssReady=new Promise((resolve,reject)=>{css.onload=resolve;css.onerror=()=>reject(Error('Shipping CSS failed to load'));});
const arrow='<svg viewBox="0 0 32 32" aria-hidden="true"><path d="m10 21 6-11 6 11" fill="none" stroke="currentColor" stroke-width="3"/></svg>';
const crosshair='<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="8" fill="none" stroke="currentColor" stroke-width="2"/><path d="M16 3v8m0 10v8M3 16h8m10 0h8" stroke="currentColor" stroke-width="2"/></svg>';
const classic=`<div class="pk"><div class="pk-stage"></div><div class="pk-hud"><div class="pk-readout" role="group" aria-label="Weapon, speed and nitro"><div class="pk-equip kart-item" role="group" aria-label="Weapon"></div><div class="pk-instruments"><div class="pk-speed"><b>0</b><small>km/h</small></div><div class="pk-tech"><span id="pk-map">HUD-only review</span><div class="pk-driftmeter"><i></i></div><div class="pk-nitrometer"><i></i><span>Nitro</span></div></div><details class="pk-help"><summary aria-label="Driving controls help">?</summary></details></div></div></div><div class="pk-touch"><div class="pk-stick" role="group" tabindex="0" aria-label="Drive stick"><span class="pk-stick-marks"></span><span class="pk-stick-thumb"></span></div><div class="pk-tright"><button class="pk-tbtn" id="pk-th" aria-label="Drift"><span class="pk-drift-art">${crosshair}</span></button><button class="pk-tbtn" id="pk-td" aria-label="Brake and reverse">▼</button><button class="pk-tbtn" id="pk-tg" aria-label="Throttle">▲</button><button class="pk-tbtn" id="pk-tn" aria-label="Nitro"><span class="pk-nitro-art">${arrow}</span></button><button class="pk-tbtn" id="pk-tb" aria-label="Use weapon"><span class="pk-fire-art"></span><span class="pk-fire-ammo"></span></button></div></div></div>`;
const elevated=`<div class="pke"><div class="pke-bottom"><div class="kart-item" role="group" aria-label="Weapon"></div><div class="pke-instruments"><span class="pke-speed"><b>0</b><small>km/h</small></span><span class="pke-charge" role="img" aria-label="Nitro charge"></span></div></div><div class="pke-touch"><div class="pke-stick" role="group" tabindex="0" aria-label="Drive stick"><span></span></div><div class="pke-actions"><button data-gas aria-label="Throttle">${arrow}</button><button data-reverse aria-label="Reverse">▼</button><button data-brake aria-label="Brake">Ⅱ</button><button data-nitro aria-label="Nitro">${arrow}</button><button data-use aria-label="Use weapon"><span data-use-icon></span><b data-use-ammo></b></button></div></div></div>`;
const mount=document.querySelector('#gbody');mount.innerHTML=renderer==='classic'?classic:elevated;
const root=mount.firstElementChild,note=document.createElement('p');note.className='review-note';note.innerHTML='HUD-only review<small>Neutral backdrop · no gameplay</small>';root.append(note);
const item=root.querySelector('.kart-item'),touch=root.querySelector('.pk-touch,.pke-touch'),action=root.querySelector('#pk-tb,[data-use]'),icon=action.querySelector('.pk-fire-art,[data-use-icon]'),badge=action.querySelector('.pk-fire-ammo,[data-use-ammo]');
const inventory=await (await fetch('/inventory.json')).json();
const ready=Promise.all([cssReady,loadKartWeaponThumbnails()]).then(()=>document.fonts.ready);
const bounds=element=>{const r=element.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};
const visible=element=>!element.hidden&&element.getClientRects().length>0;
const overlaps=(a,b)=>Math.min(a.right,b.right)-Math.max(a.left,b.left)>.5&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>.5;
let current={kind:'bomb',state:'ready',preference:'keyboard'};
function report(){
  const width=innerWidth,height=innerHeight,itemBounds=bounds(item),panelBounds=bounds(item.closest('.pk-readout,.pke-bottom')),shown=visible(touch),actionBounds=shown?bounds(action):null;
  const drivers=shown?[...root.querySelectorAll('.pk-stick,.pke-stick,.pk-tright button:not(#pk-tb),.pke-actions button:not([data-use])')]:[];
  const checks={itemInBounds:itemBounds.left>=-.5&&itemBounds.top>=-.5&&itemBounds.right<=width+.5&&itemBounds.bottom<=height+.5,
    itemBottomLeft:itemBounds.left<=32&&panelBounds.bottom>=height*.5,itemContentFits:item.scrollWidth<=item.clientWidth+1,
    actionAtLeast44:!shown||(actionBounds.width>=44&&actionBounds.height>=44),
    noItemDrivingOverlap:drivers.every(driver=>!overlaps(itemBounds,bounds(driver))),
    noItemActionOverlap:!shown||!overlaps(itemBounds,actionBounds),
    noActionDrivingOverlap:drivers.every(driver=>!overlaps(actionBounds,bounds(driver))),
    drivingControlsInBounds:drivers.every(driver=>{const r=bounds(driver);return r.left>=0&&r.top>=0&&r.right<=width&&r.bottom<=height;}),
    actionInBounds:!shown||(actionBounds.left>=0&&actionBounds.top>=0&&actionBounds.right<=width&&actionBounds.bottom<=height)};
  return {pass:Object.values(checks).every(Boolean),renderer,viewport:[width,height],input:current,touch:shown,capabilities:readInputCapabilities(),checks,item:itemBounds,action:actionBounds,
    drivers:drivers.map(element=>({label:element.getAttribute('aria-label'),...bounds(element)})),display:item.getAttribute('aria-label'),thumbnail:item.dataset.thumbnail};
}
window.hudReview={ready,get touch(){return visible(touch);},async set(value){
  await ready;current={...current,...value};if(!Object.hasOwn(inventory,current.kind))throw Error('Unknown fixture weapon');
  const show=touchControlsFor(current.preference,readInputCapabilities());root.classList.toggle(renderer==='classic'?'pk-touch-enabled':'pke-touch-mode',show);touch.hidden=!show;
  const ammo=current.state==='empty'?0:current.state==='firing'?Math.max(1,inventory[current.kind]-1):inventory[current.kind];
  const snapshot={alive:true,weapon:current.state==='empty'?null:current.kind,ammo,firing:current.state==='firing'};
  paintKartWeapon(item,snapshot,'',{hint:!show});icon.innerHTML=current.state==='empty'?crosshair:weaponThumbnailArt(current.kind);badge.textContent=ammo;badge.hidden=!ammo;action.disabled=current.state==='empty';
  await new Promise(resolve=>requestAnimationFrame(resolve));return report();
},report};
await window.hudReview.set(current);

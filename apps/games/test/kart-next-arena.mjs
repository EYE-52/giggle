import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {parseHTML} from 'linkedom';
import {KART_ARENAS} from '../public/js/engines/kart-arena-catalog.mjs';
import {createKartArenaPicker} from '../public/js/engines/kart-next-arena.mjs';
const require=createRequire(import.meta.url),game=require('../games/pocket-karts/server'),{preflightElevated}=require('../games/engines/kart-elevated-adapter');
const defaults=Object.fromEntries(game.manifest.settings.map(s=>[s.key,s.def]));
let checks=0;
const check=(value,message)=>{assert(value,message);checks++;};
const buttons=html=>[...parseHTML(html).document.querySelectorAll('[data-arena]')];
for(const mode of ['Zap Battle','Garage Battle','Star Rush'])for(const active of [{id:'garden',label:'Garden Circuit'},{label:'Alpine Courtyard'}]){
  let clock=0,settings={...defaults,mode,map:active.label},host=true,accept=true;const calls=[],spoken=[];
  const api={context:()=>({isHost:host,settings}),configure:patch=>{calls.push(patch);return accept;},announce:text=>spoken.push(text)};
  const state={phase:'done',map:active},before=JSON.stringify(state),picker=createKartArenaPicker({now:()=>clock});
  const click=key=>picker.choose({target:{closest:()=>({disabled:false,getAttribute:()=>key})}},state,api);
  picker.sync(state,api);const cards=buttons(picker.html(state,api));
  check(cards.length===18,'both result profiles expose all18 canonical maps in every mode');
  check(cards.find(b=>b.textContent.includes('Now')).dataset.arena === KART_ARENAS.find(a=>a.label===active.label).key,'current badge distinguishes classic and raised maps with reused IDs');
  check(cards.map(b=>b.dataset.arena).join()===KART_ARENAS.map(a=>a.key).join(),'results use setup catalog order and keys');
  for(const arena of KART_ARENAS){
    const card=cards.find(b=>b.dataset.arena===arena.key);
    check(card.querySelector('img').getAttribute('src')===`/assets/karts/previews/${arena.key}.webp`,'profile-specific real preview');
    if(arena.elevated&&mode!=='Zap Battle')check(card.textContent.includes('Battle')&&card.getAttribute('aria-label').includes('Switch next match to Battle'),'mode switch is explicit before choosing');
    if(arena.label===settings.map)continue;
    check(click(arena.key),'host can choose every other arena');
    const patch=calls.at(-1),resolved={...settings,...patch};
    check(resolved.map===arena.label&&(!arena.elevated||preflightElevated(resolved).ok),'every transmitted combination passes authority preflight');
    check(arena.elevated?patch.mode==='Zap Battle':!Object.hasOwn(patch,'mode'),'raised picks intentionally switch Battle; classic picks preserve mode');
    check(JSON.stringify(state)===before,'selection never rewrites active match/map');
    check(!click('legacy-neon'),'pending selection blocks repeated submits');
    check(buttons(picker.html(state,api)).every(b=>!b.hasAttribute('disabled')&&b.getAttribute('aria-disabled')==='true'),'pending ACK keeps keyboard focus while blocking new submissions');
    settings=resolved;picker.sync(state,api);
    check(buttons(picker.html(state,api)).find(b=>b.dataset.arena===arena.key).getAttribute('aria-pressed')==='true','acknowledged next badge follows saved settings');
  }
  check(spoken.length===calls.length,'one acknowledgement per actual save');
  const beforeGuest=calls.length;host=false;picker.sync(state,api);
  check(buttons(picker.html(state,api)).every(b=>b.hasAttribute('disabled')),'every guest preview is read-only');
  check(!click('legacy-ring')&&calls.length===beforeGuest,'synthetic guest click cannot configure');
  host=true;settings={...defaults,map:'Garden Circuit',mode};accept=false;
  click('legacy-frost');check(picker.html(state,api).includes('Arena was not saved'),'rejected enqueue has retry feedback');
  accept=true;click('arena-skyport-split');settings={...settings,map:'Skyport Split'};picker.sync(state,api);
  if(mode!=='Zap Battle')check(picker.html(state,api).includes('Saving Skyport'),'map-only metadata is not an ACK for required Battle switch');
  clock=5001;picker.sync(state,api);
  if(mode!=='Zap Battle')check(picker.html(state,api).includes('Arena was not saved'),'missing mode ACK times out');
  picker.reset();check(!picker.html(state,api).includes('Saving'),'dispose/reset clears pending');
  state.phase='drive';check(!click('legacy-neon'),'live match cannot configure next map');
}
console.log(`KART_NEXT_ARENA_PASS ${checks} checks; canonical18, both profiles, explicit mode repair, host gating and validated ACKs`);

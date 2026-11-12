import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {parseHTML} from 'linkedom';
import {KART_ARENAS} from '../public/js/engines/kart-arena-catalog.mjs';
import {KART_MODES} from '../public/js/engines/kart-mode-ui.mjs';
import {createKartArenaPicker} from '../public/js/engines/kart-next-arena.mjs';
const require=createRequire(import.meta.url),game=require('../games/pocket-karts/server'),{preflightElevated}=require('../games/engines/kart-elevated-adapter');
const defaults=Object.fromEntries(game.manifest.settings.map(s=>[s.key,s.def]));
let checks=0;
const check=(value,message)=>{assert(value,message);checks++;};
const document=html=>parseHTML(html).document;
for(const mode of Object.keys(KART_MODES))for(const active of [{id:'garden',label:'Garden Circuit'},{label:'Alpine Courtyard'}]){
  let clock=0,settings={...defaults,mode,map:active.label},host=true,accept=true;const calls=[],spoken=[];
  const api={context:()=>({isHost:host,settings}),configure:patch=>{calls.push(patch);return accept;},announce:text=>spoken.push(text)};
  const state={phase:'done',map:active,modeLabel:mode},before=JSON.stringify(state),picker=createKartArenaPicker({now:()=>clock});
  const click=(attribute,value)=>picker.choose({target:{closest:selector=>selector===`[${attribute}]`?{disabled:false,getAttribute:key=>key===attribute?value:null}:null}},state,api);
  const cards=()=>[...document(picker.html(state,api)).querySelectorAll('[data-arena]')];
  picker.sync(state,api);
  check(cards().length===18,'both result profiles expose all18 maps in every mode');
  check(document(picker.html(state,api)).querySelectorAll('[data-next-mode]').length===5,'next-match surface offers all five modes');
  check(cards().find(b=>b.textContent.includes('Now')).dataset.arena===KART_ARENAS.find(a=>a.label===active.label).key,'current badge distinguishes reused classic/raised IDs');
  for(const arena of KART_ARENAS){
    check(cards().find(b=>b.dataset.arena===arena.key).querySelector('img').getAttribute('src')===`/assets/karts/previews/${arena.key}.webp`,'correct profile preview');
    if(arena.label===settings.map)continue;
    check(click('data-arena',arena.key),'host can choose every arena');
    const patch=calls.at(-1),resolved={...settings,...patch};
    check(resolved.map===arena.label&&resolved.mode===mode&&!Object.hasOwn(patch,'mode'),'arena choice never changes the selected mode');
    if(arena.elevated)check(preflightElevated(resolved).ok,'raised choice passes real authority preflight in all five modes');
    check(JSON.stringify(state)===before,'next-match choice never mutates the running match');
    check(!click('data-arena','legacy-neon'),'pending selection blocks duplicate submissions');
    check(cards().every(b=>!b.disabled&&b.getAttribute('aria-disabled')==='true'),'pending save preserves native focus while blocking new choices');
    settings=resolved;picker.sync(state,api);
    check(cards().find(b=>b.dataset.arena===arena.key).getAttribute('aria-pressed')==='true','Next badge follows confirmed saved settings');
  }
  for(const nextMode of Object.keys(KART_MODES)){
    if(nextMode===settings.mode)continue;
    const map=settings.map;check(click('data-next-mode',nextMode),'host intentionally selects next mode');
    check(calls.at(-1).mode===nextMode&&!Object.hasOwn(calls.at(-1),'map'),'mode choice never replaces arena');
    settings={...settings,...calls.at(-1)};picker.sync(state,api);check(settings.map===map,'all next modes retain current arena');
  }
  check(spoken.length===calls.length,'exactly one announcement per validated save');
  const beforeGuest=calls.length;host=false;picker.sync(state,api);
  check([...document(picker.html(state,api)).querySelectorAll('button')].every(b=>b.disabled),'guests can inspect but cannot configure modes or arenas');
  check(!click('data-arena','legacy-ring')&&calls.length===beforeGuest,'synthetic guest click cannot configure');
  host=true;settings={...defaults,map:'Garden Circuit',mode};accept=false;
  click('data-arena','legacy-frost');check(picker.html(state,api).includes('Arena was not saved'),'rejected enqueue shows retry feedback');
  accept=true;click('data-arena','arena-skyport-split');clock=5001;picker.sync(state,api);
  check(picker.html(state,api).includes('Arena was not saved'),'missing ACK times out');
  picker.reset();check(!picker.html(state,api).includes('Saving'),'reset clears pending state');
  state.phase='drive';check(!click('data-next-mode','Capture the Flag'),'live match cannot configure next mode');
}
console.log(`KART_NEXT_ARENA_PASS ${checks} checks; five independent modes,18 arenas, both profiles, host gating and validated ACKs`);

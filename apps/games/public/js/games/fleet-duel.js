import { esc, nameOf } from '../util.js';
import { bkEnsureCss, bkRemoveCss, bkPanelHTML, bkPaint, bkClick, bkDispose, bkTimer, bkMeta, bkRank, bkHeadline, bkReason, bkHost } from './board-kit.js';
const CSS='fleet-duel-css', SHIPS=['Carrier','Cruiser','Frigate','Patrol','Cutter'];
const CAPTAIN=[['#e5486f','#b52f52'],['#4f6bd8','#3650b0']];
function css(){bkEnsureCss();if(document.getElementById(CSS))return;const l=document.createElement('link');l.id=CSS;l.rel='stylesheet';l.href='/css/fleet-duel.css';document.head.appendChild(l);}
function chip(i){return `<svg viewBox="0 0 30 30"><path d="M3 18L7 11H23L27 18L23 23H7Z" fill="${CAPTAIN[i][0]}" stroke="${CAPTAIN[i][1]}" stroke-width="2" stroke-linejoin="round"/><path d="M12 11V5H18V11" fill="${CAPTAIN[i][0]}" stroke="${CAPTAIN[i][1]}" stroke-width="2"/></svg>`;}
function reduced(){return typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion: reduce)').matches;}
function coord(at){return `${'ABCDEFGHIJ'[Math.floor(at/10)]}${at%10+1}`;}
function shipCells(ship,length){if(!ship||ship.at===null)return[];return Array.from({length},(_,i)=>ship.at+i*(ship.vertical?10:1));}
function candidateLegal(S,c){const n=S.lengths[c.ship],r=Math.floor(c.at/10),col=c.at%10;if(c.at===null||(c.vertical?r:col)+n>10)return false;const used=new Set(S.ownFleet.filter(s=>s.ship!==c.ship).flatMap(s=>shipCells(s,s.length)));return shipCells({at:c.at,vertical:c.vertical},n).every(i=>!used.has(i));}
function trayShip(i,length,side){
  const w=length*20,c=CAPTAIN[side]||CAPTAIN[0];
  return `<svg class="fl-tray-ship" viewBox="0 0 ${w+8} 24" style="width:${length*20}%" aria-hidden="true"><path d="M4 6H${w-6}L${w+4} 12L${w-6} 18H4Q1 12 4 6Z" fill="${c[0]}" stroke="${c[1]}" stroke-width="2" stroke-linejoin="round"/><rect x="${w*.3}" y="8.5" width="${Math.max(10,w*.3)}" height="7" rx="2" fill="#fff8e6" stroke="${c[1]}" stroke-width="1.5"/></svg>`;
}
function vessel(ship,side,ghost=false,hot=false){
  const x=55+ship.at%10*42,y=55+Math.floor(ship.at/10)*42,len=ship.length*42-12,c=CAPTAIN[side]||CAPTAIN[0];
  const ports=Array.from({length:Math.max(1,ship.length-1)},(_,i)=>`<circle cx="${i*42+6}" cy="0" r="3.2" class="fl-port"/>`).join('');
  return `<g transform="translate(${x} ${y}) ${ship.vertical?'rotate(90)':''}" class="fl-vessel ${ghost?'fl-ghost':''} ${ship.sunk?'is-sunk':''} ${hot?'fl-sinking':''}" style="--hull:${c[0]};--hull-edge:${c[1]}" aria-hidden="true"><path d="M-15-13H${len-12}L${len+7} 0L${len-12} 13H-15Q-20 0 -15-13Z" class="fl-hull"/><path d="M-11-6H${len-14}" class="fl-stripe"/><rect x="${len*.3}" y="-7" width="${Math.max(12,len*.32)}" height="14" rx="4" class="fl-deck"/>${ports}</g>`;
}
function chart(S,c,animate){
  const owner=S.youAre!==null&&!S.spectator,side=owner?(c.tab==='own'?S.youAre:1-S.youAre):c.watchSide;
  const own=owner&&side===S.youAre,marks=S.shots[1-side],ships=owner?(own?S.ownFleet:S.enemyFleet):(S.publicFleets?.[side]||[]);
  const place=S.phase==='place'&&own&&!S.ready[S.youAre],canAim=owner&&!own&&S.phase==='play'&&S.turn===S.youAre;
  const preview=place&&c.at!==null?{ship:c.ship,at:c.at,vertical:c.vertical,length:S.lengths[c.ship]}:null,previewCells=new Set(preview?shipCells(preview,preview.length):[]),legal=preview&&candidateLegal(S,c);
  const squares=Array.from({length:100},(_,i)=>{
    const x=34+i%10*42,y=34+Math.floor(i/10)*42,aim=canAim&&i===c.aim,selected=place&&previewCells.has(i)&&i<100;
    return `<g id="fl-cell-${i}" data-square="${i}" role="button" tabindex="${c.cursor===i?0:-1}"${c.cursor===i?' data-game-focus':''} aria-label="${coord(i)}${marks[i]===1?', miss':marks[i]===2?', hit':''}${aim?', aimed':''}"><rect x="${x}" y="${y}" width="42" height="42" class="fl-cell ${selected?(legal?'is-preview':'is-invalid'):''} ${aim?'is-aim':''}"/>${i===c.cursor?`<rect x="${x+2}" y="${y+2}" width="38" height="38" class="fl-cursor"/>`:''}</g>`;
  }).join('');
  const symbols=marks.map((v,i)=>{if(!v)return'';const x=55+i%10*42,y=55+Math.floor(i/10)*42,hot=animate&&S.lastMove.at===i&&S.lastMove.side===1-side;return `<g transform="translate(${x} ${y})"><g class="${hot?'fl-impact':''}">${v===2?'<circle r="14" class="fl-hit-disc"/><path d="M-7-7L7 7M-7 7L7-7" class="fl-hit-x"/>':'<circle r="5" class="fl-miss"/>'}</g></g>`;}).join('');
  const aimed=canAim&&c.aim!==null?`<g transform="translate(${55+c.aim%10*42} ${55+Math.floor(c.aim/10)*42})" class="fl-crosshair"><circle r="15"/><path d="M-20 0H-10M10 0H20M0-20V-10M0 10V20"/></g>`:'';
  const lastShot=S.lastMove&&S.lastMove.side===1-side&&!animate?`<rect class="fl-last" x="${36+S.lastMove.at%10*42}" y="${36+Math.floor(S.lastMove.at/10)*42}" width="38" height="38" rx="5"/>`:'';
  const waves=`<defs><pattern id="fl-waves" width="42" height="21" patternUnits="userSpaceOnUse"><path d="M3 14Q9.5 8 16 14T29 14" class="fl-wave"/></pattern><radialGradient id="fl-depth" cx=".5" cy=".45" r=".75"><stop offset="0" class="fl-shallow"/><stop offset="1" class="fl-deep"/></radialGradient></defs>`;
  const buoys=Array.from({length:10},(_,i)=>`<circle cx="${55+i*42}" cy="18" r="12" class="fl-buoy"/><text x="${55+i*42}" y="23" text-anchor="middle">${i+1}</text><circle cx="18" cy="${55+i*42}" r="12" class="fl-buoy"/><text x="18" y="${60+i*42}" text-anchor="middle">${'ABCDEFGHIJ'[i]}</text>`).join('');
  return `<svg class="fl-chart" viewBox="0 0 472 472" role="grid" aria-label="${own?'Your harbor':'Target harbor'}, ten rows and ten columns">${waves}<rect x="1" y="1" width="470" height="470" rx="20" class="fl-frame"/><rect x="34" y="34" width="420" height="420" rx="10" class="fl-sea" fill="url(#fl-depth)"/><rect x="34" y="34" width="420" height="420" rx="10" fill="url(#fl-waves)" class="fl-sea-waves"/>${buoys}${squares}${lastShot}${ships.map(s=>vessel(s,side,false,animate&&s.ship===S.lastMove.sunk)).join('')}${preview&&legal?vessel(preview,side,true):''}${symbols}${aimed}</svg>`;
}
function status(S,c){
  if(S.phase==='done')return S.result.reason==='fleet'?`${nameOf(S,S.result.winnerPid)} sinks the last ship.`:`${nameOf(S,S.result.winnerPid)} wins. ${bkReason(S.result.reason,nameOf(S,S.seats[1-S.result.winner]))}`;
  if(S.youAre===null||S.spectator)return S.phase==='place'?'Watching. Both captains are arranging their hidden fleets.':`${nameOf(S,S.seats[S.turn])} is taking a shot.`;
  if(S.phase==='place')return S.ready[S.youAre]?'Fleet ready. Waiting for the other captain.':`Place your fleet · ${S.ownFleet.length}/5`;
  if(S.turn!==S.youAre)return `${nameOf(S,S.seats[S.turn])} is taking a shot.`;
  return c.aim===null?'Your shot. Aim at a square, then Fire.':`Aim ${coord(c.aim)}. Fire when you’re sure.`;
}
function repaint(el,c,focus=false){
  if(c.settling)return;
  const stage=el.querySelector('.fl-stage');
  const old=stage?.contains(document.activeElement)?document.activeElement.id:null;
  stage.innerHTML=chart(c.S,c,false);
  paint(el,c);
  if(focus||(old&&document.activeElement===document.body))
    c.api.focus?.(el.querySelector(focus?`#fl-cell-${c.cursor}`:'#'+old));
  if(c.zoom&&focus){
    const cell=el.querySelector(`#fl-cell-${c.cursor}`);
    if(stage&&cell){
      // Pan the chart only; scrollIntoView also moves the surrounding game.
      const a=stage.getBoundingClientRect(),b=cell.getBoundingClientRect();
      stage.scrollLeft+=b.left<a.left?b.left-a.left:b.right>a.right?b.right-a.right:0;
      stage.scrollTop+=b.top<a.top?b.top-a.top:b.bottom>a.bottom?b.bottom-a.bottom:0;
    }
  }
}
function paint(el,c){
  el.querySelector('.fl-stage').classList.toggle('is-zoomed',c.zoom);const zoom=el.querySelector('[data-chart-zoom]');zoom.textContent=c.zoom?'Fit chart':'Zoom chart';zoom.setAttribute('aria-pressed',String(c.zoom));
  const shipFocus=el.querySelector('.fl-ships')?.contains(document.activeElement)?document.activeElement.id:null;const S=c.S,owner=S.youAre!==null&&!S.spectator,placement=owner&&S.phase==='place'&&!S.ready[S.youAre],host=c.api.context?.()?.isHost===true;
  const me=owner?S.seats[S.youAre]:null,done=S.phase==='done';
  bkPaint(el,{
    meta:bkMeta(S,'10 × 10 · 5 ships'),
    players:S.seats.map((pid,i)=>({name:nameOf(S,pid),side:i?'Blue':'Red',chip:chip(i),color:CAPTAIN[i][0],stat:S.phase==='place'?(S.ready[i]?'✓':''):S.remaining[i],statLabel:S.phase==='place'?(S.ready[i]?'ready':'placing'):'afloat',turn:S.phase==='play'&&S.turn===i,you:i===S.youAre&&!S.spectator})),
    statusColor:S.phase==='play'?CAPTAIN[S.turn][0]:null,
    status:S.preparing?'Getting the harbor ready…':c.pending?'Sending…':c.retry?'Action not confirmed. Try again.':c.settling?(S.lastMove.sunk!==null?'Ship sunk.':S.lastMove.hit?'Confirmed hit.':'A splash. Miss.'):status(S,c),
    timer:bkTimer(S,c.api),done,player:owner,busy:c.pending||c.settling||!!S.preparing,armed:c.armed,draw:false,
    final:done&&!c.settling?{headline:bkHeadline([nameOf(S,S.result.winnerPid)]),detail:S.result.reason==='fleet'?'Every ship sunk.':bkReason(S.result.reason,nameOf(S,S.seats[1-S.result.winner])),rows:bkRank(S.seats.map((pid,i)=>({name:nameOf(S,pid),points:S.scores?.[pid]??0,you:pid===me,order:i,note:`${S.remaining[i]} afloat`}))),...bkHost(c.api)}:null,
  });
  const tabs=el.querySelector('.fl-tabs');if(!tabs.children.length||Boolean(tabs.querySelector('[data-tab]'))!==owner)tabs.innerHTML=owner?`<button type="button" data-tab="own" aria-pressed="${c.tab==='own'}">Your sea</button><button type="button" data-tab="target" aria-pressed="${c.tab==='target'}">Target</button>`:`<button type="button" data-watch="0" aria-pressed="${c.watchSide===0}">Harbor 1</button><button type="button" data-watch="1" aria-pressed="${c.watchSide===1}">Harbor 2</button>`;
  for(const b of tabs.querySelectorAll('button'))b.setAttribute('aria-pressed',String(b.dataset.tab?b.dataset.tab===c.tab:Number(b.dataset.watch)===c.watchSide));
  el.querySelector('.fl-placement').hidden=!placement;
  el.querySelector('.fl-ships').innerHTML=SHIPS.map((name,i)=>`<button type="button" id="fl-ship-${i}" data-ship="${i}" class="${i===c.ship?'is-selected':''}" aria-label="${esc(name)}, ${S.lengths[i]} squares${S.ownFleet.some(s=>s.ship===i)?', confirmed':''}" aria-pressed="${i===c.ship}" aria-disabled="${c.pending}"><span class="fl-tray-name">${esc(name)} <small>${S.lengths[i]}</small></span>${trayShip(i,S.lengths[i],S.youAre??0)}${S.ownFleet.some(s=>s.ship===i)?'<span class="fl-tray-done" aria-hidden="true">✓</span>':''}</button>`).join('');
  el.querySelector('[data-rotate]').textContent=c.vertical?'↻ Turn ↕':'↻ Turn ↔';el.querySelector('[data-rotate]').setAttribute('aria-label','Rotate ship, currently '+(c.vertical?'vertical':'horizontal'));
  c.confirmAllowed=!S.preparing&&placement&&!c.pending&&!c.settling&&candidateLegal(S,c);c.undoAllowed=!S.preparing&&placement&&!c.pending&&!c.settling&&S.ownFleet.some(s=>s.ship===c.ship);c.autoAllowed=!S.preparing&&placement&&!c.pending&&!c.settling;c.readyAllowed=c.autoAllowed&&S.ownFleet.length===5;
  const confirm=el.querySelector('[data-confirm-ship]'),full=S.ownFleet.length===5,shipName=SHIPS[c.ship];confirm.hidden=full;el.querySelector('[data-ready]').hidden=!full;
  confirm.textContent=c.confirmAllowed?`Confirm ${shipName} at ${coord(c.at)}`:`Confirm ${shipName}`;
  const reason=full||c.confirmAllowed||!placement?'':c.pending?'Sending…':c.at!==null?`The ${shipName} doesn’t fit there. Try another square, or Turn it.`:`Tap a square on your sea for the ${shipName}.`,reasonEl=el.querySelector('.fl-reason');if(reasonEl&&reasonEl.textContent!==reason)reasonEl.textContent=reason;
  for(const [selector,allowed] of [['[data-confirm-ship]',c.confirmAllowed],['[data-undo]',c.undoAllowed],['[data-auto]',c.autoAllowed],['[data-ready]',c.readyAllowed],['[data-rotate]',c.autoAllowed]])el.querySelector(selector).setAttribute('aria-disabled',String(!allowed));
  const fire=el.querySelector('[data-fire]');fire.hidden=!owner||S.phase!=='play';c.fireAllowed=!S.preparing&&owner&&S.phase==='play'&&!c.pending&&!c.settling&&S.turn===S.youAre&&c.tab==='target'&&c.aim!==null&&!S.shots[S.youAre]?.[c.aim];fire.setAttribute('aria-disabled',String(!c.fireAllowed));fire.textContent=c.aim===null?'Fire':`Fire ${coord(c.aim)}`;
if(shipFocus&&document.activeElement===document.body){const target=el.querySelector('#'+shipFocus);if(target?.getClientRects().length)c.api.focus?.(target);}
}
export default {
  styles:['/css/board-duels.css','/css/fleet-duel.css'],
  ownsTimer:true,ownsInputs:true,ownsRematch:true,
  render(el,S,api){
    css();let c=el._fleet;if(c?.instance===S.instanceId&&S.rev<c.rev)return;
    if(!c||c.instance!==S.instanceId){this.dispose(el);css();c=el._fleet={instance:S.instanceId,S,baseline:S,api,rev:-1,phase:null,ship:0,at:null,vertical:false,aim:null,cursor:0,tab:S.phase==='place'?'own':'target',watchSide:0,zoom:false,pending:false,retry:false,armed:false,settling:false,ready:false,timer:0,pendingTimer:0};
      el.innerHTML=`<section class="bk-game fl-game" data-family="board"><div class="fl-chart-col bk-stage"><div class="fl-chart-tools"><div class="fl-tabs tb-seg"></div><button type="button" class="tb-btn tb-chip" data-chart-zoom aria-pressed="false">Zoom chart</button></div><div class="fl-stage"></div></div>${bkPanelHTML({title:'Fleet Duel',draw:false,extra:`<div class="fl-placement"><div class="fl-ships" aria-label="Select a ship"></div><div class="fl-place-tools"><button type="button" class="tb-btn tb-chip" data-rotate>Turn</button><button type="button" class="tb-btn tb-chip" data-undo>Undo</button><button type="button" class="tb-btn tb-chip" data-auto>Auto-place</button></div><div class="fl-place-actions"><button type="button" class="tb-btn tb-primary" data-confirm-ship>Confirm ship</button><button type="button" class="tb-btn tb-primary" data-ready hidden>Ready</button></div><p class="tb-reason fl-reason" aria-live="polite"></p></div><button type="button" class="tb-btn tb-primary fl-fire" data-fire>Fire</button>`,help:['Five ships: 5, 4, 3, 3 and 2 squares. Select a ship, tap its bow, rotate if needed, then Confirm. Ships can touch, but cannot overlap. Ready locks your fleet.','Take one shot per turn, even on a hit. Aim, then Fire. Arrows move the chart cursor; Enter aims or places; R rotates. Sink all five ships to win.']})}</section>`;
      const act=a=>{if(c.pending||c.settling||c.S.preparing||c.S.youAre===null||c.S.spectator||c.S.phase==='done')return;c.pending=true;c.retry=false;c.armed=false;clearTimeout(c.pendingTimer);const retryTimer=c.pendingTimer=setTimeout(()=>{if(el._fleet!==c||c.pendingTimer!==retryTimer)return;c.pendingTimer=0;c.pending=false;c.retry=true;paint(el,c);},4000);c.api.send({...a,rev:c.S.actionRev});paint(el,c);};
      const pick=at=>{if(c.pending||c.settling||c.S.preparing)return;c.cursor=at;if(c.S.youAre===null||c.S.spectator)return;
        if(c.S.phase==='place'&&c.tab==='own'&&!c.S.ready[c.S.youAre])c.at=at;
        else if(c.S.phase==='play'&&c.tab==='target'&&c.S.turn===c.S.youAre&&!c.S.shots[c.S.youAre][at])c.aim=at;
        repaint(el,c,true);
      };
      c.click=e=>{
        const finalAction=name=>{if(c.S.phase==='done'&&!c.settling&&c.api.context?.()?.isHost===true&&!c.api.context?.()?.roomActionPending)c.api[name]?.();};
        if(bkClick(e,{arm:()=>{if(c.settling)return;c.armed=!c.armed;paint(el,c);},keep:()=>{c.armed=false;paint(el,c);},resign:()=>{if(c.armed)act({resign:true});},rematch:()=>finalAction('rematch'),lobby:()=>finalAction('lobby')}))return;
        const b=e.target.closest?.('button,[data-square]');if(!b)return;
        if(b.dataset.square!==undefined){pick(Number(b.dataset.square));return;}
        if(c.settling)return;
        if(b.hasAttribute('data-chart-zoom')){c.zoom=!c.zoom;repaint(el,c);return;}
        if(b.dataset.tab){c.tab=b.dataset.tab;repaint(el,c);return;}
        if(b.dataset.watch!==undefined){c.watchSide=Number(b.dataset.watch);repaint(el,c);return;}
        if(b.hasAttribute('data-ship')){if(c.pending||c.settling)return;c.ship=Number(b.dataset.ship);const old=c.S.ownFleet.find(s=>s.ship===c.ship);c.at=old?.at??null;c.vertical=old?.vertical??c.vertical;c.tab='own';repaint(el,c);return;}
        if(b.hasAttribute('data-rotate')){if(!c.autoAllowed)return;c.vertical=!c.vertical;repaint(el,c);return;}
        if(b.hasAttribute('data-confirm-ship')&&c.confirmAllowed)act({place:{ship:c.ship,at:c.at,vertical:c.vertical}});
        if(b.hasAttribute('data-undo')&&c.undoAllowed)act({undo:c.ship});
        if(b.hasAttribute('data-auto')&&c.autoAllowed)act({auto:true});
        if(b.hasAttribute('data-ready')&&c.readyAllowed)act({ready:true});
        if(b.hasAttribute('data-fire')&&c.fireAllowed)act({fire:c.aim});
      };
      c.key=e=>{if(!e.target.closest?.('.fl-stage')||c.settling||c.pending)return;let next=c.cursor;
        if(e.key==='ArrowLeft')next=c.cursor%10?c.cursor-1:c.cursor;
        else if(e.key==='ArrowRight')next=c.cursor%10<9?c.cursor+1:c.cursor;
        else if(e.key==='ArrowUp')next=Math.max(0,c.cursor-10);
        else if(e.key==='ArrowDown')next=Math.min(99,c.cursor+10);
        else if(e.key==='Enter'||e.key===' '){e.preventDefault();pick(c.cursor);return;}
        else if(e.key.toLowerCase()==='r'&&c.S.phase==='place'&&c.S.youAre!==null&&!c.S.ready[c.S.youAre]){e.preventDefault();c.vertical=!c.vertical;repaint(el,c,true);return;}
        else return;e.preventDefault();c.cursor=next;repaint(el,c,true);
      };
      el.addEventListener('click',c.click);el.addEventListener('keydown',c.key);
    }
    const roleChanged=c.S.youAre!==S.youAre||c.S.spectator!==S.spectator,oldPhase=c.phase;
    // Target impacts compare with released authority, not prepared revisions.
    const confirmed=!roleChanged&&!S.preparing&&!S.audioBaseline&&c.rev>=0&&S.rev===c.baseline.rev+1&&S.lastMove?.rev===S.rev,animate=confirmed&&!reduced();
    const changed=confirmed||S.rev!==c.rev||roleChanged;
    const placed=!roleChanged&&!S.preparing&&!S.audioBaseline&&c.rev>=0&&S.actionRev!==c.S.actionRev&&S.ownFleet.some(s=>!c.S.ownFleet.some(old=>old.ship===s.ship&&old.at===s.at&&old.vertical===s.vertical));
    const confirmedAction=roleChanged||S.phase!==c.S.phase||S.actionRev!==c.S.actionRev;
    const focused=el.querySelector('.fl-stage')?.contains(document.activeElement)?document.activeElement.id:null;c.S=S;c.api=api;if(S.audioBaseline){c.effect=null;c.ready=false;}
    if(changed){clearTimeout(c.timer);c.timer=0;c.returnTab=null;if(confirmedAction){clearTimeout(c.pendingTimer);c.pendingTimer=0;c.pending=false;c.retry=false;c.armed=false;}c.settling=animate;c.effect=confirmed?S.lastMove:null;
      if(roleChanged){c.at=null;c.aim=null;c.tab=S.phase==='place'?'own':'target';}
      if(oldPhase==='place'&&S.phase==='play'){c.tab='target';c.at=null;}
      if(S.lastMove?.side===S.youAre&&S.lastMove.rev===S.rev)c.aim=null;
      if(animate){c.returnTab=c.tab;const target=1-S.lastMove.side;if(S.youAre===null||S.spectator)c.watchSide=target;else c.tab=target===S.youAre?'own':'target';}
      if(S.phase==='place'&&S.ownFleet.some(s=>s.ship===c.ship)){const next=S.lengths.findIndex((_,i)=>!S.ownFleet.some(s=>s.ship===i));if(next>=0){c.ship=next;c.at=null;}}
      el.querySelector('.fl-stage').innerHTML=chart(S,c,animate);if(animate&&c.effect){const m=c.effect;c.api.cue?.(m.hit?'capture':'piece',{id:`${c.instance}:${m.rev}:impact`,gain:m.hit?.8:.55});c.effect=null;}if(focused&&document.activeElement===document.body)c.api.focus?.(el.querySelector('#'+focused));
    }
    if(!S.audioBaseline&&S.phase==='done'&&oldPhase&&oldPhase!=='done')c.ready=true;
    const settle=()=>{if(el._fleet!==c)return;c.settling=false;c.timer=0;if(c.returnTab){c.tab=c.S.phase==='play'&&c.S.turn===c.S.youAre?'target':c.returnTab;c.returnTab=null;repaint(el,c);}paint(el,c);if(c.effect){const m=c.effect;c.api.cue?.(m.hit?'capture':'piece',{id:`${c.instance}:${m.rev}:impact`,gain:m.hit?.8:.55});c.effect=null;}if(c.ready&&c.S.phase==='done'){c.ready=false;c.api.resultsReady?.(c.instance);}};
    if(changed&&animate){const timer=c.timer=setTimeout(()=>{if(c.timer===timer)settle();},S.lastMove.sunk!==null?700:450);}else if(!c.settling&&(c.ready||c.effect))settle();
    if(placed)c.api.cue?.('place',{id:`${c.instance}:${S.actionRev}:fleet`,gain:.65});
    paint(el,c);c.rev=S.rev;c.phase=S.phase;
    if(!S.preparing||S.audioBaseline||roleChanged)c.baseline=S;
  },
  dispose(el){const c=el?._fleet;if(c){clearTimeout(c.timer);clearTimeout(c.pendingTimer);el.removeEventListener('click',c.click);el.removeEventListener('keydown',c.key);bkDispose(el);delete el._fleet;}bkRemoveCss();document.getElementById(CSS)?.remove();},
};

import { motionClock, motionReduced, diceSVG, diceTrack, hopPose, placePose, HOP_MS, DICE_MS } from './board-motion.js';
import { esc, nameOf } from '../util.js';
import { bkEnsureCss, bkRemoveCss, bkPanelHTML, bkPaint, bkClick, bkDispose, bkTimer, bkMeta, bkHost } from './board-kit.js';
const COLORS=['#e5486f','#1fa77f','#4f6bd8','#f2b631'], EDGES=['#b52f52','#147b5d','#3650b0','#c08a10'], NAMES=['Rose','Jade','Indigo','Gold'];
const TRAIL=[[6,13],[6,12],[6,11],[6,10],[6,9],[5,8],[4,8],[3,8],[2,8],[1,8],[0,8],[0,7],[0,6],[1,6],[2,6],[3,6],[4,6],[5,6],[6,5],[6,4],[6,3],[6,2],[6,1],[6,0],[7,0],[8,0],[8,1],[8,2],[8,3],[8,4],[8,5],[9,6],[10,6],[11,6],[12,6],[13,6],[14,6],[14,7],[14,8],[13,8],[12,8],[11,8],[10,8],[9,8],[8,9],[8,10],[8,11],[8,12],[8,13],[8,14],[7,14],[6,14]];
const YARDS=[[0,9],[0,0],[9,0],[9,9]], CSS='ludo-css';
function css(){bkEnsureCss();if(document.getElementById(CSS))return;const l=document.createElement('link');l.id=CSS;l.rel='stylesheet';l.href='/css/ludo.css';document.head.appendChild(l);}
const reduced = motionReduced;
function rotate([x,y],side){for(let i=0;i<side;i++)[x,y]=[14-y,x];return[x,y];}
function xy(side,pawn,pos){
  if(pos===-1){const [x,y]=YARDS[side];return[x+1.6+(pawn%2)*2.8,y+1.6+Math.floor(pawn/2)*2.8];}
  if(pos<51)return TRAIL[(side*13+pos)%52];
  return rotate([7,64-pos],side);
}
/* Flat pawn: one body, one head, a darker edge. */
function pawn(side,index,scale=1){
  const color=COLORS[side],edge=EDGES[side];
  return `<g transform="scale(${scale})"><path d="M-6-8Q-5 0-9 8L-14 13Q-16 18 0 19Q16 18 14 13L9 8Q5 0 6-8Z" fill="${color}" stroke="${edge}" stroke-width="2" stroke-linejoin="round"/><circle cy="-13" r="9" fill="${color}" stroke="${edge}" stroke-width="2"/></g>`;
}
function chip(side){return `<svg viewBox="-25 -25 50 50">${pawn(side,0,1.05)}</svg>`;}
const face = n => diceSVG(n, 'ld');
function paintDie(el,c){const button=el.querySelector('[data-roll]');if(!button.querySelector('.ld-face'))button.innerHTML=`<span class="ld-face"></span><span class="ld-roll-label">Roll</span>`;const n=c.dieShown||0,f=button.querySelector('.ld-face');if(f.getAttribute('data-n')!==String(n)){f.setAttribute('data-n',String(n));f.innerHTML=face(n);}button.classList.toggle('is-rolling',c.rolling);const canRoll=!c.S.preparing&&c.S.phase==='roll'&&c.S.youAre===c.S.turn&&!c.S.spectator;button.classList.toggle('is-ready',canRoll&&!c.pending&&!c.settling);button.querySelector('.ld-roll-label').textContent=c.rolling?'Rolling…':canRoll?'Roll':c.S.phase==='move'?'Move':c.S.phase==='done'?'Finished':c.S.youAre===null||c.S.spectator?'Watching':'Their turn';button.setAttribute('aria-label',c.rolling?'Rolling the die':canRoll?'Roll the die':`${c.dieShown?`Die shows ${c.dieShown}. `:''}${c.S.phase==='move'?'Choose a legal pawn.':'Wait for your turn.'}`);}
function status(S){
  if(S.phase==='done')return `${nameOf(S,S.result.winnerPid)} ${S.result.reason==='home'?'brings all four pawns home!':'wins the race.'}`;
  if(S.youAre===S.turn&&!S.spectator)return S.phase==='roll'?'Your turn. Roll the die.':`You rolled ${S.die}. Choose a glowing pawn.`;
  return `${S.spectator||S.youAre===null?'Watching · ':''}${nameOf(S,S.seats[S.turn])}${S.phase==='move'?` rolled ${S.die}.`:' to roll.'}`;
}
function board(S,c,animate){
  c.previousLocations = c.locations; c.locations = new Map(); c.tracks = [];
  const k=42, offset=21, safe=new Set(S.safe),homes=YARDS.map(([x,y],side)=>`<rect x="${x*k+3}" y="${y*k+3}" width="246" height="246" rx="16" fill="${COLORS[side]}"/>${[0,1,2,3].map(i=>{const [px,py]=xy(side,i,-1);return `<circle cx="${px*k+offset}" cy="${py*k+offset}" r="32" class="ld-well"/>`;}).join('')}`).join('');
  const landing=S.lastMove?.kind==='move'?xy(S.lanes[S.lastMove.side],S.lastMove.pawn,S.lastMove.to):null;
  const trail=TRAIL.map(([x,y],i)=>`<rect x="${x*k+2}" y="${y*k+2}" width="38" height="38" rx="4" fill="${i%13===0?COLORS[Math.floor(i/13)]:'#ffffff'}" stroke="#dcdcd6" stroke-width="1"/>${safe.has(i)?`<path d="M0-10L3-3L10-3L5 2L7 9L0 5L-7 9L-5 2L-10-3L-3-3Z" transform="translate(${x*k+offset} ${y*k+offset})" fill="${i%13===0?(Math.floor(i/13)===3?'#594300':'#fff'):'#747c87'}"/>`:''}`).join('');
  const lanes=COLORS.map((color,side)=>Array.from({length:6},(_,i)=>{const [x,y]=xy(side,0,51+i);return `<rect x="${x*k+2}" y="${y*k+2}" width="38" height="38" rx="4" fill="${color}" stroke="#ffffff" stroke-width="1"/>`;}).join('')).join('');
  const lastMark=landing&&!animate?`<rect class="ld-last" x="${landing[0]*k}" y="${landing[1]*k}" width="42" height="42" rx="6"/>`:'';
  const groups=new Map();S.pawns.forEach((list,side)=>list.forEach((pos,i)=>{if(pos<0)return;const key=xy(S.lanes[side],i,pos).join(',');if(!groups.has(key))groups.set(key,[]);groups.get(key).push(`${side}:${i}`);}));
  const pieces=S.pawns.map((list,side)=>list.map((pos,i)=>{
    const lane=S.lanes[side],[x,y]=xy(lane,i,pos),group=pos<0?[]:groups.get([x,y].join(',')),siblings=group.length,ordinal=group.indexOf(`${side}:${i}`),cols=Math.ceil(Math.sqrt(siblings)),rows=Math.ceil(siblings/cols),sx=36/cols,sy=36/rows,scale=siblings>1?Math.min(.8,(sx-2)/47,(sy-2)/63):1,dx=siblings>1?(ordinal%cols-(cols-1)/2)*sx-4.5*scale:0,dy=siblings>1?(Math.floor(ordinal/cols)-(rows-1)/2)*sy-2.5*scale:0,px=x*k+offset+dx,py=y*k+offset+dy;
    if (animate) {
      const m = S.lastMove, old = (c.baselineLocations || c.previousLocations)?.get(`${side}:${i}`) || [px, py];
      if (m.side === side && m.pawn === i) {
        const positions = m.from < 0 ? [-1, m.to] : Array.from({length: m.to - m.from + 1}, (_, n) => m.from + n);
        const points = positions.map(pos => xy(lane, i, pos).map(v => v*k+offset));
        points[0] = old; points[points.length - 1] = [px, py];
        c.tracks.push({side, index:i, points, destination:[px,py], captured:false});
      } else if (m.captured?.some(p => p.side === side && p.pawn === i)) {
        c.tracks.push({side, index:i, points:[old, [px,py]], destination:[px,py], captured:true});
      }
    }
    c.locations.set(`${side}:${i}`, [px,py]);
    const legal=!S.preparing&&side===S.youAre&&!S.spectator&&!c.pending&&!c.settling&&S.legal.includes(i);
    return `<g transform="translate(${px} ${py})" id="ld-pawn-${side}-${i}" class="ld-piece ${legal?'is-legal':''} ${S.resigned.includes(side)?'is-resigned':''}" data-pawn="${i}" data-side="${side}" role="button" tabindex="-1" aria-label="${NAMES[lane]} pawn ${i+1}${pos===56?', home':pos<0?', in yard':''}${legal?', legal move':''}"><g class="ld-pawn-motion">${legal?`<g transform="scale(${scale})" pointer-events="none"><circle r="25" class="ld-glow"/></g>`:''}${pawn(lane,i,scale)}</g></g>`;
  }).join('')).join('');
  return `<svg class="ld-board" viewBox="-12 -12 654 654" role="img" aria-label="Ludo board, four coloured yards around a shared trail"><rect x="-9" y="-9" width="648" height="648" rx="22" class="ld-base"/>${homes}${trail}<rect x="252" y="252" width="126" height="126" rx="6" fill="#ffffff"/>${lanes}<path d="M315 285L345 315L315 345L285 315Z" fill="#e6e8ec"/>${lastMark}${pieces}</svg>`;

}
function outLabel(S,side){return {timeout:'Out of time',forfeit:'Left',resign:'Resigned'}[S.outReason?.[side]]||'Out';}
function finalModel(S,c){
  if(S.phase!=='done'||c.settling)return null;
  const me=S.youAre!==null&&!S.spectator?S.seats[S.youAre]:null;
  const places=(S.places||[]).length?S.places:S.seats.map((pid,side)=>({pid,side,rank:side===S.result.winner?1:2,points:S.scores?.[pid]??0,out:S.resigned.includes(side)}));
  const rows=places.map(p=>({name:nameOf(S,p.pid),rank:p.rank,points:p.points,you:p.pid===me,note:p.out?outLabel(S,p.side):`${S.pawns[p.side].filter(x=>x===56).length}/4 home`}));
  const ties=places.filter(p=>p.rank===1).length;
  return {headline:ties>1?'It’s a tie':`${nameOf(S,S.result.winnerPid)} wins`,detail:S.result.reason==='home'?'All four pawns home.':S.result.reason==='timeout'?'Everyone else ran out of time or left.':'Everyone else left the race.',rows,...bkHost(c.api)};
}
function paint(el,c){
  const S=c.S,my=S.youAre!==null&&!S.spectator,out=my&&S.resigned.includes(S.youAre),acting=!S.preparing&&my&&!out&&S.turn===S.youAre&&!c.pending&&!c.settling;
  el.querySelector('[data-roll]').disabled=!my||out;el.querySelector('[data-roll]').setAttribute('aria-disabled',String(!acting||S.phase!=='roll'));
  paintDie(el,c);
  const choices=el.querySelector('.ld-choices');choices.hidden=!my;if(my&&c.choiceSide!==S.youAre){c.choiceSide=S.youAre;choices.innerHTML=S.pawns[S.youAre].map((pos,i)=>`<button type="button" id="ld-choice-${i}" data-choice="${i}" aria-label="Move pawn ${i+1}"><svg viewBox="-25 -25 50 50" aria-hidden="true">${pawn(S.lanes[S.youAre],i,.9)}</svg><span></span></button>`).join('');}
  if(my)for(const b of choices.querySelectorAll('[data-choice]')){const i=Number(b.dataset.choice);b.classList.toggle('is-legal',acting&&S.legal.includes(i));b.setAttribute('aria-disabled',String(!acting||!S.legal.includes(i)));b.querySelector('span').textContent=`${i+1}${S.pawns[S.youAre][i]===56?' · Home':''}`;}
  const reason=el.querySelector('.ld-reason');if(reason){const skipped=S.lastMove?.kind==='roll'&&S.lastMove.skipped;const text=S.phase==='done'||S.preparing||c.pending||c.settling?'':skipped?`${nameOf(S,S.seats[S.lastMove.side])} rolled ${S.lastMove.die} · no legal move.`:!my||out?'':S.turn!==S.youAre?`Your pawns wait while ${nameOf(S,S.seats[S.turn])} plays.`:S.phase==='roll'?'Roll first, then move a pawn.':S.legal.length?'Tap a glowing pawn to move it.':'No pawn can move with this roll.';if(reason.textContent!==text)reason.textContent=text;}
  el.querySelector('.ld-dock').hidden=S.phase==='done'&&!c.settling;
  bkPaint(el,{
    meta:bkMeta(S,`${S.seats.length} players`),
    players:S.seats.map((pid,side)=>({name:nameOf(S,pid),side:NAMES[S.lanes[side]],chip:chip(S.lanes[side]),color:COLORS[S.lanes[side]],stat:`${S.pawns[side].filter(p=>p===56).length}/4`,statLabel:'home',turn:S.phase!=='done'&&side===S.turn&&!S.resigned.includes(side),you:side===S.youAre&&!S.spectator,out:S.resigned.includes(side),outLabel:outLabel(S,side)})),
    statusColor:S.phase==='done'?null:COLORS[S.lanes[S.turn]],
    status:S.preparing?'Getting the table ready…':c.pending?'Sending your turn…':c.settling?(c.settleKind==='roll'?'Rolling…':'Hop, hop…'):c.retry?'Turn not confirmed. Try again.':status(S),
    timer:bkTimer(S,c.api),done:S.phase==='done',player:my&&!out,busy:c.pending||c.settling||!!S.preparing,armed:c.armed,draw:false,
    watchNote:out?'You are out of this race. Watch the others finish.':undefined,
    final:finalModel(S,c),
  });
}
export default {
  styles:['/css/board-duels.css','/css/ludo.css'],
  ownsTimer:true,ownsInputs:true,ownsRematch:true,
  render(el,S,api){
    css();let c=el._ludo;if(c?.instance===S.instanceId&&S.rev<c.rev)return;
    if(!c||c.instance!==S.instanceId){this.dispose(el);css();c=el._ludo={motion:motionClock(),instance:S.instanceId,S,baseline:S,api,rev:-1,phase:null,pendingTimer:0,pending:false,retry:false,settling:false,settleKind:null,rolling:false,dieShown:S.die||S.lastMove?.die||1,armed:false,cursor:0,choiceSide:null,ready:false};
      el.innerHTML=`<section class="bk-game ld-game" data-family="board"><div class="ld-stage bk-stage"></div>${bkPanelHTML({title:'Ludo',draw:false,extra:`<div class="ld-dock"><button type="button" class="ld-dice" data-roll aria-label="Roll the die"></button><div class="ld-choices" aria-label="Choose a pawn"></div><p class="ld-reason tb-reason" aria-live="polite"></p></div>`,help:['A six brings a pawn out and gives another roll. Move exactly into home. Stars and starting squares are safe; landing on other squares sends every opponent pawn there back to its yard. No blockades or three-sixes penalty.','Choose one of your four pawns, then it moves. First with all four home wins; the others place by how far they came.']})}</section>`;
      // The turn banner already owns a fixed text well. Keep the pawn hint
      // there too, so the die tray fits below the board without page scrolling.
      el.querySelector('.bk-status-copy').append(el.querySelector('.ld-reason'));
      c.click=e=>{const t=c.S;let action=null;
        const finalAction=name=>{if(t.phase==='done'&&!c.settling&&c.api.context?.()?.isHost===true&&!c.api.context?.()?.roomActionPending)c.api[name]?.();};
        if(bkClick(e,{arm:()=>{c.armed=!c.armed;paint(el,c);},keep:()=>{c.armed=false;paint(el,c);},resign:()=>{if(c.armed)action={resign:true};},rematch:()=>finalAction('rematch'),lobby:()=>finalAction('lobby')})&&!action)return;
        const b=action?null:e.target.closest?.('button,[data-pawn]');if(!b&&!action)return;
        if(c.pending||c.settling||t.preparing||t.spectator||t.youAre===null||t.phase==='done'||t.resigned.includes(t.youAre))return;
        if(b){
        if(b.dataset.roll!==undefined&&t.phase==='roll'&&t.turn===t.youAre)action={roll:true};
        const p=Number(b.dataset.choice??b.dataset.pawn);if((b.dataset.choice!==undefined||Number(b.dataset.side)===t.youAre)&&t.legal.includes(p))action={move:p};}
        if(action){c.pending=true;c.retry=false;c.armed=false;clearTimeout(c.pendingTimer);const retryTimer=c.pendingTimer=setTimeout(()=>{if(el._ludo!==c||c.pendingTimer!==retryTimer)return;c.pendingTimer=0;c.pending=false;c.rolling=false;c.retry=true;paint(el,c);},4000);c.api.send({...action,rev:t.rev});paint(el,c);}
      };
      c.key=e=>{if(!e.target.closest?.('.ld-choices'))return;const options=[...el.querySelectorAll('[data-choice]')];if(e.key.startsWith('Arrow')){e.preventDefault();c.cursor=(Number(e.target.closest('button')?.dataset.choice||0)+(e.key==='ArrowLeft'||e.key==='ArrowUp'?-1:1)+4)%4;options[c.cursor]?.focus({preventScroll:true});}};
      el.addEventListener('click',c.click);el.addEventListener('keydown',c.key);
    }
    const roleChanged=c.S.youAre!==S.youAre||c.S.spectator!==S.spectator,previous=c.phase;
    // Preparation must not consume the next released roll or pawn movement.
    const confirmed=!roleChanged&&!S.preparing&&!S.audioBaseline&&c.rev>=0&&S.rev===c.baseline.rev+1&&S.lastMove?.rev===S.rev;
    const changed=confirmed||c.rev!==S.rev||roleChanged||!!S.audioBaseline;
    const kind=confirmed&&!reduced()?S.lastMove.kind:null,animate=kind==='move'||kind==='roll';
    const focused=el.querySelector('.ld-stage')?.contains(document.activeElement)?document.activeElement.id:null;c.S=S;c.api=api;if(S.audioBaseline){c.effect=null;c.ready=false;}
    if(changed){c.motion.stop();clearTimeout(c.pendingTimer);c.pendingTimer=0;c.pending=false;c.retry=false;c.armed=false;c.settling=animate;c.settleKind=kind;c.effect=confirmed?S.lastMove:null;c.rolling=kind==='roll';c.dieShown=S.die||S.lastMove?.die||c.dieShown;el.querySelector('.ld-stage').innerHTML=board(S.preparing ? c.baseline : S,c,kind==='move');if(focused&&document.activeElement===document.body)c.api.focus?.(el.querySelector('#'+focused));}
    if(!S.audioBaseline&&S.phase==='done'&&previous&&previous!=='done')c.ready=true;
    const settle=()=>{if(el._ludo!==c)return;const wasRoll=c.settleKind==='roll';c.settling=false;c.settleKind=null;c.rolling=false;if(wasRoll){const focus=el.querySelector('.ld-stage')?.contains(document.activeElement)?document.activeElement.id:null;el.querySelector('.ld-stage').innerHTML=board(c.S,c,false);if(focus&&document.activeElement===document.body)c.api.focus?.(el.querySelector('#'+focus));}paint(el,c);if(c.effect){const m=c.effect;c.api.cue?.(m.kind==='roll'?'dice':m.captured?.length?'capture':'piece',{id:`${c.instance}:${m.rev}:land`,gain:.8});c.effect=null;}if(c.ready&&c.S.phase==='done'){c.ready=false;c.api.resultsReady?.(c.instance);}};
    if(changed&&animate){
      // Dice and every moving/captured pawn share this one RAF clock.
      const die = diceTrack(el.querySelector('[data-roll]'), c.dieShown);
      const mover = c.tracks.find(t=>!t.captured);
      const hopsEnd = mover ? (mover.points.length-1)*HOP_MS : 0;
      const hasCapture = c.tracks.some(t=>t.captured);
      const duration = kind==='roll' ? DICE_MS+50 : Math.max(hasCapture?760:550, hopsEnd+(hasCapture?350:180));
      const tracks = c.tracks.map(t=>({...t,node:el.querySelector(`#ld-pawn-${t.side}-${t.index}`)?.querySelector('.ld-pawn-motion')}));
      paint(el,c);
      c.motion.play(duration, ms=>{
        if(kind==='roll')die(ms);
        for(const t of tracks){
          let pose;
          if(t.captured){
            const p=Math.max(0,Math.min(1,(ms-hopsEnd-100)/250));
            pose=hopPose(t.points,p*HOP_MS);
          }else {
            pose=hopPose(t.points,ms);
            if(ms>=hopsEnd){const pop=Math.sin(Math.min(1,(ms-hopsEnd)/180)*Math.PI)*.16;pose.sx=1+pop;pose.sy=1-pop;}
          }
          placePose(t.node,pose,t.destination);
        }
      },settle);
    }else if(!c.settling&&(c.ready||c.effect)){
      settle();
      if(confirmed&&reduced()){
        const node=el.querySelector('.ld-stage svg');
        c.motion.play(120,ms=>node?.setAttribute('opacity',String(.55+.45*ms/120)));
      }
    }

    paint(el,c);if(changed&&!animate)diceTrack(el.querySelector('[data-roll]'),c.dieShown)(DICE_MS);c.rev=S.rev;c.phase=S.phase;
    if(!S.preparing||S.audioBaseline||roleChanged){c.baseline=S;c.baselineLocations=c.locations;}
  },
  dispose(el){const c=el?._ludo;if(c){c.motion.stop();clearTimeout(c.pendingTimer);el.removeEventListener('click',c.click);el.removeEventListener('keydown',c.key);bkDispose(el);delete el._ludo;}bkRemoveCss();document.getElementById(CSS)?.remove();},
};

/* Presentation only: prices, levels and purchase results come from snapshots. */
const esc = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const paths = {
  coin:'<circle cx="12" cy="12" r="9"/><path d="M14.5 8h-4a2 2 0 0 0 0 4h3a2 2 0 0 1 0 4h-4M12 6v12"/>',
  engine:'<path d="M4 9h3l3-3h7v3h3v10H7v-3H4zM11 3h5M13 3v3M1 10v5M20 11h3v6h-3"/>',
  handling:'<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/><path d="m9 11-5-3m11 3 5-3m-8 7v6"/>',
  reload:'<path d="M20 9a8 8 0 0 0-14-3L3 9m0-6v6h6M4 15a8 8 0 0 0 14 3l3-3m0 6v-6h-6"/>',
  ko:'<path d="m14 2-9 12h6l-1 8 9-12h-6z"/>',
  pickup:'<path d="m12 2 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1z"/>',
  finish:'<path d="M5 22V3m0 1c5-4 9 4 15 0v11c-6 4-10-4-15 0M10 3v11M15 5v11M5 9h15"/>',
  win:'<path d="M7 3h10v7a5 5 0 0 1-10 0zM7 5H3v3a5 5 0 0 0 5 5m9-8h4v3a5 5 0 0 1-5 5M12 15v5m-5 1h10"/>',
};
const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths[name]}</svg>`;
export const GARAGE_UPGRADES = Object.freeze([
  {id:'engine',name:'Engine',desc:'Acceleration & top speed',step:5,stat:'Speed bonus'},
  {id:'handling',name:'Handling',desc:'Sharper turns',step:4,stat:'Turn bonus'},
  {id:'reload',name:'Quick reload',desc:'Fire again sooner',step:6,stat:'Less cooldown'},
]);
const levelOf = (S, id) => Math.min(S.garagePrices.max || 3, Math.max(0, Math.floor(S.upgrades?.[S.you]?.[id] || 0)));
export const garagePreviewKey = spec => JSON.stringify([spec.color,spec.driver,...GARAGE_UPGRADES.map(d => spec.levels?.[d.id] || 0)]);

export function kartGarageHtml(S, pending, {color=0xf59539,driver='fox'} = {}) {
  if (S.mode !== 'battle' || !S.youDrive || !S.garagePrices) return '';
  const coins = Math.max(0, S.coins || 0), cap = S.garagePrices.max || 3;
  const paint = '#' + (Number(color) >>> 0).toString(16).padStart(6,'0').slice(-6);
  const animal = {fox:'🦊',bunny:'🐰',panda:'🐼',raccoon:'🦝'}[driver] || '🏎️';
  const feedback = S.garageResult;
  const message = pending ? 'Adding your upgrade…' : feedback ? feedback.ok ? `${GARAGE_UPGRADES.find(d => d.id === feedback.category)?.name || 'Kart'} upgraded to level ${feedback.level}!` : feedback.error || 'Try again.' : 'Pick a part. Build your next win.';
  return `<section class="pk-garage" aria-label="Your kart garage">
    <header class="pk-garage-header"><div><span class="pk-garage-kicker">Pocket Karts · Pit stop</span><h4>Your garage</h4></div>
      <div class="pk-wallet" aria-label="${coins} coins">${icon('coin')}<span><b class="pk-wallet-digits">${coins}</b><small>coins</small></span></div></header>
    <p class="pk-garage-note">${S.garage ? 'Upgrades apply next rematch.' : 'Upgrades apply in Garage Battle.'} Your garage stays with you in this room.</p>
    <div class="pk-garage-body"><figure class="pk-garage-display">
      <div class="pk-garage-kart" role="img" aria-label="Your kart in your chosen paint and driver, with your installed upgrades">
        <div class="pk-garage-fallback" aria-hidden="true"><svg viewBox="0 0 280 160"><g fill="var(--ink-dim)"><rect x="55" y="96" width="35" height="40" rx="12"/><rect x="190" y="96" width="35" height="40" rx="12"/></g><path d="M70 105 87 67h106l17 38-19 22H89z" fill="${paint}"/><path d="M97 69 113 40h54l16 29z" fill="${paint}"/><path d="M109 99h62v12h-62z" fill="var(--card)"/></svg><span>${animal}</span></div>
        <img class="pk-garage-thumbnail" alt="" hidden>
      </div><figcaption><strong>Your race-day ride</strong><span class="pk-garage-installed">${GARAGE_UPGRADES.map(d => `<span data-installed="${d.id}" class="${levelOf(S,d.id) ? 'is-installed' : ''}">${icon(d.id)}<b>${levelOf(S,d.id)}</b></span>`).join('')}</span></figcaption>
    </figure><div class="pk-upgrades">${GARAGE_UPGRADES.map(d => {
      const level=levelOf(S,d.id),max=level>=cap,price=S.garagePrices.prices?.[level]??20;
      const reason = max ? 'Fully upgraded' : pending ? 'Adding your upgrade…' : coins < price ? `Need ${price-coins} more coins` : `+${d.step}% per level`;
      const current=level*d.step,next=Math.min(cap,level+1)*d.step;
      return `<article class="pk-upgrade" data-part="${d.id}" data-level="${level}" data-state="${max?'maxed':pending?'pending':coins<price?'unaffordable':'affordable'}">
        <div class="pk-upgrade-heading"><span class="pk-upgrade-icon">${icon(d.id)}</span><div><h5>${d.name}</h5><span class="pk-upgrade-desc">${d.desc}</span></div></div>
        <div class="pk-upgrade-level"><span class="pk-upgrade-pips" aria-label="Level ${level} of ${cap}">${Array.from({length:cap},(_,i)=>`<i class="${i<level?'is-filled':''}" aria-hidden="true"></i>`).join('')}</span><span>${level}/${cap}</span></div>
        <div class="pk-upgrade-stat"><span>${d.stat}</span><b>+${current}%${max?'':` <span aria-hidden="true">→</span> +${next}%`}</b></div>
        <div class="pk-upgrade-track" role="img" aria-label="${esc(d.stat)}: ${current}% now${max?', maximum':`, ${next}% next level`}"><i class="pk-stat-next" style="transform:scaleX(${Math.min(cap,level+1)/cap})"></i><i class="pk-stat-current" style="transform:scaleX(${level/cap})"></i></div>
        <button type="button" data-upgrade="${d.id}" ${max||coins<price||pending?'disabled':''} ${pending?'aria-busy="true"':''} aria-label="${max?`${d.name} maxed`:`Upgrade ${d.name} for ${price} coins`}" aria-describedby="pk-upgrade-reason-${d.id}">${max?'MAX':`${icon('coin')}<span>Buy <b>${price}</b></span>`}</button>
        <span id="pk-upgrade-reason-${d.id}" class="pk-upgrade-reason">${reason}</span></article>`;
    }).join('')}</div></div>
    <p class="pk-garage-feedback" role="status">${esc(message)}</p>
    <ul class="pk-garage-earnings" aria-label="Earn coins">${[['ko','KO',10],['pickup','Pickup',1],['finish','Finish',5],['win','Win',15]].map(([id,label,n])=>`<li>${icon(id)}<span>${label} <b>+${n}</b></span></li>`).join('')}</ul></section>`;
}

// A bounded one-shot, never a second animation loop. No optimistic levels/cues.
export function createKartGarageUI() {
  let coins=null, tick=0, image=null, imageKey=null;
  const stop = () => { if(tick) cancelAnimationFrame(tick); tick=0; };
  function restore(root,key) {
    const img=root?.querySelector('.pk-garage-thumbnail');
    if(!img || key!==imageKey || !image) return;
    img.src=image; img.hidden=false;
    const fallback=root.querySelector('.pk-garage-fallback');
    if(fallback) fallback.hidden=true;
  }
  return {
    paint(root,S,{bought=false,reducedMotion=false,key}={},api) {
      if(!S.youDrive || !S.garagePrices) {stop();coins=null;return;}
      restore(root,key);
      const balance=Math.max(0,S.coins||0),previous=coins; coins=balance; stop();
      const tokens=typeof getComputedStyle==='function' ? getComputedStyle(root) : null;
      const duration=parseFloat(tokens?.getPropertyValue('--dur-base')) || 300;
      const popDuration=parseFloat(tokens?.getPropertyValue('--dur-slow')) || 500;
      const easing=tokens?.getPropertyValue('--ease').trim() || 'cubic-bezier(0.22, 1, 0.36, 1)';
      const lift=tokens?.getPropertyValue('--space-8').trim() || '8px';
      const pop=(el,frames)=>!reducedMotion && el?.animate?.(frames,{duration:popDuration,easing});
      if(previous!==null && previous!==balance) {
        pop(root.querySelector('.pk-wallet'),[{transform:'scale(1)'},{transform:'scale(1.1)',offset:.3},{transform:'scale(1)'}]);
        const digits=root.querySelector('.pk-wallet-digits');
        if(digits && !reducedMotion && typeof requestAnimationFrame==='function') {
          let start;
          const frame=now=>{start??=now;const p=Math.min(1,(now-start)/duration);digits.textContent=String(Math.round(previous+(balance-previous)*(1-(1-p)**3)));tick=p<1?requestAnimationFrame(frame):0;};
          tick=requestAnimationFrame(frame);
        }
      }
      if(bought) {
        const part=S.garageResult.category,level=levelOf(S,part),card=root.querySelector(`[data-part="${part}"]`);
        pop(card?.querySelector(`.pk-upgrade-pips i:nth-child(${level})`),[{transform:'scale(.6)'},{transform:'scale(1.2)',offset:.4},{transform:'scale(1)'}]);
        pop(card?.querySelector('.pk-stat-current'),[{transform:`scaleX(${Math.max(0,level-1)/(S.garagePrices.max||3)})`},{transform:`scaleX(${level/(S.garagePrices.max||3)})`}]);
        pop(root.querySelector('.pk-garage-kart'),[{transform:'translateY(0)'},{transform:`translateY(-${lift})`,offset:.35},{transform:'translateY(0)'}]);
        api?.cue?.('correct',{id:`${S.instanceId}:garage:${S.garageResult.nonce}`,gain:.75});
      }
    },
    preview(root,key,draw) {
      if(key!==imageKey) { try { image=draw(); } catch { image=null; } imageKey=key; }
      restore(root,key);
    },
    reset(){stop();coins=null;},
    dispose(){stop();coins=null;image=null;imageKey=null;},
  };
}

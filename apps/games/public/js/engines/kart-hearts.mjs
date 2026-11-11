/* HP HUD and hit feedback shared by both kart renderers. Authority
 * HP only: the server's health is painted, never predicted. Every
 * effect is a CSS animation that ends on its own (animationend never
 * needs to fire), and the shake is a bounded camera offset the view adds
 * after its own camera update and removes before the next one. */

export const SHAKE_MS = 260;
export const BANNER_MS = 1600;

function restart(element, name) {
  // Rewind the existing CSS animation without synchronously laying out the
  // whole game between every HP change, hit marker and toast in a damage burst.
  if(element.getAnimations){
    element.setAttribute(name,'');
    for(const animation of element.getAnimations()){animation.currentTime=0;animation.play();}
    return;
  }
  element.removeAttribute(name);
  element.setAttribute(name, '');
}

// Authority HP only. Reuse the same track/fill/number for the whole life.
export function paintKartHearts(element,kart){
 const max=Math.max(1,Number(kart?.maxHealth)||100),hp=Math.max(0,Math.min(max,Number(kart?.health??max)));
 const life=String(kart?.spawnSeq??0),guard=String(kart?.guard===true);
 if(element.children.length && element.dataset.life===life && element.dataset.hp===String(hp)
    && element.dataset.guard===guard && element.getAttribute('aria-valuemax')===String(max))return {hp,max,lost:0};
 element.classList?.add('kart-hp');
 if(!element.children.length)element.innerHTML='<i class="kart-hp-track"><i class="kart-hp-fill"></i></i><b class="kart-hp-value"></b>';
 const before=Number(element.dataset.hp),lost=element.dataset.life===life&&Number.isFinite(before)?Math.max(0,before-hp):0;
 const fill=element.querySelector?.('.kart-hp-fill')||element.children[0]?.children[0];
 if(fill)fill.style.transform=`scaleX(${hp/max})`;
 const number=element.querySelector?.('.kart-hp-value')||element.children[1];if(number)number.textContent=`${Math.ceil(hp)} HP`;
 if(lost)restart(element,'data-shake');
 element.dataset.hp=String(hp);element.dataset.life=life;element.dataset.low=String(hp<=max*.3);element.dataset.guard=guard;
 element.setAttribute('role','meter');element.setAttribute('aria-valuemin','0');element.setAttribute('aria-valuemax',String(max));element.setAttribute('aria-valuenow',String(Math.ceil(hp)));
 element.setAttribute('aria-label',`${Math.ceil(hp)} of ${max} HP${kart?.guard?', shield ready':''}`);
 return {hp,max,lost};
}

// Screen-edge flash, hit marker and "+1" toast layered over the arena.
export function createKartHitFeedback(host, { reducedMotion = () => false } = {}) {
  const layer = document.createElement('div');
  layer.className = 'kart-hitfx';
  layer.setAttribute('aria-hidden', 'true');
  layer.innerHTML = '<i class="kart-hitfx-flash"></i><i class="kart-hitfx-marker"></i><b class="kart-hitfx-toast"></b><b class="kart-hitfx-banner"></b>';
  host.append(layer);
  const [flash, marker, toast, banner] = layer.children;
  // The knockout banner styles itself (the HUD stylesheets stay untouched)
  // and fades on a fixed Web Animations timer.
  banner.style.cssText = 'position:absolute;left:50%;top:26%;transform:translateX(-50%);padding:10px 22px;border-radius:14px;background:rgba(20,16,32,.82);color:#fff;font:900 clamp(18px,4.2vw,30px)/1.1 system-ui,sans-serif;letter-spacing:.01em;white-space:nowrap;max-width:92%;overflow:hidden;text-overflow:ellipsis;box-shadow:0 0 0 3px #ffd34a,0 8px 24px rgba(0,0,0,.35);opacity:0';
  let bannerRun = null;
  let shakeAt = -Infinity;
  const offset = { x: 0, y: 0 };
  return {
    hurt(now = performance.now()) {
      restart(flash, 'data-on');
      if (!reducedMotion()) shakeAt = now;
    },
    rumble(now=performance.now()){if(!reducedMotion())shakeAt=now;},
    landed(text = '+1') {
      restart(marker, 'data-on');
      toast.textContent = text;
      restart(toast, 'data-on');
    },
    knockout(name) {
      banner.textContent = `Knocked out ${name}!`;
      bannerRun?.cancel();
      const frames = reducedMotion() ? [{ opacity: 1 }, { opacity: 1, offset: .8 }, { opacity: 0 }]
        : [{ opacity: 0, transform: 'translateX(-50%) scale(.6)' }, { opacity: 1, transform: 'translateX(-50%) scale(1.08)', offset: .12 },
          { opacity: 1, transform: 'translateX(-50%) scale(1)', offset: .25 }, { opacity: 1, offset: .8 }, { opacity: 0, transform: 'translateX(-50%) scale(1)' }];
      bannerRun = banner.animate ? banner.animate(frames, { duration: BANNER_MS, easing: 'ease-out', fill: 'forwards' }) : null;
      return banner.textContent;
    },
    // The same banner for a one-off line such as an arena fall ("Fell!").
    notice(text) {
      this.knockout('');
      banner.textContent = String(text);
      return banner.textContent;
    },
    // Decaying camera offset in world units; zero once SHAKE_MS has passed.
    shake(now = performance.now()) {
      const t = (now - shakeAt) / SHAKE_MS;
      if (!(t >= 0 && t < 1) || reducedMotion()) { offset.x = 0; offset.y = 0; return offset; }
      const amp = .22 * (1 - t) * (1 - t);
      offset.x = Math.sin(t * 47) * amp;
      offset.y = Math.cos(t * 39) * amp * .7;
      return offset;
    },
    dispose() { bannerRun?.cancel(); bannerRun = null; layer.remove(); },
  };
}

// Text for the local driver when one of their shots lands.
export function landedText(event) {
  if (event.type === 'block') return 'Blocked';
  if (event.type === 'ko') return 'KO!';
  return `−${Math.max(1, Math.round(event.damage || 1))} HP`;
}

// Blast weapons each have their own synthesized cue.
const BLAST_CUES = {cannon:'cannonBoom',missile:'missileBlast',supernova:'novaBlast', nuke: 'nukeBlast', proximity: 'bombBlast', fakecrate: 'bombBlast', frost: 'frostShatter', cluster: 'clusterPop' };
// One authoritative event to one audio cue (null when it has none).
export function kartEventCue(event, you) {
  if (event.type === 'blast') return BLAST_CUES[event.weapon] || 'rocketBlast';
  if (event.type === 'fire') return event.weapon;
  if (event.type === 'mine') return event.weapon || 'mine';
  // A Turbo Ram strike clangs for everyone nearby, rammer and victim alike.
  if (event.type === 'hit' && event.weapon === 'ram') return 'ramClang';
  if (event.type === 'hit') return event.other === you ? 'hurt' : event.pid === you ? 'hitDing' : null;
  if (event.type === 'bounce') return 'boing';
  if (event.type === 'burst') return 'clusterPop';
  return event.type;
}

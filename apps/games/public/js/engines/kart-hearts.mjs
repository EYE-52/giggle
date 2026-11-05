/* Hearts HUD and hit feedback shared by both kart renderers. Authority
 * hearts only: the server's health is painted, never predicted. Every
 * effect is a CSS animation that ends on its own (animationend never
 * needs to fire), and the shake is a bounded camera offset the view adds
 * after its own camera update and removes before the next one. */

const HEART = '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 28 4.6 16.6C-1.4 10.2 6.4 1.4 16 9.2c9.6-7.8 17.4 1 11.4 7.4Z"/></svg>';
export const SHAKE_MS = 260;

function restart(element, name) {
  element.removeAttribute(name);
  void element.offsetWidth; // a fresh animation for back-to-back hits
  element.setAttribute(name, '');
}

// Paint whole hearts into `element`; returns how many were lost since the
// previous paint of the same life (0 after a respawn refill).
export function paintKartHearts(element, kart) {
  const max = Math.max(1, Math.min(6, Math.round(Number(kart?.maxHealth) || 3)));
  const hearts = Math.max(0, Math.min(max, Math.round(Number(kart?.health ?? max))));
  if (element.childElementCount !== max) {
    element.innerHTML = Array.from({ length: max }, () => `<i class="kart-heart">${HEART}</i>`).join('');
    delete element.dataset.hearts;
  }
  const life = String(kart?.spawnSeq ?? 0), before = Number(element.dataset.hearts);
  const sameLife = element.dataset.life === life && Number.isFinite(before);
  const lost = sameLife ? Math.max(0, before - hearts) : 0;
  [...element.children].forEach((heart, i) => {
    heart.dataset.full = String(i < hearts);
    if (lost && i >= hearts && i < before) restart(heart, 'data-pop');
  });
  element.dataset.hearts = String(hearts);
  element.dataset.life = life;
  element.dataset.low = String(hearts <= 1);
  element.dataset.guard = String(kart?.guard === true);
  element.setAttribute('aria-label', `${hearts} of ${max} hearts${kart?.guard ? ', shield ready' : ''}`);
  return { hearts, max, lost };
}

// Screen-edge flash, hit marker and "+1" toast layered over the arena.
export function createKartHitFeedback(host, { reducedMotion = () => false } = {}) {
  const layer = document.createElement('div');
  layer.className = 'kart-hitfx';
  layer.setAttribute('aria-hidden', 'true');
  layer.innerHTML = '<i class="kart-hitfx-flash"></i><i class="kart-hitfx-marker"></i><b class="kart-hitfx-toast"></b>';
  host.append(layer);
  const [flash, marker, toast] = layer.children;
  let shakeAt = -Infinity;
  const offset = { x: 0, y: 0 };
  return {
    hurt(now = performance.now()) {
      restart(flash, 'data-on');
      if (!reducedMotion()) shakeAt = now;
    },
    landed(text = '+1') {
      restart(marker, 'data-on');
      toast.textContent = text;
      restart(toast, 'data-on');
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
    dispose() { layer.remove(); },
  };
}

// Text for the local driver when one of their shots lands.
export function landedText(event) {
  if (event.type === 'block') return 'Blocked';
  if (event.type === 'ko') return 'KO!';
  return `+${Math.max(1, Math.round(event.damage || 1))}`;
}

// One authoritative event to one audio cue (null when it has none).
export function kartEventCue(event, you) {
  if (event.type === 'blast') return event.weapon === 'nuke' ? 'nukeBlast' : event.weapon === 'proximity' ? 'bombBlast' : 'rocketBlast';
  if (event.type === 'fire') return event.weapon;
  if (event.type === 'hit') return event.other === you ? 'hurt' : event.pid === you ? 'hitConfirm' : null;
  return event.type;
}

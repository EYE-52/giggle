/* Pose Party view: thin wrapper on the shared camera-party toolkit view
 * (public/js/toolkit/camera-party.js). The engine owns all markup, timers
 * and behavior, with one kit HUD row (round, phase, progress, clock) and a
 * line under the prompt that names who acts and what the viewer does; this
 * file loads the engine stylesheet (/css/camera-party.css) and delegates
 * render/dispose. */
import { renderCameraParty, disposeCameraParty } from '../toolkit/camera-party.js';
import { ensureStylesheet } from '../util.js';

const CSS_ID = 'camera-party-css';
const CSS_HREF = '/css/camera-party.css';

function ensureCss(id, href) {
  ensureStylesheet(id, href);
}

function removeCss(id) {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') return;
  const l = document.getElementById(id);
  if (l) l.remove();
}

export default {
  styles: [CSS_HREF],
  ownsTimer: true,
  render(el, S, api) {
    ensureCss(CSS_ID, CSS_HREF);
    return renderCameraParty(el, S, api);
  },
  dispose(el) {
    removeCss(CSS_ID);
    return disposeCameraParty(el);
  },
};

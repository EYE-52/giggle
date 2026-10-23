/* How-to dialog: one compact playful instruction panel for every game.
 *
 * Replaces the old inline per-card expanding text (which stretched whole
 * grids). A native <dialog> gives Escape, backdrop, and Tab trapping for
 * free — no JS trap to stack against the customizer's. The dialog mounts
 * directly on <body> (outside #app AND #dlg-root) so lobby repaints never
 * eat it and customizer open/close never wipes it; each opener closes the
 * other first, so the two never stack.
 *
 * Content is the authoritative catalog howto (sentence-split into short
 * paragraphs for readability), never invented tutorial bullets. The footer
 * (context CTA) is built by the shell via buildFooter, so home/lobby/host
 * gating stays in one place and refreshes on roster ticks. Text is set via
 * textContent; the shell escapes its own footer HTML.
 */
import { closeCustomizer } from './customize.js';

let state = null; // {game, opener, meta, buildFooter, el}

/* Split catalog howto into short readable paragraphs at sentence ends.
 * One sentence per paragraph would chop poetry; the catalog lines are
 * 1–3 sentences, so sentence-split is exactly right. */
export function splitHowto(text) {
  const parts = String(text || '').match(/[^.!?]+[.!?]+["”)'\]]*|.+$/g);
  if (!parts) return [];
  return parts.map((s) => s.trim()).filter(Boolean);
}

function paintFooter() {
  if (!state || !state.el) return;
  const foot = state.el.querySelector('[data-howto-foot]');
  if (!foot) return;
  // Roster ticks repaint the CTA (counts/gates change); keep keyboard
  // focus on the same control when it survives the repaint.
  const active = document.activeElement;
  const activeId = active && foot.contains(active) && active.id ? active.id : null;
  const built = state.buildFooter(state.game) || {};
  foot.innerHTML = built.html || '';
  if (typeof built.wire === 'function') built.wire(foot);
  if (activeId) {
    const same = document.getElementById(activeId);
    if (same) {
      try { same.focus({ preventScroll: true }); } catch { same.focus(); }
    }
  }
}

export function isHowtoOpen() {
  return !!state;
}

export function howtoGameId() {
  return state ? state.game.id : null;
}

/* Roster/config snapshots call this: the static howto stays, the footer
 * (counts, gates, custom note) repaints. Never steals focus or scroll. */
export function refreshHowto() {
  paintFooter();
}

export function closeHowto(opts = {}) {
  if (!state) return;
  const { opener, el, game } = state;
  state = null;
  if (el) {
    try { if (el.open) el.close(); } catch { /* already gone */ }
    el.remove();
  }
  document.removeEventListener('keydown', escGuard, true);
  if (opts.returnFocus === false) return;
  // Return focus to the opener without scrolling; lobby repaints detach
  // card buttons constantly, so fall back to the live same-game trigger.
  let target = opener && document.contains(opener) ? opener : null;
  if (!target && game) target = document.querySelector(`[data-how="${game.id}"]`);
  if (target && target.focus) {
    try { target.focus({ preventScroll: true }); } catch { target.focus(); }
  }
}

/* Native dialogs already trap Tab and close on Escape; this capture guard
 * only keeps an Escape meant for us from also firing shell handlers. */
function escGuard(e) {
  if (e.key === 'Escape' && state) e.stopPropagation();
}

export function openHowto({ game, opener, meta, buildFooter }) {
  if (!game) return;
  closeCustomizer({ returnFocus: false });
  closeHowto({ returnFocus: false });
  state = { game, opener: opener || null, meta: meta || {}, buildFooter, el: null };

  const el = document.createElement('dialog');
  el.className = 'howto-dlg';
  el.setAttribute('aria-labelledby', 'howtoTitle');
  const src = game.art && /^img\/games\/[a-z0-9-]+\.(svg|png|webp)$/.test(game.art)
    ? '/' + game.art : `/img/games/${game.id}.png`;
  el.innerHTML =
    `<div class="howto-head">` +
    `<img class="howto-art" alt="" loading="lazy">` +
    `<div class="howto-titles"><h2 id="howtoTitle"></h2><p class="howto-tag"></p></div>` +
    `<button class="btn ghost dlg-x" id="howtoClose" aria-label="Close game details"><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button>` +
    `</div>` +
    `<div class="howto-meta"></div>` +
    `<div class="howto-tabs" role="tablist" aria-label="Game details"><button type="button" role="tab" id="howtoPlayTab" aria-controls="howtoPlayPanel" aria-selected="true">Play</button><button type="button" role="tab" id="howtoRulesTab" aria-controls="howtoRulesPanel" aria-selected="false" tabindex="-1">How to play</button></div>` +
    `<div class="howto-body" id="howtoRulesPanel" role="tabpanel" aria-labelledby="howtoRulesTab" hidden></div>` +
    `<div id="howtoPlayPanel" role="tabpanel" aria-labelledby="howtoPlayTab"></div>` +
    `<div class="howto-foot" data-howto-foot></div>`;
  el.querySelector('#howtoTitle').textContent = game.name;
  el.querySelector('.howto-tag').textContent = game.tagline || '';
  const img = el.querySelector('.howto-art');
  img.src = src;
  img.decoding = 'async';
  img.setAttribute('data-art-id', game.id);
  img.setAttribute('data-art-name', game.name);
  img.setAttribute('onerror', '__artFail(this)');
  const metaEl = el.querySelector('.howto-meta');
  for (const pill of [state.meta.seats, state.meta.vibe, state.meta.custom].filter(Boolean)) {
    const s = document.createElement('span');
    s.className = 'howto-pill';
    s.textContent = pill;
    metaEl.appendChild(s);
  }
  const intro = el.querySelector('#howtoPlayPanel');
  intro.textContent = state.meta.intro ?? (game.customizable ? 'Create a room and invite your friends. Choose your settings before playing.' : '');
  intro.classList.toggle('howto-intro', !!intro.textContent);
  intro.hidden = !intro.textContent;
  const body = el.querySelector('.howto-body');
  for (const para of splitHowto(game.howto)) {
    const p = document.createElement('p');
    p.textContent = para;
    body.appendChild(p);
  }
  document.body.appendChild(el);
  state.el = el;
  paintFooter();
  const tabs = [...el.querySelectorAll('[role="tab"]')];
  const selectTab = (selected) => {
    for (const tab of tabs) {
      const active = tab === selected;
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
      const panel = el.querySelector('#' + tab.getAttribute('aria-controls'));
      panel.hidden = !active || (panel === intro && !intro.textContent);
    }
  };
  for (const tab of tabs) {
    tab.onclick = () => selectTab(tab);
    tab.onkeydown = (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === 'Home' ? tabs[0] : event.key === 'End' ? tabs.at(-1) : tabs[1 - tabs.indexOf(tab)];
      selectTab(next);
      next.focus({ preventScroll: true });
    };
  }

  el.querySelector('#howtoClose').onclick = () => { closeHowto(); };
  el.addEventListener('click', (e) => {
    if (e.target === el) closeHowto(); // backdrop tap
  });
  el.addEventListener('cancel', (e) => {
    e.preventDefault(); // we close (focus return) instead of native close
    closeHowto();
  });
  el.addEventListener('close', () => {
    // External close (never expected): drop state without focus games.
    if (state && state.el === el) closeHowto({ returnFocus: false });
  });
  document.addEventListener('keydown', escGuard, true);
  el.showModal();
  // HTML autofocus is blocked when this UI is framed by Giggle. Focus the
  // dialog control explicitly during the user-triggered open instead.
  const close = el.querySelector('#howtoClose');
  try { close.focus({ preventScroll: true }); } catch { close.focus(); }
}

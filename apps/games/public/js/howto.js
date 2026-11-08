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

export function controlFamily(game) {
  // Catalogue categories also cover discovery (e.g. "speed"), so a few
  // games need an explicit control family from the design guide.
  if (['pocket-karts', 'reaction-tap', 'typing-race', 'number-hunt', 'chain-reaction'].includes(game.id)) return 'arcade';
  if (game.cat === 'board' || ['memory-tray', 'castle-clash'].includes(game.id)) return 'board';
  if (['draw', 'camera'].includes(game.cat) || ['charades', 'pose-party', 'show-and-go', 'word-chain', 'warm-words', 'countdown-word', 'scattergories', 'lyric-fill', 'think-alike', 'emoji-story'].includes(game.id)) return 'create';
  return 'party';
}

/* Split catalog howto into short readable paragraphs at sentence ends.
 * One sentence per paragraph would chop poetry; the catalog lines are
 * 1–3 sentences, so sentence-split is exactly right. */
export function splitHowto(text) {
  const parts = String(text || '').match(/[^.!?]+[.!?]+["”)'\]]*|.+$/g);
  if (!parts) return [];
  return parts.map((s) => s.trim()).filter(Boolean);
}

const node = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};

/* Goal line plus key/touch chips from the manifest guide, or null. Touch
 * labels replace keys on touch-preferred devices via CSS. */
export function guideGlance(game) {
  const g = game?.guide;
  if (!g || typeof g.goal !== 'string') return null;
  const wrap = node('div', 'howto-glance');
  const goal = node('p', 'howto-goal');
  goal.append(node('span', 'howto-label', 'Goal'), node('span', '', g.goal));
  wrap.append(goal);
  const controls = Array.isArray(g.controls) ? g.controls : [];
  if (controls.length) {
    const list = node('ul', 'howto-controls');
    list.setAttribute('aria-label', 'Controls');
    for (const c of controls) {
      const hasKeys = Array.isArray(c.keys) && c.keys.length;
      const li = node('li', c.touch ? `has-touch${hasKeys ? '' : ' is-touch-only'}` : '');
      if (hasKeys) {
        const keys = node('span', 'howto-keys');
        for (const k of c.keys) keys.append(node('kbd', '', k));
        li.append(keys);
      }
      if (c.touch) li.append(node('span', 'howto-touch', c.touch));
      li.append(node('span', 'howto-does', c.does));
      list.append(li);
    }
    wrap.append(list);
  }
  return wrap;
}

/* How-to tab: guide tips, then the full catalog rules collapsed. Games
 * without a guide show their first two sentences and fold the rest. */
export function renderRules(body, game) {
  const paras = splitHowto(game?.howto);
  const tips = Array.isArray(game?.guide?.tips) ? game.guide.tips : [];
  const all = node('details', 'howto-all');
  all.append(node('summary', '', tips.length ? 'All rules' : 'More rules'));
  for (const text of paras) all.append(node('p', '', text));
  if (tips.length) {
    const list = node('ul', 'howto-tips');
    for (const tip of tips) list.append(node('li', '', tip));
    body.append(list);
    if (paras.length) body.append(all);
    return;
  }
  const lead = paras.length <= 3 ? paras : paras.slice(0, 2);
  for (const text of lead) body.append(node('p', '', text));
  if (paras.length > lead.length) {
    all.replaceChildren(all.firstChild, ...paras.slice(lead.length).map(text => node('p', '', text)));
    body.append(all);
  }
}

function paintFooter() {
  if (!state || !state.el) return;
  const foot = state.el.querySelector('[data-howto-foot]');
  if (!foot) return;
  // Roster ticks repaint the CTA (counts/gates change); keep keyboard
  // focus on the same control when it survives the repaint.
  const active = document.activeElement;
  const activeId = active && foot.contains(active) && active.id ? active.id : null;
  const name = foot.querySelector('#howtoName');
  const draft = name ? { value: name.value, start: name.selectionStart, end: name.selectionEnd } : null;
  const fields = foot.querySelector('.howto-seat-fields');
  const actions = foot.querySelector('.howto-actions');
  const scroll = foot.querySelector('.howto-seat-scroll');
  const scrollTop = scroll.scrollTop;
  const built = state.buildFooter?.(state.game) || {};
  // Keep the scroll area and static guide mounted across roster ticks. All
  // shell-owned controls remain inside data-howto-foot, including the CTA.
  fields.innerHTML = built.html || '';
  actions.replaceChildren();
  const primary = fields.querySelector('#howtoGo');
  if (primary) {
    // Keep the disabled reason (and the normal next-step note) beside the
    // action even when the phone's setup fields have scrolled out of view.
    for (const note of fields.querySelectorAll('.howto-note')) actions.append(note);
    actions.append(primary);
    const oneDevice = fields.querySelector('.same-room-link');
    if (oneDevice) actions.append(oneDevice);
  }
  actions.hidden = !primary;
  const nextName = fields.querySelector('#howtoName');
  if (draft && nextName) {
    nextName.value = draft.value;
    nextName.setSelectionRange(draft.start, draft.end);
  }
  if (typeof built.wire === 'function') built.wire(foot);
  if (activeId) {
    const same = document.getElementById(activeId);
    if (same) {
      try { same.focus({ preventScroll: true }); } catch { same.focus(); }
    }
  }
  scroll.scrollTop = scrollTop;
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
  const { opener, el, game, layoutMedia, syncLayout } = state;
  layoutMedia?.removeEventListener('change', syncLayout);
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
  el.className = 'howto-dlg howto-start';
  el.setAttribute('data-family', controlFamily(game));
  el.setAttribute('aria-labelledby', 'howtoTitle');
  const src = game.art && /^img\/games\/[a-z0-9-]+\.(svg|png|webp)$/.test(game.art)
    ? '/' + game.art : `/img/games/${game.id}.png`;
  el.innerHTML =
    `<div class="howto-layout"><div class="howto-main">` +
    `<div class="howto-head">` +
    `<img class="howto-art" alt="" loading="lazy">` +
    `<div class="howto-titles"><h2 id="howtoTitle"></h2><p class="howto-tag"></p></div>` +
    `<button class="btn ghost dlg-x" id="howtoClose" aria-label="Close game details"><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button>` +
    `</div>` +
    `<div class="howto-meta"></div>` +
    `<div class="howto-tabs" role="tablist" aria-label="Game details"><button type="button" role="tab" id="howtoPlayTab" aria-controls="howtoPlayPanel" aria-selected="true">Play</button><button type="button" role="tab" id="howtoRulesTab" aria-controls="howtoRulesPanel" aria-selected="false" tabindex="-1">How to play</button></div>` +
    `<div class="howto-panels"><div class="howto-body" id="howtoRulesPanel" role="tabpanel" aria-labelledby="howtoRulesTab" tabindex="0" hidden></div>` +
    `<div id="howtoPlayPanel" role="tabpanel" aria-labelledby="howtoPlayTab"></div>` +
    `</div></div><div class="howto-foot" data-howto-foot>` +
    `<div class="howto-seat-scroll"><div class="howto-seat-content"><h3 class="howto-seat-title">Your seat</h3><div class="howto-seat-fields"></div></div></div>` +
    `<div class="howto-actions"></div></div></div>`;
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
  const introText = state.meta.intro ?? (game.customizable ? 'Create a room and invite your friends. Choose your settings before playing.' : '');
  const glance = guideGlance(game);
  if (glance) {
    // The Play tab is what people see: goal and controls, not a paragraph.
    // The footer already says how to start; the generic intro would repeat it.
    intro.append(glance);
  } else intro.textContent = introText;
  intro.classList.toggle('howto-intro', !!intro.textContent);
  intro.hidden = !intro.textContent;
  renderRules(el.querySelector('.howto-body'), game);
  document.body.appendChild(el);
  state.el = el;
  paintFooter();
  const main = el.querySelector('.howto-main');
  const layoutMedia = window.matchMedia('(min-width: 860px)');
  const syncLayout = () => {
    const active = document.activeElement;
    const scroll = el.querySelector('.howto-seat-scroll');
    el.classList.toggle('howto-two-column', layoutMedia.matches);
    el.classList.toggle('howto-sheet', !layoutMedia.matches);
    // One scroller on phones; on desktop the guide and seat stand beside
    // each other. Move the live guide, preserving tab state and handlers.
    const parent = layoutMedia.matches ? el.querySelector('.howto-layout') : scroll;
    parent.prepend(main);
    if (active && el.contains(active)) active.focus({ preventScroll: true });
  };
  Object.assign(state, { layoutMedia, syncLayout });
  layoutMedia.addEventListener('change', syncLayout);
  syncLayout();
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

/* The running game's compact guide shares the same manifest renderer. */
export function openControls({ game, opener }) {
  if (!game) return;
  closeCustomizer({ returnFocus: false });
  closeHowto({ returnFocus: false });
  const el = document.createElement('dialog');
  el.className = 'howto-dlg controls-dlg';
  el.setAttribute('data-family', controlFamily(game));
  el.setAttribute('aria-labelledby', 'controlsTitle');
  el.innerHTML = `<div class="howto-head"><div class="howto-titles"><h2 id="controlsTitle">Controls</h2><p class="howto-tag"></p></div><button type="button" class="btn ghost dlg-x" id="howtoClose" aria-label="Close controls">×</button></div>`;
  el.querySelector('.howto-tag').textContent = game.name;
  const glance = guideGlance(game);
  if (glance) el.append(glance);
  else el.append(node('p', 'howto-intro', game.howto || 'Follow the instructions on screen.'));
  state = { game, opener: opener || null, el, buildFooter: null };
  const fullscreen = document.fullscreenElement;
  // The app normally fullscreens <html>; keeping the sheet in <body>
  // preserves the active game skin and touch-preferred control labels.
  const parent = fullscreen && !fullscreen.contains(document.body) ? fullscreen : document.body;
  parent.appendChild(el);
  el.querySelector('#howtoClose').onclick = () => closeHowto();
  el.addEventListener('click', e => { if (e.target === el) closeHowto(); });
  el.addEventListener('cancel', e => { e.preventDefault(); closeHowto(); });
  el.addEventListener('close', () => { if (state?.el === el) closeHowto({ returnFocus: false }); });
  el.addEventListener('keydown', e => e.stopPropagation());
  document.addEventListener('keydown', escGuard, true);
  document.dispatchEvent(new Event('game-screenchange'));
  el.showModal();
  el.querySelector('#howtoClose').focus({ preventScroll: true });
}

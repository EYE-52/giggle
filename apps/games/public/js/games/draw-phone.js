/* Draw Phone view: exquisite-corpse telephone.
 * A HUD row with the four steps (write/draw/caption/read) and how many are
 * done, flat pages on the page tokens (draw-phone.css), kit buttons and
 * inputs, chains revealed one story at a time, kit Final scores. Private ink carries a turn token, canvas revision and whole-gesture identity.
 * Contracts: {phrase}, {stroke}, {preview}, {clear:true}, {undo:true}, {guess}, {next}, {prev}. */
import { esc, nameOf, ensureStylesheet } from '../util.js';
import { resultsHtml, syncHudTimer, stopHudTimer } from '../kit.js';

const OWN_CSS_ID = 'draw-phone-css';
const COLORS = ['#111111', '#e4572e', '#1d7a3a', '#1d4ed8', '#f2b134', '#ffffff'];
const COLOR_NAMES = ['Black', 'Orange', 'Green', 'Blue', 'Yellow', 'White'];
let color = '#111111';
let penColor = color;
let size = 7;
let drawing = false;
let cur = [];
let pending = [];
let previewAt = 0;
let snapshot = null, cueBaseline = null, revision = 0, gestureId = 0, chunk = 0, sample = 0, visibleStrokes = [];
let finishHeld = () => {};
let activeInk = { color, size };
let phaseKey = '';
let lastKey = '';
let canvasFocused = false;
let toolsVisible = true;
let capturedPointer = null;
let zoom = 1, panX = 0, panY = 0, hand = false, panStart = null, resizeObserver = null;
let revealedPages = new Set(), savedCounter = 0;
function reduced() { return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches; }
let lastEl = null;
let bound = []; // [target, type, fn, opts] — removed by dispose()

function ensureCss() {
  ensureStylesheet(OWN_CSS_ID, '/css/draw-phone.css');
}

function removeCss() {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') return;
  document.getElementById(OWN_CSS_ID)?.remove();
}

function on(t, type, fn, opts) {
  if (!t || !t.addEventListener) return;
  t.addEventListener(type, fn, opts);
  bound.push([t, type, fn, opts]);
}

function releaseCapture() {
  const held = capturedPointer;
  capturedPointer = null;
  if (held) try { held.canvas.releasePointerCapture?.(held.id); } catch { /* already released */ }
}

function unbindAll() {
  // A phase switch or dispose must never submit a stale gesture.
  drawing = false;
  cur = [];
  releaseCapture();
  for (const [t, type, fn, opts] of bound) {
    try { t.removeEventListener(type, fn, opts); } catch { /* noop */ }
  }
  bound = [];
  panStart = null; resizeObserver?.disconnect(); resizeObserver = null;
  finishHeld = () => {};
}

const STEPS = [['write', 'Write'], ['draw', 'Draw'], ['guess', 'Caption'], ['reveal', 'Read']];

function stepsHtml(phase) {
  const order = STEPS.map((s) => s[0]);
  const now = order.indexOf(phase);
  return `<ol class="sk-steps" aria-label="Notebook pages">${STEPS.map(([id, label], i) =>
    `<li class="${i < now ? 'is-done' : i === now ? 'is-now' : ''}" ${i === now ? 'aria-current="step"' : ''}><span class="sk-step-n" aria-hidden="true">${i + 1}</span><span>${label}</span></li>`).join('')}</ol>`;
}

const PEN_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20l1.2-4.6L15.8 4.8a2 2 0 0 1 2.8 0l.6.6a2 2 0 0 1 0 2.8L8.6 18.8z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M13.8 6.8l3.4 3.4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
const ERASER_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.5 20H20M4.6 15.4l9.8-9.8a2 2 0 0 1 2.8 0l2.2 2.2a2 2 0 0 1 0 2.8L12 18H8.2z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M9.2 10.8l4.6 4.6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
const UNDO_ICON = '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="m11 5-7 7 7 7M5 12h13a8 8 0 0 1 0 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const CLEAR_ICON = '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M10 8h12l-1 20H11L10 8Zm-3 0h18M13 8V4h6v4M14 12v12m4-12v12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function dpProgressText(S) {
  const players = (S.players || []).filter(p => !p.left && !(S.gone || []).includes(p.id)).length;
  if (S.phase === 'write') return `${(S.submitted || []).length} of ${players} written`;
  if (S.phase === 'draw') return `${(S.finished || []).length} of ${players} done`;
  if (S.phase === 'guess') return `${(S.guessed || []).length} of ${players} captioned`;
  return '';
}
function header(S) {
  return `<header class="dp-header gk-hud"><h2 class="dp-identity">Draw Phone</h2>${stepsHtml(S.phase)}<span class="gk-hud-progress dp-progress" id="pProgress">${esc(dpProgressText(S))}</span></header>`;
}
function roster(S) {
  const active = S.phase === 'write' ? S.submitted : S.phase === 'draw' ? S.finished : S.guessed;
  return `<aside class="dp-roster" aria-label="Players"><span class="dp-roster-label">At the table</span><ul>${(S.players || []).map((p, i) =>
    `<li><span class="dp-player-mark dp-player-${i % 4}" aria-hidden="true">${esc((p.name || '?').slice(0, 1))}</span><span class="dp-player-name">${esc(p.name)}</span>${(active || []).includes(p.id) ? '<span class="dp-player-check" aria-label="Saved">✓</span>' : ''}</li>`).join('')}</ul></aside>`;
}
function desk(S, content) {
  return `<div class="sk sk-phone dp dp-${S.phase}">${header(S)}<span class="gk-hud-timer dp-clock" role="timer" aria-live="off"></span><div class="dp-layout">${roster(S)}<section class="dp-main">${content}</section></div></div>`;
}
function updateRoster(el, S) {
  const old = el.querySelector('.dp-roster');
  if (old) old.innerHTML = roster(S).replace(/^<aside[^>]*>|<\/aside>$/g, '');
  const progress = el.querySelector('#pProgress');
  if (progress) progress.textContent = dpProgressText(S);
}
function statusText(S, kind) {
  const count = (S[kind] || []).length;
  return `${count} of ${(S.players || []).length} ${kind === 'submitted' ? 'phrases saved' : kind === 'drawn' ? 'have ink on paper' : 'captions saved'}`;
}
function book(content, extra = '') {
  return `<div class="dp-book ${extra}"><div class="dp-page">${content}</div></div>`;
}
function prompt(text, label) {
  return `<div class="dp-prompt"><span class="dp-prompt-label">${esc(label)}</span><p class="sk-phrase">${esc(text)}</p></div>`;
}
function zoomHtml() {
  return '<div class="dp-zoom" aria-label="Canvas view"><button type="button" id="pPan" data-watchok aria-pressed="false">Pan</button><button type="button" id="pZoomOut" data-watchok aria-label="Zoom out">−</button><span id="pZoomValue">100%</span><button type="button" id="pZoomIn" data-watchok aria-label="Zoom in">+</button><button type="button" id="pFit" data-watchok>Fit</button></div>';
}
function syncView(cv) {
  const viewport = cv?.closest('.sk-canvaswrap');
  if (!viewport) return;
  const r = viewport.getBoundingClientRect();
  if (!r.width || !r.height) return;
  const scale = Math.min(r.width / 880, r.height / 520) * zoom;
  const width = 880 * scale, height = 520 * scale;
  panX = Math.max(-Math.max(0, (width - r.width) / 2), Math.min(Math.max(0, (width - r.width) / 2), panX));
  panY = Math.max(-Math.max(0, (height - r.height) / 2), Math.min(Math.max(0, (height - r.height) / 2), panY));
  cv.setAttribute('style', `width:${width}px;height:${height}px;left:50%;top:50%;transform:translate(calc(-50% + ${panX}px),calc(-50% + ${panY}px));cursor:${hand ? 'grab' : snapshot?.phase === 'draw' && !snapshot.spectator ? 'crosshair' : zoom > 1 ? 'grab' : 'default'}`);
  cv.setAttribute('data-pan', String(hand || zoom > 1));
  const root = cv.closest('.dp');
  const value = root?.querySelector('#pZoomValue');
  if (value) value.textContent = `${Math.round(zoom * 100)}%`;
  const minus = root?.querySelector('#pZoomOut'), plus = root?.querySelector('#pZoomIn'), pan = root?.querySelector('#pPan');
  if (minus) minus.disabled = zoom <= 1;
  if (plus) plus.disabled = zoom >= 3;
  pan?.setAttribute('aria-pressed', String(hand));
}
function tools() {
  return `<div class="toolbar sk-toolrail dp-tools" role="toolbar" aria-label="Drawing tools">
    ${COLORS.slice(0, 5).map((c, i) => `<button type="button" class="swatch dp-puck ${c === color ? 'sel' : ''}" data-c="${c}" style="--swatch:${c}" aria-label="${COLOR_NAMES[i]} ink" aria-pressed="${c === color}"><span aria-hidden="true"></span></button>`).join('')}
    <button type="button" id="pPen" class="dp-tool ${color !== '#ffffff' ? 'sel' : ''}" aria-label="Ink pen" aria-pressed="${color !== '#ffffff'}">${PEN_ICON}</button>
    ${[3, 7, 16].map(n => `<button type="button" class="dp-brush ${size === n ? 'sel' : ''}" data-size="${n}" aria-label="${n === 3 ? 'Fine' : n === 7 ? 'Medium' : 'Bold'} brush, ${n} pixels" aria-pressed="${size === n}"><span style="--dot:${n}px" aria-hidden="true"></span></button>`).join('')}
    <button type="button" class="dp-tool ${color === '#ffffff' ? 'sel' : ''}" data-c="#ffffff" id="pEraser" aria-label="White eraser" aria-pressed="${color === '#ffffff'}">${ERASER_ICON}</button>
    <button type="button" class="dp-tool" id="pClear" aria-label="Clear drawing">${CLEAR_ICON}</button>
    <button type="button" class="dp-tool" id="pUndo" aria-label="Undo last gesture" disabled>${UNDO_ICON}</button><p class="dp-ink-feedback" id="pInkFeedback" role="status"></p>
  </div>`;
}

export default {
  styles: ['/css/draw-phone.css'],
  ownsTimer: true,
  dispose() {
    stopHudTimer(lastEl); lastEl = null;
    unbindAll(); drawing = false; cur = []; pending = [];
    phaseKey = ''; lastKey = ''; canvasFocused = false; toolsVisible = true; snapshot = cueBaseline = null; visibleStrokes = []; revealedPages.clear(); savedCounter = 0; removeCss();
  },
  render(el, S, api) {
    ensureCss();
    // Keep accepted page feedback until the new scene's readiness release.
    const prior = cueBaseline;
    const live = !!prior && prior.instanceId === S.instanceId && prior.me === S.me && prior.spectator === S.spectator && !S.preparing && !S.audioBaseline;
    if (!prior || prior.instanceId !== S.instanceId) { revealedPages.clear(); savedCounter = 0; }
    const page = `${S.instanceId}:${S.revealIdx}`;
    const reveal = live && S.phase === 'reveal' && (prior.phase !== 'reveal' || prior.revealIdx !== S.revealIdx) && !revealedPages.has(page);
    const seed = !prior || prior.instanceId !== S.instanceId || prior.me !== S.me || prior.spectator !== S.spectator || S.audioBaseline;
    if (S.phase === 'reveal' && (!S.preparing || seed)) revealedPages.add(page);
    const dealt = live && prior.phase !== S.phase && ['draw', 'guess'].includes(S.phase);
    const saved = live && !S.spectator && ((S.phase === 'write' && S.myPhrase && S.myPhrase !== prior.myPhrase) || (S.phase === 'guess' && S.myGuess && S.myGuess !== prior.myGuess));
    snapshot = S;
    if (seed || !S.preparing) cueBaseline = S;
    const nextPhase = `${S.instanceId || ''}:${S.phase}:${S.me || ''}:${!!S.spectator}`;
    const followPhase = nextPhase !== phaseKey && typeof document !== 'undefined' &&
      el.contains?.(document.activeElement) && !document.querySelector?.('.room-menu[open]');
    if (nextPhase !== phaseKey) {
      phaseKey = nextPhase; unbindAll(); pending = []; lastKey = ''; canvasFocused = false; toolsVisible = true; zoom = 1; panX = panY = 0; hand = false;
      revision = S.inkRevision || 0; gestureId = S.lastGestureId || 0; visibleStrokes = S.myStrokes || [];
    }
    if (S.phase === 'draw') {
      if ((S.inkRevision || 0) > revision || (S.myInkFeedback && (S.inkRevision || 0) < revision)) {
        drawing = false; cur = []; pending = []; panStart = null; releaseCapture(); revision = S.inkRevision || 0;
      }
      gestureId = Math.max(gestureId, S.lastGestureId || 0);
      if ((S.inkRevision || 0) === revision) visibleStrokes = S.myStrokes || [];
    }
    if (S.phase === 'write') renderWrite(el, S, api);
    else if (S.phase === 'draw') renderDraw(el, S, api);
    else if (S.phase === 'guess') renderGuess(el, S, api);
    else if (S.phase === 'reveal') renderReveal(el, S, api);
    else {
      lastKey = `done:${S.instanceId || ''}`;
      el.innerHTML = `<div class="sk sk-phone dp dp-done gk-final gk-col" role="status">${resultsHtml({ scores: S.scores || {}, players: S.players || [], you: S.spectator ? null : S.me })}${S.spectator ? '<p class="gk-final-note">You watched this game.</p>' : ''}</div>`;
    }
    if (dealt || reveal) {
      if (!reduced()) el.querySelector('.dp-book')?.animate?.([{ opacity: .5, transform: 'translateX(10px) rotate(.4deg)' }, { opacity: 1, transform: 'none' }], { duration: 240, easing: 'ease-out' });
      api.cue?.(reveal ? 'reveal' : 'deal', { id: `${S.instanceId}:${reveal ? 'story:' + S.revealIdx : S.phase}:page`, gain: .7 });
    } else if (saved) api.cue?.('place', { id: `${S.instanceId}:${S.phase}:saved:${++savedCounter}`, gain: .5 });
    // A retired input must not leave the next notebook page under the fixed Room launcher.
    if (followPhase && typeof window !== 'undefined') window.scrollTo?.({ top: 0, behavior: 'instant' });
    lastEl = el;
    syncHudTimer(el, S, api);
  },
};

function renderWrite(el, S, api) {
  const key = `write:${S.instanceId || ''}:${S.me || ''}:${!!S.spectator}`;
  if (lastKey === key) {
    el.querySelector('#pWriteStatus').textContent = statusText(S, 'submitted');
    el.querySelector('#pSaved').textContent = S.myPhrase ? 'Saved. You can still change your phrase.' : '';
    updateRoster(el, S); return;
  }
  lastKey = key;
  const sugg = (S.suggestions || []).map(s => `<button type="button" class="dp-suggestion gk-btn" data-s="${esc(s)}" ${S.spectator ? 'disabled' : ''}>${esc(s)}</button>`).join('');
  el.innerHTML = desk(S, book(`<div class="dp-writing"><span class="dp-page-kicker gk-meta">A new story starts here</span><h3 class="gk-prompt">Write something funny for someone else to draw</h3><p class="dp-status gk-meta" id="pWriteStatus">${statusText(S, 'submitted')}</p>
    ${S.spectator ? '<p class="dp-watching">The players are writing their private phrases.</p>' : `<div class="dp-entry gk-input-row"><input id="pPhrase" class="gk-input" aria-label="Starting phrase for the drawing chain" type="text" maxlength="80" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="send" inputmode="text" placeholder="A penguin opening a bakery…" value="${esc(S.myPhrase || '')}"><button type="button" class="dp-save gk-btn gk-primary" id="pSend">Save phrase</button></div>`}
    <p class="dp-saved" id="pSaved" role="status">${S.myPhrase ? 'Saved. You can still change your phrase.' : ''}</p>
    ${S.spectator ? '' : `<div class="dp-inspiration"><h4 class="gk-meta">Or borrow an idea</h4><div class="sk-sugg">${sugg}</div></div>`}</div>`, 'dp-writing-book'));
  const inp = el.querySelector('#pPhrase');
  const send = () => { if (inp && inp.value.trim() && !S.spectator) api.send({ phrase: inp.value.trim() }); };
  const btn = el.querySelector('#pSend'); if (btn) btn.onclick = send;
  if (inp) inp.onkeydown = e => { if (e.key === 'Enter' && !e.isComposing) send(); };
  el.querySelectorAll('[data-s]').forEach(b => { b.onclick = () => { if (inp && !inp.disabled) inp.value = b.dataset.s; }; });
}

function renderDraw(el, S, api) {
  const key = `draw:${S.instanceId || ''}:${S.me || ''}:${!!S.spectator}`;
  if (key !== lastKey) {
    lastKey = key;
    el.innerHTML = desk(S, `<div class="dp-draw-heading">${prompt(S.spectator ? 'Private sketchbooks are open' : (S.myPrompt || '…'), S.spectator ? 'Watching' : 'Your private prompt')}${S.spectator ? '' : '<div class="dp-view-controls"><button type="button" id="pFocus" aria-label="Focus canvas" aria-pressed="false"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg><span class="dp-focus-label">Focus canvas</span></button><button type="button" id="pTools" aria-expanded="true">Tools</button></div>'}<div class="dp-done-row">${S.spectator ? '' : `<button type="button" id="pDone" class="gk-btn gk-primary" aria-pressed="${!!S.myDone}">${S.myDone ? 'Keep drawing' : 'Done'}</button>`}<p class="dp-status sk-byline gk-meta">${doneText(S)}</p></div></div><div class="sk-drawdesk">${book(`<div class="sk-canvaswrap"><canvas class="doodle" id="pCanvas" data-drawable="${!S.spectator}" width="880" height="520" tabindex="0" aria-label="${S.spectator ? 'Private drawings are hidden until reveal' : 'Your drawing canvas'}"></canvas></div>${S.spectator ? '' : zoomHtml()}`)}${S.spectator ? '<p class="dp-watching">The drawings stay private until the stories are read.</p>' : tools()}</div>`);
    wireDraw(el, api, S.spectator);
    wireFocus(el);
    const done = el.querySelector('#pDone');
    if (done) done.onclick = () => {
      if (snapshot?.phase !== 'draw' || snapshot.spectator) return;
      finishHeld();
      api.send({ done: !snapshot.myDone });
    };
  } else {
    el.querySelector('.sk-byline').textContent = doneText(S); updateRoster(el, S);
  }
  const done = el.querySelector('#pDone');
  if (done) {
    const label = S.myDone ? 'Keep drawing' : 'Done';
    if (done.textContent !== label) done.textContent = label;
    done.className = S.myDone ? 'gk-btn' : 'gk-btn gk-primary';
    done.setAttribute('aria-pressed', String(!!S.myDone));
    done.disabled = !S.myDone && !visibleStrokes.length && !pending.length;
  }
  paintStrokes(el.querySelector('#pCanvas'), visibleStrokes, true);
  refreshInk(el);
}

// The canvas stays mounted: CSS alone changes the usable page area.
function wireFocus(el) {
  const root = el.querySelector('.dp'), focus = el.querySelector('#pFocus'), toggle = el.querySelector('#pTools');
  const cv = el.querySelector('#pCanvas');
  if (!root || !cv) return;
  const sync = () => {
    root.classList.toggle('dp-focus', canvasFocused);
    root.classList.toggle('dp-tools-hidden', canvasFocused && !toolsVisible);
    focus?.setAttribute('aria-pressed', String(canvasFocused));
    focus?.setAttribute('aria-label', canvasFocused ? 'Exit canvas focus' : 'Focus canvas');
    if (focus) focus.querySelector('span').textContent = canvasFocused ? 'Exit focus' : 'Focus canvas';
    toggle?.setAttribute('aria-expanded', String(toolsVisible));
    syncView(cv);
  };
  if (focus) focus.onclick = () => { finishHeld(); endPan(); canvasFocused = !canvasFocused; if (canvasFocused) toolsVisible = false; zoom = canvasFocused && typeof matchMedia === 'function' && matchMedia('(max-width:600px)').matches ? 3 : 1; panX = panY = 0; sync(); };
  if (toggle) toggle.onclick = () => { finishHeld(); endPan(); toolsVisible = !toolsVisible; sync(); };
  on(typeof document !== 'undefined' ? document : root, 'keydown', e => {
    if (e.key === 'Escape' && canvasFocused && el.contains?.(e.target)) { e.preventDefault(); finishHeld(); endPan(); canvasFocused = false; zoom = 1; panX = panY = 0; sync(); focus?.focus({ preventScroll: true }); }
  });
  const target = typeof window !== 'undefined' ? window : cv;
  const pointerEvents = typeof target.PointerEvent === 'function';
  let panId = null, panTouch = null;
  const contact = e => e.touches ? Array.from(e.touches).find(t => t.identifier === panTouch) : e;
  const endPan = e => {
    if (!panStart || (e?.pointerId !== undefined && e.pointerId !== panId) || (e?.changedTouches && !Array.from(e.changedTouches).some(t => t.identifier === panTouch))) return;
    panStart = null; panId = panTouch = null; releaseCapture();
  };
  const startPan = e => {
    if (drawing || panStart || (e.button !== undefined && e.button !== 0) || document.querySelector?.('.room-menu[open]')) return;
    if (!hand && !(snapshot?.phase !== 'draw' && zoom > 1)) return;
    if (e.touches) panTouch = e.changedTouches?.[0]?.identifier ?? e.touches[0]?.identifier;
    const point = contact(e); if (!point) return;
    e.preventDefault(); panId = pointerEvents ? e.pointerId : null;
    panStart = { x: point.clientX, y: point.clientY, panX, panY };
    if (pointerEvents) { capturedPointer = { canvas: cv, id: panId }; try { cv.setPointerCapture?.(panId); } catch {} }
  };
  const movePan = e => {
    if (!panStart || (pointerEvents && e.pointerId !== panId)) return;
    const point = contact(e); if (!point) return;
    e.preventDefault(); panX = panStart.panX + point.clientX - panStart.x; panY = panStart.panY + point.clientY - panStart.y; syncView(cv);
  };
  if (pointerEvents) {
    on(cv, 'pointerdown', startPan); on(target, 'pointermove', movePan); on(target, 'pointerup', endPan); on(target, 'pointercancel', endPan); on(cv, 'lostpointercapture', endPan);
  } else {
    on(cv, 'mousedown', startPan); on(cv, 'mousemove', movePan); on(target, 'mouseup', endPan);
    on(cv, 'touchstart', startPan, { passive: false }); on(cv, 'touchmove', movePan, { passive: false }); on(target, 'touchend', endPan); on(target, 'touchcancel', endPan);
  }
  const changeZoom = value => { finishHeld(); endPan(); zoom = Math.max(1, Math.min(3, value)); sync(); };
  const plus = el.querySelector('#pZoomIn'), minus = el.querySelector('#pZoomOut'), fit = el.querySelector('#pFit'), pan = el.querySelector('#pPan');
  if (plus) plus.onclick = () => changeZoom(zoom + .5);
  if (minus) minus.onclick = () => changeZoom(zoom - .5);
  if (fit) fit.onclick = () => { finishHeld(); endPan(); zoom = 1; panX = panY = 0; hand = false; sync(); };
  if (pan) pan.onclick = () => { finishHeld(); endPan(); hand = !hand; sync(); };
  on(cv, 'keydown', e => {
    const shifts = { ArrowLeft: [44, 0], ArrowRight: [-44, 0], ArrowUp: [0, 44], ArrowDown: [0, -44] };
    if (zoom > 1 && shifts[e.key]) { e.preventDefault(); finishHeld(); endPan(); panX += shifts[e.key][0]; panY += shifts[e.key][1]; sync(); }
  });
  on(target, 'resize', () => { finishHeld(); endPan(); sync(); }); on(target, 'blur', () => endPan());
  on(typeof document !== 'undefined' ? document : root, 'visibilitychange', () => { if (document.hidden) endPan(); });
  on(typeof document !== 'undefined' ? document : root, 'toggle', e => { if (e.target?.matches?.('.room-menu[open]')) endPan(); }, true);
  if (typeof ResizeObserver === 'function') { const observer = new ResizeObserver(() => { if (resizeObserver !== observer) return; finishHeld(); endPan(); sync(); }); resizeObserver = observer; observer.observe(cv.closest('.sk-canvaswrap')); }
  sync();
}

function renderGuess(el, S, api) {
  const key = `guess:${S.instanceId || ''}:${S.me || ''}:${!!S.spectator}`;
  if (key !== lastKey) {
    lastKey = key;
    el.innerHTML = desk(S, `<div class="dp-caption-heading"><h3 class="gk-prompt">${S.spectator ? 'A page is being passed' : 'What do you see?'}</h3><p class="dp-status gk-meta" id="pGuessStatus">${statusText(S, 'guessed')}</p></div>${book(`<div class="sk-canvaswrap"><canvas class="doodle" id="pCanvas" width="880" height="520" tabindex="0" aria-label="${S.spectator ? 'Private drawings are hidden until reveal' : 'Drawing to describe'}"></canvas></div>${S.spectator ? '' : zoomHtml()}`)}
      ${S.spectator ? '<p class="dp-watching">The players are writing private captions.</p>' : `<div class="dp-caption-strip"><div class="dp-entry gk-input-row"><input id="pGuess" class="gk-input" aria-label="Caption the drawing" type="text" maxlength="80" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="send" inputmode="text" placeholder="Your caption…" value="${esc(S.myGuess || '')}"><button type="button" class="dp-save gk-btn gk-primary" id="pSend">Save caption</button></div><p class="dp-saved" id="pCaptionSaved" role="status"></p></div>`}`);
    const inp = el.querySelector('#pGuess');
    const send = () => { if (inp && inp.value.trim() && !S.spectator) api.send({ guess: inp.value.trim() }); };
    const btn = el.querySelector('#pSend'); if (btn) btn.onclick = send;
    if (inp) inp.onkeydown = e => { if (e.key === 'Enter' && !e.isComposing) send(); };
    wireFocus(el);
  }
  el.querySelector('#pGuessStatus').textContent = statusText(S, 'guessed'); updateRoster(el, S);
  const saved = el.querySelector('#pCaptionSaved');
  if (saved) saved.textContent = S.myGuess ? 'Saved. You can still change your caption.' : '';
  paintStrokes(el.querySelector('#pCanvas'), S.myDrawing || []);
}

function renderReveal(el, S, api) {
  const key = `reveal:${S.instanceId || ''}:${S.me || ''}:${S.revealIdx}:${S.me === S.hostId ? 'h' : 'g'}`;
  const chains = S.chains || [], c = chains[S.revealIdx], isHost = S.me === S.hostId && !S.spectator;
  if (!c) { el.innerHTML = desk(S, book('<h3>No chains yet</h3>')); return; }
  if (key !== lastKey) {
    const focused = typeof document !== 'undefined' && el.contains?.(document.activeElement) ? document.activeElement?.id : '';
    unbindAll(); zoom = 1; panX = panY = 0; hand = false;
    lastKey = key;
    el.innerHTML = desk(S, `<div class="dp-story-heading"><h3 class="gk-prompt">Story ${S.revealIdx + 1} of ${chains.length}</h3>${isHost ? `<div class="dp-page-actions gk-actions"><button type="button" id="pPrev" class="dp-page-back gk-btn" aria-label="Previous story" ${S.revealIdx === 0 ? 'disabled' : ''}>←</button><button type="button" id="pNext" class="dp-save gk-btn gk-primary">${S.revealIdx === chains.length - 1 ? 'Final scores' : 'Next'} <span aria-hidden="true">→</span></button></div>` : '<p class="gk-wait dp-status">The host turns the pages</p>'}</div>
      ${prompt(c.phrase, `Written by ${nameOf(S, c.origin)}`)}${book(`<div class="sk-canvaswrap"><canvas class="doodle" id="pCanvas" width="880" height="520" tabindex="0" aria-label="Chain drawing"></canvas></div>${zoomHtml()}`)}<div class="dp-story-caption${c.survived ? ' is-kept' : ''}"><span class="sk-byline">Drawn by ${esc(nameOf(S, c.drawBy))}</span><p class="sk-phrase">${esc(c.guess || '…')}</p><span class="sk-byline">Captioned by ${esc(nameOf(S, c.guessBy))}</span>${c.survived ? '<p class="dp-kept">The story survived: +50 each for drawing and caption</p>' : ''}</div>`);
    wireFocus(el);
    const nx = el.querySelector('#pNext'); if (nx) nx.onclick = () => api.send({ next: true });
    const pv = el.querySelector('#pPrev'); if (pv) pv.onclick = () => api.send({ prev: true });
    if (focused === 'pNext' || focused === 'pPrev') {
      const next = el.querySelector('#' + focused);
      if (next && !next.disabled) api.focus?.(next);
    }
  }
  paintStrokes(el.querySelector('#pCanvas'), c.strokes || []);
}

function doneText(S) {
  if (S.spectator) return statusText(S, 'drawn');
  return S.myDone ? 'Done. Waiting for the others; you can keep drawing until then.' : 'Press Done when your drawing is finished.';
}

function refreshInk(el) {
  const undo = el.querySelector('#pUndo');
  if (undo) undo.disabled = !drawing && !pending.length && !visibleStrokes.length;
  const feedback = el.querySelector('#pInkFeedback');
  if (feedback) feedback.textContent = snapshot?.myInkFeedback || '';
}

function wireDraw(el, api, spectator) {
  const cv = el.querySelector('#pCanvas');
  const swatches = () => el.querySelectorAll('[data-c]');
  const selectInk = value => {
    color = value; if (value !== '#ffffff') penColor = value;
    swatches().forEach(x => { const selected = x.dataset.c === color; x.classList.toggle('sel', selected); x.setAttribute('aria-pressed', String(selected)); });
    const pen = el.querySelector('#pPen');
    if (pen) { pen.classList.toggle('sel', color !== '#ffffff'); pen.setAttribute('aria-pressed', String(color !== '#ffffff')); }
  };
  swatches().forEach(s => { s.onclick = () => selectInk(s.dataset.c); });
  const pen = el.querySelector('#pPen'); if (pen) pen.onclick = () => selectInk(penColor);
  el.querySelectorAll('[data-size]').forEach(b => { b.onclick = () => {
    size = Number(b.dataset.size);
    el.querySelectorAll('[data-size]').forEach(x => { const selected = Number(x.dataset.size) === size; x.classList.toggle('sel', selected); x.setAttribute('aria-pressed', String(selected)); });
  }; });
  const mutate = undo => {
    if (snapshot?.phase !== 'draw' || snapshot.spectator || !snapshot.inkNonce) return;
    const target = drawing ? gestureId : pending.at(-1)?.gestureId || visibleStrokes.at(-1)?.gestureId;
    if (undo && !target) return;
    const oldRevision = revision;
    drawing = false; cur = []; pending = []; panStart = null; releaseCapture();
    visibleStrokes = undo ? visibleStrokes.filter(s => s.gestureId !== target) : [];
    revision += 1;
    paintStrokes(cv, visibleStrokes, true);
    api.send({ [undo ? 'undo' : 'clear']: true, inkNonce: snapshot.inkNonce, inkRevision: oldRevision });
    refreshInk(el);
  };
  const clear = el.querySelector('#pClear'); if (clear) clear.onclick = () => mutate(false);
  const undo = el.querySelector('#pUndo'); if (undo) undo.onclick = () => mutate(true);
  if (!cv || spectator) return;
  let pointerId = null, touchId = null;
  const pointerEvents = typeof window !== 'undefined' && typeof window.PointerEvent === 'function';
  const contact = e => e.touches ? Array.from(e.touches).find(p => p.identifier === touchId) : e;
  const pos = p => {
    const r = cv.getBoundingClientRect();
    return [Math.max(0, Math.min(1, (p.clientX - r.left) / r.width)), Math.max(0, Math.min(1, (p.clientY - r.top) / r.height))];
  };
  const metadata = () => ({ inkNonce: snapshot.inkNonce, inkRevision: revision, gestureId, chunk });
  const preview = () => {
    api.send({ preview: { pts: cur.length > 1 ? cur.map(p => [...p]) : [cur[0], cur[0]], ...activeInk }, ...metadata(), sample: ++sample }, { silent: true });
    previewAt = Date.now();
  };
  const down = e => {
    if (drawing || hand || panStart || snapshot?.phase !== 'draw' || snapshot.spectator || !snapshot.inkNonce ||
        (e.button !== undefined && e.button !== 0) || (typeof document !== 'undefined' && document.querySelector?.('.room-menu[open]'))) return;
    if (e.touches) touchId = e.changedTouches?.[0]?.identifier ?? e.touches[0]?.identifier;
    const p = contact(e); if (!p) return;
    e.preventDefault(); pointerId = pointerEvents ? e.pointerId : null;
    drawing = true; cur = [pos(p)]; activeInk = { color, size }; gestureId += 1; chunk = 0; sample = 0;
    if (pointerEvents) {
      capturedPointer = { canvas: cv, id: pointerId };
      try { cv.setPointerCapture?.(pointerId); } catch { /* window listeners still finish the gesture */ }
    }
    paintStroke(cv.getContext('2d'), cv, cur, activeInk.color, activeInk.size); preview(); refreshInk(el);
  };
  const commit = finished => {
    if (!cur.length) return;
    if (cur.length === 1) cur.push([...cur[0]]);
    const stroke = { pts: cur.map(p => [...p]), ...activeInk };
    pending.push({ ...stroke, gestureId, chunk });
    api.send({ stroke, ...metadata(), finished }, { silent: true });
    chunk += 1; sample = 0; cur = finished ? [] : [cur.at(-1)];
  };
  const move = e => {
    if (!drawing || (pointerEvents && e.pointerId !== pointerId)) return;
    const p = contact(e); if (!p) return;
    e.preventDefault(); const point = pos(p);
    if (cur.at(-1)?.[0] === point[0] && cur.at(-1)?.[1] === point[1]) return;
    cur.push(point); paintStroke(cv.getContext('2d'), cv, cur.slice(-2), activeInk.color, activeInk.size);
    if (cur.length >= 200) {
      commit(false);
      if (chunk >= 400) { drawing = false; cur = []; releaseCapture(); refreshInk(el); }
    } else if (Date.now() - previewAt >= 80) preview();
  };
  const up = e => {
    if (!drawing || (e?.pointerId !== undefined && e.pointerId !== pointerId) ||
        (e?.changedTouches && !Array.from(e.changedTouches).some(p => p.identifier === touchId))) return;
    drawing = false;
    try { commit(true); } finally { cur = []; pointerId = null; touchId = null; releaseCapture(); }
    refreshInk(el);
  };
  finishHeld = () => up();
  const target = typeof window !== 'undefined' ? window : cv;
  if (pointerEvents) {
    on(cv, 'pointerdown', down); on(target, 'pointermove', move); on(target, 'pointerup', up);
    on(target, 'pointercancel', up); on(cv, 'lostpointercapture', up);
  } else {
    on(cv, 'mousedown', down); on(cv, 'mousemove', move); on(target, 'mouseup', up);
    on(cv, 'touchstart', down, { passive: false }); on(cv, 'touchmove', move, { passive: false });
    on(target, 'touchend', up); on(target, 'touchcancel', up);
  }
  on(target, 'blur', finishHeld); on(target, 'orientationchange', finishHeld);
  on(target.screen?.orientation, 'change', finishHeld);
  if (typeof document !== 'undefined' && document.addEventListener) {
    on(document, 'visibilitychange', () => { if (document.hidden) up(); });
    on(document, 'game-screenchange', finishHeld); on(document, 'fullscreenchange', finishHeld);
    on(document, 'toggle', e => { if (e.target?.matches?.('.room-menu[open]')) up(); }, true);
    on(document, 'keydown', e => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey &&
          !e.target?.closest?.('input,textarea,[contenteditable=true]') && !document.querySelector?.('.room-menu[open]')) { e.preventDefault(); mutate(true); }
    });
  }
}

function paintStrokes(cv, strokes, local = false) {
  if (!cv) return;
  const ctx = cv.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, cv.width, cv.height);
  for (const s of strokes) paintStroke(ctx, cv, s.pts, s.color, s.size);
  if (local) {
    const acknowledged = new Set(strokes.map(s => `${s.gestureId}:${s.chunk}`));
    pending = pending.filter(s => !acknowledged.has(`${s.gestureId}:${s.chunk}`));
    for (const s of pending) paintStroke(ctx, cv, s.pts, s.color, s.size);
    if (drawing) paintStroke(ctx, cv, cur, activeInk.color, activeInk.size);
  }
}

function paintStroke(ctx, cv, pts, strokeColor, strokeSize) {
  if (!ctx || !pts?.length) return;
  ctx.globalCompositeOperation = 'source-over';
  ctx.strokeStyle = strokeColor;
  ctx.fillStyle = strokeColor;
  ctx.lineWidth = strokeSize * (cv.width / 880);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (pts.length === 1 || pts.every(p => p[0] === pts[0][0] && p[1] === pts[0][1])) {
    ctx.beginPath(); ctx.arc(pts[0][0] * cv.width, pts[0][1] * cv.height, ctx.lineWidth / 2, 0, Math.PI * 2); ctx.fill(); return;
  }
  ctx.beginPath();
  ctx.moveTo(pts[0][0] * cv.width, pts[0][1] * cv.height);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0] * cv.width, pts[i][1] * cv.height);
  ctx.stroke();
}

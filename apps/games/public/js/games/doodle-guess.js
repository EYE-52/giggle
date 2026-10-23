/* Doodle Guess: one shared canvas, a compact artist palette and live guesses.
 * Built on the game kit (public/css/game-ui.css): HUD row, prompt line,
 * kit buttons, choices and results; flat tokens only (doodle-guess.css).
 * Contracts: { choose }, { stroke }, { preview }, { clear }, { undo },
 * { guess }, { next }. Ink carries a turn nonce, canvas revision and gesture ID. */
import { esc, nameOf, countdown, ensureStylesheet } from '../util.js';
import { resultsHtml, waitCardHtml } from '../kit.js';

const CSS = [['doodle-guess-css', '/css/doodle-guess.css']];
const COLORS = ['#111111', '#e4572e', '#1d7a3a', '#1d4ed8', '#f2b134'];
const COLOR_NAMES = ['Black', 'Orange', 'Green', 'Blue', 'Yellow'];
const SIZES = [3, 7, 16];
let color = '#111111', size = 7, tool = 'pen';
let drawing = false, cur = [], pending = [], activeInk = null;
let gestureId = 0, chunk = 0, sample = 0, previewAt = 0;
let lastKey = '', revision = 0, visibleStrokes = [], snapshot = null, cueBaseline = null;
let capturedPointer = null, bound = [], clock = null, feedKey = '', resizeObserver = null;
function reduced() { return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches; }

function ensureCss() {
  for (const [id, href] of CSS) ensureStylesheet(id, href);
}
function on(target, type, fn, opts) {
  if (!target?.addEventListener) return;
  target.addEventListener(type, fn, opts);
  bound.push([target, type, fn, opts]);
}
function releaseCapture() {
  const held = capturedPointer;
  capturedPointer = null;
  if (held) try { held.canvas.releasePointerCapture?.(held.id); } catch { /* already released */ }
}
function abandon() {
  drawing = false; cur = []; activeInk = null;
  releaseCapture();
}
function unbindAll() {
  abandon();
  for (const [target, type, fn, opts] of bound) target.removeEventListener(type, fn, opts);
  bound = [];
  resizeObserver?.disconnect(); resizeObserver = null;
  if (clock !== null) clearInterval(clock);
  clock = null;
}
function spacedMask(masked) { return Array.from(String(masked || '')).join(' '); }
function isArtist(S) { return S?.phase === 'draw' && S.me === S.drawer && !S.spectator; }
function outcomesHtml(S) {
  const ids = Object.keys(S.guessed || {});
  return ids.length ? ids.map(pid => `<span class="dg-found">${esc(nameOf(S, pid))} <b>+${S.guessed[pid]}</b></span>`).join('') : '';
}
function rosterHtml(S) {
  return (S.players || []).map((p, i) => `<li><i style="--player-ink:${COLORS[i % COLORS.length]}" aria-hidden="true"></i><span>${esc(p.name)}${p.id === S.drawer ? ' <small>drawing</small>' : ''}</span><b>${S.scores?.[p.id] || 0}</b></li>`).join('');
}
function toolArt(kind) {
  return kind === 'pen'
    ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20l1.2-4.6L15.8 4.8a2 2 0 0 1 2.8 0l.6.6a2 2 0 0 1 0 2.8L8.6 18.8z"/><path d="M13.8 6.8l3.4 3.4"/></svg>'
    : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.5 20H20M4.6 15.4l9.8-9.8a2 2 0 0 1 2.8 0l2.2 2.2a2 2 0 0 1 0 2.8L12 18H8.2z"/><path d="M9.2 10.8l4.6 4.6"/></svg>';
}

function phaseName(S) {
  return S.phase === 'pick' ? 'Choosing' : S.phase === 'draw' ? 'Drawing' : S.phase === 'reveal' ? 'Reveal' : '';
}
function progressLabel(S) {
  if (S.phase !== 'draw') return '';
  const guessers = (S.players || []).filter(p => p.id !== S.drawer && !p.left && !(S.gone || []).includes(p.id)).length;
  return `${Object.keys(S.guessed || {}).length} of ${guessers} guessed`;
}
function dgHudHtml(S) {
  return `<div class="gk-hud dg-hud"><span class="gk-hud-round">Round ${esc(S.round)} of ${esc(S.rounds)}</span>`
    + `<span class="gk-hud-phase">${esc(phaseName(S))}</span>`
    + `<span class="gk-hud-progress" id="dProgress">${esc(progressLabel(S))}</span>`
    + `<span class="gk-hud-timer dg-clock" id="dClock" role="timer" aria-live="off"></span></div>`;
}
function canAdvance(S) {
  return !S.spectator && (S.me === S.drawer || S.me === S.hostId);
}
/* Round result: the word, then who scored what (artist share included). */
function roundResultHtml(S) {
  const last = S.lastRound && S.lastRound.round === S.round ? S.lastRound : null;
  const points = last?.points || S.roundPoints || {};
  const ids = Object.keys(points).filter(pid => points[pid] > 0).sort((a, b) => points[b] - points[a] || nameOf(S, a).localeCompare(nameOf(S, b)));
  const rows = ids.map(pid => `<li class="dg-result-row${pid === S.me ? ' is-you' : ''}"><span class="dg-result-pts">+${esc(points[pid])}</span><span class="dg-result-who">${esc(nameOf(S, pid))}${pid === S.drawer ? ' <small>artist</small>' : ''}</span></li>`).join('');
  const reason = last?.reason && last.reason !== 'Everyone got it' ? `<p class="gk-meta">${esc(last.reason)}</p>` : '';
  return `<div class="dg-result" role="status"><p class="dg-result-title">${ids.length ? (last?.correct && last.correct === last.guessers ? 'Everyone got it' : 'Round points') : 'Nobody got it this time'}</p>${reason}${rows ? `<ol class="dg-result-list">${rows}</ol>` : ''}</div>`
    + `<div class="dg-next-row">${canAdvance(S) ? '<button type="button" id="dNext" class="gk-btn gk-primary dg-next">Next</button>' : `<p class="gk-wait dg-next">${S.round >= S.rounds ? 'Final scores are next' : 'Next round starts soon'}</p>`}</div>`;
}
function headerHtml(S) {
  const artist = S.me === S.drawer && !S.spectator;
  const word = S.phase === 'draw'
    ? (artist ? `Draw <b>${esc(S.wordShown || '')}</b>` : esc(spacedMask(S.masked)))
    : S.phase === 'reveal' ? `The word was <b>${esc(S.word || '')}</b>` : (artist ? 'Pick a word to draw' : 'Get ready to guess');
  return `<header class="dg-header sk-deskcue">${dgHudHtml(S)}
    <div class="dg-word sk-hintline" ${!artist && S.phase === 'draw' ? `aria-label="Hidden word, ${Array.from(S.masked || '').length} characters"` : ''}>${word}</div>
  </header>`;
}
function toolsHtml() {
  return `<div class="dg-tools sk-toolrail" role="toolbar" aria-label="Drawing tools">
    <div class="dg-colors" aria-label="Ink colors">${COLORS.map((c, i) => `<button type="button" class="dg-swatch swatch ${tool === 'pen' && c === color ? 'sel' : ''}" data-c="${c}" style="--swatch:${c}" aria-label="${COLOR_NAMES[i]} ink" aria-pressed="${tool === 'pen' && c === color}"><span aria-hidden="true"></span></button>`).join('')}</div>
    <button type="button" class="dg-tool dg-tool-art ${tool === 'pen' ? 'sel' : ''}" id="dPen" aria-label="Ink pen" aria-pressed="${tool === 'pen'}">${toolArt('pen')}</button>
    <div class="dg-brushes" aria-label="Brush sizes">${SIZES.map((n, i) => `<button type="button" class="dg-brush ${size === n ? 'sel' : ''}" data-size="${n}" aria-label="${['Fine', 'Medium', 'Bold'][i]} brush" aria-pressed="${size === n}"><i style="--brush:${n}px" aria-hidden="true"></i></button>`).join('')}</div>
    <button type="button" class="dg-tool dg-tool-art ${tool === 'eraser' ? 'sel' : ''}" id="dEraser" aria-label="Eraser" aria-pressed="${tool === 'eraser'}">${toolArt('eraser')}</button>
    <div class="dg-edits"><button type="button" class="dg-tool" id="dUndo" aria-label="Undo last gesture" disabled><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5L3 10L8 15M4 10H14A6 6 0 0 1 14 22"/></svg></button><button type="button" class="dg-tool" id="dClear" aria-label="Clear canvas"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7H17L16 21H8ZM5 7H19M9 7V3H15V7M11 11V17M14 11V17"/></svg></button></div>
    <p class="dg-tool-status" id="dInkFeedback" role="status" aria-live="polite"></p>
  </div>`;
}
function feedHtml(S) {
  if (!(S.guesses || []).length) return `<li class="dg-feed-empty">${S.spectator ? 'Watch the drawing and the guesses.' : S.me === S.drawer ? 'The room’s guesses will appear here.' : 'What do you see? Make the first guess.'}</li>`;
  return S.guesses.map(g => `<li data-guesser="${esc(g.pid)}" class="${g.correct ? 'dg-correct' : ''}"><b>${esc(nameOf(S, g.pid))}</b><span>${g.correct ? `Got it! <strong>+${g.points}</strong>` : esc(g.text)}</span></li>`).join('');
}
function refresh(el, S, api) {
  const clockNode = el.querySelector('#dClock');
  const updateClock = () => {
    if (!clockNode || !snapshot) return;
    const left = snapshot.endsAt ? countdown(snapshot.endsAt, api.now) : null;
    clockNode.textContent = left === null ? '' : `${left}s`;
    clockNode.classList?.toggle('is-urgent', left !== null && left <= 5 && left > 0);
  };
  updateClock();
  if (clock === null && S.endsAt && typeof setInterval === 'function') clock = setInterval(updateClock, 250);
  const progress = el.querySelector('#dProgress');
  if (progress) progress.textContent = progressLabel(S);
  const hint = el.querySelector('.sk-hintline');
  if (hint && S.phase === 'draw' && S.me !== S.drawer) {
    hint.textContent = spacedMask(S.masked);
    hint.setAttribute('aria-label', `Hidden word, ${Array.from(S.masked || '').length} characters`);
  }
  const feed = el.querySelector('#dFeed');
  const nextFeedKey = JSON.stringify(S.guesses || []);
  if (feed && nextFeedKey !== feedKey) {
    const atEnd = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 40;
    feed.innerHTML = feedHtml(S);
    if (atEnd) feed.scrollTop = feed.scrollHeight;
    feedKey = nextFeedKey;
  }
  const outcomes = el.querySelector('.sk-outcomes');
  if (outcomes) outcomes.innerHTML = outcomesHtml(S);
  const roster = el.querySelector('.dg-roster');
  if (roster) roster.innerHTML = rosterHtml(S);
  const guessed = !!S.guessed?.[S.me];
  for (const id of ['#dGuess', '#dSend']) {
    const control = el.querySelector(id);
    if (control) control.disabled = !!S.spectator || guessed;
  }
  const input = el.querySelector('#dGuess');
  if (input) input.placeholder = guessed ? 'You got it!' : 'Your guess…';
  const feedback = el.querySelector('#dFeedback');
  if (feedback) feedback.textContent = guessed ? `You got it! +${S.guessed[S.me]} points.` : S.myFeedback?.message || '';
  const inkFeedback = el.querySelector('#dInkFeedback');
  if (inkFeedback) inkFeedback.textContent = S.myInkFeedback || '';
  const undo = el.querySelector('#dUndo');
  if (undo) undo.disabled = !drawing && !pending.length && !visibleStrokes.length && !((S.inkRevision || 0) === revision && S.preview);
}

export default {
  ownsTimer: true,
  styles: CSS.map(([, href]) => href),
  dispose() {
    unbindAll(); pending = []; visibleStrokes = []; snapshot = cueBaseline = null; lastKey = ''; feedKey = '';
    if (typeof document !== 'undefined') for (const [id] of CSS) document.getElementById(id)?.remove();
  },
  render(el, S, api) {
    ensureCss();
    // Current input/ink still follows every snapshot; accepted feedback follows
    // the last released scene so preparation cannot consume its reveal.
    const prior = cueBaseline;
    const live = !!prior && prior.instanceId === S.instanceId && prior.me === S.me && prior.spectator === S.spectator && !S.preparing && !S.audioBaseline;
    const newCorrect = live && prior.round === S.round ? Object.keys(S.guessed || {}).filter(pid => !prior.guessed?.[pid]) : [];
    const revealed = live && prior.phase === 'draw' && S.phase === 'reveal';
    const hinted = live && S.phase === 'draw' && prior.phase === 'draw' && prior.masked !== S.masked && S.me !== S.drawer;
    const key = `${S.instanceId || ''}:${S.phase}:${S.round}:${S.drawer || ''}:${S.me || ''}:${!!S.spectator}:${S.phase === 'reveal' ? canAdvance(S) + ':' + JSON.stringify(S.lastRound?.points || {}) : ''}`;
    const rebuild = key !== lastKey;
    if (rebuild) {
      unbindAll(); pending = []; visibleStrokes = S.strokes || [];
      revision = S.inkRevision || 0; gestureId = S.lastGestureId || 0; feedKey = '';
      lastKey = key;
    } else if ((S.inkRevision || 0) > revision || (S.myInkFeedback && (S.inkRevision || 0) < revision)) {
      // A changed canvas or rejected command invalidates every local old fragment.
      abandon(); pending = []; revision = S.inkRevision || 0;
      visibleStrokes = S.strokes || [];
    }
    snapshot = S;
    if (!prior || prior.instanceId !== S.instanceId || prior.me !== S.me || prior.spectator !== S.spectator || S.audioBaseline || !S.preparing) cueBaseline = S;
    gestureId = Math.max(gestureId, S.lastGestureId || 0);
    if ((S.inkRevision || 0) === revision) visibleStrokes = S.strokes || [];
    if (S.phase === 'done') {
      el.innerHTML = `<div class="sk sk-doodle dg dg-done gk-final gk-col" role="status">${resultsHtml({ scores: S.scores || {}, players: S.players || [], you: S.spectator ? null : S.me })}${S.spectator ? '<p class="gk-final-note">You watched this game.</p>' : ''}</div>`;
      return;
    }
    if (rebuild) {
      const artist = isArtist(S);
      if (S.phase === 'pick') {
        const choosing = S.me === S.drawer && !S.spectator;
        el.innerHTML = `<div class="sk sk-doodle dg dg-pick gk-col gk-stack">${headerHtml(S)}${choosing
          ? `<div class="gk-choices sk-pick" role="group" aria-label="Words to draw" style="--gk-cols:3;--gk-cols-phone:1">${(S.choices || []).map((w, i) => `<button type="button" class="gk-choice" data-w="${esc(w)}"><span class="gk-mark" aria-hidden="true">${'ABC'[i] || ''}</span><span class="gk-choice-text">${esc(w)}</span></button>`).join('')}</div><p class="gk-meta dg-pick-note">Only you can see these words.</p>`
          : waitCardHtml({ kicker: S.spectator ? 'You are watching' : '', title: `${nameOf(S, S.drawer)} is picking a word`, text: 'Then they draw it and everyone guesses the word. Faster guesses score more.', waiting: `Waiting for ${nameOf(S, S.drawer)}`, attrs: 'data-dg-wait' })}</div>`;
        el.querySelectorAll?.('[data-w]').forEach(button => on(button, 'click', () => {
          if (snapshot?.phase !== 'pick' || snapshot.spectator) return;
          el.querySelectorAll('[data-w]').forEach(b => { b.disabled = true; });
          api.send({ choose: button.dataset.w });
        }));
      } else {
        const guesser = S.phase === 'draw' && !artist && !S.spectator;
        el.innerHTML = `<div class="sk sk-doodle dg dg-live">
          <div class="dg-stage"><section class="dg-drawing" aria-label="Shared drawing">${headerHtml(S)}
          <div class="dg-view-controls"><div class="dg-artist gk-meta">${S.spectator ? '<span class="dg-watching">Watching</span> · ' : ''}${artist ? 'You are drawing' : `${esc(nameOf(S, S.drawer))} ${S.phase === 'draw' ? 'is drawing' : 'drew this'}`}</div><div class="dg-view-actions"><button type="button" class="gk-btn" id="dGuesses" data-watchok aria-expanded="true" aria-controls="dChat">Guesses</button><button type="button" class="gk-btn" id="dFocus" data-watchok aria-pressed="false" aria-label="Focus canvas">Focus</button>${artist ? '<button type="button" class="gk-btn" id="dTools" aria-expanded="true" aria-controls="dToolsRail" hidden>Tools</button>' : ''}</div></div>
            <div class="dg-easel"><span class="dg-easel-cap" aria-hidden="true"></span><div class="dg-frame"><div class="sk-canvaswrap"><canvas class="doodle" id="dCanvas" data-drawable="${artist}" width="880" height="520" tabindex="0" aria-label="${artist ? 'Your drawing canvas' : 'Drawing to guess'}"></canvas></div></div>
            <div class="dg-zoom" aria-label="Canvas view"><button type="button" id="dPan" data-watchok aria-pressed="false">Pan</button><button type="button" id="dZoomOut" data-watchok aria-label="Zoom out">−</button><span id="dZoomValue">100%</span><button type="button" id="dZoomIn" data-watchok aria-label="Zoom in">+</button><button type="button" id="dFit" data-watchok>Fit</button></div>${artist ? toolsHtml() : '<div class="dg-shelf" aria-hidden="true"></div>'}</div>
          </section><aside class="dg-chat" id="dChat" aria-label="Room guesses"><ol class="dg-roster" aria-label="Players and scores">${rosterHtml(S)}</ol><div class="dg-chat-head"><b>Guesses</b><span class="sk-outcomes" aria-label="Correct guesses">${outcomesHtml(S)}</span></div>
            <ol id="dFeed" class="dg-feed" role="log" aria-live="polite" aria-relevant="additions">${feedHtml(S)}</ol>
            ${guesser ? `<form class="dg-composer" id="dGuessForm"><label for="dGuess" class="dg-label">Guess the drawing</label><div class="gk-input-row"><input id="dGuess" class="gk-input" type="text" placeholder="Your guess…" maxlength="60" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="send" inputmode="text"><button type="submit" class="gk-btn gk-primary" id="dSend">Guess</button></div><p id="dFeedback" role="status" aria-live="polite"></p></form>` : ''}
            ${S.phase === 'reveal' ? roundResultHtml(S) : ''}
          </aside></div></div>`;
        wire(el, api);
      }
    }
    refresh(el, S, api);
    paint(el);
    for (const pid of newCorrect) {
      if (!reduced()) [...el.querySelectorAll('[data-guesser]')].find(n => n.dataset.guesser === pid)?.animate?.([{ opacity: .4, transform: 'translateX(6px)' }, { opacity: 1, transform: 'none' }], { duration: 220, easing: 'ease-out' });
      api.cue?.('correct', { id: `${S.instanceId}:${S.round}:guess:${pid}`, gain: .75 });
    }
    if (revealed || hinted) {
      if (!reduced()) el.querySelector('.dg-word')?.animate?.([{ opacity: .35, transform: 'translateY(-3px)' }, { opacity: 1, transform: 'none' }], { duration: 220, easing: 'ease-out' });
      api.cue?.('reveal', { id: `${S.instanceId}:${S.round}:${revealed ? 'word' : 'hint:' + S.masked}`, gain: revealed ? .7 : .4 });
    }
  },
};

function wire(el, api) {
  const cv = el.querySelector('#dCanvas');
  const scene = el.querySelector('.dg');
  const focusButton = el.querySelector('#dFocus');
  const toolsButton = el.querySelector('#dTools');
  const toolsRail = el.querySelector('.dg-tools');
  if (toolsRail) toolsRail.id = 'dToolsRail';
  let focused = false, zoom = 1, panX = 0, panY = 0, hand = false, panStart = null;
  const viewport = cv?.closest('.sk-canvaswrap');
  if (isArtist(snapshot) && typeof matchMedia === 'function' && matchMedia('(max-width:700px)').matches) {
    scene.classList.add('is-chat-collapsed');
    el.querySelector('#dGuesses').setAttribute('aria-expanded', 'false');
  }
  const syncView = () => {
    if (!cv || !viewport) return;
    const r = viewport.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const scale = Math.min(r.width / 880, r.height / 520) * zoom;
    const width = 880 * scale, height = 520 * scale;
    panX = Math.max(-Math.max(0, (width - r.width) / 2), Math.min(Math.max(0, (width - r.width) / 2), panX));
    panY = Math.max(-Math.max(0, (height - r.height) / 2), Math.min(Math.max(0, (height - r.height) / 2), panY));
    cv.setAttribute('style', `width:${width}px;height:${height}px;left:50%;top:50%;transform:translate(calc(-50% + ${panX}px),calc(-50% + ${panY}px));cursor:${hand ? 'grab' : isArtist(snapshot) ? 'crosshair' : zoom > 1 ? 'grab' : 'default'}`);
    cv.setAttribute('data-pan', String(hand || zoom > 1));
    el.querySelector('#dZoomValue').textContent = `${Math.round(zoom * 100)}%`;
    el.querySelector('#dZoomOut').disabled = zoom <= 1;
    el.querySelector('#dZoomIn').disabled = zoom >= 3;
    el.querySelector('#dPan').setAttribute('aria-pressed', String(hand));
  };
  const setZoom = value => { up(); zoom = Math.max(1, Math.min(3, value)); syncView(); };
  on(el.querySelector('#dZoomIn'), 'click', () => setZoom(zoom + .5));
  on(el.querySelector('#dZoomOut'), 'click', () => setZoom(zoom - .5));
  on(el.querySelector('#dFit'), 'click', () => { up(); zoom = 1; panX = panY = 0; hand = false; syncView(); });
  on(el.querySelector('#dPan'), 'click', () => { up(); hand = !hand; syncView(); });
  on(el.querySelector('#dGuesses'), 'click', event => {
    const hidden = scene.classList.toggle('is-chat-collapsed');
    el.querySelector('#dGuesses').setAttribute('aria-expanded', String(!hidden));
  });
  const setFocus = (active) => {
    // Finish a held gesture before changing the canvas's displayed dimensions.
    // Focus uses the same node and normalized drawing coordinate space.
    if (drawing) up();
    focused = active;
    zoom = active && typeof matchMedia === 'function' && matchMedia('(max-width:600px)').matches ? 3 : 1; panX = panY = 0;
    scene.classList.toggle('is-canvas-focused', active);
    scene.classList.toggle('is-tools-collapsed', active && !!toolsRail);
    focusButton.textContent = active ? 'Exit' : 'Focus';
    focusButton.setAttribute('aria-label', active ? 'Exit canvas focus' : 'Focus canvas');
    focusButton.setAttribute('aria-pressed', String(active));
    if (toolsButton) {
      toolsButton.hidden = !active;
      toolsButton.setAttribute('aria-expanded', String(!active));
    }
    syncView();
  };
  on(focusButton, 'click', () => setFocus(!focused));
  on(toolsButton, 'click', () => {
    if (drawing) up();
    const hidden = scene.classList.toggle('is-tools-collapsed');
    toolsButton.setAttribute('aria-expanded', String(!hidden));
    syncView();
  });
  on(scene, 'keydown', (event) => {
    if (event.key === 'Escape' && focused && !event.defaultPrevented) {
      event.preventDefault();
      setFocus(false);
      focusButton.focus({ preventScroll: true });
    }
  });
  const updateTools = () => {
    el.querySelectorAll?.('[data-c]').forEach(b => {
      const selected = tool === 'pen' && b.dataset.c === color;
      b.classList.toggle('sel', selected); b.setAttribute('aria-pressed', String(selected));
    });
    el.querySelectorAll?.('[data-size]').forEach(b => {
      const selected = Number(b.dataset.size) === size;
      b.classList.toggle('sel', selected); b.setAttribute('aria-pressed', String(selected));
    });
    const eraser = el.querySelector('#dEraser');
    eraser?.classList.toggle('sel', tool === 'eraser');
    eraser?.setAttribute('aria-pressed', String(tool === 'eraser'));
    const pen = el.querySelector('#dPen');
    pen?.classList.toggle('sel', tool === 'pen');
    pen?.setAttribute('aria-pressed', String(tool === 'pen'));
  };
  el.querySelectorAll?.('[data-c]').forEach(b => on(b, 'click', () => { color = b.dataset.c; tool = 'pen'; updateTools(); }));
  el.querySelectorAll?.('[data-size]').forEach(b => on(b, 'click', () => { size = Number(b.dataset.size); updateTools(); }));
  on(el.querySelector('#dEraser'), 'click', () => { tool = tool === 'eraser' ? 'pen' : 'eraser'; updateTools(); });
  on(el.querySelector('#dPen'), 'click', () => { tool = 'pen'; updateTools(); });
  const mutate = undo => {
    if (!isArtist(snapshot)) return;
    const target = drawing ? gestureId : pending.at(-1)?.gestureId || ((snapshot.inkRevision || 0) === revision && snapshot.preview?.gestureId) || visibleStrokes.at(-1)?.gestureId;
    if (undo && !target) return;
    const oldRevision = revision;
    panStart = null; abandon(); pending = [];
    visibleStrokes = undo ? visibleStrokes.filter(s => s.gestureId !== target) : [];
    revision += 1;
    paint(el);
    api.send(undo ? { undo: true, inkNonce: snapshot.inkNonce, inkRevision: oldRevision }
      : { clear: true, inkNonce: snapshot.inkNonce, inkRevision: oldRevision });
    refresh(el, snapshot, api);
  };
  on(el.querySelector('#dClear'), 'click', () => mutate(false));
  on(el.querySelector('#dUndo'), 'click', () => mutate(true));
  const sendGuess = event => {
    event?.preventDefault();
    const input = el.querySelector('#dGuess');
    if (!input || input.disabled || !input.value.trim() || snapshot?.spectator || snapshot?.phase !== 'draw') return;
    if (api.send({ guess: input.value.trim() }) === false) return;
    input.value = '';
    input.focus({ preventScroll: true });
  };
  on(el.querySelector('#dGuessForm'), 'submit', sendGuess);
  on(el.querySelector('#dGuess'), 'keydown', event => {
    if (event.key === 'Enter' && event.isComposing) event.preventDefault();
  });
  on(el.querySelector('#dNext'), 'click', () => {
    if (snapshot?.phase === 'reveal' && canAdvance(snapshot)) api.send({ next: true });
  });
  if (!cv) return;
  let pointerId = null, touchId = null;
  const pointerEvents = typeof window !== 'undefined' && typeof window.PointerEvent === 'function';
  const contact = event => event.touches ? Array.from(event.touches).find(p => p.identifier === touchId) : event;
  const pos = p => {
    const r = cv.getBoundingClientRect();
    return [Math.max(0, Math.min(1, (p.clientX - r.left) / r.width)), Math.max(0, Math.min(1, (p.clientY - r.top) / r.height))];
  };
  const metadata = () => ({ inkNonce: snapshot.inkNonce, inkRevision: revision, gestureId, chunk });
  const preview = () => {
    sample += 1;
    api.send({ preview: { pts: cur.length > 1 ? cur.map(p => [...p]) : [cur[0], cur[0]], ...activeInk }, ...metadata(), sample }, { silent: true });
    previewAt = Date.now();
  };
  const down = event => {
    if (drawing || panStart || (event.button !== undefined && event.button !== 0) || document.querySelector?.('.room-menu[open]')) return;
    const panning = hand || (!isArtist(snapshot) && zoom > 1);
    if (!panning && (!isArtist(snapshot) || !snapshot.inkNonce)) return;
    if (event.touches) touchId = event.changedTouches?.[0]?.identifier ?? event.touches[0]?.identifier;
    const point = contact(event);
    if (!point) return;
    event.preventDefault(); pointerId = pointerEvents ? event.pointerId : null;
    if (panning) {
      panStart = { x: point.clientX, y: point.clientY, panX, panY };
      if (pointerEvents) { capturedPointer = { canvas: cv, id: pointerId }; try { cv.setPointerCapture?.(pointerId); } catch {} }
      return;
    }
    drawing = true; cur = [pos(point)]; gestureId += 1; chunk = 0; sample = 0;
    activeInk = { color: tool === 'eraser' ? '#ffffff' : color, size, tool };
    if (pointerEvents) {
      capturedPointer = { canvas: cv, id: pointerId };
      try { cv.setPointerCapture?.(pointerId); } catch { /* window listeners finish it */ }
    }
    paintStroke(cv.getContext('2d'), cv, cur, activeInk);
    preview(); refresh(el, snapshot, api);
  };
  const commit = finished => {
    if (!cur.length || !activeInk) return;
    if (cur.length === 1) cur.push([...cur[0]]);
    const stroke = { pts: cur.map(p => [...p]), ...activeInk };
    pending.push({ ...stroke, gestureId, chunk });
    api.send({ stroke, ...metadata(), finished }, { silent: true });
    chunk += 1; sample = 0; cur = finished ? [] : [cur.at(-1)];
  };
  const move = event => {
    if ((!drawing && !panStart) || (pointerEvents && event.pointerId !== pointerId)) return;
    const point = contact(event);
    if (!point) return;
    event.preventDefault();
    if (panStart) { panX = panStart.panX + point.clientX - panStart.x; panY = panStart.panY + point.clientY - panStart.y; syncView(); return; }
    const next = pos(point);
    if (cur.at(-1)?.[0] === next[0] && cur.at(-1)?.[1] === next[1]) return;
    cur.push(next); paintStroke(cv.getContext('2d'), cv, cur.slice(-2), activeInk);
    if (cur.length >= 200) {
      commit(false);
      if (chunk >= 400) { abandon(); refresh(el, snapshot, api); }
    } else if (Date.now() - previewAt >= 80) preview();
  };
  const up = event => {
    if ((!drawing && !panStart) || (event?.pointerId !== undefined && event.pointerId !== pointerId) ||
        (event?.changedTouches && !Array.from(event.changedTouches).some(p => p.identifier === touchId))) return;
    if (panStart) { panStart = null; pointerId = null; touchId = null; releaseCapture(); return; }
    drawing = false;
    try { commit(true); } finally {
      cur = []; activeInk = null; pointerId = null; touchId = null; releaseCapture();
    }
    refresh(el, snapshot, api);
  };
  const target = typeof window !== 'undefined' ? window : cv;
  if (pointerEvents) {
    on(cv, 'pointerdown', down); on(target, 'pointermove', move); on(target, 'pointerup', up);
    on(target, 'pointercancel', up); on(cv, 'lostpointercapture', up);
  } else {
    on(cv, 'mousedown', down); on(cv, 'mousemove', move); on(target, 'mouseup', up);
    on(cv, 'touchstart', down, { passive: false }); on(cv, 'touchmove', move, { passive: false });
    on(target, 'touchend', up); on(target, 'touchcancel', up);
  }
  on(target, 'resize', () => { up(); syncView(); });
  if (typeof ResizeObserver === 'function' && viewport) { const observer = new ResizeObserver(() => { if (resizeObserver !== observer) return; up(); syncView(); }); resizeObserver = observer; observer.observe(viewport); }
  on(cv, 'keydown', event => {
    const shifts = { ArrowLeft: [44, 0], ArrowRight: [-44, 0], ArrowUp: [0, 44], ArrowDown: [0, -44] };
    if (zoom > 1 && shifts[event.key]) { event.preventDefault(); up(); panX += shifts[event.key][0]; panY += shifts[event.key][1]; syncView(); }
  });
  syncView();
  on(target, 'blur', () => up()); on(target, 'orientationchange', () => up());
  on(target.screen?.orientation, 'change', () => up());
  if (typeof document !== 'undefined') {
    on(document, 'visibilitychange', () => { if (document.hidden) up(); });
    on(document, 'toggle', event => { if (event.target?.matches?.('.room-menu[open]')) up(); }, true);
    on(document, 'game-screenchange', () => up()); on(document, 'fullscreenchange', () => up());
    on(document, 'keydown', event => {
      if (isArtist(snapshot) && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !event.shiftKey &&
          !event.target?.closest?.('input,textarea,[contenteditable=true]') && !document.querySelector?.('.room-menu[open]')) { event.preventDefault(); mutate(true); }
    });
  }
}

function paint(el) {
  const cv = el.querySelector('#dCanvas'), ctx = cv?.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, cv.width, cv.height);
  for (const stroke of visibleStrokes) paintStroke(ctx, cv, stroke.pts, stroke);
  const sameRevision = (snapshot?.inkRevision || 0) === revision;
  if (isArtist(snapshot)) {
    const acknowledged = new Set(visibleStrokes.map(s => `${s.gestureId}:${s.chunk}`));
    pending = pending.filter(s => !acknowledged.has(`${s.gestureId}:${s.chunk}`));
    for (const stroke of pending) paintStroke(ctx, cv, stroke.pts, stroke);
    if (drawing) paintStroke(ctx, cv, cur, activeInk);
    else if (sameRevision && snapshot.preview) paintStroke(ctx, cv, snapshot.preview.pts, snapshot.preview);
  } else if (sameRevision && snapshot?.preview) paintStroke(ctx, cv, snapshot.preview.pts, snapshot.preview);
}
function paintStroke(ctx, cv, pts, ink) {
  if (!ctx || !pts?.length || !ink) return;
  ctx.globalCompositeOperation = 'source-over';
  ctx.strokeStyle = ink.tool === 'eraser' ? '#ffffff' : ink.color;
  ctx.fillStyle = ctx.strokeStyle;
  ctx.lineWidth = ink.size * cv.width / 880; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  if (pts.length === 1 || pts.every(p => p[0] === pts[0][0] && p[1] === pts[0][1])) {
    ctx.beginPath(); ctx.arc(pts[0][0] * cv.width, pts[0][1] * cv.height, ctx.lineWidth / 2, 0, Math.PI * 2); ctx.fill();
    return;
  }
  ctx.beginPath(); ctx.moveTo(pts[0][0] * cv.width, pts[0][1] * cv.height);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0] * cv.width, pts[i][1] * cv.height);
  ctx.stroke();
}

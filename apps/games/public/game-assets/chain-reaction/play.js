/* Chain Reaction reactor arena: framed game document.
 * Talks to the room ONLY through the generic frame bridge
 * (createGameClient snapshot subscription). No sockets, no storage, no
 * media capture, no secrets. The Canvas arena and semantic renderer own the board,
 * seats, rules detail, and the countdown (via client.now()). */

const $ = (id) => document.getElementById(id);

const els = {
  status: $('statusLine'),
  openFrom: $('openFrom'),
  result: $('result'),
  board: $('play'),
  controls: $('controls'),
  rematch: $('rematchBtn'),
  lobby: $('lobbyBtn'),
  hostNote: $('hostNote'),
  ranks: $('ranks'),
};

/* Inside Giggle and on the Game Night site this frame wears the parent
 * page's colour tokens (Day, Night or the call's navy palette), so the
 * board matches every other game. Same-origin only; best effort. */
const THEME_TOKENS = ['--bg', '--card', '--well', '--chip', '--ink', '--ink-dim', '--line', '--line-strong',
  '--accent', '--accent-soft', '--accent-ink', '--green', '--melon', '--sun', '--sun-ink',
  '--font-display', '--font-body', '--shadow-card'];
function mirrorTheme() {
  let parentDoc = null;
  try { parentDoc = window.parent && window.parent !== window ? window.parent.document : null; } catch { parentDoc = null; }
  if (!parentDoc || !parentDoc.body) return;
  const apply = () => {
    try {
      const cs = window.parent.getComputedStyle(parentDoc.body);
      const root = document.documentElement;
      for (const name of THEME_TOKENS) {
        const v = cs.getPropertyValue(name).trim();
        if (v) root.style.setProperty(name, v); else root.style.removeProperty(name);
      }
      root.dataset.theme = parentDoc.documentElement.dataset.theme || 'day';
      root.classList.toggle('is-embed', parentDoc.body.classList.contains('is-embed'));
      document.dispatchEvent(new CustomEvent('chain-theme'));
    } catch { /* keep the frame's own defaults */ }
  };
  apply();
  try {
    const observer = new MutationObserver(apply);
    observer.observe(parentDoc.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class', 'style'] });
    observer.observe(parentDoc.body, { attributes: true, attributeFilter: ['class', 'style'] });
    window.addEventListener('pagehide', () => observer.disconnect(), { once: true });
  } catch { /* no live theme switching */ }
}

/* Arena hex mapping: default Candy seats render in reactor hues (coral,
 * teal, yellow); Ink and anything else pass through untouched. Display only:
 * the snapshot palette still decides ownership and shapes. */
const ARENA_HEX = { '#ff557c': '#ff718f', '#36dec4': '#71edd1', '#ffd15c': '#ffd23d' };
function arenaHex(color) {
  const key = String(color || '').toLowerCase();
  return ARENA_HEX[key] || color;
}

let client = null;
let view = null;
let mounted = false;
let gotSnapshot = false;
let cleaned = false;
let stillWaitingTimer = 0;
let latestState = null;
let latestContext = null;
let revealedResultInstance = null;
let preparationKey = null;
let preparationGeneration = 0;
const preparationPaints = new Set();
const retiredInstances = new Set();

function isTopLevel() {
  try {
    return window.self === window.top;
  } catch {
    return false;
  }
}

function setStatus(tone, text) {
  if (!els.status) return;
  els.status.dataset.tone = tone;
  els.status.textContent = text;
}

function showOpenFrom(show) {
  if (els.openFrom) els.openFrom.hidden = !show;
}

function showControls(show, isHost, phase) {
  if (!els.controls) return;
  els.controls.hidden = !show;
  if (!show) return;
  els.rematch.disabled = !isHost;
  els.lobby.disabled = !isHost;
  els.hostNote.hidden = isHost;
  els.hostNote.textContent = 'Waiting for the host.';
}

function renderResult(state) {
  if (!els.result) return;
  if (!state || state.phase !== 'done') {
    els.result.hidden = true;
    els.result.replaceChildren();
    if (els.ranks) { els.ranks.hidden = true; els.ranks.replaceChildren(); }
    return;
  }
  const winner = state.result && state.result.winner ? state.result.winner : null;
  const detail = state.result && state.result.detail ? state.result.detail : 'Match over.';
  const wrap = document.createElement('span');
  wrap.className = 'round-title';
  const kids = [];
  if (winner && Array.isArray(state.order) && Array.isArray(state.palette)) {
    const seat = state.order.indexOf(winner);
    const st = seat >= 0 ? state.palette[seat] : null;
    if (st && st.color && st.shape) {
      const mark = document.createElement('span');
      mark.className = 'winner-mark';
      mark.setAttribute('aria-hidden', 'true');
      mark.style.setProperty('--orb', arenaHex(st.color));
      const orb = document.createElement('i');
      orb.className = 'cr-orb ' + st.shape;
      mark.replaceChildren(orb);
      kids.push(mark);
    }
  }
  const title = document.createElement('span');
  title.textContent = winner ? (client ? client.name(winner) : winner) + ' wins' : 'It\u2019s a tie';
  title.setAttribute('title', title.textContent);
  wrap.setAttribute('aria-label', title.textContent);
  kids.push(title);
  wrap.replaceChildren(...kids);
  const sub = document.createElement('small');
  sub.textContent = detail;
  const label = document.createElement('small');
  label.className = 'round-game';
  label.textContent = 'Chain Reaction';
  els.result.replaceChildren(label, wrap, sub);
  els.result.hidden = false;
  renderRanks(state);
}

/* Final scores: match points, equal points share a rank, your row marked. */
function renderRanks(state) {
  if (!els.ranks || !Array.isArray(state.order)) return;
  const scores = state.scores && typeof state.scores === 'object' ? state.scores : {};
  const rows = state.order.map((pid, i) => ({ pid, i, points: Number(scores[pid]) || 0 }))
    .sort((a, b) => b.points - a.points || a.i - b.i);
  let rank = 0;
  const items = rows.map((row, n) => {
    if (!n || rows[n - 1].points !== row.points) rank = n + 1;
    const li = document.createElement('li');
    li.className = 'rank-row' + (row.pid === state.you ? ' is-you' : '') + (rank === 1 ? ' is-first' : '');
    const r = document.createElement('span'); r.className = 'rank'; r.textContent = String(rank);
    const name = document.createElement('span'); name.className = 'rank-name';
    name.textContent = (client ? client.name(row.pid) : row.pid) + (row.pid === state.you ? ' (you)' : '');
    const pts = document.createElement('b'); pts.className = 'rank-points';
    pts.textContent = (row.points > 0 ? '+' : '') + row.points;
    li.replaceChildren(r, name, pts);
    return li;
  });
  els.ranks.replaceChildren(...items);
  els.ranks.hidden = false;
}

function validSnapshot(state) {
  return !!state && typeof state === 'object' &&
    Array.isArray(state.board) && Array.isArray(state.order) &&
    Number.isInteger(state.cols) && Number.isInteger(state.rows);
}

function onSnapshot(state, context) {
  if (cleaned) return;
  if (!validSnapshot(state)) {
    setStatus('error', 'That room update was unreadable. Waiting for the next one…');
    return;
  }
  if (retiredInstances.has(state.instanceId)) return;
  if (latestState && state.instanceId === latestState.instanceId &&
      (state.lastEvent?.seq || 0) < (latestState.lastEvent?.seq || 0)) return;
  if (latestState && state.instanceId !== latestState.instanceId) {
    retiredInstances.add(latestState.instanceId);
    if (retiredInstances.size > 4) retiredInstances.delete(retiredInstances.values().next().value);
  }
  gotSnapshot = true;
  if (stillWaitingTimer) { clearTimeout(stillWaitingTimer); stillWaitingTimer = 0; }
  const ctx = context && typeof context === 'object' ? context : {};
  latestState = state;
  latestContext = ctx;

  try {
    if (!mounted) {
      view.mount(els.board, client);
      mounted = true;
    }
    view.update(els.board, state, client);
  } catch (err) {
    setStatus('error', 'The board hit a snag. Waiting for the next room update…');
    return;
  }

  renderChrome(state, ctx);
}

// Hidden documents cannot produce animation frames. Resources and the rendered
// board still become ready so a background seat cannot freeze everyone's turn.
function fieldPaint() {
  return new Promise(resolve => {
    let frame = null, observer = null, paints = 0, finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      observer?.disconnect();
      preparationPaints.delete(finish);
      document.removeEventListener('visibilitychange', visibility);
      resolve();
    };
    const visibility = () => { if (document.hidden) finish(); };
    const tick = () => { if (finished) return; frame = null; if (document.hidden || ++paints === 2) finish(); else frame = requestAnimationFrame(tick); };
    preparationPaints.add(finish);
    document.addEventListener('visibilitychange', visibility);
    if (document.hidden) finish();
    else {
      if (typeof IntersectionObserver === 'function' && document.documentElement) {
        observer = new IntersectionObserver(entries => {
          if (entries.some(entry => !entry.isIntersecting)) finish();
        });
        observer.observe(document.documentElement);
      }
      frame = requestAnimationFrame(tick);
    }
  });
}

// The room freezes each actionable window until every frame has painted its
// actual field. A cascade stays gated through the final arrival animation.
async function readyFrame(state) {
  if (!state.preparing || cleaned || view.isReplaying(els.board)) return;
  const key = state.instanceId + ':' + state.w;
  if (key === preparationKey) return;
  preparationKey = key;
  const generation = ++preparationGeneration;
  for (const finish of preparationPaints) finish();
  try {
    await document.fonts?.ready;
    if (cleaned || generation !== preparationGeneration ||
        latestState?.instanceId !== state.instanceId || latestState?.w !== state.w) return;
    await fieldPaint();
    if (cleaned || generation !== preparationGeneration ||
        latestState?.instanceId !== state.instanceId || latestState?.w !== state.w) return;
    if (view.isReplaying(els.board)) { preparationKey = null; return; }
    client.ready?.(state);
  } catch {
    preparationKey = null;
    setStatus('error', 'The field is still loading. Waiting for the next room update…');
  }
}

function renderChrome(state, ctx) {
  const isHost = ctx.isHost === true;
  const replaying = mounted && view.isReplaying(els.board);
  document.querySelector('.lab-main').dataset.phase = replaying ? 'play' : state.phase;
  if (replaying) {
    renderResult(null);
    setStatus('ready', 'Watch the atoms spread. The next turn opens when they settle.');
    showControls(false, isHost, state.phase);
    return;
  }
  readyFrame(state);
  renderResult(state);
  if (state.phase === 'done') {
    setStatus('ready', 'Final board. ' + (isHost ? 'Rematch or change the game below.' : 'Waiting for the host to rematch or change the game.'));
    showControls(true, isHost, state.phase);
    if (revealedResultInstance !== state.instanceId) {
      revealedResultInstance = state.instanceId;
      // A phone may be scrolled to the last row or Skip. Reveal the finished
      // result and its actions once; later heartbeats leave the reader alone.
      els.result?.scrollIntoView?.({ block: 'start', behavior: 'auto' });
      // The room may celebrate only after this instance's final atom lands.
      client.resultsReady?.();
    }
  } else {
    const turnName = state.turnPid ? client.name(state.turnPid) : '???';
    const watching = state.spectator === true;
    setStatus('ready', watching
      ? 'Live board · ' + state.boardSize + ' · Turn ' + state.turnNo + ' (' + turnName + '). You are watching: only seated players place orbs.'
      : 'Live · ' + state.boardSize + ' board · Turn ' + state.turnNo + ' · ' + turnName +
        (state.turnPid === state.you ? ' (you): tap an empty cell or one of your own.' : '.'));
    showControls(false, isHost, state.phase);
  }
}

function onReplayState() {
  if (!cleaned && latestState) renderChrome(latestState, latestContext || {});
}

function cleanup() {
  if (cleaned) return;
  cleaned = true;
  preparationGeneration += 1;
  for (const finish of preparationPaints) finish();
  els.board.removeEventListener('chain-replay', onReplayState);
  if (stillWaitingTimer) { clearTimeout(stillWaitingTimer); stillWaitingTimer = 0; }
  try {
    if (view && mounted) view.dispose(els.board);
  } catch { /* teardown must never throw */ }
  mounted = false;
  try {
    if (client) client.dispose();
  } catch { /* teardown must never throw */ }
}

async function boot() {
  const top = isTopLevel();
  if (!top) mirrorTheme();
  showOpenFrom(top);

  if (els.rematch) els.rematch.addEventListener('click', () => { if (client) client.rematch(); });
  if (els.lobby) els.lobby.addEventListener('click', () => { if (client) client.lobby(); });
  window.addEventListener('pagehide', cleanup);
  els.board.addEventListener('chain-replay', onReplayState);

  setStatus('loading', 'Loading the reactor…');

  try {
    const [bridge, renderer] = await Promise.all([
      import('/js/game-client.js'),
      import('/js/games/chain-reaction.js'),
    ]);
    if (typeof bridge.createGameClient !== 'function' || !renderer.default) {
      throw new Error('bridge contract mismatch');
    }
    view = renderer.default;
    client = bridge.createGameClient();
  } catch (err) {
    setStatus('error', 'Could not load the Game Night bridge. Open this game from a Game Night room instead.');
    showOpenFrom(true);
    return;
  }

  // Welcome state: waiting help until the first snapshot arrives. No
  // `connected` getter is consulted; the subscription is the signal.
  setStatus('loading', top
    ? 'Standalone page: open this game from a Game Night room to play.'
    : 'Waiting for the room… The board appears on the first update.');
  client.subscribe(onSnapshot);

  if (!top) {
    stillWaitingTimer = setTimeout(() => {
      if (!gotSnapshot && !cleaned) {
        setStatus('loading', 'Still waiting for the room… If this persists, return to Game Night and rejoin the room.');
        showOpenFrom(true);
      }
    }, 8000);
  }
}

boot();

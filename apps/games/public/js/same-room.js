import { esc } from './util.js';
import { sameRoomSupport, LOCAL_AVATARS } from './same-room-support.mjs';
import { wsTargetFromConfig } from './netconfig.js';
import { show, reset } from './game-host.js';
import { segPickerHtml, wirePickers } from './pickers.js';

const $ = id => document.getElementById(id);
const app = $('srApp');
const read = key => { try { return sessionStorage.getItem(key); } catch { return null; } };
const save = (key, value) => { try { value === null ? sessionStorage.removeItem(key) : sessionStorage.setItem(key, value); } catch { /* optional tab storage */ } };
let games = [], gameId = new URLSearchParams(location.search).get('game') || 'truth-dare';
let names = [], settings = {}, socket = null, current = null, mountKey = '', readyStep = null;
let token = read('giggle:one-device:token'), busy = false, retry = 0, disconnected = false;
let anchor = { game: 0, local: 0, running: false };
let pickingGame = !new URLSearchParams(location.search).has('game');
try { const draft = JSON.parse(read('giggle:one-device:names')); if (Array.isArray(draft)) names = draft.filter(n => typeof n === 'string').slice(0, 20); } catch { /* fresh group */ }
const game = () => games.find(g => g.id === gameId);
const status = text => { $('srStatus').textContent = text; };
const avatar = p => `<span class="sr-avatar" data-colour="${p?.colour || 0}" aria-hidden="true">${esc(p?.avatar || '📱')}</span>`;
const btn = (id, text, variant = 'tb-primary') => `<button type="button" id="${id}" class="tb-btn ${variant}">${text}</button>`;
function send(message) {
  if (socket?.readyState !== WebSocket.OPEN) { status('Connection lost. Keep this page open; we’re reconnecting.'); return false; }
  socket.send(JSON.stringify(message)); return true;
}
function input(op, fields = {}) { return current && send({ t: 'same-input', step: current.step, op, ...fields }); }
function now() { return anchor.game + (anchor.running ? performance.now() - anchor.local : 0); }
function family(g) { return g?.cat === 'board' ? 'board' : ['doodle-guess', 'charades'].includes(g?.id) ? 'create' : 'party'; }
function setSkin() {
  document.body.dataset.game = gameId; document.body.dataset.family = family(game());
  document.body.classList.toggle('game-playing', !!current);
}
const cover = g => `/${g.art || `img/games/${g.id}.png`}`;
function gameCards() {
  return `<details id="srGamePicker" class="sr-game-picker"${pickingGame ? ' open' : ''}>
    <summary class="tb-btn tb-secondary">Choose a game <span class="t-caption">${games.length} on one device</span></summary>
    <div class="sr-game-grid" role="group" aria-label="Choose a one-device game">${games.map(g => {
      const selected = g.id === gameId, support = sameRoomSupport(g);
      return `<button type="button" class="sr-game-card tb-card is-compact" data-game-choice="${g.id}" data-family="${family(g)}" aria-pressed="${selected}" aria-label="Choose ${esc(g.name)}">
        <img src="${esc(cover(g))}" alt="" loading="lazy" width="96" height="96"><span class="t-title">${esc(g.name)}</span><span class="t-caption">${support.min === support.max ? support.min : `${support.min}–${support.max}`} people${selected ? ' · ✓ Picked' : ''}</span></button>`;
    }).join('')}</div></details>`;
}
function field(s) {
  const id = `sr-setting-${s.key}`, value = settings[s.key] ?? s.def;
  if (s.type === 'enum' || s.type === 'bool') {
    const choices = s.type === 'bool' ? [['true', 'On'], ['false', 'Off']] : s.options;
    const options = choices.map(o => Array.isArray(o) ? o : [o, o]);
    return `<div class="sr-field gm-tile gm-enum${options.length >= 4 ? ' sr-field-tiles' : ''}"><span id="${id}-label">${esc(s.label)}</span><select id="${id}" data-setting="${s.key}" class="picker-native" tabindex="-1" aria-hidden="true">${options.map(([v, text]) => `<option value="${esc(v)}"${String(v) === String(value) ? ' selected' : ''}>${esc(text)}</option>`).join('')}</select>${segPickerHtml(id, choices, value, `${id}-label`, false)}</div>`;
  }
  return `<label class="sr-field" for="${id}">${esc(s.label)}<span class="sr-stepper"><button type="button" class="tb-btn tb-secondary" data-step="${s.key}" data-delta="-1" aria-label="Fewer ${esc(s.label.toLowerCase())}">−</button><input id="${id}" type="number" inputmode="numeric" data-setting="${s.key}" min="${s.min}" max="${s.max}" value="${value ?? ''}" placeholder="${esc(s.autoLabel || 'Auto')}"><button type="button" class="tb-btn tb-secondary" data-step="${s.key}" data-delta="1" aria-label="More ${esc(s.label.toLowerCase())}">+</button></span></label>`;
}
function setup() {
  reset(); current = null; mountKey = ''; readyStep = null; busy = false;
  setSkin();
  const g = game();
  app.setAttribute('aria-busy', 'false');
  app.innerHTML = `<form id="srSetup" class="sr-setup">
    <div class="sr-feature"><img class="sr-cover" src="${esc(cover(g))}" alt=""><div class="sr-feature-copy"><p class="t-caption">Same room · one device</p><h1 class="t-heading">${esc(g.name)}</h1><p class="t-body">Add your people. The phone runs the game.</p></div></div>
    <input id="srGame" type="hidden" value="${g.id}">${gameCards()}
    <section class="sr-panel tb-card"><h2>Who’s here?</h2><p class="t-caption">Add names, then pass the phone when asked.</p>
      <div class="sr-add"><input id="srName" maxlength="200" autocomplete="off" enterkeyhint="done" aria-label="Player names" placeholder="Sam, Jess, Mo…"><button type="button" id="srAdd" class="tb-btn tb-secondary">Add</button></div>
      <div id="srNames" class="sr-names" aria-label="Players"></div><p id="srNameError" class="sr-error" role="alert"></p>
    </section>
    <section class="sr-panel tb-card"><h2>Make it yours</h2><div class="sr-fields">${g.schema.settings.map(field).join('') || '<p class="t-body">The board is ready. Add your names and play.</p>'}</div><p class="t-caption">Private turns each get their own timer. Passing time does not count.</p></section>
    <div class="sr-start"><button id="srStart" class="tb-btn tb-primary" type="submit">Start ${esc(g.name)}</button><p id="srReason" class="sr-reason" aria-live="polite"></p></div>
  </form>`;
  $('srGamePicker').ontoggle = () => { pickingGame = $('srGamePicker').open; };
  app.querySelectorAll('[data-game-choice]').forEach(card => { card.onclick = () => {
    const nameDraft = $('srName').value;
    gameId = card.dataset.gameChoice; settings = {}; pickingGame = false;
    history.replaceState(null, '', `?game=${encodeURIComponent(gameId)}`);
    setup(); $('srName').value = nameDraft;
    $('srGamePicker').querySelector('summary').focus({ preventScroll: true });
  }; });
  $('srAdd').onclick = addNames;
  $('srName').onkeydown = e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); addNames(); } };
  app.querySelectorAll('[data-setting]').forEach(el => {
    el.onchange = () => {
      const s = g.schema.settings.find(s => s.key === el.dataset.setting);
      settings[s.key] = s.type === 'int' ? el.value === '' ? null : Number(el.value) : s.type === 'bool' ? el.value === 'true' : el.value;
    };
  });
  app.querySelectorAll('[data-step]').forEach(b => { b.onclick = () => {
    const s = g.schema.settings.find(s => s.key === b.dataset.step), el = $(`sr-setting-${s.key}`);
    el.value = Math.max(s.min, Math.min(s.max, Number(el.value || s.min - 1) + Number(b.dataset.delta)));
    el.onchange();
  }; });
  wirePickers(app);
  $('srSetup').onsubmit = e => {
    e.preventDefault();
    if (busy || $('srStart').disabled) return;
    if ($('srName').value.trim()) { addNames(); return; }
    busy = true; $('srStart').disabled = true; $('srStart').setAttribute('aria-busy', 'true');
    if (!send({ t: 'same-start', game: gameId, names, settings })) { busy = false; paintNames(); }
  };
  paintNames();
}
function addNames() {
  const candidates = $('srName').value.split(/[,\n]/).map(n => n.trim()).filter(Boolean);
  const max = sameRoomSupport(game()).max;
  const all = [...names, ...candidates];
  const error = !candidates.length ? 'Type a name first.' : all.length > max ? `This game fits up to ${max} people.`
    : candidates.some(n => n.length > 16 || /[\p{C}]/u.test(n)) ? 'Keep each name to 16 letters.'
      : new Set(all.map(n => n.toLocaleLowerCase())).size !== all.length ? 'Give each person a different name.' : '';
  $('srNameError').textContent = error;
  if (!error) { names = all; $('srName').value = ''; save('giggle:one-device:names', JSON.stringify(names)); paintNames(); }
  $('srName').focus();
}
function paintNames() {
  const max = sameRoomSupport(game()).max;
  $('srNames').innerHTML = names.length ? names.map((name, i) => `<span class="sr-person">${avatar({ avatar: LOCAL_AVATARS[i], colour: i % 6 })}<span>${esc(name)}</span><button type="button" data-remove="${i}" aria-label="Remove ${esc(name)}">×</button></span>`).join('') : '<p class="t-caption">Everyone gets an animal. Add two names to begin.</p>';
  $('srNames').querySelectorAll('[data-remove]').forEach(b => { b.onclick = () => {
    names.splice(Number(b.dataset.remove), 1); save('giggle:one-device:names', JSON.stringify(names)); paintNames(); $('srName').focus();
  }; });
  $('srStart').disabled = busy || disconnected || names.length < 2 || names.length > max;
  $('srStart').setAttribute('aria-busy', String(busy));
  $('srReason').textContent = disconnected ? 'Connecting to the games…' : busy ? 'Setting the table…' : names.length < 2 ? `Add ${2 - names.length} more ${names.length ? 'name' : 'names'} to start. No code or account.` : names.length > max ? `This game fits ${max} people. Remove ${names.length - max} names or pick another game.` : `${names.length} people · one device · no room code`;
}
function handoff(message) {
  reset(); mountKey = ''; readyStep = null;
  const p = message.players.find(p => p.id === message.player);
  const passingBack = message.gate === 'return';
  app.innerHTML = `<section class="tb-card sr-hand" aria-labelledby="srHandTitle"><span class="sr-phone" aria-hidden="true">📱</span>${passingBack ? '' : avatar(p)}<h1 id="srHandTitle">${passingBack ? 'Pass the phone back' : `Pass the phone to ${esc(p?.name || 'the next player')}`}</h1><p>${passingBack ? 'Your private screen is hidden. Give the phone back to the group.' : 'Only they should look at the next screen.'}</p>${btn('srUnlock', passingBack ? 'Done, pass it back' : `I’m ${esc(p?.name || 'ready')}`)}</section>`;
  $('srUnlock').onclick = () => input(passingBack ? 'back' : 'unlock');
  window.scrollTo?.(0, 0);
  $('srUnlock').focus({ preventScroll: true });
}
function clearPrivate() {
  reset(); app.replaceChildren(); mountKey = ''; readyStep = null;
}
function play(message) {
  gameId = message.game;
  anchor = { game: message.gameNow, local: performance.now(), running: message.running };
  current = message; setSkin();
  app.setAttribute('aria-busy', 'false');
  if (message.gate !== 'play') { handoff(message); return; }
  const S = message.state, p = message.players.find(p => p.id === message.player);
  const key = `${S.instanceId}:${message.player}:${message.kind}:${S.phase}:${S.round}`;
  if (mountKey !== key) {
    reset(); mountKey = key; readyStep = null;
    window.scrollTo?.(0, 0);
    app.innerHTML = `<div class="sr-play-head">${avatar(p)}<div><p class="t-caption">${esc(game()?.name || gameId)}${S.round ? ` · round ${S.round}${S.rounds ? ` of ${S.rounds}` : ''}` : ''}</p><h1 id="srTurn" class="sr-turn">${S.phase === 'done' ? 'Final scores' : ['reveal', 'standings'].includes(S.phase) ? 'Round results' : `${esc(p?.name || 'Everyone')}’s turn`}</h1></div>${message.private ? btn('srCover', 'Hide', 'tb-chip') : ''}</div><div id="srView" class="sr-view-shell" aria-busy="true"><div class="sr-loading tb-card" role="status"><div class="tb-skeleton"></div><p class="t-body">Setting the table…</p></div><div id="gbody" class="sr-playfield" data-layout="standard"></div></div><div id="srExtras"></div><nav class="sr-game-tools" aria-label="Game controls">${btn('srEnd', 'End game', 'tb-chip')}</nav>`;
    if ($('srCover')) $('srCover').onclick = () => { clearPrivate(); input('cover'); };
    $('srEnd').onclick = () => confirmEnd();
  }
  // Progress snapshots must update the banner too, even when the mounted
  // game/phase is unchanged. Its actor is the server-selected seat (S.me).
  const actor = message.players.find(player => player.id === S.me) || p;
  $('srTurn').textContent = S.phase === 'done' ? 'Final scores' : ['reveal', 'standings'].includes(S.phase)
    ? 'Round results' : `${actor?.name || 'Everyone'}’s turn`;
  const api = {
    send: a => input('action', { a }), now,
    context: () => ({ isHost: true, sameRoom: true, roomActionPending: false }),
    name: pid => message.players.find(p => p.id === pid)?.name || '',
    toast: status, announce: status, cue: () => {}, resultsReady: () => {},
    focus: el => el?.focus?.({ preventScroll: true }),
    rematch: () => input('rematch'), lobby: () => stop(),
    loadError: () => {
      if ($('gbody') !== body) return;
      $('srView').setAttribute('aria-busy', 'false');
      body.innerHTML = `<section class="tb-card sr-secret" role="alert"><h2>This game could not load</h2><p>Check your connection, then try again.</p>${btn('srRetryView', 'Try again')}</section>`;
      $('srRetryView').onclick = () => { mountKey = ''; play(current); };
    },
  };
  const body = $('gbody');
  body.dataset.phase = S.phase;
  const acknowledge = () => {
    if (current !== message || readyStep === message.step) return;
    $('srView')?.setAttribute('aria-busy', 'false');
    readyStep = message.step; input('ready');
  };
  // A private cover has no game view. After unlocking, mount the same real
  // game UI used by online seats, including composing and prompt ballots.
  if (message.kind === 'peek') {
    body.innerHTML = `<section class="tb-card sr-secret"><p>Keep this word to yourself</p><h2>${esc(S.word)}</h2><p>Act it out for the group. No talking.</p>${btn('srHideWord', 'Hide word & start acting')}</section>`;
    $('srHideWord').onclick = () => input('hide'); acknowledge();
  } else if (gameId === 'five-second' && S.phase === 'answer') {
    body.innerHTML = `<section class="tb-card sr-secret"><p>Say three things out loud</p><h2>${esc(S.category)}</h2><p class="t-heading" data-sr-countdown aria-label="Seconds left">${Math.max(0, Math.ceil((S.endsAt - now()) / 1000))}</p><p>The group will judge when the timer ends.</p>${btn('srSpoken', 'Done naming three')}</section>`;
    $('srSpoken').onclick = () => api.send({ spoken: true }); acknowledge();
  } else {
    show(body, gameId, S, api, game()).then(view => { if (view) acknowledge(); });
  }
  const extras = $('srExtras');
  const guessGame = gameId === 'charades' && S.phase === 'act' && message.kind === 'guess' || gameId === 'doodle-guess' && S.phase === 'draw';
  if (guessGame) {
    const actor = S.actor || S.drawer;
    const eligible = message.players.filter(p => p.id !== actor && !S.guessed?.[p.id]);
    if (!extras.querySelector('#srGuesser')) {
      extras.innerHTML = `<form id="srGuessForm" class="sr-guesses"><label class="sr-field" for="srGuesser">Who is guessing?<select id="srGuesser"></select></label>${gameId === 'doodle-guess' ? '<label class="sr-field" for="srGuess">Say it out loud, then record the guess<input id="srGuess" maxlength="60" autocomplete="off"></label><button class="tb-btn tb-secondary">Check guess</button>' : ''}</form>`;
      $('srGuessForm').onsubmit = e => { e.preventDefault(); if (gameId === 'doodle-guess' && input('guess', { pid: $('srGuesser').value, text: $('srGuess').value })) $('srGuess').value = ''; };
      $('srGuesser').onchange = () => { if (gameId === 'charades') input('seat', { pid: $('srGuesser').value }); };
    }
    const selected = $('srGuesser').value;
    $('srGuesser').innerHTML = eligible.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
    if (gameId === 'charades') $('srGuesser').value = message.player;
    else if (eligible.some(p => p.id === selected)) $('srGuesser').value = selected;
  } else if (S.phase === 'done' && game()?.cat !== 'board') {
    if (!extras.querySelector('#srAgain')) { extras.innerHTML = `<div class="sr-actions">${btn('srAgain', 'Play again')}${btn('srChange', 'Choose another game', 'tb-secondary')}</div>`; $('srAgain').onclick = () => input('rematch'); $('srChange').onclick = () => stop(); }
  } else extras.replaceChildren();
  if (message.private) status('Private turn · the clock waits while you pass the phone.');
  else status('');
}
function confirmEnd() {
  const tools = app.querySelector('.sr-game-tools');
  tools.innerHTML = `<p class="t-caption">End this game and return to your names?</p>${btn('srConfirmEnd', 'End game', 'tb-danger')}${btn('srCancelEnd', 'Keep playing', 'tb-chip')}`;
  $('srConfirmEnd').onclick = stop;
  $('srCancelEnd').onclick = () => { tools.innerHTML = btn('srEnd', 'End game', 'tb-chip'); $('srEnd').onclick = confirmEnd; };
}
function stop() { if (send({ t: 'same-stop' })) { clearPrivate(); status('Closing the game…'); } }

document.addEventListener('visibilitychange', () => {
  if (document.hidden && current?.private && current.gate === 'play') { clearPrivate(); input('cover'); }
});
$('srTheme').onclick = () => {
  const theme = document.documentElement.dataset.theme === 'night' ? 'day' : 'night';
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem('pb_theme', theme); } catch { /* device theme */ }
};
async function connect() {
  clearTimeout(retry); disconnected = true;
  try {
    const response = await fetch('/config.json', { cache: 'no-store' });
    if (!response.ok) throw new Error('config');
    const cfg = await response.json();
    const target = wsTargetFromConfig(cfg, { allowWs: location.protocol === 'http:' }) || `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}`;
    const ws = socket = new WebSocket(target);
    ws.onopen = () => { disconnected = false; status(''); send({ t: 'games' }); if (token) send({ t: 'same-resume', token }); if ($('srNames')) paintNames(); };
    ws.onmessage = e => {
      const m = JSON.parse(e.data);
      if (m.t === 'games') {
        games = m.games.filter(sameRoomSupport);
        if (!game()) gameId = games[0]?.id;
        if (!games.length) { status('No one-device games are available. Reload to try again.'); return; }
        if (!current && !token) setup();
      } else if (m.t === 'same-created') { token = m.token; save('giggle:one-device:token', token); busy = false; }
      else if (m.t === 'same-state') play(m);
      else if (m.t === 'same-stopped') { token = null; save('giggle:one-device:token', null); setup(); status(''); }
      else if (m.t === 'same-error') {
        status(m.msg); busy = false;
        if (!current && token) { token = null; save('giggle:one-device:token', null); setup(); }
        if ($('srNames')) paintNames();
      }
    };
    ws.onclose = () => {
      if (socket !== ws) return;
      disconnected = true; anchor.running = false;
      if (current) { clearPrivate(); app.innerHTML = '<section class="tb-card sr-hand"><h1>Holding your place</h1><p>Reconnecting. Keep this page open.</p></section>'; }
      else if ($('srNames')) { busy = false; paintNames(); }
      status('Connection lost. Reconnecting…'); retry = setTimeout(connect, 1500);
    };
  } catch {
    status('Can’t reach the games. Check your connection.');
    if (!current) app.innerHTML = `<section class="tb-card sr-hand"><h1>The games are out of reach</h1><p>Check your connection, then try again.</p>${btn('srRetry', 'Try again')}</section>`;
    if ($('srRetry')) $('srRetry').onclick = connect;
  }
}
connect();
setInterval(() => {
  const counter = document.querySelector('[data-sr-countdown]');
  if (counter && current?.state) counter.textContent = String(Math.max(0, Math.ceil((current.state.endsAt - now()) / 1000)));
}, 200);

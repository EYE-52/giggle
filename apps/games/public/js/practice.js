import {warmPracticeKart} from './kart-warmup.mjs';
import { practiceContext } from './util.js';
import { practiceSupport } from './practice-support.mjs';
import { wsTargetFromConfig } from './netconfig.js';

const $ = id => document.getElementById(id);
const table = $('practiceTable');
const gameSelect = $('practiceGame');
const countSelect = $('practiceCount');
const seats = new Map();
let games = [], session = '', count = 0, selected = 1, all = false, stopping = false;
let catalogAttempt = 0, cancelCatalog = () => {}, finishStop = null;
let stopTimer = 0;

// Routine progress stays for screen readers; only problems show in the bar.
const ALERT = /hasn’t|needs|could not|unavailable|no games|reconnecting|unconfirmed/i;
function status(text) {
  const el = $('practiceStatus');
  if (el.textContent !== text) el.textContent = text;
  el.classList.toggle('is-alert', ALERT.test(text));
}
function empty(title, description, busy = false) {
  const section = document.createElement('section');
  section.className = 'practice-empty boot-view';
  section.setAttribute('role', busy ? 'status' : 'alert');
  section.setAttribute('aria-busy', String(busy));
  if (busy) section.innerHTML = '<span class="loading-mark loading-logo" aria-hidden="true"><i></i><i></i><i></i></span>';
  const heading = document.createElement('h2'); heading.textContent = title;
  const text = document.createElement('p'); text.textContent = description;
  section.append(heading); if (description) section.append(text);
  table.replaceChildren(section);
}
// Segments read "Player 2" with room to spare and "2" on narrow phones.
function seatLabel(tab, n) {
  if (tab.dataset.seat === String(n)) return;
  tab.dataset.seat = String(n);
  tab.setAttribute('aria-label', `Player ${n}`);
  const long = document.createElement('span'), short = document.createElement('span');
  long.className = 'seat-long'; long.textContent = `Player ${n}`;
  short.className = 'seat-short'; short.setAttribute('aria-hidden', 'true'); short.textContent = String(n);
  tab.replaceChildren(long, short);
}
function chosen() { return games.find(game => game.id === gameSelect.value); }
// Native lazy images can fetch thousands of pixels ahead, which includes
// this entire small catalogue. Request only tiles near the actual viewport.
const artObserver=typeof IntersectionObserver==='function'?new IntersectionObserver(entries=>{
  for(const {target,isIntersecting} of entries)if(isIntersecting){
    target.src=target.dataset.artSrc;delete target.dataset.artSrc;artObserver.unobserve(target);
  }
},{rootMargin:'120px'}):null;
const artSrc = game => game.art && /^img\/games\/[a-z0-9-]+\.(svg|png|webp)$/.test(game.art) ? '/' + game.art : `/img/games/${game.id}.png`;
function artImage(game, className) {
  const img = document.createElement('img');
  img.className = className; img.alt = '';
  img.decoding = 'async';
  if(className==='practice-tile-art'&&artObserver){img.dataset.artSrc=artSrc(game);img.fetchPriority='low';artObserver.observe(img);}
  else img.src=artSrc(game);
  img.onerror = () => img.remove();
  return img;
}
/* Idle table: the chosen game featured, and every practice-ready game as
 * an art tile to pick from (a radio group: arrows move, Space/Enter pick). */
function preview() {
  const game = chosen();
  if (!game || session) return;
  warmPracticeKart(game.id);
  let section = table.querySelector(':scope > .practice-preview');
  if (!section) {
    section = document.createElement('section');
    section.className = 'practice-preview';
    const featured = document.createElement('div');
    featured.className = 'practice-featured';
    const label = document.createElement('h2'); label.className = 'practice-pick-label'; label.id = 'practicePickLabel'; label.textContent = 'Pick a game';
    // Categories narrow the library without changing the selected game.
    const ready = games.filter(g => practiceSupport(g));
    const cats = [...new Set(ready.map(g => g.cat).filter(Boolean))];
    const chips = document.createElement('div');
    chips.className = 'practice-cats'; chips.setAttribute('role', 'group'); chips.setAttribute('aria-label', 'Game categories');
    for (const cat of cats.length > 1 ? ['all', ...cats] : []) {
      const chip = document.createElement('button');
      chip.type = 'button'; chip.dataset.cat = cat === 'all' ? '' : cat;
      chip.textContent = cat === 'all' ? 'All' : CAT_LABELS[cat] || cat[0].toUpperCase() + cat.slice(1);
      chip.setAttribute('aria-pressed', String(cat === 'all'));
      chip.onclick = () => {
        for (const c of chips.children) c.setAttribute('aria-pressed', String(c === chip));
        for (const tile of grid.children) tile.hidden = cat !== 'all' && tile.dataset.cat !== cat;
        syncChoiceFocus(grid);
      };
      chips.append(chip);
    }
    const grid = document.createElement('div');
    grid.className = 'practice-games'; grid.setAttribute('role', 'radiogroup'); grid.setAttribute('aria-labelledby', 'practicePickLabel');
    for (const g of games) {
      if (!practiceSupport(g)) continue;
      const tile = document.createElement('button');
      tile.type = 'button'; tile.className = 'practice-tile'; tile.dataset.game = g.id; tile.dataset.cat = g.cat || '';
      tile.setAttribute('role', 'radio');
      const name = document.createElement('span'); name.className = 'practice-tile-name'; name.textContent = g.name;
      const players = document.createElement('span'); players.className = 'practice-tile-meta';
      const support = practiceSupport(g);
      players.textContent = `${support.minSeats}${support.maxSeats > support.minSeats ? `–${support.maxSeats}` : ''} players`;
      tile.append(artImage(g, 'practice-tile-art'), name, players);
      tile.onclick = () => choose(g.id, true);
      tile.onkeydown = event => {
        const tiles = [...grid.querySelectorAll('.practice-tile:not([hidden])')], i = tiles.indexOf(tile);
        const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
        if (!step && event.key !== 'Home' && event.key !== 'End') return;
        event.preventDefault();
        const next = event.key === 'Home' ? tiles[0] : event.key === 'End' ? tiles.at(-1) : tiles[(i + step + tiles.length) % tiles.length];
        choose(next.dataset.game, true); next.focus();
      };
      grid.append(tile);
    }
    section.append(featured, label, chips, grid);
    table.replaceChildren(section);
  }
  const featured = section.querySelector('.practice-featured');
  featured.dataset.cat = game.cat || '';
  const h = document.createElement('h2'); h.textContent = game.name;
  const t = document.createElement('p'); t.className = 'practice-description'; t.textContent = game.tagline || '';
  const text = document.createElement('div'); text.className = 'practice-featured-text';
  text.append(h); if (t.textContent) text.append(t);
  const players = document.createElement('p'); players.className = 'practice-players';
  text.append(players);
  featured.replaceChildren(artImage(game, 'practice-art'), text);
  paintPlayerCount();
  for (const tile of section.querySelectorAll('.practice-tile')) {
    const on = tile.dataset.game === game.id;
    tile.setAttribute('aria-checked', String(on));
  }
  syncChoiceFocus(section.querySelector('.practice-games'));
}
function syncChoiceFocus(grid) {
  const tiles = [...grid.querySelectorAll('.practice-tile')];
  const visible = tiles.filter(tile => !tile.hidden);
  const first = visible.find(tile => tile.getAttribute('aria-checked') === 'true') || visible[0];
  for (const tile of tiles) tile.tabIndex = tile === first ? 0 : -1;
}
function choose(id, fromTile) {
  if (session || gameSelect.disabled || gameSelect.value === id) return;
  gameSelect.value = id; updateSeats(); preview();
  if (fromTile) history.replaceState(null, '', `/practice/?game=${encodeURIComponent(id)}`);
}
const CAT_LABELS = { vote: 'Vote', bluff: 'Bluff', word: 'Word', speed: 'Speed', draw: 'Draw', social: 'Social', board: 'Board', '3d': '3D' };
function paintPlayerCount() {
  const row = table.querySelector('.practice-players');
  const n = Number(countSelect.value);
  if (row) row.textContent = Number.isFinite(n) && !countSelect.disabled ? `${n} players` : '';
}
// The stepper writes the hidden count select, which the form submits.
function syncCount() {
  const options = [...countSelect.options].map(o => Number(o.value)).filter(Number.isFinite);
  const n = Number(countSelect.value);
  const number = document.createElement('span'), unit = document.createElement('span');
  number.className = 'practice-count-number'; number.textContent = Number.isFinite(n) && options.length ? String(n) : '–';
  unit.className = 'practice-count-unit'; unit.textContent = Number.isFinite(n) && options.length ? ` player${n === 1 ? '' : 's'}` : '';
  const icon = document.createElement('span');
  icon.className = 'practice-count-icon'; icon.setAttribute('aria-hidden', 'true');
  icon.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/><circle cx="9" cy="7" r="4"/></svg>';
  $('practiceCountLabel').replaceChildren(icon, number, unit);
  const min = Math.min(...options), max = Math.max(...options), fixed = options.length === 1;
  const output = $('practiceCountLabel'), disabled = countSelect.disabled || !options.length || fixed;
  output.tabIndex = disabled ? -1 : 0;
  output.setAttribute('aria-disabled', String(disabled));
  output.title = fixed ? `This game uses ${n} players` : 'Use arrow keys to change players';
  for (const [key, value] of Object.entries({ 'aria-valuemin': min, 'aria-valuemax': max, 'aria-valuenow': n })) {
    if (options.length) output.setAttribute(key, String(value)); else output.removeAttribute(key);
  }
  output.setAttribute('aria-valuetext', options.length ? `${n} players${fixed ? ', fixed for this game' : ''}` : 'Loading players');
  $('practiceLess').disabled = countSelect.disabled || !options.length || n <= Math.min(...options);
  $('practiceMore').disabled = countSelect.disabled || !options.length || n >= Math.max(...options);
  $('practiceLess').title = fixed ? output.title : n <= min ? `At least ${min} players` : 'Fewer players';
  $('practiceMore').title = fixed ? output.title : n >= max ? `Up to ${max} players` : 'More players';
  paintPlayerCount();
}
function setCount(n) {
  if (countSelect.disabled) return;
  if ([...countSelect.options].some(o => Number(o.value) === n)) { countSelect.value = String(n); syncCount(); }
}
function stepCount(delta) { setCount(Number(countSelect.value) + delta); }
function updateSeats() {
  const support = practiceSupport(chosen());
  countSelect.replaceChildren();
  if (!support) {
    $('practiceNote').textContent = 'Practice has not been reviewed for this game yet.';
    countSelect.disabled = true; $('practiceStart').disabled = true; syncCount(); return;
  }
  for (let n = support.minSeats; n <= support.maxSeats; n++) countSelect.add(new Option(String(n), String(n)));
  countSelect.value = String(support.minSeats);
  countSelect.disabled = false; $('practiceStart').disabled = false;
  $('practiceNote').textContent = support.note;
  $('practicePlayingNote').textContent = support.note;
  syncCount();
}

async function loadCatalog() {
  if (session) return;
  cancelCatalog();
  const attempt = ++catalogAttempt;
  const controller = new AbortController();
  let socket, timer;
  cancelCatalog = () => { controller.abort(); clearTimeout(timer); socket?.close(); };
  gameSelect.disabled = countSelect.disabled = $('practiceStart').disabled = true; syncCount();
  $('practiceRetry').hidden = true;
  status('Getting the games ready…');
  empty('Shuffling the games…', '', true);
  try {
    timer = setTimeout(() => { controller.abort(); socket?.close(); }, 8000);
    const config = await (window.GiggleTelemetry?.configPromise || Promise.resolve(null)).then(cached => cached || fetch('/config.json', { signal: controller.signal, cache: 'no-store' }).then(response => {
      if (!response.ok) throw new Error('Config unavailable');
      return response.json();
    }));
    window.GiggleTelemetry?.configure(config);
    if (config.ok !== true) throw new Error('Config unavailable');
    const override = wsTargetFromConfig(config, { allowWs: location.protocol !== 'https:' });
    socket = new WebSocket(override || `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}`);
    const catalog = await new Promise((resolve, reject) => {
      socket.onopen = () => socket.send(JSON.stringify({ t: 'games' }));
      socket.onmessage = event => {
        try {
          const message = JSON.parse(event.data);
          if (message.t === 'games' && Array.isArray(message.games)) resolve(message.games);
        } catch { reject(new Error('Invalid game list')); }
      };
      socket.onerror = () => reject(new Error('Game connection unavailable'));
      socket.onclose = () => reject(new Error('Game connection closed'));
      controller.signal.addEventListener('abort', () => reject(new Error('Connection timed out')), { once: true });
    });
    if (attempt !== catalogAttempt) return;
    games = catalog.filter(game => typeof game.id === 'string' && /^[a-z0-9-]{2,40}$/.test(game.id) && typeof game.name === 'string');
    if (!games.length) {
      status('No games available');
      empty('No games right now', 'Try again in a moment.');
      $('practiceRetry').hidden = false;
      return;
    }
    gameSelect.replaceChildren();
    for (const game of games) {
      const option = new Option(game.name, game.id);
      option.disabled = !practiceSupport(game);
      gameSelect.add(option);
    }
    const requested = new URLSearchParams(location.search).get('game');
    gameSelect.value = games.some(game => game.id === requested && practiceSupport(game)) ? requested : games.find(game => practiceSupport(game))?.id || '';
    gameSelect.disabled = false; updateSeats();
    status(`${games.length} games · you control every seat`);
    preview();
  } catch {
    if (attempt !== catalogAttempt) return;
    status('Games unavailable');
    empty('Can’t reach the games', 'Check your connection and retry.');
    $('practiceRetry').hidden = false;
  } finally { clearTimeout(timer); socket?.close(); }
}

function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = bytes[6] & 15 | 64; bytes[8] = bytes[8] & 63 | 128;
  const hex = [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
function message(seat, t) {
  seat.frame.contentWindow?.postMessage({ t, session }, location.origin);
}
function selectSeat(n, focus = false) {
  if (!seats.has(n)) return;
  if (selected !== n && seats.has(selected)) message(seats.get(selected), 'giggle-practice-pause-input');
  selected = n;
  for (const [number, seat] of seats) {
    const active = number === n;
    if (!all && !active) message(seat, 'giggle-practice-pause-input');
    seat.tab.setAttribute('aria-selected', String(active));
    seat.tab.tabIndex = active ? 0 : -1;
    seat.panel.classList.toggle('is-inactive', !all && !active);
    seat.panel.inert = !all && !active;
    seat.panel.setAttribute('aria-hidden', String(!all && !active));
  }
  if (focus) seats.get(n).tab.focus();
}
function makeSeat(n, src) {
  const context = practiceContext(`?practice=${session}&seat=${n}`);
  sessionStorage.setItem(context.prefix + 'pb_name', `Player ${n}`);
  sessionStorage.setItem(context.prefix + 'pb_theme', document.documentElement.dataset.theme === 'night' ? 'night' : 'day');
  const panel = document.createElement('section');
  panel.className = 'practice-seat'; panel.id = `practiceSeat${n}`;
  panel.setAttribute('role', 'tabpanel'); panel.setAttribute('aria-labelledby', `practiceTab${n}`);
  const loading = document.createElement('p');
  loading.className = 'practice-seat-status'; loading.setAttribute('role', 'status');
  loading.textContent = `Opening Player ${n}…`;
  const frame = document.createElement('iframe');
  frame.title = `Player ${n} practice seat`;
  frame.allow = "camera 'none'; microphone 'none'; autoplay; fullscreen";
  frame.src = src;
  const tab = document.createElement('button');
  tab.id = `practiceTab${n}`; tab.type = 'button'; tab.setAttribute('role', 'tab');
  tab.setAttribute('aria-controls', panel.id); seatLabel(tab, n);
  tab.onclick = () => selectSeat(n);
  panel.append(frame, loading); $('practiceTabs').append(tab); table.append(panel);
  const seat = { frame, panel, tab, loading, connected: false, closed: false, host: false, timer: 0 };
  seat.timer = setTimeout(() => { if (!seat.connected && session && !stopping) status(`Player ${n} hasn’t connected. Reload this seat or end practice.`); }, 15000);
  seats.set(n, seat); selectSeat(selected);
}
function start(event) {
  event.preventDefault();
  if (session || stopping) return;
  artObserver?.disconnect();
  const game = chosen(), support = practiceSupport(game);
  const requestedCount = Number(countSelect.value);
  if (!support || !Number.isInteger(requestedCount) || requestedCount < support.minSeats || requestedCount > support.maxSeats) return;
  let next;
  try {
    next = uuid();
    sessionStorage.setItem(`practice:${next}:probe`, '1'); sessionStorage.removeItem(`practice:${next}:probe`);
  } catch {
    status('Practice needs site session storage');
    empty('Can’t open separate seats', 'Allow site storage, then try again.'); return;
  }
  session = next; count = requestedCount; selected = 1; all = false;
  document.body.classList.add('is-running');
  $('practiceGuide').open = false;
  gameSelect.disabled = countSelect.disabled = $('practiceStart').disabled = true; syncCount();
  $('practiceControls').hidden = false; $('practiceAll').setAttribute('aria-pressed', 'false');
  table.classList.remove('is-all'); table.replaceChildren();
  status('Player 1 is making the room…');
  try { makeSeat(1, `/?practice=${session}&seat=1&game=${encodeURIComponent(game.id)}&name=Player%201`); }
  catch {
    cleanup(false); status('Practice needs site session storage');
    empty('Can’t open separate seats', 'Site storage is full or blocked.');
  }
}

function cleanup(confirmed) {
  clearTimeout(stopTimer);
  for (const seat of seats.values()) clearTimeout(seat.timer);
  const ended = session;
  seats.clear(); session = ''; stopping = false; finishStop = null;
  document.body.classList.remove('is-running');
  $('practiceTabs').replaceChildren(); $('practiceControls').hidden = true;
  table.classList.remove('is-all');
  // Retire child documents before purging their storage: pagehide callbacks
  // must not recreate state after the last seat acknowledged Leave.
  table.replaceChildren();
  try {
    // Storage key ordering may change on deletion. Snapshot first so no
    // practice key is skipped while the backing key list is reindexed.
    for (const key of Object.keys(sessionStorage)) {
      if (key.startsWith(`practice:${ended}:`)) sessionStorage.removeItem(key);
    }
  } catch { /* Never clear unrelated storage to recover practice. */ }
  gameSelect.disabled = false; updateSeats();
  status(confirmed ? 'Practice ended' : 'Practice ended; unconfirmed seats disconnected');
  preview();
  $('practiceStart').focus();
}
function stop() {
  if (!session || stopping) return;
  stopping = true; status('Leaving every practice seat…');
  finishStop = () => cleanup([...seats.values()].every(seat => seat.leaveConfirmed));
  stopTimer = setTimeout(() => cleanup(false), 2500);
  for (const seat of seats.values()) message(seat, 'giggle-practice-close');
}

window.addEventListener('message', event => {
  if (!session || event.origin !== location.origin || !event.data || event.data.session !== session) return;
  const n = event.data.seat, seat = seats.get(n);
  if (!seat || event.source !== seat.frame.contentWindow) return;
  if (event.data.t === 'giggle-practice-closed') {
    if (!stopping) return;
    seat.closed = true;
    seat.leaveConfirmed = event.data.confirmed === true;
    if ([...seats.values()].every(value => value.closed)) finishStop?.();
    return;
  }
  if (event.data.t !== 'giggle-practice-state' || stopping) return;
  seat.connected = event.data.connected === true;
  seat.host = event.data.host === true;
  seat.game = typeof event.data.game === 'string' ? event.data.game : '';
  seat.finished = event.data.finished === true;
  seatLabel(seat.tab, n);
  seat.tab.classList.toggle('is-host', seat.host);
  seat.tab.title = seat.host ? `Player ${n} is hosting` : '';
  seat.tab.setAttribute('aria-label', `Player ${n}${seat.host ? ', hosting' : ''}`);
  if (seat.connected) { clearTimeout(seat.timer); seat.loading.hidden = true; }
  if (n === 1 && seats.size === 1 && seat.connected && /^[A-HJ-NP-Z2-9]{4}$/.test(event.data.code || '')) {
    try {
      for (let number = 2; number <= count; number++) makeSeat(number, `/r/${event.data.code}?practice=${session}&seat=${number}&game=${encodeURIComponent(chosen().id)}`);
    } catch { status('Could not open the other seats. End practice and try again.'); return; }
  }
  const connected = [...seats.values()].filter(value => value.connected).length;
  const current = [...seats.values()].find(value => value.game);
  const note = current?.finished ? 'round finished · rematch in the host seat' : current ? 'switch seats to play · timers keep running' : 'the host starts the game';
  status(connected === count ? `${count} seats ${current ? 'connected' : 'ready'} · ${note}` : `${connected} of ${count} seats connected · timers keep running`);
});
$('practiceSetup').onsubmit = start;
$('practiceRetry').onclick = loadCatalog;
gameSelect.onchange = () => { updateSeats(); preview(); };
countSelect.onchange = syncCount;
$('practiceLess').onclick = () => stepCount(-1);
$('practiceMore').onclick = () => stepCount(1);
$('practiceCountLabel').onkeydown = event => {
  if (countSelect.disabled) return;
  const options = [...countSelect.options].map(o => Number(o.value)).filter(Number.isFinite);
  const delta = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 }[event.key];
  if (delta !== undefined) { event.preventDefault(); stepCount(delta); }
  else if (event.key === 'Home' || event.key === 'End') { event.preventDefault(); setCount(event.key === 'Home' ? options[0] : options.at(-1)); }
};
$('practiceStop').onclick = stop;
$('practiceReload').onclick = () => {
  const seat = seats.get(selected);
  if (seat && !stopping) { seat.connected = false; status(`Reconnecting Player ${selected}…`); seat.frame.contentWindow.location.reload(); }
};
$('practiceAll').onclick = () => {
  all = !all; table.classList.toggle('is-all', all);
  $('practiceAll').setAttribute('aria-pressed', String(all)); selectSeat(selected);
};
$('practiceTabs').onkeydown = event => {
  const numbers = [...seats.keys()];
  const focused = numbers.find(number => seats.get(number).tab === event.target) || selected;
  let next = focused;
  if (event.key === 'ArrowRight') next = numbers[(numbers.indexOf(focused) + 1) % numbers.length];
  else if (event.key === 'ArrowLeft') next = numbers[(numbers.indexOf(focused) + numbers.length - 1) % numbers.length];
  else if (event.key === 'Home') next = numbers[0];
  else if (event.key === 'End') next = numbers.at(-1);
  else return;
  event.preventDefault(); selectSeat(next, true);
};
window.addEventListener('pagehide', () => {
  cancelCatalog();
  for (const seat of seats.values()) message(seat, 'giggle-practice-close');
});
loadCatalog();

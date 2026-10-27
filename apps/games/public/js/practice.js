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

function status(text) { if ($('practiceStatus').textContent !== text) $('practiceStatus').textContent = text; }
function empty(title, description, busy = false) {
  const section = document.createElement('section');
  section.className = 'practice-empty boot-view';
  section.setAttribute('role', busy ? 'status' : 'alert');
  section.setAttribute('aria-busy', String(busy));
  if (busy) section.innerHTML = '<span class="loading-mark" aria-hidden="true"><i></i><i></i><i></i></span>';
  const heading = document.createElement('h2'); heading.textContent = title;
  const text = document.createElement('p'); text.textContent = description;
  section.append(heading, text); table.replaceChildren(section);
}
function chosen() { return games.find(game => game.id === gameSelect.value); }
function updateSeats() {
  const support = practiceSupport(chosen());
  countSelect.replaceChildren();
  if (!support) {
    $('practiceNote').textContent = 'Practice has not been reviewed for this game yet.';
    countSelect.disabled = true; $('practiceStart').disabled = true; return;
  }
  for (let n = support.minSeats; n <= support.maxSeats; n++) countSelect.add(new Option(String(n), String(n)));
  countSelect.value = String(support.minSeats);
  countSelect.disabled = false; $('practiceStart').disabled = false;
  $('practiceNote').textContent = support.note;
  $('practicePlayingNote').textContent = support.note;
}

async function loadCatalog() {
  if (session) return;
  cancelCatalog();
  const attempt = ++catalogAttempt;
  const controller = new AbortController();
  let socket, timer;
  cancelCatalog = () => { controller.abort(); clearTimeout(timer); socket?.close(); };
  gameSelect.disabled = countSelect.disabled = $('practiceStart').disabled = true;
  $('practiceRetry').hidden = true;
  status('Getting the games ready…');
  empty('Getting the games ready…', 'The live game list supplies the rules and player minimums.', true);
  try {
    timer = setTimeout(() => { controller.abort(); socket?.close(); }, 8000);
    const response = await fetch('/config.json', { signal: controller.signal, cache: 'no-store' });
    if (!response.ok) throw new Error('Config unavailable');
    const config = await response.json();
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
      empty('The game shelf is empty', 'The server connected but is not offering games yet. Retry later.');
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
    empty('A whole table, just for you', 'Choose a game and start practice. Player 1 is the first host; no room is created until you start.');
    table.firstElementChild.setAttribute('role', 'status');
  } catch {
    if (attempt !== catalogAttempt) return;
    status('Games unavailable');
    empty('Can’t reach the games yet', 'Check your connection, then retry. No practice room was created.');
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
  tab.setAttribute('aria-controls', panel.id); tab.textContent = `Player ${n}`;
  tab.onclick = () => selectSeat(n);
  panel.append(frame, loading); $('practiceTabs').append(tab); table.append(panel);
  const seat = { frame, panel, tab, loading, connected: false, closed: false, host: false, timer: 0 };
  seat.timer = setTimeout(() => { if (!seat.connected && session && !stopping) status(`Player ${n} hasn’t connected. Reload this seat or end practice.`); }, 15000);
  seats.set(n, seat); selectSeat(selected);
}
function start(event) {
  event.preventDefault();
  if (session || stopping) return;
  const game = chosen(), support = practiceSupport(game);
  const requestedCount = Number(countSelect.value);
  if (!support || !Number.isInteger(requestedCount) || requestedCount < support.minSeats || requestedCount > support.maxSeats) return;
  let next;
  try {
    next = uuid();
    sessionStorage.setItem(`practice:${next}:probe`, '1'); sessionStorage.removeItem(`practice:${next}:probe`);
  } catch {
    status('Practice needs site session storage');
    empty('Can’t save separate seats', 'Allow session storage for this site, then try again. Your existing storage has not been cleared.'); return;
  }
  session = next; count = requestedCount; selected = 1; all = false;
  document.body.classList.add('is-running');
  $('practiceGuide').open = false;
  gameSelect.disabled = countSelect.disabled = $('practiceStart').disabled = true;
  $('practiceControls').hidden = false; $('practiceAll').setAttribute('aria-pressed', 'false');
  table.classList.remove('is-all'); table.replaceChildren();
  status('Player 1 is making the room…');
  try { makeSeat(1, `/?practice=${session}&seat=1&game=${encodeURIComponent(game.id)}&name=Player%201`); }
  catch {
    cleanup(false); status('Practice needs site session storage');
    empty('Can’t save separate seats', 'Your site storage is full or blocked. Your normal saved room and name were not cleared.');
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
  empty('Ready for another try?', 'Choose a game and start a fresh table. Your normal saved room and name were not changed.');
  table.firstElementChild.setAttribute('role', 'status');
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
  seat.tab.textContent = `Player ${n}${seat.host ? ' · host' : ''}`;
  if (seat.connected) { clearTimeout(seat.timer); seat.loading.hidden = true; }
  if (n === 1 && seats.size === 1 && seat.connected && /^[A-HJ-NP-Z2-9]{4}$/.test(event.data.code || '')) {
    try {
      for (let number = 2; number <= count; number++) makeSeat(number, `/r/${event.data.code}?practice=${session}&seat=${number}`);
    } catch { status('Could not open the other seats. End practice and try again.'); return; }
  }
  const connected = [...seats.values()].filter(value => value.connected).length;
  const current = [...seats.values()].find(value => value.game);
  const note = current?.finished ? 'round finished · rematch in the host seat' : current ? 'switch seats to play · timers keep running' : 'the host starts the game';
  status(connected === count ? `${count} seats ${current ? 'connected' : 'ready'} · ${note}` : `${connected} of ${count} seats connected · timers keep running`);
});
$('practiceSetup').onsubmit = start;
$('practiceRetry').onclick = loadCatalog;
gameSelect.onchange = updateSeats;
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

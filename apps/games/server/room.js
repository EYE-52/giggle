'use strict';
/* Party room: players, game session, server-authoritative broadcast.
 * No login: identity = seat id + cryptographic resume token.
 * A display name NEVER grants seat ownership; only a matching token
 * reclaims a seat (connected or disconnected). Duplicate names get a
 * unique display suffix instead of taking over. */

const crypto = require('crypto');
const {
  LIMITS, manifestPlayers, manifestSeats, activeIds,
  validateSettings, validatePack, packCounts,
} = require('../games/_validate');
const { actionWindow } = require('../games/_sdk');
const { teamMetadata } = require('./bridge');

const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/* Application close code when a seat is deliberately taken over by a new
 * socket (same resume token / same verified sub elsewhere). The replaced
 * client must NOT auto-reconnect — it shows "Playing in another window"
 * with a deliberate "Rejoin here" action. Mirrored in public/js/app.js. */
const SEAT_REPLACED_CODE = 4001;
const SEAT_REPLACED_REASON = 'seat-replaced';
const SEAT_REMOVED_CODE = 4003;
const SEAT_REMOVED_REASON = 'removed-by-host';

/* A backlogged socket skips discardable realtime ticks before projection
 * and serialization. Its next send carries fresh poses and any retained
 * combat events not yet sent. Terminal and turn-based broadcasts never
 * pass { discardable: true } and are always delivered. */
const SLOW_SOCKET_BYTES = 8192;
const PREPARE_TIMEOUT_MS = 12000;

/* A match member who stays disconnected this long is "gone": the game's
 * optional onPlayerGone(state, ctx, pid, 'away') hook runs once so it can
 * forfeit, skip or drop them (see GAME_UI_GUIDE.md, "Ending and leaving"). */
const AWAY_TIMEOUT_MS = 60000;

/* Central join/create name guard: names arrive over WS as JSON, so a
 * hostile object (e.g. {"toString":null}) would make String() throw.
 * Reject non-strings BEFORE creating/detaching rooms; missing names fall
 * back to "Player" in _uniqueName. */
function validJoinName(value) {
  return value === undefined || value === null || typeof value === 'string';
}

function makeCode() {
  let c = '';
  for (let i = 0; i < 4; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return c;
}

function newToken() {
  return crypto.randomBytes(16).toString('hex');
}

class Room {
  constructor(code, content, opts = {}) {
    this.code = code;
    this.content = content; // {gameId: {...}, shell: {...}}
    // Giggle embed rooms: { squadId }. Private — only verified Giggle
    // tickets join (see server/bridge.js); anonymous code/seat-token joins
    // are rejected by the server before reaching the room.
    this.giggle = opts.giggle || null;
    // Optional send gate consulted by broadcasts (Giggle lease expiry).
    this.canSend = typeof opts.canSend === 'function' ? opts.canSend : null;
    this.players = []; // {id, name, token, socket, connected, giggleSub?}
    this.kartEventCursors = new WeakMap(); // connection, not seat/resume identity
    this.removedTokens = new Set();
    this.removedSubs = new Set(); // room lifetime, including lobby/rematches
    this.game = null; // {def, state, generation, roster:[ids], instanceId}
    this._instanceSeq = 0;
    this._phaseStart = { key: null, at: 0 }; // stable phaseStartedAt per window
    this.totals = {}; // pid -> session points across games
    this.timers = new Set();
    this.hostId = null;
    this.config = {}; // gameId -> {settings, pack} validated, room-scoped, kept for rematch
    this._sessions = {}; // gameId -> trusted server-only per-game store (see ctx.session)
    this._sessionOrder = []; // insertion order for the bounded sessions map
    this._pruneTimer = null;
    this.prepareTimeoutMs = opts.prepareTimeoutMs ?? PREPARE_TIMEOUT_MS;
    this.awayTimeoutMs = opts.awayTimeoutMs ?? AWAY_TIMEOUT_MS;
    this._awayTimers = new Map(); // pid -> timeout handle (current match only)
  }

  /* Trusted per-game store, scoped AUTOMATICALLY to the running game id.
   * Games call ctx.session() with no arguments and get the mutable object
   * for the current game def id — never an arbitrary client-supplied key,
   * so the map is bounded by distinct games started in this room (dozens
   * at most), not by client input. Survives rematches and switching
   * away/back for that game; dies with the room (no account permanence).
   * With no game running, returns a transient object (not persisted). */
  sessionForCurrentGame() {
    const gid = this.game && this.game.def ? this.game.def.id : null;
    if (!gid || typeof gid !== 'string') return {};
    if (!Object.prototype.hasOwnProperty.call(this._sessions, gid)) {
      this._sessions[gid] = {};
      this._sessionOrder.push(gid);
      while (this._sessionOrder.length > 64) {
        const drop = this._sessionOrder.shift();
        delete this._sessions[drop];
      }
    }
    return this._sessions[gid];
  }

  connectedPlayers() {
    return this.players.filter((p) => p.connected);
  }

  /* Seats that pressed Leave (standalone) are kept only while the running
   * match still needs their name; they are not part of the room. */
  seatedPlayers() {
    return this.players.filter((p) => !p.gone);
  }

  /* True when pid pressed Leave during the running match. The seat keeps
   * its place in the roster (names, seat order, scores stay stable) but no
   * longer plays: not in ctx.players(), actions ignored, sees spectator. */
  hasLeft(pid) {
    return !!this.game?.left?.has(pid);
  }

  /* Longest-seated connected player. Retained seats stay in join order,
   * so the first connected entry is the longest-connected. */
  _electHost() {
    const c = this.connectedPlayers();
    this.hostId = c.length ? c[0].id : null;
  }

  ensureHost() {
    if (!this.connectedPlayers().some((p) => p.id === this.hostId)) this._electHost();
  }

  /* Host owns configuration while connected. If no host is connected
   * (all seats dropped), any connected player may act so the party
   * never deadlocks. */
  canControl(pid) {
    this.ensureHost();
    if (!this.hostId) return true;
    return pid === this.hostId;
  }

  /* Public config metadata: settings + pack ITEM COUNTS only.
   * Custom pack contents never leave the server in snapshots. */
  configMeta() {
    const out = {};
    for (const gid of Object.keys(this.config)) {
      out[gid] = {
        settings: { ...this.config[gid].settings },
        packs: packCounts(this.config[gid].pack),
      };
    }
    return out;
  }

  /* Active-game roster: seat ids connected when the game started.
   * Disconnected-before-start seats and mid-game joiners are NOT members.
   * Members keep their roster seat across disconnects (token resume). */
  rosterIds() {
    return this.game ? this.game.roster.slice() : [];
  }

  rosterPlayers() {
    if (!this.game) return [];
    const want = new Set(this.game.roster);
    return this.players.filter((p) => want.has(p.id));
  }

  /* Active roster: the first `manifest.seats` roster seats in stable roster
   * order (chess: the first two play, the rest watch). Games without a seat
   * cap keep the whole roster active — exact legacy behavior. */
  activeRosterIds() {
    if (!this.game) return [];
    return activeIds(this.game.roster, this.game.def);
  }

  activeRosterPlayers() {
    if (!this.game) return [];
    const want = new Set(this.activeRosterIds());
    return this.players.filter((p) => want.has(p.id));
  }

  /* Connected seats outside the ACTIVE roster: late joiners plus roster
   * members beyond the seat cap (watchers). All watch-only. */
  spectatorPlayers() {
    if (!this.game) return [];
    const want = new Set(this.activeRosterIds());
    return this.players.filter((p) => p.connected && (!want.has(p.id) || this.hasLeft(p.id)));
  }

  isSpectator(pid) {
    return !!this.game && (!this.activeRosterIds().includes(pid) || this.hasLeft(pid));
  }

  get lobby() {
    this.ensureHost();
    const snap = {
      code: this.code,
      players: this.seatedPlayers().map((p) => ({ id: p.id, name: p.name, connected: p.connected,
        ...(this.giggle && p.giggleSub ? { callUserId: p.giggleSub,
          ...(p.team ? { team: p.team, teamName: p.teamName } : {}) } : {}) })),
      totals: { ...this.totals },
      game: this.game ? this.game.def.id : null,
      hostId: this.hostId,
      config: this.configMeta(),
    };
    if (this.game) {
      snap.instanceId = this.game.instanceId;
      snap.participants = this.activeRosterPlayers().map((p) => ({ id: p.id, name: p.name,
        connected: p.connected && !this.hasLeft(p.id), ...(this.hasLeft(p.id) ? { left: true } : {}) }));
      if (this.game.ended) snap.ended = true;
      snap.spectators = this.spectatorPlayers().map((p) => ({ id: p.id, name: p.name }));
      const seats = manifestSeats(this.game.def);
      if (seats !== null) snap.seats = seats;
    }
    return snap;
  }

  _uniqueName(want, exceptId) {
    const clean = String(want || '').slice(0, 16).trim() || 'Player';
    const taken = new Set(this.seatedPlayers()
      .filter((p) => p.id !== exceptId)
      .map((p) => p.name.toLowerCase()));
    if (!taken.has(clean.toLowerCase())) return clean;
    // Truncate the BASE to leave room for " N" so a full-length name
    // still yields a distinct candidate within 16 chars.
    for (let n = 2; n < 100; n++) {
      const suffix = ' ' + n;
      const cand = clean.slice(0, 16 - suffix.length) + suffix;
      if (!taken.has(cand.toLowerCase())) return cand;
    }
    for (let n = 100; n < 1000; n++) {
      const suffix = ' ' + n;
      const cand = clean.slice(0, 16 - suffix.length) + suffix;
      if (!taken.has(cand.toLowerCase())) return cand;
    }
    return clean.slice(0, 12) + ' ' + String(Date.now() % 1000).padStart(3, '0');
  }

  _cancelPrune() {
    if (this._pruneTimer) {
      clearTimeout(this._pruneTimer);
      this._pruneTimer = null;
    }
  }

  /* Capacity/resume preflight for anonymous joins. The server runs this
   * BEFORE detaching the socket's current room, so a failed target join
   * (full room) leaves the current room/host intact. */
  preflightAdd(seatToken) {
    if (this.removedTokens.has(seatToken)) return { error: 'The host removed you from this room.', code: 'REMOVED_FROM_ROOM' };
    if (seatToken) {
      const seat = this.players.find((p) => p.token === seatToken && !p.giggleSub);
      if (seat) return { resume: true };
    }
    if (this.seatedPlayers().length >= LIMITS.ROOM_CAP) return { error: 'Room is full.' };
    return { resume: false };
  }

  /* Capacity/resume preflight for verified Giggle joins (by sub). */
  preflightGiggle(sub) {
    if (this.removedSubs.has(sub)) return { error: 'The host removed you from this room.', code: 'REMOVED_FROM_ROOM' };
    if (this.players.some((p) => p.giggleSub === sub)) return { resume: true };
    if (this.seatedPlayers().length >= LIMITS.ROOM_CAP) return { error: 'Room is full.' };
    return { resume: false };
  }

  /* Token reclaim first (works whether the seat is connected — the old
   * socket is dropped — or disconnected), else a fresh seat with a
   * de-duplicated display name. Never take over by name. */
  addPlayer(name, socket, seatToken) {
    const preflight = this.preflightAdd(seatToken);
    if (preflight.error) return preflight;
    if (seatToken) {
      // Giggle seats resume only via fresh Giggle tickets (addGigglePlayer),
      // never via a legacy seat token — an anonymous join presenting one is
      // treated as an unknown token and grants nothing.
      const seat = this.players.find((p) => p.token === seatToken && !p.giggleSub);
      if (seat) {
        if (seat.connected && seat.socket !== socket) this._notifyConnection(seat.id, false);
        try {
          if (seat.socket && seat.socket !== socket && seat.socket.readyState === 1) {
            seat.socket.close(SEAT_REPLACED_CODE, SEAT_REPLACED_REASON);
          }
        } catch { /* best effort */ }
        seat.socket = socket;
        seat.connected = true;
        seat.name = this._uniqueName(name || seat.name, seat.id);
        this._cancelPrune();
        this.ensureHost();
        this._notifyConnection(seat.id, true);
        return { player: seat, resumed: true };
      }
      // Unknown/foreign token: fall through to a fresh seat (scoped per room,
      // so a token from another room grants nothing here).
    }
    if (this.seatedPlayers().length >= LIMITS.ROOM_CAP) {
      return { error: 'Room is full.' };
    }
    const p = {
      id: 'p' + crypto.randomBytes(4).toString('hex'),
      name: this._uniqueName(name),
      token: newToken(),
      socket,
      connected: true,
    };
    this.players.push(p);
    this.totals[p.id] = this.totals[p.id] || 0;
    this._cancelPrune();
    this.ensureHost();
    this._notifyConnection(p.id, true);
    return { player: p, resumed: false };
  }

  /* Verified Giggle seat: the ticket's sub (never the display name) owns
   * the seat, so reconnects with a fresh ticket resume the same active
   * participant seat and same-name users get distinct deduped seats. */
  addGigglePlayer(sub, displayName, socket, metadata = {}) {
    const team = teamMetadata(metadata);
    if (team.error) return { error: 'Invalid squad metadata.' };
    const preflight = this.preflightGiggle(sub);
    if (preflight.error) return preflight;
    const seat = this.players.find((p) => p.giggleSub === sub);
    if (seat) {
      if (seat.connected && seat.socket !== socket) this._notifyConnection(seat.id, false);
      try {
        if (seat.socket && seat.socket !== socket && seat.socket.readyState === 1) {
          seat.socket.close(SEAT_REPLACED_CODE, SEAT_REPLACED_REASON);
        }
      } catch { /* best effort */ }
      seat.socket = socket;
      seat.connected = true;
      seat.name = this._uniqueName(displayName || seat.name, seat.id);
      // Every fresh ticket replaces the metadata, including a legacy ticket
      // with no side. Never retain stale claims or take them from WS input.
      delete seat.team;
      delete seat.teamName;
      Object.assign(seat, team);
      this._cancelPrune();
      this.ensureHost();
      this._notifyConnection(seat.id, true);
      return { player: seat, resumed: true };
    }
    if (this.seatedPlayers().length >= LIMITS.ROOM_CAP) {
      return { error: 'Room is full.' };
    }
    const p = {
      id: 'p' + crypto.randomBytes(4).toString('hex'),
      name: this._uniqueName(displayName),
      token: newToken(),
      socket,
      connected: true,
      giggleSub: sub,
      ...team,
    };
    this.players.push(p);
    this.totals[p.id] = this.totals[p.id] || 0;
    this._cancelPrune();
    this.ensureHost();
    this._notifyConnection(p.id, true);
    return { player: p, resumed: false };
  }

  _notifyConnection(pid, connected) {
    if (this.hasLeft(pid)) return; // left the match: the game no longer tracks them
    if (this.game?.preparing) {
      if (!connected) this.game.ready?.delete(pid);
      // A seat may resume after disconnect() removed it from the quorum.
      // While this window still prepares, its new client must load too.
      // Resuming an already-live window never pauses or extends its clock.
      else if (this.activeRosterIds().includes(pid)) this.game.requiredReady?.add(pid);
    }
    if (connected) this._clearAway(pid);
    else this._armAway(pid);
    if (!this.game || !this.game.state || !this.game.def.onConnection || !this.activeRosterIds().includes(pid)) return;
    try { this.game.def.onConnection(this.game.state, this.ctx(), pid, connected); }
    catch (e) { console.error('game connection error', e); }
  }

  bySocket(ws) {
    return this.players.find((p) => p.socket === ws);
  }

  _sendable(ws) {
    // Expired Giggle leases stop receiving room data immediately, even
    // before the server's sweep closes the socket.
    if (!ws || ws.readyState !== 1) return false;
    if (this.canSend && !this.canSend(ws)) return false;
    return true;
  }

  send(ws, msg) {
    if (this._sendable(ws)) ws.send(JSON.stringify(msg));
  }

  broadcastLobby() {
    const msg = JSON.stringify({ t: 'room', room: this.lobby });
    for (const p of this.players) {
      if (!p.connected || !p.socket || !this._sendable(p.socket)) continue;
      // One dead socket must not starve the rest of the room (this runs on
      // the unprotected socket-close path, where a throw would crash).
      try {
        p.socket.send(msg);
      } catch { /* best effort: disconnect/prune handles the dead seat */ }
    }
  }

  broadcastState(opts) {
    // Null state is transiently visible when a game broadcasts synchronously
    // from inside create() (room.game.state is still being assigned): fall
    // back to the lobby snapshot instead of viewing null.
    if (!this.game || !this.game.state) return this.broadcastLobby();
    this._syncWindow();
    // players[] is the ACTIVE ROSTER (stable for this instance): the whole
    // start roster normally, or the first `seats` seats for seat-capped
    // games. Late joiners and seat-cap watchers arrive in spectators[] and
    // cannot act until the next start.
    const discardable = !!(opts && opts.discardable) && !this.game.preparing;
    const players = this.activeRosterPlayers().map((q) => (this.hasLeft(q.id)
      ? { id: q.id, name: q.name, connected: false, left: true }
      : { id: q.id, name: q.name, connected: q.connected }));
    const spectators = this.spectatorPlayers().map((q) => ({ id: q.id, name: q.name }));
    const inRoster = new Set(this.activeRosterIds());
    const w = this._actionToken();
    /* Server time + stable phase start on every snapshot, tracked HERE in
     * the room (outside private projection): the first broadcast per
     * instance/window/endsAt records the start; later same-window
     * broadcasts — including late joiners — share it, so every client
     * drains one bar. Never touches game state, totals, or race tokens. */
    const endsAt = this.game.state && Number.isFinite(this.game.state.endsAt)
      ? this.game.state.endsAt : 0;
    const phaseKey = `${this.game.instanceId}|${w}|${endsAt}`;
    if (this._phaseStart.key !== phaseKey) {
      this._phaseStart = { key: phaseKey, at: this._gameNow() };
    }
    const serverNow = Date.now();
    const phaseStartedAt = this._phaseStart.at;
    const ctx = this.ctx();
    for (const p of this.players) {
      if (!p.connected || !p.socket || !this._sendable(p.socket)) continue;
      // Discardable ticks only: a backlogged socket skips this snapshot
      // (checked BEFORE view/JSON work so slow clients cost nothing here).
      // Sockets without bufferedAmount (tests, old impls) always receive.
      if (discardable && typeof p.socket.bufferedAmount === 'number' &&
          p.socket.bufferedAmount > SLOW_SOCKET_BYTES) continue;
      // One bad view/send must not starve the rest of the room or crash the
      // process: this runs on action, timer, tick, AND socket-close paths.
      let view;
      try {
        // Optional transport views share immutable public nodes. Keep the
        // definition receiver for both hooks and ordinary view methods.
        const def = this.game.def;
        view = typeof def.viewForTransport === 'function'
          ? def.viewForTransport(this.game.state, p.id, ctx)
          : def.view(this.game.state, p.id, ctx);
      } catch (e) {
        console.error('game view error', e);
        continue;
      }
      try {
        let eventCursor;
        if (this.game.def.id === 'pocket-karts' && p.socket.kartEventDeltas === true && Array.isArray(view.events)) {
          const previous = this.kartEventCursors.get(p.socket);
          eventCursor = { instanceId: this.game.instanceId, ids: new Set(view.events.map(event => event.id)) };
          if (previous?.instanceId === eventCursor.instanceId) {
            view = { ...view, events: view.events.filter(event => !previous.ids.has(event.id)) };
          }
        }
        p.socket.send(JSON.stringify({
          t: 'state',
          game: this.game.def.id,
          instanceId: this.game.instanceId,
          w,
          you: p.id,
          spectator: !inRoster.has(p.id) || this.hasLeft(p.id),
          players,
          participants: players,
          spectators,
          totals: { ...this.totals },
          ...view,
          serverNow,
          phaseStartedAt,
          // Host/system "End game": the match is over even when the game
          // has no onEnd hook (the shell then shows its own Final scores).
          ...(this.game.ended ? { matchEnded: true, matchPoints: { ...(this.game.awarded || {}) } } : {}),
          ...(this.hasLeft(p.id) ? { youLeft: true } : {}),
          ...(this.game.waitForReady ? {
            preparing: this.game.preparing,
            gameNow: this._gameNow(),
            clockOffset: this.game.clockOffset,
            readyDeadline: this.game.preparing ? this.game.readyDeadline : null,
            waitingFor: this.game.preparing ? [...this.game.requiredReady].filter(id => !this.game.ready.has(id)) : [],
          } : {}),
        }));
        // Failed/skipped sends must not consume events; a new socket gets
        // the full retained history for its quiet reconnect baseline.
        if (eventCursor) this.kartEventCursors.set(p.socket, eventCursor);
      } catch { /* best effort: disconnect/prune handles the dead seat */ }
    }
  }

  // Deadlines and physics use this instance's clock. Preparation freezes it;
  // the independent server clock used for calibration continues normally.
  _gameNow(game = this.game) {
    return game ? (game.pausedAt ?? Date.now()) - game.clockOffset : Date.now();
  }

  _actionToken() {
    const game = this.game;
    if (!game) return null;
    const window = actionWindow(game.state);
    return game.waitForReady ? `${game.windowSeq}|${window}` : window;
  }

  _syncWindow() {
    const game = this.game;
    if (!game?.state || !game.waitForReady) return;
    const window = actionWindow(game.state);
    if (window === game.window) return;
    game.window = window;
    game.windowSeq += 1;
    clearTimeout(game.prepareTimer);
    if (game.state.phase === 'done') {
      this._resumeGameClock();
      return;
    }
    if (game.pausedAt === null) game.pausedAt = Date.now();
    game.preparing = true;
    game.requiredReady = new Set(this.activeRosterPlayers().filter(p => p.connected && !this.hasLeft(p.id)).map(p => p.id));
    game.ready = new Set();
    for (const timer of this.timers) {
      clearTimeout(timer.handle);
      timer.handle = null;
    }
    game.readyDeadline = Date.now() + this.prepareTimeoutMs;
    game.prepareTimer = setTimeout(() => {
      if (this.game !== game || !game.preparing) return;
      this._abortPreparation('The round could not load for everyone in time. Try starting it again.');
    }, this.prepareTimeoutMs);
    game.prepareTimer.unref?.();
  }

  onReady(ws, meta) {
    const game = this.game, player = this.bySocket(ws);
    if (!game?.preparing || !player?.connected || !game.requiredReady.has(player.id) ||
        meta?.i !== game.instanceId || meta?.w !== this._actionToken()) return;
    game.ready.add(player.id);
    this._checkReady();
  }

  _checkReady() {
    const game = this.game;
    if (!game?.preparing) return;
    const connected = this.activeRosterPlayers().filter(p => p.connected && !this.hasLeft(p.id));
    if (connected.length < manifestPlayers(game.def).min) {
      this._abortPreparation('Too few players are connected to prepare this round. Rejoin and start again.');
      return;
    }
    if ([...game.requiredReady].some(id => !game.ready.has(id))) return;
    this._resumeGameClock();
    this.broadcastState();
  }

  _resumeGameClock() {
    const game = this.game;
    if (!game) return;
    clearTimeout(game.prepareTimer);
    game.prepareTimer = null;
    if (game.pausedAt !== null) game.clockOffset += Date.now() - game.pausedAt;
    game.pausedAt = null;
    game.preparing = false;
    game.nextTickAt = Date.now() + (game.def.tickInterval ? game.def.tickInterval(game.state) : 100);
    for (const timer of this.timers) this._scheduleTimer(timer);
  }

  _abortPreparation(message) {
    for (const p of this.connectedPlayers()) this.send(p.socket, { t: 'error', msg: message });
    this.ensureHost();
    this.endGameToLobby(this.hostId);
  }

  _scheduleTimer(timer) {
    if (timer.cancelled || !timer.captured || timer.handle || this.game !== timer.game ||
        this.game.generation !== timer.generation) return;
    if (actionWindow(this.game.state) !== timer.window || this.game.windowSeq !== timer.windowSeq) {
      this.timers.delete(timer);
      return;
    }
    if (this.game.preparing) return;
    timer.handle = setTimeout(() => {
      timer.handle = null;
      if (this.game !== timer.game || this.game.generation !== timer.generation) return;
      if (this.game.preparing) return;
      if (actionWindow(this.game.state) !== timer.window || this.game.windowSeq !== timer.windowSeq) {
        this.timers.delete(timer);
        return;
      }
      // A wall-clock adjustment or early callback must not shorten a phase.
      if (this.game.waitForReady && this._gameNow() < timer.deadline) return this._scheduleTimer(timer);
      this.timers.delete(timer);
      try { timer.fn(); }
      catch (e) { console.error('game timer error', e); }
    }, Math.max(0, timer.deadline - this._gameNow()));
  }

  /* Room pack override wins over the boot locale pack; {} when neither. */
  resolveContent(gameId) {
    const base = this.content[gameId] || {};
    const over = this.config[gameId] && this.config[gameId].pack;
    if (!over || !Object.keys(over).length) return base;
    return { ...base, ...over };
  }

  ctx() {
    const room = this;
    const game = room.game;
    const generation = game?.generation;
    const active = () => room.game === game && game && !game.disposed && game.generation === generation;
    const instanceId = game ? game.instanceId : null;
    return {
      get instanceId() { return instanceId; },
      // During a game: the ACTIVE ROSTER and its connected subset.
      // Spectators (mid-game joiners, plus seat-cap watchers) are in
      // neither. With no game running, both fall back to the room seats
      // (lobby callers).
      players: () => (game && !active() ? [] : room.game
        ? room.activeRosterPlayers().filter((p) => p.connected && !room.hasLeft(p.id))
        : room.connectedPlayers()),
      allPlayers: () => (game && !active() ? [] : room.game ? room.activeRosterPlayers() : room.players.slice()),
      content: (gameId) => room.resolveContent(gameId),
      /* Only host-set values; {} when unconfigured so games keep their
       * legacy defaults (including dynamic ones like rounds-by-count). */
      settings: () => {
        const gid = active() ? game.def.id : null;
        if (!gid || !room.config[gid]) return {};
        return { ...room.config[gid].settings };
      },
      hostId: () => {
        room.ensureHost();
        return room.hostId;
      },
      broadcast: (opts) => { if (active()) room.broadcastState(opts); },
      lobby: () => { if (active()) room.broadcastLobby(); },
      later(ms, fn) {
        if (!active() || !Number.isFinite(ms) || ms < 0 || typeof fn !== 'function') return () => {};
        /* Window capture is async: later() runs during create() while
         * room.game.state is still null, so the scheduling window is read
         * on a microtask after the creating action completes. Microtasks
         * run before timeout callbacks, and games schedule at
         * the end of transitions, so the captured window is exact. */
        const timer = { game, generation, deadline: room._gameNow(game) + ms, fn, handle: null,
          captured: false, cancelled: false, window: null, windowSeq: 0 };
        room.timers.add(timer);
        const capture = () => {
          if (!active() || timer.cancelled) return;
          room._syncWindow();
          timer.window = actionWindow(game.state);
          timer.windowSeq = game.windowSeq;
          timer.captured = true;
          room._scheduleTimer(timer);
        };
        if (typeof queueMicrotask === 'function') queueMicrotask(capture);
        else Promise.resolve().then(capture);
        return () => {
          timer.cancelled = true;
          clearTimeout(timer.handle);
          room.timers.delete(timer);
        };
      },
      award(pid, points) {
        if (!active() || !game.roster.includes(pid) || !Number.isFinite(points)) return;
        room.totals[pid] = (room.totals[pid] || 0) + points;
        game.awarded = game.awarded || {};
        game.awarded[pid] = (game.awarded[pid] || 0) + points;
      },
      /* True once the host (or the room, when too few players remain)
       * ended this match. Games normally see it through onEnd. */
      ended: () => !!(active() && game.ended),
      now: () => room._gameNow(game),
      session: () => active() ? room.sessionForCurrentGame() : {},
    };
  }

  /* Host-only configuration. Validated all-or-nothing: any error leaves
   * the stored config untouched. Retained per game for rematch. */
  configure(gameId, def, settings, pack) {
    const sv = validateSettings(def, settings);
    if (!sv.ok) return { error: sv.error };
    // A pack value of null reverts that key to the built-in list.
    let packInput = pack;
    let clearKeys = [];
    if (pack && typeof pack === 'object' && !Array.isArray(pack)) {
      packInput = {};
      const schema = (def.manifest && def.manifest.packs) || {};
      for (const k of Object.keys(pack)) {
        if (pack[k] === null) {
          // Own-property check: "constructor"/"__proto__" are not packs.
          if (!Object.prototype.hasOwnProperty.call(schema, k)) return { error: `Unknown pack "${k}".` };
          clearKeys.push(k);
        } else packInput[k] = pack[k];
      }
      if (!Object.keys(packInput).length && !clearKeys.length) packInput = {};
    }
    const pv = validatePack(def, packInput);
    if (!pv.ok) return { error: pv.error };
    const prev = this.config[gameId] || { settings: {}, pack: {} };
    const next = { settings: { ...prev.settings }, pack: { ...prev.pack } };
    if (settings !== undefined) next.settings = sv.settings;
    if (pack !== undefined) {
      Object.assign(next.pack, pv.pack);
      for (const k of clearKeys) delete next.pack[k];
      // An explicitly empty pack object clears nothing by itself; full
      // resets go through resetConfig. (Empty arrays fail minItems.)
    }
    this.config[gameId] = next;
    return { ok: true };
  }

  resetConfig(gameId) {
    delete this.config[gameId];
    return { ok: true };
  }

  startGame(def, opts, requesterId) {
    if (!this.canControl(requesterId)) return { error: 'Only the host can start games.' };
    const previousConfig = this.config[def.id];
    if (opts && (opts.settings !== undefined || opts.pack !== undefined)) {
      const r = this.configure(def.id, def, opts.settings, opts.pack);
      if (r.error) return r;
    }
    const { min, max } = manifestPlayers(def);
    const connected = this.connectedPlayers();
    if (connected.length < min || connected.length > max) {
      return { error: `Need ${min}–${max} players to start (have ${connected.length}).` };
    }
    // Optional synchronous validation runs before retiring the active instance.
    if (def.preflight) {
      let result;
      try { result = def.preflight(this.config[def.id]?.settings || {}, connected); }
      catch (e) { console.error('game preflight error', e); result = { error: 'Could not start that game. Try again.' }; }
      if (result && result.error) {
        if (previousConfig) this.config[def.id] = previousConfig;
        else delete this.config[def.id];
        return result;
      }
    }
    this._disposeGame();
    this.clearTimers();
    this._purgeGoneSeats();
    // Snapshot the roster BEFORE create(): only seats connected right now
    // play; earlier disconnects stay out (no ghost turns) and later joins
    // spectate. Every start mints a fresh instanceId so all clients reset.
    this._instanceSeq += 1;
    this.game = {
      def,
      state: null,
      generation: (this.game ? this.game.generation : 0) + 1,
      roster: this.connectedPlayers().map((p) => p.id),
      instanceId: `${Date.now().toString(36)}-${this._instanceSeq}`,
      waitForReady: opts?.ready === true,
      preparing: opts?.ready === true,
      pausedAt: opts?.ready === true ? Date.now() : null,
      clockOffset: 0,
      window: null,
      windowSeq: 0,
      left: new Set(),   // pids that pressed Leave during this match
      gone: new Set(),   // pids whose onPlayerGone already ran
      awarded: {},       // pid -> points ctx.award() gave in this match
      ended: false,      // End game pressed (or too few players remained)
    };
    // A throwing create() must not wedge the room with game.state null
    // (every later broadcast/action would fail against the null state):
    // restore the lobby and report an error instead.
    try {
      this.game.state = def.create(this.ctx());
    } catch (e) {
      console.error('game create error', e);
      this.clearTimers();
      this.game = null;
      this._phaseStart = { key: null, at: 0 };
      this.broadcastLobby();
      return { error: 'Could not start that game. Try again.' };
    }
    this.game.nextTickAt = Date.now() + (def.tickInterval ? def.tickInterval(this.game.state) : 100);
    this._phaseStart = { key: null, at: 0 }; // fresh instance, fresh phase clock
    this.broadcastLobby();
    this.broadcastState();
    return { ok: true };
  }

  endGameToLobby(requesterId) {
    if (!this.canControl(requesterId)) return { error: 'Only the host can change games.' };
    this._disposeGame();
    this.clearTimers();
    this.game = null;
    this._phaseStart = { key: null, at: 0 };
    this._purgeGoneSeats();
    this.broadcastLobby();
    return { ok: true };
  }

  /* "End game": the match stops where it is. Pending game timers are
   * cancelled, points already awarded stay, and the game's optional
   * def.onEnd(state, ctx, { reason }) may award whole-match points and
   * move to its 'done' phase (its own final screen). Without the hook the
   * instance freezes (no ticks, no actions) and snapshots carry
   * matchEnded + matchPoints so the shell shows a generic Final scores
   * screen. Either way the host then chooses Rematch or Change game.
   * opts.system: the room itself ends the match (too few players left). */
  endGame(requesterId, opts = {}) {
    if (!opts.system && !this.canControl(requesterId)) return { error: 'Only the host can end the game.' };
    const game = this.game;
    if (!game || !game.state) return { error: 'No game is running.' };
    if (game.ended || game.state.phase === 'done') return { ok: true, already: true };
    for (const t of this.timers) { t.cancelled = true; clearTimeout(t.handle); }
    this.timers.clear();
    if (game.preparing) this._resumeGameClock();
    this._clearAllAway();
    game.ended = true;
    if (typeof game.def.onEnd === 'function') {
      try { game.def.onEnd(game.state, this.ctx(), { reason: opts.system ? 'players' : 'host' }); }
      catch (e) { console.error('game end error', e); }
    }
    if (this.game !== game) return { ok: true };
    this.broadcastLobby();
    this.broadcastState();
    return { ok: true };
  }

  /* True while an ended match without a 'done' phase is frozen. */
  _frozen() {
    return !!(this.game?.ended && this.game.state && this.game.state.phase !== 'done');
  }

  /* "Leave" (anyone). In the running match the seat stops playing at
   * once: the game's optional def.onPlayerGone(state, ctx, pid, 'left')
   * runs (fallback: onConnection(state, ctx, pid, false)). Standalone
   * rooms also give up the seat itself (no resume). Giggle rooms keep the
   * seat in the room, so the frame goes back to the call's game picker
   * and joins the next game (opts.stay asks for that in any room). A
   * host who leaves the match hands hosting to a player still playing. */
  leave(ws, opts = {}) {
    const p = this.bySocket(ws);
    if (!p || !p.connected) return { error: 'You are not in this room.' };
    const game = this.game;
    const inMatch = !!game?.state && this.activeRosterIds().includes(p.id) && !this.hasLeft(p.id);
    // opts.stay: keep the room seat (Giggle look of the test table).
    const removeSeat = !this.giggle && opts.stay !== true;
    if (inMatch) {
      game.left = game.left || new Set();
      game.left.add(p.id);
      this._clearAway(p.id);
      if (game.preparing) {
        game.requiredReady.delete(p.id);
        game.ready.delete(p.id);
      }
      if (this.hostId === p.id) {
        const next = this.activeRosterPlayers().find((q) => q.connected && q.id !== p.id && !this.hasLeft(q.id));
        if (next) this.hostId = next.id;
      }
    }
    if (removeSeat) {
      p.connected = false;
      p.socket = null;
      p.token = '';
      p.gone = true;
      if (!inMatch && !(game && game.roster.includes(p.id))) this.players = this.players.filter((q) => q !== p);
    }
    if (inMatch) this._playerGone(p.id, 'left');
    if (this.game === game && game?.preparing) this._checkReady();
    this.ensureHost();
    this.broadcastLobby();
    if (this.game) this.broadcastState();
    return { ok: true, removed: removeSeat };
  }

  /* Runs the game's onPlayerGone hook once per seat per match, then ends
   * the match when nobody is left to play against. */
  _playerGone(pid, reason) {
    const game = this.game;
    if (!game || !game.state) return;
    game.gone = game.gone || new Set();
    if (game.gone.has(pid) || !this.activeRosterIds().includes(pid)) return;
    if (game.ended || game.state.phase === 'done') return;
    game.gone.add(pid);
    this._clearAway(pid);
    const def = game.def;
    try {
      if (typeof def.onPlayerGone === 'function') def.onPlayerGone(game.state, this.ctx(), pid, reason);
      else if (reason === 'left' && typeof def.onConnection === 'function') {
        // Existing games already handle a dropped seat; a seat that is still
        // connected (Giggle) never sent that signal, so send it now.
        const p = this.players.find((q) => q.id === pid);
        if (p && p.connected) def.onConnection(game.state, this.ctx(), pid, false);
      }
    } catch (e) { console.error('game player-gone error', e); }
    if (this.game !== game || game.ended || game.state.phase === 'done') return;
    const remaining = this.activeRosterPlayers().filter((q) => q.connected && !this.hasLeft(q.id)).length;
    if (remaining < Math.min(manifestPlayers(def).min, 2)) this.endGame(null, { system: true });
  }

  _armAway(pid) {
    const game = this.game;
    if (!game?.state || this._awayTimers.has(pid) || game.gone?.has(pid) || game.ended ||
        game.state.phase === 'done' || !this.activeRosterIds().includes(pid)) return;
    const handle = setTimeout(() => {
      this._awayTimers.delete(pid);
      if (this.game !== game) return;
      const p = this.players.find((q) => q.id === pid);
      if (p && p.connected) return;
      this._playerGone(pid, 'away');
      if (this.game === game) {
        this.broadcastLobby();
        this.broadcastState();
      }
    }, this.awayTimeoutMs);
    handle.unref?.();
    this._awayTimers.set(pid, handle);
  }

  _clearAway(pid) {
    const handle = this._awayTimers.get(pid);
    if (handle) clearTimeout(handle);
    this._awayTimers.delete(pid);
  }

  _clearAllAway() {
    for (const handle of this._awayTimers.values()) clearTimeout(handle);
    this._awayTimers.clear();
  }

  /* Seats that pressed Leave stay only while a match needs their name. */
  _purgeGoneSeats() {
    const keep = new Set(this.game ? this.game.roster : []);
    this.players = this.players.filter((p) => !p.gone || keep.has(p.id));
  }

  kickPlayer(ws, pid, meta) {
    this.ensureHost();
    const requester = this.bySocket(ws);
    if (!requester?.connected || requester.id !== this.hostId) return { error: 'Only the host can remove players.' };
    if (typeof pid !== 'string' || !/^p[0-9a-f]{8}$/.test(pid)) return { error: 'Choose a player to remove.' };
    if (meta?.i !== (this.game?.instanceId || null)) return { error: 'The match changed. Choose the player again.' };
    if (pid === requester.id) return { error: 'Use Leave to leave your own seat.' };
    const player = this.players.find(p => p.id === pid);
    if (!player) return { error: 'That player is no longer in this room.' };
    const socket = player.socket;
    const active = this.activeRosterIds().includes(pid);
    const continueKarts = active && this.game?.def.id === 'pocket-karts' &&
      this.activeRosterPlayers().filter(p => p.connected && p.id !== pid).length >= 2;
    this.removedTokens.add(player.token);
    if (player.giggleSub) this.removedSubs.add(player.giggleSub);
    player.connected = false;
    player.socket = null;
    this._notifyConnection(pid, false);
    this.players = this.players.filter(p => p.id !== pid);
    const ended = active && !continueKarts;
    if (ended) this.endGameToLobby(requester.id);
    else {
      if (this.game?.preparing) {
        this.game.requiredReady.delete(pid);
        this.game.ready.delete(pid);
        this._checkReady();
      }
      this.broadcastLobby();
      if (this.game) this.broadcastState();
    }
    try { if (socket?.readyState === 1) socket.close(SEAT_REMOVED_CODE, SEAT_REMOVED_REASON); } catch { /* already closed */ }
    return { ok: true, pid, ended, socket };
  }

  _disposeGame() {
    this._clearAllAway();
    if (this.game && this.game.def.dispose) {
      if (this.game.disposed) return;
      this.game.disposed = true;
      try {
        this.game.def.dispose(this.game.state);
      } catch (e) {
        console.error('game dispose error', e);
      }
    }
  }

  onAction(ws, a, meta) {
    const p = this.bySocket(ws);
    if (!p || !this.game || this.game.preparing) return;
    if (!this.activeRosterIds().includes(p.id) || this.hasLeft(p.id)) return; // spectators watch only
    if (this._frozen()) return; // ended without a done phase: final scores only
    if (this.game.def.requiresActionTokens && this.game.def.requiresActionTokens(this.game.state) &&
        (!meta || meta.i !== this.game.instanceId || meta.w !== this._actionToken())) return;
    if (this.game.waitForReady && (meta?.i !== this.game.instanceId || meta?.w !== this._actionToken())) return;
    /* Stale instance/window drops: a delayed action from a dead rematch or
     * a previous round/turn is ignored silently (no broadcast, no record).
     * Missing tokens are accepted for older/embed clients. */
    if (meta && meta.i !== undefined && meta.i !== null &&
        meta.i !== this.game.instanceId) return;
    if (meta && meta.w !== undefined && meta.w !== null &&
        meta.w !== this._actionToken()) return;
    /* Input-only intents (karts steering) return exactly false to skip the
     * immediate broadcast — the 10 Hz onTick broadcast carries them. Any
     * other return (including undefined) keeps the legacy broadcast. */
    const r = this.game.def.onAction(this.game.state, this.ctx(), p.id, a || {});
    if (r !== false) this.broadcastState();
  }

  onTick(pumpNow) {
    if (!this.game || !this.game.state || this.game.preparing || !this.game.def.onTick || this._frozen()) return;
    // Explicit server pump time gates each instance independently. Direct
    // onTick() calls retain the existing test/SDK stepping contract.
    if (Number.isFinite(pumpNow)) {
      if (pumpNow < this.game.nextTickAt) return;
      const interval = this.game.def.tickInterval ? this.game.def.tickInterval(this.game.state) : 100;
      // Keep the instance's cadence after a late pump; skip missed slots
      // without drifting deadlines or issuing catch-up simulation calls.
      this.game.nextTickAt = pumpNow + interval - (pumpNow - this.game.nextTickAt) % interval;
    }
    // A throwing realtime callback would otherwise crash
    // the process, so contain it and let the next tick retry.
    try {
      this.game.def.onTick(this.game.state, this.ctx());
    } catch (e) {
      console.error('game tick error', e);
    }
  }

  /* Only the seat still attached to THIS socket is marked away, so a
   * stale close can never clobber a replacement socket. Host migrates
   * among the connected so the party keeps going. */
  disconnect(ws) {
    const p = this.bySocket(ws);
    if (p && p.socket === ws) {
      p.connected = false;
      p.socket = null;
      this._notifyConnection(p.id, false);
      if (this.game?.preparing) {
        this.game.requiredReady.delete(p.id);
        this._checkReady();
      }
      this.ensureHost();
      this.broadcastLobby();
      if (this.game) this.broadcastState();
    }
  }

  clearTimers() {
    for (const t of this.timers) { t.cancelled = true; clearTimeout(t.handle); }
    this.timers.clear();
    if (this.game) { clearTimeout(this.game.prepareTimer); this.game.generation += 1; }
  }

  destroy() {
    this._cancelPrune();
    this._disposeGame();
    this.clearTimers();
  }
}

class Rooms {
  constructor(content, opts = {}) {
    this.content = content;
    this.rooms = new Map();
    // Verified Giggle squadId -> private Room. Anonymous joins can never
    // reach these rooms (rejected by code lookup in the server).
    this.giggleRooms = new Map();
    this.roomOpts = opts.roomOpts || {};
  }

  create() {
    let code = makeCode();
    while (this.rooms.has(code)) code = makeCode();
    const room = new Room(code, this.content, this.roomOpts);
    this.rooms.set(code, room);
    return room;
  }

  /* Private room for one Giggle squad. The mapping is squadId -> room (never
   * by display name); every squad member with a valid ticket lands here. */
  getOrCreateGiggle(squadId) {
    const key = String(squadId || '');
    const existing = this.giggleRooms.get(key);
    if (existing && this.rooms.has(existing.code)) return existing;
    let code = makeCode();
    while (this.rooms.has(code)) code = makeCode();
    const room = new Room(code, this.content, { ...this.roomOpts, giggle: { squadId: key } });
    this.rooms.set(code, room);
    this.giggleRooms.set(key, room);
    return room;
  }

  get(code) {
    return this.rooms.get(String(code || '').toUpperCase());
  }

  /* Empty rooms linger briefly so a solo creator can refresh and resume
   * with their seat token; rejoin cancels the timer (see addPlayer). */
  prune(room) {
    if (!room.players.every((p) => !p.connected)) return;
    if (room._pruneTimer) return;
    room._pruneTimer = setTimeout(() => {
      room._pruneTimer = null;
      if (room.players.every((p) => !p.connected)) {
        room.destroy();
        this.rooms.delete(room.code);
        if (room.giggle) this.giggleRooms.delete(room.giggle.squadId);
      }
    }, LIMITS.ROOM_GRACE_MS);
    if (room._pruneTimer.unref) room._pruneTimer.unref();
  }
}

module.exports = { Rooms, Room, SEAT_REPLACED_CODE, SEAT_REPLACED_REASON, SEAT_REMOVED_CODE, SEAT_REMOVED_REASON, SLOW_SOCKET_BYTES, PREPARE_TIMEOUT_MS, AWAY_TIMEOUT_MS, validJoinName };

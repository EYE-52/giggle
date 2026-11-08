'use strict';
/* One controller, ordinary authoritative game definitions and Room settings /
 * scores. This Room is deliberately NEVER registered in Rooms: there is no
 * join code and no remote seat to claim. Only the selected projection leaves
 * the server, and no projection at all leaves during a hand-off. */
const { randomUUID } = require('node:crypto');
const { Room } = require('./room');
const registry = require('../games/registry');
const { actionWindow } = require('../games/_sdk');
const { sameRoomSupport, LOCAL_AVATARS } = require('../public/js/same-room-support.mjs');

const BOARDS = new Set(['chess', 'checkers', 'four-in-a-row', 'reversi', 'ludo', 'kalah']);
const RESULTS = new Set(['reveal', 'standings', 'done']);

function validateStart(msg) {
  const meta = registry.meta(msg.game), support = sameRoomSupport(meta);
  if (!support) return { error: 'This game needs separate devices. Pick a one-device game.' };
  if (!Array.isArray(msg.names) || msg.names.length < support.min || msg.names.length > support.max) {
    return { error: `Add ${support.min}–${support.max} names for this game.` };
  }
  if (msg.names.some(n => typeof n !== 'string' || !n.trim() || n.trim().length > 16 || /[\p{C}]/u.test(n))) {
    return { error: 'Use a name from 1 to 16 letters for each person.' };
  }
  const names = msg.names.map(n => n.trim());
  if (new Set(names.map(n => n.toLocaleLowerCase())).size !== names.length) {
    return { error: 'Use a different name for each person.' };
  }
  return { meta, support, names };
}

class SameRoom extends Room {
  constructor(content, msg) {
    const start = validateStart(msg);
    if (start.error) throw new Error(start.error);
    super('local', content);
    this.token = randomUUID();
    this.meta = start.meta;
    this.logicalNow = Date.now();
    this.jobs = new Set();
    this.seen = new Set();
    this.skipped = new Set();
    this.controller = null;
    this.gate = null;
    this.unlocked = null;
    this.viewReady = false;
    this.step = 0;
    this.selection = null;
    this.dirty = false;
    this.players = start.names.map((name, i) => ({ id: `local-${i + 1}`, name,
      avatar: LOCAL_AVATARS[i], colour: i % 6, connected: true, socket: { readyState: 1, send() {} } }));
    this.hostId = this.players[0].id;
    const def = registry.get(msg.game);
    // The same rules support two people; the online minimum is unchanged.
    this.localDef = { ...def, manifest: { ...def.manifest, players: { min: 2, max: start.support.max } } };
    const result = this.startGame(this.localDef, { settings: msg.settings }, this.hostId);
    if (result.error) { this.destroy(); throw new Error(result.error); }
    this.settle();
  }

  _gameNow() { return this.logicalNow; }
  broadcastLobby() {}
  broadcastState() { this.dirty = true; }
  ctx() {
    const base = super.ctx(), game = this.game;
    return { ...base, sameRoom: true, broadcast: () => { this.dirty = true; },
      later: (ms, fn) => {
        if (!Number.isFinite(ms) || ms < 0 || typeof fn !== 'function') return () => {};
        const job = { at: this.logicalNow + ms, fn, game, window: null };
        this.jobs.add(job);
        return () => this.jobs.delete(job);
      } };
  }

  window() { return `${this.game.instanceId}:${actionWindow(this.game.state)}`; }
  peekKey() { return `${this.game.instanceId}:${this.game.state.round}`; }
  currentGate(plan = this.plan()) { return this.gate || (plan.private && this.unlocked !== plan.key ? 'pass' : 'play'); }
  plan() {
    const s = this.game.state, id = this.meta.id, window = this.window();
    const make = (pid = this.hostId, privateStep = false, kind = 'play', serial = false) =>
      ({ pid, private: privateStep, kind, serial, key: `${window}:${pid}:${kind}` });
    if (RESULTS.has(s.phase)) return make();
    const pending = (record, omit = []) => this.players.find(p => !omit.includes(p.id) &&
      record?.[p.id] === undefined && !this.skipped.has(`${window}:${p.id}`))?.id || null;
    if (BOARDS.has(id)) {
      const pid = s.drawOffer ? this.players.find(p => p.id !== s.drawOffer)?.id
        : id === 'chess' ? (s.chess.turn() === 'w' ? s.white : s.black)
          : s.seats[s.turn - (['four-in-a-row', 'reversi'].includes(id) ? 1 : 0)];
      return make(pid);
    }
    if (id === 'truth-dare') {
      // The original game decides who may write, pick and judge. One device
      // visits those peers in order; the target never gets a private ballot.
      if (s.phase === 'compose') return make(pending(s.entries, [s.target]), true, 'write', true);
      if (s.phase === 'prompt-vote') return make(pending(s.promptVotes, [s.target]), true, 'prompt-vote', true);
      if (s.phase === 'vote') return make(pending(s.votes, [s.target]), true, 'vote', true);
      return make(s.target || this.hostId);
    }
    if (id === 'two-truths' && s.phase === 'write') return make(s.subject, true, 'write');
    if (id === 'hot-takes' && s.phase === 'submit') {
      return make(pending(Object.fromEntries(s.takes.filter(t => t.author).map(t => [t.author, true]))), true, 'write', true);
    }
    if (id === 'rank-it') return make(pending(s.ranks), true, 'rank', true);
    if (id === 'trivia') return make(pending(s.answers), true, 'answer', true);
    if (id === 'charades' && s.phase === 'act') {
      if (!this.seen.has(this.peekKey())) return make(s.actor, true, 'peek');
      const eligible = this.players.filter(p => p.id !== s.actor && !s.guessed[p.id]);
      return make(eligible.find(p => p.id === this.selection)?.id || eligible[0]?.id, false, 'guess');
    }
    if (id === 'doodle-guess') return s.phase === 'pick' ? make(s.drawer, true, 'pick') : make(s.drawer, false, 'draw');
    if (id === 'five-second' && s.phase === 'answer') return make(s.performer);
    if (id === 'dare-roulette' && s.phase !== 'verdict') return make(s.victim || this.hostId);
    if (id === 'story-builder' && s.phase === 'build') return make(s.turn);
    if (id === 'rapid-polls' && s.phase === 'pose') return make();
    let omit = [];
    if (id === 'two-truths') omit = [s.subject];
    if (id === 'five-second') omit = [s.performer];
    if (id === 'dare-roulette') omit = [s.victim];
    if (id === 'hot-takes') omit = [s.takes.find(t => t.tid === s.order[s.index])?.author];
    return make(pending(s.votes, omit), true, 'vote', true);
  }

  settle() {
    const window = this.window();
    for (const job of this.jobs) {
      if (job.window === null) job.window = window;
      if (job.game !== this.game || job.window !== window) this.jobs.delete(job);
    }
    if (this.phaseWindow !== window) {
      this.phaseWindow = window;
      this.phaseStart = this.logicalNow;
      this.selection = null;
      this.skipped.clear();
    }
    const plan = this.plan();
    if (plan.serial && !plan.pid && this.game.state.endsAt > 0) {
      // Everyone either answered or used their whole window. Let the real
      // game deadline settle missing answers, rather than inventing votes.
      this.logicalNow = this.game.state.endsAt;
      for (const job of [...this.jobs]) {
        if (job.at <= this.logicalNow && job.window === window) { this.jobs.delete(job); job.fn(); }
      }
      if (window !== this.window()) return this.settle();
    }
    if (this.planKey !== plan.key) {
      // Each private voter/answerer gets the same full time. Keep their
      // real answer timestamp for the game's own speed-scoring formula.
      if (plan.serial) this.logicalNow = this.phaseStart;
      this.planKey = plan.key;
      this.unlocked = null;
      this.viewReady = false;
      this.step += 1;
    }
    this.dirty = false;
  }

  snapshot() {
    const plan = this.plan();
    const gate = this.currentGate(plan);
    const players = this.players.map(({ id, name, avatar, colour }) => ({ id, name, avatar, colour, connected: true }));
    const out = { t: 'same-state', game: this.meta.id, step: this.step, gate,
      player: plan.pid, private: plan.private, kind: plan.kind, players,
      gameNow: this.logicalNow, running: !!(this.controller && this.viewReady && gate === 'play' && plan.kind !== 'peek') };
    if (gate !== 'play') return out;
    const pid = plan.pid || this.hostId;
    const view = this.game.def.view(this.game.state, pid, this.ctx());
    const s = { ...view, game: this.meta.id, players, participants: players, spectators: [],
      me: pid, you: pid, spectator: false, totals: { ...this.totals }, instanceId: this.game.instanceId,
      w: this._actionToken(), phaseStartedAt: this.phaseStart, sameRoom: true };
    delete s.camera; // In-person performance never asks for media access.
    if (this.meta.id === 'doodle-guess' && s.phase === 'draw') {
      delete s.word; delete s.wordShown; delete s.choices;
    }
    out.state = s;
    return out;
  }

  emit() {
    if (this.controller?.readyState === 1) this.controller.send(JSON.stringify(this.snapshot()));
  }
  attach(ws) {
    if (this.controller?.readyState === 1 && this.controller !== ws) throw new Error('This game is open in another window.');
    this.controller = ws;
    this.unlocked = null;
    this.viewReady = false;
    this.step += 1;
    this.emit();
  }
  detach(ws) {
    if (this.controller !== ws) return;
    this.controller = null;
    this.unlocked = null;
    this.viewReady = false;
  }
  receive(msg) {
    if (msg.step !== this.step) return; // rejects double taps and retired controls
    const plan = this.plan(), gate = this.currentGate(plan);
    if (msg.op === 'unlock' && gate === 'pass') { this.unlocked = plan.key; this.step += 1; }
    else if (msg.op === 'back' && gate === 'return') { this.gate = null; this.step += 1; }
    else if (msg.op === 'ready' && gate === 'play') { this.viewReady = true; }
    else if (msg.op === 'cover' && gate === 'play' && plan.private) {
      this.unlocked = null; this.viewReady = false; this.step += 1;
    } else if (msg.op === 'hide' && gate === 'play' && plan.kind === 'peek') {
      this.seen.add(this.peekKey()); this.gate = 'return'; this.settle();
    } else if (msg.op === 'seat' && gate === 'play' && plan.kind === 'guess') {
      if (!this.players.some(p => p.id === msg.pid && p.id !== this.game.state.actor && !this.game.state.guessed[p.id])) return;
      this.selection = msg.pid; this.settle();
    } else if (msg.op === 'action' && gate === 'play' && this.viewReady && msg.a && typeof msg.a === 'object' && !Array.isArray(msg.a)) {
      const before = this.planKey;
      const wasPrivate = plan.private;
      this.game.def.onAction(this.game.state, this.ctx(), plan.pid || this.hostId, msg.a);
      if (this.meta.id === 'doodle-guess' && this.game.state.phase === 'draw') this.seen.add(this.peekKey());
      this.settle();
      if (wasPrivate && before !== this.planKey) { this.gate = 'return'; this.step += 1; }
    } else if (msg.op === 'guess' && gate === 'play' && this.viewReady && this.meta.id === 'doodle-guess' && this.game.state.phase === 'draw') {
      const s = this.game.state;
      if (!this.players.some(p => p.id === msg.pid && p.id !== s.drawer && !s.guessed[p.id]) || typeof msg.text !== 'string') return;
      this.game.def.onAction(s, this.ctx(), msg.pid, { guess: msg.text });
      this.settle();
    } else if (msg.op === 'rematch' && gate === 'play' && this.game.state.phase === 'done') {
      this.jobs.clear(); this.seen.clear(); this.gate = null;
      this.startGame(this.localDef, {}, this.hostId); this.settle();
    } else return;
    this.emit();
  }

  pump(elapsed) {
    if (!this.controller || !this.viewReady || this.currentGate() !== 'play' || this.game.state.phase === 'done' || this.plan().kind === 'peek') return;
    this.logicalNow += Math.max(0, Math.min(elapsed, 1000));
    const plan = this.plan(), s = this.game.state;
    if (plan.serial && s.endsAt > 0 && this.logicalNow >= s.endsAt) {
      this.skipped.add(`${this.window()}:${plan.pid}`);
      const next = this.plan();
      if (next.pid) {
        this.gate = 'return'; this.settle(); this.emit(); return;
      }
    }
    const now = this.logicalNow;
    for (const job of [...this.jobs]) {
      if (job.at > now || job.window !== this.window()) continue;
      this.jobs.delete(job); job.fn(); this.dirty = true;
    }
    this.game.def.onTick?.(this.game.state, this.ctx());
    if (this.dirty || this.phaseWindow !== this.window()) { this.settle(); this.emit(); }
  }
  destroy() { this.jobs?.clear(); super.destroy(); }
}

/* Capability-based resume is tab-local. Disconnected games pause and expire;
 * a closed page cannot leave timers or twenty public sockets running. */
function createSameRoomHub(content) {
  const sessions = new Map(), sockets = new WeakMap();
  let last = Date.now();
  const sendError = (ws, msg) => ws.send(JSON.stringify({ t: 'same-error', msg }));
  const timer = setInterval(() => {
    const now = Date.now(), elapsed = now - last; last = now;
    for (const [token, session] of sessions) {
      if (!session.controller && now - session.awayAt > 120000) { session.destroy(); sessions.delete(token); }
      else {
        try { session.pump(elapsed); }
        catch (error) { console.error('one-device game failed', error); session.destroy(); sessions.delete(token); if (session.controller) sendError(session.controller, 'This game stopped. Return to setup and start again.'); }
      }
    }
  }, 100);
  timer.unref();
  return {
    handle(ws, msg) {
      if (typeof msg?.t !== 'string' || !msg.t.startsWith('same-')) return false;
      try {
        if (msg.t === 'same-start') {
          if (sockets.has(ws)) throw new Error('End this game before starting another.');
          if (sessions.size >= 500) throw new Error('The games are busy. Try again shortly.');
          const session = new SameRoom(content, msg);
          sessions.set(session.token, session); sockets.set(ws, session);
          ws.send(JSON.stringify({ t: 'same-created', token: session.token }));
          session.attach(ws);
        } else if (msg.t === 'same-resume') {
          const session = typeof msg.token === 'string' && sessions.get(msg.token);
          if (!session) throw new Error('This game has expired. Start again with your names.');
          if (sockets.has(ws) && sockets.get(ws) !== session) throw new Error('End this game first.');
          session.attach(ws); sockets.set(ws, session);
        } else if (msg.t === 'same-stop') {
          const session = sockets.get(ws);
          if (session) { session.destroy(); sessions.delete(session.token); sockets.delete(ws); }
          ws.send(JSON.stringify({ t: 'same-stopped' }));
        } else if (msg.t === 'same-input') sockets.get(ws)?.receive(msg);
      } catch (error) { sendError(ws, error.message); }
      return true;
    },
    detach(ws) { const s = sockets.get(ws); if (s) { s.detach(ws); s.awayAt = Date.now(); sockets.delete(ws); } },
  };
}
module.exports = { SameRoom, validateStart, createSameRoomHub };

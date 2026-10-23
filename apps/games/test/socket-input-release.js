'use strict';
// Exercise the actual socket callbacks, including a closing old socket
// delivering late events after a replacement has begun connecting.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../public/js/app.js'), 'utf8');
const code = source.slice(source.indexOf('function openSocket() {'), source.indexOf('\nfunction paintConn()', source.indexOf('function openSocket() {')));
const contextCode = source.match(/context: \(\) => \((\{[^\n]+\})\),/)[1];
const admissionCode = source.match(/(const audioBaseline = !ws\?\.hasGameState;[\s\S]*?if \(ws\) ws\.hasGameState = true;)/)[1];
const sockets = [], events = [], received = [], timers = new Map();
let sequence = 0, clears = 0, clocks = 0, renders = 0, soundStops = 0;
const ctx = {
  ws: null, publicConfig: {}, location: { protocol: 'http:', host: '127.0.0.1:8446' },
  runLog:{event(){},snapshot(){},pause(){},finish(){}},
  wsTargetFromConfig: () => null,
  WebSocket: class { constructor(url) { this.url = url; this.readyState = 0; sockets.push(this); } close() { this.readyState = 3; } },
  retryTimer: 0, socketStartTimer: 0, clockTimer: 0, retryMs: 500,
  connLost: false, seatTaken: false, seatRemoved:false, embedAuthed: true, games: [{}], room: { code: 'QA' },
  isHost: () => true, lastState: {}, pendingRoomAction: null, theme: () => 'day', sound: { enabled: true, stop() { soundStops++; } }, gameId: 'pocket-karts',
  EMBED: { enabled: false }, BOOT_ENTRY: null, bootEntryConsumed: false,
  myName: 'QA', roomCode: 'QA', store: { get: () => 'test-token', remove(key) { ctx.localStorage.removeItem(key); } }, tokenKey: value => value,
  SEAT_REPLACED_CODE: 4009,
  setTimeout(fn, ms) { const id = ++sequence; timers.set(id, { fn, ms }); return id; },
  clearTimeout(id) { timers.delete(id); }, setInterval: () => ++sequence, clearInterval() {},
  serverClock: { reset() { clocks++; } }, requestClock() {}, send() {},
  clearRoomAction() { clears++; }, paintConn() {}, renderBootFailure() {},
  voiceClient: { setAuthed() {}, getStatus() {} }, paintVoice() {}, connect() {},
  clearKickRequest() {}, kickConfirmation:null,lastKickRequestId:null, embedTicket:'late-ticket',embedTicketNonce:'late-nonce',embedAuthPending:true,
  closeCustomizer() {},closeHowto() {},resetView() {},resultPresentation:{reset(){}},focusGame:'kart',instanceId:'current',you:'p12345678',
  localStorage:{removed:[],removeItem(key){this.removed.push(key)}},history:{replaceState(){}},reportEmbedState(){},
  render() { renders++; }, announce() {}, onMsg(value) { received.push(value); },
  document: { dispatchEvent(event) { events.push({ type: event.type, connLost: ctx.connLost }); } },
  Event: class { constructor(type) { this.type = type; } },
};
vm.createContext(ctx);
vm.runInContext(code + '\nglobalThis.qa = openSocket; globalThis.connection = () => (' + contextCode + ').connected; globalThis.admitState = (msg = {}) => {' + admissionCode + '};', ctx);
ctx.qa();
const old = sockets[0];
assert.equal(ctx.connection(), false, 'connecting socket is not a usable game connection');
ctx.qa(); assert.equal(sockets.length, 1, 'duplicate retry cannot open a parallel connecting socket');
old.readyState = 2;
ctx.qa(); const live = sockets[1];
const timerBefore = ctx.socketStartTimer;
old.onopen(); old.onmessage({ data: '{"t":"state","instanceId":"retired"}' }); old.onclose({ code: 1006 });
assert.equal(events.length, 0, 'retired close cannot stop the replacement game');
assert.equal(received.length, 0, 'retired socket cannot replace the current snapshot');
assert.equal(clears + clocks + renders, 0, 'retired events cannot clear timers, clocks, requests or view');
assert.equal(soundStops, 0, 'retired socket cannot stop the current game audio');
assert.equal(ctx.socketStartTimer, timerBefore);
assert.equal(timers.has(timerBefore), true, 'replacement watchdog survives a retired close');
live.readyState = 1; live.onopen();
assert.equal(ctx.connection(), false, 'socket open alone does not admit old game input');
assert.equal(clocks, 1, 'current connection resets the clock once');
live.onmessage({ data: '{"t":"state","instanceId":"current"}' });
assert.equal(received[0].instanceId, 'current');
ctx.admitState();
assert.equal(ctx.connection(), true, 'first current game state admits a recovered seat');
live.readyState = 3; live.onclose({ code: 1006 });
assert.equal(ctx.connection(), false, 'closed connection cannot collect held inputs');
assert.equal(events.length, 1, 'current disconnect releases held game inputs once');
assert.equal(events[0].type, 'game-screenchange');
assert.equal(events[0].connLost, false, 'input stops before connection recovery begins');
assert.equal(ctx.connLost, true); assert.equal(clears, 1);
assert.equal(soundStops, 1, 'current disconnect stops gameplay audio immediately');
assert.equal(timers.get(ctx.retryTimer).ms, 1000, 'ordinary disconnect still schedules seat recovery');
ctx.qa(); const takeover = sockets[2]; takeover.readyState = 3;
takeover.onclose({ code: 4009 });
assert.equal(events.length, 2, 'deliberate seat takeover also releases held inputs');
assert.equal(ctx.seatTaken, true); assert.equal(ctx.connLost, false);
assert.equal(soundStops, 2, 'seat takeover also stops gameplay audio');
assert.equal(timers.size, 0, 'takeover does not fight the other window with automatic retries');
ctx.qa();const removed=sockets.at(-1);removed.readyState=3;removed.onclose({code:4003});
assert.equal(ctx.seatRemoved,true,'host removal has terminal client state');
assert.equal(ctx.connLost,false);assert.equal(ctx.seatTaken,false);
assert.equal(timers.size,0,'removed seat schedules no automatic retry');
assert.equal(ctx.room,null);assert.equal(ctx.lastState,null);assert.equal(ctx.you,null);
assert.equal(ctx.embedTicket,null);assert.equal(ctx.embedTicketNonce,null);assert.equal(ctx.embedAuthPending,false);
assert.deepEqual(ctx.localStorage.removed,['QA','pb_room'],'removed client clears persisted resume credentials');
assert.equal(events.at(-1).type,'game-screenchange','host removal releases held inputs');
const count=sockets.length;ctx.qa();assert.equal(sockets.length,count,'late reconnect cannot reopen removed seat');
const authCode=source.slice(source.indexOf('function embedSendJoin('),source.indexOf('\nconst embedBridge ='));
let authorizations=0;ctx.EMBED={enabled:true};ctx.embedTrusted=true;ctx.embedBridge={authNeeded(){authorizations++}};ctx.isValidNonce=()=>true;ctx.send=()=>authorizations++;ctx.ws={readyState:1};
vm.runInContext(authCode+'\nglobalThis.deliverRemovedAuth=deliverEmbedAuth;globalThis.requestRemovedAuth=requestEmbedAuth;',ctx);
ctx.deliverRemovedAuth('fresh-parent-ticket','new-nonce');ctx.requestRemovedAuth();
assert.equal(authorizations,0,'late parent ticket and auth retry cannot rejoin kicked identity');
console.log('SOCKET_INPUT_RELEASE_PASS: disconnect/takeover/removal stop held input; stale sockets and parent tickets cannot rejoin a removed seat');

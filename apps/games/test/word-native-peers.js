'use strict';
// Legal WebSocket companions for native primary-seat acceptance. This never
// controls the native browser, supplies an answer for it, or replaces any app,
// clock, state, content or result. Start the actual app on an isolated port.
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const WebSocket = require('ws');
const code = process.argv[2];
if (!/^[A-HJ-NP-Z2-9]{4}$/.test(code || '')) throw Error('Supply the isolated QA room code.');
const port = Number(process.env.WORD_ACCEPTANCE_PORT || 8447);
const directory = process.env.WORD_ACCEPTANCE_EVIDENCE || '/tmp/giggle-word-native-20261009';
const clients = [], records = [], snapshots = [];
let captured, closing = false;
const record = value => records.push({ at: Date.now(), ...value });
const send = (client, message) => {
  if (client.ws.readyState !== WebSocket.OPEN) throw Error('Peer socket is closed.');
  // Authentication seat tokens never enter the evidence file.
  if (!['join','leave'].includes(message.t)) record({ peer: client.name, direction: 'send', message });
  client.ws.send(JSON.stringify(message));
};
const act = (client, action, meta = client.state) => send(client, {
  t: 'action', i: meta?.instanceId, w: meta?.w, a: action,
});
const summary = client => {
  const s = client.state || {};
  return { peer: client.name, you: client.you, gameId: s.game, instanceId: s.instanceId,
    window: s.w, round: s.round, phase: s.phase, preparing: s.preparing,
    endsAt: s.endsAt, gameNow: s.gameNow, letter: s.letter, categories: s.categories,
    letters: s.letters, current: s.current, turnPid: s.turnPid, turnNo: s.turnNo,
    mine: s.mine, myFeedback: s.myFeedback, myError: s.myError,
    question: s.question, history: s.history, last: s.last, totals: s.totals,
    locked: s.locked, spectator: s.spectator };
};
const save = () => {
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, `peers-${code}.json`);
  fs.writeFileSync(file, JSON.stringify({ source: 'Actual local production WebSocket peers. Native Safari seat acts only through the real app UI; no app/clock/state/result injection.', port, room: code, records, snapshots }, null, 2));
  return file;
};
function connect(name, index, previous) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`), client = previous || { name, index, ready: new Set(), answered: new Set() };
    client.ws = ws;
    if (!previous) clients.push(client);
    ws.once('error', reject);
    ws.on('open', () => send(client, { t: 'join', code, name, seatToken: client.token }));
    ws.on('message', raw => {
      const message = JSON.parse(raw);
      if (message.t === 'hello') { client.you = message.you; client.token = message.seatToken; resolve(client); }
      if (message.t === 'error') { record({ peer: name, direction: 'receive', message }); console.log(JSON.stringify({ peer: name, error: message.msg })); }
      if (message.t === 'room') client.room = message.room;
      if (message.t !== 'state') return;
      client.state = message;
      if (snapshots.length < 3000) snapshots.push({ receivedAt: Date.now(), peer: name, state: message });
      const key = message.instanceId + ':' + message.w;
      if (message.preparing && !client.ready.has(key)) {
        client.ready.add(key);
        // A protocol-only peer has no rendered UI to prepare. Native app
        // readiness is independently acknowledged by its shipping view host.
        send(client, { t: 'game-ready', i: message.instanceId, w: message.w });
      }
      if (((message.game === 'trivia' && message.phase === 'answer') ||
           (message.game === 'warm-words' && message.phase === 'guess')) && !message.preparing && !client.answered.has(key)) {
        client.answered.add(key);
        setTimeout(() => {
          if (!closing && client.state?.instanceId === message.instanceId && client.state?.w === message.w && !client.state.preparing)
            act(client, message.game === 'trivia' ? { pick: index % 4 } : { guess: index ? 'dog' : 'cat' });
        }, 1000);
      }
    });
  });
}
async function close() {
  if (closing) return;
  closing = true;
  for (const client of clients) if (client.ws.readyState === WebSocket.OPEN) { send(client, { t: 'leave' }); client.ws.close(); }
  console.log(JSON.stringify({ saved: save(), closed: true }));
  process.stdin.pause();
}
(async () => {
  await connect('Word Peer A', 0);
  await connect('Word Peer B', 1);
  console.log(JSON.stringify({ joined: clients.map(c => ({ name: c.name, you: c.you })), room: code }));
  const input = readline.createInterface({ input: process.stdin });
  input.on('line', line => {
    try {
      const command = JSON.parse(line), client = clients[command.peer ?? 0];
      if (command.cmd === 'status') console.log(JSON.stringify(clients.map(summary)));
      else if (command.cmd === 'act') { act(client, command.action); console.log(JSON.stringify({ sent: summary(client).peer, action: command.action })); }
      else if (command.cmd === 'capture') { captured = { instanceId: client.state?.instanceId, w: client.state?.w }; console.log(JSON.stringify({ captured })); }
      else if (command.cmd === 'stale') { if (!captured) throw Error('Capture a real action window first.'); act(client, command.action, captured); console.log(JSON.stringify({ staleSent: captured })); }
      else if (command.cmd === 'flush') console.log(JSON.stringify({ saved: save() }));
      else if (command.cmd === 'reconnect') {
        const ws = client.ws;
        ws.once('close', () => connect(client.name, client.index, client).then(() => console.log(JSON.stringify({ reconnected: client.name, you: client.you }))));
        ws.close();
      }
      else if (command.cmd === 'close') { input.close(); close(); }
      else throw Error('Use status, act, capture, stale, reconnect, flush or close.');
    } catch (error) { console.error(String(error)); }
  });
  input.on('close', close);
  setTimeout(close, 90 * 60 * 1000).unref();
})().catch(error => { console.error(error); process.exitCode = 1; close(); });

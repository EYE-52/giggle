'use strict';
const assert = require('node:assert/strict');
const { WebSocket } = require('ws');
const { createServer } = require('./word-worlds-browser');
const { ids } = require('./word-worlds-fixtures');

(async () => {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    for (const id of ids) {
      const socket = new WebSocket('ws://127.0.0.1:' + server.address().port + '/socket');
      let state, pending;
      socket.on('message', text => {
        const message = JSON.parse(text);
        if (message.t === 'state') state = message;
        if (message.t === 'qa-error') pending?.reject(Error(message.error));
        if (message.t === 'prepared' || message.t === 'qa-ack') pending?.resolve(message);
      });
      const receive = () => new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(Error(id + ' no acknowledgement')), 3000);
        pending = { resolve: message => { clearTimeout(timer); resolve(message); }, reject: error => { clearTimeout(timer); reject(error); } };
      });
      await new Promise(resolve => socket.once('open', resolve));
      let ack = receive(); socket.send(JSON.stringify({ t: 'prepare', id })); await ack;
      assert(state && !state.spectator, id + ' real active projection');
      if (['scattergories', 'countdown-word', 'lyric-fill'].includes(id)) assert.deepEqual(state.answers, {}, id + ' private peers');
      if (id === 'lyric-fill') assert(!('answer' in state.line));
      if (id === 'number-hunt') assert(!('secret' in state));
      if (id === 'warm-words') assert(!('target' in state));
      const actions = {
        scattergories: { answers: ['seal', '', '', '', ''] },
        'word-chain': { word: 'fruit' },
        'countdown-word': { word: 'late', lock: true },
        'lyric-fill': { text: 'a melody' },
        'number-hunt': { guess: 42 },
        'warm-words': { guess: 'kitchen' },
      };
      ack = receive(); socket.send(JSON.stringify({ t: 'action', a: actions[id], i: state.instanceId, w: state.w }));
      const result = await ack; assert(result.changed, id + ' native payload changed actual engine');
      if (id === 'scattergories') assert.equal(state.mine[0], 'seal');
      if (id === 'word-chain') assert.equal(state.current, 'fruit');
      if (id === 'countdown-word') assert(state.myLocked && state.mine === 'late');
      if (id === 'lyric-fill') assert.equal(state.mine, 'a melody');
      if (id === 'number-hunt') assert(state.guesses[state.you].includes(42));
      if (id === 'warm-words') assert(state.history.some(h => h.word === 'kitchen' && h.rank >= 1));
      console.log('PASS ' + id + ' real Room preparation, projection privacy and client payload');
      await new Promise(resolve => { socket.once('close', resolve); socket.close(); });
    }
  } finally { await new Promise(resolve => server.close(resolve)); }
  console.log('WORD_WORLDS_TRANSPORT_PASS');
})().catch(error => { console.error(error); process.exitCode = 1; });

const test = require('node:test');
const assert = require('node:assert/strict');

function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
function track() {
  return { closed: 0, stops: 0, enabled: [], muted: [], plays: 0,
    close() { this.closed++; }, stop() { this.stops++; }, play() { this.plays++; }, setVolume() {},
    async setEnabled(on) { this.enabled.push(on); }, async setMuted(on) { this.muted.push(on); } };
}
const token = (squad = 'squad', encounter = null) => ({ appId: 'test', channelName: encounter ?? squad, rtcToken: `token-${encounter ?? squad}`, uid: encounter ? 11 : 1 });

async function harness(options = {}) {
  const { createVideoClient } = await import('../src/web.ts');
  const { createCallSession } = await import('../src/callSession.ts');
  const audio = track(), video = track(), instances = [], presence = [], tokens = [];
  let captures = 0, singles = 0;
  const sdk = {
    createClient() {
      const handlers = {}, instance = { handlers, joins: [], leaves: 0, publications: [], renewals: [],
        on(name, cb) { handlers[name] = cb; },
        async join(...args) { this.joins.push(args); await options.join?.(this); },
        async leave() { this.leaves++; handlers['connection-state-change']?.('DISCONNECTED'); await options.leave?.(this); },
        async publish(tracks) { this.publications.push([...tracks]); }, async subscribe() { await options.subscribe?.(); },
        async renewToken(value) { this.renewals.push(value); },
      }; instances.push(instance); return instance;
    },
    async createMicrophoneAndCameraTracks() { captures++; await options.capture?.(); return [audio, video]; },
    async createMicrophoneAudioTrack() { singles++; return audio; }, async createCameraVideoTrack() { singles++; return video; },
  };
  const session = createCallSession({
    createClient: () => createVideoClient(async () => sdk),
    async getToken(squad, encounter) { tokens.push([squad, encounter]); await options.token?.(squad, encounter); return token(squad, encounter); },
    async setPresence(...args) { presence.push(args); },
  });
  return { session, sdk, instances, audio, video, tokens, presence, captures: () => captures, singles: () => singles };
}

test('initial joint capture overlaps the channel handshake and requests devices once', async () => {
  const capture = deferred(), joined = deferred();
  const h = await harness({ capture: () => capture.promise, join: () => { joined.resolve(); } });
  const pending = h.session.connect('squad', null, { audio: true, video: true });
  await joined.promise;
  assert.equal(h.captures(), 1); assert.equal(h.singles(), 0);
  assert.equal(h.session.getSnapshot().pending, true);
  capture.resolve(); await pending;
  assert.deepEqual(h.instances[0].publications, [[h.audio, h.video]]);
  await h.session.stop();
});

test('search and match reuse the same private call; encounter and return reuse its capture tracks', async () => {
  const h = await harness();
  const first = await h.session.connect('squad', null, { audio: true, video: true });
  for (const screen of ['search', 'match', 'search']) {
    assert.equal(await h.session.returnToSquad(), first, screen);
    assert.equal(await h.session.connect('squad'), first, screen);
  }
  assert.equal(h.instances[0].joins.length, 1); assert.equal(h.instances[0].leaves, 0);
  assert.equal(await h.session.connect('squad', 'encounter'), first);
  assert.equal(h.session.getSnapshot().uid, 11);
  assert.equal(await h.session.returnToSquad(), first);
  assert.equal(h.session.getSnapshot().uid, 1);
  assert.equal(h.captures(), 1); assert.equal(h.singles(), 0); assert.equal(h.instances.length, 1);
  assert.equal(h.audio.closed, 0); assert.equal(h.video.closed, 0);
  assert.deepEqual(h.instances[0].publications, [[h.audio, h.video], [h.audio, h.video], [h.audio, h.video]]);
  await h.session.stop();
  assert.equal(h.audio.closed, 1); assert.equal(h.video.closed, 1);
  assert.equal(h.session.getSnapshot().client, null);
});

test('explicit mic and camera choices survive transfers and re-enable only publishes once in the new room', async () => {
  const h = await harness();
  await h.session.connect('squad', null, { audio: true, video: true });
  await h.session.setDevice('squad', 'audio', false);
  await h.session.setDevice('squad', 'video', false);
  await h.session.connect('squad', 'encounter');
  assert.deepEqual(h.session.getSnapshot().capture, { audio: 'off', video: 'off' });
  assert.equal(h.instances[0].publications.length, 1);
  await h.session.setDevice('squad', 'video', true);
  await h.session.setDevice('squad', 'video', true);
  assert.deepEqual(h.instances[0].publications, [[h.audio, h.video], [h.video]]);
  await h.session.returnToSquad();
  assert.deepEqual(h.instances[0].publications.at(-1), [h.video]);
  assert.equal(h.captures(), 1); assert.equal(h.singles(), 0);
  await h.session.stop();
});

test('direct encounter entry leaves devices off until an explicit request', async () => {
  const h = await harness();
  await h.session.connect('squad', 'encounter');
  assert.equal(h.captures(), 0); assert.equal(h.singles(), 0);
  await h.session.setDevice('squad', 'audio', true);
  assert.deepEqual(h.session.getSnapshot().capture, { audio: 'active', video: 'off' });
  assert.equal(h.singles(), 1);
  await h.session.stop();
});

test('expiry renews the current room token without reconnecting or acquiring devices', async () => {
  const h = await harness();
  await h.session.connect('squad', null, { audio: true, video: true });
  const sdkClient = h.instances[0];
  sdkClient.handlers['token-privilege-will-expire']();
  // Drain the serialized refresh with a same-room connect.
  await h.session.connect('squad');
  assert.deepEqual(sdkClient.renewals, ['token-squad']);
  assert.equal(sdkClient.joins.length, 1); assert.equal(h.captures(), 1);
  await h.session.stop();
});

test('a late permission result is closed and cannot revive a stopped or replacement call', async () => {
  const capture = deferred(), reached = deferred();
  const h = await harness({ capture: () => { reached.resolve(); return capture.promise; } });
  const old = h.session.connect('old', null, { audio: true, video: true }).catch(e => e);
  await reached.promise;
  await h.session.stop();
  await h.session.connect('new');
  capture.resolve(); assert.match((await old).message, /cancelled/);
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(h.audio.closed > 0 && h.video.closed > 0);
  assert.equal(h.session.getSnapshot().squadId, 'new');
  assert.equal(h.session.getSnapshot().joined, true);
  assert.equal(h.instances[1].leaves, 0);
  await h.session.stop();
});

test('a pending old token does not delay a replacement squad call', async () => {
  const wait = deferred(), reached = deferred();
  const h = await harness({ token: squad => { if (squad === 'old') { reached.resolve(); return wait.promise; } } });
  const old = h.session.connect('old').catch(e => e); await reached.promise;
  await h.session.stop(); await h.session.connect('new');
  wait.resolve(); assert.match((await old).message, /cancelled/);
  assert.equal(h.instances.length, 1); assert.equal(h.session.getSnapshot().squadId, 'new');
  assert.ok(h.presence.some(args => args[0] === 'old' && args[2] === false));
  await h.session.stop();
});

test('a failed destination token leaves the existing squad conversation running', async () => {
  const h = await harness({ token: (_squad, encounter) => { if (encounter) throw new Error('temporary token failure'); } });
  await h.session.connect('squad', null, { audio: true, video: true });
  await assert.rejects(h.session.connect('squad', 'encounter'), /temporary token failure/);
  assert.equal(h.instances[0].leaves, 0); assert.equal(h.session.getSnapshot().joined, true);
  assert.equal(h.session.getSnapshot().encounterId, null);
  assert.deepEqual(h.presence.at(-1), ['squad', null, true]);
  await h.session.stop();
});

test('failed initial tokens and joins clear prepared encounter presence', async () => {
  for (const failure of ['token', 'join']) {
    const h = await harness({ [failure]: () => { throw new Error(`failed ${failure}`); } });
    await assert.rejects(h.session.connect('squad', 'encounter'), new RegExp(`failed ${failure}`));
    assert.deepEqual(h.presence.at(-1), ['squad', 'encounter', false]);
    assert.equal(h.session.getSnapshot().joined, false);
    assert.equal(h.session.getSnapshot().client, null);
    await h.session.stop();
  }
});

test('a cancelled encounter token restores replacement private presence in the same squad', async () => {
  const wait = deferred(), reached = deferred();
  const h = await harness({ token: (_squad, encounter) => { if (encounter) { reached.resolve(); return wait.promise; } } });
  await h.session.connect('squad');
  const old = h.session.connect('squad', 'encounter').catch(e => e);
  await reached.promise; await h.session.stop(); await h.session.connect('squad');
  wait.resolve(); assert.match((await old).message, /cancelled/);
  assert.deepEqual(h.presence.at(-1), ['squad', null, true]);
  assert.equal(h.session.getSnapshot().joined, true);
  await h.session.stop();
});

test('late failed-join cleanup cannot erase a replacement call', async () => {
  const wait = deferred(), reached = deferred();
  const h = await harness({
    join: instance => { if (instance === h.instances[0]) throw new Error('join failed'); },
    leave: instance => { if (instance === h.instances[0]) { reached.resolve(); return wait.promise; } },
  });
  const old = h.session.connect('old', 'encounter').catch(e => e);
  await reached.promise; await h.session.stop(); await h.session.connect('new');
  wait.resolve(); assert.match((await old).message, /join failed/);
  assert.equal(h.session.getSnapshot().squadId, 'new');
  assert.equal(h.session.getSnapshot().client !== null, true);
  assert.equal(h.session.getSnapshot().joined, true);
  await h.session.stop();
});

test('stopping during a transfer releases capture immediately and rejects the old move', async () => {
  const wait = deferred(), reached = deferred(); let blocked = false;
  const h = await harness({ join: instance => { if (blocked && instance === h.instances[0]) { reached.resolve(); return wait.promise; } } });
  await h.session.connect('squad', null, { audio: true, video: true }); blocked = true;
  const move = h.session.connect('squad', 'encounter').catch(e => e); await reached.promise;
  await h.session.stop(); assert.ok(h.audio.closed && h.video.closed);
  await h.session.connect('new'); wait.resolve();
  assert.match((await move).message, /cancelled/);
  assert.equal(h.session.getSnapshot().squadId, 'new'); assert.equal(h.instances[1].leaves, 0);
  await h.session.stop();
});

test('an old room subscription resolving after a transfer cannot restore an opponent', async () => {
  const wait = deferred();
  const h = await harness({ subscribe: () => wait.promise });
  const client = await h.session.connect('squad');
  const subscription = h.instances[0].handlers['user-published']({ uid: 9, videoTrack: track(), hasVideo: true }, 'video');
  await h.session.connect('squad', 'encounter'); wait.resolve(); await subscription;
  assert.deepEqual(client.remotes, []); assert.deepEqual(h.session.getSnapshot().remotes, []);
  await h.session.stop();
});

test('joint permission denial remains visible and a single-device retry recovers', async () => {
  const h = await harness({ capture: () => { throw Object.assign(new Error('denied'), { code: 'PERMISSION_DENIED' }); } });
  await h.session.connect('squad', null, { audio: true, video: true });
  assert.deepEqual(h.session.getSnapshot().capture, { audio: 'denied', video: 'denied' });
  await h.session.setDevice('squad', 'audio', true);
  assert.deepEqual(h.session.getSnapshot().capture, { audio: 'active', video: 'denied' });
  await h.session.stop();
});

test('a recovered connection restores call status without an app-level rejoin', async () => {
  const h = await harness();
  await h.session.connect('squad', null, { audio: true, video: true });
  h.instances[0].handlers['connection-state-change']('DISCONNECTED');
  assert.equal(h.session.getSnapshot().joined, false);
  h.instances[0].handlers['connection-state-change']('CONNECTED');
  assert.equal(h.session.getSnapshot().joined, true);
  assert.equal(h.instances[0].joins.length, 1); assert.equal(h.captures(), 1);
  await h.session.stop();
});

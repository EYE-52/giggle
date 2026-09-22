const test = require('node:test');
const assert = require('node:assert/strict');
const token = { appId: 'test', channelName: 'room', rtcToken: 'test', uid: 1 };
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
function track() { return { closed: 0, stop() {}, close() { this.closed++; }, play() {}, setVolume() {}, async setMuted() {} }; }

for (const phase of ['sdk', 'channel', 'microphone', 'camera', 'publish-audio', 'publish-video']) {
  test(`web leave during ${phase} cannot publish late media or erase a replacement call`, async () => {
    const { createVideoClient } = await import('../src/web.ts');
    const delay = deferred(), reached = deferred();
    const clients = [], audio = track(), video = track();
    const pause = async (point, value) => { if (point === phase) { reached.resolve(); await delay.promise; } return value; };
    const sdk = { createClient() {
      const handlers = {};
      const instance = { handlers, publications: [], leaves: 0,
        on(name, cb) { handlers[name] = cb; },
        join: () => clients.length === 1 ? pause('channel') : Promise.resolve(),
        async publish(tracks) { this.publications.push(...tracks); await pause(tracks[0] === audio ? 'publish-audio' : 'publish-video'); },
        async leave() { this.leaves++; }, async subscribe() {},
      };
      clients.push(instance); return instance;
    }, createMicrophoneAudioTrack: () => pause('microphone', audio), createCameraVideoTrack: () => pause('camera', video) };
    let loads = 0;
    const client = createVideoClient(() => ++loads === 1 ? pause('sdk', { default: sdk }) : Promise.resolve({ default: sdk }));
    const captures = [], connections = [], volumes = [];
    client.onCaptureState(s => captures.push(s)); client.onConnectionState(s => connections.push(s)); client.onVolumes(s => volumes.push(s));
    const oldJoin = client.join(token).then(() => null, error => error);
    await reached.promise;
    await client.leave();
    const publishCount = clients[0]?.publications.length ?? 0;
    await client.join(token, { audio: false, video: false });
    const current = clients.at(-1);
    await current.handlers['user-published']({ uid: 9, audioTrack: track() }, 'audio');
    delay.resolve();
    assert.match((await oldJoin).message, /cancelled/);
    assert.deepEqual(client.remotes.map(p => p.uid), [9]);
    assert.deepEqual(captures.at(-1), { audio: 'off', video: 'off' });
    assert.equal(current.leaves, 0);
    if (clients.length > 1) {
      assert.equal(clients[0].publications.length, publishCount);
      clients[0].handlers['connection-state-change']('DISCONNECTED');
      clients[0].handlers['volume-indicator']?.([{ uid: 2, level: 90 }]);
      clients[0].handlers['user-left']({ uid: 9 });
      assert.deepEqual(client.remotes.map(p => p.uid), [9]);
      assert.deepEqual(connections, []); assert.deepEqual(volumes, []);
    }
    if (['microphone', 'camera', 'publish-audio', 'publish-video'].includes(phase)) assert.ok(audio.closed > 0);
    if (['camera', 'publish-video'].includes(phase)) assert.ok(video.closed > 0);
    await client.leave();
  });
}

test('web cleanup closes both devices even when stop fails and late toggles cannot turn them on', async () => {
  const { createVideoClient } = await import('../src/web.ts');
  const audio = track(), video = track(), toggling = deferred();
  audio.stop = () => { throw new Error('stop failed'); };
  audio.setMuted = () => toggling.promise;
  const sdkClient = { on() {}, async join() {}, async publish() {}, async leave() {} };
  const client = createVideoClient(async () => ({ default: { createClient: () => sdkClient, createMicrophoneAudioTrack: async () => audio, createCameraVideoTrack: async () => video } }));
  const captures = []; client.onCaptureState(s => captures.push(s));
  await client.join(token);
  await assert.rejects(client.join(token), /already joining or in a call/);
  const pending = client.setMicEnabled(true).then(() => null, e => e);
  await client.leave(); toggling.resolve();
  assert.match((await pending).message, /cancelled/);
  assert.ok(audio.closed && video.closed);
  assert.deepEqual(captures.at(-1), { audio: 'off', video: 'off' });
});

function nativeHarness(autoJoin = false) {
  const engines = [];
  const sdk = { ChannelProfileType: {}, ClientRoleType: {}, ConnectionStateType: {},
    LocalAudioStreamState: { LocalAudioStreamStateEncoding: 2 }, LocalVideoStreamState: { LocalVideoStreamStateCapturing: 1 },
    PermissionType: { Camera: 1 }, RemoteAudioState: {}, RemoteVideoState: {},
    createAgoraRtcEngine() {
      const engine = new Proxy({ released: 0,
        registerEventHandler(events) { this.events = events; },
        joinChannel() { if (autoJoin) queueMicrotask(() => this.events.onJoinChannelSuccess()); return 0; },
        release() { this.released++; },
      }, { get(target, key) { return target[key] ?? (() => 0); } });
      engines.push(engine); return engine;
    },
  };
  return { sdk, engines };
}

test('native leave cancels a pending join immediately and queued old callbacks cannot affect a new call', { timeout: 1000 }, async () => {
  const { createVideoClient } = await import('../src/native.ts');
  const { sdk, engines } = nativeHarness();
  const client = createVideoClient(() => sdk);
  const captures = [], connections = [], dimensions = [], volumes = [];
  client.onCaptureState(s => captures.push(s)); client.onConnectionState(s => connections.push(s));
  client.onVideoDimensions(s => dimensions.push(s)); client.onVolumes(s => volumes.push(s));
  const first = client.join(token).then(() => null, e => e);
  await assert.rejects(client.join(token), /already joining or in a call/);
  const old = engines[0]; old.leaveChannel = () => { throw new Error('leave failed'); };
  await client.leave();
  const second = client.join(token, { audio: false, video: false });
  engines[1].events.onJoinChannelSuccess(); await second;
  assert.match((await first).message, /cancelled/);
  assert.equal(old.released, 1); assert.equal(engines[1].released, 0);
  old.events.onJoinChannelSuccess(); old.events.onUserJoined({}, 7); old.events.onPermissionError(1);
  old.events.onLocalAudioStateChanged({}, 2); old.events.onLocalVideoStateChanged({}, 1);
  old.events.onConnectionStateChanged({}, 1); old.events.onAudioVolumeIndication({}, [{ uid: 0, volume: 255 }]);
  old.events.onVideoSizeChanged({}, 0, 0, 1920, 1080, 0);
  assert.deepEqual(client.remotes, []); assert.deepEqual(volumes, []);
  assert.deepEqual(captures.at(-1), { audio: 'off', video: 'off' });
  assert.equal(connections.at(-1), 'CONNECTED');
  engines[1].events.onVideoSizeChanged({}, 0, 0, 640, 480, 0);
  assert.deepEqual(dimensions.at(-1), [{ uid: 1, width: 640, height: 480 }]);
  await client.leave();
});


test('web delayed leave completion cannot clear a new session', async () => {
  const { createVideoClient } = await import('../src/web.ts');
  const leaving = deferred(), instances = [];
  const sdk = { createClient() {
    const handlers = {}, index = instances.length;
    const instance = { on(name, cb) { handlers[name] = cb; }, handlers,
      async join() {}, async subscribe() {}, leave: () => index === 0 ? leaving.promise : Promise.resolve() };
    instances.push(instance); return instance;
  } };
  const client = createVideoClient(async () => ({ default: sdk }));
  await client.join(token, { audio: false, video: false });
  const oldLeave = client.leave();
  await client.join(token, { audio: false, video: false });
  await instances[1].handlers['user-published']({ uid: 7, audioTrack: track() }, 'audio');
  leaving.resolve(); await oldLeave;
  assert.deepEqual(client.remotes.map(p => p.uid), [7]);
  await client.setRemoteAudioMuted(7, true);
  assert.equal(client.remotes[0].mutedForMe, true);
  await client.leave();
});

test('native setup failure releases the engine and allows retry', async () => {
  const { createVideoClient } = await import('../src/native.ts');
  const { sdk, engines } = nativeHarness(true);
  const original = sdk.createAgoraRtcEngine;
  sdk.createAgoraRtcEngine = () => {
    const engine = original();
    if (engines.length === 1) engine.initialize = () => -1;
    return engine;
  };
  const client = createVideoClient(() => sdk);
  await assert.rejects(client.join(token), /initialization failed/);
  assert.equal(engines[0].released, 1);
  await client.join(token, { audio: false, video: false });
  assert.equal(engines[1].released, 0);
  await client.leave();
});

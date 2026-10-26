const assert = require('node:assert/strict');
const test = require('node:test');

const token = { appId: 'synthetic-test', channelName: 'test-room', rtcToken: 'synthetic-test', uid: 1 };
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
function track() {
  const handlers = new Map();
  return {
    closed: 0, plays: 0,
    on(event, callback) { handlers.set(event, callback); },
    end() { handlers.get('track-ended')?.(); },
    stop() {}, close() { this.closed++; }, play() { this.plays++; },
    setVolume() {}, async setEnabled() {}, async setMuted() {},
  };
}
function sdkFixture() {
  const handlers = new Map(), audio = track(), video = track();
  const creates = { audio: 0, video: 0 }, published = [];
  const sdkClient = {
    on(event, callback) { handlers.set(event, callback); },
    removeAllListeners() { handlers.clear(); },
    async join() {}, async leave() {}, async unpublish() {}, async subscribe() {},
    async publish(tracks) { published.push(...tracks); },
  };
  const sdk = {
    createClient: () => sdkClient,
    async createMicrophoneAudioTrack() { creates.audio++; return audio; },
    async createCameraVideoTrack() { creates.video++; return video; },
  };
  return { sdk, sdkClient, handlers, audio, video, creates, published };
}
async function sessionFixture(fixture) {
  const { createVideoClient } = await import('../src/web.ts');
  const { createCallSession } = await import('../src/callSession.ts');
  return createCallSession({
    createClient: () => createVideoClient(async () => fixture.sdk),
    getToken: async () => token,
    setPresence: async () => {},
  });
}

for (const joint of [false, true]) test(`a camera ending during initial ${joint ? 'joint' : 'single-device'} publish cannot be reported active`, async () => {
  const { createVideoClient } = await import('../src/web.ts');
  const fixture = sdkFixture(), publishing = deferred(), release = deferred(), states = [];
  if (joint) fixture.sdk.createMicrophoneAndCameraTracks = async () => [fixture.audio, fixture.video];
  fixture.sdkClient.publish = () => { publishing.resolve(); return release.promise; };
  const client = createVideoClient(async () => fixture.sdk);
  client.onCaptureState(state => states.push(state));
  const joining = client.join(token, { audio: joint, video: true });
  try {
    await publishing.promise;
    fixture.video.end();
    assert.equal(states.at(-1).video, 'unavailable');
    release.resolve();
    await joining;
    assert.deepEqual(states.at(-1), { audio: joint ? 'active' : 'off', video: 'unavailable' }, 'publish completion cannot resurrect ended capture or silence a working microphone');
    client.playLocal({});
    assert.equal(fixture.video.plays, 0, 'ended camera cannot be played');
    assert.ok(fixture.video.closed > 0, 'ended capture is released');
    assert.equal(fixture.audio.closed, 0, 'a healthy microphone is not closed by the camera failure');
  } finally { release.resolve(); await joining.catch(() => {}); await client.leave(); }
});

test('concurrent first microphone and camera requests both enable their requested device once', async () => {
  const fixture = sdkFixture(), session = await sessionFixture(fixture);
  try {
    await Promise.all([
      session.setDevice('test-squad', 'audio', true),
      session.setDevice('test-squad', 'video', true),
    ]);
    assert.deepEqual(session.getSnapshot().capture, { audio: 'active', video: 'active' });
    assert.deepEqual(fixture.creates, { audio: 1, video: 1 });
    assert.equal(fixture.published.filter(item => item === fixture.audio).length, 1);
    assert.equal(fixture.published.filter(item => item === fixture.video).length, 1);
  } finally { await session.stop(); }
});

test('a first-device request for a replacement squad survives its intentional old-squad stop', async () => {
  const fixture = sdkFixture(), session = await sessionFixture(fixture);
  try {
    await session.connect('old-squad');
    await session.setDevice('replacement-squad', 'video', true);
    const snapshot = session.getSnapshot();
    assert.equal(snapshot.squadId, 'replacement-squad');
    assert.equal(snapshot.joined, true);
    assert.deepEqual(snapshot.capture, { audio: 'off', video: 'active' });
    assert.equal(fixture.creates.video, 1, 'replacement camera is captured once');
  } finally { await session.stop(); }
});

test('a denied first capture is not automatically prompted again by a queued same-device request', async () => {
  const fixture = sdkFixture();
  let deny = true;
  fixture.sdk.createCameraVideoTrack = async () => {
    fixture.creates.video++;
    if (deny) throw new DOMException('Synthetic denial', 'NotAllowedError');
    return fixture.video;
  };
  const session = await sessionFixture(fixture);
  try {
    await Promise.all([
      session.setDevice('test-squad', 'video', true),
      session.setDevice('test-squad', 'video', true),
    ]);
    assert.equal(session.getSnapshot().capture.video, 'denied');
    assert.equal(fixture.creates.video, 1, 'queued connection work must not repeat a refused capture');
    deny = false;
    await session.setDevice('test-squad', 'video', true);
    assert.equal(session.getSnapshot().capture.video, 'active', 'a later explicit user retry still works');
    assert.equal(fixture.creates.video, 2);
  } finally { await session.stop(); }
});

for (const requested of ['video', 'audio']) test(`a ${requested} request made during pending camera capture does not repeat a later denial`, async () => {
  const fixture = sdkFixture(), capturing = deferred();
  let rejectCapture;
  const permission = new Promise((_, reject) => { rejectCapture = reject; });
  fixture.sdk.createCameraVideoTrack = async () => {
    fixture.creates.video++;
    capturing.resolve();
    if (fixture.creates.video === 1) return permission;
    throw new DOMException('Synthetic duplicate prompt', 'NotAllowedError');
  };
  const session = await sessionFixture(fixture);
  try {
    const first = session.setDevice('test-squad', 'video', true);
    await capturing.promise;
    assert.equal(session.getSnapshot().capture.video, 'pending');
    const queued = session.setDevice('test-squad', requested, true);
    rejectCapture(new DOMException('Synthetic denied', 'NotAllowedError'));
    const outcomes = await Promise.allSettled([first, queued]);
    assert.equal(fixture.creates.video, 1, 'a request issued before denial cannot automatically ask for the camera again');
    assert.ok(outcomes.every(outcome => outcome.status === 'fulfilled'), 'queued requests finish without a second refused acquisition');
    assert.deepEqual(session.getSnapshot().capture, { audio: requested === 'audio' ? 'active' : 'off', video: 'denied' });
    assert.equal(fixture.creates.audio, requested === 'audio' ? 1 : 0, 'the independent microphone request is still honored');
  } finally { rejectCapture?.(new DOMException('Synthetic cleanup', 'AbortError')); await session.stop(); }
});

test('unpublishing revokes pending video subscription even when the SDK event uses a different object', async () => {
  const { createVideoClient } = await import('../src/web.ts');
  const fixture = sdkFixture(), release = deferred();
  fixture.sdkClient.subscribe = () => release.promise;
  const client = createVideoClient(async () => fixture.sdk);
  await client.join(token, { audio: false, video: false });
  try {
    const pending = fixture.handlers.get('user-published')({ uid: 2, hasVideo: true }, 'video');
    fixture.handlers.get('user-unpublished')({ uid: 2, hasVideo: false }, 'video');
    release.resolve(); await pending;
    assert.equal(client.remotes.find(remote => remote.uid === 2)?.hasVideo, false);
  } finally { release.resolve(); await client.leave(); }
});

test('video revocation does not invalidate an independent pending audio subscription for the same UID', async () => {
  const { createVideoClient } = await import('../src/web.ts');
  const fixture = sdkFixture(), audioRelease = deferred(), videoRelease = deferred();
  fixture.sdkClient.subscribe = (_user, kind) => kind === 'audio' ? audioRelease.promise : videoRelease.promise;
  const client = createVideoClient(async () => fixture.sdk);
  await client.join(token, { audio: false, video: false });
  const remoteAudio = track();
  try {
    const audioPending = fixture.handlers.get('user-published')({ uid: 2, hasAudio: true, audioTrack: remoteAudio }, 'audio');
    const videoPending = fixture.handlers.get('user-published')({ uid: 2, hasVideo: true }, 'video');
    fixture.handlers.get('user-unpublished')({ uid: 2, hasVideo: false }, 'video');
    videoRelease.resolve(); audioRelease.resolve();
    await Promise.all([audioPending, videoPending]);
    const remote = client.remotes.find(person => person.uid === 2);
    assert.equal(remote?.hasAudio, true, 'audio publication remains current');
    assert.equal(remote?.hasVideo, false, 'only the revoked video remains off');
    assert.equal(remoteAudio.plays, 1, 'valid remote audio plays once');
  } finally { audioRelease.resolve(); videoRelease.resolve(); await client.leave(); }
});

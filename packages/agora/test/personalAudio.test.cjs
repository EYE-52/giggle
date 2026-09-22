const test = require('node:test');
const assert = require('node:assert/strict');
const token = { appId: 'test', channelName: 'room', rtcToken: 'test', uid: 1 };

async function webHarness() {
  const { createVideoClient } = await import('../src/web.ts');
  const handlers = {};
  const sdkClient = { on: (name, cb) => { handlers[name] = cb; }, join: async () => {}, leave: async () => {}, subscribe: async () => {}, enableAudioVolumeIndicator() {} };
  const client = createVideoClient(async () => ({ default: { createClient: () => sdkClient } }));
  await client.join(token, { audio: false, video: false });
  const track = () => ({ calls: [], setVolume(value) { this.calls.push(['volume', value]); }, play() { this.calls.push(['play']); } });
  return { client, handlers, sdkClient, track };
}

test('personal mute affects only the selected listener track and precedes re-published playback', async () => {
  const { client, handlers, track } = await webHarness();
  const first = { uid: 2, audioTrack: track() }, other = { uid: 3, audioTrack: track() };
  await handlers['user-published'](first, 'audio');
  await handlers['user-published'](first, 'video');
  await handlers['user-published'](other, 'audio');
  await client.setRemoteAudioMuted('2', true);
  assert.deepEqual(first.audioTrack.calls.at(-1), ['volume', 0]);
  assert.deepEqual(other.audioTrack.calls, [['volume', 100], ['play']]);
  assert.deepEqual(client.remotes.find(p => p.uid === 2), { uid: 2, hasAudio: true, hasVideo: true, mutedForMe: true });
  handlers['user-unpublished'](first, 'audio');
  const replacement = { uid: 2, audioTrack: track() };
  await handlers['user-published'](replacement, 'audio');
  assert.deepEqual(replacement.audioTrack.calls, [['volume', 0], ['play']]);
  await client.setRemoteAudioMuted(2, false);
  assert.deepEqual(replacement.audioTrack.calls.at(-1), ['volume', 100]);
  assert.equal(client.remotes.find(p => p.uid === 2).mutedForMe, false);
  await client.leave();
  await assert.rejects(client.setRemoteAudioMuted(2, true), /not connected/);
});

test('failed audio updates do not claim success and late subscriptions cannot revive a left call', async () => {
  const { client, handlers, sdkClient, track } = await webHarness();
  const person = { uid: 2, audioTrack: track() };
  await handlers['user-published'](person, 'audio');
  person.audioTrack.setVolume = () => { throw new Error('device lost'); };
  await assert.rejects(client.setRemoteAudioMuted(2, true), /device lost/);
  assert.notEqual(client.remotes[0].mutedForMe, true);
  await assert.rejects(client.setRemoteAudioMuted(1, true), /not connected/);
  let complete;
  sdkClient.subscribe = () => new Promise(resolve => { complete = resolve; });
  const late = { uid: 3, audioTrack: track() };
  const publishing = handlers['user-published'](late, 'audio');
  await client.leave(); complete(); await publishing;
  assert.deepEqual(client.remotes, []);
  assert.deepEqual(late.audioTrack.calls, []);
});

test('native listening updates keep publisher state separate and surface SDK failures', async () => {
  const { createVideoClient } = await import('../src/native.ts');
  let events, fail = false;
  const volumes = [];
  const engine = new Proxy({
    registerEventHandler(handler) { events = handler; },
    joinChannel() { queueMicrotask(() => events.onJoinChannelSuccess()); return 0; },
    adjustUserPlaybackSignalVolume(uid, volume) { if (fail) return -1; volumes.push([uid, volume]); return 0; },
  }, { get(target, key) { return target[key] ?? (() => 0); } });
  const sdk = { createAgoraRtcEngine: () => engine,
    ChannelProfileType: {}, ClientRoleType: {}, ConnectionStateType: {}, LocalAudioStreamState: {}, LocalVideoStreamState: {}, PermissionType: {},
    RemoteAudioState: { RemoteAudioStateDecoding: 2 }, RemoteVideoState: { RemoteVideoStateDecoding: 2 } };
  const client = createVideoClient(() => sdk);
  await client.join(token, { audio: false, video: false });
  events.onUserJoined({}, 2); events.onUserJoined({}, 3);
  events.onRemoteAudioStateChanged({}, 2, 2);
  await client.setRemoteAudioMuted('2', true);
  assert.deepEqual(volumes, [[2, 0]]);
  assert.equal(client.remotes.find(p => p.uid === 2).hasAudio, true);
  assert.equal(client.remotes.find(p => p.uid === 2).mutedForMe, true);
  assert.equal(client.remotes.find(p => p.uid === 3).mutedForMe, undefined);
  events.onRemoteVideoStateChanged({}, 2, 2);
  assert.equal(client.remotes.find(p => p.uid === 2).mutedForMe, true);
  fail = true;
  await assert.rejects(client.setRemoteAudioMuted(2, false), /Listening update failed/);
  assert.equal(client.remotes.find(p => p.uid === 2).mutedForMe, true);
  fail = false;
  await client.setRemoteAudioMuted(2, false);
  assert.deepEqual(volumes.at(-1), [2, 100]);
  await client.leave();
  await assert.rejects(client.setRemoteAudioMuted(2, true), /not connected/);
});

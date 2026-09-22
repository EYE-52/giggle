const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");

test("late web subscriptions cannot become unhandled disconnect errors", () => {
  const source = readFileSync(path.join(__dirname, "../src/web.ts"), "utf8");
  const published = source.slice(source.indexOf('client.on("user-published"'), source.indexOf('client.on("user-unpublished"'));
  assert.match(published, /try\s*{\s*await joinedClient\.subscribe\(user, mediaType\);\s*}\s*catch\s*{\s*return;\s*}/);
});

test("web capture errors distinguish denial from unavailable devices", async () => {
  const { captureErrorKind } = await import("../src/web.ts");
  assert.equal(captureErrorKind(new DOMException("Denied", "NotAllowedError")), "denied");
  assert.equal(captureErrorKind(new DOMException("Missing", "NotFoundError")), "unavailable");
  assert.equal(captureErrorKind(new Error("Unknown")), "unavailable");
});

test("web track toggles fall back once and still reject real failures", async () => {
  const { setTrackEnabled } = await import("../src/web.ts");
  const calls = [];
  await setTrackEnabled({
    setMuted: async () => { throw new Error("mute unsupported"); },
    setEnabled: async (on) => { calls.push(on); },
  }, true, "Microphone");
  assert.deepEqual(calls, [true]);

  await assert.rejects(
    setTrackEnabled({
      setMuted: async () => { throw new Error("mute failed"); },
      setEnabled: async () => { throw new Error("enable failed"); },
    }, false, "Camera"),
    /mute failed/
  );
});

test("web clients expose initial capture truth and reject missing tracks", async () => {
  const { createVideoClient } = await import("../src/web.ts");
  const client = createVideoClient();
  const states = [];
  client.onCaptureState((state) => states.push(state));
  assert.deepEqual(states, [{ audio: "off", video: "off" }]);
  await assert.rejects(client.setMicEnabled(true), /Microphone is unavailable/);
  await assert.rejects(client.setCamEnabled(true), /Camera is unavailable/);
});

test("native connection states map onto the shared lifecycle", async () => {
  const { mapNativeConnectionState } = await import("../src/native.ts");
  assert.equal(mapNativeConnectionState(1), "DISCONNECTED");
  assert.equal(mapNativeConnectionState(2), "CONNECTING");
  assert.equal(mapNativeConnectionState(3), "CONNECTED");
  assert.equal(mapNativeConnectionState(4), "RECONNECTING");
  assert.equal(mapNativeConnectionState(5), "DISCONNECTED");
  assert.equal(mapNativeConnectionState(99), null);
});

test("native remote updates preserve independent audio and video truth", async () => {
  const { mergeRemoteParticipant } = await import("../src/native.ts");
  const joined = mergeRemoteParticipant(undefined, 42, {});
  const video = mergeRemoteParticipant(joined, 42, { hasVideo: true });
  const muted = mergeRemoteParticipant(video, 42, { hasAudio: false });
  assert.deepEqual(joined, { uid: 42, hasVideo: false, hasAudio: false });
  assert.deepEqual(video, { uid: 42, hasVideo: true, hasAudio: false });
  assert.deepEqual(muted, { uid: 42, hasVideo: true, hasAudio: false });
});

test("native local volume zero maps back to the token uid", async () => {
  const { normalizeNativeVolume } = await import("../src/native.ts");
  assert.deepEqual(normalizeNativeVolume(77, { uid: 0, volume: 128 }), { uid: 77, level: 50 });
  assert.deepEqual(normalizeNativeVolume(77, { uid: 81, volume: 255 }), { uid: 81, level: 100 });
});

test("native video dimensions normalize rotation and local uid exactly once", async () => {
  const { normalizeNativeVideoDimensions } = await import("../src/native.ts");
  assert.deepEqual(normalizeNativeVideoDimensions("local-7", 0, 1920, 1080, 0), {
    uid: "local-7", width: 1920, height: 1080,
  });
  assert.deepEqual(normalizeNativeVideoDimensions("local-7", 0, 1920, 1080, 90), {
    uid: "local-7", width: 1080, height: 1920,
  });
  assert.deepEqual(normalizeNativeVideoDimensions("local-7", 42, 640, 480, 180), {
    uid: 42, width: 640, height: 480,
  });
  assert.deepEqual(normalizeNativeVideoDimensions("local-7", 42, 640, 480, 270), {
    uid: 42, width: 480, height: 640,
  });
  assert.equal(normalizeNativeVideoDimensions("local-7", 42, 0, 480, 0), null);
  assert.equal(normalizeNativeVideoDimensions("local-7", 42, 640, NaN, 0), null);
  assert.equal(normalizeNativeVideoDimensions("local-7", 42, 640, 480, NaN), null);
});

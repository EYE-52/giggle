import { mergeRemoteParticipant } from "./types.ts";
import type {
  AgoraToken,
  CaptureDeviceState,
  CaptureState,
  ConnectionState,
  RemoteParticipant,
  VideoClient,
  VolumeLevel,
} from "./types";

export function captureErrorKind(error: unknown): CaptureDeviceState {
  const name = error instanceof DOMException
    ? error.name
    : (error as { name?: string } | null)?.name;
  const code = (error as { code?: string } | null)?.code;
  return name === "NotAllowedError" || name === "SecurityError" || code === "PERMISSION_DENIED"
    ? "denied"
    : "unavailable";
}

export async function setTrackEnabled(
  track: { setMuted?: (muted: boolean) => Promise<void>; setEnabled?: (on: boolean) => Promise<void> } | null,
  on: boolean,
  label: string,
  releaseCapture = false
): Promise<void> {
  if (!track) throw new Error(`${label} is unavailable.`);
  if (releaseCapture && track.setEnabled) {
    await track.setEnabled(on);
    return;
  }
  try {
    if (!track.setMuted) throw new Error(`${label} cannot be muted.`);
    await track.setMuted(!on);
  } catch (firstError) {
    try {
      if (!track.setEnabled) throw firstError;
      await track.setEnabled(on);
    } catch {
      throw firstError;
    }
  }
}

async function queryDevicePermission(name: "camera" | "microphone"): Promise<string | null> {
  try {
    return (await navigator.permissions.query({ name } as unknown as PermissionDescriptor)).state;
  } catch {
    return null; // Not every browser can query device permissions.
  }
}

/**
 * After a joint camera + microphone request failed, which devices to ask for
 * one at a time. A missing or busy device is retried separately. A denial is
 * retried only for a device that is already allowed, or still askable while
 * the other one is blocked, so a dismissed prompt never asks twice more.
 */
export async function devicesWorthRetrying(
  error: unknown,
  query: (name: "camera" | "microphone") => Promise<string | null> = queryDevicePermission
): Promise<{ audio: boolean; video: boolean }> {
  if (captureErrorKind(error) !== "denied") return { audio: true, video: true };
  const [audio, video] = await Promise.all([query("microphone"), query("camera")]);
  const worth = (mine: string | null, other: string | null) => mine === "granted" || (mine === "prompt" && other === "denied");
  return { audio: worth(audio, video), video: worth(video, audio) };
}

// Web implementation backed by agora-rtc-sdk-ng. The SDK is imported
// dynamically so it never runs during Next.js SSR.
// Local end-to-end runs have no Agora project. Opted-in loopback development
// may inject a stand-in SDK; production and remote previews always use Agora.
export function localRtcFixtureAllowed(): boolean {
  return process.env.NODE_ENV === "development"
    && process.env.NEXT_PUBLIC_GIGGLE_LOCAL_RTC_FIXTURE === "1"
    && typeof location !== "undefined"
    && location.protocol === "http:"
    && ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);
}

const loadAgoraSdk = (): Promise<any> => {
  const stand = localRtcFixtureAllowed()
    ? (globalThis as { __GIGGLE_TEST_RTC__?: unknown }).__GIGGLE_TEST_RTC__
    : undefined;
  return stand ? Promise.resolve(stand) : import("agora-rtc-sdk-ng");
};

/** Warm the module only. Devices are still acquired solely on an explicit request. */
export async function preloadVideoSdk(): Promise<void> { await loadAgoraSdk(); }

export function createVideoClient(loadSdk = loadAgoraSdk): VideoClient {
  let client: any = null;
  let sdk: any = null;
  let generation = 0;
  let joining = false;
  let moving = false;
  let channelEpoch = 0;
  let localVideoTrack: any = null;
  let localAudioTrack: any = null;
  let screenTrack: any = null;
  let screenEpoch = 0;
  let cameraEpoch = 0;
  let cameraWanted = false;
  let screenRequest: Promise<void> | null = null;
  let videoQueue: Promise<unknown> = Promise.resolve();
  let localUid: string | number = 0;
  let remotes: RemoteParticipant[] = [];
  let capture: CaptureState = { audio: "off", video: "off" };
  const listeners = new Set<(r: RemoteParticipant[]) => void>();
  const volumeListeners = new Set<(levels: VolumeLevel[]) => void>();
  const connListeners = new Set<(state: ConnectionState) => void>();
  const captureListeners = new Set<(state: CaptureState) => void>();
  const tokenListeners = new Set<() => void>();
  const publishedTracks = new Set<any>();
  const remoteUsers = new Map<string, any>();
  const remoteEpochs = new Map<string, number>();
  const remoteMediaEpochs = new Map<string, number>();
  const remoteState = new Map<string, RemoteParticipant>();
  const mutedRemoteUids = new Set<string>();
  let localPlayback: { track: any; element: unknown } | null = null;
  const remotePlayback = new Map<string, { track: any; element: unknown }>();

  function mapConnState(state: string): ConnectionState | null {
    if (state === "CONNECTED") return "CONNECTED";
    if (state === "RECONNECTING") return "RECONNECTING";
    if (state === "CONNECTING") return "CONNECTING";
    if (state === "DISCONNECTED") return "DISCONNECTED";
    return null;
  }

  function emit() {
    remotes = Array.from(remoteState.values());
    listeners.forEach((cb) => {
      try { cb(remotes); } catch {}
    });
  }

  function setCapture(patch: Partial<CaptureState>) {
    capture = { ...capture, ...patch };
    const snapshot = { ...capture };
    captureListeners.forEach((cb) => {
      try { cb(snapshot); } catch {}
    });
  }

  function closeTrack(track: any) {
    // A failing stop must not prevent close from releasing capture devices.
    try { track?.stop(); } catch {}
    try { track?.close(); } catch {}
  }

  function serialVideo<T>(job: () => Promise<T>): Promise<T> {
    const next = videoQueue.catch(() => {}).then(job);
    videoQueue = next;
    return next;
  }

  async function restoreCamera(owner: any, attempt: number, room: number) {
    if (owner !== client || attempt !== generation || room !== channelEpoch || moving || screenTrack) return;
    const camera = localVideoTrack;
    if (!cameraWanted || capture.video !== "active" || !camera || publishedTracks.has(camera)) return;
    try {
      await owner.publish([camera]);
      if (owner !== client || attempt !== generation || room !== channelEpoch || camera !== localVideoTrack || !cameraWanted) {
        try { await owner.unpublish?.([camera]); } catch {}
        return;
      }
      publishedTracks.add(camera);
    } catch (error) {
      if (owner === client && attempt === generation && camera === localVideoTrack) {
        localVideoTrack = null;
        localPlayback = null;
        closeTrack(camera);
        setCapture({ video: captureErrorKind(error) });
      }
      try { await owner.unpublish?.([camera]); } catch {}
      throw error;
    }
  }

  function stopSharing(restore = true): Promise<void> {
    screenEpoch += 1;
    screenRequest = null;
    const track = screenTrack, owner = client, attempt = generation, room = channelEpoch;
    screenTrack = null;
    closeTrack(track); // Stop capture before awaiting any network or pending publish.
    localPlayback = null;
    if (capture.screen !== undefined) setCapture({ screen: "off", videoSource: "camera" });
    return serialVideo(async () => {
      if (track && owner) { try { await owner.unpublish?.([track]); } catch {} }
      publishedTracks.delete(track);
      if (restore) await restoreCamera(owner, attempt, room);
    });
  }

  function startSharing(): Promise<void> {
    if (!client || joining || moving) return Promise.reject(new Error("Join the call before sharing your screen."));
    if (screenRequest) return screenRequest;
    if (screenTrack && capture.screen === "active") return Promise.resolve();
    if (!sdk?.createScreenVideoTrack) return Promise.reject(new Error("Screen sharing is not supported on this device."));
    const owner = client, attempt = generation, room = channelEpoch, share = ++screenEpoch;
    const current = () => owner === client && attempt === generation && room === channelEpoch && share === screenEpoch && !moving;
    setCapture({ screen: "pending", videoSource: "camera" });
    let requested: Promise<any>;
    try {
      // Invoke the native picker in the original click stack, before any await.
      requested = sdk.createScreenVideoTrack({ optimizationMode: "detail" }, "disable");
    } catch (error) { requested = Promise.reject(error); }
    let owned: any = null;
    const operation = Promise.resolve(requested).then(async result => {
      owned = Array.isArray(result) ? result[0] : result;
      if (Array.isArray(result)) result.slice(1).forEach(closeTrack);
      if (!current()) { closeTrack(owned); throw new Error("Screen sharing cancelled."); }
      if (!owned || owned.getMediaStreamTrack?.().readyState === "ended") throw new Error("The selected screen is no longer available.");
      screenTrack = owned;
      try { owned.on?.("track-ended", () => { if (screenTrack === owned) void stopSharing().catch(() => {}); }); } catch {}
      await serialVideo(async () => {
        if (!current() || screenTrack !== owned) throw new Error("Screen sharing cancelled.");
        const camera = localVideoTrack;
        if (camera && publishedTracks.has(camera)) {
          await owner.unpublish([camera]);
          publishedTracks.delete(camera);
        }
        if (!current() || screenTrack !== owned) throw new Error("Screen sharing cancelled.");
        await owner.publish([owned]);
        if (!current() || screenTrack !== owned) {
          try { await owner.unpublish?.([owned]); } catch {}
          throw new Error("Screen sharing cancelled.");
        }
        publishedTracks.add(owned);
        localPlayback = null;
        setCapture({ screen: "active", videoSource: "screen" });
      });
    }).catch(async error => {
      if (screenTrack === owned) screenTrack = null;
      closeTrack(owned);
      if (owned) { try { await owner.unpublish?.([owned]); } catch {} publishedTracks.delete(owned); }
      if (current()) {
        setCapture({ screen: captureErrorKind(error), videoSource: "camera" });
        await serialVideo(() => restoreCamera(owner, attempt, room));
      }
      throw error;
    }).finally(() => { if (screenRequest === operation) screenRequest = null; });
    screenRequest = operation;
    return operation;
  }

  function resetState() {
    localPlayback = null;
    remotePlayback.clear();
    sdk = null;
    localAudioTrack = null;
    localVideoTrack = null;
    screenTrack = null;
    screenRequest = null;
    screenEpoch += 1;
    cameraEpoch += 1;
    cameraWanted = false;
    videoQueue = Promise.resolve();
    remoteUsers.clear();
    remoteEpochs.clear();
    remoteMediaEpochs.clear();
    remoteState.clear();
    mutedRemoteUids.clear();
    publishedTracks.clear();
    emit();
    setCapture({ audio: "off", video: "off", ...(capture.screen !== undefined ? { screen: "off" as const, videoSource: "camera" as const } : {}) });
  }

  const currentTrack = (kind: "audio" | "video") => kind === "audio" ? localAudioTrack : localVideoTrack;

  /** Own a capture track and notice when its device goes away underneath the call. */
  function adoptTrack(kind: "audio" | "video", track: any) {
    if (kind === "audio") localAudioTrack = track;
    else localVideoTrack = track;
    // Unplugging a device, another app taking it or revoking the permission
    // ends the browser track. Agora keeps the dead track "enabled", so without
    // this the controls would say "on" over a frozen picture for everyone.
    try { track?.on?.("track-ended", () => { void loseTrack(kind, track); }); } catch {}
  }

  async function loseTrack(kind: "audio" | "video", track: any) {
    if (!track || currentTrack(kind) !== track) return;
    if (kind === "audio") localAudioTrack = null;
    else { localVideoTrack = null; localPlayback = null; }
    const wasPublished = publishedTracks.delete(track), owner = client;
    setCapture({ [kind]: "unavailable" });
    // The next "turn on" creates a fresh track from whatever device is present.
    if (wasPublished && owner) { try { await owner.unpublish?.([track]); } catch {} }
    closeTrack(track);
  }

  async function acceptPublication(kind: "audio" | "video", track: any, owner: any) {
    if (currentTrack(kind) === track) {
      publishedTracks.add(track);
      setCapture({ [kind]: "active" });
      return;
    }
    // A device can end while publish is pending. Its late completion must
    // neither revive capture state nor leave the dead track published.
    try { await owner.unpublish?.([track]); } catch {}
    closeTrack(track);
  }

  async function setDeviceEnabled(kind: "audio" | "video", on: boolean) {
    const attempt = generation;
    const cameraAttempt = kind === "video" ? ++cameraEpoch : cameraEpoch;
    if (kind === "video") cameraWanted = on;
    const joinedClient = client, AgoraRTC = sdk;
    const label = kind === "audio" ? "Microphone" : "Camera";
    let track = currentTrack(kind);
    // Only turning on needs the channel. Off is local to the capture track.
    if (on && (!joinedClient || joining || moving)) throw new Error("Video is not connected yet.");
    const assertTrack = () => {
      if (attempt !== generation) throw new Error("Call cancelled.");
      if (kind === "video" && cameraAttempt !== cameraEpoch) throw new Error("Camera request cancelled.");
      if (on && currentTrack(kind) !== track) throw new Error(`${label} was disconnected. Try turning it on again.`);
    };
    if (!track && on) {
      setCapture({ [kind]: "pending" });
      try {
        track = await (kind === "audio" ? AgoraRTC.createMicrophoneAudioTrack() : AgoraRTC.createCameraVideoTrack());
        if (attempt !== generation || kind === "video" && cameraAttempt !== cameraEpoch) throw new Error("Call cancelled.");
        adoptTrack(kind, track);
        if (kind === "video") await serialVideo(async () => { assertTrack();if (!screenTrack) { await joinedClient.publish([track]);assertTrack();publishedTracks.add(track); } });
        else await joinedClient.publish([track]);
        assertTrack();
        if (kind === "audio") publishedTracks.add(track);
      } catch (error) {
        closeTrack(track);
        if (attempt === generation && currentTrack(kind) === track) {
          if (kind === "audio") localAudioTrack = null;
          else localVideoTrack = null;
          setCapture({ [kind]: captureErrorKind(error) });
        }
        throw error;
      }
    } else if (track) {
      try {
        if (kind === "video") await serialVideo(async () => { assertTrack();await setTrackEnabled(track, on, label, true);assertTrack(); });
        else await setTrackEnabled(track, on, label);
      } catch (error) {
        // A camera re-enable captures again and can be refused or find the
        // device busy; report that instead of leaving a silent "off".
        if (on && attempt === generation && currentTrack(kind) === track) setCapture({ [kind]: captureErrorKind(error) });
        throw error;
      }
      assertTrack();
      if (on && !publishedTracks.has(track)) {
        if (kind === "video") await serialVideo(async () => { assertTrack();if (!screenTrack) { await joinedClient.publish([track]);assertTrack();publishedTracks.add(track); } });
        else await joinedClient.publish([track]);
        assertTrack();
        if (kind === "audio") publishedTracks.add(track);
      }
    }
    assertTrack();
    if (kind === "video") localPlayback = null;
    setCapture({ [kind]: on ? "active" : "off" });
  }

  return {
    get supportsScreenShare() { return typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getDisplayMedia === "function"; },
    startScreenShare: startSharing,
    stopScreenShare: () => stopSharing(),
    get remotes() {
      return remotes;
    },
    onRemoteChange(cb) {
      listeners.add(cb);
      cb(remotes);
      return () => listeners.delete(cb);
    },
    onVolumes(cb) {
      volumeListeners.add(cb);
      return () => volumeListeners.delete(cb);
    },
    onConnectionState(cb) {
      connListeners.add(cb);
      return () => connListeners.delete(cb);
    },
    onCaptureState(cb) {
      captureListeners.add(cb);
      cb({ ...capture });
      return () => captureListeners.delete(cb);
    },
    onTokenExpiring(cb) {
      tokenListeners.add(cb);
      return () => tokenListeners.delete(cb);
    },
    async renewToken(token) {
      if (!client || joining || moving) throw new Error("Call is changing rooms.");
      await client.renewToken(token.rtcToken);
    },
    async moveToChannel(token) {
      if (!client || joining || moving) throw new Error("Video is not connected yet.");
      moving = true;
      const attempt = generation, movingClient = client;
      const assertCurrent = () => {
        if (attempt !== generation || client !== movingClient) throw new Error("Call cancelled.");
      };
      try {
        await stopSharing(false);
        assertCurrent();
        channelEpoch += 1;
        // Stop listening to the old room before joining the next one. Capture
        // and its on/off choices stay owned by this client throughout the move.
        for (const user of remoteUsers.values()) { try { user.audioTrack?.stop(); } catch {} }
        await movingClient.leave();
        assertCurrent();
        remoteUsers.clear(); remoteEpochs.clear(); remoteMediaEpochs.clear(); remoteState.clear();
        mutedRemoteUids.clear(); remotePlayback.clear(); publishedTracks.clear();
        emit();
        localUid = token.uid;
        await movingClient.join(token.appId, token.channelName, token.rtcToken, token.uid);
        assertCurrent();
        const tracks = [capture.audio === "active" ? localAudioTrack : null, capture.video === "active" ? localVideoTrack : null].filter(Boolean);
        if (tracks.length) await movingClient.publish(tracks);
        assertCurrent();
        tracks.forEach(track => publishedTracks.add(track));
      } catch (error) {
        try { await movingClient.leave(); } catch {}
        throw error;
      } finally {
        if (attempt === generation) moving = false;
      }
    },
    async join(token: AgoraToken, opts = { audio: true, video: true }) {
      if (joining || client) throw new Error("This client is already joining or in a call.");
      joining = true;
      cameraWanted = !!opts.video;
      const joinedGeneration = ++generation;
      const assertCurrent = () => {
        if (joinedGeneration !== generation) throw new Error("Call cancelled.");
      };
      let ownedClient: any = null;
      let ownedAudio: any = null;
      let ownedVideo: any = null;
      localUid = token.uid;
      setCapture({
        audio: opts.audio ? "pending" : "off",
        video: opts.video ? "pending" : "off",
      });

      try {
        const mod = await loadSdk();
        assertCurrent();
        const AgoraRTC = mod.default ?? mod;
        sdk = AgoraRTC;
        try { AgoraRTC.setLogLevel?.(4); } catch {}
        try { AgoraRTC.disableLogUpload?.(); } catch {}
        client = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });

        const joinedClient = client;
        ownedClient = joinedClient;
        client.on("user-joined", (user: any) => {
          if (joinedGeneration !== generation) return;
          const key = String(user.uid);
          remoteUsers.set(key, user);
          remoteState.set(key, mergeRemoteParticipant(remoteState.get(key), user.uid, {
            mutedForMe: mutedRemoteUids.has(key),
          }));
          emit();
        });
        client.on("user-published", async (user: any, mediaType: "video" | "audio") => {
          if (joinedGeneration !== generation) return;
          // A UID can rejoin while its previous subscription is still resolving.
          const key = String(user.uid), epoch = remoteEpochs.get(key) ?? 0, room = channelEpoch;
          const mediaKey = `${key}:${mediaType}`, mediaEpoch = remoteMediaEpochs.get(mediaKey) ?? 0;
          try { await joinedClient.subscribe(user, mediaType); } catch { return; }
          if (joinedGeneration !== generation || room !== channelEpoch || epoch !== (remoteEpochs.get(key) ?? 0)) return;
          if (mediaEpoch !== (remoteMediaEpochs.get(mediaKey) ?? 0)) return;
          if (mediaType === "video" ? user.hasVideo === false : user.hasAudio === false) return;
          remoteUsers.set(String(user.uid), user);
          const previous = remoteState.get(String(user.uid));
          remoteState.set(String(user.uid), mergeRemoteParticipant(previous, user.uid, {
            [mediaType === "video" ? "hasVideo" : "hasAudio"]: true,
            ...(mutedRemoteUids.has(String(user.uid)) ? { mutedForMe: true } : {}),
          }));
          if (mediaType === "audio" && user.audioTrack) {
            // Set volume before playback so a re-published track never leaks sound.
            user.audioTrack.setVolume(mutedRemoteUids.has(String(user.uid)) ? 0 : 100);
            user.audioTrack.play();
          }
          emit();
        });
        client.on("user-unpublished", (user: any, mediaType: "video" | "audio") => {
          if (joinedGeneration !== generation) return;
          const mediaKey = `${String(user.uid)}:${mediaType}`;
          remoteMediaEpochs.set(mediaKey, (remoteMediaEpochs.get(mediaKey) ?? 0) + 1);
          if (mediaType === "video") remotePlayback.delete(String(user.uid));
          remoteUsers.set(String(user.uid), user);
          const previous = remoteState.get(String(user.uid));
          remoteState.set(String(user.uid), mergeRemoteParticipant(previous, user.uid, {
            [mediaType === "video" ? "hasVideo" : "hasAudio"]: false,
          }));
          emit();
        });
        client.on("user-left", (user: any) => {
          if (joinedGeneration !== generation) return;
          const key = String(user.uid);
          remoteEpochs.set(key, (remoteEpochs.get(key) ?? 0) + 1);
          remoteUsers.delete(String(user.uid));
          remoteState.delete(String(user.uid));
          remotePlayback.delete(String(user.uid));
          emit();
        });
        client.on("connection-state-change", (current: string) => {
          if (joinedGeneration !== generation) return;
          if (moving && current === "DISCONNECTED") return;
          const mapped = mapConnState(String(current));
          if (mapped) connListeners.forEach((cb) => {
            try { cb(mapped); } catch {}
          });
        });
        for (const event of ["token-privilege-will-expire", "token-privilege-did-expire"]) {
          client.on(event, () => {
            if (joinedGeneration === generation) tokenListeners.forEach(cb => { try { cb(); } catch {} });
          });
        }
        try {
          client.enableAudioVolumeIndicator?.();
          client.on("volume-indicator", (volumes: { uid: string | number; level: number }[]) => {
            if (joinedGeneration !== generation) return;
            const levels: VolumeLevel[] = (volumes ?? []).map((volume) => ({
              uid: String(volume.uid) === "0" ? localUid : volume.uid,
              level: volume.level,
            }));
            volumeListeners.forEach((cb) => {
              try { cb(levels); } catch {}
            });
          });
        } catch {}

        // A joint acquisition asks once and overlaps device startup with the
        // channel handshake. Late permission results remain cancellation-safe.
        const combined = opts.audio && opts.video && AgoraRTC.createMicrophoneAndCameraTracks
          ? AgoraRTC.createMicrophoneAndCameraTracks().then((tracks: any[]) => {
              [ownedAudio, ownedVideo] = tracks;
              if (joinedGeneration !== generation) { closeTrack(ownedAudio); closeTrack(ownedVideo); }
              return null;
            }).catch((error: unknown) => error)
          : null;
        await joinedClient.join(token.appId, token.channelName, token.rtcToken, token.uid);
        assertCurrent();

        let separately = { audio: !!opts.audio && !combined, video: !!opts.video && !combined };
        if (combined) {
          const captureError = await combined;
          assertCurrent();
          if (captureError) {
            // A joint request fails as a whole. A missing camera, a busy one or
            // a blocked one must not also silence a working microphone.
            separately = await devicesWorthRetrying(captureError);
            assertCurrent();
            for (const kind of ["audio", "video"] as const) {
              if (!separately[kind]) setCapture({ [kind]: captureErrorKind(captureError) });
            }
          } else try {
            adoptTrack("audio", ownedAudio); adoptTrack("video", ownedVideo);
            await joinedClient.publish([ownedAudio, ownedVideo]);
            assertCurrent();
            await acceptPublication("audio", ownedAudio, joinedClient);
            assertCurrent();
            await acceptPublication("video", ownedVideo, joinedClient);
            assertCurrent();
          } catch (error) {
            closeTrack(ownedAudio); closeTrack(ownedVideo);
            assertCurrent();
            localAudioTrack = null; localVideoTrack = null;
            setCapture({ audio: captureErrorKind(error), video: captureErrorKind(error) });
          }
        }
        if (separately.audio) {
          try {
            ownedAudio = await AgoraRTC.createMicrophoneAudioTrack();
            assertCurrent();
            adoptTrack("audio", ownedAudio);
            await joinedClient.publish([ownedAudio]);
            assertCurrent();
            await acceptPublication("audio", ownedAudio, joinedClient);
            assertCurrent();
          } catch (error) {
            closeTrack(ownedAudio);
            assertCurrent();
            localAudioTrack = null;
            setCapture({ audio: captureErrorKind(error) });
          }
        }
        if (separately.video) {
          try {
            ownedVideo = await AgoraRTC.createCameraVideoTrack();
            assertCurrent();
            adoptTrack("video", ownedVideo);
            await joinedClient.publish([ownedVideo]);
            assertCurrent();
            await acceptPublication("video", ownedVideo, joinedClient);
            assertCurrent();
          } catch (error) {
            closeTrack(ownedVideo);
            assertCurrent();
            localVideoTrack = null;
            setCapture({ video: captureErrorKind(error) });
          }
        }
      } catch (error) {
        if (joinedGeneration === generation) {
          generation += 1;
          client = null;
          joining = false;
          resetState();
        }
        closeTrack(ownedAudio);
        closeTrack(ownedVideo);
        try { ownedClient?.removeAllListeners?.(); } catch {}
        try { await ownedClient?.leave(); } catch {}
        throw error;
      } finally {
        if (joinedGeneration === generation) joining = false;
      }
    },
    async leave() {
      generation += 1;
      const leavingClient = client;
      const audio = localAudioTrack, video = localVideoTrack, screen = screenTrack;
      client = null;
      joining = false;
      moving = false;
      channelEpoch += 1;
      // Clear synchronously: a later leave completion cannot clear a new call.
      resetState();
      closeTrack(video);
      closeTrack(screen);
      closeTrack(audio);
      try { leavingClient?.removeAllListeners?.(); } catch {}
      try { await leavingClient?.leave(); } catch {}
    },
    async setMicEnabled(on: boolean) {
      await setDeviceEnabled("audio", on);
    },
    async setCamEnabled(on: boolean) {
      await setDeviceEnabled("video", on);
    },
    async setRemoteAudioMuted(uid, muted) {
      const key = String(uid);
      const previous = remoteState.get(key);
      if (!client || !previous || key === String(localUid)) throw new Error("This person is not connected.");
      const track = remoteUsers.get(key)?.audioTrack;
      if (track) track.setVolume(muted ? 0 : 100);
      if (muted) mutedRemoteUids.add(key);
      else mutedRemoteUids.delete(key);
      remoteState.set(key, mergeRemoteParticipant(previous, previous.uid, { mutedForMe: muted }));
      emit();
    },
    playLocal(el?: unknown) {
      const track = capture.screen === "active" ? screenTrack : localVideoTrack;
      if (!track || !el) return;
      if (localPlayback && localPlayback.track === track && localPlayback.element === el) return;
      track.play(el as HTMLElement);
      localPlayback = { track, element: el };
    },
    playRemote(uid, el?: unknown) {
      const key = String(uid), track = remoteUsers.get(key)?.videoTrack;
      if (!track || !el) return;
      const current = remotePlayback.get(key);
      if (current && current.track === track && current.element === el) return;
      track.play(el as HTMLElement);
      remotePlayback.set(key, { track, element: el });
    },
  };
}

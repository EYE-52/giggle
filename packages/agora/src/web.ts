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

// Web implementation backed by agora-rtc-sdk-ng. The SDK is imported
// dynamically so it never runs during Next.js SSR.
// Local end-to-end runs have no Agora project; they inject a stand-in SDK on
// the page before the app loads. Real sessions always load agora-rtc-sdk-ng.
const loadAgoraSdk = (): Promise<any> => {
  const stand = (globalThis as { __GIGGLE_TEST_RTC__?: unknown }).__GIGGLE_TEST_RTC__;
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

  function resetState() {
    localPlayback = null;
    remotePlayback.clear();
    sdk = null;
    localAudioTrack = null;
    localVideoTrack = null;
    remoteUsers.clear();
    remoteEpochs.clear();
    remoteState.clear();
    mutedRemoteUids.clear();
    publishedTracks.clear();
    emit();
    setCapture({ audio: "off", video: "off" });
  }

  async function setDeviceEnabled(kind: "audio" | "video", on: boolean) {
    const attempt = generation;
    const joinedClient = client, AgoraRTC = sdk;
    if (!joinedClient || joining || moving) throw new Error("Video is not connected yet.");
    const label = kind === "audio" ? "Microphone" : "Camera";
    let track = kind === "audio" ? localAudioTrack : localVideoTrack;
    if (!track && on) {
      setCapture({ [kind]: "pending" });
      try {
        track = await (kind === "audio" ? AgoraRTC.createMicrophoneAudioTrack() : AgoraRTC.createCameraVideoTrack());
        if (attempt !== generation) throw new Error("Call cancelled.");
        if (kind === "audio") localAudioTrack = track;
        else localVideoTrack = track;
        await joinedClient.publish([track]);
        if (attempt !== generation) throw new Error("Call cancelled.");
        publishedTracks.add(track);
      } catch (error) {
        closeTrack(track);
        if (attempt === generation) {
          if (kind === "audio") localAudioTrack = null;
          else localVideoTrack = null;
          setCapture({ [kind]: captureErrorKind(error) });
        }
        throw error;
      }
    } else if (track) {
      await setTrackEnabled(track, on, label, kind === "video");
      if (attempt !== generation) throw new Error("Call cancelled.");
      if (on && !publishedTracks.has(track)) {
        await joinedClient.publish([track]);
        if (attempt !== generation) throw new Error("Call cancelled.");
        publishedTracks.add(track);
      }
    }
    if (attempt !== generation) throw new Error("Call cancelled.");
    if (kind === "video") localPlayback = null;
    setCapture({ [kind]: on ? "active" : "off" });
  }

  return {
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
      channelEpoch += 1;
      const assertCurrent = () => {
        if (attempt !== generation || client !== movingClient) throw new Error("Call cancelled.");
      };
      try {
        // Stop listening to the old room before joining the next one. Capture
        // and its on/off choices stay owned by this client throughout the move.
        for (const user of remoteUsers.values()) { try { user.audioTrack?.stop(); } catch {} }
        await movingClient.leave();
        assertCurrent();
        remoteUsers.clear(); remoteEpochs.clear(); remoteState.clear();
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
          try { await joinedClient.subscribe(user, mediaType); } catch { return; }
          if (joinedGeneration !== generation || room !== channelEpoch || epoch !== (remoteEpochs.get(key) ?? 0)) return;
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

        if (combined) {
          const captureError = await combined;
          assertCurrent();
          try {
            if (captureError) throw captureError;
            localAudioTrack = ownedAudio; localVideoTrack = ownedVideo;
            await joinedClient.publish([ownedAudio, ownedVideo]);
            assertCurrent();
            publishedTracks.add(ownedAudio); publishedTracks.add(ownedVideo);
            setCapture({ audio: "active", video: "active" });
          } catch (error) {
            closeTrack(ownedAudio); closeTrack(ownedVideo);
            assertCurrent();
            localAudioTrack = null; localVideoTrack = null;
            setCapture({ audio: captureErrorKind(error), video: captureErrorKind(error) });
          }
        }
        if (opts.audio && !combined) {
          try {
            ownedAudio = await AgoraRTC.createMicrophoneAudioTrack();
            assertCurrent();
            localAudioTrack = ownedAudio;
            await joinedClient.publish([ownedAudio]);
            assertCurrent();
            publishedTracks.add(ownedAudio);
            setCapture({ audio: "active" });
          } catch (error) {
            closeTrack(ownedAudio);
            assertCurrent();
            localAudioTrack = null;
            setCapture({ audio: captureErrorKind(error) });
          }
        }
        if (opts.video && !combined) {
          try {
            ownedVideo = await AgoraRTC.createCameraVideoTrack();
            assertCurrent();
            localVideoTrack = ownedVideo;
            await joinedClient.publish([ownedVideo]);
            assertCurrent();
            publishedTracks.add(ownedVideo);
            setCapture({ video: "active" });
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
      const audio = localAudioTrack, video = localVideoTrack;
      client = null;
      joining = false;
      moving = false;
      channelEpoch += 1;
      // Clear synchronously: a later leave completion cannot clear a new call.
      resetState();
      closeTrack(video);
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
      if (!localVideoTrack || !el) return;
      if (localPlayback && localPlayback.track === localVideoTrack && localPlayback.element === el) return;
      localVideoTrack.play(el as HTMLElement);
      localPlayback = { track: localVideoTrack, element: el };
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

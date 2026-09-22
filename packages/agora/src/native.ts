import { mergeRemoteParticipant } from "./types.ts";
import type {
  AgoraToken,
  CaptureState,
  ConnectionState,
  RemoteParticipant,
  VideoClient,
  VideoDimensions,
  VolumeLevel,
} from "./types";

export function mapNativeConnectionState(state: number): ConnectionState | null {
  if (state === 1 || state === 5) return "DISCONNECTED";
  if (state === 2) return "CONNECTING";
  if (state === 3) return "CONNECTED";
  if (state === 4) return "RECONNECTING";
  return null;
}

export { mergeRemoteParticipant } from "./types.ts";

export function normalizeNativeVolume(
  localUid: string | number,
  speaker: { uid?: number; volume?: number }
): VolumeLevel {
  return {
    uid: speaker.uid === 0 ? localUid : speaker.uid ?? 0,
    level: Math.round(((speaker.volume ?? 0) / 255) * 100),
  };
}

/** Normalize one Agora video-size event into layout dimensions. */
export function normalizeNativeVideoDimensions(
  localUid: string | number,
  uid: number,
  width: number,
  height: number,
  rotation: number,
): VideoDimensions | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  if (!Number.isFinite(rotation)) return null;
  const rotated = rotation === 90 || rotation === 270;
  return {
    uid: uid === 0 ? localUid : uid,
    width: rotated ? height : width,
    height: rotated ? width : height,
  };
}

function assertAgoraResult(result: unknown, action: string) {
  if (typeof result === "number" && result < 0) {
    throw new Error(`${action} failed (${result}).`);
  }
}

// Native implementation backed by react-native-agora. Screens render video via
// <RtcSurfaceView canvas={{ uid }} /> — uid 0 is the local user.
export function createVideoClient(loadSdk = () => require("react-native-agora")): VideoClient {
  // Lazy require keeps the web bundle away from the native module.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Agora = loadSdk();
  const {
    ChannelProfileType,
    ClientRoleType,
    ConnectionStateType,
    LocalAudioStreamState,
    LocalVideoStreamState,
    PermissionType,
    RemoteAudioState,
    RemoteVideoState,
  } = Agora;

  let engine: any = null;
  let localUid: string | number = 0;
  let remotes: RemoteParticipant[] = [];
  let capture: CaptureState = { audio: "off", video: "off" };
  let connection: ConnectionState = "DISCONNECTED";
  let micEnabled = true;
  let camEnabled = true;
  let registeredHandler: any = null;
  let videoGeneration = 0;
  let cancelJoin: (() => void) | null = null;
  const remoteByUid = new Map<number, RemoteParticipant>();
  const remoteListeners = new Set<(r: RemoteParticipant[]) => void>();
  const volumeListeners = new Set<(levels: VolumeLevel[]) => void>();
  const connectionListeners = new Set<(state: ConnectionState) => void>();
  const captureListeners = new Set<(state: CaptureState) => void>();
  const dimensionsByUid = new Map<string, VideoDimensions>();
  const dimensionListeners = new Set<(dimensions: VideoDimensions[]) => void>();

  function emitRemotes() {
    remotes = Array.from(remoteByUid.values());
    remoteListeners.forEach((cb) => {
      try { cb(remotes); } catch {}
    });
  }

  function updateRemote(uid: number, patch: Partial<Pick<RemoteParticipant, "hasVideo" | "hasAudio" | "mutedForMe">>) {
    remoteByUid.set(uid, mergeRemoteParticipant(remoteByUid.get(uid), uid, patch));
    emitRemotes();
  }

  function removeRemote(uid: number) {
    remoteByUid.delete(uid);
    if (dimensionsByUid.delete(String(uid))) emitDimensions();
    emitRemotes();
  }

  function emitConnection(next: ConnectionState) {
    connection = next;
    connectionListeners.forEach((cb) => {
      try { cb(connection); } catch {}
    });
  }

  function emitDimensions() {
    const snapshot = Array.from(dimensionsByUid.values());
    dimensionListeners.forEach((cb) => { try { cb(snapshot); } catch {} });
  }

  function updateDimensions(uid: number, width: number, height: number, rotation: number) {
    const next = normalizeNativeVideoDimensions(localUid, uid, width, height, rotation);
    if (!next) return;
    const key = String(uid);
    const previous = dimensionsByUid.get(key);
    if (previous && previous.width === next.width && previous.height === next.height) return;
    dimensionsByUid.set(key, next);
    emitDimensions();
  }

  function setCapture(patch: Partial<CaptureState>) {
    capture = { ...capture, ...patch };
    const snapshot = { ...capture };
    captureListeners.forEach((cb) => {
      try { cb(snapshot); } catch {}
    });
  }

  return {
    get remotes() {
      return remotes;
    },
    onRemoteChange(cb) {
      remoteListeners.add(cb);
      cb(remotes);
      return () => remoteListeners.delete(cb);
    },
    onVolumes(cb) {
      volumeListeners.add(cb);
      return () => volumeListeners.delete(cb);
    },
    onConnectionState(cb) {
      connectionListeners.add(cb);
      cb(connection);
      return () => connectionListeners.delete(cb);
    },
    onCaptureState(cb) {
      captureListeners.add(cb);
      cb({ ...capture });
      return () => captureListeners.delete(cb);
    },
    onVideoDimensions(cb) {
      dimensionListeners.add(cb);
      cb(Array.from(dimensionsByUid.values()));
      return () => dimensionListeners.delete(cb);
    },
    async join(token: AgoraToken, opts = { audio: true, video: true }) {
      if (engine || cancelJoin) throw new Error("This client is already joining or in a call.");
      const generation = ++videoGeneration;
      localUid = token.uid;
      micEnabled = !!opts.audio;
      camEnabled = !!opts.video;
      setCapture({
        audio: opts.audio ? "pending" : "off",
        video: opts.video ? "pending" : "off",
      });
      dimensionsByUid.clear();
      emitDimensions();
      emitConnection("CONNECTING");

      let settled = false;
      let resolveJoin: () => void = () => {};
      let rejectJoin: (error: Error) => void = () => {};
      const joined = new Promise<void>((resolve, reject) => {
        resolveJoin = () => {
          if (settled) return;
          settled = true;
          resolve();
        };
        rejectJoin = (error) => {
          if (settled) return;
          settled = true;
          reject(error);
        };
      });

      const cancelThisJoin = () => rejectJoin(new Error("Call cancelled."));
      cancelJoin = cancelThisJoin;
      const timeout = setTimeout(
        () => rejectJoin(new Error("Video connection timed out.")),
        15_000
      );

      try {
        engine = Agora.createAgoraRtcEngine();
        assertAgoraResult(engine.initialize({ appId: token.appId }), "Agora initialization");
        registeredHandler = {
          onJoinChannelSuccess: () => {
            emitConnection("CONNECTED");
            resolveJoin();
          },
          onError: (code: number, message: string) => {
            if (code === 9 || code === 1501) return;
            rejectJoin(new Error(message || `Agora error ${code}.`));
          },
          onUserJoined: (_connection: unknown, uid: number) => updateRemote(uid, {}),
          onUserOffline: (_connection: unknown, uid: number) => removeRemote(uid),
          onRemoteVideoStateChanged: (_connection: unknown, uid: number, state: number) => {
            updateRemote(uid, {
              hasVideo:
                state === RemoteVideoState.RemoteVideoStateStarting ||
                state === RemoteVideoState.RemoteVideoStateDecoding ||
                state === RemoteVideoState.RemoteVideoStateFrozen,
            });
          },
          onVideoSizeChanged: (_connection: unknown, _sourceType: unknown, uid: number, width: number, height: number, rotation: number) => {
            if (generation === videoGeneration && engine) updateDimensions(uid, width, height, rotation);
          },
          onRemoteAudioStateChanged: (_connection: unknown, uid: number, state: number) => {
            updateRemote(uid, {
              hasAudio:
                state === RemoteAudioState.RemoteAudioStateStarting ||
                state === RemoteAudioState.RemoteAudioStateDecoding ||
                state === RemoteAudioState.RemoteAudioStateFrozen,
            });
          },
          onConnectionStateChanged: (_connection: unknown, state: number) => {
            const mapped = mapNativeConnectionState(state);
            if (mapped) emitConnection(mapped);
            if (state === ConnectionStateType.ConnectionStateFailed) {
              rejectJoin(new Error("Video connection failed."));
            }
          },
          onAudioVolumeIndication: (
            _connection: unknown,
            speakers: { uid?: number; volume?: number }[]
          ) => {
            const levels = (speakers ?? []).map((speaker) => normalizeNativeVolume(localUid, speaker));
            volumeListeners.forEach((cb) => {
              try { cb(levels); } catch {}
            });
          },
          onPermissionError: (permission: number) => {
            if (permission === PermissionType.RecordAudio) setCapture({ audio: "denied" });
            if (permission === PermissionType.Camera) setCapture({ video: "denied" });
          },
          onLocalAudioStateChanged: (_connection: unknown, state: number) => {
            if (state === LocalAudioStreamState.LocalAudioStreamStateEncoding) {
              setCapture({ audio: micEnabled ? "active" : "off" });
            } else if (state === LocalAudioStreamState.LocalAudioStreamStateStopped) {
              setCapture({ audio: "off" });
            } else if (
              state === LocalAudioStreamState.LocalAudioStreamStateFailed &&
              capture.audio !== "denied"
            ) {
              setCapture({ audio: "unavailable" });
            }
          },
          onLocalVideoStateChanged: (_source: unknown, state: number) => {
            if (
              state === LocalVideoStreamState.LocalVideoStreamStateCapturing ||
              state === LocalVideoStreamState.LocalVideoStreamStateEncoding
            ) {
              setCapture({ video: camEnabled ? "active" : "off" });
            } else if (state === LocalVideoStreamState.LocalVideoStreamStateStopped) {
              setCapture({ video: "off" });
            } else if (
              state === LocalVideoStreamState.LocalVideoStreamStateFailed &&
              capture.video !== "denied"
            ) {
              setCapture({ video: "unavailable" });
            }
          },
        };
        // Native callbacks can already be queued when a handler is removed.
        // Bind every callback to the call that registered it.
        registeredHandler = Object.fromEntries(Object.entries(registeredHandler).map(([name, handler]) => [
          name, (...args: unknown[]) => {
            if (generation !== videoGeneration || !engine) return;
            return (handler as (...values: unknown[]) => void)(...args);
          },
        ]));
        engine.registerEventHandler(registeredHandler);

        let publishCameraTrack = !!opts.video;
        if (publishCameraTrack) {
          try {
            assertAgoraResult(engine.enableVideo(), "Enable camera");
            assertAgoraResult(engine.startPreview(), "Camera preview");
          } catch {
            publishCameraTrack = false;
            setCapture({ video: "unavailable" });
          }
        }
        try { engine.enableAudioVolumeIndication(200, 3, true); } catch {}
        assertAgoraResult(
          engine.setChannelProfile(ChannelProfileType.ChannelProfileCommunication),
          "Channel profile"
        );
        assertAgoraResult(
          engine.joinChannel(token.rtcToken, token.channelName, token.uid, {
            clientRoleType: ClientRoleType.ClientRoleBroadcaster,
            publishMicrophoneTrack: !!opts.audio,
            publishCameraTrack,
            autoSubscribeAudio: true,
            autoSubscribeVideo: true,
          }),
          "Join channel"
        );

        await joined;
      } catch (error) {
        if (generation !== videoGeneration) throw error;
        videoGeneration += 1;
        try { engine?.leaveChannel(); } catch {}
        try { if (registeredHandler) engine?.unregisterEventHandler(registeredHandler); } catch {}
        registeredHandler = null;
        try { engine?.release(); } catch {}
        engine = null;
        remoteByUid.clear();
        dimensionsByUid.clear();
        emitRemotes();
        emitDimensions();
        setCapture({
          audio: capture.audio === "denied" || capture.audio === "unavailable" ? capture.audio : "off",
          video: capture.video === "denied" || capture.video === "unavailable" ? capture.video : "off",
        });
        emitConnection("DISCONNECTED");
        throw error;
      } finally {
        clearTimeout(timeout);
        if (cancelJoin === cancelThisJoin) cancelJoin = null;
      }
    },
    async leave() {
      videoGeneration += 1;
      const leavingEngine = engine, leavingHandler = registeredHandler;
      engine = null;
      registeredHandler = null;
      const cancel = cancelJoin;
      cancelJoin = null;
      cancel?.();
      // Release still runs if either leave or handler removal fails.
      try { leavingEngine?.leaveChannel(); } catch {}
      try { if (leavingHandler) leavingEngine?.unregisterEventHandler(leavingHandler); } catch {}
      try { leavingEngine?.release(); } catch {}
      remoteByUid.clear();
      dimensionsByUid.clear();
      emitRemotes();
      emitDimensions();
      setCapture({ audio: "off", video: "off" });
      emitConnection("DISCONNECTED");
    },
    async setMicEnabled(on: boolean) {
      if (!engine) throw new Error("Microphone is unavailable.");
      assertAgoraResult(engine.muteLocalAudioStream(!on), "Microphone update");
      micEnabled = on;
      setCapture({ audio: on ? "pending" : "off" });
    },
    async setCamEnabled(on: boolean) {
      if (!engine) throw new Error("Camera is unavailable.");
      assertAgoraResult(engine.muteLocalVideoStream(!on), "Camera update");
      if (on) assertAgoraResult(engine.startPreview(), "Camera preview");
      else assertAgoraResult(engine.stopPreview(), "Stop camera preview");
      camEnabled = on;
      setCapture({ video: on ? "pending" : "off" });
    },
    async setRemoteAudioMuted(uid, muted) {
      const remoteUid = Number(uid);
      if (!engine || !Number.isSafeInteger(remoteUid) || !remoteByUid.has(remoteUid) || String(uid) === String(localUid)) {
        throw new Error("This person is not connected.");
      }
      // Playback gain does not change the sender's microphone or subscription.
      assertAgoraResult(engine.adjustUserPlaybackSignalVolume(remoteUid, muted ? 0 : 100), "Listening update");
      updateRemote(remoteUid, { mutedForMe: muted });
    },
    async switchCamera() {
      if (!engine) throw new Error("Camera is unavailable.");
      assertAgoraResult(engine.switchCamera(), "Switch camera");
    },
    playLocal() {
      /* Render <RtcSurfaceView canvas={{ uid: 0 }} /> in the screen. */
    },
    playRemote() {
      /* Render <RtcSurfaceView canvas={{ uid }} /> in the screen. */
    },
  };
}

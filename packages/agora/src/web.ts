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
  return name === "NotAllowedError" || name === "SecurityError"
    ? "denied"
    : "unavailable";
}

export async function setTrackEnabled(
  track: { setMuted?: (muted: boolean) => Promise<void>; setEnabled?: (on: boolean) => Promise<void> } | null,
  on: boolean,
  label: string
): Promise<void> {
  if (!track) throw new Error(`${label} is unavailable.`);
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
export function createVideoClient(loadSdk = () => import("agora-rtc-sdk-ng")): VideoClient {
  let client: any = null;
  let generation = 0;
  let joining = false;
  let localVideoTrack: any = null;
  let localAudioTrack: any = null;
  let localUid: string | number = 0;
  let remotes: RemoteParticipant[] = [];
  let capture: CaptureState = { audio: "off", video: "off" };
  const listeners = new Set<(r: RemoteParticipant[]) => void>();
  const volumeListeners = new Set<(levels: VolumeLevel[]) => void>();
  const connListeners = new Set<(state: ConnectionState) => void>();
  const captureListeners = new Set<(state: CaptureState) => void>();
  const remoteUsers = new Map<string, any>();
  const remoteState = new Map<string, RemoteParticipant>();

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
    localAudioTrack = null;
    localVideoTrack = null;
    remoteUsers.clear();
    remoteState.clear();
    emit();
    setCapture({ audio: "off", video: "off" });
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
        try { AgoraRTC.setLogLevel?.(4); } catch {}
        try { AgoraRTC.disableLogUpload?.(); } catch {}
        client = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });

        const joinedClient = client;
        ownedClient = joinedClient;
        client.on("user-published", async (user: any, mediaType: "video" | "audio") => {
          if (joinedGeneration !== generation) return;
          try { await joinedClient.subscribe(user, mediaType); } catch { return; }
          if (joinedGeneration !== generation) return;
          remoteUsers.set(String(user.uid), user);
          const previous = remoteState.get(String(user.uid));
          remoteState.set(String(user.uid), mergeRemoteParticipant(previous, user.uid, {
            [mediaType === "video" ? "hasVideo" : "hasAudio"]: true,
          }));
          if (mediaType === "audio" && user.audioTrack) {
            // Set volume before playback so a re-published track never leaks sound.
            user.audioTrack.setVolume(previous?.mutedForMe ? 0 : 100);
            user.audioTrack.play();
          }
          emit();
        });
        client.on("user-unpublished", (user: any, mediaType: "video" | "audio") => {
          if (joinedGeneration !== generation) return;
          remoteUsers.set(String(user.uid), user);
          const previous = remoteState.get(String(user.uid));
          remoteState.set(String(user.uid), mergeRemoteParticipant(previous, user.uid, {
            [mediaType === "video" ? "hasVideo" : "hasAudio"]: false,
          }));
          emit();
        });
        client.on("user-left", (user: any) => {
          if (joinedGeneration !== generation) return;
          remoteUsers.delete(String(user.uid));
          remoteState.delete(String(user.uid));
          emit();
        });
        client.on("connection-state-change", (current: string) => {
          if (joinedGeneration !== generation) return;
          const mapped = mapConnState(String(current));
          if (mapped) connListeners.forEach((cb) => {
            try { cb(mapped); } catch {}
          });
        });
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

        await joinedClient.join(token.appId, token.channelName, token.rtcToken, token.uid);
        assertCurrent();

        if (opts.audio) {
          try {
            ownedAudio = await AgoraRTC.createMicrophoneAudioTrack();
            assertCurrent();
            localAudioTrack = ownedAudio;
            await joinedClient.publish([ownedAudio]);
            assertCurrent();
            setCapture({ audio: "active" });
          } catch (error) {
            closeTrack(ownedAudio);
            assertCurrent();
            localAudioTrack = null;
            setCapture({ audio: captureErrorKind(error) });
          }
        }
        if (opts.video) {
          try {
            ownedVideo = await AgoraRTC.createCameraVideoTrack();
            assertCurrent();
            localVideoTrack = ownedVideo;
            await joinedClient.publish([ownedVideo]);
            assertCurrent();
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
      // Clear synchronously: a later leave completion cannot clear a new call.
      resetState();
      closeTrack(video);
      closeTrack(audio);
      try { leavingClient?.removeAllListeners?.(); } catch {}
      try { await leavingClient?.leave(); } catch {}
    },
    async setMicEnabled(on: boolean) {
      const attempt = generation;
      await setTrackEnabled(localAudioTrack, on, "Microphone");
      if (attempt !== generation) throw new Error("Call cancelled.");
      setCapture({ audio: on ? "active" : "off" });
    },
    async setCamEnabled(on: boolean) {
      const attempt = generation;
      await setTrackEnabled(localVideoTrack, on, "Camera");
      if (attempt !== generation) throw new Error("Call cancelled.");
      setCapture({ video: on ? "active" : "off" });
    },
    async setRemoteAudioMuted(uid, muted) {
      const key = String(uid);
      const previous = remoteState.get(key);
      if (!client || !previous || key === String(localUid)) throw new Error("This person is not connected.");
      const track = remoteUsers.get(key)?.audioTrack;
      if (track) track.setVolume(muted ? 0 : 100);
      remoteState.set(key, mergeRemoteParticipant(previous, previous.uid, { mutedForMe: muted }));
      emit();
    },
    playLocal(el?: unknown) {
      if (localVideoTrack && el) localVideoTrack.play(el as HTMLElement);
    },
    playRemote(uid, el?: unknown) {
      const user = remoteUsers.get(String(uid));
      if (user?.videoTrack && el) user.videoTrack.play(el as HTMLElement);
    },
  };
}

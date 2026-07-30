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
export function createVideoClient(): VideoClient {
  let client: any = null;
  let AgoraRTC: any = null;
  let localVideoTrack: any = null;
  let localAudioTrack: any = null;
  let localUid: string | number = 0;
  let remotes: RemoteParticipant[] = [];
  let capture: CaptureState = { audio: "off", video: "off" };
  const listeners = new Set<(r: RemoteParticipant[]) => void>();
  const volumeListeners = new Set<(levels: VolumeLevel[]) => void>();
  const connListeners = new Set<(state: ConnectionState) => void>();
  const captureListeners = new Set<(state: CaptureState) => void>();
  const remoteUsers = new Map<string | number, any>();
  const remoteState = new Map<string | number, RemoteParticipant>();

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
      localUid = token.uid;
      setCapture({
        audio: opts.audio ? "pending" : "off",
        video: opts.video ? "pending" : "off",
      });

      const mod = await import("agora-rtc-sdk-ng");
      AgoraRTC = mod.default ?? mod;
      try { AgoraRTC.setLogLevel?.(4); } catch {}
      try { AgoraRTC.disableLogUpload?.(); } catch {}
      client = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });

      client.on("user-published", async (user: any, mediaType: "video" | "audio") => {
        await client.subscribe(user, mediaType);
        remoteUsers.set(user.uid, user);
        const previous = remoteState.get(user.uid);
        remoteState.set(user.uid, mergeRemoteParticipant(previous, user.uid, {
          [mediaType === "video" ? "hasVideo" : "hasAudio"]: true,
        }));
        if (mediaType === "audio") user.audioTrack?.play();
        emit();
      });
      client.on("user-unpublished", (user: any, mediaType: "video" | "audio") => {
        remoteUsers.set(user.uid, user);
        const previous = remoteState.get(user.uid);
        remoteState.set(user.uid, mergeRemoteParticipant(previous, user.uid, {
          [mediaType === "video" ? "hasVideo" : "hasAudio"]: false,
        }));
        emit();
      });
      client.on("user-left", (user: any) => {
        remoteUsers.delete(user.uid);
        remoteState.delete(user.uid);
        emit();
      });
      client.on("connection-state-change", (current: string) => {
        const mapped = mapConnState(String(current));
        if (mapped) connListeners.forEach((cb) => {
          try { cb(mapped); } catch {}
        });
      });
      try {
        client.enableAudioVolumeIndicator?.();
        client.on("volume-indicator", (volumes: { uid: string | number; level: number }[]) => {
          const levels: VolumeLevel[] = (volumes ?? []).map((volume) => ({
            uid: String(volume.uid) === "0" ? localUid : volume.uid,
            level: volume.level,
          }));
          volumeListeners.forEach((cb) => {
            try { cb(levels); } catch {}
          });
        });
      } catch {}

      await client.join(token.appId, token.channelName, token.rtcToken, token.uid);

      if (opts.audio) {
        try {
          localAudioTrack = await AgoraRTC.createMicrophoneAudioTrack();
          await client.publish([localAudioTrack]);
          setCapture({ audio: "active" });
        } catch (error) {
          try { localAudioTrack?.close?.(); } catch {}
          localAudioTrack = null;
          setCapture({ audio: captureErrorKind(error) });
        }
      }
      if (opts.video) {
        try {
          localVideoTrack = await AgoraRTC.createCameraVideoTrack();
          await client.publish([localVideoTrack]);
          setCapture({ video: "active" });
        } catch (error) {
          try { localVideoTrack?.close?.(); } catch {}
          localVideoTrack = null;
          setCapture({ video: captureErrorKind(error) });
        }
      }
    },
    async leave() {
      try {
        localVideoTrack?.stop();
        localVideoTrack?.close();
        localAudioTrack?.stop();
        localAudioTrack?.close();
        await client?.leave();
      } catch {}
      localVideoTrack = null;
      localAudioTrack = null;
      remoteUsers.clear();
      remoteState.clear();
      emit();
      setCapture({ audio: "off", video: "off" });
    },
    async setMicEnabled(on: boolean) {
      await setTrackEnabled(localAudioTrack, on, "Microphone");
      setCapture({ audio: on ? "active" : "off" });
    },
    async setCamEnabled(on: boolean) {
      await setTrackEnabled(localVideoTrack, on, "Camera");
      setCapture({ video: on ? "active" : "off" });
    },
    playLocal(el?: unknown) {
      if (localVideoTrack && el) localVideoTrack.play(el as HTMLElement);
    },
    playRemote(uid, el?: unknown) {
      const user = remoteUsers.get(uid);
      if (user?.videoTrack && el) user.videoTrack.play(el as HTMLElement);
    },
  };
}

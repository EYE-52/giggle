import type { AgoraToken } from "@giggle/core";

export interface RemoteParticipant {
  uid: string | number;
  hasVideo: boolean;
  hasAudio: boolean;
}

export function mergeRemoteParticipant(
  current: RemoteParticipant | undefined,
  uid: string | number,
  patch: Partial<Pick<RemoteParticipant, "hasVideo" | "hasAudio">>
): RemoteParticipant {
  return {
    uid,
    hasVideo: patch.hasVideo ?? current?.hasVideo ?? false,
    hasAudio: patch.hasAudio ?? current?.hasAudio ?? false,
  };
}

/** One participant's current audio level (0–100), as reported by the SDK. */
export interface VolumeLevel {
  uid: string | number;
  level: number;
}

/** Simplified connection lifecycle states shared by web + native. */
export type ConnectionState =
  | "CONNECTING"
  | "CONNECTED"
  | "RECONNECTING"
  | "DISCONNECTED";

export type CaptureDeviceState = "pending" | "active" | "off" | "denied" | "unavailable";

export interface CaptureState {
  audio: CaptureDeviceState;
  video: CaptureDeviceState;
}

export interface VideoClient {
  /** Join a channel using a server-issued token. */
  join(token: AgoraToken, opts?: { audio?: boolean; video?: boolean }): Promise<void>;
  leave(): Promise<void>;
  setMicEnabled(on: boolean): Promise<void>;
  setCamEnabled(on: boolean): Promise<void>;
  /** Switch between front and rear cameras when supported by the native SDK. */
  switchCamera?(): Promise<void>;
  /** Attach the local camera preview to a DOM element (web) or returns a render handle (native). */
  playLocal(el?: unknown): void;
  /** Attach a remote user's video. */
  playRemote(uid: string | number, el?: unknown): void;
  onRemoteChange(cb: (remotes: RemoteParticipant[]) => void): () => void;
  /**
   * Subscribe to periodic speaking-volume reports (all users incl. local).
   * Optional: implementations without volume support may omit it.
   */
  onVolumes?(cb: (levels: VolumeLevel[]) => void): () => void;
  /**
   * Subscribe to connection lifecycle changes (reconnecting banners etc.).
   * Optional: implementations without state reporting may omit it.
   */
  onConnectionState?(cb: (state: ConnectionState) => void): () => void;
  /** Subscribe to truthful local camera and microphone capture state. */
  onCaptureState?(cb: (state: CaptureState) => void): () => void;
  readonly remotes: RemoteParticipant[];
}

export type { AgoraToken };

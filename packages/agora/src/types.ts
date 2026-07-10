import type { AgoraToken } from "@giggle/core";

export interface RemoteParticipant {
  uid: string | number;
  hasVideo: boolean;
  hasAudio: boolean;
}

export interface VideoClient {
  /** Join a channel using a server-issued token. */
  join(token: AgoraToken, opts?: { audio?: boolean; video?: boolean }): Promise<void>;
  leave(): Promise<void>;
  setMicEnabled(on: boolean): Promise<void>;
  setCamEnabled(on: boolean): Promise<void>;
  /** Attach the local camera preview to a DOM element (web) or returns a render handle (native). */
  playLocal(el?: unknown): void;
  /** Attach a remote user's video. */
  playRemote(uid: string | number, el?: unknown): void;
  onRemoteChange(cb: (remotes: RemoteParticipant[]) => void): () => void;
  readonly remotes: RemoteParticipant[];
}

export type { AgoraToken };

export interface User {
  id: string;
  name: string;
  email?: string;
  image?: string;
  isPremium?: boolean;
  isApproved?: boolean;
  reputation?: number;
}

export interface SquadMember {
  id: string;
  name: string;
  initial?: string;
  isLeader?: boolean;
  isReady?: boolean;
  micOn?: boolean;
  camOn?: boolean;
}

export type SquadVisibility = "private" | "open";

export interface Squad {
  id: string;
  name: string;
  code: string;
  leaderId: string;
  members: SquadMember[];
  tags: string[];
  status: "idle" | "searching" | "matched" | "in_encounter";
  visibility: SquadVisibility;
  reputation?: number;
  region?: string;
}

export interface Encounter {
  id: string;
  status: "awaiting_ack" | "active" | "ended";
  squadAId: string;
  squadBId: string;
  expiresAt?: string;
}

export interface AgoraToken {
  appId: string;
  channelName: string;
  rtcToken: string;
  uid: number;
  expiresIn: number;
  expiresAt: number;
}

// Local-only encounter view modes (never synced to other users).
export type EncounterView = "versus" | "grid" | "spotlight" | "focus-opponent";

export interface ApiEnvelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

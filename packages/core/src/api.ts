import { backendRequest } from "./client";
import type { AgoraToken } from "./types";

/**
 * Typed wrappers over the giggle-server REST API.
 * Field names match the real backend contract (squadId/squadCode/memberId, {ok,data,error}).
 */
export const api = {
  // --- auth ---
  exchange: (payload: { email: string; name?: string; image?: string; ref?: string }) =>
    backendRequest<{ token: string; user: BackendUser }>("/api/auth/exchange", { method: "POST", body: payload }),
  // Email magic link: backend signs a 15-min token and emails (or dev-logs) a
  // link to ${FRONTEND}/auth/callback. Always resolves ok (never reveals if the
  // email exists).
  startEmailMagicLink: (email: string, ref?: string) =>
    backendRequest<{ ok: true }>("/api/auth/email/start", { method: "POST", body: { email, ref } }),
  getReferral: () =>
    backendRequest<ReferralInfo>("/api/auth/me/referral"),
  getMyProfile: () =>
    backendRequest<UserProfile>("/api/me/profile"),
  updateMyProfile: (body: { gender?: string; age?: number | null; languages?: string[]; country?: string }) =>
    backendRequest<UserProfile>("/api/me/profile", { method: "PATCH", body }),

  // --- squads ---
  createSquad: (body: { squadName?: string; displayName?: string; tags?: string[] }) =>
    backendRequest<SquadSummary>("/api/squads/create", { method: "POST", body }),
  joinSquad: (body: { squadCode: string; displayName?: string }) =>
    backendRequest<SquadSummary | { status: "requested" }>("/api/squads/join", { method: "POST", body }),
  joinSquadById: (squadId: string) =>
    backendRequest<SquadSummary | { status: "requested" }>(`/api/squads/${squadId}/join`, { method: "POST" }),
  discoverSquads: () => backendRequest<{ squads: PublicSquad[] }>("/api/squads/discover"),
  joinRandomSquad: (body?: { displayName?: string }) =>
    backendRequest<SquadSummary>("/api/squads/join-random", { method: "POST", body: body ?? {} }),
  mySquad: () => backendRequest<MySquad>("/api/squads/me"),
  mySquads: () => backendRequest<{ squads: MySquadLite[] }>("/api/squads/mine"),
  getSquad: (squadId: string) => backendRequest<SquadState>(`/api/squads/${squadId}`),
  // Public preview — works WITHOUT being a member (powers the two-step join).
  getSquadPreview: (squadId: string) => backendRequest<SquadState>(`/api/squads/${squadId}/preview`),
  setReady: (squadId: string, ready: boolean) =>
    backendRequest<{ squadId: string; memberId: string; ready: boolean }>(`/api/squads/${squadId}/ready`, { method: "POST", body: { ready } }),
  setName: (squadId: string, squadName: string) =>
    backendRequest<{ squadId: string; squadName: string }>(`/api/squads/${squadId}/name`, { method: "POST", body: { squadName } }),
  setTags: (squadId: string, tags: string[]) =>
    backendRequest<{ squadId: string; tags: string[] }>(`/api/squads/${squadId}/tags`, { method: "POST", body: { tags } }),
  setSquadVisibility: (squadId: string, visibility: "private" | "open") =>
    backendRequest<{ squadId: string; visibility: "private" | "open" }>(`/api/squads/${squadId}/visibility`, { method: "POST", body: { visibility } }),
  setSquadCover: (squadId: string, coverImage: string) =>
    backendRequest<{ squadId: string; coverImage: string }>(`/api/squads/${squadId}/cover`, { method: "POST", body: { coverImage } }),
  setJoinPolicy: (squadId: string, joinPolicy: "open" | "request" | "invite") =>
    backendRequest<{ squadId: string; joinPolicy: "open" | "request" | "invite" }>(`/api/squads/${squadId}/join-policy`, { method: "POST", body: { joinPolicy } }),
  inviteToSquad: (squadId: string, body: { userId?: string; email?: string }) =>
    backendRequest<{ squadId: string; invitedUserId: string; invitedCount: number }>(`/api/squads/${squadId}/invite`, { method: "POST", body }),
  // Invite a specific user to a squad (any member). Adds them to the invite
  // allow-list AND sends them a squad_invite notification carrying the squadCode.
  inviteUserToSquad: (squadId: string, userId: string) =>
    backendRequest<{ invited: boolean }>(`/api/squads/${squadId}/invite-user`, { method: "POST", body: { userId } }),
  revokeInvite: (squadId: string, userId: string) =>
    backendRequest<{ squadId: string; revokedUserId: string; invitedCount: number }>(`/api/squads/${squadId}/invite/${userId}/revoke`, { method: "POST" }),
  joinRequests: (squadId: string) =>
    backendRequest<{ requests: JoinRequestUser[] }>(`/api/squads/${squadId}/requests`),
  approveJoinRequest: (squadId: string, userId: string) =>
    backendRequest<{ squadId: string; member?: SquadMemberState; members?: SquadMemberState[]; status?: string }>(`/api/squads/${squadId}/requests/${userId}/approve`, { method: "POST" }),
  declineJoinRequest: (squadId: string, userId: string) =>
    backendRequest<{ squadId: string; userId: string; status: "declined" }>(`/api/squads/${squadId}/requests/${userId}/decline`, { method: "POST" }),
  startSearch: (squadId: string) =>
    backendRequest<{ squadId: string; status: string; encounterId?: string }>(`/api/squads/${squadId}/search`, { method: "POST" }),
  cancelSearch: (squadId: string) =>
    backendRequest<{ squadId: string; status: string }>(`/api/squads/${squadId}/search/cancel`, { method: "POST" }),
  leaveSquad: (squadId: string) =>
    backendRequest<{ squadId: string; squadDeleted: boolean }>(`/api/squads/${squadId}/leave`, { method: "POST" }),
  setLobbyVideo: (squadId: string, inLobbyVideo: boolean) =>
    backendRequest<{ memberId: string; inLobbyVideo: boolean }>(`/api/squads/${squadId}/lobby-video`, { method: "POST", body: { inLobbyVideo } }),
  setEncounterVideo: (squadId: string, inEncounterVideo: boolean) =>
    backendRequest<{ memberId: string; inEncounterVideo: boolean }>(`/api/squads/${squadId}/encounter-video`, { method: "POST", body: { inEncounterVideo } }),

  // --- matchmaking ---
  matchStatus: (squadId: string) =>
    backendRequest<MatchStatus>(`/api/matchmaking/status/${squadId}`),
  getEncounter: (encounterId: string) =>
    backendRequest<EncounterDetail>(`/api/matchmaking/encounters/${encounterId}`),
  ackEncounter: (encounterId: string, squadId: string) =>
    backendRequest<{ encounterId: string; allAcked: boolean }>(`/api/matchmaking/encounters/${encounterId}/ack`, { method: "POST", body: { squadId } }),
  skip: (squadId: string, encounterId: string) =>
    backendRequest<{ squadId: string; queueStatus: string }>("/api/matchmaking/skip", { method: "POST", body: { squadId, encounterId } }),

  // --- platform stats ---
  getStats: () =>
    backendRequest<{ squadsTotal: number; squadsOnline?: number; playersOnline: number; encountersTotal: number; searching: number; liveEncounters: number }>("/api/stats"),

  // --- agora tokens ---
  lobbyToken: (squadId: string) =>
    backendRequest<AgoraToken>(`/api/agora/lobby-token/${squadId}`, { method: "POST" }),
  encounterToken: (squadId: string, encounterId: string) =>
    backendRequest<AgoraToken>("/api/encounters/token", { method: "POST", body: { squadId, encounterId } }),
  disconnectEncounter: (squadId: string, encounterId: string) =>
    backendRequest<{ encounterId: string; disconnected: boolean }>("/api/encounters/disconnect", { method: "POST", body: { squadId, encounterId } }),

  // --- friends & presence ---
  listFriends: () =>
    backendRequest<{ friends: Friend[] }>("/api/friends"),
  friendRequests: () =>
    backendRequest<{ incoming: FriendRequestUser[]; outgoing: FriendRequestUser[] }>("/api/friends/requests"),
  searchUsers: (q: string) =>
    backendRequest<{ users: Friend[] }>(`/api/users/search?q=${encodeURIComponent(q)}`),
  sendFriendRequest: (userId: string) =>
    backendRequest<{ status: "requested" | "friends" }>("/api/friends/request", { method: "POST", body: { userId } }),
  acceptFriend: (userId: string) =>
    backendRequest<{ status: "friends" }>("/api/friends/accept", { method: "POST", body: { userId } }),
  declineFriend: (userId: string) =>
    backendRequest<{ status: "declined" }>("/api/friends/decline", { method: "POST", body: { userId } }),
  removeFriend: (userId: string) =>
    backendRequest<{ status: "removed" }>("/api/friends/remove", { method: "POST", body: { userId } }),

  // --- notifications ---
  listNotifications: () =>
    backendRequest<{ notifications: AppNotification[]; unread: number }>("/api/notifications"),
  markNotificationsRead: () =>
    backendRequest<{ unread: number }>("/api/notifications/read-all", { method: "POST" }),
  markNotificationRead: (id: string) =>
    backendRequest<{ unread: number }>(`/api/notifications/${id}/read`, { method: "POST" }),
  dismissNotification: (id: string) =>
    backendRequest<{ dismissed: boolean; unread: number }>(`/api/notifications/${id}`, { method: "DELETE" }),
};

// --- notification shapes ---
export type NotificationType =
  | "friend_request"
  | "squad_invite"
  | "join_request"
  | "squad_joined"
  | "info";

export interface AppNotification {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  fromUserId?: string;
  fromName?: string;
  squadId?: string;
  squadCode?: string;
  squadName?: string;
  read: boolean;
  createdAt: string;
}

// --- friends & presence shapes ---
export interface Friend {
  userId: string;
  name: string;
  image?: string;
  online: boolean;
}
export interface FriendRequestUser {
  userId: string;
  name: string;
  image?: string;
  online?: boolean;
}
export interface JoinRequestUser {
  userId: string;
  name: string;
  requestedAt: string;
  gender?: string;
  age?: number;
  languages?: string[];
  country?: string;
}
export interface UserProfile {
  gender?: string;
  age?: number;
  languages?: string[];
  country?: string;
  name: string;
  email: string;
}

// --- response shapes (match backend) ---
export interface BackendUser {
  id: string;
  email: string;
  name: string;
  image?: string;
  isPremium: boolean;
  isApproved: boolean;
  /** Referral & wallet (present from /api/auth/exchange) */
  referralCode?: string;
  referralCount?: number;
  tokens?: number;
  referralApplied?: boolean;
  referralReward?: number;
}
export interface ReferralInfo {
  code: string;
  referralCount: number;
  tokens: number;
  rewardPerInvite: number;
}
export interface SquadMemberState {
  memberId: string;
  userId: string;
  uid?: number;
  displayName: string;
  role: "leader" | "member";
  ready: boolean;
  inLobbyVideo: boolean;
  inEncounterVideo: boolean;
  online?: boolean;
  joinedAt?: string;
  gender?: string;
  age?: number;
  languages?: string[];
  country?: string;
}
export interface SquadState {
  squadId: string;
  squadCode: string;
  squadName: string;
  status: "idle" | "searching" | "matched" | "in_encounter";
  leaderMemberId: string;
  members: SquadMemberState[];
  maxSlots?: number;
  tags?: string[];
  coverImage?: string | null;
  visibility?: "private" | "open";
  joinPolicy?: "open" | "request" | "invite";
}
export type SquadSummary = SquadState;
export interface PublicSquad {
  squadId: string;
  squadName: string;
  memberCount: number;
  maxSlots: number;
  tags?: string[];
  coverImage?: string | null;
  status: string;
  leaderName?: string;
  joinPolicy?: "open" | "request" | "invite";
}
export interface MySquad {
  inSquad: boolean;
  squadId?: string;
  squadCode?: string;
  squadName?: string;
  status?: string;
  member?: SquadMemberState;
  leaderMemberId?: string;
  members?: SquadMemberState[];
}
export interface MySquadLite {
  squadId: string;
  squadCode: string;
  squadName: string;
  status: string;
  memberCount: number;
  maxSlots: number;
  coverImage?: string | null;
  tags?: string[];
  leaderName?: string;
  myRole?: string;
  joinPolicy?: "open" | "request" | "invite";
}
export interface MatchStatus {
  squadId: string;
  state: "idle" | "searching" | "matched" | "in_encounter";
  match?: { encounterId: string; opponentSquadId: string; opponentSquadName?: string; status: string };
}
export interface EncounterDetail {
  encounterId: string;
  status: "awaiting_ack" | "active" | "ended";
  squadAId: string;
  squadAName: string;
  squadACover?: string | null;
  squadAMembers: SquadMemberState[];
  squadBId: string;
  squadBName: string;
  squadBCover?: string | null;
  squadBMembers: SquadMemberState[];
  expiresAt: string;
}

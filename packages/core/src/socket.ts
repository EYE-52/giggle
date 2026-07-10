import { io, type Socket } from "socket.io-client";
import { BACKEND_URL } from "./config";
import { getAuthToken } from "./client";
import type { AppNotification } from "./api";
import { createReportOpponentPayload, type ReportOpponentInput } from "./report";

let socket: Socket | null = null;

// Rooms the client has joined, tracked so we can re-join after a reconnect.
const joinedSquads = new Set<string>();
const joinedEncounters = new Set<string>();

/** Re-emit all rooms we had joined — used on (re)connect. */
function rejoinRooms(s: Socket): void {
  joinedSquads.forEach((id) => s.emit(SOCKET_EMIT.JOIN_SQUAD, id));
  joinedEncounters.forEach((id) => s.emit(SOCKET_EMIT.JOIN_ENCOUNTER, id));
}

export function getSocket(): Socket {
  if (!socket) {
    socket = io(BACKEND_URL, {
      autoConnect: false,
      transports: ["websocket"],
      withCredentials: true,
      // Function form is re-evaluated on every (re)connect, so the freshest
      // session token is always sent. The server derives identity from it.
      auth: (cb: (data: { token?: string }) => void) => {
        Promise.resolve(getAuthToken())
          .then((token) => cb({ token: token ?? undefined }))
          .catch(() => cb({}));
      },
    });
    // On every successful (re)connect, re-join the rooms we were in so we keep
    // receiving SQUAD_UPDATED / MATCH_FOUND / new_message after a drop.
    socket.on("connect", () => {
      if (socket) rejoinRooms(socket);
    });
  }
  return socket;
}

export function connectSocket(squadId?: string): Socket {
  const s = getSocket();
  if (squadId) joinedSquads.add(squadId);
  if (!s.connected) s.connect();
  if (squadId && s.connected) s.emit(SOCKET_EMIT.JOIN_SQUAD, squadId);
  return s;
}

export function disconnectSocket() {
  // Intentional teardown — forget tracked rooms so a later connect doesn't
  // silently re-join stale rooms.
  joinedSquads.clear();
  joinedEncounters.clear();
  if (socket?.connected) socket.disconnect();
}

// Server-emitted events (exact strings from giggle-server socketService).
export const SOCKET_EVENTS = {
  SQUAD_UPDATED: "SQUAD_UPDATED",
  MATCH_FOUND: "MATCH_FOUND",
  NEW_MESSAGE: "new_message",
  NEW_REACTION: "new_reaction",
  NOTIFICATION: "notification",
} as const;

// Client→server emits.
export const SOCKET_EMIT = {
  JOIN_SQUAD: "join_squad",
  JOIN_ENCOUNTER: "join_encounter",
  SEND_MESSAGE: "send_message",
  SEND_REACTION: "send_reaction",
  REPORT_SQUAD: "report_squad",
} as const;

// --- Chat transport (lobby + encounter) ---
export interface ChatMessage {
  id: string;
  userId: string;
  name: string;
  text: string;
  ts: number;
  encounterId?: string;
  squadId?: string;
}

export type ChatScope =
  | { kind: "lobby"; squadId: string }
  | { kind: "encounter"; encounterId: string; squadId: string };

/** Join the room(s) needed for the given chat scope. */
export function joinChat(scope: ChatScope): void {
  const s = connectSocket();
  // Track rooms so they're re-joined automatically after a reconnect.
  joinedSquads.add(scope.squadId);
  if (scope.kind === "encounter") joinedEncounters.add(scope.encounterId);
  // Emit now if already connected; otherwise the "connect" handler re-joins.
  if (s.connected) {
    s.emit(SOCKET_EMIT.JOIN_SQUAD, scope.squadId);
    if (scope.kind === "encounter") s.emit(SOCKET_EMIT.JOIN_ENCOUNTER, scope.encounterId);
  }
}

/** Send a chat message to the given scope. The server echoes it back to the room. */
export function sendChatMessage(
  scope: ChatScope,
  text: string,
  sender: { id: string; name: string },
): boolean {
  try {
    const s = connectSocket();
    if (!s.connected) return false;
    s.emit(SOCKET_EMIT.SEND_MESSAGE, {
      encounterId: scope.kind === "encounter" ? scope.encounterId : undefined,
      squadId: scope.squadId,
      text,
      senderId: sender.id,
      senderName: sender.name,
    });
    return true;
  } catch {
    return false;
  }
}

/** Subscribe to incoming chat messages. Returns an unsubscribe function. */
export function subscribeChat(cb: (m: ChatMessage) => void): () => void {
  const s = connectSocket();
  const handler = (raw: {
    id: string;
    text: string;
    senderId?: string;
    senderName?: string;
    encounterId?: string;
    squadId?: string;
    ts?: number;
    timestamp?: string;
  }) => {
    cb({
      id: raw.id,
      userId: raw.senderId ?? "",
      name: raw.senderName ?? "",
      text: raw.text,
      ts: raw.ts ?? (raw.timestamp ? Date.parse(raw.timestamp) : Date.now()),
      encounterId: raw.encounterId,
      squadId: raw.squadId,
    });
  };
  s.on(SOCKET_EVENTS.NEW_MESSAGE, handler);
  return () => {
    s.off(SOCKET_EVENTS.NEW_MESSAGE, handler);
  };
}

// --- Reactions (emoji) — broadcast to everyone in the scope's room ---
export interface ReactionEvent {
  id: string;
  emoji: string;
  senderId: string;
  senderName: string;
  encounterId?: string;
  squadId?: string;
  ts: number;
}

/** Broadcast an emoji reaction to the scope (server echoes to the whole room). */
export function sendReaction(
  scope: ChatScope,
  emoji: string,
  sender: { id: string; name: string },
): boolean {
  try {
    const s = connectSocket();
    if (!s.connected) return false;
    s.emit(SOCKET_EMIT.SEND_REACTION, {
      encounterId: scope.kind === "encounter" ? scope.encounterId : undefined,
      squadId: scope.squadId,
      emoji,
      senderId: sender.id,
      senderName: sender.name,
    });
    return true;
  } catch {
    return false;
  }
}

/** Subscribe to incoming reactions. Returns an unsubscribe function. */
export function subscribeReaction(cb: (r: ReactionEvent) => void): () => void {
  const s = connectSocket();
  const handler = (raw: Partial<ReactionEvent>) => {
    cb({
      id: raw.id ?? String(raw.ts ?? Date.now()),
      emoji: raw.emoji ?? "",
      senderId: raw.senderId ?? "",
      senderName: raw.senderName ?? "",
      encounterId: raw.encounterId,
      squadId: raw.squadId,
      ts: raw.ts ?? Date.now(),
    });
  };
  s.on(SOCKET_EVENTS.NEW_REACTION, handler);
  return () => { s.off(SOCKET_EVENTS.NEW_REACTION, handler); };
}

export function reportOpponentSquad(input: ReportOpponentInput): boolean {
  const payload = createReportOpponentPayload(input);
  if (!payload) return false;
  const s = connectSocket(payload.squadId);
  if (!s.connected) return false;
  s.emit(SOCKET_EMIT.REPORT_SQUAD, payload);
  return true;
}

// --- Notifications (per-user push) ---
// The server joins the authenticated socket to its `user_<id>` room on connect,
// so simply connecting is enough to start receiving `notification` events.
/** Subscribe to live notifications for the current user. Returns an unsubscribe. */
export function subscribeNotifications(cb: (n: AppNotification) => void): () => void {
  const s = connectSocket();
  const handler = (raw: AppNotification) => cb(raw);
  s.on(SOCKET_EVENTS.NOTIFICATION, handler);
  return () => { s.off(SOCKET_EVENTS.NOTIFICATION, handler); };
}

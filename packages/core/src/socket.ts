import { io, type Socket } from "socket.io-client";
import { BACKEND_URL } from "./config";
import { getAuthToken } from "./client";
import type { AppNotification } from "./api";
import {
  createReportOpponentPayload,
  type ReportOpponentInput,
  type ReportSendResult,
  type SafetyReportStatus,
} from "./report";

let socket: Socket | null = null;
let adultAccessGetter: () => boolean = () => false;

/** Register the live session decision used before opening realtime transport. */
export function setAdultAccessGetter(fn: () => boolean) {
  adultAccessGetter = fn;
}

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
  if (!adultAccessGetter()) return s;
  if (squadId) joinedSquads.add(squadId);
  // active includes authentication in flight and automatic reconnects.
  if (!s.active) s.connect();
  if (squadId && s.connected) s.emit(SOCKET_EMIT.JOIN_SQUAD, squadId);
  return s;
}

export function disconnectSocket() {
  // Intentional teardown — forget tracked rooms so a later connect doesn't
  // silently re-join stale rooms.
  joinedSquads.clear();
  joinedEncounters.clear();
  socket?.disconnect();
}

// Server-emitted events (exact strings from giggle-server socketService).
export const SOCKET_EVENTS = {
  SQUAD_UPDATED: "SQUAD_UPDATED",
  MATCH_FOUND: "MATCH_FOUND",
  ENCOUNTER_ACTIVE: "ENCOUNTER_ACTIVE",
  ENCOUNTER_ENDED: "ENCOUNTER_ENDED",
  NEW_MESSAGE: "new_message",
  NEW_REACTION: "new_reaction",
  NOTIFICATION: "notification",
  NOTIFICATIONS_CHANGED: "notifications_changed",
} as const;

// Client→server emits.
export const SOCKET_EMIT = {
  JOIN_SQUAD: "join_squad",
  JOIN_ENCOUNTER: "join_encounter",
  SEND_MESSAGE: "send_message",
  SEND_REACTION: "send_reaction",
  REPORT_SQUAD: "report_squad",
  MEMBER_MEDIA: "member_media",
} as const;

// --- Chat transport (lobby + encounter) ---
export interface ChatMessage {
  id: string;
  userId: string;
  name: string;
  text: string;
  ts: number;
  clientMessageId?: string;
  encounterId?: string;
  squadId?: string;
}

export type ChatSendResult =
  | { ok: true; message: ChatMessage }
  | { ok: false; error: string };

interface RawChatMessage {
  id: string;
  text: string;
  senderId?: string;
  senderName?: string;
  encounterId?: string;
  squadId?: string;
  clientMessageId?: string;
  ts?: number;
  timestamp?: string;
}

function normalizeChatMessage(raw: RawChatMessage): ChatMessage {
  return {
    id: raw.id,
    userId: raw.senderId ?? "",
    name: raw.senderName ?? "",
    text: raw.text,
    ts: raw.ts ?? (raw.timestamp ? Date.parse(raw.timestamp) : Date.now()),
    clientMessageId: raw.clientMessageId,
    encounterId: raw.encounterId,
    squadId: raw.squadId,
  };
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
  options?: {
    clientMessageId?: string;
    ack?: (result: ChatSendResult) => void;
  },
): boolean {
  try {
    const s = connectSocket();
    if (!s.connected) return false;
    const payload = {
      encounterId: scope.kind === "encounter" ? scope.encounterId : undefined,
      squadId: scope.squadId,
      text,
      senderId: sender.id,
      senderName: sender.name,
      clientMessageId: options?.clientMessageId,
    };
    if (options?.ack) {
      s.timeout(5000).emit(
        SOCKET_EMIT.SEND_MESSAGE,
        payload,
        (error: Error | null, result?: { ok: boolean; message?: RawChatMessage; error?: string }) => {
          options.ack!(error || !result
            ? { ok: false, error: "Message not delivered. Try again." }
            : result.ok && result.message
            ? { ok: true, message: normalizeChatMessage(result.message) }
            : { ok: false, error: result.error || "Message not delivered. Try again." });
        },
      );
    } else {
      s.emit(SOCKET_EMIT.SEND_MESSAGE, payload);
    }
    return true;
  } catch {
    return false;
  }
}

/** Subscribe to incoming chat messages. Returns an unsubscribe function. */
export function subscribeChat(cb: (m: ChatMessage) => void): () => void {
  const s = connectSocket();
  const handler = (raw: RawChatMessage) => cb(normalizeChatMessage(raw));
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

export async function reportOpponentSquad(input: ReportOpponentInput): Promise<ReportSendResult> {
  try {
    const payload = createReportOpponentPayload(input);
    if (!payload) return { ok: false, error: "Report unavailable." };
    const s = connectSocket(payload.squadId);
    if (!s.connected) return { ok: false, error: "Report was not sent. Try again." };

    return await new Promise<ReportSendResult>((resolve) => {
      s.timeout(5000).emit(
        SOCKET_EMIT.REPORT_SQUAD,
        payload,
        (
          error: Error | null,
          result?: { ok: boolean; reportId?: string; status?: SafetyReportStatus; error?: string },
        ) => {
          if (error || !result) {
            return resolve({ ok: false, error: "Report was not saved. Try again." });
          }
          if (result.ok && result.reportId && result.status) {
            return resolve({ ok: true, reportId: result.reportId, status: result.status });
          }
          return resolve({ ok: false, error: result.error || "Report was not saved. Try again." });
        },
      );
    });
  } catch {
    return { ok: false, error: "Report was not sent. Try again." };
  }
}

// --- Notifications (per-user push) ---
// The server joins the authenticated socket to its `user_<id>` room on connect,
// so simply connecting is enough to start receiving `notification` events.
/** Subscribe to live notifications for the current user. Returns an unsubscribe. */
export function subscribeNotifications(
  cb: (n: AppNotification) => void,
  onChanged?: () => void,
): () => void {
  const s = connectSocket();
  const handler = (raw: AppNotification) => cb(raw);
  s.on(SOCKET_EVENTS.NOTIFICATION, handler);
  if (onChanged) {
    s.on(SOCKET_EVENTS.NOTIFICATIONS_CHANGED, onChanged);
    s.on("connect", onChanged);
  }
  return () => {
    s.off(SOCKET_EVENTS.NOTIFICATION, handler);
    if (onChanged) {
      s.off(SOCKET_EVENTS.NOTIFICATIONS_CHANGED, onChanged);
      s.off("connect", onChanged);
    }
  };
}

/** Screen source metadata uses the joined call scope; camera presence is separate. */
export type MemberMediaInput = {squadId:string; encounterId?:string} & ({action:"begin"} | {action:"update"; mediaSessionId:string; screenSharing:boolean} | {action:"end"; mediaSessionId:string});
export type MemberMediaResult = {ok:boolean; mediaSessionId?:string; error?:string};
export function sendMemberMedia(input: MemberMediaInput): Promise<MemberMediaResult> {
  const s = getSocket();
  if (!s.connected) return Promise.resolve({ok:false, error:"DISCONNECTED"});
  return new Promise(resolve => {
    s.timeout(5000).emit(SOCKET_EMIT.MEMBER_MEDIA, input, (error: Error | null, result: MemberMediaResult) => resolve(error ? {ok:false, error:"TIMEOUT"} : result));
  });
}


/** Scoped to an actively viewed group; call the returned cleanup on route exit. */
export function activateGroupPresence(squadId: string): () => void {
  const socket = connectSocket(squadId);
  let retired = false, generation: string | undefined;
  let operation: Promise<void> = Promise.resolve();
  const send = (action: "begin" | "update" | "end", ownedGeneration?: string) => new Promise<{ok:boolean;generation?:string}>(resolve => {
    if (!socket.connected) return resolve({ok:false});
    socket.timeout(5000).emit("group_presence", {squadId,action,generation:ownedGeneration}, (error:Error|null,result:{ok:boolean;generation?:string}) => resolve(error ? {ok:false} : result));
  });
  const refresh = () => {
    if (retired) return;
    operation = operation.then(async () => {
      if (retired || !socket.connected) return;
      const result = await send(generation ? "update" : "begin",generation);
      if (result.ok) generation = result.generation ?? generation;
      else generation = undefined;
    });
  };
  const reconnect = () => { generation = undefined;refresh(); };
  socket.on("connect",reconnect);
  const timer = setInterval(refresh,25_000);
  if (typeof document !== "undefined") document.addEventListener("visibilitychange",refresh);
  refresh();
  return () => {
    retired = true;clearInterval(timer);socket.off("connect",reconnect);
    if (typeof document !== "undefined") document.removeEventListener("visibilitychange",refresh);
    void operation.then(() => generation ? send("end",generation).then(() => {}) : undefined);
  };
}

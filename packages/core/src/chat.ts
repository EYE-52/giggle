import type { ChatMessage, ChatScope } from "./socket";

const DEFAULT_CHAT_MERGE_LIMIT = 200;
const MAX_CHAT_MERGE_LIMIT = 10_000;

/** A call message carries a squad ID too. It must never enter private squad chat. */
export function chatMessageMatchesScope(message: ChatMessage, scope: ChatScope): boolean {
  return scope.kind === "encounter"
    ? !!scope.encounterId && message.encounterId === scope.encounterId
    : !!scope.squadId && !message.encounterId && message.squadId === scope.squadId;
}

function nonEmpty(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function sameMessage(a: ChatMessage, b: ChatMessage): boolean {
  const aServerId = nonEmpty(a.id);
  const bServerId = nonEmpty(b.id);
  if (aServerId && bServerId && aServerId === bServerId) return true;

  const aClientId = nonEmpty(a.clientMessageId);
  const bClientId = nonEmpty(b.clientMessageId);
  if (!aClientId || aClientId !== bClientId || a.userId !== b.userId) return false;

  // If either message belongs to an encounter, encounter scope decides. This
  // keeps Everyone chat separate from private squad chat, including partial
  // pending/ack states where one side has not received the encounter id yet.
  if (a.encounterId || b.encounterId) return !!a.encounterId && !!b.encounterId && a.encounterId === b.encounterId;
  return !!a.squadId && !!b.squadId && a.squadId === b.squadId;
}

/** Merge one incoming message while bounding the retained call history. */
export function mergeChatMessage<T extends ChatMessage>(
  messages: readonly T[],
  incoming: T,
  limit = DEFAULT_CHAT_MERGE_LIMIT,
): T[] {
  if (!Array.isArray(messages)) throw new TypeError("messages must be an array");
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_CHAT_MERGE_LIMIT) {
    throw new RangeError(`limit must be an integer from 1 to ${MAX_CHAT_MERGE_LIMIT}`);
  }

  const merged = messages.map((message) => message);
  const duplicateIndex = merged.findIndex((message) => sameMessage(message, incoming));
  if (duplicateIndex >= 0) {
    merged[duplicateIndex] = { ...merged[duplicateIndex], ...incoming };
  } else {
    merged.push(incoming);
  }
  return merged.slice(-limit);
}

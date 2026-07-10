"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import {
  joinChat,
  sendChatMessage,
  subscribeChat,
  session,
  type ChatMessage,
  type ChatScope,
} from "@giggle/core";
import { Icon } from "@/components/Icons";

const MAX_CHAT_TEXT_LENGTH = 500;

function relTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 0 || diff < 45_000) return "now";
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  return `${days}d`;
}

export function ChatPanel({
  scope,
  onClose,
  title = "Chat",
}: {
  scope: ChatScope;
  onClose?: () => void;
  title?: string;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sendError, setSendError] = useState("");
  const [inputFocused, setInputFocused] = useState(false);
  const [closeHovered, setCloseHovered] = useState(false);
  const [sendHovered, setSendHovered] = useState(false);

  const endRef = useRef<HTMLDivElement | null>(null);
  const myId = session.user?.id;

  // Only the scope fields we care about for filtering — keeps the effect from
  // re-subscribing on every render when a fresh scope object is passed inline.
  const scopeKind = scope.kind;
  const scopeSquadId = scope.squadId;
  const scopeEncounterId = scope.kind === "encounter" ? scope.encounterId : undefined;

  // Decide whether an incoming message belongs in this panel.
  const accepts = useCallback(
    (msg: ChatMessage): boolean => {
      if (scopeKind === "lobby") {
        // Lobby: only this squad's chatter. Be lenient if squadId is missing.
        return msg.squadId == null || msg.squadId === scopeSquadId;
      }
      return msg.encounterId === scopeEncounterId;
    },
    [scopeKind, scopeSquadId, scopeEncounterId]
  );

  useEffect(() => {
    joinChat(scope);
    const unsub = subscribeChat((msg) => {
      if (!accepts(msg)) return;
      setMessages((prev) => {
        if (prev.some((m) => m.id === msg.id)) return prev; // de-dupe by id
        return [...prev, msg];
      });
    });
    return () => {
      try {
        unsub();
      } catch {}
    };
    // Re-join / re-subscribe only when the meaningful scope identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKind, scopeSquadId, scopeEncounterId, accepts]);

  // Auto-scroll to bottom whenever messages change.
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  function send() {
    const text = input.trim();
    if (!text) return;
    setSendError("");
    const sent = sendChatMessage(scope, text, {
      id: session.user?.id ?? "",
      name: session.user?.name ?? "You",
    });
    if (!sent) {
      setSendError("Message not sent. Check your connection and try again.");
      return;
    }
    setInput("");
    // No optimistic append — the server echo arrives via subscribeChat.
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: 0,
        width: "100%",
        background: "transparent",
        color: "var(--text)",
        fontFamily: "var(--font-inter)",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          padding: "13px 16px",
          borderBottom: "1px solid var(--border)",
          flexShrink: 0,
        }}
      >
        <span
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontFamily: "var(--font-space-grotesk)",
            fontSize: 14,
            fontWeight: 700,
            color: "var(--text)",
          }}
        >
          <Icon.chat size={15} color="var(--text-muted)" />
          {title}
        </span>
        {onClose && (
          <button
            onClick={onClose}
            onMouseEnter={() => setCloseHovered(true)}
            onMouseLeave={() => setCloseHovered(false)}
            title="Close chat"
            aria-label="Close chat"
            style={{
              background: closeHovered ? "var(--overlay-hover, rgba(255,255,255,0.1))" : "transparent",
              border: "none",
              cursor: "pointer",
              color: closeHovered ? "var(--text)" : "var(--text-muted)",
              borderRadius: 8,
              width: 44,
              height: 44,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              transition: "all .15s ease",
            }}
          >
            <Icon.close size={16} color={closeHovered ? "var(--text)" : "var(--text-muted)"} />
          </button>
        )}
      </div>

      {/* Messages */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          gap: 10,
          padding: "14px",
        }}
      >
        {messages.length === 0 ? (
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              textAlign: "center",
              color: "var(--text-dim)",
              fontSize: 13,
              padding: "20px 12px",
            }}
          >
            <span style={{ fontSize: 26 }}>💬</span>
            <span>No messages yet — say hi 👋</span>
          </div>
        ) : (
          messages.map((msg) => {
            const own = myId != null && msg.userId === myId;
            return (
              <div
                key={msg.id}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: own ? "flex-end" : "flex-start",
                  gap: 3,
                  maxWidth: "100%",
                }}
              >
                {!own && (
                  <span
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      fontSize: 11,
                      fontWeight: 600,
                      color: "var(--text-muted)",
                      padding: "0 2px",
                    }}
                  >
                    <span
                      style={{
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        maxWidth: 140,
                      }}
                    >
                      {msg.name}
                    </span>
                    <span style={{ color: "var(--text-dim)", fontWeight: 500 }}>{relTime(msg.ts)}</span>
                  </span>
                )}
                <div
                  style={{
                    background: own ? "var(--violet)" : "var(--surface)",
                    color: own ? "var(--on-accent)" : "var(--text)",
                    border: own ? "1px solid transparent" : "1px solid var(--border)",
                    borderRadius: own ? "16px 16px 4px 16px" : "16px 16px 16px 4px",
                    padding: "8px 12px",
                    fontSize: 13,
                    lineHeight: 1.45,
                    maxWidth: "85%",
                    wordBreak: "break-word",
                    overflowWrap: "anywhere",
                  }}
                >
                  {msg.text}
                </div>
              </div>
            );
          })
        )}
        <div ref={endRef} />
      </div>

      {/* Input */}
      <div
        style={{
          display: "flex",
          gap: 6,
          padding: "10px 12px",
          borderTop: "1px solid var(--border)",
          flexShrink: 0,
          flexDirection: "column",
        }}
      >
        {sendError ? (
          <div
            role="alert"
            style={{
              color: "var(--coral)",
              fontSize: 12,
              lineHeight: 1.35,
              fontWeight: 700,
            }}
          >
            {sendError}
          </div>
        ) : null}
        <div style={{ display: "flex", gap: 6 }}>
          <input
            value={input}
            onChange={(e) => {
              setSendError("");
              setInput(e.target.value.slice(0, MAX_CHAT_TEXT_LENGTH));
            }}
            maxLength={MAX_CHAT_TEXT_LENGTH}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            onFocus={() => setInputFocused(true)}
            onBlur={() => setInputFocused(false)}
            placeholder="Say something…"
            aria-label="Chat message"
            style={{
              flex: 1,
              minWidth: 0,
              height: 38,
              borderRadius: 12,
              background: "var(--overlay, rgba(255,255,255,0.05))",
              border: inputFocused
                ? "1px solid var(--violet)"
                : "1px solid var(--border)",
              color: "var(--text)",
              padding: "0 12px",
              fontSize: 13,
              outline: "none",
              fontFamily: "var(--font-inter)",
              transition: "border-color .15s ease",
            }}
          />
          <button
            onClick={send}
            disabled={!input.trim() || input.trim().length > MAX_CHAT_TEXT_LENGTH}
            onMouseEnter={() => setSendHovered(true)}
            onMouseLeave={() => setSendHovered(false)}
            title="Send"
            aria-label="Send message"
            style={{
              width: 44,
              height: 44,
              flexShrink: 0,
              borderRadius: 12,
              border: "none",
              cursor: input.trim() && input.trim().length <= MAX_CHAT_TEXT_LENGTH ? "pointer" : "not-allowed",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: input.trim() && input.trim().length <= MAX_CHAT_TEXT_LENGTH
                ? sendHovered
                  ? "var(--violet)"
                  : "var(--violet-soft, rgba(124,92,255,0.2))"
                : "var(--overlay, rgba(255,255,255,0.05))",
              color: input.trim() && sendHovered ? "var(--on-accent)" : "var(--violet)",
              opacity: input.trim() && input.trim().length <= MAX_CHAT_TEXT_LENGTH ? 1 : 0.5,
              transition: "all .15s ease",
              transform: sendHovered && input.trim() && input.trim().length <= MAX_CHAT_TEXT_LENGTH ? "scale(1.05)" : "scale(1)",
            }}
          >
            <Icon.send size={16} color={input.trim() && sendHovered ? "var(--on-accent)" : "var(--violet)"} />
          </button>
        </div>
      </div>
    </div>
  );
}

export default ChatPanel;

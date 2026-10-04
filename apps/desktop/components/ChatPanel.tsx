"use client";
import { useState, useEffect, useRef, useCallback, useMemo, useId, type ReactNode } from "react";
import {
  chatMessageMatchesScope,
  mergeChatMessage,
  joinChat,
  sendChatMessage,
  subscribeChat,
  session,
  type ChatMessage,
  type ChatScope,
} from "@giggle/core";
import { Icon } from "@/components/Icons";
import { chatTextParts } from "@/lib/chatLinks";
import styles from "./ChatPanel.module.css";

const MAX_CHAT_TEXT_LENGTH = 500;
const EMOJI_OFFSETS: Partial<Record<string, number>> = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 6, ArrowUp: -6 };
const EMOJIS = [
  ["🙂", "Smile"], ["😂", "Laugh"], ["❤️", "Heart"], ["👍", "Thumbs up"],
  ["🎉", "Celebrate"], ["👋", "Wave"], ["🔥", "Fire"], ["😎", "Cool"],
  ["🤔", "Thinking"], ["😅", "Nervous laugh"], ["🙌", "Raised hands"], ["👀", "Eyes"],
] as const;

export type ChatPanelMessage = ChatMessage & {
  delivery?: "sending" | "delivered" | "failed";
};

function relTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 0 || diff < 60_000) return "now";
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
  active = true,
  messages: controlledMessages,
  onSend,
  onRetry,
  audienceControls,
  draft,
  onDraftChange,
}: {
  audienceControls?: ReactNode;
  draft?: string;
  onDraftChange?: (value: string) => void;
  scope: ChatScope;
  onClose?: () => void;
  title?: string;
  active?: boolean;
  messages?: ChatPanelMessage[];
  onSend?: (text: string) => boolean;
  onRetry?: (message: ChatPanelMessage) => void;
}) {
  const [localMessages, setLocalMessages] = useState<ChatPanelMessage[]>([]);
  const [localInput, setLocalInput] = useState("");
  const input = draft ?? localInput;
  const setInput = onDraftChange ?? setLocalInput;
  const [sendError, setSendError] = useState("");
  const [emojiOpen, setEmojiOpen] = useState(false);
  const emojiId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const emojiRef = useRef<HTMLDivElement>(null);
  const emojiButtonRef = useRef<HTMLButtonElement>(null);
  const [newMessageCount, setNewMessageCount] = useState(0);

  const messagesRef = useRef<HTMLDivElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const nearBottomRef = useRef(true);
  const lastMessageKeyRef = useRef<string | null>(null);
  const sentMessageRef = useRef(false);
  const myId = session.user?.id;
  const allMessages = controlledMessages ?? localMessages;
  const controlled = controlledMessages !== undefined;

  useEffect(() => {
    if (active) inputRef.current?.focus({ preventScroll: true });
    else setEmojiOpen(false);
  }, [active]);

  useEffect(() => {
    if (!emojiOpen) return;
    emojiRef.current?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
    const dismiss = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!emojiRef.current?.contains(target) && !emojiButtonRef.current?.contains(target)) setEmojiOpen(false);
    };
    document.addEventListener("pointerdown", dismiss, true);
    return () => document.removeEventListener("pointerdown", dismiss, true);
  }, [emojiOpen]);

  // Only the scope fields we care about for filtering — keeps the effect from
  // re-subscribing on every render when a fresh scope object is passed inline.
  const scopeKind = scope.kind;
  const scopeSquadId = scope.squadId;
  const scopeEncounterId = scope.kind === "encounter" ? scope.encounterId : undefined;

  // Decide whether an incoming message belongs in this panel.
  const accepts = useCallback(
    (msg: ChatMessage): boolean => {
      return chatMessageMatchesScope(
        msg,
        scopeKind === "lobby"
          ? { kind: "lobby", squadId: scopeSquadId }
          : { kind: "encounter", squadId: scopeSquadId, encounterId: scopeEncounterId ?? "" },
      );
    },
    [scopeKind, scopeSquadId, scopeEncounterId],
  );

  const messages = useMemo(() => allMessages.filter(accepts), [allMessages, accepts]);
  useEffect(() => {
    setSendError("");
    setNewMessageCount(0);
    nearBottomRef.current = true;
    lastMessageKeyRef.current = null;
  }, [scopeKind, scopeSquadId, scopeEncounterId]);

  useEffect(() => {
    joinChat(scope);
    if (controlled) return;
    const unsub = subscribeChat((msg) => {
      if (!accepts(msg)) return;
      setLocalMessages((prev) => mergeChatMessage(prev, msg));
    });
    return () => {
      try {
        unsub();
      } catch {}
    };
    // Re-join / re-subscribe only when the meaningful scope identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKind, scopeSquadId, scopeEncounterId, accepts, controlled]);

  const scrollToLatest = useCallback(() => {
    const behavior = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
    endRef.current?.scrollIntoView({ behavior, block: "end" });
    nearBottomRef.current = true;
    setNewMessageCount(0);
  }, []);

  useEffect(() => {
    const last = messages[messages.length - 1];
    const key = last ? `${messages.length}:${last.id}` : "empty";
    if (lastMessageKeyRef.current === null) {
      lastMessageKeyRef.current = key;
      scrollToLatest();
      return;
    }
    if (key === lastMessageKeyRef.current) return;
    lastMessageKeyRef.current = key;
    if (sentMessageRef.current || nearBottomRef.current) {
      sentMessageRef.current = false;
      scrollToLatest();
    } else {
      setNewMessageCount((count) => count + 1);
    }
  }, [messages, scrollToLatest]);

  function handleMessagesScroll() {
    const element = messagesRef.current;
    if (!element) return;
    nearBottomRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 48;
    if (nearBottomRef.current) setNewMessageCount(0);
  }

  function send() {
    const text = input.trim();
    if (!text) return;
    setSendError("");
    const sent = onSend
      ? onSend(text)
      : sendChatMessage(scope, text, {
          id: session.user?.id ?? "",
          name: session.user?.name ?? "You",
        });
    if (!sent) {
      setSendError("Message not sent. Check your connection and try again.");
      return;
    }
    setInput("");
    sentMessageRef.current = true;
    scrollToLatest();
    // No optimistic append — the server echo arrives via subscribeChat.
  }

  function addEmoji(emoji: string) {
    const start = inputRef.current?.selectionStart ?? input.length;
    const end = inputRef.current?.selectionEnd ?? start;
    const next = input.slice(0, start) + emoji + input.slice(end);
    if (next.length > MAX_CHAT_TEXT_LENGTH) {
      setSendError("Your message is full. Remove a little text to add this emoji.");
      return;
    }
    setInput(next);
    setSendError("");
    setEmojiOpen(false);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(start + emoji.length, start + emoji.length);
    });
  }

  return (
    <div className={styles.panel} onKeyDown={(event) => {
      if (event.key !== "Escape" || event.nativeEvent.isComposing) return;
      if (!emojiOpen && !onClose) return;
      event.preventDefault();
      event.stopPropagation();
      if (emojiOpen) {
        setEmojiOpen(false);
        if (document.activeElement !== inputRef.current) emojiButtonRef.current?.focus();
      } else onClose?.();
    }}>
      <header className={styles.header}>
        <span className={styles.title}><Icon.chat size={18} />{title}</span>
        {onClose && <button type="button" className={styles.tool} onClick={onClose} aria-label="Close chat"><Icon.close size={19} /></button>}
      </header>
      {audienceControls}
      <div ref={messagesRef} onScroll={handleMessagesScroll} role="log" aria-live="polite" aria-label="Chat messages" className={styles.messages}>
        {messages.length === 0 ? (
          <div className={styles.empty}>
            <span aria-hidden="true"><Icon.chatDots size={28} /></span>
            <span>No messages yet. Say hi.</span>
          </div>
        ) : messages.map((msg) => {
          const own = myId != null && msg.userId === myId;
          return <div key={msg.id} className={styles.message} data-own={own}>
            <div className={styles.meta}>
              {!own && <span className={styles.sender}>{msg.name}</span>}
              <time dateTime={new Date(msg.ts).toISOString()}>{relTime(msg.ts)}</time>
            </div>
            <div className={styles.bubble}>{chatTextParts(msg.text).map((part, i) => part.href
              ? <a key={i} href={part.href} target="_blank" rel="noopener noreferrer">{part.text}</a>
              : part.text)}</div>
            {msg.delivery === "sending" && <span className={styles.delivery}>Sending…</span>}
            {msg.delivery === "failed" && <button type="button" className={styles.retry} onClick={() => onRetry?.(msg)}>Retry</button>}
          </div>;
        })}
        <div ref={endRef} />
      </div>
      {newMessageCount > 0 && <button type="button" className={styles.newMessages} onClick={scrollToLatest} aria-label={`Jump to ${newMessageCount} new message${newMessageCount === 1 ? "" : "s"}`}>New messages ↓</button>}
      <div className={styles.composer}>
        {sendError && <div role="alert" className={styles.error}>{sendError}</div>}
        {emojiOpen && <div ref={emojiRef} id={emojiId} role="group" aria-label="Emoji choices" className={styles.emojis} onKeyDown={(event) => {
          const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button"));
          const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
          const offset = EMOJI_OFFSETS[event.key];
          if (offset == null && event.key !== "Home" && event.key !== "End") return;
          event.preventDefault();
          event.stopPropagation();
          const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (offset ?? 0) + buttons.length) % buttons.length;
          buttons[next]?.focus();
        }}>
          {EMOJIS.map(([emoji, label]) => <button type="button" key={label} className={styles.tool} aria-label={label} onClick={() => addEmoji(emoji)}>{emoji}</button>)}
        </div>}
        <div className={styles.inputRow}>
          <button ref={emojiButtonRef} type="button" className={styles.tool} aria-label="Add emoji" aria-expanded={emojiOpen} aria-controls={emojiId} onClick={() => setEmojiOpen((open) => !open)}>🙂</button>
          <input ref={inputRef} className={styles.input} value={input} onChange={(event) => {
            setSendError("");
            setInput(event.target.value.slice(0, MAX_CHAT_TEXT_LENGTH));
          }} maxLength={MAX_CHAT_TEXT_LENGTH} onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); send(); }
          }} placeholder="Say something…" aria-label="Chat message" />
          <button type="button" onClick={send} disabled={!input.trim() || input.trim().length > MAX_CHAT_TEXT_LENGTH} aria-label="Send message" className={styles.send}><Icon.send size={19} /></button>
        </div>
      </div>
    </div>
  );
}

export default ChatPanel;

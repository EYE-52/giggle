"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styles from "./GamePanel.module.css";
import { api } from "@giggle/core";
import {
  DEFAULT_PRESENTATION,
  GAME_BRIDGE_VERSION,
  buildEmbedUrl,
  buildVoiceState,
  createAuthNonce,
  isFreshAuthAck,
  isGameChildMessage,
  isValidCount,
  isValidCameraScene,
  isValidPresentation,
  isValidVoiceMic,
  parseGamesUrl,
  type GameParentMessage,
  type GamePresentation,
  type GameCameraScene,
  type VoiceMic,
} from "@/lib/gameBridge";
import { useTheme } from "@/components/useTheme";
import { Button } from "@/components/Button";

// Game Night theme ids this panel may request (validated both sides): the
// parent's dark/light look maps to the child's Night/Day.
const THEME_FOR_MODE = { dark: "night", light: "day" } as const;

// Continuous authorization: fresh 90-second tickets ~every 60s leave a 30s
// margin before the ticket's own expiry ends the server lease. Renewal
// reuses the SAME iframe/socket/seat — never a leave/rejoin.
const RENEW_EVERY_MS = 60_000;
// Bounded recovery when the frame never reports live (missing service,
// 404, blocked embed): show retry instead of an endless blank frame.
const READY_TIMEOUT_MS = 20_000;

// Video layout override owned by the lobby: auto follows the child's
// contextual hint, faces/compact pin one layout across game changes.
export type GameLayoutOverride = "auto" | "faces" | "compact" | "floating" | "stage";

interface Props {
  squadId: string;
  onClose: () => void;
  // Stable presentation updates for the lobby rail (deduped; authed only).
  // Read via ref so subscribing never re-runs auth effects.
  onPresentation?: (p: GamePresentation) => void;
  onCameraScene?: (scene: GameCameraScene | null) => void;
  layout?: GameLayoutOverride;
  onLayoutChange?: (l: GameLayoutOverride) => void;
  // Encounter calls share ONE game room for both squads: when set, tickets
  // come from the encounter token route (same 90s single-use protocol)
  // instead of the squad route. Renewal, layout, and close are unchanged.
  encounter?: { encounterId: string };
  // Voice capability: the page's ACTUAL mic capture status plus its existing
  // device toggle. The child never captures — a voice-request only shows the
  // parent prompt below, and only the player's click on its real Enable
  // microphone button invokes onEnableMic (existing toggle, real gesture).
  voice?: { mic: VoiceMic; onEnableMic: () => void };
}

// Squad games inside the lobby (or encounter games inside the call): frames
// Game Night and passes single-use tickets over postMessage v1. The iframe
// gets NO camera/mic permission — media stays entirely in this parent page.
export function GamePanel({ squadId, onClose, onPresentation, onCameraScene, layout = "auto", onLayoutChange, encounter, voice }: Props) {
  const themeMode = useTheme();
  const [status, setStatus] = useState<"loading" | "live" | "unavailable" | "error">("loading");
  const [detail, setDetail] = useState<string | null>(null);
  const [embedUrl, setEmbedUrl] = useState<string | null>(null);
  const [presence, setPresence] = useState<{ game: string | null; players: number; watchers?: number } | null>(null);
  // Every Retry (or auth-needed recovery) bumps the attempt so the bounded
  // ready-timeout below re-arms even when the frame src stays the same.
  const [attempt, setAttempt] = useState(0);
  // Remount key for the game iframe ONLY: bumped when Retry must reload a
  // never-answered (404/blank) document. The parent — call media, seats,
  // controls — never remounts for this.
  const [frameKey, setFrameKey] = useState(0);

  const frameRef = useRef<HTMLIFrameElement>(null);
  const originRef = useRef<string>("");
  const mountedRef = useRef(true);
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const statusRef = useRef(status);
  statusRef.current = status;
  // True only after THIS panel's iframe posted the verified `authed`
  // acknowledgment (the child sends it after the game server accepts a
  // ticket on the child's socket). A posted ticket or a stale state
  // snapshot never sets it — only live authorization does.
  const authedRef = useRef(false);
  // True only after a live child script answers (ready/auth-needed) or an
  // ack correlated to THIS attempt is accepted: the framed document is
  // alive, not a 404/blank/blocked load. Retry reloads only a never-heard
  // frame. Shape-valid but uncorrelated traffic (a stale/spoofed ack, a
  // pre-auth state snapshot) never sets this.
  const heardRef = useRef(false);
  // Nonce posted with the latest ticket: an `authed` ack counts only when
  // it echoes this exact value, so stale acks (an older ticket's echo
  // arriving after a Retry/renewal) can never mark the panel live.
  const pendingAuthRef = useRef<string | null>(null);

  // Latest theme WITHOUT re-running auth: a look switch posts context only
  // (no iframe remount, no new ticket).
  const themeRef = useRef(THEME_FOR_MODE[themeMode] ?? "day");
  themeRef.current = THEME_FOR_MODE[themeMode] ?? "day";

  // Latest presentation subscriber WITHOUT re-running auth: the message
  // handler below reads this ref, so its deps stay [requestAuth].
  const onPresentationRef = useRef(onPresentation);
  onPresentationRef.current = onPresentation;
  // Last hint forwarded: identical snapshots (per-tick room echoes) never
  // re-notify the lobby.
  const presentationRef = useRef<GamePresentation>(DEFAULT_PRESENTATION);
  const onCameraSceneRef = useRef(onCameraScene);
  onCameraSceneRef.current = onCameraScene;
  const cameraKeyRef = useRef("null");

  // Voice capability WITHOUT re-running auth: the message handler and the
  // Enable button read this ref, so the page's per-render voice object never
  // re-runs effects — only the mic string itself is a dep (see below).
  const voiceRef = useRef(voice);
  voiceRef.current = voice;
  // Open voice prompt: the latest request id, echoed in the direct answer.
  // Cleared when the mic goes live, on dismiss, on Retry, and on unmount.
  const [voicePrompt, setVoicePrompt] = useState<{ id: string } | null>(null);

  // The one origin we frame and trust, from build-time config.
  // Memoized: doAuth/requestAuth (and their effects) key off this value.
  const configured = useMemo(
    () => parseGamesUrl(process.env.NEXT_PUBLIC_GAMES_URL),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [process.env.NEXT_PUBLIC_GAMES_URL]
  );

  const postToChild = useCallback((msg: GameParentMessage) => {
    const frame = frameRef.current;
    const origin = originRef.current;
    if (!frame?.contentWindow || !origin) return;
    // Exact configured origin — never '*'.
    frame.contentWindow.postMessage(msg, origin);
  }, []);

  // Stable: reads the latest theme from a ref, so look switches never
  // re-run the mount-auth effect — they only re-post context.
  const sendContext = useCallback(() => {
    postToChild({ v: GAME_BRIDGE_VERSION, t: "context", theme: themeRef.current });
  }, [postToChild]);

  // Encounter scope (stable string dep): when set, tickets come from the
  // encounter route so both squads share one game room; otherwise the squad
  // route. Read once per render — the object identity never re-runs auth.
  const encounterId = encounter?.encounterId ?? null;

  // Mint a FRESH ticket for every auth send (single-use: never reused).
  // Stable across theme changes: depends only on scope/config.
  const doAuth = useCallback(async () => {
    if (!configured) {
      if (mountedRef.current) {
        setStatus("unavailable");
        setDetail(null);
      }
      return;
    }
    try {
      const { gameUrl, ticket } = encounterId !== null
        ? await api.encounterGameToken(encounterId)
        : await api.gameToken(squadId);
      if (!mountedRef.current) return;
      const served = parseGamesUrl(gameUrl);
      // The served game URL must match our configured frame origin.
      if (!served || served.origin !== configured.origin) {
        authedRef.current = false;
        pendingAuthRef.current = null; // failed attempt authorizes nothing
        setStatus("error");
        setDetail("The game service answered unexpectedly. Try again.");
        return;
      }
      originRef.current = served.origin;
      const src = buildEmbedUrl(served.gamesUrl, window.location.origin);
      if (!src) {
        authedRef.current = false;
        pendingAuthRef.current = null; // failed attempt authorizes nothing
        setStatus("error");
        setDetail("The game service answered unexpectedly. Try again.");
        return;
      }
      setEmbedUrl(prev => prev ?? src);
      // Fresh nonce per auth send (single-use, like the ticket): the child
      // echoes it in `authed`, and only that echo counts (see below).
      const nonce = createAuthNonce();
      pendingAuthRef.current = nonce;
      postToChild({ v: GAME_BRIDGE_VERSION, t: "auth", ticket, n: nonce });
      sendContext();
      // A freshly posted ticket clears a previous authorization error and
      // re-arms the bounded recovery timer; posting alone never proves
      // anything — only the child's `authed` acknowledgment promotes to
      // live (see the message handler below).
      if (statusRef.current === "error") {
        setStatus("loading");
        setDetail(null);
        setAttempt(a => a + 1);
      }
    } catch (e) {
      if (!mountedRef.current) return;
      authedRef.current = false;
      pendingAuthRef.current = null; // failed attempt authorizes nothing
      const code = (e as { code?: string })?.code;
      const statusCode = (e as { status?: number })?.status;
      if (code === "GAMES_UNAVAILABLE" || statusCode === 503) {
        setStatus("unavailable");
        setDetail(null);
      } else if (code === "INTERACTION_BLOCKED" || statusCode === 403) {
        setStatus("error");
        setDetail(encounterId !== null ? "Games aren't available for this call right now." : "Games aren't available for this squad right now.");
      } else {
        setStatus("error");
        setDetail("Couldn't reach the game service. Try again.");
      }
    }
  }, [configured, postToChild, sendContext, squadId, encounterId]);

  // Serialize auth sends so rapid ready/auth-needed events don't race.
  const requestAuth = useCallback(() => {
    queueRef.current = queueRef.current.then(() => doAuth()).catch(() => {});
  }, [doAuth]);

  // Initial ticket: fetch on mount so the frame is authorized as soon as
  // it says ready (and retry cleanly if the first attempt fails early).
  // Stable deps: runs once — theme changes must NOT re-run this.
  useEffect(() => {
    mountedRef.current = true;
    requestAuth();
    return () => {
      mountedRef.current = false;
    };
  }, [requestAuth]);

  // Continuous authorization: renew ~every 60s once framed. The child
  // renews on its SAME socket/seat; cleanup stops the timer on unmount.
  useEffect(() => {
    if (!embedUrl) return;
    const timer = setInterval(() => {
      requestAuth();
    }, RENEW_EVERY_MS);
    return () => clearInterval(timer);
  }, [embedUrl, requestAuth]);

  // Bounded recovery: if the frame never reports live, surface retry
  // instead of a blank frame. Keys on the attempt as well as the frame src
  // so every Retry re-arms a fresh bounded timeout. The game iframe itself
  // remounts only when Retry must reload a never-answered document (see
  // retry); the parent — call media included — never remounts for this.
  // Already-visible error/unavailable states win.
  useEffect(() => {
    if (!embedUrl) return;
    const timer = setTimeout(() => {
      if (!mountedRef.current) return;
      if (statusRef.current !== "loading") return;
      setStatus("error");
      setDetail("The game service isn't responding. Try again.");
    }, READY_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [embedUrl, attempt]);

  // Child messages: exact source + exact origin + shape/version, always.
  useEffect(() => {
    const onMessage = (ev: MessageEvent) => {
      const frame = frameRef.current;
      // Exact source: only our own iframe — never an unrelated frame,
      // even a same-origin one.
      if (!frame || ev.source !== frame.contentWindow) return;
      if (!originRef.current || ev.origin !== originRef.current) return;
      if (!isGameChildMessage(ev.data)) return;
      if (ev.data.t === "ready" || ev.data.t === "auth-needed") {
        // A live child script answering: this proves a live document.
        heardRef.current = true;
        requestAuth();
        return;
      }
      if (ev.data.t === "authed") {
        // Verified authorization: the game server accepted a ticket on the
        // child's socket, AND the ack echoes this panel's fresh pending
        // nonce. A stale or spoofed ack is dropped here WITHOUT marking the
        // frame heard — otherwise a dead (404/blank) document with injected
        // traffic would look alive and Retry would post into it instead of
        // reloading it. Only a fresh ack proves the document and promotes
        // loading to live.
        if (!isFreshAuthAck(pendingAuthRef.current, ev.data)) return;
        heardRef.current = true;
        authedRef.current = true;
        // Single-use: consume the pending id so an old duplicate can never
        // authorize a later attempt.
        pendingAuthRef.current = null;
        if (mountedRef.current) {
          setStatus(prev => (prev === "loading" ? "live" : prev));
        }
        return;
      }
      if (ev.data.t === "voice-request") {
        // Voice needs verified authorization too: a pre-auth request (stale
        // or spoofed traffic before the server accepted a ticket) is dropped
        // without a prompt and without marking the frame heard — and nothing
        // is ever captured from a postMessage, only this UI prompt is shown.
        if (!authedRef.current) return;
        const v = voiceRef.current;
        if (!v || !isValidVoiceMic(v.mic)) return;
        if (v.mic === "active") {
          // Already enabled: answer active directly (echoing the request id
          // so the child can reject stale answers), no prompt needed.
          const direct = buildVoiceState("active", true, ev.data.id);
          if (direct) postToChild(direct);
          return;
        }
        setVoicePrompt({ id: ev.data.id });
        return;
      }
      if (ev.data.t === "state") {
        // Presence only: a state snapshot never marks the frame heard. Only
        // a live child script (ready/auth-needed) or an accepted current ack
        // proves the document — a stale pre-auth snapshot must not make a
        // dead document look answered.
        const players = isValidCount(ev.data.players) ? ev.data.players : 0;
        const watchers = isValidCount(ev.data.watchers) ? ev.data.watchers : undefined;
        setPresence({ game: ev.data.game ?? null, players, watchers });
        // Only verified authorization promotes loading to live: a stale
        // state snapshot (or a lingering room echo after an error) never
        // clears loading while `authed` is still missing.
        if (mountedRef.current) {
          setStatus(prev => (prev === "loading" && authedRef.current ? "live" : prev));
        }
        // Contextual hint for the lobby rail: ignored until verified
        // authorization (stale pre-auth state cannot change layout), omitted
        // (old child) falls back to balanced, and identical hints never
        // re-notify. The frame is never touched here — same iframe across
        // modes, game changes, and rematches.
        if (authedRef.current) {
          const camera = isValidCameraScene(ev.data.camera) ? ev.data.camera : null;
          const cameraKey = JSON.stringify(camera);
          if (cameraKey !== cameraKeyRef.current) {
            cameraKeyRef.current = cameraKey;
            onCameraSceneRef.current?.(camera);
          }
          const raw = ev.data.presentation ?? DEFAULT_PRESENTATION;
          const next = isValidPresentation(raw) ? raw : DEFAULT_PRESENTATION;
          if (next !== presentationRef.current) {
            presentationRef.current = next;
            onPresentationRef.current?.(next);
          }
        }
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [requestAuth]);

  // Theme follows the active look (validated ids only): a context post,
  // never a remount or a new ticket.
  useEffect(() => {
    if (status === "live" || embedUrl) sendContext();
  }, [themeMode, sendContext, status, embedUrl]);

  // Voice status pushes: the page's actual capture truth flows to the child
  // on every mic change (and once when the panel goes live), unsolicited —
  // the child never polls. A live mic also resolves any open prompt. The
  // call, its client, and every video node are untouched: this only posts.
  const voiceMic = voice?.mic;
  useEffect(() => {
    if (!authedRef.current || !voiceRef.current || !voiceMic) return;
    const push = buildVoiceState(voiceMic, true);
    if (push) postToChild(push);
    if (voiceMic === "active") setVoicePrompt(null);
  }, [voiceMic, status, postToChild]);

  // The prompt's real Enable microphone button: invokes the page's EXISTING
  // device toggle inside this click gesture. Never called from a message,
  // an effect, or a timer — only from the player's click.
  const enableVoiceMic = () => {
    voiceRef.current?.onEnableMic();
  };

  const retry = () => {
    setDetail(null);
    setStatus("loading");
    setVoicePrompt(null);
    authedRef.current = false;
    pendingAuthRef.current = null; // in-flight stale acks cannot land here
    setAttempt(a => a + 1); // re-arm the bounded timeout for this attempt
    if (embedUrl && !heardRef.current) {
      // The framed document never answered (service 404, blank load, or
      // blocked embed): posting another ticket into it cannot repair it,
      // so reload the FAILED game iframe. Only the iframe remounts — the
      // parent video and call controls stay mounted. Auth-only Retry on a
      // live (already-heard) frame preserves the frame instead.
      setFrameKey(k => k + 1);
    }
    requestAuth();
  };

  const frameFailed = () => {
    setStatus("error");
    setDetail("Couldn't reach the game service. Try again.");
  };

  return (
    <div className={styles.panel} data-testid="game-panel" data-status={status}>
      <div className={styles.head}>
        <div className={styles.title}>
          <strong>Game night</strong>
          <span className={styles.sub}>
            {presence && presence.game
              ? `${presence.players} playing` +
                (presence.watchers ? ` · ${presence.watchers} watching` : "")
              : "Pick something to play"}
          </span>
        </div>
        {onLayoutChange && (
          <label className={styles.layoutSwitch}>
            <svg className={styles.layoutLabel} aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="5" width="12" height="14" rx="3"/><path d="m15 9 6-3v12l-6-3" strokeLinejoin="round"/></svg>
            <select
              className={styles.layoutSelect}
              value={layout}
              onChange={e => onLayoutChange(e.target.value as GameLayoutOverride)}
              aria-label="Video layout"
            >
              <option value="auto">Auto</option>
              <option value="faces">Faces</option>
              <option value="compact">Compact</option>
              <option value="floating">Floating</option>
              <option value="stage">Game stage</option>
            </select>
          </label>
        )}
        <button type="button" className={styles.close} onClick={onClose} aria-label="Close games">
          <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="m6 6 12 12M18 6 6 18"/></svg>
        </button>
      </div>
      {status === "unavailable" || (!embedUrl && status !== "loading") ? (
        <div className={styles.fallback} role="status">
          <p className={styles.fallbackTitle}>Games are unavailable</p>
          <p className={styles.fallbackSub}>{detail ?? "The game service isn't set up right now."}</p>
          <Button variant="secondary" onClick={retry}>Retry</Button>
        </div>
      ) : status === "error" && !embedUrl ? (
        <div className={styles.fallback} role="alert">
          <p className={styles.fallbackTitle}>Games aren't working right now</p>
          <p className={styles.fallbackSub}>{detail ?? "Try again in a moment."}</p>
          <Button variant="secondary" onClick={retry}>Retry</Button>
        </div>
      ) : (
        <div className={styles.frameWrap}>
          {status === "loading" && !embedUrl && (
            <div className={styles.fallback} role="status">
              <p className={styles.fallbackTitle}>Loading games…</p>
            </div>
          )}
          {status === "error" && embedUrl && (
            <div className={styles.authError} role="alert">
              <span className={styles.authErrorText}>{detail ?? "Games aren't working right now."}</span>
              <Button variant="secondary" onClick={retry}>Retry</Button>
            </div>
          )}
          {voicePrompt && voice && (
            <div className={styles.voicePrompt} role="dialog" aria-label="Voice chat request">
              <span className={styles.voicePromptText}>
                {voice.mic === "denied"
                  ? "This game wants voice chat, but the microphone is blocked."
                  : voice.mic === "unavailable"
                    ? "This game wants voice chat, but no microphone was found."
                    : "This game wants voice chat."}
              </span>
              <button type="button" className={styles.voiceEnable} onClick={enableVoiceMic}>
                Enable microphone
              </button>
              <button type="button" className={styles.voiceDismiss} onClick={() => setVoicePrompt(null)} aria-label="Dismiss voice request">
                Dismiss
              </button>
            </div>
          )}
          {embedUrl && (
            <iframe
              ref={frameRef}
              key={frameKey}
              data-testid="game-frame"
              title="Squad games"
              src={embedUrl}
              className={styles.frame}
              onError={frameFailed}
              // No camera/microphone: media stays entirely in this parent.
              allow="autoplay; clipboard-write; encrypted-media; fullscreen"
            />
          )}
        </div>
      )}
    </div>
  );
}

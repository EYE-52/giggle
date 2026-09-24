"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { AvatarArt } from "./AvatarArt";
import { Modal, useFocusTrap } from "./Modal";
import styles from "./ParticipantVideoTile.module.css";

type Fit = "fit" | "crop";
type Props = {
  name: string; colorIndex: number; micOn?: boolean; isLocal?: boolean; isSpeaking?: boolean;
  videoRef?: (el: HTMLDivElement | null) => void;
  hasVideo: boolean; mutedForMe?: boolean; onMute?: (muted: boolean) => Promise<void>;
  onClick?: () => void; focused?: boolean; showFocusHint?: boolean; compact?: boolean;
  fit?: Fit; backdrop?: boolean; animClass?: string; avatarValue?: string; statusText?: string;
  reactions?: { id: number; emoji: string }[];
};

function PersonMenu({ anchor, onClose, children, name }: {
  anchor: HTMLButtonElement | null; onClose: () => void; children: React.ReactNode; name: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 12, top: 12 });
  useFocusTrap(ref);
  useLayoutEffect(() => {
    const place = () => {
      if (!anchor || !ref.current) return;
      const box = anchor.getBoundingClientRect(), menu = ref.current.getBoundingClientRect();
      setPosition({ left: Math.max(12, Math.min(box.right - menu.width, window.innerWidth - menu.width - 12)),
        top: Math.max(12, Math.min(box.bottom + 6, window.innerHeight - menu.height - 12)) });
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [anchor]);
  return createPortal(<div className={styles.menuVeil} onClick={onClose} onKeyDown={e => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } }}>
    <div ref={ref} role="dialog" aria-modal="true" aria-label={`${name}'s options`} className={styles.menu} style={position} onClick={e => e.stopPropagation()}>
      <strong>{name}</strong>{children}
    </div>
  </div>, document.body);
}

/** Stable media host: framing and menus never rejoin, resubscribe or move a track. */
export function ParticipantVideoTile({ name, colorIndex, micOn, isLocal, isSpeaking, videoRef, hasVideo,
  mutedForMe, onMute, onClick, focused, fit: initialFit = "crop", avatarValue, statusText = "Camera off", reactions = [] }: Props) {
  const host = useRef<HTMLDivElement>(null), button = useRef<HTMLButtonElement>(null);
  const backdrop = useRef<HTMLVideoElement>(null), preview = useRef<HTMLVideoElement>(null);
  const [fit, setFit] = useState<Fit>(initialFit), [zoom, setZoom] = useState(1);
  const [panel, setPanel] = useState<"menu" | "framing" | null>(null);
  const [pending, setPending] = useState(false), [error, setError] = useState("");
  const [ratio, setRatio] = useState(1);

  useEffect(() => { setFit(initialFit); setZoom(1); }, [initialFit]);
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) setRatio(width / height);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let foreground: HTMLVideoElement | null = null;
    const copies = [backdrop.current, preview.current].filter(Boolean) as HTMLVideoElement[];
    const sync = () => {
      for (const copy of copies) {
        const source = foreground?.srcObject ?? null;
        if (copy.srcObject === source) continue;
        copy.srcObject = source;
        if (source) void copy.play().catch(() => {});
      }
    };
    const bind = () => {
      const next = element.querySelector("video");
      if (next !== foreground) {
        foreground?.removeEventListener("loadedmetadata", sync);
        foreground?.removeEventListener("resize", sync);
        foreground?.removeEventListener("playing", sync);
        foreground = next;
        foreground?.addEventListener("loadedmetadata", sync);
        foreground?.addEventListener("resize", sync);
        foreground?.addEventListener("playing", sync);
      }
      sync();
    };
    const observer = new MutationObserver(bind);
    observer.observe(element, { childList: true, subtree: true });
    bind();
    return () => {
      observer.disconnect();
      foreground?.removeEventListener("loadedmetadata", sync);
      foreground?.removeEventListener("resize", sync);
      foreground?.removeEventListener("playing", sync);
      for (const copy of copies) { copy.pause(); copy.srcObject = null; }
    };
  }, [fit, panel, hasVideo]);

  async function mute() {
    if (!onMute || pending) return;
    setPending(true); setError("");
    try { await onMute(!mutedForMe); setPanel(null); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not change audio. Try again."); }
    finally { setPending(false); }
  }
  const frameStyle = { "--person-zoom": zoom } as CSSProperties;
  const chooseFit = (value: Fit) => { setFit(value); setZoom(1); };
  return <div className={styles.tile} data-media-frame data-local={isLocal} data-media-fit={fit} style={frameStyle}>
    <div className={styles.fallback}>
      {avatarValue ? <AvatarArt value={avatarValue} size={58} /> : <AvatarArt value={name} size={58} />}
      <span>{statusText}</span>
    </div>
    {hasVideo && fit === "fit" && <video ref={backdrop} data-media-backdrop className={styles.backdrop} muted playsInline aria-hidden="true" />}
    <div ref={el => { host.current = el; videoRef?.(el); }} data-media-host className={styles.media} style={{ visibility: hasVideo ? "visible" : "hidden" }} />
    <span className={styles.name}>{isLocal ? "You" : name}{micOn === false && <span aria-label="Microphone off"> · Mic off</span>}{mutedForMe && <span aria-label="Muted for you"> · Muted for you</span>}{isSpeaking && !mutedForMe && <span className={styles.speaking} aria-label="Speaking" />}</span>
    <button ref={button} type="button" className={styles.trigger} aria-label={`${isLocal ? "Your" : `${name}'s`} options`} aria-haspopup="dialog" aria-expanded={panel !== null} onClick={() => { setError(""); setPanel("menu"); }}><span className={styles.dots} aria-hidden="true">•••</span></button>
    <div className={styles.reactions} aria-live="polite">{reactions.map(r => <span key={r.id} data-reaction>{r.emoji}</span>)}</div>
    {panel === "menu" && <PersonMenu anchor={button.current} onClose={() => setPanel(null)} name={isLocal ? "You" : name}>
      <button disabled={!hasVideo} onClick={() => setPanel("framing")}>Adjust view{!hasVideo && <small>Camera off</small>}</button>
      {!isLocal && <button disabled={!onMute || pending} onClick={() => void mute()}>{pending ? "Updating…" : mutedForMe ? "Unmute for me" : "Mute for me"}</button>}
      {onClick && <button onClick={() => { setPanel(null); onClick(); }}>{focused ? "Back to grid" : "Focus on this person"}</button>}
      {!isLocal && <button disabled>Enhance voice<small>Not available yet</small></button>}
      {error && <p role="alert">{error}</p>}
      {!isLocal && <p>Listening changes affect only you.</p>}
    </PersonMenu>}
    {panel === "framing" && <Modal title={isLocal ? "Your view" : `${name}'s view`} subtitle="Adjust what you see. Everyone else's view stays the same." onClose={() => setPanel(null)} width={380} style={{ background: "#faf7f2", color: "#292824", border: 0, animation: "none", "--text": "#292824", "--text-muted": "#756f66", "--surface": "#faf7f2" } as CSSProperties}>
      <div className={styles.settings}>
        <div className={styles.preview} style={{ aspectRatio: ratio, width: `min(100%, ${Math.min(220 * ratio, 336)}px)` }}><video ref={preview} muted playsInline aria-label={`${name}, framing preview`} style={{ objectFit: fit === "fit" ? "contain" : "cover", transform: `scale(${zoom})${isLocal ? " scaleX(-1)" : ""}` }} /></div>
        <div className={styles.fit}><button aria-pressed={fit === "fit"} onClick={() => chooseFit("fit")}>Full view</button><button aria-pressed={fit === "crop"} onClick={() => chooseFit("crop")}>Fill</button></div>
        <label className={styles.zoom}>Zoom <output>{zoom.toFixed(1)}×</output><input type="range" aria-label={`Zoom ${name}'s view`} min={1} max={2.5} step={.1} value={zoom} onChange={e => setZoom(Number(e.target.value))} /></label>
        <button className={styles.reset} onClick={() => { setFit(initialFit); setZoom(1); }}>Reset view</button>
      </div>
    </Modal>}
  </div>;
}

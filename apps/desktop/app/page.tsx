"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { Logomark, Wordmark } from "@/components/Brand";
import { Icon } from "@/components/Icons";
import { AvatarArt } from "@/components/AvatarArt";
import { useViewport } from "@/components/useViewport";
import { api } from "@giggle/core";

/* ===========================================================================
 * Forced dark, self-contained cinematic palette. Editorial, video-first.
 * No wall of glass cards — big type, full-bleed bands, hairline dividers,
 * real video tiles carry the visual.
 * ======================================================================== */
const C = {
  base: "#0E0D12",
  base2: "#13121A",
  text: "#F4F4F7",
  body: "#C9C9DA",
  muted: "#9A9AB0",
  dim: "#6E6E84",
  violet: "#6D52FF",
  teal: "#2FE6C8",
  lime: "#B7FF2A",
  pink: "#FF5C8A",
  hair: "rgba(255,255,255,0.10)",
  hairStrong: "rgba(255,255,255,0.18)",
};
const DISPLAY = "var(--font-space-grotesk), 'Space Grotesk', sans-serif";
const BODY = "var(--font-inter), 'Inter', sans-serif";

/* On-brand gradient fills used as the *fallback* behind every <video>. Varied
 * per tile so before the .mp4 files exist the page still looks intentional. */
const FALLBACK_GRADS = [
  "radial-gradient(120% 120% at 25% 20%, rgba(109,82,255,.55), transparent 60%), linear-gradient(150deg,#221a44,#0b0b14)",
  "radial-gradient(120% 120% at 75% 25%, rgba(255,92,138,.5), transparent 60%), linear-gradient(150deg,#3a1430,#0b0b14)",
  "radial-gradient(120% 120% at 30% 75%, rgba(61,214,192,.5), transparent 60%), linear-gradient(150deg,#0f2e2b,#0b0b14)",
  "radial-gradient(120% 120% at 70% 70%, rgba(183,255,42,.45), transparent 60%), linear-gradient(150deg,#26301a,#0b0b14)",
];

/* On-brand tile background tinted to roughly match each avatar so the person
 * fallback sits on a cohesive "screen". Deterministic by avatar id. */
const AVATAR_GRAD: Record<string, string> = {
  "violet-blob": FALLBACK_GRADS[0],
  "coral-star": FALLBACK_GRADS[1],
  "teal-bot": FALLBACK_GRADS[2],
  "lime-ghost": FALLBACK_GRADS[3],
};
function pickGrad(avatar?: string) {
  return (avatar && AVATAR_GRAD[avatar]) || FALLBACK_GRADS[0];
}

/* ---------------------------------------------------------------------------
 * Motion hooks
 * ------------------------------------------------------------------------ */
function useReducedMotion() {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setReduce(mq.matches);
    on();
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);
  return reduce;
}

function useReveal<T extends HTMLElement = HTMLDivElement>(threshold = 0.18) {
  const ref = useRef<T | null>(null);
  const [shown, setShown] = useState(true);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) { setShown(true); return; }
    const io = new IntersectionObserver(
      (es) => es.forEach((e) => { if (e.isIntersecting) { setShown(true); io.unobserve(e.target); } }),
      { threshold, rootMargin: "0px 0px -8% 0px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [threshold]);
  return { ref, shown };
}

function useScrollY(enabled: boolean) {
  const [y, setY] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => { setY(window.scrollY); raf = 0; });
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => { window.removeEventListener("scroll", onScroll); if (raf) cancelAnimationFrame(raf); };
  }, [enabled]);
  return y;
}

/* Scroll-scrub progress (0..1) for a tall pinned section. rAF-throttled. */
function useScrubProgress(enabled: boolean) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [p, setP] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!enabled) { setP(0.6); return; }
    let raf = 0;
    const compute = () => {
      raf = 0;
      const rect = el.getBoundingClientRect();
      const total = rect.height - window.innerHeight;
      if (total <= 0) { setP(0); return; }
      const scrolled = Math.min(Math.max(-rect.top, 0), total);
      setP(scrolled / total);
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(compute); };
    compute();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => { window.removeEventListener("scroll", onScroll); window.removeEventListener("resize", onScroll); if (raf) cancelAnimationFrame(raf); };
  }, [enabled]);
  return { ref, p };
}

// Social-proof counts read better rounded down to a clean figure with a "+"
// (e.g. 469 → "400+") than as an exact, seed-looking number.
function socialFloor(n: number): number {
  if (n >= 1000) return Math.floor(n / 500) * 500;
  if (n >= 100) return Math.floor(n / 100) * 100;
  if (n >= 20) return Math.floor(n / 10) * 10;
  return Math.max(0, n);
}
const socialPlus = (n: number): string => (n >= 20 ? "+" : "");

function CountUp({ value, duration = 1600 }: { value: number; duration?: number }) {
  const { ref, shown } = useReveal<HTMLSpanElement>();
  const [n, setN] = useState(0);
  const fromRef = useRef(0);
  const reduce = useReducedMotion();
  useEffect(() => {
    if (!shown) return;
    if (reduce) { setN(value); fromRef.current = value; return; }
    // Animate from the currently-displayed value to the new target so live
    // poll updates tick smoothly (not a jarring reset to 0 each refresh).
    const from = fromRef.current;
    let raf = 0; const start = performance.now();
    const tick = (t: number) => {
      const k = Math.min(1, (t - start) / duration);
      const eased = 1 - Math.pow(1 - k, 3);
      const cur = Math.round(from + (value - from) * eased);
      setN(cur);
      if (k < 1) raf = requestAnimationFrame(tick);
      else fromRef.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [shown, value, duration, reduce]);
  return <span ref={ref}>{n.toLocaleString()}</span>;
}

function Reveal({ children, delay = 0, y = 30, style }: { children: React.ReactNode; delay?: number; y?: number; style?: React.CSSProperties }) {
  const { ref, shown } = useReveal();
  return (
    <div ref={ref} style={{
      opacity: shown ? 1 : 0,
      transform: shown ? "none" : `translate3d(0,${y}px,0)`,
      transition: `opacity .8s cubic-bezier(.22,1,.36,1) ${delay}ms, transform .9s cubic-bezier(.22,1,.36,1) ${delay}ms`,
      willChange: "opacity, transform",
      ...style,
    }}>{children}</div>
  );
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const seg = (t: number, a: number, b: number) => clamp01((t - a) / (b - a));

/* ===========================================================================
 * VideoFrame — the core building block. A bare rounded video element with a
 * tasteful gradient fallback BEHIND it. Plays the .mp4 when present; if the
 * file 404s (it will until the user drops the clips in) onError hides the
 * <video> and the gradient + centered AvatarArt person + name chip + live dot
 * remain — so every tile clearly reads as a participant on the call (exactly
 * like a camera-off participant in the real app). No glass frame.
 * ======================================================================== */
function VideoFrame({
  src, img, grad, label, live = true, radius = 16, aspect = "4/3",
  style, dot = C.lime, reduce = false, avatar, avatarSize = 84,
}: {
  src?: string; img?: string; grad: string; label?: string; live?: boolean; radius?: number;
  aspect?: string; style?: React.CSSProperties; dot?: string; reduce?: boolean;
  avatar?: string; avatarSize?: number;
}) {
  const [failed, setFailed] = useState(false);
  const [imgFailed, setImgFailed] = useState(false);
  const videoOn = src && !failed;
  const imgOn = img && !imgFailed && !videoOn;
  // avatar is the LAST-resort person fallback — only when no real video/photo.
  const showAvatar = avatar && !videoOn && !imgOn;
  return (
    <div style={{
      position: "relative", aspectRatio: aspect, borderRadius: radius, overflow: "hidden",
      background: grad, ...style,
    }}>
      {/* gentle inner light so the gradient fallback reads as a "screen" */}
      <div aria-hidden style={{ position: "absolute", inset: 0, background: "radial-gradient(130% 100% at 30% 12%, rgba(255,255,255,.16), transparent 55%)" }} />
      {/* animated sheen on the fallback (hidden once media paints over it) */}
      {!reduce && !videoOn && !imgOn && (
        <div aria-hidden style={{ position: "absolute", inset: "-40%", background: "linear-gradient(115deg, transparent 40%, rgba(255,255,255,.07) 50%, transparent 60%)", animation: "sheen 7s ease-in-out infinite" }} />
      )}
      {/* real-people PHOTO (Adobe Stock) — shows now; video paints over it later.
          Natural true color; the surrounding tile scrim/border handles seating. */}
      {img && !imgFailed && (
        <img
          src={img} alt="" aria-hidden onError={() => setImgFailed(true)}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", display: "block", filter: "brightness(0.94) contrast(1.03) saturate(1.02)" }}
        />
      )}
      {videoOn && (
        <video
          autoPlay muted loop playsInline preload="metadata"
          onError={() => setFailed(true)}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", display: "block" }}
        >
          <source src={src} type="video/mp4" />
        </video>
      )}
      {/* slight bottom scrim so the name chip stays legible over a photo */}
      {(imgOn || videoOn) && (
        <div aria-hidden style={{ position: "absolute", inset: 0, background: "linear-gradient(to top, rgba(7,7,11,.5), transparent 38%)" }} />
      )}
      {/* Person fallback — centered avatar so the tile reads as a participant
          (only when there's no real photo/video yet). */}
      {showAvatar && (
        <div aria-hidden style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", pointerEvents: "none" }}>
          <div style={{ filter: "drop-shadow(0 10px 30px rgba(0,0,0,.55))", animation: reduce ? undefined : "floaty 6s ease-in-out infinite" }}>
            <AvatarArt value={avatar!} size={avatarSize} />
          </div>
        </div>
      )}
      {label && (
        <div style={{ position: "absolute", left: 10, bottom: 9, display: "inline-flex", alignItems: "center", gap: 6, background: "rgba(7,7,11,.5)", backdropFilter: "blur(6px)", padding: "4px 9px", borderRadius: 999, fontSize: 11, fontWeight: 600, color: "#fff", fontFamily: BODY }}>
          {live && <span style={{ width: 6, height: 6, borderRadius: "50%", background: dot, boxShadow: `0 0 8px ${dot}`, animation: reduce ? undefined : "blink 1.5s ease-in-out infinite" }} />}
          {label}
        </div>
      )}
    </div>
  );
}

/* ===========================================================================
 * HeroVS — the cinematic "live encounter" centerpiece. A unified glass call
 * window (slim app chrome on top) holding the matchup:
 *   YOUR SQUAD (2 photo tiles) — VS medallion — THEIR SQUAD (2 photo tiles).
 * Depth: 3D perspective tilt (preserve-3d), layered drop shadows, an ambient
 * color bloom behind the panel, a floor reflection, and slight scroll parallax.
 * Mobile/tablet (stack=true): drop the tilt, simplify, stay gorgeous.
 * ======================================================================== */
function SquadTiles({ side, tiles, reduce }: {
  side: "your" | "their";
  tiles: { label: string; src?: string; img?: string; dot: string; avatar: string }[];
  reduce: boolean;
}) {
  const accent = side === "your" ? C.teal : C.pink;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 9, minWidth: 0 }}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 10.5, fontWeight: 700, letterSpacing: ".14em", textTransform: "uppercase", color: accent, fontFamily: DISPLAY }}>
        <span style={{ width: 5, height: 5, borderRadius: "50%", background: accent, boxShadow: `0 0 8px ${accent}` }} />
        {side === "your" ? "Your squad" : "Their squad"}
      </span>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 9 }}>
        {tiles.map((t) => (
          <div key={t.label} style={{ position: "relative", borderRadius: 14, padding: 1, background: `linear-gradient(150deg, ${accent}55, rgba(255,255,255,.08) 45%, rgba(255,255,255,.02))`, boxShadow: "0 18px 40px -22px rgba(0,0,0,.9)" }}>
            <VideoFrame src={t.src} img={t.img} grad={pickGrad(t.avatar)} label={t.label} dot={t.dot} avatar={t.avatar} avatarSize={64} reduce={reduce} aspect="3/4" radius={13} />
          </div>
        ))}
      </div>
    </div>
  );
}

function VSMedallion({ reduce, stack, size = 64 }: { reduce: boolean; stack: boolean; size?: number }) {
  return (
    <div style={{ position: "relative", display: "grid", placeItems: "center", flexShrink: 0, alignSelf: "center", zIndex: 4, ...(stack ? {} : { transform: "translateZ(60px)" }) }}>
      {/* connecting beam through the medallion */}
      <div aria-hidden style={stack
        ? { position: "absolute", top: "-40px", bottom: "-40px", left: "50%", width: 2, transform: "translateX(-50%)", background: "linear-gradient(180deg, transparent, rgba(61,214,192,.85), rgba(109,82,255,.95), rgba(255,92,138,.85), transparent)", boxShadow: "0 0 16px rgba(109,82,255,.8)", animation: reduce ? undefined : "beam 2.8s ease-in-out infinite" }
        : { position: "absolute", left: "-52px", right: "-52px", top: "50%", height: 2, transform: "translateY(-50%)", background: "linear-gradient(90deg, transparent, rgba(61,214,192,.85), rgba(109,82,255,.95), rgba(255,92,138,.85), transparent)", boxShadow: "0 0 16px rgba(109,82,255,.8)", animation: reduce ? undefined : "beam 2.8s ease-in-out infinite" }} />
      {/* halo */}
      <div aria-hidden style={{ position: "absolute", width: size * 1.9, height: size * 1.9, borderRadius: "50%", background: "radial-gradient(circle, rgba(109,82,255,.5), transparent 65%)", filter: "blur(10px)" }} />
      {/* glowing gradient ring */}
      <div style={{ position: "relative", width: size, height: size, borderRadius: "50%", padding: 2.5, background: "conic-gradient(from 220deg, #6D52FF, #2FE6C8, #B7FF2A, #FF5C8A, #6D52FF)", boxShadow: "0 0 30px -2px rgba(109,82,255,.9), 0 16px 36px -14px rgba(0,0,0,.9)", animation: reduce ? undefined : "vspulse 2.6s ease-in-out infinite" }}>
        <div style={{ width: "100%", height: "100%", borderRadius: "50%", background: "radial-gradient(circle at 38% 30%, #1a1a2a, #0B0B12)", display: "grid", placeItems: "center", boxShadow: "inset 0 1px 2px rgba(255,255,255,.12)" }}>
          <span style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: size * 0.34, letterSpacing: "-.02em", ...shimmerText }}>VS</span>
        </div>
      </div>
    </div>
  );
}

function HeroVS({ reduce, isPhone, isTablet, parallax }: { reduce: boolean; isPhone: boolean; isTablet: boolean; parallax: number }) {
  const stack = isTablet;
  const tilt = !stack && !reduce;

  const panel = (
    <div style={{
      position: "relative",
      borderRadius: 22,
      padding: 1,
      background: "linear-gradient(155deg, rgba(255,255,255,.22), rgba(255,255,255,.04) 38%, rgba(109,82,255,.18))",
      boxShadow: tilt
        ? "0 2px 0 rgba(255,255,255,.05) inset, 0 30px 60px -30px rgba(0,0,0,.9), 0 80px 120px -60px rgba(109,82,255,.45), 0 50px 100px -40px rgba(0,0,0,.8)"
        : "0 30px 70px -36px rgba(0,0,0,.9), 0 40px 90px -50px rgba(109,82,255,.4)",
      transformStyle: "preserve-3d",
    }}>
      <div style={{
        position: "relative", borderRadius: 21, overflow: "hidden",
        background: "linear-gradient(165deg, rgba(20,20,32,.92), rgba(10,10,16,.96))",
        backdropFilter: "blur(18px)",
      }}>
        {/* top scrim glow inside the window */}
        <div aria-hidden style={{ position: "absolute", inset: 0, background: "radial-gradient(110% 70% at 50% -8%, rgba(109,82,255,.18), transparent 60%)", pointerEvents: "none" }} />

        {/* ---- app chrome bar ---- */}
        <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "11px 16px", borderBottom: `1px solid ${C.hair}`, background: "linear-gradient(to bottom, rgba(255,255,255,.05), transparent)" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 12, fontWeight: 700, letterSpacing: ".02em", color: C.text, fontFamily: BODY }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: C.lime, boxShadow: `0 0 9px ${C.lime}`, animation: reduce ? undefined : "blink 1.4s ease-in-out infinite" }} />
            LIVE <span style={{ color: C.muted, fontWeight: 600 }}>· 4 connected</span>
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 11.5, color: C.muted, fontFamily: BODY }}>
            <Icon.discover size={13} color={C.teal} /> matched by vibe
          </span>
        </div>

        {/* ---- matchup ---- */}
        <div style={{
          position: "relative", padding: isPhone ? 14 : 18,
          display: stack ? "flex" : "grid",
          flexDirection: stack ? "column" : undefined,
          gridTemplateColumns: stack ? undefined : "1fr auto 1fr",
          alignItems: "center",
          gap: stack ? 18 : 22,
        }}>
          <SquadTiles side="your" tiles={YOUR_SQUAD} reduce={reduce} />
          <VSMedallion reduce={reduce} stack={stack} size={isPhone ? 56 : 64} />
          <SquadTiles side="their" tiles={THEIR_SQUAD} reduce={reduce} />
        </div>
      </div>
    </div>
  );

  return (
    <div style={{ position: "relative", perspective: tilt ? 1400 : undefined }}>
      {/* ambient color bloom behind the whole panel */}
      <div aria-hidden style={{ position: "absolute", inset: "-12% -8%", background: "radial-gradient(60% 60% at 35% 25%, rgba(109,82,255,.4), transparent 60%), radial-gradient(55% 55% at 75% 70%, rgba(61,214,192,.28), transparent 62%)", filter: "blur(36px)", pointerEvents: "none", animation: reduce ? undefined : "drift2 26s ease-in-out infinite" }} />

      <div style={{
        position: "relative",
        transform: tilt ? `translateY(${parallax}px) rotateX(7deg) rotateY(-12deg) rotateZ(.5deg)` : `translateY(${reduce ? 0 : parallax * 0.4}px)`,
        transformStyle: "preserve-3d",
        transition: "transform .15s ease-out",
        willChange: "transform",
      }}>
        {panel}

        {/* floor reflection (desktop only) */}
        {tilt && (
          <div aria-hidden style={{ position: "absolute", top: "100%", left: 0, right: 0, height: "55%", marginTop: 10, transform: "scaleY(-1) rotateX(7deg) rotateY(-12deg)", transformOrigin: "top", opacity: 0.16, maskImage: "linear-gradient(to bottom, rgba(0,0,0,.9), transparent 60%)", WebkitMaskImage: "linear-gradient(to bottom, rgba(0,0,0,.9), transparent 60%)", filter: "blur(2px)", pointerEvents: "none" }}>
            {panel}
          </div>
        )}
      </div>
    </div>
  );
}

/* Overlapping avatar stack for the trust row — reuses the 4 stock portraits. */
function AvatarStack() {
  const imgs = ["/landing/sq1.jpg", "/landing/sq2.jpg", "/landing/sq3.jpg", "/landing/sq4.jpg"];
  return (
    <div style={{ display: "flex" }}>
      {imgs.map((src, i) => (
        <span key={src} style={{ marginLeft: i ? -10 : 0, width: 30, height: 30, borderRadius: "50%", overflow: "hidden", border: "2px solid #0B0B12", boxShadow: "0 4px 10px -4px rgba(0,0,0,.7)", background: GRADS_FALLBACK[i % GRADS_FALLBACK.length], zIndex: imgs.length - i }}>
          <img src={src} alt="" aria-hidden style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
        </span>
      ))}
    </div>
  );
}
const GRADS_FALLBACK = ["#2a2150", "#1f3a36", "#3a1f30", "#2e3a1a"];

/* ===========================================================================
 * Page
 * ======================================================================== */
export default function LandingPage() {
  const { isPhone, isTablet } = useViewport();
  const reduce = useReducedMotion();
  const scrollY = useScrollY(!reduce);
  const { ref: scrubRef, p } = useScrubProgress(!reduce);

  const [stats, setStats] = useState<{ squadsTotal: number; squadsOnline?: number; playersOnline: number; encountersTotal: number } | null>(null);
  const [statsFailed, setStatsFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    const pull = () => api.getStats()
      .then((s) => { if (alive) { setStats(s); setStatsFailed(false); } })
      .catch(() => { if (alive) setStatsFailed(true); });
    pull();
    // Poll so the "Live pulse" actually stays live (re-animates when counts move).
    const id = setInterval(pull, 12000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  const scrollTo = useCallback((id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  }, [reduce]);

  const pad = isPhone ? 22 : isTablet ? 44 : 80;
  const maxW = 1200;
  const orbA = scrollY * 0.12;
  const orbB = scrollY * -0.08;
  const heroParallax = Math.max(-24, scrollY * -0.04); // panel lifts gently on scroll

  return (
    // overflowX must stay "clip" (NOT "hidden") — hidden creates a scroll
    // container that breaks the scroll-scrubbed `position: sticky` centerpiece.
    <div data-theme="dark" style={{ position: "relative", background: C.base, color: C.text, minHeight: "100vh", overflowX: "clip", fontFamily: BODY }}>
      <style>{CSS}</style>

      {/* ===================== GLOBAL AMBIENT AURORA ===================== */}
      <div aria-hidden style={{ position: "fixed", inset: 0, zIndex: 0, pointerEvents: "none", overflow: "hidden" }}>
        <div style={{ position: "absolute", width: 760, height: 760, borderRadius: "50%", top: "-22%", left: "-12%", background: "radial-gradient(circle, rgba(109,82,255,.40), transparent 62%)", filter: "blur(70px)", transform: `translateY(${orbA}px)`, animation: reduce ? undefined : "drift1 22s ease-in-out infinite" }} />
        <div style={{ position: "absolute", width: 680, height: 680, borderRadius: "50%", top: "18%", right: "-14%", background: "radial-gradient(circle, rgba(61,214,192,.30), transparent 62%)", filter: "blur(76px)", transform: `translateY(${orbB}px)`, animation: reduce ? undefined : "drift2 27s ease-in-out infinite" }} />
        <div style={{ position: "absolute", width: 620, height: 620, borderRadius: "50%", bottom: "-18%", left: "20%", background: "radial-gradient(circle, rgba(255,92,138,.24), transparent 62%)", filter: "blur(80px)", animation: reduce ? undefined : "drift3 31s ease-in-out infinite" }} />
        <div style={{ position: "absolute", width: 520, height: 520, borderRadius: "50%", top: "55%", left: "55%", background: "radial-gradient(circle, rgba(183,255,42,.16), transparent 62%)", filter: "blur(80px)", animation: reduce ? undefined : "drift1 35s ease-in-out infinite reverse" }} />
        <div style={{ position: "absolute", inset: 0, background: "radial-gradient(120% 90% at 50% 0%, transparent 40%, rgba(7,7,11,.55) 100%), linear-gradient(to bottom, transparent 60%, rgba(7,7,11,.6))" }} />
        {/* static grain — the animated steps() jitter read as edge "flicker" */}
        <div style={{ position: "absolute", inset: 0, opacity: 0.045, mixBlendMode: "overlay", backgroundImage: GRAIN, backgroundSize: "180px 180px" }} />
      </div>

      <div style={{ position: "relative", zIndex: 1 }}>
        {/* ===================== NAV ===================== */}
        <header style={{ position: "sticky", top: 0, zIndex: 50, display: "flex", alignItems: "center", justifyContent: "space-between", padding: `16px ${pad}px`, background: "linear-gradient(to bottom, rgba(7,7,11,.72), rgba(7,7,11,0))", backdropFilter: "blur(12px)" }}>
          <Wordmark size={isPhone ? 19 : 21} />
          <nav style={{ display: "flex", alignItems: "center", gap: isPhone ? 10 : 24, overflowX: isPhone ? "auto" : undefined, maxWidth: isPhone ? "72vw" : undefined }}>
            <button onClick={() => scrollTo("how")} style={{ ...navLink, fontSize: isPhone ? 13 : 14.5, flexShrink: 0 }}>How it works</button>
            <button onClick={() => scrollTo("features")} style={{ ...navLink, fontSize: isPhone ? 13 : 14.5, flexShrink: 0 }}>Features</button>
            <Link href="/signin" style={{ ...navLink, color: C.text, minHeight: 44, padding: "0 12px", flexShrink: 0, fontSize: isPhone ? 13 : 14.5 }}>Sign in</Link>
            {/* phone: the hero's Get started CTA is immediately below — keep the nav to links that fit */}
            {!isPhone && <CtaLink href="/signin" small>Get started</CtaLink>}
          </nav>
        </header>

        {/* ===================== HERO — cinematic encounter ===================== */}
        <section
          data-testid="giggle-hero"
          style={{ position: "relative", padding: `${isPhone ? 44 : 72}px ${pad}px ${isPhone ? 56 : 100}px` }}
        >
          <div style={{ width: "100%", maxWidth: maxW, margin: "0 auto", display: "grid", gridTemplateColumns: isTablet ? "1fr" : "1.02fr 1.05fr", gap: isTablet ? 56 : 72, alignItems: "center" }}>
            <div style={{ position: "relative" }}>
              {/* soft spotlight behind the headline for drama */}
              <div aria-hidden style={{ position: "absolute", left: -80, top: -40, width: 560, height: 560, background: "radial-gradient(circle, rgba(109,82,255,.22), transparent 60%)", filter: "blur(40px)", pointerEvents: "none", zIndex: 0 }} />
              <div style={{ position: "relative", zIndex: 1 }}>
                <Reveal y={16}>
                  <span style={eyebrow}>
                    <span style={{ width: 7, height: 7, borderRadius: "50%", background: C.teal, boxShadow: `0 0 10px ${C.teal}`, animation: reduce ? undefined : "blink 1.6s ease-in-out infinite" }} />
                    Squad-to-squad live video
                  </span>
                </Reveal>
                <Reveal delay={80}>
                  <h1
                    aria-label="Your squad. Their squad. Live."
                    style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: isPhone ? "clamp(46px,13vw,60px)" : isTablet ? 76 : 94, lineHeight: 0.94, letterSpacing: "-.05em", margin: "22px 0 0" }}
                  >
                    <span aria-hidden="true">Your squad.<br />Their squad.<br /><span style={shimmerText}>Live.</span></span>
                  </h1>
                </Reveal>
                <Reveal delay={160}>
                  <p style={{ fontSize: isPhone ? 17 : 20, lineHeight: 1.55, color: C.body, margin: "26px 0 0", maxWidth: 470 }}>
                    Giggle Meet pairs your crew with another crew over live group video — matched by your vibe. No awkward solo chats. Just your people, meeting new people.
                  </p>
                </Reveal>
                <Reveal delay={240}>
                  <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 22, marginTop: 38 }}>
                    <CtaLink href="/signin">Get started <Icon.enter size={17} color="#fff" /></CtaLink>
                    <button onClick={() => scrollTo("how")} className="lp-arrow" style={arrowLink}>
                      See how it works <span data-arr style={{ display: "inline-block", transition: "transform .2s ease" }}>→</span>
                    </button>
                  </div>
                </Reveal>
                {/* trust / social-proof row */}
                <Reveal delay={320}>
                  <div style={{ display: "flex", alignItems: "center", gap: 13, marginTop: 30 }}>
                    <AvatarStack />
                    <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.3 }}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 13.5, fontWeight: 700, color: C.text, fontFamily: BODY }}>
                        <span style={{ width: 6, height: 6, borderRadius: "50%", background: C.lime, boxShadow: `0 0 8px ${C.lime}`, animation: reduce ? undefined : "blink 1.5s ease-in-out infinite" }} />
                        Squads forming now
                      </span>
                      <span style={{ fontSize: 13, color: C.muted, fontFamily: BODY }}>
                        {stats ? <><CountUp value={socialFloor(stats.playersOnline)} />{socialPlus(stats.playersOnline)} people on Giggle</> : "Join people meeting their next crew"}
                      </span>
                    </div>
                  </div>
                </Reveal>
              </div>
            </div>

            {/* The cinematic "live encounter" call window with depth. */}
            <Reveal delay={200} y={40}>
              <HeroVS reduce={reduce} isPhone={isPhone} isTablet={isTablet} parallax={heroParallax} />
            </Reveal>
          </div>
        </section>

        {/* ===================== MARQUEE (hairline, no card) ===================== */}
        <div aria-hidden style={{ position: "relative", padding: "12px 0", borderTop: `1px solid ${C.hair}`, borderBottom: `1px solid ${C.hair}`, maskImage: "linear-gradient(90deg, transparent, #000 8%, #000 92%, transparent)", WebkitMaskImage: "linear-gradient(90deg, transparent, #000 8%, #000 92%, transparent)" }}>
          <div style={{ display: "flex", gap: 0, width: "max-content", animation: reduce ? undefined : "marquee 34s linear infinite" }}>
            {[...VIBES, ...VIBES].map((v, i) => (
              <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 18, padding: "0 18px", fontFamily: DISPLAY, fontWeight: 600, fontSize: 17, letterSpacing: "-.01em", color: i % 4 === 0 ? C.violet : i % 4 === 1 ? C.teal : i % 4 === 2 ? C.pink : C.lime }}>
                {v}<span style={{ color: C.dim }}>·</span>
              </span>
            ))}
          </div>
        </div>

        {/* ===================== FULL-BLEED HOOK BAND (no card) ===================== */}
        <section style={{ position: "relative", padding: `${isPhone ? 96 : 168}px ${pad}px`, overflow: "hidden" }}>
          <div aria-hidden style={{ position: "absolute", inset: 0, background: "radial-gradient(80% 120% at 50% 50%, rgba(109,82,255,.18), transparent 62%)" }} />
          <div style={{ position: "relative", maxWidth: 1000, margin: "0 auto", textAlign: "center" }}>
            <Reveal>
              <h2
                aria-label="Meeting strangers online is awkward. Better with your squad."
                style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: isPhone ? "clamp(34px,9vw,44px)" : 68, lineHeight: 1.04, letterSpacing: "-.035em", margin: 0 }}
              >
                <span aria-hidden="true">
                  Meeting strangers online is{" "}
                  <span style={{ color: C.dim, textDecoration: "line-through", textDecorationColor: C.pink, textDecorationThickness: 3 }}>awkward</span>.
                  <br />
                  <span style={shimmerText}>Better with your squad.</span>
                </span>
              </h2>
            </Reveal>
          </div>
        </section>

        {/* ===================== HOW IT WORKS — editorial sequence ===================== */}
        <section id="how" style={{ padding: `${isPhone ? 64 : 110}px ${pad}px`, maxWidth: maxW, margin: "0 auto" }}>
          <Reveal>
            <SectionLabel>How it works</SectionLabel>
            <h2 style={h2(isPhone)}>Three taps to your next encounter</h2>
          </Reveal>
          <div style={{ marginTop: isPhone ? 36 : 64, display: "grid", gridTemplateColumns: isTablet ? "1fr" : "repeat(3,1fr)", gap: isTablet ? 32 : 28 }}>
            {STEPS.map((s, i) => {
              const accent = [C.violet, C.teal, C.lime][i];
              return (
              <Reveal key={s.title} delay={i * 120} y={28}>
                <div style={{ height: "100%" }}>
                  {/* real-photo supporting visual in a clean glass frame */}
                  <PhotoTile src={s.img} alt={s.title} aspect="16/11" radius={18} accent={accent} reduce={reduce}>
                    {/* numeral badge on the photo */}
                    <span style={{ position: "absolute", left: 12, top: 11, fontFamily: DISPLAY, fontWeight: 800, fontSize: 30, lineHeight: 1, letterSpacing: "-.04em", color: "transparent", WebkitTextStroke: `1.5px ${accent}`, textShadow: "0 2px 10px rgba(0,0,0,.5)" }}>0{i + 1}</span>
                    {/* step 2: vibe pills overlaid on the photo */}
                    {i === 1 && (
                      <div style={{ position: "absolute", left: 12, right: 12, bottom: 12, display: "flex", flexWrap: "wrap", gap: 6 }}>
                        {[{ t: "chill", on: false }, { t: "hype", on: true }, { t: "night owls", on: false }].map((v) => (
                          <span key={v.t} style={{ padding: "5px 11px", borderRadius: 999, fontSize: 11.5, fontWeight: 700, fontFamily: BODY, color: v.on ? "#07070B" : "#fff", background: v.on ? `linear-gradient(100deg, ${C.lime}, #8FE63D)` : "rgba(11,11,18,.55)", backdropFilter: "blur(8px)", border: v.on ? "none" : `1px solid ${C.hairStrong}`, boxShadow: v.on ? `0 6px 18px -8px ${C.lime}` : undefined }}>{v.t}</span>
                        ))}
                      </div>
                    )}
                  </PhotoTile>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 20 }}>
                    <s.icon size={22} color={accent} />
                    <h3 style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: isPhone ? 22 : 25, letterSpacing: "-.02em", margin: 0 }}>{s.title}</h3>
                  </div>
                  <p style={{ fontSize: 16, lineHeight: 1.6, color: C.muted, margin: "10px 0 0", maxWidth: 340 }}>{s.body}</p>
                </div>
              </Reveal>
            );})}
          </div>
        </section>

        {/* ===================== FULL-BLEED CINEMATIC SCRUB TAKEOVER (demo.mp4) ===================== */}
        {/* Tall pinned section: while in view, demo.mp4 fills the whole viewport and
            scrubs with scroll. Edge fades melt it into #07070B above/below. */}
        <section data-testid="use-case-story" ref={scrubRef} style={{ position: "relative", height: reduce ? "auto" : isPhone ? "170vh" : "210vh" }}>
          <div style={{ position: reduce ? "relative" : "sticky", top: 0, height: reduce ? "auto" : "100svh", minHeight: reduce ? "70vh" : undefined, overflow: "hidden" }}>
            <DemoStage p={p} reduce={reduce} isPhone={isPhone} pad={pad} maxW={maxW} scrollTo={scrollTo} />
          </div>
        </section>

        {/* ===================== FEATURES — alternating editorial rows ===================== */}
        <section id="features" style={{ padding: `${isPhone ? 72 : 130}px ${pad}px`, maxWidth: maxW, margin: "0 auto" }}>
          <Reveal>
            <SectionLabel>Built for crews</SectionLabel>
            <h2 style={h2(isPhone)}>Everything your squad needs to vibe</h2>
          </Reveal>
          <div style={{ display: "flex", flexDirection: "column", gap: isPhone ? 64 : 128, marginTop: isPhone ? 56 : 100 }}>
            {FEATURES.map((f, i) => {
              const flip = i % 2 === 1 && !isTablet;
              return (
                <Reveal key={f.title} y={38}>
                  <div style={{ display: "grid", gridTemplateColumns: isTablet ? "1fr" : "1fr 1fr", gap: isTablet ? 30 : 80, alignItems: "center" }}>
                    <div style={{ order: flip ? 2 : 1 }}>
                      <span style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 13, letterSpacing: ".12em", textTransform: "uppercase", color: f.accent }}>{`0${i + 1}`}</span>
                      <h3 style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: isPhone ? 30 : 42, letterSpacing: "-.03em", lineHeight: 1.05, margin: "14px 0 16px" }}>{f.title}</h3>
                      <p style={{ fontSize: isPhone ? 17 : 19, lineHeight: 1.6, color: C.body, margin: 0, maxWidth: 460 }}>{f.body}</p>
                    </div>
                    <div style={{ order: flip ? 1 : 2 }}>{f.visual(reduce)}</div>
                  </div>
                </Reveal>
              );
            })}
          </div>
        </section>

        {/* ===================== LIVE STATS — clean strip, hairline dividers =====================
            Stays mounted while loading (shimmer tiles) and on fetch failure
            (fallback dashes) so the page never reflows under the reader. */}
        <section style={{ padding: `${isPhone ? 40 : 70}px ${pad}px` }}>
          <div style={{ maxWidth: maxW, margin: "0 auto", borderTop: `1px solid ${C.hair}`, borderBottom: `1px solid ${C.hair}`, padding: `${isPhone ? 44 : 64}px 0` }}>
            <Reveal>
              <div style={{ textAlign: "center", marginBottom: isPhone ? 36 : 52 }}>
                <SectionLabel>By the numbers</SectionLabel>
                <h2 style={{ ...h2(isPhone), textAlign: "center" }}>Giggle so far</h2>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: isPhone ? "1fr" : "repeat(3,1fr)", gap: 0 }}>
                <Stat value={stats?.squadsTotal} failed={statsFailed} label="squads formed" color={C.violet} divider={!isPhone} isPhone={isPhone} />
                <Stat value={stats != null ? socialFloor(stats.playersOnline) : undefined} suffix={stats != null ? socialPlus(stats.playersOnline) : ""} failed={statsFailed} label="people on Giggle" color={C.teal} divider={!isPhone} isPhone={isPhone} />
                <Stat value={stats?.encountersTotal} failed={statsFailed} label="encounters and counting" color={C.lime} isPhone={isPhone} />
              </div>
            </Reveal>
          </div>
        </section>

        {/* ===================== FINAL CTA — full-bleed closing statement ===================== */}
        <section style={{ padding: `${isPhone ? 100 : 180}px ${pad}px`, textAlign: "center", position: "relative", overflow: "hidden" }}>
          <div aria-hidden style={{ position: "absolute", left: "50%", top: "44%", transform: "translate(-50%,-50%)", width: 820, height: 820, borderRadius: "50%", background: "radial-gradient(circle, rgba(109,82,255,.30), transparent 60%)", filter: "blur(50px)", animation: reduce ? undefined : "breathe 6s ease-in-out infinite" }} />
          <Reveal>
            <div style={{ position: "relative" }}>
              <Logomark size={56} />
              <h2
                aria-label="Get your squad together."
                style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: isPhone ? "clamp(40px,11vw,52px)" : 84, letterSpacing: "-.045em", lineHeight: 0.98, margin: "24px 0 0" }}
              >
                <span aria-hidden="true">Get your squad<br /><span style={shimmerText}>together.</span></span>
              </h2>
              <p style={{ fontSize: isPhone ? 17 : 19, color: C.body, margin: "22px auto 0", maxWidth: 470 }}>
                The next crew you click with is one tap away. Pull your people in and press go.
              </p>
              <div style={{ display: "flex", justifyContent: "center", gap: 16, marginTop: 40, flexWrap: "wrap" }}>
                <CtaLink href="/signin">Get started <Icon.enter size={17} color="#fff" /></CtaLink>
                <CtaLink href="/signin" ghost>Create your squad</CtaLink>
              </div>
            </div>
          </Reveal>
        </section>

        {/* ===================== FOOTER — minimal ===================== */}
        <footer style={{ borderTop: `1px solid ${C.hair}`, padding: `34px ${pad}px`, maxWidth: maxW, margin: "0 auto", display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <Wordmark size={18} />
            <span style={{ fontSize: 13, color: C.dim }}>Meet in squads, not alone.</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 22, fontSize: 13.5, color: C.muted }}>
            <Link href="/privacy" style={{ minWidth: 44, minHeight: 44, display: "inline-flex", alignItems: "center", justifyContent: "center", color: "inherit", textDecoration: "none" }}>Privacy</Link>
            <Link href="/terms" style={{ minWidth: 44, minHeight: 44, display: "inline-flex", alignItems: "center", justifyContent: "center", color: "inherit", textDecoration: "none" }}>Terms</Link>
            <span style={{ color: C.dim }}>© {new Date().getFullYear()} Giggle</span>
          </div>
        </footer>
      </div>
    </div>
  );
}

/* ===========================================================================
 * DemoStage — FULL-BLEED cinematic takeover. While the tall pinned section is
 * in view, /landing/demo.mp4 fills the entire sticky viewport and SCRUBS with
 * scroll (currentTime = p * duration, Apple-style — not autoplay). Edge fades +
 * vignette + a light brand tint melt it into #07070B. Overlaid copy switches
 * cleanly through stages tied to `p`. The animated mock only shows if the video is
 * missing/errors. Reduced-motion: static frame + readable copy, no pin.
 * ======================================================================== */
function DemoStage({ p, reduce, isPhone, pad, maxW, scrollTo }: {
  p: number; reduce: boolean; isPhone: boolean; pad: number; maxW: number; scrollTo: (id: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [failed, setFailed] = useState(false);
  const [duration, setDuration] = useState(0);
  const lastSet = useRef(-1);

  // demo.mp4 is ~9.5MB — don't fetch it on page load. Only attach the real src
  // once the scrub section nears the viewport (~200px margin), same IO pattern
  // as useReveal. The poster keeps the stage looking intentional until then.
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = rootRef.current;
    if (!el || near) return;
    if (typeof IntersectionObserver === "undefined") { setNear(true); return; }
    const io = new IntersectionObserver(
      (es) => es.forEach((e) => { if (e.isIntersecting) { setNear(true); io.disconnect(); } }),
      { rootMargin: "200px 0px 200px 0px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [near]);

  const onLoaded = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    const d = v.duration;
    if (!Number.isFinite(d) || d <= 0) return; // guard NaN / 0
    setDuration(d);
    try { v.pause(); } catch { /* noop */ }
  }, []);

  // Cached media can finish loading before React hydrates and attaches the
  // onLoadedMetadata handler. Check readyState once so scrubbing still starts.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.readyState >= 1) onLoaded();
    else v.addEventListener("loadedmetadata", onLoaded, { once: true });
    return () => v.removeEventListener("loadedmetadata", onLoaded);
  }, [onLoaded]);

  // Drive currentTime from scroll progress `p` (NOT autoplay). useScrubProgress
  // already rAF-throttles p; epsilon guard avoids thrashing the decoder.
  // NOTE: demo.mp4 should be a SHORT, keyframe-dense clip for smooth scrubbing.
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !duration || failed) return;
    const t = clamp01(p) * duration;
    if (!Number.isFinite(t)) return;
    if (Math.abs(t - lastSet.current) < duration / 600) return; // ~min step guard
    lastSet.current = t;
    try { v.currentTime = t; } catch { /* seeking before ready */ }
  }, [p, failed, duration]);

  // Three discrete caption stages tied to scroll. Only one caption is mounted at
  // a time so large display text can never collide while the video keeps scrubbing.
  const STAGES = [
    { t: "Your squad forms", sub: "Pull your crew in — solo or up to eight.", c: C.violet },
    { t: "Matched by vibe", sub: "We pair you with a squad on your wavelength.", c: C.teal },
    { t: "You're live. 2v2.", sub: "Drop into a live group video room together.", c: C.lime },
  ];
  const active = p < 0.33 ? 0 : p < 0.66 ? 1 : 2;
  const activeStage = STAGES[active];

  return (
    <div ref={rootRef} style={{ position: "relative", width: "100%", height: "100%", minHeight: reduce ? "70vh" : "100svh", overflow: "hidden", background: "linear-gradient(160deg,#120c28,#0b0b14 55%,#07070b)" }}>
      {/* ---- Full-viewport scrubbed video ---- */}
      {reduce ? (
        <img
          data-testid="demo-poster"
          src="/landing/demo-poster.jpg"
          alt=""
          aria-hidden
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", display: "block", filter: "brightness(0.82) contrast(1.05) saturate(0.96)", zIndex: 1 }}
        />
      ) : !failed && (
        <video
          ref={videoRef}
          muted playsInline preload="metadata"
          poster="/landing/demo-poster.jpg"
          src={near ? "/landing/demo.mp4" : undefined}
          onLoadedMetadata={onLoaded}
          onError={() => setFailed(true)}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", display: "block", filter: "brightness(0.82) contrast(1.05) saturate(0.96)", zIndex: 1 }}
        />
      )}

      {/* Animated fallback mock — only when the video is missing/errors */}
      {failed && <DemoMock p={p} reduce={reduce} />}

      {/* ---- Light brand tint (keeps faces readable) ---- */}
      <div aria-hidden style={{ position: "absolute", inset: 0, zIndex: 2, pointerEvents: "none", background: `linear-gradient(150deg, ${C.violet}, ${STAGES[active].c})`, mixBlendMode: "soft-light", opacity: 0.32, transition: "background 1s ease" }} />

      {/* ---- Edge blend: top + bottom fades to #07070B + side legibility scrim + vignette ---- */}
      <div aria-hidden style={{ position: "absolute", inset: 0, zIndex: 3, pointerEvents: "none", background: [
        "linear-gradient(to bottom, #07070B 0%, rgba(7,7,11,0) 22%, rgba(7,7,11,0) 72%, #07070B 100%)",
        "linear-gradient(to right, rgba(7,7,11,.78) 0%, rgba(7,7,11,.25) 42%, transparent 70%)",
        "radial-gradient(120% 90% at 50% 45%, transparent 48%, rgba(7,7,11,.55) 100%)",
      ].join(", ") }} />

      {/* ---- Overlaid staged copy (lower-left) ---- */}
      <div style={{ position: "absolute", zIndex: 4, left: 0, right: 0, bottom: isPhone ? "8%" : "12%", padding: `0 ${pad}px`, pointerEvents: "none" }}>
        <div style={{ width: "100%", maxWidth: maxW, margin: "0 auto" }}>
          <SectionLabel>The encounter</SectionLabel>
          {/* One mounted caption prevents headline collisions during scrubbing. */}
          <div style={{ position: "relative", marginTop: 14, height: isPhone ? 132 : 168 }}>
            <div
              key={activeStage.t}
              data-testid="demo-caption"
              aria-hidden="false"
              className={reduce ? undefined : "gg-reveal"}
              style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
            >
              <h2 style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: isPhone ? "clamp(40px,12vw,56px)" : 86, letterSpacing: "-.045em", lineHeight: 0.96, margin: 0, textShadow: "0 8px 40px rgba(0,0,0,.6)", maxWidth: 820 }}>
                {activeStage.t}
              </h2>
              <p style={{ fontSize: isPhone ? 16 : 20, lineHeight: 1.5, color: C.body, margin: "16px 0 0", maxWidth: 440, textShadow: "0 2px 18px rgba(0,0,0,.7)" }}>{activeStage.sub}</p>
            </div>
          </div>

          {/* progress pills reflecting the active stage */}
          <div style={{ display: "flex", alignItems: "center", gap: 9, marginTop: 22 }}>
            {STAGES.map((s, i) => (
              <span key={i} style={{ width: i === active ? 30 : 9, height: 5, borderRadius: 999, background: i === active ? s.c : "rgba(255,255,255,.28)", boxShadow: i === active ? `0 0 12px ${s.c}` : undefined, transition: "all .4s ease" }} />
            ))}
          </div>

          {reduce && (
            <div style={{ marginTop: 24, pointerEvents: "auto" }}>
              <button onClick={() => scrollTo("features")} style={textLink}>Explore features →</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* DemoMock — the progressing radar → match → live 2x2 animation, cross-faded by
 * p. Reuses AvatarArt participants (like the hero). On-brand, full, cinematic. */
function DemoMock({ p, reduce }: { p: number; reduce: boolean }) {
  // cross-fade weights for the three stages
  const search = clamp01(1 - seg(p, 0.26, 0.4));                  // visible early, fades out
  const match = clamp01(seg(p, 0.3, 0.42)) * clamp01(1 - seg(p, 0.6, 0.72)); // mid bump
  const live = clamp01(seg(p, 0.62, 0.74));                       // ramps in at the end

  const liveTiles = [
    { img: "/landing/sq1.jpg", label: "You", dot: C.lime },
    { img: "/landing/sq3.jpg", label: "Maya", dot: C.pink },
    { img: "/landing/sq2.jpg", label: "Leo", dot: C.teal },
    { img: "/landing/sq4.jpg", label: "Ana", dot: C.lime },
  ];

  return (
    <div aria-hidden style={{ position: "absolute", inset: 0, zIndex: 1, overflow: "hidden" }}>
      {/* drifting aurora base so it's never flat */}
      <div style={{ position: "absolute", width: "70%", aspectRatio: "1", borderRadius: "50%", left: `${lerp(8, 38, p)}%`, top: "6%", background: "radial-gradient(circle, rgba(109,82,255,.45), transparent 60%)", filter: "blur(55px)", animation: reduce ? undefined : "drift1 18s ease-in-out infinite" }} />
      <div style={{ position: "absolute", width: "58%", aspectRatio: "1", borderRadius: "50%", right: `${lerp(2, 24, p)}%`, bottom: "6%", background: `radial-gradient(circle, ${p < 0.66 ? "rgba(61,214,192,.4)" : "rgba(183,255,42,.42)"}, transparent 60%)`, filter: "blur(55px)", animation: reduce ? undefined : "drift2 22s ease-in-out infinite" }} />

      {/* STAGE 1 — radar searching + your squad gathering */}
      <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", opacity: search, transition: "opacity .4s ease" }}>
        <div style={{ position: "relative", width: "62%", aspectRatio: "1" }}>
          {[0.4, 0.68, 1].map((r, i) => (
            <div key={i} style={{ position: "absolute", left: "50%", top: "50%", width: `${r * 100}%`, aspectRatio: "1", transform: "translate(-50%,-50%)", borderRadius: "50%", border: `1px solid rgba(109,82,255,${0.34 - i * 0.08})` }} />
          ))}
          {/* rotating sweep — driven by p so it scrubs */}
          <div style={{ position: "absolute", left: "50%", top: "50%", width: "100%", aspectRatio: "1", transform: `translate(-50%,-50%) rotate(${p * 900}deg)`, borderRadius: "50%", background: "conic-gradient(from 0deg, rgba(61,214,192,.55), transparent 26%)", mixBlendMode: "screen" }} />
          {/* blips */}
          {[[24, 30], [72, 60], [58, 22]].map(([x, y], i) => (
            <span key={i} style={{ position: "absolute", left: `${x}%`, top: `${y}%`, width: 7, height: 7, borderRadius: "50%", background: C.teal, boxShadow: `0 0 10px ${C.teal}`, animation: reduce ? undefined : `blink ${1.4 + i * 0.3}s ease-in-out infinite` }} />
          ))}
          {/* your squad — real photos gathering at center */}
          <div style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%,-50%)", display: "flex", gap: 8 }}>
            {["/landing/sq1.jpg", "/landing/sq2.jpg"].map((src, i) => (
              <div key={src} style={{ transform: `scale(${lerp(0.7, 1, clamp01(seg(p, i * 0.05, 0.18)))})` }}><PhotoCircle src={src} size={46} /></div>
            ))}
          </div>
        </div>
      </div>

      {/* STAGE 2 — match found: opponent squad slides in, VS pulse */}
      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", gap: 36, opacity: match, transition: "opacity .4s ease" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12, transform: `translateX(${lerp(-50, 0, clamp01(seg(p, 0.34, 0.5)))}px)` }}>
          {["/landing/sq1.jpg", "/landing/sq2.jpg"].map((src) => <PhotoCircle key={src} src={src} size={52} />)}
        </div>
        <div style={{ width: 50, height: 50, borderRadius: "50%", padding: 2, background: "conic-gradient(from 220deg, #6D52FF, #2FE6C8, #B7FF2A, #FF5C8A, #6D52FF)", boxShadow: "0 0 26px -4px rgba(109,82,255,.85)", animation: reduce ? undefined : "vspulse 2.4s ease-in-out infinite", flexShrink: 0 }}>
          <div style={{ width: "100%", height: "100%", borderRadius: "50%", background: "#0B0B12", display: "grid", placeItems: "center" }}>
            <span style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 17, ...shimmerText }}>VS</span>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12, transform: `translateX(${lerp(50, 0, clamp01(seg(p, 0.34, 0.5)))}px)` }}>
          {["/landing/sq3.jpg", "/landing/sq4.jpg"].map((src) => <PhotoCircle key={src} src={src} size={52} />)}
        </div>
      </div>

      {/* STAGE 3 — live 2x2 grid lighting up one by one */}
      <div style={{ position: "absolute", inset: "12%", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, opacity: live, transition: "opacity .4s ease", alignContent: "center" }}>
        {liveTiles.map((t, i) => {
          const lit = clamp01(seg(p, 0.7 + i * 0.045, 0.78 + i * 0.045));
          return (
            <div key={t.label} style={{ position: "relative", aspectRatio: "4/3", borderRadius: 14, overflow: "hidden", background: pickGrad(), opacity: lerp(0.25, 1, lit), transform: `scale(${lerp(0.92, 1, lit)})`, boxShadow: lit > 0.6 ? `0 0 0 1px ${C.violet}55, 0 16px 40px -16px rgba(109,82,255,.6)` : "0 12px 30px -18px rgba(0,0,0,.8)", transition: "box-shadow .3s ease" }}>
              <img src={t.img} alt="" aria-hidden style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", display: "block", filter: PHOTO_FILTER }} />
              <PhotoGrade accent={t.dot} radial={false} />
              <div style={{ position: "absolute", left: 7, bottom: 6, display: "inline-flex", alignItems: "center", gap: 5, background: "rgba(7,7,11,.5)", backdropFilter: "blur(6px)", padding: "3px 7px", borderRadius: 999, fontSize: 10, fontWeight: 600, color: "#fff", fontFamily: BODY }}>
                <span style={{ width: 5, height: 5, borderRadius: "50%", background: t.dot, boxShadow: `0 0 7px ${t.dot}`, opacity: lit }} />
                {t.label}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ===========================================================================
 * Small components
 * ======================================================================== */
function SectionLabel({ children }: { children: React.ReactNode }) {
  return <span style={{ display: "inline-block", fontSize: 12.5, fontWeight: 700, letterSpacing: ".14em", textTransform: "uppercase", color: C.violet, fontFamily: DISPLAY }}>{children}</span>;
}

function Stat({ value, failed, label, color, divider, isPhone, suffix }: { value?: number; failed?: boolean; label: string; color: string; divider?: boolean; isPhone?: boolean; suffix?: string }) {
  return (
    <div style={{
      textAlign: "center",
      padding: isPhone ? "22px 0" : "0 20px",
      borderRight: divider ? `1px solid ${C.hair}` : "none",
      borderBottom: isPhone ? `1px solid ${C.hair}` : "none",
    }}>
      <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: isPhone ? 56 : 72, lineHeight: 1, color, letterSpacing: "-.04em", textShadow: `0 0 44px ${color}55`, display: "flex", justifyContent: "center" }}>
        {value != null
          ? <><CountUp value={value} />{suffix}</>
          : failed
            ? <span aria-label="unavailable">—</span>
            : <span className="gg-shimmer" aria-hidden style={{ display: "inline-block", width: isPhone ? 120 : 160, height: isPhone ? 56 : 72, borderRadius: 14 }} />}
      </div>
      <div style={{ fontSize: 14.5, color: C.muted, marginTop: 12 }}>{label}</div>
    </div>
  );
}

function CtaLink({ href, children, small, ghost }: { href: string; children: React.ReactNode; small?: boolean; ghost?: boolean }) {
  // Hover/focus lift lives in the page-scoped CSS (.lp-cta / .lp-cta-ghost /
  // .lp-cta-primary) so it works for keyboard focus-visible too, not just mouse.
  const base: React.CSSProperties = {
    display: "inline-flex", alignItems: "center", gap: 8, textDecoration: "none",
    height: small ? 42 : 54, padding: small ? "0 18px" : "0 28px", borderRadius: 999,
    fontFamily: BODY, fontWeight: 700, fontSize: small ? 14.5 : 16, whiteSpace: "nowrap",
    transition: "transform .2s ease, box-shadow .2s ease, background .2s ease",
  };
  const style: React.CSSProperties = ghost
    ? { ...base, color: C.text, background: "rgba(255,255,255,.05)", border: `1px solid ${C.hairStrong}` }
    : { ...base, color: "#fff", border: "none", background: "linear-gradient(100deg, #6D52FF, #6C8BFF)", boxShadow: "0 8px 28px -10px rgba(109,82,255,.75)" };
  return <Link href={href} className={`lp-cta ${ghost ? "lp-cta-ghost" : "lp-cta-primary"}`} style={style}>{children}</Link>;
}

/* ===========================================================================
 * Feature visuals — bespoke CSS/SVG product micro-illustrations (Linear/Stripe
 * vibe). Each demonstrates its feature; on-brand, layered, subtle motion,
 * visually distinct. Not videos, not empty gradients.
 * ======================================================================== */

/* ---------------------------------------------------------------------------
 * Shared real-photo helpers — matched to the hero's polish: object-fit cover,
 * rounded, thin gradient border, soft shadow. Graceful gradient fallback on
 * 404 so it never breaks.
 * ------------------------------------------------------------------------ */
/* EDGE-only blend for stock photos: keep the ORIGINAL, true-color, vibrant
 * image (no recoloring) and seat it into the dark page purely via gradients at
 * the BORDERS — a bottom legibility scrim, an edge vignette that falls off into
 * #07070B, and a faint single-corner brand glow (away from faces).
 * `accent` only tints the tiny corner glow — never the whole image. */
const PHOTO_FILTER = "brightness(0.92) contrast(1.04) saturate(1.02)"; // natural, a hair richer
function PhotoGrade({ accent = C.violet, radial = true }: { accent?: string; radial?: boolean }) {
  return (
    <>
      {/* bottom-up legibility scrim (light) */}
      <div aria-hidden style={{ position: "absolute", inset: 0, pointerEvents: "none", background: "linear-gradient(to top, rgba(7,7,11,.7), transparent 50%)" }} />
      {/* edge vignette → borders fall off into #07070B (no hard rectangle) */}
      {radial && <div aria-hidden style={{ position: "absolute", inset: 0, pointerEvents: "none", boxShadow: "inset 0 0 44px 14px rgba(7,7,11,.65)", borderRadius: "inherit" }} />}
      {/* faint brand glow bleeding from ONE corner only (top-right), not over center */}
      {radial && <div aria-hidden style={{ position: "absolute", inset: 0, pointerEvents: "none", background: `radial-gradient(60% 55% at 100% 0%, ${accent}33, transparent 60%)` }} />}
    </>
  );
}

function PhotoTile({ src, alt = "", radius = 18, aspect = "4/3", accent = C.violet, grad, style, children, reduce }: {
  src: string; alt?: string; radius?: number; aspect?: string; accent?: string;
  grad?: string; style?: React.CSSProperties; children?: React.ReactNode; reduce?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <div style={{ position: "relative", borderRadius: radius + 1, padding: 1, background: `linear-gradient(150deg, ${accent}66, rgba(255,255,255,.10) 45%, rgba(255,255,255,.02))`, boxShadow: "0 26px 60px -34px rgba(0,0,0,.9)", ...style }}>
      <div style={{ position: "relative", aspectRatio: aspect, borderRadius: radius, overflow: "hidden", background: grad || pickGrad() }}>
        {!failed && (
          <img src={src} alt={alt} onError={() => setFailed(true)}
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", display: "block", filter: PHOTO_FILTER, animation: reduce ? undefined : "kenburns 22s ease-in-out infinite alternate" }} />
        )}
        {/* brand color-grade */}
        <PhotoGrade accent={accent} />
        {/* faint inner top light */}
        <div aria-hidden style={{ position: "absolute", inset: 0, pointerEvents: "none", background: "radial-gradient(130% 90% at 30% 8%, rgba(255,255,255,.08), transparent 55%)" }} />
        {children}
      </div>
    </div>
  );
}

/* Circular real-photo crop (people). Natural color — just a subtle ring + the
 * gentle filter. No tint/scrim (too small; recoloring looked muddy). */
function PhotoCircle({ src, size = 44, ring = "#0B0B12", grad, style }: {
  src: string; size?: number; ring?: string; grad?: string; style?: React.CSSProperties;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <span style={{ position: "relative", display: "inline-block", width: size, height: size, borderRadius: "50%", overflow: "hidden", flexShrink: 0, background: grad || pickGrad(), boxShadow: `0 0 0 2px ${ring}, 0 8px 20px -10px rgba(0,0,0,.8)`, ...style }}>
      {!failed && <img src={src} alt="" aria-hidden onError={() => setFailed(true)} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", filter: PHOTO_FILTER }} />}
    </span>
  );
}

/* Real portrait pool (reused across sections). */
const PORTRAITS = ["/landing/sq1.jpg", "/landing/sq2.jpg", "/landing/sq3.jpg", "/landing/sq4.jpg"];

/* Shared bare/rounded stage: soft shadow + subtle inner glow, glow tinted per
 * feature. Content fills it — never an empty gradient. */
function FeatureFrame({ tint, reduce, children, height = 320 }: { tint: string; reduce?: boolean; children: React.ReactNode; height?: number }) {
  return (
    <div style={{
      position: "relative", width: "100%", minHeight: height, borderRadius: 26, overflow: "hidden",
      background: "linear-gradient(165deg, rgba(255,255,255,.04), rgba(255,255,255,.015))",
      boxShadow: `0 40px 110px -55px rgba(0,0,0,.9), inset 0 1px 0 rgba(255,255,255,.06)`,
      display: "grid", placeItems: "center", padding: 26,
    }}>
      {/* subtle inner glow, feature-tinted */}
      <div aria-hidden style={{ position: "absolute", inset: 0, background: `radial-gradient(90% 80% at 50% 18%, ${tint}, transparent 62%)`, opacity: 0.9, animation: reduce ? undefined : "glowpulse 7s ease-in-out infinite" }} />
      <div style={{ position: "relative", width: "100%", display: "grid", placeItems: "center" }}>{children}</div>
    </div>
  );
}

/* 1) Vibe-based discovery — floating vibe pills, one selected, lines to a
 *    matched mini-squad avatar cluster. "pick a vibe → matched". */
function vDiscovery(reduce: boolean) {
  const pills: { t: string; sel?: boolean; c: string }[] = [
    { t: "chill", c: C.teal }, { t: "gamers", c: C.violet }, { t: "chaotic good", sel: true, c: C.lime },
    { t: "night owls", c: C.pink }, { t: "hype", c: C.violet }, { t: "deep talks", c: C.teal },
  ];
  return (
    <FeatureFrame tint="rgba(109,82,255,.20)" reduce={reduce}>
      <div style={{ position: "relative", width: "100%", maxWidth: 420, display: "flex", flexDirection: "column", alignItems: "center", gap: 26 }}>
        {/* energy rings behind */}
        <div aria-hidden style={{ position: "absolute", top: -6, left: "50%", transform: "translateX(-50%)", width: 180, height: 180, borderRadius: "50%", background: "radial-gradient(circle, rgba(183,255,42,.22), transparent 65%)", filter: "blur(14px)" }} />
        {/* pill cloud */}
        <div style={{ position: "relative", display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 9, maxWidth: 360 }}>
          {pills.map((p, i) => (
            <span key={p.t} style={{
              display: "inline-flex", alignItems: "center", gap: 6, padding: p.sel ? "9px 15px" : "7px 13px", borderRadius: 999,
              fontFamily: BODY, fontWeight: 700, fontSize: p.sel ? 14 : 12.5, whiteSpace: "nowrap",
              color: p.sel ? "#07070B" : p.c,
              background: p.sel ? `linear-gradient(100deg, ${C.lime}, #8FE63D)` : "rgba(255,255,255,.05)",
              border: `1px solid ${p.sel ? "transparent" : p.c + "55"}`,
              boxShadow: p.sel ? `0 0 0 4px ${C.lime}22, 0 10px 26px -8px ${C.lime}aa` : `0 6px 18px -12px ${p.c}`,
              animation: reduce ? undefined : p.sel ? "vspulse 2.4s ease-in-out infinite" : `floaty ${5 + (i % 4)}s ease-in-out ${i * 0.25}s infinite`,
            }}>
              {p.sel && <Icon.star size={13} color="#07070B" />}{p.t}
            </span>
          ))}
        </div>
        {/* connector */}
        <svg width="200" height="44" viewBox="0 0 200 44" aria-hidden style={{ overflow: "visible" }}>
          {[60, 100, 140].map((x, i) => (
            <line key={i} x1="100" y1="2" x2={x} y2="42" stroke={C.lime} strokeWidth="1.5" strokeDasharray="3 4" opacity="0.55">
              {!reduce && <animate attributeName="stroke-dashoffset" from="0" to="-14" dur="0.9s" repeatCount="indefinite" />}
            </line>
          ))}
        </svg>
        {/* matched squad — real photo crops */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ display: "flex" }}>
            {PORTRAITS.map((src, i) => (
              <PhotoCircle key={src} src={src} size={40} style={{ marginLeft: i ? -12 : 0, zIndex: PORTRAITS.length - i } as React.CSSProperties} />
            ))}
          </div>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 700, color: C.lime, fontFamily: BODY }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: C.lime, boxShadow: `0 0 8px ${C.lime}` }} />matched
          </span>
        </div>
      </div>
    </FeatureFrame>
  );
}

/* 2) Squads up to 8 — a real group photo hero with a glass "seats" overlay:
 *    real photo seats filled + dashed "+" open seats + "8 seats" / premium. */
function vSquads(reduce: boolean) {
  return (
    <FeatureFrame tint="rgba(61,214,192,.18)" reduce={reduce}>
      <PhotoTile src="/landing/group1.jpg" alt="A squad of friends together" aspect="16/11" radius={20} accent={C.teal} reduce={reduce} style={{ width: "100%", maxWidth: 460 }}>
        {/* premium spark, top-right */}
        <span style={{ position: "absolute", right: 12, top: 12, display: "inline-flex", alignItems: "center", gap: 5, padding: "5px 11px", borderRadius: 999, background: "rgba(11,11,18,.55)", backdropFilter: "blur(8px)", border: `1px solid ${C.violet}66`, fontSize: 11, fontWeight: 700, color: C.violet, fontFamily: BODY }}>
          <Icon.lightning size={12} color={C.violet} />premium
        </span>
        {/* seat strip, bottom — glass */}
        <div style={{ position: "absolute", left: 12, right: 12, bottom: 12, display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderRadius: 14, background: "rgba(11,11,18,.55)", backdropFilter: "blur(12px)", border: `1px solid ${C.hairStrong}` }}>
          <div style={{ display: "flex" }}>
            {PORTRAITS.map((src, i) => (
              <PhotoCircle key={src} src={src} size={32} style={{ marginLeft: i ? -10 : 0, zIndex: 9 - i, animation: reduce ? undefined : `seatpop .5s cubic-bezier(.22,1,.36,1) ${i * 90}ms both` } as React.CSSProperties} />
            ))}
            {[0, 1, 2].map((i) => (
              <span key={`o${i}`} style={{ marginLeft: -10, width: 32, height: 32, borderRadius: "50%", border: `1.5px dashed ${C.teal}77`, background: "rgba(61,214,192,.08)", display: "grid", placeItems: "center", boxShadow: "0 0 0 2px #0B0B12", zIndex: 2 - i }}>
                <Icon.plus size={14} color={C.teal} />
              </span>
            ))}
          </div>
          <div style={{ marginLeft: "auto", display: "flex", flexDirection: "column", alignItems: "flex-end", lineHeight: 1.05 }}>
            <span style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 20, ...shimmerText }}>8</span>
            <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: ".14em", color: C.muted, fontFamily: BODY }}>SEATS</span>
          </div>
        </div>
      </PhotoTile>
    </FeatureFrame>
  );
}

/* 3) Invite-only / request controls — a mini "Join requests" panel with
 *    approve/decline rows + a policy toggle (Open · Request · Invite). */
function vControls(reduce: boolean) {
  const reqs = [
    { img: "/landing/sq2.jpg", n: "Mika", meta: "22 · 🇯🇵 Japan" },
    { img: "/landing/sq3.jpg", n: "Dani", meta: "25 · 🇪🇸 Spain" },
  ];
  return (
    <FeatureFrame tint="rgba(183,255,42,.16)" reduce={reduce}>
      <div style={{ width: "100%", maxWidth: 360, borderRadius: 18, padding: 16, background: "linear-gradient(165deg, rgba(22,22,32,.78), rgba(11,11,18,.9))", border: `1px solid ${C.hairStrong}`, backdropFilter: "blur(16px)", boxShadow: "0 30px 70px -36px rgba(0,0,0,.95), inset 0 1px 0 rgba(255,255,255,.06)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontFamily: DISPLAY, fontWeight: 700, fontSize: 14, color: C.text }}>
            <Icon.shield size={16} color={C.lime} />Join requests
          </span>
          <span style={{ fontSize: 11, fontWeight: 700, color: "#07070B", background: C.lime, borderRadius: 999, padding: "2px 8px" }}>2 new</span>
        </div>
        {reqs.map((r, i) => (
          <div key={r.n} style={{ display: "flex", alignItems: "center", gap: 11, padding: "9px 0", borderTop: i ? `1px solid ${C.hair}` : "none" }}>
            <PhotoCircle src={r.img} size={36} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: C.text, fontFamily: BODY }}>{r.n}</div>
              <div style={{ fontSize: 11, color: C.muted, fontFamily: BODY }}>{r.meta}</div>
            </div>
            <span aria-hidden style={{ width: 30, height: 30, borderRadius: 9, border: `1px solid ${C.hair}`, background: "rgba(255,255,255,.04)", color: C.dim, display: "grid", placeItems: "center" }}><Icon.close size={14} color={C.muted} /></span>
            <span aria-hidden style={{ width: 30, height: 30, borderRadius: 9, border: "none", background: `linear-gradient(135deg, ${C.lime}, #8FE63D)`, color: "#07070B", display: "grid", placeItems: "center", boxShadow: `0 6px 16px -8px ${C.lime}`, animation: reduce ? undefined : i === 0 ? "vspulse 2.6s ease-in-out infinite" : undefined }}><Icon.enter size={14} color="#07070B" /></span>
          </div>
        ))}
        {/* policy toggle */}
        <div style={{ display: "flex", gap: 6, marginTop: 12, padding: 4, borderRadius: 12, background: "rgba(255,255,255,.04)", border: `1px solid ${C.hair}` }}>
          {["Open", "Request", "Invite"].map((m) => {
            const active = m === "Invite";
            return <span key={m} style={{ flex: 1, textAlign: "center", padding: "6px 0", borderRadius: 9, fontSize: 12, fontWeight: 700, fontFamily: BODY, color: active ? "#07070B" : C.muted, background: active ? `linear-gradient(100deg, ${C.violet}, #6C8BFF)` : "transparent", boxShadow: active ? `0 6px 16px -8px ${C.violet}` : undefined }}>{m}</span>;
          })}
        </div>
      </div>
    </FeatureFrame>
  );
}

/* 4) Earn tokens by inviting — you + friend joined by an arrow, coin burst,
 *    big gradient +100, "you BOTH earn". */
function vTokens(reduce: boolean) {
  const coins = [
    { x: "12%", y: "16%", d: 0 }, { x: "78%", y: "12%", d: 0.4 }, { x: "26%", y: "72%", d: 0.8 },
    { x: "70%", y: "70%", d: 1.2 }, { x: "48%", y: "4%", d: 0.6 },
  ];
  return (
    <FeatureFrame tint="rgba(109,82,255,.18)" reduce={reduce}>
      <div style={{ position: "relative", width: "100%", maxWidth: 400, display: "flex", flexDirection: "column", alignItems: "center", gap: 22 }}>
        {/* floating coins */}
        {coins.map((c, i) => (
          <span key={i} aria-hidden style={{ position: "absolute", left: c.x, top: c.y, width: 26, height: 26, borderRadius: "50%", background: `radial-gradient(circle at 35% 30%, #E9FFB0, ${C.lime})`, border: "1px solid rgba(7,7,11,.25)", display: "grid", placeItems: "center", color: "#07070B", fontWeight: 800, fontSize: 14, boxShadow: `0 6px 16px -6px ${C.lime}cc`, animation: reduce ? undefined : `coinfloat ${3.2 + i * 0.4}s ease-in-out ${c.d}s infinite` }}>✦</span>
        ))}
        {/* you + friend + arrow */}
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
            <PhotoCircle src="/landing/sq1.jpg" size={52} ring="#0B0B12" />
            <span style={{ fontSize: 11, fontWeight: 700, color: C.muted, fontFamily: BODY }}>You</span>
          </div>
          <svg width="64" height="24" viewBox="0 0 64 24" aria-hidden>
            <defs><linearGradient id="arrowg" x1="0" y1="0" x2="64" y2="0"><stop stopColor={C.violet} /><stop offset="1" stopColor={C.teal} /></linearGradient></defs>
            <line x1="2" y1="12" x2="52" y2="12" stroke="url(#arrowg)" strokeWidth="2.5" strokeLinecap="round" strokeDasharray="5 5">{!reduce && <animate attributeName="stroke-dashoffset" from="0" to="-20" dur="0.8s" repeatCount="indefinite" />}</line>
            <path d="M50 6 L60 12 L50 18" fill="none" stroke={C.teal} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
            <PhotoCircle src="/landing/sq3.jpg" size={52} ring="#0B0B12" />
            <span style={{ fontSize: 11, fontWeight: 700, color: C.muted, fontFamily: BODY }}>Friend</span>
          </div>
        </div>
        {/* +100 + both earn */}
        <div style={{ display: "flex", alignItems: "baseline", gap: 14 }}>
          <span style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: "clamp(56px,12vw,92px)", lineHeight: 0.85, letterSpacing: "-.04em", ...shimmerText }}>+100</span>
          <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "6px 12px", borderRadius: 999, background: "rgba(109,82,255,.16)", border: `1px solid ${C.violet}55` }}>
            <Icon.gift size={16} color={C.violet} />
            <span style={{ fontSize: 13, fontWeight: 700, color: C.text, fontFamily: BODY }}>you both earn</span>
          </div>
        </div>
      </div>
    </FeatureFrame>
  );
}

/* 5) Real-time chat — bubble stack with reactions + a typing indicator. */
function vChat(reduce: boolean) {
  const msgs = [
    { who: "Maya", img: "/landing/sq3.jpg", t: "ok these guys are fun 😂", me: false, react: "🔥" },
    { who: "You", t: "right?? same vibe fr", me: true },
    { who: "Leo", img: "/landing/sq1.jpg", t: "rematch next weekend?", me: false },
  ];
  return (
    <FeatureFrame tint="rgba(61,214,192,.16)" reduce={reduce}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14, width: "100%", maxWidth: 360 }}>
        {msgs.map((m, i) => (
          <div key={i} style={{ display: "flex", alignItems: "flex-end", gap: 8, alignSelf: m.me ? "flex-end" : "flex-start", maxWidth: "88%", flexDirection: m.me ? "row-reverse" : "row" }}>
            {!m.me && <PhotoCircle src={m.img!} size={28} />}
            <div style={{ position: "relative", background: m.me ? "linear-gradient(100deg,#6D52FF,#6C8BFF)" : "rgba(255,255,255,.07)", color: m.me ? "#fff" : C.text, padding: "10px 14px", borderRadius: 16, borderBottomRightRadius: m.me ? 4 : 16, borderBottomLeftRadius: m.me ? 16 : 4, fontSize: 14, lineHeight: 1.35, boxShadow: "0 8px 22px -14px rgba(0,0,0,.8)" }}>
              {!m.me && <span style={{ display: "block", fontSize: 10.5, color: C.teal, fontWeight: 700, marginBottom: 2, fontFamily: BODY }}>{m.who}</span>}
              {m.t}
              {m.react && (
                <span style={{ position: "absolute", right: -8, bottom: -10, display: "inline-flex", alignItems: "center", gap: 3, padding: "2px 6px", borderRadius: 999, background: "#15151f", border: `1px solid ${C.hair}`, fontSize: 11, animation: reduce ? undefined : "floaty 4s ease-in-out infinite" }}>{m.react}<span style={{ color: C.muted, fontWeight: 700 }}>2</span></span>
              )}
            </div>
          </div>
        ))}
        {/* typing indicator */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, alignSelf: "flex-start" }}>
          <PhotoCircle src="/landing/sq4.jpg" size={28} />
          <div style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "rgba(255,255,255,.07)", padding: "12px 14px", borderRadius: 16, borderBottomLeftRadius: 4 }}>
            {[0, 1, 2].map((d) => (
              <span key={d} style={{ width: 6, height: 6, borderRadius: "50%", background: C.muted, animation: reduce ? undefined : `typing 1.3s ease-in-out ${d * 0.2}s infinite` }} />
            ))}
          </div>
        </div>
      </div>
    </FeatureFrame>
  );
}

/* ===========================================================================
 * Data
 * ======================================================================== */
// Two squads meeting. `avatar` = a real default-avatar id (matches camera-off
// participants in the app); used as the in-tile person fallback before footage.
// `img` = real licensed Adobe Stock portrait (shows now). `src` = optional .mp4
// (drops in later and paints over the photo). `avatar` = last-resort fallback.
const YOUR_SQUAD = [
  { label: "You", img: "/landing/sq1.jpg", dot: C.lime, avatar: "violet-blob" },
  { label: "Leo", img: "/landing/sq2.jpg", dot: C.teal, avatar: "lime-ghost" },
];
const THEIR_SQUAD = [
  { label: "Maya", img: "/landing/sq3.jpg", dot: C.pink, avatar: "coral-star" },
  { label: "Ana", img: "/landing/sq4.jpg", dot: C.lime, avatar: "teal-bot" },
];
const VIBES = ["chill", "gamers", "night owls", "deep talks", "hype", "chaotic good", "creatives", "music heads", "study crew", "foodies", "sporty"];
const STEPS: { icon: (p: { size?: number; color?: string }) => React.ReactNode; title: string; body: string; img: string }[] = [
  { icon: Icon.users, title: "Form your squad", body: "Invite your friends in seconds. Roll solo or bring up to 8 — your crew, your rules.", img: "/landing/group1.jpg" },
  { icon: Icon.discover, title: "Match by vibe", body: "Pick your vibe and we pair you with another squad on the same wavelength.", img: "/landing/group2.jpg" },
  { icon: Icon.cam, title: "Meet live on video", body: "Drop into a live group video room together. Hit it off? Keep the chat going.", img: "/landing/call1.jpg" },
];
const FEATURES: { accent: string; title: string; body: string; visual: (r: boolean) => React.ReactNode }[] = [
  { accent: C.violet, title: "Vibe-based discovery", body: "No endless swiping. Choose how you're feeling and get matched with squads who match the energy — chill, chaotic, or anything between.", visual: (r) => vDiscovery(r) },
  { accent: C.teal, title: "Squads up to 8", body: "Bring the whole group chat. Premium squads scale up to eight so nobody gets left out of the fun.", visual: (r) => vSquads(r) },
  { accent: C.lime, title: "Invite-only controls", body: "Request-to-join and invite-only modes mean teammates are never surprised by who drops in. You stay in control of the room.", visual: (r) => vControls(r) },
  { accent: C.violet, title: "Earn tokens by inviting friends", body: "Pull friends in and you both get rewarded. Spend tokens on bigger squads, premium vibes, and more.", visual: (r) => vTokens(r) },
  { accent: C.teal, title: "Real-time chat", body: "Group chat runs alongside every encounter — react, drop links, and keep the conversation alive after the video ends.", visual: (r) => vChat(r) },
];

/* ===========================================================================
 * Style tokens
 * ======================================================================== */
const navLink: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  minHeight: 42,
  background: "none",
  border: "none",
  cursor: "pointer",
  fontSize: 14.5,
  fontWeight: 600,
  color: C.muted,
  textDecoration: "none",
  fontFamily: BODY,
  padding: "0 2px",
};
const eyebrow: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: 9, padding: "8px 15px", borderRadius: 999, background: "linear-gradient(100deg, rgba(109,82,255,.14), rgba(61,214,192,.08))", border: `1px solid ${C.hairStrong}`, fontSize: 13, fontWeight: 600, letterSpacing: ".01em", color: C.text, fontFamily: BODY, boxShadow: "0 6px 20px -12px rgba(109,82,255,.6), inset 0 1px 0 rgba(255,255,255,.06)", backdropFilter: "blur(8px)" };
const textLink: React.CSSProperties = { background: "none", border: "none", cursor: "pointer", fontFamily: BODY, fontWeight: 600, fontSize: 16, color: C.text, padding: 0, textDecoration: "none" };
const arrowLink: React.CSSProperties = { display: "inline-flex", alignItems: "center", minHeight: 44, gap: 8, background: "none", border: "none", cursor: "pointer", fontFamily: BODY, fontWeight: 600, fontSize: 16, color: C.text, padding: "0 2px", textDecoration: "none" };
const shimmerText: React.CSSProperties = { background: "linear-gradient(100deg, #6D52FF, #2FE6C8 40%, #B7FF2A 70%, #FF5C8A)", backgroundSize: "200% auto", WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent", animation: "shimmer 6s linear infinite" };
function h2(isPhone: boolean): React.CSSProperties {
  return { fontFamily: DISPLAY, fontWeight: 700, fontSize: isPhone ? 32 : 50, letterSpacing: "-.035em", lineHeight: 1.06, margin: "16px 0 0" };
}

const GRAIN = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`;

const CSS = `
  @keyframes drift1 { 0%,100% { transform: translate(0,0) scale(1); } 50% { transform: translate(40px,-30px) scale(1.12); } }
  @keyframes drift2 { 0%,100% { transform: translate(0,0) scale(1); } 50% { transform: translate(-36px,28px) scale(1.1); } }
  @keyframes drift3 { 0%,100% { transform: translate(0,0) scale(1); } 50% { transform: translate(30px,34px) scale(1.14); } }
  @keyframes shimmer { to { background-position: 200% center; } }
  @keyframes blink { 0%,100% { opacity: 1; } 50% { opacity: .35; } }
  @keyframes sheen { 0%,100% { transform: translateX(-30%); } 50% { transform: translateX(30%); } }
  @keyframes floaty { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-7px); } }
  @keyframes beam { 0%,100% { opacity: .55; } 50% { opacity: 1; } }
  @keyframes vspulse { 0%,100% { transform: scale(1); box-shadow: 0 0 24px -6px rgba(109,82,255,.7); } 50% { transform: scale(1.07); box-shadow: 0 0 36px -2px rgba(109,82,255,.95); } }
  @keyframes glowpulse { 0%,100% { opacity: .75; } 50% { opacity: 1; } }
  @keyframes seatpop { 0% { transform: scale(.4); opacity: 0; } 100% { transform: scale(1); opacity: 1; } }
  @keyframes coinfloat { 0%,100% { transform: translateY(0) rotate(-6deg); } 50% { transform: translateY(-10px) rotate(6deg); } }
  @keyframes typing { 0%,60%,100% { transform: translateY(0); opacity: .4; } 30% { transform: translateY(-5px); opacity: 1; } }
  @keyframes kenburns { from { transform: scale(1.06) translate(0,0); } to { transform: scale(1.14) translate(-1.5%,-1.5%); } }
  @keyframes breathe { 0%,100% { transform: translate(-50%,-50%) scale(1); opacity: .8; } 50% { transform: translate(-50%,-50%) scale(1.12); opacity: 1; } }
  @keyframes marquee { from { transform: translateX(0); } to { transform: translateX(-50%); } }
  @keyframes grain { 0%{transform:translate(0,0)}10%{transform:translate(-5%,-5%)}30%{transform:translate(3%,-8%)}50%{transform:translate(-4%,6%)}70%{transform:translate(6%,3%)}90%{transform:translate(-2%,4%)}100%{transform:translate(0,0)} }
  .lp-cta:hover, .lp-cta:focus-visible { transform: translateY(-2px); }
  .lp-cta-primary:hover, .lp-cta-primary:focus-visible { box-shadow: 0 12px 40px -8px rgba(109,82,255,.95); }
  .lp-cta-ghost:hover, .lp-cta-ghost:focus-visible { background: rgba(255,255,255,.10) !important; }
  .lp-arrow [data-arr] { transition: transform .2s ease; }
  .lp-arrow:hover [data-arr], .lp-arrow:focus-visible [data-arr] { transform: translateX(4px); }
  @media (prefers-reduced-motion: reduce) {
    * { animation: none !important; }
    .lp-cta:hover, .lp-cta:focus-visible { transform: none; }
    .lp-arrow:hover [data-arr], .lp-arrow:focus-visible [data-arr] { transform: none; }
  }
`;

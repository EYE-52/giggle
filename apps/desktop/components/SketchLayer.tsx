"use client";
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useLook } from "@/lib/look";

/**
 * Sketch renderer for the Doodle skin (data-skin="paper") — a React port of
 * design/skins/sketch.js. Rough.js draws hand-drawn strokes and fills on top
 * of elements that opt in via CSS custom properties, e.g.
 *   .thing { --sketch: rect; --sketch-fill: var(--brand); --sketch-fill-style: hachure; }
 * (see the property list in SKETCH_PROPS below; phase 2 opts real components
 * in). The overlay is an absolutely positioned, pointer-events:none SVG that
 * never changes the element's size or position.
 *
 * Mounted once in the root layout. Re-runs on skin change, route change,
 * resize (ResizeObserver) and font load. Does nothing for other skins, and
 * is SSR-safe (no window access at import; rough.js loads dynamically).
 */

const SKETCH_PROPS = [
  "--sketch", "--sketch-stroke", "--sketch-stroke-width", "--sketch-fill", "--sketch-fill-style", "--sketch-fill-weight",
  "--sketch-hachure-gap", "--sketch-hachure-angle", "--sketch-roughness", "--sketch-bowing", "--sketch-radius", "--sketch-inset", "--sketch-dash", "--sketch-layer",
] as const;

/* Design-mock opt-in surface; real components gain --sketch props in phase 2. */
const CANDIDATES = ".btn, .card, .input, .search, .tab, .tb, .chip, .badge, .pill, .seat, .pa, .friend, .cbtn, .code-box, .modal, .toast, .preview, .icon-btn, .vtile, .tip-idea, .nav, .tabbar, .switch, .more, .kicker, .card-title, .title, .tip-title, .fab, [data-sketch]";

const SVG_NS = "http://www.w3.org/2000/svg";
const SEED_BASE = 7;

type AnyRough = {
  svg: (el: SVGSVGElement) => any;
};

const num = (v: string | undefined, d: number): number => {
  const n = parseFloat(v ?? "");
  return Number.isFinite(n) ? n : d;
};
const str = (v: string | undefined, d: string): string => {
  const s = (v ?? "").trim();
  return s ? s : d;
};
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) % 100000 + 1;
}
function classNameOf(el: Element): string {
  const c = (el as HTMLElement).className;
  if (c && typeof c === "object" && "baseVal" in c) return String((c as SVGAnimatedString).baseVal);
  return String(c ?? "");
}
function clearSketch(root: ParentNode) {
  root.querySelectorAll(".gg-sketch").forEach((n) => n.remove());
}

/** Replace the __S__/__F__ placeholder colors rough.js was invoked with. */
function paint(svg: SVGSVGElement, color: { stroke: string; fill: string }) {
  svg.querySelectorAll("path").forEach((p) => {
    const s = p.getAttribute("stroke");
    const f = p.getAttribute("fill");
    if (s && s !== "none") {
      if (s === "__F__") p.style.stroke = color.fill;
      else if (s === "__S__") p.style.stroke = color.stroke;
      p.removeAttribute("stroke");
    }
    if (f && f !== "none") {
      if (f === "__F__") p.style.fill = color.fill;
      else if (f === "__S__") p.style.fill = color.stroke;
      p.removeAttribute("fill");
    }
  });
}

function draw(rough: AnyRough) {
  if (typeof document === "undefined") return;
  clearSketch(document);
  const els = Array.from(document.querySelectorAll<HTMLElement>(CANDIDATES));
  els.forEach((el, i) => {
    if (!el.offsetParent || el.closest(".gg-sketch")) return;
    const cs = getComputedStyle(el);
    const kind = str(cs.getPropertyValue("--sketch"), "none");
    if (kind === "none") return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    if (w < 4 || h < 4) return;

    const inset = num(cs.getPropertyValue("--sketch-inset"), -2);
    const pad = Math.max(8, -inset + 6);
    const svg = document.createElementNS(SVG_NS, "svg") as SVGSVGElement;
    svg.setAttribute("class", "gg-sketch");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("width", String(w + pad * 2));
    svg.setAttribute("height", String(h + pad * 2));
    const over = str(cs.getPropertyValue("--sketch-layer"), "under") === "over";
    svg.style.cssText =
      `position:absolute;left:${-pad - (parseFloat(cs.borderLeftWidth) || 0)}px;top:${-pad - (parseFloat(cs.borderTopWidth) || 0)}px;` +
      `pointer-events:none;overflow:visible;z-index:${over ? 3 : -1}`;

    const rc = rough.svg(svg);
    const fill = str(cs.getPropertyValue("--sketch-fill"), "none");
    const dash = str(cs.getPropertyValue("--sketch-dash"), "none");
    const opts: Record<string, unknown> = {
      seed: hash(classNameOf(el) + ":" + i) + SEED_BASE,
      stroke: "__S__",
      strokeWidth: num(cs.getPropertyValue("--sketch-stroke-width"), 1.6),
      roughness: num(cs.getPropertyValue("--sketch-roughness"), 1.2),
      bowing: num(cs.getPropertyValue("--sketch-bowing"), 1),
      fill: fill === "none" ? undefined : "__F__",
      fillStyle: str(cs.getPropertyValue("--sketch-fill-style"), "hachure"),
      fillWeight: num(cs.getPropertyValue("--sketch-fill-weight"), 1.2),
      hachureGap: num(cs.getPropertyValue("--sketch-hachure-gap"), 6),
      hachureAngle: num(cs.getPropertyValue("--sketch-hachure-angle"), -41),
      strokeLineDash: dash === "none" ? undefined : dash.split(/[\s,]+/).map(Number).filter(Number.isFinite),
      disableMultiStroke: false,
      preserveVertices: false,
    };

    const x = pad + inset;
    const y = pad + inset;
    const W = w - inset * 2;
    const H = h - inset * 2;
    let node: SVGGElement | null = null;
    if (kind === "rect") {
      const r = Math.min(num(cs.getPropertyValue("--sketch-radius"), 10), W / 2, H / 2);
      const d = `M${x + r},${y} L${x + W - r},${y} Q${x + W},${y} ${x + W},${y + r} L${x + W},${y + H - r} Q${x + W},${y + H} ${x + W - r},${y + H} L${x + r},${y + H} Q${x},${y + H} ${x},${y + H - r} L${x},${y + r} Q${x},${y} ${x + r},${y} Z`;
      node = rc.path(d, opts);
    } else if (kind === "ellipse") {
      node = rc.ellipse(x + W / 2, y + H / 2, W, H, opts);
    } else if (kind === "circle") {
      node = rc.circle(x + W / 2, y + H / 2, Math.min(W, H), opts);
    } else if (kind === "underline") {
      node = rc.line(x, y + H + 2, x + W, y + H + 1, { ...opts, fill: undefined });
    } else if (kind === "highlight") {
      node = rc.rectangle(x - 2, y + H * 0.35, W + 4, H * 0.62, {
        ...opts,
        stroke: "none",
        fill: "__F__",
        fillStyle: str(cs.getPropertyValue("--sketch-fill-style"), "zigzag"),
        hachureGap: 3,
        fillWeight: Math.max(3, H * 0.18),
      });
    }
    if (!node) return;
    svg.appendChild(node);
    paint(svg, { stroke: str(cs.getPropertyValue("--sketch-stroke"), cs.color), fill: fill === "none" ? "none" : fill });
    if (cs.position === "static") el.style.position = "relative";
    if (!over && cs.isolation !== "isolate") el.style.isolation = "isolate";
    el.appendChild(svg);
  });
}

/** Register the --sketch* custom properties once so they parse/inherit cleanly. */
function registerSketchProps() {
  const css = (window as unknown as { CSS?: { registerProperty?: (d: unknown) => void } }).CSS;
  if (!css || !css.registerProperty) return;
  for (const name of SKETCH_PROPS) {
    try {
      css.registerProperty({ name, syntax: "*", inherits: false });
    } catch {
      /* already registered */
    }
  }
}

export function SketchLayer() {
  const look = useLook();
  const pathname = usePathname();
  const active = look.skin === "paper";

  useEffect(() => {
    if (!active) {
      if (typeof document !== "undefined") clearSketch(document);
      return;
    }
    let disposed = false;
    let observer: ResizeObserver | null = null;
    let scheduled = 0;

    (async () => {
      const rough = ((await import("roughjs")).default as unknown as AnyRough);
      if (disposed) return;
      registerSketchProps();

      const run = () => draw(rough);
      const schedule = () => {
        cancelAnimationFrame(scheduled);
        scheduled = requestAnimationFrame(() => requestAnimationFrame(run));
      };

      run();
      observer = new ResizeObserver(schedule);
      if (document.documentElement) observer.observe(document.documentElement);
      if (document.body) observer.observe(document.body);
      // Fonts change text metrics (and therefore box sizes) after first paint.
      document.fonts?.ready.then(() => { if (!disposed) schedule(); }).catch(() => {});
      // Parity with design/skins/sketch.js — handy for devtools/debugging.
      (window as unknown as { GiggleSketch?: unknown }).GiggleSketch = { draw: run, schedule };

      return () => {
        cancelAnimationFrame(scheduled);
        observer?.disconnect();
      };
    })();

    return () => {
      disposed = true;
      observer?.disconnect();
      cancelAnimationFrame(scheduled);
    };
  }, [active, pathname]);

  return null;
}

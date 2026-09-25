"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AdaptiveVideoStage, type AdaptiveParticipant } from "@/components/AdaptiveVideoStage";
import { arrangeVideoCall, arrangeFocusCall, MAX_WEIGHT, type Tile, type FocusPerson } from "@giggle/core";

// ── prototype layouts (variant=fair|grid); "current" uses the real AdaptiveVideoStage ──
type Box = { x: number; y: number; w: number; h: number };
const RATIO: Record<string, number> = { "16:9": 16 / 9, "9:16": 9 / 16, "4:3": 4 / 3, "1:1": 1, "21:9": 21 / 9, off: 1 };

/** Same-size tiles for n people in a box: pick the tile shape and column count that gives the biggest tiles. */
function uniformGrid(n: number, box: Box, gap: number): Box[] {
  if (!n) return [];
  let best: { tw: number; th: number; cols: number; rows: number } | null = null;
  for (const a of [16 / 9, 4 / 3, 1, 3 / 4, 9 / 16]) for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    let tw = (box.w - gap * (cols - 1)) / cols, th = tw / a;
    if (th * rows + gap * (rows - 1) > box.h) { th = (box.h - gap * (rows - 1)) / rows; tw = th * a; }
    if (!best || tw * th > best.tw * best.th) best = { tw, th, cols, rows };
  }
  const { tw, th, cols, rows } = best!;
  const out: Box[] = [];
  const totalH = rows * th + (rows - 1) * gap;
  for (let r = 0; r < rows; r++) {
    const inRow = Math.min(cols, n - r * cols);
    const rowW = inRow * tw + (inRow - 1) * gap;
    for (let c = 0; c < inRow; c++) out.push({ x: box.x + (box.w - rowW) / 2 + c * (tw + gap), y: box.y + (box.h - totalH) / 2 + r * (th + gap), w: tw, h: th });
  }
  return out;
}

function prototypeLayout(variant: string, mineShapes: string[], theirShapes: string[], W: number, H: number): { mine: Box[]; theirs: Box[]; split: Box | null } {
  const squadGap = 10, gap = 4;
  if (variant === "fair") {
    const clamp = (k: string) => Math.max(0.75, Math.min(1.5, RATIO[k] ?? 1));
    const r = arrangeVideoCall(mineShapes.map(clamp), theirShapes.map(clamp), W, H);
    const place = (tiles: Tile[], ox: number, oy: number) => tiles.map(t => ({ x: ox + t.x, y: oy + t.y, w: t.width, h: t.height }));
    // mirror the real stage: groups centred, theirs first (left/top), mine second
    const tw = r.theirs.width, th = r.theirs.height, mw = r.mine.width, mh = r.mine.height;
    if (!mineShapes.length || !theirShapes.length) {
      const one = mineShapes.length ? r.mine : r.theirs;
      const b = place(one.tiles, (W - one.width) / 2, (H - one.height) / 2 + r.label);
      return mineShapes.length ? { mine: b, theirs: [], split: null } : { mine: [], theirs: b, split: null };
    }
    if (r.stacked) {
      const total = th + r.gap + mh, y0 = (H - total) / 2;
      return { theirs: place(r.theirs.tiles, (W - tw) / 2, y0 + r.label), mine: place(r.mine.tiles, (W - mw) / 2, y0 + th + r.gap + r.label), split: null };
    }
    const total = tw + r.gap + mw, x0 = (W - total) / 2;
    return { theirs: place(r.theirs.tiles, x0, (H - th) / 2 + r.label), mine: place(r.mine.tiles, x0 + tw + r.gap, (H - mh) / 2 + r.label), split: null };
  }
  // grid: space shared by headcount (floor 30%), them left/top, us right/bottom
  const m = mineShapes.length, t = theirShapes.length;
  if (!m || !t) {
    const one = uniformGrid(m || t, { x: 0, y: 0, w: W, h: H }, gap);
    return m ? { mine: one, theirs: [], split: null } : { mine: [], theirs: one, split: null };
  }
  const stacked = W < 700 && H > W * 0.65;
  const share = Math.max(0.3, Math.min(0.7, t / (m + t)));
  if (stacked) {
    const th = (H - squadGap) * share;
    return { theirs: uniformGrid(t, { x: 0, y: 0, w: W, h: th }, gap), mine: uniformGrid(m, { x: 0, y: th + squadGap, w: W, h: H - th - squadGap }, gap), split: { x: 0, y: th, w: W, h: squadGap } };
  }
  const tw = (W - squadGap) * share;
  return { theirs: uniformGrid(t, { x: 0, y: 0, w: tw, h: H }, gap), mine: uniformGrid(m, { x: tw + squadGap, y: 0, w: W - tw - squadGap, h: H }, gap), split: { x: tw, y: 0, w: squadGap, h: H } };
}

function PrototypeStage({ variant, mine, theirs, shapeKeys, render }: { variant: string; mine: AdaptiveParticipant[]; theirs: AdaptiveParticipant[]; shapeKeys: Record<string, string>; render: (id: string, fit: "cover") => React.ReactNode }) {
  const host = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = host.current; if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el); setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);
  const L = size.w ? prototypeLayout(variant, mine.map(p => shapeKeys[p.id]), theirs.map(p => shapeKeys[p.id]), size.w, size.h) : null;
  const cell = (p: AdaptiveParticipant, b: Box, side: "mine" | "theirs") => (
    <div key={p.id} data-participant-id={p.id} data-side={side} style={{ position: "absolute", left: b.x, top: b.y, width: b.w, height: b.h, borderRadius: 10, overflow: "hidden", boxShadow: `inset 0 0 0 2px ${side === "mine" ? "#4f8cff" : "#ffb020"}` }}>{render(p.id, "cover")}</div>
  );
  return (
    <div ref={host} data-adaptive-video-stage style={{ position: "relative", flex: 1, minWidth: 0, minHeight: 0 }}>
      {L && L.theirs.map((b, i) => cell(theirs[i], b, "theirs"))}
      {L && L.mine.map((b, i) => cell(mine[i], b, "mine"))}
    </div>
  );
}

// ?m=3&t=5&shapes=16:9,9:16,off,4:3  (shapes cycle across mine then theirs)
type Shape = [number, number] | null;
const SHAPES: Record<string, Shape> = { "16:9": [1280, 720], "9:16": [720, 1280], "4:3": [640, 480], "1:1": [720, 720], "21:9": [2560, 1080], off: null };
const COLORS = ["#5b6cff", "#ff7a59", "#2fb88a", "#c05bd6", "#e6b422", "#3aa7d9", "#ef5d8f", "#8a9a3b"];

function SyntheticCamera({ shape, color, label }: { shape: [number, number]; color: string; label: string }) {
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const [w, h] = shape;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "rgba(255,255,255,.85)";
      ctx.beginPath();
      ctx.arc(w / 2, h * 0.42, Math.min(w, h) * 0.18, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(w / 2 - Math.min(w, h) * 0.28, h * 0.62, Math.min(w, h) * 0.56, h * 0.4);
      ctx.fillStyle = "#000";
      ctx.font = `${Math.round(Math.min(w, h) / 9)}px sans-serif`;
      ctx.fillText(`${label} ${w}×${h}`, 24, Math.min(w, h) / 7);
    }
    const stream = canvas.captureStream(5);
    if (video.current) video.current.srcObject = stream;
    return () => stream.getTracks().forEach(t => t.stop());
  }, [shape, color, label]);
  return <video ref={video} autoPlay muted playsInline style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />;
}

/** Viewer-controlled layout: zoom (weight) re-flows everyone; a pin freezes that person's size. */
function FocusStage({ mine, theirs, render }: { mine: AdaptiveParticipant[]; theirs: AdaptiveParticipant[]; render: (id: string) => React.ReactNode }) {
  const host = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [weights, setWeights] = useState<Record<string, number>>({});
  const [pins, setPins] = useState<Record<string, { width: number; height: number }>>({});
  useEffect(() => {
    const el = host.current; if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el); setSize({ w: el.clientWidth, h: el.clientHeight });
    // test hook: window.__focus.zoom(id, w) / pin(id) / unpin(id)
    (window as unknown as { __focus: unknown }).__focus = {
      zoom: (id: string, w: number) => setWeights(prev => ({ ...prev, [id]: w })),
      pin: (id: string) => { const t = document.querySelector<HTMLElement>(`[data-participant-id="${id}"]`); if (t) setPins(prev => ({ ...prev, [id]: { width: t.offsetWidth, height: t.offsetHeight } })); },
      unpin: (id: string) => setPins(prev => { const next = { ...prev }; delete next[id]; return next; }),
    };
    return () => ro.disconnect();
  }, []);
  const toFocus = (p: AdaptiveParticipant): FocusPerson => ({ id: p.id, weight: weights[p.id] ?? 1, pinned: pins[p.id] ?? null });
  const layout = size.w ? arrangeFocusCall(mine.map(toFocus), theirs.map(toFocus), size.w, size.h) : null;
  const btn: React.CSSProperties = { width: 30, height: 30, borderRadius: 9, border: 0, background: "rgba(0,0,0,.6)", color: "#fff", font: "700 15px system-ui", cursor: "pointer", display: "grid", placeItems: "center" };
  return (
    <div ref={host} data-adaptive-video-stage style={{ position: "relative", flex: 1, minWidth: 0, minHeight: 0 }}>
      {layout?.tiles.map(t => {
        const w = weights[t.id] ?? 1;
        const pinned = !!pins[t.id];
        return (
          <div key={t.id} data-participant-id={t.id} data-side={t.side} data-weight={w} data-pinned={pinned || undefined}
            onDoubleClick={() => !pinned && setWeights(prev => ({ ...prev, [t.id]: w >= MAX_WEIGHT ? 1 : w * 2 }))}
            style={{ position: "absolute", left: t.x, top: t.y, width: t.width, height: t.height, borderRadius: 10, overflow: "hidden", transition: "left .25s, top .25s, width .25s, height .25s", outline: pinned ? "2px solid #ffd166" : "none", outlineOffset: -2 }}>
            {render(t.id)}
            <div style={{ position: "absolute", top: 6, right: 6, display: "flex", gap: 4 }}>
              <button type="button" aria-label="Smaller" style={btn} disabled={pinned || w <= 1} onClick={() => setWeights(prev => ({ ...prev, [t.id]: Math.max(1, w / 2) }))}>−</button>
              <button type="button" aria-label="Bigger" style={btn} disabled={pinned || w >= MAX_WEIGHT} onClick={() => setWeights(prev => ({ ...prev, [t.id]: Math.min(MAX_WEIGHT, w * 2) }))}>+</button>
              <button type="button" aria-label={pinned ? "Unpin" : "Pin this size"} aria-pressed={pinned} style={{ ...btn, background: pinned ? "#ffd166" : btn.background, color: pinned ? "#1a1400" : "#fff" }}
                onClick={e => { const el = (e.currentTarget.closest("[data-participant-id]") as HTMLElement); setPins(prev => { const next = { ...prev }; if (pinned) delete next[t.id]; else next[t.id] = { width: el.offsetWidth, height: el.offsetHeight }; return next; }); }}>📌</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function CallStageHarness() {
  const [params, setParams] = useState<URLSearchParams | null>(null);
  useEffect(() => setParams(new URLSearchParams(window.location.search)), []);
  const { mine, theirs, shapes, keys, variant } = useMemo(() => {
    const m = Math.max(0, Math.min(8, Number(params?.get("m") ?? 2)));
    const t = Math.max(0, Math.min(8, Number(params?.get("t") ?? 2)));
    const pattern = (params?.get("shapes") ?? "16:9,9:16,off,4:3").split(",").map(s => s.trim()).filter(s => s in SHAPES);
    const shapes: Record<string, Shape> = {};
    const keys: Record<string, string> = {};
    const make = (side: string, n: number, offset: number): AdaptiveParticipant[] => Array.from({ length: n }, (_, i) => {
      const id = `${side}-${i + 1}`;
      const shape = SHAPES[pattern[(offset + i) % pattern.length] ?? "16:9"];
      shapes[id] = shape;
      keys[id] = pattern[(offset + i) % pattern.length] ?? "16:9";
      return { id, cameraOn: !!shape };
    });
    return { mine: make("mine", m, 0), theirs: make("theirs", t, m), shapes, keys, variant: params?.get("variant") ?? "current" };
  }, [params]);
  if (!params) return null;
  const renderTile = (id: string) => {
    const shape = shapes[id];
    const index = Number(id.split("-")[1]) - 1 + (id.startsWith("theirs") ? mine.length : 0);
    const name = ["You", "Maya", "Theo", "Alexandria-Rose", "Kit", "June", "Sam", "Priya", "Jonas", "Noor", "Bartholomew", "Eli", "Ana", "Zed", "Liv", "Rio"][index % 16];
    return (
      <div data-media-host style={{ position: "absolute", inset: 0, overflow: "hidden", borderRadius: 12, background: "#23232b", display: "grid", placeItems: "center", color: "#fff", font: "600 14px system-ui" }}>
        {shape ? <SyntheticCamera shape={shape} color={COLORS[index % COLORS.length]} label={id} /> : <span style={{ width: "38%", aspectRatio: "1", borderRadius: "50%", background: COLORS[index % COLORS.length], display: "grid", placeItems: "center", fontSize: 18 }}>{name[0]}</span>}
        <span data-name style={{ position: "absolute", left: 6, bottom: 6, maxWidth: "calc(100% - 12px)", padding: "2px 7px", borderRadius: 7, background: "rgba(0,0,0,.6)", font: "600 12px system-ui", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{name}</span>
      </div>
    );
  };
  return (
    <div className="gg-call-theme" data-testid="call-stage-harness" style={{ position: "fixed", inset: 0, background: "#0d0d12", display: "flex", padding: 10 }}>
{variant === "current" ? (
      <AdaptiveVideoStage
        mine={mine}
        theirs={theirs}
        mineLabel={`Your squad · ${mine.length}`}
        theirsLabel={`Their squad · ${theirs.length}`}
        renderParticipant={renderTile}
      />
      ) : variant === "focus" ? <FocusStage mine={mine} theirs={theirs} render={renderTile} /> : <PrototypeStage variant={variant} mine={mine} theirs={theirs} shapeKeys={keys} render={renderTile} />}
    </div>
  );
}

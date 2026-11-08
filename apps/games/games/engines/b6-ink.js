"use strict";
const { randomUUID } = require("node:crypto");
const { normalizeStroke } = require("./drawing-input");
const COLORS = [
  "#2563eb",
  "#db2777",
  "#0d9488",
  "#d97706",
  "#7c3aed",
  "#c2410c",
  "#0891b2",
  "#4d7c0f",
  "#be185d",
  "#4338ca",
  "#a16207",
  "#047857",
];

function makeInk() {
  return {
    nonce: randomUUID(),
    revision: 0,
    lastId: 0,
    active: null,
    strokes: [],
    preview: null,
  };
}
function seal(ink) {
  if (ink.preview && ink.strokes.length < 400) ink.strokes.push(ink.preview);
  ink.preview = null;
  ink.active = null;
}
function accept(ink, a, forcedColor, single = false) {
  if (a.inkNonce !== ink.nonce || a.inkRevision !== ink.revision) return false;
  const keys = ["stroke", "preview", "undo", "clear"].filter((k) => a[k]);
  if (keys.length !== 1) return false;
  if (a.undo || a.clear) {
    if (single || (a.undo !== true && a.clear !== true)) return false;
    const id =
      ink.active?.id || ink.preview?.gestureId || ink.strokes.at(-1)?.gestureId;
    ink.strokes = a.clear ? [] : ink.strokes.filter((s) => s.gestureId !== id);
    ink.preview = null;
    ink.active = null;
    ink.revision++;
    return "changed";
  }
  const source = a.stroke || a.preview;
  const stroke = normalizeStroke(source);
  if (
    !stroke ||
    !/^#[0-9a-f]{6}$/i.test(stroke.color) ||
    !["pen", "eraser", undefined].includes(source.tool) ||
    !Number.isSafeInteger(a.gestureId) ||
    a.gestureId < 1 ||
    a.gestureId > 1e9 ||
    !Number.isInteger(a.chunk) ||
    a.chunk < 0 ||
    a.chunk >= 400 ||
    (a.stroke && typeof a.finished !== "boolean") ||
    (a.preview &&
      (!Number.isInteger(a.sample) || a.sample < 1 || a.sample > 1e6))
  )
    return false;
  stroke.tool = forcedColor ? "pen" : source.tool || "pen";
  stroke.color =
    forcedColor ||
    (stroke.tool === "eraser" ? "#ffffff" : stroke.color.toLowerCase());
  if (!ink.active) {
    if (
      a.gestureId <= ink.lastId ||
      a.chunk !== 0 ||
      (single && ink.lastId > 0)
    )
      return false;
    ink.active = {
      id: a.gestureId,
      chunk: 0,
      sample: 0,
      color: stroke.color,
      size: stroke.size,
      tool: stroke.tool,
    };
    ink.lastId = a.gestureId;
  }
  const live = ink.active;
  if (
    live.id !== a.gestureId ||
    live.chunk !== a.chunk ||
    live.color !== stroke.color ||
    live.size !== stroke.size ||
    live.tool !== stroke.tool ||
    ink.strokes.length >= 400
  )
    return false;
  const item = { ...stroke, gestureId: a.gestureId, chunk: a.chunk };
  if (a.preview) {
    if (a.sample <= live.sample) return false;
    live.sample = a.sample;
    ink.preview = item;
    return "changed";
  }
  ink.strokes.push(item);
  ink.preview = null;
  live.chunk++;
  live.sample = 0;
  if (a.finished || live.chunk >= 400) {
    ink.active = null;
    return "finished";
  }
  return "changed";
}
function strokes(ink) {
  return [...ink.strokes, ...(ink.preview ? [ink.preview] : [])];
}
function tools(ink) {
  return {
    inkNonce: ink.nonce,
    inkRevision: ink.revision,
    lastGestureId: ink.lastId,
  };
}
module.exports = { COLORS, makeInk, seal, accept, strokes, tools };

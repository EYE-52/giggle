#!/usr/bin/env node
/**
 * Skin system, phase 2a — ports the APPROVED mock skins in
 * design/skins/skin-<id>.css (written for the studio markup in
 * design/skins/markup.html) onto the real app DOM.
 *
 * Usage:  node scripts/port-skins.mjs        (from apps/desktop)
 *
 * Selector translation (mock → app):
 *   .frame[data-skin="X"]                     → html[data-skin="X"]
 *   .frame[data-skin="X"][data-theme="dark"]  → html[data-skin="X"][data-mode="dark"]
 *                                              (soft wrote dark variants with data-theme)
 *   @media (prefers-color-scheme: dark) {…}   → … under html[data-skin="X"][data-mode="dark"]
 *                                              (scrap keyed dark off the OS in the studio;
 *                                               the app keys it off the resolved look mode)
 *   … .device.desktop …                       → same rule inside @media (min-width: 721px)
 *   … .device.phone …                         → same rule inside @media (max-width: 720px)
 *   .device / .board (bare)                   → body  (frame chrome — border/border-radius/
 *                                              box-shadow — is dropped; backdrops stay)
 *   .device::before / .board::before          → body::before
 *   .app                                      → .gg-app-root   (the (app) layout shell)
 *   .s-home                                   → .gg-screen-home (Home page root)
 *   .screen                                   → .gg-screen      (any screen root)
 *   .home-grid                                → .gg-home-grid — but grid PLACEMENT
 *                                              declarations on the grid root are dropped:
 *                                              the real Home keeps its own two-column
 *                                              layout (primary + side); skins restyle
 *                                              surfaces, not that layout.
 *   html:has(.frame[data-skin="X"])::view-transition… → html[data-skin="X"]::view-transition…
 *                                              (kept inert — the app does not wire the
 *                                              ViewTransition API in this phase)
 *
 * Declaration translation:
 *   var(--accent)              → var(--pop)     (the mock's pop color; the phase-1
 *                                                bridge re-points --accent at the brand)
 *   var(--paper-font-display)  → var(--font-display)   } skins.css owns font mapping
 *   var(--paper-font-body)     → var(--font-body)      } via next/font variables
 *   var(--hand)                → var(--font-hand)
 *   --font-display / --font-body declarations are dropped (skins.css owns them).
 *
 * DOM-shape overrides (real component ≠ mock markup):
 *   img.av                              → .av                       (AvatarArt sizing span)
 *   .switch span                        → .switch .gg-switch-track
 *   .switch span::after                 → .switch .gg-switch-track::after
 *   .switch input:checked + span        → .gg-switch[aria-checked="true"] .gg-switch-track
 *   .switch input:checked + span::after → … .gg-switch-track::after  (same prefix)
 *   .switch input:focus-visible + span  → .gg-switch:focus-visible .gg-switch-track
 *   .switch input {…} rules are DROPPED — the real Switch is a <button role="switch">;
 *   the mock's visually-hidden checkbox styles would hide it.
 *
 * Scope: selectors that reference mock classes which do not exist in the real
 * DOM yet (Lobby / Friends / Call screens and the component board arrive in
 * phases 2b/2c) are dropped. Rules mixing live and future selectors keep only
 * the live ones.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DESKTOP = join(HERE, "..");
const DESIGN = join(DESKTOP, "..", "..", "design", "skins");

const SKINS = ["soft", "play", "paper", "clay", "scrap"];

/* Mock classes that exist in the real DOM after phase 2a (plus the mapped app
 * hooks). Selectors referencing anything else are dropped. */
const LIVE_CLASSES = new Set([
  // shell
  "nav", "nav-end", "tabs", "tab", "is-active", "tabbar", "tb",
  "brand", "wordmark", "logo", "icon-btn", "ic",
  // avatars / presence
  "av", "me", "pa", "presence", "on", "away",
  // primitives
  "btn", "btn-primary", "btn-secondary", "btn-ghost", "btn-danger", "btn-tonal",
  "small", "wide", "input", "code", "chip", "is-on", "badge", "switch",
  "card", "card-title", "card-foot", "hint", "fine", "link", "kicker",
  // home
  "create", "join-card", "join", "seat", "seat-row", "filled", "empty",
  "page-head", "eyebrow", "title", "lede",
  "tip", "tip-mark", "tip-body", "tip-title", "tip-shuffle", "tip-ideas",
  "tip-idea", "is-shuffled", "tip-cta",
  // overlays
  "modal", "modal-head", "modal-foot", "toast",
  // mapped app hooks (may appear in translated selectors)
  "gg-app-root", "gg-screen", "gg-screen-home", "gg-home-grid",
  "gg-switch", "gg-switch-track",
]);

const CLASS_RE = /\.([A-Za-z0-9_-]+)/g;

function classesOf(selector) {
  const out = new Set();
  let m;
  CLASS_RE.lastIndex = 0;
  while ((m = CLASS_RE.exec(selector))) out.add(m[1]);
  return out;
}

/* ── selector translation ─────────────────────────────────────────────────── */

/**
 * Translate one selector for `skin`.
 * Returns { selector, media: "min" | "max" | null } or null to drop.
 * `forceDark` remaps studio dark-media rules onto [data-mode="dark"].
 */
function translateSelector(sel, skin, forceDark = false) {
  let s = sel.trim();
  if (!s) return null;

  // @keyframes step selectors (e.g. "0%, 100%") and anything frame-less pass through.
  if (!s.includes(".frame")) return { selector: s, media: null };

  let dark = forceDark;
  const frameDark = `.frame[data-skin="${skin}"][data-theme="dark"]`;
  const frameMode = `.frame[data-skin="${skin}"][data-mode="dark"]`;
  const frame = `.frame[data-skin="${skin}"]`;
  const ROOT = "\u0001";       // → html[data-skin="X"]
  const ROOT_DARK = "\u0002";  // → html[data-skin="X"][data-mode="dark"]

  // view-transition rules: html:has(.frame[data-skin="X"])::… → html[data-skin="X"]::…
  s = s.replaceAll(`html:has(${frameDark})`, ROOT_DARK);
  s = s.replaceAll(`html:has(${frameMode})`, ROOT_DARK);
  s = s.replaceAll(`html:has(${frame})`, ROOT);

  if (s.includes(frameDark)) { dark = true; s = s.replaceAll(frameDark, ROOT); }
  if (s.includes(frameMode)) { dark = true; s = s.replaceAll(frameMode, ROOT); }
  s = s.replaceAll(frame, ROOT);
  if (s.includes(".frame")) return null; // another skin's frame — never matches

  let media = null;
  if (s.includes(".device.desktop")) { s = s.replaceAll(".device.desktop", ""); media = "min"; }
  if (s.includes(".device.phone")) {
    if (media) return null;
    s = s.replaceAll(".device.phone", "");
    media = "max";
  }

  // the component board is not part of the app — drop its selectors outright
  if (/(^|[\s+>~])\.board($|[\s+>~:.#[])/.test(s)) return null;
  // the app shell hangs off .device directly
  s = s.replace(/\.device\s+\.app\b/g, ".gg-app-root");
  // .device/.board → body (pseudo-elements included)
  s = s.replace(/(\.device|\.board)(::before|::after)?/g, (_m, _d, pseudo = "") => `body${pseudo}`);
  // .app → the app shell root
  s = s.replace(/(?<![\w-])\.app(?![\w-])/g, ".gg-app-root");

  // screens
  s = s.replace(/\.s-home\b/g, ".gg-screen-home");
  s = s.replace(/\.s-friends\b/g, ".gg-screen-friends");
  s = s.replace(/(?<![\w-])\.screen(?![\w-])/g, ".gg-screen");
  s = s.replace(/\.home-grid\b/g, ".gg-home-grid");

  // DOM-shape overrides
  s = s.replace(/img\.av\b/g, ".av");
  s = s.replace(/\.switch input:checked \+ span::after/g, "@SWON@ .gg-switch-track::after");
  s = s.replace(/\.switch input:checked \+ span/g, "@SWON@ .gg-switch-track");
  s = s.replace(/\.switch input:focus-visible \+ span/g, "@SWFOC@ .gg-switch-track");
  s = s.replace(/\.switch span::after/g, ".switch .gg-switch-track::after");
  s = s.replace(/\.switch span/g, ".switch .gg-switch-track");
  if (/(^|[\s+>~])\.switch input([.:[]|$)/.test(s)) return null; // hidden-checkbox styles — N/A

  // rebuild the root
  const rootSel = dark ? `html[data-skin="${skin}"][data-mode="dark"]` : `html[data-skin="${skin}"]`;
  s = s.replaceAll(ROOT_DARK, `html[data-skin="${skin}"][data-mode="dark"]`).replaceAll(ROOT, rootSel);
  s = s.replace(/@SWON@/g, ".gg-switch[aria-checked=\"true\"]").replace(/@SWFOC@/g, ".gg-switch:focus-visible");

  // scope filter — every class in the translated selector must be live
  for (const cls of classesOf(s)) {
    if (!LIVE_CLASSES.has(cls)) return null;
  }

  s = s.replace(/\s{2,}/g, " ").replace(/\s*>\s*/g, " > ").trim();
  return s ? { selector: s, media } : null;
}

/* ── declaration translation ──────────────────────────────────────────────── */

const FRAME_CHROME = new Set(["border", "border-radius", "box-shadow", "border-color", "border-width", "border-style"]);
const GRID_TEMPLATE = new Set([
  "grid-template-columns", "grid-template-rows", "grid-template-areas",
  "grid-auto-rows", "grid-auto-flow", "align-content", "justify-items",
]);
/* Self-placement: the mock places the home cards into its own grid areas
 * ("create"/"join"/"tip") — names that don't exist in the app's grid. */
const GRID_SELF_PLACEMENT = new Set(["grid-area", "grid-row", "grid-column", "align-self", "justify-self"]);

function translateValue(v) {
  return v
    .replaceAll("var(--accent)", "var(--pop)")
    .replaceAll("var(--accent,", "var(--pop,")
    .replaceAll("var(--paper-font-display)", "var(--font-display)")
    .replaceAll("var(--paper-font-body)", "var(--font-body)")
    .replaceAll("var(--paper-font-display,", "var(--font-display,")
    .replaceAll("var(--paper-font-body,", "var(--font-body,")
    .replaceAll("var(--hand)", "var(--font-hand)")
    .replaceAll("var(--hand,", "var(--font-hand,");
}

/* Raw Google family names from the mock CSS are NOT loaded in the app (skins
 * load fonts through next/font CSS variables) — map any font-family that
 * names a skin face onto the matching variable. */
const DISPLAY_FACES = ["Bricolage Grotesque", "Baloo 2", "Fredoka", "Caveat Brush"];
const BODY_FACES = ["Plus Jakarta Sans", "Nunito", "Kalam", "Caveat"];

function translateFontFamily(v) {
  if (DISPLAY_FACES.some((f) => v.includes(f))) return "var(--font-display)";
  if (BODY_FACES.some((f) => v.includes(f))) return "var(--font-body)";
  return translateValue(v);
}

/** Does this translated selector target exactly the app/body/screen roots? */
function rootKind(selector) {
  const t = selector.trim();
  if (/(^|\s)body$/.test(t) || /body::(before|after)$/.test(t)) return "body";
  if (/\.gg-screen$/.test(t) || /\.gg-screen-(home|friends)$/.test(t)) return "screen";
  return null;
}

/** Does this translated selector target a layout-critical app root/card? */
function placementKind(selector) {
  const lastCompound = selector.trim().split(/[\s>+~]+/).pop() ?? "";
  const classes = classesOf(lastCompound);
  if (classes.has("gg-home-grid")) return "homeGrid";
  if ((classes.has("create") || classes.has("join-card") || classes.has("tip")) && !lastCompound.includes(":")) return "homeCard";
  return null;
}

function translateBody(body, selector) {
  const kind = placementKind(selector);
  const rootKindValue = rootKind(selector);
  const decls = [];
  for (const raw of body.split(";")) {
    const idx = raw.indexOf(":");
    if (idx < 0) continue;
    const prop = raw.slice(0, idx).trim();
    let value = raw.slice(idx + 1).trim();
    if (!prop || !value) continue;
    if (prop === "--font-display" || prop === "--font-body") continue; // skins.css owns fonts
    if (prop.startsWith("--")) { decls.push(`${prop}: ${value}`); continue; }
    const p = prop.toLowerCase();
    if (rootKindValue === "body" && FRAME_CHROME.has(p)) continue;      // device-frame chrome → N/A
    // the app owns the real Home layout; skins restyle surfaces, not placement
    if (kind === "homeGrid" && (GRID_TEMPLATE.has(p) || GRID_SELF_PLACEMENT.has(p) || p === "align-items")) continue;
    if (kind === "homeCard" && GRID_SELF_PLACEMENT.has(p)) continue;
    if (rootKindValue === "screen" && p.startsWith("padding")) continue; // .gg-app-container pads
    if (p === "font-family") { decls.push(`${p}: ${translateFontFamily(value)}`); continue; }
    decls.push(`${p}: ${translateValue(value)}`);
  }
  return decls;
}

/* ── CSS parsing (rules with bodies, nested @media/@keyframes) ───────────── */

function parseRules(css) {
  css = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const items = [];
  let i = 0;
  const n = css.length;
  while (i < n) {
    const ch = css[i];
    if (/\s/.test(ch)) { i++; continue; }
    let j = i;
    while (j < n && css[j] !== "{" && css[j] !== "}" && css[j] !== ";") j++;
    const head = css.slice(i, j).trim();
    if (css[j] === "{") {
      let depth = 1;
      let k = j + 1;
      while (k < n && depth > 0) {
        if (css[k] === "{") depth++;
        else if (css[k] === "}") depth--;
        k++;
      }
      items.push({ head, body: css.slice(j + 1, k - 1), isAt: head.startsWith("@") });
      i = k;
    } else {
      i = j + 1;
    }
  }
  return items.filter((x) => x.head);
}

/* ── emission ─────────────────────────────────────────────────────────────── */

function formatPairs(pairs) {
  const merged = new Map();
  for (const { selector, decls } of pairs) {
    if (!decls.length) continue;
    if (!merged.has(selector)) merged.set(selector, new Set());
    const set = merged.get(selector);
    for (const d of decls) set.add(d); // dedupe (`.device, .board` share decls)
  }
  const lines = [];
  for (const [sel, decls] of merged) {
    lines.push(`${sel} {`, ...[...decls].map((d) => `  ${d};`), `}`);
  }
  return lines;
}

/** Translate one style rule; returns lines. */
function styleRule(item, skin, forceDark = false) {
  const buckets = { min: [], max: [], none: [] };
  for (const part of item.head.split(",")) {
    const t = translateSelector(part, skin, forceDark);
    if (t) buckets[t.media ?? "none"].push(t.selector);
  }
  if (!buckets.none.length && !buckets.min.length && !buckets.max.length) return [];

  // skin root block: custom props on html, background/color/font on body
  const rootOnly = forceDark === false
    && buckets.none.length === 1
    && /^html\[data-skin="[a-z]+"\]$/.test(buckets.none[0])
    && !buckets.min.length && !buckets.max.length;
  if (rootOnly) {
    const htmlDecls = [];
    const bodyDecls = [];
    for (const raw of item.body.split(";")) {
      const idx = raw.indexOf(":");
      if (idx < 0) continue;
      const prop = raw.slice(0, idx).trim();
      let value = raw.slice(idx + 1).trim();
      if (!prop || !value) continue;
      if (prop === "--font-display" || prop === "--font-body") continue;
      if (prop.startsWith("--")) { htmlDecls.push(`${prop}: ${value}`); continue; }
      value = prop.toLowerCase() === "font-family" ? translateFontFamily(value) : translateValue(value);
      const p = prop.toLowerCase();
      if (p.startsWith("background") || p === "color" || p.startsWith("font")) bodyDecls.push(`${p}: ${value}`);
      else htmlDecls.push(`${p}: ${value}`);
    }
    const lines = [];
    if (htmlDecls.length) lines.push(`html[data-skin="${skin}"] {`, ...htmlDecls.map((d) => `  ${d};`), `}`);
    if (bodyDecls.length) lines.push(`html[data-skin="${skin}"] body {`, ...bodyDecls.map((d) => `  ${d};`), `}`);
    return lines;
  }

  const lines = formatPairs(buckets.none.map((sel) => ({ selector: sel, decls: translateBody(item.body, sel) })));
  for (const [key, query] of [["min", "@media (min-width: 721px)"], ["max", "@media (max-width: 720px)"]]) {
    if (!buckets[key].length) continue;
    const inner = formatPairs(buckets[key].map((sel) => ({ selector: sel, decls: translateBody(item.body, sel) })));
    if (!inner.length) continue;
    lines.push(`${query} {`, ...inner.map((l) => `  ${l}`), `}`);
  }
  return lines;
}

function processItem(item, skin) {
  if (!item.isAt) return styleRule(item, skin);
  const head = item.head;
  if (head.startsWith("@keyframes")) return [`${head} {${item.body}}`];
  if (head.startsWith("@media")) {
    if (head.includes("prefers-color-scheme: dark")) {
      // studio dark → resolved-mode dark
      return parseRules(item.body).flatMap((sub) => (sub.isAt ? [] : styleRule(sub, skin, true)));
    }
    if (head.includes("prefers-reduced-motion")) {
      const inner = parseRules(item.body).flatMap((sub) => (sub.isAt ? [] : styleRule(sub, skin)));
      if (!inner.length) return [];
      return [`${head} {`, ...inner, `}`];
    }
    return [];
  }
  return [];
}

/* ── driver ───────────────────────────────────────────────────────────────── */

for (const skin of SKINS) {
  const src = readFileSync(join(DESIGN, `skin-${skin}.css`), "utf8");
  const chunks = [
    `/* GENERATED by apps/desktop/scripts/port-skins.mjs from design/skins/skin-${skin}.css — do not edit.
 * Skin system phase 2a: the approved "${skin}" skin translated onto the real
 * app DOM. See the script header for the full rule table. */
`,
  ];
  for (const item of parseRules(src)) {
    for (const line of processItem(item, skin)) chunks.push(line);
  }
  const out = chunks.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
  writeFileSync(join(DESKTOP, "app", "skins", `skin-${skin}.css`), out);
  console.log(`skin-${skin}.css → ${out.split("\n").length} lines`);
}

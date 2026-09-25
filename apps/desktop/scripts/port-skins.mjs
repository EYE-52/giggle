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
 *   .s-friends                                → .gg-screen-friends (Friends page root)
 *   .s-lobby                                  → .gg-screen-lobby (Lobby page root)
 *   .s-call / .screen.s-call                  → .gg-screen-call (2c: Call screen root —
 *                                              the encounter shell; it is NOT a
 *                                              .gg-screen, which is a padded,
 *                                              scrollable column)
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
 * DOM are dropped. Rules mixing live and future selectors keep only the live
 * ones.
 *
 * Phase 3 — LIVE PREVIEW SCOPE. Profile → Appearance renders each skin's
 * real markup inside a [data-skin-preview="X"] container. Every rule whose
 * final compound is a preview-able hook (button/card/avatar/chip primitives
 * — PREVIEW_HOOKS below) is additionally emitted scoped to that container:
 *   html[data-skin="X"] REST                  → html[data-skin] [data-skin-preview="X"][data-skin-preview="X"] REST
 *   html[data-skin="X"][data-mode="dark"] R   → html[data-skin][data-mode="dark"] [data-skin-preview="X"][data-skin-preview="X"] R
 * The doubled [data-skin-preview] compound keeps the alias (0,4,1) above
 * every real skin rule (max (0,4,1), and that one shape — soft's dark
 * desktop .friend — never appears in a preview), so inside the container the
 * preview scope always wins over the ACTIVE skin's own rules; the dark alias
 * (0,5,1) beats the light alias, so previews follow the resolved mode.
 * @media device wraps stay around the alias. Root custom-property blocks
 * also alias onto the container itself (so --sp, --r and --ink tokens resolve inside
 * the preview); body/shell/call-screen selectors never exist inside a
 * preview and are not aliased. The palette vars (--brand/--bg/…) are NOT
 * aliased: previews inherit them from html[data-palette], so a preview
 * always shows the chosen palette in the previewed skin's material.
 *
 * Phase 2c — VIDEO GEOMETRY GUARD. The call stage's tile boxes come from
 * packages/core arrangeVideoCall + the app's own stage CSS; skins may only
 * restyle paint. translateBody() therefore drops, per selector tier:
 *   TIER STRICT (.vstage/.vgroups/.vgroup/.vfeeds/.vtile and compounds like
 *     .vtile.speaking): every size/place property (width, height, min- and
 *     max-width/height, left/right/top/bottom, inset, position, transform,
 *     margin-*, padding-*, flex-*, display, aspect-ratio, gap-*, order,
 *     align-*, justify-*) and border widths (a border would eat into the
 *     tile's fixed box and shrink the video). Background, radius ≤18px,
 *     box-shadow/outline, ::before/::after frames, animations, fonts and
 *     colors pass through.
 *   TIER CHROME (.gg-screen-call/.call-top/.call-title/.call-bar): the same
 *     drops plus line-height/white-space/overflow-wrap/word-break — these
 *     elements size the stage's height, and per-skin fonts must never change
 *     it (the app pins the chrome text metrics in revamp.css instead).
 *   Everything else (.pill/.timer/.cbtn/.vname/.vlabel/.av/.ic/…) passes
 *     freely: those live inside rows whose heights are already pinned
 *     (inline styles, the toolbar lock, or the tile box itself).
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DESKTOP = join(HERE, "..");
const DESIGN = join(DESKTOP, "..", "..", "design", "skins");

const SKINS = ["soft", "play", "paper", "clay", "scrap"];

/* Mock classes that exist in the real DOM after phase 2b (plus the mapped app
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
  "muted",
  // home
  "create", "join-card", "join", "seat", "seat-row", "filled", "empty",
  "page-head", "eyebrow", "title", "lede",
  "tip", "tip-mark", "tip-body", "tip-title", "tip-shuffle", "tip-ideas",
  "tip-idea", "is-shuffled", "tip-cta",
  // friends (2b)
  "search", "friend-list", "friend", "request", "pair",
  // lobby (2b)
  "lobby-head", "lobby-grid", "lobby-stage", "lobby-controls",
  "preview", "self", "invite", "cam-off", "preview-meta",
  "squad-panel", "panel-head", "count", "code-box", "code-val", "meta-row",
  // call (2c)
  "call-top", "call-title", "timer", "pill", "live", "dot",
  "vstage", "vgroups", "vgroup", "vlabel", "vfeeds",
  "vtile", "speaking", "off", "cam", "vname",
  "call-bar", "cbtn", "leave",
  // overlays
  "modal", "modal-head", "modal-foot", "toast",
  // mapped app hooks (may appear in translated selectors)
  "gg-app-root", "gg-screen", "gg-screen-home", "gg-home-grid",
  "gg-screen-friends", "gg-screen-lobby", "gg-screen-call",
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
  s = s.replace(/\.screen\.s-call\b/g, ".gg-screen-call");
  s = s.replace(/\.s-call\b/g, ".gg-screen-call");
  s = s.replace(/\.s-home\b/g, ".gg-screen-home");
  s = s.replace(/\.s-friends\b/g, ".gg-screen-friends");
  s = s.replace(/\.s-lobby\b/g, ".gg-screen-lobby");
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
  // Device-scoped rules (now media queries) repeat the skin attribute once:
  // in the studio `.device.desktop` / `.device.phone` added two classes of
  // specificity over the same skin's unscoped base rules (soft writes its
  // base `.friend-list` AFTER the desktop grid rule, so a plain media wrap
  // would let the base rule win the tie and stack the cards).
  let rootSel = dark ? `html[data-skin="${skin}"][data-mode="dark"]` : `html[data-skin="${skin}"]`;
  if (media) rootSel += `[data-skin="${skin}"]`;
  s = s.replaceAll(ROOT_DARK, rootSel).replaceAll(ROOT, rootSel);
  s = s.replace(/@SWON@/g, ".gg-switch[aria-checked=\"true\"]").replace(/@SWFOC@/g, ".gg-switch:focus-visible");

  // scope filter — every class in the translated selector must be live
  for (const cls of classesOf(s)) {
    if (!LIVE_CLASSES.has(cls)) return null;
  }

  s = s.replace(/\s{2,}/g, " ").replace(/\s*>\s*/g, " > ").trim();
  return s ? { selector: s, media } : null;
}

/* ── Phase 3: preview scope ──────────────────────────────────────────────────
 * Final-compound classes a preview sample can carry. Anything else (shell,
 * screen roots, home/friends/lobby/call-specific hooks) cannot appear inside
 * a [data-skin-preview] container, so those rules are not aliased. */
const PREVIEW_HOOKS = new Set([
  // primitives that a mini-preview renders for real
  "btn", "btn-primary", "btn-secondary", "btn-ghost", "btn-tonal", "btn-danger",
  "small", "wide", "card", "card-title", "card-foot", "hint", "fine", "link",
  "kicker", "muted", "eyebrow", "title", "lede", "page-head",
  "input", "code", "chip", "is-on", "badge",
  "pa", "av", "presence", "on",
  "modal", "modal-head", "icon-btn", "ic",
  "seat", "seat-row", "filled", "empty",
]);

function lastCompoundOf(selector) {
  return selector.trim().split(/[\s>+~]+/).pop() ?? "";
}

/**
 * Phase 3: the [data-skin-preview="X"] alias for one translated selector.
 * Returns the alias selector string, or null when the rule cannot apply
 * inside a preview (body/shell/call roots) or its target hook is not
 * preview-able.
 */
function previewAlias(selector, skin) {
  const light = `html[data-skin="${skin}"]`;
  const doubled = `html[data-skin="${skin}"][data-skin="${skin}"]`;
  const dark = `html[data-skin="${skin}"][data-mode="dark"]`;
  const darkDoubled = `html[data-skin="${skin}"][data-mode="dark"][data-skin="${skin}"]`;
  // Root custom-property block: alias onto the container itself so the
  // skin's spacing/radius/ink tokens resolve inside the preview.
  if (selector === light) return `[data-skin-preview="${skin}"]`;

  let rest = null;
  let isDark = false;
  for (const [prefix, dark_] of [[darkDoubled, true], [dark, true], [doubled, false], [light, false]]) {
    if (selector.startsWith(prefix + " ")) {
      rest = selector.slice(prefix.length + 1);
      isDark = dark_;
      break;
    }
  }
  if (rest == null) return null; // view-transition / other roots — never in a preview

  if (/^body(::[a-z-]+)?$/.test(rest)) return null; // the page body is not preview-able
  const compound = lastCompoundOf(rest).replace(/:[A-Za-z-]+(\([^)]*\))?/g, "");
  const hooks = classesOf(compound);
  if (![...hooks].every((cls) => PREVIEW_HOOKS.has(cls))) return null;

  const scope = `[data-skin-preview="${skin}"][data-skin-preview="${skin}"]`;
  return (isDark ? `html[data-skin][data-mode="dark"] ` : `html[data-skin] `) + scope + " " + rest;
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
const DISPLAY_FACES = ["Fraunces", "Bricolage Grotesque", "Baloo 2", "Fredoka", "Caveat Brush"];
const BODY_FACES = ["Karla", "Plus Jakarta Sans", "Nunito", "Kalam", "Caveat"];

function translateFontFamily(v) {
  if (DISPLAY_FACES.some((f) => v.includes(f))) return "var(--font-display)";
  if (BODY_FACES.some((f) => v.includes(f))) return "var(--font-body)";
  return translateValue(v);
}

/** Does this translated selector target exactly the app/body/screen roots? */
function rootKind(selector) {
  const t = selector.trim();
  if (/(^|\s)body$/.test(t) || /body::(before|after)$/.test(t)) return "body";
  if (/\.gg-screen$/.test(t) || /\.gg-screen-(home|friends|lobby)$/.test(t)) return "screen";
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

/* ── Phase 2c: video geometry guard ──────────────────────────────────────────
 * Which selector tier a translated selector falls into, per its LAST compound
 * (pseudo-classes stripped): the stage graph, or the chrome rows that size it. */
const STAGE_HOOKS = new Set(["vstage", "vgroups", "vgroup", "vfeeds", "vtile"]);
const CHROME_HOOKS = new Set(["gg-screen-call", "call-top", "call-title", "call-bar"]);

function geometryTier(selector) {
  const lastCompound = selector.trim().split(/[\s>+~]+/).pop() ?? "";
  const classes = classesOf(lastCompound.replace(/:[A-Za-z-]+(\([^)]*\))?/g, ""));
  for (const cls of classes) {
    if (STAGE_HOOKS.has(cls)) return "stage";
    if (CHROME_HOOKS.has(cls)) return "chrome";
  }
  return null;
}

/* Size/place properties skins may never set on the stage graph or the chrome
 * rows (see the script header). border* included: with the app's fixed boxes a
 * border would either shrink the video (tiles) or grow the row (chrome). */
const GEOMETRY_PROPS = new Set([
  "width", "height",
  "min-width", "min-height", "max-width", "max-height",
  "left", "right", "top", "bottom", "inset",
  "position", "transform", "aspect-ratio",
  "order", "display",
]);
const GEOMETRY_PROP_RE = /^(margin|padding|flex|gap|align|justify|row-gap|column-gap)-?/;
/* Border WIDTH changes the box (tiles shrink their video, chrome rows grow);
 * paint-only border properties (radius/color/style) stay allowed. */
const BORDER_GEOMETRY_RE = /^border$|^border-(top|right|bottom|left|block|inline|width)/;

function isGeometryProp(prop) {
  return GEOMETRY_PROPS.has(prop) || GEOMETRY_PROP_RE.test(prop) || BORDER_GEOMETRY_RE.test(prop);
}

/* Chrome rows additionally must not reflow text: their heights are pinned by
 * the app (revamp.css) so every skin's stage box stays identical. */
const CHROME_TEXT_RE = /^(line-height|white-space|overflow-wrap|word-break|vertical-align)$/;

function translateBody(body, selector) {
  const kind = placementKind(selector);
  const rootKindValue = rootKind(selector);
  const tier = geometryTier(selector);
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
    // phase 2c: the video stage + the rows that size it are geometry-frozen
    if (tier && isGeometryProp(p)) continue;
    if (tier === "chrome" && CHROME_TEXT_RE.test(p)) continue;
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

/** Split a selector list on TOP-LEVEL commas only — commas inside :is()/
 * :where()/:not() keep the list together (a naive split once emitted broken
 * `:is(.btn` fragments and stray global rules from Scrapbook's focus rule). */
function splitSelectorList(head) {
  const parts = [];
  let depth = 0;
  let current = "";
  for (const ch of head) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      parts.push(current);
      current = "";
    } else current += ch;
  }
  parts.push(current);
  return parts.map((p) => p.trim()).filter(Boolean);
}

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

/** Phase 3: a selector's pairs plus its [data-skin-preview] alias pairs. */
function pairsWithAliases(pairs, item, skin) {
  const out = [];
  for (const { selector, decls } of pairs) {
    out.push({ selector, decls });
    const alias = previewAlias(selector, skin);
    if (alias) out.push({ selector: alias, decls: translateBody(item.body, alias) });
  }
  return out;
}

/** Translate one style rule; returns lines. */
function styleRule(item, skin, forceDark = false) {
  const buckets = { min: [], max: [], none: [] };
  for (const part of splitSelectorList(item.head)) {
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
    // Phase 3: the same tokens on the preview container (custom props only —
    // the container has no body/backdrop of its own).
    if (htmlDecls.length) lines.push(`[data-skin-preview="${skin}"] {`, ...htmlDecls.map((d) => `  ${d};`), `}`);
    return lines;
  }

  const lines = formatPairs(pairsWithAliases(buckets.none.map((sel) => ({ selector: sel, decls: translateBody(item.body, sel) })), item, skin));
  for (const [key, query] of [["min", "@media (min-width: 721px)"], ["max", "@media (max-width: 720px)"]]) {
    if (!buckets[key].length) continue;
    const inner = formatPairs(pairsWithAliases(buckets[key].map((sel) => ({ selector: sel, decls: translateBody(item.body, sel) })), item, skin));
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
 * Skin system phase 3: the approved "${skin}" skin translated onto the real
 * app DOM, plus [data-skin-preview="${skin}"] aliases so Profile → Appearance
 * can render live samples in this skin. See the script header for the full
 * rule table. */
`,
  ];
  for (const item of parseRules(src)) {
    for (const line of processItem(item, skin)) chunks.push(line);
  }
  const out = chunks.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
  writeFileSync(join(DESKTOP, "app", "skins", `skin-${skin}.css`), out);
  console.log(`skin-${skin}.css → ${out.split("\n").length} lines`);
}

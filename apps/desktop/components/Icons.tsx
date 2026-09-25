"use client";
import { useLook, SKINS } from "@/lib/look";
import { PHOSPHOR_PATHS, PHOSPHOR_WEIGHTS, type PhosphorWeight } from "@/components/phosphorPaths";

/**
 * App icons, now rendered from Phosphor (MIT, @phosphor-icons/core 2.1.1)
 * path data vendored in components/phosphorPaths.ts.
 *
 * The API is unchanged from the hand-drawn version: every Icon.<name> takes
 * { size, color, strokeWidth, fill }. strokeWidth is accepted but ignored
 * (Phosphor weights are fill-based, not stroke-based). `color` feeds
 * currentColor; `fill` overrides the path fill. `weight` optionally overrides
 * the icon weight — by default the weight follows the current skin
 * (e.g. bold for Soft/Play/Doodle/Scrapbook, fill for Clay) via useLook().
 *
 * Name → Phosphor mapping is recorded in PHOSPHOR_NAMES (see the phase-1
 * report for the table). All icons are aria-hidden as before.
 */

type P = {
  size?: number;
  color?: string;
  /** Accepted for API compat; ignored — Phosphor icons are fill-based. */
  strokeWidth?: number;
  fill?: string;
  /** Override the skin's icon weight (thin|light|regular|bold|fill|duotone). */
  weight?: PhosphorWeight;
};

function makeIcon(name: string, defaults: Partial<P> = {}) {
  function PhosphorIcon({ size, color, strokeWidth: _ignored, fill, weight }: P) {
    const look = useLook();
    const skinWeight = SKINS.find((s) => s.id === look.skin)?.iconWeight ?? "regular";
    const w: PhosphorWeight = weight && PHOSPHOR_WEIGHTS.includes(weight) ? weight : skinWeight;
    const entry = PHOSPHOR_PATHS[name];
    const paths = (entry && (entry[w] ?? entry.regular)) ?? [];
    return (
      <svg
        className="ic"
        data-i={name}
        width={size ?? defaults.size ?? 22}
        height={size ?? defaults.size ?? 22}
        viewBox="0 0 256 256"
        fill={fill ?? defaults.fill ?? "currentColor"}
        aria-hidden
        style={{ display: "block", color: color ?? defaults.color }}
      >
        {paths.map((p, i) => (
          <path key={i} d={p.d} opacity={p.opacity} />
        ))}
      </svg>
    );
  }
  return PhosphorIcon;
}

export const Icon = {
  hangup: makeIcon("hangup"),
  home: makeIcon("home"),
  discover: makeIcon("discover"),
  profile: makeIcon("profile"),
  settings: makeIcon("settings"),
  edit: makeIcon("edit"),
  google: makeIcon("google", { size: 18 }),
  apple: makeIcon("apple", { size: 18 }),
  star: makeIcon("star", { color: "var(--accent)", fill: "var(--accent-soft)" }),
  lightning: makeIcon("lightning", { fill: "var(--accent)" }),
  hd: makeIcon("hd"),
  history: makeIcon("history"),
  shield: makeIcon("shield"),
  bell: makeIcon("bell"),
  account: makeIcon("account"),
  mic: makeIcon("mic"),
  cam: makeIcon("cam"),
  chat: makeIcon("chat"),
  flag: makeIcon("flag", { color: "var(--coral)" }),
  more: makeIcon("more"),
  plus: makeIcon("plus"),
  minus: makeIcon("minus"),
  enter: makeIcon("enter"),
  close: makeIcon("close"),
  chevron: makeIcon("chevron"),
  pin: makeIcon("pin", { color: "var(--live)" }),
  trend: makeIcon("trend", { color: "var(--live)" }),
  gift: makeIcon("gift"),
  link: makeIcon("link"),
  copy: makeIcon("copy"),
  share: makeIcon("share"),
  send: makeIcon("send"),
  users: makeIcon("users"),
  /* Skin-phase additions (Home tip card + mock icon hooks). `arrowRight`
   * keeps the mock's data-i="arrow-right" hover nudge working. */
  arrowRight: makeIcon("arrow-right"),
  shuffle: makeIcon("shuffle"),
  sparkle: makeIcon("sparkle"),
  music: makeIcon("music"),
  book: makeIcon("book"),
  wink: makeIcon("wink"),
  popcorn: makeIcon("popcorn"),
  dice: makeIcon("dice"),
  bulb: makeIcon("bulb"),
  wave: makeIcon("wave"),
  confetti: makeIcon("confetti"),
};

export type IconName = keyof typeof Icon;

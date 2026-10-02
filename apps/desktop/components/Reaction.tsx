"use client";

import { Icon } from "@/components/Icons";

/**
 * Call reactions. The wire still carries the emoji code points the server and
 * the mobile app already accept, but the interface draws them as the active
 * skin's icons, so nothing on screen is an emoji.
 */
export const REACTIONS = [
  { value: "\u{1F44B}", label: "Wave", Glyph: Icon.wave },
  { value: "\u{1F525}", label: "Fire", Glyph: Icon.fire },
  { value: "\u{1F602}", label: "Laugh", Glyph: Icon.laugh },
  { value: "\u{2764}\u{FE0F}", label: "Love", Glyph: Icon.heart },
  { value: "\u{1F44F}", label: "Clap", Glyph: Icon.clap },
] as const;

const byValue = new Map<string, (typeof REACTIONS)[number]>(REACTIONS.map(r => [r.value, r]));
// tolerate the heart without its variation selector (older clients)
byValue.set("\u{2764}", REACTIONS[3]);

export function reactionLabel(value: string): string {
  return byValue.get(value)?.label ?? "Reaction";
}

/** One reaction drawn in the skin's icon style; unknown values show a sparkle. */
export function ReactionGlyph({ value, size = 22 }: { value: string; size?: number }) {
  const Glyph = byValue.get(value)?.Glyph ?? Icon.sparkle;
  return <Glyph size={size} color="currentColor" />;
}

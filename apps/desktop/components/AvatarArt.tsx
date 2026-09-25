"use client";
import { GiggleAvatar } from "../../../packages/avatars/src";
import { parseCharacter, isCustomAvatar, legacyCharacterFor, seededCharacterFor, type CharacterConfig } from "@giggle/core";
import { OnlineWrap } from "./Avatar";

interface AvatarArtProps {
  value: string;
  /** Pixel size, or "fill" to size from the skinned container (e.g. seats). */
  size?: number | "fill";
  online?: boolean;
  style?: React.CSSProperties;
  className?: string;
}

/**
 * Renders a Giggle avatar:
 * - data: URL             → circular <img> (custom upload)
 * - giggle:v1:… character → GiggleAvatar with those settings
 * - legacy motif id       → the fixed character legacyCharacterFor maps it to
 * - anything else / empty → a character seeded from the value
 *
 * When `online` is true, the avatar gets a glowing lime presence ring + dot.
 * The sizing span carries the mock's `av` class so the ported skins can
 * restyle avatars in context (`.seat .av`, `.nav-end .av.me`, …).
 */
export function AvatarArt({ value, size = 40, online, style, className }: AvatarArtProps) {
  return (
    <OnlineWrap online={online}>
      <AvatarArtInner value={value} size={size} style={style} className={className} />
    </OnlineWrap>
  );
}

/**
 * Large avatars (profile hero, picker preview) animate their idle motion;
 * small avatars in lists and tiles stay static so grids never distract.
 */
export const AVATAR_ANIMATION_MIN_SIZE = 72;

function CharacterArt({ config, size, style, className }: { config: CharacterConfig; size: number | "fill"; style?: React.CSSProperties; className?: string }) {
  const fill = size === "fill";
  const px = fill ? 96 : size;
  const classes = ["av", className, fill ? "gg-av--fill" : ""].filter(Boolean).join(" ");
  return (
    <span
      className={classes}
      style={{ display: "inline-flex", ...(fill ? null : { width: size, height: size }), flexShrink: 0, ...style }}
    >
      <GiggleAvatar {...config} size={px} animated={config.animated && px >= AVATAR_ANIMATION_MIN_SIZE} label="Giggle character" />
    </span>
  );
}

function AvatarArtInner({ value, size, style, className }: { value: string; size: number | "fill"; style?: React.CSSProperties; className?: string }) {
  const character = parseCharacter(value) ?? legacyCharacterFor(value);
  if (character) return <CharacterArt config={character} size={size} style={style} className={className} />;
  if (isCustomAvatar(value)) {
    const fill = size === "fill";
    return (
      <img
        src={value}
        alt="My avatar"
        className={["av", className, fill ? "gg-av--fill" : ""].filter(Boolean).join(" ")}
        width={fill ? undefined : size}
        height={fill ? undefined : size}
        style={{
          objectFit: "cover",
          flexShrink: 0,
          display: "block",
          ...style,
        }}
      />
    );
  }
  return <CharacterArt config={seededCharacterFor(value || "giggle")} size={size} style={style} className={className} />;
}

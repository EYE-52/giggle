"use client";
import { GiggleAvatar } from "../../../packages/avatars/src";
import { parseCharacter, isCustomAvatar, legacyCharacterFor, seededCharacterFor, type CharacterConfig } from "@giggle/core";
import { OnlineWrap } from "./Avatar";

interface AvatarArtProps {
  value: string;
  size?: number;
  online?: boolean;
  style?: React.CSSProperties;
}

/**
 * Renders a Giggle avatar:
 * - data: URL             → circular <img> (custom upload)
 * - giggle:v1:… character → GiggleAvatar with those settings
 * - legacy motif id       → the fixed character legacyCharacterFor maps it to
 * - anything else / empty → a character seeded from the value
 *
 * When `online` is true, the avatar gets a glowing lime presence ring + dot.
 */
export function AvatarArt({ value, size = 40, online, style }: AvatarArtProps) {
  return (
    <OnlineWrap size={size} online={online}>
      <AvatarArtInner value={value} size={size} style={style} />
    </OnlineWrap>
  );
}

/**
 * Large avatars (profile hero, picker preview) animate their idle motion;
 * small avatars in lists and tiles stay static so grids never distract.
 */
export const AVATAR_ANIMATION_MIN_SIZE = 72;

function CharacterArt({ config, size, style }: { config: CharacterConfig; size: number; style?: React.CSSProperties }) {
  return (
    <span style={{ display: "inline-flex", width: size, height: size, flexShrink: 0, ...style }}>
      <GiggleAvatar {...config} size={size} animated={config.animated && size >= AVATAR_ANIMATION_MIN_SIZE} label="Giggle character" />
    </span>
  );
}

function AvatarArtInner({ value, size = 40, style }: AvatarArtProps) {
  const character = parseCharacter(value) ?? legacyCharacterFor(value);
  if (character) return <CharacterArt config={character} size={size} style={style} />;
  if (isCustomAvatar(value)) {
    return (
      <img
        src={value}
        alt="My avatar"
        width={size}
        height={size}
        style={{
          width: size,
          height: size,
          borderRadius: "50%",
          objectFit: "cover",
          flexShrink: 0,
          display: "block",
          ...style,
        }}
      />
    );
  }
  return <CharacterArt config={seededCharacterFor(value || "giggle")} size={size} style={style} />;
}

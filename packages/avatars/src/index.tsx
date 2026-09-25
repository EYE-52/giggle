"use client";

import { useId, type CSSProperties } from "react";
import { logoPaths, logoViewBox } from "../../ui-tokens/src/logo";

export type AvatarHair = "crop" | "curls" | "bob" | "swoop" | "buzz" | "bald" | "long" | "bun";
export type AvatarExpression = "smile" | "laugh" | "wink" | "surprised";
export type AvatarFace = "soft" | "round" | "angular";
export type AvatarGlasses = "none" | "round" | "square";
export type AvatarFacialHair = "none" | "stubble" | "beard" | "mustache";
export type AvatarClothing = "tee" | "hoodie" | "sweater" | "jacket" | "collared";
export type AvatarHeadwear = "none" | "beanie" | "cap";
export type AvatarEarrings = "none" | "studs" | "hoops";
export type GiggleAvatarProps = {
  clothing?: AvatarClothing;
  headwear?: AvatarHeadwear;
  earrings?: AvatarEarrings;
  accessoryColor?: string;
  face?: AvatarFace;
  glasses?: AvatarGlasses;
  facialHair?: AvatarFacialHair;
  /** Proportion controls use 0–100; values are clamped before rendering. */
  faceWidth?: number;
  eyeSize?: number;
  eyeSpacing?: number;
  browTilt?: number;
  noseSize?: number;
  mouthWidth?: number;
  freckles?: boolean;
  shirtColor?: string;
  hair?: AvatarHair;
  skin?: string;
  hairColor?: string;
  accent?: string;
  expression?: AvatarExpression;
  animated?: boolean;
  size?: number | string;
  /** An empty label makes this decorative. */
  label?: string;
  className?: string;
};

/** Giggle character drawn in SVG code. See ../README.md for artwork provenance. */
export function GiggleAvatar({
  hair = "curls", skin = "#c98763", hairColor = "#39302e", accent = "#d4ddbd",
  expression = "smile", animated = true, size = 240,
  label = "Illustrated Giggle character", className = "",
  clothing = "tee", headwear = "none", earrings = "none", accessoryColor = "#74618c",
  face = "soft", glasses = "none", facialHair = "none", freckles = false,
  faceWidth = 50, eyeSize = 50, eyeSpacing = 50, browTilt = 50,
  noseSize = 50, mouthWidth = 50, shirtColor = "#f9f0dc",
}: GiggleAvatarProps) {
  const id = useId();
  // Give each character its own rhythm so a row of them never sways or blinks in unison.
  // Derived from the SSR-stable useId, so server and client markup match.
  let seed = 0;
  for (const char of id) seed = (seed * 31 + char.charCodeAt(0)) >>> 0;
  const phase = (salt: number) => ((Math.imul(seed ^ salt, 2654435761) >>> 0) % 1000) / 1000;
  const motion = {
    "--gg-sway-duration": `${(4.6 + phase(1) * 1.4).toFixed(2)}s`,
    "--gg-sway-delay": `${(-phase(2) * 6).toFixed(2)}s`,
    "--gg-blink-duration": `${(3.8 + phase(3) * 2.4).toFixed(2)}s`,
    "--gg-blink-delay": `${(-phase(4) * 6).toFixed(2)}s`,
  } as CSSProperties;
  const ink = "#342923";
  const unit = (value: number) => Number.isFinite(value) ? Math.max(0, Math.min(100, value)) / 100 : .5;
  const width = .88 + unit(faceWidth) * .24;
  const eyes = .7 + unit(eyeSize) * .6;
  const spacing = .82 + unit(eyeSpacing) * .36;
  const tilt = (unit(browTilt) - .5) * 12;
  const nose = .7 + unit(noseSize) * .6;
  const mouth = .75 + unit(mouthWidth) * .5;
  const facePaths = {
    soft: "M65 94c0-34 22-57 55-57s55 23 55 57v30c0 33-23 53-55 53s-55-20-55-53Z",
    round: "M62 100c0-38 24-63 58-63s58 25 58 63v23c0 35-25 56-58 56s-58-21-58-56Z",
    angular: "M65 94c0-36 23-57 55-57s55 21 55 57v30c0 13-7 25-17 34-8 8-17 12-38 12s-30-4-38-12c-10-9-17-21-17-34Z",
  };
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240" width={size} height={size}
      className={`giggle-avatar ${className}`} data-animated={animated} style={animated ? motion : undefined}
      role={label ? "img" : undefined} aria-labelledby={label ? `${id}-title` : undefined} aria-hidden={label ? undefined : true}>
      {label && <title id={`${id}-title`}>{label}</title>}
      <style>{`
        .giggle-avatar { overflow: visible; }
        .giggle-avatar[data-animated="true"] .gg-avatar-head { animation: gg-avatar-sway var(--gg-sway-duration, 5s) ease-in-out var(--gg-sway-delay, 0s) infinite; transform-origin: 120px 170px; }
        .giggle-avatar[data-animated="true"] .gg-avatar-eyes { animation: gg-avatar-blink var(--gg-blink-duration, 4.4s) var(--gg-blink-delay, 0s) infinite; transform-origin: 120px 111px; }
        @keyframes gg-avatar-sway { 0%,100% { transform: rotate(-2.5deg) translateY(0); } 50% { transform: rotate(2.5deg) translateY(-4px); } }
        @keyframes gg-avatar-blink { 0%,41%,45%,47.5%,49%,100% { transform: scaleY(1); } 43%,48% { transform: scaleY(.08); } }
        @media (prefers-reduced-motion: reduce) { .giggle-avatar .gg-avatar-head, .giggle-avatar .gg-avatar-eyes { animation: none !important; } }
      `}</style>
      <defs><clipPath id={`${id}-circle`}><circle cx="120" cy="120" r="112" /></clipPath></defs>
      <circle cx="120" cy="120" r="112" fill={accent} />
      <g clipPath={`url(#${id}-circle)`}>
        {clothing === "hoodie" && <path d="M79 193c-25-38-14-57 41-57s66 19 41 57" fill={shirtColor} stroke={ink} strokeOpacity=".12" strokeWidth="3" />}
        <path d="M39 245c0-43 26-71 81-71s81 28 81 71" fill={shirtColor} />
        <path d="M40 229q8-26 39-37m121 37q-8-26-39-37" fill="none" stroke={ink} strokeOpacity=".09" strokeWidth="3" />
        {clothing !== "jacket" && clothing !== "collared" && <g fill="none"><path d="M91 178q29 54 58 0" stroke={ink} strokeOpacity=".12" strokeWidth="9" /><path d="M91 176q29 54 58 0" stroke="#fff" strokeOpacity=".5" strokeWidth="5" /></g>}
        {clothing === "sweater" && <g stroke={ink} strokeOpacity=".1" fill="none" strokeWidth="2"><path d="M45 224h150M42 231h156M42 238h156" /><path d="M91 180v10m7-6v10m7-6v9m7-5v7m8-6v7m8-8v7m7-10v9m7-13v10m7-15v10" /></g>}
        {clothing === "hoodie" && <g><path d="M94 182l-9 44m61-44 9 44" stroke="#fff" strokeOpacity=".65" strokeWidth="3" strokeLinecap="round" /><path d="M95 244v-11q25-11 50 0v11" fill="none" stroke={ink} strokeOpacity=".15" strokeWidth="2" /></g>}
        {clothing === "jacket" && <g><path d="M97 180l23 24 23-24-4 60h-38Z" fill={accessoryColor} /><path d="M94 178l-14 20 16 14-5 12 23 16-7-44m39-18 14 20-16 14 5 12-23 16 7-44" fill={shirtColor} stroke={ink} strokeOpacity=".17" strokeWidth="2" /><path d="M120 204v38" stroke={ink} strokeOpacity=".25" strokeWidth="2" /></g>}
        {clothing === "collared" && <g><path d="M96 176l24 19-15 17-19-23Zm48 0-24 19 15 17 19-23Z" fill={shirtColor} stroke={ink} strokeOpacity=".18" strokeWidth="2" /><path d="M120 196v45" stroke={ink} strokeOpacity=".15" strokeWidth="2" /><circle cx="124" cy="218" r="2" fill={ink} opacity=".5" /><circle cx="124" cy="233" r="2" fill={ink} opacity=".5" /></g>}
        <g className="gg-avatar-head">
          <g transform={`translate(120 0) scale(${width} 1) translate(-120 0)`}>
          {hair === "long" && <path d="M55 89c0-74 132-79 132 0l8 106q-22 14-43 0l-9-52H91l-9 52q-21 14-38 0Z" fill={hairColor} />}
          {hair === "bun" && headwear === "none" && <circle cx="137" cy="36" r="28" fill={hairColor} />}
          {hair === "bob" && <path d="M56 94c-5-80 132-90 132 0l8 80c-37 23-111 23-150 0Z" fill={hairColor} />}
          <path d="M105 157h30v30q-15 14-30 0Z" fill={skin} />
          <path d="M106 160h28v17c-10 4-20 1-28-5Z" fill={ink} opacity=".1" />
          <ellipse cx="66" cy="116" rx="13" ry="18" fill={skin} />
          <ellipse cx="174" cy="116" rx="13" ry="18" fill={skin} />
          <path d="M67 113q-6-6-6 5m112-5q6-6 6 5" fill="none" stroke={ink} strokeOpacity=".25" strokeWidth="3" strokeLinecap="round" />
          <path d={facePaths[face] ?? facePaths.soft} fill={skin} />
          <g visibility={headwear === "none" ? "visible" : "hidden"}>
          {hair === "buzz" && <path d="M65 96V82c0-31 24-48 55-48s55 17 55 48v14l-10-23q-45-22-90 0Z" fill={hairColor} opacity=".85" />}
          {hair === "crop" && <path d="M64 101V76c0-32 26-49 58-49 34 0 58 21 54 61l-6 16-8-32c-29 11-56 7-80-1l-11 32Z" fill={hairColor} />}
          {hair === "swoop" && <path d="M62 103c-13-42 9-74 52-76 34-18 73 15 65 67l-9 13-7-42c-19 27-48 28-75 23l-14 21-1-38Z" fill={hairColor} />}
          {hair === "bob" && <path d="M64 109V75c2-30 25-45 56-45s54 15 56 45v35l-13-41c-16 15-35 19-51 18l6-22c-11 18-25 28-39 29l-9 18Z" fill={hairColor} />}
          {hair === "curls" && <g fill={hairColor}>
            <path d="M61 104c-18-3-23-24-12-37-8-15 1-31 18-32 4-18 22-26 37-18 13-14 33-12 43 1 21-7 38 6 38 23 19 9 21 30 8 41 2 19-15 30-31 19l-6-21c-10 13-26 15-35 5-12 13-28 12-38 2l-12 20Z" />
            <path d="M61 57q1-16 17-17m10-9q14-11 27 0m17-5q14-4 21 8m14 14q15 4 12 17" fill="none" stroke="#fff" strokeOpacity=".1" strokeWidth="5" strokeLinecap="round" />
          </g>}
          {(hair === "long" || hair === "bun") && <path d="M64 112V81c0-35 23-53 56-53s57 22 57 55v29l-12-36c-19-2-37-13-43-23-9 23-28 33-46 33l-6 26Z" fill={hairColor} />}
          {(hair === "bob" || hair === "swoop") && <path d="M80 64q24-33 66-19" fill="none" stroke="#fff" strokeOpacity=".12" strokeWidth="6" strokeLinecap="round" />}
          </g>
          <g transform={`translate(120 0) scale(${spacing} 1) translate(-120 0)`}>
          <path d={`M84 ${97+tilt}q9-5 17 ${-1-tilt*2}m38 0q9-4 17 ${1+tilt*2}`} fill="none" stroke={hairColor} strokeWidth="4" strokeLinecap="round" />
          <g className="gg-avatar-eyes" fill={ink}>
            {expression === "laugh" ? <path d="M84 112q8-11 16 0m40 0q8-11 16 0" fill="none" stroke={ink} strokeWidth="4" strokeLinecap="round" /> : <>
              <g transform={`translate(93 111) scale(${eyes})`}>
                <ellipse rx="6" ry="8" fill={ink} /><ellipse cx="-1.5" cy="-2.5" rx="2.1" ry="2.7" fill="#fff8ed" />
              </g>
              {expression === "wink" ? <path d="M140 112q8-8 16 0" fill="none" stroke={ink} strokeWidth="4" strokeLinecap="round" /> : <g transform={`translate(148 111) scale(${eyes})`}><ellipse rx="6" ry="8" /><ellipse cx="-1.5" cy="-2.5" rx="2.1" ry="2.7" fill="#fff8ed" /></g>}
            </>}
          </g>
          </g>
          {glasses !== "none" && <g fill="none" stroke={ink} strokeWidth="3.5">
            <rect x="74" y="99" width="37" height="29" rx={glasses === "round" ? 14 : 6} />
            <rect x="130" y="99" width="37" height="29" rx={glasses === "round" ? 14 : 6} />
            <path d="M111 109q9-6 19 0M65 106l9 3m93 0 8-3" />
          </g>}
          <path transform={`translate(120 120) scale(${nose}) translate(-120 -120)`} d="M120 114q-1 8-5 11-1 5 7 4" fill="none" stroke={ink} strokeOpacity=".3" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          <ellipse cx="83" cy="133" rx="11" ry="5.5" fill="#d66a5f" opacity=".34" />
          <ellipse cx="156" cy="133" rx="11" ry="5.5" fill="#d66a5f" opacity=".34" />
          {freckles && <g fill="#794733" opacity=".55">{[76, 85, 94, 146, 155, 164].map((x, i) => <circle key={x} cx={x} cy={135 + i % 2 * 4} r="1.5" />)}</g>}
          {(facialHair === "beard" || facialHair === "stubble") && <path d="M68 130q8 10 20 9l10 18q22 13 44 0l10-18q12 1 20-9c-4 31-24 47-52 47s-48-16-52-47Z" fill={hairColor} opacity={facialHair === "stubble" ? .3 : 1} />}
          <g transform={`translate(120 145) scale(${mouth} 1) translate(-120 -145)`}>
          {expression === "surprised" ? <ellipse cx="120" cy="145" rx="9" ry="12" fill={ink} /> : expression === "laugh" ? <g>
            <path d="M100 139q20 7 40 0c-1 30-38 30-40 0" fill={ink} />
            <path d="M104 142q16 4 32 0l-3 7h-26Z" fill="#fff7e8" />
            <path d="M110 160q10-10 20 0-10 6-20 0" fill="#df887b" />
          </g> : <path d="M106 141q14 14 29-1" fill="none" stroke={ink} strokeWidth="3.5" strokeLinecap="round" />}
          </g>
          {earrings === "studs" && <g fill={accessoryColor} stroke="#fff4da" strokeWidth="1"><circle cx="61" cy="131" r="3.5" /><circle cx="179" cy="131" r="3.5" /></g>}
          {earrings === "hoops" && <g fill="none" stroke={accessoryColor} strokeWidth="3.5"><ellipse cx="61" cy="138" rx="6" ry="9" /><ellipse cx="179" cy="138" rx="6" ry="9" /></g>}
          {headwear === "beanie" && <g><path d="M59 84c-3-41 19-66 61-66s64 25 61 66" fill={accessoryColor} /><path d="M68 62q52-12 104 0" fill="none" stroke="#fff" strokeOpacity=".12" strokeWidth="3" /><path d="M61 69q59-12 118 0v24q-59-12-118 0Z" fill={accessoryColor} stroke={ink} strokeOpacity=".15" strokeWidth="2" /><path d="M75 75v12m12-14v12m12-15v12m12-15v13m12-14v13m12-12v13m12-12v13m12-10v12m12-10v12" stroke={ink} strokeOpacity=".12" strokeWidth="2" /></g>}
          {headwear === "cap" && <g><path d="M60 79c0-37 22-60 60-60s59 23 60 60Z" fill={accessoryColor} /><path d="M120 22v48" stroke={ink} strokeOpacity=".15" strokeWidth="2" /><path d="M61 76q59-17 118 0l22 13q-43 15-72-4-35-2-68 5Z" fill={accessoryColor} stroke={ink} strokeOpacity=".18" strokeWidth="2" /><path d="M112 46h16" stroke="#fff" strokeOpacity=".5" strokeWidth="4" strokeLinecap="round" /></g>}
          {facialHair === "mustache" && <path d="M120 136c-11-9-15 6-26 5 8 9 20 4 26-1 6 5 18 10 26 1-11 1-15-14-26-5Z" fill={hairColor} />}
          </g>
        </g>
        <svg x="157" y="201" width="20" height="19" viewBox={logoViewBox} fill="none" aria-hidden="true">
          {logoPaths.map(path => <path key={path} d={path} stroke={accent} strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />)}
        </svg>
      </g>
    </svg>
  );
}

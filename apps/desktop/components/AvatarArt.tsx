"use client";
import { isCustomAvatar, getDefaultAvatarById, DEFAULT_AVATARS, type AvatarStyle } from "@giggle/core";
import { OnlineWrap } from "./Avatar";

interface AvatarArtProps {
  value: string;
  size?: number;
  online?: boolean;
  style?: React.CSSProperties;
}

/**
 * Renders a Giggle avatar:
 * - data: URL  → circular <img> (custom upload)
 * - default id → playful SVG motif with gradient background
 * - unknown    → gradient circle with first letter fallback
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

function AvatarArtInner({ value, size = 40, style }: AvatarArtProps) {
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

  const avatar = getDefaultAvatarById(value);
  if (!avatar) {
    // Fallback: gradient circle with first letter of value
    const letter = value ? value[0].toUpperCase() : "?";
    return (
      <div
        style={{
          width: size,
          height: size,
          borderRadius: "50%",
          background: "linear-gradient(150deg, #9B7CFF, #5436C9)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
          fontWeight: 700,
          fontSize: size * 0.42,
          color: "#fff",
          flexShrink: 0,
          ...style,
        }}
      >
        {letter}
      </div>
    );
  }

  const [from, to] = avatar.colors;
  const mid = size / 2;
  const r = mid;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      style={{ flexShrink: 0, display: "block", borderRadius: "50%", ...style }}
      aria-label={avatar.name}
    >
      <defs>
        <radialGradient id={`g-${avatar.id}`} cx="40%" cy="35%" r="65%">
          <stop offset="0%" stopColor={from} />
          <stop offset="100%" stopColor={to} />
        </radialGradient>
        <clipPath id={`c-${avatar.id}`}>
          <circle cx={mid} cy={mid} r={r} />
        </clipPath>
      </defs>
      {/* Background circle */}
      <circle cx={mid} cy={mid} r={r} fill={`url(#g-${avatar.id})`} />
      {/* Motif */}
      <g clipPath={`url(#c-${avatar.id})`}>
        <AvatarMotif style={avatar.style} size={size} from={from} to={to} />
      </g>
    </svg>
  );
}

/** Renders a playful SVG motif centred in a size×size canvas */
function AvatarMotif({
  style,
  size,
  from,
  to,
}: {
  style: AvatarStyle;
  size: number;
  from: string;
  to: string;
}) {
  const s = size;
  const cx = s / 2;
  const cy = s / 2;
  // Helper — scale a coordinate from a 100-unit reference canvas to actual size
  const sc = (v: number) => (v / 100) * s;

  // We darken the fill slightly relative to the gradient stops for contrast
  const dark = "#0B0B0F";
  const light = "rgba(255,255,255,0.92)";

  switch (style) {
    // ── blob: friendly organic shape ──────────────────────────────────────
    case "blob": {
      const r = sc(28);
      return (
        <g>
          {/* inner lighter blob */}
          <ellipse cx={cx} cy={cy - sc(3)} rx={r * 0.72} ry={r * 0.78}
            fill="rgba(255,255,255,0.22)" />
          {/* eyes */}
          <circle cx={cx - sc(8)} cy={cy - sc(4)} r={sc(6)} fill={light} />
          <circle cx={cx + sc(8)} cy={cy - sc(4)} r={sc(6)} fill={light} />
          <circle cx={cx - sc(8)} cy={cy - sc(4)} r={sc(3)} fill={dark} />
          <circle cx={cx + sc(8)} cy={cy - sc(4)} r={sc(3)} fill={dark} />
          {/* highlight dots */}
          <circle cx={cx - sc(6.5)} cy={cy - sc(6)} r={sc(1.5)} fill={light} />
          <circle cx={cx + sc(9.5)} cy={cy - sc(6)} r={sc(1.5)} fill={light} />
          {/* smile */}
          <path
            d={`M ${cx - sc(10)} ${cy + sc(6)} Q ${cx} ${cy + sc(18)} ${cx + sc(10)} ${cy + sc(6)}`}
            stroke={light} strokeWidth={sc(3.5)} fill="none" strokeLinecap="round"
          />
          {/* cheek blushes */}
          <circle cx={cx - sc(17)} cy={cy + sc(6)} r={sc(6)} fill="rgba(255,120,120,0.35)" />
          <circle cx={cx + sc(17)} cy={cy + sc(6)} r={sc(6)} fill="rgba(255,120,120,0.35)" />
        </g>
      );
    }

    // ── bot: little robot face ─────────────────────────────────────────────
    case "bot": {
      const hw = sc(30); const hh = sc(26);
      const hx = cx - hw / 2; const hy = cy - hh / 2 + sc(5);
      return (
        <g>
          {/* antenna */}
          <line x1={cx} y1={hy - sc(12)} x2={cx} y2={hy} stroke={light} strokeWidth={sc(3)} strokeLinecap="round" />
          <circle cx={cx} cy={hy - sc(13)} r={sc(4)} fill={light} />
          {/* head box */}
          <rect x={hx} y={hy} width={hw} height={hh} rx={sc(7)} fill="rgba(255,255,255,0.2)" stroke={light} strokeWidth={sc(2.5)} />
          {/* eye rectangles */}
          <rect x={cx - sc(14)} y={hy + sc(7)} width={sc(10)} height={sc(8)} rx={sc(2)} fill={light} />
          <rect x={cx + sc(4)} y={hy + sc(7)} width={sc(10)} height={sc(8)} rx={sc(2)} fill={light} />
          {/* pupils */}
          <rect x={cx - sc(11)} y={hy + sc(9.5)} width={sc(4)} height={sc(3)} rx={sc(1)} fill={dark} />
          <rect x={cx + sc(7)} y={hy + sc(9.5)} width={sc(4)} height={sc(3)} rx={sc(1)} fill={dark} />
          {/* mouth line */}
          <rect x={cx - sc(8)} y={hy + sc(19)} width={sc(16)} height={sc(3)} rx={sc(1.5)} fill={light} />
        </g>
      );
    }

    // ── star: cute 5-pointed star ──────────────────────────────────────────
    case "star": {
      const pts: string[] = [];
      const outer = sc(34); const inner = sc(14);
      for (let i = 0; i < 10; i++) {
        const angle = (i * Math.PI) / 5 - Math.PI / 2;
        const r2 = i % 2 === 0 ? outer : inner;
        pts.push(`${cx + r2 * Math.cos(angle)},${cy + r2 * Math.sin(angle)}`);
      }
      return (
        <g>
          <polygon points={pts.join(" ")} fill={light} opacity={0.9} />
          {/* face */}
          <circle cx={cx - sc(9)} cy={cy - sc(4)} r={sc(4.5)} fill={dark} />
          <circle cx={cx + sc(9)} cy={cy - sc(4)} r={sc(4.5)} fill={dark} />
          <circle cx={cx - sc(7.5)} cy={cy - sc(6)} r={sc(1.5)} fill={light} />
          <circle cx={cx + sc(10.5)} cy={cy - sc(6)} r={sc(1.5)} fill={light} />
          <path d={`M ${cx - sc(8)} ${cy + sc(5)} Q ${cx} ${cy + sc(14)} ${cx + sc(8)} ${cy + sc(5)}`}
            stroke={dark} strokeWidth={sc(3)} fill="none" strokeLinecap="round" />
        </g>
      );
    }

    // ── ghost: classic friendly ghost ─────────────────────────────────────
    case "ghost": {
      const gw = sc(44); const gh = sc(50);
      const gx = cx - gw / 2; const gy = cy - gh / 2 + sc(4);
      const wavy = `M ${gx},${gy + gh}
        q ${sc(7)},-${sc(12)} ${sc(14)},0
        q ${sc(7)},${sc(12)} ${sc(14)},0
        q ${sc(7)},-${sc(12)} ${sc(14)},0
        L ${gx + gw},${gy + sc(26)}
        Q ${cx},${gy - sc(10)} ${gx},${gy + sc(26)}
        Z`;
      return (
        <g>
          <path d={wavy} fill={light} opacity={0.92} />
          {/* eyes */}
          <ellipse cx={cx - sc(10)} cy={gy + sc(18)} rx={sc(7)} ry={sc(8)} fill={dark} />
          <ellipse cx={cx + sc(10)} cy={gy + sc(18)} rx={sc(7)} ry={sc(8)} fill={dark} />
          {/* eye shines */}
          <circle cx={cx - sc(8)} cy={gy + sc(15)} r={sc(2.5)} fill={light} />
          <circle cx={cx + sc(12)} cy={gy + sc(15)} r={sc(2.5)} fill={light} />
          {/* smile */}
          <path d={`M ${cx - sc(9)} ${gy + sc(32)} Q ${cx} ${gy + sc(40)} ${cx + sc(9)} ${gy + sc(32)}`}
            stroke={dark} strokeWidth={sc(3)} fill="none" strokeLinecap="round" />
        </g>
      );
    }

    // ── cat: cute cat face ─────────────────────────────────────────────────
    case "cat": {
      return (
        <g>
          {/* ears */}
          <polygon points={`${cx - sc(26)},${cy - sc(30)} ${cx - sc(10)},${cy - sc(8)} ${cx - sc(28)},${cy - sc(4)}`}
            fill={light} opacity={0.85} />
          <polygon points={`${cx + sc(26)},${cy - sc(30)} ${cx + sc(10)},${cy - sc(8)} ${cx + sc(28)},${cy - sc(4)}`}
            fill={light} opacity={0.85} />
          {/* inner ear */}
          <polygon points={`${cx - sc(22)},${cy - sc(26)} ${cx - sc(13)},${cy - sc(10)} ${cx - sc(24)},${cy - sc(6)}`}
            fill="rgba(255,160,180,0.5)" />
          <polygon points={`${cx + sc(22)},${cy - sc(26)} ${cx + sc(13)},${cy - sc(10)} ${cx + sc(24)},${cy - sc(6)}`}
            fill="rgba(255,160,180,0.5)" />
          {/* face circle */}
          <circle cx={cx} cy={cy + sc(4)} r={sc(28)} fill={light} opacity={0.88} />
          {/* eyes */}
          <ellipse cx={cx - sc(11)} cy={cy - sc(4)} rx={sc(7)} ry={sc(8.5)} fill={dark} />
          <ellipse cx={cx + sc(11)} cy={cy - sc(4)} rx={sc(7)} ry={sc(8.5)} fill={dark} />
          <circle cx={cx - sc(9)} cy={cy - sc(6)} r={sc(2)} fill={light} />
          <circle cx={cx + sc(13)} cy={cy - sc(6)} r={sc(2)} fill={light} />
          {/* nose */}
          <ellipse cx={cx} cy={cy + sc(6)} rx={sc(4)} ry={sc(3)} fill="rgba(255,120,160,0.8)" />
          {/* mouth */}
          <path d={`M ${cx} ${cy + sc(9)} L ${cx - sc(7)} ${cy + sc(15)}`}
            stroke={dark} strokeWidth={sc(2.5)} strokeLinecap="round" fill="none" />
          <path d={`M ${cx} ${cy + sc(9)} L ${cx + sc(7)} ${cy + sc(15)}`}
            stroke={dark} strokeWidth={sc(2.5)} strokeLinecap="round" fill="none" />
          {/* whiskers */}
          {[[-28, -sc(1)], [-22, sc(5)], [-15, sc(10)]].map(([dx, dy], i) => (
            <line key={i} x1={cx + sc(dx as number)} y1={cy + (dy as number)} x2={cx - sc(2)} y2={cy + sc(5)}
              stroke="rgba(11,11,15,0.35)" strokeWidth={sc(1.5)} strokeLinecap="round" />
          ))}
          {[[28, -sc(1)], [22, sc(5)], [15, sc(10)]].map(([dx, dy], i) => (
            <line key={i} x1={cx + sc(dx as number)} y1={cy + (dy as number)} x2={cx + sc(2)} y2={cy + sc(5)}
              stroke="rgba(11,11,15,0.35)" strokeWidth={sc(1.5)} strokeLinecap="round" />
          ))}
        </g>
      );
    }

    // ── bolt: lightning bolt ───────────────────────────────────────────────
    case "bolt": {
      const boltPts = [
        [cx + sc(10), cy - sc(36)],
        [cx - sc(6),  cy - sc(4)],
        [cx + sc(6),  cy - sc(4)],
        [cx - sc(10), cy + sc(36)],
        [cx + sc(4),  cy + sc(2)],
        [cx - sc(4),  cy + sc(2)],
      ].map(([x, y]) => `${x},${y}`).join(" ");
      return (
        <g>
          <polygon points={boltPts} fill={light} opacity={0.92} />
          <polygon points={boltPts}
            fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth={sc(2)} />
        </g>
      );
    }

    // ── moon: crescent moon with stars ────────────────────────────────────
    case "moon": {
      return (
        <g>
          {/* crescent via two overlapping circles */}
          <circle cx={cx - sc(3)} cy={cy + sc(2)} r={sc(28)} fill={light} opacity={0.9} />
          <circle cx={cx + sc(11)} cy={cy - sc(6)} r={sc(24)} fill={`url(#g-${DEFAULT_AVATARS[0].id})`} opacity={0.96} />
          {/* stars */}
          {[
            [cx + sc(22), cy - sc(22), sc(4)],
            [cx + sc(30), cy + sc(4), sc(2.5)],
            [cx + sc(18), cy + sc(20), sc(3)],
          ].map(([sx, sy, sr], i) => (
            <circle key={i} cx={sx} cy={sy} r={sr} fill={light} opacity={0.85} />
          ))}
        </g>
      );
    }

    // ── diamond: gem shape ────────────────────────────────────────────────
    case "diamond": {
      const tw = sc(52); const th = sc(56);
      const tx = cx - tw / 2; const ty = cy - th / 2 + sc(2);
      const topH = th * 0.35;
      return (
        <g>
          {/* top facets */}
          <polygon
            points={`${cx},${ty} ${tx + tw},${ty + topH} ${cx},${ty + topH} ${tx},${ty + topH}`}
            fill={light} opacity={0.9} />
          {/* bottom facets */}
          <polygon
            points={`${tx},${ty + topH} ${cx},${ty + topH} ${cx},${ty + th}`}
            fill={light} opacity={0.65} />
          <polygon
            points={`${cx},${ty + topH} ${tx + tw},${ty + topH} ${cx},${ty + th}`}
            fill={light} opacity={0.8} />
          {/* center highlight line */}
          <line x1={tx + tw * 0.25} y1={ty + topH * 0.4} x2={cx} y2={ty + topH}
            stroke="rgba(255,255,255,0.55)" strokeWidth={sc(2)} strokeLinecap="round" />
        </g>
      );
    }

    default:
      return null;
  }
}

"use client";
import { useRef } from "react";
import {
  SKINS,
  PALETTES,
  applyLook,
  useLook,
  type Look,
  type SkinId,
  type PaletteId,
  type Mode,
} from "@/lib/look";

/**
 * Profile → Appearance: choose skin, palette and light/dark/auto.
 * Radio-group semantics (roving tabindex, arrow keys, aria-checked) and
 * every choice applies instantly via applyLook (which also persists it).
 */

/* Preview face for each skin card (its display font, via the CSS variables
   next/font sets up in app/layout.tsx). */
const SKIN_PREVIEW_FONT: Record<SkinId, string> = {
  soft: "var(--font-bricolage), system-ui, sans-serif",
  play: "var(--font-baloo), system-ui, sans-serif",
  paper: "var(--font-caveat-brush), cursive",
  clay: "var(--font-fredoka), system-ui, sans-serif",
  scrap: "var(--font-nunito), system-ui, sans-serif",
};

const MODES: { value: Mode; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "auto", label: "Auto" },
];

interface RadioOption<T extends string> {
  value: T;
  label: string;
  content: React.ReactNode;
}

/**
 * Accessible radio group: role=radiogroup + role=radio children, roving
 * tabindex (checked item tabbable), arrows/Home/End move AND select, so the
 * look applies as the user arrows through choices.
 */
function RadioGroup<T extends string>({
  label,
  value,
  options,
  onSelect,
  layout,
}: {
  label: string;
  value: T;
  options: RadioOption<T>[];
  onSelect: (value: T) => void;
  layout: "grid" | "row" | "segment";
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  function select(index: number) {
    const option = options[index];
    if (option && option.value !== value) onSelect(option.value);
    refs.current[index]?.focus();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    const current = refs.current.findIndex((el) => el === document.activeElement);
    if (current < 0) return;
    const last = options.length - 1;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      select((current + 1) % options.length);
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      select((current - 1 + options.length) % options.length);
    } else if (e.key === "Home") {
      e.preventDefault();
      select(0);
    } else if (e.key === "End") {
      e.preventDefault();
      select(last);
    }
  }

  return (
    <div
      role="radiogroup"
      aria-label={label}
      onKeyDown={onKeyDown}
      style={
        layout === "grid"
          ? { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 8 }
          : layout === "row"
            ? { display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }
            : { display: "inline-flex", gap: 2, padding: 3, borderRadius: 999, background: "var(--overlay)", border: "1px solid var(--border)" }
      }
    >
      {options.map((option, i) => {
        const checked = option.value === value;
        return (
          <button
            key={option.value}
            ref={(el) => { refs.current[i] = el; }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            onClick={() => select(i)}
            className="gg-press gg-focusable"
            style={
              layout === "segment"
                ? {
                    minHeight: 36,
                    padding: "0 16px",
                    borderRadius: 999,
                    border: "none",
                    cursor: "pointer",
                    fontSize: 13,
                    fontWeight: 700,
                    background: checked ? "var(--surface)" : "transparent",
                    color: checked ? "var(--text)" : "var(--text-muted)",
                    boxShadow: checked ? "var(--shadow-sm)" : "none",
                  }
                : layout === "row"
                  ? {
                      display: "inline-flex",
                      flexDirection: "column",
                      alignItems: "center",
                      gap: 6,
                      minWidth: 44,
                      padding: "6px 8px 8px",
                      borderRadius: "var(--radius-control, 12px)",
                      border: `1.5px solid ${checked ? "var(--accent)" : "transparent"}`,
                      background: checked ? "var(--accent-soft)" : "transparent",
                      cursor: "pointer",
                      fontSize: 12,
                      fontWeight: 600,
                      color: checked ? "var(--text)" : "var(--text-muted)",
                    }
                  : {
                      display: "grid",
                      gap: 4,
                      textAlign: "left",
                      padding: "10px 12px",
                      borderRadius: "var(--radius-control, 12px)",
                      border: `1.5px solid ${checked ? "var(--accent)" : "var(--border)"}`,
                      background: checked ? "var(--accent-soft)" : "var(--surface)",
                      cursor: "pointer",
                    }
            }
          >
            {option.content}
          </button>
        );
      })}
    </div>
  );
}

export function AppearancePicker() {
  const look = useLook();

  function update(patch: Partial<Look>) {
    applyLook({ ...look, ...patch });
  }

  const skinOptions: RadioOption<SkinId>[] = SKINS.map((skin) => ({
    value: skin.id,
    label: skin.name,
    content: (
      <>
        <span aria-hidden style={{ fontFamily: SKIN_PREVIEW_FONT[skin.id], fontSize: 20, fontWeight: 700, lineHeight: 1, color: "var(--accent)" }}>
          Ag
        </span>
        <span style={{ fontFamily: "var(--font-display)", fontSize: 14, fontWeight: 700, color: "var(--text)" }}>{skin.name}</span>
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{skin.description}</span>
      </>
    ),
  }));

  const paletteOptions: RadioOption<PaletteId>[] = PALETTES.map((palette) => ({
    value: palette.id,
    label: palette.label,
    content: (
      <>
        <span
          aria-hidden
          style={{
            width: 22,
            height: 22,
            borderRadius: "50%",
            background: `linear-gradient(135deg, ${palette.brandLight} 50%, ${palette.brandDark} 50%)`,
            boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.08)",
          }}
        />
        <span>{palette.label}</span>
      </>
    ),
  }));

  const modeOptions: RadioOption<Mode>[] = MODES.map((mode) => ({
    value: mode.value,
    label: mode.label,
    content: <span>{mode.label}</span>,
  }));

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "grid", gap: 8 }}>
        <div style={{ color: "var(--text)", fontSize: 13, fontWeight: 600 }}>Skin</div>
        <RadioGroup label="Skin" value={look.skin} options={skinOptions} onSelect={(skin) => update({ skin })} layout="grid" />
      </div>
      <div style={{ display: "grid", gap: 8 }}>
        <div style={{ color: "var(--text)", fontSize: 13, fontWeight: 600 }}>Color</div>
        <RadioGroup label="Color" value={look.palette} options={paletteOptions} onSelect={(palette) => update({ palette })} layout="row" />
      </div>
      <div style={{ display: "grid", gap: 8 }}>
        <div style={{ color: "var(--text)", fontSize: 13, fontWeight: 600 }}>Mode</div>
        <RadioGroup label="Mode" value={look.mode} options={modeOptions} onSelect={(mode) => update({ mode })} layout="segment" />
      </div>
    </div>
  );
}

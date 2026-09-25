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
import { PersonAvatar } from "./PersonAvatar";

/**
 * Profile → Appearance: choose skin, palette and light/dark/auto.
 * Radio-group semantics (roving tabindex, arrow keys, aria-checked) and
 * every choice applies instantly via applyLook (which also persists it).
 *
 * Phase 3 — LIVE MINI-PREVIEWS: each skin card renders a real sample (an
 * avatar in a card with a primary button) inside a
 * `[data-skin-preview="<skin>"]` container. The ported skin CSS
 * (apps/desktop/app/skins/skin-*.css) applies every skin rule under that
 * scope, so the sample shows the skin's true material, typography, colors
 * and buttons — in the current palette and light/dark mode — instead of an
 * "Ag" glyph. Swatches are ≥32px with names; the selected skin card, swatch
 * and mode segment all carry a 2.5px high-contrast ring.
 */

const MODES: { value: Mode; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "auto", label: "Auto" },
];

/** The selected ring every picker level shares (≥2px, high contrast). */
const SELECTED_RING = "0 0 0 2px var(--surface), 0 0 0 4.5px var(--brand)";

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
  layout: "skin" | "palette" | "segment";
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
        layout === "skin"
          ? { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(184px, 1fr))", gap: 10 }
          : layout === "palette"
            ? { display: "flex", flexWrap: "wrap", gap: 8 }
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
              layout === "skin"
                ? {
                    display: "grid",
                    gap: 8,
                    textAlign: "left",
                    padding: 10,
                    borderRadius: "var(--radius-control, 14px)",
                    border: `1.5px solid ${checked ? "var(--brand)" : "var(--border-strong)"}`,
                    background: "var(--surface)",
                    cursor: "pointer",
                    boxShadow: checked ? SELECTED_RING : "none",
                  }
                : layout === "palette"
                  ? {
                      display: "inline-flex",
                      flexDirection: "column",
                      alignItems: "center",
                      gap: 6,
                      minWidth: 62,
                      padding: "8px 8px 9px",
                      borderRadius: "var(--radius-control, 14px)",
                      border: `1.5px solid ${checked ? "var(--brand)" : "transparent"}`,
                      background: checked ? "var(--brand-tint)" : "transparent",
                      cursor: "pointer",
                      fontSize: 13,
                      fontWeight: 600,
                      color: checked ? "var(--text)" : "var(--text-body)",
                      boxShadow: checked ? "0 0 0 2px var(--brand-tint), 0 0 0 4px var(--brand)" : "none",
                    }
                  : {
                      minHeight: 44,
                      padding: "0 18px",
                      borderRadius: 999,
                      border: "none",
                      cursor: "pointer",
                      fontSize: 14,
                      fontWeight: 700,
                      background: checked ? "var(--surface)" : "transparent",
                      color: checked ? "var(--text)" : "var(--text-body)",
                      boxShadow: checked ? "var(--shadow-sm), inset 0 0 0 2px var(--brand)" : "none",
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

/**
 * One skin's live sample: a real avatar, card and primary button rendered
 * inside the preview scope. aria-hidden — the card's name/description (the
 * radio's real label) already describe the choice.
 */
function SkinSample({ skinId, name }: { skinId: SkinId; name: string }) {
  return (
    <div
      data-skin-preview={skinId}
      aria-hidden="true"
      style={{ display: "block", pointerEvents: "none", minWidth: 0 }}
    >
      <div className="card" style={{ display: "grid", gap: 8, padding: 12, margin: 0 }}>
        <PersonAvatar userId={`skin-sample-${skinId}`} name={name} size={30} wrapClassName="pa" />
        <span
          className="card-title"
          style={{ fontSize: 14.5, lineHeight: 1.2, width: "fit-content", maxWidth: "100%" }}
        >
          Friday crew
        </span>
        <span className="hint" style={{ fontSize: 13 }}>2 of 4 ready</span>
        <span className="gg-btn btn btn-primary" style={{ minHeight: 38, fontSize: 13 }}>
          Join
        </span>
      </div>
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
        <SkinSample skinId={skin.id} name={skin.name} />
        <span style={{ fontFamily: "var(--font-display)", fontSize: 14.5, fontWeight: 700, color: "var(--text)" }}>{skin.name}</span>
        <span style={{ fontSize: 13, lineHeight: 1.4, color: "var(--text-muted)" }}>{skin.description}</span>
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
            width: 34,
            height: 34,
            borderRadius: "50%",
            background: `linear-gradient(135deg, ${palette.brandLight} 50%, ${palette.brandDark} 50%)`,
            boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.12)",
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
    <div style={{ display: "grid", gap: 18 }}>
      <div style={{ display: "grid", gap: 8 }}>
        <div style={{ color: "var(--text)", fontSize: 13, fontWeight: 600 }}>Skin</div>
        <RadioGroup label="Skin" value={look.skin} options={skinOptions} onSelect={(skin) => update({ skin })} layout="skin" />
      </div>
      <div style={{ display: "grid", gap: 8 }}>
        <div style={{ color: "var(--text)", fontSize: 13, fontWeight: 600 }}>Color</div>
        <RadioGroup label="Color" value={look.palette} options={paletteOptions} onSelect={(palette) => update({ palette })} layout="palette" />
      </div>
      <div style={{ display: "grid", gap: 8 }}>
        <div style={{ color: "var(--text)", fontSize: 13, fontWeight: 600 }}>Mode</div>
        <RadioGroup label="Mode" value={look.mode} options={modeOptions} onSelect={(mode) => update({ mode })} layout="segment" />
      </div>
    </div>
  );
}

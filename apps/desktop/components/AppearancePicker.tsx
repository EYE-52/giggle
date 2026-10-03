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
import styles from "./AppearancePicker.module.css";

/**
 * Profile → Appearance: choose skin, palette and light/dark/auto.
 * Radio-group semantics (roving tabindex, arrow keys, aria-checked) and
 * every choice applies instantly via applyLook (which also persists it).
 *
 * A single live sample follows the selected skin, palette and mode.
 * Its preview scope uses the same material rules as the rest of the app.
 */

const MODES: { value: Mode; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "auto", label: "Auto" },
];

interface RadioOption<T extends string> {
  value: T;
  label: string;
  description?: string;
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
      className={`${styles.group} ${styles[layout]}`}
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
            aria-label={option.label}
            aria-description={option.description}
            className={styles.choice}
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
 * inside the preview scope. Decorative: the radios describe the choices.
 */
function SkinSample({ skinId, name }: { skinId: SkinId; name: string }) {
  return (
    <div
      data-skin-preview={skinId}
      aria-hidden="true"
      className={styles.preview}
    >
      <div className={`card gg-skin-sample ${styles.sample}`}>
        <PersonAvatar userId="skin-sample-giggle" name={name} size={32} wrapClassName="pa" />
        <span
          className="card-title"
          style={{ fontSize: skinId === "paper" || skinId === "scrap" ? 21 : 18, lineHeight: 1.2, width: "fit-content", maxWidth: "100%" }}
        >
          Friday crew
        </span>
        <span className="gg-btn btn btn-primary" style={{ minHeight: 36, fontSize: 13, paddingInline: 18, paddingBlock: 8, lineHeight: 1.2 }}>
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
    description: skin.description,
    content: <span>{skin.name}</span>,
  }));

  const paletteOptions: RadioOption<PaletteId>[] = PALETTES.map((palette) => ({
    value: palette.id,
    label: palette.label,
    content: (
      <>
        <span
          aria-hidden
          className={styles.swatch}
          style={{
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
    <div className={styles.picker}>
      <div style={{ display: "grid", gap: 8 }}>
        <div style={{ color: "var(--text)", fontSize: 13, fontWeight: 600 }}>Skin</div>
        <RadioGroup label="Skin" value={look.skin} options={skinOptions} onSelect={(skin) => update({ skin })} layout="skin" />
        <SkinSample skinId={look.skin} name={SKINS.find((skin) => skin.id === look.skin)?.name ?? "Giggle"} />
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

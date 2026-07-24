"use client";
import { useRef, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { PRESET_COVERS, api, billing } from "@giggle/core";
import type { PresetCover } from "@giggle/core";
import { useTheme } from "@/components/useTheme";
import { coverKind, coverBackground, themeCoverStyle } from "@/components/covers";
import { Icon } from "@/components/Icons";
import { Modal } from "@/components/Modal";
import { Button } from "@/components/Button";

interface CoverPickerProps {
  squadId: string;
  currentCover?: string | null;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}

// Premium cover presets — gated behind the "cover_themes" perk. Free users keep
// a generous set of gradients; the fancier gradients + all photos require unlock.
const PREMIUM_COVER_IDS = new Set<string>([
  "grad-cyber",
  "grad-velvet",
  "grad-frost",
  "grad-ember",
  "grad-lagoon",
]);

function isPremiumPreset(p: PresetCover): boolean {
  return p.type === "photo" || PREMIUM_COVER_IDS.has(p.id);
}

const violet = "var(--accent, var(--violet))";
const MAX_UPLOAD_IMAGE_BYTES = 2_000_000;
const ALLOWED_UPLOAD_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

export function CoverPicker({ squadId, currentCover, onClose, onSaved }: CoverPickerProps) {
  const router = useRouter();
  const [selected, setSelected] = useState<string>(currentCover ?? "");
  const [uploadPreview, setUploadPreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [hint, setHint] = useState<string>("");
  const [unlocked, setUnlocked] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const themeId = useTheme();
  // Which gradient family this theme previews (photos always stay dark-scrimmed).
  const themeKind = themeCoverStyle(themeId);

  useEffect(() => {
    setUnlocked(billing.hasPerk("cover_themes"));
    return billing.subscribe(() => setUnlocked(billing.hasPerk("cover_themes")));
  }, []);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!ALLOWED_UPLOAD_IMAGE_TYPES.has(file.type)) {
      setHint("Upload a PNG, JPG, WebP, or GIF image.");
      return;
    }
    if (file.size > MAX_UPLOAD_IMAGE_BYTES) {
      setHint("Keep cover uploads under 2 MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string;
      setUploadPreview(dataUrl);
      setSelected(dataUrl);
      setHint("");
    };
    reader.readAsDataURL(file);
  }

  function selectPreset(p: PresetCover) {
    if (isPremiumPreset(p) && !unlocked) {
      setHint(`“${p.name}” is a premium cover — unlock cover themes to use it.`);
      return;
    }
    setSelected(p.id);
    setUploadPreview(null);
    setHint("");
  }

  async function handleSave() {
    if (!selected) return;
    setSaving(true);
    try {
      await api.setSquadCover(squadId, selected);
      await onSaved();
    } catch (e) {
      console.error("setSquadCover failed:", e);
      setHint("Couldn't save cover — please try again.");
    } finally {
      setSaving(false);
    }
  }

  const renderPreset = (p: PresetCover, height: number) => {
    const active = selected === p.id;
    const locked = isPremiumPreset(p) && !unlocked;
    const isPhoto = p.type === "photo";
    // Gradient tiles preview the variant the current theme will actually render;
    // photo tiles keep the dark label scrim in every theme.
    const tileKind = isPhoto ? "dark" : themeKind;
    return (
      <button
        key={p.id}
        onClick={() => selectPreset(p)}
        title={locked ? `${p.name} — premium` : p.name}
        className="gg-press gg-focusable"
        style={{
          height,
          borderRadius: "var(--radius-control, 14px)",
          background: isPhoto ? `url(${p.value}) center/cover no-repeat` : coverBackground(p.id, tileKind),
          border: `2px solid ${active ? violet : "transparent"}`,
          cursor: "pointer",
          position: "relative",
          overflow: "hidden",
          transition: "box-shadow .15s ease, border-color .15s ease, opacity .15s ease",
          boxShadow: active ? `0 0 0 3px color-mix(in srgb, var(--accent, var(--violet)) 27%, transparent)` : "none",
          opacity: locked ? 0.85 : 1,
        }}
      >
        {active && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "var(--overlay-strong, rgba(0,0,0,0.3))",
            }}
          >
            <span aria-hidden="true" style={{
              width: 22, height: 22, borderRadius: "50%",
              background: "var(--accent, var(--violet, #7657FF))",
              display: "inline-flex", alignItems: "center", justifyContent: "center",
            }}>
              <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden><path d="M2 5.5 4.5 8 9 3" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </span>
          </div>
        )}
        {locked && !active && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "var(--overlay-strong, rgba(0,0,0,0.4))",
            }}
          >
            <Icon.shield size={16} color="#fff" />
          </div>
        )}
        <div
          style={{
            position: "absolute",
            bottom: 4,
            left: 0,
            right: 0,
            textAlign: "center",
            fontSize: 12,
            color: tileKind === "light" ? "#1B1420" : "rgba(255,255,255,0.85)",
            fontWeight: 600,
            textShadow: tileKind === "light" ? "0 1px 4px rgba(255,255,255,0.8)" : "0 1px 4px rgba(0,0,0,0.8)",
          }}
        >
          {p.name}
        </div>
      </button>
    );
  };

  return (
    <Modal onClose={onClose} title="Change Cover" closeLabel="Close cover picker">
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        {/* Premium banner — only when locked content exists */}
        {!unlocked && (
          <button
            onClick={() => router.push("/premium")}
            className="gg-press gg-focusable"
            style={{
              display: "flex", alignItems: "center", gap: 10,
              textAlign: "left", width: "100%",
              background: "linear-gradient(135deg, var(--violet-soft), color-mix(in srgb, var(--live, var(--lime, #B7FF2A)) 8%, transparent))",
              border: "1px solid var(--violet-soft)",
              borderRadius: "var(--radius-control, 14px)", padding: "10px 14px", cursor: "pointer",
            }}
          >
            <Icon.shield size={16} color={violet} />
            <span style={{ flex: 1, fontSize: 12, color: "var(--text)", fontWeight: 600 }}>
              Premium covers locked — unlock with tokens
            </span>
            <span style={{ background: violet, color: "#fff", borderRadius: 999, padding: "3px 12px", fontSize: 12, fontWeight: 700 }}>
              Unlock
            </span>
          </button>
        )}

        {/* Preview strip */}
        <div
          style={{
            height: 100,
            flexShrink: 0,
            borderRadius: "var(--radius-control, 14px)",
            background: coverBackground(uploadPreview ?? selected, coverKind(uploadPreview ?? selected, themeId)),
            border: "1px solid var(--border)",
            position: "relative",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: coverKind(uploadPreview ?? selected, themeId) === "light"
                ? "linear-gradient(to bottom, transparent 40%, rgba(255,255,255,0.7))"
                : "linear-gradient(to bottom, transparent 40%, rgba(0,0,0,0.55))",
            }}
          />
          <span
            style={{
              position: "absolute",
              bottom: 10,
              left: 14,
              fontSize: 12,
              color: coverKind(uploadPreview ?? selected, themeId) === "light" ? "rgba(27,20,32,0.75)" : "rgba(255,255,255,0.6)",
              fontWeight: 500,
            }}
          >
            Preview
          </span>
        </div>

        {/* Gradient presets */}
        <div>
          <div
            style={{
              fontSize: 12,
              fontWeight: 600,
              letterSpacing: "0.08em",
              color: "var(--text-dim)",
              textTransform: "uppercase",
              marginBottom: 10,
            }}
          >
            Gradients
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
            {PRESET_COVERS.filter((p) => p.type === "gradient").map((p) => renderPreset(p, 60))}
          </div>
        </div>

        {/* Photo presets */}
        <div>
          <div
            style={{
              fontSize: 12,
              fontWeight: 600,
              letterSpacing: "0.08em",
              color: "var(--text-dim)",
              textTransform: "uppercase",
              marginBottom: 10,
            }}
          >
            Photos
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
            {PRESET_COVERS.filter((p) => p.type === "photo").map((p) => renderPreset(p, 70))}
          </div>
        </div>

        {/* Upload your own */}
        <div>
          <div
            style={{
              fontSize: 12,
              fontWeight: 600,
              letterSpacing: "0.08em",
              color: "var(--text-dim)",
              textTransform: "uppercase",
              marginBottom: 10,
            }}
          >
            Upload your own
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            style={{ display: "none" }}
            onChange={handleFileChange}
          />
          <button
            onClick={() => fileRef.current?.click()}
            className="gg-press gg-focusable"
            style={{
              width: "100%",
              height: 64,
              borderRadius: "var(--radius-control, 14px)",
              transition: "border-color .15s ease, background .15s ease",
              border: `2px dashed ${uploadPreview ? violet : "var(--border-strong)"}`,
              background: uploadPreview
                ? `url(${uploadPreview}) center/cover no-repeat`
                : "var(--overlay)",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              color: uploadPreview ? "rgba(255,255,255,0.85)" : "var(--text-muted)",
              fontSize: 13,
              fontWeight: 600,
              position: "relative",
              overflow: "hidden",
            }}
          >
            {uploadPreview && (
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  background: "rgba(0,0,0,0.4)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                }}
              >
                <Icon.plus size={14} color="#fff" />
                <span style={{ color: "#fff", fontSize: 13, fontWeight: 600 }}>Change image</span>
              </div>
            )}
            {!uploadPreview && (
              <>
                <Icon.plus size={16} color="var(--text-muted)" />
                Upload image
              </>
            )}
          </button>
        </div>

        {/* Hint / error line */}
        {hint && (
          <div style={{ fontSize: 12, color: "var(--coral)", fontWeight: 600 }}>{hint}</div>
        )}

        {/* Footer actions */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            gap: 10,
            paddingTop: 4,
          }}
        >
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} loading={saving} disabled={!selected}>
            {saving ? "Saving…" : "Apply Cover"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

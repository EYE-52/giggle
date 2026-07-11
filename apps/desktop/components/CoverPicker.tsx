"use client";
import { useRef, useState, useEffect, useId } from "react";
import { useRouter } from "next/navigation";
import { PRESET_COVERS, resolveCover, api, billing } from "@giggle/core";
import type { PresetCover } from "@giggle/core";
import { Icon } from "@/components/Icons";

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

const violet = "var(--violet)";
const MAX_UPLOAD_IMAGE_BYTES = 2_000_000;
const ALLOWED_UPLOAD_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

export function CoverPicker({ squadId, currentCover, onClose, onSaved }: CoverPickerProps) {
  const router = useRouter();
  const titleId = useId();
  const [selected, setSelected] = useState<string>(currentCover ?? "");
  const [uploadPreview, setUploadPreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [hint, setHint] = useState<string>("");
  const [unlocked, setUnlocked] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setUnlocked(billing.hasPerk("cover_themes"));
    return billing.subscribe(() => setUnlocked(billing.hasPerk("cover_themes")));
  }, []);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

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
    return (
      <button
        key={p.id}
        onClick={() => selectPreset(p)}
        title={locked ? `${p.name} — premium` : p.name}
        style={{
          height,
          borderRadius: 12,
          background: isPhoto ? `url(${p.value}) center/cover no-repeat` : p.value,
          border: `2px solid ${active ? violet : "transparent"}`,
          cursor: "pointer",
          position: "relative",
          overflow: "hidden",
          boxShadow: active ? `0 0 0 3px color-mix(in srgb, var(--violet) 27%, transparent)` : "none",
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
            <span style={{ color: "#fff", fontSize: 16, fontWeight: 900 }}>✓</span>
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
            fontSize: 10,
            color: "rgba(255,255,255,0.85)",
            fontWeight: 600,
            textShadow: "0 1px 4px rgba(0,0,0,0.8)",
          }}
        >
          {p.name}
        </div>
      </button>
    );
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1100,
        background: "var(--overlay-strong, rgba(0,0,0,0.65))",
        backdropFilter: "blur(8px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 20,
          padding: "28px 24px",
          width: 520,
          maxHeight: "80vh",
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          gap: 20,
          boxShadow: "var(--elev)",
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div
            id={titleId}
            style={{
              fontFamily: "var(--font-space-grotesk)",
              fontSize: 18,
              fontWeight: 700,
              color: "var(--text)",
            }}
          >
            Change Cover
          </div>
          <button
            onClick={onClose}
            aria-label="Close cover picker"
            style={{ width: 44, height: 44, margin: -13, display: "grid", placeItems: "center", background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)" }}
          >
            <Icon.close size={18} color="var(--text-muted)" />
          </button>
        </div>

        {/* Premium banner — only when locked content exists */}
        {!unlocked && (
          <button
            onClick={() => router.push("/premium")}
            style={{
              display: "flex", alignItems: "center", gap: 10,
              textAlign: "left", width: "100%",
              background: "linear-gradient(135deg, var(--violet-soft), rgba(194,255,61,0.08))",
              border: "1px solid var(--violet-soft)",
              borderRadius: 12, padding: "10px 14px", cursor: "pointer",
            }}
          >
            <Icon.shield size={16} color={violet} />
            <span style={{ flex: 1, fontSize: 12.5, color: "var(--text)", fontWeight: 600 }}>
              Premium covers locked — unlock with tokens
            </span>
            <span style={{ background: violet, color: "#fff", borderRadius: 999, padding: "3px 12px", fontSize: 11, fontWeight: 700 }}>
              Unlock
            </span>
          </button>
        )}

        {/* Preview strip */}
        <div
          style={{
            height: 100,
            flexShrink: 0,
            borderRadius: 14,
            background: resolveCover(uploadPreview ?? selected),
            border: "1px solid var(--border)",
            position: "relative",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: "linear-gradient(to bottom, transparent 40%, rgba(0,0,0,0.55))",
            }}
          />
          <span
            style={{
              position: "absolute",
              bottom: 10,
              left: 14,
              fontSize: 12,
              color: "rgba(255,255,255,0.6)",
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
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.08em",
              color: "var(--text-dim)",
              textTransform: "uppercase",
              marginBottom: 10,
            }}
          >
            Gradients
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
            {PRESET_COVERS.filter((p) => p.type === "gradient").map((p) => renderPreset(p, 60))}
          </div>
        </div>

        {/* Photo presets */}
        <div>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.08em",
              color: "var(--text-dim)",
              textTransform: "uppercase",
              marginBottom: 10,
            }}
          >
            Photos
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
            {PRESET_COVERS.filter((p) => p.type === "photo").map((p) => renderPreset(p, 70))}
          </div>
        </div>

        {/* Upload your own */}
        <div>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
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
            style={{
              width: "100%",
              height: 64,
              borderRadius: 12,
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
          <div style={{ fontSize: 12.5, color: "var(--coral)", fontWeight: 600 }}>{hint}</div>
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
          <button
            onClick={onClose}
            style={{
              padding: "10px 20px",
              borderRadius: 999,
              background: "transparent",
              border: "1px solid var(--border)",
              color: "var(--text-muted)",
              fontSize: 14,
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !selected}
            style={{
              padding: "10px 24px",
              borderRadius: 999,
              background: selected ? violet : "var(--violet-soft)",
              border: "none",
              color: "#fff",
              fontSize: 14,
              fontWeight: 700,
              cursor: selected ? "pointer" : "not-allowed",
              boxShadow: selected ? `0 0 20px -6px var(--violet)` : "none",
              opacity: saving ? 0.7 : 1,
            }}
          >
            {saving ? "Saving…" : "Apply Cover"}
          </button>
        </div>
      </div>
    </div>
  );
}

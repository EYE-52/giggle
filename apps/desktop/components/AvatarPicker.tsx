"use client";
import { useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { CHARACTER_PRESETS, encodeCharacter } from "@giggle/core";
import { saveMyAvatar } from "@/lib/avatarSync";
import { AvatarArt } from "./AvatarArt";
import { Icon } from "./Icons";
import { Modal } from "./Modal";
import { Button } from "./Button";

interface AvatarPickerProps {
  current: string;
  onClose: () => void;
  title?: string;
  subtitle?: string;
}

const MAX_UPLOAD_IMAGE_BYTES = 2_000_000;
const ALLOWED_UPLOAD_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

export function AvatarPicker({ current, onClose, title = "Choose your avatar", subtitle = "Friends and squads see your pick. Uploaded photos stay on this device." }: AvatarPickerProps) {
  const router = useRouter();
  const [selected, setSelected] = useState(current);
  const [preview, setPreview] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);
  const [hint, setHint] = useState("");
  const [saveError, setSaveError] = useState("");

  const [uploadHover, setUploadHover] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const effectiveSelected = preview ?? selected;
  const selectedPresetName =
    !preview && selected
      ? CHARACTER_PRESETS.find((preset) => encodeCharacter(preset.config) === selected)?.name
      : undefined;

  const handleFile = useCallback((file: File) => {
    if (!ALLOWED_UPLOAD_IMAGE_TYPES.has(file.type)) {
      setHint("Upload a PNG, JPG, WebP, or GIF image.");
      return;
    }
    if (file.size > MAX_UPLOAD_IMAGE_BYTES) {
      setHint("Keep avatar uploads under 2 MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const url = e.target?.result as string;
      setPreview(url);
      setSelected(url);
      setHint("");
    };
    reader.readAsDataURL(file);
  }, []);

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  }

  async function handleSave() {
    setSaving(true);
    setSaveError("");
    try {
      await saveMyAvatar(effectiveSelected);
      onClose();
    } catch {
      setSaveError("Couldn't save your avatar. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      onClose={onClose}
      title={title}
      subtitle={subtitle}
      closeLabel="Close avatar picker"
    >
      <div>
        <style>{`
          @media (prefers-reduced-motion: no-preference) {
            .gg-avatar-tile .gg-avatar-hello { display: inline-flex; transform-origin: 50% 85%; }
            .gg-avatar-tile:hover .gg-avatar-hello, .gg-avatar-tile:focus-visible .gg-avatar-hello,
            .gg-avatar-tile[aria-pressed="true"] .gg-avatar-hello { animation: gg-avatar-hello .5s ease; }
          }
          @keyframes gg-avatar-hello {
            0% { transform: rotate(0) scale(1); }
            35% { transform: rotate(-7deg) scale(1.07); }
            70% { transform: rotate(5deg) scale(1.03); }
            100% { transform: rotate(0) scale(1); }
          }
        `}</style>
        {/* Preview of the currently-selected avatar — tapping a preset swaps
            this instantly. The character art fills its circle inside the
            viewBox, so render it slightly oversized in a fixed circular
            window: the whole face stays inside the ring. */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, marginBottom: 14 }}>
          <div style={{
            width: 104,
            height: 104,
            borderRadius: "50%",
            overflow: "hidden",
            boxShadow: "0 0 0 4px var(--surface), 0 0 0 6px var(--accent-line)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}>
            <AvatarArt value={effectiveSelected} size={112} />
          </div>
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-muted)" }}>
            {preview ? "Your upload" : selectedPresetName ?? "Your pick"}
          </span>
        </div>

        <Button variant="secondary" onClick={() => { onClose(); router.push("/avatar-playground"); }} style={{ width: "100%", marginBottom: 18 }}>Create or edit your character</Button>
        {/* Grid of character looks */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(76px, 1fr))",
            gap: 10,
            marginBottom: 20,
          }}
        >
          {CHARACTER_PRESETS.map((preset) => {
            const value = encodeCharacter(preset.config);
            const isActive = effectiveSelected === value;
            return (
              <button
                key={preset.id}
                title={preset.name}
                aria-label={preset.name}
                aria-pressed={isActive}
                onClick={() => {
                  setSelected(value); setPreview(null); setHint("");
                }}
                className="gg-press gg-focusable gg-avatar-tile"
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 6,
                  padding: "6px 4px 6px",
                  borderRadius: "var(--radius-tile, 16px)",
                  border: isActive
                    ? "2px solid var(--accent, var(--violet, #7657FF))"
                    : "2px solid transparent",
                  background: isActive
                    ? "color-mix(in srgb, var(--accent, var(--violet, #7657FF)) 12%, transparent)"
                    : "var(--overlay, rgba(255,255,255,0.04))",
                  cursor: "pointer",
                  transition: "all 0.12s ease",
                  outline: "none",
                  boxShadow: isActive ? "0 0 16px -4px var(--accent, var(--violet, #7657FF))" : undefined,
                }}
              >
                <div style={{ position: "relative" }}>
                  <span className="gg-avatar-hello">
                    <AvatarArt value={value} size={58} />
                  </span>
                  {isActive && (
                    <div aria-hidden style={{
                      position: "absolute", bottom: -2, right: -2, width: 16, height: 16,
                      borderRadius: "50%", background: "var(--accent, var(--violet, #7657FF))",
                      border: "2px solid var(--surface, #16161f)",
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                      <svg width="8" height="8" viewBox="0 0 11 11" fill="none" aria-hidden><path d="M2 5.5 4.5 8 9 3" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    </div>
                  )}
                </div>
                <span style={{
                  fontSize: 13, fontWeight: 600,
                  color: isActive ? "var(--accent, var(--violet))" : "var(--text-muted)",
                  fontFamily: "var(--font-display, var(--font-space-grotesk)), 'Space Grotesk', sans-serif",
                  whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                  maxWidth: 68,
                }}>
                  {preset.name}
                </span>
              </button>
            );
          })}

          {/* Upload tile */}
          <button
            onMouseEnter={() => setUploadHover(true)}
            onMouseLeave={() => setUploadHover(false)}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => fileRef.current?.click()}
            className="gg-press gg-focusable gg-avatar-tile"
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              padding: "8px 4px 6px",
              borderRadius: "var(--radius-tile, 16px)",
              border: dragOver
                ? "2px solid var(--live, var(--lime))"
                : preview
                ? "2px solid var(--live, var(--lime))"
                : "2px dashed var(--border-strong)",
              background: dragOver
                ? "var(--live-soft)"
                : uploadHover
                ? "var(--overlay-hover, var(--surface-2))"
                : "var(--overlay)",
              cursor: "pointer",
              transition: "all 0.12s ease",
              outline: "none",
            }}
          >
            {preview ? (
              <span className="gg-avatar-hello">
                <AvatarArt value={preview} size={58} />
              </span>
            ) : (
              <div style={{
                width: 58, height: 58, borderRadius: "50%",
                background: "var(--overlay-hover, var(--surface-2))",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <Icon.plus size={22} color="var(--accent, #ba4b33)" />
              </div>
            )}
            <span style={{
              fontSize: 13, fontWeight: 600,
              color: preview ? "var(--lime-text)" : "var(--text-muted)",
              fontFamily: "var(--font-display, var(--font-space-grotesk)), 'Space Grotesk', sans-serif",
            }}>
              {preview ? "Custom" : "Upload"}
            </span>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              style={{ display: "none" }}
              onChange={handleFileInput}
            />
          </button>
        </div>

        {/* Upload hint */}
        {hint && (
          <div style={{ marginBottom: 14, padding: "8px 12px", borderRadius: "var(--radius-control, 14px)", background: "var(--coral-soft)" }}>
            <span style={{ fontSize: 13, color: "var(--coral)", fontWeight: 600 }}>{hint}</span>
          </div>
        )}

        {saveError && (
          <p role="alert" className="gg-inline-error" style={{ marginBottom: 12 }}>{saveError}</p>
        )}

        {/* Footer: one clear primary action — Save */}
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} loading={saving} style={{ minWidth: 96 }}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

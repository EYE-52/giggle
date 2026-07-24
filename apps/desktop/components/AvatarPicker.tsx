"use client";
import { useState, useRef, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { DEFAULT_AVATARS, setMyAvatar, billing } from "@giggle/core";
import { AvatarArt } from "./AvatarArt";
import { Icon } from "./Icons";
import { Modal } from "./Modal";
import { Button } from "./Button";

interface AvatarPickerProps {
  current: string;
  onClose: () => void;
}

// The first 8 avatars are always free; the rest are a premium "vibe_pack".
const FREE_AVATAR_COUNT = 8;
const MAX_UPLOAD_IMAGE_BYTES = 2_000_000;
const ALLOWED_UPLOAD_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

export function AvatarPicker({ current, onClose }: AvatarPickerProps) {
  const router = useRouter();
  const [selected, setSelected] = useState(current);
  const [preview, setPreview] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);
  const [vibePackUnlocked, setVibePackUnlocked] = useState(false);
  const [hint, setHint] = useState("");

  useEffect(() => {
    setVibePackUnlocked(billing.hasPerk("vibe_pack"));
    return billing.subscribe(() => setVibePackUnlocked(billing.hasPerk("vibe_pack")));
  }, []);
  const [uploadHover, setUploadHover] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const effectiveSelected = preview ?? selected;

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

  function handleSave() {
    setSaving(true);
    setMyAvatar(effectiveSelected);
    setTimeout(() => {
      setSaving(false);
      onClose();
    }, 120);
  }

  return (
    <Modal
      onClose={onClose}
      title="Choose your avatar"
      subtitle="Pick a vibe or upload your own photo"
      closeLabel="Close avatar picker"
      style={{
        background: "linear-gradient(160deg, var(--surface-grad-from) 0%, var(--surface-grad-to) 100%)",
      }}
    >
      <div>
        {/* Preview of currently-highlighted avatar */}
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 24 }}>
          <div style={{ position: "relative" }}>
            <AvatarArt value={effectiveSelected} size={80} />
            <div style={{
              position: "absolute", inset: -4, borderRadius: "50%",
              background: "conic-gradient(from 0deg, var(--accent, var(--violet, #7657FF)) 0%, var(--live, var(--lime, #B7FF2A)) 50%, var(--accent, var(--violet, #7657FF)) 100%)",
              filter: "blur(6px)", opacity: 0.6, zIndex: -1,
            }} />
          </div>
        </div>

        {/* Grid of default avatars */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(72px, 1fr))",
            gap: 10,
            marginBottom: 20,
          }}
        >
          {DEFAULT_AVATARS.map((av, idx) => {
            const isActive = effectiveSelected === av.id;
            const locked = idx >= FREE_AVATAR_COUNT && !vibePackUnlocked;
            return (
              <button
                key={av.id}
                title={locked ? `${av.name} — premium` : av.name}
                onClick={() => {
                  if (locked) { setHint(`“${av.name}” is in the premium Vibe Pack.`); return; }
                  setSelected(av.id); setPreview(null); setHint("");
                }}
                className="gg-press gg-focusable"
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 6,
                  padding: "10px 6px 8px",
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
                  <AvatarArt value={av.id} size={44} />
                  {isActive && !locked && (
                    <div aria-hidden style={{
                      position: "absolute", bottom: -2, right: -2, width: 16, height: 16,
                      borderRadius: "50%", background: "var(--accent, var(--violet, #7657FF))",
                      border: "2px solid var(--surface, #16161f)",
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                      <svg width="8" height="8" viewBox="0 0 11 11" fill="none" aria-hidden><path d="M2 5.5 4.5 8 9 3" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    </div>
                  )}
                  {locked && (
                    <div style={{
                      position: "absolute", inset: 0, borderRadius: "50%",
                      background: "var(--overlay-strong, rgba(0,0,0,0.5))",
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                      <Icon.shield size={14} color="#fff" />
                    </div>
                  )}
                </div>
                <span style={{
                  fontSize: 12, fontWeight: 600,
                  color: isActive ? "var(--accent, var(--violet))" : "var(--text-muted)",
                  fontFamily: "var(--font-display, var(--font-space-grotesk)), 'Space Grotesk', sans-serif",
                  whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                  maxWidth: 60,
                }}>
                  {locked ? "Premium" : (av.name.split(" ")[1] ?? av.name)}
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
            className="gg-press gg-focusable"
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              padding: "10px 6px 8px",
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
              <AvatarArt value={preview} size={44} />
            ) : (
              <div style={{
                width: 44, height: 44, borderRadius: "50%",
                background: "var(--overlay-hover, var(--surface-2))",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 22,
              }}>
                <span aria-hidden="true">📷</span>
              </div>
            )}
            <span style={{
              fontSize: 12, fontWeight: 600,
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

        {/* Premium hint */}
        {hint && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 14, padding: "8px 12px", borderRadius: "var(--radius-control, 14px)", background: "var(--coral-soft)" }}>
            <span style={{ fontSize: 12, color: "var(--coral)", fontWeight: 600 }}>{hint}</span>
            <Button size="sm" onClick={() => router.push("/premium")} style={{ whiteSpace: "nowrap" }}>
              Unlock
            </Button>
          </div>
        )}

        {/* Footer buttons */}
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} loading={saving} style={{ minWidth: 80 }}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

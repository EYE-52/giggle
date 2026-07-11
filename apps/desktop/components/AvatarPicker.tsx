"use client";
import { useState, useRef, useCallback, useEffect, useId } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { DEFAULT_AVATARS, setMyAvatar, billing } from "@giggle/core";
import { AvatarArt } from "./AvatarArt";
import { Icon } from "./Icons";

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
  const titleId = useId();
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
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);
  const [uploadHover, setUploadHover] = useState(false);
  const [saveHover, setSaveHover] = useState(false);
  const [cancelHover, setCancelHover] = useState(false);
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

  return createPortal(
    /* Backdrop */
    <div
      onClick={(e) => e.target === e.currentTarget && onClose()}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 200,
        background: "rgba(11,11,15,0.72)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
    >
      {/* Modal card */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        style={{
          background: "linear-gradient(160deg, var(--surface-grad-from, #1a1a26) 0%, var(--surface-grad-to, #13131c) 100%)",
          border: "1px solid var(--border, rgba(255,255,255,0.1))",
          borderRadius: 24,
          padding: "28px 28px 24px",
          width: "min(520px, calc(100vw - 32px))",
          maxHeight: "calc(100dvh - 32px)",
          overflowY: "auto",
          boxSizing: "border-box",
          boxShadow: "0 32px 80px rgba(0,0,0,0.65), 0 0 0 1px rgba(255,255,255,0.04)",
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 22 }}>
          <div>
            <div id={titleId} style={{
              fontFamily: "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
              fontSize: 20, fontWeight: 700,
              color: "var(--text, #F4F4F7)",
              letterSpacing: "-0.02em",
            }}>
              Choose your avatar
            </div>
            <div style={{ fontSize: 13, color: "var(--text-muted, #9A9AB0)", marginTop: 3 }}>
              Pick a vibe or upload your own photo
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close avatar picker"
            style={{
              width: 44, height: 44, borderRadius: 999, border: "1px solid var(--border, rgba(255,255,255,0.1))",
              background: "var(--overlay, rgba(255,255,255,0.06))",
              display: "flex", alignItems: "center", justifyContent: "center",
              cursor: "pointer", color: "var(--text-muted, #9A9AB0)", fontSize: 16,
              flexShrink: 0,
            }}
          >
            ✕
          </button>
        </div>

        {/* Preview of currently-highlighted avatar */}
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 24 }}>
          <div style={{ position: "relative" }}>
            <AvatarArt value={effectiveSelected} size={80} />
            <div style={{
              position: "absolute", inset: -4, borderRadius: "50%",
              background: "conic-gradient(from 0deg, var(--violet, #7C5CFF) 0%, var(--lime, #C2FF3D) 50%, var(--violet, #7C5CFF) 100%)",
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
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 6,
                  padding: "10px 6px 8px",
                  borderRadius: 16,
                  border: isActive
                    ? "2px solid var(--violet, #7C5CFF)"
                    : "2px solid transparent",
                  background: isActive
                    ? "rgba(124,92,255,0.12)"
                    : "var(--overlay, rgba(255,255,255,0.04))",
                  cursor: "pointer",
                  transition: "all 0.12s ease",
                  outline: "none",
                  boxShadow: isActive ? "0 0 16px -4px var(--violet, #7C5CFF)" : undefined,
                }}
              >
                <div style={{ position: "relative" }}>
                  <AvatarArt value={av.id} size={44} />
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
                  fontSize: 10, fontWeight: 600,
                  color: isActive ? "var(--violet, #7C5CFF)" : "var(--text-muted, #9A9AB0)",
                  fontFamily: "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
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
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              padding: "10px 6px 8px",
              borderRadius: 16,
              border: dragOver
                ? "2px solid var(--lime, #C2FF3D)"
                : preview
                ? "2px solid var(--lime, #C2FF3D)"
                : "2px dashed rgba(255,255,255,0.18)",
              background: dragOver
                ? "rgba(194,255,61,0.08)"
                : uploadHover
                ? "rgba(255,255,255,0.07)"
                : "var(--overlay, rgba(255,255,255,0.04))",
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
                background: "rgba(255,255,255,0.08)",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 22,
              }}>
                📷
              </div>
            )}
            <span style={{
              fontSize: 10, fontWeight: 600,
              color: preview ? "var(--lime, #C2FF3D)" : "var(--text-muted, #9A9AB0)",
              fontFamily: "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
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
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 14 }}>
            <span style={{ fontSize: 12.5, color: "var(--coral, #FF5C8A)", fontWeight: 600 }}>{hint}</span>
            <button
              onClick={() => router.push("/premium")}
              style={{
                background: "var(--violet, #7C5CFF)", color: "#fff", border: "none",
                borderRadius: 999, padding: "5px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              Unlock
            </button>
          </div>
        )}

        {/* Footer buttons */}
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button
            onMouseEnter={() => setCancelHover(true)}
            onMouseLeave={() => setCancelHover(false)}
            onClick={onClose}
            style={{
              height: 40, padding: "0 20px",
              borderRadius: 999,
              border: "1px solid var(--border, rgba(255,255,255,0.1))",
              background: cancelHover ? "var(--overlay-hover, rgba(255,255,255,0.1))" : "transparent",
              color: "var(--text-muted, #9A9AB0)",
              fontFamily: "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
              fontWeight: 600, fontSize: 14,
              cursor: "pointer",
              transition: "all 0.12s ease",
            }}
          >
            Cancel
          </button>
          <button
            onMouseEnter={() => setSaveHover(true)}
            onMouseLeave={() => setSaveHover(false)}
            onClick={handleSave}
            disabled={saving}
            style={{
              height: 40, padding: "0 24px",
              borderRadius: 999,
              border: "none",
              background: saving
                ? "rgba(124,92,255,0.5)"
                : saveHover
                ? "#9B7CFF"
                : "var(--violet, #7C5CFF)",
              color: "#fff",
              fontFamily: "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
              fontWeight: 700, fontSize: 14,
              cursor: saving ? "not-allowed" : "pointer",
              transition: "all 0.12s ease",
              minWidth: 80,
            }}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

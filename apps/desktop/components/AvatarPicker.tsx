"use client";
import { useState, useEffect, useId } from "react";
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

export function AvatarPicker({ current, onClose }: AvatarPickerProps) {
  const router = useRouter();
  const titleId = useId();
  const [selected, setSelected] = useState(current);
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
  const [saveHover, setSaveHover] = useState(false);
  const [cancelHover, setCancelHover] = useState(false);

  function handleSave() {
    setMyAvatar(selected);
    onClose();
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
              Choose how you appear on this device
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
            <AvatarArt value={selected} size={80} />
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
            const isActive = selected === av.id;
            const locked = idx >= FREE_AVATAR_COUNT && !vibePackUnlocked;
            return (
              <button
                key={av.id}
                title={locked ? `${av.name} — premium` : av.name}
                onClick={() => {
                  if (locked) { setHint(`“${av.name}” is in the premium Vibe Pack.`); return; }
                  setSelected(av.id); setHint("");
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
              height: 44, padding: "0 20px",
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
            style={{
              height: 44, padding: "0 24px",
              borderRadius: 999,
              border: "none",
              background: saveHover
                ? "#9B7CFF"
                : "var(--violet, #7C5CFF)",
              color: "#fff",
              fontFamily: "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
              fontWeight: 700, fontSize: 14,
              cursor: "pointer",
              transition: "all 0.12s ease",
              minWidth: 80,
            }}
          >
            Save
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

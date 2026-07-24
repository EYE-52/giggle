"use client";
import {
  CSSProperties,
  ReactNode,
  RefObject,
  useEffect,
  useId,
  useRef,
} from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icons";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Focus management for dialog-like surfaces: traps Tab inside `containerRef`
 * while `active`, moves focus in on mount (initialFocusRef → first focusable →
 * container), and restores focus to the previously-focused element on unmount.
 * Exported so bespoke dialogs (e.g. SquadPreview) can share the behavior
 * without adopting the full <Modal> chrome.
 */
export function useFocusTrap(
  containerRef: RefObject<HTMLElement | null>,
  active = true,
  initialFocusRef?: RefObject<HTMLElement | null>
) {
  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    if (!container) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;

    const initial =
      initialFocusRef?.current ??
      (container.querySelector(FOCUSABLE) as HTMLElement | null) ??
      container;
    if (initial === container) container.tabIndex = -1;
    initial.focus({ preventScroll: true });

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const nodes = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement
      );
      if (nodes.length === 0) {
        e.preventDefault();
        container.focus({ preventScroll: true });
        return;
      }
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const current = document.activeElement as HTMLElement | null;
      if (e.shiftKey) {
        if (current === first || !container.contains(current)) {
          e.preventDefault();
          last.focus();
        }
      } else if (current === last || !container.contains(current)) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      previouslyFocused?.focus?.({ preventScroll: true });
    };
  }, [containerRef, active, initialFocusRef]);
}

/** Locks body scroll while mounted (restores the previous value on unmount). */
export function useBodyScrollLock(active = true) {
  useEffect(() => {
    if (!active) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [active]);
}

export interface ModalProps {
  onClose: () => void;
  children: ReactNode;
  /** Header title (renders the standard header row). */
  title?: ReactNode;
  /** Smaller muted line under the title. */
  subtitle?: ReactNode;
  /** Accessible label when no `title` is given. */
  ariaLabel?: string;
  /** Backdrop click closes the modal. Default true. */
  closeOnBackdrop?: boolean;
  /** Show the standard close (✕) button. Default true. */
  showClose?: boolean;
  /** aria-label for the close button. Default "Close". */
  closeLabel?: string;
  /** Card width. Default `min(520px, calc(100vw - 32px))`. */
  width?: number | string;
  /** Bottom-sheet presentation (full-width, bottom-aligned, top radius only). */
  sheet?: boolean;
  /** Card padding. Default "24px 24px 22px" (sheet: side padding kept, no top radius change). */
  padding?: number | string;
  /** Extra styles merged onto the card. */
  style?: CSSProperties;
  /** Element to receive initial focus. */
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** z-index of the backdrop. Default 1100. */
  zIndex?: number;
}

/**
 * Shared modal primitive: portal to body, `var(--overlay-strong)` blurred
 * backdrop, focus trap + restore, Escape/backdrop close, body scroll lock,
 * gg-reveal entrance (honors reduced motion), radius 20, z-index 1100.
 */
export function Modal({
  onClose,
  children,
  title,
  subtitle,
  ariaLabel,
  closeOnBackdrop = true,
  showClose = true,
  closeLabel = "Close",
  width = "min(520px, calc(100vw - 32px))",
  sheet = false,
  padding = "24px 24px 22px",
  style,
  initialFocusRef,
  zIndex = 1100,
}: ModalProps) {
  const titleId = useId();
  const cardRef = useRef<HTMLDivElement>(null);

  useBodyScrollLock();
  useFocusTrap(cardRef, true, initialFocusRef);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div
      onClick={(e) => {
        if (closeOnBackdrop && e.target === e.currentTarget) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex,
        background: "var(--overlay-strong)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        display: "flex",
        alignItems: sheet ? "flex-end" : "center",
        justifyContent: "center",
        padding: sheet ? 0 : 16,
      }}
    >
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title != null ? titleId : undefined}
        aria-label={title == null ? ariaLabel : undefined}
        className="gg-reveal"
        style={{
          background: "var(--surface)",
          border: "var(--border-w) solid var(--border)",
          borderRadius: sheet ? "var(--radius-card) var(--radius-card) 0 0" : "var(--radius-card)",
          padding,
          width: sheet ? "100%" : width,
          maxWidth: "100%",
          maxHeight: sheet ? "88dvh" : "calc(100dvh - 32px)",
          overflowY: "auto",
          boxSizing: "border-box",
          boxShadow: "var(--shadow-pop)",
          display: "flex",
          flexDirection: "column",
          ...style,
        }}
      >
        {(title != null || showClose) && (
          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "space-between",
              gap: 12,
              marginBottom: title != null ? 18 : 0,
            }}
          >
            <div style={{ minWidth: 0 }}>
              {title != null && (
                <div
                  id={titleId}
                  style={{
                    fontFamily: "var(--font-display)",
                    fontSize: 17, /* v3 type scale: 30/22/17/14/13/12 */
                    fontWeight: 700,
                    color: "var(--text)",
                    letterSpacing: "-0.02em",
                  }}
                >
                  {title}
                </div>
              )}
              {subtitle != null && (
                <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 3 }}>
                  {subtitle}
                </div>
              )}
            </div>
            {showClose && (
              <button
                type="button"
                onClick={onClose}
                aria-label={closeLabel}
                className="gg-press gg-focusable"
                style={{
                  flexShrink: 0,
                  width: 44,
                  height: 44,
                  margin: title != null ? "-6px -8px 0 0" : "-6px -8px -6px 0",
                  borderRadius: "var(--radius-control)",
                  border: "var(--control-border)",
                  background: "var(--overlay)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: "pointer",
                  color: "var(--text-muted)",
                }}
              >
                <Icon.close size={17} color="var(--text-muted)" />
              </button>
            )}
          </div>
        )}
        {children}
      </div>
    </div>,
    document.body
  );
}

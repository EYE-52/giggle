"use client";
import {
  ReactNode,
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icons";

export type ToastVariant = "success" | "error" | "info";

export interface ToastItem {
  id: number;
  message: ReactNode;
  variant: ToastVariant;
}

interface ToastContextValue {
  /** Show a toast. Returns its id. Auto-dismisses after ~4s. */
  toast: (message: ReactNode, variant?: ToastVariant) => number;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const AUTO_DISMISS_MS = 4000;

/* Spec 06: toasts are dark ink pills with white text in EVERY theme —
   only the status icon color changes (soft lime / soft coral / soft violet).
   Colors live in globals.css (.gg-toast-card) so the skin system's `toast`
   hook can restyle them. */
const VARIANT_STYLE: Record<ToastVariant, { icon: ReactNode }> = {
  success: { icon: <Icon.star size={15} color="#A3E635" fill="#A3E635" /> },
  error: { icon: <Icon.flag size={15} color="#FCA5A5" /> },
  info: { icon: <Icon.bell size={15} color="#B4A3FF" /> },
};

function ToastCard({ t, onDismiss }: { t: ToastItem; onDismiss: (id: number) => void }) {
  const v = VARIANT_STYLE[t.variant];
  return (
    <div role={t.variant === "error" ? "alert" : "status"} className="gg-toast gg-toast-card toast">
      <span aria-hidden="true" className="gg-toast-icon">{v.icon}</span>
      <span className="gg-toast-message">{t.message}</span>
      <button
        type="button"
        onClick={() => onDismiss(t.id)}
        aria-label="Dismiss notification"
        className="gg-press gg-focusable gg-toast-dismiss"
        style={{
          flexShrink: 0,
          width: 28,
          height: 28,
          margin: "-4px -4px -4px 2px",
          borderRadius: 999,
          border: "none",
          background: "transparent",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
        }}
      >
        <Icon.close size={13} color="currentColor" />
      </button>
    </div>
  );
}

/**
 * App-level toast provider. Wrap a subtree, then call
 * `const { toast } = useToast(); toast("Saved!", "success")`.
 * Renders a single top-center stack (z-index 1200) that stacks without overlap.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const [mounted, setMounted] = useState(false);
  // Avoid document access during SSR.
  if (typeof window !== "undefined" && !mounted) setMounted(true);

  const dismiss = useCallback((id: number) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (message: ReactNode, variant: ToastVariant = "info") => {
      const id = nextId.current++;
      setItems((prev) => [...prev, { id, message, variant }]);
      window.setTimeout(() => dismiss(id), AUTO_DISMISS_MS);
      return id;
    },
    [dismiss]
  );

  const value = useMemo(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {mounted &&
        createPortal(
          <div
            style={{
              position: "fixed",
              top: "max(14px, env(safe-area-inset-top))",
              left: "50%",
              transform: "translateX(-50%)",
              zIndex: 1200,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 8,
              pointerEvents: "none",
            }}
          >
            {items.map((t) => (
              <ToastCard key={t.id} t={t} onDismiss={dismiss} />
            ))}
          </div>,
          document.body
        )}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}

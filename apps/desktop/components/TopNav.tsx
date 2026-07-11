"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Wordmark, Logomark } from "./Brand";
import { Icon } from "./Icons";
import { ThemeToggle } from "./ThemeToggle";
import { NotificationBell } from "./NotificationBell";
import { useViewport } from "./useViewport";
import { getTokenBalance, billing } from "@giggle/core";

function fmtTokens(n: number): string {
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "k";
  return String(n);
}

const NAV = [
  { href: "/home", label: "Home", icon: Icon.home },
  { href: "/discover", label: "Discover", icon: Icon.discover },
  { href: "/friends", label: "Friends", icon: Icon.users },
  { href: "/profile", label: "Profile", icon: Icon.profile },
] as const;

const CALLING_ROUTES = ["/lobby", "/encounter", "/matchmaking", "/match"];

export function TopNav() {
  const path = usePathname();
  const [hovered, setHovered] = useState<string | null>(null);
  const [tokens, setTokens] = useState(0);

  useEffect(() => {
    setTokens(getTokenBalance());
    return billing.subscribe(() => setTokens(getTokenBalance()));
  }, []);
  const isCallingRoute = CALLING_ROUTES.includes(path);
  const { width, isPhone, isTablet } = useViewport();

  const innerStyle: React.CSSProperties = isCallingRoute
    ? {
        height: "100%",
        maxWidth: "none",
        margin: 0,
        padding: isPhone ? "0 8px" : "0 24px",
        display: "grid",
        gridTemplateColumns: "auto 1fr auto",
        alignItems: "center",
        gap: 16,
      }
    : {
        height: "100%",
        maxWidth: 1200,
        margin: "0 auto",
        padding: isPhone ? "0 8px" : "0 40px",
        display: "grid",
        gridTemplateColumns: "auto 1fr auto",
        alignItems: "center",
        gap: 16,
      };

  return (
    <header
      style={{
        position: "sticky",
        top: 0,
        zIndex: 50,
        height: 68,
        background: "color-mix(in srgb, var(--bg) 90%, transparent)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        borderBottom: "1px solid var(--border)",
      }}
    >
      <div style={innerStyle}>
        {/* left: logo (Wordmark already includes the logomark) */}
        <Link
          href="/home"
          aria-label="Giggle home"
          title="Giggle home"
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            minWidth: 44,
            minHeight: 44,
            textDecoration: "none",
            flexShrink: 0,
          }}
        >
          {isPhone ? <Logomark size={28} /> : <Wordmark size={20} />}
        </Link>

        <nav aria-label="Primary navigation" style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: isPhone ? 0 : 4 }}>
          {NAV.map(({ href, label, icon: I }) => {
            const active = path === href;
            const isHovered = hovered === href;
            return (
              <Link
                key={href}
                href={href}
                className="gg-nav-item"
                onMouseEnter={() => setHovered(href)}
                onMouseLeave={() => setHovered(null)}
                aria-label={label}
                title={isTablet ? label : undefined}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 7,
                  padding: isTablet ? "0" : "0 14px",
                  minWidth: 44,
                  minHeight: 44,
                  borderRadius: 10,
                  textDecoration: "none",
                  color: active || isHovered ? "var(--text)" : "var(--text-muted)",
                  background: active
                    ? "var(--overlay)"
                    : isHovered
                    ? "var(--overlay-hover)"
                    : "transparent",
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: "pointer",
                  transition:
                    "color var(--dur) var(--ease-inout), background-color var(--dur) var(--ease-inout), border-color var(--dur) var(--ease-inout), transform var(--dur) var(--ease-out)",
                  border: active ? "1px solid var(--border-strong)" : "1px solid transparent",
                }}
              >
                <I
                  size={isPhone ? 20 : 18}
                  color={active || isHovered ? "var(--violet)" : "var(--text-muted)"}
                  strokeWidth={2}
                />
                {!isTablet && label}
              </Link>
            );
          })}

        </nav>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: isPhone ? 0 : 4 }}>
          {width >= 360 && <div>
            <ThemeToggle size={44} />
          </div>}

          {!isPhone && <div style={{ position: "relative" }}>
            <Link
              href="/premium"
              className="gg-nav-item"
              onMouseEnter={() => setHovered("premium")}
              onMouseLeave={() => setHovered(null)}
              aria-label={`${fmtTokens(tokens)} tokens. View Giggle Plus`}
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
                padding: "0 12px",
                minWidth: 58,
                minHeight: 44,
                borderRadius: 10,
                background:
                  hovered === "premium"
                    ? "rgba(255,200,50,0.12)"
                    : "var(--overlay)",
                border:
                  hovered === "premium"
                    ? "1px solid rgba(255,200,50,0.3)"
                    : "1px solid var(--border)",
                cursor: "pointer",
                transition:
                  "background-color var(--dur) var(--ease-inout), border-color var(--dur) var(--ease-inout), transform var(--dur) var(--ease-out)",
              }}
            >
              <Icon.star size={14} color="var(--lime)" fill="var(--lime)" />
              <span style={{ fontFamily: "var(--font-space-grotesk)", fontWeight: 700, fontSize: 13, color: "var(--text)" }}>{fmtTokens(tokens)}</span>
            </Link>
            {hovered === "premium" && (
              <div
                style={{
                  position: "absolute",
                  top: "calc(100% + 8px)",
                  left: "50%",
                  transform: "translateX(-50%)",
                  background: "var(--surface)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  padding: "4px 10px",
                  fontSize: 12,
                  fontWeight: 600,
                  color: "var(--text)",
                  whiteSpace: "nowrap",
                  fontFamily: "var(--font-space-grotesk)",
                  pointerEvents: "none",
                  boxShadow: "0 8px 20px rgba(0,0,0,0.45)",
                  zIndex: 60,
                }}
              >
                Tokens & Giggle+
                <div
                  style={{
                    position: "absolute",
                    bottom: "100%",
                    left: "50%",
                    transform: "translateX(-50%)",
                    width: 0,
                    height: 0,
                    borderLeft: "5px solid transparent",
                    borderRight: "5px solid transparent",
                    borderBottom: "5px solid var(--border)",
                  }}
                />
              </div>
            )}
          </div>}

          {/* Notification bell + live panel */}
          <NotificationBell />

        </div>
      </div>
    </header>
  );
}

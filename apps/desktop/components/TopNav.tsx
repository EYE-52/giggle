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
  const [premiumFocused, setPremiumFocused] = useState(false);
  const [tokens, setTokens] = useState(0);

  useEffect(() => {
    setTokens(getTokenBalance());
    return billing.subscribe(() => setTokens(getTokenBalance()));
  }, []);
  const isCallingRoute = CALLING_ROUTES.includes(path);
  const { width, isPhone, isTablet } = useViewport();
  // Tooltip shows on hover AND keyboard focus (not on touch — no hover there).
  const premiumTipVisible = !isPhone && (hovered === "premium" || premiumFocused);

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
    <>
    <header
      style={{
        position: "sticky",
        top: 0,
        zIndex: 50,
        height: 68,
        background: "color-mix(in srgb, var(--surface) 85%, transparent)",
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

        <nav data-testid="desktop-navigation" aria-label="Primary navigation" style={{ display: isPhone ? "none" : "flex", alignItems: "center", justifyContent: "center", gap: 4 }}>
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
                aria-current={active ? "page" : undefined}
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
                  // Active tab = tonal fill: accent-soft bg + accent text (spec 05).
                  color: active ? "var(--accent)" : isHovered ? "var(--text)" : "var(--text-muted)",
                  background: active
                    ? "var(--accent-soft)"
                    : isHovered
                    ? "var(--overlay-hover)"
                    : "transparent",
                  fontSize: 13.5,
                  fontWeight: 600,
                  cursor: "pointer",
                  transition:
                    "color var(--dur) var(--ease-inout), background-color var(--dur) var(--ease-inout), border-color var(--dur) var(--ease-inout), transform var(--dur) var(--ease-out)",
                  border: "1px solid transparent",
                }}
              >
                <I
                  size={isPhone ? 20 : 18}
                  color={active ? "var(--accent)" : isHovered ? "var(--violet)" : "var(--text-muted)"}
                  strokeWidth={2}
                />
                {!isTablet && label}
              </Link>
            );
          })}

        </nav>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: isPhone ? 0 : 4 }}>
          {/* Right controls: 38px rounded squares on one baseline (44px
              touch target kept on phone via the larger size). */}
          {width >= 360 && <div>
            <ThemeToggle size={isPhone ? 44 : 38} />
          </div>}

          <div style={{ position: "relative" }}>
            <Link
              href="/premium"
              className="gg-nav-item"
              onMouseEnter={() => setHovered("premium")}
              onMouseLeave={() => setHovered(null)}
              onFocus={() => setPremiumFocused(true)}
              onBlur={() => setPremiumFocused(false)}
              aria-label={`${fmtTokens(tokens)} tokens. View Giggle Plus`}
              aria-describedby={premiumTipVisible ? "premium-tooltip" : undefined}
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
                padding: isPhone ? "0 10px" : "0 12px",
                minWidth: isPhone ? 50 : 58,
                minHeight: isPhone ? 44 : 38,
                height: isPhone ? 44 : 38,
                borderRadius: 10,
                // Token pill: accent-soft fill + accent text + accent-line border.
                background:
                  hovered === "premium"
                    ? "var(--accent-line)"
                    : "var(--accent-soft)",
                border: "var(--border-w) solid var(--accent-line)",
                cursor: "pointer",
                transition:
                  "background-color var(--dur) var(--ease-inout), border-color var(--dur) var(--ease-inout), transform var(--dur) var(--ease-out)",
              }}
            >
              <Icon.star size={14} color="var(--accent)" fill="var(--accent)" />
              <span style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 13, color: "var(--accent)" }}>{fmtTokens(tokens)}</span>
            </Link>
            {premiumTipVisible && (
              <div
                id="premium-tooltip"
                role="tooltip"
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
          </div>

          {/* Notification bell + live panel */}
          <NotificationBell />

        </div>
      </div>
    </header>
    <nav data-testid="mobile-navigation" className="gg-mobile-nav" aria-label="Primary navigation">
      {NAV.map(({ href, label, icon: ItemIcon }) => {
        const active = path === href;
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className="gg-mobile-nav__item"
          >
            <ItemIcon size={21} color={active ? "var(--violet-bright)" : "var(--text-muted)"} strokeWidth={2} />
            <span>{label}</span>
          </Link>
        );
      })}
    </nav>
    </>
  );
}

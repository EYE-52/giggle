"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { colors, radii } from "./tokens";

const navItems = [
  { href: "/home", label: "Home", icon: "⊞" },
  { href: "/discover", label: "Discover", icon: "⊙" },
  { href: "/profile", label: "Profile", icon: "◎" },
  { href: "/premium", label: "Premium", icon: "✦" },
];

export function SideNav() {
  const pathname = usePathname();
  return (
    <nav
      style={{
        width: 220,
        minHeight: "100vh",
        background: colors.surface,
        borderRight: `1px solid ${colors.border}`,
        display: "flex",
        flexDirection: "column",
        padding: "28px 16px",
        flexShrink: 0,
      }}
    >
      <div
        style={{
          fontFamily: "Space Grotesk, sans-serif",
          fontWeight: 700,
          fontSize: 22,
          color: colors.violet,
          marginBottom: 36,
          paddingLeft: 8,
          letterSpacing: -0.5,
        }}
      >
        Giggle
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {navItems.map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "10px 12px",
                borderRadius: radii.input,
                background: active ? colors.violetSoft : "transparent",
                color: active ? colors.violet : colors.textSecondary,
                fontFamily: "Inter, sans-serif",
                fontWeight: active ? 600 : 400,
                fontSize: 15,
                textDecoration: "none",
                transition: "background 0.15s, color 0.15s",
              }}
            >
              <span style={{ fontSize: 18 }}>{item.icon}</span>
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

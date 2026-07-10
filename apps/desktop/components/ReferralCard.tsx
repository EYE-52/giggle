"use client";
import { useState, useEffect, useCallback } from "react";
import { api, billing, type ReferralInfo } from "@giggle/core";
import { Icon } from "./Icons";
import { useViewport } from "./useViewport";

/**
 * Invite-for-tokens card. Shows the signed-in user's referral code + link.
 * When a friend signs up via the link, BOTH sides are credited tokens
 * (server-side in authController). We refresh on mount and sync any newly
 * earned tokens into the local wallet so the balance updates live.
 */
export function ReferralCard({ compact = false }: { compact?: boolean }) {
  const { isPhone } = useViewport();
  const [info, setInfo] = useState<ReferralInfo | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [origin, setOrigin] = useState("");

  const load = useCallback(async () => {
    try {
      const data = await api.getReferral();
      setInfo(data);
      // A referrer's tokens accrue server-side; mirror the increase into wallet.
      if (typeof data.tokens === "number") billing.syncServerTokens(data.tokens);
    } catch {
      // not authed / offline — card stays hidden
    }
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined") setOrigin(window.location.origin);
    load();
  }, [load]);

  if (!info) return null;

  const reward = info.rewardPerInvite;
  const link = `${origin}/?ref=${info.code}`;

  async function writeReferralLink() {
    try {
      await navigator.clipboard.writeText(link);
      return true;
    } catch {}

    try {
      const ta = document.createElement("textarea");
      ta.value = link;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const copiedOk = document.execCommand("copy");
      ta.remove();
      return copiedOk;
    } catch {
      return false;
    }
  }

  async function copy() {
    setCopyError(null);
    const copiedOk = await writeReferralLink();
    if (!copiedOk) {
      setCopyError("Couldn't copy invite link. Select the link and copy it manually.");
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  async function share() {
    const shareData = {
      title: "Join me on Giggle",
      text: `Meet new squads on Giggle — use my invite and we both get ${reward} tokens!`,
      url: link,
    };
    if (typeof navigator !== "undefined" && "share" in navigator && typeof navigator.share === "function") {
      try {
        await navigator.share(shareData);
        return;
      } catch {
        // user cancelled or share sheet failed; fall through to copy
      }
    }
    copy();
  }

  const text = "var(--text)";
  const muted = "var(--text-muted)";
  const dim = "var(--text-dim)";
  const border = "var(--border)";

  return (
    <div style={{
      position: "relative",
      overflow: "hidden",
      background: "linear-gradient(135deg, var(--violet-soft) 0%, rgba(194,255,61,0.07) 100%)",
      border: `1px solid ${border}`,
      borderRadius: 24,
      padding: isPhone ? "20px 18px" : compact ? "22px 24px" : "28px 32px",
      display: "flex",
      flexDirection: "column",
      gap: 18,
    }}>
      {/* accent bar */}
      <div style={{
        position: "absolute", top: 0, left: 0, right: 0, height: 3,
        background: "linear-gradient(90deg, var(--violet), var(--lime))",
      }} />

      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap" as const }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <span style={{
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              width: 30, height: 30, borderRadius: 10,
              background: "var(--violet-soft)", border: "1px solid rgba(124,92,255,0.3)",
            }}>
              <Icon.gift size={17} color="var(--violet)" />
            </span>
            <span style={{ fontFamily: "var(--font-space-grotesk)", fontSize: isPhone ? 18 : 20, fontWeight: 800, color: text, letterSpacing: "-0.02em" }}>
              Invite friends, earn tokens
            </span>
          </div>
          <div style={{ fontSize: 13.5, color: muted, lineHeight: 1.5, maxWidth: 460 }}>
            Share your link. When a friend joins, <strong style={{ color: text }}>you both get {reward} tokens</strong> — instantly.
          </div>
        </div>

        {/* invited counter */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2, flexShrink: 0 }}>
          <span style={{ fontFamily: "var(--font-space-grotesk)", fontSize: isPhone ? 28 : 34, fontWeight: 800, color: text, letterSpacing: "-0.02em", lineHeight: 1 }}>
            {info.referralCount}
          </span>
          <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.1em", color: dim, textTransform: "uppercase" }}>
            Invited
          </span>
        </div>
      </div>

      {/* link + actions */}
      <div style={{ display: "flex", gap: 10, flexWrap: isPhone ? "wrap" as const : "nowrap" as const }}>
        <div style={{
          flex: 1, minWidth: isPhone ? "100%" : 200,
          display: "flex", alignItems: "center", gap: 10,
          background: "var(--bg)", border: `1px solid ${border}`,
          borderRadius: 12, padding: "11px 14px",
          fontFamily: "var(--font-space-grotesk)", fontSize: 14, color: text,
          overflow: "hidden",
        }}>
          <Icon.link size={15} color={dim} />
          <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {origin.replace(/^https?:\/\//, "")}/?ref={info.code}
          </span>
        </div>
        <button
          onClick={copy}
          style={{
            flexShrink: 0,
            background: copied ? "var(--lime)" : "var(--overlay)",
            border: copied ? "1px solid var(--lime)" : `1px solid ${border}`,
            color: copied ? "#0B0B0F" : text,
            borderRadius: 12, padding: "0 16px", height: 44,
            fontWeight: 700, fontSize: 14, cursor: "pointer",
            display: "inline-flex", alignItems: "center", gap: 7,
            transition: "all .15s ease",
          }}
        >
          <Icon.copy size={15} color={copied ? "#0B0B0F" : text} />
          {copied ? "Copied!" : "Copy"}
        </button>
        <button
          onClick={share}
          style={{
            flexShrink: 0,
            background: "var(--violet)",
            border: "1px solid var(--violet)",
            color: "#fff",
            borderRadius: 12, padding: "0 18px", height: 44,
            fontWeight: 700, fontSize: 14, cursor: "pointer",
            display: "inline-flex", alignItems: "center", gap: 7,
            boxShadow: "0 0 22px -8px rgba(124,92,255,0.8)",
          }}
        >
          <Icon.share size={15} color="#fff" />
          Share
        </button>
      </div>
      {copyError && (
        <div role="alert" style={{ fontSize: 12.5, color: "var(--coral)", fontWeight: 700, lineHeight: 1.35 }}>
          {copyError}
        </div>
      )}
    </div>
  );
}

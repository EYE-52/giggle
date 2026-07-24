"use client";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Avatar } from "@/components/Avatar";
import { AvatarArt } from "@/components/AvatarArt";
import { AvatarPicker } from "@/components/AvatarPicker";
import { Icon } from "@/components/Icons";
import { billing, getMyAvatar, subscribeAvatar, session, DEFAULT_AVATAR_ID, api, type UserProfile } from "@giggle/core";
import { useViewport } from "@/components/useViewport";
import { Button } from "@/components/Button";
import { Modal } from "@/components/Modal";
import { Switch } from "@/components/Switch";

const CURATED_VIBES = ["Gaming", "Music", "Chill", "Comedy", "Deep Talks", "Late Night", "Sports", "Art", "Study", "Hype", "Fitness", "Foodies"];
const VIBE_STORAGE_KEY = "giggle.vibes";
const PROFILE_SETTINGS_STORAGE_KEY = "giggle.profile.settings";

const DEFAULT_VIBES = ["Gaming", "Music", "Chill", "Late Night", "Deep Talks"];
const MAX_PROFILE_VIBES = 5;
const DEFAULT_PROFILE_SETTINGS = {
  notificationsOn: true,
  openToDiscovery: true,
  showOnlineStatus: false,
};

type ProfileSettingKey = keyof typeof DEFAULT_PROFILE_SETTINGS;
type ProfileSettings = typeof DEFAULT_PROFILE_SETTINGS;

const GENDER_OPTIONS: { value: string; label: string }[] = [
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
  { value: "nonbinary", label: "Non-binary" },
  { value: "other", label: "Other" },
  { value: "prefer_not", label: "Prefer not to say" },
];

const COMMON_COUNTRIES: { code: string; label: string; flag: string }[] = [
  { code: "US", label: "United States", flag: "🇺🇸" },
  { code: "IN", label: "India", flag: "🇮🇳" },
  { code: "GB", label: "United Kingdom", flag: "🇬🇧" },
  { code: "CA", label: "Canada", flag: "🇨🇦" },
  { code: "AU", label: "Australia", flag: "🇦🇺" },
  { code: "DE", label: "Germany", flag: "🇩🇪" },
  { code: "FR", label: "France", flag: "🇫🇷" },
  { code: "ES", label: "Spain", flag: "🇪🇸" },
  { code: "BR", label: "Brazil", flag: "🇧🇷" },
  { code: "JP", label: "Japan", flag: "🇯🇵" },
  { code: "MX", label: "Mexico", flag: "🇲🇽" },
  { code: "NG", label: "Nigeria", flag: "🇳🇬" },
];
const MAX_LANGUAGES = 6;

function normalizeProfileVibes(value: unknown, fallback: string[] = DEFAULT_VIBES): string[] {
  if (!Array.isArray(value)) return fallback;
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") continue;
    const label = item.replace(/^[^\w]+/, "").replace(/\s+/g, " ").trim().slice(0, 15);
    if (!label) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(label);
    if (normalized.length >= MAX_PROFILE_VIBES) break;
  }
  return normalized.length ? normalized : fallback;
}

function normalizeProfileSettings(value: unknown): ProfileSettings {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value as Partial<ProfileSettings>
    : {};

  return {
    notificationsOn: typeof source.notificationsOn === "boolean"
      ? source.notificationsOn
      : DEFAULT_PROFILE_SETTINGS.notificationsOn,
    openToDiscovery: typeof source.openToDiscovery === "boolean"
      ? source.openToDiscovery
      : DEFAULT_PROFILE_SETTINGS.openToDiscovery,
    showOnlineStatus: typeof source.showOnlineStatus === "boolean"
      ? source.showOnlineStatus
      : DEFAULT_PROFILE_SETTINGS.showOnlineStatus,
  };
}

/** Stable module-scoped row so toggling a Switch doesn't remount it (an inline
 *  component would be a new type each render, killing the thumb animation). */
function SwitchRow({ label, desc, value, onChange }: { label: string; desc: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 0", borderBottom: "1px solid var(--border)", gap: 12 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ color: "var(--text)", fontSize: 14, fontWeight: 600 }}>{label}</div>
        <div style={{ color: "var(--text-dim)", fontSize: 12, marginTop: 2 }}>{desc}</div>
      </div>
      <Switch checked={value} onChange={onChange} ariaLabel={label} />
    </div>
  );
}

export default function ProfilePage() {
  const router = useRouter();
  const { isPhone, isTablet } = useViewport();

  const violet = "var(--accent, var(--violet))";
  const coral = "var(--coral)";
  const textPrimary = "var(--text)";
  const textMuted = "var(--text-muted)";
  const textTertiary = "var(--text-dim)";
  const surface: React.CSSProperties = {
    background: "linear-gradient(160deg, var(--surface-grad-from) 0%, var(--surface-grad-to) 100%)",
    border: "var(--control-border, 1px solid var(--border))",
    borderRadius: "var(--radius-card, 20px)",
    padding: isPhone ? 16 : 24,
    boxShadow: "var(--shadow-card, var(--elev))",
  };
  const settingsSection: React.CSSProperties = {
    padding: isPhone ? 16 : 24,
    borderBottom: "1px solid var(--border)",
  };
  // Vibe preferences state (persisted to localStorage)
  const [vibes, setVibes] = useState<string[]>(() => normalizeProfileVibes(DEFAULT_VIBES));
  const [vibePickerOpen, setVibePickerOpen] = useState(false);

  // Premium state from billing module
  const [isPremium, setIsPremium] = useState(false);

  useEffect(() => {
    setIsPremium(billing.isPremium());
    const unsub = billing.subscribe((e) => setIsPremium(e.premium));
    return unsub;
  }, []);

  // Real signed-in identity — read after mount (SSR-safe; session lives in memory/localStorage)
  const [user, setUser] = useState<{ name: string; email?: string } | null>(null);
  useEffect(() => {
    const u = session.user;
    if (u) setUser({ name: u.name, email: u.email });
  }, []);
  const displayName = user?.name ?? "Your Profile";

  // Account toggles
  const manageAccountRef = useRef<HTMLElement>(null);
  const [notificationsOn, setNotificationsOn] = useState(true);
  const [openToDiscovery, setOpenToDiscovery] = useState(true);
  const [showOnlineStatus, setShowOnlineStatus] = useState(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(VIBE_STORAGE_KEY);
      if (stored) setVibes(normalizeProfileVibes(JSON.parse(stored)));
    } catch {}
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(PROFILE_SETTINGS_STORAGE_KEY);
      if (!raw) return;
      const parsed = normalizeProfileSettings(JSON.parse(raw));
      setNotificationsOn(parsed.notificationsOn);
      setOpenToDiscovery(parsed.openToDiscovery);
      setShowOnlineStatus(parsed.showOnlineStatus);
    } catch {}
  }, []);

  function setProfileSetting(key: ProfileSettingKey, value: boolean) {
    if (key === "notificationsOn") setNotificationsOn(value);
    if (key === "openToDiscovery") setOpenToDiscovery(value);
    if (key === "showOnlineStatus") setShowOnlineStatus(value);
    try {
      const raw = localStorage.getItem(PROFILE_SETTINGS_STORAGE_KEY);
      const current = raw ? normalizeProfileSettings(JSON.parse(raw)) : DEFAULT_PROFILE_SETTINGS;
      localStorage.setItem(PROFILE_SETTINGS_STORAGE_KEY, JSON.stringify({
        ...current,
        [key]: value,
      }));
    } catch {}
  }

  function toggleVibe(vibe: string) {
    setVibes(prev => {
      const label = normalizeProfileVibes([vibe])[0];
      if (!label) return prev;
      const exists = prev.some(v => v.replace(/^[^\w]+/, "").trim() === label || v === label);
      let nextRaw: string[];
      if (exists) {
        nextRaw = prev.filter(v => !(v.replace(/^[^\w]+/, "").trim().toLowerCase() === label.toLowerCase() || v.toLowerCase() === label.toLowerCase()));
      } else {
        nextRaw = [...prev, label];
      }
      const next = normalizeProfileVibes(nextRaw, []);
      try { localStorage.setItem(VIBE_STORAGE_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  }

  function removeVibe(vibe: string) {
    setVibes(prev => {
      const key = vibe.replace(/^[^\w]+/, "").trim().toLowerCase();
      const next = normalizeProfileVibes(prev.filter(v => v.replace(/^[^\w]+/, "").trim().toLowerCase() !== key), []);
      try { localStorage.setItem(VIBE_STORAGE_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  }

  function addCuratedVibe(vibe: string) {
    setVibes(prev => {
      if (prev.some(v => v.replace(/^[^\w]+/, "").trim() === vibe || v === vibe)) return prev;
      const next = normalizeProfileVibes([...prev, vibe], []);
      try { localStorage.setItem(VIBE_STORAGE_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  }

  // Avatar state — SSR-safe: default on server, real value after mount
  const [myAvatar, setMyAvatarState] = useState<string>(DEFAULT_AVATAR_ID);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [avatarHover, setAvatarHover] = useState(false);

  useEffect(() => {
    // Sync value after mount (localStorage may differ from SSR default)
    setMyAvatarState(getMyAvatar());
    return subscribeAvatar((v) => setMyAvatarState(v));
  }, []);

  // Demographics ("About you") — SSR-safe: empty defaults, fetch on mount
  const [gender, setGender] = useState("");
  const [age, setAge] = useState("");
  const [languages, setLanguages] = useState<string[]>([]);
  const [country, setCountry] = useState("");
  const [langDraft, setLangDraft] = useState("");
  const [loadedProfile, setLoadedProfile] = useState<UserProfile | null>(null);
  const [savingDemo, setSavingDemo] = useState(false);
  const [savedDemo, setSavedDemo] = useState(false);
  const [demoError, setDemoError] = useState<string | null>(null);
  const [langInputFocus, setLangInputFocus] = useState(false);
  const [ageFocus, setAgeFocus] = useState(false);
  const [countryFocus, setCountryFocus] = useState(false);
  // True once the user edits any About-You field — a late-arriving fetch must
  // not clobber in-progress edits (it still becomes the dirty-check baseline).
  const demoTouchedRef = useRef(false);

  useEffect(() => {
    let active = true;
    api.getMyProfile().then((p) => {
      if (!active) return;
      setLoadedProfile(p);
      if (demoTouchedRef.current) return;
      setGender(p.gender ?? "");
      setAge(p.age != null ? String(p.age) : "");
      setLanguages(p.languages ?? []);
      setCountry(p.country ?? "");
    }).catch(() => {});
    return () => { active = false; };
  }, []);

  function addLanguage(raw: string) {
    const lang = raw.trim();
    if (!lang) return;
    demoTouchedRef.current = true;
    setLanguages((prev) => {
      if (prev.length >= MAX_LANGUAGES) return prev;
      if (prev.some((l) => l.toLowerCase() === lang.toLowerCase())) return prev;
      return [...prev, lang];
    });
    setLangDraft("");
  }
  function removeLanguage(lang: string) {
    demoTouchedRef.current = true;
    setLanguages((prev) => prev.filter((l) => l !== lang));
  }

  // Dirty check against the loaded profile — Save stays disabled until
  // something actually changed (no fake "Saved" flash on a no-op).
  const demoDirty =
    gender !== (loadedProfile?.gender ?? "") ||
    country.trim() !== (loadedProfile?.country ?? "") ||
    age.trim() !== (loadedProfile?.age != null ? String(loadedProfile.age) : "") ||
    JSON.stringify(languages) !== JSON.stringify(loadedProfile?.languages ?? []);

  async function saveDemographics() {
    setDemoError(null);
    const body: { gender?: string; age?: number | null; languages?: string[]; country?: string } = {};
    const trimmedCountry = country.trim();
    if (gender !== (loadedProfile?.gender ?? "")) body.gender = gender;
    if (trimmedCountry !== (loadedProfile?.country ?? "")) body.country = trimmedCountry;
    const langChanged = JSON.stringify(languages) !== JSON.stringify(loadedProfile?.languages ?? []);
    if (langChanged) body.languages = languages;
    const ageStr = age.trim();
    const prevAgeStr = loadedProfile?.age != null ? String(loadedProfile.age) : "";
    if (ageStr !== prevAgeStr) {
      if (ageStr === "") {
        body.age = null;
      } else {
        const n = Number(ageStr);
        if (!Number.isInteger(n) || n < 13 || n > 120) {
          setDemoError("Age must be a whole number between 13 and 120.");
          return;
        }
        body.age = n;
      }
    }
    if (Object.keys(body).length === 0) return;
    setSavingDemo(true);
    try {
      const updated = await api.updateMyProfile(body);
      setLoadedProfile(updated);
      setGender(updated.gender ?? "");
      setAge(updated.age != null ? String(updated.age) : "");
      setLanguages(updated.languages ?? []);
      setCountry(updated.country ?? "");
      demoTouchedRef.current = false;
      setSavedDemo(true);
      setTimeout(() => setSavedDemo(false), 1800);
    } catch (e) {
      setDemoError(e instanceof Error ? e.message : "Couldn't save. Please try again.");
    } finally {
      setSavingDemo(false);
    }
  }

  // Hover states
  const [vibeTagHover, setVibeTagHover] = useState<string | null>(null);
  const [upgradeCardHover, setUpgradeCardHover] = useState(false);
  const [vibeChipHover, setVibeChipHover] = useState<string | null>(null);
  const [logoutConfirm, setLogoutConfirm] = useState(false);

  // Responsive layout: single column on tablet/phone, 2-col on desktop
  const outerGrid: React.CSSProperties = isTablet
    ? { display: "flex", flexDirection: "column", gap: isPhone ? 16 : 20 }
    : { display: "grid", gridTemplateColumns: "300px 1fr", gap: 24, alignItems: "start" };

  return (
    <>
    <div className="gg-reveal" style={outerGrid}>
      {/* LEFT COLUMN — Avatar + Score + Stats. Sticky on desktop so the short
          column tracks the (much taller) right column instead of leaving a void. */}
      <div style={{ display: "flex", flexDirection: "column", gap: isPhone ? 14 : 16, ...(isTablet ? {} : { position: "sticky", top: 24 }) }}>
        {/* Avatar card */}
        <div style={{ ...surface, display: "flex", flexDirection: "column", alignItems: "center", gap: 14, paddingTop: isPhone ? 22 : 26, paddingBottom: isPhone ? 18 : 22 }}>
          {/* Avatar — click to edit */}
          <button
            onClick={() => setPickerOpen(true)}
            onMouseEnter={() => setAvatarHover(true)}
            onMouseLeave={() => setAvatarHover(false)}
            onFocus={() => setAvatarHover(true)}
            onBlur={() => setAvatarHover(false)}
            aria-label="Edit avatar"
            style={{
              position: "relative", width: 120, height: 120,
              border: "none", background: "none", padding: 0,
              cursor: "pointer",
            }}
          >
            <div style={{ position: "absolute", inset: 0, borderRadius: "50%", overflow: "hidden", border: avatarHover ? "3px solid var(--accent, var(--violet))" : "3px solid var(--border-strong)", transition: "border-color .16s ease" }}>
              <AvatarArt value={myAvatar} size={114} />
            </div>
            {/* Persistent edit affordance — visible without hover (touch/keyboard) */}
            <div aria-hidden style={{
              position: "absolute", bottom: 4, left: 4, width: 24, height: 24,
              borderRadius: "50%", background: "var(--surface-2)",
              border: "1.5px solid var(--border-strong)",
              display: "flex", alignItems: "center", justifyContent: "center",
              boxShadow: "0 2px 8px rgba(0,0,0,0.35)",
            }}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" stroke="var(--text-muted)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            {/* Edit overlay */}
            <div style={{
              position: "absolute", inset: 0, borderRadius: "50%",
              background: "var(--overlay-strong)",
              display: "flex", alignItems: "center", justifyContent: "center",
              opacity: avatarHover ? 1 : 0,
              transition: "opacity 0.18s",
            }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            {/* Verified badge — premium members only */}
            {isPremium && (
              <div style={{
                position: "absolute", bottom: 4, right: 4, width: 24, height: 24,
                borderRadius: "50%", background: "var(--accent, var(--violet))",
                display: "flex", alignItems: "center", justifyContent: "center",
                border: "2.5px solid var(--bg)",
              }}>
                <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden><path d="M2 5.5 4.5 8 9 3" stroke="#fff" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </div>
            )}
          </button>
          <div style={{ textAlign: "center", display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, justifyContent: "center" }}>
              <h1 style={{ fontFamily: "var(--font-display, var(--font-space-grotesk))", fontSize: 22, fontWeight: 700, color: textPrimary, letterSpacing: "-0.02em", margin: 0 }}>{displayName}</h1>
            </div>
          </div>
        </div>

        {/* Giggle+ status */}
        {isPremium ? (
          <div style={{ ...surface, background: `linear-gradient(135deg, color-mix(in srgb, var(--accent, var(--violet)) 22%, transparent) 0%, color-mix(in srgb, var(--live, var(--lime)) 8%, transparent) 100%)`, display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 36, height: 36, borderRadius: "var(--radius-control, 14px)", background: `linear-gradient(135deg, var(--accent, var(--violet)), var(--live, var(--lime)))`, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Icon.star size={18} color="var(--live-contrast)" fill="var(--live-contrast)" />
          </div>
            <div>
              <div style={{ fontFamily: "var(--font-display, var(--font-space-grotesk))", fontSize: 17, fontWeight: 700, color: textPrimary, letterSpacing: "-0.02em" }}>Giggle+ Active</div>
              <div style={{ color: textMuted, fontSize: 12 }}>Premium member</div>
            </div>
          </div>
        ) : (
          <div
            role="button"
            tabIndex={0}
            aria-label="Upgrade to Giggle+"
            onClick={() => router.push("/premium")}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") { e.preventDefault(); router.push("/premium"); }
            }}
            onMouseEnter={() => setUpgradeCardHover(true)}
            onMouseLeave={() => setUpgradeCardHover(false)}
            className="gg-press-card gg-focusable"
            style={{
              ...surface, cursor: "pointer",
              background: upgradeCardHover
                ? "linear-gradient(135deg, color-mix(in srgb, var(--accent, var(--violet)) 32%, transparent) 0%, var(--surface-grad-to) 100%)"
                : "linear-gradient(135deg, color-mix(in srgb, var(--accent, var(--violet)) 22%, transparent) 0%, var(--surface-grad-to) 100%)",
              border: upgradeCardHover ? "1px solid color-mix(in srgb, var(--accent, var(--violet)) 40%, transparent)" : "var(--control-border, 1px solid var(--border))",
              display: "flex", alignItems: "center", justifyContent: "space-between",
              transition: "all .15s ease",
              transform: upgradeCardHover ? "translateY(-1px)" : "translateY(0)",
            }}
          >
            <div>
              <div style={{ fontFamily: "var(--font-display, var(--font-space-grotesk))", fontSize: 17, fontWeight: 700, color: textPrimary, letterSpacing: "-0.02em" }}>Giggle+</div>
              <div style={{ color: textMuted, fontSize: 13, marginTop: 2 }}>Monthly token stipend + 15% bonus tokens on packs</div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{
                background: violet, color: "#fff", borderRadius: 999, padding: "4px 12px",
                fontSize: 12, fontWeight: 700, transition: "all .15s ease",
              }}>Upgrade</span>
              <Icon.chevron size={18} color={violet} />
            </div>
          </div>
        )}
      </div>

      {/* RIGHT COLUMN — Prefs + Settings + Manage Account + Log Out */}
      <div style={{ display: "flex", flexDirection: "column", gap: isPhone ? 16 : 18 }}>
        <div style={{ ...surface, padding: 0, overflow: "hidden" }}>
        {/* Vibe Preferences */}
        <section style={settingsSection}>
          <h2 style={{ fontFamily: "var(--font-display, var(--font-space-grotesk))", fontSize: 22, fontWeight: 700, color: textPrimary, margin: "0 0 14px", letterSpacing: "-0.02em" }}>Vibe Preferences</h2>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
            {vibes.map(t => (
              <button
                key={t}
                onClick={() => removeVibe(t)}
                onMouseEnter={() => setVibeTagHover(t)}
                onMouseLeave={() => setVibeTagHover(null)}
                className="gg-press"
                style={{
                  background: vibeTagHover === t ? "color-mix(in srgb, var(--accent, var(--violet)) 20%, transparent)" : "color-mix(in srgb, var(--accent, var(--violet)) 13%, transparent)",
                  color: violet, borderRadius: 20, padding: "0 16px", minHeight: 44,
                  fontSize: 14, fontWeight: 500,
                  border: `1px solid ${vibeTagHover === t ? "color-mix(in srgb, var(--accent, var(--violet)) 53%, transparent)" : "color-mix(in srgb, var(--accent, var(--violet)) 27%, transparent)"}`,
                  cursor: "pointer",
                  display: "flex", alignItems: "center", gap: 6,
                  transition: "all .15s ease",
                  transform: vibeTagHover === t ? "translateY(-1px)" : "translateY(0)",
                }}
              >
                {t}
                <Icon.close size={12} color={violet} />
              </button>
            ))}
            <Button
              onClick={() => setVibePickerOpen(true)}
              variant="tonal"
              style={{ borderRadius: 20, fontSize: 14, fontWeight: 500, padding: "0 16px" }}
            >
              <Icon.plus size={14} color={violet} />
              Add More
            </Button>
          </div>

          {/* Curated vibe picker */}
          {vibePickerOpen && (
            <div className="gg-toast" style={{ marginTop: 16, padding: 16, background: "var(--overlay)", borderRadius: "var(--radius-control, 14px)", border: "var(--control-border, 1px solid var(--border))" }}>
              <div style={{ color: textMuted, fontSize: 12, marginBottom: 10, display: "flex", justifyContent: "space-between" }}>
                <span>Pick vibes to add · {vibes.length}/{MAX_PROFILE_VIBES}</span>
                <button onClick={() => setVibePickerOpen(false)} aria-label="Close vibe picker" style={{ minWidth: 44, minHeight: 44, display: "inline-flex", alignItems: "center", justifyContent: "center", background: "none", border: "none", color: textMuted, cursor: "pointer" }}>
                  <Icon.close size={14} color={textMuted} />
                </button>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {CURATED_VIBES.map(vibe => {
                  const active = vibes.some(v => v.replace(/^[^\w]+/, "").trim() === vibe || v === vibe);
                  const hovered = vibeChipHover === vibe;
                  // Once at the cap, only already-selected chips (which remove)
                  // stay interactive; adding more is disabled rather than a
                  // silent no-op that truncates the just-clicked vibe.
                  const disabled = !active && vibes.length >= MAX_PROFILE_VIBES;
                  return (
                    <button
                      key={vibe}
                      disabled={disabled}
                      onClick={() => active ? removeVibe(vibe) : addCuratedVibe(vibe)}
                      onMouseEnter={() => !disabled && setVibeChipHover(vibe)}
                      onMouseLeave={() => setVibeChipHover(null)}
                      className="gg-press"
                      title={disabled ? `You can pick up to ${MAX_PROFILE_VIBES} vibes` : undefined}
                      style={{
                        borderRadius: 999, padding: "0 14px", minHeight: 44, fontSize: 13, fontWeight: 500,
                        border: `1.5px solid ${active || (hovered && !disabled) ? violet : "var(--border-strong)"}`,
                        background: active ? "color-mix(in srgb, var(--accent, var(--violet)) 20%, transparent)" : (hovered && !disabled) ? "color-mix(in srgb, var(--accent, var(--violet)) 10%, transparent)" : "var(--overlay)",
                        color: active || (hovered && !disabled) ? violet : textMuted,
                        cursor: disabled ? "not-allowed" : "pointer", transition: "all .15s ease",
                        opacity: disabled ? 0.4 : 1,
                        transform: hovered && !active && !disabled ? "translateY(-1px)" : "translateY(0)",
                        boxShadow: hovered && !disabled ? "0 0 12px -4px color-mix(in srgb, var(--accent, var(--violet)) 40%, transparent)" : "none",
                      }}
                    >
                      {vibe}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </section>

        {/* About you — demographics editor */}
        <section style={settingsSection}>
          <h2 style={{ fontFamily: "var(--font-display, var(--font-space-grotesk))", fontSize: 22, fontWeight: 700, color: textPrimary, margin: "0 0 4px", letterSpacing: "-0.02em" }}>About You</h2>
          <div style={{ color: textMuted, fontSize: 13, marginBottom: 16 }}>Help us tailor your vibe matches.</div>

          {/* Gender — segmented control */}
          <div style={{ marginBottom: 18 }}>
            <div style={{ color: textPrimary, fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Gender</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {GENDER_OPTIONS.map((opt) => {
                const active = gender === opt.value;
                return (
                  <button
                    key={opt.value}
                    onClick={() => { demoTouchedRef.current = true; setGender(active ? "" : opt.value); }}
                    className="gg-press"
                    style={{
                      borderRadius: 999, padding: "0 14px", minHeight: 44, fontSize: 13, fontWeight: 600,
                      border: `1.5px solid ${active ? violet : "var(--border-strong)"}`,
                      background: active ? "color-mix(in srgb, var(--accent, var(--violet)) 20%, transparent)" : "var(--overlay)",
                      color: active ? violet : textMuted,
                      cursor: "pointer",
                      transition: "transform .14s ease, background .2s var(--ease-ui), border-color .2s var(--ease-ui), color .2s var(--ease-ui)",
                    }}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Age + Country row */}
          <div style={{ display: "grid", gridTemplateColumns: isPhone ? "1fr" : "1fr 1fr", gap: 14, marginBottom: 18 }}>
            <div>
              <div style={{ color: textPrimary, fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Age</div>
              <input
                type="number"
                min={13}
                max={120}
                value={age}
                onChange={(e) => { demoTouchedRef.current = true; setAge(e.target.value); }}
                onFocus={() => setAgeFocus(true)}
                onBlur={() => setAgeFocus(false)}
                placeholder="e.g. 24"
                style={{
                  width: "100%", boxSizing: "border-box", minHeight: 44, padding: "10px 14px", fontSize: 14,
                  borderRadius: "var(--radius-control, 14px)", border: ageFocus ? "1px solid var(--accent, var(--violet))" : "1px solid var(--border-strong)",
                  boxShadow: ageFocus ? "0 0 0 3px color-mix(in srgb, var(--accent, var(--violet)) 30%, transparent)" : "none",
                  background: "var(--overlay)", color: textPrimary, outline: "none",
                  transition: "box-shadow .2s var(--ease-ui), border-color .2s var(--ease-ui)",
                }}
              />
            </div>
            <div>
              <div style={{ color: textPrimary, fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Country</div>
              <div style={{ position: "relative", display: "flex" }}>
                <select
                  value={country}
                  onChange={(e) => { demoTouchedRef.current = true; setCountry(e.target.value); }}
                  onFocus={() => setCountryFocus(true)}
                  onBlur={() => setCountryFocus(false)}
                  style={{
                    width: "100%", boxSizing: "border-box", minHeight: 44, padding: "10px 34px 10px 14px", fontSize: 14,
                    borderRadius: "var(--radius-control, 14px)", border: countryFocus ? "1px solid var(--accent, var(--violet))" : "1px solid var(--border-strong)",
                    boxShadow: countryFocus ? "0 0 0 3px color-mix(in srgb, var(--accent, var(--violet)) 30%, transparent)" : "none",
                    background: "var(--overlay)", color: country ? textPrimary : textTertiary, outline: "none",
                    appearance: "none", WebkitAppearance: "none", MozAppearance: "none", cursor: "pointer",
                    transition: "box-shadow .2s var(--ease-ui), border-color .2s var(--ease-ui)",
                  }}
                >
                  <option value="">Select a country…</option>
                  {COMMON_COUNTRIES.map((c) => (
                    <option key={c.code} value={c.code}>{c.flag} {c.label}</option>
                  ))}
                  {/* Loaded country outside the common list — keep it selectable so it
                      displays and can't be silently wiped by the controlled select. */}
                  {country && !COMMON_COUNTRIES.some((c) => c.code === country) && (
                    <option value={country}>{country}</option>
                  )}
                </select>
                {/* Custom chevron — appearance:none strips the native arrow, so
                    supply our own affordance (matches the AgeGate DOB dropdowns). */}
                <span aria-hidden style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", pointerEvents: "none", display: "flex" }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                    <path d="m6 9 6 6 6-6" stroke={textMuted} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
              </div>
            </div>
          </div>

          {/* Languages — chip editor */}
          <div style={{ marginBottom: 18 }}>
            <div style={{ color: textPrimary, fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
              Languages <span style={{ color: textTertiary, fontWeight: 400 }}>({languages.length}/{MAX_LANGUAGES})</span>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
              {languages.map((lang) => (
                <span
                  key={lang}
                  style={{
                    background: "color-mix(in srgb, var(--accent, var(--violet)) 13%, transparent)", color: violet, borderRadius: 20, padding: "6px 12px",
                    fontSize: 13, fontWeight: 500, border: "1px solid color-mix(in srgb, var(--accent, var(--violet)) 27%, transparent)",
                    display: "flex", alignItems: "center", gap: 6,
                  }}
                >
                  {lang}
                  <button
                    onClick={() => removeLanguage(lang)}
                    aria-label={`Remove ${lang}`}
                  style={{ background: "none", border: "none", padding: 0, minWidth: 32, minHeight: 32, cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center" }}
                  >
                    <Icon.close size={12} color={violet} />
                  </button>
                </span>
              ))}
              {languages.length < MAX_LANGUAGES && (
                <input
                  value={langDraft}
                  onChange={(e) => setLangDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { e.preventDefault(); addLanguage(langDraft); }
                  }}
                  onFocus={() => setLangInputFocus(true)}
                  onBlur={() => setLangInputFocus(false)}
                  placeholder="Add language + Enter"
                  style={{
                    flex: "1 1 140px", minWidth: 120, minHeight: 44, padding: "7px 12px", fontSize: 13,
                    borderRadius: 20, background: "var(--overlay)", color: textPrimary, outline: "none",
                    border: `1.5px dashed ${langInputFocus ? violet : "var(--border-strong)"}`,
                    boxShadow: langInputFocus ? "0 0 0 3px color-mix(in srgb, var(--accent, var(--violet)) 30%, transparent)" : "none",
                    transition: "box-shadow .2s var(--ease-ui), border-color .2s var(--ease-ui)",
                  }}
                />
              )}
            </div>
          </div>

          {demoError && (
            <div className="gg-toast" style={{ color: coral, fontSize: 13, marginBottom: 12 }}>{demoError}</div>
          )}

          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <Button
              onClick={saveDemographics}
              loading={savingDemo}
              disabled={!demoDirty}
              style={{ fontFamily: "var(--font-display, var(--font-space-grotesk))", fontSize: 14 }}
            >
              {savingDemo ? "Saving…" : "Save"}
            </Button>
            {savedDemo && (
              <span className="gg-toast" style={{ color: "var(--lime-text)", fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden><path d="M2.5 7.5 6 11l5.5-7" stroke="var(--lime-text)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
                Saved
              </span>
            )}
          </div>
        </section>

        {/* Account — the real, functional settings (privacy + notifications) */}
        <section ref={manageAccountRef} style={{ ...settingsSection, borderBottom: "none" }}>
          <h2 style={{ fontFamily: "var(--font-display, var(--font-space-grotesk))", fontSize: 22, fontWeight: 700, color: textPrimary, margin: "0 0 4px", letterSpacing: "-0.02em" }}>Account</h2>
          {user?.email && (
            <div style={{ padding: "10px 0 14px", borderBottom: "1px solid var(--overlay)" }}>
              <div style={{ color: textTertiary, fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em" }}>Signed in as</div>
              <div style={{ color: textMuted, fontSize: 13, marginTop: 4, overflowWrap: "anywhere" }}>{user.email}</div>
            </div>
          )}
          <SwitchRow
            label="Notifications"
            desc="Receive push notifications for matches and messages"
            value={notificationsOn}
            onChange={(v) => setProfileSetting("notificationsOn", v)}
          />
          <SwitchRow
            label="Open to Discovery"
            desc="Let others find you via vibe matching"
            value={openToDiscovery}
            onChange={(v) => setProfileSetting("openToDiscovery", v)}
          />
          <SwitchRow
            label="Show Online Status"
            desc="Display when you are active on Giggle"
            value={showOnlineStatus}
            onChange={(v) => setProfileSetting("showOnlineStatus", v)}
          />
        </section>
        </div>

        {/* Log Out */}
        <Button
          onClick={() => setLogoutConfirm(true)}
          variant="danger"
          style={{
            alignSelf: isPhone ? "stretch" : "flex-start",
            minHeight: 48,
            padding: "0 32px",
            fontFamily: "var(--font-display, var(--font-space-grotesk))", fontSize: 14, fontWeight: 600,
          }}
        >
          <Icon.enter size={18} color={coral} />
          Log Out
        </Button>
      </div>
    </div>
    {logoutConfirm && (
      <Modal onClose={() => setLogoutConfirm(false)} title="Log out of Giggle?" subtitle="You can sign back in any time.">
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 6 }}>
          <Button variant="ghost" onClick={() => setLogoutConfirm(false)}>Cancel</Button>
          <Button variant="danger" onClick={() => { session.signOut(); router.push("/"); }}>Log out</Button>
        </div>
      </Modal>
    )}
    {pickerOpen && <AvatarPicker current={myAvatar} onClose={() => setPickerOpen(false)} />}
    </>
  );
}

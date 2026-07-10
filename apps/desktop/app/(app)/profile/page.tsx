"use client";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Avatar } from "@/components/Avatar";
import { AvatarArt } from "@/components/AvatarArt";
import { AvatarPicker } from "@/components/AvatarPicker";
import { Icon } from "@/components/Icons";
import { billing, getMyAvatar, subscribeAvatar, session, DEFAULT_AVATAR_ID, api, type UserProfile } from "@giggle/core";
import { useViewport } from "@/components/useViewport";

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

export default function ProfilePage() {
  const router = useRouter();
  const { isPhone, isTablet } = useViewport();

  const violet = "var(--violet)";
  const coral = "var(--coral)";
  const textPrimary = "var(--text)";
  const textMuted = "var(--text-muted)";
  const textTertiary = "var(--text-dim)";
  const surface: React.CSSProperties = {
    background: "linear-gradient(160deg, var(--surface-grad-from) 0%, var(--surface-grad-to) 100%)",
    border: "1px solid var(--border)",
    borderRadius: 20,
    padding: isPhone ? "16px 16px" : "20px 24px",
    boxShadow: "var(--elev)",
  };
  const iconTile = (color: string): React.CSSProperties => ({
    width: 40, height: 40, borderRadius: 12, background: `${color}22`,
    display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
  });

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
  const handle = user?.email
    ? "@" + user.email.split("@")[0].replace(/[^a-zA-Z0-9_]/g, "").toLowerCase()
    : "";

  // Account toggles
  const manageAccountRef = useRef<HTMLElement>(null);
  function openManageAccount() {
    manageAccountRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }
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
  const [saveDemoHover, setSaveDemoHover] = useState(false);
  const [ageFocus, setAgeFocus] = useState(false);
  const [countryFocus, setCountryFocus] = useState(false);

  useEffect(() => {
    let active = true;
    api.getMyProfile().then((p) => {
      if (!active) return;
      setLoadedProfile(p);
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
    setLanguages((prev) => {
      if (prev.length >= MAX_LANGUAGES) return prev;
      if (prev.some((l) => l.toLowerCase() === lang.toLowerCase())) return prev;
      return [...prev, lang];
    });
    setLangDraft("");
  }
  function removeLanguage(lang: string) {
    setLanguages((prev) => prev.filter((l) => l !== lang));
  }

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
    if (Object.keys(body).length === 0) {
      setSavedDemo(true);
      setTimeout(() => setSavedDemo(false), 1800);
      return;
    }
    setSavingDemo(true);
    try {
      const updated = await api.updateMyProfile(body);
      setLoadedProfile(updated);
      setGender(updated.gender ?? "");
      setAge(updated.age != null ? String(updated.age) : "");
      setLanguages(updated.languages ?? []);
      setCountry(updated.country ?? "");
      setSavedDemo(true);
      setTimeout(() => setSavedDemo(false), 1800);
    } catch (e) {
      setDemoError(e instanceof Error ? e.message : "Couldn't save. Please try again.");
    } finally {
      setSavingDemo(false);
    }
  }

  // Hover states
  const [settingsCardHover, setSettingsCardHover] = useState<string | null>(null);
  const [vibeTagHover, setVibeTagHover] = useState<string | null>(null);
  const [addMoreHover, setAddMoreHover] = useState(false);
  const [logOutHover, setLogOutHover] = useState(false);
  const [upgradeCardHover, setUpgradeCardHover] = useState(false);
  const [vibeChipHover, setVibeChipHover] = useState<string | null>(null);

  const SwitchRow = ({ label, desc, value, onChange }: { label: string; desc: string; value: boolean; onChange: (v: boolean) => void }) => (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 0", borderBottom: "1px solid var(--overlay)", gap: 12 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ color: textPrimary, fontSize: 14, fontWeight: 600 }}>{label}</div>
        <div style={{ color: textTertiary, fontSize: 12, marginTop: 2 }}>{desc}</div>
      </div>
      <button
        onClick={() => onChange(!value)}
        aria-label={label}
        aria-pressed={value}
        style={{
          width: 44, height: 44, borderRadius: 999, border: "none", cursor: "pointer",
          background: "transparent",
          position: "relative", transition: "all .15s ease", flexShrink: 0,
        }}
      >
        <div style={{
          position: "absolute", top: 10, left: 0,
          width: 44, height: 24, borderRadius: 12,
          background: value ? violet : "var(--overlay-hover)",
          transition: "background .15s ease",
        }}>
          <span style={{
            position: "absolute", top: 3, left: value ? 23 : 3,
            width: 18, height: 18, borderRadius: "50%", background: "#fff",
            transition: "left 0.2s", boxShadow: "0 1px 4px rgba(0,0,0,0.4)",
          }} />
        </div>
      </button>
    </div>
  );

  // Responsive layout: single column on tablet/phone, 2-col on desktop
  const outerGrid: React.CSSProperties = isTablet
    ? { display: "flex", flexDirection: "column", gap: isPhone ? 16 : 20 }
    : { display: "grid", gridTemplateColumns: "300px 1fr", gap: 24, alignItems: "start" };

  return (
    <div className="gg-reveal" style={outerGrid}>
      {/* LEFT COLUMN — Avatar + Score + Stats */}
      <div style={{ display: "flex", flexDirection: "column", gap: isPhone ? 14 : 16 }}>
        {/* Avatar card */}
        <div style={{ ...surface, display: "flex", flexDirection: "column", alignItems: "center", gap: 14, paddingTop: isPhone ? 22 : 26, paddingBottom: isPhone ? 18 : 22 }}>
          {/* Avatar with conic glow ring — click to edit */}
          <button
            onClick={() => setPickerOpen(true)}
            onMouseEnter={() => setAvatarHover(true)}
            onMouseLeave={() => setAvatarHover(false)}
            aria-label="Edit avatar"
            style={{
              position: "relative", width: 120, height: 120,
              border: "none", background: "none", padding: 0,
              cursor: "pointer",
            }}
          >
            <div style={{
              position: "absolute", inset: -5, borderRadius: "50%",
              background: "conic-gradient(from 0deg, var(--violet) 0%, var(--lime) 50%, var(--violet) 100%)",
              filter: "blur(8px)", opacity: avatarHover ? 1 : 0.85,
              transition: "opacity 0.2s",
            }} />
            <div style={{ position: "absolute", inset: 0, borderRadius: "50%", overflow: "hidden", border: "3px solid var(--bg)" }}>
              <AvatarArt value={myAvatar} size={114} />
            </div>
            {/* Edit overlay */}
            <div style={{
              position: "absolute", inset: 0, borderRadius: "50%",
              background: "rgba(11,11,15,0.5)",
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
                borderRadius: "50%", background: "#2563EB",
                display: "flex", alignItems: "center", justifyContent: "center",
                border: "2.5px solid var(--bg)",
              }}>
                <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden><path d="M2 5.5 4.5 8 9 3" stroke="#fff" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </div>
            )}
          </button>
          {pickerOpen && <AvatarPicker current={myAvatar} onClose={() => setPickerOpen(false)} />}
          <div style={{ textAlign: "center", display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, justifyContent: "center" }}>
              <h1 style={{ fontFamily: "var(--font-space-grotesk)", fontSize: 22, fontWeight: 700, color: textPrimary, letterSpacing: "-0.02em", margin: 0 }}>{displayName}</h1>
              {isPremium && (
                <span style={{ background: "#2563EB", borderRadius: "50%", width: 18, height: 18, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden><path d="M2 5.5 4 7.5 8 3" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </span>
              )}
            </div>
            {handle && <div style={{ color: textMuted, fontSize: 14 }}>{handle}</div>}
            {user?.email && <div style={{ color: textTertiary, fontSize: 12 }}>{user.email}</div>}
          </div>
        </div>

        {/* Giggle+ status */}
        {isPremium ? (
          <div style={{ ...surface, background: `linear-gradient(135deg, rgba(124,92,255,0.22) 0%, rgba(194,255,61,0.08) 100%)`, display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: `linear-gradient(135deg, var(--violet), var(--lime))`, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Icon.star size={18} color="#0B0B0F" fill="#0B0B0F" />
          </div>
            <div>
              <div style={{ fontFamily: "var(--font-space-grotesk)", fontSize: 14, fontWeight: 700, color: textPrimary, letterSpacing: "-0.02em" }}>Giggle+ Active</div>
              <div style={{ color: textMuted, fontSize: 12 }}>Premium member</div>
            </div>
          </div>
        ) : (
          <div
            onClick={() => router.push("/premium")}
            onMouseEnter={() => setUpgradeCardHover(true)}
            onMouseLeave={() => setUpgradeCardHover(false)}
            className="gg-press-card"
            style={{
              ...surface, cursor: "pointer",
              background: upgradeCardHover
                ? "linear-gradient(135deg, rgba(124,92,255,0.32) 0%, var(--surface-grad-to) 100%)"
                : "linear-gradient(135deg, rgba(124,92,255,0.22) 0%, var(--surface-grad-to) 100%)",
              border: upgradeCardHover ? `1px solid rgba(124,92,255,0.4)` : "1px solid var(--border)",
              display: "flex", alignItems: "center", justifyContent: "space-between",
              transition: "all .15s ease",
              transform: upgradeCardHover ? "translateY(-1px)" : "translateY(0)",
            }}
          >
            <div>
              <div style={{ fontFamily: "var(--font-space-grotesk)", fontSize: 15, fontWeight: 700, color: textPrimary, letterSpacing: "-0.02em" }}>Giggle+</div>
              <div style={{ color: textMuted, fontSize: 13, marginTop: 2 }}>Upgrade for premium vibes</div>
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
        {/* Vibe Preferences */}
        <section style={surface}>
          <div style={{ fontFamily: "var(--font-space-grotesk)", fontSize: 18, fontWeight: 700, color: textPrimary, marginBottom: 14, letterSpacing: "-0.02em" }}>Vibe Preferences</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
            {vibes.map(t => (
              <button
                key={t}
                onClick={() => removeVibe(t)}
                onMouseEnter={() => setVibeTagHover(t)}
                onMouseLeave={() => setVibeTagHover(null)}
                className="gg-press"
                style={{
                  background: vibeTagHover === t ? `${violet}33` : `${violet}22`,
                  color: violet, borderRadius: 20, padding: "0 16px", minHeight: 44,
                  fontSize: 14, fontWeight: 500,
                  border: `1px solid ${vibeTagHover === t ? violet + "88" : violet + "44"}`,
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
            <button
              onClick={() => setVibePickerOpen(true)}
              onMouseEnter={() => setAddMoreHover(true)}
              onMouseLeave={() => setAddMoreHover(false)}
              className="gg-press"
              style={{
                border: addMoreHover ? `1.5px dashed ${textMuted}` : "1.5px dashed var(--text-dim)",
                color: addMoreHover ? textMuted : textTertiary,
                borderRadius: 20, padding: "0 16px", minHeight: 44, fontSize: 14, cursor: "pointer",
                background: addMoreHover ? "var(--overlay)" : "transparent",
                display: "flex", alignItems: "center", gap: 6,
                transition: "all .15s ease",
              }}
            >
              <Icon.plus size={14} color={addMoreHover ? textMuted : textTertiary} />
              Add More
            </button>
          </div>

          {/* Curated vibe picker */}
          {vibePickerOpen && (
            <div className="gg-toast" style={{ marginTop: 16, padding: "16px", background: "var(--overlay)", borderRadius: 14, border: "1px solid var(--border)" }}>
              <div style={{ color: textMuted, fontSize: 12, marginBottom: 10, display: "flex", justifyContent: "space-between" }}>
                <span>Pick vibes to add</span>
                <button onClick={() => setVibePickerOpen(false)} aria-label="Close vibe picker" style={{ minWidth: 44, minHeight: 44, display: "inline-flex", alignItems: "center", justifyContent: "center", background: "none", border: "none", color: textMuted, cursor: "pointer" }}>
                  <Icon.close size={14} color={textMuted} />
                </button>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {CURATED_VIBES.map(vibe => {
                  const active = vibes.some(v => v.replace(/^[^\w]+/, "").trim() === vibe || v === vibe);
                  const hovered = vibeChipHover === vibe;
                  return (
                    <button
                      key={vibe}
                      onClick={() => active ? removeVibe(vibe) : addCuratedVibe(vibe)}
                      onMouseEnter={() => setVibeChipHover(vibe)}
                      onMouseLeave={() => setVibeChipHover(null)}
                      className="gg-press"
                      style={{
                        borderRadius: 999, padding: "0 14px", minHeight: 44, fontSize: 13, fontWeight: 500,
                        border: `1.5px solid ${active || hovered ? violet : "var(--border-strong)"}`,
                        background: active ? `${violet}33` : hovered ? `${violet}18` : "var(--overlay)",
                        color: active || hovered ? violet : textMuted,
                        cursor: "pointer", transition: "all .15s ease",
                        transform: hovered && !active ? "translateY(-1px)" : "translateY(0)",
                        boxShadow: hovered ? `0 0 12px -4px ${violet}66` : "none",
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
        <section style={surface}>
          <div style={{ fontFamily: "var(--font-space-grotesk)", fontSize: 18, fontWeight: 700, color: textPrimary, marginBottom: 4, letterSpacing: "-0.02em" }}>About You</div>
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
                    onClick={() => setGender(active ? "" : opt.value)}
                    className="gg-press"
                    style={{
                      borderRadius: 999, padding: "0 14px", minHeight: 44, fontSize: 13, fontWeight: 600,
                      border: `1.5px solid ${active ? violet : "var(--border-strong)"}`,
                      background: active ? `${violet}33` : "var(--overlay)",
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
                onChange={(e) => setAge(e.target.value)}
                onFocus={() => setAgeFocus(true)}
                onBlur={() => setAgeFocus(false)}
                placeholder="e.g. 24"
                style={{
                  width: "100%", boxSizing: "border-box", minHeight: 44, padding: "10px 14px", fontSize: 14,
                  borderRadius: 12, border: ageFocus ? "1px solid var(--violet)" : "1px solid var(--border-strong)",
                  boxShadow: ageFocus ? "0 0 0 3px color-mix(in srgb, var(--violet) 30%, transparent)" : "none",
                  background: "var(--overlay)", color: textPrimary, outline: "none",
                  transition: "box-shadow .2s var(--ease-ui), border-color .2s var(--ease-ui)",
                }}
              />
            </div>
            <div>
              <div style={{ color: textPrimary, fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Country</div>
              <select
                value={COMMON_COUNTRIES.some((c) => c.code === country) ? country : ""}
                onChange={(e) => setCountry(e.target.value)}
                onFocus={() => setCountryFocus(true)}
                onBlur={() => setCountryFocus(false)}
                style={{
                  width: "100%", boxSizing: "border-box", minHeight: 44, padding: "10px 14px", fontSize: 14,
                  borderRadius: 12, border: countryFocus ? "1px solid var(--violet)" : "1px solid var(--border-strong)",
                  boxShadow: countryFocus ? "0 0 0 3px color-mix(in srgb, var(--violet) 30%, transparent)" : "none",
                  background: "var(--overlay)", color: country ? textPrimary : textTertiary, outline: "none",
                  appearance: "none", cursor: "pointer",
                  transition: "box-shadow .2s var(--ease-ui), border-color .2s var(--ease-ui)",
                }}
              >
                <option value="">Select a country…</option>
                {COMMON_COUNTRIES.map((c) => (
                  <option key={c.code} value={c.code}>{c.flag} {c.label}</option>
                ))}
              </select>
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
                    background: `${violet}22`, color: violet, borderRadius: 20, padding: "6px 12px",
                    fontSize: 13, fontWeight: 500, border: `1px solid ${violet}44`,
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
                  onBlur={() => { setLangInputFocus(false); addLanguage(langDraft); }}
                  placeholder="Add language + Enter"
                  style={{
                    flex: "1 1 140px", minWidth: 120, minHeight: 44, padding: "7px 12px", fontSize: 13,
                    borderRadius: 20, background: "var(--overlay)", color: textPrimary, outline: "none",
                    border: `1.5px dashed ${langInputFocus ? violet : "var(--border-strong)"}`,
                    boxShadow: langInputFocus ? "0 0 0 3px color-mix(in srgb, var(--violet) 30%, transparent)" : "none",
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
            <button
              onClick={saveDemographics}
              disabled={savingDemo}
              onMouseEnter={() => setSaveDemoHover(true)}
              onMouseLeave={() => setSaveDemoHover(false)}
              className="gg-press"
              style={{
                padding: "10px 24px", borderRadius: 999, border: "none", minHeight: 40,
                cursor: savingDemo ? "default" : "pointer",
                background: saveDemoHover && !savingDemo ? "var(--violet-bright)" : violet,
                color: "var(--on-accent)", fontFamily: "var(--font-space-grotesk)",
                fontSize: 14, fontWeight: 700, opacity: savingDemo ? 0.7 : 1,
                transform: saveDemoHover && !savingDemo ? "translateY(-1px)" : "translateY(0)",
                display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
                transition: "transform .14s ease, background .2s var(--ease-ui), box-shadow .2s var(--ease-ui)",
              }}
            >
              {savingDemo ? (<><span className="gg-spinner" /> Saving…</>) : "Save"}
            </button>
            {savedDemo && (
              <span className="gg-toast" style={{ color: "var(--lime)", fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden><path d="M2.5 7.5 6 11l5.5-7" stroke="var(--lime)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
                Saved
              </span>
            )}
          </div>
        </section>

        {/* Giggle+ Premium row */}
        <section style={surface}>
          <div style={{ fontFamily: "var(--font-space-grotesk)", fontSize: 18, fontWeight: 700, color: textPrimary, marginBottom: 14, letterSpacing: "-0.02em" }}>Giggle+ / Premium</div>
          <div style={{
            display: "flex", alignItems: isPhone ? "flex-start" : "center",
            flexDirection: isPhone ? "column" : "row",
            justifyContent: "space-between", gap: isPhone ? 12 : 0,
            padding: isPhone ? "12px 14px" : "14px 18px",
            background: `linear-gradient(135deg, rgba(124,92,255,0.15), rgba(194,255,61,0.06))`,
            borderRadius: 14, border: `1px solid var(--violet-soft)`
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ width: 32, height: 32, borderRadius: 8, background: `linear-gradient(135deg, var(--violet), var(--lime))`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <Icon.star size={15} color="#0B0B0F" fill="#0B0B0F" />
              </div>
              <div>
                <div style={{ color: textPrimary, fontSize: 15, fontWeight: 700, letterSpacing: "-0.02em" }}>{isPremium ? "Premium Active" : "Unlock Premium"}</div>
                <div style={{ color: textMuted, fontSize: 13, marginTop: 2 }}>{isPremium ? "Member badge and cosmetic perks active" : "Member badge, premium cosmetics, token perks"}</div>
              </div>
            </div>
            {!isPremium && (
              <UpgradeButton onClick={() => router.push("/premium")} violet={violet} fullWidth={isPhone} />
            )}
          </div>
        </section>

        {/* Settings grid — 2-col on desktop/tablet, 1-col on phone */}
        <section style={surface}>
          <div style={{ fontFamily: "var(--font-space-grotesk)", fontSize: 18, fontWeight: 700, color: textPrimary, marginBottom: 14, letterSpacing: "-0.02em" }}>Settings</div>
          <div style={{ display: "grid", gridTemplateColumns: isPhone ? "1fr" : "1fr 1fr", gap: 12 }}>
            {[
              { icon: <Icon.account size={20} color={violet} />, title: "Account Details", desc: "Manage your info" },
              { icon: <Icon.bell size={20} color={violet} />, title: "Notifications", desc: "Alert preferences" },
              { icon: <Icon.shield size={20} color={violet} />, title: "Privacy & Safety", desc: "Control who sees you" },
              { icon: <Icon.settings size={20} color={violet} />, title: "Preferences", desc: "App customization" },
            ].map(({ icon, title, desc }) => (
              <SettingsCard
                key={title}
                icon={icon}
                title={title}
                desc={desc}
                violet={violet}
                iconTile={iconTile}
                textPrimary={textPrimary}
                textMuted={textMuted}
                textTertiary={textTertiary}
                isHovered={settingsCardHover === title}
                onHover={() => setSettingsCardHover(title)}
                onLeave={() => setSettingsCardHover(null)}
                onClick={openManageAccount}
              />
            ))}
          </div>
        </section>

        {/* Manage Account */}
        <section ref={manageAccountRef} style={surface}>
          <div style={{ fontFamily: "var(--font-space-grotesk)", fontSize: 18, fontWeight: 700, color: textPrimary, marginBottom: 4, letterSpacing: "-0.02em" }}>Manage Account</div>
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

        {/* Log Out */}
        <button
          onClick={() => { session.signOut(); router.push("/"); }}
          onMouseEnter={() => setLogOutHover(true)}
          onMouseLeave={() => setLogOutHover(false)}
          className="gg-press"
          style={{
            alignSelf: isPhone ? "stretch" : "flex-start",
            padding: "13px 32px",
            border: `1.5px solid ${logOutHover ? coral + "99" : coral + "55"}`,
            borderRadius: 999,
            background: logOutHover ? `${coral}18` : "transparent",
            color: coral,
            fontFamily: "var(--font-space-grotesk)", fontSize: 15, fontWeight: 600, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
            transform: logOutHover ? "translateY(-1px)" : "translateY(0)",
            transition: "transform .14s ease, background .2s var(--ease-ui), border-color .2s var(--ease-ui)",
          }}
        >
          <Icon.enter size={18} color={coral} />
          Log Out
        </button>
      </div>
    </div>
  );
}

// Sub-components extracted to avoid calling hooks conditionally

function UpgradeButton({ onClick, violet, fullWidth }: { onClick: () => void; violet: string; fullWidth?: boolean }) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="gg-press"
      style={{
        padding: "9px 20px", borderRadius: 999, border: "none", cursor: "pointer", minHeight: 40,
        background: hovered ? "var(--violet-bright)" : violet,
        color: "var(--on-accent)", fontFamily: "var(--font-space-grotesk)",
        fontSize: 13, fontWeight: 700,
        boxShadow: hovered ? `0 0 24px -4px ${violet}` : `0 0 16px -4px ${violet}`,
        transform: hovered ? "translateY(-1px)" : "translateY(0)",
        transition: "transform .14s ease, background .2s var(--ease-ui), box-shadow .2s var(--ease-ui)",
        width: fullWidth ? "100%" : undefined,
      }}
    >
      Upgrade
    </button>
  );
}

function SettingsCard({
  icon, title, desc, violet, iconTile, textPrimary, textMuted, textTertiary, isHovered, onHover, onLeave, onClick,
}: {
  icon: React.ReactNode; title: string; desc: string; violet: string;
  iconTile: (c: string) => React.CSSProperties;
  textPrimary: string; textMuted: string; textTertiary: string;
  isHovered: boolean; onHover: () => void; onLeave: () => void; onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      onMouseEnter={onHover}
      onMouseLeave={onLeave}
      className="gg-press-card"
      style={{
        background: isHovered ? "var(--overlay-hover)" : "var(--overlay)",
        border: isHovered ? "1px solid var(--border-strong)" : "1px solid var(--hairline)",
        borderRadius: 16, padding: "16px 18px", display: "flex", alignItems: "center",
        gap: 14, cursor: "pointer",
        transition: "transform .18s var(--ease-ui), background .2s var(--ease-ui), border-color .2s var(--ease-ui), box-shadow .2s var(--ease-ui)",
        transform: isHovered ? "translateY(-2px)" : "translateY(0)",
        boxShadow: isHovered ? "0 8px 22px rgba(0,0,0,0.2)" : "none",
      }}
    >
      <div style={iconTile(violet)}>{icon}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ color: textPrimary, fontSize: 15, fontWeight: 600, fontFamily: "var(--font-space-grotesk)", letterSpacing: "-0.02em" }}>{title}</div>
        <div style={{ color: textMuted, fontSize: 13, marginTop: 2 }}>{desc}</div>
      </div>
      <Icon.chevron size={16} color={textTertiary} />
    </div>
  );
}

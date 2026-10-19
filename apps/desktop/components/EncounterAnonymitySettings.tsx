"use client";
import { useEffect, useRef, useState } from "react";
import { api, checkEncounterAlias, encounterAppearsAs, ENCOUNTER_ALIAS_MAX_LENGTH, type UserProfile } from "@giggle/core";
import { Button } from "@/components/Button";
import { Switch } from "@/components/Switch";

/**
 * "Stay anonymous with other squads": your own squad always sees you as
 * usual; other squads (calls, chat, games, squad previews) see only the alias.
 */
export function EncounterAnonymitySettings({ profile, onSaved }: { profile: UserProfile | null; onSaved: (profile: UserProfile) => void }) {
  const [anonymous, setAnonymous] = useState(false);
  const [alias, setAlias] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const touchedRef = useRef(false);

  useEffect(() => {
    if (!profile || touchedRef.current) return;
    setAnonymous(profile.anonymousInEncounters === true);
    setAlias(profile.encounterAlias ?? "");
  }, [profile]);

  const check = checkEncounterAlias(alias);
  const aliasDirty = (check.value ?? alias.trim()) !== (profile?.encounterAlias ?? "");

  async function save(body: { anonymousInEncounters?: boolean; encounterAlias?: string }) {
    setError(null);
    setSaving(true);
    try {
      const updated = await api.updateMyProfile(body);
      touchedRef.current = false;
      setAnonymous(updated.anonymousInEncounters === true);
      setAlias(updated.encounterAlias ?? "");
      onSaved(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 1800);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  function toggle(next: boolean) {
    touchedRef.current = true;
    setAnonymous(next);
    void save({ anonymousInEncounters: next, ...(check.value !== undefined && aliasDirty ? { encounterAlias: check.value } : {}) });
  }

  const appearsAs = check.value || encounterAppearsAs({ encounterAliasFallback: profile?.encounterAliasFallback });

  return (
    <div data-testid="encounter-anonymity">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "12px 0" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div id="encounter-anonymity-label" style={{ color: "var(--text)", fontSize: 14, fontWeight: 600 }}>Stay anonymous with other squads</div>
          <div style={{ color: "var(--text-dim)", fontSize: 12, marginTop: 2 }}>
            Your own squad still sees your name and avatar. Other squads in calls, chat, games and squad previews only see the name below, with no avatar or profile.
          </div>
        </div>
        <Switch checked={anonymous} onChange={toggle} disabled={saving || !profile} ariaLabelledBy="encounter-anonymity-label" />
      </div>
      {anonymous && (
        <form
          onSubmit={e => { e.preventDefault(); if (check.value !== undefined && aliasDirty) void save({ encounterAlias: check.value }); }}
          style={{ display: "flex", flexDirection: "column", gap: 8, paddingBottom: 12 }}
        >
          <label htmlFor="encounter-alias" style={{ color: "var(--text)", fontSize: 13, fontWeight: 600 }}>Name other squads see</label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input
              id="encounter-alias"
              value={alias}
              maxLength={ENCOUNTER_ALIAS_MAX_LENGTH}
              placeholder={profile?.encounterAliasFallback ?? "Guest"}
              aria-describedby="encounter-alias-hint"
              aria-invalid={check.error ? true : undefined}
              onChange={e => { touchedRef.current = true; setAlias(e.target.value); }}
              style={{ flex: "1 1 180px", minWidth: 0, minHeight: 44, padding: "8px 12px", fontSize: 14, borderRadius: "var(--radius-control, 14px)", background: "var(--overlay)", color: "var(--text)", border: "1px solid var(--border-strong)" }}
            />
            <Button type="submit" variant="secondary" loading={saving} disabled={!aliasDirty || !!check.error}>{saved ? "Saved" : "Save name"}</Button>
          </div>
          <div id="encounter-alias-hint" role={check.error ? "alert" : undefined} style={{ color: check.error ? "var(--coral)" : "var(--text-dim)", fontSize: 12 }}>
            {check.error ?? `Other squads will see you as "${appearsAs}". Leave it empty to use ${profile?.encounterAliasFallback ?? "a guest name"}.`}
          </div>
        </form>
      )}
      {error && <div role="alert" style={{ color: "var(--coral)", fontSize: 12, paddingBottom: 12 }}>{error}</div>}
    </div>
  );
}

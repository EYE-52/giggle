import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { api, checkEncounterAlias, encounterAppearsAs, ENCOUNTER_ALIAS_MAX_LENGTH, type UserProfile } from '@giggle/core';
import { Card } from './Card';
import { SwitchControl } from './SwitchControl';
import { COLORS, SPACE } from '../constants/theme';

/**
 * "Stay anonymous with other squads": your own squad always sees you as
 * usual; other squads (calls, chat, squad previews) see only the alias.
 */
export function EncounterAnonymityCard() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [anonymous, setAnonymous] = useState(false);
  const [alias, setAlias] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const touchedRef = useRef(false);

  useEffect(() => {
    let active = true;
    api.getMyProfile()
      .then((loaded) => {
        if (!active) return;
        setProfile(loaded);
        if (touchedRef.current) return;
        setAnonymous(loaded.anonymousInEncounters === true);
        setAlias(loaded.encounterAlias ?? '');
      })
      .catch(() => { if (active) setError("Couldn't load this setting."); });
    return () => { active = false; };
  }, []);

  const check = checkEncounterAlias(alias);
  const aliasDirty = (check.value ?? alias.trim()) !== (profile?.encounterAlias ?? '');

  async function save(body: { anonymousInEncounters?: boolean; encounterAlias?: string }) {
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const updated = await api.updateMyProfile(body);
      touchedRef.current = false;
      setProfile(updated);
      setAnonymous(updated.anonymousInEncounters === true);
      setAlias(updated.encounterAlias ?? '');
      setNotice('Saved.');
    } catch (e) {
      setAnonymous(profile?.anonymousInEncounters === true);
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
    <Card style={styles.card}>
      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Stay anonymous with other squads</Text>
          <Text style={styles.help}>
            Your own squad still sees your name and avatar. Other squads in calls, chat and squad previews only see the name below, with no avatar or profile.
          </Text>
        </View>
        <SwitchControl label="Stay anonymous with other squads" value={anonymous} disabled={saving || !profile} onValueChange={toggle} />
      </View>
      {anonymous && (
        <View style={styles.aliasBlock}>
          <Text style={styles.label}>Name other squads see</Text>
          <View style={styles.aliasRow}>
            <TextInput
              value={alias}
              onChangeText={(value) => { touchedRef.current = true; setAlias(value); }}
              maxLength={ENCOUNTER_ALIAS_MAX_LENGTH}
              placeholder={profile?.encounterAliasFallback ?? 'Guest'}
              placeholderTextColor={COLORS.textDim}
              autoCorrect={false}
              style={styles.input}
              accessibilityLabel="Name other squads see"
            />
            <TouchableOpacity
              onPress={() => { if (check.value !== undefined && aliasDirty) void save({ encounterAlias: check.value }); }}
              disabled={saving || !aliasDirty || !!check.error}
              style={[styles.saveButton, (saving || !aliasDirty || !!check.error) && styles.disabled]}
              accessibilityRole="button"
              accessibilityLabel="Save name"
            >
              <Text style={styles.saveText}>{saving ? 'Saving…' : 'Save'}</Text>
            </TouchableOpacity>
          </View>
          <Text style={check.error ? styles.error : styles.help} accessibilityRole={check.error ? 'alert' : undefined}>
            {check.error ?? `Other squads will see you as "${appearsAs}". Leave it empty to use ${profile?.encounterAliasFallback ?? 'a guest name'}.`}
          </Text>
        </View>
      )}
      {!!error && <Text style={styles.error} accessibilityRole="alert">{error}</Text>}
      {!!notice && !error && <Text style={styles.notice} accessibilityLiveRegion="polite">{notice}</Text>}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: SPACE.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: SPACE.md },
  title: { color: COLORS.text, fontSize: 15, fontWeight: '700' },
  help: { color: COLORS.textMuted, fontSize: 13, lineHeight: 19, marginTop: 2 },
  aliasBlock: { gap: SPACE.sm, marginTop: SPACE.sm },
  label: { color: COLORS.text, fontSize: 13, fontWeight: '700' },
  aliasRow: { flexDirection: 'row', alignItems: 'center', gap: SPACE.sm },
  input: { flex: 1, minHeight: 48, borderWidth: 1, borderColor: COLORS.border, borderRadius: 12, paddingHorizontal: 12, color: COLORS.text },
  saveButton: { minHeight: 44, minWidth: 64, alignItems: 'center', justifyContent: 'center' },
  saveText: { color: COLORS.violet, fontSize: 14, fontWeight: '700' },
  disabled: { opacity: 0.5 },
  error: { color: COLORS.coral, fontSize: 13 },
  notice: { color: COLORS.lime, fontSize: 13 },
});

import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Modal } from 'react-native';
import { useRouter } from 'expo-router';
import { Screen } from '../components/Screen';
import { Card } from '../components/Card';
import { Avatar } from '../components/Avatar';
import { Button } from '../components/Button';
import { Icon } from '../components/Icon';
import { SwitchControl } from '../components/SwitchControl';
import { COLORS, SPACE, RADII } from '../constants/theme';
import { session } from '@giggle/core';
import Svg, { Circle } from 'react-native-svg';

const CURATED_VIBES = ['Gaming', 'Music', 'Chill', 'Comedy', 'Deep Talks', 'Late Night', 'Sports', 'Art', 'Study', 'Hype', 'Fitness', 'Foodies'];
const PROFILE_SETTINGS_STORAGE_KEY = 'giggle.mobile.profile.settings';
type ProfileSettings = {
  notifications: boolean;
  openToDiscovery: boolean;
  showOnline: boolean;
};
const DEFAULT_PROFILE_SETTINGS: ProfileSettings = {
  notifications: true,
  openToDiscovery: true,
  showOnline: true,
};

const SETTINGS = [
  {
    iconName: 'shield' as const,
    label: 'Privacy & Safety',
    body: 'Control discovery visibility, online status, and safety reporting from one place.',
    actions: ['Discovery', 'Online status', 'Safety tools'],
  },
  {
    iconName: 'account' as const,
    label: 'Account',
    body: 'Manage your profile identity, session, and connected sign-in methods.',
    actions: ['Profile info', 'Connected login', 'Session'],
  },
  {
    iconName: 'settings' as const,
    label: 'Preferences',
    body: 'Tune notifications, vibe matching, and how Giggle personalizes squads for you.',
    actions: ['Notifications', 'Vibe matching', 'Recommendations'],
  },
];

const PROFILE = {
  vibePrefs: ['Gaming', 'Chill', 'Late Night'],
};

function handleFromEmail(email?: string) {
  if (!email) return '@giggle';
  const localPart = email.split('@')[0] || 'giggle';
  const safeHandle = localPart.replace(/[^a-zA-Z0-9_]/g, '').toLowerCase();
  return `@${safeHandle || 'giggle'}`;
}

function loadProfileSettings() {
  if (typeof localStorage === 'undefined') return DEFAULT_PROFILE_SETTINGS;
  try {
    const raw = localStorage.getItem(PROFILE_SETTINGS_STORAGE_KEY);
    if (!raw) return DEFAULT_PROFILE_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<ProfileSettings>;
    return {
      notifications: typeof parsed.notifications === 'boolean' ? parsed.notifications : DEFAULT_PROFILE_SETTINGS.notifications,
      openToDiscovery: typeof parsed.openToDiscovery === 'boolean' ? parsed.openToDiscovery : DEFAULT_PROFILE_SETTINGS.openToDiscovery,
      showOnline: typeof parsed.showOnline === 'boolean' ? parsed.showOnline : DEFAULT_PROFILE_SETTINGS.showOnline,
    };
  } catch {
    return DEFAULT_PROFILE_SETTINGS;
  }
}

function saveProfileSetting(key: keyof ProfileSettings, value: boolean) {
  if (typeof localStorage === 'undefined') return;
  try {
    const current = loadProfileSettings();
    localStorage.setItem(PROFILE_SETTINGS_STORAGE_KEY, JSON.stringify({ ...current, [key]: value }));
  } catch {}
}

function StatusRing({ approved, size = 100 }: { approved: boolean; size?: number }) {
  const r = (size - 12) / 2;
  const circ = 2 * Math.PI * r;
  const dash = approved ? circ : 0;
  return (
    <Svg width={size} height={size} style={{ transform: [{ rotate: '-90deg' }] }}>
      <Circle cx={size / 2} cy={size / 2} r={r} stroke="rgba(255,255,255,0.08)" strokeWidth={6} fill="none" />
      <Circle
        cx={size / 2} cy={size / 2} r={r}
        stroke="#C2FF3D" strokeWidth={6} fill="none"
        strokeDasharray={`${dash} ${circ}`}
        strokeLinecap="round"
      />
    </Svg>
  );
}

export default function ProfileScreen() {
  const router = useRouter();
  const currentUser = session.user;
  const displayName = currentUser?.name?.trim() || currentUser?.email?.split('@')[0] || 'Your profile';
  const displayHandle = handleFromEmail(currentUser?.email);
  const profileStatus = currentUser?.isApproved ? 'Approved' : 'Pending review';
  const accountFacts = [
    { label: 'Plan', val: currentUser?.isPremium ? 'Giggle+' : 'Free' },
    { label: 'Tokens', val: currentUser?.tokens ?? 0 },
    { label: 'Access', val: currentUser?.isApproved ? 'Approved' : 'Pending' },
    { label: 'Status', val: session.isAuthed() ? 'Signed in' : 'Guest' },
  ];
  const [vibePrefs, setVibePrefs] = useState<string[]>(PROFILE.vibePrefs);
  const [vibeModalVisible, setVibeModalVisible] = useState(false);
  const [profileSettings, setProfileSettings] = useState(() => loadProfileSettings());
  const [selectedSetting, setSelectedSetting] = useState<(typeof SETTINGS)[number] | null>(null);

  function setProfileSetting(key: keyof ProfileSettings, value: boolean) {
    setProfileSettings((prev) => ({ ...prev, [key]: value }));
    saveProfileSetting(key, value);
  }

  function removeVibe(v: string) {
    setVibePrefs((prev) => prev.filter((x) => x !== v));
  }

  function addVibe(v: string) {
    if (!vibePrefs.includes(v)) setVibePrefs((prev) => [...prev, v]);
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <TouchableOpacity onPress={() => router.back()} style={styles.back}>
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>

        <View style={styles.hero}>
          <View style={styles.avatarRing}>
            <StatusRing approved={!!currentUser?.isApproved} size={108} />
            <View style={styles.avatarCenter}>
              <Avatar name={displayName} size={72} colorIndex={0} />
            </View>
          </View>
          <Text style={styles.name}>{displayName}</Text>
          <Text style={styles.handle}>{displayHandle}</Text>
          <View style={styles.tierBadge}>
            <Text style={styles.tierText}>{profileStatus}</Text>
          </View>
          <View style={styles.vibeScoreRow}>
            <Icon.trend size={14} color={COLORS.lime} />
            <Text style={styles.vibeScoreText}>PROFILE STATUS</Text>
          </View>
        </View>

        <Text style={styles.sectionLabel}>Account</Text>
        <View style={styles.statsGrid}>
          {accountFacts.map((s) => (
            <Card key={s.label} style={styles.statCard}>
              <Text style={styles.statVal}>{s.val}</Text>
              <Text style={styles.statKey}>{s.label}</Text>
            </Card>
          ))}
        </View>

        <TouchableOpacity onPress={() => router.push('/premium')} activeOpacity={0.85}>
          <Card style={styles.premCard}>
            <View style={styles.premRow}>
              <Icon.star size={20} color="#C2FF3D" fill="#C2FF3D" />
              <View style={{ flex: 1, marginLeft: SPACE.md }}>
                <Text style={styles.premTitle}>Giggle+</Text>
                <Text style={styles.premSub}>Unlock member badges, premium cosmetics, and token perks</Text>
              </View>
              <Icon.chevron size={18} color={COLORS.textDim} />
            </View>
          </Card>
        </TouchableOpacity>

        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionLabel}>Vibe Preferences</Text>
          <TouchableOpacity onPress={() => setVibeModalVisible(true)} style={styles.addMoreBtn}>
            <Text style={styles.addMoreText}>+ Add More</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.chips}>
          {vibePrefs.map((v) => (
            <TouchableOpacity key={v} onPress={() => removeVibe(v)} style={styles.vibeChipRemovable} activeOpacity={0.75}>
              <Text style={styles.vibeChipText}>{v}</Text>
              <Text style={styles.vibeChipX}> ✕</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Vibe picker modal */}
        <Modal visible={vibeModalVisible} transparent animationType="slide" onRequestClose={() => setVibeModalVisible(false)}>
          <View style={styles.modalOverlay}>
            <View style={styles.modalSheet}>
              <Text style={styles.modalTitle}>Add Vibes</Text>
              <View style={styles.modalChips}>
                {CURATED_VIBES.filter((v) => !vibePrefs.includes(v)).map((v) => (
                  <TouchableOpacity
                    key={v}
                    onPress={() => { addVibe(v); setVibeModalVisible(false); }}
                    style={styles.modalChip}
                    activeOpacity={0.75}
                  >
                    <Text style={styles.modalChipText}>{v}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <TouchableOpacity onPress={() => setVibeModalVisible(false)} style={styles.modalCancel}>
                <Text style={styles.modalCancelText}>Done</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>

        <Text style={styles.sectionLabel}>Account Toggles</Text>
        {[
          { label: 'Notifications', key: 'notifications' as const, value: profileSettings.notifications },
          { label: 'Open to Discovery', key: 'openToDiscovery' as const, value: profileSettings.openToDiscovery },
          { label: 'Show Online Status', key: 'showOnline' as const, value: profileSettings.showOnline },
        ].map(({ label, key, value }) => (
          <View key={label} style={styles.toggleRow}>
            <Text style={styles.settingsLabel}>{label}</Text>
            <SwitchControl
              label={label}
              value={value}
              onValueChange={(value) => setProfileSetting(key, value)}
            />
          </View>
        ))}

        <Text style={styles.sectionLabel}>Settings</Text>
        {SETTINGS.map((setting) => {
          const IconComp = Icon[setting.iconName];
          return (
            <TouchableOpacity
              key={setting.label}
              onPress={() => setSelectedSetting(setting)}
              style={styles.settingsRow}
              accessibilityRole="button"
              accessibilityLabel={`Open ${setting.label}`}
            >
              <IconComp size={20} color={COLORS.textMuted} />
              <Text style={styles.settingsLabel}>{setting.label}</Text>
              <Icon.chevron size={18} color={COLORS.textDim} />
            </TouchableOpacity>
          );
        })}

        <Modal visible={!!selectedSetting} transparent animationType="slide" onRequestClose={() => setSelectedSetting(null)}>
          <View style={styles.modalOverlay}>
            <View style={styles.modalSheet}>
              <Text style={styles.settingsSheetTitle}>{selectedSetting?.label}</Text>
              <Text style={styles.settingsSheetBody}>{selectedSetting?.body}</Text>
              <View style={styles.settingsSheetActions}>
                {selectedSetting?.actions.map((action) => (
                  <View key={action} style={styles.settingsSheetAction}>
                    <Text style={styles.settingsSheetActionText}>{action}</Text>
                    <Text style={styles.settingsSheetStatus}>Available in app settings</Text>
                  </View>
                ))}
              </View>
              <TouchableOpacity onPress={() => setSelectedSetting(null)} style={styles.modalCancel}>
                <Text style={styles.modalCancelText}>Done</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>

        <Button
          label="Log Out"
          onPress={() => {
            session.signOut();
            router.replace('/');
          }}
          variant="outline"
          style={styles.logout}
        />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: SPACE.lg, paddingTop: SPACE.xl },
  back: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: SPACE.lg },
  backText: { color: COLORS.violet, fontSize: 16, fontWeight: '600' },
  hero: { alignItems: 'center', marginBottom: SPACE.xl },
  avatarRing: { position: 'relative', marginBottom: SPACE.md },
  avatarCenter: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center', justifyContent: 'center',
  },
  name: { fontSize: 24, fontWeight: '900', color: COLORS.text, marginBottom: 4 },
  handle: { fontSize: 14, color: COLORS.textMuted, marginBottom: SPACE.sm },
  tierBadge: {
    backgroundColor: 'rgba(194,255,61,0.12)', borderRadius: 999,
    paddingVertical: 4, paddingHorizontal: 14,
    borderWidth: 1, borderColor: 'rgba(194,255,61,0.4)',
    marginBottom: SPACE.sm,
  },
  tierText: { color: COLORS.lime, fontWeight: '700', fontSize: 13 },
  vibeScoreRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  vibeScoreText: { fontSize: 13, fontWeight: '700', color: COLORS.lime, letterSpacing: 0.5 },
  sectionLabel: {
    fontSize: 12, fontWeight: '700', color: COLORS.textDim,
    textTransform: 'uppercase', letterSpacing: 1, marginBottom: SPACE.md, marginTop: SPACE.xl,
  },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: SPACE.lg },
  statCard: { width: '30%', alignItems: 'center', paddingVertical: SPACE.lg },
  statVal: { fontSize: 22, fontWeight: '900', color: COLORS.violet },
  statKey: { fontSize: 11, color: COLORS.textMuted, textTransform: 'capitalize', marginTop: 2 },
  premCard: { marginBottom: SPACE.xl },
  premRow: { flexDirection: 'row', alignItems: 'center' },
  premTitle: { fontSize: 16, fontWeight: '700', color: COLORS.lime },
  premSub: { fontSize: 13, color: COLORS.textMuted, marginTop: 2 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: SPACE.lg },
  vibeChip: {
    paddingVertical: 6, paddingHorizontal: 14, borderRadius: 999,
    backgroundColor: 'rgba(124,92,255,0.12)', borderWidth: 1, borderColor: 'rgba(124,92,255,0.3)',
  },
  vibeChipRemovable: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 6, paddingHorizontal: 14, borderRadius: 999,
    backgroundColor: 'rgba(124,92,255,0.12)', borderWidth: 1, borderColor: 'rgba(124,92,255,0.3)',
  },
  vibeChipText: { color: COLORS.violet, fontWeight: '600', fontSize: 14 },
  vibeChipX: { color: COLORS.violet, fontWeight: '400', fontSize: 13 },
  sectionHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACE.md, marginTop: SPACE.xl },
  addMoreBtn: {
    paddingVertical: 4, paddingHorizontal: 12, borderRadius: 999,
    backgroundColor: 'rgba(124,92,255,0.12)', borderWidth: 1, borderColor: 'rgba(124,92,255,0.3)',
  },
  addMoreText: { color: COLORS.violet, fontWeight: '600', fontSize: 13 },
  toggleRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: SPACE.md, borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  settingsRow: {
    flexDirection: 'row', alignItems: 'center', gap: SPACE.md,
    paddingVertical: SPACE.md, borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  settingsLabel: { flex: 1, fontSize: 15, color: COLORS.text, fontWeight: '500' },
  logout: { marginTop: SPACE.xxl },
  // modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'flex-end' },
  modalSheet: {
    backgroundColor: '#16161E', borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: SPACE.xl, paddingBottom: SPACE.xxl,
    borderTopWidth: 1, borderColor: COLORS.border,
  },
  modalTitle: { fontSize: 22, fontWeight: '800', color: COLORS.text, marginBottom: SPACE.lg },
  modalChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: SPACE.xl },
  modalChip: {
    paddingVertical: 8, paddingHorizontal: 16, borderRadius: 999,
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border,
  },
  modalChipText: { color: COLORS.textMuted, fontWeight: '600', fontSize: 14 },
  settingsSheetTitle: { fontSize: 24, fontWeight: '900', color: COLORS.text, marginBottom: SPACE.sm },
  settingsSheetBody: { fontSize: 14, lineHeight: 21, color: COLORS.textMuted, marginBottom: SPACE.lg },
  settingsSheetActions: { gap: 10, marginBottom: SPACE.lg },
  settingsSheetAction: {
    padding: SPACE.md, borderRadius: RADII.lg,
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border,
  },
  settingsSheetActionText: { fontSize: 15, fontWeight: '700', color: COLORS.text },
  settingsSheetStatus: { marginTop: 3, fontSize: 12, color: COLORS.textDim },
  modalCancel: { alignItems: 'center', paddingVertical: SPACE.md },
  modalCancelText: { color: COLORS.violet, fontWeight: '700', fontSize: 15 },
});

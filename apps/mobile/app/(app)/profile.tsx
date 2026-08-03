import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Modal, Linking } from 'react-native';
import { useRouter } from 'expo-router';
import { Screen } from '../../components/Screen';
import { Card } from '../../components/Card';
import { Avatar } from '../../components/Avatar';
import { Button } from '../../components/Button';
import { Icon } from '../../components/Icon';
import { COLORS, SPACE } from '../../constants/theme';
import { api, session, type BlockedAccount } from '@giggle/core';
import Svg, { Circle } from 'react-native-svg';

const CURATED_VIBES = ['Gaming', 'Music', 'Chill', 'Comedy', 'Deep Talks', 'Late Night', 'Sports', 'Art', 'Study', 'Hype', 'Fitness', 'Foodies'];

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
  const profileStatus = currentUser?.isApproved ? 'Approved' : 'Pending review';
  const accountRows = [
    { label: 'Plan', value: currentUser?.isPremium ? 'Giggle+' : 'Free' },
    { label: 'Tokens', value: String(currentUser?.tokens ?? 0) },
  ];
  const [vibePrefs, setVibePrefs] = useState<string[]>([]);
  const [vibeLoading, setVibeLoading] = useState(true);
  const [vibeSaving, setVibeSaving] = useState(false);
  const [vibeError, setVibeError] = useState('');
  const [vibeLoadAttempt, setVibeLoadAttempt] = useState(0);
  const [vibeModalVisible, setVibeModalVisible] = useState(false);
  const [resourceError, setResourceError] = useState('');
  const [blockedAccounts, setBlockedAccounts] = useState<BlockedAccount[]>([]);
  const [blocksLoading, setBlocksLoading] = useState(true);
  const [blocksError, setBlocksError] = useState('');
  const [blocksLoadAttempt, setBlocksLoadAttempt] = useState(0);
  const [unblockingId, setUnblockingId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setVibeLoading(true);
    setVibeError('');
    api.getMyProfile()
      .then((profile) => { if (active) setVibePrefs(profile.vibes ?? []); })
      .catch(() => { if (active) setVibeError("Couldn't load vibe preferences."); })
      .finally(() => { if (active) setVibeLoading(false); });
    return () => { active = false; };
  }, [vibeLoadAttempt]);

  useEffect(() => {
    let active = true;
    setBlocksLoading(true);
    setBlocksError('');
    api.listBlockedUsers()
      .then(({ accounts }) => { if (active) setBlockedAccounts(accounts ?? []); })
      .catch(() => { if (active) setBlocksError("Couldn't load blocked accounts."); })
      .finally(() => { if (active) setBlocksLoading(false); });
    return () => { active = false; };
  }, [blocksLoadAttempt]);

  async function saveVibes(next: string[]) {
    const previous = vibePrefs;
    setVibePrefs(next);
    setVibeSaving(true);
    setVibeError('');
    try {
      const profile = await api.updateMyProfile({ vibes: next });
      setVibePrefs(profile.vibes ?? next);
    } catch (error) {
      setVibePrefs(previous);
      setVibeError(error instanceof Error ? error.message : "Couldn't save vibe preferences.");
    } finally {
      setVibeSaving(false);
    }
  }

  function removeVibe(v: string) {
    if (vibeSaving) return;
    void saveVibes(vibePrefs.filter((x) => x !== v));
  }

  function addVibe(v: string) {
    if (vibeSaving || vibePrefs.includes(v)) return;
    setVibeModalVisible(false);
    void saveVibes([...vibePrefs, v]);
  }

  async function unblockAccount(account: BlockedAccount) {
    if (unblockingId) return;
    setUnblockingId(account.userId);
    setBlocksError('');
    try {
      await api.unblockUser(account.userId);
      setBlockedAccounts((current) => current.filter((item) => item.userId !== account.userId));
    } catch {
      setBlocksError("Couldn't unblock that account.");
    } finally {
      setUnblockingId(null);
    }
  }

  async function openResource(url: string) {
    setResourceError('');
    try {
      await Linking.openURL(url);
    } catch {
      setResourceError("Couldn't open that page. Visit gigglemeet.com in your browser.");
    }
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.back}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
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
          <View style={styles.tierBadge}>
            <Text style={styles.tierText}>{profileStatus}</Text>
          </View>
        </View>

        <Text style={styles.sectionLabel}>Account</Text>
        <Card style={styles.accountList}>
          {accountRows.map((row, index) => (
            <View key={row.label} style={[styles.accountRow, index > 0 && styles.accountRowDivider]}>
              <Text style={styles.accountKey}>{row.label}</Text>
              <Text style={styles.accountValue} numberOfLines={1}>{row.value}</Text>
            </View>
          ))}
        </Card>

        <TouchableOpacity
          onPress={() => router.push('/premium')}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel="Open wallet"
        >
          <Card style={styles.premCard}>
            <View style={styles.premRow}>
              <Icon.star size={20} color="#C2FF3D" fill="#C2FF3D" />
              <View style={{ flex: 1, marginLeft: SPACE.md }}>
                <Text style={styles.premTitle}>Wallet</Text>
                <Text style={styles.premSub}>View your token balance and referral rewards</Text>
              </View>
              <Icon.chevron size={18} color={COLORS.textDim} />
            </View>
          </Card>
        </TouchableOpacity>

        <View style={styles.sectionHeaderRow}>
          <Text style={[styles.sectionLabel, styles.sectionHeaderLabel]}>Vibe Preferences</Text>
          <TouchableOpacity
            onPress={() => setVibeModalVisible(true)}
            style={[styles.addMoreBtn, (vibeLoading || vibeSaving) && styles.disabled]}
            disabled={vibeLoading || vibeSaving}
            accessibilityRole="button"
            accessibilityLabel="Add vibe preference"
          >
            <Text style={styles.addMoreText}>+ Add More</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.chips}>
          {vibeLoading ? (
            <Text style={styles.vibeHelp}>Loading preferences…</Text>
          ) : vibePrefs.length ? (
            vibePrefs.map((v) => (
              <TouchableOpacity
                key={v}
                onPress={() => removeVibe(v)}
                style={styles.vibeChipRemovable}
                activeOpacity={0.75}
                disabled={vibeSaving}
                accessibilityRole="button"
                accessibilityLabel={`Remove ${v} vibe`}
              >
                <Text style={styles.vibeChipText}>{v}</Text>
                <Text style={styles.vibeChipX}> ✕</Text>
              </TouchableOpacity>
            ))
          ) : (
            <Text style={styles.vibeHelp}>No vibe preferences yet.</Text>
          )}
        </View>
        {!!vibeError && (
          <View style={styles.vibeErrorRow} accessibilityLiveRegion="polite">
            <Text style={styles.vibeErrorText}>{vibeError}</Text>
            <TouchableOpacity
              onPress={() => setVibeLoadAttempt((attempt) => attempt + 1)}
              style={styles.retryButton}
              accessibilityRole="button"
            >
              <Text style={styles.retryText}>Retry</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Vibe picker modal */}
        <Modal visible={vibeModalVisible} transparent animationType="slide" onRequestClose={() => setVibeModalVisible(false)}>
          <View style={styles.modalOverlay}>
            <View style={styles.modalSheet}>
              <Text style={styles.modalTitle}>Add Vibes</Text>
              <View style={styles.modalChips}>
                {CURATED_VIBES.filter((v) => !vibePrefs.includes(v)).map((v) => (
                  <TouchableOpacity
                    key={v}
                    onPress={() => addVibe(v)}
                    style={styles.modalChip}
                    activeOpacity={0.75}
                    accessibilityRole="button"
                  >
                    <Text style={styles.modalChipText}>{v}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <TouchableOpacity
                onPress={() => setVibeModalVisible(false)}
                style={styles.modalCancel}
                accessibilityRole="button"
                accessibilityLabel="Close vibe picker"
              >
                <Text style={styles.modalCancelText}>Done</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>

        <Text style={styles.sectionLabel}>Blocked accounts</Text>
        <Card style={styles.blockedList}>
          {blocksLoading ? (
            <Text style={styles.blockedHelp}>Loading…</Text>
          ) : blockedAccounts.length === 0 ? (
            <Text style={styles.blockedHelp}>No blocked accounts.</Text>
          ) : (
            blockedAccounts.map((account, index) => {
              const name = account.name || 'Blocked account';
              return (
                <View key={account.userId} style={[styles.blockedRow, index > 0 && styles.resourceDivider]}>
                  <Avatar name={name} size={36} colorIndex={index} />
                  <Text style={styles.blockedName} numberOfLines={1}>{name}</Text>
                  <TouchableOpacity
                    onPress={() => void unblockAccount(account)}
                    disabled={!!unblockingId}
                    style={[styles.unblockButton, !!unblockingId && styles.disabled]}
                    accessibilityRole="button"
                    accessibilityLabel={`Unblock ${name}`}
                  >
                    <Text style={styles.unblockText}>{unblockingId === account.userId ? 'Unblocking…' : 'Unblock'}</Text>
                  </TouchableOpacity>
                </View>
              );
            })
          )}
        </Card>
        {!!blocksError && (
          <View style={styles.vibeErrorRow} accessibilityLiveRegion="polite">
            <Text style={styles.vibeErrorText}>{blocksError}</Text>
            <TouchableOpacity
              onPress={() => setBlocksLoadAttempt((attempt) => attempt + 1)}
              style={styles.retryButton}
              accessibilityRole="button"
              accessibilityLabel="Retry blocked accounts"
            >
              <Text style={styles.retryText}>Retry</Text>
            </TouchableOpacity>
          </View>
        )}

        <Text style={styles.sectionLabel}>Help & policies</Text>
        <Card style={styles.resourceList}>
          <TouchableOpacity
            onPress={() => void openResource('https://gigglemeet.com/safety')}
            style={styles.resourceLink}
            accessibilityRole="link"
            accessibilityLabel="Open Safety Center"
          >
            <Text style={styles.resourceText}>Safety</Text>
            <Icon.chevron size={18} color={COLORS.textDim} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => void openResource('https://gigglemeet.com/support')}
            style={[styles.resourceLink, styles.resourceDivider]}
            accessibilityRole="link"
            accessibilityLabel="Open Support"
          >
            <Text style={styles.resourceText}>Support</Text>
            <Icon.chevron size={18} color={COLORS.textDim} />
          </TouchableOpacity>
        </Card>
        {!!resourceError && <Text style={styles.resourceError} accessibilityRole="alert">{resourceError}</Text>}

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
  back: { minHeight: 44, minWidth: 44, alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: SPACE.lg },
  backText: { color: COLORS.violet, fontSize: 16, fontWeight: '600' },
  hero: { alignItems: 'center', marginBottom: SPACE.xl },
  avatarRing: { position: 'relative', marginBottom: SPACE.md },
  avatarCenter: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center', justifyContent: 'center',
  },
  name: { fontSize: 24, fontWeight: '900', color: COLORS.text, marginBottom: 4 },
  tierBadge: {
    backgroundColor: 'rgba(194,255,61,0.12)', borderRadius: 999,
    paddingVertical: 4, paddingHorizontal: 14,
    borderWidth: 1, borderColor: 'rgba(194,255,61,0.4)',
  },
  tierText: { color: COLORS.lime, fontWeight: '700', fontSize: 13 },
  sectionLabel: {
    fontSize: 12, fontWeight: '700', color: COLORS.textDim,
    textTransform: 'uppercase', letterSpacing: 1, marginBottom: SPACE.md, marginTop: SPACE.xl,
  },
  accountList: { paddingVertical: 0, marginBottom: SPACE.md },
  accountRow: {
    minHeight: 56, flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', gap: SPACE.md,
  },
  accountRowDivider: { borderTopWidth: 1, borderTopColor: COLORS.border },
  accountKey: { fontSize: 14, color: COLORS.textMuted, fontWeight: '600' },
  accountValue: { flexShrink: 1, fontSize: 15, color: COLORS.text, fontWeight: '800', textAlign: 'right' },
  premCard: { marginBottom: SPACE.xl },
  premRow: { flexDirection: 'row', alignItems: 'center' },
  premTitle: { fontSize: 16, fontWeight: '700', color: COLORS.lime },
  premSub: { fontSize: 13, color: COLORS.textMuted, marginTop: 2 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: SPACE.lg },
  vibeChipRemovable: {
    minHeight: 44, flexDirection: 'row', alignItems: 'center',
    paddingVertical: 6, paddingHorizontal: 14, borderRadius: 999,
    backgroundColor: 'rgba(124,92,255,0.12)', borderWidth: 1, borderColor: 'rgba(124,92,255,0.3)',
  },
  vibeChipText: { color: COLORS.violet, fontWeight: '600', fontSize: 14 },
  vibeChipX: { color: COLORS.violet, fontWeight: '400', fontSize: 13 },
  sectionHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACE.md, marginTop: SPACE.xl },
  sectionHeaderLabel: { marginTop: 0, marginBottom: 0 },
  addMoreBtn: {
    minHeight: 44, justifyContent: 'center', paddingVertical: 4, paddingHorizontal: 12, borderRadius: 999,
    backgroundColor: 'rgba(124,92,255,0.12)', borderWidth: 1, borderColor: 'rgba(124,92,255,0.3)',
  },
  addMoreText: { color: COLORS.violet, fontWeight: '600', fontSize: 13 },
  disabled: { opacity: 0.5 },
  vibeHelp: { minHeight: 44, color: COLORS.textMuted, fontSize: 14, textAlignVertical: 'center' },
  vibeErrorRow: { flexDirection: 'row', alignItems: 'center', gap: SPACE.sm, marginTop: -SPACE.md },
  vibeErrorText: { flex: 1, color: COLORS.coral, fontSize: 13 },
  retryButton: { minHeight: 44, minWidth: 44, justifyContent: 'center', alignItems: 'center' },
  retryText: { color: COLORS.violet, fontSize: 13, fontWeight: '700' },
  resourceList: { paddingVertical: 0 },
  resourceLink: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  resourceDivider: { borderTopWidth: 1, borderTopColor: COLORS.border },
  resourceText: { color: COLORS.text, fontSize: 15, fontWeight: '700' },
  resourceError: { color: COLORS.coral, fontSize: 13, marginTop: SPACE.sm },
  blockedList: { paddingVertical: 0 },
  blockedRow: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: SPACE.sm },
  blockedName: { flex: 1, color: COLORS.text, fontSize: 14, fontWeight: '700' },
  blockedHelp: { minHeight: 56, color: COLORS.textMuted, fontSize: 14, textAlignVertical: 'center' },
  unblockButton: { minHeight: 44, minWidth: 72, alignItems: 'center', justifyContent: 'center' },
  unblockText: { color: COLORS.violet, fontSize: 13, fontWeight: '700' },
  logout: { marginTop: SPACE.xl },
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
    minHeight: 44, justifyContent: 'center', paddingVertical: 8, paddingHorizontal: 16, borderRadius: 999,
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border,
  },
  modalChipText: { color: COLORS.textMuted, fontWeight: '600', fontSize: 14 },
  modalCancel: { minHeight: 44, alignItems: 'center', justifyContent: 'center', paddingVertical: SPACE.md },
  modalCancelText: { color: COLORS.violet, fontWeight: '700', fontSize: 15 },
});

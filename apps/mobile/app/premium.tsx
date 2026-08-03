import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Share } from 'react-native';
import { useRouter } from 'expo-router';
import { Screen } from '../components/Screen';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { Icon } from '../components/Icon';
import { COLORS, SPACE } from '../constants/theme';
import { api, session, TOKEN_PERKS, type ReferralInfo } from '@giggle/core';

export default function PremiumScreen() {
  const router = useRouter();
  const [referral, setReferral] = useState<ReferralInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [shareError, setShareError] = useState('');
  const [loadAttempt, setLoadAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError('');
    api.getReferral()
      .then((info) => {
        if (!active) return;
        setReferral(info);
      })
      .catch(() => {
        if (active) setLoadError("Couldn't load your wallet.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [loadAttempt]);

  const balance = referral?.tokens ?? session.user?.tokens ?? 0;

  async function shareInvite() {
    if (!referral) return;
    setShareError('');
    try {
      await Share.share({
        message: `Join me on Giggle. Use referral code ${referral.code} when you sign up.`,
      });
    } catch {
      setShareError("Couldn't open sharing. Please try again.");
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

        <View style={styles.header}>
          <View style={styles.headerCopy}>
            <Text style={styles.heading}>Wallet</Text>
            <Text style={styles.sub}>Earn and track tokens for your squad identity.</Text>
          </View>
          <Card style={styles.balanceCard}>
            <Text style={styles.balanceLabel}>Balance</Text>
            <View style={styles.balanceRow}>
              <Text style={styles.balanceValue}>{balance}</Text>
              <Text style={styles.balanceUnit}>tokens</Text>
            </View>
          </Card>
        </View>

        <Text style={styles.sectionLabel}>Earn tokens</Text>
        <Card style={styles.referralCard}>
          <View style={styles.referralTop}>
            <View style={styles.iconBox}>
              <Icon.account size={20} color={COLORS.lime} />
            </View>
            <View style={styles.referralCopy}>
              <Text style={styles.cardTitle}>Invite friends</Text>
              <Text style={styles.cardBody}>
                {referral
                  ? `${referral.referralCount} joined · ${referral.rewardPerInvite} tokens each`
                  : loading ? 'Loading your referral code…' : 'Referral details unavailable'}
              </Text>
            </View>
          </View>
          {!!referral && (
            <View style={styles.codeRow}>
              <Text style={styles.codeLabel}>Your code</Text>
              <Text style={styles.code} selectable>{referral.code}</Text>
            </View>
          )}
          <Button
            label="Share invite"
            onPress={() => void shareInvite()}
            variant="lime"
            disabled={!referral || loading}
          />
        </Card>

        {!!loadError && (
          <View style={styles.errorRow} accessibilityLiveRegion="polite">
            <Text style={styles.errorText}>{loadError}</Text>
            <TouchableOpacity
              onPress={() => setLoadAttempt((attempt) => attempt + 1)}
              style={styles.retryButton}
              accessibilityRole="button"
            >
              <Text style={styles.retryText}>Retry</Text>
            </TouchableOpacity>
          </View>
        )}
        {!!shareError && <Text style={styles.shareError} accessibilityLiveRegion="polite">{shareError}</Text>}

        <Text style={styles.sectionLabel}>Token perks</Text>
        <Text style={styles.sectionNote}>Your balance is tracked now. Server-backed perk redemption is launching soon.</Text>
        <View style={styles.perkList}>
          {TOKEN_PERKS.map((perk, index) => (
              <View key={perk.id} style={[styles.perkRow, index > 0 && styles.perkDivider]}>
                <View style={styles.iconBox}>
                  <Icon.star size={19} color={COLORS.violet} fill="transparent" />
                </View>
                <View style={styles.perkCopy}>
                  <Text style={styles.perkName}>{perk.name}</Text>
                  <Text style={styles.perkDescription}>{perk.description}</Text>
                </View>
                <View style={styles.perkMeta}>
                  <Text style={styles.perkCost}>{perk.tokenCost} tokens</Text>
                  <Text style={styles.comingSoon} numberOfLines={1}>Coming soon</Text>
                </View>
              </View>
          ))}
        </View>

        <Card style={styles.membershipCard}>
          <View style={styles.iconBox}>
            <Icon.star size={20} color={COLORS.lime} fill={COLORS.lime} />
          </View>
          <View style={styles.membershipCopy}>
            <Text style={styles.cardTitle}>Giggle+</Text>
            <Text style={styles.cardBody}>Monthly token stipend and bonus tokens on packs.</Text>
          </View>
          <Text style={styles.launchStatus}>Launching soon</Text>
        </Card>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: SPACE.lg, paddingTop: SPACE.xl, paddingBottom: SPACE.xxl },
  back: { minHeight: 44, minWidth: 44, alignSelf: 'flex-start', justifyContent: 'center', marginBottom: SPACE.md },
  backText: { color: COLORS.violet, fontSize: 16, fontWeight: '700' },
  header: { gap: SPACE.lg, marginBottom: SPACE.xl },
  headerCopy: { gap: SPACE.sm },
  heading: { fontSize: 32, fontWeight: '900', color: COLORS.text },
  sub: { maxWidth: 460, fontSize: 15, lineHeight: 22, color: COLORS.textMuted },
  balanceCard: { paddingVertical: SPACE.md },
  balanceLabel: { fontSize: 12, color: COLORS.textMuted, fontWeight: '700' },
  balanceRow: { flexDirection: 'row', alignItems: 'baseline', gap: SPACE.sm, marginTop: 2 },
  balanceValue: { fontSize: 40, lineHeight: 46, color: COLORS.text, fontWeight: '900' },
  balanceUnit: { fontSize: 13, color: COLORS.textMuted, fontWeight: '700' },
  sectionLabel: {
    marginTop: SPACE.lg, marginBottom: SPACE.sm,
    color: COLORS.text, fontSize: 18, fontWeight: '800',
  },
  sectionNote: { marginBottom: SPACE.md, color: COLORS.textMuted, fontSize: 13, lineHeight: 19 },
  referralCard: { gap: SPACE.md },
  referralTop: { flexDirection: 'row', alignItems: 'center', gap: SPACE.md },
  referralCopy: { flex: 1 },
  iconBox: {
    width: 44, height: 44, flexShrink: 0, alignItems: 'center', justifyContent: 'center',
    borderRadius: 14, backgroundColor: 'rgba(124,92,255,0.12)', borderWidth: 1, borderColor: COLORS.border,
  },
  cardTitle: { color: COLORS.text, fontSize: 16, fontWeight: '800' },
  cardBody: { marginTop: 3, color: COLORS.textMuted, fontSize: 13, lineHeight: 19 },
  codeRow: {
    minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    gap: SPACE.md, paddingHorizontal: SPACE.md, borderRadius: 12,
    backgroundColor: COLORS.bgDeep, borderWidth: 1, borderColor: COLORS.border,
  },
  codeLabel: { color: COLORS.textMuted, fontSize: 13, fontWeight: '600' },
  code: { flexShrink: 1, color: COLORS.lime, fontSize: 16, fontWeight: '900', letterSpacing: 1.5 },
  errorRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: SPACE.sm },
  errorText: { flex: 1, color: COLORS.coral, fontSize: 13 },
  retryButton: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  retryText: { color: COLORS.violet, fontSize: 13, fontWeight: '800' },
  shareError: { minHeight: 44, textAlignVertical: 'center', color: COLORS.coral, fontSize: 13 },
  perkList: { borderTopWidth: 1, borderTopColor: COLORS.border, marginBottom: SPACE.xl },
  perkRow: { minHeight: 88, flexDirection: 'row', alignItems: 'center', gap: SPACE.md, paddingVertical: SPACE.md },
  perkDivider: { borderTopWidth: 1, borderTopColor: COLORS.border },
  perkCopy: { flex: 1, minWidth: 0 },
  perkName: { color: COLORS.text, fontSize: 14, fontWeight: '800' },
  perkDescription: { marginTop: 2, color: COLORS.textMuted, fontSize: 12, lineHeight: 17 },
  perkMeta: { flexShrink: 0, alignItems: 'flex-end', gap: 5 },
  perkCost: { color: COLORS.text, fontSize: 12, fontWeight: '800' },
  comingSoon: { color: COLORS.textDim, fontSize: 11, fontWeight: '700' },
  membershipCard: { flexDirection: 'row', alignItems: 'center', gap: SPACE.md },
  membershipCopy: { flex: 1, minWidth: 0 },
  launchStatus: { flexShrink: 0, maxWidth: 72, color: COLORS.textDim, fontSize: 11, fontWeight: '800', textAlign: 'right' },
});

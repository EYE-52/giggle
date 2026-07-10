import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { Screen } from '../components/Screen';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { Icon } from '../components/Icon';
import { SwitchControl } from '../components/SwitchControl';
import { COLORS, SPACE, RADII } from '../constants/theme';
import { LinearGradient } from 'expo-linear-gradient';
import { billing, getTokenBalance, PRODUCTS } from '@giggle/core';

const BOOSTS = [
  { id: 'vibe_pack', icon: '✦', label: 'Vibe Pack', sub: 'Unlock exclusive vibe tags', cost: 80 },
  { id: 'cover_themes', icon: '🎭', label: 'Squad Themes', sub: 'Custom squad themes & colors', cost: 120 },
];

const TOKEN_PACKS = [
  PRODUCTS.tokens_starter,
  PRODUCTS.tokens_plus,
  PRODUCTS.tokens_pro,
  PRODUCTS.tokens_mega,
];

const FEATURES = [
  { iconName: 'palette' as const, label: 'Premium Themes', sub: 'Unlock expressive squad covers' },
  { iconName: 'hd' as const, label: 'Video polish', sub: 'Launch-ready video upgrades preview' },
  { iconName: 'history' as const, label: 'Encounter History', sub: 'Replay your best moments' },
  { iconName: 'star' as const, label: 'Member Badge', sub: 'Stand out across squads' },
];

export default function PremiumScreen() {
  const router = useRouter();
  const [yearly, setYearly] = useState(true);
  const [tokenBalance, setTokenBalance] = useState(0);
  const [status, setStatus] = useState('');

  const price = 'Planned';
  const period = yearly ? 'annual benefits preview' : 'launch pricing under review';
  const canRedeemPerks = billing.canRedeemTokenPerksLocally();

  useEffect(() => {
    setTokenBalance(getTokenBalance());
    return billing.subscribe(() => setTokenBalance(getTokenBalance()));
  }, []);

  const isPremium = billing.isPremium();
  const ctaLabel = useMemo(() => {
    if (isPremium) return 'Giggle+ Active';
    return 'Plan preview';
  }, [isPremium, yearly]);

  function spendBoost(boostId: string) {
    if (!canRedeemPerks) {
      setStatus('Perk redemption is in launch prep. Tokens are tracked now; server-backed unlocks are coming with checkout.');
      return;
    }
    let ok = false;
    if (boostId === 'vibe_pack') ok = billing.spendOnVibePack();
    if (boostId === 'cover_themes') ok = billing.spendOnCoverThemes();
    setTokenBalance(getTokenBalance());
    setStatus(ok ? 'Perk unlocked.' : 'Not enough tokens.');
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <TouchableOpacity onPress={() => router.back()} style={styles.back}>
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>

        <View style={styles.badge}>
          <Icon.star size={28} color="#C2FF3D" fill="#C2FF3D" />
        </View>

        <Text style={styles.heading}>Giggle Premium</Text>
        <Text style={styles.sub}>Unlock the full Giggle experience — squad up in style.</Text>
        <Text style={styles.wallet}>{tokenBalance} tokens available</Text>

        <View style={styles.toggleRow}>
          <Text style={[styles.toggleLabel, !yearly && styles.toggleActive]}>Monthly</Text>
          <SwitchControl
            label="Use yearly billing"
            value={yearly}
            onValueChange={setYearly}
          />
          <Text style={[styles.toggleLabel, yearly && styles.toggleActive]}>Yearly</Text>
          {yearly && (
            <View style={styles.saveBadge}><Text style={styles.saveText}>-20%</Text></View>
          )}
        </View>

        <LinearGradient colors={['rgba(124,92,255,0.18)', 'rgba(124,92,255,0.06)']} style={styles.priceCard}>
          <Text style={styles.price}>{price}</Text>
          <Text style={styles.pricePeriod}>{period}</Text>
        </LinearGradient>

        <View style={styles.features}>
          {FEATURES.map((f) => {
            const IconComp = Icon[f.iconName];
            return (
              <View key={f.label} style={styles.featureRow}>
                <View style={styles.featureIcon}>
                  <IconComp size={18} color={COLORS.lime} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.featureLabel}>{f.label}</Text>
                  <Text style={styles.featureSub}>{f.sub}</Text>
                </View>
              </View>
            );
          })}
        </View>

        <Button
          label={ctaLabel}
          onPress={() => {
            if (!isPremium) setStatus('Giggle+ subscriptions are in launch prep. Earn tokens by inviting friends today.');
          }}
          variant="lime"
          style={styles.cta}
          disabled={!isPremium}
        />
        <Button label="Maybe Later" onPress={() => router.back()} variant="outline" />
        {!!status && <Text style={styles.status}>{status}</Text>}

        <Text style={styles.boostSectionLabel}>Token Packs</Text>
        <Text style={styles.storeNote}>Token packs are in launch prep. Your current balance comes from referrals and earned rewards.</Text>
        <View style={styles.boostGrid}>
          {TOKEN_PACKS.map((pack) => {
            const total = (pack.tokens ?? 0) + (pack.bonusTokens ?? 0);
            return (
              <View key={pack.id} style={styles.boostCard}>
                <Text style={styles.boostIcon}>{pack.icon}</Text>
                <Text style={styles.boostLabel}>{pack.name}</Text>
                <Text style={styles.boostSub}>{total} tokens</Text>
                <Text style={styles.boostPrice}>${pack.priceUsd.toFixed(2)}</Text>
                <TouchableOpacity
                  disabled
                  accessibilityRole="button"
                  accessibilityLabel={`${pack.name} token pack preview`}
                  accessibilityState={{ disabled: true }}
                  style={[styles.buyBtn, styles.buyBtnDisabled]}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.buyBtnText, styles.buyBtnTextDisabled]}>Preview</Text>
                </TouchableOpacity>
              </View>
            );
          })}
        </View>

        <Text style={styles.boostSectionLabel}>One-time Boosts</Text>
        <Text style={styles.storeNote}>
          {canRedeemPerks
            ? 'Redeem earned tokens for cosmetic perks.'
            : 'Perk redemption is in launch prep. Tokens are tracked now; server-backed cosmetic unlocks will arrive with checkout.'}
        </Text>
        <View style={styles.boostGrid}>
          {BOOSTS.map((b) => (
            <View key={b.label} style={styles.boostCard}>
              <Text style={styles.boostIcon}>{b.icon}</Text>
              <Text style={styles.boostLabel}>{b.label}</Text>
              <Text style={styles.boostSub}>{b.sub}</Text>
              <Text style={styles.boostPrice}>{b.cost} tokens</Text>
              <TouchableOpacity
                onPress={() => spendBoost(b.id)}
                disabled={!canRedeemPerks}
                accessibilityRole="button"
                accessibilityLabel={`${b.label}: ${billing.isPremium() ? 'Use' : 'Unlock'}`}
                accessibilityState={{ disabled: !canRedeemPerks }}
                style={[styles.buyBtn, !canRedeemPerks && styles.buyBtnDisabled]}
                activeOpacity={0.8}
              >
                <Text style={[styles.buyBtnText, !canRedeemPerks && styles.buyBtnTextDisabled]}>
                  {!canRedeemPerks ? 'Launch prep' : billing.isPremium() ? 'Use' : 'Unlock'}
                </Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: SPACE.lg, paddingTop: SPACE.xl },
  back: { marginBottom: SPACE.lg },
  backText: { color: COLORS.violet, fontSize: 16, fontWeight: '600' },
  badge: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: 'rgba(194,255,61,0.12)',
    borderWidth: 1, borderColor: 'rgba(194,255,61,0.3)',
    alignItems: 'center', justifyContent: 'center',
    alignSelf: 'center', marginBottom: SPACE.lg,
  },
  heading: { fontSize: 32, fontWeight: '900', color: COLORS.text, textAlign: 'center', marginBottom: 8 },
  sub: { fontSize: 15, color: COLORS.textMuted, textAlign: 'center', marginBottom: SPACE.xl },
  wallet: { fontSize: 14, color: COLORS.lime, textAlign: 'center', fontWeight: '800', marginBottom: SPACE.lg },
  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SPACE.md, marginBottom: SPACE.xl },
  toggleLabel: { fontSize: 15, color: COLORS.textMuted, fontWeight: '600' },
  toggleActive: { color: COLORS.text },
  saveBadge: {
    backgroundColor: 'rgba(194,255,61,0.15)', borderRadius: 999,
    paddingVertical: 3, paddingHorizontal: 10,
    borderWidth: 1, borderColor: 'rgba(194,255,61,0.35)',
  },
  saveText: { fontSize: 12, color: COLORS.lime, fontWeight: '700' },
  priceCard: {
    borderRadius: RADII.card, padding: SPACE.xl,
    alignItems: 'center', marginBottom: SPACE.xl,
    borderWidth: 1, borderColor: 'rgba(124,92,255,0.25)',
  },
  price: { fontSize: 48, fontWeight: '900', color: COLORS.text },
  pricePeriod: { fontSize: 14, color: COLORS.textMuted, marginTop: 4 },
  features: { marginBottom: SPACE.xl },
  featureRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: SPACE.md,
    paddingVertical: SPACE.md, borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  featureIcon: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: 'rgba(194,255,61,0.1)',
    alignItems: 'center', justifyContent: 'center',
  },
  featureLabel: { fontSize: 15, fontWeight: '700', color: COLORS.text },
  featureSub: { fontSize: 13, color: COLORS.textMuted, marginTop: 2 },
  cta: { marginBottom: SPACE.md },
  status: { color: COLORS.textMuted, textAlign: 'center', fontSize: 13, marginTop: SPACE.sm },
  storeNote: { color: COLORS.textMuted, fontSize: 13, lineHeight: 19, marginTop: -SPACE.md, marginBottom: SPACE.lg },
  boostSectionLabel: {
    fontSize: 18, fontWeight: '800', color: COLORS.text,
    marginTop: SPACE.xxl, marginBottom: SPACE.lg,
  },
  boostGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, paddingBottom: SPACE.xxl },
  boostCard: {
    width: '47%',
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: SPACE.lg,
    alignItems: 'center',
  },
  boostIcon: { fontSize: 28, marginBottom: 8 },
  boostLabel: { fontSize: 14, fontWeight: '700', color: COLORS.text, textAlign: 'center', marginBottom: 4 },
  boostSub: { fontSize: 12, color: COLORS.textMuted, textAlign: 'center', marginBottom: SPACE.sm },
  boostPrice: { fontSize: 18, fontWeight: '900', color: COLORS.violet, marginBottom: SPACE.md },
  buyBtn: {
    width: '100%', paddingVertical: 10, borderRadius: 999,
    backgroundColor: COLORS.violet, alignItems: 'center',
  },
  buyBtnDisabled: {
    backgroundColor: COLORS.surfaceElevated,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  buyBtnAdded: { backgroundColor: 'rgba(194,255,61,0.15)', borderWidth: 1, borderColor: COLORS.lime },
  buyBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  buyBtnTextDisabled: { color: COLORS.textDim },
});

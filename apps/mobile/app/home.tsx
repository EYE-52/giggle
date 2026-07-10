import React, { useState } from 'react';
import { View, Text, TextInput, ScrollView, StyleSheet, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { Screen } from '../components/Screen';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { VibeChip } from '../components/VibeChip';
import { Wordmark } from '../components/Wordmark';
import { Icon } from '../components/Icon';
import { COLORS, SPACE, RADII } from '../constants/theme';
import { LinearGradient } from 'expo-linear-gradient';
import { session, api, randomSquadName, formatSquadCodeInput, isValidSquadCode } from '@giggle/core';

const VIBES = ['Competitive', 'Casual', 'Chill', 'Comedy', 'Gaming', 'Late Night'];

export default function HomeScreen() {
  const router = useRouter();
  const [joinCode, setJoinCode] = useState('');
  const [activeVibe, setActiveVibe] = useState('Casual');
  const [creating, setCreating] = useState(false);
  const [joining, setJoining] = useState(false);
  const [actionError, setActionError] = useState('');

  async function ensureAuthed() {
    if (session.isAuthed()) return true;
    setActionError('Sign in to continue.');
    router.replace('/');
    return false;
  }

  async function handleCreate() {
    if (creating) return;
    setCreating(true);
    setActionError('');
    const authed = await ensureAuthed();
    if (!authed) {
      setCreating(false);
      return;
    }
    try {
      const squad = await api.createSquad({ squadName: randomSquadName(), tags: [activeVibe] });
      router.push(`/lobby?squad=${squad.squadId}`);
    } catch (e: any) {
      setActionError(e?.message || "Couldn't create a squad. Please try again.");
    } finally {
      setCreating(false);
    }
  }

  async function handleJoin() {
    if (joining) return;
    const normalizedCode = formatSquadCodeInput(joinCode);
    setJoinCode(normalizedCode);
    if (!isValidSquadCode(normalizedCode)) {
      setActionError('Enter a squad code in the format ABC-123.');
      return;
    }
    setJoining(true);
    setActionError('');
    const authed = await ensureAuthed();
    if (!authed) {
      setJoining(false);
      return;
    }
    try {
      const squad = await api.joinSquad({ squadCode: normalizedCode });
      if ('squadId' in squad) {
        router.push(`/lobby?squad=${squad.squadId}`);
      } else {
        setActionError('Request sent. The leader will review it.');
      }
    } catch (e: any) {
      setActionError(e?.message || "Couldn't join that squad. Check the code and try again.");
    } finally {
      setJoining(false);
    }
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Top Nav */}
        <View style={styles.topNav}>
          <Wordmark size={20} />
          <TouchableOpacity onPress={() => router.push('/profile')}>
            <Icon.profile size={24} color={COLORS.textMuted} />
          </TouchableOpacity>
        </View>

        {/* Compact value prop header */}
        <View style={styles.heroCopy}>
          <Text style={styles.headline}>
            Your squad,{' '}
            <Text style={styles.headlineAccent}>another squad</Text>
            {', live on video.'}
          </Text>
        </View>

        {/* Create a Squad — primary action */}
        <LinearGradient
          colors={['rgba(124,92,255,0.18)', 'rgba(124,92,255,0.06)']}
          style={styles.heroCard}
        >
          <View style={styles.heroIconRow}>
            <View style={styles.iconTile}>
              <Icon.plus size={22} color="#fff" strokeWidth={2.6} />
            </View>
            <Text style={styles.heroTitle}>Create a Squad</Text>
          </View>
          <Text style={styles.heroBody}>Invite your crew and match with another squad.</Text>
          {/* Fixed-width button to prevent layout shift on label change */}
          <Button
            label={creating ? 'Creating…' : 'Create Squad'}
            onPress={handleCreate}
            variant="violet"
            disabled={creating}
            style={styles.fixedBtn}
          />
        </LinearGradient>

        {/* Join with Code — secondary */}
        <Card style={styles.card}>
          <View style={styles.cardHeader}>
            <View style={[styles.iconTile, styles.iconTileMuted]}>
              <Icon.enter size={20} color={COLORS.textMuted} />
            </View>
            <Text style={styles.cardTitle}>Join with Code</Text>
          </View>
          <View style={styles.codeRow}>
            <TextInput
              style={styles.codeInput}
              placeholder="ENTER-CODE"
              placeholderTextColor={COLORS.textDim}
              value={joinCode}
              onChangeText={(value) => {
                setJoinCode(formatSquadCodeInput(value));
                if (actionError) setActionError('');
              }}
              autoCapitalize="characters"
              autoCorrect={false}
              spellCheck={false}
              onSubmitEditing={handleJoin}
            />
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Join squad"
              style={[styles.joinBtn, (!isValidSquadCode(joinCode) || joining) && styles.joinBtnDisabled]}
              onPress={handleJoin}
              disabled={!isValidSquadCode(joinCode) || joining}
            >
              <Text style={styles.joinBtnText}>{joining ? '…' : 'Join'}</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.feedbackArea}>
            {actionError ? <Text style={styles.errorText}>{actionError}</Text> : null}
          </View>
        </Card>

        {/* Flexible spacer */}
        <View style={{ flex: 1, minHeight: SPACE.xxl }} />

        {/* Vibe + Find — lower, lighter */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Pick your vibe</Text>
          <View style={styles.chips}>
            {VIBES.map((v) => (
              <VibeChip key={v} label={v} active={activeVibe === v} onPress={() => setActiveVibe(v)} />
            ))}
          </View>
          {/* Fixed-width button to prevent reflow */}
          <Button
            label="Find a Squad →"
            onPress={() => router.push(`/discover?vibe=${encodeURIComponent(activeVibe)}`)}
            variant="lime"
            style={styles.findBtn}
          />
        </View>

        {/* Secondary discovery path */}
        <TouchableOpacity
          onPress={() => router.push('/discover')}
          style={styles.sceneRow}
          accessibilityRole="button"
          accessibilityLabel="Browse live scenes"
        >
          <Text style={styles.sceneText}>Or browse live scenes →</Text>
        </TouchableOpacity>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: SPACE.lg, paddingTop: SPACE.md, flexGrow: 1 },

  topNav: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: SPACE.xl,
  },

  // Compact value prop — small headline, no eyebrow/subtext competing
  heroCopy: { marginBottom: SPACE.lg },
  headline: { fontSize: 22, fontWeight: '800', color: COLORS.text, letterSpacing: -0.4, lineHeight: 30 },
  headlineAccent: { color: COLORS.violet },

  heroCard: {
    borderRadius: RADII.card, padding: SPACE.lg,
    borderWidth: 1, borderColor: 'rgba(124,92,255,0.25)',
    marginBottom: SPACE.lg,
  },
  heroIconRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 8 },
  heroTitle: { fontSize: 17, fontWeight: '700', color: COLORS.text },
  heroBody: { fontSize: 13, color: COLORS.textMuted, marginBottom: SPACE.md, lineHeight: 18 },
  iconTile: {
    width: 38, height: 38, borderRadius: 11,
    backgroundColor: COLORS.violet, alignItems: 'center', justifyContent: 'center',
  },
  iconTileMuted: { backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: COLORS.border },

  // Fixed button: no layout shift when label changes
  fixedBtn: { minWidth: 160, alignSelf: 'flex-start' },

  card: { marginBottom: SPACE.lg },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: SPACE.sm },
  cardTitle: { fontSize: 15, fontWeight: '600', color: COLORS.text },
  codeRow: { flexDirection: 'row', gap: 10 },
  codeInput: {
    flex: 1, height: 46, borderRadius: RADII.input,
    backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: COLORS.border,
    color: COLORS.text, paddingHorizontal: 16, fontSize: 14, letterSpacing: 2,
  },
  joinBtn: {
    // Fixed width so "Join" vs "…" don't reflow
    width: 72, height: 46, borderRadius: RADII.input,
    backgroundColor: COLORS.violet, alignItems: 'center', justifyContent: 'center',
  },
  joinBtnDisabled: { opacity: 0.4 },
  joinBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  feedbackArea: {
    minHeight: 22,
    justifyContent: 'center',
    marginTop: SPACE.sm,
  },
  errorText: { color: COLORS.coral, fontSize: 13, lineHeight: 18 },

  // Lower, lighter section for discovery
  section: { marginBottom: SPACE.md },
  sectionLabel: {
    fontSize: 11, fontWeight: '600', color: COLORS.textDim,
    textTransform: 'uppercase', letterSpacing: 1, marginBottom: SPACE.sm,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: SPACE.md },
  findBtn: {},

  // Inline text link — minimal footprint
  sceneRow: {
    minHeight: 44,
    justifyContent: 'center',
    paddingVertical: SPACE.sm,
    marginBottom: SPACE.lg,
  },
  sceneText: { fontSize: 13, color: COLORS.textDim },
});

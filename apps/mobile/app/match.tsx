import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, ImageBackground, ScrollView, useWindowDimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Screen } from '../components/Screen';
import { Button } from '../components/Button';
import { AvatarStack } from '../components/Avatar';
import { squadCoverSource } from '../components/squadCover';
import { COLORS, SPACE } from '../constants/theme';
import { api, ApiError, session } from '@giggle/core';
import type { EncounterDetail, SquadState } from '@giggle/core';

function isExpiredEncounterError(error: unknown) {
  return error instanceof ApiError && ['ENCOUNTER_EXPIRED', 'ENCOUNTER_ENDED', 'ENCOUNTER_NOT_FOUND'].includes(error.code);
}

export default function MatchScreen() {
  const router = useRouter();
  const { height } = useWindowDimensions();
  const compact = height < 700;
  const params = useLocalSearchParams<{ squad?: string; enc?: string }>();
  const squadId = typeof params.squad === 'string' ? params.squad : undefined;
  const encId = typeof params.enc === 'string' ? params.enc : undefined;

  const [enc, setEnc] = useState<EncounterDetail | null>(null);
  const [squad, setSquad] = useState<SquadState | null>(null);
  const [loading, setLoading] = useState(true);
  const [countdown, setCountdown] = useState(1);
  const [countdownTotal, setCountdownTotal] = useState(1);
  const [deadlineMs, setDeadlineMs] = useState<number | null>(null);
  const [joinError, setJoinError] = useState('');
  const [encounterError, setEncounterError] = useState('');
  const [handoffExpired, setHandoffExpired] = useState(false);
  const [joining, setJoining] = useState(false);
  const [skipping, setSkipping] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const expiryHandled = useRef(false);

  useEffect(() => {
    if (!encId || !squadId) {
      router.replace(squadId ? `/matchmaking?squad=${squadId}` : '/home');
      return;
    }
    let active = true;
    setLoading(true);
    setEncounterError('');
    setHandoffExpired(false);
    setJoinError('');
    setDeadlineMs(null);
    expiryHandled.current = false;

    Promise.all([
      api.getEncounter(encId),
      api.getSquad(squadId).catch(() => null),
    ]).then(([encounterData, squadData]) => {
      if (!active) return;
      if (encounterData.status === 'active') {
        router.replace(`/encounter?squad=${squadId}&enc=${encId}`);
        return;
      }
      const deadline = Date.parse(encounterData.expiresAt);
      if (!Number.isFinite(deadline)) throw new Error('Match timing is unavailable. Try again.');
      const secondsLeft = Math.ceil((deadline - Date.now()) / 1000);
      if (encounterData.status === 'ended' || secondsLeft <= 0) {
        setHandoffExpired(true);
        setEncounterError('This match handoff has expired.');
        setLoading(false);
        return;
      }
      setEnc(encounterData);
      setSquad(squadData);
      setCountdown(secondsLeft);
      setCountdownTotal(secondsLeft);
      setDeadlineMs(deadline);
      setLoading(false);
    }).catch((error: unknown) => {
      if (!active) return;
      const expired = isExpiredEncounterError(error);
      setHandoffExpired(expired);
      setEncounterError(expired ? 'This match handoff has expired.' : error instanceof Error ? error.message : "Couldn't load this match.");
      setLoading(false);
    });

    return () => { active = false; };
  }, [encId, loadAttempt, router, squadId]);

  useEffect(() => {
    if (!deadlineMs) return;
    const update = () => setCountdown(Math.max(0, Math.ceil((deadlineMs - Date.now()) / 1000)));
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [deadlineMs]);

  const yoursIsA = enc?.squadAId === squadId;
  const yourMembers = enc ? (yoursIsA ? enc.squadAMembers : enc.squadBMembers) : [];
  const theirMembers = enc ? (yoursIsA ? enc.squadBMembers : enc.squadAMembers) : [];
  const yourName = enc ? (yoursIsA ? enc.squadAName : enc.squadBName) : '';
  const theirName = enc ? (yoursIsA ? enc.squadBName : enc.squadAName) : '';
  const yourCover = enc ? (yoursIsA ? enc.squadACover : enc.squadBCover) : null;
  const theirCover = enc ? (yoursIsA ? enc.squadBCover : enc.squadACover) : null;
  const yourCoverImage = squadCoverSource(yourCover);
  const theirCoverImage = squadCoverSource(theirCover);
  const myMember = squad?.members.find((member) => member.userId === session.user?.id)
    ?? yourMembers.find((member) => member.userId === session.user?.id);
  const isLeader = myMember?.role === 'leader';
  const vibeLabel = squad?.tags?.slice(0, 2).join(' & ');

  const handleJoin = useCallback(async () => {
    setJoinError('');
    if (!encId || !squadId || joining) return;
    setJoining(true);
    try {
      await api.ackEncounter(encId, squadId);
      router.replace(`/encounter?squad=${squadId}&enc=${encId}`);
    } catch (e: any) {
      if (isExpiredEncounterError(e)) {
        setHandoffExpired(true);
        setEncounterError('This match handoff has expired.');
      } else {
        setJoinError(e?.message || "Couldn't join this encounter yet.");
      }
      setJoining(false);
    }
  }, [encId, joining, router, squadId]);

  const handleSkip = useCallback(async () => {
    setJoinError('');
    if (!squadId || !encId) return;
    if (isLeader) {
      setSkipping(true);
      try {
        await api.skip(squadId, encId);
      } catch (e: any) {
        setJoinError(e?.message || "Couldn't skip this match yet.");
        setSkipping(false);
        return;
      }
    }
    router.replace(`/matchmaking?squad=${squadId}`);
  }, [encId, isLeader, router, squadId]);

  useEffect(() => {
    if (!enc || countdown > 0 || expiryHandled.current || !squadId || !encId) return;
    expiryHandled.current = true;
    if (!isLeader) {
      router.replace(`/matchmaking?squad=${squadId}`);
      return;
    }
    api.skip(squadId, encId)
      .then(() => router.replace(`/matchmaking?squad=${squadId}`))
      .catch((e: any) => {
        setHandoffExpired(true);
        setEncounterError(e?.message || "Couldn't refresh this match yet.");
      });
  }, [countdown, enc, encId, isLeader, router, squadId]);

  if (loading) {
    return (
      <Screen>
        <View style={styles.centerState}>
          <Text style={styles.stateTitle}>Loading match</Text>
          <Text style={styles.stateCopy}>Pulling in the real squad details.</Text>
        </View>
      </Screen>
    );
  }

  if (encounterError || !enc) {
    return (
      <Screen>
        <View style={styles.centerState}>
          <Text style={styles.stateTitle}>{handoffExpired ? 'Match unavailable' : "Couldn't open match"}</Text>
          <Text style={styles.stateCopy}>{encounterError || 'This match is no longer available.'}</Text>
          <Button
            label={handoffExpired ? 'Find another' : 'Retry'}
            onPress={handoffExpired ? handleSkip : () => setLoadAttempt((attempt) => attempt + 1)}
            variant="violet"
            disabled={skipping}
            style={styles.fullButton}
          />
          <Button label="Home" onPress={() => router.replace('/home')} variant="outline" style={styles.fullButton} />
          {!!joinError && <Text style={styles.errorText}>{joinError}</Text>}
        </View>
      </Screen>
    );
  }

  const progress = Math.max(0, Math.min(1, countdown / countdownTotal));

  return (
    <Screen>
      <ScrollView contentContainerStyle={[styles.container, compact && styles.containerCompact]} showsVerticalScrollIndicator={false}>
        <Text style={styles.eyebrow}>MATCH FOUND</Text>
        <Text style={styles.heading}>Your squads are ready.</Text>

        <View style={[styles.versus, compact && styles.versusCompact]}>
          <ImageBackground
            source={yourCoverImage}
            style={[styles.squadCol, compact && styles.squadColCompact, !yourCoverImage && styles.yourFallback]}
            imageStyle={styles.panelImage}
            resizeMode="cover"
          >
            <LinearGradient colors={['rgba(11,11,20,0.15)', 'rgba(11,11,20,0.92)']} style={StyleSheet.absoluteFill} />
            <View style={styles.squadContent}>
              <Text style={styles.sideLabel}>YOUR SQUAD</Text>
              <AvatarStack names={yourMembers.map((member) => member.displayName)} size={30} />
              <Text style={styles.squadName} numberOfLines={2}>{yourName}</Text>
              <Text style={styles.squadRep}>{yourMembers.length} members</Text>
            </View>
          </ImageBackground>

          <View style={styles.vsBadge}><Text style={styles.vsText}>VS</Text></View>

          <ImageBackground
            source={theirCoverImage}
            style={[styles.squadCol, compact && styles.squadColCompact, !theirCoverImage && styles.theirFallback]}
            imageStyle={styles.panelImage}
            resizeMode="cover"
          >
            <LinearGradient colors={['rgba(7,18,13,0.12)', 'rgba(7,18,13,0.92)']} style={StyleSheet.absoluteFill} />
            <View style={styles.squadContent}>
              <Text style={[styles.sideLabel, styles.opponentLabel]}>OPPONENT</Text>
              <AvatarStack names={theirMembers.map((member) => member.displayName)} size={30} />
              <Text style={styles.squadName} numberOfLines={2}>{theirName}</Text>
              <Text style={styles.squadRep}>{theirMembers.length} members</Text>
            </View>
          </ImageBackground>
        </View>

        <View style={styles.actionCard}>
          {!!vibeLabel && <Text style={styles.vibeText}>Vibe match · {vibeLabel}</Text>}
          <View style={styles.deadlineRow}>
            <View>
              <Text style={styles.deadlineLabel}>Handoff closes in</Text>
              <Text style={styles.deadlineValue}>{countdown}s</Text>
            </View>
            <Text style={styles.deadlineHint}>Join when your squad is ready.</Text>
          </View>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
          </View>
          <Button
            label={joining ? 'Joining…' : 'Join Encounter'}
            onPress={handleJoin}
            variant="violet"
            disabled={joining || handoffExpired}
            style={styles.fullButton}
          />
          {isLeader && (
            <Button
              label={skipping ? 'Skipping…' : 'Skip match'}
              onPress={handleSkip}
              variant="outline"
              disabled={skipping || joining}
              style={styles.fullButton}
            />
          )}
          {!isLeader && <Text style={styles.leaderHint}>Your squad leader can skip this match.</Text>}
          {!!joinError && <Text style={styles.errorText} accessibilityLiveRegion="polite">{joinError}</Text>}
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, justifyContent: 'center', padding: SPACE.lg, paddingVertical: SPACE.xl },
  containerCompact: { justifyContent: 'flex-start', paddingVertical: SPACE.md },
  eyebrow: { color: COLORS.lime, fontSize: 11, fontWeight: '900', letterSpacing: 1.4, textAlign: 'center' },
  heading: { color: COLORS.text, fontSize: 26, fontWeight: '900', textAlign: 'center', marginTop: 4, marginBottom: SPACE.lg },
  versus: { flexDirection: 'row', alignItems: 'center', width: '100%', marginBottom: SPACE.lg },
  versusCompact: { marginBottom: SPACE.md },
  squadCol: { flex: 1, height: 184, justifyContent: 'flex-end', borderRadius: 20, overflow: 'hidden' },
  squadColCompact: { height: 144 },
  yourFallback: { backgroundColor: '#211943' },
  theirFallback: { backgroundColor: '#173528' },
  panelImage: { width: '100%', height: '100%', borderRadius: 20 },
  squadContent: { gap: 5, padding: SPACE.md, alignItems: 'center' },
  sideLabel: { color: '#C7BEFF', fontSize: 9, fontWeight: '900', letterSpacing: 1 },
  opponentLabel: { color: COLORS.lime },
  squadName: { minHeight: 36, color: COLORS.text, fontSize: 15, lineHeight: 18, fontWeight: '800', textAlign: 'center' },
  squadRep: { color: COLORS.textMuted, fontSize: 11 },
  vsBadge: {
    width: 46, height: 46, zIndex: 2, marginHorizontal: -4, borderRadius: 23,
    alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.bgDeep,
    borderWidth: 1, borderColor: COLORS.border,
  },
  vsText: { color: COLORS.text, fontSize: 14, fontWeight: '900' },
  actionCard: {
    width: '100%', gap: SPACE.sm, padding: SPACE.lg, borderRadius: 20,
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border,
  },
  vibeText: { color: COLORS.textMuted, fontSize: 12, fontWeight: '700', textAlign: 'center' },
  deadlineRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: SPACE.md },
  deadlineLabel: { color: COLORS.textMuted, fontSize: 11, fontWeight: '700' },
  deadlineValue: { color: COLORS.text, fontSize: 30, lineHeight: 34, fontWeight: '900' },
  deadlineHint: { flex: 1, maxWidth: 150, color: COLORS.textMuted, fontSize: 12, lineHeight: 17, textAlign: 'right' },
  progressTrack: { height: 4, overflow: 'hidden', borderRadius: 2, backgroundColor: COLORS.border, marginBottom: SPACE.sm },
  progressFill: { height: '100%', borderRadius: 2, backgroundColor: COLORS.lime },
  fullButton: { width: '100%' },
  leaderHint: { minHeight: 36, color: COLORS.textDim, fontSize: 12, textAlign: 'center', textAlignVertical: 'center' },
  errorText: { color: COLORS.coral, fontSize: 13, lineHeight: 18, fontWeight: '700', textAlign: 'center' },
  centerState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: SPACE.md, padding: SPACE.xl },
  stateTitle: { color: COLORS.text, fontSize: 22, fontWeight: '900', textAlign: 'center' },
  stateCopy: { maxWidth: 340, color: COLORS.textMuted, fontSize: 14, lineHeight: 21, textAlign: 'center', marginBottom: SPACE.sm },
});

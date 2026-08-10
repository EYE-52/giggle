import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, ImageBackground, ScrollView, useWindowDimensions } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Screen } from '../../components/Screen';
import { Button } from '../../components/Button';
import { AvatarStack } from '../../components/Avatar';
import { squadCoverSource } from '../../components/squadCover';
import { COLORS, RADII, SPACE } from '../../constants/theme';
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
  const crews = [
    { label: 'Your crew', name: yourName, members: yourMembers, cover: yourCoverImage },
    { label: 'Joining you', name: theirName, members: theirMembers, cover: theirCoverImage },
  ];

  return (
    <Screen>
      <ScrollView contentContainerStyle={[styles.container, compact && styles.containerCompact]} showsVerticalScrollIndicator={false}>
        <Text style={styles.eyebrow}>THE ROOM IS OPEN</Text>
        <Text style={styles.heading}>Room ready</Text>

        <View style={[styles.roomCard, compact && styles.roomCardCompact]}>
          {crews.map((crew, index) => {
            const names = crew.members.map((member) => member.displayName);
            const shownNames = names.slice(0, 4);
            return (
              <React.Fragment key={crew.label}>
                {index > 0 && <View style={styles.crewDivider} />}
                <View style={styles.crewRow}>
                  {crew.cover ? (
                    <ImageBackground source={crew.cover} style={styles.coverThumb} imageStyle={styles.coverImage} resizeMode="cover" />
                  ) : (
                    <View style={styles.coverThumb} />
                  )}
                  <View style={styles.crewCopy}>
                    <Text style={styles.sideLabel}>{crew.label}</Text>
                    <Text style={styles.squadName} numberOfLines={1}>{crew.name}</Text>
                    <Text style={styles.squadRep}>{crew.members.length} members</Text>
                  </View>
                  <AvatarStack names={shownNames} size={28} extra={Math.max(0, names.length - shownNames.length)} />
                </View>
              </React.Fragment>
            );
          })}
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
  roomCard: {
    width: '100%', marginBottom: SPACE.lg, padding: SPACE.md, borderRadius: RADII.card,
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border,
  },
  roomCardCompact: { marginBottom: SPACE.md },
  crewRow: { minHeight: 74, flexDirection: 'row', alignItems: 'center', gap: SPACE.md },
  crewDivider: { height: 1, marginVertical: SPACE.sm, backgroundColor: COLORS.border },
  coverThumb: { width: 56, height: 56, borderRadius: RADII.tile, overflow: 'hidden', backgroundColor: COLORS.violetSoft },
  coverImage: { borderRadius: RADII.tile },
  crewCopy: { flex: 1, minWidth: 0 },
  sideLabel: { color: COLORS.textMuted, fontSize: 10, fontWeight: '900', letterSpacing: 0.8, textTransform: 'uppercase' },
  squadName: { color: COLORS.text, fontSize: 15, lineHeight: 19, fontWeight: '800', marginTop: 3 },
  squadRep: { color: COLORS.textMuted, fontSize: 11 },
  actionCard: {
    width: '100%', gap: SPACE.sm, padding: SPACE.lg, borderRadius: RADII.card,
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

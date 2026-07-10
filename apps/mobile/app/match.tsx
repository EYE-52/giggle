import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ImageBackground } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Screen } from '../components/Screen';
import { Button } from '../components/Button';
import { AvatarStack } from '../components/Avatar';
import { COLORS, SPACE } from '../constants/theme';
import { api } from '@giggle/core';
import type { EncounterDetail } from '@giggle/core';

const VIBE_TAGS = ['Casual', 'Gaming', 'Late Night'];

export default function MatchScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ squad?: string; enc?: string }>();
  const squadId = typeof params.squad === 'string' ? params.squad : undefined;
  const encId = typeof params.enc === 'string' ? params.enc : undefined;

  const [enc, setEnc] = useState<EncounterDetail | null>(null);
  const [countdown, setCountdown] = useState(10);
  const [joinError, setJoinError] = useState('');
  const [encounterError, setEncounterError] = useState('');
  const canAutoJoin = Boolean(encId && squadId);

  const handleJoin = useCallback(async () => {
    setJoinError('');
    if (encId && squadId) {
      try {
        await api.ackEncounter(encId, squadId);
      } catch (e: any) {
        setJoinError(e?.message || "Couldn't join this encounter yet.");
        return;
      }
      router.push(`/encounter?squad=${squadId}&enc=${encId}`);
      return;
    }
    router.push('/encounter');
  }, [encId, router, squadId]);

  const handleSkip = useCallback(async () => {
    setJoinError('');
    if (squadId && encId) {
      try {
        await api.skip(squadId, encId);
      } catch (e: any) {
        setJoinError(e?.message || "Couldn't skip this match yet.");
        return;
      }
    }
    router.push(squadId ? `/matchmaking?squad=${squadId}` : '/matchmaking');
  }, [encId, router, squadId]);

  useEffect(() => {
    if (!encId) return;
    (async () => {
      setEncounterError('');
      try {
        setEnc(await api.getEncounter(encId));
      } catch (e: any) {
        setEncounterError(e?.message || "Couldn't load this match.");
      }
    })();
  }, [encId]);

  useEffect(() => {
    if (!canAutoJoin) return;
    const t = setInterval(() => {
      setCountdown((c) => Math.max(0, c - 1));
    }, 1000);
    return () => clearInterval(t);
  }, [canAutoJoin]);

  useEffect(() => {
    if (canAutoJoin && countdown === 0) {
      handleJoin();
    }
  }, [canAutoJoin, countdown, handleJoin]);

  // Decide which side is "yours" based on the squad id we arrived with.
  const yoursIsA = enc ? enc.squadAId === squadId : true;
  const yourName = enc ? (yoursIsA ? enc.squadAName : enc.squadBName) : 'Preview squad';
  const yourMembers = enc ? (yoursIsA ? enc.squadAMembers : enc.squadBMembers) : [];
  const theirName = enc ? (yoursIsA ? enc.squadBName : enc.squadAName) : 'Matched squad';
  const theirMembers = enc ? (yoursIsA ? enc.squadBMembers : enc.squadAMembers) : [];
  const waitingForEncounter = Boolean(encId && !enc);

  return (
    <Screen>
      <View style={styles.container}>
        <Text style={styles.heading}>MATCH FOUND!</Text>

        {waitingForEncounter ? (
          <View style={styles.matchState}>
            <Text style={styles.matchStateTitle}>{encounterError ? 'Match unavailable' : 'Loading match'}</Text>
            <Text style={styles.matchStateCopy}>
              {encounterError || 'Pulling in the real squad details before opening this match.'}
            </Text>
          </View>
        ) : (
          <View style={styles.versus}>
          <ImageBackground
            source={require('../assets/img/match-your-squad.jpg')}
            style={styles.squadCol}
            imageStyle={styles.panelImage}
            resizeMode="cover"
          >
            <View style={styles.panelScrim} />
            <AvatarStack names={yourMembers.map((m) => m.displayName)} size={34} />
            <Text style={styles.squadName}>{yourName}</Text>
            <Text style={styles.squadRep}>{yourMembers.length} members</Text>
          </ImageBackground>

          <View style={styles.vsBadge}>
            <Text style={styles.vsText}>VS</Text>
          </View>

          <ImageBackground
            source={require('../assets/img/match-opponent-squad.jpg')}
            style={styles.squadCol}
            imageStyle={styles.panelImage}
            resizeMode="cover"
          >
            <View style={styles.panelScrim} />
            <AvatarStack names={theirMembers.map((m) => m.displayName)} size={34} />
            <Text style={styles.squadName}>{theirName}</Text>
            <Text style={styles.squadRep}>{theirMembers.length} members</Text>
          </ImageBackground>
          </View>
        )}

        <View style={styles.vibeRow}>
          {VIBE_TAGS.map((tag) => (
            <View key={tag} style={styles.vibeTag}>
              <Text style={styles.vibeTagText}>{tag}</Text>
            </View>
          ))}
        </View>

        <View style={styles.countdownBlock}>
          {canAutoJoin ? (
            <>
              <Text style={styles.countdownCaption}>Auto-joining in</Text>
              <Text style={styles.countdownNumber}>{countdown}</Text>
              <Text style={styles.countdownSub}>seconds</Text>
            </>
          ) : (
            <>
              <Text style={styles.countdownCaption}>Preview match flow</Text>
              <Text style={styles.countdownNumber}>Ready</Text>
              <Text style={styles.countdownSub}>Start a squad to match live</Text>
            </>
          )}
        </View>

        <View style={styles.joinBtnWrapper}>
          <Button label={canAutoJoin ? 'Join Encounter' : 'Preview Encounter'} onPress={handleJoin} variant="violet" style={styles.btn} />
        </View>
        {joinError ? <Text style={styles.errorText}>{joinError}</Text> : null}
        <Button label="Skip" onPress={handleSkip} variant="outline" style={styles.btn} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: SPACE.xl },

  heading: {
    fontSize: 32,
    fontWeight: '900',
    color: COLORS.text,
    letterSpacing: -0.5,
    marginBottom: SPACE.xl,
    textAlign: 'center',
  },

  versus: { flexDirection: 'row', alignItems: 'center', width: '100%', marginBottom: SPACE.lg },
  matchState: {
    width: '100%',
    minHeight: 200,
    alignItems: 'center',
    justifyContent: 'center',
    padding: SPACE.xl,
    marginBottom: SPACE.lg,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
  },
  matchStateTitle: {
    color: COLORS.text,
    fontSize: 18,
    fontWeight: '900',
    textAlign: 'center',
  },
  matchStateCopy: {
    color: COLORS.textMuted,
    fontSize: 13,
    lineHeight: 20,
    textAlign: 'center',
    marginTop: 8,
  },

  squadCol: {
    flex: 1,
    height: 200,
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACE.sm,
    borderRadius: 20,
    overflow: 'hidden',
  },
  panelImage: { width: '100%', height: '100%', borderRadius: 20 },
  panelScrim: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(11,11,15,0.6)' },

  squadName: { fontSize: 16, fontWeight: '700', color: COLORS.text, textAlign: 'center' },
  squadRep: { fontSize: 12, color: COLORS.textMuted },

  vsBadge: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: COLORS.violet,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: SPACE.md,
    boxShadow: '0 0 16px rgba(124,92,255,0.6)',
    elevation: 10,
  },
  vsText: { fontSize: 16, fontWeight: '900', color: '#fff' },

  vibeRow: {
    flexDirection: 'row',
    gap: SPACE.sm,
    marginBottom: SPACE.xl,
  },
  vibeTag: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 14,
  },
  vibeTagText: { fontSize: 13, color: COLORS.textMuted },

  countdownBlock: {
    alignItems: 'center',
    marginBottom: SPACE.xl,
  },
  countdownCaption: { fontSize: 13, color: COLORS.textMuted },
  countdownNumber: { fontSize: 40, fontWeight: '900', color: COLORS.lime },
  countdownSub: { fontSize: 13, color: COLORS.textDim },

  joinBtnWrapper: {
    width: '100%',
    boxShadow: '0 4px 12px rgba(124,92,255,0.45)',
    elevation: 8,
    marginBottom: SPACE.md,
  },
  errorText: {
    width: '100%',
    color: COLORS.coral,
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: SPACE.md,
  },
  btn: { width: '100%' },
});

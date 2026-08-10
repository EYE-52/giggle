import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Screen } from '../../components/Screen';
import { Button } from '../../components/Button';
import { AvatarStack } from '../../components/Avatar';
import { COLORS, RADII, SPACE } from '../../constants/theme';
import { api, connectSocket, session, SOCKET_EVENTS } from '@giggle/core';
import type { SquadState } from '@giggle/core';

export default function MatchmakingScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ squad?: string }>();
  const squadId = typeof params.squad === 'string' ? params.squad : undefined;

  const navigated = useRef(false);
  const cancellingRef = useRef(false);
  const [cancelling, setCancelling] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [squad, setSquad] = useState<SquadState | null>(null);
  const [squadError, setSquadError] = useState('');
  const [cancelError, setCancelError] = useState('');
  const [statusError, setStatusError] = useState('');

  const loadSquad = useCallback(async () => {
    if (!squadId) return;
    setSquadError('');
    try {
      setSquad(await api.getSquad(squadId));
    } catch (e: any) {
      setSquadError(e?.message || "Couldn't load your squad details.");
    }
  }, [squadId]);

  const goToMatch = useCallback((encounterId: string) => {
    if (navigated.current || cancellingRef.current || !squadId) return;
    navigated.current = true;
    router.replace(`/match?squad=${squadId}&enc=${encounterId}`);
  }, [router, squadId]);

  useEffect(() => {
    if (!squadId) return;

    navigated.current = false;
    cancellingRef.current = false;
    setCancelling(false);
    setElapsed(0);
    void loadSquad();
    const elapsedTimer = setInterval(() => setElapsed((value) => value + 1), 1000);

    let inactive = false;
    const checkStatus = async () => {
      try {
        const status = await api.matchStatus(squadId);
        if (inactive || cancellingRef.current) return;
        setStatusError('');
        if (status.match?.encounterId) goToMatch(status.match.encounterId);
        else if (status.state !== 'searching') {
          navigated.current = true;
          router.replace(`/lobby?squad=${squadId}`);
        }
      } catch (e: any) {
        if (inactive || cancellingRef.current) return;
        setStatusError(e?.message || "Couldn't refresh matchmaking status.");
      }
    };
    let pollTimeout: ReturnType<typeof setTimeout> | undefined;
    const schedulePoll = () => {
      if (inactive || navigated.current) return;
      pollTimeout = setTimeout(async () => {
        if (inactive || navigated.current) return;
        if (cancellingRef.current) {
          schedulePoll();
          return;
        }
        await checkStatus();
        schedulePoll();
      }, 2000);
    };
    void checkStatus().then(schedulePoll);

    let cleanup: (() => void) | undefined;
    try {
      const sock = connectSocket(squadId);
      const onFound = (payload: any) => {
        const enc = payload?.encounterId || payload?.match?.encounterId;
        if (enc) goToMatch(enc);
      };
      const onSquadUpdated = () => { void loadSquad(); };
      sock.on(SOCKET_EVENTS.MATCH_FOUND, onFound);
      sock.on(SOCKET_EVENTS.SQUAD_UPDATED, onSquadUpdated);
      cleanup = () => {
        sock.off(SOCKET_EVENTS.MATCH_FOUND, onFound);
        sock.off(SOCKET_EVENTS.SQUAD_UPDATED, onSquadUpdated);
      };
    } catch (e: any) {
      setStatusError(e?.message || "Couldn't refresh matchmaking status.");
    }

    return () => {
      inactive = true;
      clearInterval(elapsedTimer);
      if (pollTimeout) clearTimeout(pollTimeout);
      cleanup?.();
    };
  }, [goToMatch, loadSquad, router, squadId]);

  async function cancel() {
    if (!squadId || cancellingRef.current) return;
    cancellingRef.current = true;
    setCancelling(true);
    setCancelError('');
    try {
      await api.cancelSearch(squadId);
    } catch (e: any) {
      cancellingRef.current = false;
      setCancelling(false);
      setCancelError(e?.message || "Couldn't cancel search yet.");
      return;
    }
    navigated.current = true;
    router.replace(`/lobby?squad=${squadId}`);
  }

  if (!squadId) {
    return (
      <Screen>
        <View style={styles.container}>
          <Text style={styles.heading}>No squad selected</Text>
          <Text style={styles.sub}>Start matchmaking from a squad lobby so we know who to pair you with.</Text>
          <Button label="Back to home" onPress={() => router.replace('/home')} style={styles.fullWidth} />
        </View>
      </Screen>
    );
  }

  const names = squad?.members.map((member) => member.displayName) ?? [];
  const isLeader = squad?.members.some((member) =>
    member.memberId === squad.leaderMemberId && member.userId === session.user?.id
  ) ?? false;
  const shownNames = names.slice(0, 4);
  const extraNames = Math.max(0, names.length - shownNames.length);
  const statusCopy = elapsed < 4
    ? 'Checking active squads'
    : elapsed < 10
      ? "Matching your squad's vibes"
      : 'Finding the strongest live match';
  const elapsedLabel = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`;

  return (
    <Screen>
      <View style={styles.container}>
        <View style={styles.signal} accessibilityRole="progressbar" accessibilityLabel="Searching for a squad">
          <View style={styles.signalDot} />
        </View>

        <Text style={styles.heading}>Finding your match…</Text>
        <Text style={styles.sub}>
          {elapsed >= 20 ? 'Still searching — few squads are live right now.' : "Looking for a squad that matches your crew's vibe."}
        </Text>

        <View style={styles.squadCard} accessibilityLabel="Your squad">
          {squad ? (
            <>
              <AvatarStack names={shownNames} size={30} extra={extraNames} />
              <View style={styles.squadCopy}>
                <Text style={styles.squadName} numberOfLines={1}>{squad.squadName}</Text>
                <Text style={styles.squadMembers} numberOfLines={1}>{names.join(' · ')}</Text>
              </View>
              <Text style={styles.together}>{names.length} together</Text>
            </>
          ) : (
            <Text style={styles.loadingSquad}>Keeping your squad together…</Text>
          )}
        </View>

        {squadError ? (
          <View style={styles.inlineError}>
            <Text style={styles.errorText}>{squadError}</Text>
            <Button label="Retry squad details" onPress={() => void loadSquad()} variant="outline" style={styles.retryButton} />
          </View>
        ) : null}

        <View style={styles.queueMeta}>
          <Text style={styles.queueTime}>{elapsedLabel}</Text>
          <View style={styles.queueState}>
            <View style={styles.liveDot} />
            <Text style={styles.queueStateText}>{statusCopy}</Text>
          </View>
        </View>

        {isLeader ? (
          <Button
            label={cancelling ? 'Cancelling…' : cancelError ? 'Try cancel again' : 'Cancel search'}
            onPress={cancel}
            variant="outline"
            style={styles.cancel}
            disabled={cancelling}
          />
        ) : squad ? (
          <Text style={styles.leaderHint}>Your squad leader can cancel the search.</Text>
        ) : null}
        {statusError ? (
          <View style={styles.statusError}>
            <Text style={styles.statusErrorTitle}>Queue status unavailable</Text>
            <Text style={styles.statusErrorText}>{statusError}</Text>
          </View>
        ) : null}
        {cancelError ? <Text style={styles.errorText}>{cancelError}</Text> : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: SPACE.md, padding: SPACE.xl },
  signal: {
    width: 64, height: 64, borderRadius: RADII.tile, alignItems: 'center', justifyContent: 'center',
    backgroundColor: COLORS.violetSoft, borderWidth: 1, borderColor: COLORS.border,
  },
  signalDot: { width: 13, height: 13, borderRadius: 7, backgroundColor: COLORS.violet },
  heading: { fontSize: 28, fontWeight: '900', color: COLORS.text, textAlign: 'center' },
  sub: { maxWidth: 360, minHeight: 42, fontSize: 14, lineHeight: 20, color: COLORS.textMuted, textAlign: 'center' },
  fullWidth: { width: '100%' },
  squadCard: {
    width: '100%', minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: SPACE.md,
    padding: SPACE.md, borderRadius: RADII.tile, backgroundColor: COLORS.surface,
    borderWidth: 1, borderColor: COLORS.border,
  },
  squadCopy: { flex: 1, minWidth: 0 },
  squadName: { color: COLORS.text, fontSize: 14, fontWeight: '800' },
  squadMembers: { color: COLORS.textMuted, fontSize: 11, marginTop: 3 },
  together: { color: COLORS.lime, fontSize: 11, fontWeight: '800' },
  loadingSquad: { flex: 1, color: COLORS.textMuted, fontSize: 13, textAlign: 'center' },
  queueMeta: { width: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  queueTime: { color: COLORS.text, fontSize: 18, fontWeight: '900', fontVariant: ['tabular-nums'] as any },
  queueState: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: SPACE.sm },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: COLORS.lime },
  queueStateText: { flexShrink: 1, color: COLORS.textMuted, fontSize: 12, textAlign: 'right' },
  cancel: { width: '100%', marginTop: SPACE.sm },
  leaderHint: { minHeight: 44, color: COLORS.textMuted, fontSize: 12, lineHeight: 18, textAlign: 'center', textAlignVertical: 'center' },
  inlineError: { width: '100%', alignItems: 'center', gap: SPACE.sm },
  retryButton: { width: '100%' },
  statusError: {
    width: '100%', padding: SPACE.sm, borderRadius: RADII.tile,
    borderWidth: 1, borderColor: COLORS.coral, backgroundColor: COLORS.coralSoft,
  },
  statusErrorTitle: { color: COLORS.coral, fontSize: 12, fontWeight: '900', textAlign: 'center' },
  statusErrorText: { color: COLORS.textMuted, fontSize: 12, lineHeight: 17, marginTop: 2, textAlign: 'center' },
  errorText: { color: COLORS.coral, fontSize: 13, lineHeight: 18, fontWeight: '700', textAlign: 'center' },
});

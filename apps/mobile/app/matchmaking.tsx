import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Animated, StyleSheet, Platform } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Screen } from '../components/Screen';
import { Button } from '../components/Button';
import { Avatar } from '../components/Avatar';
import { COLORS, SPACE } from '../constants/theme';
import { api, connectSocket, session, SOCKET_EVENTS } from '@giggle/core';

const USE_NATIVE_DRIVER = Platform.OS !== 'web';

export default function MatchmakingScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ squad?: string }>();
  const squadId = typeof params.squad === 'string' ? params.squad : undefined;

  const ring1 = useRef(new Animated.Value(0)).current;
  const ring2 = useRef(new Animated.Value(0)).current;
  const ring3 = useRef(new Animated.Value(0)).current;
  const rotation = useRef(new Animated.Value(0)).current;
  const navigated = useRef(false);
  const [cancelError, setCancelError] = useState('');
  const [statusError, setStatusError] = useState('');

  const createRingAnim = (val: Animated.Value, delay: number) =>
    Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(val, { toValue: 1, duration: 2000, useNativeDriver: USE_NATIVE_DRIVER }),
        Animated.timing(val, { toValue: 0, duration: 0, useNativeDriver: USE_NATIVE_DRIVER }),
      ])
    );

  function goToMatch(encounterId: string) {
    if (navigated.current || !squadId) return;
    navigated.current = true;
    router.push(`/match?squad=${squadId}&enc=${encounterId}`);
  }

  useEffect(() => {
    if (!squadId) return;

    navigated.current = false;
    const ringAnimations = [createRingAnim(ring1, 0), createRingAnim(ring2, 600), createRingAnim(ring3, 1200)];
    const rotationAnimation = Animated.loop(
      Animated.timing(rotation, { toValue: 1, duration: 6000, useNativeDriver: USE_NATIVE_DRIVER })
    );
    ringAnimations.forEach((animation) => animation.start());
    rotationAnimation.start();

    let inactive = false;
    const checkStatus = async () => {
      try {
        const status = await api.matchStatus(squadId);
        if (inactive) return;
        setStatusError('');
        if (status.match?.encounterId) goToMatch(status.match.encounterId);
        else if (status.state !== 'searching') {
          navigated.current = true;
          router.replace(`/lobby?squad=${squadId}`);
        }
      } catch (e: any) {
        if (inactive) return;
        setStatusError(e?.message || "Couldn't refresh matchmaking status.");
      }
    };
    void checkStatus();
    const poll = setInterval(checkStatus, 2000);

    let cleanup: (() => void) | undefined;
    try {
      const sock = connectSocket(squadId);
      const onFound = (payload: any) => {
        const enc = payload?.encounterId || payload?.match?.encounterId;
        if (enc) goToMatch(enc);
      };
      sock.on(SOCKET_EVENTS.MATCH_FOUND, onFound);
      cleanup = () => sock.off(SOCKET_EVENTS.MATCH_FOUND, onFound);
    } catch (e: any) {
      setStatusError(e?.message || "Couldn't refresh matchmaking status.");
    }

    return () => {
      inactive = true;
      clearInterval(poll);
      cleanup?.();
      ringAnimations.forEach((animation) => animation.stop());
      rotationAnimation.stop();
    };
  }, [squadId]);

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

  const ringStyle = (val: Animated.Value) => ({
    transform: [{ scale: val.interpolate({ inputRange: [0, 1], outputRange: [1, 2.4] }) }],
    opacity: val.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.6, 0.3, 0] }),
  });

  async function cancel() {
    setCancelError('');
    if (squadId) {
      try {
        await api.cancelSearch(squadId);
      } catch (e: any) {
        setCancelError(e?.message || "Couldn't cancel search yet.");
        return;
      }
    }
    router.push(squadId ? `/lobby?squad=${squadId}` : '/lobby');
  }

  return (
    <Screen>
      <View style={styles.container}>
        <View style={styles.radarWrap}>
          {[ring1, ring2, ring3].map((r, i) => (
            <Animated.View key={i} style={[styles.ring, ringStyle(r)]} />
          ))}
          <Animated.View style={[styles.dashedRing, {
            transform: [{ rotate: rotation.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) }],
          }]} />
          <View style={styles.core}>
            <Avatar name={session.user?.displayName || 'You'} size={84} />
          </View>
        </View>

        <Text style={styles.heading}>Scanning for squads…</Text>
        <Text style={styles.sub}>Matching your squad's vibes</Text>

        <Button label="Cancel search" onPress={cancel} variant="outline" style={styles.cancel} />
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
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: SPACE.xl },
  radarWrap: { width: 200, height: 200, alignItems: 'center', justifyContent: 'center', marginBottom: SPACE.xxl },
  ring: {
    position: 'absolute',
    width: 120, height: 120, borderRadius: 60,
    borderWidth: 1.5, borderColor: COLORS.violet,
  },
  dashedRing: {
    position: 'absolute', width: 180, height: 180, borderRadius: 90,
    borderWidth: 2, borderColor: 'rgba(124,92,255,0.5)',
    borderStyle: 'dashed',
  },
  core: {
    width: 88, height: 88, borderRadius: 44,
    backgroundColor: COLORS.surface,
    borderWidth: 2, borderColor: 'rgba(124,92,255,0.6)',
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  heading: { fontSize: 28, fontWeight: '900', color: COLORS.text, marginBottom: SPACE.sm, textAlign: 'center' },
  sub: { fontSize: 15, color: COLORS.textMuted, marginBottom: SPACE.xl, textAlign: 'center' },
  fullWidth: { width: '100%' },
  cancel: { width: '100%', marginTop: SPACE.sm },
  statusError: {
    width: '100%',
    marginTop: SPACE.md,
    padding: SPACE.sm,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,92,92,0.26)',
    backgroundColor: 'rgba(255,92,92,0.09)',
  },
  statusErrorTitle: { color: COLORS.coral, fontSize: 12, fontWeight: '900', textAlign: 'center' },
  statusErrorText: { color: COLORS.textMuted, fontSize: 12, lineHeight: 17, marginTop: 2, textAlign: 'center' },
  errorText: {
    color: COLORS.coral,
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
    marginTop: SPACE.md,
  },
});

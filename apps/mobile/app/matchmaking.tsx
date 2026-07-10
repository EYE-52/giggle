import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Animated, StyleSheet, Image, Platform } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Screen } from '../components/Screen';
import { Button } from '../components/Button';
import { COLORS, SPACE } from '../constants/theme';
import { api, connectSocket, SOCKET_EVENTS } from '@giggle/core';

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
    createRingAnim(ring1, 0).start();
    createRingAnim(ring2, 600).start();
    createRingAnim(ring3, 1200).start();
    Animated.loop(Animated.timing(rotation, { toValue: 1, duration: 6000, useNativeDriver: USE_NATIVE_DRIVER })).start();

    if (!squadId) return;

    const poll = setInterval(async () => {
      try {
        const status = await api.matchStatus(squadId);
        setStatusError('');
        if (status.match?.encounterId) goToMatch(status.match.encounterId);
      } catch (e: any) {
        setStatusError(e?.message || "Couldn't refresh matchmaking status.");
      }
    }, 2000);

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

    return () => { clearInterval(poll); cleanup?.(); };
  }, [squadId]);

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
            <Image source={require('../assets/img/avatar-alex.jpg')} style={styles.coreImage} />
          </View>
        </View>

        <Text style={styles.heading}>Scanning for squads…</Text>
        <Text style={styles.sub}>Matching your vibe across the city</Text>

        <View style={styles.pills}>
          {['Queue open', 'Live signal', 'Squad synced'].map((p) => (
            <View key={p} style={styles.pill}>
              {p === 'Queue open' && <View style={styles.violetDot} />}
              <Text style={styles.pillText}>{p}</Text>
            </View>
          ))}
        </View>

        <View style={styles.fastPassWrap}>
          <LinearGradient
            colors={['#7C5CFF', '#5C3FFF']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.fastPassBtn}
          >
            <Text style={styles.fastPassText}>Queue signal live</Text>
          </LinearGradient>
        </View>

        <Button label="Cancel" onPress={cancel} variant="outline" style={styles.cancel} />
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
  coreImage: { width: 88, height: 88, borderRadius: 44 },
  heading: { fontSize: 28, fontWeight: '900', color: COLORS.text, marginBottom: SPACE.sm, textAlign: 'center' },
  sub: { fontSize: 15, color: COLORS.textMuted, marginBottom: SPACE.xl, textAlign: 'center' },
  pills: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8, marginBottom: SPACE.xxl },
  pill: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 6, paddingHorizontal: 14, borderRadius: 999,
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border,
  },
  violetDot: {
    width: 6, height: 6, borderRadius: 3,
    backgroundColor: COLORS.violet, marginRight: 6,
  },
  pillText: { fontSize: 13, color: COLORS.textMuted, fontWeight: '600' },
  fastPassWrap: { width: '100%', borderRadius: 14, overflow: 'hidden', marginBottom: SPACE.md },
  fastPassBtn: { paddingVertical: 14, alignItems: 'center', borderRadius: 14 },
  fastPassText: { color: '#fff', fontWeight: '800', fontSize: 15, letterSpacing: 0.3 },
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

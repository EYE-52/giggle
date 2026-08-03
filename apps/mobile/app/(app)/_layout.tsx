import { Stack, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { session } from '@giggle/core';
import { AgeGate } from '../../components/AgeGate';
import { COLORS } from '../../constants/theme';

export default function ProtectedLayout() {
  const router = useRouter();
  const [authReady, setAuthReady] = useState(false);
  const [hasAdultAccess, setHasAdultAccess] = useState(false);

  useEffect(() => {
    let active = true;

    async function openProtectedRoute() {
      if (!session.isAuthed()) {
        if (process.env.NODE_ENV !== 'production') {
          try {
            await session.devSignIn();
          } catch {
            router.replace('/');
            return;
          }
        } else {
          router.replace('/');
          return;
        }
      }

      await session.syncAgeFromServer();
      if (!active) return;
      setHasAdultAccess(session.hasAdultAccess);
      setAuthReady(true);
    }

    void openProtectedRoute();
    return () => { active = false; };
  }, [router]);

  if (!authReady) {
    return (
      <View style={styles.loading} accessibilityRole="progressbar" accessibilityLabel="Opening Giggle">
        <ActivityIndicator color={COLORS.violet} size="large" />
      </View>
    );
  }
  if (!hasAdultAccess) {
    return <AgeGate onDone={() => setHasAdultAccess(true)} />;
  }

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: COLORS.bg },
        animation: 'fade',
      }}
    />
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.bg,
  },
});

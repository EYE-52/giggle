import { Stack } from 'expo-router';
import Head from 'expo-router/head';
import { usePathname, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { session } from '@giggle/core';
import { AgeGate } from '../components/AgeGate';
import { COLORS } from '../constants/theme';

const PUBLIC_ROUTES = new Set(['/', '/auth/callback']);

const ROUTE_TITLES: Record<string, string> = {
  '/': 'Giggle | Squad Discovery',
  '/auth/callback': 'Sign-in status | Giggle',
  '/home': 'Home | Giggle',
  '/discover': 'Discover | Giggle',
  '/profile': 'Profile | Giggle',
  '/premium': 'Premium | Giggle',
  '/matchmaking': 'Matchmaking | Giggle',
  '/match': 'Match | Giggle',
  '/lobby': 'Lobby | Giggle',
  '/encounter': 'Encounter | Giggle',
};

export default function RootLayout() {
  const pathname = usePathname();
  const router = useRouter();
  const title = ROUTE_TITLES[pathname] || 'Giggle';
  const isPublicRoute = PUBLIC_ROUTES.has(pathname);
  const [authReady, setAuthReady] = useState(false);
  const [hasAdultAccess, setHasAdultAccess] = useState(false);

  useEffect(() => {
    let active = true;
    if (isPublicRoute) {
      setAuthReady(false);
      setHasAdultAccess(false);
      return;
    }

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
  }, [isPublicRoute, router]);

  if (!isPublicRoute && !authReady) {
    return (
      <View style={styles.loading} accessibilityRole="progressbar" accessibilityLabel="Opening Giggle">
        <ActivityIndicator color={COLORS.violet} size="large" />
      </View>
    );
  }
  if (!isPublicRoute && !hasAdultAccess) {
    return <AgeGate onDone={() => setHasAdultAccess(true)} />;
  }

  return (
    <>
      {Platform.OS === 'web' && (
        <Head>
          <title>{title}</title>
        </Head>
      )}
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: COLORS.bg },
          animation: 'fade',
        }}
      >
        <Stack.Screen name="index" options={{ title: ROUTE_TITLES['/'] }} />
        <Stack.Screen name="auth/callback" options={{ title: ROUTE_TITLES['/auth/callback'] }} />
        <Stack.Screen name="home" options={{ title: ROUTE_TITLES['/home'] }} />
        <Stack.Screen name="discover" options={{ title: ROUTE_TITLES['/discover'] }} />
        <Stack.Screen name="profile" options={{ title: ROUTE_TITLES['/profile'] }} />
        <Stack.Screen name="premium" options={{ title: ROUTE_TITLES['/premium'] }} />
        <Stack.Screen name="matchmaking" options={{ title: ROUTE_TITLES['/matchmaking'] }} />
        <Stack.Screen name="match" options={{ title: ROUTE_TITLES['/match'] }} />
        <Stack.Screen name="lobby" options={{ title: ROUTE_TITLES['/lobby'] }} />
        <Stack.Screen name="encounter" options={{ title: ROUTE_TITLES['/encounter'] }} />
      </Stack>
    </>
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

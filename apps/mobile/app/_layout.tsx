import { Stack, usePathname } from 'expo-router';
import Head from 'expo-router/head';
import React from 'react';
import { Platform } from 'react-native';
import { COLORS } from '../constants/theme';

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
  const title = ROUTE_TITLES[pathname] || 'Giggle';

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
        <Stack.Screen name="(app)" options={{ headerShown: false }} />
      </Stack>
    </>
  );
}

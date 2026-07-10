import { Stack } from 'expo-router';
import Head from 'expo-router/head';
import { usePathname, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { session } from '@giggle/core';
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

  useEffect(() => {
    if (isPublicRoute || session.isAuthed()) return;

    if (process.env.NODE_ENV !== 'production') {
      session.devSignIn().catch(() => router.replace('/'));
      return;
    }

    router.replace('/');
  }, [isPublicRoute, router]);

  return (
    <>
      <Head>
        <title>{title}</title>
      </Head>
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

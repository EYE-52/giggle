import { Redirect, Stack, usePathname, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { session } from '@giggle/core';
import { AgeGate } from '../../components/AgeGate';
import { COLORS } from '../../constants/theme';
import { NATIVE_DISCOVERY_ENABLED } from '../../constants/discovery';
import { IdentityOnlyAccount } from '../../components/IdentityOnlyAccount';
import { Icon } from '../../components/Icon';

const DISCOVERY_ROUTES = ['/discover', '/matchmaking', '/match'];

export default function ProtectedLayout() {
  const router = useRouter();
  const pathname = usePathname();
  const [authReady, setAuthReady] = useState(false);
  const [hasAdultAccess, setHasAdultAccess] = useState(false);
  const insets = useSafeAreaInsets();
  const identityOnlyAccess = authReady && session.hasIdentityOnlyAccess;
  const identityRouteBlocked = identityOnlyAccess && session.accountStatus !== 'active' && pathname !== '/profile';
  const identityProfile = identityOnlyAccess && pathname === '/profile';

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
  if (identityRouteBlocked) {
    return <Redirect href="/profile" />;
  }
  if (identityProfile) {
    return (
      <IdentityOnlyAccount
        onReturnToVerification={session.accountStatus === 'active' ? () => router.replace('/home') : undefined}
      />
    );
  }
  if (!hasAdultAccess) {
    return (
      <AgeGate
        onDone={() => setHasAdultAccess(true)}
        onManageAccount={() => router.push('/profile')}
      />
    );
  }
  if (!NATIVE_DISCOVERY_ENABLED && DISCOVERY_ROUTES.includes(pathname)) {
    return <Redirect href="/home" />;
  }

  const showNav = ['/home', '/discover', '/profile', '/premium'].includes(pathname);
  return (
    <View style={styles.shell}>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: COLORS.bg }, animation: 'fade' }} />
      {showNav ? <View style={[styles.nav, { paddingBottom: Math.max(insets.bottom, 10) }]}>
        <NavItem label="Home" active={pathname === '/home'} onPress={() => router.replace('/home')} icon="home" />
        {NATIVE_DISCOVERY_ENABLED ? <NavItem label="Discover" active={pathname === '/discover'} onPress={() => router.replace('/discover')} icon="discover" /> : null}
        <NavItem label="Wallet" active={pathname === '/premium'} onPress={() => router.replace('/premium')} icon="wallet" />
        <NavItem label="Account" active={pathname === '/profile'} onPress={() => router.replace('/profile')} icon="profile" />
      </View> : null}
    </View>
  );
}

function NavItem({ label, active, onPress, icon }: { label: string; active: boolean; onPress: () => void; icon: 'home' | 'discover' | 'wallet' | 'profile' }) {
  return <TouchableOpacity onPress={onPress} style={styles.navItem} accessibilityRole="button" accessibilityState={{ selected: active }} accessibilityLabel={label}>
    {React.createElement(Icon[icon], { size: 20, color: active ? COLORS.violet : COLORS.textDim })}
    <Text style={[styles.navLabel, active && styles.activeLabel]}>{label}</Text>
  </TouchableOpacity>;
}

const styles = StyleSheet.create({
  shell: { flex: 1, backgroundColor: COLORS.bg },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.bg,
  },
  nav: { flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center', backgroundColor: COLORS.surface, borderTopWidth: 1, borderTopColor: COLORS.border, paddingTop: 9 },
  navItem: { minWidth: 64, minHeight: 48, alignItems: 'center', justifyContent: 'center', gap: 3 },
  navLabel: { color: COLORS.textDim, fontSize: 11, fontWeight: '700' },
  activeLabel: { color: COLORS.violet },
  activeIcon: { color: COLORS.violet },
  walletIcon: { color: COLORS.textDim, fontSize: 20, fontWeight: '800', lineHeight: 20 },
});

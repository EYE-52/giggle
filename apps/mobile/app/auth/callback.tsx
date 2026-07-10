import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { session } from '@giggle/core';
import { Logomark } from '../../components/Logomark';
import { COLORS, RADII, SPACE } from '../../constants/theme';

function friendly(code: string): string {
  if (code.startsWith('MAGIC')) return 'This magic link is invalid or has expired. Request a new one.';
  if (code.startsWith('GOOGLE')) return "Google sign-in didn't complete. Please try again.";
  if (code.startsWith('APPLE')) return "Apple sign-in didn't complete. Please try again.";
  return "We couldn't complete sign-in. Please try again.";
}

export default function AuthCallbackScreen() {
  const router = useRouter();
  const [error, setError] = useState('');

  useEffect(() => {
    if (typeof window === 'undefined') {
      setError('Open this sign-in link in a browser to finish.');
      return;
    }

    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const hashError = hash.get('error');
    if (hashError) {
      setError(friendly(hashError));
      return;
    }

    const token = hash.get('token');
    if (!token) {
      setError('This sign-in link is invalid or has expired.');
      return;
    }

    try {
      session.setTokenFromOAuth(token);
      window.history.replaceState(null, '', window.location.pathname);
      router.replace('/home');
    } catch {
      setError("We couldn't complete sign-in. Please try again.");
    }
  }, [router]);

  return (
    <View style={styles.root}>
      <View style={styles.panel}>
        <Logomark size={46} />
        {error ? (
          <>
            <Text style={styles.title}>Sign-in failed</Text>
            <Text style={styles.copy}>{error}</Text>
            <TouchableOpacity onPress={() => router.replace('/')} style={styles.button}>
              <Text style={styles.buttonText}>Back to sign in</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <Text style={styles.title}>Signing you in</Text>
            <Text style={styles.copy}>Finishing your Giggle session...</Text>
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#050508',
    alignItems: 'center',
    justifyContent: 'center',
    padding: SPACE.xl,
  },
  panel: {
    width: '100%',
    maxWidth: 360,
    alignItems: 'center',
    gap: SPACE.md,
    padding: SPACE.xl,
    borderRadius: RADII.xl,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  title: {
    color: COLORS.text,
    fontSize: 22,
    fontWeight: '900',
    textAlign: 'center',
  },
  copy: {
    color: COLORS.textMuted,
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
  },
  button: {
    minHeight: 46,
    paddingHorizontal: SPACE.lg,
    borderRadius: RADII.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.lime,
  },
  buttonText: {
    color: '#07100A',
    fontSize: 15,
    fontWeight: '900',
  },
});

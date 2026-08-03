import React, { useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ImageBackground,
  useWindowDimensions,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Linking,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { BACKEND_URL, session, randomPlayerName } from '@giggle/core';
import { Logomark } from '../components/Logomark';
import { COLORS, SPACE, RADII } from '../constants/theme';

type Mode = 'create' | 'signin';

export default function OnboardingScreen() {
  const router = useRouter();
  const { height, width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const isWide = width >= 760;
  const heroH = isWide ? Math.min(height - 72, 720) : Math.round(height * 0.56);
  const isProduction = process.env.NODE_ENV === 'production';
  const showDevSkip = process.env.NODE_ENV !== 'production';

  const [mode, setMode] = useState<Mode>('create');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [oauthNote, setOauthNote] = useState('');

  const emailRef = useRef<TextInput>(null);

  function validateEmail(e: string) {
    return e.includes('@') && e.includes('.');
  }

  async function handleSubmit() {
    setError('');
    setOauthNote('');
    const trimmedEmail = email.trim();
    if (!validateEmail(trimmedEmail)) {
      setError('Please enter a valid email address.');
      return;
    }
    setLoading(true);
    try {
      if (isProduction) {
        await session.startEmailSignIn(trimmedEmail);
        setOauthNote('Check your email for a secure sign-in link.');
        return;
      }
      const displayName = mode === 'create'
        ? (name.trim() || randomPlayerName())
        : randomPlayerName();
      await session.signIn({ email: trimmedEmail, name: displayName });
      router.replace('/home');
    } catch (e: any) {
      setError(e?.message ?? 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  function handleOAuthPress(provider: 'google' | 'apple') {
    setError('');
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.location.href = `${BACKEND_URL}/api/auth/${provider}`;
      return;
    }
    setOauthNote(`${provider === 'google' ? 'Google' : 'Apple'} sign-in opens on web right now. Use email here.`);
    emailRef.current?.focus();
  }

  async function handleDevSkip() {
    if (!showDevSkip) return;
    setError('');
    try {
      await session.devSignIn();
      router.replace('/home');
    } catch (e: any) {
      setError(e?.message ?? "Couldn't start the dev session.");
    }
  }

  async function openPublicLink(url: string) {
    setError('');
    try {
      await Linking.openURL(url);
    } catch {
      setError("Couldn't open that page. Visit gigglemeet.com in your browser.");
    }
  }

  return (
    <View style={styles.root}>
      <ImageBackground
        source={require('../assets/img/onboarding-hero.jpg')}
        style={[styles.hero, { height: heroH }]}
        resizeMode="cover"
      >
        <LinearGradient
          colors={isWide
            ? ['rgba(5,5,8,0.10)', 'rgba(5,5,8,0.32)', 'rgba(5,5,8,0.78)', '#050508']
            : ['rgba(11,11,15,0.15)', 'rgba(11,11,15,0.30)', 'rgba(11,11,15,0.82)', 'rgba(11,11,15,0.97)', '#0B0B0F']}
          locations={isWide ? [0, 0.35, 0.70, 1] : [0, 0.32, 0.60, 0.80, 1]}
          style={StyleSheet.absoluteFill}
        />
        <LinearGradient
          colors={['rgba(194,255,61,0.20)', 'rgba(124,92,255,0.16)', 'rgba(5,5,8,0)']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.brandWash}
        />
      </ImageBackground>

      {/* Keyboard-aware scroll so form is visible when keyboard opens */}
      <KeyboardAvoidingView
        style={styles.kavContainer}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        <ScrollView
          contentContainerStyle={[
            styles.scroll,
            isWide && styles.scrollWide,
            { paddingBottom: insets.bottom + 20 },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={[styles.shell, isWide && styles.shellWide]}>
            <View style={[styles.story, isWide && styles.storyWide]}>
              <View style={styles.logoPill}>
                <Logomark size={30} />
                <Text style={styles.brandName}>Giggle</Text>
              </View>
              <Text style={[styles.headline, isWide && styles.headlineWide]}>
                Meet in squads,{'\n'}not alone.
              </Text>
              <Text style={styles.subhead}>
                Bring your people, match with another crew, and let the night start before anyone says hello.
              </Text>
              <View style={styles.proofRow}>
                <View style={styles.proofItem}>
                  <Text style={styles.proofNumber}>4v4</Text>
                  <Text style={styles.proofLabel}>squad rooms</Text>
                </View>
                <View style={styles.proofDivider} />
                <View style={styles.proofItem}>
                  <Text style={styles.proofNumber}>Live</Text>
                  <Text style={styles.proofLabel}>encounters</Text>
                </View>
                <View style={styles.proofDivider} />
                <View style={styles.proofItem}>
                  <Text style={styles.proofNumber}>Safe</Text>
                  <Text style={styles.proofLabel}>crew-first</Text>
                </View>
              </View>
            </View>

            <View style={[styles.panelSurface, isWide && styles.panelWide]}>
              <View style={styles.cardHeader}>
                <Text style={styles.eyebrow}>{mode === 'create' ? 'Start your squad' : 'Welcome back'}</Text>
                <Text style={styles.cardTitle}>
                  {mode === 'create' ? 'Create an account' : 'Sign in'}
                </Text>
              </View>

              <View style={styles.authStage}>
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel="Continue with Google"
                  onPress={() => handleOAuthPress('google')}
                  activeOpacity={0.86}
                  style={styles.primaryOauthBtn}
                >
                  <Text style={styles.primaryOauthIcon}>G</Text>
                  <Text style={styles.primaryOauthText}>Continue with Google</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel="Continue with Apple"
                  onPress={() => handleOAuthPress('apple')}
                  activeOpacity={0.86}
                  style={styles.secondaryOauthBtn}
                >
                  <Text style={styles.secondaryOauthIcon}></Text>
                  <Text style={styles.secondaryOauthText}>Continue with Apple</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.dividerRow}>
                <View style={styles.dividerLine} />
                <Text style={styles.dividerLabel}>or use email</Text>
                <View style={styles.dividerLine} />
              </View>

              <TextInput
                ref={emailRef}
                style={styles.input}
                placeholder="Email address"
                placeholderTextColor={COLORS.textDim}
                value={email}
                onChangeText={(v) => { setEmail(v); setError(''); setOauthNote(''); }}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                returnKeyType={mode === 'create' ? 'next' : 'done'}
              />

              {mode === 'create' && (
                <TextInput
                  style={styles.input}
                  placeholder={`Display name (or we'll pick one)`}
                  placeholderTextColor={COLORS.textDim}
                  value={name}
                  onChangeText={setName}
                  autoCapitalize="words"
                  returnKeyType="done"
                />
              )}

              <View style={styles.feedbackArea}>
                {error ? (
                  <Text style={styles.errorText} accessibilityRole="alert" accessibilityLiveRegion="polite">{error}</Text>
                ) : oauthNote ? (
                  <Text style={styles.noteText}>{oauthNote}</Text>
                ) : null}
              </View>

              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel={mode === 'create' ? 'Create account' : 'Sign in'}
                style={[styles.submitBtn, loading && styles.submitBtnDisabled]}
                onPress={handleSubmit}
                disabled={loading}
                activeOpacity={0.84}
              >
                {loading
                  ? <ActivityIndicator color="#07100A" size="small" />
                  : <Text style={styles.submitBtnText}>
                      {mode === 'create' ? 'Create account' : 'Sign in'}
                    </Text>
                }
              </TouchableOpacity>

              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel={mode === 'create'
                  ? 'Already have an account? Sign in'
                  : 'No account yet? Create one'}
                onPress={() => { setMode(m => m === 'create' ? 'signin' : 'create'); setError(''); setOauthNote(''); }}
                style={styles.toggleBtn}
              >
                <Text style={styles.toggleText}>
                  {mode === 'create'
                    ? 'Already have an account? Sign in'
                    : "No account yet? Create one"}
                </Text>
              </TouchableOpacity>

              <Text style={styles.legal}>By continuing you agree to our</Text>
              <View style={styles.legalRow}>
                <TouchableOpacity
                  accessibilityRole="link"
                  accessibilityLabel="Open Terms"
                  onPress={() => void openPublicLink('https://gigglemeet.com/terms')}
                  style={styles.legalLink}
                >
                  <Text style={styles.legalLinkText}>Terms</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  accessibilityRole="link"
                  accessibilityLabel="Open Privacy Policy"
                  onPress={() => void openPublicLink('https://gigglemeet.com/privacy')}
                  style={styles.legalLink}
                >
                  <Text style={styles.legalLinkText}>Privacy Policy</Text>
                </TouchableOpacity>
              </View>

              {showDevSkip && (
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel="Skip with a dev account"
                  onPress={handleDevSkip}
                  style={styles.devSkip}
                >
                  <Text style={styles.devSkipText}>Skip with a dev account</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#050508' },
  hero: { position: 'absolute', top: 0, left: 0, right: 0, width: '100%' },
  brandWash: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: '58%',
    opacity: 0.9,
  },
  kavContainer: { flex: 1 },
  scroll: {
    flexGrow: 1,
    justifyContent: 'flex-end',
    paddingHorizontal: 20,
    paddingTop: 18,
  },
  scrollWide: {
    justifyContent: 'center',
    paddingHorizontal: 44,
    paddingTop: 44,
  },

  shell: {
    width: '100%',
    alignSelf: 'center',
    maxWidth: 1120,
  },
  shellWide: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 38,
  },

  story: {
    alignItems: 'center',
    marginBottom: SPACE.lg,
  },
  storyWide: {
    flex: 1,
    alignItems: 'flex-start',
    marginBottom: 0,
    paddingRight: 12,
  },

  logoPill: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: RADII.pill,
    backgroundColor: 'rgba(5,5,8,0.58)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    marginBottom: SPACE.md,
  },
  brandName: {
    color: COLORS.text,
    fontSize: 15,
    fontWeight: '800',
  },

  headline: {
    fontSize: 34,
    fontWeight: '900',
    color: COLORS.text,
    letterSpacing: 0,
    textAlign: 'center',
    lineHeight: 38,
    marginBottom: 10,
    textShadow: '0 3px 18px rgba(0,0,0,0.82)',
  },
  headlineWide: {
    fontSize: 58,
    lineHeight: 62,
    textAlign: 'left',
    maxWidth: 560,
  },
  subhead: {
    maxWidth: 520,
    color: 'rgba(244,244,247,0.78)',
    fontSize: 16,
    lineHeight: 22,
    textAlign: 'center',
    marginBottom: SPACE.lg,
  },
  proofRow: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'stretch',
    justifyContent: 'center',
    borderRadius: RADII.tile,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    backgroundColor: 'rgba(5,5,8,0.46)',
    overflow: 'hidden',
  },
  proofItem: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 8,
  },
  proofNumber: {
    color: COLORS.lime,
    fontSize: 17,
    fontWeight: '900',
  },
  proofLabel: {
    color: COLORS.textMuted,
    fontSize: 11,
    marginTop: 3,
  },
  proofDivider: {
    width: 1,
    height: 30,
    backgroundColor: 'rgba(255,255,255,0.13)',
  },

  panelSurface: {
    backgroundColor: 'rgba(13,16,18,0.78)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    borderRadius: 22,
    padding: 14,
    boxShadow: '0 22px 60px rgba(0,0,0,0.52)',
  },
  panelWide: {
    width: 410,
    padding: 18,
  },
  cardHeader: {
    marginBottom: SPACE.sm,
  },
  eyebrow: {
    color: COLORS.lime,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  cardTitle: {
    fontSize: 25,
    lineHeight: 30,
    fontWeight: '900',
    color: COLORS.text,
  },
  authStage: {
    gap: 10,
    marginBottom: 8,
  },
  primaryOauthBtn: {
    minHeight: 54,
    width: '100%',
    borderRadius: RADII.pill,
    backgroundColor: '#F7F7FB',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 10,
    boxShadow: '0 14px 30px rgba(124,92,255,0.24)',
  },
  primaryOauthIcon: {
    width: 24,
    height: 24,
    borderRadius: 12,
    color: '#FFFFFF',
    backgroundColor: '#4285F4',
    textAlign: 'center',
    lineHeight: 24,
    fontSize: 14,
    fontWeight: '900',
  },
  primaryOauthText: {
    color: '#080A0B',
    fontSize: 15,
    fontWeight: '900',
  },
  secondaryOauthBtn: {
    minHeight: 52,
    width: '100%',
    borderRadius: RADII.pill,
    backgroundColor: 'rgba(255,255,255,0.055)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 10,
  },
  secondaryOauthIcon: {
    color: COLORS.text,
    fontSize: 19,
    fontWeight: '900',
    lineHeight: 22,
  },
  secondaryOauthText: {
    color: COLORS.text,
    fontSize: 15,
    fontWeight: '900',
  },

  input: {
    minHeight: 50,
    borderRadius: 15,
    backgroundColor: 'rgba(255,255,255,0.065)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    color: COLORS.text,
    paddingHorizontal: 16,
    fontSize: 16,
    marginBottom: 9,
  },

  feedbackArea: {
    minHeight: 20,
    justifyContent: 'center',
    marginBottom: SPACE.sm,
  },
  errorText: { fontSize: 13, color: COLORS.coral, textAlign: 'center' },
  noteText: { fontSize: 13, color: COLORS.textMuted, textAlign: 'center' },

  submitBtn: {
    minHeight: 52,
    width: '100%',
    borderRadius: 16,
    backgroundColor: COLORS.lime,
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 12px 30px rgba(194,255,61,0.24)',
  },
  submitBtnDisabled: { opacity: 0.6 },
  submitBtnText: { color: '#07100A', fontWeight: '900', fontSize: 16 },

  toggleBtn: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 6,
  },

  toggleText: {
    fontSize: 14,
    color: 'rgba(244,244,247,0.80)',
    textAlign: 'center',
    textDecorationLine: 'underline',
  },

  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 10,
  },
  dividerLine: { flex: 1, height: 1, backgroundColor: 'rgba(255,255,255,0.12)' },
  dividerLabel: { color: COLORS.textDim, fontSize: 12, marginHorizontal: 12 },

  legal: {
    fontSize: 12,
    color: COLORS.textDim,
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 0,
  },
  legalRow: { flexDirection: 'row', justifyContent: 'center', gap: SPACE.sm, marginBottom: 6 },
  legalLink: { minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  legalLinkText: { fontSize: 12, color: COLORS.textMuted, textDecorationLine: 'underline' },

  devSkip: { alignItems: 'center', minHeight: 44, justifyContent: 'center' },
  devSkipText: { fontSize: 12, color: COLORS.textDim, opacity: 0.6, textDecorationLine: 'underline' },
});

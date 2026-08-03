import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  type AppStateStatus,
  KeyboardAvoidingView,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api, session } from '@giggle/core';
import { Button } from './Button';
import { Logomark } from './Logomark';
import { COLORS, RADII, SPACE } from '../constants/theme';

const MAX_STATUS_POLLS = 4;
const STATUS_POLL_MS = 2_000;
const SUPPORT_URL = 'mailto:support@gigglemeet.com?subject=Age%20verification%20help';

type GateState = 'dob' | 'checking' | 'ready' | 'pending' | 'rejected' | 'unavailable' | 'restricted';

function digits(value: string, maxLength: number) {
  return value.replace(/\D/g, '').slice(0, maxLength);
}

function makeValidDate(year: number, month: number, day: number): Date | null {
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
    ? date
    : null;
}

function ageFromDate(birth: Date, now: Date): number {
  let age = now.getFullYear() - birth.getFullYear();
  const month = now.getMonth() - birth.getMonth();
  if (month < 0 || (month === 0 && now.getDate() < birth.getDate())) age -= 1;
  return age;
}

function DobField({
  label,
  placeholder,
  value,
  maxLength,
  onChange,
  wide = false,
  editable,
}: {
  label: string;
  placeholder: string;
  value: string;
  maxLength: number;
  onChange: (value: string) => void;
  wide?: boolean;
  editable: boolean;
}) {
  return (
    <View style={[styles.field, wide && styles.yearField]}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={(next) => onChange(digits(next, maxLength))}
        placeholder={placeholder}
        placeholderTextColor={COLORS.textDim}
        keyboardType="number-pad"
        maxLength={maxLength}
        editable={editable}
        accessibilityLabel={`Birth ${label.toLowerCase()}`}
        style={styles.input}
        selectionColor={COLORS.violet}
      />
    </View>
  );
}

function AgeHelp({ onPress }: { onPress: () => void }) {
  return (
    <TouchableOpacity
      accessibilityRole="link"
      accessibilityLabel="Get age verification help"
      onPress={onPress}
      style={styles.helpLink}
    >
      <Text style={styles.helpText}>Get age verification help</Text>
    </TouchableOpacity>
  );
}

export function AgeGate({ onDone }: { onDone: () => void }) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const now = useMemo(() => new Date(), []);
  const [month, setMonth] = useState('');
  const [day, setDay] = useState('');
  const [year, setYear] = useState('');
  const [state, setState] = useState<GateState>(() => {
    if (!session.ageConfirmed) return 'dob';
    return session.isAdult ? 'checking' : 'restricted';
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  const operationGeneration = useRef(0);
  const reconcileInFlight = useRef<Promise<void> | null>(null);
  const completed = useRef(false);

  const finishVerified = useCallback(async (operation: number) => {
    const synced = await session.syncAgeFromServer();
    if (!mounted.current || operation !== operationGeneration.current) return false;
    if (synced && session.hasAdultAccess && !completed.current) {
      completed.current = true;
      onDone();
      return true;
    }
    setState('unavailable');
    setError("We couldn't confirm the completed check. Please try again.");
    setBusy(false);
    return false;
  }, [onDone]);

  const reconcile = useCallback(() => {
    if (!mounted.current || !session.ageConfirmed || !session.isAdult || completed.current) {
      return Promise.resolve();
    }
    if (reconcileInFlight.current) return reconcileInFlight.current;

    const operation = ++operationGeneration.current;
    const request = (async () => {
      setBusy(true);
      setError(null);

      for (let attempt = 0; attempt < MAX_STATUS_POLLS; attempt += 1) {
        try {
          const result = await api.getAgeVerificationStatus();
          if (!mounted.current || operation !== operationGeneration.current) return;
          if (result.status === 'verified') {
            await finishVerified(operation);
            return;
          }
          if (result.status === 'restricted') {
            setState('restricted');
            setBusy(false);
            return;
          }
          if (result.status === 'rejected') {
            setState('rejected');
            setBusy(false);
            return;
          }
          if (result.status === 'not_started') {
            setState('ready');
            setBusy(false);
            return;
          }

          setState('pending');
          setBusy(false);
          if (attempt + 1 < MAX_STATUS_POLLS) {
            await new Promise((resolve) => setTimeout(resolve, STATUS_POLL_MS));
            if (!mounted.current || operation !== operationGeneration.current) return;
          }
        } catch (cause) {
          if (!mounted.current || operation !== operationGeneration.current) return;
          setState('unavailable');
          setError((cause as { message?: string })?.message || 'Age verification is temporarily unavailable.');
          setBusy(false);
          return;
        }
      }

      if (mounted.current && operation === operationGeneration.current) setBusy(false);
    })();

    reconcileInFlight.current = request;
    void request.finally(() => {
      if (reconcileInFlight.current === request) reconcileInFlight.current = null;
    });
    return request;
  }, [finishVerified]);

  useEffect(() => {
    mounted.current = true;
    if (session.ageConfirmed && session.isAdult) void reconcile();
    const onAppStateChange = (nextState: AppStateStatus) => {
      if (nextState === 'active') void reconcile();
    };
    const subscription = AppState.addEventListener('change', onAppStateChange);
    return () => {
      mounted.current = false;
      operationGeneration.current += 1;
      reconcileInFlight.current = null;
      subscription.remove();
    };
  }, [reconcile]);

  async function submit() {
    setError(null);
    if (!month || !day || year.length !== 4) {
      setError('Enter your full date of birth.');
      return;
    }

    const birth = makeValidDate(Number(year), Number(month), Number(day));
    if (!birth) {
      setError("That date doesn't look right. Check the month, day, and year.");
      return;
    }
    const age = ageFromDate(birth, now);
    if (birth.getTime() > now.getTime() || age > 120) {
      setError("That date doesn't look right. Check your birth year.");
      return;
    }
    if (age < 13) {
      setState('restricted');
      return;
    }

    const birthDate = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    const operation = ++operationGeneration.current;
    reconcileInFlight.current = null;
    setBusy(true);
    try {
      await session.setAge(birthDate);
      if (!mounted.current || operation !== operationGeneration.current) return;
      setState('checking');
      await reconcile();
    } catch (cause) {
      if (!mounted.current || operation !== operationGeneration.current) return;
      const code = (cause as { code?: string }).code;
      if (code === 'AGE_RESTRICTED') {
        await session.syncAgeFromServer();
        if (!mounted.current || operation !== operationGeneration.current) return;
        setState('restricted');
      } else {
        setError(
          code === 'INVALID_REQUEST' || code === 'INVALID_AGE'
            ? "That date doesn't look right. Check the month, day, and year."
            : (cause as { message?: string }).message || "Couldn't save that right now. Try again.",
        );
      }
      setBusy(false);
    }
  }

  async function startVerification() {
    const operation = ++operationGeneration.current;
    reconcileInFlight.current = null;
    setBusy(true);
    setError(null);
    try {
      const result = await api.startAgeVerification();
      if (!mounted.current || operation !== operationGeneration.current || !session.isAuthed()) return;
      if (result.status === 'verified') {
        await finishVerified(operation);
        return;
      }
      if (result.status === 'restricted') {
        setState('restricted');
      } else if (result.status === 'rejected') {
        setState('rejected');
      } else if (result.url) {
        let providerUrl: URL;
        try {
          providerUrl = new URL(result.url);
        } catch {
          setState('unavailable');
          setError('Age verification returned an invalid provider link.');
          setBusy(false);
          return;
        }
        if (
          providerUrl.protocol !== 'https:' ||
          providerUrl.hostname !== 'age.yoti.com' ||
          providerUrl.port !== '' ||
          providerUrl.username !== '' ||
          providerUrl.password !== ''
        ) {
          setState('unavailable');
          setError('Age verification returned an invalid provider link.');
          setBusy(false);
          return;
        }
        setState('pending');
        await Linking.openURL(providerUrl.toString());
        if (!mounted.current || operation !== operationGeneration.current) return;
      } else if (result.status === 'pending') {
        setState('unavailable');
        setError('Age verification returned an invalid provider link.');
      } else {
        setState('ready');
      }
    } catch (cause) {
      if (!mounted.current || operation !== operationGeneration.current) return;
      setState('unavailable');
      setError((cause as { message?: string })?.message || 'Age verification is temporarily unavailable.');
    }
    setBusy(false);
  }

  function signOut() {
    mounted.current = false;
    operationGeneration.current += 1;
    reconcileInFlight.current = null;
    session.signOut();
    router.replace('/');
  }

  async function openSupport() {
    try {
      await Linking.openURL(SUPPORT_URL);
    } catch {
      if (mounted.current) setError("Couldn't open your email app. Email support@gigglemeet.com.");
    }
  }

  if (state === 'restricted') {
    return (
      <Shell insets={insets}>
        <Logomark size={44} />
        <Text style={styles.title}>Giggle is for verified adults 18+</Text>
        <Text style={styles.body}>This account can't access squads, matching, chat, or video calls.</Text>
        {!!error && <Text style={styles.error} accessibilityRole="alert">{error}</Text>}
        <AgeHelp onPress={() => void openSupport()} />
        <Button label="Sign out" variant="outline" onPress={signOut} style={styles.fullButton} />
      </Shell>
    );
  }

  if (state !== 'dob') {
    const content = {
      checking: ['Checking your verification', 'Confirming your status with Giggle.'],
      ready: ["Verify you're 18 or older", 'Complete a quick hosted Yoti check to continue.'],
      pending: ['Verification pending', 'Finish the hosted check, then return here. Giggle will update automatically.'],
      rejected: ["We couldn't verify your age", 'Try the hosted check again or contact support for help.'],
      unavailable: ['Verification unavailable', 'Your access stays protected while the age service is unavailable.'],
    }[state];

    return (
      <Shell insets={insets}>
        <Logomark size={44} />
        <Text style={styles.title}>{content[0]}</Text>
        <Text
          style={[styles.body, state === 'unavailable' && error ? styles.error : null]}
          accessibilityRole={state === 'unavailable' ? 'alert' : undefined}
          accessibilityLiveRegion="polite"
        >
          {error || content[1]}
        </Text>
        {state === 'ready' && (
          <Button label="Verify with Yoti" onPress={() => void startVerification()} disabled={busy} style={styles.fullButton} />
        )}
        {state === 'pending' && (
          <View style={styles.actions}>
            <Button label="Continue with Yoti" onPress={() => void startVerification()} disabled={busy} style={styles.fullButton} />
            <Button label="Check again" variant="outline" onPress={() => void reconcile()} disabled={busy} style={styles.fullButton} />
          </View>
        )}
        {state === 'rejected' && (
          <Button label="Try verification again" onPress={() => void startVerification()} disabled={busy} style={styles.fullButton} />
        )}
        {state === 'unavailable' && (
          <Button label="Try again" variant="outline" onPress={() => void reconcile()} disabled={busy} style={styles.fullButton} />
        )}
        {state === 'checking' && (
          <ActivityIndicator color={COLORS.violet} size="large" accessibilityRole="progressbar" accessibilityLabel="Checking verification" />
        )}
        <AgeHelp onPress={() => void openSupport()} />
        <Button label="Sign out" variant="outline" onPress={signOut} style={styles.fullButton} />
      </Shell>
    );
  }

  return (
    <Shell insets={insets}>
      <Logomark size={44} />
      <Text style={styles.title}>Confirm your age</Text>
      <Text style={styles.body}>Giggle is for verified adults 18+. Enter your date of birth to continue.</Text>
      <View style={styles.form}>
        <Text style={styles.legend}>Date of birth</Text>
        <View style={styles.fields}>
          <DobField label="Month" placeholder="MM" value={month} maxLength={2} onChange={setMonth} editable={!busy} />
          <DobField label="Day" placeholder="DD" value={day} maxLength={2} onChange={setDay} editable={!busy} />
          <DobField label="Year" placeholder="YYYY" value={year} maxLength={4} onChange={setYear} wide editable={!busy} />
        </View>
        {!!error && (
          <Text style={styles.error} accessibilityRole="alert" accessibilityLiveRegion="polite">{error}</Text>
        )}
        <Button
          label={busy ? 'Saving…' : 'Continue'}
          onPress={() => void submit()}
          disabled={busy}
          accessibilityLabel="Confirm date of birth"
          style={styles.fullButton}
        />
      </View>
      <Text style={styles.privacy}>Your date of birth is private and is never shown on your profile.</Text>
      <Button label="Sign out" variant="outline" onPress={signOut} style={styles.fullButton} />
    </Shell>
  );
}

function Shell({ children, insets }: { children: React.ReactNode; insets: { top: number; bottom: number } }) {
  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: insets.top + SPACE.xl, paddingBottom: insets.bottom + SPACE.xl },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View
          style={styles.card}
          accessibilityViewIsModal
          accessibilityLabel="Confirm your age"
          accessibilityLiveRegion="polite"
        >
          {children}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  scroll: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: SPACE.lg,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    alignSelf: 'center',
    alignItems: 'center',
    gap: SPACE.md,
    padding: SPACE.xl,
    borderRadius: RADII.card,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
  },
  title: {
    color: COLORS.text,
    fontSize: 26,
    lineHeight: 30,
    fontWeight: '900',
    textAlign: 'center',
  },
  body: {
    color: COLORS.textMuted,
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
  },
  form: {
    width: '100%',
    gap: SPACE.md,
    marginTop: SPACE.sm,
  },
  actions: {
    width: '100%',
    gap: SPACE.sm,
  },
  fullButton: {
    width: '100%',
  },
  helpLink: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: SPACE.sm,
  },
  helpText: {
    color: COLORS.violet,
    fontSize: 13,
    fontWeight: '700',
  },
  legend: {
    color: COLORS.textMuted,
    fontSize: 13,
    fontWeight: '700',
  },
  fields: {
    flexDirection: 'row',
    gap: SPACE.sm,
  },
  field: {
    flex: 1,
    gap: SPACE.xs,
  },
  yearField: {
    flex: 1.3,
  },
  fieldLabel: {
    color: COLORS.textDim,
    fontSize: 12,
    fontWeight: '600',
  },
  input: {
    minHeight: 50,
    paddingHorizontal: SPACE.md,
    borderRadius: RADII.input,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.bgDeep,
    color: COLORS.text,
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
  },
  error: {
    color: COLORS.coral,
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
  },
  privacy: {
    color: COLORS.textDim,
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
  },
});

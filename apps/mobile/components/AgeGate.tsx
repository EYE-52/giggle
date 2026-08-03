import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { session } from '@giggle/core';
import { Button } from './Button';
import { Logomark } from './Logomark';
import { COLORS, RADII, SPACE } from '../constants/theme';

function digits(value: string, maxLength: number) {
  return value.replace(/\D/g, '').slice(0, maxLength);
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

export function AgeGate({ onDone }: { onDone: () => void }) {
  const insets = useSafeAreaInsets();
  const [month, setMonth] = useState('');
  const [day, setDay] = useState('');
  const [year, setYear] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    setError('');
    if (!month || !day || year.length !== 4) {
      setError('Enter your full date of birth.');
      return;
    }

    const birthDate = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    setSubmitting(true);
    try {
      await session.setAge(birthDate);
      onDone();
    } catch (cause) {
      const code = (cause as { code?: string }).code;
      setError(
        code === 'INVALID_AGE'
          ? 'You must be at least 13 to use Giggle.'
          : code === 'INVALID_REQUEST'
            ? "That date doesn't look right. Check the month, day, and year."
            : (cause as { message?: string }).message || "Couldn't save that right now. Try again.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
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
        >
          <Logomark size={44} />
          <Text style={styles.title}>Confirm your age</Text>
          <Text style={styles.body}>
            Giggle uses this to keep adult content away from minors. You must be at least 13 to use Giggle.
          </Text>

          <View style={styles.form}>
            <Text style={styles.legend}>Date of birth</Text>
            <View style={styles.fields}>
              <DobField label="Month" placeholder="MM" value={month} maxLength={2} onChange={setMonth} editable={!submitting} />
              <DobField label="Day" placeholder="DD" value={day} maxLength={2} onChange={setDay} editable={!submitting} />
              <DobField label="Year" placeholder="YYYY" value={year} maxLength={4} onChange={setYear} wide editable={!submitting} />
            </View>
            {!!error && (
              <Text style={styles.error} accessibilityRole="alert" accessibilityLiveRegion="polite">
                {error}
              </Text>
            )}
            <Button
              label={submitting ? 'Saving…' : 'Continue'}
              onPress={() => void submit()}
              disabled={submitting}
              accessibilityLabel="Confirm date of birth"
            />
          </View>

          <Text style={styles.privacy}>Your date of birth is private and is never shown on your profile.</Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 20,
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
  },
  privacy: {
    color: COLORS.textDim,
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
  },
});

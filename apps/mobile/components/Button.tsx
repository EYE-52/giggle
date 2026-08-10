import React from 'react';
import { TouchableOpacity, Text, StyleSheet, ViewStyle } from 'react-native';
import { COLORS, RADII, SPACE } from '../constants/theme';

type Variant = 'violet' | 'lime' | 'coral' | 'outline';

interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: Variant;
  style?: ViewStyle;
  disabled?: boolean;
  accessibilityLabel?: string;
}

const BG: Record<Variant, string> = {
  violet: COLORS.violet,
  lime: COLORS.lime,
  coral: COLORS.coral,
  outline: 'transparent',
};

const FG: Record<Variant, string> = {
  violet: '#FFFFFF',
  lime: '#0B0B0F',
  coral: '#FFFFFF',
  outline: COLORS.text,
};

export function Button({ label, onPress, variant = 'violet', style, disabled, accessibilityLabel }: ButtonProps) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: Boolean(disabled) }}
      style={[
        styles.btn,
        { backgroundColor: BG[variant], borderColor: variant === 'outline' ? COLORS.border : 'transparent' },
        disabled && styles.disabled,
        style,
      ]}
      activeOpacity={0.8}
    >
      <Text style={[styles.label, { color: FG[variant] }]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  btn: {
    minHeight: 44,
    borderRadius: RADII.pill,
    paddingVertical: SPACE.md,
    paddingHorizontal: SPACE.xl,
    alignItems: 'center',
    borderWidth: 1,
  },
  label: {
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  disabled: {
    opacity: 0.4,
  },
});

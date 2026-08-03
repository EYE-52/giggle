import React from 'react';
import { TouchableOpacity, Text, StyleSheet } from 'react-native';
import { COLORS, RADII, SPACE } from '../constants/theme';

interface VibeChipProps {
  label: string;
  active?: boolean;
  onPress?: () => void;
}

export function VibeChip({ label, active = false, onPress }: VibeChipProps) {
  return (
    <TouchableOpacity
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      style={[styles.chip, active && styles.chipActive]}
      activeOpacity={0.7}
    >
      <Text style={[styles.label, active && styles.labelActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  chip: {
    minHeight: 44,
    justifyContent: 'center',
    borderRadius: RADII.pill,
    paddingVertical: SPACE.xs,
    paddingHorizontal: SPACE.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: 'transparent',
    marginRight: SPACE.sm,
    marginBottom: SPACE.sm,
  },
  chipActive: {
    backgroundColor: COLORS.violetSoft,
    borderColor: COLORS.violet,
  },
  label: {
    color: COLORS.textMuted,
    fontSize: 13,
    fontWeight: '600',
  },
  labelActive: {
    color: COLORS.violet,
  },
});

import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { COLORS } from '../constants/theme';

export function SwitchControl({
  value,
  onValueChange,
  label,
  disabled = false,
}: {
  value: boolean;
  onValueChange: (value: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <TouchableOpacity
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value, disabled }}
      activeOpacity={0.78}
      disabled={disabled}
      onPress={() => onValueChange(!value)}
      style={[styles.hitArea, disabled && styles.disabled]}
    >
      <View style={[styles.track, value && styles.trackOn]}>
        <View style={[styles.thumb, value && styles.thumbOn]} />
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  hitArea: {
    width: 54,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: {
    opacity: 0.45,
  },
  track: {
    width: 44,
    height: 26,
    borderRadius: 999,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 3,
  },
  trackOn: {
    backgroundColor: COLORS.violet,
    borderColor: COLORS.violet,
  },
  thumb: {
    width: 18,
    height: 18,
    borderRadius: 999,
    backgroundColor: COLORS.textDim,
  },
  thumbOn: {
    backgroundColor: '#fff',
    transform: [{ translateX: 18 }],
  },
});

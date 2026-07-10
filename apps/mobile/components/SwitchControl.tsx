import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { COLORS } from '../constants/theme';

export function SwitchControl({
  value,
  onValueChange,
  label,
}: {
  value: boolean;
  onValueChange: (value: boolean) => void;
  label: string;
}) {
  return (
    <TouchableOpacity
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value }}
      activeOpacity={0.78}
      onPress={() => onValueChange(!value)}
      style={styles.hitArea}
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

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Logomark } from './Logomark';
import { COLORS } from '../constants/theme';

// Shared smiling gg mark and lowercase wordmark.
export function Wordmark({ size = 22, mark = true }: { size?: number; mark?: boolean }) {
  return (
    <View style={styles.row}>
      {mark ? <Logomark size={size * 1.05} /> : null}
      <Text style={[styles.text, { fontSize: size }]}>giggle</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  text: { fontWeight: '800', letterSpacing: -0.8, color: COLORS.text },
});

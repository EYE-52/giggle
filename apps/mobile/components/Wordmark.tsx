import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Logomark } from './Logomark';

// Original lockup: squad-bubble logomark + "Giggle" text.
export function Wordmark({ size = 22, mark = true }: { size?: number; mark?: boolean }) {
  return (
    <View style={styles.row}>
      {mark ? <Logomark size={size * 1.05} /> : null}
      <Text style={[styles.text, { fontSize: size }]}>Giggle</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  text: { fontWeight: '700', letterSpacing: -0.44, color: '#F4F4F7' },
});

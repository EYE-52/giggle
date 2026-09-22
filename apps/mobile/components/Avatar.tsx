import React from 'react';
import { View, Text } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { COLORS } from '../constants/theme';

const AVATAR_COLORS = COLORS.avatar;

interface AvatarProps {
  name: string;
  size?: number;
  colorIndex?: number;
  ring?: boolean;
}

export function Avatar({ name, size = 40, colorIndex = 0, ring = false }: AvatarProps) {
  const base = AVATAR_COLORS[colorIndex % AVATAR_COLORS.length];
  const [from, to] = [base, base];
  const fg = '#fff';
  const initial = name ? name[0].toUpperCase() : '?';
  return (
    <LinearGradient
      colors={[from, to]}
      start={{ x: 0.1, y: 0 }}
      end={{ x: 0.9, y: 1 }}
      style={[
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        },
        ring && {
          borderWidth: 2,
          borderColor: COLORS.surface,
        },
      ]}
    >
      <Text style={{ fontSize: size * 0.42, fontWeight: '700', color: fg }}>{initial}</Text>
    </LinearGradient>
  );
}

export function AvatarStack({ names, size = 30, extra }: { names: string[]; size?: number; extra?: number }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      {names.map((n, i) => (
        <View key={i} style={{ marginLeft: i === 0 ? 0 : -size * 0.32 }}>
          <Avatar name={n} size={size} colorIndex={i} ring />
        </View>
      ))}
      {extra ? (
        <View
          style={{
            marginLeft: -size * 0.32,
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: '#16161E',
            borderWidth: 1,
            borderColor: 'rgba(255,255,255,0.14)',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ fontWeight: '700', fontSize: size * 0.34, color: '#C9C9DA' }}>+{extra}</Text>
        </View>
      ) : null}
    </View>
  );
}

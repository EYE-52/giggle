import React from 'react';
import { View, Text } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

const AVATAR_COLORS = ['#7C5CFF', '#3DD6C0', '#FF8A5C', '#C2FF3D', '#FF5C8A', '#5C8CFF', '#FFC65C', '#9B7CFF'];

const GRADIENTS: Record<string, [string, string]> = {
  '#7C5CFF': ['#9B7CFF', '#5436C9'],
  '#3DD6C0': ['#5BE8D4', '#1F9A8A'],
  '#FF8A5C': ['#FFA877', '#D85E34'],
  '#C2FF3D': ['#D4FF6E', '#8FCF12'],
  '#FF5C8A': ['#FF7BA3', '#C2306B'],
  '#5C8CFF': ['#7BA3FF', '#2F5BD4'],
  '#FFC65C': ['#FFD787', '#D49A23'],
  '#9B7CFF': ['#B49BFF', '#6344C2'],
};

const TEXT_COLORS: Record<string, string> = {
  '#7C5CFF': '#fff',
  '#3DD6C0': '#06241f',
  '#FF8A5C': '#fff',
  '#C2FF3D': '#162400',
  '#FF5C8A': '#fff',
  '#5C8CFF': '#fff',
  '#FFC65C': '#3a2a00',
  '#9B7CFF': '#fff',
};

interface AvatarProps {
  name: string;
  size?: number;
  colorIndex?: number;
  ring?: boolean;
}

export function Avatar({ name, size = 40, colorIndex = 0, ring = false }: AvatarProps) {
  const base = AVATAR_COLORS[colorIndex % AVATAR_COLORS.length];
  const [from, to] = GRADIENTS[base] ?? [base, base];
  const fg = TEXT_COLORS[base] ?? '#fff';
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
          borderColor: '#0B0B0F',
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

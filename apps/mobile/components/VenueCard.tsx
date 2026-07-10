import React from 'react';
import { View, Text, StyleSheet, ImageBackground, ImageSourcePropType } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { AvatarStack } from './Avatar';

const VENUE_IMAGES = {
  neon: require('../assets/img/venue-neon-nights.jpg') as ImageSourcePropType,
  arcade: require('../assets/img/venue-midnight-gamers.jpg') as ImageSourcePropType,
};

const WASH_COLORS: Record<string, [string, string, string]> = {
  neon: ['rgba(255,92,138,0.25)', 'rgba(124,92,255,0.35)', 'rgba(10,5,15,0.85)'],
  arcade: ['rgba(92,140,255,0.25)', 'rgba(61,214,192,0.25)', 'rgba(8,15,25,0.85)'],
};

export function VenueCard({
  title,
  subtitle,
  wash = 'neon',
  live,
  members,
  extra,
}: {
  title: string;
  subtitle: string;
  wash?: 'neon' | 'arcade';
  live?: boolean;
  members: string[];
  extra?: number;
}) {
  const colors = WASH_COLORS[wash] ?? WASH_COLORS.neon;
  const image = VENUE_IMAGES[wash] ?? VENUE_IMAGES.neon;
  return (
    <ImageBackground source={image} style={styles.card} imageStyle={styles.cardImage} resizeMode="cover">
      <LinearGradient
        colors={colors}
        start={{ x: 0.2, y: 0 }}
        end={{ x: 0.8, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      {live && (
        <View style={styles.liveBadge}>
          <View style={styles.liveDot} />
          <Text style={styles.liveText}>LIVE</Text>
        </View>
      )}
      <View style={styles.bottom}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.subtitle}>{subtitle}</Text>
        <AvatarStack names={members} size={28} extra={extra} />
      </View>
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  card: {
    height: 200,
    width: '100%',
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.09)',
    justifyContent: 'flex-end',
  },
  cardImage: {
    width: '100%',
    height: '100%',
    borderRadius: 20,
  },
  liveBadge: {
    position: 'absolute',
    top: 12,
    left: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 4,
    paddingHorizontal: 9,
    borderRadius: 999,
    backgroundColor: 'rgba(11,11,15,0.6)',
    borderWidth: 1,
    borderColor: 'rgba(194,255,61,0.5)',
  },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#C2FF3D' },
  liveText: { fontSize: 10, fontWeight: '700', letterSpacing: 1, color: '#C2FF3D' },
  bottom: { padding: 16 },
  title: { fontSize: 19, fontWeight: '700', color: '#F4F4F7', letterSpacing: -0.2 },
  subtitle: { fontSize: 12.5, color: '#C9C9DA', marginTop: 2, marginBottom: 12 },
});

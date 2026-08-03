import type { ImageSourcePropType } from 'react-native';

const PRESET_IMAGES: Record<string, ImageSourcePropType> = {
  'photo-neon-nights': require('../assets/img/venue-neon-nights.jpg'),
  'photo-midnight-gamers': require('../assets/img/venue-midnight-gamers.jpg'),
  'photo-match-your-squad': require('../assets/img/match-your-squad.jpg'),
  'photo-match-opponent': require('../assets/img/match-opponent-squad.jpg'),
  'photo-hero': require('../assets/img/onboarding-hero.jpg'),
  'photo-alex': require('../assets/img/avatar-alex.jpg'),
};

export function squadCoverSource(coverImage?: string | null): ImageSourcePropType | undefined {
  if (!coverImage) return undefined;
  if (coverImage.startsWith('data:') || coverImage.startsWith('https://') || coverImage.startsWith('http://')) {
    return { uri: coverImage };
  }
  return PRESET_IMAGES[coverImage];
}

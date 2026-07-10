import type { StyleProp, ViewStyle } from 'react-native';
import { View } from 'react-native';

export interface RtcSurfaceProps {
  style?: StyleProp<ViewStyle>;
  canvas?: { uid?: number | string };
}

export function RtcSurface({ style }: RtcSurfaceProps) {
  return <View style={style} />;
}

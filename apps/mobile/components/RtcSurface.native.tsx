import type { ComponentProps } from 'react';
import { RtcSurfaceView } from 'react-native-agora';

export type RtcSurfaceProps = ComponentProps<typeof RtcSurfaceView>;

export function RtcSurface(props: RtcSurfaceProps) {
  return <RtcSurfaceView {...props} />;
}

import type { ComponentProps } from 'react';
import { RenderModeType, RtcSurfaceView } from 'react-native-agora';

export type RtcSurfaceProps = ComponentProps<typeof RtcSurfaceView> & {
  fit?: 'fit' | 'crop';
};

export function RtcSurface({ canvas, fit = 'crop', ...props }: RtcSurfaceProps) {
  return (
    <RtcSurfaceView
      {...props}
      canvas={{
        ...(canvas ?? {}),
        renderMode: fit === 'fit' ? RenderModeType.RenderModeFit : RenderModeType.RenderModeHidden,
      }}
    />
  );
}

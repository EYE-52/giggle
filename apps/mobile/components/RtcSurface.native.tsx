import type { ComponentProps } from 'react';
import { RenderModeType, RtcTextureView } from 'react-native-agora';

export type RtcSurfaceProps = ComponentProps<typeof RtcTextureView> & {
  fit?: 'fit' | 'crop';
};

// Texture views keep viewer zoom clipped inside its tile on Android too.
export function RtcSurface({ canvas, fit = 'crop', ...props }: RtcSurfaceProps) {
  return (
    <RtcTextureView
      {...props}
      canvas={{
        ...(canvas ?? {}),
        renderMode: fit === 'fit' ? RenderModeType.RenderModeFit : RenderModeType.RenderModeHidden,
      }}
    />
  );
}

import React from 'react';
import Svg, { Circle, Defs, LinearGradient, Stop, G } from 'react-native-svg';

/**
 * Giggle logomark — three balanced "squad" circles flowing through one cohesive
 * violet→blue→lime diagonal gradient, crisp separator strokes, highlight dot.
 * Mirrors the desktop Brand.tsx Logomark.
 */
export function Logomark({ size = 32 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48">
      <Defs>
        <LinearGradient id="grad" x1="10" y1="10" x2="40" y2="40" gradientUnits="userSpaceOnUse">
          <Stop stopColor="#9B7CFF" />
          <Stop offset="0.55" stopColor="#6C8BFF" />
          <Stop offset="1" stopColor="#C2FF3D" />
        </LinearGradient>
      </Defs>
      {/* Three equal circles in balanced triangle (top-center, bottom-left, bottom-right) */}
      <G stroke="#0B0B0F" strokeWidth="2.4" fill="url(#grad)">
        <Circle cx="24" cy="15" r="9.5" />
        <Circle cx="15.5" cy="31" r="9.5" />
        <Circle cx="32.5" cy="31" r="9.5" />
      </G>
      {/* Subtle white highlight dot on top circle for dimension */}
      <Circle cx="21" cy="12" r="2.6" fill="#FFFFFF" fillOpacity="0.35" />
    </Svg>
  );
}

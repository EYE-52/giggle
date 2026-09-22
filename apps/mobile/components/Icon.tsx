import React from 'react';
import Svg, { Path, Circle, Rect } from 'react-native-svg';

type P = { size?: number; color?: string; strokeWidth?: number; fill?: string };

const base = (color = '#F4F4F7', sw = 2) => ({
  stroke: color,
  strokeWidth: sw,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
});

export const Icon = {
  wallet: ({ size = 22, color, strokeWidth }: P) => <Svg width={size} height={size} viewBox="0 0 24 24" fill="none"><Rect x={3} y={5} width={18} height={15} rx={3} {...base(color, strokeWidth)} /><Path d="M3 8V6a2 2 0 0 1 2-2h13M21 11h-5v4h5" {...base(color, strokeWidth)} /></Svg>,
  hangup: ({ size = 22, color, strokeWidth }: P) => <Svg width={size} height={size} viewBox="0 0 24 24" fill="none"><Path d="M3 10c5-5 13-5 18 0v5h-4v-4a15 15 0 0 0-10 0v4H3z" {...base(color, strokeWidth)} /></Svg>,
  home: ({ size = 22, color, strokeWidth }: P) => (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M3 11l9-8 9 8M5 9.5V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9.5" {...base(color, strokeWidth)} />
    </Svg>
  ),
  discover: ({ size = 22, color, strokeWidth }: P) => (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx="11" cy="11" r="7.5" {...base(color, strokeWidth)} />
      <Path d="m21 21-4.3-4.3" {...base(color, strokeWidth)} />
    </Svg>
  ),
  profile: ({ size = 22, color, strokeWidth }: P) => (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx="12" cy="8" r="4" {...base(color, strokeWidth)} />
      <Path d="M5 21c0-3.9 3.1-7 7-7s7 3.1 7 7" {...base(color, strokeWidth)} />
    </Svg>
  ),
  settings: ({ size = 22, color, strokeWidth }: P) => (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx="12" cy="12" r="3.2" {...base(color, strokeWidth)} />
      <Path d="M19.4 13.5a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-2.87 1.2V21a2 2 0 1 1-4 0v-.07a1.7 1.7 0 0 0-2.87-1.2l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 13.5H4.5a2 2 0 1 1 0-4h.07A1.7 1.7 0 0 0 5.77 6.6l-.06-.06A2 2 0 1 1 8.54 3.7l.06.06a1.7 1.7 0 0 0 1.87.34H10.5a1.7 1.7 0 0 0 1-1.55V2.5a2 2 0 1 1 4 0v.07a1.7 1.7 0 0 0 2.87 1.2l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87V8.5a1.7 1.7 0 0 0 1.55 1H21.5a2 2 0 1 1 0 4h-.07a1.7 1.7 0 0 0-1.55 1Z" {...base(color, strokeWidth)} />
    </Svg>
  ),
  star: ({ size = 22, color = '#C2FF3D', fill = '#C2FF3D' }: P) => (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="m12 2.5 2.9 5.9 6.5.95-4.7 4.58 1.1 6.47L12 17.9l-5.8 3.06 1.1-6.47-4.7-4.58 6.5-.95L12 2.5Z" fill={fill} stroke={color} strokeWidth={1.2} strokeLinejoin="round" />
    </Svg>
  ),
  lightning: ({ size = 22, color, fill = '#7C5CFF' }: P) => (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M13 2 4 13.5h6L9.5 22 20 10h-6.5L13 2Z" fill={fill} stroke={color ?? fill} strokeWidth={1.4} strokeLinejoin="round" />
    </Svg>
  ),
  mic: ({ size = 22, color = '#F4F4F7', strokeWidth }: P) => (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x="9" y="2" width="6" height="12" rx="3" {...base(color, strokeWidth)} />
      <Path d="M5 11a7 7 0 0 0 14 0M12 18v3" {...base(color, strokeWidth)} />
    </Svg>
  ),
  cam: ({ size = 22, color = '#F4F4F7', strokeWidth }: P) => (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x="2" y="6" width="14" height="12" rx="2.5" {...base(color, strokeWidth)} />
      <Path d="m16 10 6-3v10l-6-3" {...base(color, strokeWidth)} />
    </Svg>
  ),
  chat: ({ size = 22, color = '#F4F4F7', strokeWidth }: P) => (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M21 11.5a8 8 0 0 1-11.5 7.2L4 20l1.3-4.5A8 8 0 1 1 21 11.5Z" {...base(color, strokeWidth)} />
    </Svg>
  ),
  flag: ({ size = 22, color = '#FF5C5C', strokeWidth }: P) => (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M4 21V4M4 4h13l-2 4 2 4H4" {...base(color, strokeWidth)} />
    </Svg>
  ),
  plus: ({ size = 22, color = '#F4F4F7', strokeWidth }: P) => (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M12 5v14M5 12h14" {...base(color, strokeWidth ?? 2.4)} />
    </Svg>
  ),
  enter: ({ size = 22, color = '#F4F4F7', strokeWidth }: P) => (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M15 3h4a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1h-4M10 17l5-5-5-5M15 12H3" {...base(color, strokeWidth ?? 2)} />
    </Svg>
  ),
  close: ({ size = 22, color = '#F4F4F7', strokeWidth }: P) => (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M6 6l12 12M18 6 6 18" {...base(color, strokeWidth ?? 2.2)} />
    </Svg>
  ),
  chevron: ({ size = 22, color = '#9A9AB0', strokeWidth }: P) => (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="m9 6 6 6-6 6" {...base(color, strokeWidth ?? 2)} />
    </Svg>
  ),
  pin: ({ size = 22, color = '#C2FF3D' }: P) => (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M12 21s-6.5-5.3-6.5-10.2A6.5 6.5 0 0 1 18.5 10.8C18.5 15.7 12 21 12 21Z" stroke={color} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" />
      <Circle cx="12" cy="10.5" r="2.3" stroke={color} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  ),
  trend: ({ size = 22, color = '#C2FF3D' }: P) => (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M3 17l6-6 4 4 7-8M16 7h5v5" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  ),
  bell: ({ size = 22, color = '#F4F4F7' }: P) => (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6Z" stroke={color} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M10.5 19a1.8 1.8 0 0 0 3 0" stroke={color} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  ),
  shield: ({ size = 22, color = '#F4F4F7' }: P) => (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M12 2.5 4.5 5.5v5c0 4.5 3.1 7.9 7.5 9.5 4.4-1.6 7.5-5 7.5-9.5v-5L12 2.5Z" stroke={color} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="m9 12 2 2 4-4" stroke={color} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  ),
  account: ({ size = 22, color = '#F4F4F7' }: P) => (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx="12" cy="8" r="3.4" stroke={color} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M5.5 20a6.5 6.5 0 0 1 13 0" stroke={color} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  ),
  history: ({ size = 22, color = '#F4F4F7' }: P) => (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M12 8v4l3 3M3.05 11a9 9 0 1 0 .5-3M3 4v4h4" stroke={color} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  ),
  hd: ({ size = 22, color = '#F4F4F7' }: P) => (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x="2" y="4" width="20" height="16" rx="2.5" stroke={color} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M8 9v6M16 9v6M8 12h4M14 9h1.5a2.5 2.5 0 0 1 0 5H14" stroke={color} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  ),
  check: ({ size = 22, color = '#F4F4F7', strokeWidth }: P) => (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M5 13l4 4L19 7" {...base(color, strokeWidth ?? 2.4)} />
    </Svg>
  ),
  search: ({ size = 22, color = '#F4F4F7', strokeWidth }: P) => (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx="11" cy="11" r="7.5" {...base(color, strokeWidth)} />
      <Path d="m21 21-4.3-4.3" {...base(color, strokeWidth)} />
    </Svg>
  ),
};

export type IconName = keyof typeof Icon;

import * as React from "react";

type P = { size?: number; color?: string; strokeWidth?: number; fill?: string };

function Svg({ size = 22, children, viewBox = "0 0 24 24" }: { size?: number; children: React.ReactNode; viewBox?: string }) {
  return (
    <svg width={size} height={size} viewBox={viewBox} fill="none" aria-hidden style={{ display: "block" }}>
      {children}
    </svg>
  );
}

const base = (color = "#F4F4F7", sw = 2) => ({
  stroke: color,
  strokeWidth: sw,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
});

export const Icon = {
  home: ({ size, color, strokeWidth }: P) => (
    <Svg size={size}><path d="M3 11l9-8 9 8M5 9.5V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9.5" {...base(color, strokeWidth)} /></Svg>
  ),
  discover: ({ size, color, strokeWidth }: P) => (
    <Svg size={size}><circle cx="11" cy="11" r="7.5" {...base(color, strokeWidth)} /><path d="m21 21-4.3-4.3" {...base(color, strokeWidth)} /></Svg>
  ),
  profile: ({ size, color, strokeWidth }: P) => (
    <Svg size={size}><circle cx="12" cy="8" r="4" {...base(color, strokeWidth)} /><path d="M5 21c0-3.9 3.1-7 7-7s7 3.1 7 7" {...base(color, strokeWidth)} /></Svg>
  ),
  settings: ({ size, color = "#9A9AB0", strokeWidth }: P) => (
    <Svg size={size}><circle cx="12" cy="12" r="3.2" {...base(color, strokeWidth ?? 1.9)} /><path d="M12 2.2 13.4 5a7.8 7.8 0 0 1 2.1.9l2.9-1 1.7 3-2.2 2.1a7.8 7.8 0 0 1 0 2l2.2 2.1-1.7 3-2.9-1a7.8 7.8 0 0 1-2.1.9L12 21.8l-1.4-2.8a7.8 7.8 0 0 1-2.1-.9l-2.9 1-1.7-3 2.2-2.1a7.8 7.8 0 0 1 0-2L3.9 9.9l1.7-3 2.9 1A7.8 7.8 0 0 1 10.6 7L12 2.2Z" {...base(color, strokeWidth ?? 1.7)} /></Svg>
  ),
  edit: ({ size, color = "#9A9AB0", strokeWidth }: P) => (
    <Svg size={size}><path d="M4 20h4l10.5-10.5a2 2 0 0 0 0-2.8l-1.2-1.2a2 2 0 0 0-2.8 0L4 16v4Z" {...base(color, strokeWidth ?? 1.9)} /><path d="m13.5 6.5 4 4" {...base(color, strokeWidth ?? 1.9)} /></Svg>
  ),
  google: ({ size = 18 }: P) => (
    <Svg size={size} viewBox="0 0 18 18"><path fill="#4285F4" d="M17.6 9.2c0-.6-.1-1.2-.2-1.8H9v3.5h4.8a4.1 4.1 0 0 1-1.8 2.7v2.2h2.9c1.7-1.6 2.7-3.9 2.7-6.6Z"/><path fill="#34A853" d="M9 18c2.4 0 4.5-.8 6-2.2l-2.9-2.2c-.8.5-1.8.9-3.1.9-2.4 0-4.4-1.6-5.1-3.8H.9v2.3A9 9 0 0 0 9 18Z"/><path fill="#FBBC05" d="M3.9 10.7a5.4 5.4 0 0 1 0-3.4V5H.9a9 9 0 0 0 0 8l3-2.3Z"/><path fill="#EA4335" d="M9 3.6c1.3 0 2.5.5 3.4 1.3l2.6-2.6A9 9 0 0 0 .9 5l3 2.3C4.6 5.2 6.6 3.6 9 3.6Z"/></Svg>
  ),
  apple: ({ size = 18, color = "#F4F4F7" }: P) => (
    <Svg size={size} viewBox="0 0 17 20"><path fill={color} d="M14.1 15.3c-.3.7-.6 1.3-1 1.9-.6.8-1 1.4-1.4 1.7-.5.5-1.1.7-1.7.8-.4 0-1-.1-1.6-.4-.6-.2-1.2-.4-1.7-.4-.5 0-1.1.1-1.8.4-.6.3-1.1.4-1.5.4-.6 0-1.2-.3-1.8-.8-.4-.3-.9-.9-1.5-1.8C.5 16 0 14.4 0 12.8c0-1.4.3-2.7 1-3.7.5-.8 1.1-1.4 2-1.9.8-.4 1.6-.6 2.5-.7.4 0 1 .2 1.8.5.7.3 1.2.4 1.4.4.1 0 .7-.2 1.6-.5.8-.3 1.5-.4 2-.4 1.5.1 2.6.7 3.4 1.7-1.3.8-2 1.9-2 3.4 0 1.1.4 2.1 1.2 2.8.4.3.8.6 1.2.7-.1.3-.2.5-.3.8ZM10.6.4c0 1-.4 2-1.1 2.8-.9 1-2 1.6-3.2 1.5 0-.1 0-.2 0-.4 0-1 .4-2 1.2-2.8.4-.4.9-.8 1.5-1C9.5.4 10 .3 10.6.3v.1Z"/></Svg>
  ),
  star: ({ size, color = "#B7FF2A", fill = "#B7FF2A" }: P) => (
    <Svg size={size}><path d="m12 2.5 2.9 5.9 6.5.95-4.7 4.58 1.1 6.47L12 17.9l-5.8 3.06 1.1-6.47-4.7-4.58 6.5-.95L12 2.5Z" fill={fill} stroke={color} strokeWidth={1.2} strokeLinejoin="round" /></Svg>
  ),
  lightning: ({ size, color, fill = "#7657FF" }: P) => (
    <Svg size={size}><path d="M13 2 4 13.5h6L9.5 22 20 10h-6.5L13 2Z" fill={fill} stroke={color ?? fill} strokeWidth={1.4} strokeLinejoin="round" /></Svg>
  ),
  hd: ({ size, color = "#F4F4F7" }: P) => (
    <Svg size={size}><rect x="2.5" y="6" width="19" height="12" rx="3" {...base(color, 1.8)} /><path d="M7 9.5v5M7 12h2.6M9.6 9.5v5" {...base(color, 1.8)} /><path d="M13.4 9.5v5h1.8a2 2 0 0 0 2-2v-1a2 2 0 0 0-2-2h-1.8Z" {...base(color, 1.8)} /></Svg>
  ),
  history: ({ size, color = "#F4F4F7" }: P) => (
    <Svg size={size}><path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1M3.5 4.5V9H8" {...base(color, 1.9)} /><path d="M12 7.5V12l3 1.8" {...base(color, 1.9)} /></Svg>
  ),
  shield: ({ size, color = "#F4F4F7" }: P) => (
    <Svg size={size}><path d="M12 2.5 4.5 5.5v5c0 4.5 3.1 7.9 7.5 9.5 4.4-1.6 7.5-5 7.5-9.5v-5L12 2.5Z" {...base(color, 1.9)} /><path d="m9 12 2 2 4-4" {...base(color, 1.9)} /></Svg>
  ),
  bell: ({ size, color = "#F4F4F7" }: P) => (
    <Svg size={size}><path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6Z" {...base(color, 1.9)} /><path d="M10.5 19a1.8 1.8 0 0 0 3 0" {...base(color, 1.9)} /></Svg>
  ),
  account: ({ size, color = "#F4F4F7" }: P) => (
    <Svg size={size}><circle cx="12" cy="8" r="3.4" {...base(color, 1.9)} /><path d="M5.5 20a6.5 6.5 0 0 1 13 0" {...base(color, 1.9)} /></Svg>
  ),
  mic: ({ size, color = "#F4F4F7", strokeWidth }: P) => (
    <Svg size={size}><rect x="9" y="2" width="6" height="12" rx="3" {...base(color, strokeWidth)} /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" {...base(color, strokeWidth)} /></Svg>
  ),
  cam: ({ size, color = "#F4F4F7", strokeWidth }: P) => (
    <Svg size={size}><rect x="2" y="6" width="14" height="12" rx="2.5" {...base(color, strokeWidth)} /><path d="m16 10 6-3v10l-6-3" {...base(color, strokeWidth)} /></Svg>
  ),
  chat: ({ size, color = "#F4F4F7", strokeWidth }: P) => (
    <Svg size={size}><path d="M21 11.5a8 8 0 0 1-11.5 7.2L4 20l1.3-4.5A8 8 0 1 1 21 11.5Z" {...base(color, strokeWidth)} /></Svg>
  ),
  flag: ({ size, color = "#FF5C5C", strokeWidth }: P) => (
    <Svg size={size}><path d="M4 21V4M4 4h13l-2 4 2 4H4" {...base(color, strokeWidth)} /></Svg>
  ),
  plus: ({ size, color = "#F4F4F7", strokeWidth }: P) => (
    <Svg size={size}><path d="M12 5v14M5 12h14" {...base(color, strokeWidth ?? 2.4)} /></Svg>
  ),
  enter: ({ size, color = "#F4F4F7", strokeWidth }: P) => (
    <Svg size={size}><path d="M15 3h4a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1h-4M10 17l5-5-5-5M15 12H3" {...base(color, strokeWidth ?? 2)} /></Svg>
  ),
  close: ({ size, color = "#F4F4F7", strokeWidth }: P) => (
    <Svg size={size}><path d="M6 6l12 12M18 6 6 18" {...base(color, strokeWidth ?? 2.2)} /></Svg>
  ),
  chevron: ({ size, color = "#9A9AB0", strokeWidth }: P) => (
    <Svg size={size}><path d="m9 6 6 6-6 6" {...base(color, strokeWidth ?? 2)} /></Svg>
  ),
  pin: ({ size, color = "#B7FF2A" }: P) => (
    <Svg size={size}><path d="M12 21s-6.5-5.3-6.5-10.2A6.5 6.5 0 0 1 18.5 10.8C18.5 15.7 12 21 12 21Z" {...base(color, 1.9)} /><circle cx="12" cy="10.5" r="2.3" {...base(color, 1.9)} /></Svg>
  ),
  trend: ({ size, color = "#B7FF2A" }: P) => (
    <Svg size={size}><path d="M3 17l6-6 4 4 7-8M16 7h5v5" {...base(color, 2)} /></Svg>
  ),
  gift: ({ size, color, strokeWidth }: P) => (
    <Svg size={size}><path d="M20 12v8a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-8M2 7h20v5H2zM12 21V7M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7zM12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z" {...base(color, strokeWidth ?? 1.8)} /></Svg>
  ),
  link: ({ size, color, strokeWidth }: P) => (
    <Svg size={size}><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" {...base(color, strokeWidth ?? 1.9)} /></Svg>
  ),
  copy: ({ size, color, strokeWidth }: P) => (
    <Svg size={size}><rect x="9" y="9" width="11" height="11" rx="2" {...base(color, strokeWidth ?? 1.9)} /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" {...base(color, strokeWidth ?? 1.9)} /></Svg>
  ),
  share: ({ size, color, strokeWidth }: P) => (
    <Svg size={size}><circle cx="18" cy="5" r="3" {...base(color, strokeWidth ?? 1.9)} /><circle cx="6" cy="12" r="3" {...base(color, strokeWidth ?? 1.9)} /><circle cx="18" cy="19" r="3" {...base(color, strokeWidth ?? 1.9)} /><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4" {...base(color, strokeWidth ?? 1.9)} /></Svg>
  ),
  send: ({ size, color, strokeWidth }: P) => (
    <Svg size={size}><path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7Z" {...base(color, strokeWidth ?? 1.9)} /></Svg>
  ),
  users: ({ size, color, strokeWidth }: P) => (
    <Svg size={size}><circle cx="9" cy="8" r="3.2" {...base(color, strokeWidth ?? 1.9)} /><path d="M3.5 20c0-3.3 2.6-6 5.5-6s5.5 2.7 5.5 6" {...base(color, strokeWidth ?? 1.9)} /><path d="M16 5.2a3.2 3.2 0 0 1 0 5.6M17.5 14c2.5.4 4.5 2.9 4.5 6" {...base(color, strokeWidth ?? 1.9)} /></Svg>
  ),
};

export type IconName = keyof typeof Icon;

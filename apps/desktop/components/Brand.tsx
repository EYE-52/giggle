'use client';
import { useEffect, useState, type CSSProperties } from 'react';
import { logoPaths, logoViewBox } from '@giggle/ui-tokens';

export function Logomark({ size = 32, animated = false }: { size?: number; glow?: boolean; animated?: boolean }) {
  const [drawing, setDrawing] = useState(animated);
  useEffect(() => {
    setDrawing(animated);
    if (!animated) return;
    const finish = window.setTimeout(() => setDrawing(false), 1400);
    return () => window.clearTimeout(finish);
  }, [animated]);
  return <svg className={`gg-logomark ${drawing ? 'gg-logo-draw' : ''}`} width={size} height={size} viewBox={logoViewBox} fill="none" aria-hidden="true" style={{ color: 'var(--accent, #ba4b33)' }}>
    {logoPaths.map((path) => <path key={path} d={path} stroke="currentColor" strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round" />)}
  </svg>;
}
export function Wordmark({ size = 25, mark = true }: { size?: number; mark?: boolean }) {
  const style: CSSProperties = { display:'inline-flex', alignItems:'center', gap:9, fontFamily:'var(--font-display)', fontWeight:800, fontSize:size, letterSpacing:'-.055em', color:'var(--text)' };
  return <span style={style}>{mark && <Logomark size={size * 1.3}/>}<span>giggle</span></span>;
}

import React, { useEffect, useRef } from 'react';
import { AccessibilityInfo, Animated, Easing } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { logoPaths, logoViewBox } from '@giggle/ui-tokens';
import { COLORS } from '../constants/theme';

const AnimatedPath = Animated.createAnimatedComponent(Path);

export function Logomark({ size = 32, animated = false }: { size?: number; animated?: boolean }) {
  const first = useRef(new Animated.Value(0)).current;
  const second = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    let active = true;
    let animation: Animated.CompositeAnimation | undefined;
    const still = () => { animation?.stop(); first.setValue(0); second.setValue(0); };
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', reduced => { if (reduced) still(); });
    if (animated) {
      AccessibilityInfo.isReduceMotionEnabled().then(reduced => {
        if (!active || reduced) return;
        first.setValue(200); second.setValue(200);
        animation = Animated.stagger(280, [first, second].map(value => Animated.timing(value, {
          toValue: 0, duration: 850, easing: Easing.out(Easing.cubic), useNativeDriver: false,
        })));
        animation.start();
      }).catch(still);
    } else still();
    return () => { active = false; animation?.stop(); subscription.remove(); };
  }, [animated, first, second]);
  return <Svg width={size} height={size} viewBox={logoViewBox} fill="none" accessible={false}>
    {logoPaths.map((path, index) => <AnimatedPath key={path} d={path} stroke={COLORS.violet} strokeWidth={3.5}
      strokeLinecap="round" strokeLinejoin="round" strokeDasharray="200 200" strokeDashoffset={index === 0 ? first : second} />)}
  </Svg>;
}

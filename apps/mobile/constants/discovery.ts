import { Platform } from 'react-native';

export function isNativeDiscoveryEnabled(
  sharedFlag = process.env.EXPO_PUBLIC_STRANGER_DISCOVERY_ENABLED,
  iosFlag = process.env.EXPO_PUBLIC_IOS_DISCOVERY_ENABLED,
  platform = Platform.OS,
) {
  return sharedFlag !== 'false' && (platform !== 'ios' || iosFlag !== 'false');
}

export const NATIVE_DISCOVERY_ENABLED = isNativeDiscoveryEnabled();

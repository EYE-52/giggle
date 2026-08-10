export function isWebDiscoveryEnabled(
  flag = process.env.NEXT_PUBLIC_STRANGER_DISCOVERY_ENABLED,
) {
  return flag !== "false";
}

export const WEB_DISCOVERY_ENABLED = isWebDiscoveryEnabled();

/** Keep SDK details out of device notices while describing the recovery action. */
export function describeVideoError(error: unknown): string {
  const detail = error as { name?: string; code?: string; message?: string } | null;
  const text = `${detail?.name ?? ""} ${detail?.code ?? ""} ${detail?.message ?? ""}`;
  if (/PERMISSION_DENIED|NotAllowed|SecurityError|Permission denied/i.test(text)) return "Camera or microphone access is blocked. Check your browser permissions and try again.";
  if (/DEVICE_NOT_FOUND|NotFoundError/i.test(text)) return "No usable camera or microphone was found. Connect a device and try again.";
  if (/DEVICE_IN_USE|NotReadableError|TrackStartError/i.test(text)) return "Another app may be using your camera or microphone. Close it and try again.";
  if (/AGORA_NOT_CONFIGURED|NOT_CONFIGURED|not available|unavailable/i.test(text)) return "Video isn't available right now.";
  return "Couldn't connect video. You can still use chat.";
}

import { api, parseCharacter, getDefaultAvatarById, getStoredAvatar, isCustomAvatar, setMyAvatar } from "@giggle/core";

/**
 * Sets this device's avatar and, for illustrated avatars, saves it on the
 * server profile so friends and squads see it. Custom photos stay local.
 */
export async function saveMyAvatar(value: string): Promise<void> {
  if (getDefaultAvatarById(value) || parseCharacter(value)) await api.updateMyProfile({ avatar: value });
  setMyAvatar(value);
}

/**
 * Reconciles this device with the server profile's avatar. Returns true when
 * the person has never picked an avatar on any device (show the first-run picker).
 */
export function reconcileMyAvatar(serverAvatar: string | null | undefined): boolean {
  const local = getStoredAvatar();
  if (serverAvatar && (getDefaultAvatarById(serverAvatar) || parseCharacter(serverAvatar))) {
    // A local custom photo wins on this device; otherwise follow the account.
    if (local !== serverAvatar && !(local && isCustomAvatar(local))) setMyAvatar(serverAvatar);
    return false;
  }
  if (local && (getDefaultAvatarById(local) || parseCharacter(local))) {
    // Picked before avatars were shared: publish it once.
    void api.updateMyProfile({ avatar: local }).catch(() => {});
    return false;
  }
  return !local;
}

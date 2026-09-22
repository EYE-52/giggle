"use client";
import { useEffect, useState } from "react";
import { getMyAvatar, resolveAvatar, session, subscribeAvatar } from "@giggle/core";
import { AvatarArt } from "./AvatarArt";

/** Your own avatar as picked on this device (custom uploads included). */
export function useMyAvatar(): string | null {
  const [value, setValue] = useState<string | null>(null);
  useEffect(() => {
    setValue(getMyAvatar(session.user?.id));
    return subscribeAvatar(setValue);
  }, []);
  return value;
}

/**
 * A person's illustrated avatar: their shared pick, or a stable default seeded
 * from their user id, so everyone sees the same face for them. Never initials.
 */
export function PersonAvatar({ userId, name, avatar, size = 40, online, isMe = false }: {
  userId?: string;
  name: string;
  avatar?: string | null;
  size?: number;
  online?: boolean;
  isMe?: boolean;
}) {
  const mine = useMyAvatar();
  const value = isMe && mine ? mine : resolveAvatar(avatar, userId || name);
  return <AvatarArt value={value} size={size} online={online} />;
}

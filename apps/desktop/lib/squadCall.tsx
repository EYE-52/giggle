"use client";
import { useEffect, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { api } from "@giggle/core";
import { createCallSession, createVideoClient, preloadVideoSdk } from "@giggle/agora";

export const squadCall = createCallSession({
  createClient: createVideoClient,
  async getToken(squadId, encounterId) {
    if (!encounterId) return api.lobbyToken(squadId);
    await api.setEncounterVideo(squadId, true);
    return api.encounterToken(squadId, encounterId);
  },
  async setPresence(squadId, encounterId, on) {
    if (encounterId && on) {
      // Lobby-off also clears encounter presence on the server. Set the new
      // encounter flag afterwards, once the channel transfer has succeeded.
      await api.setLobbyVideo(squadId, false);
      return api.setEncounterVideo(squadId, true);
    }
    if (on) await api.setEncounterVideo(squadId, false);
    // Lobby-off clears both flags, including a prepared but cancelled join.
    return api.setLobbyVideo(squadId, on);
  },
});

export function useSquadCall(squadId: string) {
  const state = useSyncExternalStore(squadCall.subscribe, squadCall.getSnapshot, squadCall.getServerSnapshot);
  useEffect(() => { if (squadId) squadCall.bindSquad(squadId); }, [squadId]);
  return state.squadId === squadId ? state : squadCall.getServerSnapshot();
}

/** Mounted by the authenticated layout, which outlives individual call pages. */
export function SquadCallLifetime() {
  const path = usePathname();
  useEffect(() => {
    if (!["/lobby", "/matchmaking", "/match", "/encounter"].includes(path)) {
      void squadCall.stop();
      return;
    }
    void preloadVideoSdk().catch(() => {});
    if (path !== "/encounter") void squadCall.returnToSquad().catch(() => {});
  }, [path]);
  useEffect(() => () => { void squadCall.stop(); }, []);
  return null;
}

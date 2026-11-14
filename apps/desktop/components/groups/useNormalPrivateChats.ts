"use client";
import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { api } from "@giggle/core";
import { squadCall } from "@/lib/squadCall";
import { usePrivateChats, type PrivateChatAdapter } from "./PrivateChats";
export function useNormalPrivateChats(squadId: string | undefined) {
    const router = useRouter();
    const adapter = useMemo<PrivateChatAdapter>(() => ({
        list: async (source) => (await api.privateGroupRequests(source)).requests.map(r => ({ id: r.requestId, alias: r.member?.displayName || "Former member", mode: r.communicationMode, direction: r.direction, status: r.status, expiresAt: Date.parse(r.expiresAt), roomPath: r.resultSquadId ? `/lobby?squad=${encodeURIComponent(r.resultSquadId)}` : undefined })),
        invite: async (source, member) => { await api.requestPrivateGroup(source, member); }, accept: async (id) => { await api.acceptPrivateGroup(id); }, decline: async (id) => { await api.declinePrivateGroup(id); }, cancel: async (id) => { await api.cancelPrivateGroup(id); },
        open: async (path) => { await squadCall.stop(); router.push(path); },
    }), [router]);
    return usePrivateChats(squadId, adapter);
}

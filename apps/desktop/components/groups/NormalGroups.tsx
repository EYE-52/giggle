"use client";
import { api, type GroupDraft as ApiDraft } from "@giggle/core";
import { GroupPages, type GroupAdapter } from "./GroupPages";
import type { GroupDraft } from "./GroupComposer";
import type { GroupListing } from "./GroupDirectory";

function draft(value: GroupDraft): ApiDraft {
  return {
    squadName: value.title, description: value.description,
    publicTopic: value.publicTopic as ApiDraft["publicTopic"], language: value.language as ApiDraft["language"],
    visibility: value.visibility, joinPolicy: value.joinPolicy,
    identityMode: value.identityMode, communicationMode: value.mode, alias: value.alias,
  };
}
type ListingInput = {
  squadId: string; squadName: string; description?: string; publicTopic?: string; language?: string;
  identityMode?: "names" | "aliases"; communicationMode?: "chat" | "voice" | "video";
  memberCount?: number; onlineCount?: number; maxSlots?: number; joinPolicy?: "open" | "request" | "invite";
};
function listing(group: ListingInput): GroupListing {
  return {
    id: group.squadId, title: group.squadName, description: group.description,
    publicTopic: group.publicTopic, language: group.language, identityMode: group.identityMode,
    mode: group.communicationMode || "video", memberCount: group.memberCount || 0,
    onlineCount: group.onlineCount || 0, capacity: group.maxSlots || 6, joinPolicy: group.joinPolicy || "open",
  };
}
const adapter: GroupAdapter = {
  async list(filters, signal) {
    const query = {
      search: filters.search.trim() || undefined,
      communicationMode: (filters.mode || undefined) as ApiDraft["communicationMode"] | undefined,
      publicTopic: (filters.publicTopic || undefined) as ApiDraft["publicTopic"],
      language: (filters.language || undefined) as ApiDraft["language"],
    };
    const result = filters.mine ? await api.mySquads(query, { signal }) : await api.discoverSquads(query, { signal });
    return result.squads.map(listing);
  },
  async get(id, invite) {
    const preview = await api.previewGroup(id, invite);
    if (preview.viewerMembership === "none" || preview.viewerMembership === "pending") {
      return { group: { ...listing(preview), visibility: preview.visibility }, status: preview.viewerMembership };
    }
    const group = await api.getGroup(id);
    const owner = group.selfMemberId === group.leaderMemberId;
    const [requests, bans] = owner ? await Promise.all([api.joinRequests(id), api.groupBans(id)]) : [{ requests: [] }, { bans: [] }];
    return {
      group: { ...listing({ ...group, memberCount: group.members.length }), visibility: group.visibility },
      status: owner ? "owner" : "member",
      members: owner ? group.members.map(person => ({ id: person.memberId, alias: person.displayName, owner: person.memberId === group.leaderMemberId })) : undefined,
      requests: requests.requests.map(person => ({ id: person.userId, alias: person.name })),
      bans: bans.bans.map(person => ({ id: person.memberId, alias: person.displayName })),
    };
  },
  async create(value) { return (await api.createGroup(draft(value))).squadId; },
  async save(id, value) {
    const { communicationMode, identityMode, alias, ...settings } = draft(value);
    await api.updateGroup(id, settings);
  },
  async join(id, alias, invite) { await api.joinGroup(id, { alias: alias || undefined, invite }); },
  async open(id) { return `/lobby?squad=${encodeURIComponent(id)}`; },
  async invite(id) { return (await api.groupInvite(id)).invite; },
  async leave(id, successor) { await api.leaveGroup(id, successor); },
  async remove(id) { await api.deleteGroup(id); },
  async cancel(id) { await api.cancelGroupJoin(id); },
  async moderate(id, action, member) {
    if (action === "approve") await api.approveJoinRequest(id, member);
    else if (action === "reject") await api.declineJoinRequest(id, member);
    else if (action === "kick") await api.banGroupMember(id, member);
    else await api.unbanGroupMember(id, member);
  },
};
export function NormalGroups({ id, creating = false }: { id?: string; creating?: boolean }) {
  return <GroupPages key={id || (creating ? "new" : "directory")} adapter={adapter} id={id} creating={creating} />;
}

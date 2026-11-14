/** Server self handles keep anonymous call/chat identity out of account space. */
type GroupIdentity = {
  identityMode?: "names" | "aliases";
  selfUserId?: string;
  selfMemberId?: string;
};
export function groupViewerId(
  group: GroupIdentity | null | undefined,
  accountId?: string,
): string {
  return (
    group?.selfUserId ||
    (group?.identityMode === "aliases" ? "" : accountId || "")
  );
}
export function isOwnGroupMember(
  group: GroupIdentity | null | undefined,
  member: { userId?: string; memberId?: string },
  accountId?: string,
): boolean {
  if (group?.selfMemberId) return member.memberId === group.selfMemberId;
  const id = groupViewerId(group, accountId);
  return !!id && member.userId === id;
}

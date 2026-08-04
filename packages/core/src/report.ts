export interface ReportableEncounter {
  squadAId?: string;
  squadBId?: string;
}

export interface BlockableEncounter extends ReportableEncounter {
  squadAMembers?: Array<{ userId?: unknown }>;
  squadBMembers?: Array<{ userId?: unknown }>;
}

export interface OpponentUsersInput {
  squadId?: string;
  ownUserId?: string;
  encounter?: BlockableEncounter | null;
}

export interface ReportOpponentInput {
  encounterId?: string;
  squadId?: string;
  encounter?: ReportableEncounter | null;
  category?: SafetyReportCategory;
  details?: string;
}

export type SafetyReportCategory = "harassment" | "hate" | "sexual" | "minor_safety" | "spam" | "other";
export type SafetyReportStatus = "open" | "reviewing" | "actioned" | "dismissed";

export interface ReportOpponentPayload {
  encounterId: string;
  squadId: string;
  reportedSquadId: string;
  category: SafetyReportCategory;
  details?: string;
}

export type ReportSendResult =
  | { ok: true; reportId: string; status: SafetyReportStatus }
  | { ok: false; error: string };

const REPORT_CATEGORIES = new Set<SafetyReportCategory>([
  "harassment", "hate", "sexual", "minor_safety", "spam", "other",
]);
const USER_ID_PATTERN = /^[a-f0-9]{24}$/;

function canonicalUserId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return USER_ID_PATTERN.test(normalized) ? normalized : null;
}

export function createOpponentUserIds(input: OpponentUsersInput): string[] | null {
  const squadId = input.squadId;
  const squadAId = input.encounter?.squadAId;
  const squadBId = input.encounter?.squadBId;
  const ownUserId = canonicalUserId(input.ownUserId);
  if (!squadId || !squadAId || !squadBId || squadAId === squadBId || !ownUserId) return null;

  const rosters = squadId === squadAId
    ? [input.encounter?.squadAMembers, input.encounter?.squadBMembers]
    : squadId === squadBId
      ? [input.encounter?.squadBMembers, input.encounter?.squadAMembers]
      : null;
  if (!rosters) return null;

  const [ownMembers, opponentMembers] = rosters;
  if (!ownMembers?.length || ownMembers.length > 8 || !opponentMembers?.length || opponentMembers.length > 8) return null;
  const ownIds = ownMembers.map((member) => canonicalUserId(member.userId));
  const opponentIds = opponentMembers.map((member) => canonicalUserId(member.userId));
  if (ownIds.includes(null) || opponentIds.includes(null) || !ownIds.includes(ownUserId)) return null;

  const ownUserIds = new Set(ownIds as string[]);
  const result = [...new Set((opponentIds as string[]).filter((userId) => !ownUserIds.has(userId)))];
  return result.length > 0 && result.length <= 8 ? result : null;
}

export function createReportOpponentPayload(input: ReportOpponentInput): ReportOpponentPayload | null {
  const encounterId = input.encounterId?.trim();
  const squadId = input.squadId?.trim();
  const squadAId = input.encounter?.squadAId?.trim();
  const squadBId = input.encounter?.squadBId?.trim();
  const category = input.category ?? "other";
  if (input.details !== undefined && typeof input.details !== "string") return null;
  const details = input.details?.replace(/\s+/g, " ").trim();

  if (!encounterId || !squadId || !squadAId || !squadBId || !REPORT_CATEGORIES.has(category)) return null;
  if (details && details.length > 500) return null;
  const report = { encounterId, squadId, category, ...(details ? { details } : {}) };
  if (squadId === squadAId) return { ...report, reportedSquadId: squadBId };
  if (squadId === squadBId) return { ...report, reportedSquadId: squadAId };
  return null;
}

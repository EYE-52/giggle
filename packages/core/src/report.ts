export interface ReportableEncounter {
  squadAId?: string;
  squadBId?: string;
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

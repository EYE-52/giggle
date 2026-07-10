export interface ReportableEncounter {
  squadAId?: string;
  squadBId?: string;
}

export interface ReportOpponentInput {
  encounterId?: string;
  squadId?: string;
  encounter?: ReportableEncounter | null;
}

export interface ReportOpponentPayload {
  encounterId: string;
  squadId: string;
  reportedSquadId: string;
}

export function createReportOpponentPayload(input: ReportOpponentInput): ReportOpponentPayload | null {
  const encounterId = input.encounterId?.trim();
  const squadId = input.squadId?.trim();
  const squadAId = input.encounter?.squadAId?.trim();
  const squadBId = input.encounter?.squadBId?.trim();

  if (!encounterId || !squadId || !squadAId || !squadBId) return null;
  if (squadId === squadAId) return { encounterId, squadId, reportedSquadId: squadBId };
  if (squadId === squadBId) return { encounterId, squadId, reportedSquadId: squadAId };
  return null;
}

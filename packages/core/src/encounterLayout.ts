export type EncounterViewportClass = "phone" | "narrow" | "wide";
export type EncounterSide = "mine" | "theirs";
export type EncounterLayoutKind =
  | "remote-main"
  | "squad-split"
  | "featured-split"
  | "single-focus"
  | "dual-focus";

export interface EncounterLayoutParticipant {
  id: string;
  side: EncounterSide;
}

export interface SpeakerFocusState {
  focusedId: string | null;
  focusedSince: number;
  candidateId: string | null;
  candidateSince: number;
}

export interface EncounterLayout {
  kind: EncounterLayoutKind;
  focusId: string | null;
  minePrimaryId: string | null;
  theirsPrimaryId: string | null;
  mineStripIds: string[];
  theirsStripIds: string[];
}

export const EMPTY_SPEAKER_FOCUS: SpeakerFocusState = {
  focusedId: null,
  focusedSince: 0,
  candidateId: null,
  candidateSince: 0,
};

const CANDIDATE_MS = 600;
const HOLD_MS = 1500;

export function advanceSpeakerFocus(
  participantIds: readonly string[],
  previous: SpeakerFocusState,
  activeSpeakerId: string | null,
  now: number
): SpeakerFocusState {
  const valid = new Set(participantIds);
  const focusedId = previous.focusedId && valid.has(previous.focusedId)
    ? previous.focusedId
    : null;
  const base = focusedId === previous.focusedId
    ? previous
    : { ...previous, focusedId, focusedSince: focusedId ? previous.focusedSince : 0 };

  if (!activeSpeakerId || !valid.has(activeSpeakerId) || activeSpeakerId === focusedId) {
    if (base.candidateId === null && base.candidateSince === 0) return base;
    return { ...base, candidateId: null, candidateSince: 0 };
  }
  if (base.candidateId !== activeSpeakerId) {
    return { ...base, candidateId: activeSpeakerId, candidateSince: now };
  }
  if (now - base.candidateSince < CANDIDATE_MS) return base;
  if (focusedId && now - base.focusedSince < HOLD_MS) return base;
  return {
    focusedId: activeSpeakerId,
    focusedSince: now,
    candidateId: null,
    candidateSince: 0,
  };
}

export function deriveEncounterLayout(input: {
  viewport: EncounterViewportClass;
  mine: readonly EncounterLayoutParticipant[];
  theirs: readonly EncounterLayoutParticipant[];
  pinnedId?: string | null;
  automaticFocusId?: string | null;
}): EncounterLayout {
  const mineIds = input.mine.map((person) => person.id);
  const theirsIds = input.theirs.map((person) => person.id);
  const allIds = [...mineIds, ...theirsIds];
  const valid = new Set(allIds);
  const pinnedId = input.pinnedId && valid.has(input.pinnedId) ? input.pinnedId : null;
  const automaticFocusId = input.automaticFocusId && valid.has(input.automaticFocusId)
    ? input.automaticFocusId
    : null;
  const total = allIds.length;

  if (total === 2 && mineIds.length === 1 && theirsIds.length === 1) {
    const focusId = pinnedId ?? theirsIds[0];
    return {
      kind: "remote-main",
      focusId,
      minePrimaryId: mineIds.includes(focusId) ? focusId : null,
      theirsPrimaryId: theirsIds.includes(focusId) ? focusId : null,
      mineStripIds: mineIds.filter((id) => id !== focusId),
      theirsStripIds: theirsIds.filter((id) => id !== focusId),
    };
  }
  if (pinnedId) {
    return {
      kind: "single-focus",
      focusId: pinnedId,
      minePrimaryId: mineIds.includes(pinnedId) ? pinnedId : null,
      theirsPrimaryId: theirsIds.includes(pinnedId) ? pinnedId : null,
      mineStripIds: mineIds.filter((id) => id !== pinnedId),
      theirsStripIds: theirsIds.filter((id) => id !== pinnedId),
    };
  }
  if (total <= 4) {
    return {
      kind: "squad-split",
      focusId: null,
      minePrimaryId: null,
      theirsPrimaryId: null,
      mineStripIds: mineIds,
      theirsStripIds: theirsIds,
    };
  }

  const minePrimaryId = automaticFocusId && mineIds.includes(automaticFocusId)
    ? automaticFocusId
    : mineIds[0] ?? null;
  const theirsPrimaryId = automaticFocusId && theirsIds.includes(automaticFocusId)
    ? automaticFocusId
    : theirsIds[0] ?? null;
  if (total <= 8) {
    return {
      kind: "featured-split",
      focusId: automaticFocusId,
      minePrimaryId,
      theirsPrimaryId,
      mineStripIds: mineIds.filter((id) => id !== minePrimaryId),
      theirsStripIds: theirsIds.filter((id) => id !== theirsPrimaryId),
    };
  }
  if (input.viewport === "wide") {
    return {
      kind: "dual-focus",
      focusId: automaticFocusId,
      minePrimaryId,
      theirsPrimaryId,
      mineStripIds: mineIds.filter((id) => id !== minePrimaryId),
      theirsStripIds: theirsIds.filter((id) => id !== theirsPrimaryId),
    };
  }

  const focusId = automaticFocusId ?? theirsIds[0] ?? mineIds[0] ?? null;
  return {
    kind: "single-focus",
    focusId,
    minePrimaryId: focusId && mineIds.includes(focusId) ? focusId : null,
    theirsPrimaryId: focusId && theirsIds.includes(focusId) ? focusId : null,
    mineStripIds: mineIds.filter((id) => id !== focusId),
    theirsStripIds: theirsIds.filter((id) => id !== focusId),
  };
}

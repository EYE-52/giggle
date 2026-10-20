// Client-side mirror of the server's alias rules (server/src/services/
// encounterIdentityService.js). The server stays the authority and also
// rejects offensive names; this only gives instant feedback.
export const ENCOUNTER_ALIAS_MIN_LENGTH = 2;
export const ENCOUNTER_ALIAS_MAX_LENGTH = 24;
const ENCOUNTER_ALIAS_PATTERN = /^[\p{L}\p{N}](?:[\p{L}\p{N} ._'-]*[\p{L}\p{N}])?$/u;

export type EncounterAliasCheck = { value: string; error?: undefined } | { value?: undefined; error: string };

/** Trim and validate an alias. An empty value is allowed (it clears the alias). */
export function checkEncounterAlias(raw: string): EncounterAliasCheck {
  const value = raw.normalize("NFC").replace(/\s+/g, " ").trim();
  if (!value) return { value: "" };
  if (value.length < ENCOUNTER_ALIAS_MIN_LENGTH || value.length > ENCOUNTER_ALIAS_MAX_LENGTH) {
    return { error: `Use ${ENCOUNTER_ALIAS_MIN_LENGTH} to ${ENCOUNTER_ALIAS_MAX_LENGTH} characters.` };
  }
  if (!ENCOUNTER_ALIAS_PATTERN.test(value)) return { error: "Use letters, numbers, spaces and . _ ' -" };
  return { value };
}

/** The name the other squad sees for you, when you are anonymous. */
export function encounterAppearsAs(profile: { encounterAlias?: string; encounterAliasFallback?: string } | null | undefined): string {
  return profile?.encounterAlias || profile?.encounterAliasFallback || "a guest";
}

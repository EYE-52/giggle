const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const read = (file) => readFileSync(path.join(__dirname, "..", file), "utf8");

test("mobile profile offers 'Stay anonymous with other squads' with an alias input", () => {
  const card = read("components/EncounterAnonymityCard.tsx");
  const profile = read("app/(app)/profile.tsx");
  assert.match(profile, /<Text style=\{styles\.sectionLabel\}>Other squads<\/Text>\s*<EncounterAnonymityCard \/>/);
  assert.match(card, /Stay anonymous with other squads/);
  assert.match(card, /Your own squad still sees your name and avatar\./);
  assert.match(card, /<SwitchControl label="Stay anonymous with other squads"/);
  assert.match(card, /save\(\{ anonymousInEncounters: next/);
  assert.match(card, /save\(\{ encounterAlias: check\.value \}\)/);
  assert.match(card, /checkEncounterAlias\(alias\)/);
  assert.match(card, /maxLength=\{ENCOUNTER_ALIAS_MAX_LENGTH\}/);
  assert.match(profile, /account\.anonymous \? ' · anonymous in a call' : ''/);
});

test("mobile encounter and match screens tell an anonymous user which name the other squad sees", () => {
  const encounter = read("app/(app)/encounter.tsx");
  const match = read("app/(app)/match.tsx");
  assert.match(encounter, /const myEncounterAlias = myMember\?\.anonymous \? myMember\.alias \?\? null : null;/);
  assert.match(encounter, /testID="encounter-anonymous-note"[\s\S]*You appear as \{myEncounterAlias\}/);
  assert.match(match, /testID="match-anonymous-note">You appear to \{theirName \|\| 'them'\} as \{myEncounterAlias\}/);
});

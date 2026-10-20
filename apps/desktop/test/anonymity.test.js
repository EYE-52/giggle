const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const read = (file) => readFileSync(path.join(__dirname, "..", file), "utf8");

test("profile offers 'Stay anonymous with other squads' with an alias input", () => {
  const settings = read("components/EncounterAnonymitySettings.tsx");
  const profile = read("app/(app)/profile/page.tsx");
  assert.match(profile, /<EncounterAnonymitySettings profile=\{loadedProfile\} onSaved=\{setLoadedProfile\} \/>/);
  assert.match(settings, /Stay anonymous with other squads/);
  assert.match(settings, /Your own squad still sees your name and avatar\./);
  assert.match(settings, /api\.updateMyProfile\(body\)/);
  assert.match(settings, /save\(\{ anonymousInEncounters: next/);
  assert.match(settings, /save\(\{ encounterAlias: check\.value \}\)/);
  assert.match(settings, /checkEncounterAlias\(alias\)/);
  assert.match(settings, /maxLength=\{ENCOUNTER_ALIAS_MAX_LENGTH\}/);
  // Anonymous blocks are labelled in the block list.
  assert.match(profile, /account\.anonymous && <span[^>]*> · anonymous in a call<\/span>/);
});

test("encounter and match screens tell an anonymous user which name the other squad sees", () => {
  const encounter = read("app/(app)/encounter/page.tsx");
  const match = read("app/(app)/match/page.tsx");
  assert.match(encounter, /const myEncounterAlias = myMember\?\.anonymous \? myMember\.alias \?\? null : null;/);
  assert.match(encounter, /data-testid="encounter-anonymous-note"[\s\S]*You appear as \{myEncounterAlias\}/);
  assert.match(match, /data-testid="match-anonymous-note"[^>]*>You appear to \{theirSide\?\.name \?\? "them"\} as \{myEncounterAlias\}/);
});

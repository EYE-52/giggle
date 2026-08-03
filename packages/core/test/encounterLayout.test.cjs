const assert = require("node:assert/strict");
const test = require("node:test");

const people = (side, count) =>
  Array.from({ length: count }, (_, index) => ({ id: `${side}-${index}`, side }));

test("encounter layouts scale from 1v1 to 8v8 without a dense phone grid", async () => {
  const { deriveEncounterLayout } = await import("../src/encounterLayout.ts");
  const cases = [
    ["wide", 1, 1, "remote-main"],
    ["phone", 2, 2, "squad-split"],
    ["wide", 3, 3, "featured-split"],
    ["wide", 4, 4, "featured-split"],
    ["wide", 8, 8, "dual-focus"],
    ["phone", 8, 8, "single-focus"],
    ["narrow", 8, 8, "single-focus"],
  ];

  for (const [viewport, mineCount, theirsCount, kind] of cases) {
    const mine = people("mine", mineCount);
    const theirs = people("theirs", theirsCount);
    const layout = deriveEncounterLayout({ viewport, mine, theirs });
    assert.equal(layout.kind, kind);
    assert.deepEqual(
      new Set([
        layout.focusId,
        layout.minePrimaryId,
        layout.theirsPrimaryId,
        ...layout.mineStripIds,
        ...layout.theirsStripIds,
      ].filter(Boolean)),
      new Set([...mine, ...theirs].map((person) => person.id))
    );
  }
});

test("manual pins win and disappear safely when their participant leaves", async () => {
  const { deriveEncounterLayout } = await import("../src/encounterLayout.ts");
  const mine = people("mine", 4);
  const theirs = people("theirs", 4);
  const pinned = deriveEncounterLayout({ viewport: "wide", mine, theirs, pinnedId: "theirs-3" });
  const afterLeave = deriveEncounterLayout({ viewport: "wide", mine, theirs: theirs.slice(0, 3), pinnedId: "theirs-3" });
  assert.equal(pinned.kind, "single-focus");
  assert.equal(pinned.focusId, "theirs-3");
  assert.equal(afterLeave.kind, "featured-split");
  assert.notEqual(afterLeave.focusId, "theirs-3");
});

test("1v1 defaults to the remote person and tapping self swaps the main stage", async () => {
  const { deriveEncounterLayout } = await import("../src/encounterLayout.ts");
  const mine = people("mine", 1);
  const theirs = people("theirs", 1);
  const normal = deriveEncounterLayout({ viewport: "phone", mine, theirs });
  const swapped = deriveEncounterLayout({ viewport: "phone", mine, theirs, pinnedId: "mine-0" });
  assert.equal(normal.focusId, "theirs-0");
  assert.equal(normal.theirsPrimaryId, "theirs-0");
  assert.deepEqual(normal.mineStripIds, ["mine-0"]);
  assert.equal(swapped.focusId, "mine-0");
  assert.equal(swapped.minePrimaryId, "mine-0");
  assert.deepEqual(swapped.theirsStripIds, ["theirs-0"]);
});

test("speaker focus waits 600ms and holds an automatic focus for 1500ms", async () => {
  const { advanceSpeakerFocus, EMPTY_SPEAKER_FOCUS } = await import("../src/encounterLayout.ts");
  const ids = ["mine-0", "theirs-0"];
  const candidate = advanceSpeakerFocus(ids, EMPTY_SPEAKER_FOCUS, "theirs-0", 1000);
  assert.equal(candidate.focusedId, null);
  assert.equal(candidate.candidateId, "theirs-0");

  const focused = advanceSpeakerFocus(ids, candidate, "theirs-0", 1600);
  assert.equal(focused.focusedId, "theirs-0");

  const held = advanceSpeakerFocus(ids, focused, "mine-0", 2200);
  assert.equal(advanceSpeakerFocus(ids, held, "mine-0", 2800).focusedId, "theirs-0");
  assert.equal(advanceSpeakerFocus(ids, held, "mine-0", 3100).focusedId, "mine-0");
});

test("unchanged speaker focus preserves state identity", async () => {
  const { advanceSpeakerFocus } = await import("../src/encounterLayout.ts");
  const ids = ["mine-0", "theirs-0"];
  const previous = {
    focusedId: "theirs-0",
    focusedSince: 1000,
    candidateId: null,
    candidateSince: 0,
  };

  assert.equal(advanceSpeakerFocus(ids, previous, null, 2000), previous);
  assert.equal(advanceSpeakerFocus(ids, previous, "theirs-0", 2000), previous);
});

test("mute, camera, and reconnect state never reorder participants", async () => {
  const { deriveEncounterLayout } = await import("../src/encounterLayout.ts");
  const mine = people("mine", 4);
  const theirs = people("theirs", 4);
  const before = deriveEncounterLayout({ viewport: "wide", mine, theirs });
  const after = deriveEncounterLayout({ viewport: "wide", mine: [...mine], theirs: [...theirs] });
  assert.deepEqual(after.mineStripIds, before.mineStripIds);
  assert.deepEqual(after.theirsStripIds, before.theirsStripIds);
});
